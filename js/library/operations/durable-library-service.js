import { createRepositoryError } from '../repository/contract-errors.js';
import { digestBulkOperationRequest } from './bulk-operation-protocol.js';

export const LIBRARY_SERVICE_ADAPTER_METHODS = Object.freeze([
  'receiveOperation',
  'lookupOperationResult',
  'getOperationStatus',
  'requestOperationCancel',
  'transitionOperation',
  'recordOperationProgress',
  'completeOperation'
]);

export class DurableLibraryService {
  constructor({ repository, handlers = {}, cryptoApi = globalThis.crypto, now = () => Date.now(), buildTimeoutMs = 30 * 60 * 1000 } = {}) {
    assertAdapter(repository);
    this.repository = repository;
    this.handlers = new Map(Object.entries(handlers));
    this.cryptoApi = cryptoApi;
    this.now = now;
    this.buildTimeoutMs = buildTimeoutMs;
    this.running = new Map();
  }

  async start(request) {
    const { canonical, requestDigest, runtime } = await digestBulkOperationRequest(request, this.cryptoApi);
    const receivedAt = this.now();
    const receipt = await this.repository.receiveOperation({
      clientRequestId: canonical.clientRequestId,
      requestDigest,
      canonicalRequestVersion: canonical.canonicalRequestVersion,
      operationKind: canonical.operationKind,
      target: canonical.target,
      expectedTargetVersion: canonical.expectedTargetVersion,
      sourceContextToken: canonical.selectionDescriptor?.contextToken ?? null,
      sourceSequenceIds: sequenceSourceIds(canonical),
      sourceSequenceItemCount: sequenceSourceItemCount(canonical),
      buildDeadlineAt: receivedAt + this.buildTimeoutMs,
      receivedAt
    });
    if (!receipt || typeof receipt.kind !== 'string') {
      throw createRepositoryError('invalidOperationReceipt', 'Repository returned an invalid operation receipt');
    }
    if (receipt.kind === 'requestIdReuse' || receipt.kind === 'busy' || receipt.kind === 'insufficientStorage') {
      return receipt;
    }
    if (receipt.kind === 'terminal' || receipt.kind === 'active') {
      return receipt;
    }
    if (receipt.kind !== 'created' || typeof receipt.operationId !== 'string') {
      throw createRepositoryError('invalidOperationReceipt', 'Repository did not create a valid operation');
    }
    const handler = this.handlers.get(canonical.operationKind);
    if (typeof handler !== 'function') {
      await this.repository.completeOperation(receipt.operationId, {
        state: 'failed',
        code: 'operationUnavailable',
        finishedAt: this.now()
      });
      return { kind: 'terminal', result: { state: 'failed', code: 'operationUnavailable' } };
    }

    const controller = new AbortController();
    const task = this.runOperation({
      operationId: receipt.operationId,
      canonical,
      runtime,
      handler,
      controller
    }).finally(() => this.running.delete(receipt.operationId));
    this.running.set(receipt.operationId, { controller, task });
    return { kind: 'started', operationId: receipt.operationId };
  }

  lookupResult(clientRequestId) {
    return this.repository.lookupOperationResult(clientRequestId);
  }

  status(operationId) {
    return this.repository.getOperationStatus(operationId);
  }

  async cancel(operationId) {
    const result = await this.repository.requestOperationCancel(operationId, { requestedAt: this.now() });
    if (result?.kind === 'cancelRequested') {
      this.running.get(operationId)?.controller.abort(createRepositoryError('cancelled', 'Operation cancelled'));
    }
    return result;
  }

  async runOperation({ operationId, canonical, runtime, handler, controller }) {
    let sequence = 0;
    const reportProgress = async ({ phase, processed, total = null, state = 'running' }) => {
      await this.repository.recordOperationProgress(operationId, {
        operationId,
        sequence: sequence += 1,
        phase,
        processed,
        total,
        state,
        updatedAt: this.now()
      });
    };
    const checkCancelled = () => {
      if (controller.signal.aborted) {
        throw createRepositoryError('cancelled', 'Operation cancelled');
      }
    };

    try {
      await this.repository.transitionOperation(operationId, 'SNAPSHOTTING', { updatedAt: this.now() });
      const outcome = await handler({
        operationId,
        request: canonical,
        runtime,
        signal: controller.signal,
        reportProgress,
        checkCancelled
      });
      const committed = outcome?.committed === true;
      if (!committed) checkCancelled();
      await this.repository.completeOperation(operationId, {
        state: 'succeeded',
        result: committed ? outcome.result : outcome,
        finishedAt: this.now()
      });
    } catch (error) {
      const cancelled = controller.signal.aborted || error?.code === 'cancelled';
      await this.repository.completeOperation(operationId, {
        state: cancelled ? 'cancelled' : 'failed',
        code: cancelled ? 'cancelled' : (error?.code || 'operationFailed'),
        finishedAt: this.now()
      });
    }
  }
}

function sequenceSourceIds(canonical) {
  const segments = canonical.operationKind === 'addToPlaylist'
    ? canonical.options?.sourceSequenceDescriptor?.segments
    : null;
  return Array.isArray(segments) ? [...new Set(segments.map(segment => segment.sequenceId))] : [];
}

function sequenceSourceItemCount(canonical) {
  const segments = canonical.operationKind === 'addToPlaylist'
    ? canonical.options?.sourceSequenceDescriptor?.segments
    : null;
  return Array.isArray(segments)
    ? segments.reduce((total, segment) => total + segment.endOrdinal - segment.startOrdinal, 0)
    : 0;
}

function assertAdapter(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('Durable LibraryService requires a repository adapter');
  }
  const missing = LIBRARY_SERVICE_ADAPTER_METHODS.filter(method => typeof repository[method] !== 'function');
  if (missing.length > 0) {
    throw new TypeError(`Durable LibraryService adapter is missing: ${missing.join(', ')}`);
  }
}
