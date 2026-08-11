const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_OUTBOUND_QUEUE_BYTES = MAX_MESSAGE_BYTES * 2;
const MAX_DIAGNOSTIC_LENGTH = 1024;
const STARTUP_TIMEOUT_MS = 10000;
const ALLOWED_SERVICES = new Set(['Product', 'Playlist', 'Info', 'Time']);

class OpenHomeSidecarManager extends EventEmitter {
  constructor({
    sidecarPath,
    processFactory = defaultProcessFactory,
    fileSystem = fs,
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    shutdownTimeoutMs = 1500,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  } = {}) {
    super();
    this.sidecarPath = sidecarPath;
    this.processFactory = processFactory;
    this.fileSystem = fileSystem;
    this.startupTimeoutMs = startupTimeoutMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.child = null;
    this.stdoutBuffer = '';
    this.state = 'stopped';
    this.stopPromise = null;
    this.startupTimer = null;
    this.stopTimer = null;
    this.stopChild = null;
    this.stopResolve = null;
    this.lastConfiguration = null;
    this.writeBlocked = false;
    this.outboundQueue = [];
    this.queuedState = null;
    this.outboundQueueBytes = 0;
  }

  getStatus() {
    return Object.freeze({
      state: this.state,
      available: isUsableSidecar(this.fileSystem, this.sidecarPath)
    });
  }

  start(configuration = {}) {
    if (this.child) return this.state === 'starting' || this.state === 'ready';
    if (!isUsableSidecar(this.fileSystem, this.sidecarPath)) {
      this.setState('unavailable');
      return false;
    }

    const normalizedConfiguration = normalizeConfiguration(configuration);
    let child;
    try {
      child = this.processFactory(this.sidecarPath);
    } catch (error) {
      this.emitDiagnostic('spawn-failed', error);
      this.setState('failed');
      return false;
    }
    if (!isSidecarProcess(child)) {
      this.emitDiagnostic('spawn-failed', new TypeError('Invalid sidecar process'));
      this.setState('failed');
      return false;
    }

    this.child = child;
    this.stdoutBuffer = '';
    this.resetOutbound();
    this.lastConfiguration = normalizedConfiguration;
    this.attachChild(child);
    this.setState('starting');
    this.send({
      type: 'configure',
      protocolVersion: PROTOCOL_VERSION,
      device: normalizedConfiguration
    });
    this.startupTimer = this.setTimer(() => {
      this.startupTimer = null;
      if (this.child !== child || this.state !== 'starting') return;
      this.emit('diagnostic', { code: 'startup-timeout', detail: '' });
      void this.stop();
    }, this.startupTimeoutMs);
    this.startupTimer?.unref?.();
    return true;
  }

  publishState(snapshot) {
    if (this.state !== 'ready') return false;
    return this.send({ type: 'state', snapshot });
  }

