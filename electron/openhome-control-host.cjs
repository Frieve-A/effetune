const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const { OpenHomeMediaGateway } = require('./openhome-media-gateway.cjs');
const { OpenHomeSidecarManager } = require('./openhome-sidecar-manager.cjs');

const CHANNELS = Object.freeze({
  getStatus: 'openhome-v1:get-status',
  setEnabled: 'openhome-v1:set-enabled',
  setUpnpAvEnabled: 'openhome-v1:set-upnp-av-enabled',
  setFriendlyName: 'openhome-v1:set-friendly-name',
  rendererReady: 'openhome-v1:renderer-ready',
  rendererUnavailable: 'openhome-v1:renderer-unavailable',
  response: 'openhome-v1:response',
  resetAck: 'openhome-v1:reset-ack',
  state: 'openhome-v1:state',
  action: 'openhome-v1:action',
  cancel: 'openhome-v1:cancel',
  reset: 'openhome-v1:reset',
  status: 'openhome-v1:status'
});
const MAX_IPC_BYTES = 128 * 1024;
const MAX_PENDING_ACTIONS = 16;
const ACTION_TIMEOUT_MS = 10000;
const CATALOG_ACTION_TIMEOUT_MS = 120000;
const RESET_TIMEOUT_MS = 2000;
const SIDECAR_RETRY_BASE_MS = 500;
const SIDECAR_RETRY_MAX_MS = 30000;
const SIDECAR_STABLE_MS = 60000;
const MAX_FRIENDLY_NAME_LENGTH = 128;

class OpenHomeControlHost {
  constructor({
    sidecar,
    gateway,
    getMainWindow,
    loadConfig,
    saveConfig,
    setAppConfig,
    defaultFriendlyName = createDefaultFriendlyName(),
    onFriendlyNameChanged = async () => {},
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = Date.now,
    onDiagnostic = () => {}
  }) {
    this.sidecar = sidecar;
    this.gateway = gateway;
    this.getMainWindow = getMainWindow;
    this.loadConfig = loadConfig;
    this.saveConfig = saveConfig;
    this.setAppConfig = setAppConfig;
    this.defaultFriendlyName = normalizeFriendlyName(defaultFriendlyName, 'EffeTune');
    this.onFriendlyNameChanged = onFriendlyNameChanged;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.onDiagnostic = onDiagnostic;
    const config = this.loadConfig();
    this.enabled = config.openHomeRemoteControl === true;
    this.upnpAvEnabled = config.upnpAvRemoteControl === true;
    this.localControlEnabled = false;
    this.rendererReady = false;
    this.latestSnapshot = null;
    this.pendingActions = new Map();
    this.actionDispatch = Promise.resolve();
    this.tokensByTrackId = new Map();
    this.artworkTokensByTrackId = new Map();
    this.deferredRegistrationTokens = new Set();
    this.pendingReset = null;
    this.resetSequence = 0;
    this.resetRequired = false;
    this.disposed = false;
    this.lifecycleEpoch = 0;
    this.reconciledEpoch = 0;
    this.reconciledMode = 'stopped';
    this.environmentAvailable = true;
    this.sidecarRetryTimer = null;
    this.sidecarRetryAttempt = 0;
    this.sidecarReadySince = 0;
    this.suppressSidecarRetry = 0;
    this.actionEpoch = 0;
    this.reconciliation = Promise.resolve();
    this.requestedEnabled = this.enabled;
    this.requestedUpnpAvEnabled = this.upnpAvEnabled;
    this.pendingDisableTransitions = 0;
    this.settingsTransitionEpoch = 0;
    this.completedSettingsTransitionEpoch = 0;
    this.settingsTransition = Promise.resolve();

    this.sidecar.on('action', action => void this.handleSidecarAction(action));
    this.sidecar.on('ready', () => {
      this.sidecarReadySince = this.now();
      if (this.getDesiredServiceMode() === 'running' && this.latestSnapshot) {
        this.sidecar.publishState(this.latestSnapshot);
      }
      this.sendStatus();
    });
    this.sidecar.on('status', status => {
      this.handleSidecarStatus(status);
      this.sendStatus();
    });
    this.sidecar.on('diagnostic', diagnostic => {
      this.onDiagnostic(String(diagnostic?.code || 'sidecar-diagnostic').slice(0, 64), diagnostic?.detail);
    });
  }

