import { AssetError, ValidationError } from './errors.js';
import { prepareSoundFontBank } from './internal/js/sf2/asset.js';
import { sfzSampleCacheFootprint } from './internal/js/sfz/asset.js';
import { SFZ_DEFAULT_MAX_BYTES, SFZ_MAX_SUPPORTED_BYTES } from './internal/js/sfz/limits.js';
import { encodeSfzBankBlob } from './internal/js/sfz/sample-bank-source.js';
import { SFZ_SAMPLE_PAGE_FRAMES, SfzSampleStream } from './internal/js/sfz/sample-stream.js';
import { prepareBankSource } from './internal/js/sfz/service.js';
import { sfzStorageSlots } from './internal/js/sfz/storage-plan.js';
import { prepareStreamedSfzBank } from './internal/js/sfz/streamed-bank.js';

const ETSF_MAGIC = 0x46535445; // "ETSF"
const ETSF_VERSION = 1;
const ETSF_HEADER_BYTES = 16;
const ETSF_PAGE_HEADER_BYTES = 16;
const PAYLOAD_MAGIC = 0x31415445;
// The native player needs the 32-byte payload header plus a control block of at
// least 56 bytes; word 12 of the payload holds the control block's word count.
const MIN_CONTROL_BYTES = 56;
const MAX_CACHE_SLOTS = 32768;
const MAX_SAMPLES = 65536;
// Header lanes of the packed sampler table (uint32 words after the 32-byte payload header).
const LANE_CACHE_SLOTS = 14;
const LANE_STREAM_KIND = 15;
const LANE_SLOTS16 = 16;
const STREAM_KIND_STORAGE = 2;
// Preparation identifies a bank by a 24-hex id; a fixed id keeps output deterministic.
const BANK_ID = '0'.repeat(24);

const tooLarge = cause => new AssetError(
  'The SoundFont bank is too large for the memory limit. Increase maxBytes (--max-bytes on the command line, up to 1 GiB) and try again.',
  { code: 'too-large', cause });

const MISSING_SAMPLES_SHOWN = 3;
// The parser's invalid-region entry ("<sample>: <reason>") for a reference above the root.
const OUTSIDE_ROOT_SUFFIX = ': SFZ references must stay inside the selected folder.';
const missingSamplesError = (paths, cause) => {
  const shown = [...paths].sort().slice(0, MISSING_SAMPLES_SHOWN).join(', ');
  const more = paths.size > MISSING_SAMPLES_SHOWN ? ` and ${paths.size - MISSING_SAMPLES_SHOWN} more` : '';
  return new AssetError(`${paths.size} SFZ sample file${paths.size === 1 ? ' was' : 's were'} not found: ${shown}${more}. ` +
    'If the SFZ uses samples in a folder above its own, pass that folder as root (--root on the command line).',
  { code: 'missing-samples', cause });
};

export class SoundFontBank {
  constructor(payload, pages = []) {
    if (!(payload instanceof ArrayBuffer) || !Array.isArray(pages)) {
      throw new ValidationError('A SoundFont bank needs a payload ArrayBuffer and a page list.');
    }
    this.payload = payload;
    this.pages = Object.freeze(pages.map(page => Object.freeze({ ...page })));
    Object.freeze(this);
  }

  toBytes() {
    let size = ETSF_HEADER_BYTES + this.payload.byteLength;
    for (const page of this.pages) size += ETSF_PAGE_HEADER_BYTES + page.pcm.byteLength;
    const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
    view.setUint32(0, ETSF_MAGIC, true);
    view.setUint32(4, ETSF_VERSION, true);
    view.setUint32(8, this.payload.byteLength, true);
    view.setUint32(12, this.pages.length, true);
    bytes.set(new Uint8Array(this.payload), ETSF_HEADER_BYTES);
    let offset = ETSF_HEADER_BYTES + this.payload.byteLength;
    for (const { sample, pageIndex, frames, channels, pcm } of this.pages) {
      view.setUint32(offset, sample, true);
      view.setUint32(offset + 4, pageIndex, true);
      view.setUint32(offset + 8, frames, true);
      view.setUint32(offset + 12, channels, true);
      offset += ETSF_PAGE_HEADER_BYTES;
      for (let index = 0; index < pcm.length; index++, offset += 4) view.setFloat32(offset, pcm[index], true);
    }
    return bytes;
  }

