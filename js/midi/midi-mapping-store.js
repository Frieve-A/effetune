import { loadConfig, saveConfig } from '../electron/configIntegration.js';
import {
  canonicalizeAutomationAmount,
  canonicalizeTargetValue,
  defaultAutomationAmount,
  defaultMapRange,
  getTargetValueRange,
  isNumericTargetRange,
  ParamAdapter
} from './param-adapter.js';

const SOURCE_KINDS = new Set([
  'cc', 'note', 'pitchbend', 'mcuFader', 'mcuVpot', 'mcuButton',
  'key', 'gamepadButton', 'gamepadAxis', 'clock', 'timer'
]);
const MIDI_KINDS = new Set(['cc', 'note', 'pitchbend', 'mcuFader', 'mcuVpot', 'mcuButton']);
const VIRTUAL_SOURCE_KINDS = new Set(['clock', 'timer']);
const DISCRETE_ACTION_SOURCE_KINDS = new Set(['note', 'mcuButton', 'key', 'gamepadButton', 'timer']);
const INSTANCE_RULES = new Set(['first', 'last', 'all']);
const CC_MODES = new Set(['abs', 'rel2c', 'relBin', 'relSign']);
const AXIS_MODES = new Set(['rel', 'abs']);
const SENSITIVITIES = new Set([0.25, 0.5, 1, 2, 4]);
const GLOBAL_PARAMS = new Set(['masterBypass', 'abToggle']);
const CLOCK_COMPONENTS = new Set(['hour', 'minute', 'second']);
const CLOCK_SHAPES = new Set(['ramp', 'sin', 'cos']);
const AUTOMATION_BEHAVIORS = new Set(['direct', 'random', 'randomWalk']);
const TIMER_SCHEDULES = new Set(['interval', 'once', 'daily']);

export const MAX_TIMER_DELAY_MS = 2_147_483_647;

