import { parseIrAudioHeader, isSupportedIrFileName } from './audio-header-metadata.js';
import { openIrLibrary } from './ir-library-factory.js';
import {
  IR_LIBRARY_MAX_ORIGINAL_BYTES,
  requireBoundedDecodedIrHeader,
  requireBoundedDecodedIrPcm,
  requireBoundedDecodedIrShape,
  requireBoundedIrBytes
} from './ir-library-limits.js';
import { mergeTrueStereoPair, parseTrueStereoSide } from './ir-true-stereo-pair.js';

const DECODE_CACHE_VERSION = 1;
const MAX_FOLDER_FILES = 10000;
const directoryKeys = new WeakMap();

export const IR_IMPORT_FAILURE_FILE_TOO_LARGE = 'file-too-large';

function fileTooLargeError() {
  const error = new RangeError('The selected impulse response file is too large.');
  error.code = IR_IMPORT_FAILURE_FILE_TOO_LARGE;
  return error;
}

function importFailureCode(error) {
  return error?.code === IR_IMPORT_FAILURE_FILE_TOO_LARGE
    ? IR_IMPORT_FAILURE_FILE_TOO_LARGE
    : null;
}

function importResult(imported, failed, unsupportedCount) {
  return {
    imported,
    failedCount: failed.length,
    unsupportedCount,
    failureCodes: [...new Set(failed.map(item => item.code).filter(Boolean))]
  };
}

function relativeDirectory(file) {
  const known = directoryKeys.get(file);
  if (known !== undefined) return known;
  const relativePath = typeof file?.webkitRelativePath === 'string'
    ? file.webkitRelativePath.replace(/\\/g, '/')
    : '';
  return relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
}

function compareFiles(left, right) {
  const leftKey = `${relativeDirectory(left)}\0${String(left.name)}`;
  const rightKey = `${relativeDirectory(right)}\0${String(right.name)}`;
  return leftKey.localeCompare(rightKey);
}

function withFileLabel(entry) {
  if (!entry) return null;
  const fileLabel = entry.originals.map(original => original.fileName).join(' + ');
  return { ...entry, fileLabel };
}

function pairSelections(files) {
  const sorted = [...files].sort(compareFiles);
  const groups = new Map();
  const singles = [];
  for (const file of sorted) {
    const side = parseTrueStereoSide(file.name);
    if (!side) {
      singles.push(file);
      continue;
    }
    const key = `${relativeDirectory(file)}\0${side.base}`;
    const group = groups.get(key) || { left: [], right: [] };
    group[side.side].push(file);
    groups.set(key, group);
  }
  const pairs = [];
  const unmatched = [];
  for (const group of groups.values()) {
    if (group.left.length === 1 && group.right.length === 1) pairs.push([group.left[0], group.right[0]]);
    else unmatched.push([...group.left, ...group.right]);
  }
  return {
    pairs,
    singles: singles.sort(compareFiles),
    unmatched
  };
}

async function readFileBytes(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('The selected item is not an audio file.');
  if (Number.isSafeInteger(file.size) && file.size > IR_LIBRARY_MAX_ORIGINAL_BYTES) {
    throw fileTooLargeError();
  }
  const buffer = await file.arrayBuffer();
  try {
    requireBoundedIrBytes(buffer, IR_LIBRARY_MAX_ORIGINAL_BYTES, 'Selected impulse response file');
  } catch (error) {
    if (error instanceof RangeError) throw fileTooLargeError();
    throw error;
  }
  return new Uint8Array(buffer);
}

export async function enumerateIrDirectory(directoryHandle) {
  const files = [];
  async function visit(directory, depth, segments) {
    if (depth > 32 || files.length >= MAX_FOLDER_FILES) return;
    for await (const [name, handle] of directory.entries()) {
      if (files.length >= MAX_FOLDER_FILES) return;
      if (handle.kind === 'directory') await visit(handle, depth + 1, [...segments, name]);
      else if (handle.kind === 'file') {
        const file = await handle.getFile();
        if (isSupportedIrFileName(file.name)) {
          directoryKeys.set(file, segments.join('/'));
          files.push(file);
        }
      }
    }
  }
  await visit(directoryHandle, 0, []);
  return files;
}