  static fromBytes(input) {
    const source = input instanceof ArrayBuffer ? new Uint8Array(input)
      : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
    if (!source) throw new ValidationError('A SoundFont bank must be given as bytes.');
    // Copy once so every PCM page is an aligned view owned by the bank.
    const bytes = source.slice(), view = new DataView(bytes.buffer);
    const invalid = () => new AssetError('The SoundFont bank file is damaged or is not an EffeTune SoundFont bank.');
    if (bytes.byteLength < ETSF_HEADER_BYTES || view.getUint32(0, true) !== ETSF_MAGIC) throw invalid();
    if (view.getUint32(4, true) !== ETSF_VERSION) {
      throw new AssetError('This SoundFont bank was prepared for a different format version. Prepare it again with this version of EffeTune DSP.');
    }
    const payloadBytes = view.getUint32(8, true), pageCount = view.getUint32(12, true);
    if (payloadBytes < MIN_CONTROL_BYTES || payloadBytes % 4 || ETSF_HEADER_BYTES + payloadBytes > bytes.byteLength ||
        view.getUint32(ETSF_HEADER_BYTES, true) !== PAYLOAD_MAGIC || view.getUint32(ETSF_HEADER_BYTES + 4, true) !== 1 ||
        32 + view.getUint32(ETSF_HEADER_BYTES + 8, true) * 4 !== payloadBytes || pageCount > MAX_CACHE_SLOTS) throw invalid();
    const controlBytes = 32 + view.getUint32(ETSF_HEADER_BYTES + 48, true) * 4;
    if (controlBytes < MIN_CONTROL_BYTES || controlBytes > payloadBytes) throw invalid();
    const payload = bytes.buffer.slice(ETSF_HEADER_BYTES, ETSF_HEADER_BYTES + payloadBytes);
    const pages = [];
    let offset = ETSF_HEADER_BYTES + payloadBytes, previous = -1;
    for (let index = 0; index < pageCount; index++) {
      if (offset + ETSF_PAGE_HEADER_BYTES > bytes.byteLength) throw invalid();
      const sample = view.getUint32(offset, true), pageIndex = view.getUint32(offset + 4, true);
      const frames = view.getUint32(offset + 8, true), channels = view.getUint32(offset + 12, true);
      offset += ETSF_PAGE_HEADER_BYTES;
      const order = sample * 2 ** 32 + pageIndex;
      if (sample >= MAX_SAMPLES || order <= previous || frames < 1 || frames > SFZ_SAMPLE_PAGE_FRAMES ||
          (channels !== 1 && channels !== 2) || offset + frames * channels * 4 > bytes.byteLength) throw invalid();
      pages.push({ sample, pageIndex, frames, channels, pcm: new Float32Array(bytes.buffer, offset, frames * channels) });
      offset += frames * channels * 4;
      previous = order;
    }
    if (offset !== bytes.byteLength) throw invalid();
    return new SoundFontBank(payload, pages);
  }
}

export async function prepareSoundFont(source, { maxBytes = SFZ_DEFAULT_MAX_BYTES, root } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > SFZ_MAX_SUPPORTED_BYTES) {
    throw new ValidationError(`maxBytes must be a whole number of bytes from 1 to ${SFZ_MAX_SUPPORTED_BYTES}.`);
  }
  if (root !== undefined && typeof root !== 'string') throw new ValidationError('root must be a folder path.');
  let resolved;
  try {
    resolved = await resolveSource(source, root);
  } catch (error) {
    if (error instanceof AssetError || error instanceof ValidationError) throw error;
    throw new AssetError('The SoundFont file could not be opened. Check that the path exists and is readable.',
      { code: error?.code, cause: error });
  }
  const { selectedPath, files } = resolved;
  const workerFactory = await sampleWorkerFactory();
  const providerOptions = { workerFactory, persistentCache: null };
  // The app's bank preparation owns source resolution and the resident/streamed decision.
  const container = new File([encodeSfzBankBlob(selectedPath, files)], 'soundfont.sfzbank', { lastModified: 0 });
  // The parser reports each sample file it could not find, or that lies outside the
  // root, and drops its regions; a prepared bank must not silently lose them.
  const missingSamples = new Set();
  const onDiagnostic = detail => {
    for (const samplePath of detail?.missingSamples ?? []) missingSamples.add(samplePath);
    for (const entry of detail?.invalidRegions ?? []) {
      if (entry.endsWith(OUTSIDE_ROOT_SUFFIX)) missingSamples.add(`${entry.slice(0, -OUTSIDE_ROOT_SUFFIX.length)} (outside the root folder)`);
    }
  };
  let prepared;
  try {
    prepared = await prepareBankSource(BANK_ID, container, {
      decode: decodeSample, maxBytes, onDiagnostic,
      prepareStreamedBank: options => prepareStreamedSfzBank(options, providerOptions),
      prepareSoundFontBank: options => prepareSoundFontBank(options, providerOptions)
    });
  } catch (error) {
    throw missingSamples.size ? missingSamplesError(missingSamples, error) : preparationError(error);
  }
  if (missingSamples.size) throw missingSamplesError(missingSamples);
  const { descriptor } = prepared;
  if (typeof descriptor.sampleProviderFactory !== 'function') {
    if (descriptor.payload.byteLength > maxBytes) throw tooLarge();
    return new SoundFontBank(descriptor.payload.slice(0), []);
  }
  return collectResidentPages(descriptor, maxBytes);
}

