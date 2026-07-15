import { LogicalSelection } from './logical-selection.js';

const FIRST_PAGE_DEADLINES_MS = Object.freeze({ electron: 2_000, web: 3_000 });
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

    const totalCount = page.totalCount ?? { pending: true };
    const ariaRowCount = Number.isSafeInteger(totalCount) && totalCount >= 0 ? totalCount : -1;
    const announceCount = identity.announceCount === true && ariaRowCount >= 0;
    this.commitState({
      phase: 'committed',
      queryGeneration,
      pageAttemptId,
      rows: page.rows,
      totalCount,
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
    this.seekOrdinalHook = seekOrdinal;
    this.seekAnchorHook = seekAnchor;
    this.contextToken = null;
    this.selection = null;
    this.selectionAnchor = null;
    this.staleSelectionDescriptor = null;
    this.selectionRejection = null;
    this.query = null;
    this.queryKey = null;
    this.pages = new Map();
    this.currentPageIndex = 0;
    this.pageRequestId = 0;
    this.firstPage = new PagedViewController({
      runtime,
      setTimeoutFn,
      clearTimeoutFn,
      loadFirstPage: identity => this.loadFirstPage(identity),
      loadCount: identity => this.loadCount(identity),
      onRowsInvalidated,
      onStateChange: state => this.onStateChange(this.createViewState(state))
    });
  }

  async loadCount(identity) {
    if (!this.contextToken || typeof this.manager.getContextCount !== 'function' ||
        !this.firstPage.isCurrent(identity.queryGeneration, identity.pageAttemptId)) return null;
    return this.manager.getContextCount({ contextToken: this.contextToken });
  }

  async start(query, { preserveStaleSelection = false } = {}) {
    this.query = normalizePagedQuery(query);
    this.queryKey = JSON.stringify(this.query);
    if (!preserveStaleSelection) this.staleSelectionDescriptor = null;
    this.preserveStaleSelectionDuringStart = preserveStaleSelection;
    this.pages.clear();
    this.currentPageIndex = 0;
    this.pageRequestId += 1;
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
    const page = normalizePageStart(await this.queryPage(null), 0);
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
    let page = this.pages.get(pageIndex);
    if (!page) {
      const current = this.pages.get(this.currentPageIndex);
      const fallbackStart = pageIndex > this.currentPageIndex
        ? (current?.pageStartOrdinal ?? 0) + (current?.rows?.length ?? this.pageLimit)
        : Math.max(0, (current?.pageStartOrdinal ?? 0) - this.pageLimit);
      page = normalizePageStart(await this.queryPage(cursor), fallbackStart);
    }
    if (!this.firstPage.isCurrent(generation, attempt) || requestId !== this.pageRequestId) {
      return { accepted: false, reason: 'stale-page' };
    }
    this.currentPageIndex = pageIndex;
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
    if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
      return { accepted: false, reason: 'invalid-ordinal' };
    }
    const totalCount = this.firstPage.state.totalCount;
    if (Number.isSafeInteger(totalCount) && ordinal >= totalCount) {
      return { accepted: false, reason: 'end' };
    }
    const cachedPageIndex = this.findCachedPageIndex(ordinal);
    if (cachedPageIndex !== null) return this.activateCachedPage(cachedPageIndex);
    const pageIndex = Math.floor(ordinal / this.pageLimit);
    if (pageIndex === this.currentPageIndex + 1) return this.nextPage();
    if (pageIndex === this.currentPageIndex - 1) return this.previousPage();
    return this.seekToOrdinal(ordinal);
  }

  activateCachedPage(pageIndex) {
    const page = this.pages.get(pageIndex);
    if (!page) return { accepted: false, reason: 'page-not-cached' };
    this.currentPageIndex = pageIndex;
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
    for (const pageIndex of this.pages.keys()) {
      if (Math.abs(pageIndex - this.currentPageIndex) > 2) this.pages.delete(pageIndex);
    }
    while (this.pages.size > PAGED_LIBRARY_MAX_CACHED_PAGES) {
      const [oldest] = this.pages.keys();
      this.pages.delete(oldest);
    }
  }

  getCachedRowCount() {
    return [...this.pages.values()].reduce((sum, page) => sum + page.rows.length, 0);
  }

  getSelectionDescriptor() {
    return this.selection?.toDescriptor() ?? null;
  }

  selectAll() {
    this.selection?.selectAll();
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
        this.selection.setSelected(uid, selected);
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

  dispatchSelectionAction(identity, operationKind, request = {}) {
    return this.dispatchRowAction(identity, () => {
      const descriptor = this.getSelectionDescriptor();
      if (!descriptor || this.staleSelectionDescriptor) {
        return { accepted: false, reason: this.staleSelectionDescriptor ? 'stale-selection' : 'empty-selection' };
      }
      if (descriptor.mode === 'explicit' && descriptor.trackUids.length === 0) {
        return { accepted: false, reason: 'empty-selection' };
      }
      return this.manager.performSelectionAction(operationKind, descriptor, request);
    });
  }

  setSelected(uid, selected) {
    return this.toggleSelection(uid, selected);
  }

  markSelectionStale() {
    const descriptor = this.getSelectionDescriptor();
    if (descriptor && (descriptor.mode !== 'explicit' || descriptor.trackUids.length > 0)) {
      this.staleSelectionDescriptor = descriptor;
    }
    return this.staleSelectionDescriptor;
  }

  clearStaleSelection() {
    this.staleSelectionDescriptor = null;
  }

  reselectStaleSelection() {
    const stale = this.staleSelectionDescriptor;
    if (!stale || !this.selection) return { accepted: false, reason: 'no-stale-selection' };
    try {
      this.selection.clear();
      if (stale.mode === 'all') {
        this.selection.selectAll();
        for (const uid of stale.exclusions ?? []) this.selection.setSelected(uid, false);
      } else if (stale.mode === 'range') {
        this.selection.selectRange(stale.startUid, stale.endUid);
        for (const uid of stale.exclusions ?? []) this.selection.setSelected(uid, false);
      } else {
        for (const uid of stale.trackUids ?? []) this.selection.setSelected(uid, true);
      }
      this.staleSelectionDescriptor = null;
      this.selectionRejection = null;
      return { accepted: true, descriptor: this.getSelectionDescriptor() };
    } catch (error) {
      this.selection.clear();
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
    for (const fallback of ['exact', 'successor', 'predecessor']) {
      const result = await this.seekAnchorHook({
        contextToken: this.contextToken,
        anchor,
        fallback,
        limit: this.pageLimit
      });
      if (isMissingAnchorResult(result)) continue;
      return this.commitAnchorResult(result, anchor);
    }
    return { accepted: false, reason: 'anchor-missing' };
  }

  async typeJump(prefix) {
    const normalizedPrefix = String(prefix || '').trim();
    if (!normalizedPrefix || typeof this.seekAnchorHook !== 'function') {
      return { accepted: false, reason: 'seek-unavailable' };
    }
    const result = await this.seekAnchorHook({
      contextToken: this.contextToken,
      mode: 'prefix',
      prefix: normalizedPrefix,
      queryFingerprint: this.queryKey
    });
    if (isMissingAnchorResult(result)) return { accepted: false, reason: 'prefix-missing' };
    return this.commitAnchorResult(result, {
      focusKey: result.entityId ?? null,
      viewportOffsetPx: 0
    });
  }

  async jumpToEntity(entityKind, entityId) {
    if (!entityId || typeof this.seekAnchorHook !== 'function') {
      return { accepted: false, reason: 'seek-unavailable' };
    }
    const result = await this.seekAnchorHook({
      contextToken: this.contextToken,
      mode: 'entity',
      entityKind,
      entityId,
      queryFingerprint: this.queryKey,
      limit: this.pageLimit
    });
    if (isMissingAnchorResult(result)) return { accepted: false, reason: 'entity-missing' };
    return this.commitAnchorResult(result, { focusKey: entityId, viewportOffsetPx: 0 });
  }

  commitAnchorResult(result, anchor) {
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
    const generation = this.firstPage.queryGeneration;
    const attempt = this.firstPage.pageAttemptId;
    const page = normalizePageStart(await this.seekOrdinalHook({
      contextToken: this.contextToken,
      ordinal,
      limit: this.pageLimit
    }), ordinal);
    if (!this.firstPage.isCurrent(generation, attempt)) {
      return { accepted: false, reason: 'stale-page' };
    }
    this.validateBoundedPage(page);
    this.pages.clear();
    this.currentPageIndex = Math.floor(page.pageStartOrdinal / this.pageLimit);
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
      selectionDescriptor: this.getSelectionDescriptor()
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
      scope: null
    };
  }
  throw new TypeError('Paged query endpoint is invalid');
}

function isMissingAnchorResult(result) {
  return !result || result.found === false || result.status === 'missing' ||
    (result.accepted === false && (result.reason === 'missing' || result.reason === 'not-found'));
}
