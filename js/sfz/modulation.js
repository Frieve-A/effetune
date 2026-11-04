import { canonicalSfzOpcode, sfzControllerOpcode, sfzMidiKey } from './schema.js';
import { SFZ_GENERATOR_WAVES } from './generators.js';
import { SFZ_MOD_KINDS as K, SFZ_MOD_PROPERTY_IDS as P, SFZ_MOD_PROPERTIES,
  SFZ_MOD_FILTER_TYPES, SFZ_MOD_SOURCES as S, SFZ_MOD_LAYOUT as L, SFZ_MOD_STORAGE as B,
  SFZ_MOD_VIRTUAL_CONTROLLERS, SFZ_MOD_STORAGE_TYPES as Storage, SFZ_MOD_ROUTE_FLAGS as Flags,
  sfzModulationTarget } from './modulation-schema.js';

// Public SFZ Format documentation, not an existing sampler implementation:
// https://sfzformat.com/headers/curve/
// https://sfzformat.com/modulations/{curveccN,smoothccN,stepccN}/
// https://sfzformat.com/extensions/midi_ccs/
export const SFZ_MODULATION_SECTION_VERSION = L.Version;
export const SFZ_MODULATION_PROFILE = 'sfz-linear-ramp-previous-sample-v3';
export const SFZ_MODULATION_SOURCES = Object.freeze(Object.fromEntries(
  SFZ_MOD_VIRTUAL_CONTROLLERS.map(source => [source.id, source.name])));

function number(value) {
  // Empty assignments and infinities must not become valid coefficients.
  return typeof value === 'string' && !value.trim() ? NaN : Number(value);
}

function finiteFloat(value) {
  return Number.isFinite(value) && Number.isFinite(Math.fround(value));
}

function compileCurves(headers, diagnostics) {
  const curves = new Map();
  for (const header of headers) {
    if (header.name !== 'curve') continue;
    const id = number(header.opcodes.curve_index);
    if (!Number.isInteger(id) || id < 7 || id > 254) {
      diagnostics.push({ code: 'curve-index', opcode: 'curve_index' });
      continue;
    }
    if (curves.has(id)) {
      // The public contract does not define duplicate curve-header precedence.
      diagnostics.push({ code: 'duplicate-curve', curve: id });
      continue;
    }
    const points = new Map([[0, 0], [127, 1]]);
    let invalid = false;
    for (const [key, raw] of Object.entries(header.opcodes)) {
      if (key === 'curve_index') continue;
      const match = /^v([0-9]{3})$/.exec(key);
      const value = number(raw);
      if (!match || Number(match[1]) > 127 || !finiteFloat(value)) {
        diagnostics.push({ code: 'curve-point', curve: id, opcode: key });
        invalid = true;
      } else points.set(Number(match[1]), value);
    }
    if (invalid) continue;
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    const values = new Float32Array(128);
    for (let index = 1; index < sorted.length; index++) {
      const [start, from] = sorted[index - 1], [end, to] = sorted[index];
      for (let point = start; point <= end; point++) {
        // A weighted sum also avoids overflow between opposite finite endpoints.
        const fraction = (point - start) / (end - start);
        values[point] = from * (1 - fraction) + to * fraction;
      }
    }
    curves.set(id, values);
  }
  return [...curves].sort((a, b) => a[0] - b[0]).map(([id, values]) => ({ id, values }));
}

const propertySpecs = new Map(SFZ_MOD_PROPERTIES.map(spec => [`${spec.kind}:${spec.id}`, spec]));
const virtualControllers = new Set(SFZ_MOD_VIRTUAL_CONTROLLERS.map(source => source.id));

function variableOpcode(key) {
  const match = /^var([0-9]+)_(.+)$/.exec(key);
  if (!match) return null;
  const index = Number(match[1]), field = match[2];
  if (field === 'mod') return { index, modifier: 'mode' };
  const input = /^(oncc|curvecc)([0-9]{1,3})$/.exec(field);
  if (input) return { index, modifier: input[1] === 'oncc' ? 'depth' : 'curve', controller: Number(input[2]) };
  const destination = sfzModulationTarget(field);
  // Variables modulate audio destinations, never envelopes, LFOs or other variables.
  return destination && destination.source === null &&
    (destination.target.kind === K.Region || destination.target.kind >= K.Filter)
    ? { index, modifier: 'target', destination } : null;
}

