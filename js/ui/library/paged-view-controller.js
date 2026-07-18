import { LogicalSelection } from './logical-selection.js';

const FIRST_PAGE_DEADLINES_MS = Object.freeze({ electron: 2_000, web: 3_000 });
const SATISFIED_PREFETCH_RESULT = Object.freeze({ accepted: true, prefetched: false });
const SATISFIED_PREFETCH_PROMISE = Promise.resolve(SATISFIED_PREFETCH_RESULT);
export const PAGED_LIBRARY_PAGE_LIMIT = 200;
export const PAGED_LIBRARY_MAX_CACHED_PAGES = 5;
export const PAGED_LIBRARY_MAX_CACHED_TRACKS = 2_500;
export const PAGED_LIBRARY_MANAGER_METHODS = Object.freeze([
  'createContext',
  'queryTracks',
  'queryEntities',
  'releaseContext',
  'getCounts',
  'getTrack'
]);

export class PagedViewController {
  constructor({
    loadFirstPage,
    loadCount = null,
    runtime = 'web',
    setTimeoutFn = (...args) => globalThis.setTimeout(...args),
    clearTimeoutFn = (...args) => globalThis.clearTimeout(...args),
    monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(),
    onStateChange = () => {},
    onRowsInvalidated = () => {}
  } = {}) {
    if (typeof loadFirstPage !== 'function') {
      throw new TypeError('loadFirstPage must be a function');
    }
    this.loadFirstPage = loadFirstPage;
    this.loadCount = typeof loadCount === 'function' ? loadCount : null;
    this.deadlineMs = FIRST_PAGE_DEADLINES_MS[runtime] || FIRST_PAGE_DEADLINES_MS.web;
    // Keep host functions unbound. Calling a captured Window timer as a method
    // of this controller throws "Illegal invocation" in Chromium/Electron.
    this.setTimeoutFn = (...args) => setTimeoutFn(...args);
    this.clearTimeoutFn = (...args) => clearTimeoutFn(...args);
    this.monotonicNow = () => monotonicNow();
    this.onStateChange = onStateChange;
    this.onRowsInvalidated = onRowsInvalidated;
    this.queryGeneration = 0;
    this.pageAttemptId = 0;
    this.query = null;
    this.timer = null;
    this.state = createInitialState();
  }

  async start(query) {
    this.queryGeneration += 1;
    this.pageAttemptId = 0;
    this.query = query;
    this.onRowsInvalidated();
    return this.runAttempt();
  }

  async retry() {
    if (this.queryGeneration === 0 || this.state.phase === 'loading') {
      return { accepted: false, reason: 'not-retryable' };
    }
    return this.runAttempt();
  }

  async runAttempt() {
    const queryGeneration = this.queryGeneration;
    const pageAttemptId = ++this.pageAttemptId;
    this.clearDeadline();
    this.commitState({
      phase: 'loading',
      queryGeneration,
      pageAttemptId,
      rows: [],
      totalCount: { pending: true },
      resolvedCount: null,
      unresolvedCount: null,
      error: null,
      ariaBusy: true,
      ariaRowCount: -1
    });

    const acceptedAt = this.monotonicNow();
    const deadlineAt = acceptedAt + this.deadlineMs;

    const deadline = new Promise(resolve => {
      const reachDeadline = () => {
        const remainingMs = deadlineAt - this.monotonicNow();
        if (remainingMs > 0) {
          this.timer = this.setTimeoutFn(reachDeadline, remainingMs);
          return;
        }
        resolve({ kind: 'timeout', completedAt: this.monotonicNow() });
      };
      this.timer = this.setTimeoutFn(reachDeadline, this.deadlineMs);
    });
    const request = Promise.resolve()
      .then(() => this.loadFirstPage({
        query: this.query,
        queryGeneration,
        pageAttemptId
      }))
      .then(
        page => ({ kind: 'page', page, completedAt: this.monotonicNow() }),
        error => ({ kind: 'error', error, completedAt: this.monotonicNow() })
      );
    let result = await Promise.race([request, deadline]);

    if (!this.isCurrent(queryGeneration, pageAttemptId)) {
      return { accepted: false, reason: 'stale-attempt' };
    }
    this.clearDeadline();
    if (result.kind !== 'timeout' && !(result.completedAt < deadlineAt)) {
      result = { kind: 'timeout', completedAt: result.completedAt };
    }
    if (result.kind === 'timeout') {
      this.commitTerminal('timedOut', new Error('The first library page timed out'));
      return { accepted: true, terminal: 'timedOut' };
    }
    if (result.kind === 'error') {
      this.commitTerminal('failed', result.error);
      return { accepted: true, terminal: 'failed' };
    }
    return this.commitPage(result.page, { queryGeneration, pageAttemptId, announceCount: true });
  }

  commitPage(page, identity = {}) {
    const queryGeneration = identity.queryGeneration ?? this.queryGeneration;
    const pageAttemptId = identity.pageAttemptId ?? this.pageAttemptId;
    if (!this.isCurrent(queryGeneration, pageAttemptId)) {
      return { accepted: false, reason: 'stale-attempt' };
    }
    if (!page || !Array.isArray(page.rows)) {
      this.commitTerminal('failed', new TypeError('A page must contain rows'));
      return { accepted: true, terminal: 'failed' };
    }

    const totalCount = Number.isSafeInteger(page.totalCount)
      ? page.totalCount
      : Number.isSafeInteger(this.state.totalCount)
        ? this.state.totalCount
        : page.totalCount ?? { pending: true };
    const ariaRowCount = Number.isSafeInteger(totalCount) && totalCount >= 0 ? totalCount : -1;
    const announceCount = identity.announceCount === true && ariaRowCount >= 0;
    this.commitState({
      phase: 'committed',
      queryGeneration,
      pageAttemptId,
      rows: page.rows,
      totalCount,
      resolvedCount: Number.isSafeInteger(page.resolvedCount) ? page.resolvedCount : null,
      unresolvedCount: Number.isSafeInteger(page.unresolvedCount) ? page.unresolvedCount : null,
      error: null,
      ariaBusy: false,
      ariaRowCount,
      countAnnounced: this.state.countAnnounced || announceCount,
      liveAnnouncement: announceCount ? String(totalCount) : '',
      liveAnnouncementId: announceCount ? `${queryGeneration}:${pageAttemptId}:count` : null
    });
    if (ariaRowCount < 0 && this.loadCount) {
      void Promise.resolve()
        .then(() => this.loadCount({ queryGeneration, pageAttemptId }))
        .then(count => this.commitCount(count, { queryGeneration, pageAttemptId }), () => {});
    }
    return { accepted: true, terminal: 'committed', page };
  }

