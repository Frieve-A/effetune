import {
  MAX_TRANSPORT_SEQUENCE_ITEMS,
  ReversibleShufflePermutation,
  shuffleEpochSeed
} from '../../library/repository/transport-shuffle.js';

const MAX_SEQUENCE_ITEMS = MAX_TRANSPORT_SEQUENCE_ITEMS;
export { ReversibleShufflePermutation } from '../../library/repository/transport-shuffle.js';
export const MAX_MATERIALIZED_SEQUENCE_ITEMS = 4_096;
export const CATALOG_SEQUENCE_PAGE_SIZE = 200;
export const CATALOG_SEQUENCE_MAX_CACHED_PAGES = 5;
export const CATALOG_QUEUE_WINDOW_SIZE = 80;
export const TRANSPORT_DEADLINE_MS = Object.freeze({ electron: 3_000, web: 5_000 });

let materializedEntrySequence = 0;

export class MaterializedSequence {
  constructor(entries = []) {
    if (!Array.isArray(entries)) throw new TypeError('Materialized sequence entries must be an array');
    if (entries.length > MAX_MATERIALIZED_SEQUENCE_ITEMS) {
      throw new RangeError(`Materialized sequences are limited to ${MAX_MATERIALIZED_SEQUENCE_ITEMS} entries`);
    }
    this.kind = 'materialized';
    this.sequenceId = `materialized-${(++materializedEntrySequence).toString(36)}`;
    this.entries = Object.freeze(entries.map(entry => immutableEntry(entry, nextMaterializedEntryId())));
    this.itemCount = this.entries.length;
  }

  getEntry(ordinal) {
    validateOrdinal(ordinal, this.itemCount);
    return immutableEntry({
      ...this.entries[ordinal],
      sequenceId: this.sequenceId,
      transportOrdinal: ordinal,
      canonicalOrdinal: ordinal
    }, this.entries[ordinal].entryInstanceId);
  }

  getWindow({ startOrdinal = 0, limit = CATALOG_QUEUE_WINDOW_SIZE } = {}) {
    const normalizedLimit = normalizeWindowLimit(limit);
    const start = Math.max(0, Math.min(startOrdinal, Math.max(0, this.itemCount - 1)));
    return Promise.resolve({
      startOrdinal: start,
      rows: this.entries.slice(start, start + normalizedLimit),
      totalCount: this.itemCount
    });
  }

  peekEntry(ordinal) {
    return this.getEntry(ordinal);
  }

  resolveEntrySource(entry) {
    if (!entry || entry.sequenceId !== this.sequenceId) {
      return Promise.reject(new TypeError('Materialized entry does not belong to this sequence'));
    }
    return Promise.resolve({ path: entry.path, file: entry.file, provider: entry.provider });
  }

  getDescriptor() {
    return Object.freeze({
      kind: 'materialized',
      sequenceId: this.sequenceId,
      itemCount: this.itemCount,
      trackUids: Object.freeze(this.entries.map(entry => entry.libraryTrackId ?? null))
    });
  }

  clear() {}
}