function opcodeFor(rawKey) {
  let key = canonicalSfzOpcode(rawKey), controller = null, modifier = 'depth', note = null;
  const variable = variableOpcode(key);
  if (variable?.modifier === 'target') return { ...variable.destination,
    source: { kind: K.Variable, index: variable.index }, controller: null, note: null, modifier: 'depth', key };
  if (key.endsWith('_mod')) {
    const resolved = sfzModulationTarget(key.slice(0, -4));
    return resolved && resolved.source === null
      ? { ...resolved, controller: null, note: null, modifier: 'mode', key } : null;
  }
  const panCurve = /^(eg[0-9]+_pan)_curve$/.exec(key);
  if (panCurve) { key = panCurve[1]; modifier = 'curve'; }
  const cc = /^(.*?)_(oncc|curvecc|smoothcc|stepcc|icurvecc)([0-9]{1,3})$/.exec(key);
  if (cc) { key = cc[1]; controller = Number(cc[3]); modifier = cc[2] === 'oncc' ? 'depth' : cc[2].slice(0, -2); }
  else {
    const pressure = /^(.*?)_(chanaft|polyaft)$/.exec(key);
    if (pressure) { key = pressure[1]; controller = pressure[2] === 'chanaft' ? 129 : 130; }
    const velocity = /^(ampeg|fileg|pitcheg|eq[1-3])_vel2(.+)$/.exec(key);
    if (velocity) { key = `${velocity[1]}_${velocity[2]}`; note = 1; }
  }
  const resolved = sfzModulationTarget(key);
  return resolved ? { ...resolved, controller, note, modifier, key } : null;
}

const pitchFields = Object.freeze({ bend_smooth: P.BendSmooth, bend_stepup: P.BendStepUp,
  bend_stepdown: P.BendStepDown });
const scopeTunes = new Set(['global_tune', 'master_tune', 'group_tune']);
const scopeGains = /^(global|master|group)_(volume|amplitude)$/;
const lifecycleEnums = Object.freeze({ offset_mode: { samples: 0, percent: 1 },
  loop_type: { forward: 0, backward: 1, alternate: 2 },
  note_selfmask: { on: 1, off: 0 }, rt_dead: { on: 1, off: 0 },
  sustain_sw: { on: 1, off: 0 }, sostenuto_sw: { on: 1, off: 0 }, sw_vel: { current: 0, previous: 1 },
  noise_stereo: { on: 1, off: 0 }, pan_law: { no_law: 1, balance: 1, mma: 2, MMA: 2 }, phase: { normal: 0, invert: 1 } });
const oscillatorFields = Object.freeze({ oscillator: P.Enabled, oscillator_mode: P.OscillatorMode,
  oscillator_multi: P.OscillatorMulti, oscillator_phase: P.OscillatorPhase,
  oscillator_quality: P.OscillatorQuality, oscillator_table_size: P.OscillatorTableSize });
export const SFZ_PITCH_CONTROL_RANGES = Object.freeze({ note_offset: 127, octave_offset: 10,
  sw_note_offset: 127, sw_octave_offset: 10 });
export function isSfzModulationOpcode(key) {
  return variableOpcode(key) !== null || opcodeFor(key) !== null || Object.hasOwn(pitchFields, key) || Object.hasOwn(oscillatorFields, key) ||
    key === 'bend_step' || scopeTunes.has(key) || scopeGains.test(key) || /^xf_(key|vel|cc)curve$/.test(key);
}

