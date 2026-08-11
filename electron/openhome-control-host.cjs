const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const { OpenHomeMediaGateway } = require('./openhome-media-gateway.cjs');
const { OpenHomeSidecarManager } = require('./openhome-sidecar-manager.cjs');

const CHANNELS = Object.freeze({
  getStatus: 'openhome-v1:get-status',
  setEnabled: 'openhome-v1:set-enabled',
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
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.onDiagnostic = onDiagnostic;
    const config = this.loadConfig();
    this.enabled = config.openHomeRemoteControl === true;
    this.rendererReady = false;
    this.latestSnapshot = null;
    this.pendingActions = new Map();
    this.actionDispatch = Promise.resolve();
    this.tokensByTrackId = new Map();
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
      this.onDiagnostic(String(diagnostic?.code || 'sidecar-diagnostic').slice(0, 64));
    });
  }

  getStatus() {
    const sidecarStatus = this.sidecar.getStatus();
    return Object.freeze({
      apiVersion: 1,
      enabled: this.enabled,
      friendlyName: this.getFriendlyName(),
      rendererReady: this.rendererReady,
      available: sidecarStatus.available,
      state: sidecarStatus.state
    });
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw createHostError('invalid-setting');
    const gateDisable = enabled === false && this.requestedEnabled === true;
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
    if (currentFriendlyName !== friendlyName) await this.restartForEnvironmentChange();
    this.sendStatus();
    return this.getStatus();
  }

  getFriendlyName(config = this.loadConfig()) {
    return normalizeFriendlyName(config.openHomeFriendlyName, this.defaultFriendlyName);
  }

  async applyEnabledTransition(enabled, epoch, disableTransition) {
    if (this.enabled !== enabled) {
      const current = this.loadConfig();
      const next = { ...current, openHomeRemoteControl: enabled };
      if (!this.saveConfig(next)) {
        if (disableTransition) this.finishDisableTransition(true);
        throw createHostError('save-failed');
      }
      this.setAppConfig(next);
      this.enabled = enabled;
      if (enabled) this.resetSidecarRetry();
      else this.cancelSidecarRetry();
      this.advanceLifecycle(enabled ? null : 'service-stopped');
      if (enabled && this.rendererReady && this.resetRequired &&
          this.pendingDisableTransitions === 0) {
        const resetSucceeded = await this.requestRendererReset();
        this.latestSnapshot = null;
        if (resetSucceeded) this.resetRequired = false;
      } else if (!enabled) {
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
    this.cancelSidecarRetry();
    this.finishPendingReset(false);
    if (this.rendererReady) {
      this.rendererReady = false;
      if (this.enabled) this.resetRequired = true;
      this.advanceLifecycle('renderer-unavailable');
    }
    this.latestSnapshot = null;
    await this.scheduleReconciliation();
    this.sendStatus();
  }

  publishState(snapshot) {
    requireBoundedObject(snapshot, 'invalid-state');
    if (!this.enabled || !this.rendererReady || this.resetRequired || this.disposed) return false;
    this.latestSnapshot = snapshot;
    return this.sidecar.publishState(snapshot);
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
      const accepted = this.sidecar.respond(requestId, response.result ?? {});
      if (accepted === true) this.commitMediaRegistration(pending, response.result);
      else this.releasePendingRegistration(pending);
      return accepted;
    }
    this.releasePendingRegistration(pending);
    return this.sidecar.reject(requestId, response.error?.code || 'action-failed');
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

    const deadlineEpochMs = this.now() + ACTION_TIMEOUT_MS;
    const pending = {
      action,
      actionEpoch: this.actionEpoch,
      deadlineEpochMs,
      registration: null,
      timer: null
    };
    this.pendingActions.set(action.requestId, pending);

    const dispatch = this.actionDispatch.then(() => this.dispatchSidecarAction(pending));
    this.actionDispatch = dispatch.catch(() => {});
    return dispatch;
  }

  async dispatchSidecarAction(pending) {
    const action = pending.action;
    if (!this.isCurrentAction(pending)) return;

    let rendererAction = Object.freeze({ ...action, deadlineEpochMs: pending.deadlineEpochMs });
    try {
      requireBoundedObject(action, 'invalid-action');
      pending.timer = this.setTimer(() => {
        this.failPendingAction(pending, 'action-timeout', true);
      }, ACTION_TIMEOUT_MS);

      if (action.service === 'Playlist' && action.action === 'Insert') {
        const registration = await this.gateway.register(action.args.uri);
        if (!this.isCurrentAction(pending)) {
          this.gateway.release(registration.token);
          return;
        }
        pending.registration = registration;
        rendererAction = Object.freeze({
          ...rendererAction,
          args: Object.freeze({ ...action.args, playbackUrl: registration.playbackUrl })
        });
      }
      requireBoundedObject(rendererAction, 'invalid-action');
    } catch (error) {
      this.failPendingAction(pending, error?.code || 'invalid-media-uri');
      return;
    }

    const window = this.getMainWindow();
    if (!window?.webContents || window.isDestroyed?.()) {
      this.failPendingAction(pending, 'renderer-unavailable');
      return;
    }

    try {
      window.webContents.send(CHANNELS.action, rendererAction);
    } catch (_) {
      this.failPendingAction(pending, 'renderer-unavailable');
    }
  }

  isCurrentAction(pending) {
    return this.pendingActions.get(pending.action.requestId) === pending &&
      pending.actionEpoch === this.actionEpoch &&
      this.getDesiredServiceMode() === 'running' && this.reconciledMode === 'running';
  }

  failPendingAction(pending, code, cancelRenderer = false) {
    const requestId = pending.action.requestId;
    if (this.pendingActions.get(requestId) !== pending) return false;
    if (pending.timer) this.clearTimer(pending.timer);
    this.pendingActions.delete(requestId);
    this.releasePendingRegistration(pending);
    if (cancelRenderer) this.sendRendererCancel(requestId);
    this.sidecar.reject(requestId, code);
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
    if (action.service !== 'Playlist') return;
    if (action.action === 'Insert' && pending.registration) {
      const newId = Number(result?.newId);
      if (Number.isSafeInteger(newId) && newId > 0 && newId <= 0xffffffff) {
        this.tokensByTrackId.set(newId, pending.registration.token);
      } else {
        this.gateway.release(pending.registration.token);
      }
      return;
    }
    if (action.action === 'DeleteId') {
      const id = Number(action.args.id);
      const token = this.tokensByTrackId.get(id);
      if (token) this.gateway.release(token);
      this.tokensByTrackId.delete(id);
      return;
    }
    if (action.action === 'DeleteAll') this.releaseAllRegistrations();
  }

  releasePendingRegistration(pending) {
    if (pending.registration) this.gateway.release(pending.registration.token);
  }

  rejectPendingActions(code, deferRegistrationRelease = false) {
    for (const [requestId, pending] of this.pendingActions) {
      this.clearTimer(pending.timer);
      if (deferRegistrationRelease && pending.registration) {
        this.deferredRegistrationTokens.add(pending.registration.token);
      } else {
        this.releasePendingRegistration(pending);
      }
      this.sendRendererCancel(requestId);
      this.sidecar.reject(requestId, code);
    }
    this.pendingActions.clear();
  }

  releaseAllRegistrations() {
    for (const token of this.tokensByTrackId.values()) this.gateway.release(token);
    for (const token of this.deferredRegistrationTokens) this.gateway.release(token);
    this.tokensByTrackId.clear();
    this.deferredRegistrationTokens.clear();
  }

  advanceLifecycle(pendingCode = null) {
    this.lifecycleEpoch += 1;
    this.actionEpoch += 1;
    if (pendingCode) this.rejectPendingActions(pendingCode, true);
  }

  getDesiredServiceMode() {
    if (this.disposed || !this.enabled || !this.rendererReady || this.resetRequired) {
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
          udn: `uuid:${config.openHomeDeviceId}`
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
    if (/^[0-9a-f-]{36}$/i.test(current.openHomeDeviceId || '')) return current;
    const next = { ...current, openHomeDeviceId: crypto.randomUUID() };
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
    this.disposed = true;
    this.cancelSidecarRetry();
    this.finishPendingReset(false);
    this.rendererReady = false;
    this.advanceLifecycle('service-stopped');
    await this.scheduleReconciliation();
  }
}

function registerOpenHomeIpc({ ipcMain, host, getMainWindow }) {
  const handlers = new Map([
    [CHANNELS.getStatus, () => host.getStatus()],
    [CHANNELS.setEnabled, (_event, request) => host.setEnabled(request?.enabled)],
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
  onDiagnostic = () => {}
}) {
  const executableName = processRef.platform === 'win32'
    ? 'effetune-openhome-sidecar.exe'
    : 'effetune-openhome-sidecar';
  const basePath = app.isPackaged
    ? path.join(processRef.resourcesPath, 'openhome')
    : path.join(app.getAppPath(), 'native', 'openhome-sidecar', 'build');
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
    onDiagnostic
  });
}

function createDefaultFriendlyName(computerName = os.hostname()) {
  const name = String(computerName || '').trim();
  return normalizeFriendlyName(name ? `EffeTune (${name})` : 'EffeTune', 'EffeTune');
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

function requireBoundedObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createHostError(code);
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (_) {
    throw createHostError(code);
  }
  if (Buffer.byteLength(serialized) > MAX_IPC_BYTES) throw createHostError(code);
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
  registerOpenHomeIpc
};
