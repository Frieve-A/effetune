import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMissingPagedManagerMethods,
  PAGED_LIBRARY_MAX_CACHED_PAGES,
  PAGED_LIBRARY_MAX_CACHED_TRACKS,
  PagedLibraryViewController,
  PagedViewController
} from '../../js/ui/library/paged-view-controller.js';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('a newer query rejects a late first page from the previous generation', async () => {
  const first = createDeferred();
  const second = createDeferred();
  const requests = [first, second];
  let invalidations = 0;
  const controller = new PagedViewController({
    loadFirstPage: () => requests.shift().promise,
    onRowsInvalidated: () => { invalidations += 1; }
  });

  const oldAttempt = controller.start({ text: 'old' });
  const newAttempt = controller.start({ text: 'new' });
  second.resolve({ rows: [{ id: 'new' }], totalCount: { pending: true } });
  assert.deepEqual(await newAttempt, {
    accepted: true,
    terminal: 'committed',
    page: { rows: [{ id: 'new' }], totalCount: { pending: true } }
  });
  first.resolve({ rows: [{ id: 'old' }], totalCount: 1 });
  assert.deepEqual(await oldAttempt, { accepted: false, reason: 'stale-attempt' });
  assert.deepEqual(controller.state.rows, [{ id: 'new' }]);
  assert.equal(controller.state.ariaBusy, false);
  assert.equal(controller.state.ariaRowCount, -1);
  assert.equal(invalidations, 2);
});

test('retry keeps the query generation and advances only the attempt identity', async () => {
  let calls = 0;
  const controller = new PagedViewController({
    loadFirstPage: async () => {
      calls += 1;
      if (calls === 1) throw new Error('offline');
      return { rows: [{ id: 'ready' }], totalCount: 1 };
    }
  });

  const failed = await controller.start({ text: 'same' });
  const generation = controller.queryGeneration;
  const retried = await controller.retry();

  assert.equal(failed.terminal, 'failed');
  assert.equal(retried.terminal, 'committed');
  assert.equal(controller.queryGeneration, generation);
  assert.equal(controller.pageAttemptId, 2);
  assert.equal(controller.state.ariaRowCount, 1);
});

test('timer adapters are invoked without rebinding their host receiver', async () => {
  let setReceiver = 'not-called';
  let clearReceiver = 'not-called';
  const controller = new PagedViewController({
    loadFirstPage: async () => ({ rows: [], totalCount: 0 }),
    setTimeoutFn: function setTimer() {
      setReceiver = this;
      return 9;
    },
    clearTimeoutFn: function clearTimer() {
      clearReceiver = this;
    }
  });

  assert.equal((await controller.start({ text: '' })).terminal, 'committed');
  assert.equal(setReceiver, undefined);
  assert.equal(clearReceiver, undefined);
});

test('first page timeout releases busy state and allows retry', async () => {
  let fireDeadline;
  let now = 0;
  const controller = new PagedViewController({
    loadFirstPage: () => new Promise(() => {}),
    monotonicNow: () => now,
    setTimeoutFn: callback => {
      fireDeadline = callback;
      return 7;
    },
    clearTimeoutFn: () => {}
  });

  const attempt = controller.start({ text: 'slow' });
  await Promise.resolve();
  now = 3_000;
  fireDeadline();
  assert.deepEqual(await attempt, { accepted: true, terminal: 'timedOut' });
  assert.equal(controller.state.ariaBusy, false);
  assert.equal(controller.state.ariaRowCount, -1);
  assert.match(controller.state.error.message, /timed out/);
});

test('first page completion must be strictly before the injected monotonic deadline', async () => {
  for (const [completedAt, terminal] of [[1_999, 'committed'], [2_000, 'timedOut'], [2_001, 'timedOut']]) {
    const page = createDeferred();
    let now = 0;
    const controller = new PagedViewController({
      runtime: 'electron',
      loadFirstPage: () => page.promise,
      monotonicNow: () => now,
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {}
    });
    const attempt = controller.start({ text: '' });
    await Promise.resolve();
    now = completedAt;
    page.resolve({ rows: [{ id: 'ready' }], totalCount: 1 });
    assert.equal((await attempt).terminal, terminal, `completion at ${completedAt} ms`);
  }
});

test('row actions run only for the committed current attempt', async () => {
  const controller = new PagedViewController({
    loadFirstPage: async () => ({ rows: [{ id: 'a' }], totalCount: 1 })
  });
  await controller.start({ text: '' });
  const identity = {
    queryGeneration: controller.queryGeneration,
    pageAttemptId: controller.pageAttemptId
  };

  assert.deepEqual(
    controller.dispatchRowAction(identity, () => 'played'),
    { accepted: true, value: 'played' }
  );
  assert.deepEqual(
    controller.dispatchRowAction({ ...identity, pageAttemptId: identity.pageAttemptId - 1 }, () => 'stale'),
    { accepted: false, reason: 'inactive-page' }
  );
});