  commitCount(totalCount, identity = {}) {
    const queryGeneration = identity.queryGeneration ?? this.queryGeneration;
    const pageAttemptId = identity.pageAttemptId ?? this.pageAttemptId;
    if (!this.isCurrent(queryGeneration, pageAttemptId) || this.state.phase !== 'committed') {
      return { accepted: false, reason: 'stale-attempt' };
    }
    if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
      return { accepted: false, reason: 'invalid-count' };
    }
    if (this.state.countAnnounced) return { accepted: false, reason: 'duplicate-count' };
    this.commitState({
      ...this.state,
      totalCount,
      ariaRowCount: totalCount,
      countAnnounced: true,
      liveAnnouncement: String(totalCount),
      liveAnnouncementId: `${queryGeneration}:${pageAttemptId}:count`
    });
    return { accepted: true };
  }

  dispatchRowAction(identity, callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('callback must be a function');
    }
    if (this.state.phase !== 'committed' || !this.isCurrent(
      identity?.queryGeneration,
      identity?.pageAttemptId
    )) {
      return { accepted: false, reason: 'inactive-page' };
    }
    return { accepted: true, value: callback() };
  }

  abort() {
    this.clearDeadline();
    this.queryGeneration += 1;
    this.commitState({ ...createInitialState(), phase: 'aborted' });
  }

  isCurrent(queryGeneration, pageAttemptId) {
    return queryGeneration === this.queryGeneration && pageAttemptId === this.pageAttemptId;
  }

  commitTerminal(phase, error) {
    this.commitState({
      ...this.state,
      phase,
      rows: [],
      error,
      ariaBusy: false,
      ariaRowCount: -1,
      liveAnnouncement: '',
      liveAnnouncementId: `${this.queryGeneration}:${this.pageAttemptId}:${phase}`
    });
  }

  commitState(state) {
    this.state = state;
    this.onStateChange(state);
  }

  clearDeadline() {
    if (this.timer == null) return;
    this.clearTimeoutFn(this.timer);
    this.timer = null;
  }
}

function createInitialState() {
  return {
    phase: 'idle',
    queryGeneration: 0,
    pageAttemptId: 0,
    rows: [],
    totalCount: { pending: true },
    resolvedCount: null,
    unresolvedCount: null,
    error: null,
    ariaBusy: false,
    ariaRowCount: -1,
    countAnnounced: false,
    liveAnnouncement: '',
    liveAnnouncementId: null
  };
}

export function getMissingPagedManagerMethods(manager) {
  return PAGED_LIBRARY_MANAGER_METHODS.filter(method => typeof manager?.[method] !== 'function');
}

