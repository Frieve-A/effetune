'use strict';

const { EventEmitter } = require('node:events');
const { LIVE_KIND, FEEDBACK_FRESHNESS_MS, validDelay } = require('./network-output-live.cjs');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const L0_MS = 2000;
const L0_MAX_MS = 6000;
const MAX_TRIM_MS = 2000;
const MAX_SYNC_DELAY_MS = L0_MAX_MS + MAX_TRIM_MS;
const DELAY_TRANSITION_FRAMES = 256;
const MAX_FRAME_HISTORY = SAMPLE_RATE * 10;
const MAX_TIMING_UNCERTAINTY_MS = 175;
const LIVE_LATENCY_TOLERANCE_MS = 25;
const LATENCY_TOLERANCE_MS = 20;
const LATENCY_SAMPLES = 21;
const CAST_POLL_MS = 250;
const CAST_STALL_SAMPLES = 8;
const POLL_MS = 2000;
const RETRY_MS = 30000;
const SILENCE_AFTER_MS = 250;
const SILENCE_TICK_MS = 20;
const MAX_SILENCE_FRAMES = SAMPLE_RATE;
const MAX_DROPS = 3;
const CAST_START_TIMEOUT_MS = 15000;
const DISPOSE_STOP_TIMEOUT_MS = 3000;
const CAST_APP_ID = 'CC1AD845';
const DLNA_FEATURES = 'DLNA.ORG_OP=00;DLNA.ORG_FLAGS=01700000000000000000000000000000';
const UPNP_MIME_TYPES = ['audio/flac', 'audio/x-flac'];
const CAST_MIME_TYPE = 'audio/wav';
const TARGET_TYPES = ['upnp', 'cast'];
const DEFAULT_CONFIGURATION = Object.freeze({ enabled: false, localEnabled: true, localTrimMs: 0, targets: Object.freeze([]) });

const isTrim = (value, min) => Number.isInteger(value) && value >= min && value <= MAX_TRIM_MS;
const framesForMs = ms => Math.round(ms * SAMPLE_RATE / 1000);
const msForFrames = frames => frames * 1000 / SAMPLE_RATE;
const cappedDelay = ms => Math.max(0, Math.min(MAX_SYNC_DELAY_MS, ms));

function normalizeRoute(input, now) {
  if (input?.active === false) return null;
  const { active, revision, localReachable, dspMs, softwareOutputMs, physicalOutputMs, contextFrame,
    frameTimeMs, clockUncertaintyMs } = input ?? {};
  if (active !== true || !Number.isSafeInteger(revision) || revision < 0 || typeof localReachable !== 'boolean' ||
      ![dspMs, softwareOutputMs, physicalOutputMs].every(value => value === null || validDelay(value)) ||
      !Number.isFinite(contextFrame) || contextFrame < 0 || !Number.isFinite(frameTimeMs) || Math.abs(frameTimeMs - now) > FEEDBACK_FRESHNESS_MS ||
      !Number.isFinite(clockUncertaintyMs) || clockUncertaintyMs < 0 || clockUncertaintyMs > MAX_TIMING_UNCERTAINTY_MS) {
    throw new TypeError('Invalid network output route');
  }
  const localMs = [dspMs, softwareOutputMs, physicalOutputMs].every(validDelay) ? dspMs + softwareOutputMs + physicalOutputMs : null;
  return { revision, localReachable, localMs, contextFrame, frameTimeMs, clockUncertaintyMs };
}

// Validate the complete main-owned `networkOutput` configuration (§4).
function normalizeConfiguration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid network output configuration');
  const { enabled, localEnabled = true, localTrimMs, targets } = input;
  if (typeof enabled !== 'boolean') throw new TypeError('Invalid network output enabled state');
  if (typeof localEnabled !== 'boolean') throw new TypeError('Invalid local output enabled state');
  if (!isTrim(localTrimMs, -MAX_TRIM_MS)) throw new TypeError('Invalid local trim');
  if (!Array.isArray(targets)) throw new TypeError('Invalid network output targets');
  const ids = new Set();
  const normalized = targets.map(target => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) throw new TypeError('Invalid network output target');
    const { id, type, name, enabled: targetEnabled, trimMs } = target;
    if (typeof id !== 'string' || !id || ids.has(id)) throw new TypeError('Invalid network output target id');
    if (!TARGET_TYPES.includes(type)) throw new TypeError('Invalid network output target type');
    if (typeof name !== 'string') throw new TypeError('Invalid network output target name');
    if (typeof targetEnabled !== 'boolean') throw new TypeError('Invalid network output target enabled state');
    if (!isTrim(trimMs, 0)) throw new TypeError('Invalid network output target trim');
    ids.add(id);
    return Object.freeze({ id, type, name, enabled: targetEnabled, trimMs });
  });
  return Object.freeze({ enabled, localEnabled, localTrimMs, targets: Object.freeze(normalized) });
}

// A saved configuration is trusted only after validation; a damaged settings
// entry falls back to the default so startup and partial IPC patches share one base.
// A missing entry (first run) is simply the default and is not reported.
function sanitizeConfiguration(saved, onDiagnostic = () => {}) {
  if (saved === undefined) return DEFAULT_CONFIGURATION;
  try { return normalizeConfiguration(saved); }
  catch (error) { onDiagnostic('network-output-config-invalid', error); return DEFAULT_CONFIGURATION; }
}