export class CatalogSequence {
  constructor({
    sequenceId,
    itemCount,
    readPage,
    resolveSource,
    pageSize = CATALOG_SEQUENCE_PAGE_SIZE,
    shuffleSeed = 0,
    shuffleEpoch = 0,
    shuffleEnabled = false,
    shuffleTransportOffset = 0
  } = {}) {
    if (typeof sequenceId !== 'string' || sequenceId.length === 0) {
      throw new TypeError('Catalog sequenceId must be a non-empty string');
    }
    if (!Number.isSafeInteger(itemCount) || itemCount < 1 || itemCount > MAX_SEQUENCE_ITEMS) {
      throw new RangeError(`Catalog itemCount must be an integer from 1 to ${MAX_SEQUENCE_ITEMS}`);
    }
    if (typeof readPage !== 'function' || typeof resolveSource !== 'function') {
      throw new TypeError('Catalog readPage and resolveSource functions are required');
    }
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      throw new RangeError('Catalog pageSize must be an integer from 1 to 500');
    }
    this.kind = 'catalog';
    this.sequenceId = sequenceId;
    this.itemCount = itemCount;
    this.readPage = readPage;
    this.resolveSource = resolveSource;
    this.pageSize = pageSize;
    this.shuffleSeed = shuffleSeed;
    validateRestoredShuffleState(itemCount, shuffleSeed, shuffleEpoch, shuffleTransportOffset);
    this.shuffleEpoch = shuffleEpoch;
    this.shuffleEnabled = Boolean(shuffleEnabled);
    this.shuffleTransportOffset = shuffleTransportOffset;
    this.permutation = new ReversibleShufflePermutation(itemCount, shuffleEpochSeed(shuffleSeed, shuffleEpoch));
    this.pages = new Map();
    this.pageRequests = new Map();
    this.currentPageIndex = 0;
  }

  setShuffle(enabled, { seed = this.shuffleSeed, preserveEpoch = false } = {}) {
    this.shuffleEnabled = Boolean(enabled);
    this.shuffleSeed = seed;
    if (!preserveEpoch) this.shuffleEpoch = 0;
    this.shuffleTransportOffset = 0;
    this.#refreshPermutation();
  }

  restoreShuffleState({ enabled, seed, epoch, transportOffset } = {}) {
    validateRestoredShuffleState(this.itemCount, seed, epoch, transportOffset);
    this.shuffleEnabled = Boolean(enabled);
    this.shuffleSeed = seed;
    this.shuffleEpoch = epoch;
    this.shuffleTransportOffset = transportOffset;
    this.#refreshPermutation();
  }

  moveTransportOrdinal(currentOrdinal, step, repeatMode = 'OFF') {
    validateOrdinal(currentOrdinal, this.itemCount);
    if (repeatMode === 'ONE') return currentOrdinal;
    const next = currentOrdinal + step;
    if (next >= 0 && next < this.itemCount) return next;
    if (repeatMode !== 'ALL') return null;
    if (this.shuffleEnabled) {
      const boundaryOrdinal = step > 0 ? 0 : this.itemCount - 1;
      const previousCanonicalOrdinal = this.toCanonicalOrdinal(currentOrdinal);
      this.shuffleEpoch += step > 0 ? 1 : -1;
      this.shuffleTransportOffset = 0;
      this.#refreshPermutation();
      if (
        this.itemCount > 1 &&
        this.toCanonicalOrdinal(boundaryOrdinal) === previousCanonicalOrdinal
      ) {
        this.shuffleTransportOffset = 1;
      }
    }
    return step > 0 ? 0 : this.itemCount - 1;
  }

  toCanonicalOrdinal(transportOrdinal) {
    validateOrdinal(transportOrdinal, this.itemCount);
    if (!this.shuffleEnabled) return transportOrdinal;
    return this.permutation.permute((transportOrdinal + this.shuffleTransportOffset) % this.itemCount);
  }

  toTransportOrdinal(canonicalOrdinal) {
    validateOrdinal(canonicalOrdinal, this.itemCount);
    if (!this.shuffleEnabled) return canonicalOrdinal;
    return (this.permutation.invert(canonicalOrdinal) - this.shuffleTransportOffset + this.itemCount) % this.itemCount;
  }

  async getEntry(transportOrdinal) {
    const canonicalOrdinal = this.toCanonicalOrdinal(transportOrdinal);
    const entry = await this.getCanonicalEntry(canonicalOrdinal);
    return immutableEntry({
      ...entry,
      transportOrdinal,
      canonicalOrdinal
    }, entry.entryInstanceId);
  }

  peekEntry(transportOrdinal) {
    const canonicalOrdinal = this.toCanonicalOrdinal(transportOrdinal);
    const page = this.pages.get(Math.floor(canonicalOrdinal / this.pageSize));
    if (!page) return null;
    const entry = page.rows[canonicalOrdinal - page.startOrdinal] ?? null;
    if (!entry) return null;
    return immutableEntry({
      ...entry,
      transportOrdinal,
      canonicalOrdinal
    }, entry.entryInstanceId);
  }

  async getCanonicalEntry(canonicalOrdinal) {
    validateOrdinal(canonicalOrdinal, this.itemCount);
    const pageIndex = Math.floor(canonicalOrdinal / this.pageSize);
    const page = await this.#loadPage(pageIndex);
    const entry = page.rows[canonicalOrdinal - page.startOrdinal];
    if (!entry) throw new RangeError('Catalog page did not contain the requested ordinal');
    return entry;
  }

  async getWindow({ centerOrdinal = 0, startOrdinal, limit = CATALOG_QUEUE_WINDOW_SIZE } = {}) {
    const normalizedLimit = normalizeWindowLimit(limit);
    const start = Number.isSafeInteger(startOrdinal)
      ? Math.max(0, Math.min(startOrdinal, Math.max(0, this.itemCount - 1)))
      : Math.max(0, Math.min(
        centerOrdinal - Math.floor(normalizedLimit / 2),
        Math.max(0, this.itemCount - normalizedLimit)
      ));
    const rows = [];
    for (let ordinal = start; ordinal < Math.min(this.itemCount, start + normalizedLimit); ordinal += 1) {
      rows.push(await this.getEntry(ordinal));
    }
    return { startOrdinal: start, rows, totalCount: this.itemCount };
  }

  resolveEntrySource(entry) {
    if (!entry || entry.sequenceId && entry.sequenceId !== this.sequenceId) {
      return Promise.reject(new TypeError('Catalog entry does not belong to this sequence'));
    }
    return this.resolveSource({
      sequenceId: this.sequenceId,
      entryInstanceId: entry.entryInstanceId,
      trackUid: entry.trackUid ?? entry.libraryTrackId ?? null,
      ordinal: entry.sourceCanonicalOrdinal ?? entry.canonicalOrdinal
    });
  }

  getDescriptor() {
    return Object.freeze({
      kind: 'catalog',
      sequenceId: this.sequenceId,
      itemCount: this.itemCount,
      pageSize: this.pageSize,
      shuffleSeed: this.shuffleSeed,
      shuffleEpoch: this.shuffleEpoch,
      shuffleEnabled: this.shuffleEnabled,
      shuffleTransportOffset: this.shuffleTransportOffset
    });
  }

  getCacheStats() {
    return Object.freeze({
      cachedPageCount: this.pages.size,
      cachedRowCount: [...this.pages.values()].reduce((total, page) => total + page.rows.length, 0),
      pendingPageCount: this.pageRequests.size
    });
  }

  clear() {
    this.pages.clear();
    this.pageRequests.clear();
  }

  async #loadPage(pageIndex) {
    const cached = this.pages.get(pageIndex);
    if (cached) {
      this.currentPageIndex = pageIndex;
      this.#trimPages();
      return cached;
    }
    const pending = this.pageRequests.get(pageIndex);
    if (pending) return pending;
    if (this.pageRequests.size >= CATALOG_SEQUENCE_MAX_CACHED_PAGES) {
      throw new Error('Catalog sequence page request limit reached');
    }
    const startOrdinal = pageIndex * this.pageSize;
    const request = Promise.resolve(this.readPage({
      sequenceId: this.sequenceId,
      startOrdinal,
      limit: Math.min(this.pageSize, this.itemCount - startOrdinal)
    })).then(result => {
      const sourceRows = Array.isArray(result) ? result : result?.rows;
      if (!Array.isArray(sourceRows) || sourceRows.length > this.pageSize) {
        throw new TypeError('Catalog sequence page is invalid or unbounded');
      }
      const rows = Object.freeze(sourceRows.map((row, index) => immutableEntry({
        ...row,
        sequenceId: this.sequenceId,
        canonicalOrdinal: startOrdinal + index
      }, row?.entryInstanceId ?? `${this.sequenceId}:${startOrdinal + index}`)));
      const page = Object.freeze({ startOrdinal, rows });
      this.currentPageIndex = pageIndex;
      this.pages.set(pageIndex, page);
      this.#trimPages();
      return page;
    }).finally(() => {
      this.pageRequests.delete(pageIndex);
    });
    this.pageRequests.set(pageIndex, request);
    return request;
  }

  #trimPages() {
    for (const pageIndex of this.pages.keys()) {
      if (Math.abs(pageIndex - this.currentPageIndex) > 2) this.pages.delete(pageIndex);
    }
    while (this.pages.size > CATALOG_SEQUENCE_MAX_CACHED_PAGES) {
      const [oldest] = this.pages.keys();
      this.pages.delete(oldest);
    }
  }

  #refreshPermutation() {
    const epochSeed = shuffleEpochSeed(this.shuffleSeed, this.shuffleEpoch);
    this.permutation = new ReversibleShufflePermutation(this.itemCount, epochSeed);
  }
}

