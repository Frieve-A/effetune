const WAITING_AFTER_MS = 5_000;

function initialState() {
  return Object.freeze({ status: 'idle' });
}

function terminalState(result, canUndo = false) {
  const payload = result?.result && typeof result.result === 'object' ? result.result : result;
  const state = result?.state ?? result?.terminalKind ?? result?.kind ??
    (payload?.operationKind ? 'succeeded' : 'failed');
  const operationKind = payload?.operationKind ?? result?.operationKind ?? null;
  return {
    terminalKind: state,
    ...(operationKind ? { operationKind } : {}),
    result,
    canCancel: false,
    canUndo,
    retryAvailable: false
  };
}

export class DurableActionController {
  constructor({
    service,
    now = Date.now,
    setIntervalFn = (...args) => globalThis.setInterval(...args),
    clearIntervalFn = (...args) => globalThis.clearInterval(...args),
    onStateChange = () => {}
  } = {}) {
    if (!service) throw new TypeError('service is required');
    this.service = service;
    this.now = now;
    this.setIntervalFn = (...args) => setIntervalFn(...args);
    this.clearIntervalFn = (...args) => clearIntervalFn(...args);
    this.onStateChange = onStateChange;
    this.state = initialState();
    this.operationToken = 0;
    this.resource = null;
  }

  async track({
    clientRequestId,
    operationKind,
    targetName = '',
    start
  } = {}) {
    if (this.#isBusy()) return { kind: 'busy' };
    if (typeof start !== 'function') return { kind: 'notStarted', reason: 'factoryMissing' };
    this.#discardResource();
    const resource = {
      token: ++this.operationToken,
      operationId: null,
      unsubscribe: null,
      waitingTimer: null
    };
    this.resource = resource;
    const durable = !isPlaybackOperation(operationKind);
    this.#publish({
      status: 'starting',
      actionToken: resource.token,
      ...(durable ? { clientRequestId } : {}),
      operationKind,
      targetName,
      canCancel: false,
      retryAvailable: false,
      lastEventAt: this.now()
    });
    try {
      const receipt = await start();
      if (!this.#isCurrent(resource)) return { kind: 'stale' };
      if (receipt?.kind === 'terminal') {
        resource.operationId = receipt.operationId ?? null;
        this.#complete(resource, receipt.result);
        return receipt;
      }
      if (!['started', 'active'].includes(receipt?.kind) || typeof receipt.operationId !== 'string') {
        this.#complete(resource, {
          state: 'failed',
          code: receipt?.kind ?? 'invalidOperationReceipt',
          receipt
        });
        return receipt;
      }
      resource.operationId = receipt.operationId;
      this.#publish({
        ...this.state,
        status: 'active',
        operationId: receipt.operationId,
        phase: receipt.phase ?? 'RECEIVED',
        canCancel: true,
        lastEventAt: this.now()
      });
      await this.#attach(resource);
      return receipt;
    } catch (error) {
      if (this.#isCurrent(resource)) {
        this.#complete(resource, { state: 'failed', code: error?.code ?? 'operationFailed', error });
      }
      return { kind: 'failed', error };
    }
  }

  async cancel() {
    if (this.state.status !== 'active' && this.state.status !== 'waiting') {
      return { kind: 'notActive' };
    }
    const resource = this.resource;
    if (!resource?.operationId) return { kind: 'notActive' };
    this.#publish({ ...this.state, status: 'cancelling', canCancel: false });
    try {
      const result = await this.service.cancelLibraryOperation(resource.operationId);
      if (!this.#isCurrent(resource)) return { kind: 'stale' };
      if (result?.kind === 'tooLate') {
        this.#publish({ ...this.state, status: 'active', canCancel: false, cancelDisposition: 'tooLate' });
      }
      return result;
    } catch (error) {
      if (this.#isCurrent(resource)) {
        this.#publish({ ...this.state, status: 'active', canCancel: true, cancelError: error });
      }
      throw error;
    }
  }

  async undo() {
    if (!this.state.canUndo || this.state.operationKind !== 'play') {
      return { kind: 'notAvailable' };
    }
    const result = await this.service.undoPlaybackSession?.() ?? { kind: 'notAvailable' };
    this.#publish({
      ...this.state,
      canUndo: false,
      ...(result?.kind === 'published' ? { undoApplied: true } : { undoUnavailable: true })
    });
    return result;
  }

  close() {
    this.operationToken += 1;
    this.#discardResource();
  }

  async #attach(resource) {
    const operationId = resource.operationId;
    if (!this.#isCurrent(resource) || !operationId) return;
    const unsubscribe = this.service.subscribeLibraryOperation(operationId, event => {
      if (!this.#isCurrent(resource)) return;
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
        this.#complete(resource, event.result);
      }
    });
    if (typeof unsubscribe !== 'function') {
      throw new TypeError('Operation subscription must return an unsubscribe function');
    }
    if (!this.#isCurrent(resource) || this.state.status === 'terminal') {
      unsubscribe();
      return;
    }
    resource.unsubscribe = unsubscribe;
    const current = await this.service.getLibraryOperationStatus(operationId);
    if (!this.#isCurrent(resource) || this.state.status === 'terminal' ||
        this.state.operationId !== operationId) return;
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
      this.#complete(resource, current.result);
      return;
    }
    this.#armWaitingTimer(resource);
  }

  #armWaitingTimer(resource) {
    if (!this.#isCurrent(resource) || resource.waitingTimer != null) return;
    resource.waitingTimer = this.setIntervalFn(() => {
      if (!this.#isCurrent(resource)) return;
      if (!['active', 'waiting'].includes(this.state.status)) return;
      const waiting = this.now() - (this.state.lastEventAt ?? 0) >= WAITING_AFTER_MS;
      if (waiting && this.state.status !== 'waiting') {
        this.#publish({ ...this.state, status: 'waiting' });
      }
    }, 1_000);
  }

  #complete(resource, result) {
    if (!this.#isCurrent(resource)) return;
    const previousState = this.state;
    this.#discardResource(resource);
    const payload = result?.result && typeof result.result === 'object' ? result.result : result;
    const terminalKind = result?.state ?? result?.terminalKind ?? result?.kind ??
      (payload?.operationKind ? 'succeeded' : 'failed');
    const canUndo = terminalKind === 'succeeded' &&
      (payload?.operationKind ?? previousState.operationKind) === 'play' &&
      this.service.canUndoPlaybackSession?.() === true;
    const completed = terminalState(result, canUndo);
    this.#publish({
      ...previousState,
      ...(resource.operationId ? { operationId: resource.operationId } : {}),
      status: 'terminal',
      ...completed
    });
  }

  #isBusy() {
    return ['starting', 'active', 'waiting', 'cancelling'].includes(this.state.status);
  }

  #isCurrent(resource) {
    return Boolean(resource && this.resource === resource && resource.token === this.operationToken);
  }

  #discardResource(resource = this.resource) {
    if (!resource) return;
    const unsubscribe = resource.unsubscribe;
    resource.unsubscribe = null;
    unsubscribe?.();
    if (resource.waitingTimer != null) this.clearIntervalFn(resource.waitingTimer);
    resource.waitingTimer = null;
    if (this.resource === resource) this.resource = null;
  }

  #publish(state) {
    this.state = Object.freeze(state);
    this.onStateChange(this.state);
  }

}

function isPlaybackOperation(operationKind) {
  return operationKind === 'play' || operationKind === 'playNext' || operationKind === 'queue';
}
