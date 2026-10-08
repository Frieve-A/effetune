import { openIrLibraryBackend } from '../ir-library/ir-library-factory.js';
import { parseIrAudioHeader } from '../ir-library/audio-header-metadata.js';
import { decodeSfzBank, encodeSfzBank, identifySfzBank, readSfzAudioHeader, estimateSfzBankBytes } from './bank.js';
import { packSfzAsset, SFZ_REGION_FIELDS } from './asset.js';
import { getSfzMaxBytes, requireSfzMaxBytes } from './limits.js';
import { normalizeSfzPath, parseSfz, sfzError } from './parser.js';

const pathsByFile = new WeakMap();
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const VALID_ID = /^[a-f0-9]{24}$/;
let defaultServicePromise;

function fileMap(files) {
  const entries = Array.from(files || []);
  if (entries.length > 10000) throw sfzError('prepare', 'The SFZ folder contains too many files.');
  const rootNames = entries.filter(file => !pathsByFile.has(file)).map(file => file.webkitRelativePath?.split('/')[0]);
  const stripRoot = rootNames.length > 0 && rootNames.every(name => name && name === rootNames[0]);
  const result = new Map();
  for (const file of entries) {
    let path = pathsByFile.get(file) || file.webkitRelativePath || file.name;
    if (!pathsByFile.has(file) && stripRoot) path = path.slice(path.indexOf('/') + 1);
    path = normalizeSfzPath(path);
    if (!path || result.has(path)) throw sfzError('prepare', 'The SFZ folder contains duplicate file paths.');
    result.set(path, file);
  }
  return result;
}

export function listSfzFolderFiles(files) {
  return [...fileMap(files).keys()].filter(path => /\.sfz$/i.test(path)).sort();
}

export async function enumerateSfzDirectory(directoryHandle, { isCurrent } = {}) {
  const files = [];
  async function visit(directory, depth, prefix) {
    if (isCurrent?.() === false) throw sfzError('cancelled', 'SFZ import was cancelled.');
    if (depth > 32) throw sfzError('prepare', 'The SFZ folder is nested too deeply.');
    for await (const [name, handle] of directory.entries()) {
      if (isCurrent?.() === false) throw sfzError('cancelled', 'SFZ import was cancelled.');
      const path = normalizeSfzPath(name, prefix);
      if (handle.kind === 'directory') await visit(handle, depth + 1, path);
      else if (handle.kind === 'file') {
        if (files.length >= 10000) throw sfzError('prepare', 'The SFZ folder contains too many files.');
        const file = await handle.getFile();
        pathsByFile.set(file, path);
        files.push(file);
      }
    }
  }
  await visit(directoryHandle, 0, '');
  return files;
}

async function parseBankFiles(selectedPath, files, onDiagnostic, maxBytes) {
  return parseSfz({ selectedPath, maxBytes,
    readText: async path => {
      const bytes = files.get(path);
      return bytes ? decoder.decode(bytes) : null;
    },
    hasSample: path => files.has(path), onDiagnostic });
}

async function prepareBank(bytes, decode, onDiagnostic, maxBytes) {
  const bank = decodeSfzBank(bytes, { maxBytes });
  const parsed = await parseBankFiles(bank.selectedPath, bank.files, onDiagnostic, maxBytes);
  parsed.warnings = mergeSfzWarnings(bank.warnings, parsed.warnings);
  return { ...await prepareSfzSamples(parsed, path => bank.files.get(path), decode, maxBytes, onDiagnostic),
    name: bank.selectedPath.split('/').pop() };
}

export function mergeSfzWarnings(...groups) {
  const counts = new Map();
  // Re-parsing a stored definition must not count the same omission a second time.
  for (const group of groups) for (const { code, count } of group || []) {
    counts.set(code, Math.max(counts.get(code) || 0, count));
  }
  return [...counts].map(([code, count]) => ({ code, count }))
    .sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
}