export class CompositeCatalogSequence {
  constructor({
    sequenceId,
    segments,
    shuffleSeed = 0,
    shuffleEpoch = 0,
    shuffleEnabled = false,
    shuffleTransportOffset = 0
  } = {}) {
    if (typeof sequenceId !== 'string' || sequenceId.length === 0) {
      throw new TypeError('Composite sequenceId must be a non-empty string');
    }
    if (!Array.isArray(segments) || segments.length === 0) {
      throw new TypeError('Composite playback segments are required');
    }
    this.kind = 'catalog';
    this.sequenceId = sequenceId;
    this.segments = Object.freeze(segments.map(normalizeCompositeSegment));
    this.itemCount = this.segments.reduce((total, segment) => total + segment.itemCount, 0);
    if (this.itemCount < 1 || this.itemCount > MAX_SEQUENCE_ITEMS) {
      throw new RangeError(`Composite itemCount must be from 1 to ${MAX_SEQUENCE_ITEMS}`);
    }
    this.shuffleSeed = shuffleSeed;
    validateRestoredShuffleState(this.itemCount, shuffleSeed, shuffleEpoch, shuffleTransportOffset);
    this.shuffleEpoch = shuffleEpoch;
    this.shuffleEnabled = Boolean(shuffleEnabled);
    this.shuffleTransportOffset = shuffleTransportOffset;
    this.permutation = new ReversibleShufflePermutation(
      this.itemCount,
      shuffleEpochSeed(shuffleSeed, shuffleEpoch)
    );
  }

