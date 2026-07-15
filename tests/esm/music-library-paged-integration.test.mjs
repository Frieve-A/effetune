import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPagedPlaylistTarget,
  getPagedInvalidationDecision,
  LibraryView,
  PAGED_RENDERED_ROW_LIMIT
} from '../../js/ui/library/library-view.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class PagedDomElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.clientWidth = 800;
    this.clientHeight = 480;
    this.offsetTop = 0;
    this.scrollTop = 0;
    this.isConnected = true;
    this.innerHTML = '';
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    children.forEach(child => this.appendChild(child));
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() { this.focused = true; }
}

function createPagedManager() {
  return {
    async createContext() { return 'context'; },
    async queryTracks() {},
    async queryEntities() {},
    async releaseContext() {},
    async getCounts() { return {}; },
    async getTrack() { return null; }
  };
}

test('LibraryView maps every top-level collection and Search to a bounded paged endpoint', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  const entityViews = {
    albums: 'album',
    artists: 'artist',
    genres: 'genre',
    folders: 'folder',
    subfolders: 'subfolder',
    playlists: 'playlist'
  };
  for (const [currentView, entityType] of Object.entries(entityViews)) {
    view.currentView = currentView;
    view.detail = null;
    view.searchQuery = '';
    assert.deepEqual(view.getPagedQuery(), {
      endpoint: 'entities',
      entityType,
      query: '',
      sort: 'name',
      direction: view.sortDirection,
      scope: null
    });
  }
  view.currentView = 'tracks';
  assert.equal(view.getPagedQuery().endpoint, 'tracks');
  view.searchQuery = 'needle';
  assert.deepEqual(view.getPagedQuery(), {
    endpoint: 'tracks',
    query: 'needle',
    sort: view.sort,
    direction: view.sortDirection,
    scope: null
  });
  assert.ok(PAGED_RENDERED_ROW_LIMIT < 500);
});

test('Add to Playlist targets carry the repository playlist version', () => {
  assert.deepEqual(getPagedPlaylistTarget({ playlistId: 'playlist-1', name: 'One', version: 7 }), {
    accepted: true,
    target: { playlistId: 'playlist-1', name: 'One' },
    expectedTargetVersion: 7
  });
  assert.deepEqual(getPagedPlaylistTarget({ playlistId: 'playlist-1', name: 'One' }), {
    accepted: false,
    reason: 'playlist-version-unavailable'
  });
});

test('LibraryView invalidates old paged rows before a replacement first page commits', () => {
  const rows = Array.from({ length: 3 }, () => ({
    inert: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  }));
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.content = { querySelectorAll: () => rows };
  view.markPagedRowsInert();
  assert.equal(rows.every(row => row.inert), true);
  assert.equal(rows.every(row => row.attributes['aria-hidden'] === 'true'), true);
  assert.equal(rows.every(row => row.attributes['aria-disabled'] === 'true'), true);
});

test('LibraryView row dispatcher sends only the current generation and attempt', () => {
  const calls = [];
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.pagedController = {
    dispatchRowAction(identity, callback) {
      calls.push(identity);
      return identity.queryGeneration === 4 && identity.pageAttemptId === 2
        ? { accepted: true, value: callback() }
        : { accepted: false, reason: 'inactive-page' };
    }
  };
  const current = {
    dataset: { queryGeneration: '4', pageAttemptId: '2' }
  };
  const stale = {
    dataset: { queryGeneration: '3', pageAttemptId: '2' }
  };
  assert.deepEqual(view.dispatchPagedRowAction(current, () => 'open'), {
    accepted: true,
    value: 'open'
  });
  assert.deepEqual(view.dispatchPagedRowAction(stale, () => 'stale'), {
    accepted: false,
    reason: 'inactive-page'
  });
  assert.deepEqual(calls, [
    { queryGeneration: 4, pageAttemptId: 2 },
    { queryGeneration: 3, pageAttemptId: 2 }
  ]);
});

test('LibraryView detail lookup uses the asynchronous paged manager contract', async () => {
  const manager = createPagedManager();
  manager.getTrack = async trackUid => ({ trackUid, title: 'Paged track' });
  const view = new LibraryView({ manager, uiManager: {} });
  const calls = [];
  view.navigateToView = target => calls.push(['view', target]);
  view.setSelection = selection => calls.push(['selection', selection]);
  view.show = options => calls.push(['show', options]);
  view.scrollTrackIntoView = trackUid => calls.push(['scroll', trackUid]);

  assert.equal(await view.showTrack('track-42'), true);
  assert.deepEqual(calls, [
    ['view', 'tracks'],
    ['show', { focusSearch: false, returnFocus: undefined }],
    ['scroll', 'track-42']
  ]);
});

test('LibraryView paged status awaits counts without a synchronous manager read', async () => {
  const manager = createPagedManager();
  manager.getCounts = async () => ({ tracks: 1_000_001, albums: 40_000 });
  const view = new LibraryView({ manager, uiManager: {} });
  view.status = { innerHTML: '', textContent: '' };
  view.syncContentScrollbarInset = () => {};

  await view.renderPagedStatus();

  assert.match(view.status.innerHTML, /1000001/);
  assert.match(view.status.innerHTML, /40000/);
});