export class IrLibraryService {
  constructor(store, options = {}) {
    this.store = store;
    this.onDiagnostic = options.onDiagnostic || (error => console.error('IR library service diagnostic:', error));
  }

  list(options = {}) {
    const query = String(options.query || '').trim().toLowerCase();
    const sort = options.sort === 'recent' ? 'recent' : 'filename';
    const entries = this.store.list().map(withFileLabel).filter(entry =>
      !query || entry.fileLabel.toLowerCase().includes(query));
    return entries.sort(sort === 'recent'
      ? (left, right) => String(right.importedAt).localeCompare(String(left.importedAt))
      : (left, right) => left.fileLabel.localeCompare(right.fileLabel));
  }

  get(irId) {
    return withFileLabel(this.store.get(irId));
  }

  readAnalysis(irId) {
    return this.store.readAnalysis(irId);
  }

  async delete(irId, options = {}) {
    const activeIds = options.activeIds instanceof Set ? options.activeIds : new Set(options.activeIds || []);
    let blocked = false;
    const removed = await this.store.remove(irId, {
      canRemove: () => {
        try {
          const inUse = options.isInUse?.(irId);
          if (typeof inUse?.then === 'function') throw new TypeError('The in-use check must be synchronous.');
          blocked = activeIds.has(irId) || inUse === true;
        } catch (error) {
          this.onDiagnostic(error);
          blocked = true;
        }
        return !blocked;
      }
    });
    return { removed, reason: blocked ? 'in-use' : null };
  }