export async function prepareSfzSamples(parsed, readSample, decode, maxBytes, onDiagnostic) {
  if (typeof decode !== 'function') throw sfzError('prepare', 'SFZ audio decoding is unavailable.');
  const samples = new Map();
  let decodedBytes = 0;
  for (const path of [...new Set(parsed.regions.map(region => region.sample))].sort()) {
    const bytes = await readSample(path);
    const header = parseIrAudioHeader(bytes);
    if (header.channels > 2) throw sfzError('prepare', 'SFZ samples must contain mono or stereo audio.');
    if (header.frames && decodedBytes + header.frames * header.channels * 4 > maxBytes) {
      throw sfzError('too-large', 'The SFZ samples are too large to load.');
    }
    const pcm = await decode(bytes.slice().buffer, header?.sampleRate ?? null);
    decodedBytes += (pcm?.channels?.length ?? 0) * (pcm?.channels?.[0]?.length ?? 0) * 4;
    if (decodedBytes > maxBytes) throw sfzError('too-large', 'The SFZ samples are too large to load.');
    samples.set(path, pcm);
  }
  const recovered = [];
  const descriptor = packSfzAsset(parsed.regions, samples, { maxBytes,
    onDiagnostic: onDiagnostic ?? undefined, onWarning: warning => {
      // Parser omissions and sample-aware omissions concern different regions.
      if (warning.code === 'invalid-regions') warning = { ...warning,
        count: warning.count + (parsed.warnings?.find(item => item.code === warning.code)?.count || 0) };
      recovered.push(warning);
      console.warn('SFZ load warnings:', warning);
    } });
  const warnings = mergeSfzWarnings(parsed.warnings, recovered);
  const regionCount = new DataView(descriptor.payload, 32, 32).getUint32(8, true);
  return { descriptor, regionCount, ...(warnings.length ? { warnings } : {}) };
}

export function selectSfzRegionsForBudget(regions, metadata, maxBytes, definitionBytes = 0) {
  const fits = candidate => {
    const paths = new Set(candidate.map(region => region.sample));
    let rawBytes = definitionBytes;
    let decodedBytes = 0;
    for (const path of paths) {
      const info = metadata.get(path);
      if (!info) return false;
      rawBytes += info.size;
      decodedBytes += (info.frames || 0) * (info.channels || 0) * 4;
    }
    const groups = new Set(candidate.map(region => region.seqGroup)).size;
    const indexEntries = candidate.reduce((sum, region) => sum + region.hikey - region.lokey + 1, 0);
    const footprint = 64 + 4 * SFZ_REGION_FIELDS.length * candidate.length + decodedBytes +
      4 * (129 + 2 * groups + indexEntries);
    return rawBytes <= maxBytes && footprint <= maxBytes;
  };
  if (fits(regions)) return { regions, reduced: false };
  const byKey = Array.from({ length: 128 }, () => []);
  const originalKeys = new Set();
  for (const region of regions) {
    const info = metadata.get(region.sample);
    for (let key = region.lokey; key <= region.hikey; key++) {
      originalKeys.add(key);
      if (info?.frames > 0 && info.channels > 0 && info.channels <= 2) byKey[key].push(region);
    }
  }
  const keyCount = byKey.filter(items => items.length).length;
  if (!keyCount || keyCount !== originalKeys.size) throw sfzError('too-large', 'The SFZ cannot fit its playable note range.');
  // Try every MIDI velocity, retaining complete key coverage and one representative per key.
  const velocities = Array.from({ length: 127 }, (_, index) => index + 1)
    .sort((a, b) => Math.abs(a - 64) - Math.abs(b - 64) || a - b);
  for (const velocity of velocities) {
    const selected = [];
    for (let key = 0; key < byKey.length; key++) {
      let best;
      let bestDistance = Infinity;
      let bestBytes = Infinity;
      for (const region of byKey[key]) {
        const distance = velocity < region.lovel ? region.lovel - velocity :
          velocity > region.hivel ? velocity - region.hivel : 0;
        const info = metadata.get(region.sample);
        const bytes = info.frames * info.channels * 4;
        if (distance < bestDistance || (distance === bestDistance && bytes < bestBytes)) {
          best = region; bestDistance = distance; bestBytes = bytes;
        }
      }
      if (!best) continue;
      const previous = selected.at(-1);
      if (previous?.source === best && previous.region.hikey === key - 1) previous.region.hikey = key;
      else selected.push({ source: best, region: { ...best, lokey: key, hikey: key,
        lovel: 1, hivel: 127, lorand: 0, hirand: 1, seq_length: 1, seq_position: 1 } });
    }
    const candidate = selected.map(item => item.region);
    if (fits(candidate)) return { regions: candidate, reduced: true, velocity, keyCount };
  }
  throw sfzError('too-large', 'The SFZ cannot fit its playable note range.');
}

