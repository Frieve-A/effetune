import { openIrLibraryBackend } from '../ir-library/ir-library-factory.js';
import { parseIrAudioHeader } from '../ir-library/audio-header-metadata.js';
import { decodeSfzBank, encodeSfzBank, identifySfzBank, readSfzAudioHeader, estimateSfzBankBytes } from './bank.js';
import { packSfzAsset, sfzRequiresSampleStreaming, SFZ_REGION_FIELDS, SFZ_TABLE_HEADER_WORDS } from './asset.js';
import { getSfzMaxBytes, requireSfzMaxBytes, SFZ_MAX_SUPPORTED_BYTES } from './limits.js';
import { normalizeSfzPath, parseSfz, sfzError } from './parser.js';
import { decodeSfzText, readSfzBankDefines } from './source.js';
import { isSfzGenerator, sfzGeneratorMetadata, createSfzGeneratorSample } from './generators.js';
import { prepareSfzOscillatorSources } from './oscillator-source.js';
import { compileSfzScriptAsync } from './script-worker.js';
import { SFZ_SAMPLE_RANGE_MAX_BYTES, createSfzFileSampleReader, createSfzMemorySampleReader } from './sample-reader.js';
import { encodeSfzBankBlob, openSfzBankSource } from './sample-bank-source.js';
import { openSf2Source } from '../sf2/source.js';
import { createSfzSampleIntegrity } from './sample-integrity.js';
import { readSfzWaveLoop, applySfzLoopMetadata } from './sample-metadata.js';
import { effectSamplePaths } from './effects-asset.js';
import { materializeSfzAsset, prepareSfzAssetForContext, sfzPreparationContextKey } from './preparation-context.js';

const pathsByFile = new WeakMap();
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const VALID_ID = /^[a-f0-9]{24}$/;
let defaultServicePromise;

function fileMap(files) {
  const entries = Array.from(files || []);
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
  if ([...result.keys()].filter(path => /\.(sf2|sf3|sfz)$/i.test(path)).length > 10000) {
    throw sfzError('prepare', 'The SFZ folder contains too many instruments.');
  }
  return result;
}

export function listSfzFolderFiles(files) {
  return [...fileMap(files).keys()].filter(path => /\.(sf2|sf3|sfz)$/i.test(path)).sort();
}

export async function enumerateSfzDirectory(directoryHandle, { isCurrent } = {}) {
  const files = [];
  let instruments = 0;
  async function visit(directory, depth, prefix) {
    if (isCurrent?.() === false) throw sfzError('cancelled', 'SFZ import was cancelled.');
    if (depth > 32) throw sfzError('prepare', 'The SFZ folder is nested too deeply.');
    for await (const [name, handle] of directory.entries()) {
      if (isCurrent?.() === false) throw sfzError('cancelled', 'SFZ import was cancelled.');
      const path = normalizeSfzPath(name, prefix);
      if (handle.kind === 'directory') await visit(handle, depth + 1, path);
      else if (handle.kind === 'file') {
        if (/\.(sf2|sf3|sfz)$/i.test(path) && ++instruments > 10000) {
          throw sfzError('prepare', 'The SFZ folder contains too many instruments.');
        }
        // Retrieve File objects only for definitions and samples used by the selected instrument.
        pathsByFile.set(handle, path);
        files.push(handle);
      }
    }
  }
  await visit(directoryHandle, 0, '');
  return files;
}

function sampleIntegrityResolver(openReader, candidatePaths, maxBytes, onDiagnostic, isCurrent, onProgress) {
  let embedded = new Map();
  let integrity;
  return (path, md5, embeddedSamples) => {
    embedded = embeddedSamples;
    if (!integrity) {
      const candidates = [...new Set([...embedded.keys(), ...candidatePaths()])];
      integrity = createSfzSampleIntegrity({ maxLookupBytes: maxBytes, maxLookupFiles: candidates.length,
        onDiagnostic, isCurrent, onProgress, candidatePaths: candidates,
        openReader: path => embedded.has(path) ? createSfzMemorySampleReader(embedded.get(path)) : openReader(path) });
    }
    return integrity.resolve(path, md5);
  };
}