  getStatus() {
    const sidecarStatus = this.sidecar.getStatus();
    return Object.freeze({
      apiVersion: 1,
      enabled: this.enabled,
      upnpAvEnabled: this.upnpAvEnabled,
      localControlEnabled: this.localControlEnabled,
      friendlyName: this.getFriendlyName(),
      rendererReady: this.rendererReady,
      available: sidecarStatus.available,
      state: sidecarStatus.state
    });
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw createHostError('invalid-setting');
    const gateDisable = enabled === false && this.requestedEnabled === true && !this.requestedUpnpAvEnabled;
    this.requestedEnabled = enabled;
    const epoch = ++this.settingsTransitionEpoch;
    if (gateDisable) {
      this.pendingDisableTransitions += 1;
      this.resetRequired = true;
    }
    const result = this.settingsTransition.then(() => (
      this.applyEnabledTransition(enabled, epoch, gateDisable)
    ));
    this.settingsTransition = result.catch(() => {});
    return result;
  }

  setFriendlyName(friendlyName) {
    const normalized = normalizeFriendlyName(friendlyName, this.defaultFriendlyName, true);
    const restoreDefault = friendlyName.trim() === '';
    const result = this.settingsTransition.then(() => (
      this.applyFriendlyNameTransition(normalized, restoreDefault)
    ));
    this.settingsTransition = result.catch(() => {});
    return result;
  }

  setUpnpAvEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw createHostError('invalid-setting');
    const gateDisable = !enabled && this.requestedUpnpAvEnabled && !this.requestedEnabled;
    this.requestedUpnpAvEnabled = enabled;
    const epoch = ++this.settingsTransitionEpoch;
    if (gateDisable) {
      this.pendingDisableTransitions += 1;
      this.resetRequired = true;
    }
    const result = this.settingsTransition.then(() =>
      this.applyEnabledTransition(enabled, epoch, gateDisable, 'upnpAvEnabled'));
    this.settingsTransition = result.catch(() => {});
    return result;
  }

  async restartDeviceConfiguration() {
    this.resetSidecarRetry();
    this.advanceLifecycle('service-stopped');
    await this.stopAdvertisement();
    this.reconciledMode = 'paused';
    await this.scheduleReconciliation();
  }

  async applyFriendlyNameTransition(friendlyName, restoreDefault) {
    const current = this.loadConfig();
    const currentFriendlyName = this.getFriendlyName(current);
    const alreadyStored = restoreDefault
      ? !Object.hasOwn(current, 'openHomeFriendlyName')
      : current.openHomeFriendlyName === friendlyName;
    if (currentFriendlyName === friendlyName && alreadyStored) {
      return this.getStatus();
    }
    const next = { ...current };
    if (restoreDefault) delete next.openHomeFriendlyName;
    else next.openHomeFriendlyName = friendlyName;
    if (!this.saveConfig(next)) throw createHostError('save-failed');
    this.setAppConfig(next);
    if (currentFriendlyName !== friendlyName) {
      await this.onFriendlyNameChanged();
      await this.restartForEnvironmentChange();
    }
    this.sendStatus();
    return this.getStatus();
  }

  getFriendlyName(config = this.loadConfig()) {
    return resolveFriendlyName(config, this.defaultFriendlyName);
  }

  async applyEnabledTransition(enabled, epoch, disableTransition, property = 'enabled') {
    if (this[property] !== enabled) {
      const wasRunning = this.enabled || this.upnpAvEnabled;
      const current = this.loadConfig();
      const next = { ...current, [property === 'enabled' ? 'openHomeRemoteControl' : 'upnpAvRemoteControl']: enabled };
      if (!this.saveConfig(next)) {
        if (disableTransition) this.finishDisableTransition(true);
        throw createHostError('save-failed');
      }
      this.setAppConfig(next);
      this[property] = enabled;
      const anyEnabled = this.enabled || this.upnpAvEnabled;
      if (wasRunning && anyEnabled) {
        if (disableTransition) this.finishDisableTransition(true);
        await this.restartDeviceConfiguration();
        this.completedSettingsTransitionEpoch = epoch;
        this.sendStatus();
        return this.getStatus();
      }
      if (anyEnabled) this.resetSidecarRetry();
      else this.cancelSidecarRetry();
      this.advanceLifecycle(enabled ? null : 'service-stopped');
      if (anyEnabled && this.rendererReady && this.resetRequired &&
          this.pendingDisableTransitions === 0) {
        const resetSucceeded = await this.requestRendererReset();
        this.latestSnapshot = null;
        if (resetSucceeded) this.resetRequired = false;
      } else if (!anyEnabled) {
        this.resetRequired = true;
        const resetSucceeded = await this.requestRendererReset();
        this.latestSnapshot = null;
        await this.scheduleReconciliation();
        this.finishDisableTransition(resetSucceeded);
      }
    } else if (disableTransition) {
      this.finishDisableTransition(true);
    }
    await this.scheduleReconciliation();
    this.completedSettingsTransitionEpoch = epoch;
    this.sendStatus();
    return this.getStatus();
  }

  finishDisableTransition(resetSucceeded) {
    this.pendingDisableTransitions = Math.max(0, this.pendingDisableTransitions - 1);
    if (resetSucceeded && this.pendingDisableTransitions === 0) this.resetRequired = false;
  }

  async setRendererReady() {
    if (this.disposed) return this.getStatus();
    if (!this.rendererReady) {
      this.rendererReady = true;
      this.resetSidecarRetry();
      this.advanceLifecycle();
    }
    if (this.resetRequired) {
      const resetSucceeded = await this.requestRendererReset();
      this.latestSnapshot = null;
      if (resetSucceeded) this.resetRequired = false;
    }
    await this.scheduleReconciliation();
    this.sendStatus();
    return this.getStatus();
  }

  async setRendererUnavailable() {
    const localOnly = this.reconciledMode === 'stopped';
    this.cancelSidecarRetry();
    this.finishPendingReset(false);
    if (this.rendererReady) {
      this.rendererReady = false;
      if (this.enabled || this.upnpAvEnabled) this.resetRequired = true;
      this.advanceLifecycle('renderer-unavailable');
    }
    this.latestSnapshot = null;
    await this.scheduleReconciliation();
    if (localOnly) {
      this.releaseAllRegistrations();
      await this.gateway.close();
    }
    this.sendStatus();
  }

  publishState(snapshot) {
    requireBoundedObject(snapshot, 'invalid-state');
    if ((!this.enabled && !this.upnpAvEnabled && !this.localControlEnabled) || !this.rendererReady || this.resetRequired || this.disposed) return false;
    this.latestSnapshot = snapshot;
    return this.enabled || this.upnpAvEnabled ? this.sidecar.publishState(snapshot) : true;
  }

  setLocalControlEnabled(enabled) {
    this.localControlEnabled = enabled === true;
    if (!this.localControlEnabled) this.cancelLocalActions();
    this.sendStatus();
  }

  cancelLocalActions() {
    for (const pending of this.pendingActions.values()) {
      if (pending.local) this.failPendingAction(pending, 'service-stopped', true);
    }
  }

  cancelStaleLocalActions() {
    for (const pending of this.pendingActions.values()) {
      if (pending.local && !pending.isCurrent()) this.failPendingAction(pending, 'unauthorized', true);
    }
  }

  requestLocalAction(service, action, args = {}, isCurrent = () => true) {
    if (!isCurrent()) return Promise.reject(createHostError('unauthorized'));
    if (!this.localControlEnabled || !this.rendererReady || this.resetRequired ||
        !this.environmentAvailable || this.disposed) return Promise.reject(createHostError('renderer-unavailable'));
    if (this.pendingActions.size >= MAX_PENDING_ACTIONS) return Promise.reject(createHostError('busy'));
    return new Promise((resolve, reject) => {
      const request = { requestId: `pwa-${crypto.randomUUID()}`, service, action, args };
      this.queueAction(request, {
        local: true,
        isCurrent,
        respond: result => { resolve(result); return true; },
        reject: (code, phase) => {
          const error = createHostError(code);
          if (phase === 'preflight' || phase === 'mutation') error.phase = phase;
          reject(error);
          return true;
        }
      });
    });
  }

  handleRendererResetAck(ack) {
    requireBoundedObject(ack, 'invalid-reset-ack');
    const resetId = typeof ack.resetId === 'string' ? ack.resetId : '';
    if (!this.pendingReset || this.pendingReset.resetId !== resetId) return false;
    this.finishPendingReset(ack.ok === true);
    return true;
  }

  handleRendererResponse(response) {
    requireBoundedObject(response, 'invalid-response');
    const requestId = typeof response.requestId === 'string' ? response.requestId : '';
    const pending = this.pendingActions.get(requestId);
    if (!pending) return false;
    this.clearTimer(pending.timer);
    this.pendingActions.delete(requestId);

    if (response.ok === true) {
      const accepted = pending.respond(response.result ?? {});
      if (accepted === true) this.commitMediaRegistration(pending, response.result);
      else this.releasePendingRegistration(pending);
      return accepted;
    }
    this.releasePendingRegistration(pending);
    return pending.reject(response.error?.code || 'action-failed', response.error?.phase);
  }

  handleSidecarAction(action) {
    if (this.getDesiredServiceMode() !== 'running' || this.reconciledMode !== 'running') {
      this.sidecar.reject(action.requestId, 'renderer-unavailable');
      return Promise.resolve();
    }
    if (this.pendingActions.size >= MAX_PENDING_ACTIONS || this.pendingActions.has(action.requestId)) {
      this.sidecar.reject(action.requestId, 'busy');
      return Promise.resolve();
    }

    return this.queueAction(action, {
      local: false,
      respond: result => this.sidecar.respond(action.requestId, result),
      reject: code => this.sidecar.reject(action.requestId, code)
    });
  }

  queueAction(action, response) {
    const timeoutMs = action.service === 'Catalog' ? CATALOG_ACTION_TIMEOUT_MS : ACTION_TIMEOUT_MS;
    const deadlineEpochMs = this.now() + timeoutMs;
    const pending = {
      ...response,
      action,
      actionEpoch: this.actionEpoch,
      deadlineEpochMs,
      timeoutMs,
      registration: null,
      artworkRegistration: null,
      timer: null
    };
    this.pendingActions.set(action.requestId, pending);

    const dispatch = this.actionDispatch.then(() => this.dispatchSidecarAction(pending));
    this.actionDispatch = dispatch.catch(() => {});
    return dispatch;
  }

  async dispatchSidecarAction(pending) {
    const action = pending.action;
    if (!this.isCurrentAction(pending)) { this.failRevokedLocalAction(pending); return; }

    // Only the main process can grant authority to observe the existing local queue.
    let rendererAction = Object.freeze({ ...action, localControl: pending.local === true, deadlineEpochMs: pending.deadlineEpochMs });
    try {
      requireBoundedObject(action, 'invalid-action', action.service === 'Catalog' ? 4 * 1024 * 1024 : MAX_IPC_BYTES);
      pending.timer = this.setTimer(() => {
        this.failPendingAction(pending, 'action-timeout', true);
      }, pending.timeoutMs);

      if ((action.service === 'Playlist' && action.action === 'Insert') ||
          (action.service === 'AVTransport' && action.action === 'SetAVTransportURI' && action.args.uri)) {
        const registration = await this.gateway.register(action.args.uri);
        if (!this.isCurrentAction(pending)) {
          this.gateway.release(registration.token);
          this.failRevokedLocalAction(pending);
          return;
        }
        pending.registration = registration;
        const artworkUri = extractDidlAlbumArtUri(action.args.metadata);
        if (artworkUri) {
          try {
            pending.artworkRegistration = await this.gateway.register(artworkUri);
          } catch (_) {
            pending.artworkRegistration = null;
          }
        }
        if (!this.isCurrentAction(pending)) {
          if (!this.failRevokedLocalAction(pending)) this.releasePendingRegistration(pending);
          return;
        }
        rendererAction = Object.freeze({
          ...rendererAction,
          args: Object.freeze({
            ...action.args,
            playbackUrl: registration.playbackUrl,
            ...(pending.artworkRegistration
              ? { artworkUrl: pending.artworkRegistration.playbackUrl }
              : {})
          })
        });
      }
      requireBoundedObject(rendererAction, 'invalid-action', action.service === 'Catalog' ? 4 * 1024 * 1024 : MAX_IPC_BYTES);
    } catch (error) {
      this.failPendingAction(pending, error?.code || 'invalid-media-uri');
      return;
    }

    const window = this.getMainWindow();
    if (!window?.webContents || window.isDestroyed?.()) {
      this.failPendingAction(pending, 'renderer-unavailable');
      return;
    }
    if (!this.isCurrentAction(pending)) { this.failRevokedLocalAction(pending); return; }

    try {
      window.webContents.send(CHANNELS.action, rendererAction);
    } catch (_) {
      this.failPendingAction(pending, 'renderer-unavailable');
    }
  }

  isCurrentAction(pending) {
    return this.pendingActions.get(pending.action.requestId) === pending &&
      pending.actionEpoch === this.actionEpoch &&
      (pending.local
        ? this.localControlEnabled && this.rendererReady && this.environmentAvailable && !this.resetRequired && !this.disposed && pending.isCurrent()
        : this.getDesiredServiceMode() === 'running' && this.reconciledMode === 'running');
  }

  failRevokedLocalAction(pending) {
    return pending.local && !pending.isCurrent() && this.failPendingAction(pending, 'unauthorized', true);
  }

  failPendingAction(pending, code, cancelRenderer = false) {
    const requestId = pending.action.requestId;
    if (this.pendingActions.get(requestId) !== pending) return false;
    if (pending.timer) this.clearTimer(pending.timer);
    this.pendingActions.delete(requestId);
    this.releasePendingRegistration(pending);
    if (cancelRenderer) this.sendRendererCancel(requestId);
    pending.reject(code);
    return true;
  }

  sendRendererCancel(requestId) {
    const window = this.getMainWindow();
    if (!window?.webContents || window.isDestroyed?.()) return false;
    try {
      window.webContents.send(CHANNELS.cancel, Object.freeze({ requestId }));
      return true;
    } catch (_) {
      return false;
    }
  }

  requestRendererReset() {
    if (this.pendingReset) return this.pendingReset.promise;
    const window = this.getMainWindow();
    if (!this.rendererReady || !window?.webContents || window.isDestroyed?.()) {
      return Promise.resolve(false);
    }
    const resetId = `reset-${++this.resetSequence}`;
    let resolveReset;
    const promise = new Promise(resolve => { resolveReset = resolve; });
    const pending = {
      resetId,
      promise,
      resolve: resolveReset,
      timer: this.setTimer(() => this.finishPendingReset(false), RESET_TIMEOUT_MS)
    };
    this.pendingReset = pending;
    try {
      window.webContents.send(CHANNELS.reset, Object.freeze({ resetId }));
    } catch (_) {
      this.finishPendingReset(false);
    }
    return promise;
  }

  finishPendingReset(succeeded) {
    const pending = this.pendingReset;
    if (!pending) return false;
    this.pendingReset = null;
    this.clearTimer(pending.timer);
    pending.resolve(succeeded === true);
    return true;
  }

  commitMediaRegistration(pending, result) {
    const action = pending.action;
    if (action.service === 'AVTransport' && action.action === 'SetAVTransportURI') {
      this.releaseAllRegistrations();
      if (pending.registration && Number.isSafeInteger(result?.newId) && result.newId > 0) {
        this.tokensByTrackId.set(result.newId, pending.registration.token);
        if (pending.artworkRegistration) this.artworkTokensByTrackId.set(result.newId, pending.artworkRegistration.token);
      }
      return;
    }
    if (action.service !== 'Playlist') return;
    if (action.action === 'Insert' && pending.registration) {
      const newId = Number(result?.newId);
      if (Number.isSafeInteger(newId) && newId > 0 && newId <= 0xffffffff) {
        this.tokensByTrackId.set(newId, pending.registration.token);
        if (pending.artworkRegistration) {
          this.artworkTokensByTrackId.set(newId, pending.artworkRegistration.token);
        }
      } else {
        this.releasePendingRegistration(pending);
      }
      return;
    }
    if (action.action === 'DeleteId') {
      const id = Number(action.args.id);
      const token = this.tokensByTrackId.get(id);
      if (token) this.gateway.release(token);
      const artworkToken = this.artworkTokensByTrackId.get(id);
      if (artworkToken) this.gateway.release(artworkToken);
      this.tokensByTrackId.delete(id);
      this.artworkTokensByTrackId.delete(id);
      return;
    }
    if (action.action === 'DeleteAll') this.releaseAllRegistrations();
  }

  releasePendingRegistration(pending) {
    if (pending.registration) this.gateway.release(pending.registration.token);
    if (pending.artworkRegistration) this.gateway.release(pending.artworkRegistration.token);
  }

  rejectPendingActions(code, deferRegistrationRelease = false) {
    for (const [requestId, pending] of this.pendingActions) {
      this.clearTimer(pending.timer);
      if (deferRegistrationRelease && pending.registration) {
        this.deferredRegistrationTokens.add(pending.registration.token);
        if (pending.artworkRegistration) {
          this.deferredRegistrationTokens.add(pending.artworkRegistration.token);
        }
      } else {
        this.releasePendingRegistration(pending);
      }
      this.sendRendererCancel(requestId);
      pending.reject(code);
    }
    this.pendingActions.clear();
  }

  releaseAllRegistrations() {
    for (const token of this.tokensByTrackId.values()) this.gateway.release(token);
    for (const token of this.artworkTokensByTrackId.values()) this.gateway.release(token);
    for (const token of this.deferredRegistrationTokens) this.gateway.release(token);
    this.tokensByTrackId.clear();
    this.artworkTokensByTrackId.clear();
    this.deferredRegistrationTokens.clear();
  }

  advanceLifecycle(pendingCode = null) {
    this.lifecycleEpoch += 1;
    this.actionEpoch += 1;
    if (pendingCode) this.rejectPendingActions(pendingCode, true);
    else this.cancelLocalActions();
  }

  getDesiredServiceMode() {
    if (this.disposed || (!this.enabled && !this.upnpAvEnabled) || !this.rendererReady || this.resetRequired) {
      return 'stopped';
    }
    return this.environmentAvailable ? 'running' : 'paused';
  }

  handleSidecarStatus(status) {
    const state = status?.state || this.sidecar.getStatus().state;
    if (state === 'ready') return;
    if (state !== 'failed' && state !== 'stopped' && state !== 'unavailable') return;
    if (this.suppressSidecarRetry > 0 || this.getDesiredServiceMode() !== 'running') return;
    if (this.reconciledMode !== 'paused') {
      if (this.sidecarReadySince > 0 && this.now() - this.sidecarReadySince >= SIDECAR_STABLE_MS) {
        this.sidecarRetryAttempt = 0;
      }
      this.sidecarReadySince = 0;
      this.reconciledMode = 'paused';
      this.rejectPendingActions('service-stopped');
      this.advanceLifecycle();
    }
    this.scheduleSidecarRetry();
  }

  scheduleSidecarRetry() {
    if (this.sidecarRetryTimer || this.getDesiredServiceMode() !== 'running') return false;
    const exponent = Math.min(this.sidecarRetryAttempt, 16);
    const delay = Math.min(SIDECAR_RETRY_BASE_MS * (2 ** exponent), SIDECAR_RETRY_MAX_MS);
    this.sidecarRetryAttempt += 1;
    this.sidecarRetryTimer = this.setTimer(() => {
      this.sidecarRetryTimer = null;
      if (this.getDesiredServiceMode() !== 'running') return;
      this.advanceLifecycle();
      void this.scheduleReconciliation().catch(error => {
        this.onDiagnostic(String(error?.code || 'sidecar-retry-failed').slice(0, 64));
      });
    }, delay);
    this.sidecarRetryTimer?.unref?.();
    return true;
  }

  cancelSidecarRetry() {
    if (!this.sidecarRetryTimer) return;
    this.clearTimer(this.sidecarRetryTimer);
    this.sidecarRetryTimer = null;
  }

  resetSidecarRetry() {
    this.cancelSidecarRetry();
    this.sidecarRetryAttempt = 0;
    this.sidecarReadySince = 0;
  }

  async setEnvironmentAvailable(available) {
    if (typeof available !== 'boolean') throw createHostError('invalid-environment-state');
    if (this.disposed || this.environmentAvailable === available) return this.getStatus();
    this.environmentAvailable = available;
    this.resetSidecarRetry();
    if (!available) this.rejectPendingActions('service-stopped');
    this.advanceLifecycle();
    await this.scheduleReconciliation();
    this.sendStatus();
    return this.getStatus();
  }

  async restartForEnvironmentChange() {
    if (this.disposed || this.getDesiredServiceMode() !== 'running') return this.getStatus();
    this.resetSidecarRetry();
    const restart = this.reconciliation.then(async () => {
      if (this.getDesiredServiceMode() !== 'running') return;
      this.rejectPendingActions('service-stopped');
      this.advanceLifecycle();
      this.reconciledMode = 'paused';
      await this.stopAdvertisement();
      if (this.getDesiredServiceMode() === 'running') await this.reconcileServices();
    });
    this.reconciliation = restart.catch(() => {});
    await restart;
    this.sendStatus();
    return this.getStatus();
  }

  scheduleReconciliation() {
    const result = this.reconciliation.then(() => this.reconcileServices());
    this.reconciliation = result.catch(() => {});
    return result;
  }

  async reconcileServices() {
    while (this.reconciledEpoch !== this.lifecycleEpoch) {
      const epoch = this.lifecycleEpoch;
      const desiredMode = this.getDesiredServiceMode();
      if (desiredMode === this.reconciledMode) {
        this.reconciledEpoch = epoch;
        continue;
      }
      if (desiredMode === 'running') {
        if (this.sidecarRetryTimer) {
          this.reconciledEpoch = epoch;
          return;
        }
        const config = this.ensureDeviceId();
        const started = await this.sidecar.start({
          friendlyName: this.getFriendlyName(config),
          udn: `uuid:${config.openHomeDeviceId}`,
          openHomeEnabled: this.enabled, upnpAvEnabled: this.upnpAvEnabled,
          upnpAvUdn: `uuid:${config.upnpAvDeviceId}`
        });
        if (started !== true) {
          this.reconciledMode = 'paused';
          this.reconciledEpoch = this.lifecycleEpoch;
          this.scheduleSidecarRetry();
          return;
        }
      } else if (desiredMode === 'paused') {
        await this.stopAdvertisement();
      } else {
        await this.stopServices();
      }
      this.reconciledMode = desiredMode;
      this.reconciledEpoch = epoch;
    }
  }

  ensureDeviceId() {
    const current = this.loadConfig();
    const validId = value => /^[0-9a-f-]{36}$/i.test(value || '');
    if (validId(current.openHomeDeviceId) && (!this.upnpAvEnabled || validId(current.upnpAvDeviceId))) return current;
    const next = { ...current,
      ...(!validId(current.openHomeDeviceId) ? { openHomeDeviceId: crypto.randomUUID() } : {}),
      ...(this.upnpAvEnabled && !validId(current.upnpAvDeviceId) ? { upnpAvDeviceId: crypto.randomUUID() } : {}) };
    if (!this.saveConfig(next)) throw createHostError('save-failed');
    this.setAppConfig(next);
    return next;
  }

  async stopServices() {
    this.rejectPendingActions('service-stopped', true);
    await Promise.allSettled([Promise.resolve().then(() => this.sidecar.stop())]);
    this.releaseAllRegistrations();
    await Promise.allSettled([Promise.resolve().then(() => this.gateway.close())]);
  }

  async stopAdvertisement() {
    this.rejectPendingActions('service-stopped');
    this.suppressSidecarRetry += 1;
    try {
      await Promise.resolve().then(() => this.sidecar.stop());
    } finally {
      this.suppressSidecarRetry -= 1;
    }
  }

  sendStatus() {
    const window = this.getMainWindow();
    if (!window?.webContents || window.isDestroyed?.()) return;
    window.webContents.send(CHANNELS.status, this.getStatus());
  }

  async dispose() {
    if (this.disposed) return;
    const localOnly = this.reconciledMode === 'stopped';
    this.disposed = true;
    this.cancelSidecarRetry();
    this.finishPendingReset(false);
    this.rendererReady = false;
    this.advanceLifecycle('service-stopped');
    await this.scheduleReconciliation();
    if (localOnly) {
      this.releaseAllRegistrations();
      await this.gateway.close();
    }
  }
}