test('first committed page publishes segmented DOM without throwing', async () => {
  const document = {
    activeElement: null,
    createElement: tagName => new PagedDomElement(tagName)
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1200
  };
  await withGlobals({ document, window, requestAnimationFrame: callback => callback() }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = new PagedDomElement('main');
    view.root = new PagedDomElement('section');
    view.currentView = 'tracks';
    view.pagedController = {
      pageLimit: 200,
      firstPage: { isCurrent: (generation, attempt) => generation === 1 && attempt === 1 },
      getCachedRows: () => [{ ordinal: 0, row: { trackUid: 'track-1', title: 'One' } }],
      ensureOrdinal: async () => ({ accepted: true }),
      createAnchor: value => value,
      getSelectionDescriptor: () => ({ mode: 'explicit', contextToken: 'context', trackUids: [] }),
      isSelected: () => false
    };
    view.createPagedActionBar = () => new PagedDomElement('div');
    view.createPagedRow = () => new PagedDomElement('div');
    const state = {
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      rows: [{ trackUid: 'track-1', title: 'One' }],
      totalCount: 1_000_001,
      ariaBusy: false,
      ariaRowCount: 1_000_001,
      currentPageIndex: 0,
      pageStartOrdinal: 0,
      nextCursor: 'next',
      previousCursor: null,
      selectionDescriptor: { mode: 'explicit', contextToken: 'context', trackUids: [] }
    };
    view.pagedState = state;

    assert.doesNotThrow(() => view.renderPagedCommitted(state));
    assert.equal(view.content.attributes.get('aria-busy'), 'false');
    assert.equal(view.content.attributes.get('aria-rowcount'), '1000001');
    assert.equal(view.content.children[0].dataset.pageAttemptId, '1');
  });
});

test('unrelated invalidations preserve the active page, viewport, and selection', () => {
  assert.deepEqual(getPagedInvalidationDecision({
    endpoint: 'tracks',
    scope: null
  }, {
    changedScopes: ['playlist:other']
  }), { restart: false, reason: 'unrelated-scope' });
  assert.deepEqual(getPagedInvalidationDecision({
    endpoint: 'entities',
    entityType: 'folder'
  }, {
    changedScopes: ['tracks']
  }), { restart: false, reason: 'unrelated-scope' });

  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.pagedQueryKey = 'active-query';
  view.pagedViewportOrdinal = 4567;
  view.pagedController = { markSelectionStale: () => assert.fail('selection must remain current') };
  view.renderPagedNav = () => {};
  view.renderPagedStatus = async () => {};
  view.handleCatalogInvalidation({ changedScopes: ['playlist:other'] });

  assert.equal(view.pagedQueryKey, 'active-query');
  assert.equal(view.pagedViewportOrdinal, 4567);
});

test('visible-scope invalidation restarts from an anchor and marks selection stale', () => {
  const calls = [];
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.pagedQueryKey = 'active-query';
  view.capturePagedAnchor = () => calls.push('anchor');
  view.pagedController = { markSelectionStale: () => calls.push('stale') };
  view.scheduleRender = () => calls.push('render');
  view.handleCatalogInvalidation({ changedScopes: ['tracks'] });

  assert.equal(view.pagedQueryKey, null);
  assert.equal(view.pagedRestartPreservesSelection, true);
  assert.deepEqual(calls, ['anchor', 'stale', 'render']);
});

test('paged keyboard navigation leaves native controls alone and uses absolute focus transitions', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.content = { clientHeight: 400 };
  view.pagedState = { phase: 'committed', totalCount: 1_000_000 };
  view.pagedFocusedOrdinal = 40_000;
  const calls = [];
  view.movePagedFocus = (delta, options) => { calls.push(['move', delta, options]); };
  view.activatePagedFocused = () => calls.push(['activate']);
  view.togglePagedFocusedSelection = options => calls.push(['toggle', options]);
  view.getTrackRowHeight = () => 40;
  view.getPagedQuery = () => ({ endpoint: 'tracks' });

  let prevented = 0;
  const native = {
    closest(selector) { return selector.includes('input') ? this : null; }
  };
  view.handleContentKeyDown({ key: 'Home', target: native, preventDefault() { prevented += 1; } });
  assert.equal(prevented, 0);
  assert.deepEqual(calls, []);

  view.handleContentKeyDown({ key: 'PageDown', target: view.content, shiftKey: true, preventDefault() { prevented += 1; } });
  view.handleContentKeyDown({ key: ' ', target: view.content, shiftKey: false, preventDefault() { prevented += 1; } });
  view.handleContentKeyDown({ key: 'Enter', target: view.content, preventDefault() { prevented += 1; } });
  assert.deepEqual(calls, [
    ['move', 10, { extend: true }],
    ['toggle', { extend: false }],
    ['activate']
  ]);
  assert.equal(prevented, 3);
});

test('paged playlist drop forwards the File stream without reading arrayBuffer', async () => {
  const calls = [];
  const file = {
    name: 'million.m3u8',
    stream() {},
    arrayBuffer() { assert.fail('paged drop must not materialize the file'); }
  };
  const manager = createPagedManager();
  manager.playlists = {
    async importFile(value) {
      calls.push(['import', value]);
      return { playlistId: 'playlist-1' };
    }
  };
  const view = new LibraryView({ manager, uiManager: {} });
  view.navigateToDetail = detail => calls.push(['navigate', detail]);
  await view.handlePlaylistFileDrop({
    preventDefault() { calls.push(['prevent']); },
    dataTransfer: { types: ['Files'], files: [file] }
  });

  assert.deepEqual(calls, [
    ['prevent'],
    ['import', file],
    ['navigate', { type: 'playlist', key: 'playlist-1' }]
  ]);
});