// Fixed-length interleaved delay line. The first `frames` frames of output are
// silence, so trimmed audio is never sent ahead of real time.
class DelayLine {
  constructor(frames) {
    this.buffer = null;
    this.frames = 0;
    this.appliedFrames = 0;
    this.position = 0;
    this.remaining = 0;
    this.nextFrames = null;
    this.capacity = 0;
    this.setDelay(frames);
  }
  setDelay(frames, smooth = false) {
    const capacity = smooth ? framesForMs(MAX_SYNC_DELAY_MS) : frames;
    if (capacity !== this.capacity) {
      const next = capacity ? new Int16Array((capacity + 1) * CHANNELS) : null;
      if (this.buffer && next) {
        const count = Math.min(capacity, this.capacity) * CHANNELS;
        const end = this.position;
        const start = (end - count + this.buffer.length) % this.buffer.length;
        const firstCount = Math.min(count, this.buffer.length - start);
        next.set(this.buffer.subarray(start, start + firstCount), next.length - count);
        next.set(this.buffer.subarray(0, count - firstCount), next.length - count + firstCount);
      }
      this.buffer = next;
      this.capacity = capacity;
      this.position = 0;
    }
    if (smooth && this.remaining) {
      this.nextFrames = frames === this.frames ? null : frames;
      return;
    }
    this.nextFrames = null;
    if (smooth && this.frames !== frames) {
      this.remaining = frames === this.appliedFrames ? 0 : DELAY_TRANSITION_FRAMES;
    } else if (!smooth) {
      this.remaining = 0;
      this.appliedFrames = frames;
    }
    this.frames = frames;
  }
  process(input) {
    if (!this.remaining && this.nextFrames !== null) {
      this.frames = this.nextFrames;
      this.nextFrames = null;
      if (this.frames !== this.appliedFrames) this.remaining = DELAY_TRANSITION_FRAMES;
    }
    const buffer = this.buffer;
    if (!buffer) return input;
    const output = this.frames || this.remaining ? new Int16Array(input.length) : input;
    const length = buffer.length;
    const delay = this.frames * CHANNELS;
    const previousDelay = this.appliedFrames * CHANNELS;
    let position = this.position;
    for (let index = 0; index < input.length; index += CHANNELS) {
      buffer[position] = input[index]; buffer[position + 1] = input[index + 1];
      if (output !== input) {
        let read = position - delay;
        if (read < 0) read += length;
        if (this.remaining) {
          let previous = position - previousDelay;
          if (previous < 0) previous += length;
          const fade = --this.remaining / DELAY_TRANSITION_FRAMES;
          output[index] = Math.round(buffer[read] * (1 - fade) + buffer[previous] * fade);
          output[index + 1] = Math.round(buffer[read + 1] * (1 - fade) + buffer[previous + 1] * fade);
          if (!this.remaining) this.appliedFrames = this.frames;
        } else {
          output[index] = buffer[read]; output[index + 1] = buffer[read + 1];
        }
      }
      position += CHANNELS; if (position === length) position = 0;
    }
    this.position = position;
    return output;
  }
}

class NetworkOutputHost extends EventEmitter {
  constructor({
    discovery, castDiscovery, streamServer, createCastSession,
    upnp = require('./network-music-upnp.cjs'),
    routeAddress = require('./network-music-host.cjs').routeAddress,
    supportsProtocol = require('./network-music-host.cjs').supportsProtocol,
    getOwnDeviceIds = () => [],
    onDiagnostic = () => {}, onStatus = () => {},
    now = Date.now, clockNow = () => performance.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout
  }) {
    super();
    Object.assign(this, { discovery, upnp, routeAddress, supportsProtocol, getOwnDeviceIds, onDiagnostic, onStatus, now, clockNow, setIntervalFn, clearIntervalFn, setTimeoutFn, clearTimeoutFn });
    this.castDiscovery = castDiscovery ?? new (require('./network-output-mdns.cjs').CastDiscovery)({ onDiagnostic });
    this.streamServer = streamServer ?? new (require('./network-output-stream.cjs').LiveStreamServer)({ onDiagnostic, clockNow });
    this.createCastSession = createCastSession ?? (options => new (require('./cast-sender.cjs').CastSession)(options));
    this.config = DEFAULT_CONFIGURATION;
    this.pickerOpen = false;
    this.sessions = new Map();
    this.operation = Promise.resolve();
    this.environmentAvailable = true;
    this.disposed = false;
    this.serverOpen = false;
    this.serverFailed = false;
    this.rendererPort = null;
    this.portMessageListener = null;
    this.portCloseListener = null;
    this.silenceWatch = null;
    this.silenceTimer = null;
    this.silenceAnchor = 0;
    this.silenceFrames = 0;
    this.sourceEpoch = null;
    this.sourceNextFrame = 0;
    this.lateRun = null;
    this.silenceActive = false;
    this.resumeFadeRemaining = 0;
    this.epochFadeRemaining = 0;
    this.epochFadeFrom = [0, 0];
    this.hasSourceAudio = false;
    this.lastSourceSample = [0, 0];
    this.lastStatus = '';
    this.syncRevision = 0;
    this.liveRoute = null;
    this.localOutputMs = 0;
    this.routeAnchorTimer = null;
    this.syncPlanKey = null;
    this.feedFrame = 0;
    this.packetTiming = [];
    this.discoveryChanged = () => {
      if (this.config.enabled && !this.disposed) void this.enqueue(() => this.reconcile());
      else this.publishStatus();
    };
    this.discovery.on('change', this.discoveryChanged);
    this.castDiscovery.on('change', this.discoveryChanged);
  }

  // ---- status -------------------------------------------------------------

