import { getSfzMaxBytes, requireSfzMaxBytes } from './limits.js';
import { normalizeSfzPath, parseSfz, sfzError } from './parser.js';
import { prepareSfzSamples, selectSfzRegionsForBudget, mergeSfzWarnings } from './service.js';

const VALID_ID = /^[a-f0-9]{24}$/;
const decoder = new TextDecoder('utf-8', { fatal: true });

function responseData(response, failureCode = 'storage') {
  if (response?.ok === true) return response.data;
  throw sfzError(response?.code === 'too-large' ? 'too-large' : failureCode,
    'The selected SFZ files could not be read.');
}

function entriesFromResponse(response) {
  const entries = responseData(response);
  if (!Array.isArray(entries) || entries.length > 10000 || entries.some(entry =>
    !VALID_ID.test(entry?.id) || typeof entry.name !== 'string' ||
    typeof entry.selectedPath !== 'string' || !/\.sfz$/i.test(entry.selectedPath) ||
    normalizeSfzPath(entry.selectedPath) !== entry.selectedPath)) {
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
    if (isCurrent?.() === false) return null;
    const selected = responseData(await this.bridge.select());
    if (isCurrent?.() === false || !selected) return null;
    return entriesFromResponse({ ok: true, data: selected.banks })
      .map(({ id, name }) => ({ id, name }));
  }

  async list() {
    return entriesFromResponse(await this.bridge.list()).map(({ id, name }) => ({ id, name }));
  }

  async remove(id) {
    if (!VALID_ID.test(id)) throw sfzError('storage', 'Invalid SFZ file identifier.');
    responseData(await this.bridge.remove({ id }));
  }

  async prepare(id, { decode } = {}) {
    const maxBytes = requireSfzMaxBytes(this.getMaxBytes());
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
      return decoder.decode(bytes);
    };
    const first = await parseSfz({ selectedPath: entry.selectedPath, readText, maxBytes,
      hasSample: () => true, onDiagnostic: null });
    const present = new Set();
    const metadata = new Map();
    for (const path of [...new Set(first.regions.map(region => region.sample))].sort()) {
      const stats = responseData(await this.bridge.statRelative({ id, relativePath: path }), 'prepare');
      if (!stats) continue;
      if (!Number.isSafeInteger(stats.size) || stats.size < 0) {
        throw sfzError('prepare', 'An SFZ sample has an invalid size.');
      }
      metadata.set(path, stats);
      present.add(path);
    }
    // Reuse the parser's missing-sample filtering without enumerating the source folder.
    const parsed = await parseSfz({ selectedPath: entry.selectedPath, readText, maxBytes,
      hasSample: path => present.has(path), onDiagnostic: this.onDiagnostic });
    if (!parsed.regions.length) throw sfzError('no-regions', 'The SFZ has no playable regions.');
    const selection = selectSfzRegionsForBudget(parsed.regions, metadata, maxBytes, rawBytes);
    if (selection.reduced) this.onDiagnostic?.({ reducedBank: {
      originalRegions: parsed.regions.length, selectedRegions: selection.regions.length,
      keys: selection.keyCount, representativeVelocity: selection.velocity } });
    parsed.regions = selection.regions;
    if (selection.reduced) parsed.warnings = mergeSfzWarnings(parsed.warnings, [{ code: 'reduced-bank', count: 1 }]);
    const value = await prepareSfzSamples(parsed, async path => {
      const bytes = await read(path);
      if (!bytes) throw sfzError('prepare', 'An SFZ sample could not be found.');
      return bytes;
    }, decode, maxBytes, this.onDiagnostic);
    if (!entriesFromResponse(await this.bridge.list()).some(item => item.id === id)) return null;
    return { ...value, name: entry.name };
  }
}
