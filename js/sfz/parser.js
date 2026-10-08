import { SFZ_DEFAULT_MAX_BYTES, requireSfzMaxBytes } from './limits.js';

const MAX_INCLUDE_VISITS = 10000;
const SUPPORTED = new Set([
  'sample', 'key', 'lokey', 'hikey', 'lovel', 'hivel', 'lorand', 'hirand',
  'seq_length', 'seq_position', 'pitch_keycenter', 'pitch_keytrack', 'transpose',
  'tune', 'volume', 'pan', 'amp_veltrack', 'offset', 'end', 'loop_mode',
  'loop_start', 'loop_end', 'ampeg_attack', 'ampeg_hold', 'ampeg_decay',
  'ampeg_sustain', 'ampeg_release'
]);
const DEFAULTS = Object.freeze({
  lokey: 0, hikey: 127, lovel: 1, hivel: 127, lorand: 0, hirand: 1,
  seq_length: 1, seq_position: 1, pitch_keycenter: 60, pitch_keytrack: 100,
  transpose: 0, tune: 0, volume: 0, pan: 0, amp_veltrack: 100, offset: 0,
  loop_mode: 0, loop_start: 0, ampeg_attack: 0, ampeg_hold: 0,
  ampeg_decay: 0, ampeg_sustain: 100, ampeg_release: 0.001
});
const LOOP_MODES = new Map([['no_loop', 0], ['one_shot', 1], ['loop_continuous', 2], ['loop_sustain', 3]]);
const NOTE_KEYS = new Set(['key', 'lokey', 'hikey', 'pitch_keycenter']);
const INTEGER_KEYS = new Set(['lokey', 'hikey', 'lovel', 'hivel', 'seq_length', 'seq_position',
  'pitch_keycenter', 'transpose', 'offset', 'end', 'loop_start', 'loop_end']);

export function sfzError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

export function normalizeSfzPath(value, directory = '') {
  if (typeof value !== 'string') throw sfzError('prepare', 'An SFZ file path is invalid.');
  const path = value.replaceAll('\\', '/');
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\0')) {
    throw sfzError('prepare', 'SFZ references must stay inside the selected folder.');
  }
  const parts = directory ? directory.split('/') : [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw sfzError('prepare', 'SFZ references must stay inside the selected folder.');
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

function stripComments(text) {
  let result = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++;
      result += '\n';
    } else if (!quoted && char === '/' && text[index + 1] === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++;
      index++;
      result += ' ';
    } else result += char;
  }
  return result;
}