test('count updates require the committed current attempt', async () => {
  const controller = new PagedViewController({
    loadFirstPage: async () => ({ rows: [], totalCount: { pending: true } })
  });
  await controller.start({});
  const identity = {
    queryGeneration: controller.queryGeneration,
    pageAttemptId: controller.pageAttemptId
  };

  assert.deepEqual(controller.commitCount(1_000_000, identity), { accepted: true });
  assert.equal(controller.state.ariaRowCount, 1_000_000);
  assert.equal(controller.state.liveAnnouncementId, '1:1:count');
  assert.deepEqual(controller.commitCount(1_000_000, identity), {
    accepted: false,
    reason: 'duplicate-count'
  });
  assert.deepEqual(
    controller.commitCount(-1, identity),
    { accepted: false, reason: 'invalid-count' }
  );
  controller.abort();
  assert.deepEqual(
    controller.commitCount(4, identity),
    { accepted: false, reason: 'stale-attempt' }
  );
});

test('playlist page aggregates are retained in committed view state', async () => {
  const controller = new PagedViewController({
    loadFirstPage: async () => ({
      rows: [{ trackUid: 'available' }, { trackUid: null }],
      totalCount: 3,
      resolvedCount: 2,
      unresolvedCount: 1
    })
  });

  await controller.start({});

  assert.equal(controller.state.resolvedCount, 2);
  assert.equal(controller.state.unresolvedCount, 1);
});

test('retry terminal and count publication remain fenced to one attempt', async () => {
  const first = createDeferred();
  const second = createDeferred();
  const requests = [first, second];
  const states = [];
  const controller = new PagedViewController({
    loadFirstPage: () => requests.shift().promise,
    onStateChange: state => states.push(state)
  });
  const failedAttempt = controller.start({});
  first.reject(new Error('offline'));
  await failedAttempt;
  const retry = controller.retry();
  second.resolve({ rows: [{ id: 'ready' }], totalCount: { pending: true } });
  await retry;

  const failed = states.find(state => state.phase === 'failed');
  const committed = states.at(-1);
  assert.equal(failed.liveAnnouncementId, '1:1:failed');
  assert.equal(committed.pageAttemptId, 2);
  assert.equal(committed.liveAnnouncementId, null);
  assert.equal(committed.ariaBusy, false);
  assert.equal(committed.ariaRowCount, -1);
  assert.deepEqual(controller.commitCount(42, { queryGeneration: 1, pageAttemptId: 1 }), {
    accepted: false,
    reason: 'stale-attempt'
  });
});

function createPagedManager({ pageSize = 500 } = {}) {
  const released = [];
  const contexts = [];
  return {
    released,
    contexts,
    async createContext(query) {
      const token = `context-${contexts.length}`;
      contexts.push({ token, query });
      return token;
    },
    async queryTracks({ cursor, contextToken }) {
      const pageIndex = cursor ? Number(cursor.slice(5)) : 0;
      return {
        rows: Array.from({ length: pageSize }, (_, index) => ({
          trackUid: `track-${pageIndex}-${index}`
        })),
        nextCursor: pageIndex < 7 ? `page-${pageIndex + 1}` : null,
        previousCursor: pageIndex > 0 ? `page-${pageIndex - 1}` : null,
        totalCount: pageSize * 8,
        catalogVersion: 1,
        contextToken
      };
    },
    async queryEntities(options) {
      return this.queryTracks(options);
    },
    async releaseContext(contextToken) {
      released.push(contextToken);
    },
    async getCounts() { return { tracks: pageSize * 8 }; },
    async getTrack(trackUid) { return { trackUid }; }
  };
}

test('paged library controller keeps only current-near pages under the 2500 row cap', async () => {
  const manager = createPagedManager();
  const controller = new PagedLibraryViewController({ manager, pageLimit: 500 });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  for (let page = 1; page <= 6; page += 1) {
    const result = await controller.nextPage();
    assert.equal(result.accepted, true);
    assert.ok(controller.pages.size <= PAGED_LIBRARY_MAX_CACHED_PAGES);
    assert.ok(controller.getCachedRowCount() <= PAGED_LIBRARY_MAX_CACHED_TRACKS);
  }
  assert.deepEqual([...controller.pages.keys()], [4, 5, 6]);
  await controller.destroy();
  assert.deepEqual(manager.released, ['context-0']);
});