function representativeSfzText(regions, selectedPath) {
  const root = '../'.repeat(selectedPath.split('/').length - 1);
  const loopModes = ['no_loop', 'one_shot', 'loop_continuous', 'loop_sustain'];
  return regions.map(region => '<region> sample=' + JSON.stringify(root + region.sample) + ' ' +
    SFZ_REGION_FIELDS.slice(4).filter(key => key !== 'seqGroup' && region[key] !== undefined)
      .map(key => `${key}=${key === 'loop_mode' ? loopModes[region[key]] : region[key]}`).join(' ')).join('\n');
}

export class SfzLibraryService {
  constructor(backend, { onDiagnostic = detail => console.warn('SFZ library:', detail),
    getMaxBytes = () => getSfzMaxBytes(globalThis.window?.appConfig?.sfzMaxSizeMiB) } = {}) {
    this.backend = backend;
    this.onDiagnostic = onDiagnostic;
    this.getMaxBytes = getMaxBytes;
    this.entries = [];
    this.prepared = null;
    this.writes = Promise.resolve();
  }

  async open() {
    try {
      await this.backend.cleanupTemporary?.();
      const bytes = await this.backend.read('index.json');
      if (bytes) {
        const index = JSON.parse(decoder.decode(bytes));
        if (index.version !== 1 || !Array.isArray(index.entries) || index.entries.length > 10000 ||
            index.entries.some(entry => !VALID_ID.test(entry.id) || typeof entry.name !== 'string' ||
              !Number.isSafeInteger(entry.regionCount) || entry.regionCount < 1)) {
          throw new Error('Invalid SFZ library index.');
        }
        this.entries = index.entries;
      }
      return this;
    } catch (cause) { throw sfzError('storage', 'The SFZ library could not be opened.', cause); }
  }

  async list() {
    await this.writes;
    return this.entries.map(entry => ({ ...entry }));
  }