  respond(requestId, result) {
    if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 64) {
      return false;
    }
    return this.send({ type: 'response', requestId, ok: true, result });
  }

  reject(requestId, code = 'action-failed') {
    if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 64) {
      return false;
    }
    return this.send({
      type: 'response',
      requestId,
      ok: false,
      error: { code: normalizeErrorCode(code) }
    });
  }

  send(message) {
    const child = this.child;
    if (!child?.stdin?.writable) return false;
    let line;
    try {
      line = `${JSON.stringify(message)}\n`;
    } catch (_) {
      return false;
    }
    if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) return false;
    const item = { line, bytes: Buffer.byteLength(line) };
    if (message.type === 'state') {
      const previousBytes = this.queuedState?.bytes || 0;
      if (!this.reserveOutboundBytes(item.bytes - previousBytes)) return false;
      this.queuedState = item;
    } else {
      if (!this.reserveOutboundBytes(item.bytes)) return false;
      this.outboundQueue.push(item);
    }
    this.flushOutbound(child);
    return true;
  }

  reserveOutboundBytes(additionalBytes) {
    if (this.outboundQueueBytes + additionalBytes > MAX_OUTBOUND_QUEUE_BYTES) {
      this.emit('diagnostic', { code: 'outbound-overflow', detail: '' });
      this.outboundQueue = [];
      this.queuedState = null;
      this.outboundQueueBytes = 0;
      void this.stop();
      return false;
    }
    this.outboundQueueBytes += additionalBytes;
    return true;
  }

  flushOutbound(child) {
    while (this.child === child && !this.writeBlocked) {
      const item = this.outboundQueue.shift() || this.takeQueuedState();
      if (!item) return;
      this.outboundQueueBytes -= item.bytes;
      try {
        if (!child.stdin.write(item.line)) {
          this.writeBlocked = true;
          return;
        }
      } catch (error) {
        this.handleTransportError('write-failed', error, child);
        return;
      }
    }
  }

  takeQueuedState() {
    const item = this.queuedState;
    this.queuedState = null;
    return item;
  }

  resetOutbound() {
    this.writeBlocked = false;
    this.outboundQueue = [];
    this.queuedState = null;
    this.outboundQueueBytes = 0;
  }

  handleTransportError(code, error, child) {
    if (this.child !== child) return;
    this.emitDiagnostic(code, error);
    if (this.state === 'starting' || this.state === 'ready') void this.stop();
  }

  stop() {
    this.clearStartupTimer();
    if (!this.child) {
      if (this.state !== 'unavailable') this.setState('stopped');
      return Promise.resolve();
    }
    if (this.stopPromise) return this.stopPromise;

    const child = this.child;
    this.setState('stopping');
    this.stopPromise = new Promise(resolve => {
      this.stopResolve = resolve;
    });
    this.stopChild = child;
    this.send({ type: 'shutdown' });
    this.stopTimer = this.setTimer(
      () => this.requestTermination(child),
      this.shutdownTimeoutMs
    );
    return this.stopPromise;
  }

  requestTermination(child) {
    if (this.stopChild !== child) return;
    this.stopTimer = null;
    try {
      child.kill();
    } catch (error) {
      this.emitDiagnostic('terminate-failed', error);
    }
    if (this.stopChild !== child) return;
    this.stopTimer = this.setTimer(
      () => this.failStop(child),
      this.shutdownTimeoutMs
    );
  }

  failStop(child) {
    if (this.stopChild !== child) return;
    this.stopTimer = null;
    const resolve = this.stopResolve;
    this.stopChild = null;
    this.stopResolve = null;
    this.stopPromise = null;
    this.emit('diagnostic', { code: 'terminate-timeout', detail: '' });
    this.setState('failed');
    resolve?.();
  }

  finishStop(child) {
    if (this.stopChild !== child) return false;
    if (this.stopTimer) {
      this.clearTimer(this.stopTimer);
      this.stopTimer = null;
    }
    const resolve = this.stopResolve;
    this.stopChild = null;
    this.stopResolve = null;
    this.stopPromise = null;
    this.clearStartupTimer();
    this.setState('stopped');
    resolve?.();
    return true;
  }

  attachChild(child) {
    let terminalSettled = false;
    const settleTerminal = (code, signal) => {
      if (terminalSettled) return;
      terminalSettled = true;
      this.handleChildTerminal(child, code, signal);
    };
    child.stdout.setEncoding?.('utf8');
    child.stderr.setEncoding?.('utf8');
    child.stdout.on('data', chunk => this.handleStdout(chunk));
    child.stderr.on('data', chunk => {
      const diagnostic = String(chunk).trim().slice(0, MAX_DIAGNOSTIC_LENGTH);
      if (diagnostic) this.emit('diagnostic', { code: 'sidecar-stderr', detail: diagnostic });
    });
    child.stdin.on?.('drain', () => {
      if (this.child !== child) return;
      this.writeBlocked = false;
      this.flushOutbound(child);
    });
    child.stdin.on?.('error', error => {
      this.handleTransportError('write-failed', error, child);
    });
    child.on('error', error => {
      this.handleTransportError('sidecar-error', error, child);
    });
    child.on('exit', settleTerminal);
    child.on('close', settleTerminal);
  }

  handleChildTerminal(child, code, signal) {
    if (this.child !== child) return;
    this.child = null;
    this.clearStartupTimer();
    this.stdoutBuffer = '';
    this.resetOutbound();
    if (this.finishStop(child)) return;
    this.emit('diagnostic', {
      code: 'sidecar-exited',
      detail: `${Number.isInteger(code) ? code : 'unknown'}:${signal || 'none'}`
    });
    this.setState('failed');
  }

  handleStdout(chunk) {
    this.stdoutBuffer += String(chunk);
    if (Buffer.byteLength(this.stdoutBuffer) > MAX_MESSAGE_BYTES) {
      this.emit('diagnostic', { code: 'message-too-large', detail: '' });
      void this.stop();
      return;
    }

    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (_) {
      this.emit('diagnostic', { code: 'invalid-json', detail: '' });
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this.emit('diagnostic', { code: 'invalid-message', detail: '' });
      return;
    }

    if (message.type === 'ready') {
      if (this.state !== 'starting') return;
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        this.emit('diagnostic', { code: 'protocol-mismatch', detail: '' });
        void this.stop();
        return;
      }
      this.clearStartupTimer();
      this.setState('ready');
      this.emit('ready');
      return;
    }
    if (message.type === 'action') {
      if (this.state !== 'ready') {
        this.reject(String(message.requestId || ''), 'not-ready');
        return;
      }
      const action = normalizeAction(message);
      if (!action) {
        this.reject(String(message.requestId || ''), 'invalid-action');
        return;
      }
      this.emit('action', action);
      return;
    }
    if (message.type === 'diagnostic') {
      this.emit('diagnostic', {
        code: normalizeErrorCode(message.code || 'sidecar-diagnostic'),
        detail: String(message.detail || '').slice(0, MAX_DIAGNOSTIC_LENGTH)
      });
    }
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('status', this.getStatus());
  }

  clearStartupTimer() {
    if (!this.startupTimer) return;
    this.clearTimer(this.startupTimer);
    this.startupTimer = null;
  }

  emitDiagnostic(code, error) {
    this.emit('diagnostic', {
      code,
      detail: String(error?.code || error?.name || 'unknown').slice(0, MAX_DIAGNOSTIC_LENGTH)
    });
  }
}