async function collectResidentPages(descriptor, maxBytes) {
  const pages = new Map();
  const publish = page => {
    pages.set(`${page.sample}:${page.pageIndex}`, { sample: page.sample, pageIndex: page.pageIndex,
      frames: page.frames, channels: page.channels, pcm: Float32Array.from(page.pcm) });
    return true;
  };
  let provider;
  try {
    provider = await descriptor.sampleProviderFactory({ generation: 1, publish });
    const payload = descriptor.payload.slice(0), lanes = new Uint32Array(payload, 32);
    const requests = [];
    for (const [sample, { frames }] of provider.samples.entries()) {
      for (let pageIndex = 0; pageIndex * SFZ_SAMPLE_PAGE_FRAMES < frames; pageIndex++) requests.push({ sample, pageIndex });
    }
    // Every page stays resident: the slot count covers all pages plus one
    // transient slot per present storage format, so playback never waits on I/O.
    const cacheSlots = requests.length + 2;
    if (cacheSlots > MAX_CACHE_SLOTS) throw tooLarge();
    const storage = lanes[LANE_STREAM_KIND] === STREAM_KIND_STORAGE ? sfzStorageSlots(cacheSlots,
      new Map(provider.samples.entries()), new Map(provider.samples.map((sample, index) => [index, [[0, sample.frames]]]))) : null;
    const channels = provider.samples.some(sample => sample.channels === 2) ? 2 : 1;
    if (payload.byteLength + sfzSampleCacheFootprint(provider.samples.length, cacheSlots, channels, storage) > maxBytes) {
      throw tooLarge();
    }
    lanes[LANE_CACHE_SLOTS] = cacheSlots;
    if (storage) lanes[LANE_SLOTS16] = storage.slots16;
    await provider.preload(requests);
    const ordered = [...pages.values()].sort((a, b) => a.sample - b.sample || a.pageIndex - b.pageIndex);
    return new SoundFontBank(payload, ordered);
  } catch (error) {
    throw preparationError(error);
  } finally {
    provider?.close();
  }
}

function preparationError(error) {
  if (error instanceof AssetError || error instanceof ValidationError) return error;
  if (error?.code === 'too-large') return tooLarge(error);
  if (error?.code === 'sample-codec-unavailable' && typeof globalThis.Worker !== 'function') {
    return new AssetError('Compressed SoundFonts (SF3) cannot be prepared in Node.js. Prepare the bank in a web browser, or use an SF2 SoundFont.',
      { code: 'sample-codec-unavailable', cause: error });
  }
  return new AssetError(error?.message || 'The SoundFont could not be prepared.', { code: error?.code, cause: error });
}

async function resolveSource(source, root) {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    const bytes = source instanceof ArrayBuffer ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    return { selectedPath: 'soundfont.sf2', files: new Map([['soundfont.sf2', bytes.slice()]]) };
  }
  if (typeof source === 'string') return readSourcePath(source, root);
  if (source && typeof source.selectedPath === 'string' && source.files instanceof Map) {
    return { selectedPath: source.selectedPath, files: source.files };
  }
  throw new ValidationError('Pass SoundFont bytes, a file path, or { selectedPath, files }.');
}