function registerOpenHomeIpc({ ipcMain, host, getMainWindow }) {
  const handlers = new Map([
    [CHANNELS.getStatus, () => host.getStatus()],
    [CHANNELS.setEnabled, (_event, request) => host.setEnabled(request?.enabled)],
    [CHANNELS.setUpnpAvEnabled, (_event, request) => host.setUpnpAvEnabled(request?.enabled)],
    [CHANNELS.setFriendlyName, (_event, request) => host.setFriendlyName(request?.friendlyName)],
    [CHANNELS.rendererReady, () => host.setRendererReady()],
    [CHANNELS.rendererUnavailable, () => host.setRendererUnavailable()],
    [CHANNELS.response, (_event, response) => host.handleRendererResponse(response)],
    [CHANNELS.resetAck, (_event, ack) => host.handleRendererResetAck(ack)],
    [CHANNELS.state, (_event, snapshot) => host.publishState(snapshot)]
  ]);
  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, (event, ...args) => {
      const window = getMainWindow();
      if (!window?.webContents || event.sender !== window.webContents) {
        throw createHostError('invalid-sender');
      }
      return handler(event, ...args);
    });
  }
  return () => {
    for (const channel of handlers.keys()) ipcMain.removeHandler(channel);
  };
}

function createOpenHomeControlHost({
  app,
  constants,
  config,
  getMainWindow,
  processRef = process,
  onFriendlyNameChanged,
  onDiagnostic = () => {}
}) {
  const executableName = processRef.platform === 'win32'
    ? 'effetune-openhome-sidecar.exe'
    : 'effetune-openhome-sidecar';
  const basePath = app.isPackaged
    ? path.join(processRef.resourcesPath, 'openhome')
    : path.join(app.getAppPath(), 'out', 'native', 'openhome-sidecar', `${processRef.platform}-${processRef.arch}`);
  const sidecar = new OpenHomeSidecarManager({
    sidecarPath: path.join(basePath, executableName)
  });
  const gateway = new OpenHomeMediaGateway({ onDiagnostic });
  return new OpenHomeControlHost({
    sidecar,
    gateway,
    getMainWindow,
    loadConfig: () => config.loadConfig(),
    saveConfig: next => config.saveConfig(next),
    setAppConfig: next => constants.setAppConfig(next),
    defaultFriendlyName: createDefaultFriendlyName(),
    onFriendlyNameChanged,
    onDiagnostic
  });
}

