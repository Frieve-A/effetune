const PENDING_OPERATION_STORAGE_KEY = 'effetune.library.pendingOperations.v1';
const MAX_PENDING_OPERATIONS = 8;
const WAITING_AFTER_MS = 5_000;

function initialState() {
  return Object.freeze({ status: 'idle' });
}

function terminalState(result) {
  const state = result?.state ?? result?.terminalKind ?? result?.kind ?? 'failed';
  return {
    terminalKind: state,
    ...(result?.operationKind ? { operationKind: result.operationKind } : {}),
    result,
    canCancel: false,
    canUndo: state === 'cancelled' && typeof result?.undoId === 'string' && result.undoId.length > 0,
    undoId: result?.undoId ?? null,
    undoExpiresAt: result?.undoExpiresAt ?? null,
    transportVersion: result?.transportVersion ?? null,
    retryAvailable: state !== 'succeeded'
  };
}

export class DurableActionController {
  constructor({
    service,
    sessionStorage = globalThis.sessionStorage,
    now = Date.now,
    setIntervalFn = (...args) => globalThis.setInterval(...args),
    clearIntervalFn = (...args) => globalThis.clearInterval(...args),
    onStateChange = () => {}
  } = {}) {
    if (!service) throw new TypeError('service is required');
    this.service = service;
    this.sessionStorage = sessionStorage;
    this.now = now;
    this.setIntervalFn = (...args) => setIntervalFn(...args);
    this.clearIntervalFn = (...args) => clearIntervalFn(...args);
    this.onStateChange = onStateChange;
    this.state = initialState();
    this.unsubscribe = null;
    this.waitingTimer = null;
    this.startFactory = null;
  }

  remember(clientRequestId) {
    if (typeof clientRequestId !== 'string' || !clientRequestId) return;
    const ids = this.#readPending().filter(value => value !== clientRequestId);
    ids.push(clientRequestId);
    this.#writePending(ids.slice(-MAX_PENDING_OPERATIONS));
  }

