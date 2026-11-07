import { sf2Error } from './parser.js';
import { SF2_MAX_ROUTES } from './modulation.js';

// Independently implemented from Creative/E-mu SoundFont 2.04, sections 8–10:
// https://www.synthfont.com/sfspec24.pdf
// Lane 60 is an internal initial-pitch destination, not the reserved file endOper.
export const SF2_INITIAL_PITCH = 60;
export const SF2_GENERATOR_DEFAULTS = Object.freeze(Array.from({ length: 61 }, (_, id) =>
  id === 8 ? 13500 : [21, 23, 25, 26, 27, 28, 30, 33, 34, 35, 36, 38].includes(id) ? -12000 :
    [46, 47, 58].includes(id) ? -1 : id === 56 ? 100 : [43, 44].includes(id) ? 0x7f00 : 0));
const RESERVED = new Set([14, 18, 19, 20, 42, 49, 55, 59, 60]);
const INSTRUMENT_ONLY = new Set([0, 1, 2, 3, 4, 12, 45, 46, 47, 50, 53, 54, 57, 58]);
const NON_MODULATED = new Set([41, 43, 44, 46, 47, 53, 54, 56, 57, 58]);
const defaults = [
  [0x0502, 48, 960, 0], [0x0102, 8, -2400, 0], [13, 6, 50, 0], [0x81, 6, 50, 0],
  [0x0587, 48, 960, 0], [0x028a, 17, 500, 0], [0x058b, 48, 960, 0],
  [0xdb, 16, 200, 0], [0xdd, 15, 200, 0], [0x020e, SF2_INITIAL_PITCH, 12700, 16]
];
export const SF2_DEFAULT_MODULATORS = Object.freeze(defaults.map(([source, destination, amount, amountSource]) =>
  Object.freeze({ source, destination, amount, amountSource, transform: 0 })));

function validSource(value, amountSource = false) {
  if (value >>> 10 > 3) return false;
  const index = value & 127;
  if (value & 128) return ![0, 6, 32, 38, 98, 99, 100, 101].includes(index) && index < 120 && !(index >= 33 && index <= 63);
  return [0, 2, 3, 10, 13, 14, 16].includes(index) || index === 127 && !amountSource;
}

// Link destinations are zone-relative. Canonical identities include the target
// identity, so global/local replacement never accidentally links another zone.
function compileModulators(records, identities, diagnostics, isDefault = false) {
  const nodes = records.map((record, index) => ({ ...record, index, incoming: [], key: null }));
  for (const node of nodes) {
    const linked = Boolean(node.destination & 0x8000), target = node.destination & 0x7fff;
    node.valid = validSource(node.source) && validSource(node.amountSource, true) && [0, 2].includes(node.transform) &&
      (linked ? target < nodes.length && (nodes[target].source & 255) === 127 :
        node.destination >= 0 && node.destination < 60 && !RESERVED.has(node.destination) && !NON_MODULATED.has(node.destination) ||
        isDefault && node.destination === SF2_INITIAL_PITCH);
    if (linked && node.valid) { node.target = nodes[target]; nodes[target].incoming.push(node); }
  }
  const queue = nodes.filter(node => node.valid && !node.target);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if ((node.source & 255) === 127 && !node.incoming.some(input => input.valid)) continue;
    const signature = `${node.source}:${node.target ? `m${node.target.key}` : `g${node.destination}`}:${node.amountSource}:${node.transform}`;
    if (!identities.has(signature)) identities.set(signature, identities.size);
    node.key = identities.get(signature);
    for (const input of node.incoming) if (input.valid) queue.push(input);
  }
  const result = new Map();
  for (const node of nodes) {
    if (node.key === null) { diagnostics.ignoredModulators++; continue; }
    const { source, destination, amount, amountSource, transform, key } = node;
    result.set(key, { source, destination, amount, amountSource, transform, key,
      link: node.target?.key ?? null });
  }
  return result;
}

function zones(tables, header, prefix, index, identities, diagnostics) {
  const result = [], bags = tables[`${prefix}bag`], generators = tables[`${prefix}gen`], modulators = tables[`${prefix}mod`];
  const terminal = prefix === 'p' ? 41 : 53;
  for (let bag = header[index].bag; bag < header[index + 1].bag; bag++) {
    const begin = bags[bag], end = bags[bag + 1], values = new Map();
    for (let at = begin.generator; at < end.generator; at++) {
      const gen = generators[at], id = gen.operator, position = at - begin.generator;
      if (id > 60 || RESERVED.has(id) || prefix === 'p' && INSTRUMENT_ONLY.has(id) || prefix === 'i' && id === 41 ||
          id === 43 && position !== 0 || id === 44 && !(position === 0 || position === 1 && generators[begin.generator].operator === 43)) {
        diagnostics.ignoredGenerators++; continue;
      }
      values.set(id, [41, 43, 44, 53].includes(id) ? gen.unsignedAmount : gen.amount);
      if (id === terminal) break;
    }
    const mods = compileModulators(modulators.slice(begin.modulator, end.modulator), identities, diagnostics);
    if (!values.has(terminal) && bag !== header[index].bag) { diagnostics.ignoredZones++; continue; }
    // Some widely used banks place sampleModes in the instrument global zone.
    // Retain it as the zone default; a local value, including zero, replaces it.
    result.push({ generators: values, modulators: mods });
  }
  const global = result[0] && !result[0].generators.has(terminal) ? result.shift() : null;
  return result.map(zone => ({ generators: new Map([...(global?.generators || []), ...zone.generators]),
    modulators: new Map([...(global?.modulators || []), ...zone.modulators]) }));
}

const intersect = (a, b) => [Math.max(a & 255, b & 255), Math.min(a >>> 8, b >>> 8)];