function createDefaultFriendlyName(computerName = os.hostname()) {
  const name = String(computerName || '').trim();
  return normalizeFriendlyName(name, 'EffeTune');
}

function resolveFriendlyName(config, defaultFriendlyName = createDefaultFriendlyName()) {
  return normalizeFriendlyName(config.openHomeFriendlyName, defaultFriendlyName);
}

function normalizeFriendlyName(value, fallback, strict = false) {
  if (strict && typeof value !== 'string') throw createHostError('invalid-setting');
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return fallback;
  const hasControlCharacter = [...normalized].some(character => {
    const codePoint = character.codePointAt(0);
    return codePoint < 32 || codePoint === 127;
  });
  if (hasControlCharacter || normalized.length > MAX_FRIENDLY_NAME_LENGTH) {
    if (strict) throw createHostError('invalid-setting');
    return fallback;
  }
  return normalized;
}

function extractDidlAlbumArtUri(metadata) {
  if (typeof metadata !== 'string' || metadata.length === 0) return '';
  const lowerMetadata = metadata.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < metadata.length) {
    const tagStart = lowerMetadata.indexOf('<', searchFrom);
    if (tagStart < 0) return '';
    let nameEnd = tagStart + 1;
    while (nameEnd < metadata.length && isXmlNameCharacter(metadata.charCodeAt(nameEnd))) {
      nameEnd += 1;
    }
    const qualifiedName = lowerMetadata.slice(tagStart + 1, nameEnd);
    const localName = qualifiedName.slice(qualifiedName.lastIndexOf(':') + 1);
    if (localName !== 'albumarturi') {
      searchFrom = nameEnd > tagStart + 1 ? nameEnd : tagStart + 1;
      continue;
    }
    const contentStart = lowerMetadata.indexOf('>', nameEnd);
    if (contentStart < 0) return '';
    const closingPrefix = `</${qualifiedName}`;
    let closingStart = lowerMetadata.indexOf(closingPrefix, contentStart + 1);
    while (closingStart >= 0) {
      const boundary = metadata.charCodeAt(closingStart + closingPrefix.length);
      if (boundary === 62 || boundary === 9 || boundary === 10 || boundary === 13 || boundary === 32) {
        const closingEnd = lowerMetadata.indexOf('>', closingStart + closingPrefix.length);
        if (closingEnd < 0) return '';
        const value = decodeXmlText(metadata.slice(contentStart + 1, closingStart)).trim();
        return value.length <= 8192 ? value : '';
      }
      closingStart = lowerMetadata.indexOf(closingPrefix, closingStart + closingPrefix.length);
    }
    return '';
  }
  return '';
}