  async importFolderFiles(files, selectedPath, options = {}) {
    const maxBytes = requireSfzMaxBytes(this.getMaxBytes());
    const selectedFiles = fileMap(files);
    selectedPath = normalizeSfzPath(selectedPath);
    const read = async path => {
      const file = selectedFiles.get(path);
      if (!file) return null;
      if (file.size > maxBytes) throw sfzError('too-large', 'An SFZ file is too large to save.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw sfzError('too-large', 'An SFZ file is too large to save.');
      return bytes;
    };
    const storedFiles = new Map();
    const parsed = await parseSfz({ selectedPath, maxBytes,
      readText: async path => {
        let bytes = storedFiles.get(path);
        if (!bytes) {
          bytes = await read(path);
          if (!bytes) return null;
          storedFiles.set(path, bytes);
        }
        return decoder.decode(bytes);
      },
      hasSample: path => selectedFiles.has(path), onDiagnostic: this.onDiagnostic });
    if (!parsed.regions.length) throw sfzError('no-regions', 'The SFZ has no playable regions.');
    let accumulatedBytes = [...storedFiles.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
    const metadata = new Map();
    const sizes = new Map([...storedFiles].map(([path, bytes]) => [path, bytes.byteLength]));
    for (const path of [...new Set(parsed.regions.map(region => region.sample))].sort()) {
      const file = selectedFiles.get(path);
      const header = typeof file.slice === 'function'
        ? await readSfzAudioHeader(async (position, length) =>
          new Uint8Array(await file.slice(position, position + length).arrayBuffer()), file.size) : {};
      metadata.set(path, { size: file.size, ...header });
      sizes.set(path, file.size);
    }
    const rawSize = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    const containerBytes = estimateSfzBankBytes(selectedPath, sizes) - rawSize;
    const selection = selectSfzRegionsForBudget(parsed.regions, metadata, maxBytes, accumulatedBytes + containerBytes);
    if (selection.reduced) this.onDiagnostic?.({ reducedBank: { originalRegions: parsed.regions.length,
      selectedRegions: selection.regions.length, keys: selection.keyCount,
      representativeVelocity: selection.velocity } });
    parsed.regions = selection.regions;
    if (selection.reduced) {
      parsed.warnings = mergeSfzWarnings(parsed.warnings, [{ code: 'reduced-bank', count: 1 }]);
      storedFiles.clear();
      storedFiles.set(selectedPath, encoder.encode(representativeSfzText(parsed.regions, selectedPath)));
      accumulatedBytes = storedFiles.get(selectedPath).byteLength;
    }
    for (const path of [...new Set(parsed.regions.map(region => region.sample))].sort()) {
      if (storedFiles.has(path)) continue;
      const file = selectedFiles.get(path);
      if (Number.isFinite(file?.size) && accumulatedBytes + file.size > maxBytes) {
        throw sfzError('too-large', 'The SFZ bank is too large to save.');
      }
      const bytes = await read(path);
      accumulatedBytes += bytes.byteLength;
      if (accumulatedBytes > maxBytes) throw sfzError('too-large', 'The SFZ bank is too large to save.');
      storedFiles.set(path, bytes);
    }
    const bytes = encodeSfzBank(selectedPath, storedFiles, { maxBytes,
      warnings: selection.reduced ? parsed.warnings : [] });
    const id = await identifySfzBank(bytes);
    const prepared = { ...await prepareSfzSamples(parsed, path => storedFiles.get(path),
      options.decode, maxBytes, this.onDiagnostic), name: selectedPath.split('/').pop() };
    const entry = { id, name: selectedPath.split('/').pop(), regionCount: prepared.regionCount };
    await this._write(async () => {
      try {
        await this.backend.writeAtomic(`${id}.sfzbank`, bytes);
        const entries = this.entries.filter(item => item.id !== id).concat(entry)
          .sort((a, b) => a.id < b.id ? -1 : 1);
        await this._saveIndex(entries);
        this.entries = entries;
        this.prepared = { id, bankBytes: bytes.byteLength, value: prepared };
      } catch (cause) { throw sfzError('storage', 'The SFZ bank could not be saved.', cause); }
    });
    return { ...entry };
  }

  async prepare(id, { decode } = {}) {
    const maxBytes = requireSfzMaxBytes(this.getMaxBytes());
    if (!VALID_ID.test(id)) return null;
    await this.writes;
    const entry = this.entries.find(item => item.id === id);
    if (!entry) return null;
    if (this.prepared?.id === id) {
      if (this.prepared.bankBytes > maxBytes || this.prepared.value.descriptor.footprintBytes > maxBytes) {
        throw sfzError('too-large', 'The SFZ bank is too large to load.');
      }
      return this.prepared.value;
    }
    let bytes;
    try { bytes = await this.backend.read(`${id}.sfzbank`); }
    catch (cause) { throw sfzError('storage', 'The SFZ bank could not be read.', cause); }
    if (!bytes) return null;
    try {
      const value = await prepareBank(bytes, decode, this.onDiagnostic, maxBytes);
      await this.writes;
      if (!this.entries.includes(entry)) return null;
      this.prepared = { id, bankBytes: bytes.byteLength, value };
      return value;
    } catch (cause) {
      if (cause?.code) throw cause;
      throw sfzError('prepare', 'The SFZ bank could not be prepared.', cause);
    }
  }

  async remove(id) {
    if (!VALID_ID.test(id)) throw sfzError('storage', 'Invalid SFZ bank identifier.');
    await this._write(async () => {
      try {
        const entries = this.entries.filter(entry => entry.id !== id);
        await this._saveIndex(entries);
        this.entries = entries;
        await this.backend.remove(`${id}.sfzbank`);
        if (this.prepared?.id === id) this.prepared = null;
      } catch (cause) { throw sfzError('storage', 'The SFZ bank could not be removed.', cause); }
    });
  }

  _saveIndex(entries) {
    return this.backend.writeAtomic('index.json', encoder.encode(JSON.stringify({ version: 1, entries })));
  }

  _write(operation) {
    const promise = this.writes.then(operation);
    this.writes = promise.catch(() => {});
    return promise;
  }
}

export function getDefaultSfzLibraryService(options = {}) {
  if (!defaultServicePromise) {
    const nativeBridge = options.nativeBridge || globalThis.window?.electronAPI?.sfzLibraryV1;
    defaultServicePromise = (nativeBridge
      ? import('./native-service.js').then(({ NativeSfzLibraryService }) => new NativeSfzLibraryService(nativeBridge, options))
      : openIrLibraryBackend({ ...options, namespace: 'sfz-library' })
        .then(backend => new SfzLibraryService(backend, options).open())).catch(cause => {
        defaultServicePromise = null;
        throw sfzError('storage', 'The SFZ library is unavailable.', cause);
      });
  }
  return defaultServicePromise;
}