function normalizeAction(message) {
  const requestId = typeof message.requestId === 'string' ? message.requestId : '';
  const service = typeof message.service === 'string' ? message.service : '';
  const action = typeof message.action === 'string' ? message.action : '';
  const args = message.args && typeof message.args === 'object' && !Array.isArray(message.args)
    ? message.args
    : {};
  if (!requestId || requestId.length > 64 || !ALLOWED_SERVICES.has(service) ||
      !action || action.length > 64) {
    return null;
  }
  let encoded;
  try {
    encoded = JSON.stringify(args);
  } catch (_) {
    return null;
  }
  if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES / 2) return null;
  return Object.freeze({ requestId, service, action, args });
}

function normalizeConfiguration(configuration) {
  const friendlyName = String(configuration.friendlyName || 'EffeTune').trim().slice(0, 128);
  const udn = String(configuration.udn || '').trim().slice(0, 128);
  return Object.freeze({ friendlyName: friendlyName || 'EffeTune', udn });
}

function normalizeErrorCode(code) {
  const normalized = String(code || '').trim();
  return /^[a-z][a-z0-9-]{0,63}$/i.test(normalized) ? normalized : 'action-failed';
}

function isUsableSidecar(fileSystem, sidecarPath) {
  if (typeof sidecarPath !== 'string' || sidecarPath.length === 0) return false;
  try {
    return fileSystem.statSync(sidecarPath).isFile();
  } catch (_) {
    return false;
  }
}

function isSidecarProcess(child) {
  return !!(
    child &&
    child.stdin && typeof child.stdin.write === 'function' &&
    child.stdout && typeof child.stdout.on === 'function' &&
    child.stderr && typeof child.stderr.on === 'function' &&
    typeof child.on === 'function'
  );
}

function defaultProcessFactory(sidecarPath) {
  return spawn(sidecarPath, ['--stdio'], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
}

module.exports = {
  ALLOWED_SERVICES,
  MAX_MESSAGE_BYTES,
  MAX_OUTBOUND_QUEUE_BYTES,
  OpenHomeSidecarManager,
  PROTOCOL_VERSION,
  STARTUP_TIMEOUT_MS
};