export class PagedLibraryViewController {
  constructor({
    manager,
    runtime = 'web',
    pageLimit = PAGED_LIBRARY_PAGE_LIMIT,
    onStateChange = () => {},
    onCacheChange = () => {},
    onRowsInvalidated = () => {},
    seekOrdinal = null,
    seekAnchor = null,
    setTimeoutFn,
    clearTimeoutFn
  } = {}) {
    const missing = getMissingPagedManagerMethods(manager);
    if (missing.length > 0) {
      throw new TypeError(`Paged library manager is missing: ${missing.join(', ')}`);
    }
    if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 500) {
      throw new RangeError('pageLimit must be an integer from 1 to 500');
    }
    this.manager = manager;
    this.pageLimit = pageLimit;
    this.onStateChange = onStateChange;
    this.onCacheChange = onCacheChange;
    this.seekOrdinalHook = seekOrdinal;
    this.seekAnchorHook = seekAnchor;
    this.contextToken = null;
    this.selection = null;
    this.selectionAnchor = null;
    this.staleSelectionDescriptor = null;
    this.selectionRejection = null;
    this.defaultSelectAllLimit = null;
    this.defaultSelectionAttemptKey = null;
    this.query = null;
    this.queryKey = null;
    this.pages = new Map();
    this.currentPageIndex = 0;
    this.cacheCenterPageIndex = 0;
    this.pageRequestId = 0;
    this.viewportRequestId = 0;
    this.viewportRequestedOrdinal = null;
    this.viewportRequestPromise = null;
    this.prefetchRequestId = 0;
    this.prefetchIntentId = 0;
    this.prefetchRequested = null;
    this.prefetchRequestPromise = null;
    this.prefetchActiveRange = null;
    this.prefetchWaiters = new Set();
    this.navigationRequestId = 0;
    this.firstPage = new PagedViewController({
      runtime,
      setTimeoutFn,
      clearTimeoutFn,
      loadFirstPage: identity => this.loadFirstPage(identity),
      loadCount: identity => this.loadCount(identity),
      onRowsInvalidated,
      onStateChange: state => {
        this.applyDefaultSelection(state);
        this.onStateChange(this.createViewState(state));
      }
    });
  }

  async loadCount(identity) {
    if (!this.contextToken || typeof this.manager.getContextCount !== 'function' ||
        !this.firstPage.isCurrent(identity.queryGeneration, identity.pageAttemptId)) return null;
    return this.manager.getContextCount({ contextToken: this.contextToken });
  }

  async start(query, { preserveStaleSelection = false, defaultSelectAllLimit = null } = {}) {
    this.query = normalizePagedQuery(query);
    this.queryKey = JSON.stringify(this.query);
    this.defaultSelectAllLimit = Number.isSafeInteger(defaultSelectAllLimit) && defaultSelectAllLimit > 0
      ? defaultSelectAllLimit
      : null;
    this.defaultSelectionAttemptKey = null;
    if (!preserveStaleSelection) this.staleSelectionDescriptor = null;
    this.preserveStaleSelectionDuringStart = preserveStaleSelection;
    this.pages.clear();
    this.currentPageIndex = 0;
    this.cacheCenterPageIndex = 0;
    this.pageRequestId += 1;
    this.viewportRequestId += 1;
    this.navigationRequestId += 1;
    this.viewportRequestedOrdinal = null;
    this.viewportRequestPromise = null;
    this.invalidatePrefetch();
    return this.firstPage.start(this.query);
  }

  retry() {
    return this.firstPage.retry();
  }

  async loadFirstPage(identity) {
    const staleSelection = this.preserveStaleSelectionDuringStart
      ? (this.staleSelectionDescriptor ?? this.markSelectionStale())
      : null;
    await this.releaseContext();
    this.staleSelectionDescriptor = staleSelection;
    if (!this.firstPage.isCurrent(identity.queryGeneration, identity.pageAttemptId)) {
      return { rows: [], totalCount: { pending: true } };
    }
    const contextToken = await this.manager.createContext(this.query);
    if (!this.firstPage.isCurrent(identity.queryGeneration, identity.pageAttemptId)) {
      await this.manager.releaseContext(contextToken);
      return { rows: [], totalCount: { pending: true } };
    }
    this.contextToken = contextToken;
    this.selection = new LogicalSelection(contextToken);
    this.selectionAnchor = null;
    this.selectionRejection = null;
    this.preserveStaleSelectionDuringStart = false;
    let page = normalizePageStart(await this.queryPage(null), 0);
    const needsInitialCount = this.query.endpoint === 'entities' || this.defaultSelectAllLimit !== null;
    if (needsInitialCount && !Number.isSafeInteger(page?.totalCount) &&
        typeof this.manager.getContextCount === 'function') {
      const attemptKey = `${identity.queryGeneration}:${identity.pageAttemptId}`;
      try {
        const totalCount = await this.loadCount(identity);
        if (!this.firstPage.isCurrent(identity.queryGeneration, identity.pageAttemptId)) {
          return { rows: [], totalCount: { pending: true } };
        }
        if (Number.isSafeInteger(totalCount) && totalCount >= 0) {
          page = { ...page, totalCount };
        } else if (this.defaultSelectAllLimit !== null) {
          this.defaultSelectionAttemptKey = attemptKey;
        }
      } catch (_) {
        // The page remains usable when its count is temporarily unavailable.
        if (this.defaultSelectAllLimit !== null) this.defaultSelectionAttemptKey = attemptKey;
      }
    }
    this.validateBoundedPage(page);
    this.pages.set(0, page);
    return page;
  }

  async nextPage() {
    const current = this.pages.get(this.currentPageIndex);
    if (!current?.nextCursor) return { accepted: false, reason: 'end' };
    return this.loadAdjacentPage(this.currentPageIndex + 1, current.nextCursor);
  }

  async previousPage() {
    const current = this.pages.get(this.currentPageIndex);
    if (!current?.previousCursor) return { accepted: false, reason: 'start' };
    return this.loadAdjacentPage(this.currentPageIndex - 1, current.previousCursor);
  }

  async loadAdjacentPage(pageIndex, cursor) {
    const generation = this.firstPage.queryGeneration;
    const attempt = this.firstPage.pageAttemptId;
    const requestId = ++this.pageRequestId;
    const navigationRequestId = ++this.navigationRequestId;
    let page = this.pages.get(pageIndex);
    if (!page) {
      const current = this.pages.get(this.currentPageIndex);
      const fallbackStart = pageIndex > this.currentPageIndex
        ? (current?.pageStartOrdinal ?? 0) + (current?.rows?.length ?? this.pageLimit)
        : Math.max(0, (current?.pageStartOrdinal ?? 0) - this.pageLimit);
      page = normalizePageStart(await this.queryPage(cursor), fallbackStart);
    }
    if (!this.firstPage.isCurrent(generation, attempt) || requestId !== this.pageRequestId ||
        navigationRequestId !== this.navigationRequestId) {
      return { accepted: false, reason: 'stale-page' };
    }
    this.currentPageIndex = pageIndex;
    this.cacheCenterPageIndex = pageIndex;
    this.trimPageCache();
    this.validateBoundedPage(page);
    this.pages.set(pageIndex, page);
    const result = this.firstPage.commitPage(page, {
      queryGeneration: generation,
      pageAttemptId: attempt
    });
    return { ...result, pageIndex };
  }

  async ensureOrdinal(ordinal) {
    const rejection = this.getOrdinalRejection(ordinal);
    if (rejection) return rejection;
    const cachedPageIndex = this.findCachedPageIndex(ordinal);
    if (cachedPageIndex !== null) return this.activateCachedPage(cachedPageIndex);
    const current = this.pages.get(this.currentPageIndex);
    const currentStart = current?.pageStartOrdinal ?? 0;
    const currentEnd = currentStart + (current?.rows?.length ?? 0);
    if (current?.nextCursor && ordinal >= currentEnd && ordinal < currentEnd + this.pageLimit) {
      return this.nextPage();
    }
    if (current?.previousCursor && ordinal < currentStart && ordinal >= Math.max(0, currentStart - this.pageLimit)) {
      return this.previousPage();
    }
    return this.seekToOrdinal(ordinal);
  }

  requestViewportOrdinal(ordinal) {
    const rejection = this.getOrdinalRejection(ordinal);
    if (rejection) return Promise.resolve(rejection);
    if (this.findCachedPageIndex(ordinal) === null && !this.prefetchCoversOrdinal(ordinal)) {
      this.invalidatePrefetch();
    }
    this.viewportRequestedOrdinal = ordinal;
    if (this.viewportRequestPromise) {
      this.resolvePrefetchWaiters({ finished: true });
      return Promise.resolve({ accepted: false, reason: 'page-pending' });
    }
    const requestId = ++this.viewportRequestId;
    const request = this.loadLatestViewportOrdinal(requestId);
    this.viewportRequestPromise = request;
    return request.finally(() => {
      if (this.viewportRequestPromise === request) {
        this.viewportRequestPromise = null;
        this.viewportRequestedOrdinal = null;
      }
    });
  }

  async loadLatestViewportOrdinal(requestId) {
    while (this.viewportRequestedOrdinal !== null) {
      const ordinal = this.viewportRequestedOrdinal;
      this.viewportRequestedOrdinal = null;
      const loaded = await this.loadViewportOrdinal(ordinal, requestId);
      if (!loaded.accepted) {
        if (loaded.reason === 'superseded' && this.viewportRequestedOrdinal !== null) continue;
        return loaded;
      }
      if (requestId !== this.viewportRequestId ||
          loaded.navigationRequestId !== this.navigationRequestId) {
        return { accepted: false, reason: 'stale-page' };
      }
      const loadedPageIndex = loaded.cachedPageIndex ?? this.cacheViewportPage(loaded.page);
      const latestOrdinal = this.viewportRequestedOrdinal;
      if (latestOrdinal !== null) {
        const latestPageIndex = this.findCachedPageIndex(latestOrdinal);
        if (latestPageIndex !== null) {
          this.viewportRequestedOrdinal = null;
          return {
            ...this.activateCachedPage(latestPageIndex, {
              navigationRequestId: loaded.navigationRequestId
            }),
            ordinal: latestOrdinal
          };
        }
        if (loaded.cachedPageIndex === null) {
          this.onCacheChange({
            pageIndex: loadedPageIndex,
            page: loaded.page,
            requestId
          });
        }
        continue;
      }
      if (loadedPageIndex !== null) {
        return {
          ...this.activateCachedPage(loadedPageIndex, {
            navigationRequestId: loaded.navigationRequestId
          }),
          ordinal
        };
      }
    }
    return { accepted: false, reason: 'stale-page' };
  }

  cacheViewportPage(page) {
    const pageIndex = Math.floor(page.pageStartOrdinal / this.pageLimit);
    this.pages.set(pageIndex, page);
    this.cacheCenterPageIndex = pageIndex;
    this.trimPageCache();
    return pageIndex;
  }

  async loadViewportOrdinal(ordinal, requestId) {
    const rejection = this.getOrdinalRejection(ordinal);
    if (rejection) return rejection;
    const navigationRequestId = ++this.navigationRequestId;
    let cachedPageIndex = this.findCachedPageIndex(ordinal);
    if (cachedPageIndex !== null) {
      return { accepted: true, cachedPageIndex, page: null, navigationRequestId };
    }
    const prefetchPromise = this.prefetchCoversOrdinal(ordinal)
      ? this.prefetchRequestPromise
      : null;
    if (prefetchPromise) {
      try {
        await this.waitForPrefetchedOrdinal(ordinal);
      } catch (_) {
        // The visible-row read below remains the authoritative fallback.
      }
      if (requestId !== this.viewportRequestId || navigationRequestId !== this.navigationRequestId) {
        return { accepted: false, reason: 'stale-page' };
      }
      if (this.viewportRequestedOrdinal !== null) {
        return { accepted: false, reason: 'superseded' };
      }
      cachedPageIndex = this.findCachedPageIndex(ordinal);
      if (cachedPageIndex !== null) {
        return { accepted: true, cachedPageIndex, page: null, navigationRequestId };
      }
    }
    if (typeof this.seekOrdinalHook !== 'function') {
      return { accepted: false, reason: 'seek-unavailable' };
    }
    const contextToken = this.contextToken;
    const generation = this.firstPage.queryGeneration;
    const attempt = this.firstPage.pageAttemptId;
    const page = normalizePageStart(await this.seekOrdinalHook({
      contextToken,
      ordinal,
      limit: this.pageLimit
    }), ordinal);
    if (requestId !== this.viewportRequestId ||
        navigationRequestId !== this.navigationRequestId ||
        !this.firstPage.isCurrent(generation, attempt) ||
        this.contextToken !== contextToken) {
      return { accepted: false, reason: 'stale-page' };
    }
    this.validateBoundedPage(page);
    return {
      accepted: true,
      cachedPageIndex: null,
      page,
      generation,
      attempt,
      navigationRequestId
    };
  }

  getOrdinalRejection(ordinal) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
      return { accepted: false, reason: 'invalid-ordinal' };
    }
    if (this.firstPage.state.phase !== 'committed' ||
        typeof this.contextToken !== 'string' || this.contextToken.length === 0) {
      return { accepted: false, reason: 'inactive-page' };
    }
    const totalCount = this.firstPage.state.totalCount;
    if (Number.isSafeInteger(totalCount) && ordinal >= totalCount) {
      return { accepted: false, reason: 'end' };
    }
    return null;
  }

  activateCachedPage(pageIndex, { navigationRequestId = ++this.navigationRequestId } = {}) {
    if (navigationRequestId !== this.navigationRequestId) {
      return { accepted: false, reason: 'stale-page' };
    }
    const page = this.pages.get(pageIndex);
    if (!page) return { accepted: false, reason: 'page-not-cached' };
    this.currentPageIndex = pageIndex;
    this.cacheCenterPageIndex = pageIndex;
    this.trimPageCache();
    const result = this.firstPage.commitPage(page, {
      queryGeneration: this.firstPage.queryGeneration,
      pageAttemptId: this.firstPage.pageAttemptId
    });
    return { ...result, pageIndex };
  }

  findCachedPageIndex(ordinal) {
    for (const [pageIndex, page] of this.pages) {
      const start = page.pageStartOrdinal ?? pageIndex * this.pageLimit;
      if (ordinal >= start && ordinal < start + page.rows.length) return pageIndex;
    }
    return null;
  }

  prefetchAroundOrdinal(ordinal, { direction = 1, pageCount = 1 } = {}) {
    const rejection = this.getOrdinalRejection(ordinal);
    if (rejection) return Promise.resolve(rejection);
    const pageIndex = this.findCachedPageIndex(ordinal);
    if (pageIndex === null) return Promise.resolve({ accepted: false, reason: 'not-cached' });
    const normalizedPageCount = Math.max(1, Math.min(2, Number.isSafeInteger(pageCount) ? pageCount : 1));
    const prefetchTarget = {
      ordinal,
      direction: direction < 0 ? -1 : 1,
      pageCount: normalizedPageCount,
      intentId: ++this.prefetchIntentId
    };
    this.cacheCenterPageIndex = pageIndex;
    this.trimPageCache();
    if (this.isPrefetchSatisfied(prefetchTarget)) {
      this.prefetchRequested = null;
      return SATISFIED_PREFETCH_PROMISE;
    }
    this.prefetchRequested = prefetchTarget;
    if (this.prefetchRequestPromise) {
      return Promise.resolve({ accepted: false, reason: 'page-pending' });
    }
    const requestId = ++this.prefetchRequestId;
    const request = this.loadLatestPrefetch(requestId);
    this.prefetchRequestPromise = request;
    return request.finally(() => {
      if (this.prefetchRequestPromise === request) {
        this.prefetchRequestPromise = null;
        this.prefetchRequested = null;
        this.prefetchActiveRange = null;
      }
    });
  }

  isPrefetchSatisfied({ ordinal, direction, pageCount }) {
    let pageIndex = this.findCachedPageIndex(ordinal);
    if (pageIndex === null) return false;
    let page = this.pages.get(pageIndex);
    for (let distance = 0; distance < pageCount; distance += 1) {
      const start = page.pageStartOrdinal ?? pageIndex * this.pageLimit;
      const adjacentOrdinal = direction > 0 ? start + page.rows.length : start - 1;
      const cursor = direction > 0 ? page.nextCursor : page.previousCursor;
      if (!cursor || adjacentOrdinal < 0) return true;
      const cachedPageIndex = this.findCachedPageIndex(adjacentOrdinal);
      if (cachedPageIndex === null) return false;
      pageIndex = cachedPageIndex;
      page = this.pages.get(pageIndex);
    }
    return true;
  }

  async loadLatestPrefetch(requestId) {
    let lastResult = { accepted: false, reason: 'stale-page' };
    let prefetched = false;
    while (this.prefetchRequested) {
      const request = this.prefetchRequested;
      this.prefetchRequested = null;
      const result = await this.loadPrefetchPages(request, requestId);
      if (requestId !== this.prefetchRequestId) {
        return { accepted: false, reason: 'stale-page' };
      }
      prefetched ||= result.prefetched === true;
      lastResult = result;
      if (result.visibleReady) {
        this.prefetchRequested = null;
        break;
      }
    }
    this.resolvePrefetchWaiters({ requestId, finished: true });
    return { ...lastResult, prefetched };
  }

  async loadPrefetchPages({ ordinal, direction, pageCount, intentId }, requestId) {
    let pageIndex = this.findCachedPageIndex(ordinal);
    if (pageIndex === null) return { accepted: false, reason: 'not-cached' };
    let page = this.pages.get(pageIndex);
    const contextToken = this.contextToken;
    const generation = this.firstPage.queryGeneration;
    const attempt = this.firstPage.pageAttemptId;
    const pageStart = page.pageStartOrdinal ?? pageIndex * this.pageLimit;
    const rangeStart = direction > 0
      ? pageStart + page.rows.length
      : Math.max(0, pageStart - pageCount * this.pageLimit);
    const rangeEnd = direction > 0
      ? pageStart + page.rows.length + pageCount * this.pageLimit
      : pageStart;
    this.prefetchActiveRange = { requestId, startOrdinal: rangeStart, endOrdinal: rangeEnd };
    let prefetched = false;

    for (let distance = 0; distance < pageCount; distance += 1) {
      const start = page.pageStartOrdinal ?? pageIndex * this.pageLimit;
      const adjacentOrdinal = direction > 0 ? start + page.rows.length : start - 1;
      const cursor = direction > 0 ? page.nextCursor : page.previousCursor;
      if (!cursor || adjacentOrdinal < 0) break;
      const cachedPageIndex = this.findCachedPageIndex(adjacentOrdinal);
      if (cachedPageIndex !== null) {
        pageIndex = cachedPageIndex;
        page = this.pages.get(pageIndex);
        continue;
      }

      const fallbackStart = direction > 0
        ? adjacentOrdinal
        : Math.max(0, start - this.pageLimit);
      const loadedPage = normalizePageStart(await this.queryPage(cursor), fallbackStart);
      if (requestId !== this.prefetchRequestId ||
          !this.firstPage.isCurrent(generation, attempt) ||
          this.contextToken !== contextToken) {
        return { accepted: false, reason: 'stale-page', prefetched };
      }
      this.validateBoundedPage(loadedPage);
      pageIndex += direction;
      this.pages.set(pageIndex, loadedPage);
      page = loadedPage;
      prefetched = true;
      this.trimPageCache();
      this.onCacheChange({
        pageIndex,
        page: loadedPage,
        requestId
      });
      if (this.resolvePrefetchWaiters({ requestId })) {
        return { accepted: true, prefetched, visibleReady: true };
      }
      if (intentId !== this.prefetchIntentId) {
        return { accepted: true, prefetched };
      }
    }
    return { accepted: true, prefetched };
  }

  waitForPrefetchedOrdinal(ordinal) {
    const cachedPageIndex = this.findCachedPageIndex(ordinal);
    if (cachedPageIndex !== null) return Promise.resolve({ cached: true });
    const requestId = this.prefetchRequestId;
    return new Promise(resolve => {
      const waiter = { ordinal, requestId, resolve };
      this.prefetchWaiters.add(waiter);
      if (!this.prefetchCoversOrdinal(ordinal)) {
        this.prefetchWaiters.delete(waiter);
        resolve({ cached: false });
      }
    });
  }

  resolvePrefetchWaiters({ requestId = null, finished = false } = {}) {
    let visibleReady = false;
    for (const waiter of this.prefetchWaiters) {
      if (requestId !== null && waiter.requestId !== requestId) continue;
      const cached = this.findCachedPageIndex(waiter.ordinal) !== null;
      if (!cached && !finished) continue;
      this.prefetchWaiters.delete(waiter);
      waiter.resolve({ cached });
      visibleReady ||= cached;
    }
    return visibleReady;
  }

  prefetchCoversOrdinal(ordinal) {
    const range = this.prefetchActiveRange;
    return Boolean(
      this.prefetchRequestPromise &&
      range?.requestId === this.prefetchRequestId &&
      ordinal >= range.startOrdinal &&
      ordinal < range.endOrdinal
    );
  }

  invalidatePrefetch() {
    this.prefetchRequestId += 1;
    this.prefetchIntentId += 1;
    this.resolvePrefetchWaiters({ finished: true });
    this.prefetchRequested = null;
    this.prefetchActiveRange = null;
  }

  getCachedRows(startOrdinal, endOrdinal) {
    const start = Math.max(0, Number.isSafeInteger(startOrdinal) ? startOrdinal : 0);
    const end = Math.max(start, Number.isSafeInteger(endOrdinal) ? endOrdinal : start);
    const rows = [];
    for (let ordinal = start; ordinal < end; ordinal += 1) {
      for (const page of this.pages.values()) {
        const pageStart = page.pageStartOrdinal ?? 0;
        const row = page.rows?.[ordinal - pageStart];
        if (row !== undefined) {
          rows.push({ ordinal, row });
          break;
        }
      }
    }
    return rows;
  }

  async queryPage(cursor) {
    const options = {
      ...this.query,
      contextToken: this.contextToken,
      cursor,
      limit: this.pageLimit
    };
    if (this.query.endpoint === 'tracks') {
      delete options.endpoint;
      delete options.entityType;
      return this.manager.queryTracks(options);
    }
    const type = this.query.entityType;
    delete options.endpoint;
    delete options.entityType;
    delete options.scope;
    return this.manager.queryEntities({ ...options, type });
  }

  validateBoundedPage(page) {
    if (!page || !Array.isArray(page.rows) || page.rows.length > 500) {
      throw new TypeError('Paged library response exceeds the row contract');
    }
    const cachedRows = [...this.pages.values()].reduce((sum, cached) => sum + cached.rows.length, 0);
    if (cachedRows + page.rows.length > PAGED_LIBRARY_MAX_CACHED_TRACKS + 500) {
      throw new RangeError('Paged library cache would exceed its row budget');
    }
  }

  trimPageCache() {
    const centerPageIndex = this.cacheCenterPageIndex;
    for (const pageIndex of this.pages.keys()) {
      if (pageIndex !== this.currentPageIndex && Math.abs(pageIndex - centerPageIndex) > 2) {
        this.pages.delete(pageIndex);
      }
    }
    while (this.pages.size > PAGED_LIBRARY_MAX_CACHED_PAGES) {
      const oldest = [...this.pages.keys()].find(pageIndex => pageIndex !== this.currentPageIndex) ??
        this.pages.keys().next().value;
      this.pages.delete(oldest);
    }
  }

  getCachedRowCount() {
    return [...this.pages.values()].reduce((sum, page) => sum + page.rows.length, 0);
  }

  getSelectionDescriptor() {
    return this.selection?.toDescriptor() ?? null;
  }

  getSelectionProjection(totalCount = this.firstPage.state.totalCount) {
    return this.selection?.getProjection({
      totalCount: Number.isSafeInteger(totalCount) ? totalCount : null
    }) ?? Object.freeze({ hasAny: false, selectedCount: 0 });
  }

  applyDefaultSelection(state) {
    if (!this.selection || state?.phase !== 'committed' || !Number.isSafeInteger(state.totalCount)) return;
    const attemptKey = `${state.queryGeneration}:${state.pageAttemptId}`;
    if (this.defaultSelectionAttemptKey === attemptKey) return;
    this.defaultSelectionAttemptKey = attemptKey;
    if (this.defaultSelectAllLimit === null || this.staleSelectionDescriptor ||
        state.totalCount < 1 || state.totalCount > this.defaultSelectAllLimit) return;
    this.selection.selectAll();
  }

  selectAll() {
    this.selection?.selectAll();
    this.selectionRejection = null;
    return this.getSelectionDescriptor();
  }

  clearSelection() {
    this.selection?.clear();
    this.selectionAnchor = null;
    this.selectionRejection = null;
    return this.getSelectionDescriptor();
  }

  selectRange(startUid, endUid) {
    this.selection?.selectRange(startUid, endUid);
    return this.getSelectionDescriptor();
  }

  toggleSelection(uid, selected, { ordinal, extend = false } = {}) {
    if (!this.selection) return null;
    try {
      if (extend && this.selectionAnchor && Number.isSafeInteger(ordinal)) {
        this.selection.selectRange(this.selectionAnchor.uid, uid, {
          startOrdinal: this.selectionAnchor.ordinal,
          endOrdinal: ordinal
        });
      } else {
        this.selection.setSelected(uid, selected, { ordinal });
        if (Number.isSafeInteger(ordinal)) this.selectionAnchor = { uid, ordinal };
      }
      this.selectionRejection = null;
      return this.getSelectionDescriptor();
    } catch (error) {
      if (error?.code !== 'selectionTooLarge') throw error;
      this.selectionRejection = Object.freeze({
        accepted: false,
        reason: 'selection-too-large',
        code: error.code,
        details: error.details ?? null
      });
      return this.selectionRejection;
    }
  }

  isSelected(uid, ordinal) {
    return this.selection?.isSelected(uid, { ordinal }) ?? false;
  }

  getSelectedOrdinal(uid, ordinal) {
    return this.selection?.getSelectedOrdinal(uid, ordinal) ?? null;
  }

  prepareSelectionAction(identity, operationKind, request = {}) {
    return this.dispatchRowAction(identity, () => {
      const descriptor = this.getSelectionDescriptor();
      const projection = this.getSelectionProjection();
      if (!descriptor || !projection.hasAny || this.staleSelectionDescriptor) {
        return { accepted: false, reason: this.staleSelectionDescriptor ? 'stale-selection' : 'empty-selection' };
      }
      return { operationKind, descriptor, request };
    });
  }

  setSelected(uid, selected) {
    return this.toggleSelection(uid, selected);
  }

  markSelectionStale() {
    const descriptor = this.getSelectionDescriptor();
    if (descriptor && this.getSelectionProjection().hasAny) {
      this.staleSelectionDescriptor = descriptor;
    }
    return this.staleSelectionDescriptor;
  }

  async reselectStaleSelection() {
    const stale = this.staleSelectionDescriptor;
    if (!stale || !this.selection) return { accepted: false, reason: 'no-stale-selection' };
    const selection = this.selection;
    const contextToken = this.contextToken;
    try {
      let rangeOrdinals = null;
      if (stale.mode === 'range') {
        if (typeof this.seekAnchorHook !== 'function' || !contextToken) {
          return { accepted: false, reason: 'range-endpoint-resolution-unavailable' };
        }
        const entityKind = this.query?.endpoint === 'tracks' ? 'track' : this.query?.entityType;
        const resolveEndpoint = entityId => this.seekAnchorHook({
          contextToken,
          mode: 'entity',
          entityKind,
          entityId,
          queryFingerprint: this.queryKey,
          limit: this.pageLimit
        });
        const [start, end] = await Promise.all([
          resolveEndpoint(stale.startUid),
          resolveEndpoint(stale.endUid)
        ]);
        if (selection !== this.selection || contextToken !== this.contextToken ||
            stale !== this.staleSelectionDescriptor) {
          return { accepted: false, reason: 'stale-page' };
        }
        if (!start?.accepted || !Number.isSafeInteger(start.ordinal) ||
            !end?.accepted || !Number.isSafeInteger(end.ordinal)) {
          return { accepted: false, reason: 'range-endpoint-missing' };
        }
        rangeOrdinals = { startOrdinal: start.ordinal, endOrdinal: end.ordinal };
      }
      selection.clear();
      if (stale.mode === 'all') {
        selection.selectAll();
        for (const uid of stale.exclusions ?? []) selection.setSelected(uid, false);
      } else if (stale.mode === 'range') {
        selection.selectRange(stale.startUid, stale.endUid, rangeOrdinals);
        for (const uid of stale.exclusions ?? []) selection.setSelected(uid, false, { inRange: true });
        for (const uid of stale.inclusions ?? []) selection.setSelected(uid, true);
        this.selectionAnchor = { uid: stale.endUid, ordinal: rangeOrdinals.endOrdinal };
      } else {
        for (const uid of stale.trackUids ?? []) selection.setSelected(uid, true);
      }
      this.staleSelectionDescriptor = null;
      this.selectionRejection = null;
      return { accepted: true, descriptor: this.getSelectionDescriptor() };
    } catch (error) {
      if (selection === this.selection) selection.clear();
      this.selectionRejection = Object.freeze({
        accepted: false,
        reason: error?.code === 'selectionTooLarge' ? 'selection-too-large' : 'invalid-stale-selection',
        code: error?.code ?? 'invalidSelection'
      });
      return this.selectionRejection;
    }
  }

  dispatchRowAction(identity, callback) {
    return this.firstPage.dispatchRowAction(identity, callback);
  }

  createAnchor({ canonicalTuple, ordinal = null, entityId = null, viewportOffsetPx = 0, focusKey = null } = {}) {
    return {
      queryFingerprint: this.queryKey,
      snapshotVersion: this.pages.get(this.currentPageIndex)?.catalogVersion ?? null,
      canonicalTuple: canonicalTuple ?? null,
      ordinal: Number.isSafeInteger(ordinal) ? ordinal : null,
      entityId,
      viewportOffsetPx,
      focusKey
    };
  }

  async restoreAnchor(anchor) {
    if (!anchor || anchor.queryFingerprint !== this.queryKey) {
      return { accepted: false, reason: 'query-mismatch', ordinal: 0 };
    }
    if (typeof this.seekAnchorHook !== 'function') {
      return { accepted: false, reason: 'seek-unavailable' };
    }
    const contextToken = this.contextToken;
    if (this.firstPage.state.phase !== 'committed' ||
        typeof contextToken !== 'string' || contextToken.length === 0) {
      return { accepted: false, reason: 'inactive-page' };
    }
    const generation = this.firstPage.queryGeneration;
    const attempt = this.firstPage.pageAttemptId;
    const navigationRequestId = ++this.navigationRequestId;
    for (const fallback of ['exact', 'successor', 'predecessor']) {
      const result = await this.seekAnchorHook({
        contextToken,
        anchor,
        fallback,
        limit: this.pageLimit
      });
      if (!this.firstPage.isCurrent(generation, attempt) || this.contextToken !== contextToken ||
          navigationRequestId !== this.navigationRequestId) {
        return { accepted: false, reason: 'stale-page' };
      }
      if (isMissingAnchorResult(result)) continue;
      return this.commitAnchorResult(result, anchor, { navigationRequestId });
    }
    return { accepted: false, reason: 'anchor-missing' };
  }

  async typeJump(prefix) {
    const normalizedPrefix = String(prefix || '').trim();
    if (!normalizedPrefix || typeof this.seekAnchorHook !== 'function') {
      return { accepted: false, reason: 'seek-unavailable' };
    }
    const contextToken = this.contextToken;
    const generation = this.firstPage.queryGeneration;
    const attempt = this.firstPage.pageAttemptId;
    if (this.firstPage.state.phase !== 'committed' || !contextToken) {
      return { accepted: false, reason: 'inactive-page' };
    }
    const navigationRequestId = ++this.navigationRequestId;
    const result = await this.seekAnchorHook({
      contextToken,
      mode: 'prefix',
      prefix: normalizedPrefix,
      queryFingerprint: this.queryKey
    });
    if (!this.firstPage.isCurrent(generation, attempt) || this.contextToken !== contextToken ||
        navigationRequestId !== this.navigationRequestId) {
      return { accepted: false, reason: 'stale-page' };
    }
    if (isMissingAnchorResult(result)) return { accepted: false, reason: 'prefix-missing' };
    return this.commitAnchorResult(result, {
      focusKey: result.entityId ?? null,
      viewportOffsetPx: 0
    }, { navigationRequestId });
  }

  async jumpToEntity(entityKind, entityId) {
    if (!entityId || typeof this.seekAnchorHook !== 'function') {
      return { accepted: false, reason: 'seek-unavailable' };
    }
    const contextToken = this.contextToken;
    const generation = this.firstPage.queryGeneration;
    const attempt = this.firstPage.pageAttemptId;
    if (this.firstPage.state.phase !== 'committed' || !contextToken) {
      return { accepted: false, reason: 'inactive-page' };
    }
    const navigationRequestId = ++this.navigationRequestId;
    const result = await this.seekAnchorHook({
      contextToken,
      mode: 'entity',
      entityKind,
      entityId,
      queryFingerprint: this.queryKey,
      limit: this.pageLimit
    });
    if (!this.firstPage.isCurrent(generation, attempt) || this.contextToken !== contextToken ||
        navigationRequestId !== this.navigationRequestId) {
      return { accepted: false, reason: 'stale-page' };
    }
    if (isMissingAnchorResult(result)) return { accepted: false, reason: 'entity-missing' };
    return this.commitAnchorResult(result, { focusKey: entityId, viewportOffsetPx: 0 }, {
      navigationRequestId
    });
  }

  commitAnchorResult(result, anchor, { navigationRequestId = this.navigationRequestId } = {}) {
    if (navigationRequestId !== this.navigationRequestId) {
      return { accepted: false, reason: 'stale-page' };
    }
    const page = result?.page ?? (Array.isArray(result?.rows) ? result : null);
    if (!page) return result ?? { accepted: false, reason: 'invalid-anchor-result' };
    const pageStartOrdinal = Number.isSafeInteger(result?.pageStartOrdinal)
      ? result.pageStartOrdinal
      : Number.isSafeInteger(page.pageStartOrdinal)
        ? page.pageStartOrdinal
        : Number.isSafeInteger(result?.ordinal)
          ? Math.floor(result.ordinal / this.pageLimit) * this.pageLimit
          : 0;
    const ordinal = Number.isSafeInteger(result?.ordinal) ? result.ordinal : pageStartOrdinal;
    const normalizedPage = normalizePageStart(page, pageStartOrdinal);
    this.validateBoundedPage(normalizedPage);
    this.pages.clear();
    this.currentPageIndex = Math.floor(pageStartOrdinal / this.pageLimit);
    this.cacheCenterPageIndex = this.currentPageIndex;
    this.pages.set(this.currentPageIndex, normalizedPage);
    const committed = this.firstPage.commitPage(normalizedPage, {
      queryGeneration: this.firstPage.queryGeneration,
      pageAttemptId: this.firstPage.pageAttemptId
    });
    return {
      ...committed,
      ordinal,
      viewportOffsetPx: anchor?.viewportOffsetPx ?? 0,
      focusKey: anchor?.focusKey ?? null
    };
  }

  home() {
    return this.seekToOrdinal(0);
  }

  end() {
    const count = this.firstPage.state.totalCount;
    if (!Number.isSafeInteger(count) || count < 1) {
      return Promise.resolve({ accepted: false, reason: 'count-pending' });
    }
    return this.seekToOrdinal(count - 1);
  }

  async seekToOrdinal(ordinal) {
    if (typeof this.seekOrdinalHook !== 'function') {
      return { accepted: false, reason: 'seek-unavailable' };
    }
    const contextToken = this.contextToken;
    if (this.firstPage.state.phase !== 'committed' ||
        typeof contextToken !== 'string' || contextToken.length === 0) {
      return { accepted: false, reason: 'inactive-page' };
    }
    const generation = this.firstPage.queryGeneration;
    const attempt = this.firstPage.pageAttemptId;
    const navigationRequestId = ++this.navigationRequestId;
    const page = normalizePageStart(await this.seekOrdinalHook({
      contextToken,
      ordinal,
      limit: this.pageLimit
    }), ordinal);
    if (!this.firstPage.isCurrent(generation, attempt) || this.contextToken !== contextToken ||
        navigationRequestId !== this.navigationRequestId) {
      return { accepted: false, reason: 'stale-page' };
    }
    this.validateBoundedPage(page);
    this.pages.clear();
    this.currentPageIndex = Math.floor(page.pageStartOrdinal / this.pageLimit);
    this.cacheCenterPageIndex = this.currentPageIndex;
    this.pages.set(this.currentPageIndex, page);
    const result = this.firstPage.commitPage(page, {
      queryGeneration: generation,
      pageAttemptId: attempt
    });
    return { ...result, ordinal };
  }

  async releaseContext() {
    const contextToken = this.contextToken;
    this.contextToken = null;
    this.selection = null;
    this.selectionAnchor = null;
    if (contextToken) await this.manager.releaseContext(contextToken);
  }

  async destroy() {
    this.viewportRequestId += 1;
    this.navigationRequestId += 1;
    this.viewportRequestedOrdinal = null;
    this.viewportRequestPromise = null;
    this.invalidatePrefetch();
    this.firstPage.abort();
    this.pages.clear();
    await this.releaseContext();
  }

  createViewState(state = this.firstPage.state) {
    const currentPage = this.pages.get(this.currentPageIndex);
    return {
      ...state,
      contextToken: this.contextToken,
      currentPageIndex: this.currentPageIndex,
      cachedPageCount: this.pages.size,
      cachedRowCount: this.getCachedRowCount(),
      nextCursor: currentPage?.nextCursor ?? null,
      previousCursor: currentPage?.previousCursor ?? null,
      pageStartOrdinal: currentPage?.pageStartOrdinal ?? 0,
      staleSelectionDescriptor: this.staleSelectionDescriptor ?? null,
      selectionRejection: this.selectionRejection ?? null,
      selectionDescriptor: this.getSelectionDescriptor(),
      selectionProjection: this.getSelectionProjection(state.totalCount)
    };
  }
}

