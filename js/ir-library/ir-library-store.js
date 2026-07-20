import { identifyPairedIr, identifySingleIr, sha256IrBytes } from './ir-library-id.js';
import { decodeIrAnalysisSidecar, encodeIrAnalysisSidecar, summarizeIrAnalysis } from './ir-analysis-sidecar.js';
import {
  IR_LIBRARY_INDEX_TOO_LARGE_CODE,
  IR_LIBRARY_MAX_ANALYSIS_BYTES,
  IR_LIBRARY_MAX_INDEX_BYTES,
  IR_LIBRARY_MAX_ORIGINAL_BYTES,
  requireBoundedIrBytes
} from './ir-library-limits.js';

export const IR_LIBRARY_INDEX_VERSION = 1;
export const IR_LIBRARY_INDEX_NAME = 'index.json';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ID_PATTERN = /^[a-f0-9]{24}$/;
const MANAGED_FILE_PATTERN = /^[a-f0-9]{24}(?:\.(?:L|R))?\.[a-z0-9]{1,10}$/;
const ORIGINAL_EXTENSIONS = new Set(['.aif', '.aiff', '.bin', '.flac', '.m4a', '.mp3', '.ogg', '.wav']);
const ANALYSIS_REVISION_PATTERN = /^([a-f0-9]{24})\.a([0-9]{9})$/;