  setShuffle(enabled, { seed = this.shuffleSeed, preserveEpoch = false } = {}) {
    this.shuffleEnabled = Boolean(enabled);
    this.shuffleSeed = seed;
    if (!preserveEpoch) this.shuffleEpoch = 0;
    this.shuffleTransportOffset = 0;
    this.#refreshPermutation();
  }

  restoreShuffleState({ enabled, seed, epoch, transportOffset } = {}) {
    validateRestoredShuffleState(this.itemCount, seed, epoch, transportOffset);
    this.shuffleEnabled = Boolean(enabled);
    this.shuffleSeed = seed;
    this.shuffleEpoch = epoch;
    this.shuffleTransportOffset = transportOffset;
    this.#refreshPermutation();
  }

  moveTransportOrdinal(currentOrdinal, step, repeatMode = 'OFF') {
    validateOrdinal(currentOrdinal, this.itemCount);
    if (repeatMode === 'ONE') return currentOrdinal;
    const next = currentOrdinal + step;
    if (next >= 0 && next < this.itemCount) return next;
    if (repeatMode !== 'ALL') return null;
    if (this.shuffleEnabled) {
      const boundaryOrdinal = step > 0 ? 0 : this.itemCount - 1;
      const previousCanonicalOrdinal = this.toCanonicalOrdinal(currentOrdinal);
      this.shuffleEpoch += step > 0 ? 1 : -1;
      this.shuffleTransportOffset = 0;
      this.#refreshPermutation();
      if (
        this.itemCount > 1 &&
        this.toCanonicalOrdinal(boundaryOrdinal) === previousCanonicalOrdinal
      ) {
        this.shuffleTransportOffset = 1;
      }
    }
    return step > 0 ? 0 : this.itemCount - 1;
  }

  toCanonicalOrdinal(transportOrdinal) {
    validateOrdinal(transportOrdinal, this.itemCount);
    if (!this.shuffleEnabled) return transportOrdinal;
    return this.permutation.permute((transportOrdinal + this.shuffleTransportOffset) % this.itemCount);
  }

  toTransportOrdinal(canonicalOrdinal) {
    validateOrdinal(canonicalOrdinal, this.itemCount);
    if (!this.shuffleEnabled) return canonicalOrdinal;
    return (this.permutation.invert(canonicalOrdinal) - this.shuffleTransportOffset + this.itemCount) % this.itemCount;
  }

  async getEntry(transportOrdinal) {
    const canonicalOrdinal = this.toCanonicalOrdinal(transportOrdinal);
    const { segment, offset } = this.#findSegment(canonicalOrdinal);
    const sourceEntry = await segment.sequence.getEntry(segment.startOrdinal + offset);
    return compositeEntry(sourceEntry, segment.sequence.sequenceId, transportOrdinal, canonicalOrdinal);
  }

  peekEntry(transportOrdinal) {
    const canonicalOrdinal = this.toCanonicalOrdinal(transportOrdinal);
    const { segment, offset } = this.#findSegment(canonicalOrdinal);
    const sourceEntry = segment.sequence.peekEntry?.(segment.startOrdinal + offset) ?? null;
    return sourceEntry
      ? compositeEntry(sourceEntry, segment.sequence.sequenceId, transportOrdinal, canonicalOrdinal)
      : null;
  }

