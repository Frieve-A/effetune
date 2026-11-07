import { SFZ_MOD_FILTER_TYPES, sfzModulationTarget } from './modulation-schema.js';
// Ordered scalar and controller lanes mirrored by the native compiled-instrument ABI.
export const SFZ_EXTRA_DEFAULTS = Object.freeze({
  trigger: 0, lochan: 1, hichan: 16, lobend: -8192, hibend: 8192,
  lochanaft: 0, hichanaft: 127, lopolyaft: 0, hipolyaft: 127, loprog: 0, hiprog: 127,
  sw_lokey: -1, sw_hikey: -1, sw_last: -1, sw_lolast: -1, sw_hilast: -1,
  sw_down: -1, sw_up: -1, sw_previous: -1, sw_default: -1,
  group: 0, off_by: 0, off_mode: 0, off_time: .006, polyphony: 0, note_polyphony: 0,
  bend_up: 200, bend_down: -200, cutoff: 20000, resonance: 0, fil_type: 0,
  ampeg_delay: 0, ampeg_start: 0, amp_keytrack: 0, amp_keycenter: 60, amp_random: 0,
  pitch_veltrack: 0, pitch_random: 0, delay: 0, delay_random: 0,
  pitcheg_delay: 0, pitcheg_start: 0, pitcheg_attack: 0, pitcheg_hold: 0,
  pitcheg_decay: 0, pitcheg_sustain: 0, pitcheg_release: 0, pitcheg_depth: 0,
  fileg_delay: 0, fileg_start: 0, fileg_attack: 0, fileg_hold: 0,
  fileg_decay: 0, fileg_sustain: 0, fileg_release: 0, fileg_depth: 0,
  amplfo_delay: 0, amplfo_fade: 0, amplfo_freq: 0, amplfo_depth: 0,
  pitchlfo_delay: 0, pitchlfo_fade: 0, pitchlfo_freq: 0, pitchlfo_depth: 0,
  fillfo_delay: 0, fillfo_fade: 0, fillfo_freq: 0, fillfo_depth: 0,
  direction: 0, loop_count: -1, loop_crossfade: 0,
  ampeg_dynamic: 0,
  eq1_freq: 50, eq1_bw: 1, eq1_gain: 0,
  eq2_freq: 500, eq2_bw: 1, eq2_gain: 0,
  eq3_freq: 5000, eq3_bw: 1, eq3_gain: 0
});
export const SFZ_CONTROLLER_FAMILIES = Object.freeze({
  locc: 0, hicc: 127, set_cc: -1, volume_oncc: 0, pan_oncc: 0, pitch_oncc: 0,
  cutoff_oncc: 0, resonance_oncc: 0, on_locc: -1, on_hicc: -1,
  ampeg_delay_oncc: 0, ampeg_start_oncc: 0, ampeg_attack_oncc: 0,
  ampeg_hold_oncc: 0, ampeg_decay_oncc: 0, ampeg_sustain_oncc: 0, ampeg_release_oncc: 0,
  eq1_freq_oncc: 0, eq1_bw_oncc: 0, eq1_gain_oncc: 0,
  eq2_freq_oncc: 0, eq2_bw_oncc: 0, eq2_gain_oncc: 0,
  eq3_freq_oncc: 0, eq3_bw_oncc: 0, eq3_gain_oncc: 0
});
// Target IDs are the existing sparse controller-family IDs; conditions and initial
// values remain separate from modulation routes in the next native bank section.
export const SFZ_MODULATION_TARGETS = Object.freeze(Object.fromEntries(
  Object.keys(SFZ_CONTROLLER_FAMILIES).flatMap((family, id) =>
    family.endsWith('_oncc') ? [[family.slice(0, -5), id]] : [])));
export const SFZ_MODULATION_DEPTH_RANGES = Object.freeze(Object.fromEntries(
  Object.entries(SFZ_MODULATION_TARGETS).map(([target, id]) => [id, Object.freeze(
    target.startsWith('ampeg_') ? [-100, 100] : /^eq[1-3]_freq$/.test(target) ? [-30000, 30000]
      : /^eq[1-3]_bw$/.test(target) ? [-4, 4] : /^eq[1-3]_gain$/.test(target) ? [-96, 24]
        : [-12000, 12000])])));
export const SFZ_EXTRA_FIELDS = Object.freeze([...Object.keys(SFZ_EXTRA_DEFAULTS),
  ...Object.keys(SFZ_CONTROLLER_FAMILIES).flatMap(prefix => Array.from({ length: 128 }, (_, cc) => prefix + cc))]);