test('paged library controller reads two adjacent pages without replacing the visible page', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const queryCursors = [];
  const committedStarts = [];
  const queryTracks = manager.queryTracks.bind(manager);
  manager.queryTracks = async request => {
    queryCursors.push(request.cursor ?? null);
    return queryTracks(request);
  };
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    onStateChange: state => {
      if (state.phase === 'committed') committedStarts.push(state.pageStartOrdinal);
    }
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });

  const result = await controller.prefetchAroundOrdinal(0, { direction: 1, pageCount: 2 });

  assert.equal(result.accepted, true);
  assert.equal(result.prefetched, true);
  assert.deepEqual(queryCursors, [null, 'page-1', 'page-2']);
  assert.deepEqual([...controller.pages.keys()], [0, 1, 2]);
  assert.equal(controller.currentPageIndex, 0);
  assert.deepEqual(committedStarts, [0]);
  assert.deepEqual(controller.getCachedRows(4, 5), [{
    ordinal: 4,
    row: { trackUid: 'track-2-0' }
  }]);

  const cachedRequestId = controller.prefetchRequestId;
  const cachedPrefetch = controller.prefetchAroundOrdinal(0, { direction: 1, pageCount: 2 });
  assert.deepEqual(
    await cachedPrefetch,
    { accepted: true, prefetched: false }
  );
  assert.deepEqual(queryCursors, [null, 'page-1', 'page-2']);
  assert.equal(controller.prefetchRequestId, cachedRequestId);
  assert.equal(controller.prefetchRequestPromise, null);
  const reverseCachedPrefetch = controller.prefetchAroundOrdinal(4, { direction: -1, pageCount: 2 });
  assert.equal(reverseCachedPrefetch, cachedPrefetch);
  assert.deepEqual(
    await reverseCachedPrefetch,
    { accepted: true, prefetched: false }
  );
  const boundaryCachedPrefetch = controller.prefetchAroundOrdinal(0, { direction: -1, pageCount: 2 });
  assert.equal(boundaryCachedPrefetch, cachedPrefetch);
  assert.deepEqual(
    await boundaryCachedPrefetch,
    { accepted: true, prefetched: false }
  );
  assert.deepEqual(queryCursors, [null, 'page-1', 'page-2']);
  assert.equal(controller.prefetchRequestId, cachedRequestId);

  await controller.prefetchAroundOrdinal(2, { direction: 1, pageCount: 2 });
  await controller.prefetchAroundOrdinal(4, { direction: 1, pageCount: 2 });
  await controller.prefetchAroundOrdinal(6, { direction: 1, pageCount: 2 });
  assert.equal(controller.pages.has(0), true);
  assert.equal(controller.pages.size, PAGED_LIBRARY_MAX_CACHED_PAGES);
  assert.ok(controller.getCachedRowCount() <= PAGED_LIBRARY_MAX_CACHED_TRACKS);
  await controller.destroy();
});

test('a satisfied reverse prefetch stops obsolete read-ahead after its in-flight page', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const nextPage = createDeferred();
  const queryTracks = manager.queryTracks.bind(manager);
  const pageOne = await queryTracks({ cursor: 'page-1', contextToken: 'context-0' });
  const queryCursors = [];
  manager.queryTracks = request => {
    queryCursors.push(request.cursor ?? null);
    return request.cursor === 'page-1' ? nextPage.promise : queryTracks(request);
  };
  const controller = new PagedLibraryViewController({ manager, pageLimit: 2 });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });

  const prefetch = controller.prefetchAroundOrdinal(0, { direction: 1, pageCount: 2 });
  const requestId = controller.prefetchRequestId;
  const reversePrefetch = controller.prefetchAroundOrdinal(0, { direction: -1, pageCount: 2 });
  assert.equal(
    controller.prefetchAroundOrdinal(0, { direction: -1, pageCount: 2 }),
    reversePrefetch
  );
  assert.deepEqual(await reversePrefetch, { accepted: true, prefetched: false });
  assert.equal(controller.prefetchRequestId, requestId);

  nextPage.resolve(pageOne);
  assert.equal((await prefetch).prefetched, true);
  assert.deepEqual(queryCursors, [null, 'page-1']);
  assert.deepEqual([...controller.pages.keys()], [0, 1]);
  await controller.destroy();
});

