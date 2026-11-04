import { SFZ_EXTRA_DEFAULTS, SFZ_ENUMS, SFZ_MODULATION_TARGETS, SFZ_MODULATION_DEPTH_RANGES,
  sfzControllerOpcode, sfzControllerValue, canonicalSfzOpcode, sfzMidiKey as midi } from './schema.js';
import { SFZ_DEFAULT_MAX_BYTES, requireSfzMaxBytes } from './limits.js';
import { isSfzGenerator } from './generators.js';
import { compileSfzModulation, isSfzModulationOpcode, SFZ_PITCH_CONTROL_RANGES } from './modulation.js';
import { embeddedSfzRanges, decodeEmbeddedSfzSample } from './embedded-sample.js';
import { normalizeSfzRegionSentinels } from './region-sentinels.js';
import { isSfzEffectOpcode } from './effects.js';
import { compileSfzEffectHeaders, effectSamplePaths } from './effects-asset.js';

const MAX_INCLUDE_VISITS = 10000;
const SUPPORTED = new Set([
  'load_start', 'load_end', 'load_mode', 'sample', 'key', 'lokey', 'hikey', 'lovel', 'hivel', 'lorand', 'hirand',
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
const ENVELOPE_TIMES = new Set(['ampeg_attack', 'ampeg_hold', 'ampeg_decay', 'ampeg_release']);
const HEADERS = new Set(['control', 'global', 'master', 'group', 'region', 'curve', 'effect', 'midi']);

function validateExtraOpcode(key, number) {
  const controller = sfzControllerOpcode(key);
  let low = -12000, high = 12000, integer = false;
  if (controller) {
    if (['locc', 'hicc', 'set_cc', 'on_locc', 'on_hicc'].includes(controller.family)) {
      low = controller.family.startsWith('on_') ? -1 : 0; high = 127; integer = true;
    } else {
      [low, high] = SFZ_MODULATION_DEPTH_RANGES[SFZ_MODULATION_TARGETS[controller.family.slice(0, -5)]];
    }
  } else if (key === 'ampeg_dynamic') { low = 0; high = 1; integer = true;
  } else if (/^eq[1-3]_freq$/.test(key)) { low = 0; high = 30000;
  } else if (/^eq[1-3]_bw$/.test(key)) { low = .001; high = 4;
  } else if (/^eq[1-3]_gain$/.test(key)) { low = -96; high = 24;
  } else if (key.startsWith('sw_')) { low = -1; high = 127; integer = true; }
  else if (key === 'lochan' || key === 'hichan') { low = 1; high = 16; integer = true; }
  else if (['lobend', 'hibend'].includes(key)) { low = -8192; high = 8192; integer = true; }
  else if (/^(?:lo|hi)(?:chanaft|polyaft|prog)$/.test(key) || key === 'amp_keycenter') { low = 0; high = 127; integer = true; }
  else if (['group', 'off_by'].includes(key)) { low = -2147483648; high = 2147483647; integer = true; }
  else if (key === 'loop_count') { low = -1; high = 4294967295; integer = true; }
  else if (['polyphony', 'note_polyphony'].includes(key)) { low = 1; high = 16777216; integer = true; }
  else if (key === 'cutoff') { low = 0; high = 192000; }
  else if (key === 'resonance') { low = 0; high = 40; }
  else if (key === 'amp_keytrack') { low = -96; high = 12; }
  else if (key === 'amp_random') { low = 0; high = 24; }
  else if (key === 'pitch_veltrack') { low = -9600; high = 9600; }
  else if (key === 'bend_up' || key === 'bend_down') { low = -9600; high = 9600; integer = true; }
  else if (key === 'pitch_random') { low = 0; high = 9600; }
  else if (key === 'off_time' || key === 'delay' || key === 'delay_random' || key === 'loop_crossfade' ||
      /^(?:amp|pitch|fil)(?:eg|lfo)_(?:delay|attack|hold|decay|release|fade)$/.test(key)) { low = 0; high = 100; }
  else if (/^(?:amp|pitch|fil)eg_(?:start|sustain)$/.test(key)) { low = 0; high = 100; }
  else if (/lfo_freq$/.test(key)) { low = 0; high = 20000; }
  else if (key === 'amplfo_depth') { low = -10; high = 10; }
  if (!Number.isFinite(number) || number < low || number > high || (integer && !Number.isInteger(number))) {
    throw sfzError('prepare', `Invalid SFZ opcode ${key}.`);
  }
}

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

function normalizeRegion(raw, samplePath, seqGroup, adjustedEnvelopes) {
  const region = { ...DEFAULTS, ...SFZ_EXTRA_DEFAULTS, sample: samplePath, seqGroup, opcodes: {...raw} };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'sample' || key === 'key') continue;
    if (['load_start', 'load_end', 'load_mode'].includes(key)) {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0 || number > (key === 'load_mode' ? 1 : 0x100000000))
        throw sfzError('prepare', 'The instrument sample loading range is invalid.');
      region[key] = number;
      continue;
    }
    if (Object.hasOwn(SFZ_EXTRA_DEFAULTS, key) || sfzControllerOpcode(key)) {
      const number = Object.hasOwn(SFZ_ENUMS, key) ? SFZ_ENUMS[key][value]
        : key.startsWith('sw_') || key === 'amp_keycenter' ? midi(value) : Number(value);
      validateExtraOpcode(key, number);
      region[key] = number;
      continue;
    }
    if (!SUPPORTED.has(key)) continue;
    let number = key === 'loop_mode' ? LOOP_MODES.get(value)
      : NOTE_KEYS.has(key) ? midi(value) : Number(value);
    if (ENVELOPE_TIMES.has(key) && (!Number.isFinite(number) || number < 0 || number > 100)) {
      adjustedEnvelopes.add(`${samplePath}: ${key}=${value}`);
      number = Number.isFinite(number) ? (number < 0 ? 0 : 100) : DEFAULTS[key];
    }
    if (!Number.isFinite(number)) throw sfzError('prepare', `Invalid SFZ opcode ${key}.`);
    if (key === 'key') {
      region.lokey = region.hikey = region.pitch_keycenter = number;
    } else {
      if (INTEGER_KEYS.has(key) && !(key === 'offset' && raw.offset_mode === 'percent') && !Number.isInteger(number)) {
        throw sfzError('prepare', `SFZ opcode ${key} must be an integer.`);
      }
      region[key] = number;
    }
  }
  normalizeSfzRegionSentinels(region);
  if (!Object.hasOwn(raw, 'fil_type') && Object.keys(raw).some(key =>
    ['cutoff', 'resonance', 'fileg_depth', 'fillfo_depth'].includes(key) ||
    ['cutoff_oncc', 'resonance_oncc'].includes(sfzControllerOpcode(key)?.family))) region.fil_type = 2;
  if (region.lovel === 0) region.lovel = 1;
  for (const [low, high] of [['lochan', 'hichan'], ['lobend', 'hibend'], ['lochanaft', 'hichanaft'],
    ['lopolyaft', 'hipolyaft'], ['loprog', 'hiprog']]) {
    if (region[low] > region[high]) throw sfzError('prepare', `Invalid SFZ condition ${low}/${high}.`);
  }
  for (let cc = 0; cc < 128; cc++) {
    if (sfzControllerValue(region, 'locc', cc) > sfzControllerValue(region, 'hicc', cc)) {
      throw sfzError('prepare', `Invalid SFZ controller range ${cc}.`);
    }
  }
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