export function compileSf2(parsed, { presetIndex = null } = {}) {
  const { tables } = parsed, identities = new Map(), diagnostics = { ignoredGenerators: 0, ignoredModulators: 0, ignoredZones: 0, adjustedLoops: 0 };
  const defaultMods = compileModulators(SF2_DEFAULT_MODULATORS, identities, diagnostics, true);
  const instruments = new Map(), regions = [], presets = [];
  let routeCount = 0;
  if (presetIndex !== null && (!Number.isInteger(presetIndex) || presetIndex < 0 || presetIndex >= parsed.presets.length)) throw sf2Error('Invalid preset selection');
  for (const preset of parsed.presets) {
    if (presetIndex !== null && preset.index !== presetIndex) continue;
    const firstRegion = regions.length;
    for (const presetZone of zones(tables, tables.phdr, 'p', preset.index, identities, diagnostics)) {
      const instrumentId = presetZone.generators.get(41);
      if (instrumentId >= tables.inst.length - 1) throw sf2Error('Invalid instrument reference');
      if (!instruments.has(instrumentId)) instruments.set(instrumentId, zones(tables, tables.inst, 'i', instrumentId, identities, diagnostics));
      for (const instrument of instruments.get(instrumentId)) {
        const sampleId = instrument.generators.get(53), sample = tables.shdr[sampleId];
        if (sampleId >= tables.shdr.length - 1) throw sf2Error('Invalid sample reference');
        const keyRange = intersect(instrument.generators.get(43) ?? 0x7f00, presetZone.generators.get(43) ?? 0x7f00);
        const velocityRange = intersect(instrument.generators.get(44) ?? 0x7f00, presetZone.generators.get(44) ?? 0x7f00);
        if (keyRange[0] > keyRange[1] || velocityRange[0] > velocityRange[1]) continue;
        if (keyRange[1] > 127 || velocityRange[1] > 127) throw sf2Error('Invalid MIDI zone range');
        const generators = new Float64Array(SF2_GENERATOR_DEFAULTS);
        for (const [id, amount] of instrument.generators) generators[id] = amount;
        for (const [id, amount] of presetZone.generators) if (![41, 43, 44].includes(id)) generators[id] += amount;
        const start = sample.start + generators[0] + 32768 * generators[4];
        const end = sample.end + generators[1] + 32768 * generators[12];
        // Distributed banks contain zones that no synthesizer can sound: ROM or zero-rate
        // samples, and address offsets past the sample (for example a coarse start offset
        // authored for a longer sample). Such zones are dropped like other unusable zones
        // rather than failing the whole bank.
        if (sample.sampleType & 0x8000 || sample.sampleRate < 1 || sample.sampleRate > 768000 ||
            start < 0 || end <= start || end > (sample.compressed?.frames ?? parsed.sampleFrames)) {
          diagnostics.ignoredZones++; continue;
        }
        const requestedLoopStart = sample.loopStart + generators[2] + 32768 * generators[45];
        const requestedLoopEnd = sample.loopEnd + generators[3] + 32768 * generators[50];
        // Section 10.5 clips out-of-range synthesis parameters to their nearest
        // realizable value; sample addresses themselves must remain in the pool.
        let loopStart = Math.max(start, Math.min(end, requestedLoopStart));
        let loopEnd = Math.max(start, Math.min(end, requestedLoopEnd));
        const looped = generators[54] & 1;
        if (looped && loopEnd <= loopStart) {
          loopStart = Math.max(start, sample.loopStart);
          loopEnd = Math.min(end, sample.loopEnd);
          // A loop that is still empty cannot be realized, so the zone plays unlooped,
          // as common synthesizers do for distributed banks with zero-length loops.
          if (loopEnd <= loopStart) generators[54] = 0;
        }
        if (looped && (!(generators[54] & 1) || loopStart !== requestedLoopStart || loopEnd !== requestedLoopEnd)) diagnostics.adjustedLoops++;
        // Every sample plays as an individual mono source, so a type without channel
        // flags (written by some editors) is mono; only declared links must resolve.
        if ([2, 4, 8].includes(sample.sampleType & ~0x10) && sample.sampleLink >= tables.shdr.length - 1) {
          throw sf2Error(`Invalid sample link: ${JSON.stringify({ sampleId, sample })}`);
        }
        const mods = new Map([...defaultMods, ...instrument.modulators]);
        for (const [key, mod] of presetZone.modulators) mods.set(key, { ...mod, amount: mod.amount + (mods.get(key)?.amount ?? 0) });
        const selected = [...mods.values()], indices = new Map(selected.map((mod, index) => [mod.key, index]));
        routeCount += selected.length;
        if (selected.length > 65536 || routeCount > SF2_MAX_ROUTES) throw sf2Error('Too many compiled SoundFont modulation routes');
        const compiledMods = selected.map(({ key: _key, link, ...mod }) => ({ ...mod, link: link === null ? -1 : indices.get(link) ?? -1 }));
        regions.push({ presetIndex: preset.index, bank: preset.bank, program: preset.program, sampleId, keyRange, velocityRange,
          generators, modulators: compiledMods, sample: { ...sample, start, end, loopStart, loopEnd,
            originalPitch: sample.originalPitch > 127 ? 60 : sample.originalPitch } });
        if (regions.length > 262144) throw sf2Error('Too many compiled SoundFont zones');
      }
    }
    presets.push({ ...preset, firstRegion, regionCount: regions.length - firstRegion });
  }
  return { format: 'sf2', sourceProfile: `${parsed.format}-${parsed.version.major}.${String(parsed.version.minor).padStart(2, '0')}`, presets, regions, diagnostics };
}