test('a replacement prefetch starts only after the obsolete in-flight page finishes', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const oldAdjacentPage = createDeferred();
  const queryTracks = manager.queryTracks.bind(manager);
  const pageThree = await queryTracks({ cursor: 'page-3', contextToken: 'context-0' });
  const queryCursors = [];
  manager.queryTracks = request => {
    queryCursors.push(request.cursor ?? null);
    return request.cursor === 'page-3' ? oldAdjacentPage.promise : queryTracks(request);
  };
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    seekOrdinal: request => queryTracks({ ...request, cursor: 'page-2' })
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  assert.equal((await controller.requestViewportOrdinal(4)).accepted, true);

  const prefetch = controller.prefetchAroundOrdinal(4, { direction: 1, pageCount: 2 });
  assert.deepEqual(
    await controller.prefetchAroundOrdinal(0, { direction: 1, pageCount: 1 }),
    { accepted: false, reason: 'page-pending' }
  );

  oldAdjacentPage.resolve(pageThree);
  assert.equal((await prefetch).prefetched, true);
  assert.deepEqual(queryCursors, [null, 'page-3', 'page-1']);
  await controller.destroy();
});

test('viewport loading joins an in-flight adjacent read instead of seeking the same rows again', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const nextPage = createDeferred();
  const queryTracks = manager.queryTracks.bind(manager);
  manager.queryTracks = request => request.cursor === 'page-1'
    ? nextPage.promise
    : queryTracks(request);
  let seekCount = 0;
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    seekOrdinal: async request => {
      seekCount += 1;
      return queryTracks({ ...request, cursor: 'page-1' });
    }
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });

  const prefetch = controller.prefetchAroundOrdinal(0);
  const viewport = controller.requestViewportOrdinal(2);
  nextPage.resolve(await queryTracks({ cursor: 'page-1', contextToken: 'context-0' }));

  assert.equal((await prefetch).prefetched, true);
  assert.equal((await viewport).accepted, true);
  assert.equal(controller.currentPageIndex, 1);
  assert.equal(seekCount, 0);
  await controller.destroy();
});

test('viewport loading publishes the requested prefetched page ahead of additional read-ahead', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const nextPage = createDeferred();
  const queryTracks = manager.queryTracks.bind(manager);
  const pageOne = await queryTracks({ cursor: 'page-1', contextToken: 'context-0' });
  const queryCursors = [];
  const cacheChanges = [];
  manager.queryTracks = request => {
    queryCursors.push(request.cursor ?? null);
    return request.cursor === 'page-1' ? nextPage.promise : queryTracks(request);
  };
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    onCacheChange: change => cacheChanges.push(change.pageIndex)
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });

  const prefetch = controller.prefetchAroundOrdinal(0, { direction: 1, pageCount: 2 });
  const viewport = controller.requestViewportOrdinal(2);
  nextPage.resolve(pageOne);

  assert.equal((await viewport).accepted, true);
  assert.equal(controller.currentPageIndex, 1);
  assert.deepEqual(queryCursors, [null, 'page-1']);
  assert.deepEqual(cacheChanges, [1]);
  assert.deepEqual(await prefetch, {
    accepted: true,
    prefetched: true,
    visibleReady: true
  });
  await controller.destroy();
});

test('an invalidated read-ahead finishes without starting another prefetch concurrently', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const obsoletePage = createDeferred();
  const queryTracks = manager.queryTracks.bind(manager);
  let adjacentReads = 0;
  manager.queryTracks = request => {
    if (request.cursor === 'page-1') {
      adjacentReads += 1;
      return obsoletePage.promise;
    }
    return queryTracks(request);
  };
  const pageFor = ordinal => ({
    rows: [{ trackUid: `track-${ordinal}` }, { trackUid: `track-${ordinal + 1}` }],
    pageStartOrdinal: ordinal,
    totalCount: 16,
    nextCursor: 'next',
    previousCursor: 'previous'
  });
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    seekOrdinal: request => pageFor(request.ordinal)
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });

  const obsoletePrefetch = controller.prefetchAroundOrdinal(0);
  assert.equal((await controller.requestViewportOrdinal(6)).accepted, true);
  assert.deepEqual(await controller.prefetchAroundOrdinal(6), {
    accepted: false,
    reason: 'page-pending'
  });
  assert.equal(adjacentReads, 1);

  obsoletePage.resolve(await queryTracks({ cursor: 'page-1', contextToken: 'context-0' }));
  assert.equal((await obsoletePrefetch).accepted, false);
  assert.equal(adjacentReads, 1);
  await controller.destroy();
});

test('paged library controller does not seek while a replacement context is opening', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const replacementContext = createDeferred();
  let contextNumber = 0;
  manager.createContext = async query => {
    const token = `context-${contextNumber++}`;
    manager.contexts.push({ token, query });
    return token === 'context-0' ? token : replacementContext.promise;
  };
  const seeks = [];
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    seekOrdinal: async request => {
      seeks.push(request);
      return manager.queryTracks({ contextToken: request.contextToken, cursor: 'page-3' });
    }
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });

  const restart = controller.start({ endpoint: 'tracks', query: 'updated', sort: 'title', direction: 'asc' });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(controller.contextToken, null);
  assert.deepEqual(await controller.ensureOrdinal(6), {
    accepted: false,
    reason: 'inactive-page'
  });
  assert.deepEqual(seeks, []);

  replacementContext.resolve('context-1');
  await restart;
  assert.equal(controller.contextToken, 'context-1');
  await controller.destroy();
});