function compileRegion(region, regionIndex, diagnostics, offsets, initialControllers) {
  const instances = [], instanceIds = new Map(), parameters = [], routes = new Map(), modes = new Map();
  const error = (code, opcode) => diagnostics.push({ code, region: regionIndex, opcode });
  function instance(kind, index = 0, parent = null) {
    if (!Number.isInteger(index) || index < 0 || index > 0xffffffff ||
        ([K.FlexEG, K.LFO].includes(kind) && index === 0) ||
        (kind === K.Variable && (index === 0 || index > 65535)) || (kind === K.LFOSubosc && (index < 2 || index > 8))) {
      throw new Error('instance-index');
    }
    if ([K.InitialController, K.ReverseController, K.ControllerCondition, K.ControllerStart, K.ControllerStop].includes(kind) && index > 127) throw new Error('instance-index');
    if (kind === K.VelocityCurvePoint && index > 127 || kind === K.Crossfade && index > 129) throw new Error('instance-index');
    if (kind === K.Equalizer && (index < 1 || index > 3)) throw new Error('instance-index');
    const parentId = parent ? instance(parent.kind, parent.index) : 0xffffffff;
    const key = `${kind}:${index}:${parentId}`;
    if (!instanceIds.has(key)) {
      if (instances.length >= 65536) throw new Error('instance-count');
      const id = instances.length;
      instanceIds.set(key, id);
      instances.push({ kind, index, parent: parentId, parameters: new Map() });
      for (const spec of SFZ_MOD_PROPERTIES) if (spec.kind === kind) instances[id].parameters.set(spec.id, spec.default);
    }
    return instanceIds.get(key);
  }
  instance(K.Region);
  instance(K.AmpEG);
  for (const [cc, value] of initialControllers) {
    instances[instance(K.InitialController, cc)].parameters.set(P.InitialValue, value);
  }
  const root = instances[0].parameters;
  const rawRegion = region.opcodes || {};
  root.set(P.NoteEnabled, Number(rawRegion.lokey) === -1 && Number(rawRegion.hikey) === -1 ? 0 : 1);
  root.set(P.SilentAction, Number(rawRegion.end) === -1 ? 1 : 0);
  if (Object.hasOwn(SFZ_GENERATOR_WAVES, region.sample)) {
    const oscillator = instances[instance(K.Oscillator)].parameters;
    oscillator.set(P.Enabled, 1);
    oscillator.set(P.SourceWave, SFZ_GENERATOR_WAVES[region.sample]);
  }
  root.set(P.NoteOffset, offsets.note_offset + 12 * offsets.octave_offset);
  root.set(P.SwitchOffset, offsets.sw_note_offset + 12 * offsets.sw_octave_offset);
  let scopeTune = 0, scopeVolume = 0, scopeAmplitude = 100;
  const crossfadeCurves = new Map();
  for (const [rawKey, raw] of Object.entries(region.opcodes || {})) {
    const canonical = canonicalSfzOpcode(rawKey);
    const variable = variableOpcode(canonical);
    if (variable && variable.modifier !== 'target') {
      try {
        const id = instance(K.Variable, variable.index);
        if (variable.modifier === 'mode') {
          if (!['add', 'mult'].includes(raw)) error('variable-mode', rawKey);
          else modes.set(`${id}:${P.VariableValue}`, raw === 'mult');
          continue;
        }
        if (!(variable.controller <= 127 || virtualControllers.has(variable.controller))) {
          error('source-unavailable', rawKey); continue;
        }
        const value = number(raw), curve = variable.modifier === 'curve';
        if (!finiteFloat(value) || value < 0 || value > (curve ? 254 : 1) || curve && !Number.isInteger(value)) {
          error('variable-input', rawKey); continue;
        }
        const sourceA = S.Controller | variable.controller, routeKey = `${id}:${P.VariableValue}:${sourceA}:0`;
        const route = routes.get(routeKey) || { instance: id, property: P.VariableValue, sourceA,
          sourceB: S.Constant, depth: 0, curveA: 0, curveB: 0, smooth: 0, step: 0, flags: 0, transform: 0 };
        route[curve ? 'curveA' : 'depth'] = value;
        routes.set(routeKey, route);
      } catch (cause) { error(cause.message, rawKey); }
      continue;
    }
    const crossfadeCurve = /^xf_(key|vel|cc)curve$/.exec(canonical);
    if (crossfadeCurve) {
      if (!['gain', 'power'].includes(raw)) error('crossfade-curve', rawKey);
      else crossfadeCurves.set(crossfadeCurve[1], raw === 'power' ? 1 : 0);
      continue;
    }
    if (canonical === 'loop_count' && number(raw) > 16777216) {
      const value = number(raw);
      if (!Number.isInteger(value) || value > 0xffffffff) error('loop-count', rawKey);
      else {
        const playback = instances[instance(K.SamplePlayback)].parameters;
        playback.set(P.LoopRepeatLimit, value); playback.set(P.LoopRepeatLimited, 1);
      }
      continue;
    }
    const scopeGain = scopeGains.exec(canonical);
    if (scopeGain) {
      const value = number(raw), amplitude = scopeGain[2] === 'amplitude';
      if (!finiteFloat(value) || value < (amplitude ? 0 : -144) || value > (amplitude ? 100 : 6)) error('scope-gain', rawKey);
      else if (amplitude) scopeAmplitude *= value * .01;
      else scopeVolume += value;
      continue;
    }
    if (Object.hasOwn(oscillatorFields, canonical)) {
      const property = oscillatorFields[canonical], spec = propertySpecs.get(`${K.Oscillator}:${property}`);
      const value = canonical === 'oscillator' ? { on: 1, off: 0 }[raw] : number(raw);
      if (!finiteFloat(value) || value < spec.min || value > spec.max || spec.integer && !Number.isInteger(value)) error('oscillator-value', rawKey);
      else instances[instance(K.Oscillator)].parameters.set(property, value);
      continue;
    }
    if (Object.hasOwn(SFZ_PITCH_CONTROL_RANGES, canonical)) {
      error('pitch-control-scope', rawKey); continue;
    }
    if (Object.hasOwn(pitchFields, canonical) || canonical === 'bend_step' || scopeTunes.has(canonical)) {
      const value = number(raw);
      const property = canonical === 'bend_step' ? P.BendStepUp : pitchFields[canonical];
      const spec = propertySpecs.get(`${K.Region}:${property}`);
      if (scopeTunes.has(canonical)) {
        if (!Number.isInteger(value) || Math.abs(value) > 9600) error('pitch-value', rawKey);
        else scopeTune += value;
      } else if (!finiteFloat(value) || value < spec.min || value > spec.max || spec.integer && !Number.isInteger(value)) {
        error('pitch-value', rawKey);
      } else {
        root.set(property, value);
        if (canonical === 'bend_step') root.set(P.BendStepDown, value);
      }
      continue;
    }
    const opcode = opcodeFor(rawKey);
    if (!opcode) {
      if (/_((?:on|curve|smooth|step|icurve)cc)[0-9]+$/.test(rawKey) || /^(?:eg|lfo)[0-9]+_/.test(rawKey)) error('target-unavailable', rawKey);
      continue;
    }
    const { target, source, controller, note, modifier, multiply } = opcode;
    if (target.kind === K.Amplifier && target.property === P.Random &&
        (source !== null || controller !== null || note !== null || modifier === 'mode')) {
      error('static-setting-modulation', rawKey); continue;
    }
    if (modifier === 'mode') {
      if (!['add', 'mult'].includes(raw)) error('route-value', rawKey);
      else {
        try { modes.set(`${instance(target.kind, target.index, target.parent)}:${target.property}`, raw === 'mult'); }
        catch (cause) { error(cause.message, rawKey); }
      }
      continue;
    }
    if (controller !== null && !(controller <= 127 || virtualControllers.has(controller))) {
      error('source-unavailable', rawKey); continue;
    }
    const spec = propertySpecs.get(`${target.kind}:${target.property}`);
    const routed = source !== null || controller !== null || note !== null;
    // These explicit defaults are already the ordinary sample/peak-EQ behavior.
    // A later authored route still creates its target instance normally.
    if (!routed && (opcode.key === 'offset_mode' && raw === 'samples' ||
        (opcode.key === 'delay_samples' || opcode.key === 'amp_veltrack_random') && number(raw) === 0)) continue;
    const peakEq = /^eq([1-3])_type$/.exec(opcode.key);
    if (!routed && peakEq && raw === 'peak' && !Object.keys(region.opcodes).some(key =>
      key.startsWith(`eq${peakEq[1]}_`) && !/^eq[1-3]_(type|freq|bw|gain)$/.test(key))) continue;
    if ((target.kind >= K.VelocityCurvePoint && target.kind <= K.Equalizer || target.property >= P.PositionKeyCenter && target.property <= P.PositionRandom) && routed) { error('static-setting-modulation', rawKey); continue; }
    // Static sample addresses retain their exact uint32 representation in the
    // region record. Generic sample-address slots contain modulation deltas.
    if (!routed && target.kind === K.SamplePlayback && ['offset', 'loop_start', 'delay'].includes(opcode.key)) continue;
    const adjusted = !routed && /^ampeg_(attack|hold|decay|release)$/.test(opcode.key) && region[opcode.key] !== undefined;
    let value = adjusted ? region[opcode.key] : !routed && target.property === P.FilterType ? SFZ_MOD_FILTER_TYPES[raw] :
      !routed && target.property === P.FilterMode ? { cents: 0, hz: 1 }[raw] :
      !routed && target.property === P.EqType ? { peak: 0, lshelf: 1, hshelf: 2 }[raw] :
      !routed && target.property === P.NoiseFilter ? ({ off: 0, on: 1 }[raw] ?? SFZ_MOD_FILTER_TYPES[raw]) :
      !routed && (target.property === P.PanKeyCenter || target.property === P.PositionKeyCenter || target.kind === K.Crossfade && target.index === 0) ? sfzMidiKey(raw) :
      !routed && Object.hasOwn(lifecycleEnums, opcode.key) ? lifecycleEnums[opcode.key][raw] : number(raw);
    if (!routed && /^stop_(lo|hi)cc[0-9]+$/.test(opcode.key)) {
      if (!Number.isInteger(value) || value < -1 || value > 127) { error('controller-condition', rawKey); continue; }
      if (value >= 0) value /= 127;
    }
    if (!routed && [K.ControllerStart, K.ControllerStop].includes(target.kind) && value < 0 && value !== -1) { error('controller-condition', rawKey); continue; }
    if (!routed && target.property === P.SampleQuality && value === 0) { error('sample-quality', rawKey); continue; }
    if (!finiteFloat(value) || (!routed && (value < spec.min || value > spec.max || spec.integer && !Number.isInteger(value))) ||
        (modifier !== 'depth' && value < 0) || (['curve', 'icurve'].includes(modifier) && !Number.isInteger(value)) ||
        (modifier === 'curve' && value > 254) || (modifier === 'icurve' && value > 1)) {
      error('route-value', rawKey); continue;
    }
    if (target.property === P.Wave && [8, 9, 10, 11].includes(value) && !routed) { error('wave-unverified', rawKey); continue; }
    if (target.property === P.OffCurve && ![-2, -1, 0, 1, 2, 10].includes(value)) { error('off-curve', rawKey); continue; }
    const integerDepth = target.kind === K.SamplePlayback && controller !== null && source === null && note === null &&
      (target.property === P.DelaySamples || target.property === P.Offset && region.opcodes.offset_mode !== 'percent');
    if (integerDepth && modifier === 'depth' && (!Number.isInteger(value) || Math.abs(value) > 0x100000000)) {
      error('route-value', rawKey); continue;
    }
    if (!routed && spec.integer && spec.storage === Storage.Float && Math.fround(value) !== value) { error('integer-precision', rawKey); continue; }
    try {
      const targetId = instance(target.kind, target.index, target.parent);
      if (target.kind === K.Filter) instances[targetId].parameters.set(P.Enabled, 1);
      if (!routed) {
        instances[targetId].parameters.set(target.property, value);
        if (target.kind === K.LFO && target.property === P.Steps) instances[targetId].parameters.set(P.Wave, 13);
        if (target.kind === K.LFO && target.property === P.Wave && value !== 13) instances[targetId].parameters.set(P.Steps, 0);
      }
      else {
        const sourceA = source ? (source.kind === K.Variable ? S.Variable : source.kind === K.FlexEG ? S.Envelope : S.LFO) | instance(source.kind, source.index) :
          note !== null ? S.Note | note : S.Controller | controller;
        const sourceB = source && controller !== null ? S.Controller | controller : S.Constant;
        const routeKey = `${targetId}:${target.property}:${sourceA}:${sourceB}`;
        const route = routes.get(routeKey) || { instance: targetId, property: target.property, sourceA, sourceB,
          depth: 0, curveA: 0, curveB: 0, smooth: 0, step: 0, flags: multiply ? 1 : 0, transform: 0 };
        if (integerDepth) route.flags |= Flags.IntegerDepth;
        if (modifier === 'curve') route[source && controller !== null ? 'curveB' : 'curveA'] = value;
        else if (modifier === 'icurve') {
          const flag = source && controller !== null ? 4 : 2;
          route.flags = value ? route.flags & ~flag : route.flags | flag;
        } else route[modifier] = value;
        routes.set(routeKey, route);
      }
    } catch (cause) { error(cause.message, rawKey); }
  }
  root.set(P.ScopeTune, scopeTune);
  root.set(P.ScopeVolume, scopeVolume);
  root.set(P.ScopeAmplitude, scopeAmplitude);
  // Built-in source names remain generators even with oscillator=off; the
  // switch selects wavetable versus ordinary playback for actual sample files.
  if (Object.hasOwn(SFZ_GENERATOR_WAVES, region.sample)) instances[instance(K.Oscillator)].parameters.set(P.Enabled, 1);
  for (const route of routes.values()) {
    const mode = modes.get(`${route.instance}:${route.property}`);
    if (mode !== undefined) route.flags = mode ? route.flags | 1 : route.flags & ~1;
  }
  // The bounded reference batch confirms additive omission against an explicit
  // add and two ordinary controller routes; multiplication has identity one.
  for (const [id, entry] of instances.entries()) if (entry.kind === K.Variable)
    entry.parameters.set(P.VariableValue, modes.get(`${id}:${P.VariableValue}`) ? 1 : 0);
  const direct = (sourceId, targetId, property, depth, multiply = false) => routes.set(`direct:${sourceId}:${property}`, {
    instance: targetId, property, sourceA: (instances[sourceId].kind <= K.EGStage ? S.Envelope : S.LFO) | sourceId,
    sourceB: S.Constant, depth, curveA: 0, curveB: 0, smooth: 0, step: 0, flags: multiply ? 1 : 0, transform: 0
  });
  const replacement = instances.findIndex(entry => entry.kind === K.FlexEG && entry.parameters.get(P.AmpEnvelope) === 1);
  direct(replacement < 0 ? instance(K.AmpEG) : replacement, instance(K.Region), P.Amplitude, 100, true);
  for (let id = 0; id < instances.length; id++) {
    const kind = instances[id].kind;
    if ([K.FilterEG, K.FilterLFO].includes(kind)) {
      const filter = instance(K.Filter, 1);
      instances[filter].parameters.set(P.Enabled, 1);
      direct(id, filter, P.Cutoff, 1);
    } else if ([K.PitchEG, K.PitchLFO].includes(kind)) direct(id, instance(K.Region), P.Pitch, 1);
    else if (kind === K.AmpLFO) direct(id, instance(K.Region), P.Volume, 1);
  }
  // Materialize only the nodes needed by each authored envelope or stepped LFO.
  for (let id = 0; id < instances.length; id++) {
    const entry = instances[id];
    if (entry.kind !== K.FlexEG && entry.kind !== K.LFO) continue;
    const childKind = entry.kind === K.FlexEG ? K.EGStage : K.LFOStep;
    if (childKind === K.LFOStep && entry.parameters.get(P.Wave) !== 13) continue;
    const children = instances.filter(item => item.parent === id && item.kind === childKind);
    const first = childKind === K.EGStage ? 0 : 1;
    const count = Math.max(entry.parameters.get(childKind === K.EGStage ? P.Points : P.Steps),
      ...children.map(item => item.index + (childKind === K.EGStage ? 1 : 0)), 0);
    if (count > 65535) { error('instance-count', 'points'); continue; }
    for (let point = first; point < count + first; point++) instance(childKind, point, { kind: entry.kind, index: entry.index });
    entry.parameters.set(childKind === K.EGStage ? P.Points : P.Steps, count);
    if (childKind === K.EGStage && entry.parameters.get(P.SustainPoint) < 0) entry.parameters.set(P.SustainPoint, count - 1);
  }
  const parameterIds = new Map();
  for (const [id, entry] of instances.entries()) {
    if ([K.ControllerCondition, K.ControllerStart, K.ControllerStop].includes(entry.kind)) {
      const low = entry.parameters.get(P.ConditionLow), high = entry.parameters.get(P.ConditionHigh);
      if (low >= 0 && high >= 0 && low > high) error('controller-condition-range', 'lohdcc/hihdcc');
    }
    if (entry.kind === K.TempoCondition && entry.parameters.get(P.BpmLow) > entry.parameters.get(P.BpmHigh) ||
        entry.kind === K.TimerCondition && entry.parameters.get(P.TimerLow) > entry.parameters.get(P.TimerHigh)) error('transport-condition-range', 'lobpm/lotimer');
    if (entry.kind === K.Crossfade) {
      const curve = crossfadeCurves.get(entry.index === 0 ? 'key' : entry.index === 1 ? 'vel' : 'cc');
      if (curve !== undefined) entry.parameters.set(P.Curve, curve);
      if (entry.parameters.get(P.InLow) > entry.parameters.get(P.InHigh) || entry.parameters.get(P.OutLow) > entry.parameters.get(P.OutHigh)) error('crossfade-range', 'xfin/xfout');
    }
    if (entry.kind === K.ReverseController && entry.parameters.get(P.ReverseLow) > entry.parameters.get(P.ReverseHigh)) error('reverse-range', 'reverse_locc');
    entry.firstParameter = parameters.length;
    for (const [property, value] of [...entry.parameters].sort((a, b) => a[0] - b[0])) {
      parameterIds.set(`${id}:${property}`, parameters.length);
      parameters.push({ instance: id, property, value, combine: 0 });
    }
    entry.parameterCount = parameters.length - entry.firstParameter;
    delete entry.parameters;
  }
  const orderedRoutes = [], variableInputs = new Map();
  for (const route of routes.values()) {
    if (instances[route.instance].kind === K.Variable && route.property === P.VariableValue) {
      if (!variableInputs.has(route.instance)) variableInputs.set(route.instance, []);
      variableInputs.get(route.instance).push(route);
    } else orderedRoutes.push(route);
  }
  // New variable banks keep each input group contiguous for native admission.
  // Preserve all other route order and the authored order within each group.
  for (const group of variableInputs.values()) orderedRoutes.push(...group);
  return { instances, parameters, routes: orderedRoutes.map(route => ({ ...route,
    target: parameterIds.get(`${route.instance}:${route.property}`) })) };
}