function unquote(value) {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function midi(value) {
  if (/^-?[0-9]+$/.test(value)) return Number(value);
  const match = /^([a-g])([#b]?)(-?[0-9]+)$/i.exec(value);
  if (!match) return NaN;
  const pitch = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[match[1].toLowerCase()];
  return (Number(match[3]) + 1) * 12 + pitch + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}

function conditionalOpcode(key, value) {
  return key === 'trigger' ? value !== 'attack'
    : /^(?:on_)?(?:lo|hi)(?:cc|hdcc|realcc|oncc|bend|chanaft|polyaft|prog|chan|timer|bpm)/.test(key) ||
      key.startsWith('sw_') || key === 'sustain_sw' || key === 'sostenuto_sw';
}

function normalizeRegion(raw, samplePath, seqGroup) {
  const region = { ...DEFAULTS, sample: samplePath, seqGroup };
  for (const [key, value] of Object.entries(raw)) {
    if (!SUPPORTED.has(key) || key === 'sample') continue;
    let number = key === 'loop_mode' ? LOOP_MODES.get(value)
      : NOTE_KEYS.has(key) ? midi(value) : Number(value);
    if (!Number.isFinite(number)) throw sfzError('prepare', `Invalid SFZ opcode ${key}.`);
    if (key === 'key') {
      region.lokey = region.hikey = region.pitch_keycenter = number;
    } else {
      if (INTEGER_KEYS.has(key) && !Number.isInteger(number)) {
        throw sfzError('prepare', `SFZ opcode ${key} must be an integer.`);
      }
      region[key] = number;
    }
  }
  if (region.lovel === 0) region.lovel = 1;
  if (region.lokey < 0 || region.hikey > 127 || region.lokey > region.hikey ||
      region.lovel < 1 || region.hivel > 127 || region.lovel > region.hivel ||
      region.lorand < 0 || region.hirand > 1 || region.lorand > region.hirand ||
      region.seq_length < 1 || region.seq_length > 16777216 || region.seq_position < 1 || region.seq_position > region.seq_length ||
      region.pitch_keycenter < 0 || region.pitch_keycenter > 127 || region.offset < 0 ||
      region.pitch_keytrack < -1200 || region.pitch_keytrack > 1200 ||
      region.transpose < -127 || region.transpose > 127 || region.tune < -1200 || region.tune > 1200 ||
      region.volume < -144 || region.volume > 144 ||
      region.pan < -100 || region.pan > 100 || region.amp_veltrack < -100 || region.amp_veltrack > 100 ||
      ['ampeg_attack', 'ampeg_hold', 'ampeg_decay', 'ampeg_release'].some(key => region[key] < 0 || region[key] > 100) ||
      region.ampeg_sustain < 0 || region.ampeg_sustain > 100) {
    throw sfzError('prepare', 'SFZ region contains an invalid parameter range.');
  }
  return region;
}

// The selected SFZ owns sample paths; includes are resolved relative to the including text.
export async function parseSfz({ selectedPath, readText, hasSample, maxBytes = SFZ_DEFAULT_MAX_BYTES,
  onDiagnostic = detail => console.warn('SFZ import:', detail) }) {
  requireSfzMaxBytes(maxBytes);
  selectedPath = normalizeSfzPath(selectedPath);
  const directory = selectedPath.includes('/') ? selectedPath.slice(0, selectedPath.lastIndexOf('/')) : '';
  const dependencies = new Set();
  const defines = new Map();
  const diagnostics = { ignoredOpcodes: new Set(), excludedOpcodes: new Set(),
    missingSamples: new Set(), invalidRegions: new Set() };
  let includeVisits = 0;
  let sourceChars = 0;
  let expandedChars = 0;
  const tooLarge = () => sfzError('too-large', 'The SFZ definition is too large to load.');
  const expandDefines = text => {
    let length = text.length;
    if (length > maxBytes - expandedChars) throw tooLarge();
    const expanded = text.replace(/\$[a-z0-9_]+/gi, key => {
      const value = defines.get(key) ?? key;
      length += value.length - key.length;
      if (length > maxBytes - expandedChars) throw tooLarge();
      return value;
    });
    expandedChars += length + 1;
    if (expandedChars > maxBytes) throw tooLarge();
    return expanded;
  };
  async function expand(path, ancestors = []) {
    if (ancestors.includes(path) || ancestors.length >= 32) throw sfzError('prepare', 'SFZ includes are recursive or too deep.');
    // Count every visit, including cached or empty definitions, before reading it.
    if (++includeVisits > MAX_INCLUDE_VISITS) throw tooLarge();
    const text = await readText(path);
    if (typeof text !== 'string') throw sfzError('prepare', 'An SFZ include could not be found.');
    sourceChars += text.length;
    if (sourceChars > maxBytes) throw tooLarge();
    dependencies.add(path);
    let output = '';
    for (const line of stripComments(text).split(/\r?\n/)) {
      const define = /^\s*#define\s+(\$[a-z0-9_]+)\s+(.+)$/i.exec(line);
      const include = /^\s*#include\s+(.+)$/i.exec(line);
      if (define) defines.set(define[1], expandDefines(unquote(define[2].trim())));
      else if (include) {
        const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        output += await expand(normalizeSfzPath(unquote(expandDefines(include[1].trim())), base), [...ancestors, path]);
      } else output += expandDefines(line) + '\n';
    }
    return output;
  }
  const text = await expand(selectedPath);
  const markers = [...text.matchAll(/<([a-z0-9_]+)>|([a-z0-9_]+)\s*=/gi)];
  const regions = [];
  const pendingRegions = [];
  // Freeze CC conditions at sfizz-style initial values; this player has no CC input.
  const initialCC = new Uint8Array(128);
  initialCC[7] = 100;
  initialCC[10] = 64;
  initialCC[11] = 127;
  let global = Object.create(null);
  let master = Object.create(null);
  let group = Object.create(null);
  let scope = Object.create(null);
  let header = '';
  let defaultPath = '';
  let initialSwitch = null;
  let seqGroup = 0;
  const finishRegion = () => {
    if (header !== 'region') return;
    pendingRegions.push({ raw: { ...global, ...master, ...group, ...scope }, defaultPath, seqGroup });
  };
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index];
    if (marker[1]) {
      finishRegion();
      header = marker[1].toLowerCase();
      scope = Object.create(null);
      if (header === 'global') { global = scope; master = Object.create(null); group = Object.create(null); seqGroup++; }
      else if (header === 'master') { master = scope; group = Object.create(null); seqGroup++; }
      else if (header === 'group') { group = scope; seqGroup++; }
      continue;
    }
    const key = marker[2].toLowerCase();
    const value = unquote(text.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? text.length).trim());
    if (key === 'sw_default') {
      const note = midi(value);
      if (Number.isInteger(note) && note >= 0 && note <= 127) initialSwitch = note;
    }
    if (header === 'control' && key === 'default_path') defaultPath = value.replaceAll('\\', '/');
    else if (header === 'control' && /^set_cc[0-9]{1,3}$/.test(key) && Number(key.slice(6)) < 128) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0 || number > 127) {
        throw sfzError('prepare', `Invalid SFZ opcode ${key}.`);
      }
      initialCC[Number(key.slice(6))] = number;
    }
    else if (key === 'key') {
      scope.lokey = scope.hikey = scope.pitch_keycenter = value;
    } else if (SUPPORTED.has(key) || key === 'trigger' || conditionalOpcode(key, value)) scope[key] = value;
    else diagnostics.ignoredOpcodes.add(key);
  }
  finishRegion();
  let invalidRegionCount = 0;
  let unsupportedRegionCount = 0;
  // All control headers describe the instrument's initial state, regardless of their position.
  for (const { raw, defaultPath: regionDefaultPath, seqGroup: regionSeqGroup } of pendingRegions) {
    try {
      const excluded = Object.entries(raw).filter(([key, value]) => {
        if (['sw_default', 'sw_lokey', 'sw_hikey', 'sw_label'].includes(key)) return false;
        if (key === 'sw_last') return initialSwitch === null || midi(value) !== initialSwitch;
        const cc = /^(lo|hi)cc([0-9]{1,3})$/.exec(key);
        if (!cc || Number(cc[2]) >= 128) return conditionalOpcode(key, value);
        const bound = Number(value);
        if (!Number.isInteger(bound) || bound < 0 || bound > 127) {
          throw sfzError('prepare', `Invalid SFZ opcode ${key}.`);
        }
        return cc[1] === 'lo' ? initialCC[Number(cc[2])] < bound : initialCC[Number(cc[2])] > bound;
      });
      if (excluded.length) {
        for (const [key] of excluded) diagnostics.excludedOpcodes.add(key);
        if (excluded.some(([key]) => {
          if (key === 'sw_last') return initialSwitch === null;
          const cc = /^(?:lo|hi)cc([0-9]{1,3})$/.exec(key);
          return !cc || Number(cc[1]) >= 128;
        })) unsupportedRegionCount++;
        continue;
      }
      if (!raw.sample) continue;
      const sample = normalizeSfzPath(regionDefaultPath + unquote(raw.sample), directory);
      const region = normalizeRegion(raw, sample, regionSeqGroup);
      if (hasSample && !hasSample(sample)) {
        diagnostics.missingSamples.add(sample);
        continue;
      }
      regions.push(region);
    } catch (error) {
      if (error?.code !== 'prepare') throw error;
      invalidRegionCount++;
      diagnostics.invalidRegions.add(`${raw.sample || '(no sample)'}: ${error.message}`);
    }
  }
  const detail = Object.fromEntries(Object.entries(diagnostics).map(([key, values]) => [key, [...values].sort()]));
  if (Object.values(detail).some(values => values.length)) onDiagnostic?.(detail);
  const warnings = [];
  if (invalidRegionCount) warnings.push({ code: 'invalid-regions', count: invalidRegionCount });
  if (diagnostics.missingSamples.size) warnings.push({ code: 'missing-samples', count: diagnostics.missingSamples.size });
  if (unsupportedRegionCount) warnings.push({ code: 'unsupported-regions', count: unsupportedRegionCount });
  return { regions, dependencies: [...dependencies].sort(), diagnostics: detail, warnings };
}
