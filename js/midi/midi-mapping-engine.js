import {
  denormalizeDSPAutomationValue,
  normalizeDSPAutomationValue
} from '../audio/dsp-params.generated.js';
import {
  canonicalizeTargetValue,
  getTargetValueRange,
  getMappedEnumRange,
  getMappedNormalizedRange,
  ParamAdapter
} from './param-adapter.js';

const ABSOLUTE_KINDS = new Set(['pitchbend', 'mcuFader']);
const BUTTON_KINDS = new Set(['note', 'mcuButton', 'key', 'gamepadButton']);
const RELATIVE_KINDS = new Set(['cc', 'mcuVpot', 'gamepadAxis']);

function clamp(value, low = 0, high = 1) {
  return value < low ? low : value > high ? high : value;
}

function sameSource(mapping, deviceName, source) {
  if (mapping.device !== deviceName || mapping.source.kind !== source.kind) return false;
  if (source.kind === 'key') return mapping.source.keyCombo === source.keyCombo;
  if (source.kind === 'gamepadAxis' && source.mode && mapping.source.mode !== source.mode) return false;
  if (['cc', 'note', 'pitchbend', 'mcuFader', 'mcuVpot', 'mcuButton'].includes(source.kind) &&
      mapping.source.channel !== source.channel) return false;
  if (['cc', 'note', 'mcuVpot', 'mcuButton', 'gamepadButton', 'gamepadAxis'].includes(source.kind) &&
      mapping.source.number !== source.number) return false;
  return true;
}

function relativeMidiDelta(mode, value) {
  const raw = Number(value) & 0x7f;
  if (mode === 'rel2c') return raw === 64 ? 0 : raw < 64 ? raw : raw - 128;
  if (mode === 'relBin') return raw - 64;
  if (mode === 'relSign') return raw === 64 ? 0 : raw >= 65 ? -(raw - 64) : raw;
  return 0;
}

function isAbsolute(mapping) {
  return ABSOLUTE_KINDS.has(mapping.source.kind) ||
    (mapping.source.kind === 'cc' && mapping.source.mode === 'abs') ||
    (mapping.source.kind === 'gamepadAxis' && mapping.source.mode === 'abs');
}

export class MidiMappingEngine {
  constructor({
    store,
    adapter = new ParamAdapter(),
    windowRef = globalThis.window,
    documentRef = globalThis.document,
    requestFrame = callback => windowRef.requestAnimationFrame(callback),
    cancelFrame = id => windowRef.cancelAnimationFrame(id),
    setTimeoutFn = (...args) => globalThis.setTimeout(...args),
    clearTimeoutFn = (...args) => globalThis.clearTimeout(...args),
    randomFn = Math.random
  } = {}) {
    this.store = store;
    this.adapter = adapter;
    this.window = windowRef;
    this.document = documentRef;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.randomFn = randomFn;
    this.pending = new Map();
    this.absoluteApplied = new Map();
    this.accumulators = new Map();
    this.absoluteThresholds = new Map();
    this.pluginIdentities = new WeakMap();
    this.nextPluginIdentity = 1;
    this.relativeThresholds = new Map();
    this.frameHandle = null;
    this.frameUsesTimeout = false;
    this.historyTimer = null;
    this.gamepadPoller = null;
    this.continuousFrame = false;
  }

  setGamepadPoller(poller) {
    this.gamepadPoller = poller;
  }

  setContinuousFrame(active) {
    this.continuousFrame = Boolean(active);
    if (active) this.scheduleFrame();
  }

  onSourceEvent(deviceName, source, value) {
    if (this.window?.uiManager?.isDoubleBlindActive?.()) return false;
    let matched = false;
    for (const mapping of this.store?.mappings || []) {
      if (!sameSource(mapping, deviceName, source)) continue;
      matched = true;
      this.queueMapping(mapping, source, value);
    }
    if (matched) this.scheduleFrame();
    return matched;
  }