async function parseBankFiles(selectedPath, files, onDiagnostic, maxBytes, options = {}) {
  const readText = async path => {
    const bytes = files.get(path);
    return bytes ? decodeSfzText(bytes) : null;
  };
  const { defines } = await readSfzBankDefines(selectedPath,
    [...files.keys()].filter(path => /\.bank\.xml$/i.test(path)), readText);
  return parseSfz({ selectedPath, maxBytes, defines, readText,
    resolveSample: sampleIntegrityResolver(path => files.has(path) ? createSfzMemorySampleReader(files.get(path)) : null,
      () => files.keys(), maxBytes, onDiagnostic, options.isCurrent, options.onSourceProgress),
    hasSample: path => files.has(path), onDiagnostic });
}

async function prepareBank(bytes, decode, onDiagnostic, maxBytes, options) {
  const bank = decodeSfzBank(bytes, { maxBytes });
  const parsed = await parseBankFiles(bank.selectedPath, bank.files, onDiagnostic, maxBytes, options);
  parsed.warnings = mergeSfzWarnings(bank.warnings, parsed.warnings);
  return { ...await prepareSfzSamples(parsed, path => bank.files.get(path), decode, maxBytes, onDiagnostic, options),
    sourceBytes: bytes.byteLength,
    name: bank.selectedPath.split('/').pop() };
}