function normalizePageStart(page, fallbackStartOrdinal) {
  if (!page || !Array.isArray(page.rows)) return page;
  return {
    ...page,
    pageStartOrdinal: Number.isSafeInteger(page.pageStartOrdinal)
      ? page.pageStartOrdinal
      : Math.max(0, Number.isSafeInteger(fallbackStartOrdinal) ? fallbackStartOrdinal : 0)
  };
}

function normalizePagedQuery(query = {}) {
  if (query.endpoint === 'tracks') {
    return {
      endpoint: 'tracks',
      query: String(query.query ?? ''),
      sort: query.sort ?? 'title',
      direction: query.direction === 'desc' ? 'desc' : 'asc',
      scope: query.scope ?? null
    };
  }
  if (query.endpoint === 'entities' && typeof query.entityType === 'string') {
    return {
      endpoint: 'entities',
      entityType: query.entityType,
      query: String(query.query ?? ''),
      sort: query.sort ?? 'name',
      direction: query.direction === 'desc' ? 'desc' : 'asc',
      scope: null,
      ...(query.entityType === 'playlist'
        ? { includeSystemPlaylists: query.includeSystemPlaylists === true }
        : {})
    };
  }
  throw new TypeError('Paged query endpoint is invalid');
}

function isMissingAnchorResult(result) {
  return !result || result.found === false || result.status === 'missing' ||
    (result.accepted === false && (result.reason === 'missing' || result.reason === 'not-found'));
}