  onAutomationEvent(mappingId, event = {}) {
    if (this.window?.uiManager?.isDoubleBlindActive?.()) return false;
    const mapping = this.store?.mappings.find(candidate => candidate.id === mappingId);
    if (!mapping || mapping.source.kind !== event.kind) return false;
    const state = this.pending.get(mapping.id) || this.createPendingState();
    if (event.kind === 'clock') {
      const value = Number(event.value);
      if (!Number.isFinite(value)) return false;
      state.absolute = clamp(value);
    } else if (event.kind === 'timer') {
      state.automationActions.push(event);
    } else {
      return false;
    }
    state.automation = true;
    this.pending.set(mapping.id, state);
    this.scheduleFrame();
    return true;
  }

  createPendingState() {
    return { absolute: undefined, relative: 0, edges: [], automationActions: [], physical: false, automation: false };
  }

  queueMapping(mapping, source, value) {
    const targetKind = this.getTargetKind(mapping);
    const state = this.pending.get(mapping.id) || this.createPendingState();
    state.physical = true;
    if (isAbsolute(mapping)) {
      const normalized = this.normalizeAbsolute(mapping, value);
      if (mapping.target.type === '_global') {
        const active = normalized >= 0.5;
        const previous = this.absoluteThresholds.get(mapping.id) || false;
        this.absoluteThresholds.set(mapping.id, active);
        if (active && !previous) state.edges.push({ pressed: true, delta: 1 });
      } else {
        state.absolute = normalized;
      }
    } else if (BUTTON_KINDS.has(mapping.source.kind)) {
      const pressed = typeof value === 'object' ? Boolean(value.pressed) : Boolean(value);
      const repeated = typeof value === 'object' && value.repeat === true;
      if (targetKind === 'bool') {
        if (repeated) return;
        if (mapping.map.buttonMode === 'momentary' || pressed) state.edges.push({ pressed, delta: mapping.map.dir });
      } else if (pressed) {
        if (mapping.map.behavior === 'random' || mapping.map.behavior === 'randomWalk') {
          state.automationActions.push({ kind: 'discrete' });
        } else {
          state.edges.push({ pressed: true, delta: mapping.map.dir });
        }
      }
    } else {
      const delta = this.normalizeRelativeDelta(mapping, source, value);
      if (targetKind === 'bool' || targetKind === 'enum') {
        if (mapping.source.kind === 'gamepadAxis') {
          const active = delta !== 0;
          const previous = this.relativeThresholds.get(mapping.id) || false;
          this.relativeThresholds.set(mapping.id, active);
          if (!active || previous) return;
        } else if (!delta) {
          return;
        }
        const count = Math.max(1, Math.round(Math.abs(delta)));
        for (let index = 0; index < count; index++) {
          state.edges.push({ pressed: true, delta: Math.sign(delta) });
        }
      } else {
        if (!delta) return;
        state.relative += delta;
      }
    }
    this.pending.set(mapping.id, state);
  }

  getTargetKind(mapping) {
    if (mapping.target.type === '_global' || mapping.target.param === '_enabled') return 'bool';
    return this.adapter.resolve(
      mapping.target.type,
      mapping.target.param,
      mapping.target.element
    )?.descriptor.kind || 'float';
  }

  normalizeAbsolute(mapping, value) {
    const raw = typeof value === 'object' ? value.value : value;
    let normalized;
    if (mapping.source.kind === 'pitchbend' || mapping.source.kind === 'mcuFader') {
      normalized = Number(raw) / 16383;
    } else if (mapping.source.kind === 'gamepadAxis') {
      normalized = (Number(raw) + 1) / 2;
    } else {
      normalized = Number(raw) / 127;
    }
    return clamp(normalized);
  }

  normalizeRelativeDelta(mapping, source, value) {
    let ticks;
    if (mapping.source.kind === 'cc') ticks = relativeMidiDelta(mapping.source.mode, value);
    else if (mapping.source.kind === 'mcuVpot') ticks = Number(source.delta ?? value);
    else ticks = Number(source.delta ?? value);
    return Number.isFinite(ticks) ? ticks : 0;
  }