// Percent addresses become source-frame addresses after metadata is known.
export function resolveSfzRegionOffset(region, frames) {
  return region.opcodes?.offset_mode === 'percent'
    ? Math.floor((region.offset ?? 0) * .01 * frames) : region.offset ?? 0;
}

function instrumentPresentation(headers, regions, directory) {
  const keys = new Map(), controllers = new Map(), outputs = new Map(), switches = new Map(), groups = new Set();
  const scopes = new Map();
  let image = null;
  for (const header of headers) for (const [key, value] of Object.entries(header.opcodes)) {
    const label = /^label_(key|cc|output)([0-9]+)$/.exec(key);
    if (label) {
      const index = Number(label[2]), limit = label[1] === 'output' ? 1024 : 127;
      if (header.name !== 'control' || index > limit) throw sfzError('prepare', 'An instrument label has an invalid location.');
      ({ key: keys, cc: controllers, output: outputs })[label[1]].set(index, value);
    }
    if (key === 'image') image = normalizeSfzPath(value, directory);
    if (header.name === 'control' && key === 'group_label') groups.add(value);
  }
  for (const region of regions) {
    for (const name of ['global', 'master', 'region']) {
      const label = region.opcodes[`${name}_label`];
      if (label) scopes.set(`${name}:${label}`, { scope: name, label });
    }
    const label = region.opcodes.sw_label;
    const first = region.sw_last >= 0 ? region.sw_last : region.sw_lolast;
    const last = region.sw_last >= 0 ? region.sw_last : region.sw_hilast;
    if (label && first >= 0 && last >= first) switches.set(`${first}:${last}:${label}`, { first, last, label });
    if (region.opcodes.group_label) groups.add(region.opcodes.group_label);
  }
  const labels = map => [...map].sort((a, b) => a[0] - b[0]).map(([index, label]) => ({ index, label }));
  return { keys: labels(keys), controllers: labels(controllers), outputs: labels(outputs),
    switches: [...switches.values()], groups: [...groups], ...(scopes.size ? { scopes: [...scopes.values()] } : {}), image };
}