test('viewport paging publishes completed pages while coalescing dragged positions', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const pendingPages = new Map();
  const seeks = [];
  const committedStarts = [];
  const cacheChanges = [];
  let setup = true;
  const pageFor = ordinal => {
    const pageStartOrdinal = Math.floor(ordinal / 2) * 2;
    return {
      rows: [
        { trackUid: `track-${pageStartOrdinal}` },
        { trackUid: `track-${pageStartOrdinal + 1}` }
      ],
      pageStartOrdinal,
      totalCount: 16,
      nextCursor: pageStartOrdinal < 14 ? 'next' : null,
      previousCursor: pageStartOrdinal > 0 ? 'previous' : null
    };
  };
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    onStateChange: state => {
      if (state.phase === 'committed') committedStarts.push(state.pageStartOrdinal);
    },
    onCacheChange: change => cacheChanges.push(change.page.pageStartOrdinal),
    seekOrdinal: request => {
      seeks.push(request.ordinal);
      if (setup) return pageFor(request.ordinal);
      const pending = createDeferred();
      pendingPages.set(request.ordinal, pending);
      return pending.promise;
    }
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  await controller.seekToOrdinal(14);
  setup = false;
  seeks.length = 0;
  committedStarts.length = 0;

  const firstRequest = controller.requestViewportOrdinal(10);
  assert.deepEqual(await controller.requestViewportOrdinal(6), {
    accepted: false,
    reason: 'page-pending'
  });
  assert.deepEqual(await controller.requestViewportOrdinal(0), {
    accepted: false,
    reason: 'page-pending'
  });
  assert.deepEqual(seeks, [10]);

  pendingPages.get(10).resolve(pageFor(10));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(seeks, [10, 0]);
  assert.deepEqual(committedStarts, []);
  assert.deepEqual(cacheChanges, [10]);
  assert.deepEqual(controller.getCachedRows(10, 11), [{
    ordinal: 10,
    row: { trackUid: 'track-10' }
  }]);

  assert.deepEqual(await controller.requestViewportOrdinal(1), {
    accepted: false,
    reason: 'page-pending'
  });
  pendingPages.get(0).resolve(pageFor(0));
  assert.equal((await firstRequest).accepted, true);
  assert.deepEqual(seeks, [10, 0]);
  assert.equal(controller.currentPageIndex, 0);
  assert.deepEqual(controller.getCachedRows(0, 1), [{
    ordinal: 0,
    row: { trackUid: 'track-0' }
  }]);
  assert.deepEqual(committedStarts, [0]);
  await controller.destroy();
});

test('anchor fallback stays on one context when a replacement starts mid-restore', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const replacementContext = createDeferred();
  let contextNumber = 0;
  manager.createContext = async query => {
    const token = `context-${contextNumber++}`;
    manager.contexts.push({ token, query });
    return token === 'context-0' ? token : replacementContext.promise;
  };
  const firstAnchorResult = createDeferred();
  const seeks = [];
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    seekAnchor: request => {
      seeks.push(request);
      return firstAnchorResult.promise;
    }
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  const anchor = controller.createAnchor({
    entityId: 'track-0-0',
    canonicalTuple: ['track-0-0']
  });

  const restore = controller.restoreAnchor(anchor);
  await Promise.resolve();
  const restart = controller.start({ endpoint: 'tracks', query: 'updated', sort: 'title', direction: 'asc' });
  await Promise.resolve();
  await Promise.resolve();
  firstAnchorResult.resolve({ accepted: false, reason: 'missing' });

  assert.deepEqual(await restore, { accepted: false, reason: 'stale-page' });
  assert.equal(seeks.length, 1);
  assert.equal(seeks[0].contextToken, 'context-0');
  replacementContext.resolve('context-1');
  await restart;
  await controller.destroy();
});