  async track({ clientRequestId, operationKind, targetName = '', startResult, startFactory } = {}) {
    this.remember(clientRequestId);
    this.startFactory = startFactory ?? null;
    this.#publish({
      status: 'starting',
      clientRequestId,
      operationKind,
      targetName,
      canCancel: false,
      retryAvailable: false,
      lastEventAt: this.now()
    });
    try {
      const receipt = await startResult;
      if (receipt?.kind === 'terminal') {
        this.#complete(receipt.result);
        return receipt;
      }
      if (!['started', 'active'].includes(receipt?.kind) || typeof receipt.operationId !== 'string') {
        this.#complete({
          state: 'failed',
          code: receipt?.kind ?? 'invalidOperationReceipt',
          receipt
        });
        return receipt;
      }
      this.#publish({
        ...this.state,
        status: 'active',
        operationId: receipt.operationId,
        phase: receipt.phase ?? 'RECEIVED',
        canCancel: true,
        lastEventAt: this.now()
      });
      await this.#attach(receipt.operationId);
      return receipt;
    } catch (error) {
      this.#complete({ state: 'failed', code: error?.code ?? 'operationFailed', error });
      return { kind: 'failed', error };
    }
  }

  async recover({ operationKind = 'operation', targetName = '' } = {}) {
    const ids = this.#readPending();
    for (const clientRequestId of ids.slice().reverse()) {
      let result;
      try {
        result = await this.service.lookupLibraryOperation(clientRequestId);
      } catch (_) {
        continue;
      }
      if (result?.kind === 'active' && result.operationId) {
        this.#publish({
          status: 'active', clientRequestId, operationId: result.operationId,
          operationKind, targetName, phase: 'RECEIVED', canCancel: true,
          retryAvailable: false, lastEventAt: this.now()
        });
        await this.#attach(result.operationId);
        return result;
      }
      if (result?.kind === 'terminal') {
        this.#publish({ status: 'active', clientRequestId, operationKind, targetName });
        this.#complete(result.result);
        return result;
      }
      this.#forget(clientRequestId);
    }
    return { kind: 'none' };
  }

  async cancel() {
    if (this.state.status !== 'active' && this.state.status !== 'waiting') {
      return { kind: 'notActive' };
    }
    this.#publish({ ...this.state, status: 'cancelling', canCancel: false });
    try {
      const result = await this.service.cancelLibraryOperation(this.state.operationId);
      if (result?.kind === 'tooLate') {
        this.#publish({ ...this.state, status: 'active', canCancel: false, cancelDisposition: 'tooLate' });
      }
      return result;
    } catch (error) {
      this.#publish({ ...this.state, status: 'active', canCancel: true, cancelError: error });
      throw error;
    }
  }

  retry() {
    if (!this.state.retryAvailable || typeof this.startFactory !== 'function') {
      return Promise.resolve({ kind: 'notRetryable' });
    }
    return this.startFactory();
  }

  async undo() {
    if (!this.state.canUndo || this.state.operationKind !== 'play') return { kind: 'notAvailable' };
    const result = await this.service.undoCancelledPlay({
      undoId: this.state.undoId,
      expectedTransportVersion: this.state.transportVersion
    });
    if (result?.kind === 'published') {
      this.#publish({ ...this.state, canUndo: false, undoApplied: true });
    } else if (['expired', 'notFound', 'conflict'].includes(result?.kind)) {
      this.#publish({ ...this.state, canUndo: false, undoUnavailable: result.kind });
    }
    return result;
  }

  close() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.waitingTimer != null) this.clearIntervalFn(this.waitingTimer);
    this.waitingTimer = null;
  }

  async #attach(operationId) {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const unsubscribe = this.service.subscribeLibraryOperation(operationId, event => {
      if (event?.kind === 'progress' && event.progress?.operationId === operationId) {
        this.#publish({
          ...this.state,
          status: 'active',
          phase: event.progress.phase ?? this.state.phase,
          processed: event.progress.processed ?? null,
          total: event.progress.total ?? null,
          message: event.progress.message ?? '',
          lastEventAt: this.now()
        });
      } else if (event?.kind === 'terminal' && event.operationId === operationId) {
        this.#complete(event.result);
      }
    });
    if (typeof unsubscribe !== 'function') {
      throw new TypeError('Operation subscription must return an unsubscribe function');
    }
    if (this.state.status === 'terminal') {
      unsubscribe();
      return;
    }
    this.unsubscribe = unsubscribe;
    const current = await this.service.getLibraryOperationStatus(operationId);
    if (this.state.status === 'terminal' || this.state.operationId !== operationId) return;
    if (current?.progress || current?.phase) {
      this.#publish({
        ...this.state,
        phase: current.progress?.phase ?? current.phase ?? this.state.phase,
        processed: current.progress?.processed ?? null,
        total: current.progress?.total ?? null,
        lastEventAt: this.now()
      });
    }
    if (current?.terminalKind || current?.result?.state) {
      this.#complete(current.result);
      return;
    }
    this.#armWaitingTimer();
  }

  #armWaitingTimer() {
    if (this.waitingTimer != null) return;
    this.waitingTimer = this.setIntervalFn(() => {
      if (!['active', 'waiting'].includes(this.state.status)) return;
      const waiting = this.now() - (this.state.lastEventAt ?? 0) >= WAITING_AFTER_MS;
      if (waiting && this.state.status !== 'waiting') {
        this.#publish({ ...this.state, status: 'waiting' });
      }
    }, 1_000);
  }

  #complete(result) {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.waitingTimer != null) this.clearIntervalFn(this.waitingTimer);
    this.waitingTimer = null;
    const completed = terminalState(result);
    this.#publish({ ...this.state, status: 'terminal', ...completed });
    this.#forget(this.state.clientRequestId);
  }

  #publish(state) {
    this.state = Object.freeze(state);
    this.onStateChange(this.state);
  }

  #readPending() {
    try {
      const value = JSON.parse(this.sessionStorage?.getItem(PENDING_OPERATION_STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(-MAX_PENDING_OPERATIONS) : [];
    } catch (_) {
      return [];
    }
  }

  #writePending(ids) {
    try {
      this.sessionStorage?.setItem(PENDING_OPERATION_STORAGE_KEY, JSON.stringify(ids));
    } catch (_) {
      // Recovery metadata is best-effort; the durable service remains authoritative.
    }
  }

  #forget(clientRequestId) {
    if (!clientRequestId) return;
    this.#writePending(this.#readPending().filter(value => value !== clientRequestId));
  }
}