  scheduleFrame() {
    if (this.frameHandle !== null) return;
    if (this.document?.hidden) {
      this.frameUsesTimeout = true;
      this.frameHandle = this.setTimeoutFn(() => this.applyFrame(), 33);
    } else {
      this.frameUsesTimeout = false;
      this.frameHandle = this.requestFrame(() => this.applyFrame());
    }
  }

  applyFrame() {
    this.frameHandle = null;
    this.gamepadPoller?.pollGamepads?.();
    const entries = Array.from(this.pending.entries());
    this.pending.clear();
    let changed = false;
    let hasPhysicalEvent = false;
    const uiManager = this.window?.uiManager;
    const historyManager = this.window?.pipelineManager?.historyManager;
    const previousReflection = uiManager?.urlReflectionEnabled;
    if (uiManager) uiManager.urlReflectionEnabled = false;
    const apply = () => {
      for (const [id, pending] of entries) {
        const mapping = this.store?.mappings.find(candidate => candidate.id === id);
        if (!mapping) continue;
        hasPhysicalEvent ||= pending.physical;
        const targets = mapping.target.type === '_global'
          ? []
          : this.resolveTargets(mapping.target.type, mapping.target.instance);
        const previousAbsolute = this.absoluteApplied.get(id);
        const signature = this.absoluteApplicationSignature(mapping, targets);
        if (pending.absolute !== undefined &&
            (previousAbsolute?.value !== pending.absolute || previousAbsolute.signature !== signature)) {
          const applied = this.applyAbsolute(mapping, pending.absolute, targets);
          changed = applied || changed;
          if (applied) this.absoluteApplied.set(id, { value: pending.absolute, signature });
          else this.absoluteApplied.delete(id);
        }
        if (pending.relative) changed = this.applyRelative(mapping, pending.relative) || changed;
        for (const edge of pending.edges) {
          changed = this.applyEdge(mapping, edge) || changed;
        }
        for (const event of pending.automationActions) {
          changed = this.applyAutomationAction(mapping, event) || changed;
        }
      }
    };
    try {
      if (historyManager?.withHistorySuppressed) historyManager.withHistorySuppressed(apply);
      else apply();
    } finally {
      if (uiManager) uiManager.urlReflectionEnabled = previousReflection;
    }
    if (changed && hasPhysicalEvent) {
      if (previousReflection !== false) uiManager?.updateURL?.();
      this.scheduleHistorySave();
    }
    if (this.continuousFrame) this.scheduleFrame();
    return changed;
  }

  absoluteApplicationSignature(mapping, targets) {
    const target = mapping.target;
    const identities = targets.map(plugin => {
      if (plugin.id !== undefined && plugin.id !== null) return `id:${plugin.id}`;
      if (!this.pluginIdentities.has(plugin)) this.pluginIdentities.set(plugin, this.nextPluginIdentity++);
      return `object:${this.pluginIdentities.get(plugin)}`;
    });
    return [target.type, target.instance, target.param, target.element, mapping.map.lo, mapping.map.hi,
      identities.join(',')].join('|');
  }

  applyAbsolute(mapping, normalized, targets = this.resolveTargets(
    mapping.target.type, mapping.target.instance
  )) {
    if (mapping.target.type === '_global') return false;
    if (targets.length === 0) return false;
    if (mapping.target.param === '_enabled') {
      const on = normalized >= 0.5;
      targets.forEach(plugin => this.applyEnabled(plugin, on));
      return true;
    }
    const resolved = this.adapter.resolve(
      mapping.target.type,
      mapping.target.param,
      mapping.target.element
    );
    if (!resolved) return false;
    const { lo, hi } = getMappedNormalizedRange(mapping, resolved.descriptor);
    const mapped = lo + normalized * (hi - lo);
    const realValue = denormalizeDSPAutomationValue(resolved.descriptor, mapped);
    return this.applyParameterTargets(targets, resolved, realValue);
  }