  async getWindow({ centerOrdinal = 0, startOrdinal, limit = CATALOG_QUEUE_WINDOW_SIZE } = {}) {
    const normalizedLimit = normalizeWindowLimit(limit);
    const start = Number.isSafeInteger(startOrdinal)
      ? Math.max(0, Math.min(startOrdinal, Math.max(0, this.itemCount - 1)))
      : Math.max(0, Math.min(
        centerOrdinal - Math.floor(normalizedLimit / 2),
        Math.max(0, this.itemCount - normalizedLimit)
      ));
    const rows = [];
    for (let ordinal = start; ordinal < Math.min(this.itemCount, start + normalizedLimit); ordinal += 1) {
      rows.push(await this.getEntry(ordinal));
    }
    return { startOrdinal: start, rows, totalCount: this.itemCount };
  }

  resolveEntrySource(entry) {
    const segment = this.segments.find(candidate => candidate.sequence.sequenceId === entry?.sourceSequenceId);
    if (!segment) return Promise.reject(new TypeError('Composite entry does not belong to this sequence'));
    return segment.sequence.resolveEntrySource({
      ...entry,
      transportOrdinal: entry.sourceTransportOrdinal,
      canonicalOrdinal: entry.sourceCanonicalOrdinal
    });
  }

  getDescriptor() {
    return Object.freeze({
      kind: 'composite',
      sequenceId: this.sequenceId,
      itemCount: this.itemCount,
      shuffleSeed: this.shuffleSeed,
      shuffleEpoch: this.shuffleEpoch,
      shuffleEnabled: this.shuffleEnabled,
      shuffleTransportOffset: this.shuffleTransportOffset,
      segments: Object.freeze(this.segments.map(segment => Object.freeze({
        startOrdinal: segment.startOrdinal,
        itemCount: segment.itemCount,
        source: segment.sequence.getDescriptor?.() ?? Object.freeze({
          kind: segment.sequence.kind,
          sequenceId: segment.sequence.sequenceId,
          itemCount: segment.sequence.itemCount
        })
      })))
    });
  }

  clear() {
    const cleared = new Set();
    for (const segment of this.segments) {
      if (cleared.has(segment.sequence)) continue;
      cleared.add(segment.sequence);
      segment.sequence.clear?.();
    }
  }

  #findSegment(canonicalOrdinal) {
    let remaining = canonicalOrdinal;
    for (const segment of this.segments) {
      if (remaining < segment.itemCount) return { segment, offset: remaining };
      remaining -= segment.itemCount;
    }
    throw new RangeError('Composite ordinal is outside the playback sequence');
  }

  #refreshPermutation() {
    const epochSeed = shuffleEpochSeed(this.shuffleSeed, this.shuffleEpoch);
    this.permutation = new ReversibleShufflePermutation(this.itemCount, epochSeed);
  }
}

export class SequenceQueueProvider {
  constructor(sequence) {
    if (!sequence || typeof sequence.getWindow !== 'function') {
      throw new TypeError('A playback sequence with getWindow is required');
    }
    this.sequence = sequence;
    this.startOrdinal = 0;
  }

  get itemCount() {
    return this.sequence.itemCount;
  }

  getWindow(centerOrdinal, limit = CATALOG_QUEUE_WINDOW_SIZE) {
    return this.sequence.getWindow({ centerOrdinal, limit }).then(window => {
      this.startOrdinal = window.startOrdinal;
      return window;
    });
  }

  getPage(startOrdinal = this.startOrdinal, limit = CATALOG_QUEUE_WINDOW_SIZE) {
    return this.sequence.getWindow({ startOrdinal, limit }).then(window => {
      this.startOrdinal = window.startOrdinal;
      return window;
    });
  }

  getNextPage(limit = CATALOG_QUEUE_WINDOW_SIZE) {
    return this.getPage(Math.min(this.itemCount - 1, this.startOrdinal + limit), limit);
  }

  getPreviousPage(limit = CATALOG_QUEUE_WINDOW_SIZE) {
    return this.getPage(Math.max(0, this.startOrdinal - limit), limit);
  }

