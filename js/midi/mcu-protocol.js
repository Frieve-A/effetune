import { normalizeDSPAutomationValue } from '../audio/dsp-params.generated.js';
import { getMappedNormalizedRange } from './param-adapter.js';

function clamp(value, low = 0, high = 1) {
  return value < low ? low : value > high ? high : value;
}

function vpotDelta(raw) {
  if (raw >= 1 && raw <= 7) return raw;
  if (raw >= 65 && raw <= 71) return -(raw - 64);
  return 0;
}

export class McuProtocol {
  constructor({
    engine,
    adapter,
    store,
    getOutput = () => null,
    windowRef = globalThis.window,
    now = () => Date.now(),
    setIntervalFn = (...args) => globalThis.setInterval(...args),
    clearIntervalFn = (...args) => globalThis.clearInterval(...args)
  } = {}) {
    this.engine = engine;
    this.adapter = adapter;
    this.store = store;
    this.getOutput = getOutput;
    this.window = windowRef;
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.touchedFaders = new Map();
    this.echoGuards = new Map();
    this.feedbackValues = new Map();
    this.poller = null;
  }

  decode(data) {
    if (!data || data.length < 2) return null;
    const status = data[0];
    const type = status & 0xf0;
    const channel = status & 0x0f;
    if (type === 0xe0 && channel <= 8 && data.length >= 3) {
      return { kind: 'mcuFader', channel, value: (data[2] << 7) | data[1] };
    }
    if (type === 0xb0 && data.length >= 3 && data[1] >= 16 && data[1] <= 23) {
      const delta = vpotDelta(data[2]);
      return delta ? { kind: 'mcuVpot', channel, number: data[1] - 16, delta } : null;
    }
    if ((type === 0x90 || type === 0x80) && data.length >= 3) {
      const note = data[1];
      const pressed = type === 0x90 && data[2] > 0;
      if (note >= 104 && note <= 112) {
        return { kind: 'mcuTouch', channel: note - 104, number: note, pressed };
      }
      return { kind: 'mcuButton', channel, number: note, pressed };
    }
    return null;
  }

  setTouched(deviceName, channel, touched) {
    this.touchedFaders.set(`${deviceName}:${channel}`, Boolean(touched));
  }

  shouldIgnoreInput(deviceName, source) {
    const key = this.sourceKey(deviceName, source);
    return (this.echoGuards.get(key) || 0) > this.now();
  }

  sourceKey(deviceName, source) {
    return `${deviceName}:${source.kind}:${source.channel || 0}:${source.number || 0}`;
  }

  guardEcho(deviceName, source) {
    this.echoGuards.set(this.sourceKey(deviceName, source), this.now() + 50);
  }

  sendFader(output, deviceName, channel, normalized) {
    if (!output?.send || this.touchedFaders.get(`${deviceName}:${channel}`)) return false;
    const value = Math.round(clamp(normalized) * 16383);
    output.send([0xe0 | channel, value & 0x7f, (value >> 7) & 0x7f]);
    this.guardEcho(deviceName, { kind: 'mcuFader', channel });
    return true;
  }

  sendVpotRing(output, deviceName, index, normalized) {
    if (!output?.send || index < 0 || index > 7) return false;
    const value = Math.round(clamp(normalized) * 10) + 1;
    output.send([0xb0, 48 + index, value]);
    this.guardEcho(deviceName, { kind: 'mcuVpot', channel: 0, number: index });
    return true;
  }

  sendButtonLed(output, deviceName, note, on) {
    if (!output?.send) return false;
    output.send([0x90, note & 0x7f, on ? 127 : 0]);
    this.guardEcho(deviceName, { kind: 'mcuButton', channel: 0, number: note });
    return true;
  }

  startFeedbackPoller() {
    this.stopFeedbackPoller();
    this.feedbackValues.clear();
    const mappings = this.feedbackMappings();
    if (mappings.length === 0 || !mappings.some(mapping => this.getOutput(mapping.device))) return;
    this.poller = this.setIntervalFn(() => this.pollFeedback(), 100);
  }

  stopFeedbackPoller() {
    if (this.poller !== null) this.clearIntervalFn(this.poller);
    this.poller = null;
  }

  feedbackMappings() {
    const seen = new Set();
    return (this.store?.mappings || []).filter(mapping => {
      if (this.store.getDeviceProtocol(mapping.device) !== 'mcu') return false;
      if (!['mcuFader', 'mcuVpot', 'mcuButton'].includes(mapping.source.kind)) return false;
      const key = this.sourceKey(mapping.device, mapping.source);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  pollFeedback() {
    for (const mapping of this.feedbackMappings()) {
      const output = this.getOutput(mapping.device);
      if (!output) continue;
      const feedback = this.readFeedback(mapping);
      if (!feedback || Object.is(this.feedbackValues.get(mapping.id), feedback.value)) continue;
      let sent = false;
      if (mapping.source.kind === 'mcuFader' && feedback.kind === 'continuous') {
        sent = this.sendFader(output, mapping.device, mapping.source.channel, feedback.normalized);
      } else if (mapping.source.kind === 'mcuVpot') {
        sent = this.sendVpotRing(output, mapping.device, mapping.source.number, feedback.normalized);
      } else if (mapping.source.kind === 'mcuButton' && feedback.kind === 'bool') {
        sent = this.sendButtonLed(output, mapping.device, mapping.source.number, feedback.value);
      }
      if (sent) this.feedbackValues.set(mapping.id, feedback.value);
    }
  }

  readFeedback(mapping) {
    if (mapping.target.type === '_global') {
      const value = mapping.target.param === 'masterBypass'
        ? !this.window?.pipelineManager?.core?.enabled
        : this.window?.audioManager?.currentPipeline === 'B';
      return { kind: 'bool', value, normalized: value ? 1 : 0 };
    }
    const targets = this.engine.resolveTargets(mapping.target.type, mapping.target.instance);
    if (targets.length === 0) return null;
    if (mapping.target.param === '_enabled') {
      const value = Boolean(targets[0].enabled);
      return { kind: 'bool', value, normalized: value ? 1 : 0 };
    }
    const resolved = this.adapter.resolve(
      mapping.target.type,
      mapping.target.param,
      mapping.target.element
    );
    if (!resolved) return null;
    const value = this.adapter.read(targets[0], resolved);
    const normalizedValue = normalizeDSPAutomationValue(resolved.descriptor, value);
    const { lo, hi } = getMappedNormalizedRange(mapping, resolved.descriptor);
    const normalized = lo === hi ? 0 : clamp((normalizedValue - lo) / (hi - lo));
    return {
      kind: ['float', 'int'].includes(resolved.descriptor.kind) ? 'continuous' : resolved.descriptor.kind,
      value,
      normalized
    };
  }

  dispose() {
    this.stopFeedbackPoller();
    this.touchedFaders.clear();
    this.echoGuards.clear();
    this.feedbackValues.clear();
  }
}
