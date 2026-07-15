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

test('shift range membership and bulk actions share one selection descriptor', async () => {
  const manager = createPagedManager({ pageSize: 3 });
  const actions = [];
  manager.performSelectionAction = async (operationKind, selectionDescriptor, request) => {
    actions.push({ operationKind, selectionDescriptor, request });
    return { operationId: 'operation-1' };
  };
  const controller = new PagedLibraryViewController({ manager, pageLimit: 3 });
  await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });
  const identity = controller.createViewState();
  controller.toggleSelection('track-0-0', true, { ordinal: 0 });
  controller.toggleSelection('track-0-2', true, { ordinal: 2, extend: true });

  assert.equal(controller.isSelected('track-0-1', 1), true);
  assert.equal(controller.isSelected('track-1-0', 3), false);
  const dispatched = controller.dispatchSelectionAction(identity, 'playNext');
  assert.equal(dispatched.accepted, true);
  await dispatched.value;
  assert.deepEqual(actions, [{
    operationKind: 'playNext',
    selectionDescriptor: {
      mode: 'range',
      contextToken: 'context-0',
      startUid: 'track-0-0',
      endUid: 'track-0-2',
      exclusions: []
    },
    request: {}
  }]);
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
    preserveStaleSelection: true
  });
  assert.equal(controller.createViewState().staleSelectionDescriptor.mode, 'all');
  const rebound = controller.reselectStaleSelection();
  assert.equal(rebound.accepted, true);
  assert.deepEqual(rebound.descriptor, {
    mode: 'all', contextToken: 'context-1', exclusions: ['track-0-1']
  });
  assert.equal(controller.createViewState().staleSelectionDescriptor, null);
});

test('clamped final pages keep absolute membership outside limit-aligned starts', async () => {
  const manager = createPagedManager({ pageSize: 3 });
  let seeks = 0;
  const controller = new PagedLibraryViewController({
    manager,
    pageLimit: 3,
    seekOrdinal: async () => {
      seeks += 1;
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