  async importFiles(files, options = {}) {
    const supported = Array.from(files || []).filter(file => isSupportedIrFileName(file?.name));
    const unsupportedCount = Array.from(files || []).length - supported.length;
    const { pairs, singles, unmatched } = pairSelections(supported);
    if (options.strictPair) {
      if (supported.length !== 2 || pairs.length !== 1 || singles.length || unmatched.length) {
        throw new Error('The two files must have matching names ending in L/R or Left/Right.');
      }
      try {
        return importResult([await this.#importPair(pairs[0], options)], [], unsupportedCount);
      } catch (error) {
        const code = importFailureCode(error);
        if (!code) throw error;
        this.onDiagnostic(error);
        return importResult([], [{ code }], unsupportedCount);
      }
    }
    const imported = [];
    const failed = [];
    singles.push(...unmatched.flat());
    singles.sort(compareFiles);
    for (const pair of pairs) {
      if (options.isCurrent?.() === false) break;
      try {
        imported.push(await this.#importPair(pair, options));
      } catch (error) {
        this.onDiagnostic(error);
        failed.push({ files: pair.map(file => file.name), code: importFailureCode(error) });
      }
    }
    for (const file of singles) {
      if (options.isCurrent?.() === false) break;
      try {
        imported.push(await this.#importSingle(file, options));
      } catch (error) {
        this.onDiagnostic(error);
        failed.push({ files: [file.name], code: importFailureCode(error) });
      }
    }
    return importResult(imported, failed, unsupportedCount);
  }

  async importDirectory(directoryHandle, options = {}) {
    return this.importFiles(await enumerateIrDirectory(directoryHandle), options);
  }

  async resolveDecodedPcm(irId, targetSampleRate, adapters) {
    const isCurrent = adapters.isCurrent || (() => true);
    if (!isCurrent()) return null;
    const entry = this.store.get(irId);
    if (!entry) return null;
    const revision = this.store.getOriginalRevision(irId);
    if (revision === null) return null;
    const isSameEntry = () => isCurrent() && this.store.getOriginalRevision(irId) === revision;
    const discardStaleCache = async () => {
      try {
        await this.store.pcmCache?.deleteAll?.(irId);
      } catch (error) {
        this.onDiagnostic(error);
      }
      return null;
    };
    const preparation = { kind: 'decoded', version: DECODE_CACHE_VERSION, composition: entry.composition };
    let cached = await this.store.pcmCache?.get(irId, targetSampleRate, preparation);
    if (!isSameEntry()) return discardStaleCache();
    if (cached) {
      try {
        requireBoundedDecodedIrPcm({ channels: cached.channelData, sampleRate: cached.sampleRate });
      } catch (error) {
        this.onDiagnostic(error);
        await this.store.pcmCache?.deleteAll?.(irId);
        cached = null;
      }
    }
    if (cached) return {
      channels: cached.channelData,
      sampleRate: cached.sampleRate,
      topologyHint: entry.composition === 'pair' ? 'true-stereo' : undefined,
      fileLabel: withFileLabel(entry).fileLabel
    };
    const decoded = [];
    for (const original of entry.originals) {
      const bytes = await this.store.readOriginal(irId, original.role);
      if (!bytes || !isSameEntry()) return discardStaleCache();
      requireBoundedDecodedIrHeader(parseIrAudioHeader(bytes));
      const pcm = await adapters.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      requireBoundedDecodedIrPcm(pcm);
      if (!isSameEntry()) return discardStaleCache();
      const resampled = await adapters.resample(pcm, targetSampleRate);
      requireBoundedDecodedIrPcm(resampled, 'Resampled impulse response');
      if (!isSameEntry()) return discardStaleCache();
      decoded.push({
        name: original.fileName,
        pcm: resampled
      });
    }
    if (entry.composition === 'pair') {
      const frames = decoded.reduce((maximum, item) => {
        const length = item.pcm.channels[0].length;
        return length > maximum ? length : maximum;
      }, 0);
      requireBoundedDecodedIrShape(4, frames, targetSampleRate, 'Decoded true-stereo impulse response');
    }
    const pcm = entry.composition === 'pair' ? mergeTrueStereoPair(decoded) : decoded[0].pcm;
    requireBoundedDecodedIrPcm(pcm);
    if (!isSameEntry()) return discardStaleCache();
    pcm.fileLabel = withFileLabel(entry).fileLabel;
    if (!isSameEntry()) return discardStaleCache();
    await this.store.pcmCache?.set(irId, targetSampleRate, preparation, {
      sampleRate: targetSampleRate,
      channelData: pcm.channels
    });
    if (!isSameEntry()) return discardStaleCache();
    return pcm;
  }

  async #importSingle(file, options) {
    const bytes = await readFileBytes(file);
    if (options.isCurrent?.() === false) throw new Error('The import was superseded.');
    const header = parseIrAudioHeader(bytes);
    const result = await this.store.importSingle({
      bytes,
      fileName: file.name,
      metadata: {
        ...header,
        topology: header.channels === 1 ? 'mono' : header.channels ? 'independent' : 'unknown'
      }
    });
    return withFileLabel(result.entry);
  }

  async #importPair(files, options) {
    const parts = await Promise.all(files.map(async file => ({ file, bytes: await readFileBytes(file) })));
    if (options.isCurrent?.() === false) throw new Error('The import was superseded.');
    const named = parts.map(part => ({ ...part, side: parseTrueStereoSide(part.file.name) }));
    const left = named.find(part => part.side?.side === 'left');
    const right = named.find(part => part.side?.side === 'right');
    if (!left || !right) throw new Error('Invalid true-stereo pair.');
    const leftHeader = parseIrAudioHeader(left.bytes);
    const rightHeader = parseIrAudioHeader(right.bytes);
    if (leftHeader.channels !== 2 || rightHeader.channels !== 2) {
      throw new Error('Each true-stereo pair file must contain exactly two audio channels.');
    }
    if (!leftHeader.sampleRate || leftHeader.sampleRate !== rightHeader.sampleRate) {
      throw new Error('The left and right impulse-response files must use the same sample rate.');
    }
    const frames = Math.max(leftHeader.frames || 0, rightHeader.frames || 0) || null;
    const sampleRate = leftHeader.sampleRate;
    const result = await this.store.importPair({
      left: { bytes: left.bytes, fileName: left.file.name },
      right: { bytes: right.bytes, fileName: right.file.name },
      metadata: {
        channels: 4,
        frames,
        sampleRate,
        topology: 'true-stereo'
      }
    });
    return withFileLabel(result.entry);
  }
}

let defaultServicePromise = null;

export function getDefaultIrLibraryService(options = {}) {
  if (!defaultServicePromise) {
    const currentPromise = openIrLibrary(options)
      .then(store => new IrLibraryService(store, options))
      .catch(error => {
        if (defaultServicePromise === currentPromise) defaultServicePromise = null;
        throw error;
      });
    defaultServicePromise = currentPromise;
  }
  return defaultServicePromise;
}

export function resetDefaultIrLibraryServiceForTests() {
  defaultServicePromise = null;
}