  applyRelative(mapping, delta) {
    const targets = this.resolveTargets(mapping.target.type, mapping.target.instance);
    if (targets.length === 0 || mapping.target.param === '_enabled') return false;
    const resolved = this.adapter.resolve(
      mapping.target.type,
      mapping.target.param,
      mapping.target.element
    );
    if (!resolved) return false;
    const basePlugin = targets[0];
    const currentReal = this.adapter.read(basePlugin, resolved);
    const signature = this.relativeAccumulatorSignature(mapping, basePlugin);
    let accumulator = this.accumulators.get(mapping.id);
    if (!accumulator || accumulator.signature !== signature || !Object.is(currentReal, accumulator.lastReal)) {
      accumulator = {
        normalized: normalizeDSPAutomationValue(resolved.descriptor, currentReal),
        lastReal: currentReal,
        signature
      };
    }
    const { lo, hi } = getMappedNormalizedRange(mapping, resolved.descriptor);
    const direction = Math.sign(hi - lo) || 1;
    const lower = Math.min(lo, hi);
    const upper = Math.max(lo, hi);
    accumulator.normalized = clamp(
      accumulator.normalized + delta * (1 / 127) * mapping.map.sensitivity * direction,
      lower,
      upper
    );
    const realValue = denormalizeDSPAutomationValue(resolved.descriptor, accumulator.normalized);
    const changed = this.applyParameterTargets(targets, resolved, realValue);
    accumulator.lastReal = realValue;
    this.accumulators.set(mapping.id, accumulator);
    return changed;
  }

  applyAutomationAction(mapping, event) {
    if (event.kind !== 'timer' && event.kind !== 'discrete') return false;
    const targets = this.resolveTargets(mapping.target.type, mapping.target.instance);
    if (targets.length === 0 || mapping.target.param === '_enabled') return false;
    const resolved = this.adapter.resolve(
      mapping.target.type,
      mapping.target.param,
      mapping.target.element
    );
    if (!resolved || (resolved.descriptor.kind !== 'float' && resolved.descriptor.kind !== 'int')) {
      return false;
    }
    const range = getTargetValueRange(mapping.target, this.adapter);
    if (!range) return false;
    const minimum = Math.min(mapping.map.lo, mapping.map.hi);
    const maximum = Math.max(mapping.map.lo, mapping.map.hi);
    const behavior = mapping.map.behavior || 'direct';
    let next;
    if (behavior === 'random') {
      next = this.randomAutomationValue(range, minimum, maximum);
    } else {
      const current = this.adapter.read(targets[0], resolved);
      const delta = behavior === 'randomWalk'
        ? (this.randomFn() < 0.5 ? -mapping.map.amount : mapping.map.amount)
        : mapping.map.dir * mapping.map.amount;
      next = canonicalizeTargetValue(range, clamp(Number(current) + delta, minimum, maximum), minimum);
    }
    return this.applyParameterTargets(targets, resolved, next);
  }

  randomAutomationValue(range, minimum, maximum) {
    const candidate = Number(this.randomFn());
    const random = Number.isFinite(candidate) ? clamp(candidate) : 0;
    if (range.kind !== 'int') return minimum + random * (maximum - minimum);
    const count = Math.round((maximum - minimum) / range.step);
    return canonicalizeTargetValue(range, minimum + Math.floor(random * (count + 1)) * range.step, minimum);
  }

  relativeAccumulatorSignature(mapping, basePlugin) {
    if (!this.pluginIdentities.has(basePlugin)) {
      this.pluginIdentities.set(basePlugin, this.nextPluginIdentity++);
    }
    const target = mapping.target;
    return [
      target.type,
      target.param,
      target.element,
      target.instance,
      mapping.map.lo,
      mapping.map.hi,
      this.pluginIdentities.get(basePlugin)
    ].join('|');
  }