function safeText(value, maxLength = 1024) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function extensionFor(fileName) {
  const match = safeText(fileName).toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  const extension = match ? `.${match[1]}` : '.bin';
  return ORIGINAL_EXTENSIONS.has(extension) ? extension : '.bin';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyIndex() {
  return { version: IR_LIBRARY_INDEX_VERSION, entries: {} };
}

function validateOriginal(id, composition, original) {
  const expectedBase = composition === 'pair' ? `${id}.${original?.role}` : id;
  const extension = typeof original?.storageName === 'string'
    ? original.storageName.slice(expectedBase.length)
    : '';
  return original && typeof original === 'object' &&
    ['single', 'L', 'R'].includes(original.role) &&
    typeof original.storageName === 'string' && MANAGED_FILE_PATTERN.test(original.storageName) &&
    original.storageName.startsWith(`${expectedBase}.`) && ORIGINAL_EXTENSIONS.has(extension) &&
    typeof original.fileName === 'string' && original.fileName.length > 0 && original.fileName.length <= 512 &&
    /^[a-f0-9]{64}$/.test(original.sha256) &&
    Number.isSafeInteger(original.byteLength) && original.byteLength >= 0;
}

function validateNullableInteger(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function validatePathSummary(value) {
  return Array.isArray(value) && value.length <= 8 && value.every(path =>
    path && typeof path === 'object' &&
    Number.isSafeInteger(path.input) && path.input >= 0 &&
    Number.isSafeInteger(path.output) && path.output >= 0 &&
    Number.isSafeInteger(path.irChannel) && path.irChannel >= 0);
}

function validateAnalysisStorageName(id, storageName) {
  if (storageName === `${id}.analysis`) return true;
  const match = typeof storageName === 'string' ? ANALYSIS_REVISION_PATTERN.exec(storageName) : null;
  return match?.[1] === id;
}

function validateEntry(id, entry) {
  if (!ID_PATTERN.test(id) || !entry || entry.irId !== id) return false;
  if (['name', 'tags', 'source', 'sourceUrl'].some(field => Object.hasOwn(entry, field))) return false;
  if (!['single', 'pair'].includes(entry.composition) || !Array.isArray(entry.originals)) return false;
  if (entry.composition === 'single' && entry.originals.length !== 1) return false;
  if (entry.composition === 'pair' && entry.originals.length !== 2) return false;
  const roles = entry.originals.map(original => original.role).join(',');
  if ((entry.composition === 'single' && roles !== 'single') ||
      (entry.composition === 'pair' && roles !== 'L,R')) return false;
  const summary = summarizeIrAnalysis(entry.analysis);
  const validSummary = entry.analysis && summary.onsetFrame === entry.analysis.onsetFrame && summary.rt60 === entry.analysis.rt60 &&
    summary.peakDb === entry.analysis?.peakDb && !Object.hasOwn(entry.analysis, 'data');
  const validImportedAt = typeof entry.importedAt === 'string' &&
    Number.isFinite(Date.parse(entry.importedAt));
  return entry.originals.every(original => validateOriginal(id, entry.composition, original)) &&
    Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 &&
    entry.bytes === entry.originals.reduce((total, original) => total + original.byteLength, 0) &&
    validateNullableInteger(entry.channels) && validateNullableInteger(entry.frames) &&
    validateNullableInteger(entry.sampleRate) &&
    typeof entry.topology === 'string' && entry.topology.length > 0 && entry.topology.length <= 64 &&
    validatePathSummary(entry.pathSummary) && validImportedAt && validSummary &&
    validateAnalysisStorageName(id, entry.analysis?.storageName);
}

function entryStorageNames(entry) {
  return [...entry.originals.map(original => original.storageName), entry.analysis.storageName];
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizePathSummary(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map(path => ({
    input: safeInteger(path?.input),
    output: safeInteger(path?.output),
    irChannel: safeInteger(path?.irChannel)
  })).filter(path => path.input !== null && path.output !== null && path.irChannel !== null);
}

function normalizeTechnicalMetadata(metadata = {}) {
  return {
    channels: safeInteger(metadata.channels),
    frames: safeInteger(metadata.frames),
    sampleRate: safeInteger(metadata.sampleRate),
    topology: safeText(metadata.topology, 64),
    pathSummary: normalizePathSummary(metadata.pathSummary)
  };
}

function safeFailure(error, diagnostic, operation) {
  diagnostic?.(error);
  const failure = new Error(`The IR library could not ${operation}.`);
  failure.code = 'ir-library-unavailable';
  return failure;
}

export class IrLibraryStore {
  constructor(backend, options = {}) {
    if (!backend || !['read', 'exists', 'writeAtomic', 'remove', 'list', 'cleanupTemporary'].every(name => typeof backend[name] === 'function')) {
      throw new TypeError('A valid IR library backend is required.');
    }
    this.backend = backend;
    this.diagnostic = options.onDiagnostic || (error => console.error('IR library diagnostic:', error));
    this.index = emptyIndex();
    this.opened = false;
    this.mutation = Promise.resolve();
    this.requestPersistence = typeof options.requestPersistence === 'function' ? options.requestPersistence : null;
    this.persistenceRequested = false;
    this.pcmCache = options.pcmCache || null;
    this.recoveryRequired = false;
    this.entryRevisions = new Map();
    this.originalRevisions = new Map();
  }

  async open() {
    if (this.opened) return this;
    let bytes;
    try {
      bytes = await this.backend.read(IR_LIBRARY_INDEX_NAME);
    } catch (error) {
      if (error?.code === IR_LIBRARY_INDEX_TOO_LARGE_CODE) return this.#enterRecovery(error);
      throw safeFailure(error, this.diagnostic, 'open');
    }
    if (!bytes) {
      try {
        const names = await this.backend.list();
        if (names.some(name => MANAGED_FILE_PATTERN.test(name))) {
          return this.#enterRecovery(new Error('The IR library index is missing while managed files remain.'));
        }
        this.index = emptyIndex();
        this.opened = true;
        return this;
      } catch (error) {
        throw safeFailure(error, this.diagnostic, 'open');
      }
    }
    let parsed;
    try {
      requireBoundedIrBytes(bytes, IR_LIBRARY_MAX_INDEX_BYTES, 'IR library index');
      parsed = JSON.parse(decoder.decode(bytes));
      if (parsed?.version !== IR_LIBRARY_INDEX_VERSION || !parsed.entries ||
          typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
        throw new Error('Unsupported IR library index.');
      }
    } catch (error) {
      return this.#enterRecovery(error);
    }
    const parsedEntries = Object.entries(parsed.entries);
    let entriesAreValid = false;
    try {
      entriesAreValid = parsedEntries.every(([id, entry]) => validateEntry(id, entry));
    } catch {
      entriesAreValid = false;
    }
    if (!entriesAreValid) {
      return this.#enterRecovery(new Error('The IR library index contains an invalid entry.'));
    }
    try {
      const entries = {};
      const claimedStorageNames = new Set();
      let changed = false;
      for (const [id, entry] of parsedEntries) {
        const storageNames = entryStorageNames(entry);
        if (new Set(storageNames).size !== storageNames.length ||
            storageNames.some(name => claimedStorageNames.has(name))) {
          changed = true;
          continue;
        }
        const required = entry.originals.map(item => item.storageName);
        const available = await Promise.all(required.map(name => this.backend.exists(name)));
        if (available.every(Boolean)) {
          entries[id] = entry;
          storageNames.forEach(name => claimedStorageNames.add(name));
        } else changed = true;
      }
      this.index = { version: IR_LIBRARY_INDEX_VERSION, entries };
      for (const id of Object.keys(entries)) this.#touchOriginal(id);
      if (changed) await this.#writeIndex();
      await this.#cleanOwnedOrphans();
      this.opened = true;
      return this;
    } catch (error) {
      throw safeFailure(error, this.diagnostic, 'recover');
    }
  }

  list() {
    this.#requireOpen();
    return Object.values(this.index.entries).map(clone);
  }

  get(irId) {
    this.#requireOpen();
    const entry = this.index.entries[irId];
    return entry ? clone(entry) : null;
  }

  getEntryRevision(irId) {
    this.#requireOpen();
    return this.index.entries[irId] ? this.entryRevisions.get(irId) || 0 : null;
  }

  getOriginalRevision(irId) {
    this.#requireOpen();
    return this.index.entries[irId] ? this.originalRevisions.get(irId) || 0 : null;
  }

  importSingle(request) {
    this.#requestPersistence();
    return this.#serialize(() => this.#importSingle(request));
  }

  importPair(request) {
    this.#requestPersistence();
    return this.#serialize(() => this.#importPair(request));
  }

  remove(irId, options = {}) {
    const canRemove = typeof options.canRemove === 'function' ? options.canRemove : null;
    return this.#serialize(() => this.#remove(irId, canRemove));
  }

  updateAnalysis(irId, analysis) {
    return this.#serialize(() => this.#updateAnalysis(irId, analysis));
  }

  async readOriginal(irId, role = 'single') {
    this.#requireOpen();
    const original = this.index.entries[irId]?.originals.find(item => item.role === role);
    if (!original) return null;
    let bytes;
    try {
      bytes = await this.backend.read(original.storageName);
    } catch (error) {
      throw safeFailure(error, this.diagnostic, 'read this impulse response');
    }
    try {
      if (!bytes) throw new Error(`The stored ${role} IR original is missing.`);
      requireBoundedIrBytes(bytes, IR_LIBRARY_MAX_ORIGINAL_BYTES, 'IR original');
      if (bytes.byteLength !== original.byteLength) throw new Error(`The stored ${role} IR original has the wrong size.`);
      if (await sha256IrBytes(bytes) !== original.sha256) throw new Error(`The stored ${role} IR original failed its integrity check.`);
      return bytes;
    } catch (error) {
      this.diagnostic(error);
      return null;
    }
  }

  async readAnalysis(irId) {
    this.#requireOpen();
    const analysis = this.index.entries[irId]?.analysis;
    if (!analysis) return null;
    try {
      const bytes = await this.backend.read(analysis.storageName);
      if (!bytes) return null;
      requireBoundedIrBytes(bytes, IR_LIBRARY_MAX_ANALYSIS_BYTES, 'IR analysis');
      return Object.freeze({
        onsetFrame: analysis.onsetFrame,
        rt60: analysis.rt60,
        peakDb: analysis.peakDb,
        ...decodeIrAnalysisSidecar(bytes)
      });
    } catch (error) {
      this.diagnostic(error);
      return null;
    }
  }

  #requireOpen() {
    if (!this.opened) throw new Error('Open the IR library before using it.');
  }

  #serialize(task) {
    const run = this.mutation.then(() => {
      this.#requireOpen();
      if (this.recoveryRequired) {
        const error = new Error('The IR library needs to be restored before it can be changed.');
        error.code = 'ir-library-recovery-required';
        throw error;
      }
      return task();
    });
    this.mutation = run.catch(() => {});
    return run;
  }

  #requestPersistence() {
    if (this.persistenceRequested || !this.requestPersistence) return;
    this.persistenceRequested = true;
    Promise.resolve()
      .then(() => this.requestPersistence())
      .then(granted => {
        if (granted === false) this.diagnostic(new Error('Persistent browser storage was not granted.'));
      })
      .catch(error => this.diagnostic(error));
  }

  async #importSingle(request = {}) {
    const bytes = request.bytes;
    try {
      requireBoundedIrBytes(bytes, IR_LIBRARY_MAX_ORIGINAL_BYTES, 'IR original');
      const identity = await identifySingleIr(bytes);
      const duplicate = await this.#resolveDuplicate(identity.irId, 'single', [{
        role: 'single',
        bytes,
        sha256: identity.sha256
      }]);
      if (duplicate) return duplicate;
      const storageName = `${identity.irId}${extensionFor(request.fileName)}`;
      const analysisName = `${identity.irId}.analysis`;
      const metadata = normalizeTechnicalMetadata(request.metadata);
      const analysisSummary = summarizeIrAnalysis(request.analysis);
      const entry = {
        irId: identity.irId,
        composition: 'single',
        bytes: bytes.byteLength,
        channels: metadata.channels,
        frames: metadata.frames,
        sampleRate: metadata.sampleRate,
        topology: metadata.topology || 'single',
        pathSummary: metadata.pathSummary,
        originals: [{
          role: 'single',
          storageName,
          fileName: safeText(request.fileName, 512) || storageName,
          sha256: identity.sha256,
          byteLength: bytes.byteLength
        }],
        analysis: { storageName: analysisName, ...analysisSummary },
        importedAt: new Date().toISOString()
      };
      await this.backend.writeAtomic(storageName, bytes);
      const analysisBytes = encodeIrAnalysisSidecar(request.analysis);
      requireBoundedIrBytes(analysisBytes, IR_LIBRARY_MAX_ANALYSIS_BYTES, 'IR analysis');
      await this.backend.writeAtomic(analysisName, analysisBytes);
      this.index.entries[identity.irId] = entry;
      try {
        await this.#writeIndex();
      } catch (error) {
        delete this.index.entries[identity.irId];
        throw error;
      }
      this.#touchOriginal(identity.irId);
      return { entry: clone(entry), duplicate: false };
    } catch (error) {
      throw safeFailure(error, this.diagnostic, 'save this impulse response');
    }
  }

  async #importPair(request = {}) {
    try {
      requireBoundedIrBytes(request.left?.bytes, IR_LIBRARY_MAX_ORIGINAL_BYTES, 'Left IR original');
      requireBoundedIrBytes(request.right?.bytes, IR_LIBRARY_MAX_ORIGINAL_BYTES, 'Right IR original');
      const identity = await identifyPairedIr(request.left?.bytes, request.right?.bytes);
      const duplicate = await this.#resolveDuplicate(identity.irId, 'pair', [
        { role: 'L', bytes: request.left.bytes, sha256: identity.leftSha256 },
        { role: 'R', bytes: request.right.bytes, sha256: identity.rightSha256 }
      ]);
      if (duplicate) return duplicate;
      const leftName = `${identity.irId}.L${extensionFor(request.left.fileName)}`;
      const rightName = `${identity.irId}.R${extensionFor(request.right.fileName)}`;
      const analysisName = `${identity.irId}.analysis`;
      const metadata = normalizeTechnicalMetadata(request.metadata);
      const analysisSummary = summarizeIrAnalysis(request.analysis);
      const sources = [
        { role: 'L', part: request.left, sha256: identity.leftSha256, storageName: leftName },
        { role: 'R', part: request.right, sha256: identity.rightSha256, storageName: rightName }
      ];
      const entry = {
        irId: identity.irId,
        composition: 'pair',
        bytes: request.left.bytes.byteLength + request.right.bytes.byteLength,
        channels: metadata.channels,
        frames: metadata.frames,
        sampleRate: metadata.sampleRate,
        topology: metadata.topology || 'true-stereo',
        pathSummary: metadata.pathSummary,
        originals: sources.map(item => ({
          role: item.role,
          storageName: item.storageName,
          fileName: safeText(item.part.fileName, 512) || item.storageName,
          sha256: item.sha256,
          byteLength: item.part.bytes.byteLength
        })),
        analysis: { storageName: analysisName, ...analysisSummary },
        importedAt: new Date().toISOString()
      };
      for (const source of sources) await this.backend.writeAtomic(source.storageName, source.part.bytes);
      const analysisBytes = encodeIrAnalysisSidecar(request.analysis);
      requireBoundedIrBytes(analysisBytes, IR_LIBRARY_MAX_ANALYSIS_BYTES, 'IR analysis');
      await this.backend.writeAtomic(analysisName, analysisBytes);
      this.index.entries[identity.irId] = entry;
      try {
        await this.#writeIndex();
      } catch (error) {
        delete this.index.entries[identity.irId];
        throw error;
      }
      this.#touchOriginal(identity.irId);
      return { entry: clone(entry), duplicate: false };
    } catch (error) {
      throw safeFailure(error, this.diagnostic, 'save this impulse response');
    }
  }

  async #remove(irId, canRemove) {
    const entry = this.index.entries[irId];
    if (!entry) return false;
    if (canRemove) {
      try {
        const decision = canRemove(irId, clone(entry));
        if (decision !== true || typeof decision?.then === 'function') return false;
      } catch (error) {
        this.diagnostic(error);
        return false;
      }
    }
    delete this.index.entries[irId];
    try {
      await this.#writeIndex();
    } catch (error) {
      this.index.entries[irId] = entry;
      throw safeFailure(error, this.diagnostic, 'remove this impulse response');
    }
    this.#touchOriginal(irId);
    for (const name of [...entry.originals.map(item => item.storageName), entry.analysis.storageName]) {
      if (this.#isStorageNameReferenced(name)) continue;
      try {
        await this.backend.remove(name);
      } catch (error) {
        this.diagnostic(error);
      }
    }
    try {
      await this.pcmCache?.deleteAll?.(irId);
    } catch (error) {
      this.diagnostic(error);
    }
    return true;
  }

  async #updateAnalysis(irId, analysis = {}) {
    const entry = this.index.entries[irId];
    if (!entry) return false;
    const previous = clone(entry.analysis);
    let nextStorageName = null;
    try {
      const bytes = encodeIrAnalysisSidecar(analysis);
      requireBoundedIrBytes(bytes, IR_LIBRARY_MAX_ANALYSIS_BYTES, 'IR analysis');
      nextStorageName = await this.#nextAnalysisStorageName(irId, previous.storageName);
      await this.backend.writeAtomic(nextStorageName, bytes);
      entry.analysis = { storageName: nextStorageName, ...summarizeIrAnalysis(analysis) };
      await this.#writeIndex();
      this.#touchEntry(irId);
      if (!this.#isStorageNameReferenced(previous.storageName)) {
        try {
          await this.backend.remove(previous.storageName);
        } catch (error) {
          this.diagnostic(error);
        }
      }
      return true;
    } catch (error) {
      entry.analysis = previous;
      if (nextStorageName) {
        try {
          await this.backend.remove(nextStorageName);
        } catch (cleanupError) {
          this.diagnostic(cleanupError);
        }
      }
      throw safeFailure(error, this.diagnostic, 'update this analysis');
    }
  }

  async #nextAnalysisStorageName(irId, currentStorageName) {
    const match = ANALYSIS_REVISION_PATTERN.exec(currentStorageName);
    let revision = match?.[1] === irId ? Number(match[2]) + 1 : 1;
    while (revision <= 999999999) {
      const storageName = `${irId}.a${String(revision).padStart(9, '0')}`;
      if (!await this.backend.exists(storageName)) return storageName;
      revision += 1;
    }
    throw new Error('IR analysis revision capacity was exhausted.');
  }

  async #resolveDuplicate(irId, composition, sources) {
    const duplicate = this.index.entries[irId];
    if (!duplicate) return null;
    const originalsByRole = new Map(duplicate.originals.map(original => [original.role, original]));
    const identityMatches = duplicate.composition === composition && duplicate.originals.length === sources.length &&
      sources.every(source => {
        const original = originalsByRole.get(source.role);
        return original && original.sha256 === source.sha256 && original.byteLength === source.bytes.byteLength;
      });
    if (!identityMatches) throw new Error('An impulse-response identity collision was detected.');

    let repaired = false;
    for (const source of sources) {
      const original = originalsByRole.get(source.role);
      let stored = null;
      try {
        stored = await this.backend.read(original.storageName);
        if (stored) requireBoundedIrBytes(stored, IR_LIBRARY_MAX_ORIGINAL_BYTES, 'IR original');
      } catch (error) {
        this.diagnostic(error);
        stored = null;
      }
      const valid = Boolean(stored) && stored.byteLength === original.byteLength &&
        await sha256IrBytes(stored) === original.sha256;
      if (!valid) {
        await this.backend.writeAtomic(original.storageName, source.bytes);
        repaired = true;
      }
    }
    if (repaired) this.#touchEntry(irId);
    return { entry: clone(duplicate), duplicate: true };
  }

  #touchEntry(irId) {
    this.entryRevisions.set(irId, (this.entryRevisions.get(irId) || 0) + 1);
  }

  #touchOriginal(irId) {
    this.#touchEntry(irId);
    this.originalRevisions.set(irId, (this.originalRevisions.get(irId) || 0) + 1);
  }

  #isStorageNameReferenced(storageName) {
    return Object.values(this.index.entries).some(entry => entryStorageNames(entry).includes(storageName));
  }

  async #writeIndex() {
    const bytes = encoder.encode(JSON.stringify(this.index));
    requireBoundedIrBytes(bytes, IR_LIBRARY_MAX_INDEX_BYTES, 'IR library index');
    await this.backend.writeAtomic(IR_LIBRARY_INDEX_NAME, bytes);
  }

  #enterRecovery(error) {
    this.diagnostic(error);
    this.index = emptyIndex();
    this.recoveryRequired = true;
    this.opened = true;
    return this;
  }

  async #cleanOwnedOrphans() {
    await this.backend.cleanupTemporary();
    const referenced = new Set([IR_LIBRARY_INDEX_NAME]);
    for (const entry of Object.values(this.index.entries)) {
      for (const original of entry.originals) referenced.add(original.storageName);
      referenced.add(entry.analysis.storageName);
    }
    const names = await this.backend.list();
    for (const name of names) {
      if (MANAGED_FILE_PATTERN.test(name) && !referenced.has(name)) {
        try { await this.backend.remove(name); } catch (error) { this.diagnostic(error); }
      }
    }
  }
}