export function compileSfzModulation(regions, headers = []) {
  const diagnostics = [], curves = compileCurves(headers, diagnostics);
  const initialControllers = new Map();
  const offsets = Object.fromEntries(Object.keys(SFZ_PITCH_CONTROL_RANGES).map(key => [key, 0]));
  for (const header of headers) for (const [key, raw] of Object.entries(header.opcodes)) {
    if (variableOpcode(key) && !['global', 'master', 'group', 'region'].includes(header.name))
      diagnostics.push({ code: 'variable-region-scope', opcode: key });
    const initialization = /^set_(hdcc|cc)([0-9]{1,3})$/.exec(key);
    if (initialization) {
      const cc = Number(initialization[2]);
      if (initialization[1] === 'cc') initialControllers.delete(cc);
      else if (header.name === 'control' && cc < 128 && Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 1) initialControllers.set(cc, Number(raw));
      else diagnostics.push({ code: 'controller-initialization', opcode: key });
    }
    if ([K.SamplePlayback, K.Lifecycle, K.ReleaseDecaySegment].includes(opcodeFor(key)?.target.kind) &&
        !['global', 'master', 'group', 'region'].includes(header.name)) {
      diagnostics.push({ code: 'playback-region-scope', opcode: key });
    }
    if ((Object.hasOwn(oscillatorFields, key) || opcodeFor(key)?.target.kind === K.Oscillator) &&
        !['global', 'master', 'group', 'region'].includes(header.name)) {
      diagnostics.push({ code: 'oscillator-scope', opcode: key });
    }
    if ((Object.hasOwn(pitchFields, key) || key === 'bend_step' || scopeTunes.has(key) || scopeGains.test(key)) &&
        !['global', 'master', 'group', 'region'].includes(header.name)) {
      diagnostics.push({ code: 'pitch-region-scope', opcode: key });
    }
    if (!Object.hasOwn(SFZ_PITCH_CONTROL_RANGES, key)) continue;
    const value = number(raw);
    if (header.name !== 'control') diagnostics.push({ code: 'pitch-control-scope', opcode: key });
    else if (!Number.isInteger(value) || Math.abs(value) > SFZ_PITCH_CONTROL_RANGES[key]) {
      diagnostics.push({ code: 'pitch-value', opcode: key });
    } else offsets[key] = value;
  }
  const compiledRegions = regions.map((region, index) => compileRegion(region, index, diagnostics, offsets, initialControllers));
  const curveIds = new Set(curves.map(curve => curve.id));
  for (const [region, compiled] of compiledRegions.entries()) {
    const usedCurves = [...compiled.routes.flatMap(route => [route.curveA, route.curveB]),
      ...compiled.parameters.filter(parameter => parameter.property === P.Curve).map(parameter => parameter.value)];
    for (const curve of usedCurves) {
      if (curve >= 4 && curve <= 6) diagnostics.push({ code: 'curve-unverified', region, curve });
      else if (curve >= 7 && !curveIds.has(curve)) diagnostics.push({ code: 'curve-missing', region, curve });
    }
  }
  return { version: L.Version, profile: SFZ_MODULATION_PROFILE, regions: compiledRegions, curves, diagnostics };
}