test('paged controller exposes compact selection, generic anchors, and seek hooks', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const seeks = [];
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    seekOrdinal: async request => {
      seeks.push(request);
      return manager.queryTracks({ contextToken: request.contextToken, cursor: null });
    },
    seekAnchor: async request => ({ accepted: true, request })
  });
  await controller.start({ endpoint: 'tracks', query: 'term', sort: 'title', direction: 'asc' });
  controller.selectAll();
  controller.setSelected('track-0-1', false);
  assert.deepEqual(controller.getSelectionDescriptor(), {
    mode: 'all',
    contextToken: 'context-0',
    exclusions: ['track-0-1']
  });
  const anchor = controller.createAnchor({
    canonicalTuple: [{ type: 'text', nullRank: 0, value: 'a' }],
    viewportOffsetPx: 24,
    focusKey: 'track-0-0'
  });
  assert.equal(anchor.viewportOffsetPx, 24);
  assert.equal(anchor.focusKey, 'track-0-0');
  assert.equal((await controller.restoreAnchor(anchor)).accepted, true);
  assert.equal((await controller.home()).accepted, true);
  assert.equal((await controller.end()).accepted, true);
  assert.deepEqual(seeks.map(request => request.ordinal), [0, 15]);
  await controller.destroy();
});

test('paged controller selects at most 300 results by default only once per search attempt', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  let totalCount = 300;
  manager.queryTracks = async ({ contextToken }) => ({
    rows: [{ trackUid: 'track-0' }, { trackUid: 'track-1' }],
    nextCursor: null,
    previousCursor: null,
    totalCount,
    catalogVersion: 1,
    contextToken
  });
  const controller = new PagedLibraryViewController({ manager, pageLimit: 2 });

  await controller.start(
    { endpoint: 'tracks', query: 'term', sort: 'title', direction: 'asc' },
    { defaultSelectAllLimit: 300 }
  );
  assert.deepEqual(controller.getSelectionDescriptor(), {
    mode: 'all', contextToken: 'context-0', exclusions: []
  });

  controller.clearSelection();
  controller.firstPage.commitPage(await manager.queryTracks({ contextToken: controller.contextToken }), {
    queryGeneration: controller.firstPage.queryGeneration,
    pageAttemptId: controller.firstPage.pageAttemptId
  });
  assert.deepEqual(controller.getSelectionDescriptor(), {
    mode: 'explicit', contextToken: 'context-0', trackUids: []
  });

  totalCount = 301;
  await controller.start(
    { endpoint: 'tracks', query: 'broader term', sort: 'title', direction: 'asc' },
    { defaultSelectAllLimit: 300 }
  );
  assert.deepEqual(controller.getSelectionDescriptor(), {
    mode: 'explicit', contextToken: 'context-1', trackUids: []
  });

  totalCount = 300;
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  assert.deepEqual(controller.getSelectionDescriptor(), {
    mode: 'explicit', contextToken: 'context-2', trackUids: []
  });
  await controller.destroy();
});

test('paged controller resolves a pending count before publishing default selection', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const count = createDeferred();
  let countRequests = 0;
  manager.queryTracks = async ({ contextToken }) => ({
    rows: [{ trackUid: 'track-0' }, { trackUid: 'track-1' }],
    nextCursor: null,
    previousCursor: null,
    totalCount: { pending: true },
    catalogVersion: 1,
    contextToken
  });
  manager.getContextCount = () => {
    countRequests += 1;
    return count.promise;
  };
  const committed = [];
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    onStateChange: state => {
      if (state.phase === 'committed') committed.push(state);
    }
  });

  const start = controller.start(
    { endpoint: 'tracks', query: 'term', sort: 'title', direction: 'asc' },
    { defaultSelectAllLimit: 300 }
  );
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(countRequests, 1);
  assert.equal(committed.length, 0);

  count.resolve(2);
  await start;

  assert.equal(committed.length, 1);
  assert.equal(committed[0].totalCount, 2);
  assert.deepEqual(committed[0].selectionProjection, { hasAny: true, selectedCount: 2 });
  assert.deepEqual(controller.getSelectionDescriptor(), {
    mode: 'all', contextToken: 'context-0', exclusions: []
  });
  await controller.destroy();
});

test('paged controller does not apply default selection after an unavailable initial count', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  manager.queryTracks = async ({ contextToken }) => ({
    rows: [{ trackUid: 'track-0' }, { trackUid: 'track-1' }],
    totalCount: { pending: true },
    contextToken
  });
  let countRequests = 0;
  manager.getContextCount = async () => (++countRequests === 1 ? null : 2);
  const controller = new PagedLibraryViewController({ manager, pageLimit: 2 });

  await controller.start(
    { endpoint: 'tracks', query: 'term', sort: 'title', direction: 'asc' },
    { defaultSelectAllLimit: 300 }
  );
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(countRequests, 2);
  assert.equal(controller.createViewState().totalCount, 2);
  assert.deepEqual(controller.getSelectionDescriptor(), {
    mode: 'explicit', contextToken: 'context-0', trackUids: []
  });
  await controller.destroy();
});