// The selected SFZ owns sample paths; includes are resolved relative to the including text.
export async function parseSfz({ selectedPath, readText, hasSample, resolveSample, maxBytes = SFZ_DEFAULT_MAX_BYTES,
  defines: sourceDefines = new Map(),
  onDiagnostic = detail => console.warn('SFZ import:', detail) }) {
  requireSfzMaxBytes(maxBytes);
  selectedPath = normalizeSfzPath(selectedPath);
  const directory = selectedPath.includes('/') ? selectedPath.slice(0, selectedPath.lastIndexOf('/')) : '';
  const dependencies = new Set();
  const embeddedPayloads = [], embeddedSamples = new Map();
  const defines = new Map(sourceDefines);
  const diagnostics = { ignoredOpcodes: new Set(), unsupportedHeaders: new Set(), excludedOpcodes: new Set(),
    missingSamples: new Set(), invalidRegions: new Set(), adjustedEnvelopes: new Set() };
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
    let text = await readText(path);
    if (typeof text !== 'string') throw sfzError('prepare', 'An SFZ include could not be found.');
    sourceChars += text.length;
    if (sourceChars > maxBytes) throw tooLarge();
    dependencies.add(path);
    // Strip binary payloads before comments, macros, includes and opcode markers
    // are processed. Their bytes may contain all of those text patterns.
    let cursor = 0, clean = '';
    for (const range of embeddedSfzRanges(text)) {
      clean += text.slice(cursor, range.dataStart) + `embedded_${embeddedPayloads.length}\n`;
      embeddedPayloads.push(decodeEmbeddedSfzSample(text.slice(range.dataStart, range.end), maxBytes));
      cursor = range.end;
    }
    if (cursor) text = clean + text.slice(cursor);
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
  const initialCC = [];
  let global = Object.create(null);
  let master = Object.create(null);
  let group = Object.create(null);
  let scope = Object.create(null);
  let header = '';
  let defaultPath = '';
  let scriptPath = null;
  const headers = [];
  let seqGroup = 0;
  const finishRegion = () => {
    if (header !== 'region') return;
    const raw = Object.create(null);
    for (const inherited of [global, master, group, scope]) for (const [key, value] of Object.entries(inherited)) {
      delete raw[key];
      raw[key] = value;
    }
    pendingRegions.push({ raw, defaultPath, seqGroup });
  };
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index];
    if (marker[1]) {
      finishRegion();
      header = marker[1].toLowerCase();
      scope = Object.create(null);
      headers.push({ name: header, opcodes: scope });
      if (!HEADERS.has(header) && header !== 'sample') diagnostics.unsupportedHeaders.add(header);
      if (header === 'global') { global = scope; master = Object.create(null); group = Object.create(null); seqGroup++; }
      else if (header === 'master') { master = scope; group = Object.create(null); seqGroup++; }
      else if (header === 'group') { group = scope; seqGroup++; }
      continue;
    }
    const key = marker[2].toLowerCase();
    const value = unquote(text.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? text.length).trim());
    if (header === 'global' && key === 'script') {
      scope.script = value;
      scriptPath = normalizeSfzPath(value, directory);
    } else if (header === 'control' && key.startsWith('hint_')) diagnostics.excludedOpcodes.add(key);
    else if (header === 'control' && key === 'default_path') defaultPath = value.replaceAll('\\', '/');
    else if (header === 'effect' && key === 'tdfir_impulse') scope.tdfir_impulse = normalizeSfzPath(defaultPath + value, directory);
    else if (key === 'loop_end_offset') {
      if (header !== 'control' || !['0', '-1'].includes(value)) throw sfzError('prepare', 'The instrument loop correction must be 0 or -1 under control.');
      scope.loop_end_offset = value;
    }
    else if (header === 'control' && /^set_cc[0-9]{1,3}$/.test(key) && Number(key.slice(6)) < 128) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0 || number > 127) {
        throw sfzError('prepare', `Invalid SFZ opcode ${key}.`);
      }
      initialCC[Number(key.slice(6))] = number;
      delete scope[key]; scope[key] = value;
    }
    else if (header === 'control' && /^set_(?:hdcc|realcc)[0-9]{1,3}$/.test(key)) {
      const cc = Number(key.match(/[0-9]+$/)[0]), number = Number(value);
      if (cc > 127 || !Number.isFinite(number) || number < 0 || number > 1) throw sfzError('prepare', 'An instrument controller has an invalid initial value.');
      initialCC[cc] = Math.round(number * 127);
      const canonical = canonicalSfzOpcode(key);
      delete scope[canonical]; scope[canonical] = value;
    }
    else if (key === 'key') {
      delete scope.key; scope.key = value;
      scope.lokey = scope.hikey = scope.pitch_keycenter = value;
    } else {
      const canonical = header === 'effect' && isSfzEffectOpcode(key, header) ? key : canonicalSfzOpcode(key);
      delete scope[canonical];
      scope[canonical] = value;
      if (!SUPPORTED.has(canonical) && !Object.hasOwn(SFZ_EXTRA_DEFAULTS, canonical) &&
          !sfzControllerOpcode(canonical) && !isSfzModulationOpcode(canonical) && !isSfzEffectOpcode(canonical, header) &&
          !Object.hasOwn(SFZ_PITCH_CONTROL_RANGES, canonical) &&
          !(header === 'curve' && (canonical === 'curve_index' || /^v[0-9]{3}$/.test(canonical))) &&
          !(header === 'sample' && ['name', 'data'].includes(canonical)) &&
          !['sw_label', 'sw_note', 'global_label', 'master_label', 'group_label', 'region_label', 'image'].includes(canonical) &&
          !(canonical === 'md5' && (resolveSample || value === 'null')) &&
          !/^(?:label_key|label_cc|label_output)[0-9]{1,4}$/.test(canonical)) diagnostics.ignoredOpcodes.add(canonical);
    }
  }
  finishRegion();
  for (const header of headers) if (header.name === 'sample') {
    const token = /^embedded_([0-9]+)$/.exec(header.opcodes.data || '');
    const bytes = token && embeddedPayloads[Number(token[1])];
    if (!bytes || !header.opcodes.name) throw sfzError('prepare', 'An embedded instrument sample is incomplete.');
    const path = normalizeSfzPath(header.opcodes.name, directory);
    if (embeddedSamples.has(path)) throw sfzError('prepare', 'The instrument contains duplicate embedded sample names.');
    embeddedSamples.set(path, bytes);
  }
  let script = null;
  if (scriptPath !== null) {
    const source = await readText(scriptPath);
    if (typeof source !== 'string') throw sfzError('prepare', 'An instrument script could not be found.');
    if (source.length > 262144 || sourceChars + source.length > maxBytes) throw tooLarge();
    dependencies.add(scriptPath);
    script = { path: scriptPath, source };
  }
  let invalidRegionCount = 0;
  // All control headers describe the instrument's initial state, regardless of their position.
  for (const { raw, defaultPath: regionDefaultPath, seqGroup: regionSeqGroup } of pendingRegions) {
    try {
      if (!raw.sample) continue;
      let sample = Number(raw.end) === -1 ? '*silence' : isSfzGenerator(raw.sample) ? raw.sample : normalizeSfzPath(regionDefaultPath + unquote(raw.sample), directory);
      const region = normalizeRegion(raw, sample, regionSeqGroup, diagnostics.adjustedEnvelopes);
      sample = region.sample;
      const generator = isSfzGenerator(sample);
      if (Number(raw.end) !== -1 && raw.md5 && raw.md5 !== 'null') {
        if (!/^[a-f0-9]{32}$/i.test(raw.md5)) throw sfzError('sample-integrity', 'An instrument sample has an invalid content fingerprint.');
        if (generator) diagnostics.ignoredOpcodes.add('md5');
        else if (resolveSample) sample = normalizeSfzPath(await resolveSample(sample, raw.md5.toLowerCase(), embeddedSamples));
      }
      region.sample = sample;
      for (let cc = 0; cc < 128; cc++) {
        if (initialCC[cc] !== undefined) region[`set_cc${cc}`] = initialCC[cc];
      }
      if (generator && Number(raw.end) !== -1) {
        // Generated cycles have a fixed middle-C reference and sustain until note release.
        region.pitch_keycenter = 60;
        region.loop_mode = 2;
      }
      if (!generator && !embeddedSamples.has(sample) && hasSample && !hasSample(sample)) {
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
  if (diagnostics.adjustedEnvelopes.size) warnings.push({ code: 'envelope-times-adjusted', count: diagnostics.adjustedEnvelopes.size });
  const modulation = compileSfzModulation(regions, headers);
  if (modulation.diagnostics.length) onDiagnostic?.({ modulation: modulation.diagnostics });
  const effects = compileSfzEffectHeaders(regions, headers);
  if (effects?.diagnostics.length) {
    onDiagnostic?.({ effects: effects.diagnostics });
    throw sfzError('prepare', 'The instrument uses an effect setting that cannot be prepared.');
  }
  for (const path of effectSamplePaths(effects)) {
    if (!embeddedSamples.has(path) && hasSample && !hasSample(path)) throw sfzError('prepare',
      'An instrument effect sample could not be found. Select its complete folder and try again.');
    dependencies.add(path);
  }
  return { regions, dependencies: [...dependencies].sort(), diagnostics: detail, warnings, source: text, headers, script,
    modulation, effects, embeddedSamples, presentation: instrumentPresentation(headers, regions, directory),
    unsupportedOpcodes: [...detail.ignoredOpcodes, ...detail.unsupportedHeaders.map(name => `<${name}>`)] };
}