function isValidTimePart(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function isValidLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function normalizeTimerSource(source) {
  const schedule = TIMER_SCHEDULES.has(source.schedule) ? source.schedule : 'interval';
  if (schedule === 'interval') {
    return {
      kind: 'timer',
      schedule,
      intervalMs: Number.isSafeInteger(source.intervalMs) && source.intervalMs >= 1000 &&
          source.intervalMs <= MAX_TIMER_DELAY_MS
        ? source.intervalMs
        : 1000
    };
  }
  if (!isValidTimePart(source.hour, 23) || !isValidTimePart(source.minute, 59) ||
      !isValidTimePart(source.second, 59)) return null;
  if (schedule === 'once' && !isValidLocalDate(source.date)) return null;
  return schedule === 'once'
    ? { kind: 'timer', schedule, date: source.date, hour: source.hour, minute: source.minute, second: source.second }
    : { kind: 'timer', schedule, hour: source.hour, minute: source.minute, second: source.second };
}

export function createMappingId(cryptoRef = globalThis.crypto) {
  if (typeof cryptoRef?.randomUUID === 'function') return `m-${cryptoRef.randomUUID()}`;
  if (typeof cryptoRef?.getRandomValues !== 'function') {
    throw new Error('Secure randomness is required to create a controller mapping.');
  }
  const bytes = cryptoRef.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `m-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cloneControllerConfig(value) {
  return {
    version: 1,
    devices: (value?.devices || []).map(device => ({ ...device })),
    mappings: (value?.mappings || []).map(mapping => ({
      ...mapping,
      source: { ...mapping.source },
      target: { ...mapping.target },
      map: { ...mapping.map }
    }))
  };
}

export class MidiMappingStore {
  constructor({
    pluginManager = globalThis.window?.pluginManager,
    adapter = new ParamAdapter(),
    isElectron = Boolean(globalThis.window?.electronIntegration?.isElectron),
    loadConfigFn = loadConfig,
    saveConfigFn = saveConfig,
    onPersistenceFailure = () => {}
  } = {}) {
    this.pluginManager = pluginManager;
    this.adapter = adapter;
    this.isElectron = isElectron;
    this.loadConfigFn = loadConfigFn;
    this.saveConfigFn = saveConfigFn;
    this.onPersistenceFailure = onPersistenceFailure;
    this.config = { version: 1, devices: [], mappings: [] };
    this.listeners = new Set();
  }

  async initialize(initialConfig) {
    const appConfig = initialConfig || await this.loadConfigFn(this.isElectron);
    this.config = this.validate(appConfig?.midiController);
    return this.snapshot();
  }

  snapshot() {
    return cloneControllerConfig(this.config);
  }

  get mappings() {
    return this.config.mappings;
  }

  get devices() {
    return this.config.devices;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async persist() {
    const snapshot = this.snapshot();
    const saved = await this.saveConfigFn(this.isElectron, { midiController: snapshot });
    // Runtime consumers operate on this store's in-memory state. A failed
    // persistence attempt must not leave an already-visible mapping inert for
    // the remainder of the session.
    this.listeners.forEach(listener => listener(snapshot));
    if (!saved) this.onPersistenceFailure();
    return saved;
  }

  async addMapping(mapping) {
    const normalized = this.validateMapping({ ...mapping, id: mapping.id || createMappingId() });
    if (!normalized) return null;
    this.config.mappings.push(normalized);
    await this.persist();
    return { ...normalized };
  }

  async updateMapping(id, patch) {
    const index = this.config.mappings.findIndex(mapping => mapping.id === id);
    if (index < 0) return false;
    const current = this.config.mappings[index];
    const normalized = this.validateMapping({
      ...current,
      ...patch,
      source: { ...current.source, ...(patch.source || {}) },
      target: { ...current.target, ...(patch.target || {}) },
      map: { ...current.map, ...(patch.map || {}) },
      id
    });
    if (!normalized) return false;
    this.config.mappings[index] = normalized;
    return this.persist();
  }

  async removeMapping(id) {
    const next = this.config.mappings.filter(mapping => mapping.id !== id);
    if (next.length === this.config.mappings.length) return false;
    this.config.mappings = next;
    return this.persist();
  }

  async setDeviceProtocol(key, protocol) {
    if (typeof key !== 'string' || !key || !['generic', 'mcu'].includes(protocol)) return false;
    const existing = this.config.devices.find(device => device.key === key);
    if (existing) existing.protocol = protocol;
    else this.config.devices.push({ key, protocol });
    return this.persist();
  }

  getDeviceProtocol(key) {
    return this.config.devices.find(device => device.key === key)?.protocol || 'generic';
  }

  validate(value) {
    if (!value || value.version !== 1) return { version: 1, devices: [], mappings: [] };
    const devices = Array.isArray(value.devices) ? value.devices
      .filter(device => device && typeof device.key === 'string' && device.key)
      .map(device => ({
        key: device.key,
        protocol: device.protocol === 'mcu' ? 'mcu' : 'generic'
      })) : [];
    const mappings = Array.isArray(value.mappings)
      ? value.mappings.map(mapping => this.validateMapping(mapping)).filter(Boolean)
      : [];
    const discarded = Array.isArray(value.mappings) ? value.mappings.length - mappings.length : 0;
    if (discarded > 0) console.warn(`Ignored ${discarded} invalid controller mapping(s).`);
    return { version: 1, devices, mappings };
  }

  validateMapping(mapping) {
    if (!mapping || typeof mapping !== 'object') return null;
    const source = mapping.source;
    const target = mapping.target;
    if (!source || !target || !SOURCE_KINDS.has(source.kind)) return null;
    const device = source.kind === 'key' || VIRTUAL_SOURCE_KINDS.has(source.kind) ? '' : mapping.device;
    if (typeof device !== 'string') return null;
    if (MIDI_KINDS.has(source.kind) && !device) return null;
    if (source.kind === 'key' && (typeof source.keyCombo !== 'string' || !source.keyCombo)) return null;
    if (MIDI_KINDS.has(source.kind)) {
      const maxChannel = source.kind === 'mcuFader' ? 8 : 15;
      if (!Number.isSafeInteger(source.channel) || source.channel < 0 || source.channel > maxChannel) return null;
    }
    if (['cc', 'note', 'mcuVpot', 'mcuButton', 'gamepadButton', 'gamepadAxis'].includes(source.kind) &&
        (!Number.isSafeInteger(source.number) || source.number < 0)) return null;

    const type = target.type;
    const param = target.param;
    const element = Number.isSafeInteger(target.element) && target.element >= 0 ? target.element : 0;
    if (typeof type !== 'string' || typeof param !== 'string') return null;
    if (type === '_global') {
      if (!GLOBAL_PARAMS.has(param)) return null;
    } else if (param === '_enabled') {
      if (!this.hasPluginType(type)) return null;
    } else if (!this.adapter.isAssignable(type, param, element)) {
      return null;
    }

    const instance = INSTANCE_RULES.has(target.instance) ? target.instance : 'first';
    let mode = source.mode;
    if (source.kind === 'cc' && !CC_MODES.has(mode)) mode = 'abs';
    if (source.kind === 'gamepadAxis' && !AXIS_MODES.has(mode)) mode = 'rel';
    const map = mapping.map || {};
    const range = getTargetValueRange({ type, param, element }, this.adapter);
    if (!range) return null;
    const defaults = defaultMapRange({ type, param, element }, this.adapter);
    const lo = range.kind === 'enum'
      ? (range.values.includes(map.lo) ? map.lo : defaults.lo)
      : canonicalizeTargetValue(range, map.lo, defaults.lo);
    const hi = range.kind === 'enum'
      ? (range.values.includes(map.hi) ? map.hi : defaults.hi)
      : canonicalizeTargetValue(range, map.hi, defaults.hi);
    const behavior = AUTOMATION_BEHAVIORS.has(map.behavior) ? map.behavior : 'direct';
    const amount = canonicalizeAutomationAmount(range, map.amount, defaultAutomationAmount(range));
    const numericTarget = isNumericTargetRange(range);
    if (source.kind === 'clock' && (!numericTarget || behavior !== 'direct')) return null;
    if (source.kind === 'timer' && !numericTarget) return null;
    if (behavior !== 'direct' && (!numericTarget || !DISCRETE_ACTION_SOURCE_KINDS.has(source.kind))) {
      return null;
    }
    const timerSource = source.kind === 'timer' ? normalizeTimerSource(source) : null;
    if (source.kind === 'timer' && !timerSource) return null;
    const normalizedSource = VIRTUAL_SOURCE_KINDS.has(source.kind)
      ? source.kind === 'clock'
        ? {
            kind: 'clock',
            component: CLOCK_COMPONENTS.has(source.component) ? source.component : 'hour',
            shape: CLOCK_SHAPES.has(source.shape) ? source.shape : 'ramp'
          }
        : timerSource
      : {
          kind: source.kind,
          channel: Number.isSafeInteger(source.channel) ? source.channel : 0,
          number: Number.isSafeInteger(source.number) ? source.number : 0,
          keyCombo: typeof source.keyCombo === 'string' ? source.keyCombo : '',
          mode: mode || ''
        };
    return {
      id: typeof mapping.id === 'string' && mapping.id ? mapping.id : createMappingId(),
      device,
      source: normalizedSource,
      target: { type, instance, param, element },
      map: {
        lo,
        hi,
        sensitivity: SENSITIVITIES.has(map.sensitivity) ? map.sensitivity : 1,
        dir: map.dir === -1 ? -1 : 1,
        buttonMode: map.buttonMode === 'momentary' ? 'momentary' : 'toggle',
        behavior,
        amount
      }
    };
  }

  hasPluginType(type) {
    return Object.values(this.pluginManager?.pluginClasses || {}).some(pluginClass =>
      pluginClass?.name === type
    ) || globalThis.window?.[type] instanceof Function;
  }
}

export const MIDI_SOURCE_KINDS = MIDI_KINDS;