function isXmlNameCharacter(codePoint) {
  return (codePoint >= 48 && codePoint <= 57) ||
    (codePoint >= 65 && codePoint <= 90) ||
    (codePoint >= 97 && codePoint <= 122) ||
    codePoint === 45 || codePoint === 46 || codePoint === 58 || codePoint === 95;
}

function decodeXmlText(value) {
  return String(value).replace(/&(?:#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|apos);/gi, entity => {
    const lower = entity.toLowerCase();
    if (lower === '&amp;') return '&';
    if (lower === '&lt;') return '<';
    if (lower === '&gt;') return '>';
    if (lower === '&quot;') return '"';
    if (lower === '&apos;') return "'";
    const numeric = lower.startsWith('&#x')
      ? Number.parseInt(lower.slice(3, -1), 16)
      : Number.parseInt(lower.slice(2, -1), 10);
    if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > 0x10ffff ||
        (numeric >= 0xd800 && numeric <= 0xdfff)) return '';
    return String.fromCodePoint(numeric);
  });
}

function requireBoundedObject(value, code, maximum = MAX_IPC_BYTES) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createHostError(code);
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (_) {
    throw createHostError(code);
  }
  if (Buffer.byteLength(serialized) > maximum) throw createHostError(code);
}

function createHostError(code) {
  const error = new Error('OpenHome control request failed');
  error.code = code;
  return error;
}

module.exports = {
  ACTION_TIMEOUT_MS,
  CHANNELS,
  MAX_IPC_BYTES,
  MAX_FRIENDLY_NAME_LENGTH,
  MAX_PENDING_ACTIONS,
  RESET_TIMEOUT_MS,
  SIDECAR_RETRY_BASE_MS,
  SIDECAR_RETRY_MAX_MS,
  SIDECAR_STABLE_MS,
  OpenHomeControlHost,
  createDefaultFriendlyName,
  createOpenHomeControlHost,
  resolveFriendlyName,
  extractDidlAlbumArtUri,
  registerOpenHomeIpc
};