  applyEdge(mapping, edge) {
    if (mapping.target.type === '_global') {
      if (!edge.pressed) return false;
      return this.applyGlobal(mapping.target.param);
    }
    const targets = this.resolveTargets(mapping.target.type, mapping.target.instance);
    if (targets.length === 0) return false;
    if (mapping.target.param === '_enabled') {
      const current = Boolean(targets[0].enabled);
      const on = mapping.map.buttonMode === 'momentary' ? edge.pressed : !current;
      targets.forEach(plugin => this.applyEnabled(plugin, on));
      return true;
    }
    const resolved = this.adapter.resolve(
      mapping.target.type,
      mapping.target.param,
      mapping.target.element
    );
    if (!resolved) return false;
    if (resolved.descriptor.kind === 'bool') {
      const current = Boolean(this.adapter.read(targets[0], resolved));
      const on = mapping.map.buttonMode === 'momentary' ? edge.pressed : !current;
      return this.applyParameterTargets(targets, resolved, on);
    }
    if (resolved.descriptor.kind === 'enum') {
      const values = resolved.descriptor.values;
      const current = this.adapter.read(targets[0], resolved);
      const range = getMappedEnumRange(mapping, resolved.descriptor);
      const currentIndex = clamp(values.indexOf(current), range.minimum, range.maximum);
      const offset = currentIndex + Math.sign(edge.delta) * range.direction;
      const nextIndex = RELATIVE_KINDS.has(mapping.source.kind)
        ? clamp(offset, range.minimum, range.maximum)
        : range.minimum + ((offset - range.minimum + (range.maximum - range.minimum + 1)) %
          (range.maximum - range.minimum + 1));
      return this.applyParameterTargets(targets, resolved, values[nextIndex]);
    }
    return this.applyRelative(mapping, Math.sign(edge.delta));
  }

  applyParameterTargets(targets, resolved, realValue) {
    const core = this.window?.pipelineManager?.core;
    let changed = false;
    for (const plugin of targets) {
      if (!this.adapter.apply(plugin, resolved, realValue)) continue;
      core?.updateWorkletPlugin?.(plugin);
      plugin.syncUIControls?.();
      changed = true;
    }
    return changed;
  }

  resolveTargets(type, rule = 'first') {
    const matches = (this.window?.audioManager?.pipeline || []).filter(plugin =>
      plugin?.constructor?.name === type
    );
    if (rule === 'all') return matches;
    if (rule === 'last') return matches.length ? [matches[matches.length - 1]] : [];
    return matches.length ? [matches[0]] : [];
  }

  applyEnabled(plugin, on) {
    plugin.setEnabled?.(on);
    const item = this.document?.querySelector?.(`.pipeline-item[data-plugin-id="${plugin.id}"]`);
    item?.querySelector?.('.toggle-button')?.classList?.toggle('off', !on);
    if (plugin.constructor?.name === 'SectionPlugin') {
      const pipeline = this.window?.audioManager?.pipeline || [];
      const start = pipeline.indexOf(plugin);
      for (let index = start + 1; index < pipeline.length; index++) {
        if (pipeline[index]?.constructor?.name === 'SectionPlugin') break;
        pipeline[index]?._setSectionEnabled?.(on);
      }
    }
    this.window?.pipelineManager?.core?.updateAllPluginDisplayState?.();
  }

  applyGlobal(param) {
    if (param === 'masterBypass') {
      const toggle = this.window?.pipelineManager?.core?.masterToggle;
      if (!toggle?.click) return false;
      toggle.click();
      return true;
    }
    if (param === 'abToggle') {
      if (!this.window?.uiManager?.togglePipeline) return false;
      void this.window.uiManager.togglePipeline();
      return true;
    }
    return false;
  }

  scheduleHistorySave() {
    if (this.historyTimer !== null) this.clearTimeoutFn(this.historyTimer);
    this.historyTimer = this.setTimeoutFn(() => {
      this.historyTimer = null;
      this.window?.pipelineManager?.historyManager?.saveState?.();
    }, 1000);
  }

  dispose() {
    if (this.frameHandle !== null) {
      if (this.frameUsesTimeout) this.clearTimeoutFn(this.frameHandle);
      else this.cancelFrame(this.frameHandle);
    }
    if (this.historyTimer !== null) this.clearTimeoutFn(this.historyTimer);
    this.frameHandle = null;
    this.historyTimer = null;
    this.pending.clear();
  }
}