export const SFZ_ENUMS = Object.freeze({
  trigger: { attack: 0, release: 1, release_key: 2, first: 3, legato: 4 },
  off_mode: { fast: 0, normal: 1, time: 2 },
  fil_type: SFZ_MOD_FILTER_TYPES,
  direction: { forward: 0, reverse: 1 }
});
export const SFZ_ALIASES = Object.freeze({
  loopcount: 'loop_count', loopend: 'loop_end', loopmode: 'loop_mode', loopstart: 'loop_start',
  looptype: 'loop_type', looptune: 'loop_tune',
  polyphony_group: 'group', offby: 'off_by', offmode: 'off_mode', gain_random: 'amp_random',
  bendup: 'bend_up', benddown: 'bend_down', bendstep: 'bend_step', pitch: 'tune', filtype: 'fil_type',
  tune_keytrack: 'pitch_keytrack', tune_random: 'pitch_random', tune_veltrack: 'pitch_veltrack',
  amp_attack: 'ampeg_attack', amp_decay: 'ampeg_decay', amp_delay: 'ampeg_delay',
  amp_hold: 'ampeg_hold', amp_release: 'ampeg_release', amp_sustain: 'ampeg_sustain',
  fil_attack: 'fileg_attack', fil_decay: 'fileg_decay', fil_delay: 'fileg_delay', fil_depth: 'fileg_depth',
  fil_hold: 'fileg_hold', fil_release: 'fileg_release', fil_sustain: 'fileg_sustain',
  pitch_attack: 'pitcheg_attack', pitch_decay: 'pitcheg_decay', pitch_delay: 'pitcheg_delay',
  pitch_depth: 'pitcheg_depth', pitch_hold: 'pitcheg_hold', pitch_release: 'pitcheg_release', pitch_sustain: 'pitcheg_sustain'
});
export function sfzMidiKey(value) {
  if (/^-?[0-9]+$/.test(value)) return Number(value);
  const match = /^([a-g])([#b]?)(-?[0-9]+)$/i.exec(value);
  if (!match) return NaN;
  const pitch = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[match[1].toLowerCase()];
  return (Number(match[3]) + 1) * 12 + pitch + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}
// Opcode names form a small vocabulary, while large banks query them once per region.
const controllerOpcodes = new Map();
export function sfzControllerOpcode(key) {
  let route = controllerOpcodes.get(key);
  if (route === undefined) {
    const match = /^(.*?)([0-9]{1,3})$/.exec(key);
    route = match && Object.hasOwn(SFZ_CONTROLLER_FAMILIES, match[1]) && Number(match[2]) < 128
      ? Object.freeze({ family: match[1], controller: Number(match[2]) }) : null;
    if (controllerOpcodes.size < 65536) controllerOpcodes.set(key, route);
  }
  return route;
}
export function sfzControllerValue(region, family, controller) {
  return region[family + controller] ?? SFZ_CONTROLLER_FAMILIES[family];
}
export function canonicalSfzOpcode(key) {
  key = key.replace(/^set_realcc([0-9]{1,3})$/, 'set_hdcc$1');
  key = key.replace(/^oscillator_mod_smoothcc([0-9]{1,3})$/, 'oscillator_mod_depth_smoothcc$1');
  key = key.replace(/^(eg|lfo)0*([0-9]+)_/, (_, prefix, index) => `${prefix}${Number(index)}_`);
  key = key.replace(/^(amp|fil|pitch)_vel2/, '$1eg_vel2');
  key = key.replace(/^((?:amp|fil|pitch)lfo_(?:depth|freq))(chanaft|polyaft)$/, '$1_$2');
  if (Object.hasOwn(SFZ_ALIASES, key)) return SFZ_ALIASES[key];
  const alias = /^(volume|pan|pitch|cutoff|resonance)_cc([0-9]{1,3})$/.exec(key);
  const gain = /^(?:gain_cc|gain_oncc)([0-9]{1,3})$/.exec(key);
  const tune = /^(?:tune_cc|tune_oncc)([0-9]{1,3})$/.exec(key);
  const start = /^start_((?:lo|hi)(?:hd)?cc)([0-9]{1,3})$/.exec(key);
  const envelope = /^(ampeg_(?:delay|start|attack|hold|decay|sustain|release))(?:_?cc|_oncc)([0-9]{1,3})$/.exec(key);
  const equalizer = /^(eq[1-3]_(?:freq|bw|gain))(?:_?cc|_oncc)([0-9]{1,3})$/.exec(key);
  const canonical = alias ? `${alias[1]}_oncc${alias[2]}` : gain ? `volume_oncc${gain[1]}`
    : tune ? `pitch_oncc${tune[1]}` : start ? `on_${start[1]}${start[2]}`
      : envelope ? `${envelope[1]}_oncc${envelope[2]}` : equalizer ? `${equalizer[1]}_oncc${equalizer[2]}` : key;
  const modifier = /^([a-z0-9_]+)_(curvecc|smoothcc|stepcc)([0-9]{1,3})$/.exec(canonical);
  if (modifier) {
    const target = modifier[1] === 'tune' ? 'pitch' : modifier[1];
    if (Object.hasOwn(SFZ_MODULATION_TARGETS, target)) return `${target}_${modifier[2]}${Number(modifier[3])}`;
  }
  const generic = /^(.*?)(?:_oncc|_cc|cc)([0-9]{1,3})$/.exec(canonical);
  if (generic && sfzModulationTarget(generic[1])) return `${generic[1]}_oncc${Number(generic[2])}`;
  const controller = sfzControllerOpcode(canonical);
  return controller ? `${controller.family}${controller.controller}` : canonical;
}

export function sfzModulationOpcode(key) {
  const canonical = canonicalSfzOpcode(key);
  const match = /^([a-z0-9_]+)_(oncc|curvecc|smoothcc|stepcc)([0-9]{1,3})$/.exec(canonical);
  if (!match || !Object.hasOwn(SFZ_MODULATION_TARGETS, match[1])) return null;
  return { target: SFZ_MODULATION_TARGETS[match[1]], source: Number(match[3]),
    property: { oncc: 'depth', curvecc: 'curve', smoothcc: 'smooth', stepcc: 'step' }[match[2]], canonical };
}
