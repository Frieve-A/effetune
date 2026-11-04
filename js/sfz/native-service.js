import { sfzRequiresSampleStreaming } from './asset.js';
import { getSfzMaxBytes, requireSfzMaxBytes } from './limits.js';
import { normalizeSfzPath, parseSfz, sfzError } from './parser.js';
import { prepareSfzSamples, selectSfzRegionsForBudget, prepareSfzPresentation } from './service.js';
import { decodeSfzText, readSfzBankDefines } from './source.js';
import { isSfzGenerator, sfzGeneratorMetadata } from './generators.js';
import { requireSfzSampleRange, createSfzMemorySampleReader } from './sample-reader.js';
import { parseIrAudioHeader } from '../ir-library/audio-header-metadata.js';
import { openSf2Source } from '../sf2/source.js';
import { createSfzSampleIntegrity } from './sample-integrity.js';
import { effectSamplePaths } from './effects-asset.js';
import { openSfzProtectedRangePort } from './sample-supply-port.js';

const VALID_ID = /^[a-f0-9]{24}$/;

function responseData(response, failureCode = 'storage') {
  if (response?.ok === true) return response.data;
  throw sfzError(response?.code === 'too-large' ? 'too-large' : failureCode,
    'The selected SFZ files could not be read.');
}

function entriesFromResponse(response) {
  const entries = responseData(response);
  if (!Array.isArray(entries) || entries.length > 10000 || entries.some(entry =>
    !VALID_ID.test(entry?.id) || typeof entry.name !== 'string' ||
    typeof entry.selectedPath !== 'string' || !/\.(sf2|sf3|sfz)$/i.test(entry.selectedPath) ||
    normalizeSfzPath(entry.selectedPath) !== entry.selectedPath ||
    (entry.bankPaths !== undefined && (!Array.isArray(entry.bankPaths) || entry.bankPaths.length > 10000 ||
      entry.bankPaths.some(path => typeof path !== 'string' || !/\.bank\.xml$/i.test(path) ||
        normalizeSfzPath(path) !== path))))) {
    throw sfzError('storage', 'The SFZ file list could not be read.');
  }
  return entries;
}

export class NativeSfzLibraryService {
  constructor(bridge, { onDiagnostic = detail => console.warn('SFZ library:', detail),
    getMaxBytes = () => getSfzMaxBytes(globalThis.window?.appConfig?.sfzMaxSizeMiB) } = {}) {
    if (bridge?.apiVersion !== 1) throw sfzError('storage', 'Native SFZ file access is unavailable.');
    this.bridge = bridge;
    this.onDiagnostic = onDiagnostic;
    this.getMaxBytes = getMaxBytes;
  }

  async selectFolder({ isCurrent } = {}) {
    return this._select('folder', isCurrent);
  }

  async selectFiles({ isCurrent } = {}) {
    return this._select('files', isCurrent);
  }

  async _select(mode, isCurrent) {
    if (isCurrent?.() === false) return null;
    const selected = responseData(await this.bridge.select({ mode }));
    if (isCurrent?.() === false || !selected) return null;
    return entriesFromResponse({ ok: true, data: selected.banks })
      .map(({ id, name, importedAt }) => ({ id, name, ...(importedAt && { importedAt }) }));
  }

  async list() {
    return entriesFromResponse(await this.bridge.list())
      .map(({ id, name, importedAt }) => ({ id, name, ...(importedAt && { importedAt }) }));
  }

  async remove(id) {
    if (!VALID_ID.test(id)) throw sfzError('storage', 'Invalid SFZ file identifier.');
    responseData(await this.bridge.remove({ id }));
  }