  getActiveSequenceDescriptor() {
    return this.sequence.getDescriptor?.() ?? Object.freeze({
      kind: this.sequence.kind,
      sequenceId: this.sequence.sequenceId ?? null,
      itemCount: this.sequence.itemCount
    });
  }
}

export class PendingTransportSlot {
  constructor({
    runtime = 'web',
    setTimeoutFn = (...args) => globalThis.setTimeout(...args),
    clearTimeoutFn = (...args) => globalThis.clearTimeout(...args),
    now = () => Date.now(),
    recoveredState = null
  } = {}) {
    this.deadlineMs = TRANSPORT_DEADLINE_MS[runtime] ?? TRANSPORT_DEADLINE_MS.web;
    this.setTimeoutFn = (...args) => setTimeoutFn(...args);
    this.clearTimeoutFn = (...args) => clearTimeoutFn(...args);
    this.now = now;
    this.generation = 0;
    this.current = null;
    this.lastTerminal = null;
    if (recoveredState) this.recoverInterrupted(recoveredState);
  }

  run(command, executor) {
    if (typeof executor !== 'function') throw new TypeError('Transport executor is required');
    const metadata = normalizeTransportCommand(command);
    const active = this.current;
    if (active) {
      if (metadata.priority < active.priority) {
        return Promise.resolve({ accepted: false, reason: 'lower-priority', generation: active.generation });
      }
      if (
        metadata.kind === 'ended' && active.kind === 'ended' &&
        metadata.playbackGeneration === active.playbackGeneration &&
        metadata.sourceEntryInstanceId === active.sourceEntryInstanceId
      ) {
        return active.promise;
      }
    }
    this.invalidate('superseded');
    const createdAt = this.now();
    const request = {
      ...metadata,
      generation: this.generation,
      createdAt,
      deadlineAt: createdAt + this.deadlineMs,
      timer: null,
      state: 'resolving',
      promise: null
    };
    this.current = request;
    const operation = Promise.resolve().then(() => executor({
      kind: request.kind,
      generation: request.generation,
      playbackGeneration: request.playbackGeneration,
      sourceEntryInstanceId: request.sourceEntryInstanceId,
      reason: request.reason,
      priority: request.priority,
      deadlineAt: request.deadlineAt,
      isCurrent: () => this.isCurrent(request)
    }));
    const deadline = new Promise(resolve => {
      request.timer = this.setTimeoutFn(() => resolve({ type: 'timeout' }), this.deadlineMs);
    });
    request.promise = Promise.race([
      operation.then(value => ({ type: 'value', value }), error => ({ type: 'error', error })),
      deadline
    ]).then(result => {
      if (!this.isCurrent(request)) return { accepted: false, reason: 'stale', generation: request.generation };
      if (result.type === 'timeout') {
        request.state = 'timed-out';
        this.#clearRequest(request);
        return { accepted: false, reason: 'timeout', generation: request.generation };
      }
      if (result.type === 'error') {
        request.state = 'failed';
        this.#clearRequest(request);
        throw result.error;
      }
      request.state = 'resolved';
      this.#clearRequest(request);
      return { accepted: true, value: result.value, generation: request.generation };
    });
    return request.promise;
  }

  isCurrent(request) {
    return this.current === request && request?.generation === this.generation;
  }

  isGenerationCurrent(generation) {
    return generation === this.generation;
  }

  getStateSnapshot() {
    const state = this.current ?? this.lastTerminal;
    if (!state) return null;
    return Object.freeze({
      kind: state.kind,
      generation: state.generation,
      playbackGeneration: state.playbackGeneration,
      sourceEntryInstanceId: state.sourceEntryInstanceId,
      reason: state.reason,
      priority: state.priority,
      createdAt: state.createdAt,
      deadlineAt: state.deadlineAt,
      state: state.state
    });
  }

  recoverInterrupted(snapshot) {
    if (!snapshot || typeof snapshot.kind !== 'string') {
      throw new TypeError('Recovered transport state is invalid');
    }
    const recoveredGeneration = Number.isSafeInteger(snapshot.generation) && snapshot.generation >= 0
      ? snapshot.generation
      : 0;
    this.generation = Math.max(this.generation, recoveredGeneration + 1);
    this.lastTerminal = Object.freeze({
      kind: snapshot.kind,
      generation: recoveredGeneration,
      playbackGeneration: snapshot.playbackGeneration ?? null,
      sourceEntryInstanceId: snapshot.sourceEntryInstanceId ?? null,
      reason: snapshot.reason ?? 'recovery',
      priority: snapshot.priority ?? 0,
      createdAt: snapshot.createdAt ?? this.now(),
      deadlineAt: snapshot.deadlineAt ?? this.now(),
      state: 'interrupted'
    });
    return this.lastTerminal;
  }