export function packSfzModulation(compiled) {
  if (compiled.version !== L.Version || compiled.profile !== SFZ_MODULATION_PROFILE || compiled.diagnostics.length) {
    throw new Error('SFZ modulation cannot be compiled.');
  }
  const count = field => compiled.regions.reduce((sum, region) => sum + region[field].length, 0);
  const regionCount = compiled.regions.length, routeCount = count('routes'), instanceCount = count('instances'), parameterCount = count('parameters');
  const directoryOffset = L.HeaderWords, routeOffset = directoryOffset + regionCount * L.DirectoryWords;
  const curveOffset = routeOffset + routeCount * L.RouteWords;
  const instanceOffset = curveOffset + compiled.curves.length * L.CurveWords;
  const parameterOffset = instanceOffset + instanceCount * L.InstanceWords;
  const total = parameterOffset + parameterCount * L.ParameterWords;
  if (!Number.isSafeInteger(total) || total > 0x3fffffff) throw new Error('SFZ modulation is too large.');
  const buffer = new ArrayBuffer(total * 4), u = new Uint32Array(buffer), f = new Float32Array(buffer);
  u.set([0x31525453, L.Version, regionCount, routeCount, compiled.curves.length, directoryOffset,
    routeOffset, curveOffset, instanceOffset, instanceCount, parameterOffset, parameterCount, L.Profile, 0]);
  let routeFirst = 0, instanceFirst = 0, parameterFirst = 0;
  for (const [index, region] of compiled.regions.entries()) {
    u.set([routeFirst, region.routes.length, instanceFirst, region.instances.length, parameterFirst, region.parameters.length],
      directoryOffset + index * L.DirectoryWords);
    for (const route of region.routes) {
      const at = routeOffset + routeFirst++ * L.RouteWords;
      u.set([route.target, route.sourceA, route.sourceB, 0, route.curveA, route.curveB, 0, 0, route.flags, route.transform], at);
      if (route.flags & Flags.IntegerDepth) {
        const magnitude = Math.abs(route.depth);
        u[at + 3] = magnitude % 0x100000000;
        if (magnitude >= 0x100000000) u[at + 8] |= Flags.IntegerHigh;
        if (route.depth < 0) u[at + 8] |= Flags.IntegerNegative;
      } else f[at + 3] = route.depth;
      f[at + 6] = route.smooth; f[at + 7] = route.step;
    }
    for (const instance of region.instances) u.set([instance.kind, instance.index, instance.parent,
      instance.firstParameter, instance.parameterCount, 0], instanceOffset + instanceFirst++ * L.InstanceWords);
    for (const parameter of region.parameters) {
      const at = parameterOffset + parameterFirst++ * L.ParameterWords;
      const spec = propertySpecs.get(`${region.instances[parameter.instance].kind}:${parameter.property}`);
      u.set([parameter.instance, parameter.property, 0, parameter.combine], at);
      if (spec.storage === Storage.Float) f[at + 2] = parameter.value;
      else {
        u[at + 2] = parameter.value % 0x100000000;
        u[at + 3] = Math.floor(parameter.value / 0x100000000);
      }
    }
  }
  for (const [index, curve] of compiled.curves.entries()) {
    const at = curveOffset + index * L.CurveWords;
    u[at] = curve.id; f.set(curve.values, at + 1);
  }
  return new Uint8Array(buffer);
}