test('type jump preserves the resolved entity as the focus target', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    seekAnchor: async request => ({
      accepted: true,
      entityId: 'track-3-1',
      ordinal: 7,
      pageStartOrdinal: 6,
      page: {
        rows: [{ trackUid: 'track-3-0' }, { trackUid: 'track-3-1' }],
        totalCount: 16,
        contextToken: request.contextToken,
        pageStartOrdinal: 6
      }
    })
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });

  const result = await controller.typeJump('t');

  assert.equal(result.accepted, true);
  assert.equal(result.ordinal, 7);
  assert.equal(result.focusKey, 'track-3-1');
});

test('the latest navigation await wins across overlapping ordinal seeks', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const first = createDeferred();
  const second = createDeferred();
  let seekCount = 0;
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    seekOrdinal: () => (seekCount++ === 0 ? first.promise : second.promise)
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });

  const older = controller.seekToOrdinal(2);
  const newer = controller.seekToOrdinal(4);
  second.resolve({
    rows: [{ trackUid: 'newest-0' }, { trackUid: 'newest-1' }],
    pageStartOrdinal: 4,
    totalCount: 16,
    contextToken: 'context-0'
  });
  assert.equal((await newer).accepted, true);
  first.resolve({
    rows: [{ trackUid: 'older-0' }, { trackUid: 'older-1' }],
    pageStartOrdinal: 2,
    totalCount: 16,
    contextToken: 'context-0'
  });

  assert.deepEqual(await older, { accepted: false, reason: 'stale-page' });
  assert.deepEqual(controller.createViewState().rows, [
    { trackUid: 'newest-0' },
    { trackUid: 'newest-1' }
  ]);
  await controller.destroy();
});

test('shift range membership produces one selection descriptor', async () => {
  const manager = createPagedManager({ pageSize: 3 });
  const controller = new PagedLibraryViewController({ manager, pageLimit: 3 });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  controller.toggleSelection('track-0-0', true, { ordinal: 0 });
  controller.toggleSelection('track-0-2', true, { ordinal: 2, extend: true });
  controller.toggleSelection('track-0-1', false, { ordinal: 1 });
  controller.toggleSelection('track-1-0', true, { ordinal: 3 });

  assert.equal(controller.isSelected('track-0-1', 1), false);
  assert.equal(controller.isSelected('track-1-0', 3), true);
  assert.deepEqual(controller.getSelectionProjection(), { hasAny: true, selectedCount: 3 });
  assert.deepEqual(controller.getSelectionDescriptor(), {
    mode: 'range',
    contextToken: 'context-0',
    startUid: 'track-0-0',
    endUid: 'track-0-2',
    exclusions: ['track-0-1'],
    inclusions: ['track-1-0']
  });
});

test('sparse overflow is a typed rejection that preserves selection and stale selection is explicitly rebound', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const controller = new PagedLibraryViewController({ manager, pageLimit: 2 });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  const oversizedUid = 'x'.repeat(256 * 1024);
  const rejected = controller.toggleSelection(oversizedUid, true, { ordinal: 0 });
  assert.deepEqual(rejected, {
    accepted: false,
    reason: 'selection-too-large',
    code: 'selectionTooLarge',
    details: rejected.details
  });
  assert.deepEqual(controller.getSelectionDescriptor(), {
    mode: 'explicit', contextToken: 'context-0', trackUids: []
  });

  controller.selectAll();
  controller.setSelected('track-0-1', false);
  controller.markSelectionStale();
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' }, {
    preserveStaleSelection: true,
    defaultSelectAllLimit: 300
  });
  assert.equal(controller.createViewState().staleSelectionDescriptor.mode, 'all');
  assert.deepEqual(controller.getSelectionDescriptor(), {
    mode: 'explicit', contextToken: 'context-1', trackUids: []
  });
  const rebound = await controller.reselectStaleSelection();
  assert.equal(rebound.accepted, true);
  assert.deepEqual(rebound.descriptor, {
    mode: 'all', contextToken: 'context-1', exclusions: ['track-0-1']
  });
  assert.equal(controller.createViewState().staleSelectionDescriptor, null);
});