  invalidate(reason = 'interrupted') {
    if (this.current) {
      this.current.state = reason;
      this.#clearRequest(this.current);
    }
    this.generation += 1;
  }

  #clearRequest(request) {
    if (request?.timer != null) this.clearTimeoutFn(request.timer);
    request.timer = null;
    if (this.current === request) {
      this.lastTerminal = Object.freeze({
        kind: request.kind,
        generation: request.generation,
        playbackGeneration: request.playbackGeneration,
        sourceEntryInstanceId: request.sourceEntryInstanceId,
        reason: request.reason,
        priority: request.priority,
        createdAt: request.createdAt,
        deadlineAt: request.deadlineAt,
        state: request.state
      });
      this.current = null;
    }
  }
}

function immutableEntry(entry, fallbackId) {
  if (!entry || typeof entry !== 'object') throw new TypeError('Playback sequence entry must be an object');
  const entryInstanceId = entry.entryInstanceId ?? fallbackId;
  if (typeof entryInstanceId !== 'string' || entryInstanceId.length === 0) {
    throw new TypeError('Playback entryInstanceId must be a non-empty string');
  }
  return Object.freeze({ ...entry, entryInstanceId });
}

function normalizeCompositeSegment(segment) {
  if (!segment?.sequence || typeof segment.sequence.getEntry !== 'function') {
    throw new TypeError('Composite segment sequence is required');
  }
  const startOrdinal = segment.startOrdinal ?? 0;
  const itemCount = segment.itemCount ?? (segment.sequence.itemCount - startOrdinal);
  if (
    !Number.isSafeInteger(startOrdinal) || startOrdinal < 0 ||
    !Number.isSafeInteger(itemCount) || itemCount < 1 ||
    startOrdinal + itemCount > segment.sequence.itemCount
  ) {
    throw new RangeError('Composite segment bounds are invalid');
  }
  return Object.freeze({ sequence: segment.sequence, startOrdinal, itemCount });
}

function normalizeTransportCommand(command) {
  const source = typeof command === 'string' ? { kind: command } : command;
  if (!source || typeof source.kind !== 'string' || source.kind.length === 0) {
    throw new TypeError('Transport command kind is required');
  }
  const reason = source.reason ?? (source.kind === 'ended' ? 'ended' : 'explicit');
  const priority = source.priority ?? (reason === 'ended' ? 1 : 2);
  if (!Number.isSafeInteger(priority) || priority < 0) {
    throw new RangeError('Transport command priority must be a non-negative integer');
  }
  return {
    kind: source.kind,
    playbackGeneration: Number.isSafeInteger(source.playbackGeneration)
      ? source.playbackGeneration
      : null,
    sourceEntryInstanceId: source.sourceEntryInstanceId ?? null,
    reason,
    priority
  };
}

function compositeEntry(sourceEntry, sourceSequenceId, transportOrdinal, canonicalOrdinal) {
  return immutableEntry({
    ...sourceEntry,
    sourceSequenceId,
    sourceTransportOrdinal: sourceEntry.transportOrdinal,
    sourceCanonicalOrdinal: sourceEntry.canonicalOrdinal,
    transportOrdinal,
    canonicalOrdinal
  }, sourceEntry.entryInstanceId);
}

function nextMaterializedEntryId() {
  materializedEntrySequence += 1;
  return `materialized-entry-${materializedEntrySequence.toString(36)}`;
}

function validateOrdinal(ordinal, itemCount) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= itemCount) {
    throw new RangeError('ordinal is outside the playback sequence');
  }
}

function validateRestoredShuffleState(itemCount, seed, epoch, offset) {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(epoch) ||
      !Number.isSafeInteger(offset) || offset < 0 || offset >= itemCount) {
    throw new RangeError('Persisted shuffle state is invalid');
  }
}

function normalizeWindowLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CATALOG_QUEUE_WINDOW_SIZE) {
    throw new RangeError(`Queue windows are limited to ${CATALOG_QUEUE_WINDOW_SIZE} entries`);
  }
  return limit;
}