  async createSampleReader(id, path, metadata = null) {
    if (!VALID_ID.test(id) || typeof this.bridge.readRelativeRange !== 'function') {
      throw sfzError('prepare', 'Instrument sample streaming is unavailable.');
    }
    const relativePath = normalizeSfzPath(path);
    const info = metadata || responseData(await this.bridge.statRelative({ id, relativePath }), 'prepare');
    if (!info || !Number.isSafeInteger(info.size) || info.size < 0 ||
        typeof info.revision !== 'string' || !/^[a-f0-9]{64}$/.test(info.revision)) {
      throw sfzError('prepare', 'An instrument sample could not be opened. Reload the instrument.');
    }
    const { size, revision } = info;
    const bridge = this.bridge;
    return Object.freeze({ size, revision,
      rangeSource: { kind: 'protected', bankId: id, relativePath, revision, offset: 0 },
      openRangePort: typeof bridge.openRangePort === 'function' ? () => openSfzProtectedRangePort(bridge, id) : null,
      async readRange(offset, length) {
      requireSfzSampleRange(offset, length, size);
      const response = await bridge.readRelativeRange({ id, relativePath, offset, length, revision });
      if (response?.code === 'source-changed') {
        throw sfzError('source-changed', 'An instrument sample changed. Reload the instrument.');
      }
      const data = responseData(response, 'prepare');
      const bytes = data?.bytes;
      if (data?.revision !== revision || !(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
        throw sfzError('prepare', 'An instrument sample could not be read. Reload the instrument.');
      }
      return bytes;
    } });
  }

  async _readBank(id, maxBytes, onDiagnostic, { isCurrent, onSourceProgress } = {}) {
    if (!VALID_ID.test(id)) return null;
    const entry = entriesFromResponse(await this.bridge.list()).find(item => item.id === id);
    if (!entry) return null;
    const definitions = new Map();
    let rawBytes = 0;
    const read = async path => {
      if (definitions.has(path)) return definitions.get(path);
      const remaining = maxBytes - rawBytes;
      if (remaining < 1) throw sfzError('too-large', 'The SFZ files are too large to load.');
      const value = responseData(await this.bridge.readRelative({ id,
        relativePath: normalizeSfzPath(path), maxBytes: remaining }), 'prepare');
      if (value === null) return null;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      rawBytes += bytes.byteLength;
      if (rawBytes > maxBytes) throw sfzError('too-large', 'The SFZ files are too large to load.');
      return bytes;
    };
    const selected = await read(entry.selectedPath);
    if (!selected) return null;
    definitions.set(entry.selectedPath, selected);
    const readText = async path => {
      const bytes = await read(path);
      if (!bytes) return null;
      definitions.set(path, bytes);
      return decodeSfzText(bytes);
    };
    const { defines } = await readSfzBankDefines(entry.selectedPath, entry.bankPaths || [], readText);
    let embeddedSamples = new Map();
    const integrity = createSfzSampleIntegrity({
      isCurrent, onProgress: onSourceProgress, onDiagnostic, maxLookupBytes: maxBytes, maxLookupFiles: 10000,
      openReader: async path => {
        const embedded = embeddedSamples.get(path);
        if (embedded) return createSfzMemorySampleReader(embedded);
        const stats = responseData(await this.bridge.statRelative({ id, relativePath: path }), 'prepare');
        return stats ? this.createSampleReader(id, path, stats) : null;
      },
      candidatePaths: async path => {
        if (typeof this.bridge.listSampleCandidates !== 'function') return [...embeddedSamples.keys()];
        const response = await this.bridge.listSampleCandidates({ id, relativePath: path, maxEntries: 10000 });
        if (response?.code === 'sample-lookup-limit') throw sfzError('sample-lookup-limit',
          'The sample folder contains too many files to search. Restore the original sample name.');
        const candidates = responseData(response, 'prepare');
        if (!Array.isArray(candidates) || candidates.length > 10000 || candidates.some(candidate =>
          typeof candidate !== 'string' || normalizeSfzPath(candidate) !== candidate)) {
          throw sfzError('prepare', 'The instrument sample folder could not be searched.');
        }
        return [...embeddedSamples.keys(), ...candidates];
      }
    });
    const resolveSample = (path, md5, embedded) => {
      embeddedSamples = embedded;
      return integrity.resolve(path, md5);
    };
    const first = await parseSfz({ selectedPath: entry.selectedPath, readText, maxBytes, defines,
      hasSample: () => true, resolveSample, onDiagnostic: null });
    const present = new Set();
    const metadata = new Map();
    for (const path of [...new Set([...first.regions.map(region => region.sample), ...effectSamplePaths(first.effects)])].sort()) {
      if (isSfzGenerator(path)) {
        metadata.set(path, sfzGeneratorMetadata(path));
        present.add(path);
        continue;
      }
      const embedded = first.embeddedSamples.get(path);
      if (embedded) {
        metadata.set(path, { size: embedded.byteLength, ...parseIrAudioHeader(embedded) });
        present.add(path);
        continue;
      }
      const stats = responseData(await this.bridge.statRelative({ id, relativePath: path }), 'prepare');
      if (!stats) continue;
      if (!Number.isSafeInteger(stats.size) || stats.size < 0) {
        throw sfzError('prepare', 'An SFZ sample has an invalid size.');
      }
      metadata.set(path, stats);
      present.add(path);
    }
    // Reuse the parser's missing-sample filtering without enumerating the source folder.
    const parsed = await parseSfz({ selectedPath: entry.selectedPath, readText, maxBytes, defines,
      hasSample: path => present.has(path), resolveSample, onDiagnostic });
    if (!parsed.regions.length) throw sfzError('no-regions', 'The SFZ has no playable regions.');
    return { entry, parsed, metadata, read, rawBytes, definitionCount: definitions.size,
      createSampleReader: path => parsed.embeddedSamples.has(path)
        ? createSfzMemorySampleReader(parsed.embeddedSamples.get(path)) : this.createSampleReader(id, path, metadata.get(path)) };
  }

  async readMetadata(id) {
    const entry = entriesFromResponse(await this.bridge.list()).find(item => item.id === id);
    if (entry && /\.sf[23]$/i.test(entry.selectedPath)) {
      const reader = await this.createSampleReader(id, entry.selectedPath);
      const source = await openSf2Source(reader);
      return { size: reader.size, fileCount: 1, regionCount: source.compiled.regions.length,
        format: source.parsed.format, presets: source.compiled.presets };
    }
    const bank = await this._readBank(id, requireSfzMaxBytes(this.getMaxBytes()), null);
    if (!bank) return null;
    const samples = [...bank.metadata.values()].filter(info => info.size > 0);
    return { size: bank.rawBytes + samples.reduce((sum, info) => sum + info.size, 0),
      fileCount: bank.definitionCount + samples.length, regionCount: bank.parsed.regions.length };
  }

  async prepare(id, { decode, prepareStreamedBank, prepareSoundFontBank, isCurrent, onSourceProgress, onPreparationProgress, preparationContext, estimateEffectBytes } = {}) {
    const maxBytes = requireSfzMaxBytes(this.getMaxBytes());
    const selected = entriesFromResponse(await this.bridge.list()).find(item => item.id === id);
    if (selected && /\.sf[23]$/i.test(selected.selectedPath)) {
      if (typeof prepareSoundFontBank !== 'function') throw sfzError('prepare', 'SoundFont playback is unavailable. Reload the app and try again.');
      const source = await openSf2Source(await this.createSampleReader(id, selected.selectedPath));
      const value = await prepareSoundFontBank({ id, source, maxBytes, onDiagnostic: this.onDiagnostic,
        onProgress: onPreparationProgress, preparationContext, estimateEffectBytes });
      if (!entriesFromResponse(await this.bridge.list()).some(item => item.id === id)) return null;
      return { ...value, name: selected.name, format: source.parsed.format, presets: source.compiled.presets };
    }
    const bank = await this._readBank(id, maxBytes, this.onDiagnostic, { isCurrent, onSourceProgress });
    if (!bank) return null;
    const { entry, parsed, metadata, read, rawBytes } = bank;
    let streamed = typeof prepareStreamedBank === 'function' && sfzRequiresSampleStreaming(parsed.regions);
    if (!streamed) try { selectSfzRegionsForBudget(parsed.regions, metadata, maxBytes, rawBytes); }
    catch (error) {
      // The caller supplies this path only after the target DSP has advertised
      // sample-provider support. An older runtime retains the resident contract.
      if (error?.code !== 'too-large' || typeof prepareStreamedBank !== 'function') throw error;
      streamed = true;
    }
    let value;
    if (!streamed) try {
      value = await prepareSfzSamples(parsed, async path => {
        const bytes = await read(path);
        if (!bytes) throw sfzError('prepare', 'An SFZ sample could not be found.');
        return bytes;
      }, decode, maxBytes, this.onDiagnostic, { preparationContext, estimateEffectBytes, onProgress: onPreparationProgress });
    } catch (error) {
      if (error?.code !== 'too-large' || typeof prepareStreamedBank !== 'function') throw error;
      streamed = true;
    }
    if (streamed) value = await prepareStreamedBank({ id, parsed, metadata, maxBytes,
      definitionBytes: rawBytes, createSampleReader: bank.createSampleReader,
      onDiagnostic: this.onDiagnostic, onProgress: onPreparationProgress, preparationContext, estimateEffectBytes });
    if (!entriesFromResponse(await this.bridge.list()).some(item => item.id === id)) return null;
    const sourceBytes = rawBytes + [...metadata].reduce((bytes, [path, info]) =>
      bytes + (parsed.embeddedSamples.has(path) ? 0 : info.size || 0), 0);
    return { ...value, sourceBytes, presentation: value.presentation ?? await prepareSfzPresentation(parsed, read), name: entry.name };
  }
}