export async function prepareBankSource(id, file, { decode, prepareStreamedBank, prepareSoundFontBank, maxBytes, onDiagnostic, cacheBackend, isCurrent, onSourceProgress, onPreparationProgress, preparationContext, estimateEffectBytes }) {
  const source = await openSfzBankSource(file), definitions = new Map();
  if (/\.sf[23]$/i.test(source.selectedPath)) {
    if (typeof prepareSoundFontBank !== 'function') throw sfzError('prepare', 'SoundFont playback is unavailable. Reload the app and try again.');
    const sf2 = await openSf2Source(source.createSampleReader(source.selectedPath));
    return { ...await prepareSoundFontBank({ id, source: sf2, maxBytes, onDiagnostic, cacheBackend,
      onProgress: onPreparationProgress, preparationContext, estimateEffectBytes }),
      name: source.selectedPath.split('/').pop(), format: sf2.parsed.format, presets: sf2.compiled.presets };
  }
  let definitionBytes = 0;
  const read = async path => {
    const reader = source.createSampleReader(path);
    if (reader.size > maxBytes) throw sfzError('too-large', 'An SFZ source file exceeds the memory limit.');
    const bytes = new Uint8Array(reader.size);
    for (let offset = 0; offset < bytes.length; offset += SFZ_SAMPLE_RANGE_MAX_BYTES)
      bytes.set(await reader.readRange(offset, Math.min(SFZ_SAMPLE_RANGE_MAX_BYTES, bytes.length - offset)), offset);
    return bytes;
  };
  const readText = async path => {
    if (!source.files.has(path)) return null;
    if (definitions.has(path)) return definitions.get(path);
    definitionBytes += source.files.get(path).length;
    if (definitionBytes > maxBytes) throw sfzError('too-large', 'The SFZ definitions exceed the memory limit.');
    const value = decodeSfzText(await read(path)); definitions.set(path, value); return value;
  };
  const { defines } = await readSfzBankDefines(source.selectedPath,
    [...source.files.keys()].filter(path => /\.bank\.xml$/i.test(path)), readText);
  const parsed = await parseSfz({ selectedPath: source.selectedPath, maxBytes, defines, readText,
    resolveSample: sampleIntegrityResolver(path => source.files.has(path) ? source.createSampleReader(path) : null,
      () => source.files.keys(), maxBytes, onDiagnostic, isCurrent, onSourceProgress),
    hasSample: path => source.files.has(path), onDiagnostic });
  const createSampleReader = path => parsed.embeddedSamples.has(path)
    ? createSfzMemorySampleReader(parsed.embeddedSamples.get(path)) : source.createSampleReader(path);
  parsed.warnings = mergeSfzWarnings(source.warnings, parsed.warnings);
  const metadata = new Map();
  for (const path of [...new Set([...parsed.regions.map(region => region.sample), ...effectSamplePaths(parsed.effects)])].sort()) {
    if (isSfzGenerator(path)) metadata.set(path, sfzGeneratorMetadata(path));
    else {
      const reader = await createSampleReader(path);
      metadata.set(path, { size: reader.size, revision: reader.revision,
        ...await readSfzAudioHeader(reader.readRange, reader.size) });
    }
  }
  let streamed = typeof prepareStreamedBank === 'function' && sfzRequiresSampleStreaming(parsed.regions);
  if (!streamed) try { selectSfzRegionsForBudget(parsed.regions, metadata, maxBytes, definitionBytes); }
  catch (error) {
    if (error?.code !== 'too-large' || typeof prepareStreamedBank !== 'function') throw error;
    streamed = true;
  }
  let prepared;
  if (!streamed) try {
    prepared = await prepareSfzSamples(parsed, read, decode, maxBytes, onDiagnostic,
      { preparationContext, estimateEffectBytes, onProgress: onPreparationProgress });
  } catch (error) {
    if (error?.code !== 'too-large' || typeof prepareStreamedBank !== 'function') throw error;
    streamed = true;
  }
  if (streamed) prepared = await prepareStreamedBank({ id, parsed, metadata, maxBytes, definitionBytes,
    createSampleReader, onDiagnostic, cacheBackend, onProgress: onPreparationProgress, preparationContext, estimateEffectBytes });
  return { ...prepared, sourceBytes: file.size, presentation: prepared.presentation ?? await prepareSfzPresentation(parsed, read),
    name: source.selectedPath.split('/').pop() };
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

export async function prepareSfzSamples(parsed, readSample, decode, maxBytes, onDiagnostic,
  { preparationContext = null, estimateEffectBytes, onProgress } = {}) {
  const script = parsed.script ? await compileSfzScriptAsync(parsed.script.source) : null;
  if (typeof decode !== 'function' && parsed.regions.some(region => !isSfzGenerator(region.sample))) {
    throw sfzError('prepare', 'SFZ audio decoding is unavailable.');
  }
  const samples = new Map(), loops = new Map();
  let decodedBytes = 0;
  const paths = [...new Set([...parsed.regions.map(region => region.sample), ...effectSamplePaths(parsed.effects)])].sort();
  for (const path of paths) {
    if (isSfzGenerator(path)) {
      const pcm = createSfzGeneratorSample(path);
      decodedBytes += pcm.channels[0].byteLength;
      if (decodedBytes > maxBytes) throw sfzError('too-large', 'The SFZ samples are too large to load.');
      samples.set(path, pcm);
      onProgress?.({ phase: 'metadata', completedCount: samples.size, totalCount: paths.length });
      continue;
    }
    const bytes = parsed.embeddedSamples?.get(path) ?? await readSample(path);
    const header = parseIrAudioHeader(bytes);
    if (header.channels > 2) throw sfzError('prepare', 'SFZ samples must contain mono or stereo audio.');
    if (header.frames && decodedBytes + header.frames * header.channels * 4 > maxBytes) {
      throw sfzError('too-large', 'The SFZ samples are too large to load.');
    }
    loops.set(path, await readSfzWaveLoop({ size: bytes.length,
      readRange: async (offset, length) => bytes.subarray(offset, offset + length) }, maxBytes));
    const pcm = await decode(bytes.slice().buffer, header?.sampleRate ?? null);
    decodedBytes += (pcm?.channels?.length ?? 0) * (pcm?.channels?.[0]?.length ?? 0) * 4;
    if (decodedBytes > maxBytes) throw sfzError('too-large', 'The SFZ samples are too large to load.');
    samples.set(path, pcm);
    onProgress?.({ phase: 'metadata', completedCount: samples.size, totalCount: paths.length });
  }
  const recovered = [];
  parsed = applySfzLoopMetadata(parsed, loops);
  const oscillators = await prepareSfzOscillatorSources(parsed, async path => samples.get(path), maxBytes, { residentBytes: decodedBytes });
  parsed = oscillators.parsed;
  for (const [path, pcm] of oscillators.samples) samples.set(path, pcm);
  let descriptor = packSfzAsset(parsed.regions, samples, { maxBytes, script, modulation: parsed.modulation, effects: parsed.effects,
    onDiagnostic: onDiagnostic ?? undefined, onWarning: warning => {
      // Parser omissions and sample-aware omissions concern different regions.
      if (warning.code === 'invalid-regions') warning = { ...warning,
        count: warning.count + (parsed.warnings?.find(item => item.code === warning.code)?.count || 0) };
      recovered.push(warning);
      console.warn('SFZ load warnings:', warning);
    } });
  if (preparationContext) descriptor = await materializeSfzAsset(descriptor, preparationContext, maxBytes, estimateEffectBytes);
  descriptor.materializeForContext = function(context, budget = maxBytes, estimate = estimateEffectBytes) {
    return materializeSfzAsset(this, context, budget, estimate);
  };
  descriptor.unsupportedOpcodes = parsed.unsupportedOpcodes || [];
  descriptor.incomplete = Boolean(parsed.diagnostics?.missingSamples?.length || parsed.diagnostics?.invalidRegions?.length || recovered.some(item => item.code === 'invalid-regions'));
  const warnings = mergeSfzWarnings(parsed.warnings, recovered);
  const regionCount = new DataView(descriptor.payload, 32, 32).getUint32(8, true);
  return { descriptor, sampleCount: samples.size, regionCount, presentation: await prepareSfzPresentation(parsed, readSample),
    ...(warnings.length ? { warnings } : {}) };
}

export async function prepareSfzPresentation(parsed, readFile) {
  const presentation = parsed.presentation;
  if (!presentation) return null;
  if (!presentation.image) return presentation;
  const bytes = await readFile(presentation.image);
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw sfzError('prepare', 'The instrument image could not be found. Select its complete folder and try again.');
  const extension = presentation.image.split('.').pop().toLowerCase();
  const type = { bmp: 'image/bmp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[extension] || 'application/octet-stream';
  return { ...presentation, imageBlob: new Blob([bytes], { type }) };
}

export function selectSfzRegionsForBudget(regions, metadata, maxBytes, definitionBytes = 0) {
  const fits = candidate => {
    const paths = new Set([...candidate.map(region => region.sample), ...metadata.keys()]);
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
    const footprint = 32 + 4 * SFZ_TABLE_HEADER_WORDS + 4 * SFZ_REGION_FIELDS.length * candidate.length + decodedBytes +
      4 * (129 + 2 * groups + indexEntries);
    return rawBytes <= maxBytes && footprint <= maxBytes;
  };
  if (fits(regions)) return { regions, reduced: false };
  throw sfzError('too-large', 'The complete SFZ instrument exceeds the memory limit.');
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
              !Number.isSafeInteger(entry.regionCount) || entry.regionCount < 1 ||
              entry.streamedSource !== undefined && typeof entry.streamedSource !== 'boolean')) {
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
    const getFile = async path => {
      const source = selectedFiles.get(path);
      if (typeof source?.getFile !== 'function') return source;
      const file = await source.getFile();
      selectedFiles.set(path, file);
      return file;
    };
    if (/\.sf[23]$/i.test(selectedPath)) {
      const file = await getFile(selectedPath);
      if (!file || typeof this.backend.writeSfzBankFile !== 'function' || typeof this.backend.readSfzBankFile !== 'function') {
        throw sfzError('storage', 'This browser cannot store the SoundFont. Try another browser.');
      }
      // Validate metadata before copying the source; neither parsing nor Blob
      // construction reads the sample pool into a whole-file ArrayBuffer.
      await openSf2Source(await createSfzFileSampleReader(file));
      return this._storeStreamedSource(selectedPath, new Map([[selectedPath, file]]), options, maxBytes);
    }
    const read = async path => {
      const file = await getFile(path);
      if (!file) return null;
      if (file.size > maxBytes) throw sfzError('too-large', 'An SFZ file is too large to save.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw sfzError('too-large', 'An SFZ file is too large to save.');
      return bytes;
    };
    const storedFiles = new Map();
    const readText = async path => {
      let bytes = storedFiles.get(path);
      if (!bytes) {
        bytes = await read(path);
        if (!bytes) return null;
        storedFiles.set(path, bytes);
      }
      return decodeSfzText(bytes);
    };
    const { defines, bankPath } = await readSfzBankDefines(selectedPath,
      [...selectedFiles.keys()].filter(path => /\.bank\.xml$/i.test(path)), readText);
    // Only the matching bank's definitions are needed when the saved instrument reopens.
    for (const path of storedFiles.keys()) if (path !== bankPath) storedFiles.delete(path);
    const parsed = await parseSfz({ selectedPath, maxBytes, defines, readText,
      resolveSample: sampleIntegrityResolver(async path => {
        const file = await getFile(path);
        if (!file) return null;
        if (typeof file.slice === 'function') return createSfzFileSampleReader({ size: file.size,
          lastModified: file.lastModified ?? 0, slice: (start, end) => file.slice(start, end) });
        return createSfzMemorySampleReader(await read(path));
      }, () => selectedFiles.keys(), maxBytes, this.onDiagnostic, options.isCurrent, options.onSourceProgress),
      hasSample: path => selectedFiles.has(path), onDiagnostic: this.onDiagnostic });
    if (!parsed.regions.length) throw sfzError('no-regions', 'The SFZ has no playable regions.');
    if (parsed.presentation.image) {
      const bytes = await read(parsed.presentation.image);
      if (!bytes) throw sfzError('prepare', 'The instrument image could not be found. Select its complete folder and try again.');
      storedFiles.set(parsed.presentation.image, bytes);
    }
    let accumulatedBytes = [...storedFiles.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
    const metadata = new Map();
    const sizes = new Map([...storedFiles].map(([path, bytes]) => [path, bytes.byteLength]));
    for (const path of [...new Set([...parsed.regions.map(region => region.sample), ...effectSamplePaths(parsed.effects)])].sort()) {
      if (isSfzGenerator(path)) {
        metadata.set(path, sfzGeneratorMetadata(path));
        continue;
      }
      const embedded = parsed.embeddedSamples.get(path);
      if (embedded) {
        metadata.set(path, { size: embedded.byteLength, ...parseIrAudioHeader(embedded) });
        continue;
      }
      const file = await getFile(path);
      const header = typeof file.slice === 'function'
        ? await readSfzAudioHeader(async (position, length) =>
          new Uint8Array(await file.slice(position, position + length).arrayBuffer()), file.size) : {};
      metadata.set(path, { size: file.size, ...header });
      sizes.set(path, file.size);
    }
    const rawSize = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    const containerBytes = estimateSfzBankBytes(selectedPath, sizes) - rawSize;
    const canStream = typeof options.prepareStreamedBank === 'function' &&
      typeof this.backend.writeSfzBankFile === 'function' && typeof this.backend.readSfzBankFile === 'function';
    let streamed = canStream && sfzRequiresSampleStreaming(parsed.regions);
    if (!streamed) try { selectSfzRegionsForBudget(parsed.regions, metadata, maxBytes, accumulatedBytes + containerBytes); }
    catch (error) {
      if (error?.code !== 'too-large' || !canStream) throw error;
      streamed = true;
    }
    if (streamed) {
      const sourceFiles = new Map(storedFiles);
      for (const path of new Set([...parsed.regions.map(region => region.sample), ...effectSamplePaths(parsed.effects)])) {
        if (!isSfzGenerator(path) && !parsed.embeddedSamples.has(path)) sourceFiles.set(path, await getFile(path));
      }
      return this._storeStreamedSource(selectedPath, sourceFiles, options, maxBytes, parsed.warnings);
    }
    for (const path of [...new Set([...parsed.regions.map(region => region.sample), ...effectSamplePaths(parsed.effects)])].sort()) {
      if (isSfzGenerator(path)) continue;
      if (parsed.embeddedSamples.has(path)) continue;
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
      warnings: parsed.warnings || [] });
    const id = await identifySfzBank(bytes);
    const prepared = { ...await prepareSfzSamples(parsed, path => storedFiles.get(path),
      options.decode, maxBytes, this.onDiagnostic), name: selectedPath.split('/').pop() };
    const entry = { id, name: selectedPath.split('/').pop(), regionCount: prepared.regionCount,
      size: bytes.byteLength, fileCount: storedFiles.size, importedAt: new Date().toISOString() };
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

  async _storeStreamedSource(selectedPath, sourceFiles, options, maxBytes, warnings = []) {
    const blob = encodeSfzBankBlob(selectedPath, sourceFiles, { warnings });
    // A random identity avoids a whole-buffer WebCrypto copy of multi-GB sources.
    const id = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('');
    const name = `${id}.sfzbank`;
    return this._write(async () => {
      let committed = false;
      try {
        await this.backend.writeSfzBankFile(name, blob, { isCurrent: options.isCurrent, onProgress: options.onSourceProgress });
        const file = await this.backend.readSfzBankFile(name);
        const prepared = await prepareBankSource(id, file, { ...options, maxBytes,
          onDiagnostic: this.onDiagnostic, cacheBackend: this.backend });
        if (options.isCurrent?.() === false) throw sfzError('cancelled', 'Instrument import was cancelled.');
        const entry = { id, name: selectedPath.split('/').pop(), regionCount: prepared.regionCount,
          size: blob.size, fileCount: sourceFiles.size, streamedSource: true, importedAt: new Date().toISOString(),
          ...(['sf2', 'sf3'].includes(prepared.format) && { format: prepared.format }) };
        const entries = this.entries.concat(entry).sort((a, b) => a.id < b.id ? -1 : 1);
        await this._saveIndex(entries); this.entries = entries; committed = true;
        this.prepared = { id, bankBytes: blob.size, streamedSource: true, value: prepared };
        return { ...entry };
      } finally {
        if (!committed) await this.backend.remove(name).catch(error => this.onDiagnostic?.({ sourceCleanup: error }));
      }
    });
  }

  async prepare(id, { decode, prepareStreamedBank, prepareSoundFontBank, isCurrent, onSourceProgress, onPreparationProgress, preparationContext, estimateEffectBytes } = {}) {
    const maxBytes = requireSfzMaxBytes(this.getMaxBytes());
    if (!VALID_ID.test(id)) return null;
    await this.writes;
    const entry = this.entries.find(item => item.id === id);
    if (!entry) return null;
    if (this.prepared?.id === id) {
      const cached = this.prepared;
      let value = cached.value;
      if ((!cached.streamedSource && cached.bankBytes > maxBytes) || value.descriptor.footprintBytes > maxBytes) {
        throw sfzError('too-large', 'The SFZ bank is too large to load.');
      }
      const key = preparationContext ? sfzPreparationContextKey(preparationContext) : null;
      if (preparationContext && key !== cached.contextKey) {
        const previous = value.descriptor;
        const descriptor = await prepareSfzAssetForContext(previous, preparationContext, maxBytes, estimateEffectBytes);
        if (isCurrent?.() === false) return null;
        value = { ...value, descriptor };
        if (this.prepared === cached) this.prepared = { ...cached, contextKey: key, value };
      }
      return value;
    }
    if (entry.streamedSource || typeof prepareStreamedBank === 'function' && typeof this.backend.readSfzBankFile === 'function') {
      if (typeof this.backend.readSfzBankFile !== 'function') throw sfzError('storage', 'The SFZ source files could not be opened.');
      const file = await this.backend.readSfzBankFile(`${id}.sfzbank`);
      if (!file) return null;
      const value = await prepareBankSource(id, file, { decode, prepareStreamedBank, prepareSoundFontBank, maxBytes, isCurrent, onSourceProgress, onPreparationProgress,
        onDiagnostic: this.onDiagnostic, cacheBackend: this.backend, preparationContext, estimateEffectBytes });
      await this.writes;
      if (!this.entries.includes(entry)) return null;
      this.prepared = { id, bankBytes: file.size, streamedSource: true, value,
        contextKey: preparationContext ? sfzPreparationContextKey(preparationContext) : null };
      return value;
    }
    let bytes;
    try { bytes = await this.backend.read(`${id}.sfzbank`); }
    catch (cause) { throw sfzError('storage', 'The SFZ bank could not be read.', cause); }
    if (!bytes) return null;
    try {
      const value = await prepareBank(bytes, decode, this.onDiagnostic, maxBytes, { isCurrent, onSourceProgress, preparationContext, estimateEffectBytes, onProgress: onPreparationProgress });
      await this.writes;
      if (!this.entries.includes(entry)) return null;
      this.prepared = { id, bankBytes: bytes.byteLength, value,
        contextKey: preparationContext ? sfzPreparationContextKey(preparationContext) : null };
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

  async readMetadata(id) {
    await this.writes;
    const entry = this.entries.find(entry => entry.id === id);
    if (!entry) return null;
    if (entry.size !== undefined && entry.fileCount !== undefined) return { ...entry };
    const bytes = await this.backend.read(`${id}.sfzbank`);
    if (!bytes) return null;
    const bank = decodeSfzBank(bytes, { maxBytes: SFZ_MAX_SUPPORTED_BYTES });
    return { ...entry, size: bytes.byteLength, fileCount: bank.files.size };
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