test('stale range reselect resolves endpoint ordinals in the replacement context', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const resolved = new Map([
    ['occurrence-start', 10],
    ['occurrence-end', 14]
  ]);
  const requests = [];
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    seekAnchor: async request => {
      requests.push(request);
      const ordinal = resolved.get(request.entityId);
      return Number.isSafeInteger(ordinal)
        ? { accepted: true, found: true, ordinal }
        : { accepted: false, found: false, reason: 'missing' };
    }
  });
  await controller.start({
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc',
    scope: { playlistId: 'playlist-1' }
  });
  controller.toggleSelection('occurrence-start', true, { ordinal: 1 });
  controller.toggleSelection('occurrence-end', true, { ordinal: 4, extend: true });
  controller.toggleSelection('occurrence-excluded', false, { ordinal: 2 });
  controller.toggleSelection('occurrence-included', true, { ordinal: 6 });
  controller.markSelectionStale();

  await controller.start({
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc',
    scope: { playlistId: 'playlist-1' }
  }, { preserveStaleSelection: true });
  const rebound = await controller.reselectStaleSelection();

  assert.equal(rebound.accepted, true);
  assert.deepEqual(rebound.descriptor, {
    mode: 'range',
    contextToken: 'context-1',
    startUid: 'occurrence-start',
    endUid: 'occurrence-end',
    exclusions: ['occurrence-excluded'],
    inclusions: ['occurrence-included']
  });
  assert.deepEqual(controller.getSelectionProjection(), { hasAny: true, selectedCount: 5 });
  assert.equal(controller.isSelected('replacement-intermediate', 12), true);
  assert.deepEqual(controller.selectionAnchor, { uid: 'occurrence-end', ordinal: 14 });
  assert.deepEqual(requests.map(request => ({
    contextToken: request.contextToken,
    entityKind: request.entityKind,
    entityId: request.entityId
  })), [
    { contextToken: 'context-1', entityKind: 'track', entityId: 'occurrence-start' },
    { contextToken: 'context-1', entityKind: 'track', entityId: 'occurrence-end' }
  ]);
});

test('ordinal loading returns the requested row after leaving a clamped final page', async () => {
  const manager = createPagedManager({ pageSize: 3 });
  let seeks = 0;
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 3,
    seekOrdinal: async ({ ordinal }) => {
      seeks += 1;
      if (ordinal === 9) {
        return {
          rows: [{ trackUid: 'track-9' }, { trackUid: 'track-10' }, { trackUid: 'track-11' }],
          pageStartOrdinal: 9,
          totalCount: 16,
          nextCursor: 'after-nine',
          previousCursor: 'before-nine'
        };
      }
      return {
        rows: [{ trackUid: 'track-13' }, { trackUid: 'track-14' }, { trackUid: 'track-15' }],
        pageStartOrdinal: 13,
        totalCount: 16,
        nextCursor: null,
        previousCursor: 'before'
      };
    }
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  await controller.seekToOrdinal(15);
  assert.deepEqual(controller.getCachedRows(15, 16), [{
    ordinal: 15,
    row: { trackUid: 'track-15' }
  }]);
  assert.equal((await controller.ensureOrdinal(15)).accepted, true);
  assert.equal(seeks, 1);
  assert.equal((await controller.ensureOrdinal(9)).accepted, true);
  assert.deepEqual(controller.getCachedRows(9, 10), [{
    ordinal: 9,
    row: { trackUid: 'track-9' }
  }]);
  assert.equal(seeks, 2);
});

test('anchor restoration falls back to successor then predecessor and commits the resolved page', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const fallbacks = [];
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 2,
    seekAnchor: async request => {
      fallbacks.push(request.fallback);
      if (request.fallback !== 'predecessor') return { accepted: false, reason: 'missing' };
      return {
        accepted: true,
        ordinal: 6,
        page: await manager.queryTracks({ cursor: 'page-3', contextToken: request.contextToken })
      };
    }
  });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  const anchor = controller.createAnchor({ canonicalTuple: ['gone'] });
  const result = await controller.restoreAnchor(anchor);
  assert.deepEqual(fallbacks, ['exact', 'successor', 'predecessor']);
  assert.equal(result.accepted, true);
  assert.equal(result.ordinal, 6);
  assert.equal(controller.currentPageIndex, 3);
  assert.deepEqual(controller.getCachedRows(6, 8).map(item => item.row.trackUid), [
    'track-3-0',
    'track-3-1'
  ]);
  await controller.destroy();
});

test('query-mismatched anchors reset explicitly to the top without moving pagination', async () => {
  const manager = createPagedManager({ pageSize: 2 });
  const controller = new PagedLibraryViewController({ manager, pageLimit: 2 });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  assert.deepEqual(await controller.restoreAnchor({ queryFingerprint: 'other' }), {
    accepted: false,
    reason: 'query-mismatch',
    ordinal: 0
  });
  assert.equal(controller.currentPageIndex, 0);
  await controller.destroy();
});

test('paged manager contract fails visibly instead of selecting a materialized fallback', () => {
  const missing = getMissingPagedManagerMethods({ queryTracks() {} });
  assert.deepEqual(missing, [
    'createContext',
    'queryEntities',
    'releaseContext',
    'getCounts',
    'getTrack'
  ]);
  assert.throws(
    () => new PagedLibraryViewController({ manager: { queryTracks() {} } }),
    /Paged library manager is missing/
  );
});