// Timer timestamps belong to lexical sequence groups, independently of voice state.
// The exact offline trial backup has the same 16-channel storage as the live bank.
export function sfzTimerFootprint(compiled, groupCount) {
  return compiled?.regions.some(region => region.instances.some(instance => instance.kind === K.TimerCondition))
    ? groupCount * B.TimerGroupBytes : 0;
}

export function sfzModulationFootprint(compiled) {
  let metadata = compiled.curves.length * L.CurveWords * 4 +
    (compiled.regions.some(region => region.instances.some(instance => instance.kind === K.InitialController)) ? B.InitialControllerBytes : 0);
  const maximum = { envelopes: 0, lfos: 0, routes: 0, parameters: 0, instances: 0 };
  const usedFamilies = new Map();
  for (const region of compiled.regions) {
    const envelopes = region.instances.filter(instance => instance.kind >= K.AmpEG && instance.kind <= K.FlexEG).length;
    const lfos = region.instances.filter(instance => instance.kind >= K.AmpLFO && instance.kind <= K.LFOSubosc).length;
    const oscillators = region.instances.filter(instance => instance.kind === K.Oscillator).length;
    const playback = region.instances.filter(instance => instance.kind === K.SamplePlayback).length;
    const voiceDsp = region.instances.filter(instance => instance.kind === K.VoiceDSP).length;
    const noise = region.instances.filter(instance => instance.kind === K.NoiseLayer).length;
    const releaseSegments = region.instances.filter(instance => instance.kind === K.ReleaseDecaySegment).length;
    const lifecycle = region.instances.some(instance => instance.kind === K.Lifecycle);
    const reverse = region.instances.filter(instance => instance.kind === K.ReverseController).length;
    metadata += B.RegionPlanBytes + region.routes.length * (L.RouteWords * 4 + B.IntegerDepthBytes) +
      region.instances.length * (L.InstanceWords * 4 + B.StateIndexBytes + B.GeneratorParametersBytes + B.ConditionIndexBytes) +
      region.parameters.length * (L.ParameterWords * 4 + B.PropertyPointerBytes + B.ParameterIndexBytes + B.IntegerBaseBytes) +
      (playback || lifecycle || reverse ? B.PlaybackPlanBytes : 0) + releaseSegments * B.ReleaseSegmentBytes + reverse * B.ReverseConditionBytes;
    if (oscillators) usedFamilies.set(K.Oscillator, B.OscillatorStateBytes);
    if (playback) usedFamilies.set(K.SamplePlayback, B.PlaybackStateBytes);
    if (voiceDsp) usedFamilies.set(K.VoiceDSP, B.VoiceDspStateBytes);
    if (noise) usedFamilies.set(K.NoiseLayer, B.NoiseStateBytes);
    for (const [key, value] of Object.entries({ envelopes, lfos, routes: region.routes.length,
      parameters: region.parameters.length, instances: region.instances.length })) maximum[key] = Math.max(maximum[key], value);
  }
  // Both active voices and the offline trial have preallocated state.
  const maximumState = maximum.envelopes * B.EnvelopeStateBytes + maximum.lfos * B.LfoStateBytes +
    maximum.routes * B.RouteStateBytes + maximum.parameters * 4 + maximum.instances * 4 + B.BornFactsBytes +
    [...usedFamilies.values()].reduce((bytes, size) => bytes + size, 0);
  return metadata + (2 * B.MaxVoices + B.PreviewVoices) * maximumState;
}