async function readSourcePath(sourcePath, rootPath) {
  if (typeof process === 'undefined' || !process.versions?.node) {
    throw new ValidationError('File paths can be prepared only in Node.js. Pass the SoundFont bytes instead.');
  }
  const [{ openAsBlob }, { access, readdir }, path] = await Promise.all([import('node:fs'), import('node:fs/promises'), import('node:path')]);
  const fullPath = path.resolve(sourcePath), name = path.basename(fullPath);
  // A fixed name keeps the prepared bank independent of the SoundFont's file name,
  // matching the bytes form.
  const soundFont = /\.sf[23]$/i.exec(name)?.[0].toLowerCase();
  if (soundFont) return { selectedPath: `soundfont${soundFont}`, files: new Map([[`soundfont${soundFont}`, await openAsBlob(fullPath)]]) };
  if (!/\.sfz$/i.test(name)) throw new ValidationError('Choose an .sf2, .sf3, or .sfz file.');
  // The root plays the role of the folder selected in the app: every file below it is
  // available, so samples and .bank.xml files outside the SFZ's own folder resolve.
  const root = rootPath === undefined ? path.dirname(fullPath) : path.resolve(rootPath), files = new Map();
  const selectedPath = path.relative(root, fullPath);
  if (!selectedPath || selectedPath === '..' || selectedPath.startsWith(`..${path.sep}`) || path.isAbsolute(selectedPath)) {
    throw new AssetError('The SFZ file is not inside the root folder. Choose a root folder that contains the SFZ file.');
  }
  await access(fullPath);
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files.set(path.relative(root, file).split(path.sep).join('/'), await openAsBlob(file));
  }
  return { selectedPath: selectedPath.split(path.sep).join('/'), files };
}

// Browsers use the preparation module's own module Worker. Node runs the same
// worker endpoint over worker_threads.
async function sampleWorkerFactory() {
  if (typeof globalThis.Worker === 'function') return undefined;
  const { Worker } = await import('node:worker_threads');
  const entry = new URL('./internal/js/sfz/sample-stream-worker.js', import.meta.url).href;
  const code = `const { parentPort } = require('node:worker_threads');
import(${JSON.stringify(entry)}).then(({ attachSfzSampleStreamWorker }) => {
  const endpoint = { postMessage: (...args) => parentPort.postMessage(...args) };
  attachSfzSampleStreamWorker(endpoint);
  parentPort.on('message', data => endpoint.onmessage({ data }));
});`;
  return () => {
    const thread = new Worker(code, { eval: true });
    const adapter = { postMessage: (...args) => thread.postMessage(...args), terminate: () => { void thread.terminate(); } };
    thread.on('message', data => adapter.onmessage?.({ data }));
    thread.on('error', error => adapter.onerror?.(error));
    return adapter;
  };
}

// Resident SFZ samples decode with the same WAV/AIFF/FLAC decoder as streamed
// pages, so prepared banks match across environments. Other formats need the
// browser's audio decoder.
async function decodeSample(buffer, sampleRate) {
  const bytes = new Uint8Array(buffer);
  let stream = null;
  try { stream = await SfzSampleStream.open(async (offset, length) => bytes.subarray(offset, offset + length), bytes.length); }
  catch { /* Not a WAV, AIFF or FLAC file; fall back to the platform decoder. */ }
  if (stream) {
    const { frames, channels } = stream.metadata;
    const output = Array.from({ length: channels }, () => new Float32Array(frames));
    for (let first = 0; first < frames; first += 65536) {
      const count = Math.min(65536, frames - first), pcm = await stream.readFrames(first, count);
      for (let frame = 0; frame < count; frame++) {
        for (let channel = 0; channel < channels; channel++) output[channel][first + frame] = pcm[frame * channels + channel];
      }
    }
    return { sampleRate: stream.metadata.sampleRate, channels: output };
  }
  if (typeof globalThis.OfflineAudioContext !== 'function') {
    throw new AssetError('This sample format cannot be prepared in Node.js. Convert the SFZ samples to WAV or FLAC, or prepare the bank in a web browser.',
      { code: 'sample-codec-unavailable' });
  }
  const decoded = await new OfflineAudioContext(2, 1, sampleRate || 48000).decodeAudioData(buffer);
  return { sampleRate: decoded.sampleRate,
    channels: Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel)) };
}