  getStatus() {
    const plan = this.planLiveDelays();
    const own = new Set(this.ownDeviceIds());
    const entries = new Map();
    for (const target of this.config.targets) entries.set(target.id, { ...target, present: false });
    const merge = (id, type, name) => {
      const saved = entries.get(id);
      if (saved) { saved.present = true; saved.name = name; }
      else entries.set(id, { id, type, name, enabled: false, trimMs: 0, present: true });
    };
    for (const device of this.discovery.devices.values()) {
      if (device.available && this.upnp.service(device, 'AVTransport') && !own.has(device.id)) merge(device.id, 'upnp', device.name);
    }
    for (const device of this.castDiscovery.devices.values()) merge(device.id, 'cast', device.name);
    const targets = [...entries.values()].map(entry => {
      let state = 'searching'; let note = null;
      if (this.config.enabled && entry.enabled) {
        const session = this.sessions.get(entry.id);
        if (session) ({ state, note } = session);
        else if (this.serverFailed) { state = 'unreachable'; note = 'startFailed'; }
      }
      const sync = plan?.targets.get(entry.id);
      return Object.freeze({ ...entry, state, note, ...(sync ? { syncState: sync.state } : {}) });
    }).sort((a, b) => {
      const left = a.name.toLowerCase(); const right = b.name.toLowerCase();
      return left < right ? -1 : left > right ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const { enabled, localEnabled, localTrimMs } = this.config;
    const syncDelayMs = plan?.goal ?? (enabled && this.config.targets.some(target => target.enabled) ? this.baseDelayMs() : 0);
    const localDelayMs = plan?.localDelayMs ?? (syncDelayMs > 0 ? Math.max(0, syncDelayMs + localTrimMs - this.localOutputMs) : 0);
    return Object.freeze({ enabled, localEnabled, localTrimMs, localDelayMs, syncDelayMs, syncRevision: this.syncRevision,
      ...(plan ? { networkTiming: { measured: plan.measured, arrivalMs: plan.arrivalMs, revision: this.liveRoute.revision } } : {}),
      targets: Object.freeze(targets) });
  }

  planLiveDelays() {
    if (!this.liveRoute || !this.isActive()) return null;
    const enabledTargets = this.config.targets.filter(target => target.enabled);
    if (!enabledTargets.length) return null;
    const now = this.clockNow();
    const anchorFresh = Math.abs(this.liveRoute.frameTimeMs - now) <= FEEDBACK_FRESHNESS_MS;
    const includesLocal = this.config.localEnabled && this.liveRoute.localReachable;
    const localMs = this.liveRoute.localMs;
    let goal = includesLocal ? Math.max(0, (localMs ?? 0) - this.config.localTrimMs) : 0;
    const targets = new Map();
    for (const target of enabledTargets) {
      const session = this.sessions.get(target.id);
      const live = session?.liveMeasurement;
      const cast = session?.type === 'cast' && now - session.castMeasuredAt <= FEEDBACK_FRESHNESS_MS ? session.latencyMs : null;
      // Cast's existing position estimate spans its receiver buffer and playout. EffeTune reports its suffix separately.
      const hasLiveTiming = Boolean(anchorFresh && live && live.routeRevision === this.liveRoute.revision && now - live.receivedAt <= FEEDBACK_FRESHNESS_MS);
      const fallbackMs = hasLiveTiming ? live.latencyMs : cast ?? L0_MS;
      goal = Math.max(goal, fallbackMs);
      targets.set(target.id, { fallbackMs, known: hasLiveTiming, trimMs: target.trimMs, delay: session?.delay });
    }
    const requestedLocalMs = includesLocal ? goal - (localMs ?? 0) + this.config.localTrimMs : 0;
    const localLimited = requestedLocalMs > MAX_SYNC_DELAY_MS;
    let measured = true;
    let arrivalMs = 0;
    for (const target of targets.values()) {
      const requested = goal - target.fallbackMs + target.trimMs;
      target.frames = framesForMs(cappedDelay(requested));
      const applied = target.delay?.appliedFrames;
      target.state = requested > MAX_SYNC_DELAY_MS || localLimited ? 'limited' : target.known &&
        applied === target.frames && !target.delay.remaining && target.delay.nextFrames === null && (!includesLocal || localMs !== null) ? 'synced' : 'unmeasured';
      measured &&= target.state === 'synced';
      if (target.known && Number.isFinite(applied)) arrivalMs = Math.max(arrivalMs, target.fallbackMs + msForFrames(applied));
    }
    return { goal, localDelayMs: cappedDelay(requestedLocalMs), targets, measured, arrivalMs: measured ? arrivalMs : null };
  }

  // The local stage waits for the slowest receiver: at least L0, more when a measured Cast latency exceeds it.
  baseDelayMs() {
    let base = L0_MS;
    const now = this.clockNow();
    for (const session of this.sessions.values()) {
      if (now - session.castMeasuredAt <= FEEDBACK_FRESHNESS_MS && session.latencyMs !== null && session.latencyMs > base) base = session.latencyMs;
    }
    return Math.ceil(base);
  }

  // Each send-side delay line lands its receiver on the local stage: the base minus the receiver's own latency
  // (L0 assumed where it is not measured), plus the user's trim.
  applyDelays() {
    const plan = this.planLiveDelays();
    const base = this.baseDelayMs();
    for (const session of this.sessions.values()) {
      const measured = this.clockNow() - session.castMeasuredAt <= FEEDBACK_FRESHNESS_MS ? session.latencyMs : null;
      const delayMs = base - (measured ?? L0_MS) + session.target.trimMs;
      const live = plan?.targets.get(session.id);
      const frames = live?.frames ?? framesForMs(cappedDelay(delayMs));
      session.delay.setDelay(frames, true);
    }
    const key = plan ? JSON.stringify([this.liveRoute.revision, plan.localDelayMs, ...[...plan.targets].map(([id, target]) => [id, target.frames, target.known])]) : null;
    if (this.syncPlanKey !== key) {
      this.syncPlanKey = key;
      this.syncRevision++;
    }
    this.publishStatus();
  }

  updateRoute(input) {
    const route = normalizeRoute(input, this.clockNow());
    if (route && this.liveRoute && route.frameTimeMs < this.liveRoute.frameTimeMs) return false;
    // Without a send tap the stream leaves after the whole pipeline, so the local stage trails it by the output
    // device's latency alone and its delay is shortened by that much. A reading within the tolerance keeps the delay.
    if (!route) {
      const outputMs = validDelay(input?.physicalOutputMs) ? Math.round(input.physicalOutputMs) : 0;
      if (Math.abs(outputMs - this.localOutputMs) >= LATENCY_TOLERANCE_MS) this.localOutputMs = outputMs;
    }
    if (route?.revision !== this.liveRoute?.revision) this.packetTiming.length = 0;
    if (this.routeAnchorTimer) this.clearTimeoutFn(this.routeAnchorTimer);
    this.routeAnchorTimer = null;
    this.liveRoute = route;
    if (route) {
      this.routeAnchorTimer = this.setTimeoutFn(() => {
        this.routeAnchorTimer = null;
        this.applyDelays();
      }, Math.max(1, route.frameTimeMs + FEEDBACK_FRESHNESS_MS - this.clockNow() + 1));
      this.routeAnchorTimer.unref?.();
    }
    this.applyDelays();
    return true;
  }

  ownDeviceIds() {
    try { return this.getOwnDeviceIds() ?? []; }
    catch (error) { this.onDiagnostic('network-output-own-id-failed', error); return []; }
  }

  publishStatus() {
    const status = this.getStatus();
    const serialized = JSON.stringify(status);
    if (serialized !== this.lastStatus) {
      this.lastStatus = serialized;
      this.onStatus(status);
    }
    return status;
  }

  // Serializes an operation behind the ones already queued.
  run(callback) {
    const next = this.operation.then(callback);
    this.operation = next.catch(error => { this.onDiagnostic('network-output-operation-failed', error); });
    return this.operation;
  }

  // Runs an operation, then publishes the resulting status and resolves with it.
  enqueue(callback) {
    return this.run(callback).then(() => this.publishStatus());
  }

  // ---- public operations --------------------------------------------------

  async setConfiguration(input) {
    const config = normalizeConfiguration(input);
    return this.enqueue(async () => {
      if (this.disposed) return;
      this.config = config;
      await this.reconcile();
    });
  }

  attachRendererPort(port) {
    return this.enqueue(async () => {
      if (this.disposed) { port?.close(); return; }
      this.detachRendererPort();
      this.rendererPort = port;
      this.portMessageListener = event => { if (this.rendererPort === port) this.handlePortMessage(event?.data ?? event, port); };
      this.portCloseListener = () => {
        void this.enqueue(() => { if (this.rendererPort === port) this.detachRendererPort(); });
      };
      port.on('message', this.portMessageListener);
      port.on('close', this.portCloseListener);
      port.start();
    });
  }

  detachRendererPort() {
    const port = this.rendererPort;
    this.rendererPort = null;
    this.sourceEpoch = null;
    this.lateRun = null;
    if (this.liveRoute) {
      if (this.routeAnchorTimer) this.clearTimeoutFn(this.routeAnchorTimer);
      this.routeAnchorTimer = null;
      this.liveRoute = null;
      this.packetTiming.length = 0;
      if (!this.disposed) this.applyDelays();
    }
    if (!port) return;
    port.removeListener('message', this.portMessageListener);
    port.removeListener('close', this.portCloseListener);
    port.close();
    // Sessions keep running on real-time silence until a renderer returns.
    this.armSilenceWatch();
  }

  setRendererUnavailable() {
    return this.enqueue(() => {
      this.detachRendererPort();
      if (this.pickerOpen) {
        this.pickerOpen = false;
        this.updateDiscovery();
      }
    });
  }

  setPickerOpen(open) {
    return this.enqueue(() => {
      if (this.disposed) return;
      this.pickerOpen = open;
      this.updateDiscovery();
    });
  }

  setEnvironmentAvailable(available) {
    return this.enqueue(async () => {
      if (this.disposed) return;
      this.environmentAvailable = available === true;
      await this.reconcile();
    });
  }

  resync() {
    return this.enqueue(async () => {
      if (this.disposed) return;
      this.syncRevision++;
      for (const session of this.sessions.values()) {
        this.teardownTransport(session);
        session.phase = 'idle'; session.state = 'searching'; session.note = null; session.failures = 0;
      }
      this.serverFailed = false;
      await this.reconcile();
    });
  }

  dispose() {
    // Nothing receives status after disposal, and the own-device lookup may already be gone.
    return this.run(async () => {
      this.disposed = true;
      this.discovery.removeListener('change', this.discoveryChanged);
      this.castDiscovery.removeListener('change', this.discoveryChanged);
      this.detachRendererPort();
      this.stopSilenceFill();
      const stops = [...this.sessions.values()].map(session => this.removeSession(session, { stop: true }));
      this.sessions.clear();
      await Promise.race([Promise.allSettled(stops), new Promise(resolve => { this.setTimeoutFn(resolve, DISPOSE_STOP_TIMEOUT_MS).unref?.(); })]);
      await this.closeServer();
      this.castDiscovery.stop();
    });
  }

  // ---- reconciliation -----------------------------------------------------

  isActive() { return this.config.enabled && this.environmentAvailable && !this.disposed; }

  updateDiscovery() {
    if (!this.disposed && (this.config.enabled || this.pickerOpen)) {
      this.castDiscovery.start();
      Promise.resolve().then(() => this.discovery.start()).catch(error => this.onDiagnostic('network-output-discovery-failed', error));
    } else {
      this.castDiscovery.stop();
    }
  }

  async reconcile() {
    this.updateDiscovery();
    const wanted = new Map(this.isActive() ? this.config.targets.filter(target => target.enabled).map(target => [target.id, target]) : []);
    for (const session of [...this.sessions.values()]) if (!wanted.has(session.id)) void this.removeSession(session, { stop: true });
    if (!wanted.size) { await this.closeServer(); this.armSilenceWatch(); return; }
    if (!await this.ensureServer()) { this.armSilenceWatch(); return; }
    for (const target of wanted.values()) {
      let session = this.sessions.get(target.id);
      if (!session) {
        session = { id: target.id, type: target.type, target, delay: new DelayLine(framesForMs(target.trimMs)), generation: 0, phase: 'idle', state: 'searching', note: null,
          url: '', stream: null, cast: null, castApp: null, launchedApp: null, launched: false, mediaSessionId: null,
          latencyMs: null, latencySamples: [], castMeasuredAt: -Infinity, castMediaRevision: 0, castPlayerState: null, liveMeasurement: null, measurementTimer: null,
          failures: 0, pollTimer: null, polling: false, retryTimer: null, startTimer: null };
        this.sessions.set(target.id, session);
      }
      session.target = target;
      const device = this.findDevice(target);
      if (!device) {
        // A blocked session already has no transport and waits for the user to select it again, so it keeps its note.
        if (session.phase !== 'blocked' && (session.phase !== 'idle' || session.state !== 'searching')) {
          // A target that was reachable and vanished is reported as offline until it is seen again.
          this.teardownTransport(session);
          session.phase = 'idle'; session.state = 'unreachable'; session.note = 'offline';
        }
      } else if (session.phase === 'idle') {
        void this.startSession(session);
      }
    }
    this.applyDelays();
    this.armSilenceWatch();
  }

  findDevice(target) {
    if (target.type === 'cast') return this.castDiscovery.devices.get(target.id) ?? null;
    const device = this.discovery.devices.get(target.id);
    return device?.available && this.upnp.service(device, 'AVTransport') && !this.ownDeviceIds().includes(device.id) ? device : null;
  }

  async ensureServer() {
    if (this.serverOpen) return true;
    try {
      await this.streamServer.open();
      this.serverOpen = true; this.serverFailed = false;
      return true;
    } catch (error) {
      this.serverFailed = true;
      this.onDiagnostic('network-output-server-failed', error);
      return false;
    }
  }

  async closeServer() {
    this.serverFailed = false;
    if (!this.serverOpen) return;
    this.serverOpen = false;
    try { await this.streamServer.close(); } catch (error) { this.onDiagnostic('network-output-server-failed', error); }
  }

  removeSession(session, { stop = false } = {}) {
    this.sessions.delete(session.id);
    return this.teardownTransport(session, { stop });
  }

  // Drop the live transport of one target without forgetting the target itself.
  teardownTransport(session, { stop = false } = {}) {
    session.generation += 1;
    this.clearSessionTimers(session);
    const { stream, cast, url } = session;
    session.stream = null; session.cast = null; session.castApp = null; session.launchedApp = null; session.launched = false; session.mediaSessionId = null;
    session.latencyMs = null; session.latencySamples = []; session.castMeasuredAt = -Infinity; session.castOverLimit = 0; session.castPlayerState = null; session.liveMeasurement = null; session.url = '';
    stream?.close();
    const pending = [];
    if (cast) {
      cast.removeAllListeners();
      cast.on('error', () => {});
      pending.push((stop ? Promise.resolve().then(() => cast.stop()).catch(error => this.onDiagnostic('network-output-cast-failed', error)) : Promise.resolve()).then(() => cast.close()));
    }
    if (stop && session.type === 'upnp' && url) {
      const device = this.discovery.devices.get(session.id);
      const transport = this.upnp.service(device, 'AVTransport');
      if (transport) pending.push(this.upnp.soap(transport, 'Stop', { InstanceID: 0 }).catch(error => this.onDiagnostic('network-output-upnp-failed', error)));
    }
    return Promise.all(pending);
  }

  clearSessionTimers(session) {
    if (session.pollTimer) { this.clearIntervalFn(session.pollTimer); session.pollTimer = null; }
    if (session.retryTimer) { this.clearTimeoutFn(session.retryTimer); session.retryTimer = null; }
    if (session.measurementTimer) { this.clearTimeoutFn(session.measurementTimer); session.measurementTimer = null; }
    this.clearStartTimer(session);
    session.polling = false;
  }

  clearStartTimer(session) {
    if (session.startTimer) { this.clearTimeoutFn(session.startTimer); session.startTimer = null; }
  }

  isCurrent(session, generation) {
    return !this.disposed && this.sessions.get(session.id) === session && session.generation === generation;
  }

  setState(session, state, note = null) {
    if (session.state === state && session.note === note) return;
    session.state = state; session.note = note;
    this.publishStatus();
  }

  // ---- session lifecycle --------------------------------------------------

  async startSession(session) {
    const device = this.findDevice(session.target);
    if (!device) return;
    session.generation += 1;
    const generation = session.generation;
    session.phase = 'starting';
    this.setState(session, 'connecting');
    try {
      if (session.type === 'upnp') await this.startUpnp(session, device, generation);
      else await this.startCast(session, device, generation);
      if (this.isCurrent(session, generation)) session.phase = 'running';
    } catch (error) {
      if (!this.isCurrent(session, generation)) return;
      if (session.type === 'cast') this.handleDrop(session, error);
      else this.fail(session, 'offline', 'network-output-upnp-failed', error);
    }
  }

  restart(session) {
    if (this.disposed || this.sessions.get(session.id) !== session) return;
    this.teardownTransport(session);
    session.phase = 'idle';
    void this.enqueue(() => this.reconcile());
  }

  fail(session, note, code, error) {
    this.teardownTransport(session);
    this.applyDelays();
    if (error) this.onDiagnostic(code, error);
    // Only a failure without a definite cause (or one that means the device is unreachable) is retried automatically.
    const retry = !note || note === 'offline';
    session.phase = retry ? 'waiting' : 'blocked';
    this.setState(session, 'unreachable', note ?? null);
    if (!retry) return;
    session.retryTimer = this.setTimeoutFn(() => {
      session.retryTimer = null;
      if (this.sessions.get(session.id) !== session) return;
      session.phase = 'idle';
      void this.enqueue(() => this.reconcile());
    }, RETRY_MS);
    session.retryTimer.unref?.();
  }

  openStream(session, contentType, hostAddress) {
    const stream = this.streamServer.createStream({ contentType });
    session.stream = stream;
    session.url = stream.url(hostAddress);
    stream.on('overflow', () => {
      if (session.stream !== stream) return;
      this.onDiagnostic('network-output-stream-overflow', session.id);
      this.handleDrop(session, new Error('Network output stream overflow'));
    });
    stream.on('disconnected', () => {
      // A Cast receiver that rejects the stream closes the connection; count it as a drop so the offline back-off
      // engages instead of reloading the receiver every few hundred ms. UPnP renderers may probe with a short GET
      // before the real one, so the token stays valid and the transport-state poll alone decides when playback ended.
      if (session.stream !== stream || session.type !== 'cast') return;
      this.handleDrop(session, new Error('Receiver closed the stream'));
    });
    stream.on('feedback', sample => {
      if (session.stream === stream) this.recordLiveMeasurement(session, sample);
    });
    stream.on('connected', () => {
      if (session.stream !== stream || session.type !== 'cast') return;
      session.latencyMs = null;
      session.latencySamples = [];
      session.castMeasuredAt = -Infinity;
      session.castOverLimit = 0;
      this.applyDelays();
    });
    stream.on('feedback-ended', () => {
      if (session.stream !== stream || !session.liveMeasurement) return;
      session.liveMeasurement = null;
      this.applyDelays();
    });
    return stream;
  }

  async startUpnp(session, device, generation) {
    const hostAddress = await this.routeAddress(device.address);
    if (!this.isCurrent(session, generation)) return;
    let mime = UPNP_MIME_TYPES[0];
    const connection = this.upnp.service(device, 'ConnectionManager');
    const info = connection ? await this.upnp.soap(connection, 'GetProtocolInfo').catch(() => null) : null;
    if (!this.isCurrent(session, generation)) return;
    // Renderers that publish no sink list are tried with FLAC like those without ConnectionManager.
    const sink = info?.Sink || '';
    if (sink) {
      mime = UPNP_MIME_TYPES.find(candidate => this.supportsProtocol(sink, `http-get:*:${candidate}:*`));
      if (!mime) { this.fail(session, 'format'); return; }
    }
    this.openStream(session, mime, hostAddress);
    const url = session.url;
    const metadata = this.upnp.didl([this.upnp.didlItem({ id: 'effetune-network-output', title: 'EffeTune', uri: url,
      protocolInfo: `http-get:*:${mime}:${DLNA_FEATURES}`, streamKind: LIVE_KIND })]);
    const transport = this.upnp.service(device, 'AVTransport');
    await this.upnp.soap(transport, 'SetAVTransportURI', { InstanceID: 0, CurrentURI: url, CurrentURIMetaData: metadata });
    if (!this.isCurrent(session, generation)) return;
    await this.upnp.soap(transport, 'Play', { InstanceID: 0, Speed: '1' });
    if (!this.isCurrent(session, generation)) return;
    session.pollTimer = this.setIntervalFn(() => { void this.pollUpnp(session); }, POLL_MS);
    session.pollTimer.unref?.();
  }

  async pollUpnp(session) {
    if (session.polling) return;
    const generation = session.generation;
    const transport = this.upnp.service(this.discovery.devices.get(session.id), 'AVTransport');
    if (!transport) return;
    session.polling = true;
    try {
      const [info, position, media] = await Promise.all([
        this.upnp.soap(transport, 'GetTransportInfo', { InstanceID: 0 }),
        this.upnp.soap(transport, 'GetPositionInfo', { InstanceID: 0 }).catch(() => ({})),
        this.upnp.soap(transport, 'GetMediaInfo', { InstanceID: 0 }).catch(() => ({}))
      ]);
      if (!this.isCurrent(session, generation)) return;
      const uri = position.TrackURI || media.CurrentURI || '';
      const state = info.CurrentTransportState;
      if (state === 'STOPPED' || state === 'NO_MEDIA_PRESENT') {
        // Only a different, non-empty URI means another controller took the renderer; any other stop resumes.
        if (uri && uri !== session.url) this.fail(session, 'taken');
        else this.handleDrop(session, new Error(`UPnP playback ended (${state})`));
      } else if (state === 'PLAYING') {
        if (uri && uri !== session.url) this.fail(session, 'taken');
        else { session.failures = 0; this.setState(session, 'playing'); }
      }
    } catch (error) {
      // A single lost SOAP reply is tolerated; repeated failures without observed playback take the target offline.
      if (this.isCurrent(session, generation)) {
        session.failures += 1;
        if (session.failures >= MAX_DROPS) { session.failures = 0; this.fail(session, 'offline', 'network-output-upnp-failed', error); }
      }
    } finally {
      session.polling = false;
    }
  }

  async startCast(session, device, generation) {
    const cast = this.createCastSession({ host: device.address, port: device.port, onDiagnostic: this.onDiagnostic });
    session.cast = cast;
    cast.on('receiver', ({ appId, sessionId } = {}) => {
      if (!this.isCurrent(session, generation)) return;
      if (!session.castApp) {
        if (appId === CAST_APP_ID) {
          session.launchedApp = { appId, sessionId };
          if (session.launched) session.castApp = session.launchedApp;
        }
        return;
      }
      // No application at all means our receiver app ended; another application means the device was taken.
      if (!appId) this.handleDrop(session, new Error('Cast receiver application ended'));
      else if (appId !== session.castApp.appId || sessionId !== session.castApp.sessionId) this.fail(session, 'taken');
    });
    cast.on('media', ({ playerState, idleReason = null, mediaSessionId = null, contentId = null } = {}) => {
      if (!this.isCurrent(session, generation)) return;
      // The receiver reports every media session it has handled; only the one created for this stream matters.
      if (session.mediaSessionId === null) { if (contentId !== session.url) return; session.mediaSessionId = mediaSessionId; }
      else if (mediaSessionId !== session.mediaSessionId) return;
      if (session.castPlayerState !== playerState) {
        session.castPlayerState = playerState;
        session.castMediaRevision += 1;
      }
      // PLAYING does not prove the position advances, so it does not clear the drop count; only an accepted latency
      // window does (recordLatency). A receiver that cycles BUFFERING then ERROR, or stalls while PLAYING, reaches MAX_DROPS.
      if (playerState === 'PLAYING') { this.clearStartTimer(session); this.setState(session, 'playing'); }
      // A freshly loaded item is IDLE without a reason; FINISHED, ERROR, INTERRUPTED or CANCELLED means it ended.
      else if (playerState === 'IDLE' && idleReason) this.handleDrop(session, new Error(`Cast playback ended (${idleReason})`));
    });
    cast.on('close', () => { if (this.isCurrent(session, generation)) this.handleDrop(session, new Error('Cast session closed')); });
    cast.on('error', error => { if (this.isCurrent(session, generation)) this.handleDrop(session, error); });
    const hostAddress = await this.routeAddress(device.address);
    if (!this.isCurrent(session, generation)) return;
    await cast.connect();
    if (!this.isCurrent(session, generation)) return;
    // Chromecast receivers stall on a variable-rate FLAC stream of quiet audio, so they get constant-rate LPCM instead.
    this.openStream(session, CAST_MIME_TYPE, hostAddress);
    const result = await cast.launchAndLoad({ url: session.url, contentType: CAST_MIME_TYPE });
    if (!this.isCurrent(session, generation)) return;
    session.launched = true;
    session.castApp = result?.sessionId ? { appId: result.appId ?? CAST_APP_ID, sessionId: result.sessionId } : session.launchedApp;
    session.pollTimer = this.setIntervalFn(() => { void this.pollCast(session); }, CAST_POLL_MS);
    session.pollTimer.unref?.();
    if (session.state === 'playing') return;
    // Playback must be observed within the start window; otherwise the attempt counts as a drop.
    session.startTimer = this.setTimeoutFn(() => {
      session.startTimer = null;
      if (this.isCurrent(session, generation)) this.handleDrop(session, new Error('Cast playback did not start'));
    }, CAST_START_TIMEOUT_MS);
    session.startTimer.unref?.();
  }

  // A session that ends or loses its stream restarts; repeated drops without observed playback make the target
  // unreachable (without a cause, since the device still answers) so a receiver that keeps rejecting the stream backs off instead of being reloaded in a tight loop.
  handleDrop(session, error) {
    session.failures += 1;
    this.onDiagnostic(`network-output-${session.type}-failed`, error);
    if (session.failures >= MAX_DROPS) { session.failures = 0; this.fail(session); }
    else this.restart(session);
  }

  // A Cast receiver reports its playback position; how far that trails the stream position written by the time the
  // reply arrives is the receiver's latency, which the delay lines then cancel. The reported position is a snapshot
  // the receiver refreshes in steps (every 100 ms on some devices) and the reply takes time to arrive, so a reading
  // is never early, only late by a varying amount.
  async pollCast(session) {
    if (session.polling || session.mediaSessionId === null) return;
    const generation = session.generation;
    const stream = session.stream;
    const connection = stream?.connection;
    const mediaRevision = session.castMediaRevision;
    const startedAt = this.clockNow();
    session.polling = true;
    try {
      const status = await session.cast.mediaStatus(session.mediaSessionId);
      if (!this.isCurrent(session, generation) || session.stream !== stream || stream?.connection !== connection ||
          session.castMediaRevision !== mediaRevision || this.clockNow() - startedAt > CAST_POLL_MS ||
          status?.playerState !== 'PLAYING' || !Number.isFinite(status.currentTime)) return;
      const frames = stream?.framesAt(this.clockNow());
      if (frames === null || frames === undefined) return;
      this.recordLatency(session, frames * 1000 / SAMPLE_RATE - status.currentTime * 1000);
    } catch (error) {
      if (this.isCurrent(session, generation)) this.onDiagnostic('network-output-cast-failed', error);
    } finally {
      if (this.isCurrent(session, generation)) session.polling = false;
    }
  }

  recordLatency(session, latencyMs) {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    // One position outlier is not evidence that the receiver has stalled; two seconds of them are.
    if (latencyMs > L0_MAX_MS) {
      session.castOverLimit = (session.castOverLimit || 0) + 1;
      if (session.castOverLimit >= CAST_STALL_SAMPLES) this.handleDrop(session, new Error(`Cast playback is ${Math.round(latencyMs)} ms behind`));
      return;
    }
    session.castOverLimit = 0;
    // Readings only err late (see pollCast), and the first ones after playback starts run a few hundred ms high
    // while the receiver still fills its buffer, so the smallest of the latest window, taken just after the receiver
    // refreshed its position, is what gets applied.
    const samples = session.latencySamples;
    samples.push(latencyMs);
    if (samples.length > LATENCY_SAMPLES) samples.shift();
    if (samples.length < LATENCY_SAMPLES) return;
    const floorMs = Math.min(...samples);
    if (Math.max(...samples) - floorMs > 1000) return;
    // A full window of advancing positions is the observed playback that clears earlier drops.
    session.failures = 0;
    const wasFresh = this.clockNow() - session.castMeasuredAt <= FEEDBACK_FRESHNESS_MS;
    session.castMeasuredAt = this.clockNow();
    this.scheduleMeasurementExpiry(session);
    if (wasFresh && session.latencyMs !== null && Math.abs(floorMs - session.latencyMs) < LATENCY_TOLERANCE_MS) return;
    session.latencyMs = floorMs;
    this.applyDelays();
  }

  recordLiveMeasurement(session, sample) {
    if (sample.routeRevision !== this.liveRoute?.revision || !Number.isFinite(sample.ingressMs) ||
        !Number.isFinite(sample.transportMs) || sample.uncertaintyMs > MAX_TIMING_UNCERTAINTY_MS ||
        sample.ingressMs < -sample.uncertaintyMs || sample.transportMs < -sample.uncertaintyMs ||
        sample.ingressMs + sample.transportMs > FEEDBACK_FRESHNESS_MS * 3) return;
    const suffix = [sample.dspMs, sample.softwareOutputMs, sample.physicalOutputMs];
    if (!suffix.every(validDelay)) {
      if (session.liveMeasurement) {
        session.liveMeasurement = null;
        this.applyDelays();
      }
      return;
    }
    const latencyMs = Math.round(Math.max(0, sample.ingressMs + sample.transportMs) + suffix.reduce((sum, value) => sum + value, 0));
    const previous = session.liveMeasurement;
    const stable = previous && previous.connectionId === sample.connectionId && previous.routeRevision === sample.routeRevision &&
      previous.revision === sample.revision && Math.abs(latencyMs - previous.latencyMs) < LIVE_LATENCY_TOLERANCE_MS;
    session.liveMeasurement = { connectionId: sample.connectionId, routeRevision: sample.routeRevision, revision: sample.revision,
      receivedAt: sample.receivedAt, latencyMs: stable ? previous.latencyMs : latencyMs };
    this.scheduleMeasurementExpiry(session);
    this.applyDelays();
  }

  scheduleMeasurementExpiry(session) {
    if (session.measurementTimer) this.clearTimeoutFn(session.measurementTimer);
    session.measurementTimer = this.setTimeoutFn(() => {
      session.measurementTimer = null;
      if (this.clockNow() - session.castMeasuredAt > FEEDBACK_FRESHNESS_MS) {
        session.latencyMs = null;
        session.latencySamples = [];
        session.castOverLimit = 0;
      }
      this.applyDelays();
    }, FEEDBACK_FRESHNESS_MS + 1);
    session.measurementTimer.unref?.();
  }

  // ---- PCM clock ----------------------------------------------------------

  handlePortMessage(message, port = this.rendererPort) {
    if (message?.type !== 'pcm' || message.sampleRate !== SAMPLE_RATE || message.channelCount !== CHANNELS ||
        !(message.data instanceof ArrayBuffer) || message.data.byteLength % (CHANNELS * 2) !== 0 ||
        message.data.byteLength === 0 || message.data.byteLength > 8192 * CHANNELS * 2) return;
    let samples = new Int16Array(message.data);
    let timing = this.packetSourceTiming(message);
    const { sourceEpoch, sourceFrame } = message;
    if (sourceEpoch !== undefined || sourceFrame !== undefined) {
      if (!Number.isSafeInteger(sourceEpoch) || sourceEpoch < 0 || !Number.isSafeInteger(sourceFrame) || sourceFrame < 0 ||
          !Number.isSafeInteger(sourceFrame + samples.length / CHANNELS)) return;
      if (port && port === this.rendererPort) {
        try { port.postMessage?.({ type: 'pcm-ack', sourceEpoch, sourceFrame }); }
        catch (error) { this.onDiagnostic('network-output-port-ack-failed', error); }
      }
      if (this.sourceEpoch !== null && sourceEpoch < this.sourceEpoch) return;
      if (this.sourceEpoch !== sourceEpoch) {
        if (this.hasSourceAudio && !this.silenceActive) {
          this.epochFadeFrom = this.lastSourceSample.slice();
          this.epochFadeRemaining = 128;
          this.resumeFadeRemaining = 0;
        }
        this.sourceEpoch = sourceEpoch;
        this.sourceNextFrame = sourceFrame;
        this.lateRun = null;
      }
      const end = sourceFrame + samples.length / CHANNELS;
      if (end <= this.sourceNextFrame) {
        const now = this.clockNow();
        if (!this.lateRun || sourceFrame !== this.lateRun.end) this.lateRun = { startedAt: now, start: sourceFrame, end };
        else this.lateRun.end = end;
        const elapsed = now - this.lateRun.startedAt;
        const audioMs = (end - this.lateRun.start) * 1000 / SAMPLE_RATE;
        if (elapsed < 250 || audioMs < elapsed * 0.7 || audioMs > elapsed * 1.5 + 50) return;
        // A frozen audio context can resume in the same epoch. Rebase only after paced input confirms it is live.
        this.sourceNextFrame = sourceFrame;
      }
      this.lateRun = null;
      const skip = Math.max(0, this.sourceNextFrame - sourceFrame);
      if (skip) {
        samples = samples.subarray(skip * CHANNELS);
        if (timing) timing = { ...timing, firstFrameTimeMs: timing.firstFrameTimeMs + skip * timing.frameDurationMs };
      }
      const gap = sourceFrame + skip - this.sourceNextFrame;
      if (gap > 0 && gap <= MAX_SILENCE_FRAMES) this.feedConcealment(gap);
      this.sourceNextFrame = end;
    }
    this.stopSilenceFill();
    if (this.epochFadeRemaining) {
      samples = samples.slice();
      const fadeFrames = Math.min(this.epochFadeRemaining, samples.length / CHANNELS);
      for (let frame = 0; frame < fadeFrames; frame++) {
        const gain = (129 - this.epochFadeRemaining--) / 128;
        samples[frame * CHANNELS] = Math.round(this.epochFadeFrom[0] * (1 - gain) + samples[frame * CHANNELS] * gain);
        samples[frame * CHANNELS + 1] = Math.round(this.epochFadeFrom[1] * (1 - gain) + samples[frame * CHANNELS + 1] * gain);
      }
      timing = null;
    }
    if (this.silenceActive) {
      this.resumeFadeRemaining = 128;
      this.silenceActive = false;
    }
    if (this.resumeFadeRemaining) {
      samples = samples.slice();
      const fadeFrames = Math.min(this.resumeFadeRemaining, samples.length / CHANNELS);
      for (let frame = 0; frame < fadeFrames; frame++) {
        const gain = (129 - this.resumeFadeRemaining--) / 128;
        samples[frame * CHANNELS] = Math.round(samples[frame * CHANNELS] * gain);
        samples[frame * CHANNELS + 1] = Math.round(samples[frame * CHANNELS + 1] * gain);
      }
    }
    this.lastSourceSample = [samples[samples.length - 2], samples[samples.length - 1]];
    this.hasSourceAudio = true;
    this.feed(samples, timing);
    this.armSilenceWatch();
  }

  packetSourceTiming(message) {
    const route = this.liveRoute;
    const { contextFrame, contextFrameStep, contextSampleRate, routeRevision, routeRevisionEnd } = message;
    if (!route || route.revision !== routeRevision || (routeRevisionEnd !== undefined && routeRevisionEnd !== routeRevision) ||
        !Number.isFinite(contextFrame) || contextFrame < 0 || !Number.isFinite(contextSampleRate) ||
        contextSampleRate < 8000 || contextSampleRate > 384000 ||
        !Number.isFinite(contextFrameStep) || Math.abs(contextFrameStep - contextSampleRate / SAMPLE_RATE) > 0.01) return null;
    const firstFrameTimeMs = route.frameTimeMs + (contextFrame - route.contextFrame) * 1000 / contextSampleRate;
    const now = this.clockNow();
    if (Math.abs(now - route.frameTimeMs) > FEEDBACK_FRESHNESS_MS || firstFrameTimeMs > now + route.clockUncertaintyMs ||
        now - firstFrameTimeMs > FEEDBACK_FRESHNESS_MS) return null;
    return { firstFrameTimeMs, frameDurationMs: contextFrameStep * 1000 / contextSampleRate,
      revision: routeRevision, uncertaintyMs: route.clockUncertaintyMs };
  }

  feed(samples, sourceTiming = null) {
    const start = this.feedFrame;
    const frames = samples.length / CHANNELS;
    this.feedFrame += frames;
    if (sourceTiming) this.packetTiming.push({ ...sourceTiming, start, end: this.feedFrame });
    while (this.packetTiming[0]?.end < start - MAX_FRAME_HISTORY) this.packetTiming.shift();
    let delaySettled = false;
    for (const session of this.sessions.values()) {
      if (!session.stream) continue;
      const { delay } = session;
      const unstable = delay.nextFrames === null ? Math.min(frames, delay.remaining) : frames;
      const data = delay.process(samples);
      const timing = session.stream.connection?.pcm ? this.delayedPacketTiming(start, frames, delay.frames, unstable) : [];
      session.stream.write(data, timing);
      if (unstable > 0 && !delay.remaining && delay.nextFrames === null) delaySettled = true;
    }
    if (delaySettled) this.publishStatus();
  }

  delayedPacketTiming(start, frames, delayFrames, unstable) {
    const sourceStart = start - delayFrames;
    const timing = [];
    for (let index = this.packetTiming.length - 1; index >= 0; index--) {
      const packet = this.packetTiming[index];
      if (packet.end <= sourceStart + unstable) break;
      const first = Math.max(packet.start, sourceStart + unstable);
      const end = Math.min(packet.end, sourceStart + frames);
      if (end <= first) continue;
      timing.push({ offset: first - sourceStart, frames: end - first,
        firstFrameTimeMs: packet.firstFrameTimeMs + (first - packet.start) * packet.frameDurationMs,
        frameDurationMs: packet.frameDurationMs, revision: packet.revision, delayFrames, uncertaintyMs: packet.uncertaintyMs });
    }
    return timing;
  }

  armSilenceWatch() {
    if (this.silenceWatch) { this.clearTimeoutFn(this.silenceWatch); this.silenceWatch = null; }
    if (!this.sessions.size || !this.serverOpen || this.disposed) { this.stopSilenceFill(); return; }
    if (this.silenceTimer) return;
    this.silenceWatch = this.setTimeoutFn(() => { this.silenceWatch = null; this.startSilenceFill(); }, SILENCE_AFTER_MS);
    this.silenceWatch.unref?.();
  }

  startSilenceFill() {
    if (this.silenceTimer || !this.sessions.size || !this.serverOpen || this.disposed) return;
    this.silenceAnchor = this.clockNow();
    this.silenceFrames = 0;
    this.silenceTimer = this.setIntervalFn(() => this.fillSilence(), SILENCE_TICK_MS);
    this.silenceTimer.unref?.();
  }

  fillSilence() {
    const due = Math.floor((this.clockNow() - this.silenceAnchor) * SAMPLE_RATE / 1000) - this.silenceFrames;
    if (due <= 0) return;
    // Account for the whole gap but never emit more than one second at once (e.g. after sleep).
    this.silenceFrames += due;
    const frames = due > MAX_SILENCE_FRAMES ? MAX_SILENCE_FRAMES : due;
    this.feedConcealment(frames);
    if (this.sourceEpoch !== null) this.sourceNextFrame += frames;
  }

  feedConcealment(frames) {
    this.resumeFadeRemaining = 0;
    this.epochFadeRemaining = 0;
    const samples = new Int16Array(frames * CHANNELS);
    if (!this.silenceActive) {
      for (let frame = 0; frame < Math.min(128, frames); frame++) {
        const gain = 1 - (frame + 1) / 128;
        samples[frame * CHANNELS] = Math.round(this.lastSourceSample[0] * gain);
        samples[frame * CHANNELS + 1] = Math.round(this.lastSourceSample[1] * gain);
      }
    }
    this.silenceActive = true;
    this.feed(samples);
  }

  stopSilenceFill() {
    if (!this.silenceTimer) return;
    this.clearIntervalFn(this.silenceTimer);
    this.silenceTimer = null;
  }
}

module.exports = { NetworkOutputHost, DelayLine, normalizeConfiguration, sanitizeConfiguration, DEFAULT_CONFIGURATION, L0_MS, L0_MAX_MS, MAX_TRIM_MS, LATENCY_TOLERANCE_MS, LATENCY_SAMPLES, CAST_POLL_MS, SAMPLE_RATE };
