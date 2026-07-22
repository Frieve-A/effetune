import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFolderDirKey,
  decodeFolderDirKey,
  getPagedPlaylistTarget,
  getPagedInvalidationDecision,
  LibraryView,
  PAGED_RENDERED_ROW_LIMIT
} from '../../js/ui/library/library-view.js';
import { LibraryManagerV2 } from '../../js/library/library-manager-v2.js';
import { PagedLibraryViewController } from '../../js/ui/library/paged-view-controller.js';
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
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus(options) {
    this.focused = true;
    this.focusOptions = options;
  }
}

function createPagedManager() {
  return {
    async createContext() { return 'context'; },
    async queryTracks() {},
    async browseFolderChildren() {
      return { children: [], hasMore: false, cursor: null, nodeExists: true };
    },
    async queryEntities() {},
    async releaseContext() {},
    async getCounts() { return {}; },
    async getTrack() { return null; }
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('LibraryView maps every top-level collection and Search to a paged endpoint', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  const entityViews = {
    albums: ['album', 'name', 'asc'],
    artists: ['artist', 'name', 'asc'],
    genres: ['genre', 'name', 'asc'],
    folders: ['folder', 'name', view.sortDirection],
    subfolders: ['subfolder', 'path', 'asc'],
    playlists: ['playlist', 'name', 'asc']
  };
  for (const [currentView, [entityType, sort, direction]] of Object.entries(entityViews)) {
    view.currentView = currentView;
    view.detail = null;
    view.searchQuery = '';
    assert.deepEqual(view.getPagedQuery(), {
      endpoint: 'entities',
      entityType,
      query: '',
      sort,
      direction,
      scope: null,
      ...(entityType === 'playlist' ? { includeSystemPlaylists: true } : {})
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
  view.searchEntityType = 'album';
  assert.deepEqual(view.getPagedQuery(), {
    endpoint: 'entities',
    entityType: 'album',
    query: 'needle',
    sort: 'name',
    direction: 'asc',
    scope: null
  });
  assert.ok(PAGED_RENDERED_ROW_LIMIT < 500);
});

test('folderNode queries switch between direct tree tracks and flat folder tracks without losing path', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.currentView = 'folders';
  view.detail = { type: 'folderNode', folderId: 'folder:one', path: '音楽/Live', title: 'Music' };
  assert.deepEqual(decodeFolderDirKey(createFolderDirKey('folder:one', '音楽/Live')), {
    folderId: 'folder:one', path: '音楽/Live'
  });
  assert.deepEqual(view.getPagedQuery().scope, {
    folderDirKey: createFolderDirKey('folder:one', '音楽/Live')
  });

  view.folderBrowseMode = 'flat';
  assert.deepEqual(view.getPagedQuery().scope, { folderKey: 'folder:one' });
  assert.equal(view.detail.path, '音楽/Live');

  view.folderBrowseMode = 'tree';
  view.searchQuery = 'needle';
  assert.equal(view.getPagedQuery().scope, null);
  assert.equal(view.isFolderTreeBrowse(), false);
  assert.deepEqual(view.detail, {
    type: 'folderNode', folderId: 'folder:one', path: '音楽/Live', title: 'Music'
  });
  view.searchQuery = '';
  assert.equal(view.isFolderTreeBrowse(), true);
  assert.deepEqual(view.getPagedQuery().scope, {
    folderDirKey: createFolderDirKey('folder:one', '音楽/Live')
  });

  assert.deepEqual(view.createEntityDetail('folder', 'folder:one', { displayName: 'Music' }), {
    type: 'folderNode', folderId: 'folder:one', path: '', title: 'Music'
  });
  assert.equal(getPagedInvalidationDecision(view.getPagedQuery(), {
    changedScopes: ['folder:folder:one']
  }).restart, true);
});

test('folder navigation uses canonical root paths, migrates legacy detail, and backs up one level', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.render = () => {};
  view.currentView = 'folders';
  view.applyNavigationSnapshot({
    currentView: 'folders',
    detail: { type: 'folder', key: 'folder-1', title: 'Music' }
  });
  assert.deepEqual(view.detail, {
    type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music'
  });

  view.detail = null;
  view.content = new PagedDomElement('main');
  view.content.scrollTop = 987;
  view.navigateToDetail(
    { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' },
    null,
    { pushHistory: false }
  );
  const collectionReturnSnapshot = view.navigationReturnSnapshot;
  view.navigateToFolderPath('Child');
  assert.equal(view.detail.path, 'Child');
  assert.equal(view.navigationReturnSnapshot, collectionReturnSnapshot);
  view.navigateToFolderPath('Child/Grandchild');
  assert.equal(view.detail.path, 'Child/Grandchild');
  assert.equal(view.navigationReturnSnapshot, collectionReturnSnapshot);
  assert.equal(view.navigateBack({ fromPopState: true }), true);
  assert.equal(view.detail.path, 'Child');
  assert.equal(view.pendingFolderFocusPath, 'Child/Grandchild');
  assert.equal(view.navigateBack({ fromPopState: true }), true);
  assert.equal(view.detail.path, '');
  assert.equal(view.pendingFolderFocusPath, 'Child');
  assert.equal(view.navigateBack({ fromPopState: true }), true);
  assert.equal(view.detail, null);
  assert.equal(view.currentView, 'folders');
  assert.equal(view.pendingPagedNavigationPosition.contentScrollTop, 987);
});

test('the first folder-row activation from a root creates a path without a leading slash', () => {
  return withGlobals({
    document: { createElement: tagName => new PagedDomElement(tagName) }
  }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' };
    view.folderChildrenState = {
      key: 'folder-1\0',
      requestId: view.folderBrowseRequestId,
      intentId: view.navigationIntentId,
      browseGeneration: view.folderBrowseGeneration,
      children: [{ name: 'Child', directTrackCount: 1, recursiveTrackCount: 1 }],
      cursor: null,
      hasMore: false,
      nodeExists: true,
      loading: false,
      error: false
    };
    const section = view.createFolderDirectorySection(0);
    const row = section.children[0].children[0];
    assert.equal(row.tagName, 'BUTTON');
    row.listeners.get('click')();
    assert.equal(view.detail.path, 'Child');
  });
});

test('folder browse requests are suppressed during search and stale responses cannot replace a newer path', async () => {
  await withGlobals({
    document: { createElement: tagName => new PagedDomElement(tagName) }
  }, async () => {
    const requests = [];
    const manager = createPagedManager();
    manager.browseFolderChildren = request => {
      const deferred = createDeferred();
      requests.push({ request, deferred });
      return deferred.promise;
    };
    const view = new LibraryView({ manager, uiManager: {} });
    view.render = () => {};
    view.content = new PagedDomElement('main');
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
    const sectionA = new PagedDomElement('section');
    sectionA.dataset.folderBrowseKey = 'folder-1\0A';

    view.searchQuery = 'needle';
    await view.loadFolderChildren(sectionA, 0);
    assert.equal(requests.length, 0);
    view.searchQuery = '';
    const firstLoad = view.loadFolderChildren(sectionA, 0);
    assert.deepEqual(requests[0].request, { folderId: 'folder-1', path: 'A', limit: 500 });

    view.navigateToFolderPath('B');
    const sectionB = new PagedDomElement('section');
    sectionB.dataset.folderBrowseKey = 'folder-1\0B';
    const secondLoad = view.loadFolderChildren(sectionB, 0);
    requests[0].deferred.resolve({
      children: [{ name: 'Stale', directTrackCount: 1, recursiveTrackCount: 1 }],
      hasMore: false, cursor: null, nodeExists: true
    });
    await firstLoad;
    assert.equal(view.folderChildrenState.key, 'folder-1\0B');
    assert.deepEqual(view.folderChildrenState.children, []);

    requests[1].deferred.resolve({
      children: [{ name: 'Current', directTrackCount: 1, recursiveTrackCount: 1 }],
      hasMore: false, cursor: null, nodeExists: true
    });
    await secondLoad;
    assert.deepEqual(view.folderChildrenState.children.map(child => child.name), ['Current']);
  });
});

test('folder child loading preserves scroll only when the viewport has reached the track grid', async () => {
  const manager = createPagedManager();
  manager.browseFolderChildren = async () => ({
    children: [{ name: 'Child', directTrackCount: 1, recursiveTrackCount: 1 }],
    hasMore: false,
    cursor: null,
    nodeExists: true
  });
  const view = new LibraryView({ manager, uiManager: {} });
  view.currentView = 'folders';
  view.detail = { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' };
  const section = new PagedDomElement('section');
  section.dataset.folderBrowseKey = 'folder-1\0';
  const grid = { offsetTop: 200 };
  view.content = {
    scrollTop: 50,
    querySelector(selector) {
      if (selector === '.library-folder-directory-section') return section;
      if (selector === '.library-paged-grid') return grid;
      return null;
    }
  };
  let refreshCount = 0;
  view.refreshPagedWindow = () => { refreshCount += 1; };
  view.renderFolderDirectorySection = () => {
    if (view.folderChildrenState?.loading === false) grid.offsetTop += 50;
  };

  await view.loadFolderChildren(section, 1);
  assert.equal(view.content.scrollTop, 50);
  assert.equal(refreshCount, 0);

  view.folderChildrenState = null;
  grid.offsetTop = 200;
  view.content.scrollTop = 220;
  await view.loadFolderChildren(section, 1);
  assert.equal(view.content.scrollTop, 270);
  assert.equal(refreshCount, 1);
});

test('folder browse invalidation fences same-path responses and renders only the current live section', async () => {
  const requests = [];
  const manager = createPagedManager();
  manager.browseFolderChildren = () => {
    const deferred = createDeferred();
    requests.push(deferred);
    return deferred.promise;
  };
  const view = new LibraryView({ manager, uiManager: {} });
  view.currentView = 'folders';
  view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
  view.scheduleRender = () => {};
  const originalSection = new PagedDomElement('section');
  originalSection.dataset.folderBrowseKey = 'folder-1\0A';
  let liveSection = originalSection;
  const grid = { offsetTop: 200 };
  view.content = {
    scrollTop: 0,
    querySelector(selector) {
      if (selector === '.library-folder-directory-section') return liveSection;
      if (selector === '.library-paged-grid') return grid;
      return null;
    }
  };
  const renderedSections = [];
  view.renderFolderDirectorySection = section => renderedSections.push(section);

  const staleLoad = view.loadFolderChildren(originalSection, 1);
  view.handleCatalogInvalidation({ changedScopes: ['folder:folder-1'] });
  requests[0].resolve({
    children: [{ name: 'Stale', directTrackCount: 1, recursiveTrackCount: 1 }],
    hasMore: false,
    cursor: null,
    nodeExists: true
  });
  await staleLoad;
  assert.equal(view.folderChildrenState, null);

  const detachedSection = new PagedDomElement('section');
  detachedSection.dataset.folderBrowseKey = 'folder-1\0A';
  liveSection = detachedSection;
  const currentLoad = view.loadFolderChildren(detachedSection, 1);
  renderedSections.length = 0;
  detachedSection.isConnected = false;
  const replacementSection = new PagedDomElement('section');
  replacementSection.dataset.folderBrowseKey = 'folder-1\0A';
  liveSection = replacementSection;
  requests[1].resolve({
    children: [{ name: 'Current', directTrackCount: 1, recursiveTrackCount: 1 }],
    hasMore: false,
    cursor: null,
    nodeExists: true
  });
  await currentLoad;
  assert.deepEqual(view.folderChildrenState.children.map(child => child.name), ['Current']);
  assert.deepEqual(renderedSections, [replacementSection]);
});

test('folder browse state expires with its navigation intent and the same path reloads', async () => {
  await withGlobals({
    document: { createElement: tagName => new PagedDomElement(tagName) }
  }, async () => {
    const requests = [];
    const manager = createPagedManager();
    manager.browseFolderChildren = () => {
      const deferred = createDeferred();
      requests.push(deferred);
      return deferred.promise;
    };
    const view = new LibraryView({ manager, uiManager: {} });
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
    view.content = { querySelector() { return null; } };
    view.renderFolderDirectorySection = () => {};
    const section = new PagedDomElement('section');
    section.dataset.folderBrowseKey = 'folder-1\0A';

    const staleLoad = view.loadFolderChildren(section, 0);
    assert.equal(view.folderChildrenState.loading, true);
    view.beginNavigationIntent();
    assert.equal(view.folderChildrenState, null);
    requests[0].resolve({
      children: [{ name: 'Stale', directTrackCount: 1, recursiveTrackCount: 1 }],
      hasMore: false, cursor: null, nodeExists: true
    });
    await staleLoad;
    assert.equal(view.folderChildrenState, null);

    view.createFolderDirectorySection(0);
    assert.equal(requests.length, 2);
    requests[1].resolve({
      children: [{ name: 'Fresh', directTrackCount: 1, recursiveTrackCount: 1 }],
      hasMore: false, cursor: null, nodeExists: true
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(view.folderChildrenState.children.map(child => child.name), ['Fresh']);
    assert.ok(view.getCurrentFolderChildrenState('folder-1\0A'));

    view.invalidateNavigationIntent();
    assert.equal(view.getCurrentFolderChildrenState('folder-1\0A'), null);
    view.createFolderDirectorySection(0);
    assert.equal(requests.length, 3);
    requests[2].resolve({ children: [], hasMore: false, cursor: null, nodeExists: true });
    await Promise.resolve();
    await Promise.resolve();
  });
});

test('folder ancestor jumps restore the target position and focus its descended child row', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.render = () => {};
  view.currentView = 'folders';
  view.detail = { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' };
  view.content = new PagedDomElement('main');

  view.content.scrollTop = 100;
  view.navigateToFolderPath('Child');
  view.content.scrollTop = 200;
  view.navigateToFolderPath('Child/Grandchild');
  view.content.scrollTop = 300;
  view.navigateToFolderPath('');

  assert.equal(view.detail.path, '');
  assert.equal(view.pendingPagedNavigationPosition.contentScrollTop, 100);
  assert.equal(view.pendingFolderFocusPath, 'Child');

  view.content.scrollTop = 100;
  view.navigateToFolderPath('Child');
  assert.equal(view.pendingPagedNavigationPosition.contentScrollTop, 200);
  assert.equal(view.pendingFolderFocusPath, null);
});

test('folder Back restores loaded parent pages and focuses a child only after its section is live', async () => {
  const document = {
    body: { classList: { contains: () => false } },
    createElement: tagName => new PagedDomElement(tagName),
    activeElement: null
  };
  await withGlobals({ document }, () => {
    let browseCalls = 0;
    const manager = createPagedManager();
    manager.browseFolderChildren = async () => {
      browseCalls += 1;
      return { children: [], hasMore: false, cursor: null, nodeExists: true };
    };
    const view = new LibraryView({ manager, uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' };
    view.content = new PagedDomElement('main');
    view.content.scrollTop = 640;
    view.folderChildrenState = {
      key: 'folder-1\0',
      requestId: view.folderBrowseRequestId,
      intentId: view.navigationIntentId,
      browseGeneration: view.folderBrowseGeneration,
      children: [
        { name: 'First', directTrackCount: 1, recursiveTrackCount: 1 },
        { name: 'OutsideFirstPage', directTrackCount: 1, recursiveTrackCount: 1 }
      ],
      cursor: 'OutsideFirstPage',
      hasMore: true,
      nodeExists: true,
      loading: false,
      error: false
    };

    view.navigateToFolderPath('OutsideFirstPage', { pushHistory: false });
    assert.equal(view.detail.path, 'OutsideFirstPage');
    view.navigateBack({ fromPopState: true });

    const restored = view.getCurrentFolderChildrenState('folder-1\0');
    assert.deepEqual(restored.children.map(child => child.name), ['First', 'OutsideFirstPage']);
    assert.equal(restored.cursor, 'OutsideFirstPage');
    assert.equal(restored.hasMore, true);
    assert.equal(view.pendingPagedNavigationPosition.contentScrollTop, 640);
    assert.equal(view.pendingFolderFocusPath, 'OutsideFirstPage');

    const section = new PagedDomElement('section');
    section.dataset.folderBrowseKey = 'folder-1\0';
    section.querySelectorAll = selector => selector === '.library-folder-directory-row'
      ? section.children.flatMap(child => child.children || [])
        .filter(child => child.className === 'library-folder-directory-row')
      : [];
    view.renderFolderDirectorySection(section, 0);
    const focused = section.querySelectorAll('.library-folder-directory-row')
      .find(row => row.dataset.folderPath === 'OutsideFirstPage');
    focused.focus = options => {
      focused.focused = true;
      focused.focusOptions = options;
      document.activeElement = focused;
    };
    assert.equal(focused.focused, undefined);
    assert.equal(view.pendingFolderFocusPath, 'OutsideFirstPage');
    view.content.querySelector = selector => (
      selector === '.library-folder-directory-section' ? section : null
    );
    assert.equal(view.focusPendingFolderRow(section), true);
    assert.equal(focused.focused, true);
    assert.deepEqual(focused.focusOptions, { preventScroll: true });
    assert.equal(view.pendingFolderFocusPath, null);
    assert.equal(browseCalls, 0);
  });
});

test('mobile folder popstate restores cached pages without copying them into History state', async () => {
  const document = {
    body: { classList: { contains: name => name === 'layout-mobile' || name === 'view-library' } },
    createElement: tagName => new PagedDomElement(tagName),
    activeElement: null
  };
  const history = { state: null, replaceState() {}, pushState() {} };
  await withGlobals({ document, history }, () => {
    let browseCalls = 0;
    const manager = createPagedManager();
    manager.browseFolderChildren = async () => {
      browseCalls += 1;
      return { children: [], hasMore: false, cursor: null, nodeExists: true };
    };
    const view = new LibraryView({ manager, uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'Child-500', title: 'Music' };
    const children = Array.from({ length: 501 }, (_, index) => ({
      name: `Child-${String(index).padStart(3, '0')}`,
      directTrackCount: 1,
      recursiveTrackCount: 1
    }));
    const parentKey = 'folder-1\0';
    view.folderNavigationPositions.set(parentKey, {
      currentView: 'folders',
      detail: { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' },
      pagedPosition: { contentScrollTop: 720 },
      folderBrowseState: {
        key: parentKey,
        browseGeneration: view.folderBrowseGeneration,
        children,
        cursor: 'Child-500',
        hasMore: true,
        nodeExists: true
      }
    });
    const state = {
      effetuneLibrary: true,
      index: 0,
      depth: 0,
      snapshot: {
        currentView: 'folders',
        detail: { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' },
        searchQuery: '',
        pagedPosition: { contentScrollTop: 720 }
      }
    };

    view.handleMobilePopState({ state });

    const restored = view.getCurrentFolderChildrenState(parentKey);
    assert.equal(restored.children.length, 501);
    assert.equal(restored.children.at(-1).name, 'Child-500');
    assert.equal(restored.hasMore, true);
    assert.equal(view.pendingFolderFocusPath, 'Child-500');
    assert.equal(browseCalls, 0);
    assert.equal(JSON.stringify(state).includes('folderBrowseState'), false);
    assert.equal(Object.hasOwn(view.getNavigationSnapshot(), 'folderBrowseState'), false);

    const section = new PagedDomElement('section');
    section.dataset.folderBrowseKey = parentKey;
    section.querySelectorAll = selector => selector === '.library-folder-directory-row'
      ? section.children.flatMap(child => child.children || [])
        .filter(child => child.className === 'library-folder-directory-row')
      : [];
    view.content = {
      scrollTop: 0,
      querySelector: selector => selector === '.library-folder-directory-section' ? section : null
    };
    view.renderFolderDirectorySection(section, 0);
    const focusTarget = section.querySelectorAll('.library-folder-directory-row').at(-1);
    focusTarget.focus = options => {
      focusTarget.focusOptions = options;
      document.activeElement = focusTarget;
    };
    assert.equal(view.focusPendingFolderRow(section), true);
    assert.deepEqual(focusTarget.focusOptions, { preventScroll: true });
    assert.equal(view.pendingFolderFocusPath, null);
  });
});

test('folder append keeps the live More button mounted and busy until the request settles', async () => {
  const deferred = createDeferred();
  const manager = createPagedManager();
  manager.browseFolderChildren = () => deferred.promise;
  const view = new LibraryView({ manager, uiManager: {} });
  view.currentView = 'folders';
  view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
  const more = new PagedDomElement('button');
  const section = new PagedDomElement('section');
  section.dataset.folderBrowseKey = 'folder-1\0A';
  section.querySelector = selector => selector === '.library-folder-directory-more' ? more : null;
  view.content = {
    scrollTop: 0,
    querySelector(selector) {
      return selector === '.library-folder-directory-section' ? section : null;
    }
  };
  view.folderChildrenState = {
    key: 'folder-1\0A',
    requestId: view.folderBrowseRequestId,
    intentId: view.navigationIntentId,
    browseGeneration: view.folderBrowseGeneration,
    children: [{ name: 'First', directTrackCount: 1, recursiveTrackCount: 1 }],
    cursor: 'First',
    hasMore: true,
    nodeExists: true,
    loading: false,
    error: false
  };
  const rendered = [];
  view.renderFolderDirectorySection = target => rendered.push(target);

  const load = view.loadFolderChildren(section, 1, { append: true });
  assert.deepEqual(rendered, []);
  assert.notEqual(more.disabled, true);
  assert.equal(more.attributes.get('aria-disabled'), 'true');
  assert.equal(more.attributes.get('aria-busy'), 'true');

  deferred.resolve({
    children: [{ name: 'Second', directTrackCount: 1, recursiveTrackCount: 1 }],
    hasMore: false, cursor: null, nodeExists: true
  });
  await load;
  assert.deepEqual(view.folderChildrenState.children.map(child => child.name), ['First', 'Second']);
  assert.deepEqual(rendered, [section]);
});

test('More forwards focus intent only for keyboard activation and guards busy clicks', () => {
  const document = {
    activeElement: null,
    createElement: tagName => new PagedDomElement(tagName)
  };
  return withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
    view.folderChildrenState = {
      key: 'folder-1\0A',
      requestId: view.folderBrowseRequestId,
      intentId: view.navigationIntentId,
      browseGeneration: view.folderBrowseGeneration,
      children: [{ name: 'First', directTrackCount: 1, recursiveTrackCount: 1 }],
      cursor: 'First', hasMore: true, nodeExists: true, loading: false, error: false
    };
    const section = new PagedDomElement('section');
    section.dataset.folderBrowseKey = 'folder-1\0A';
    const calls = [];
    view.loadFolderChildren = (_section, _count, options) => { calls.push(options); };
    view.renderFolderDirectorySection(section, 1);
    const more = section.children.at(-1);
    document.activeElement = more;

    more.listeners.get('click')({ detail: 1 });
    more.listeners.get('click')({ detail: 0 });
    assert.deepEqual(calls, [
      { append: true, preserveFocus: false },
      { append: true, preserveFocus: true }
    ]);

    view.folderChildrenState.loading = true;
    let prevented = 0;
    more.listeners.get('click')({ detail: 0, preventDefault() { prevented += 1; } });
    assert.equal(prevented, 1);
    assert.equal(calls.length, 2);
  });
});

test('keyboard More append keeps focus during loading and hands it to the first appended row', async () => {
  const deferred = createDeferred();
  const manager = createPagedManager();
  let browseCalls = 0;
  manager.browseFolderChildren = () => {
    browseCalls += 1;
    return deferred.promise;
  };
  const document = { activeElement: null };
  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager, uiManager: {} });
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
    const more = new PagedDomElement('button');
    const existingRow = new PagedDomElement('button');
    existingRow.className = 'library-folder-directory-row';
    let currentMore = more;
    let rows = [existingRow];
    const section = new PagedDomElement('section');
    section.dataset.folderBrowseKey = 'folder-1\0A';
    section.querySelector = selector => {
      if (selector === '.library-folder-directory-more') return currentMore;
      return null;
    };
    section.querySelectorAll = selector => selector === '.library-folder-directory-row' ? rows : [];
    view.content = {
      scrollTop: 0,
      querySelector(selector) {
        return selector === '.library-folder-directory-section' ? section : null;
      }
    };
    view.folderChildrenState = {
      key: 'folder-1\0A',
      requestId: view.folderBrowseRequestId,
      intentId: view.navigationIntentId,
      browseGeneration: view.folderBrowseGeneration,
      children: [{ name: 'First', directTrackCount: 1, recursiveTrackCount: 1 }],
      cursor: 'First',
      hasMore: true,
      nodeExists: true,
      loading: false,
      error: false
    };
    let appendedRow = null;
    view.renderFolderDirectorySection = () => {
      more.isConnected = false;
      currentMore = null;
      appendedRow = new PagedDomElement('button');
      appendedRow.className = 'library-folder-directory-row';
      appendedRow.focus = options => {
        appendedRow.focusOptions = options;
        document.activeElement = appendedRow;
      };
      rows = [existingRow, appendedRow];
    };
    document.activeElement = more;

    const load = view.loadFolderChildren(section, 1, { append: true, preserveFocus: true });
    await view.loadFolderChildren(section, 1, { append: true, preserveFocus: true });
    assert.equal(browseCalls, 1);
    assert.notEqual(more.disabled, true);
    assert.equal(more.attributes.get('aria-disabled'), 'true');
    assert.equal(document.activeElement, more);

    deferred.resolve({
      children: [{ name: 'Second', directTrackCount: 1, recursiveTrackCount: 1 }],
      hasMore: false, cursor: null, nodeExists: true
    });
    await load;
    assert.equal(document.activeElement, appendedRow);
    assert.deepEqual(appendedRow.focusOptions, { preventScroll: true });
  });
});

test('failed keyboard More append hands focus to the live Retry control', async () => {
  const manager = createPagedManager();
  manager.browseFolderChildren = async () => {
    throw new Error('expected append failure');
  };
  const document = { activeElement: null };
  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager, uiManager: {} });
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
    const more = new PagedDomElement('button');
    let retry = null;
    const section = new PagedDomElement('section');
    section.dataset.folderBrowseKey = 'folder-1\0A';
    section.querySelector = selector => {
      if (selector === '.library-folder-directory-more') return retry ? null : more;
      if (selector === '.library-folder-directory-retry') return retry;
      return null;
    };
    view.content = {
      querySelector(selector) {
        return selector === '.library-folder-directory-section' ? section : null;
      }
    };
    view.folderChildrenState = {
      key: 'folder-1\0A',
      requestId: view.folderBrowseRequestId,
      intentId: view.navigationIntentId,
      browseGeneration: view.folderBrowseGeneration,
      children: [{ name: 'First', directTrackCount: 1, recursiveTrackCount: 1 }],
      cursor: 'First',
      hasMore: true,
      nodeExists: true,
      loading: false,
      error: false
    };
    view.renderFolderDirectorySection = () => {
      more.isConnected = false;
      retry = new PagedDomElement('button');
      retry.focus = options => {
        retry.focusOptions = options;
        document.activeElement = retry;
      };
    };
    document.activeElement = more;

    await view.loadFolderChildren(section, 1, { append: true, preserveFocus: true });
    assert.equal(document.activeElement, retry);
    assert.deepEqual(retry.focusOptions, { preventScroll: true });
  });
});

test('pointer and detached More appends never hand focus to replacement content', async () => {
  const document = { activeElement: null };
  await withGlobals({ document }, async () => {
    for (const { preserveFocus, moreConnected } of [
      { preserveFocus: false, moreConnected: true },
      { preserveFocus: true, moreConnected: false }
    ]) {
      const manager = createPagedManager();
      const view = new LibraryView({ manager, uiManager: {} });
      view.currentView = 'folders';
      view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
      const more = new PagedDomElement('button');
      more.isConnected = moreConnected;
      const successor = new PagedDomElement('button');
      successor.className = 'library-folder-directory-row';
      successor.focus = () => { successor.focused = true; };
      let rows = [];
      const section = new PagedDomElement('section');
      section.dataset.folderBrowseKey = 'folder-1\0A';
      section.querySelector = selector => selector === '.library-folder-directory-more' ? more : null;
      section.querySelectorAll = selector => selector === '.library-folder-directory-row' ? rows : [];
      view.content = {
        querySelector(selector) {
          return selector === '.library-folder-directory-section' ? section : null;
        }
      };
      view.folderChildrenState = {
        key: 'folder-1\0A',
        requestId: view.folderBrowseRequestId,
        intentId: view.navigationIntentId,
        browseGeneration: view.folderBrowseGeneration,
        children: [], cursor: null, hasMore: true, nodeExists: true, loading: false, error: false
      };
      view.renderFolderDirectorySection = () => { rows = [successor]; };
      document.activeElement = more;

      await view.loadFolderChildren(section, 0, { append: true, preserveFocus });
      assert.notEqual(successor.focused, true);
    }
  });
});

test('append failure keeps existing rows and its Retry preserves activation modality and busy guard', () => {
  const document = {
    activeElement: null,
    createElement: tagName => new PagedDomElement(tagName)
  };
  return withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
    view.folderChildrenState = {
      key: 'folder-1\0A',
      requestId: view.folderBrowseRequestId,
      intentId: view.navigationIntentId,
      browseGeneration: view.folderBrowseGeneration,
      children: [{ name: 'First', directTrackCount: 1, recursiveTrackCount: 1 }],
      cursor: 'First', hasMore: true, nodeExists: true, loading: false, error: true
    };
    const calls = [];
    view.loadFolderChildren = (_section, _count, options) => { calls.push(options); };
    const section = new PagedDomElement('section');
    section.dataset.folderBrowseKey = 'folder-1\0A';

    view.renderFolderDirectorySection(section, 1);
    const list = section.children[0];
    const failure = section.children[1];
    const retry = failure.children[1];
    assert.equal(list.className, 'library-folder-directory-list');
    assert.equal(list.children[0].dataset.folderPath, 'A/First');
    assert.match(failure.className, /library-folder-directory-append-error/);

    retry.listeners.get('click')({ detail: 1 });
    retry.listeners.get('click')({ detail: 0 });
    assert.deepEqual(calls, [
      { append: true, preserveFocus: false },
      { append: true, preserveFocus: true }
    ]);
    view.folderChildrenState.loading = true;
    let prevented = 0;
    retry.listeners.get('click')({ detail: 0, preventDefault() { prevented += 1; } });
    assert.equal(prevented, 1);
    assert.equal(calls.length, 2);

    view.folderChildrenState = {
      ...view.folderChildrenState,
      children: [], loading: false, error: true
    };
    const initialFailureSection = new PagedDomElement('section');
    initialFailureSection.dataset.folderBrowseKey = 'folder-1\0A';
    view.renderFolderDirectorySection(initialFailureSection, 0);
    assert.equal(initialFailureSection.children.length, 1);
    assert.doesNotMatch(initialFailureSection.children[0].className, /append-error/);
  });
});

test('append Retry hands keyboard focus through success and repeated failure without pointer focus theft', async () => {
  const document = { activeElement: null };
  await withGlobals({ document }, async () => {
    const run = async ({ preserveFocus, reject }) => {
      const manager = createPagedManager();
      manager.browseFolderChildren = async () => {
        if (reject) throw new Error('expected retry failure');
        return {
          children: [{ name: 'Second', directTrackCount: 1, recursiveTrackCount: 1 }],
          hasMore: false, cursor: null, nodeExists: true
        };
      };
      const view = new LibraryView({ manager, uiManager: {} });
      view.currentView = 'folders';
      view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
      view.folderChildrenState = {
        key: 'folder-1\0A',
        requestId: view.folderBrowseRequestId,
        intentId: view.navigationIntentId,
        browseGeneration: view.folderBrowseGeneration,
        children: [{ name: 'First', directTrackCount: 1, recursiveTrackCount: 1 }],
        cursor: 'First', hasMore: true, nodeExists: true, loading: false, error: true
      };
      const existingRow = new PagedDomElement('button');
      const retry = new PagedDomElement('button');
      let liveRetry = retry;
      let rows = [existingRow];
      let successor = null;
      const section = new PagedDomElement('section');
      section.dataset.folderBrowseKey = 'folder-1\0A';
      section.querySelector = selector => {
        if (selector === '.library-folder-directory-retry') return liveRetry;
        return null;
      };
      section.querySelectorAll = selector => selector === '.library-folder-directory-row' ? rows : [];
      view.content = {
        querySelector(selector) {
          return selector === '.library-folder-directory-section' ? section : null;
        }
      };
      view.renderFolderDirectorySection = () => {
        retry.isConnected = false;
        if (view.folderChildrenState.error) {
          successor = new PagedDomElement('button');
          successor.className = 'library-folder-directory-retry';
          liveRetry = successor;
        } else {
          successor = new PagedDomElement('button');
          successor.className = 'library-folder-directory-row';
          rows = [existingRow, successor];
          liveRetry = null;
        }
        successor.focus = options => {
          successor.focusOptions = options;
          document.activeElement = successor;
        };
        return false;
      };
      document.activeElement = retry;

      await view.loadFolderChildren(section, 1, { append: true, preserveFocus });
      return { retry, successor };
    };

    const succeeded = await run({ preserveFocus: true, reject: false });
    assert.equal(document.activeElement, succeeded.successor);
    assert.deepEqual(succeeded.successor.focusOptions, { preventScroll: true });

    const failed = await run({ preserveFocus: true, reject: true });
    assert.equal(document.activeElement, failed.successor);
    assert.equal(failed.successor.className, 'library-folder-directory-retry');
    assert.deepEqual(failed.successor.focusOptions, { preventScroll: true });

    const pointer = await run({ preserveFocus: false, reject: false });
    assert.notEqual(document.activeElement, pointer.successor);
    assert.equal(pointer.successor.focusOptions, undefined);
  });
});

test('Back pending child focus wins over generic keyboard append focus', async () => {
  const document = { activeElement: null };
  await withGlobals({ document }, async () => {
    const manager = createPagedManager();
    manager.browseFolderChildren = async () => ({
      children: [
        { name: 'Second', directTrackCount: 1, recursiveTrackCount: 1 },
        { name: 'Third', directTrackCount: 1, recursiveTrackCount: 1 }
      ],
      hasMore: false, cursor: null, nodeExists: true
    });
    const view = new LibraryView({ manager, uiManager: {} });
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' };
    view.pendingFolderFocusPath = 'A/Third';
    view.pendingFolderFocusFolderId = 'folder-1';
    view.folderChildrenState = {
      key: 'folder-1\0A',
      requestId: view.folderBrowseRequestId,
      intentId: view.navigationIntentId,
      browseGeneration: view.folderBrowseGeneration,
      children: [{ name: 'First', directTrackCount: 1, recursiveTrackCount: 1 }],
      cursor: 'First', hasMore: true, nodeExists: true, loading: false, error: false
    };
    const more = new PagedDomElement('button');
    let rows = [];
    const section = new PagedDomElement('section');
    section.dataset.folderBrowseKey = 'folder-1\0A';
    section.querySelector = selector => selector === '.library-folder-directory-more' ? more : null;
    section.querySelectorAll = selector => selector === '.library-folder-directory-row' ? rows : [];
    view.content = {
      querySelector(selector) {
        return selector === '.library-folder-directory-section' ? section : null;
      }
    };
    let second = null;
    let third = null;
    view.renderFolderDirectorySection = target => {
      more.isConnected = false;
      second = new PagedDomElement('button');
      second.className = 'library-folder-directory-row';
      second.dataset.folderPath = 'A/Second';
      second.focus = options => {
        second.focusOptions = options;
        document.activeElement = second;
      };
      third = new PagedDomElement('button');
      third.className = 'library-folder-directory-row';
      third.dataset.folderPath = 'A/Third';
      third.focus = options => {
        third.focusOptions = options;
        document.activeElement = third;
      };
      rows = [new PagedDomElement('button'), second, third];
      return view.focusPendingFolderRow(target);
    };
    document.activeElement = more;

    await view.loadFolderChildren(section, 1, { append: true, preserveFocus: true });
    assert.equal(document.activeElement, third);
    assert.deepEqual(third.focusOptions, { preventScroll: true });
    assert.equal(second.focusOptions, undefined);
    assert.equal(view.pendingFolderFocusPath, null);
  });
});

test('folder search clears before every back path and mobile parent pop restores child focus', async () => {
  const historyCalls = [];
  const history = {
    state: null,
    backCount: 0,
    back() { this.backCount += 1; },
    replaceState(state) { this.state = state; historyCalls.push(['replace', state]); },
    pushState(state) { this.state = state; historyCalls.push(['push', state]); }
  };
  const body = {
    classList: {
      contains: name => name === 'layout-mobile' || name === 'view-library'
    }
  };
  await withGlobals({ document: { body }, history }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A/B', title: 'Music' };
    view.searchQuery = 'needle';
    view.searchInput = { value: 'needle' };
    view.mobileHistoryDepth = 2;
    view.mobileHistoryIndex = 2;

    let prevented = 0;
    view.handleContentKeyDown({
      key: 'Backspace',
      target: null,
      preventDefault() { prevented += 1; }
    });
    assert.equal(prevented, 1);
    assert.equal(view.detail.path, 'A/B');
    assert.equal(view.searchQuery, '');
    assert.equal(history.backCount, 0);

    view.searchQuery = 'needle';
    view.searchInput.value = 'needle';
    assert.equal(view.navigateBack(), true);
    assert.equal(view.detail.path, 'A/B');
    assert.equal(view.searchQuery, '');
    assert.equal(history.backCount, 0);

    view.searchQuery = 'needle';
    view.searchInput.value = 'needle';
    view.handleMobilePopState({
      state: {
        effetuneLibrary: true,
        index: 1,
        depth: 1,
        snapshot: {
          currentView: 'folders',
          detail: { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' },
          searchQuery: ''
        }
      }
    });
    assert.equal(view.detail.path, 'A/B');
    assert.equal(view.searchQuery, '');
    assert.equal(view.mobileHistoryIndex, 2);
    assert.equal(view.mobileHistoryDepth, 2);
    assert.equal(historyCalls.at(-1)[0], 'push');
    assert.equal(historyCalls.at(-1)[1].snapshot.detail.path, 'A/B');

    view.handleMobilePopState({
      state: {
        effetuneLibrary: true,
        index: 1,
        depth: 1,
        snapshot: {
          currentView: 'folders',
          detail: { type: 'folderNode', folderId: 'folder-1', path: 'A', title: 'Music' },
          searchQuery: ''
        }
      }
    });
    assert.equal(view.detail.path, 'A');
    assert.equal(view.pendingFolderFocusPath, 'A/B');
  });
});

test('missing folder nodes use an existing mobile parent entry or replace the current snapshot', async () => {
  const historyCalls = [];
  const history = {
    state: { effetuneLibrary: true, index: 0, depth: 0, snapshot: null },
    backCount: 0,
    pushCount: 0,
    back() { this.backCount += 1; },
    pushState() { this.pushCount += 1; },
    replaceState(state) { this.state = state; historyCalls.push(state); }
  };
  const body = {
    classList: {
      contains: name => name === 'layout-mobile' || name === 'view-library'
    }
  };
  await withGlobals({ document: { body }, history }, async () => {
    const manager = createPagedManager();
    manager.browseFolderChildren = async () => ({
      children: [], hasMore: false, cursor: null, nodeExists: false
    });
    const view = new LibraryView({ manager, uiManager: {} });
    view.render = () => {};
    view.renderFolderDirectorySection = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A/B', title: 'Music' };
    view.mobileHistoryDepth = 1;
    await view.loadFolderChildren(new PagedDomElement('section'), 0);
    assert.equal(history.backCount, 1);
    assert.equal(view.detail.path, 'A/B');

    view.mobileHistoryDepth = 0;
    await view.loadFolderChildren(new PagedDomElement('section'), 0);
    assert.equal(history.backCount, 1);
    assert.equal(view.detail.path, 'A');
    assert.equal(history.pushCount, 0);
    assert.equal(historyCalls.at(-1).snapshot.detail.path, 'A');
  });
});

test('artwork collections and playlists expose and retain their database sort orders', async () => {
  const storage = new Map();
  const document = { createElement: tagName => new PagedDomElement(tagName) };
  await withGlobals({
    document,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    }
  }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    let renders = 0;
    view.render = () => { renders += 1; };
    view.currentView = 'albums';

    const expectedOptions = {
      album: [
        'name:asc', 'name:desc', 'artist:asc', 'artist:desc',
        'year:asc', 'year:desc',
        'trackCount:asc', 'trackCount:desc', 'duration:asc', 'duration:desc'
      ],
      artist: [
        'name:asc', 'name:desc', 'trackCount:asc', 'trackCount:desc',
        'duration:asc', 'duration:desc'
      ],
      genre: [
        'name:asc', 'name:desc', 'trackCount:asc', 'trackCount:desc',
        'duration:asc', 'duration:desc'
      ],
      subfolder: [
        'path:asc', 'path:desc', 'name:asc', 'name:desc',
        'trackCount:asc', 'trackCount:desc', 'duration:asc', 'duration:desc'
      ],
      playlist: [
        'name:asc', 'name:desc', 'updated:asc', 'updated:desc',
        'created:asc', 'created:desc'
      ]
    };
    for (const [entityType, values] of Object.entries(expectedOptions)) {
      const entitySelect = view.createEntitySortControl(entityType).children[1];
      assert.deepEqual(entitySelect.children.map(option => option.value), values);
    }

    const control = view.createEntitySortControl('album');
    const select = control.children[1];
    select.value = 'trackCount:desc';
    select.listeners.get('change')({ currentTarget: select });
    assert.equal(renders, 1);
    assert.deepEqual(view.getPagedQuery(), {
      endpoint: 'entities', entityType: 'album', query: '',
      sort: 'trackCount', direction: 'desc', scope: null
    });

    view.currentView = 'artists';
    assert.deepEqual(view.getEntitySort('artist'), { sort: 'name', direction: 'asc' });
    view.searchQuery = 'needle';
    view.searchEntityType = 'album';
    assert.equal(view.getPagedQuery().sort, 'trackCount');
    assert.equal(view.getPagedQuery().direction, 'desc');
    assert.equal(view.applyEntitySort('album', 'unsupported:asc'), false);

    const stored = JSON.parse([...storage.values()][0]);
    assert.deepEqual(stored.entitySorts.album, { sort: 'trackCount', direction: 'desc' });

    view.searchQuery = '';
    view.searchEntityType = null;
    view.currentView = 'playlists';
    const header = view.createPagedSectionHeader({ rows: [] }, 3, false);
    assert.match(header.className, /library-section-head-sortable/);
    const playlistSelect = header.children.at(-1).children[1];
    assert.deepEqual(playlistSelect.children.map(option => option.value), expectedOptions.playlist);
  });
});

test('detail navigation normalizes every entity type back to its plural collection', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.render = () => {};
  for (const [type, collection] of [
    ['album', 'albums'],
    ['artist', 'artists'],
    ['genre', 'genres'],
    ['subfolder', 'subfolders'],
    ['folder', 'folders'],
    ['playlist', 'playlists']
  ]) {
    view.currentView = 'tracks';
    view.navigateToDetail({ type, key: `${type}-1` }, null, { pushHistory: false });
    assert.equal(view.currentView, collection);
    assert.equal(view.navigateBack(), true);
    assert.equal(view.currentView, collection);
    assert.equal(view.detail, null);
  }
});

test('detail navigation retains each artwork collection scroll position for Back', () => {
  for (const [type, collection] of [
    ['album', 'albums'],
    ['artist', 'artists'],
    ['genre', 'genres'],
    ['subfolder', 'subfolders'],
    ['playlist', 'playlists']
  ]) {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = collection;
    view.content = { scrollTop: 4_321 };
    view.pagedState = { phase: 'committed' };
    view.pagedQueryKey = JSON.stringify(view.getPagedQuery());
    view.pagedViewportOrdinal = 120;
    view.pagedViewportOffsetPx = -18;
    view.pagedAnchor = {
      queryFingerprint: view.pagedQueryKey,
      entityId: `${type}-120`,
      canonicalTuple: [`${type}-120`],
      viewportOffsetPx: -18,
      focusKey: null
    };
    view.capturePagedAnchor = () => view.pagedAnchor;

    view.navigateToDetail({ type, key: `${type}-120` }, null, { pushHistory: false });
    view.content.scrollTop = 0;
    view.pagedAnchor = { queryFingerprint: 'detail-query', entityId: 'track-1' };

    assert.equal(view.navigateBack(), true);
    assert.deepEqual(view.pendingPagedNavigationPosition, {
      queryFingerprint: view.pagedQueryKey,
      anchor: {
        queryFingerprint: view.pagedQueryKey,
        entityId: `${type}-120`,
        canonicalTuple: [`${type}-120`],
        viewportOffsetPx: -18,
        focusKey: null
      },
      viewportOrdinal: 120,
      viewportOffsetPx: -18,
      contentScrollTop: 4_321
    });
  }
});

test('Back applies the retained collection position before starting its paged render', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.root = {};
  view.content = new PagedDomElement('main');
  view.currentView = 'albums';
  const queryFingerprint = JSON.stringify(view.getPagedQuery());
  const retainedAnchor = {
    queryFingerprint,
    entityId: 'album-800',
    canonicalTuple: ['album-800'],
    viewportOffsetPx: 24,
    focusKey: null
  };
  view.pendingPagedNavigationPosition = {
    queryFingerprint,
    anchor: retainedAnchor,
    viewportOrdinal: 800,
    viewportOffsetPx: 24,
    contentScrollTop: 12_345
  };
  view.pagedState = { phase: 'committed' };
  view.pagedQueryKey = 'detail-query';
  view.pagedAnchor = { queryFingerprint: 'detail-query', entityId: 'track-1' };
  let captures = 0;
  view.capturePagedAnchor = () => { captures += 1; };
  view.renderStatus = () => {};
  view.renderPagedLibrary = () => {
    assert.deepEqual(view.pagedAnchor, retainedAnchor);
    assert.notEqual(view.pagedAnchor, retainedAnchor);
    assert.equal(view.pagedViewportOrdinal, 800);
    assert.equal(view.pagedViewportOffsetPx, 24);
    assert.equal(view.pagedContentScrollTop, 12_345);
  };

  view.render();

  assert.equal(captures, 0);
  assert.equal(view.pendingPagedNavigationPosition, null);
  assert.deepEqual(view.pagedNavigationRestorePosition, {
    queryFingerprint,
    anchor: retainedAnchor,
    viewportOrdinal: 800,
    viewportOffsetPx: 24,
    contentScrollTop: 12_345
  });
});

test('a newer navigation intent fences a late asynchronous track lookup', async () => {
  const lookup = createDeferred();
  const manager = createPagedManager();
  manager.getTrack = () => lookup.promise;
  const view = new LibraryView({ manager, uiManager: {} });
  const calls = [];
  view.render = () => calls.push('render');
  view.show = () => calls.push('show');
  view.scrollTrackIntoView = () => calls.push('scroll');

  const oldLookup = view.showTrack('track-old');
  view.navigateToView('albums');
  lookup.resolve({ trackUid: 'track-old', title: 'Old track' });

  assert.equal(await oldLookup, false);
  assert.equal(view.currentView, 'albums');
  assert.deepEqual(calls, ['render']);
});

test('paged Search does not impose an eight-result entity cap and releases every context', async () => {
  const requests = [];
  const releases = [];
  const manager = createPagedManager();
  manager.queryEntities = async request => {
    requests.push(request);
    return {
      rows: [{ [`${request.type}Key`]: `${request.type}-1`, id: `${request.type}-1`, name: request.type }],
      contextToken: `${request.type}-context`
    };
  };
  manager.releaseContext = async contextToken => releases.push(contextToken);
  const view = new LibraryView({ manager, uiManager: {} });

  const groups = await view.loadPagedSearchEntities('needle');

  assert.deepEqual(groups.map(group => group.entityType), ['album', 'artist', 'playlist']);
  assert.deepEqual(requests.map(request => [request.type, request.query]), [
    ['album', 'needle'],
    ['artist', 'needle'],
    ['playlist', 'needle']
  ]);
  assert.equal(requests.every(request => !Object.hasOwn(request, 'limit')), true);
  assert.deepEqual(releases.sort(), ['album-context', 'artist-context', 'playlist-context']);
});

test('paged Search keeps successful entity groups when one secondary query fails', async () => {
  const releases = [];
  const warnings = [];
  const manager = createPagedManager();
  manager.queryEntities = async request => {
    if (request.type === 'artist') throw new Error('artist unavailable');
    return {
      rows: [{ id: `${request.type}-1`, name: request.type }],
      contextToken: `${request.type}-context`
    };
  };
  manager.releaseContext = async contextToken => releases.push(contextToken);
  const view = new LibraryView({ manager, uiManager: {} });

  const groups = await withGlobals({
    console: { warn: (...args) => warnings.push(args) }
  }, () => view.loadPagedSearchEntities('needle'));

  assert.deepEqual(groups.map(group => group.entityType), ['album', 'playlist']);
  assert.equal(groups.failedCount, 1);
  assert.deepEqual(releases.sort(), ['album-context', 'playlist-context']);
  assert.equal(warnings.length, 1);
});

test('zero-track Search shows Retry when any secondary query fails', async () => {
  const retry = new PagedDomElement('button');
  const document = {
    createElement(tagName) {
      const element = new PagedDomElement(tagName);
      element.querySelector = selector => (
        selector === '.library-paged-search-retry' ? retry : null
      );
      return element;
    },
    createDocumentFragment: () => new PagedDomElement('fragment')
  };
  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.searchQuery = 'needle';
    view.isCurrentPagedAttempt = () => true;
    let loads = 0;
    view.loadPagedSearchEntities = async () => {
      loads += 1;
      const groups = [];
      Object.defineProperty(groups, 'failedCount', {
        value: loads === 1 ? 1 : 0,
        enumerable: false
      });
      return groups;
    };

    const container = view.createPagedSearchEntitySections({}, { showEmptyWhenNoResults: true });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(container.children.length, 1);
    assert.match(container.children[0].className, /library-paged-search-error/);
    assert.match(container.children[0].innerHTML, /Retry/);

    retry.listeners.get('click')();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(loads, 2);
    assert.equal(container.children[0].dataset.emptyScope, 'search');
  });
});

test('paged Search previews expose a localized all-results route', async () => {
  const document = {
    createElement: tagName => new PagedDomElement(tagName),
    createDocumentFragment: () => new PagedDomElement('fragment')
  };
  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.searchQuery = 'needle';
    view.isCurrentPagedAttempt = () => true;
    view.loadPagedSearchEntities = async () => [{
      entityType: 'album',
      rows: [{ albumKey: 'album-1', name: 'Album One', trackCount: 2 }]
    }];
    const calls = [];
    view.navigateToSearchEntityResults = entityType => calls.push(entityType);

    const container = view.createPagedSearchEntitySections({});
    await Promise.resolve();
    await Promise.resolve();

    const section = container.children[0].children[0];
    const header = section.children[0];
    const showAll = header.children[1];
    assert.equal(showAll.textContent, 'Show all');
    showAll.listeners.get('click')();
    assert.deepEqual(calls, ['album']);
  });
});

test('paged Search preserves the previous entity sections until replacements are ready', async () => {
  const previousSection = new PagedDomElement('section');
  const previousContainer = new PagedDomElement('div');
  previousContainer.appendChild(previousSection);
  const replacement = createDeferred();
  const document = {
    createElement: tagName => new PagedDomElement(tagName),
    createDocumentFragment: () => new PagedDomElement('fragment')
  };
  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = {
      querySelector: selector => selector === '.library-paged-search-entities'
        ? previousContainer
        : null
    };
    view.searchQuery = 'next';
    view.isCurrentPagedAttempt = () => true;
    view.loadPagedSearchEntities = () => replacement.promise;

    const container = view.createPagedSearchEntitySections({});

    assert.deepEqual(container.children, [previousSection]);
    assert.equal(container.inert, true);
    assert.equal(container.attributes.get('aria-hidden'), 'true');
    assert.equal(container.attributes.get('aria-busy'), 'true');

    replacement.resolve([{
      entityType: 'album',
      rows: [{ albumKey: 'album-2', name: 'Album Two', trackCount: 1 }]
    }]);
    await Promise.resolve();
    await Promise.resolve();

    assert.notEqual(container.children[0], previousSection);
    assert.equal(container.inert, false);
    assert.equal(container.attributes.has('aria-hidden'), false);
    assert.equal(container.attributes.get('aria-busy'), 'false');
    assert.equal(container.hidden, false);
  });
});

test('unchanged Search entity groups keep their existing DOM', async () => {
  const document = {
    createElement: tagName => new PagedDomElement(tagName),
    createDocumentFragment: () => new PagedDomElement('fragment')
  };
  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.searchQuery = 'artist';
    view.isCurrentPagedAttempt = () => true;
    view.loadPagedSearchEntities = async () => [{
      entityType: 'artist',
      rows: [{ artistKey: 'artist-1', name: 'Artist One', trackCount: 3 }]
    }];
    const container = new PagedDomElement('div');
    const replaceChildren = container.replaceChildren.bind(container);
    let replacementCount = 0;
    container.replaceChildren = (...children) => {
      replacementCount += 1;
      replaceChildren(...children);
    };

    await view.loadPagedSearchEntitySections(container, {});
    const firstChildren = [...container.children];
    await view.loadPagedSearchEntitySections(container, {});

    assert.equal(replacementCount, 1);
    assert.deepEqual(container.children, firstChildren);
    assert.equal(container.inert, false);
    assert.equal(container.attributes.has('aria-hidden'), false);
  });
});

test('playlist captions localize itemCount and preserve an explicit zero', () => {
  const view = new LibraryView({
    manager: createPagedManager(),
    uiManager: { t: key => key === 'library.status.tracks' ? 'songs' : key }
  });

  assert.equal(view.getPagedEntityCaption({ itemCount: 0 }, 'playlist'), '0 songs');
  assert.equal(view.getPagedEntityCaption({ itemCount: 42 }, 'playlist'), '42 songs');
});

test('playlist detail header and live status announce resolved and unresolved totals', async () => {
  const document = { createElement: tagName => new PagedDomElement(tagName) };
  await withGlobals({ document }, async () => {
    const labels = {
      'library.status.tracks': 'songs',
      'library.status.unresolved': 'Missing'
    };
    const view = new LibraryView({
      manager: createPagedManager(),
      uiManager: { t: key => labels[key] ?? key }
    });
    view.currentView = 'playlists';
    view.detail = { type: 'playlist', key: 'playlist-1', name: 'Mix' };
    const state = {
      phase: 'committed',
      rows: [],
      totalCount: 3,
      resolvedCount: 2,
      unresolvedCount: 1,
      queryGeneration: 1,
      pageAttemptId: 1,
      liveAnnouncement: '3',
      liveAnnouncementId: '1:1:count'
    };

    const header = view.createPagedSectionHeader(state, 3, true);
    assert.match(header.innerHTML, /2 songs · 1 Missing/);
    assert.doesNotMatch(header.innerHTML, />3 songs</);
    const shell = view.createPagedAttemptShell(state);
    assert.equal(shell.children[0].textContent, '2 songs · 1 Missing');

    const resolvedOnly = view.createPagedSectionHeader({ ...state, unresolvedCount: 0 }, 2, true);
    assert.match(resolvedOnly.innerHTML, /2 songs/);
    assert.doesNotMatch(resolvedOnly.innerHTML, /Missing/);
  });
});

test('paged empty states distinguish scopes and wait for every Search preview', async () => {
  const document = {
    createElement: tagName => new PagedDomElement(tagName),
    createDocumentFragment: () => new PagedDomElement('fragment')
  };
  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.isCurrentPagedAttempt = () => true;

    view.currentView = 'tracks';
    view.searchQuery = 'needle';
    const preview = createDeferred();
    view.loadPagedSearchEntities = () => preview.promise;
    const search = view.createPagedSearchEntitySections({}, { showEmptyWhenNoResults: true });
    assert.equal(search.children.length, 0);
    assert.equal(search.attributes.get('aria-busy'), 'true');

    preview.resolve(['album', 'artist', 'playlist'].map(entityType => ({ entityType, rows: [] })));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(search.attributes.get('aria-busy'), 'false');
    assert.equal(search.children[0].dataset.emptyScope, 'search');
    assert.match(search.children[0].innerHTML, /No results for &quot;needle&quot;/);

    view.searchQuery = '';
    view.detail = { type: 'playlist', key: 'playlist-1' };
    assert.equal(view.createPagedEmptyState().dataset.emptyScope, 'playlist');
    view.detail = null;
    view.currentView = 'playlists';
    assert.equal(view.createPagedEmptyState().dataset.emptyScope, 'playlists');
    view.currentView = 'subfolders';
    assert.equal(view.createPagedEmptyState().dataset.emptyScope, 'subfolders');
    view.currentView = 'tracks';
    const library = view.createPagedEmptyState();
    assert.equal(library.dataset.emptyScope, 'library');
    assert.match(library.innerHTML, /library-empty-add/);
  });
});

test('all-results search uses paging, preserves the query, and returns to track results', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  let renders = 0;
  view.render = () => { renders += 1; };
  view.currentView = 'tracks';
  view.searchQuery = 'needle';
  view.searchInput = { value: 'needle' };

  assert.equal(view.navigateToSearchEntityResults('artist', { pushHistory: false }), true);
  assert.equal(view.currentView, 'artists');
  assert.equal(view.searchQuery, 'needle');
  assert.equal(view.searchEntityType, 'artist');
  assert.deepEqual(view.getPagedQuery(), {
    endpoint: 'entities',
    entityType: 'artist',
    query: 'needle',
    sort: 'name',
    direction: view.sortDirection,
    scope: null
  });

  assert.equal(view.navigateBack(), true);
  assert.equal(view.currentView, 'tracks');
  assert.equal(view.searchQuery, 'needle');
  assert.equal(view.searchEntityType, null);
  assert.equal(view.searchInput.value, 'needle');
  assert.equal(renders, 2);
});

test('folder Search all-results Back and Escape restore the saved folder path', async () => {
  const document = {
    body: { classList: { contains: () => false } },
    querySelector: () => null
  };
  await withGlobals({ document }, () => {
    for (const exit of ['back', 'escape']) {
      const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
      view.render = () => {};
      view.currentView = 'folders';
      view.detail = {
        type: 'folder',
        folderId: 'folder-1',
        title: 'Music'
      };
      view.searchQuery = 'needle';
      view.searchInput = { value: 'needle' };

      assert.equal(view.navigateToSearchEntityResults('artist', { pushHistory: false }), true);
      if (exit === 'back') {
        assert.equal(view.navigateBack(), true);
      } else {
        assert.equal(view.handleLibraryEscape({ preventDefault() {} }), true);
      }
      assert.deepEqual(view.detail, {
        type: 'folderNode',
        folderId: 'folder-1',
        path: '',
        title: 'Music'
      });
      assert.equal(view.currentView, 'folders');
      assert.equal(view.searchQuery, 'needle');
      assert.equal(view.searchInput.value, 'needle');
      assert.equal(view.searchEntityType, null);
    }
  });
});

test('folder Search show-all preserves the outer Folders collection return snapshot', async () => {
  const document = {
    body: { classList: { contains: () => false } },
    querySelector: () => null
  };
  await withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.content = new PagedDomElement('main');
    view.content.scrollTop = 880;
    view.navigateToDetail({
      type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music'
    }, null, { pushHistory: false });
    const collectionReturnSnapshot = view.navigationReturnSnapshot;
    view.searchQuery = 'needle';
    view.searchInput = { value: 'needle' };

    assert.equal(view.navigateToSearchEntityResults('artist', { pushHistory: false }), true);
    assert.equal(view.navigationReturnSnapshot, collectionReturnSnapshot);
    assert.equal(view.navigateBack(), true);
    assert.equal(view.navigationReturnSnapshot, collectionReturnSnapshot);
    assert.equal(view.detail.path, '');
    assert.equal(view.searchQuery, 'needle');

    assert.equal(view.handleLibraryEscape({ preventDefault() {} }), true);
    assert.equal(view.searchQuery, '');
    assert.equal(view.navigateBack({ fromPopState: true }), true);
    assert.equal(view.detail, null);
    assert.equal(view.currentView, 'folders');
    assert.equal(view.pendingPagedNavigationPosition.contentScrollTop, 880);
  });
});

test('mobile history restores the search summary after opening all entity results', async () => {
  const historyCalls = [];
  const history = {
    state: null,
    replaceState(state) {
      this.state = state;
      historyCalls.push(['replace', state]);
    },
    pushState(state) {
      this.state = state;
      historyCalls.push(['push', state]);
    }
  };
  const body = {
    classList: {
      contains: name => name === 'layout-mobile' || name === 'view-library'
    }
  };
  await withGlobals({ document: { body }, history }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'tracks';
    view.searchQuery = 'needle';

    view.navigateToSearchEntityResults('playlist');
    assert.equal(view.mobileHistoryDepth, 1);
    assert.equal(view.mobileHistoryIndex, 1);
    assert.equal(historyCalls[0][1].index, 0);
    assert.equal(historyCalls[0][1].depth, 0);
    assert.equal(historyCalls[1][1].index, 1);
    assert.equal(historyCalls[1][1].depth, 1);
    assert.equal(historyCalls[0][1].snapshot.searchEntityType, null);
    assert.equal(historyCalls[1][1].snapshot.searchEntityType, 'playlist');
    assert.equal(historyCalls[1][1].snapshot.searchQuery, 'needle');

    view.handleMobilePopState({ state: historyCalls[0][1] });
    assert.equal(view.currentView, 'tracks');
    assert.equal(view.searchQuery, 'needle');
    assert.equal(view.searchEntityType, null);
    assert.equal(view.mobileHistoryDepth, 0);
    assert.equal(view.mobileHistoryIndex, 0);

    view.handleMobilePopState({ state: historyCalls[1][1] });
    assert.equal(view.currentView, 'playlists');
    assert.equal(view.searchQuery, 'needle');
    assert.equal(view.searchEntityType, 'playlist');
    assert.equal(view.mobileHistoryDepth, 1);
    assert.equal(view.mobileHistoryIndex, 1);
  });
});

test('mobile history refreshes the current collection position before opening detail', async () => {
  const historyCalls = [];
  const history = {
    state: null,
    replaceState(state) {
      this.state = state;
      historyCalls.push(['replace', state]);
    },
    pushState(state) {
      this.state = state;
      historyCalls.push(['push', state]);
    }
  };
  const body = {
    classList: {
      contains: name => name === 'layout-mobile' || name === 'view-library'
    }
  };
  await withGlobals({ document: { body }, history }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.navigateToView('albums');

    view.content = { scrollTop: 6_400 };
    view.pagedState = { phase: 'committed' };
    view.pagedQueryKey = JSON.stringify(view.getPagedQuery());
    view.pagedViewportOrdinal = 120;
    view.pagedViewportOffsetPx = -24;
    view.pagedAnchor = {
      queryFingerprint: view.pagedQueryKey,
      entityId: 'album-120',
      canonicalTuple: ['album-120'],
      viewportOffsetPx: -24,
      focusKey: null
    };
    view.capturePagedAnchor = () => view.pagedAnchor;

    view.navigateToDetail({ type: 'album', key: 'album-120' });

    assert.deepEqual(historyCalls.map(([operation]) => operation), [
      'replace', 'push', 'replace', 'push'
    ]);
    const refreshedCollectionState = historyCalls[2][1];
    assert.equal(refreshedCollectionState.index, 1);
    assert.equal(refreshedCollectionState.depth, 1);
    assert.equal(refreshedCollectionState.snapshot.currentView, 'albums');
    assert.equal(refreshedCollectionState.snapshot.detail, null);
    assert.equal(refreshedCollectionState.snapshot.pagedPosition.contentScrollTop, 6_400);
    assert.equal(refreshedCollectionState.snapshot.pagedPosition.viewportOrdinal, 120);

    view.handleMobilePopState({ state: refreshedCollectionState });
    assert.equal(view.currentView, 'albums');
    assert.equal(view.detail, null);
    assert.equal(view.pendingPagedNavigationPosition.contentScrollTop, 6_400);
    assert.equal(view.mobileHistoryDepth, 1);
    assert.equal(view.mobileHistoryIndex, 1);
  });
});

test('paged service failure keeps internal method names out of the user-facing message', async () => {
  const content = new PagedDomElement('main');
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.content = content;
  await withGlobals({ console: { error() {} } }, () => {
    view.renderPagedUnavailable(['createContext', 'queryEntities']);
  });
  assert.match(content.innerHTML, /service is unavailable/);
  assert.doesNotMatch(content.innerHTML, /createContext|queryEntities|<code>/);
});

test('paged album detail defaults to disc and track order until the user overrides the sort', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.detail = { type: 'album', key: 'album-1' };
  view.sort = 'title';
  view.sortDirection = 'desc';
  view.detailSortOverride = false;

  assert.deepEqual(view.getPagedQuery(), {
    endpoint: 'tracks',
    query: '',
    sort: 'album',
    direction: 'asc',
    scope: { albumKey: 'album-1' }
  });

  view.detailSortOverride = true;
  assert.deepEqual(view.getPagedQuery(), {
    endpoint: 'tracks',
    query: '',
    sort: 'title',
    direction: 'desc',
    scope: { albumKey: 'album-1' }
  });
});

test('LibraryView enables 300-result default selection for searches and supported detail scopes', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  const starts = [];
  view.currentView = 'tracks';
  view.renderPagedNav = () => {};
  view.markPagedRowsInert = () => {};
  view.pagedController = {
    start(query, options) {
      starts.push({ query, options });
    }
  };

  view.searchQuery = 'needle';
  view.renderPagedLibrary(1);
  view.searchQuery = '';
  for (const type of ['album', 'artist', 'genre', 'subfolder', 'folder', 'playlist']) {
    view.detail = { type, key: `${type}-1`, title: type };
    view.renderPagedLibrary(1);
  }
  view.detail = null;
  view.renderPagedLibrary(1);

  assert.deepEqual(starts.map(start => start.options.defaultSelectAllLimit), [
    300, 300, 300, 300, 300, null, 300, null
  ]);
});

test('LibraryView uses the same default selection scopes in mobile layout', async () => {
  const starts = [];
  const body = { classList: { contains: name => name === 'layout-mobile' } };
  await withGlobals({ document: { body } }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.currentView = 'tracks';
    view.renderPagedNav = () => {};
    view.markPagedRowsInert = () => {};
    view.pagedController = {
      start(query, options) {
        starts.push({ query, options });
      }
    };

    view.searchQuery = 'needle';
    view.renderPagedLibrary(1);
    view.searchQuery = '';
    for (const type of ['album', 'artist', 'genre', 'subfolder', 'folder', 'playlist']) {
      view.detail = { type, key: `${type}-1`, title: type };
      view.renderPagedLibrary(1);
    }
    view.detail = null;
    view.renderPagedLibrary(1);
  });

  assert.deepEqual(starts.map(start => start.options.defaultSelectAllLimit), [
    300, 300, 300, 300, 300, null, 300, null
  ]);
});

test('mobile Ctrl+A does not create a hidden paged selection', async () => {
  const body = { classList: { contains: name => name === 'layout-mobile' } };
  await withGlobals({ document: { body } }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    let selectAllCalls = 0;
    let prevented = 0;
    view.content = new PagedDomElement('main');
    view.pagedState = { phase: 'committed' };
    view.pagedController = { selectAll: () => { selectAllCalls += 1; } };

    view.handleContentKeyDown({
      key: 'a',
      ctrlKey: true,
      target: view.content,
      preventDefault: () => { prevented += 1; }
    });

    assert.equal(selectAllCalls, 0);
    assert.equal(prevented, 0);
  });
});

test('Escape clears paged selection without rebuilding results before the interactive-target guard', async () => {
  const document = {
    body: { classList: { contains: () => false } },
    querySelector: () => null
  };
  await withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    let clears = 0;
    let refreshes = 0;
    let prevented = 0;
    let stopped = 0;
    view.detail = { type: 'album', key: 'album-1' };
    view.pagedState = {
      phase: 'committed',
      selectionProjection: { hasAny: false, selectedCount: 0 }
    };
    view.pagedController = {
      clearSelection() { clears += 1; },
      getSelectionProjection() {
        return { hasAny: true, selectedCount: 1 };
      },
      createViewState() {
        return {
          phase: 'committed',
          selectionProjection: { hasAny: false, selectedCount: 0 }
        };
      }
    };
    view.refreshPagedSelectionState = () => { refreshes += 1; };
    const input = {
      closest(selector) { return selector.includes('input') ? this : null; }
    };

    view.handleContentKeyDown({
      key: 'Escape',
      target: input,
      preventDefault() { prevented += 1; },
      stopPropagation() { stopped += 1; }
    });

    assert.equal(clears, 1);
    assert.equal(refreshes, 1);
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
    assert.deepEqual(view.detail, { type: 'album', key: 'album-1' });
  });
});

test('mobile all-results selection does not enter long-press selection mode', async () => {
  const rootClasses = new Set();
  const body = { classList: { contains: name => name === 'layout-mobile' } };
  await withGlobals({ document: { body } }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.root = {
      classList: {
        add(name) { rootClasses.add(name); },
        remove(name) { rootClasses.delete(name); }
      }
    };

    view.pagedState = {
      selectionDescriptor: { mode: 'all', contextToken: 'context', exclusions: [] },
      selectionProjection: { hasAny: true, selectedCount: 2 }
    };
    view.refreshPagedMobileSelectionMode();

    assert.equal(view.pagedMobileSelectionActive, false);
    assert.equal(rootClasses.has('mobile-selection-mode'), false);
  });
});

test('paged action bar changes selection without changing mobile selection mode', async () => {
  const bar = new PagedDomElement('div');
  const selectAll = new PagedDomElement('button');
  const deselectAll = new PagedDomElement('button');
  const rootClasses = new Set();
  const controls = new Map([
    ['.library-paged-select-all', selectAll],
    ['.library-paged-deselect-all', deselectAll]
  ]);
  bar.querySelector = selector => controls.get(selector) ?? null;
  const calls = [];
  const body = { classList: { contains: name => name === 'layout-mobile' } };

  await withGlobals({ document: { body, createElement: () => bar } }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.root = {
      classList: {
        add(name) { rootClasses.add(name); },
        remove(name) { rootClasses.delete(name); }
      }
    };
    view.pagedController = {
      selectAll() { calls.push('select'); },
      clearSelection() { calls.push('clear'); },
      createViewState() { return { phase: 'committed' }; }
    };
    view.pagedState = {
      totalCount: 1,
      selectionProjection: { hasAny: true, selectedCount: 1 }
    };
    view.renderPagedCommitted = state => calls.push(state.phase);
    view.refreshPagedSelectionState = () => calls.push('refresh');
    view.setPagedMobileSelectionActive(true);

    const result = view.createPagedActionBar({
      selectionDescriptor: { mode: 'explicit', contextToken: 'context', trackUids: ['track-1'] },
      selectionProjection: { hasAny: true, selectedCount: 1 },
      staleSelectionDescriptor: null,
      selectionRejection: null
    });

    assert.notEqual(result.hidden, true);
    assert.match(result.innerHTML, /Select All<\/button>\s*<button[^>]+library-paged-deselect-all[^>]*>Deselect All/);
    selectAll.listeners.get('click')();
    assert.equal(rootClasses.has('mobile-selection-mode'), true);
    deselectAll.listeners.get('click')();
    assert.equal(rootClasses.has('mobile-selection-mode'), true);
  });

  assert.deepEqual(calls, ['select', 'refresh', 'clear', 'refresh']);
});

test('paged loading preserves committed results without changing row appearance', async () => {
  const document = { createElement: tagName => new PagedDomElement(tagName), activeElement: null };
  await withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    const content = new PagedDomElement('main');
    const committedResults = new PagedDomElement('section');
    content.appendChild(committedResults);
    content.querySelector = selector => selector === '.library-paged-attempt' ? committedResults : null;
    view.content = content;
    view.pagedPublishedPhase = 'committed';
    view.pagedController = {
      firstPage: { isCurrent: (generation, attempt) => generation === 2 && attempt === 1 }
    };
    let invalidations = 0;
    view.markPagedRowsInert = () => { invalidations += 1; };
    const loading = {
      phase: 'loading',
      queryGeneration: 2,
      pageAttemptId: 1,
      ariaBusy: true
    };

    view.renderPagedState(loading);

    assert.equal(invalidations, 0);
    assert.equal(content.attributes.get('aria-busy'), 'true');
    assert.deepEqual(content.children, [committedResults]);
    assert.equal(committedResults.inert, true);
    assert.equal(committedResults.attributes.get('aria-disabled'), 'true');
    assert.equal(view.pagedPublishedPhase, 'committed');
  });
});

test('paged action availability enables Deselect All as soon as a track is selected', () => {
  const deselectAll = new PagedDomElement('button');
  let selected = false;
  const content = {
    querySelector(selector) {
      return selector === '.library-paged-deselect-all' ? deselectAll : null;
    },
    querySelectorAll() { return []; }
  };
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.content = content;
  view.pagedController = {
    createViewState() {
      return {
        selectionDescriptor: {
          mode: 'explicit',
          trackUids: selected ? ['track-1'] : []
        },
        selectionProjection: { hasAny: selected, selectedCount: selected ? 1 : 0 }
      };
    }
  };

  view.refreshPagedActionAvailability();
  assert.equal(deselectAll.disabled, true);

  selected = true;
  view.refreshPagedActionAvailability();
  assert.equal(deselectAll.disabled, false);
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

test('paged track rows retain the v2.0 genre and duration columns', () => {
  const row = new PagedDomElement('div');
  const document = { createElement: () => row };
  return withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.pagedController = { isSelected: () => false };
    const result = view.createPagedRow({
      trackUid: 'track-1',
      title: 'Track One',
      artist: 'Artist One',
      artistKey: 'artist-1',
      album: 'Album One',
      albumKey: 'album-1',
      genre: 'Jazz',
      durationSec: 245
    }, 0, { queryGeneration: 1, pageAttemptId: 1 }, true);

    assert.match(result.innerHTML, />Jazz<\/span>/);
    assert.match(result.innerHTML, />4:05<\/span>/);
    assert.match(result.innerHTML, /library-paged-row-more/);
    assert.doesNotMatch(result.innerHTML, /library-track-mobile-meta|Artist One · 4:05/);
    assert.match(result.innerHTML, /library-artist-link/);
    assert.match(result.innerHTML, /library-album-link/);
  });
});

test('unresolved playlist occurrences remain mutable but cannot start playback', async () => {
  const row = new PagedDomElement('div');
  const document = { createElement: () => row };
  await withGlobals({ document }, async () => {
    let playbackStarts = 0;
    const manager = createPagedManager();
    manager.performSelectionAction = () => { playbackStarts += 1; };
    manager.createOperationRequestId = () => 'request-1';
    const view = new LibraryView({ manager, uiManager: {} });
    view.detail = { type: 'playlist', key: 'playlist-1' };
    view.pagedController = {
      contextToken: 'context-1',
      isSelected: () => false
    };
    view.pagedActionController = { track: () => ({}) };
    const unresolved = {
      trackUid: null,
      itemKey: 'item-7',
      metadataStatus: 'unresolved',
      title: 'Missing Track'
    };

    const result = view.createPagedRow(unresolved, 6, {
      queryGeneration: 2,
      pageAttemptId: 3
    }, true, { rowIndexOffset: 1 });

    assert.match(result.className, /library-paged-unresolved/);
    assert.equal(result.attributes.get('aria-rowindex'), '8');
    assert.match(result.attributes.get('aria-describedby'), /library-paged-unresolved-2-3-6/);
    assert.match(result.innerHTML, /library-paged-unresolved-status/);
    assert.match(result.innerHTML, />Missing<\/span>/);
    assert.match(result.innerHTML, /library-paged-select-cell" role="gridcell"/);
    assert.match(result.innerHTML, /library-paged-more-cell" role="gridcell"/);
    assert.match(result.innerHTML, /library-paged-item-up/);
    assert.match(result.innerHTML, /library-paged-item-down/);
    assert.match(result.innerHTML, /library-paged-item-remove/);

    assert.deepEqual(await view.startPagedTrackPlay(unresolved, 6), {
      kind: 'unavailable',
      reason: 'unresolved-playlist-item'
    });
    assert.equal(playbackStarts, 0);
  });
});

test('paged mobile track rows enter selection on long press and preserve all-results selection', async () => {
  const row = new PagedDomElement('div');
  const checkbox = new PagedDomElement('input');
  row.querySelector = selector => selector === '.library-paged-select' ? checkbox : null;
  const content = new PagedDomElement('main');
  content.querySelectorAll = selector => selector === '.library-paged-row[data-track-id]' ? [row] : [];
  const body = { classList: { contains: name => name === 'layout-mobile' } };
  const rootClasses = new Set();
  const root = {
    classList: {
      add(name) { rootClasses.add(name); },
      remove(name) { rootClasses.delete(name); },
      contains(name) { return rootClasses.has(name); }
    }
  };
  const calls = [];
  let longPress = null;
  let selected = false;
  const document = { body, createElement: () => row };

  await withGlobals({
    document,
    setTimeout(callback) {
      longPress = callback;
      return 1;
    },
    clearTimeout() {}
  }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.root = root;
    view.content = content;
    view.pagedController = {
      isSelected: () => selected,
      clearSelection() { selected = false; },
      toggleSelection(trackUid, nextSelected, options) {
        selected = nextSelected;
        calls.push(['select', trackUid, 4, nextSelected, options]);
        return { accepted: true };
      },
      getSelectionDescriptor() {
        return { mode: 'explicit', trackUids: selected ? ['track-1'] : [] };
      },
      getSelectionProjection() {
        return { hasAny: selected, selectedCount: selected ? 1 : 0 };
      }
    };
    view.dispatchPagedRowAction = (_row, callback) => ({ accepted: true, value: callback() });
    view.startPagedTrackPlay = (_track, ordinal) => calls.push(['play', ordinal]);
    view.openPagedTrackContextMenu = () => calls.push(['menu']);
    view.refreshPagedActionAvailability = () => {};
    view.createPagedRow({
      trackUid: 'track-1',
      title: 'Song',
      artist: 'Artist',
      durationSec: 125
    }, 4, { queryGeneration: 1, pageAttemptId: 1 }, true);

    assert.doesNotMatch(row.innerHTML, /library-track-mobile-meta|Artist · 2:05/);
    assert.equal(row.draggable, false);
    assert.equal(rootClasses.has('mobile-selection-mode'), false);
    row.listeners.get('click')({ detail: 1, target: { closest: () => null } });
    assert.deepEqual(calls, [['play', 4]]);
    row.listeners.get('click')({ detail: 2, target: { closest: () => null } });
    row.listeners.get('dblclick')({ target: { closest: () => null } });
    assert.equal(calls.filter(call => call[0] === 'play').length, 1);

    let prevented = 0;
    row.listeners.get('touchstart')({ preventDefault() { prevented += 1; } });
    longPress();
    assert.equal(prevented, 1);
    assert.deepEqual(calls.at(-1), ['select', 'track-1', 4, true, { ordinal: 4, extend: false }]);
    assert.equal(view.pagedMobileSelectionActive, true);
    assert.equal(rootClasses.has('mobile-selection-mode'), true);

    let contextPrevented = 0;
    row.listeners.get('contextmenu')({ preventDefault() { contextPrevented += 1; } });
    assert.equal(contextPrevented, 1);
    assert.equal(calls.filter(call => call[0] === 'select').length, 1);
    assert.equal(calls.some(call => call[0] === 'menu'), false);
    row.listeners.get('touchend')();

    let stopped = 0;
    row.listeners.get('click')({
      target: { closest: () => null },
      preventDefault() { prevented += 1; },
      stopPropagation() { stopped += 1; }
    });
    assert.equal(stopped, 1);
    assert.equal(calls.filter(call => call[0] === 'play').length, 1);

    row.listeners.get('touchstart')({ preventDefault() {} });
    row.listeners.get('touchend')();
    row.listeners.get('click')({ target: { closest: () => null } });
    assert.deepEqual(calls.at(-1), ['select', 'track-1', 4, false, { ordinal: 4, extend: false }]);
    assert.equal(view.pagedMobileSelectionActive, true);
    assert.equal(rootClasses.has('mobile-selection-mode'), true);

    selected = true;
    checkbox.listeners.get('change')({ target: { checked: false } });
    assert.equal(view.pagedMobileSelectionActive, true);
    assert.equal(rootClasses.has('mobile-selection-mode'), true);

    const allSelection = {
      mode: 'all',
      contextToken: 'context',
      exclusions: []
    };
    const allSelectionCalls = [];
    view.pagedController = {
      isSelected(trackUid) {
        return !allSelection.exclusions.includes(trackUid);
      },
      clearSelection() {
        allSelectionCalls.push(['clear']);
      },
      toggleSelection(trackUid, nextSelected, options) {
        allSelectionCalls.push(['select', trackUid, nextSelected, options]);
        if (!nextSelected && !allSelection.exclusions.includes(trackUid)) {
          allSelection.exclusions.push(trackUid);
        }
        return { accepted: true };
      },
      getSelectionDescriptor() {
        return allSelection;
      },
      getSelectionProjection() {
        return {
          hasAny: allSelection.exclusions.length === 0,
          selectedCount: allSelection.exclusions.length === 0 ? 1 : 0
        };
      }
    };
    view.setPagedMobileSelectionActive(false);
    row.listeners.get('touchstart')({ preventDefault() {} });
    longPress();
    assert.equal(view.pagedMobileSelectionActive, true);
    assert.equal(rootClasses.has('mobile-selection-mode'), true);
    assert.deepEqual(allSelectionCalls, []);
    assert.deepEqual(allSelection, {
      mode: 'all',
      contextToken: 'context',
      exclusions: []
    });

    row.listeners.get('touchend')();
    row.listeners.get('click')({
      target: { closest: () => null },
      preventDefault() {},
      stopPropagation() {}
    });
    row.listeners.get('click')({ target: { closest: () => null } });
    assert.deepEqual(allSelectionCalls, [
      ['select', 'track-1', false, { ordinal: 4, extend: false }]
    ]);
    assert.deepEqual(allSelection.exclusions, ['track-1']);
  });
});

test('paged desktop Ctrl-click toggles the current selection state', () => {
  const row = new PagedDomElement('div');
  const checkbox = new PagedDomElement('input');
  row.querySelector = selector => selector === '.library-paged-select' ? checkbox : null;
  const document = { createElement: () => row };
  return withGlobals({ document }, () => {
    let selected = false;
    const calls = [];
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.pagedController = { isSelected: () => selected };
    view.commitPagedTrackSelection = (_row, trackUid, ordinal, nextSelected, options) => {
      calls.push([trackUid, ordinal, nextSelected, options]);
    };
    view.createPagedRow({ trackUid: 'track-1', title: 'Song' }, 4, {
      queryGeneration: 1,
      pageAttemptId: 1
    }, true);

    row.listeners.get('click')({
      target: { closest: () => null },
      ctrlKey: true
    });
    selected = true;
    row.listeners.get('click')({
      target: { closest: () => null },
      ctrlKey: true
    });

    assert.deepEqual(calls, [
      ['track-1', 4, true, { exclusive: false, extend: false }],
      ['track-1', 4, false, { exclusive: false, extend: false }]
    ]);
  });
});

test('playlist duplicate tracks keep independent occurrence selection, focus, anchor, and context identity', async () => {
  const firstRow = new PagedDomElement('div');
  const secondRow = new PagedDomElement('div');
  const menu = new PagedDomElement('div');
  const rows = [firstRow, secondRow, menu];
  const document = {
    activeElement: secondRow,
    body: { classList: { contains: () => false } },
    createElement: () => rows.shift()
  };
  await withGlobals({ document }, async () => {
    const selectedCalls = [];
    const manager = createPagedManager();
    const view = new LibraryView({ manager, uiManager: {} });
    view.currentView = 'playlists';
    view.detail = { type: 'playlist', key: 'playlist-1', title: 'Duplicates' };
    view.pagedController = {
      isSelected(entityId, ordinal) {
        selectedCalls.push(['selected', entityId, ordinal]);
        return false;
      },
      createAnchor: value => value
    };
    const first = {
      trackUid: 'track-1', playlistItemKey: 'occurrence-a', itemKey: 10,
      playlistVersion: 4, title: 'Same song'
    };
    const second = {
      trackUid: 'track-1', playlistItemKey: 'occurrence-b', itemKey: 11,
      playlistVersion: 4, title: 'Same song'
    };

    view.createPagedRow(first, 0, { queryGeneration: 1, pageAttemptId: 1, totalCount: 2 }, true);
    view.createPagedRow(second, 1, { queryGeneration: 1, pageAttemptId: 1, totalCount: 2 }, true);

    assert.equal(firstRow.dataset.entityId, 'occurrence-a');
    assert.equal(secondRow.dataset.entityId, 'occurrence-b');
    assert.equal(firstRow.dataset.trackId, 'track-1');
    assert.equal(secondRow.dataset.trackId, 'track-1');
    assert.equal(firstRow.draggable, true);
    assert.match(firstRow.innerHTML, /library-paged-item-up/);
    assert.match(firstRow.innerHTML, /library-paged-item-down/);
    assert.match(firstRow.innerHTML, /library-paged-item-remove/);
    assert.match(firstRow.innerHTML, /library-paged-item-up"[^>]* disabled/);
    assert.doesNotMatch(firstRow.innerHTML, /library-paged-item-down"[^>]* disabled/);
    assert.doesNotMatch(secondRow.innerHTML, /library-paged-item-up"[^>]* disabled/);
    assert.match(secondRow.innerHTML, /library-paged-item-down"[^>]* disabled/);
    assert.deepEqual(selectedCalls.slice(0, 2), [
      ['selected', 'occurrence-a', 0],
      ['selected', 'occurrence-b', 1]
    ]);

    secondRow.listeners.get('focus')();
    assert.equal(view.pagedFocusedEntityId, 'occurrence-b');
    secondRow.getBoundingClientRect = () => ({ top: 24, bottom: 80 });
    secondRow.contains = element => element === secondRow;
    view.content = {
      querySelectorAll: () => [secondRow],
      getBoundingClientRect: () => ({ top: 0 })
    };
    view.pagedState = { phase: 'committed' };
    view.pagedController.getCachedRows = () => [{ ordinal: 1, row: second }];
    const anchor = view.capturePagedAnchor();
    assert.equal(anchor.entityId, 'occurrence-b');
    assert.equal(anchor.focusKey, 'occurrence-b');

    const contextCalls = [];
    view.pagedController.contextToken = 'playlist-context';
    view.pagedController.isSelected = entityId => {
      contextCalls.push(['isSelected', entityId]);
      return false;
    };
    view.pagedController.clearSelection = () => { throw new Error('context menu must not mutate selection'); };
    view.pagedController.toggleSelection = () => { throw new Error('context menu must not mutate selection'); };
    view.pagedController.getSelectionProjection = () => ({ hasAny: false, selectedCount: 0 });
    view.pagedController.createViewState = () => ({
      phase: 'committed', queryGeneration: 1, pageAttemptId: 1
    });
    view.refreshPagedRenderedSelection = () => {};
    view.refreshPagedActionAvailability = () => {};
    view.presentContextMenu = () => {};
    view.openPagedTrackContextMenu({ preventDefault() {} }, second, { ordinal: 1 });
    assert.deepEqual(contextCalls, [['isSelected', 'occurrence-b']]);

    view.pagedState = { totalCount: 2 };
    view.pagedFocusedOrdinal = 0;
    view.pagedController.ensureOrdinal = async () => ({ accepted: true });
    view.pagedController.getCachedRows = () => [{ ordinal: 1, row: second }];
    view.pagedController.createViewState = () => ({ phase: 'committed' });
    view.renderPagedCommitted = () => {};
    assert.deepEqual(await view.movePagedFocus(1), {
      accepted: true, ordinal: 1, entityId: 'occurrence-b'
    });
  });
});

test('desktop playlist drag reorders arbitrary occurrences before or after the target itemKey', async () => {
  const calls = [];
  const manager = createPagedManager();
  manager.playlists = {
    async reorderItem(...args) {
      calls.push(args);
      return { accepted: true };
    }
  };
  const view = new LibraryView({ manager, uiManager: {} });
  view.detail = { type: 'playlist', key: 'playlist-1' };
  const classNames = new Set();
  const targetRow = {
    dataset: {},
    classList: {
      add: (...names) => names.forEach(name => classNames.add(name)),
      remove: (...names) => names.forEach(name => classNames.delete(name)),
      toggle(name, enabled) {
        if (enabled) classNames.add(name);
        else classNames.delete(name);
      }
    },
    getBoundingClientRect: () => ({ top: 0, height: 20 })
  };
  view.content = { querySelectorAll: () => [targetRow] };
  view.runPagedRowCommand = (_row, callback) => callback();
  const selectionDescriptor = Object.freeze({
    mode: 'explicit',
    contextToken: 'playlist-context',
    trackUids: Object.freeze(['10'])
  });
  view.pagedState = { selectionProjection: { hasAny: true, selectedCount: 1 } };
  view.pagedController = {
    contextToken: 'playlist-context',
    isSelected: entityId => entityId === '10',
    getSelectionDescriptor: () => selectionDescriptor,
    getSelectedOrdinal: () => 0
  };
  const transferData = new Map();
  const dataTransfer = {
    types: [],
    setData(type, value) {
      transferData.set(type, value);
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData: type => transferData.get(type) || ''
  };
  view.handlePagedPlaylistItemDragStart({ dataTransfer }, { itemKey: 10 }, 0);
  assert.equal(dataTransfer.effectAllowed, 'copyMove');
  assert.deepEqual(JSON.parse(transferData.get('application/x-effetune-library-tracks')), {
    selectionDescriptor,
    contextToken: 'playlist-context'
  });

  for (const [clientY, target] of [
    [2, { beforeItemKey: 20 }],
    [18, { afterItemKey: 20 }]
  ]) {
    const event = {
      dataTransfer,
      currentTarget: targetRow,
      clientY,
      preventDefault() {},
      stopPropagation() {}
    };
    view.handlePagedPlaylistItemDragOver(event, { itemKey: 20 });
    await view.handlePagedPlaylistItemDrop(event, targetRow, {
      itemKey: 20,
      playlistVersion: 7
    });
    assert.deepEqual(calls.at(-1), [
      'playlist-1', 10, target, { expectedVersion: 7 }
    ]);
  }
});

test('track drag carries the complete logical selection descriptor', () => {
  const descriptor = Object.freeze({
    mode: 'range',
    contextToken: 'context-drag',
    startUid: 'track-1',
    endUid: 'track-9',
    exclusions: Object.freeze(['track-4']),
    inclusions: Object.freeze(['track-20'])
  });
  const payloads = new Map();
  const dataTransfer = {
    setData(type, value) { payloads.set(type, value); }
  };
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.pagedController = {
    contextToken: 'context-drag',
    getSelectionDescriptor: () => descriptor,
    getSelectionProjection: () => ({ hasAny: true, selectedCount: 9 }),
    isSelected: (_uid, ordinal) => ordinal === 3
  };

  view.handlePagedTrackDragStart({ dataTransfer }, 'track-3', 3);
  assert.deepEqual(JSON.parse(payloads.get('application/x-effetune-library-tracks')), {
    selectionDescriptor: descriptor,
    contextToken: 'context-drag'
  });
  assert.equal(payloads.get('text/plain'), 'track-3');

  const singlePayloads = new Map();
  view.handlePagedTrackDragStart({
    dataTransfer: { setData: (type, value) => singlePayloads.set(type, value) }
  }, 'track-30', 30);
  assert.deepEqual(
    JSON.parse(singlePayloads.get('application/x-effetune-library-tracks')).selectionDescriptor,
    { mode: 'explicit', contextToken: 'context-drag', trackUids: ['track-30'] }
  );
});

test('row Play uses a selection-relative ordinal without changing playlist occurrence identity', async () => {
  const calls = [];
  const manager = createPagedManager();
  manager.createOperationRequestId = () => `request-${calls.length + 1}`;
  manager.performSelectionAction = async (...args) => {
    calls.push(args);
    return { kind: 'terminal', result: { state: 'succeeded' } };
  };
  const descriptor = Object.freeze({
    mode: 'explicit',
    contextToken: 'playlist-context',
    trackUids: Object.freeze(['occurrence-a', 'occurrence-c'])
  });
  const view = new LibraryView({ manager, uiManager: {} });
  view.detail = { type: 'playlist', key: 'playlist-1' };
  view.pagedState = { selectionProjection: { hasAny: true, selectedCount: 2 } };
  view.pagedController = {
    contextToken: 'playlist-context',
    isSelected: entityId => entityId === 'occurrence-c',
    getSelectionDescriptor: () => descriptor,
    getSelectedOrdinal: (entityId, ordinal) => {
      assert.equal(entityId, 'occurrence-c');
      assert.equal(ordinal, 41);
      return 1;
    }
  };
  view.pagedActionController = { track: request => request.start() };
  const occurrence = {
    trackUid: 'duplicate-track',
    playlistItemKey: 'occurrence-c',
    title: 'Duplicate'
  };

  const selectedIntent = view.createPagedTrackActionIntent(occurrence, 41);
  assert.equal(selectedIntent.currentOrdinal, 1);
  assert.deepEqual(selectedIntent.descriptor, descriptor);
  await view.startPagedActionIntent(selectedIntent, 'play');

  view.pagedController.isSelected = () => false;
  const singleIntent = view.createPagedTrackActionIntent(occurrence, 41);
  assert.equal(singleIntent.currentOrdinal, 0);
  assert.deepEqual(singleIntent.descriptor, {
    mode: 'explicit',
    contextToken: 'playlist-context',
    trackUids: ['occurrence-c']
  });
  await view.startPagedActionIntent(singleIntent, 'play');

  assert.deepEqual(calls, [
    ['play', descriptor, {
      options: { currentOrdinal: 1 }
    }],
    ['play', {
      mode: 'explicit', contextToken: 'playlist-context', trackUids: ['occurrence-c']
    }, {
      options: { currentOrdinal: 0 }
    }]
  ]);
});

test('playlist action bar uses the full context when no rows are selected', async () => {
  const calls = [];
  const manager = createPagedManager();
  manager.createOperationRequestId = () => `request-${calls.length + 1}`;
  manager.performSelectionAction = async (...args) => {
    calls.push(args);
    return { kind: 'terminal', result: { state: 'succeeded' } };
  };
  const view = new LibraryView({ manager, uiManager: {} });
  view.detail = { type: 'playlist', key: 'playlist-1', title: 'Whole playlist' };
  view.pagedController = {
    contextToken: 'playlist-context',
    dispatchRowAction: (_identity, callback) => ({ accepted: true, value: callback() })
  };
  view.pagedActionController = { track: request => request.start() };
  const state = {
    totalCount: 4,
    selectionProjection: { hasAny: false, selectedCount: 0 }
  };

  await view.startPagedSelectionAction(state, 'play', { options: { seed: 1234 } }).value;
  await view.startPagedSelectionAction(state, 'playNext').value;

  assert.deepEqual(calls, [
    ['play', { mode: 'all', contextToken: 'playlist-context', exclusions: [] }, {
      options: { seed: 1234 }
    }],
    ['playNext', { mode: 'all', contextToken: 'playlist-context', exclusions: [] }, {}]
  ]);
});

test('mobile ordinary actions target the full current context with zero selection', async () => {
  const body = { classList: { contains: name => name === 'layout-mobile' } };
  await withGlobals({ document: { body } }, async () => {
    const calls = [];
    const manager = createPagedManager();
    manager.createOperationRequestId = () => 'mobile-request';
    manager.performSelectionAction = async (...args) => {
      calls.push(args);
      return { kind: 'terminal', result: { state: 'succeeded' } };
    };
    const view = new LibraryView({ manager, uiManager: {} });
    view.currentView = 'tracks';
    view.pagedController = {
      contextToken: 'mobile-context',
      dispatchRowAction: (_identity, callback) => ({ accepted: true, value: callback() }),
      prepareSelectionAction: () => {
        throw new Error('ordinary mobile action must not require a selection');
      }
    };
    view.pagedActionController = { track: request => request.start() };
    const state = {
      phase: 'committed',
      totalCount: 4,
      selectionProjection: { hasAny: false, selectedCount: 0 }
    };
    view.pagedState = state;
    assert.deepEqual(view.createPagedTrackActionIntent({ trackUid: 'track-3' }, 3), {
      descriptor: {
        mode: 'explicit', contextToken: 'mobile-context', trackUids: ['track-3']
      },
      currentOrdinal: 0,
      targetName: ''
    });

    const action = view.startPagedSelectionAction(state, 'queue');
    assert.equal(action.accepted, true);
    await action.value;
    assert.deepEqual(calls, [[
      'queue',
      { mode: 'all', contextToken: 'mobile-context', exclusions: [] },
      {}
    ]]);
    assert.equal(Object.isFrozen(calls[0][1]), true);
    assert.equal(Object.isFrozen(calls[0][1].exclusions), true);
  });
});

test('mobile row actions ignore hidden selection outside selection mode', async () => {
  const body = { classList: { contains: name => name === 'layout-mobile' } };
  await withGlobals({ document: { body } }, async () => {
    const descriptor = Object.freeze({
      mode: 'explicit',
      contextToken: 'mobile-context',
      trackUids: Object.freeze(['track-1', 'track-3'])
    });
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.pagedController = {
      contextToken: 'mobile-context',
      isSelected: () => true,
      getSelectionDescriptor: () => descriptor,
      getSelectedOrdinal: () => 1,
      getSelectionProjection: () => ({ hasAny: true, selectedCount: 2 }),
      createViewState: () => ({
        selectionProjection: { hasAny: true, selectedCount: 2 }
      })
    };

    assert.deepEqual(view.createPagedTrackActionIntent({ trackUid: 'track-3' }, 3), {
      descriptor: {
        mode: 'explicit', contextToken: 'mobile-context', trackUids: ['track-3']
      },
      currentOrdinal: 0,
      targetName: ''
    });

    view.setPagedMobileSelectionActive(true);
    assert.equal(view.usesPagedContextAction({ totalCount: 4 }), false);
    assert.deepEqual(view.createPagedTrackActionIntent({ trackUid: 'track-3' }, 3), {
      descriptor,
      currentOrdinal: 1,
      targetName: ''
    });
  });
});

test('playlist action bar includes shuffle and enables whole-playlist actions without selection', () => {
  const controls = new PagedDomElement('div');
  return withGlobals({ document: { createElement: () => controls } }, () => {
    const manager = createPagedManager();
    manager.performSelectionAction = async () => ({ kind: 'terminal' });
    const view = new LibraryView({ manager, uiManager: {} });
    view.detail = { type: 'playlist', key: 'playlist-1', title: 'Whole playlist' };
    view.pagedController = {
      contextToken: 'playlist-context',
      getSelectionProjection: () => ({ hasAny: false, selectedCount: 0 })
    };
    view.pagedActionController = { state: { status: 'idle' } };

    const result = view.createPagedActionBar({
      totalCount: 4,
      selectionProjection: { hasAny: false, selectedCount: 0 },
      staleSelectionDescriptor: null,
      selectionRejection: null
    });

    assert.doesNotMatch(result.className, /library-playlist-actions/);
    assert.match(result.innerHTML, /library-paged-shuffle/);
    for (const action of ['play', 'shuffle', 'play-next', 'queue']) {
      assert.match(result.innerHTML, new RegExp(`library-paged-${action}"`));
      assert.doesNotMatch(result.innerHTML, new RegExp(`library-paged-${action}" disabled`));
    }
    assert.match(result.innerHTML, /library-paged-select-all/);
  });
});

test('newly rendered selection controls stay disabled while an action is busy', () => {
  const controls = new PagedDomElement('div');
  return withGlobals({ document: { createElement: () => controls } }, () => {
    const manager = createPagedManager();
    manager.performSelectionAction = async () => ({ kind: 'terminal' });
    const view = new LibraryView({ manager, uiManager: {} });
    view.pagedActionController = { state: { status: 'waiting' } };

    const result = view.createPagedActionBar({
      selectionProjection: { hasAny: true, selectedCount: 1 },
      staleSelectionDescriptor: null,
      selectionRejection: null
    });

    for (const action of ['play', 'play-next', 'queue', 'add-playlist']) {
      assert.match(result.innerHTML, new RegExp(`library-paged-${action}" disabled`));
    }
  });
});

test('playlist action bar controls re-enable when the durable action becomes terminal', () => {
  const controls = new Map(['play', 'shuffle', 'play-next', 'queue'].map(action => [
    `.library-paged-${action}`,
    { disabled: false }
  ]));
  const manager = createPagedManager();
  manager.performSelectionAction = async () => ({ kind: 'terminal' });
  const view = new LibraryView({ manager, uiManager: {} });
  view.content = {
    querySelector: selector => controls.get(selector) ?? null,
    querySelectorAll: () => []
  };
  view.detail = { type: 'playlist', key: 'playlist-1', title: 'Whole playlist' };
  view.pagedController = {
    contextToken: 'playlist-context',
    createViewState: () => ({
      totalCount: 4,
      selectionProjection: { hasAny: false, selectedCount: 0 }
    })
  };
  view.pagedActionController = { state: { status: 'waiting' } };

  view.refreshPagedActionAvailability();
  controls.forEach(control => assert.equal(control.disabled, true));

  view.pagedActionController.state = { status: 'terminal', terminalKind: 'succeeded' };
  view.refreshPagedActionAvailability();
  controls.forEach(control => assert.equal(control.disabled, false));
});

test('Playlists collection omits the misleading Export control while detail export remains', () => {
  const elements = [new PagedDomElement('div'), new PagedDomElement('div')];
  const document = { createElement: () => elements.shift() };
  return withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    const collection = view.createPagedPlaylistCollectionControls();
    assert.doesNotMatch(collection.innerHTML, /library-export-playlists|choosePlaylistToExport/);
    assert.match(collection.innerHTML, /library-import-playlist/);
    assert.match(collection.innerHTML, /library-new-playlist/);

    view.detail = { type: 'playlist', key: 'playlist-1', title: 'Daily' };
    const detail = view.createPagedPlaylistControls();
    assert.match(detail.innerHTML, /library-playlist-export-m3u8/);
    assert.match(detail.innerHTML, /library-playlist-export-xspf/);
  });
});

test('playlist collection controls are rendered only for the pure Playlists collection', async () => {
  const document = {
    activeElement: null,
    createElement: tagName => new PagedDomElement(tagName)
  };
  const window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1200 };
  await withGlobals({ document, window, requestAnimationFrame: callback => callback() }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = new PagedDomElement('main');
    view.root = new PagedDomElement('section');
    view.currentView = 'playlists';
    view.pagedController = {
      pageLimit: 200,
      firstPage: { isCurrent: () => true },
      getCachedRows: () => []
    };
    let controls = 0;
    view.createPagedPlaylistCollectionControls = () => {
      controls += 1;
      return new PagedDomElement('div');
    };
    const state = {
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      rows: [],
      totalCount: 0,
      currentPageIndex: 0,
      pageStartOrdinal: 0,
      nextCursor: null,
      previousCursor: null,
      selectionProjection: { hasAny: false, selectedCount: 0 }
    };

    view.pagedState = state;
    view.renderPagedCommitted(state);
    assert.equal(controls, 1);

    view.searchQuery = 'needle';
    view.searchEntityType = 'playlist';
    const searchState = { ...state, pageAttemptId: 2 };
    view.pagedState = searchState;
    view.renderPagedCommitted(searchState);
    assert.equal(controls, 1);
  });
});

test('paged track context menu restores playback, queue, playlist, and entity actions', async () => {
  const body = new PagedDomElement('body');
  body.classList = { contains: () => false };
  const menu = new PagedDomElement('div');
  menu.classList = { contains: () => false, add() {} };
  const document = {
    body,
    createElement: () => menu,
    addEventListener() {},
    removeEventListener() {}
  };
  await withGlobals({ document, window: { innerWidth: 800, innerHeight: 600 } }, async () => {
    const manager = createPagedManager();
    manager.performSelectionAction = async () => ({ kind: 'terminal' });
    const view = new LibraryView({ manager, uiManager: {} });
    view.pagedState = { phase: 'committed' };
    view.pagedController = {
      isSelected: () => true,
      createViewState: () => ({
        queryGeneration: 1,
        pageAttemptId: 1,
        selectionDescriptor: { mode: 'explicit', contextToken: 'context', trackUids: ['track-1'] }
      })
    };
    view.openPagedTrackContextMenu({
      preventDefault() {},
      clientX: 10,
      clientY: 20
    }, {
      trackUid: 'track-1',
      title: 'Song',
      artist: 'Artist',
      artistKey: 'artist-1',
      album: 'Album',
      albumKey: 'album-1'
    }, { ordinal: 4 });

    for (const action of ['play', 'next', 'queue', 'playlist', 'album', 'artist', 'properties']) {
      assert.match(menu.innerHTML, new RegExp(`data-action="${action}"`));
    }
  });
});

test('paged track properties hydrate complete metadata and the resolved Electron path', async () => {
  const calls = [];
  const closeButton = new PagedDomElement('button');
  const backdrop = new PagedDomElement('div');
  backdrop.querySelector = selector => selector === '.library-dialog-close' ? closeButton : null;
  backdrop.querySelectorAll = () => [closeButton];
  const body = new PagedDomElement('body');
  const document = {
    activeElement: null,
    body,
    createElement: () => backdrop,
    addEventListener() {},
    removeEventListener() {}
  };
  const manager = createPagedManager();
  manager.runtime = 'electron';
  manager.getTrack = async trackUid => {
    calls.push(['getTrack', trackUid]);
    return {
      trackUid,
      fileName: 'Song.flac',
      title: 'Detailed Song',
      artist: 'Artist',
      album: 'Album',
      genre: 'Rock',
      year: 2026,
      trackNo: 2,
      trackTotal: 10,
      durationSec: 125,
      codec: 'FLAC',
      sampleRate: 96000,
      bitsPerSample: 24,
      bitrate: 1411200
    };
  };
  manager.resolvePlaybackSource = async trackUid => {
    calls.push(['resolvePlaybackSource', trackUid]);
    return { kind: 'electron-file', path: 'D:\\Music\\Album\\Song.flac' };
  };

  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager, uiManager: {} });
    await view.showTrackProperties({ trackUid: 'track-one', title: 'Summary Song' });

    assert.match(backdrop.innerHTML, /Detailed Song/);
    assert.match(backdrop.innerHTML, /D:\\Music\\Album\\Song\.flac/);
    assert.match(backdrop.innerHTML, /2\/10/);
    assert.match(backdrop.innerHTML, /96000 Hz/);
    assert.match(backdrop.innerHTML, /24 bit/);
    assert.match(backdrop.innerHTML, /1411 kbps/);
  });
  assert.deepEqual(calls, [
    ['getTrack', 'track-one'],
    ['resolvePlaybackSource', 'track-one']
  ]);
});

test('paged track headers sort all v2.0 columns and toggle the active direction', () => {
  const buttons = ['title', 'artist', 'album', 'genre', 'duration'].map(sort => {
    const button = new PagedDomElement('button');
    button.dataset.sort = sort;
    return button;
  });
  const header = new PagedDomElement('div');
  header.querySelectorAll = selector => selector === '[data-sort]' ? buttons : [];
  const document = { createElement: () => header };
  return withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    const renders = [];
    view.render = () => renders.push([view.sort, view.sortDirection]);

    view.createPagedTrackHeader();
    buttons.find(button => button.dataset.sort === 'genre').listeners.get('click')();
    buttons.find(button => button.dataset.sort === 'genre').listeners.get('click')();
    buttons.find(button => button.dataset.sort === 'duration').listeners.get('click')();

    assert.deepEqual(renders, [
      ['genre', 'asc'],
      ['genre', 'desc'],
      ['duration', 'asc']
    ]);
  });
});

test('paged track double-click and focused Enter variants reach playback through the production manager contract', async () => {
  const tracks = [
    { trackUid: 'duplicate-track', playlistItemKey: 'occurrence-a', itemKey: 1, title: 'Track One' },
    { trackUid: 'duplicate-track', playlistItemKey: 'occurrence-b', itemKey: 2, title: 'Track Two' },
    { trackUid: 'track-3', playlistItemKey: 'occurrence-c', itemKey: 3, title: 'Track Three' }
  ];
  const track = tracks[1];
  const operationRequests = [];
  let requestNumber = 0;
  const client = {
    async getCounts() { return { tracks: tracks.length }; },
    async createContext() { return { contextToken: 'context-1', totalCount: tracks.length }; },
    async queryTracks({ contextToken }) {
      return {
        rows: tracks, nextCursor: null, previousCursor: null, totalCount: tracks.length,
        catalogVersion: 1, contextToken
      };
    },
    async queryEntities() { return { rows: [] }; },
    async releaseContext() {},
    async getTrack() { return track; },
    async close() {}
  };
  const manager = new LibraryManagerV2({
    catalogClientFactory: async () => ({
      client,
      runtime: 'electron',
      bulkOperationService: {
        async start(request) {
          operationRequests.push(request);
          return { kind: 'terminal', result: { state: 'succeeded' } };
        }
      }
    }),
    clientRequestIdFactory: () => `request-${++requestNumber}`
  });
  await manager.init();

  const row = new PagedDomElement('div');
  const checkbox = new PagedDomElement('input');
  const controls = new Map([
    ['.library-paged-select', checkbox]
  ]);
  row.querySelector = selector => controls.get(selector) ?? null;
  const document = { createElement: () => row };

  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager, uiManager: {} });
    view.currentView = 'playlists';
    view.detail = { type: 'playlist', key: 'playlist-1', title: 'Duplicates' };
    view.content = new PagedDomElement('main');
    view.pagedController = new PagedLibraryViewController({ manager, runtime: 'electron' });
    await view.pagedController.start({
      endpoint: 'tracks', query: '', sort: 'title', direction: 'asc', scope: { playlistId: 'playlist-1' }
    });
    const state = view.pagedController.createViewState();
    view.pagedState = state;
    view.createPagedRow(track, 1, state, true);

    row.listeners.get('dblclick')({ target: { closest: () => null } });
    await Promise.resolve();

    view.pagedFocusedOrdinal = 1;
    view.pagedFocusedEntityId = track.playlistItemKey;
    view.pagedController.toggleSelection('occurrence-a', true, { ordinal: 0 });
    view.pagedController.toggleSelection('occurrence-b', true, { ordinal: 1 });
    let prevented = 0;
    const pressEnter = async modifiers => {
      view.handleContentKeyDown({
        key: 'Enter',
        target: view.content,
        ...modifiers,
        preventDefault() { prevented += 1; }
      });
      await new Promise(resolve => setImmediate(resolve));
    };
    await pressEnter({});
    await pressEnter({ shiftKey: true });
    await pressEnter({ ctrlKey: true, shiftKey: true });
    await pressEnter({ metaKey: true });

    assert.equal(prevented, 4);
    const focusedDescriptor = {
      mode: 'explicit', contextToken: 'context-1', trackUids: ['occurrence-b']
    };
    assert.deepEqual(operationRequests, [
      {
        operationKind: 'play',
        selectionDescriptor: {
          mode: 'all', contextToken: 'context-1', exclusions: []
        },
        target: {},
        options: { currentOrdinal: 1 }
      },
      {
        operationKind: 'play',
        selectionDescriptor: focusedDescriptor,
        target: {},
        options: { currentOrdinal: 0 }
      },
      {
        operationKind: 'playNext',
        selectionDescriptor: focusedDescriptor,
        target: {},
        options: {}
      },
      {
        operationKind: 'queue',
        selectionDescriptor: focusedDescriptor,
        target: {},
        options: {}
      },
      {
        operationKind: 'queue',
        selectionDescriptor: focusedDescriptor,
        target: {},
        options: {}
      }
    ]);
    view.pagedActionController.close();
  });
  await manager.close();
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

test('first committed page publishes its segmented DOM only after rows are ready', async () => {
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
    const content = new PagedDomElement('main');
    const replaceChildren = content.replaceChildren.bind(content);
    let rowCountAtPublish = -1;
    content.replaceChildren = (...children) => {
      const pending = [...children];
      while (pending.length) {
        const element = pending.shift();
        if (element.className === 'library-paged-row-layer') {
          rowCountAtPublish = element.children.length;
          break;
        }
        pending.push(...element.children);
      }
      replaceChildren(...children);
    };
    view.content = content;
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
    assert.equal(rowCountAtPublish, 1);
    assert.equal(view.content.attributes.get('aria-busy'), 'false');
    assert.equal(view.content.attributes.has('aria-rowcount'), false);
    assert.equal(view.content.children[0].dataset.pageAttemptId, '1');
    const gridRoot = view.content.children[0].children.find(child => (
      child.className === 'library-paged-semantic-grid'
    ));
    assert.equal(gridRoot.attributes.get('role'), 'grid');
    assert.equal(gridRoot.attributes.get('aria-multiselectable'), 'true');
    assert.equal(gridRoot.attributes.get('aria-rowcount'), '1000002');
    assert.equal(gridRoot.children[0].attributes.get('role'), 'row');
    assert.equal(gridRoot.children[0].attributes.get('aria-rowindex'), '1');
    assert.equal(gridRoot.children[1].attributes.get('role'), 'presentation');
    const rowGroup = gridRoot.children[1].children.find(child => (
      child.className === 'library-paged-row-layer'
    ));
    assert.equal(rowGroup.attributes.get('role'), 'rowgroup');
  });
});

test('Search commits keep library content mounted for unchanged and changed rows', async () => {
  const document = {
    activeElement: null,
    createElement: tagName => new PagedDomElement(tagName)
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1200
  };
  let activeGeneration = 1;
  let currentTrack = { trackUid: 'track-1', title: 'One' };
  await withGlobals({ document, window, requestAnimationFrame: callback => callback() }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    const content = new PagedDomElement('main');
    const originalReplaceChildren = content.replaceChildren.bind(content);
    let publishCount = 0;
    content.replaceChildren = (...children) => {
      publishCount += 1;
      originalReplaceChildren(...children);
    };
    const descendants = () => {
      const found = [];
      const pending = [...content.children];
      while (pending.length) {
        const element = pending.shift();
        found.push(element);
        pending.push(...element.children);
      }
      return found;
    };
    const matches = (element, selector) => selector.split(',').some(part => {
      const className = part.trim().match(/^\.([\w-]+)/)?.[1];
      return className && String(element.className || '').split(' ').includes(className);
    });
    content.querySelectorAll = selector => descendants().filter(element => matches(element, selector));
    content.querySelector = selector => content.querySelectorAll(selector)[0] ?? null;
    view.content = content;
    view.root = new PagedDomElement('section');
    view.currentView = 'tracks';
    view.searchQuery = 'artist';
    view.pagedController = {
      pageLimit: 200,
      firstPage: {
        isCurrent: (generation, attempt) => generation === activeGeneration && attempt === 1
      },
      getCachedRows: () => [{ ordinal: 0, row: currentTrack }],
      ensureOrdinal: async () => ({ accepted: true }),
      createAnchor: value => value,
      isSelected: () => false
    };
    view.createPagedActionBar = () => new PagedDomElement('div');
    view.createPagedSearchEntitySections = () => {
      const container = new PagedDomElement('section');
      container.className = 'library-paged-search-entities';
      return container;
    };
    view.createPagedRow = (row, ordinal, state) => {
      const element = new PagedDomElement('div');
      element.className = 'library-paged-row';
      element.dataset.entityId = row.trackUid;
      element.dataset.trackId = row.trackUid;
      element.dataset.ordinal = String(ordinal);
      element.dataset.queryGeneration = String(state.queryGeneration);
      element.dataset.pageAttemptId = String(state.pageAttemptId);
      return element;
    };
    view.refreshPagedSelectionState = () => {};
    let entityRefreshCount = 0;
    view.refreshPagedSearchEntitySections = () => { entityRefreshCount += 1; };
    const createState = generation => ({
      phase: 'committed',
      queryGeneration: generation,
      pageAttemptId: 1,
      rows: [currentTrack],
      totalCount: 1,
      ariaBusy: false,
      ariaRowCount: 1,
      currentPageIndex: 0,
      pageStartOrdinal: 0,
      nextCursor: null,
      previousCursor: null,
      selectionDescriptor: { mode: 'explicit', contextToken: `context-${generation}`, trackUids: [] }
    });
    const firstState = createState(1);
    view.pagedState = firstState;
    view.renderPagedCommitted(firstState);
    const firstShell = content.children[0];
    const firstRow = content.querySelector('.library-paged-row');
    const firstScrollCleanup = view.trackScrollCleanup;

    activeGeneration = 2;
    view.searchQuery = 'artist name';
    view.syncNowPlayingTrack = () => {};
    view.renderPagedLibrary = () => {};
    view.renderStatus = () => {};
    view.render();
    assert.equal(view.trackScrollCleanup, firstScrollCleanup);
    const loading = {
      phase: 'loading', queryGeneration: 2, pageAttemptId: 1,
      rows: [], totalCount: { pending: true }, ariaBusy: true, ariaRowCount: -1
    };
    view.pagedState = loading;
    view.renderPagedState(loading);
    assert.equal(content.querySelector('.library-paged-row'), firstRow);
    assert.equal(firstRow.attributes.has('aria-hidden'), false);
    assert.equal(firstRow.inert, undefined);
    assert.equal(firstShell.inert, true);
    const secondState = createState(2);
    view.pagedState = secondState;
    view.renderPagedState(secondState);

    assert.equal(publishCount, 1);
    assert.equal(content.children[0], firstShell);
    assert.equal(content.querySelector('.library-paged-row'), firstRow);
    assert.equal(firstShell.dataset.queryGeneration, '2');
    assert.equal(firstRow.dataset.queryGeneration, '2');
    assert.equal(firstRow.inert, false);
    assert.equal(entityRefreshCount, 1);
    assert.equal(view.pagedPublishedState.queryGeneration, 2);

    activeGeneration = 3;
    currentTrack = { trackUid: 'track-2', title: 'Two' };
    view.searchQuery = 'different';
    view.render();
    const nextLoading = { ...loading, queryGeneration: 3 };
    view.pagedState = nextLoading;
    view.renderPagedState(nextLoading);
    assert.equal(content.querySelector('.library-paged-row'), firstRow);
    assert.equal(firstRow.attributes.has('aria-hidden'), false);
    assert.equal(firstShell.inert, true);
    const thirdState = createState(3);
    view.pagedState = thirdState;
    view.renderPagedState(thirdState);

    assert.equal(publishCount, 1);
    assert.equal(content.children[0], firstShell);
    assert.notEqual(content.querySelector('.library-paged-row'), firstRow);
    assert.equal(content.querySelector('.library-paged-row').dataset.entityId, 'track-2');
  });
});

test('zero-result track Search hides bulk actions and the track header', async () => {
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
    view.searchQuery = 'missing';
    view.createPagedSearchEntitySections = () => new PagedDomElement('section');
    view.pagedController = {
      pageLimit: 200,
      firstPage: { isCurrent: () => true },
      getCachedRows: () => []
    };
    let actionBarCalls = 0;
    let trackHeaderCalls = 0;
    view.createPagedActionBar = () => {
      actionBarCalls += 1;
      return new PagedDomElement('div');
    };
    view.createPagedTrackHeader = () => {
      trackHeaderCalls += 1;
      return new PagedDomElement('div');
    };
    const state = {
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      rows: [],
      totalCount: 0,
      ariaBusy: false,
      currentPageIndex: 0,
      pageStartOrdinal: 0,
      nextCursor: null,
      previousCursor: null,
      selectionDescriptor: { mode: 'explicit', contextToken: 'context', trackUids: [] }
    };
    view.pagedState = state;

    view.renderPagedCommitted(state);

    assert.equal(actionBarCalls, 0);
    assert.equal(trackHeaderCalls, 0);
    const gridRoot = view.content.children[0].children.find(child => (
      child.className === 'library-paged-semantic-grid'
    ));
    assert.equal(gridRoot.attributes.get('aria-rowcount'), '0');
  });
});

test('pagination failures reuse one retry region and success clears it', async () => {
  const regions = [];
  const retry = new PagedDomElement('button');
  const document = {
    createElement: tagName => {
      const region = new PagedDomElement(tagName);
      region.querySelector = selector => (
        selector === '.library-paged-pagination-retry' ? retry : null
      );
      region.remove = () => {
        const index = regions.indexOf(region);
        if (index >= 0) regions.splice(index, 1);
      };
      return region;
    }
  };
  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = {
      appendChild(region) { regions.push(region); },
      querySelector: selector => (
        selector === '.library-paged-pagination-error' ? regions[0] ?? null : null
      ),
      querySelectorAll: selector => (
        selector === '.library-paged-pagination-error' ? [...regions] : []
      )
    };
    const retried = [];
    view.ensurePagedOrdinal = ordinal => {
      retried.push(ordinal);
      return Promise.resolve({ accepted: true });
    };

    view.showPagedPaginationFailure(20);
    view.showPagedPaginationFailure(40);
    assert.equal(regions.length, 1);
    retry.listeners.get('click')();
    await Promise.resolve();
    assert.deepEqual(retried, [40]);

    view.clearPagedPaginationFailure();
    assert.equal(regions.length, 0);
    assert.equal(view.pagedPaginationFailureOrdinal, null);
  });
});

test('paged ARIA announcements use the localized entity type and Back has an accessible name', () => {
  const document = { createElement: tagName => new PagedDomElement(tagName) };
  return withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.currentView = 'albums';
    view.pagedController = {
      firstPage: { isCurrent: () => true }
    };
    const shell = view.createPagedAttemptShell({
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      totalCount: 12,
      liveAnnouncementId: 'albums-12'
    });
    assert.equal(shell.children[0].textContent, '12 Albums');

    view.detail = { type: 'album', key: 'album-1', title: 'One' };
    const header = view.createPagedSectionHeader({ rows: [] }, 0, true);
    assert.match(header.innerHTML, /aria-label="Previous"/);
    assert.match(header.innerHTML, /title="Previous"/);
  });
});

test('paged collection pages start at the page top and preserve scroll across rerenders', async () => {
  let gridOffsetTop = 160;
  const document = {
    activeElement: null,
    createElement(tagName) {
      const element = new PagedDomElement(tagName);
      Object.defineProperty(element, 'offsetTop', {
        configurable: true,
        get() {
          return this.className?.includes('library-paged-grid') ? gridOffsetTop : 0;
        }
      });
      return element;
    }
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1200
  };
  await withGlobals({ document, window, requestAnimationFrame: callback => callback() }, async () => {
    for (const currentView of ['tracks', 'albums']) {
      gridOffsetTop = 160;
      const isTrackQuery = currentView === 'tracks';
      const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
      view.content = new PagedDomElement('main');
      view.root = new PagedDomElement('section');
      view.currentView = currentView;
      const publishPagedAttemptDom = view.publishPagedAttemptDom.bind(view);
      view.publishPagedAttemptDom = (state, shell) => {
        const published = publishPagedAttemptDom(state, shell);
        view.content.scrollTop = 0;
        view.content.listeners.get('scroll')?.();
        return published;
      };
      view.preparePagedArtworkLoader = () => {};
      view.pagedController = {
        pageLimit: 200,
        firstPage: { isCurrent: () => true },
        getCachedRows(start, end) {
          return Array.from({ length: end - start }, (_, index) => {
            const ordinal = start + index;
            const row = isTrackQuery
              ? { trackUid: `track-${ordinal}`, title: `Track ${ordinal}` }
              : { albumKey: `album-${ordinal}`, name: `Album ${ordinal}` };
            return { ordinal, row };
          });
        },
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
        rows: [isTrackQuery
          ? { trackUid: 'track-0', title: 'Track 0' }
          : { albumKey: 'album-0', name: 'Album 0' }],
        totalCount: 1_000,
        ariaBusy: false,
        ariaRowCount: 1_000,
        currentPageIndex: 0,
        pageStartOrdinal: 0,
        nextCursor: 'next',
        previousCursor: null,
        selectionDescriptor: isTrackQuery
          ? { mode: 'explicit', contextToken: 'context', trackUids: [] }
          : null
      };
      view.pagedState = state;

      view.renderPagedCommitted(state);
      assert.equal(view.content.scrollTop, 0, `${currentView} initial scroll`);

      const queryFingerprint = JSON.stringify(view.getPagedQuery());
      view.pagedQueryKey = queryFingerprint;
      view.content.scrollHeight = 100_000;
      view.pagedContentScrollTop = 0;
      view.pagedNavigationRestorePosition = {
        queryFingerprint,
        contentScrollTop: 430
      };
      view.renderPagedCommitted(state);
      assert.equal(view.content.scrollTop, 430, `${currentView} retained navigation scroll`);
      assert.equal(view.pagedNavigationRestorePosition, null);

      for (const scrollTop of [80, 430]) {
        view.content.scrollTop = scrollTop;
        view.content.listeners.get('scroll')();
        view.renderPagedCommitted(state);
        assert.equal(view.content.scrollTop, scrollTop, `${currentView} rerendered scroll at ${scrollTop}`);
      }
      gridOffsetTop = 220;
      view.renderPagedCommitted(state);
      assert.equal(view.content.scrollTop, 430, `${currentView} scroll after content above the catalog changed`);
    }
  });
});

test('paged track scrolling returns from the final virtual segment to the first page', async () => {
  const rowCount = 5_000_000;
  const document = {
    activeElement: null,
    createElement: tagName => new PagedDomElement(tagName)
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1200
  };
  const requestedOrdinals = [];
  await withGlobals({ document, window, requestAnimationFrame: callback => callback() }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = new PagedDomElement('main');
    view.root = new PagedDomElement('section');
    view.currentView = 'tracks';
    view.pagedViewportOrdinal = rowCount - 1;
    view.pagedResetScrollOnCommit = false;
    view.preparePagedArtworkLoader = () => {};
    view.pagedController = {
      pageLimit: 200,
      firstPage: { isCurrent: (generation, attempt) => generation === 1 && attempt === 1 },
      getCachedRows(start, end) {
        const coveredStart = Math.max(start, rowCount - 200);
        const coveredEnd = Math.min(end, rowCount);
        return Array.from({ length: Math.max(0, coveredEnd - coveredStart) }, (_, index) => {
          const ordinal = coveredStart + index;
          return { ordinal, row: { trackUid: `track-${ordinal}`, title: `Track ${ordinal}` } };
        });
      },
      async ensureOrdinal(ordinal) {
        requestedOrdinals.push(ordinal);
        return { accepted: true, ordinal };
      },
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
      rows: [{ trackUid: `track-${rowCount - 1}`, title: 'Last track' }],
      totalCount: rowCount,
      ariaBusy: false,
      ariaRowCount: rowCount,
      currentPageIndex: Math.floor((rowCount - 1) / 200),
      pageStartOrdinal: rowCount - 200,
      nextCursor: null,
      previousCursor: 'previous',
      selectionDescriptor: { mode: 'explicit', contextToken: 'context', trackUids: [] }
    };
    view.pagedState = state;
    view.renderPagedCommitted(state);
    assert.deepEqual(requestedOrdinals, []);

    view.content.scrollTop = 0;
    view.content.listeners.get('scroll')();
    await Promise.resolve();

    assert.equal(view.pagedViewportOrdinal, 0);
    assert.equal(view.content.scrollTop, 0);
    assert.deepEqual(requestedOrdinals, [0]);
  });
});

test('paged entity grids request the first missing row anywhere in the rendered range', async () => {
  const document = {
    activeElement: null,
    createElement: tagName => new PagedDomElement(tagName)
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1200
  };
  const requestedOrdinals = [];
  await withGlobals({ document, window, requestAnimationFrame: callback => callback() }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = new PagedDomElement('main');
    view.root = new PagedDomElement('section');
    view.currentView = 'albums';
    view.preparePagedArtworkLoader = () => {};
    view.pagedController = {
      pageLimit: 200,
      firstPage: { isCurrent: (generation, attempt) => generation === 1 && attempt === 1 },
      getCachedRows(start, end) {
        return Array.from({ length: end - start }, (_, index) => start + index)
          .filter(ordinal => ordinal !== 1)
          .map(ordinal => ({
            ordinal,
            row: { albumKey: `album-${ordinal}`, name: `Album ${ordinal}` }
          }));
      },
      async ensureOrdinal(ordinal) {
        requestedOrdinals.push(ordinal);
        return { accepted: true, ordinal };
      },
      createAnchor: value => value,
      getSelectionDescriptor: () => null,
      isSelected: () => false
    };
    view.createPagedActionBar = () => new PagedDomElement('div');
    view.createPagedRow = () => new PagedDomElement('div');
    const state = {
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      rows: Array.from({ length: 200 }, (_, ordinal) => ({
        albumKey: `album-${ordinal}`,
        name: `Album ${ordinal}`
      })),
      totalCount: 1_000,
      ariaBusy: false,
      ariaRowCount: 1_000,
      currentPageIndex: 0,
      pageStartOrdinal: 0,
      nextCursor: 'next',
      previousCursor: null,
      selectionDescriptor: null
    };
    view.pagedState = state;

    view.renderPagedCommitted(state);

    assert.deepEqual(requestedOrdinals, [1]);
  });
});

test('paged track scrolling fills partial and empty viewports without reloading visible rows', async () => {
  const rowCount = 7_977;
  const pageLimit = 200;
  const loadedStart = 1_190;
  const requestedOrdinals = [];
  const renderedOrdinals = [];
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
    view.pagedViewportOrdinal = loadedStart;
    view.pagedResetScrollOnCommit = false;
    view.pagedScrollToAnchorOnCommit = true;
    view.preparePagedArtworkLoader = () => {};
    view.pagedController = {
      pageLimit,
      firstPage: { isCurrent: (generation, attempt) => generation === 1 && attempt === 1 },
      getCachedRows(start, end) {
        const coveredStart = Math.max(start, loadedStart);
        const coveredEnd = Math.min(end, loadedStart + pageLimit);
        return Array.from({ length: Math.max(0, coveredEnd - coveredStart) }, (_, index) => {
          const ordinal = coveredStart + index;
          return { ordinal, row: { trackUid: `track-${ordinal}`, title: `Track ${ordinal}` } };
        });
      },
      async ensureOrdinal(ordinal) {
        requestedOrdinals.push(ordinal);
        return { accepted: true, ordinal };
      },
      createAnchor: value => value,
      getSelectionDescriptor: () => ({ mode: 'explicit', contextToken: 'context', trackUids: [] }),
      isSelected: () => false
    };
    view.createPagedActionBar = () => new PagedDomElement('div');
    view.createPagedRow = (_row, ordinal) => {
      renderedOrdinals.push(ordinal);
      return new PagedDomElement('div');
    };
    const state = {
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      rows: Array.from({ length: pageLimit }, (_, index) => ({
        trackUid: `track-${loadedStart + index}`,
        title: `Track ${loadedStart + index}`
      })),
      totalCount: rowCount,
      ariaBusy: false,
      ariaRowCount: rowCount,
      currentPageIndex: Math.floor(loadedStart / pageLimit),
      pageStartOrdinal: loadedStart,
      nextCursor: 'next',
      previousCursor: 'previous',
      selectionDescriptor: { mode: 'explicit', contextToken: 'context', trackUids: [] }
    };
    view.pagedState = state;
    view.renderPagedCommitted(state);
    assert.ok(renderedOrdinals.length > 0);

    const scrollTo = async targetOrdinal => {
      requestedOrdinals.length = 0;
      renderedOrdinals.length = 0;
      view.content.scrollTop = targetOrdinal * view.getTrackRowHeight();
      view.content.listeners.get('scroll')();
      await Promise.resolve();
      assert.equal(view.pagedViewportOrdinal, targetOrdinal);
    };

    await scrollTo(1_185);
    assert.ok(renderedOrdinals.length > 0);
    assert.ok(renderedOrdinals.every(ordinal => ordinal >= loadedStart));
    assert.equal(requestedOrdinals.length, 1);
    assert.ok(requestedOrdinals[0] < 1_185);
    assert.ok(requestedOrdinals[0] + pageLimit > 1_185);

    await scrollTo(1_000);
    assert.deepEqual(renderedOrdinals, []);
    assert.equal(requestedOrdinals.length, 1);
    assert.ok(requestedOrdinals[0] < 1_000);
    assert.ok(requestedOrdinals[0] + pageLimit > 1_000);

    await scrollTo(1_200);
    assert.ok(renderedOrdinals.includes(1_200));
    assert.deepEqual(requestedOrdinals, []);
  });
});

test('paged track scrolling reuses overlapping row elements', async () => {
  const rowCount = 1_000;
  const items = Array.from({ length: rowCount }, (_, ordinal) => ({
    trackUid: `track-${ordinal}`,
    title: `Track ${ordinal}`
  }));
  const document = {
    activeElement: null,
    createElement: tagName => new PagedDomElement(tagName)
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 480
  };
  await withGlobals({ document, window, requestAnimationFrame: callback => callback() }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = new PagedDomElement('main');
    view.root = new PagedDomElement('section');
    view.currentView = 'tracks';
    view.pagedViewportOrdinal = 0;
    view.pagedResetScrollOnCommit = false;
    view.preparePagedArtworkLoader = () => {};
    view.createPagedActionBar = () => new PagedDomElement('div');
    let createdRows = 0;
    const rowElements = new Map();
    view.createPagedRow = row => {
      createdRows += 1;
      const element = new PagedDomElement('div');
      element._pagedItem = row;
      element.tabIndex = row.trackUid === view.pagedFocusedEntityId ? 0 : -1;
      rowElements.set(row.trackUid, element);
      return element;
    };
    view.pagedController = {
      pageLimit: 200,
      firstPage: { isCurrent: (generation, attempt) => generation === 1 && attempt === 1 },
      getCachedRows(start, end) {
        return items.slice(start, end).map((row, index) => ({ ordinal: start + index, row }));
      },
      prefetchAroundOrdinal: async () => ({ accepted: true, prefetched: false }),
      createAnchor: value => value,
      getSelectionDescriptor: () => ({ mode: 'explicit', contextToken: 'context', trackUids: [] }),
      isSelected: () => false
    };
    const state = {
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      rows: items.slice(0, 200),
      totalCount: rowCount,
      ariaBusy: false,
      ariaRowCount: rowCount,
      currentPageIndex: 0,
      pageStartOrdinal: 0,
      nextCursor: 'next',
      previousCursor: null,
      selectionDescriptor: { mode: 'explicit', contextToken: 'context', trackUids: [] }
    };
    view.pagedState = state;
    view.renderPagedCommitted(state);
    const initialCreatedRows = createdRows;

    view.content.scrollTop = view.getTrackRowHeight();
    view.content.listeners.get('scroll')();
    assert.equal(createdRows - initialCreatedRows, 1);

    view.content.listeners.get('scroll')();
    assert.equal(createdRows - initialCreatedRows, 1);

    view.content.scrollTop = 12 * view.getTrackRowHeight();
    view.content.listeners.get('scroll')();
    assert.equal(view.pagedFocusedEntityId, 'track-2');
    assert.equal(rowElements.get('track-2').tabIndex, 0);
  });
});

test('mobile paged track scrolling reads two pages ahead in the current direction', async () => {
  const pageLimit = 200;
  const prefetches = [];
  const document = {
    activeElement: null,
    body: { classList: { contains: name => name === 'layout-mobile' } },
    createElement: tagName => new PagedDomElement(tagName)
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 480
  };
  await withGlobals({ document, window, requestAnimationFrame: callback => callback() }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = new PagedDomElement('main');
    view.root = new PagedDomElement('section');
    view.currentView = 'tracks';
    view.pagedViewportOrdinal = 0;
    view.pagedResetScrollOnCommit = false;
    view.preparePagedArtworkLoader = () => {};
    view.createPagedActionBar = () => new PagedDomElement('div');
    view.createPagedRow = () => new PagedDomElement('div');
    view.pagedController = {
      pageLimit,
      firstPage: { isCurrent: (generation, attempt) => generation === 1 && attempt === 1 },
      getCachedRows(start, end) {
        return Array.from({ length: Math.max(0, Math.min(pageLimit, end) - Math.max(0, start)) }, (_, index) => {
          const ordinal = Math.max(0, start) + index;
          return { ordinal, row: { trackUid: `track-${ordinal}` } };
        });
      },
      prefetchAroundOrdinal(ordinal, options) {
        prefetches.push({ ordinal, ...options });
        return Promise.resolve({ accepted: true, prefetched: false });
      },
      createAnchor: value => value,
      getSelectionDescriptor: () => ({ mode: 'explicit', contextToken: 'context', trackUids: [] }),
      isSelected: () => false
    };
    const state = {
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      rows: Array.from({ length: pageLimit }, (_, ordinal) => ({ trackUid: `track-${ordinal}` })),
      totalCount: 1_000,
      ariaBusy: false,
      ariaRowCount: 1_000,
      currentPageIndex: 0,
      pageStartOrdinal: 0,
      nextCursor: 'next',
      previousCursor: null,
      selectionDescriptor: { mode: 'explicit', contextToken: 'context', trackUids: [] }
    };
    view.pagedState = state;
    view.renderPagedCommitted(state);

    view.content.scrollTop = 20 * view.getTrackRowHeight();
    view.content.listeners.get('scroll')();
    view.content.scrollTop = 5 * view.getTrackRowHeight();
    view.content.listeners.get('scroll')();
    await Promise.resolve();

    assert.deepEqual(prefetches, [
      { ordinal: 0, direction: 1, pageCount: 2 },
      { ordinal: 20, direction: 1, pageCount: 2 },
      { ordinal: 5, direction: -1, pageCount: 2 }
    ]);
  });
});

test('rapid scrollbar dragging publishes completed intermediate reads and renders the final position', async () => {
  const rowCount = 5_000_000;
  const pageLimit = 200;
  const finalOrdinal = rowCount - 1;
  const pageFor = ordinal => {
    const pageStartOrdinal = Math.min(
      rowCount - pageLimit,
      ordinal
    );
    return {
      rows: Array.from({ length: pageLimit }, (_, index) => ({
        trackUid: `track-${pageStartOrdinal + index}`,
        title: `Track ${pageStartOrdinal + index}`
      })),
      pageStartOrdinal,
      totalCount: rowCount,
      nextCursor: pageStartOrdinal + pageLimit < rowCount ? 'next' : null,
      previousCursor: pageStartOrdinal > 0 ? 'previous' : null
    };
  };
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
    const manager = createPagedManager();
    manager.queryTracks = async () => pageFor(0);
    manager.queryEntities = async () => pageFor(0);
    const pendingPages = new Map();
    const requestedOrdinals = [];
    let cachePublishes = 0;
    let setup = true;
    const view = new LibraryView({ manager, uiManager: {} });
    view.content = new PagedDomElement('main');
    view.root = new PagedDomElement('section');
    view.currentView = 'tracks';
    view.preparePagedArtworkLoader = () => {};
    view.createPagedActionBar = () => new PagedDomElement('div');
    view.createPagedRow = (row, ordinal) => {
      const element = new PagedDomElement('div');
      element.dataset.ordinal = String(ordinal);
      element.dataset.entityId = row.trackUid;
      element._pagedItem = row;
      return element;
    };
    const controller = new PagedLibraryViewController({
      manager,
      pageLimit,
      onStateChange: state => {
        view.pagedState = state;
        view.renderPagedState(state);
      },
      onCacheChange: () => {
        cachePublishes += 1;
        view.refreshPagedWindow?.();
      },
      seekOrdinal: request => {
        requestedOrdinals.push(request.ordinal);
        if (setup) return pageFor(request.ordinal);
        const pending = createDeferred();
        pendingPages.set(request.ordinal, pending);
        return pending.promise;
      }
    });
    view.pagedController = controller;
    await controller.start({ endpoint: 'tracks', query: '', sort: 'title', direction: 'asc' });

    view.pagedViewportOrdinal = finalOrdinal;
    view.pagedResetScrollOnCommit = false;
    view.pagedScrollToAnchorOnCommit = true;
    await controller.seekToOrdinal(finalOrdinal);
    setup = false;
    requestedOrdinals.length = 0;

    assert.ok(view.pagedViewportOrdinal >= rowCount - pageLimit);

    view.content.scrollTop = 1;
    view.content.listeners.get('scroll')();
    const intermediateVisibleOrdinal = view.pagedViewportOrdinal;
    assert.ok(
      intermediateVisibleOrdinal > 0 && intermediateVisibleOrdinal < finalOrdinal,
      `expected an intermediate ordinal, received ${intermediateVisibleOrdinal} at scrollTop ${view.content.scrollTop}`
    );
    assert.equal(requestedOrdinals.length, 1);
    const [backwardReadOrdinal] = requestedOrdinals;
    assert.ok(backwardReadOrdinal < intermediateVisibleOrdinal);
    assert.ok(backwardReadOrdinal + pageLimit > intermediateVisibleOrdinal);

    view.content.scrollTop = 0;
    view.content.listeners.get('scroll')();
    pendingPages.get(backwardReadOrdinal).resolve(pageFor(backwardReadOrdinal));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(requestedOrdinals, [backwardReadOrdinal, 0]);
    assert.equal(cachePublishes, 1);
    assert.deepEqual(controller.getCachedRows(intermediateVisibleOrdinal, intermediateVisibleOrdinal + 1), [{
      ordinal: intermediateVisibleOrdinal,
      row: {
        trackUid: `track-${intermediateVisibleOrdinal}`,
        title: `Track ${intermediateVisibleOrdinal}`
      }
    }]);

    pendingPages.get(0).resolve(pageFor(0));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(controller.currentPageIndex, 0);
    assert.equal(view.pagedViewportOrdinal, 0);
    assert.equal(view.content.scrollTop, 0);
    assert.deepEqual(controller.getCachedRows(0, 1), [{
      ordinal: 0,
      row: { trackUid: 'track-0', title: 'Track 0' }
    }]);
    await controller.destroy();
  });
});

test('non-navigation updates preserve the exact library scroll position', () => {
  const content = {
    scrollTop: 320
  };
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.content = content;

  view.preserveContentScroll(() => {
    content.scrollTop = 0;
  });

  assert.equal(content.scrollTop, 320);

  const focusTarget = {
    focus(options) {
      this.options = options;
      content.scrollTop = 0;
    }
  };
  view.focusWithoutContentScroll(focusTarget);

  assert.equal(content.scrollTop, 320);
  assert.deepEqual(focusTarget.options, { preventScroll: true });
});

test('short playback actions do not add status UI or change the library scroll position', () => {
  let appended = 0;
  const content = {
    scrollTop: 500,
    querySelector(selector) {
      if (selector === '.library-paged-attempt') {
        return { appendChild() { appended += 1; } };
      }
      return null;
    },
    querySelectorAll() { return []; }
  };
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.content = content;
  view.refreshPagedActionAvailability = () => {};
  const active = { status: 'starting', actionToken: 1 };
  view.pagedActionController = { state: active };

  view.handlePagedActionStateChange(active);

  const succeeded = {
    status: 'terminal', terminalKind: 'succeeded', actionToken: 1
  };
  view.pagedActionController.state = succeeded;
  view.handlePagedActionStateChange(succeeded);

  assert.equal(content.scrollTop, 500);
  assert.equal(appended, 0);
  assert.equal(view.pagedActionToastVisible, false);
  assert.equal(view.pagedActionToastTimer, null);
});

test('current-session action tracking does not require cross-session operation lookup', () => {
  const manager = {
    ...createPagedManager(),
    async getLibraryOperationStatus() { return null; },
    async cancelLibraryOperation() { return { kind: 'cancelled' }; },
    subscribeLibraryOperation() { return () => {}; }
  };
  const view = new LibraryView({ manager, uiManager: {} });

  assert.ok(view.pagedActionController);
  assert.equal(typeof manager.lookupLibraryOperation, 'undefined');
  view.pagedActionController.close();
});

test('queue replacement Undo stays in session status across later actions and toast dismissal', async () => {
  let undoAvailable = false;
  let undoCalls = 0;
  const manager = {
    ...createPagedManager(),
    canUndoPlaybackSession() { return undoAvailable; },
    async undoPlaybackSession() {
      undoCalls += 1;
      undoAvailable = false;
      return { kind: 'published' };
    }
  };
  const document = { createElement: tagName => new PagedDomElement(tagName) };
  await withGlobals({ document }, async () => {
    const view = new LibraryView({ manager, uiManager: {} });
    const status = new PagedDomElement('footer');
    let statusMarkup = '';
    Object.defineProperty(status, 'innerHTML', {
      configurable: true,
      get() { return statusMarkup; },
      set(value) {
        statusMarkup = value;
        this.children = [];
      }
    });
    status.querySelector = selector => selector === '.library-status-queue-undo'
      ? status.children.find(child => child.className.includes('library-status-queue-undo')) ?? null
      : null;
    view.status = status;
    view.syncContentScrollbarInset = () => {};
    view.renderStatus = () => {};

    undoAvailable = true;
    const playSucceeded = {
      status: 'terminal', terminalKind: 'succeeded', operationKind: 'play', actionToken: 1
    };
    view.pagedActionController = { state: playSucceeded };
    view.handlePagedActionStateChange(playSucceeded);
    await view.renderPagedStatus();
    let undoButton = status.querySelector('.library-status-queue-undo');
    assert.equal(undoButton.textContent, 'Undo Queue Replace');

    for (const [actionToken, operationKind] of [[2, 'playNext'], [3, 'queue'], [4, 'addToPlaylist'], [5, 'importPlaylist']]) {
      const succeeded = { status: 'terminal', terminalKind: 'succeeded', operationKind, actionToken };
      view.pagedActionController.state = succeeded;
      view.handlePagedActionStateChange(succeeded);
      view.pagedActionToastVisible = false;
      await view.renderPagedStatus();
      undoButton = status.querySelector('.library-status-queue-undo');
      assert.ok(undoButton, `${operationKind} must not hide the queue Undo`);
    }

    await undoButton.listeners.get('click')();
    assert.equal(undoCalls, 1);
    assert.equal(view.queueUndoAvailable, false);
    await view.renderPagedStatus();
    assert.equal(status.querySelector('.library-status-queue-undo'), null);
  });
});

test('failed playback actions use a non-layout terminal toast without Retry', () => {
  let toast = null;
  const content = {
    querySelector(selector) {
      if (selector === '[data-library-paged-action-toast]') return toast;
      if (selector === '.library-paged-attempt') {
        return { appendChild(element) { toast = element; } };
      }
      return null;
    },
    querySelectorAll() { return []; }
  };
  const document = { createElement: tagName => new PagedDomElement(tagName) };

  return withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = content;
    view.refreshPagedActionAvailability = () => {};
    const failed = {
      status: 'terminal',
      terminalKind: 'failed',
      operationKind: 'play'
    };
    view.pagedActionController = { state: failed };

    view.handlePagedActionStateChange(failed);

    assert.equal(toast.className, 'library-paged-action-toast');
    assert.doesNotMatch(toast.innerHTML, /library-paged-action-toast-retry/);
    assert.doesNotMatch(toast.innerHTML, /library\.job\.phase|Request received/);
  });
});

test('current-session action toast localizes known progress without exposing internal text', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  const toast = new PagedDomElement('section');
  const known = {
    status: 'active',
    operationKind: 'addToPlaylist',
    phase: 'MATERIALIZING',
    processed: 12,
    total: 20,
    message: 'internal operation detail',
    canCancel: true
  };

  view.updatePagedActionToast(toast, known);

  assert.match(toast.innerHTML, /Writing items/);
  assert.match(toast.innerHTML, /12 \/ 20/);
  assert.doesNotMatch(toast.innerHTML, /MATERIALIZING|internal operation detail/);

  view.updatePagedActionToast(toast, {
    ...known,
    phase: 'INTERNAL_PHASE',
    processed: 13,
    total: null
  });
  assert.match(toast.innerHTML, /13 processed/);
  assert.doesNotMatch(toast.innerHTML, /INTERNAL_PHASE/);
});

test('paged row focus restoration does not undo wheel or touch scrolling', async () => {
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
      firstPage: { isCurrent: () => true },
      getCachedRows(start, end) {
        return Array.from({ length: end - start }, (_, index) => {
          const ordinal = start + index;
          return { ordinal, row: { trackUid: `track-${ordinal}`, title: `Track ${ordinal}` } };
        });
      },
      ensureOrdinal: async () => ({ accepted: true }),
      createAnchor: value => value,
      getSelectionDescriptor: () => ({ mode: 'explicit', contextToken: 'context', trackUids: [] }),
      isSelected: () => false
    };
    view.createPagedActionBar = () => new PagedDomElement('div');
    view.createPagedRow = (_row, ordinal, state) => {
      const row = new PagedDomElement('div');
      row.className = 'library-paged-row';
      row.dataset.entityId = `track-${ordinal}`;
      row.dataset.queryGeneration = String(state.queryGeneration);
      row.dataset.pageAttemptId = String(state.pageAttemptId);
      row.closest = selector => selector === '.library-paged-row' ? row : null;
      return row;
    };
    const state = {
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      rows: [{ trackUid: 'track-0', title: 'Track 0' }],
      totalCount: 1_000,
      ariaBusy: false,
      ariaRowCount: 1_000,
      currentPageIndex: 0,
      pageStartOrdinal: 0,
      nextCursor: 'next',
      previousCursor: null,
      selectionDescriptor: { mode: 'explicit', contextToken: 'context', trackUids: [] }
    };
    view.pagedState = state;
    view.renderPagedCommitted(state);

    const shell = view.content.children[0];
    const grid = shell.children.flatMap(child => (
      child.className === 'library-paged-semantic-grid' ? child.children : [child]
    )).find(child => child.className?.split?.(' ').includes('library-paged-grid'));
    const rowLayer = grid.children.find(child => child.className === 'library-paged-row-layer');
    rowLayer.contains = row => rowLayer.children.includes(row);
    rowLayer.querySelectorAll = selector => selector === '.library-paged-row' ? rowLayer.children : [];
    document.activeElement = rowLayer.children[0];
    view.content.scrollTop = 80;

    view.content.listeners.get('scroll')();

    assert.equal(view.content.scrollTop, 80);
    assert.deepEqual(rowLayer.children[0].focusOptions, { preventScroll: true });
  });
});

test('replacement loading cancels stale scroll work before it can seek without a context', async () => {
  const document = {
    activeElement: null,
    createElement: tagName => new PagedDomElement(tagName)
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1200
  };
  let activeGeneration = 1;
  let scheduledFrame = null;
  const cancelledFrames = [];
  let seekCount = 0;
  await withGlobals({
    document,
    window,
    requestAnimationFrame(callback) {
      scheduledFrame = callback;
      return 41;
    },
    cancelAnimationFrame(frameId) {
      cancelledFrames.push(frameId);
    }
  }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = new PagedDomElement('main');
    view.root = new PagedDomElement('section');
    view.currentView = 'tracks';
    view.pagedController = {
      pageLimit: 200,
      firstPage: {
        isCurrent: (generation, attempt) => generation === activeGeneration && attempt === 1
      },
      getCachedRows(start, end) {
        if (start >= 200) return [];
        return Array.from({ length: Math.min(200, end) - start }, (_, index) => {
          const ordinal = start + index;
          return { ordinal, row: { trackUid: `track-${ordinal}`, title: `Track ${ordinal}` } };
        });
      },
      async ensureOrdinal() {
        seekCount += 1;
        return { accepted: true };
      },
      createAnchor: value => value,
      getSelectionDescriptor: () => ({ mode: 'explicit', contextToken: 'context-0', trackUids: [] }),
      isSelected: () => false
    };
    view.createPagedActionBar = () => new PagedDomElement('div');
    view.createPagedRow = () => new PagedDomElement('div');
    const committed = {
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      rows: [{ trackUid: 'track-0', title: 'Track 0' }],
      totalCount: 1_000,
      ariaBusy: false,
      ariaRowCount: 1_000,
      currentPageIndex: 0,
      pageStartOrdinal: 0,
      nextCursor: 'next',
      previousCursor: null,
      selectionDescriptor: { mode: 'explicit', contextToken: 'context-0', trackUids: [] }
    };
    view.pagedState = committed;
    view.renderPagedCommitted(committed);
    view.content.scrollTop = 10_000;
    view.content.listeners.get('scroll')();

    activeGeneration = 2;
    const loading = {
      phase: 'loading',
      queryGeneration: 2,
      pageAttemptId: 1,
      rows: [],
      totalCount: { pending: true },
      ariaBusy: true,
      ariaRowCount: -1
    };
    view.pagedState = loading;
    view.renderPagedState(loading);

    assert.deepEqual(cancelledFrames, [41]);
    scheduledFrame();
    assert.equal(seekCount, 0);
  });
});

test('paged album cards reserve enough virtual row height for square artwork', async () => {
  const document = {
    activeElement: null,
    createElement: tagName => new PagedDomElement(tagName)
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 320
  };
  await withGlobals({ document, window, requestAnimationFrame: callback => callback() }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.content = new PagedDomElement('main');
    view.content.clientWidth = 320;
    view.root = new PagedDomElement('section');
    view.currentView = 'albums';
    view.pagedController = {
      pageLimit: 200,
      firstPage: { isCurrent: (generation, attempt) => generation === 1 && attempt === 1 },
      getCachedRows: () => [{ ordinal: 0, row: { albumKey: 'album-1', name: 'One' } }],
      ensureOrdinal: async () => ({ accepted: true }),
      createAnchor: value => value
    };
    view.createPagedRow = () => new PagedDomElement('div');
    const state = {
      phase: 'committed',
      queryGeneration: 1,
      pageAttemptId: 1,
      rows: [{ albumKey: 'album-1', name: 'One' }],
      totalCount: 1,
      ariaBusy: false,
      ariaRowCount: 1,
      currentPageIndex: 0,
      pageStartOrdinal: 0,
      nextCursor: null,
      previousCursor: null,
      selectionDescriptor: null
    };
    view.pagedState = state;

    view.renderPagedCommitted(state);

    const shell = view.content.children[0];
    const grid = shell.children.find(child => child.className?.includes('library-paged-grid'));
    const rowLayer = grid.children.find(child => child.className === 'library-paged-row-layer');
    assert.equal(rowLayer.children[0].style.height, '384px');
    assert.equal(rowLayer.children[0].style.left, '0%');
    assert.equal(rowLayer.children[0].style.width, '100%');
  });
});

const PAGED_ARTWORK_DETAIL_CASES = [
  ['album', 'albums', 'albumKey'],
  ['artist', 'artists', 'artistKey'],
  ['genre', 'genres', 'genreKey'],
  ['subfolder', 'subfolders', 'subfolderKey']
];

for (const [detailType] of PAGED_ARTWORK_DETAIL_CASES) {
  test(`paged ${detailType} detail completes artwork loading after virtual rows reset their loader`, async () => {
    const header = new PagedDomElement('div');
    const artwork = new PagedDomElement('div');
    const backButton = new PagedDomElement('button');
    header.querySelector = selector => ({
      '.library-paged-detail-artwork': artwork,
      '.library-back': backButton
    })[selector] ?? null;
    const artworkResult = createDeferred();
    const calls = [];
    const document = {
      createElement(tagName) {
        return tagName === 'img' ? new PagedDomElement('img') : header;
      }
    };
    artwork.ownerDocument = document;
    const artworkUrl = `blob:${detailType}-artwork`;
    const urlApi = {
      createObjectURL(blob) {
        calls.push(['create-url', blob.type]);
        return artworkUrl;
      },
      revokeObjectURL(url) {
        calls.push(['revoke-url', url]);
      }
    };

    await withGlobals({ document, URL: urlApi }, async () => {
      const manager = createPagedManager();
      manager.getArtworkThumbBlob = (trackUid, options) => {
        calls.push(['load', trackUid, options]);
        return artworkResult.promise;
      };
      const view = new LibraryView({ manager, uiManager: {} });
      view.detail = {
        type: detailType,
        key: `${detailType}-1`,
        title: `${detailType} One`,
        representativeTrackUid: `track-${detailType}-artwork`
      };
      view.pagedArtworkLoader = view.createPagedArtworkLoader();
      view.pagedDetailArtworkLoader = view.createPagedArtworkLoader();
      view.navigateBack = () => calls.push(['back']);

      const result = view.createPagedSectionHeader({ rows: [] }, 12, true);
      view.pagedArtworkLoader.resetTargets();
      artworkResult.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      assert.equal(result, header);
      assert.equal(header.className, 'library-detail-head library-paged-detail-head');
      assert.match(header.innerHTML, /library-paged-detail-artwork/);
      assert.match(header.innerHTML, /12/);
      assert.deepEqual(calls, [
        ['load', `track-${detailType}-artwork`, { reason: 'viewport' }],
        ['create-url', 'image/jpeg']
      ]);
      assert.equal(artwork.children.length, 1);
      assert.equal(artwork.children[0].tagName, 'IMG');
      assert.equal(artwork.children[0].src, artworkUrl);
      backButton.listeners.get('click')();
      assert.deepEqual(calls.at(-1), ['back']);
      view.destroyPagedArtworkLoader();
      assert.deepEqual(calls.at(-1), ['revoke-url', artworkUrl]);
    });
  });
}

for (const [detailType, currentView, keyField] of PAGED_ARTWORK_DETAIL_CASES) {
  test(`paged ${detailType} cards preserve the representative artwork track when opened`, async () => {
    const row = new PagedDomElement('div');
    const artwork = new PagedDomElement('span');
    const openButton = new PagedDomElement('button');
    const playButton = new PagedDomElement('button');
    row.querySelector = selector => ({
      '.library-paged-artwork': artwork,
      '.library-paged-entity-open': openButton,
      '.library-card-play': playButton
    })[selector] ?? null;

    await withGlobals({ document: { createElement: () => row } }, async () => {
      const manager = createPagedManager();
      manager.performSelectionAction = async () => ({ kind: 'terminal' });
      const view = new LibraryView({ manager, uiManager: {} });
      view.currentView = currentView;
      view.pagedController = {
        dispatchRowAction: (_identity, callback) => ({ accepted: true, value: callback() })
      };
      view.pagedArtworkLoader = { observe() {} };
      let openedDetail = null;
      view.navigateToDetail = detail => { openedDetail = detail; };
      const detailKey = `${detailType}-1`;

      view.createPagedRow({
        [keyField]: detailKey,
        name: `${detailType} One`,
        representativeTrackUid: `track-${detailType}-artwork`
      }, 0, { queryGeneration: 1, pageAttemptId: 1 }, false);
      openButton.listeners.get('click')();

      assert.deepEqual(openedDetail, {
        type: detailType,
        key: detailKey,
        title: `${detailType} One`,
        representativeTrackUid: `track-${detailType}-artwork`
      });
    });
  });
}

test('paged media card Play opens the entity filter before starting playback', async () => {
  const row = new PagedDomElement('div');
  const artwork = new PagedDomElement('span');
  const openButton = new PagedDomElement('button');
  const playButton = new PagedDomElement('button');
  const controls = new Map([
    ['.library-paged-artwork', artwork],
    ['.library-paged-entity-open', openButton],
    ['.library-card-play', playButton]
  ]);
  row.querySelector = selector => controls.get(selector) ?? null;
  const document = { createElement: () => row };

  await withGlobals({ document }, async () => {
    const manager = createPagedManager();
    manager.performSelectionAction = async () => ({ kind: 'terminal' });
    const view = new LibraryView({ manager, uiManager: {} });
    const calls = [];
    view.currentView = 'artists';
    view.pagedController = {
      dispatchRowAction: (_identity, callback) => ({ accepted: true, value: callback() })
    };
    view.pagedArtworkLoader = {
      observe: (element, artworkId) => calls.push(['artwork', element, artworkId])
    };
    view.navigateToDetail = detail => calls.push(['open', detail]);
    view.startPagedEntityPlay = (entityType, entity) => calls.push(['play', entityType, entity]);

    const item = {
      artistKey: 'artist-1',
      name: 'Artist One',
      trackCount: 42,
      representativeTrackUid: 'track-1'
    };
    const card = view.createPagedRow(item, 4, {
      queryGeneration: 3,
      pageAttemptId: 2,
      totalCount: 12
    }, false);

    assert.match(card.className, /library-paged-media-card/);
    assert.equal(card.attributes.get('role'), 'listitem');
    assert.equal(card.attributes.get('aria-posinset'), '5');
    assert.equal(card.attributes.get('aria-setsize'), '12');
    assert.equal(card.tabIndex, undefined);
    assert.match(card.innerHTML, /class="library-paged-artwork"/);
    assert.match(card.innerHTML, /<button[^>]+class="library-paged-entity-open/);
    assert.match(card.innerHTML, /class="library-card-play" tabindex="-1"/);
    assert.match(card.innerHTML, /class="library-card-play"/);
    assert.match(card.innerHTML, /class="library-card-subtitle">42 tracks<\/span>/);
    assert.deepEqual(calls[0], ['artwork', artwork, 'track-1']);

    openButton.listeners.get('focus')();
    assert.equal(view.pagedFocusedOrdinal, 4);
    assert.equal(view.pagedFocusedEntityId, 'artist-1');
    openButton.listeners.get('click')();
    assert.deepEqual(calls[1], ['open', {
      type: 'artist', key: 'artist-1', title: 'Artist One', representativeTrackUid: 'track-1'
    }]);

    let stopped = 0;
    playButton.listeners.get('keydown')({ stopPropagation: () => { stopped += 1; } });
    playButton.listeners.get('click')({ stopPropagation: () => { stopped += 1; } });
    assert.equal(stopped, 2);
    assert.deepEqual(calls.slice(2), [
      ['open', {
        type: 'artist', key: 'artist-1', title: 'Artist One', representativeTrackUid: 'track-1'
      }],
      ['play', 'artist', item]
    ]);

    view.currentView = 'subfolders';
    const subfolderCard = view.createPagedRow({
      subfolderKey: 'subfolder-1',
      name: 'Album',
      caption: 'Music / Artist/Album',
      trackCount: 10
    }, 5, { queryGeneration: 3, pageAttemptId: 2 }, false);
    assert.match(subfolderCard.innerHTML, /class="library-paged-entity-title library-card-title">Album<\/span>/);
    assert.match(subfolderCard.innerHTML, /class="library-card-subtitle">Music \/ Artist\/Album · 10 tracks<\/span>/);

    view.currentView = 'playlists';
    view.uiManager = {
      t(key) {
        if (key === 'library.playlist.system.favorites') return 'お気に入り';
        if (key === 'library.status.tracks') return 'tracks';
        if (key === 'library.action.play') return 'Play';
        return key;
      }
    };
    const favoritesCard = view.createPagedRow({
      id: 'system_favorites',
      name: 'Favorites',
      itemCount: 7
    }, 0, { queryGeneration: 3, pageAttemptId: 2, totalCount: 3 }, false);
    assert.match(favoritesCard.className, /\blibrary-system-playlist-card\b/);
    assert.match(favoritesCard.innerHTML, /library-system-playlist-artwork/);
    assert.match(favoritesCard.innerHTML, /library-system-playlist-icon/);
    assert.match(favoritesCard.innerHTML, />お気に入り<\/span>/);
    assert.match(favoritesCard.innerHTML, /class="library-card-play"/);
  });
});

test('paged card Play uses a scoped session selection and releases its context', async () => {
  const calls = [];
  const manager = createPagedManager();
  manager.createOperationRequestId = () => 'request-1';
  manager.createContext = async request => {
    calls.push(['createContext', request]);
    return 'album-context';
  };
  manager.performSelectionAction = async (operationKind, selectionDescriptor, request) => {
    calls.push(['performSelectionAction', operationKind, selectionDescriptor, request]);
    return { kind: 'started', operationId: 'operation-1' };
  };
  manager.releaseContext = async contextToken => {
    calls.push(['releaseContext', contextToken]);
  };
  const view = new LibraryView({ manager, uiManager: {} });
  view.pagedActionController = {
    track: async request => {
      calls.push(['track', request.clientRequestId, request.operationKind, request.targetName]);
      return request.start();
    }
  };

  assert.deepEqual(await view.startPagedEntityPlay('album', { albumKey: 'album-1', name: 'Album One' }), {
    kind: 'started',
    operationId: 'operation-1'
  });
  assert.deepEqual(calls, [
    ['track', undefined, 'play', 'Album One'],
    ['createContext', {
      endpoint: 'tracks', query: '', sort: 'album', direction: 'asc', scope: { albumKey: 'album-1' }
    }],
    ['performSelectionAction', 'play', {
      mode: 'all', contextToken: 'album-context', exclusions: []
    }, undefined]
  ]);

  view.handlePagedActionStateChange({ status: 'terminal', operationId: 'operation-1' });
  assert.deepEqual(calls.at(-1), ['releaseContext', 'album-context']);
  assert.equal(view.pagedOperationContexts.size, 0);
});

test('paged card Play scopes albums, artists, genres, subfolders, and playlists', async () => {
  const scopes = [];
  const manager = createPagedManager();
  manager.createOperationRequestId = () => `request-${scopes.length + 1}`;
  manager.createContext = async request => {
    scopes.push(request.scope);
    return `context-${scopes.length}`;
  };
  manager.performSelectionAction = async () => ({
    kind: 'terminal',
    result: { state: 'succeeded' }
  });
  manager.releaseContext = async () => {};
  const view = new LibraryView({ manager, uiManager: {} });
  view.pagedActionController = { track: request => request.start() };
  const cards = [
    ['album', { albumKey: 'album-1', name: 'Album' }, { albumKey: 'album-1' }],
    ['artist', { artistKey: 'artist-1', name: 'Artist' }, { artistKey: 'artist-1' }],
    ['genre', { genreKey: 'genre-1', name: 'Genre' }, { genreKey: 'genre-1' }],
    ['subfolder', { subfolderKey: 'subfolder-1', name: 'Subfolder' }, { subfolderKey: 'subfolder-1' }],
    ['playlist', { id: 'playlist-1', name: 'Playlist' }, { playlistId: 'playlist-1' }]
  ];

  for (const [entityType, entity] of cards) {
    await view.startPagedEntityPlay(entityType, entity);
  }
  assert.deepEqual(scopes, cards.map(([, , scope]) => scope));
  assert.deepEqual(await view.startPagedEntityPlay('folder', { folderId: 'folder-1' }), {
    kind: 'unavailable'
  });
  assert.equal(scopes.length, cards.length);
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
  assert.deepEqual(getPagedInvalidationDecision({
    endpoint: 'entities',
    entityType: 'album'
  }, {
    changedScopes: ['artwork']
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

test('folder invalidation expires offscreen browse pages before visible-query early return', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.currentView = 'artists';
  view.searchQuery = 'needle';
  view.searchEntityType = 'artist';
  view.pagedQueryKey = 'show-all-query';
  view.renderPagedNav = () => {};
  view.renderPagedStatus = () => {};
  const targetKey = 'folder-1\0Parent';
  const otherKey = 'folder-2\0Parent';
  const cached = key => ({
    folderBrowseState: {
      key,
      browseGeneration: view.folderBrowseGeneration,
      children: [{ name: 'Stale', directTrackCount: 1, recursiveTrackCount: 1 }],
      cursor: null,
      hasMore: false,
      nodeExists: true
    }
  });
  view.folderNavigationPositions.set(targetKey, cached(targetKey));
  view.folderNavigationPositions.set(otherKey, cached(otherKey));

  view.handleCatalogInvalidation({ changedScopes: ['folder:folder-1'] });

  assert.equal(view.pagedQueryKey, 'show-all-query');
  assert.equal(view.folderNavigationPositions.has(targetKey), false);
  assert.equal(view.folderNavigationPositions.has(otherKey), true);

  const generation = view.folderBrowseGeneration;
  view.handleCatalogInvalidation({ changedScopes: ['tracks'] });
  assert.equal(view.folderBrowseGeneration, generation + 1);
  assert.equal(view.folderNavigationPositions.size, 0);
});

test('Search summary invalidation includes Albums, Artists, and Playlists previews', () => {
  assert.deepEqual(getPagedInvalidationDecision({
    endpoint: 'tracks',
    scope: null
  }, {
    changedScopes: ['playlist:other']
  }, [
    { endpoint: 'entities', entityType: 'album' },
    { endpoint: 'entities', entityType: 'artist' },
    { endpoint: 'entities', entityType: 'playlist' }
  ]), {
    restart: true,
    reason: 'visible-scope-changed',
    changedScope: 'playlist:other'
  });

  const calls = [];
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.searchQuery = 'needle';
  view.pagedQueryKey = 'search-query';
  view.capturePagedAnchor = () => calls.push('anchor');
  view.pagedController = { markSelectionStale: () => calls.push('stale') };
  view.scheduleRender = () => calls.push('render');

  view.handleCatalogInvalidation({ changedScopes: ['playlist:other'] });

  assert.equal(view.pagedQueryKey, null);
  assert.deepEqual(calls, ['anchor', 'stale', 'render']);
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

test('anchor restoration publishes only the restored page without a top-page rewind', async () => {
  const manager = createPagedManager();
  manager.queryEntities = async request => ({
    rows: [{ albumKey: 'album-0', name: 'First' }],
    nextCursor: 'next',
    previousCursor: null,
    totalCount: 1_000,
    catalogVersion: 1,
    contextToken: request.contextToken,
    pageStartOrdinal: 0
  });
  manager.resolveEntityAnchor = async request => ({
    accepted: true,
    entityId: 'album-800',
    ordinal: 800,
    pageStartOrdinal: 800,
    page: {
      rows: [{ albumKey: 'album-800', name: 'Restored' }],
      nextCursor: 'next-restored',
      previousCursor: 'previous-restored',
      totalCount: 1_000,
      catalogVersion: 1,
      contextToken: request.contextToken,
      pageStartOrdinal: 800
    }
  });
  const view = new LibraryView({ manager, uiManager: {} });
  view.currentView = 'albums';
  const queryFingerprint = JSON.stringify(view.getPagedQuery());
  view.pagedAnchor = {
    queryFingerprint,
    entityId: 'album-800',
    canonicalTuple: ['album-800'],
    viewportOffsetPx: 32,
    focusKey: 'album-800'
  };
  view.pagedContentScrollTop = 12_345;
  const rendered = [];
  view.renderPagedNav = () => {};
  view.markPagedRowsInert = () => {};
  view.renderPagedState = state => rendered.push({
    source: 'state', phase: state.phase, pageStartOrdinal: state.pageStartOrdinal
  });
  view.renderPagedCommitted = state => rendered.push({
    source: 'committed',
    phase: state.phase,
    pageStartOrdinal: state.pageStartOrdinal,
    viewportOrdinal: view.pagedViewportOrdinal,
    viewportOffsetPx: view.pagedViewportOffsetPx
  });

  view.renderPagedLibrary(view.renderVersion);
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();

  assert.equal(rendered.some(entry => entry.phase === 'committed' && entry.pageStartOrdinal === 0), false);
  assert.deepEqual(rendered.at(-1), {
    source: 'committed',
    phase: 'committed',
    pageStartOrdinal: 800,
    viewportOrdinal: 800,
    viewportOffsetPx: 32
  });
  assert.equal(view.pagedContentScrollTop, 12_345);
  await view.pagedController.destroy();
});

test('anchor restoration failures are contained and leave the committed page usable', async () => {
  const errors = [];
  await withGlobals({ console: { error: (...args) => errors.push(args) } }, async () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    const committedState = { phase: 'committed', pageStartOrdinal: 0 };
    view.pagedQueryKey = 'active-query';
    view.pagedController = {
      async restoreAnchor() { throw new Error('restore failed'); },
      createViewState() { return committedState; }
    };
    const rendered = [];
    view.renderPagedCommitted = state => rendered.push(state);

    const result = await view.restorePagedAnchor();

    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'restore-failed');
    assert.equal(view.pagedAnchorRestoreInProgress, false);
    assert.deepEqual(rendered, [committedState]);
  });
  assert.equal(errors.length, 1);
});

test('paged keyboard navigation uses entity open buttons while preserving text editing controls', () => {
  const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
  view.content = { clientHeight: 400 };
  view.pagedState = { phase: 'committed', totalCount: 1_000_000 };
  view.pagedFocusedOrdinal = 40_000;
  const calls = [];
  view.movePagedFocus = (delta, options) => { calls.push(['move', delta, options]); };
  view.seekPagedBoundary = (key, options) => { calls.push(['boundary', key, options]); };
  view.activatePagedFocused = () => calls.push(['activate']);
  view.togglePagedFocusedSelection = options => calls.push(['toggle', options]);
  view.focusPagedByPrefix = prefix => calls.push(['prefix', prefix]);
  view.getTrackRowHeight = () => 40;
  view.getPagedQuery = () => ({ endpoint: 'tracks' });
  view.renderPagedCommitted = () => {};

  let prevented = 0;
  const textInput = {
    tagName: 'INPUT',
    type: 'search',
    closest(selector) { return selector.includes('input') ? this : null; }
  };
  view.handleContentKeyDown({ key: 'Home', target: textInput, preventDefault() { prevented += 1; } });
  view.handleContentKeyDown({
    key: 'a', ctrlKey: true, target: textInput,
    preventDefault() { prevented += 1; }
  });
  assert.equal(prevented, 0);
  assert.deepEqual(calls, []);

  const row = { dataset: { queryGeneration: '1', pageAttemptId: '1' } };
  const createRowButton = className => ({
    tagName: 'BUTTON',
    className,
    closest(selector) {
      if (selector === '.library-paged-row') return row;
      if (selector === '.library-paged-entity-open') {
        return className === 'library-paged-entity-open' ? this : null;
      }
      return selector.includes('button') ? this : null;
    }
  });
  view.pagedController = {
    dispatchRowAction(_identity, callback) { return { accepted: true, value: callback() }; },
    selectAll() { calls.push(['selectAll']); },
    createViewState() { return view.pagedState; }
  };
  const playButton = createRowButton('library-card-play');
  view.handleContentKeyDown({ key: 'ArrowDown', target: playButton, preventDefault() { prevented += 1; } });
  assert.equal(prevented, 0);
  assert.deepEqual(calls, []);

  const entityOpenButton = createRowButton('library-paged-entity-open');
  view.handleContentKeyDown({
    key: 'ArrowDown', target: entityOpenButton,
    preventDefault() { prevented += 1; }
  });
  view.handleContentKeyDown({
    key: 'Home', target: entityOpenButton,
    preventDefault() { prevented += 1; }
  });
  view.handleContentKeyDown({
    key: 'End', shiftKey: true, target: entityOpenButton,
    preventDefault() { prevented += 1; }
  });
  view.handleContentKeyDown({
    key: 'r', target: entityOpenButton,
    preventDefault() { prevented += 1; }, stopPropagation() {}
  });
  view.handleContentKeyDown({
    key: 'a', ctrlKey: true, target: entityOpenButton,
    preventDefault() { prevented += 1; }
  });

  view.handleContentKeyDown({ key: 'PageDown', target: view.content, shiftKey: true, preventDefault() { prevented += 1; } });
  view.handleContentKeyDown({ key: ' ', target: view.content, shiftKey: false, preventDefault() { prevented += 1; } });
  view.handleContentKeyDown({ key: 'Enter', target: view.content, preventDefault() { prevented += 1; } });
  assert.deepEqual(calls, [
    ['move', 1, { extend: false }],
    ['boundary', 'Home', { extend: false }],
    ['boundary', 'End', { extend: true }],
    ['prefix', 'r'],
    ['selectAll'],
    ['move', 10, { extend: true }],
    ['toggle', { extend: false }],
    ['activate']
  ]);
  assert.equal(prevented, 8);
});

test('paged keyboard command failures are contained behind a generic localized message', async () => {
  const exposed = [];
  const logged = [];
  const secret = new Error('D:\\Private\\Music\\secret.flac failed');
  const view = new LibraryView({
    manager: createPagedManager(),
    uiManager: {
      t: key => key,
      setError(message) { exposed.push(message); }
    }
  });
  view.content = { clientHeight: 400 };
  view.pagedState = { phase: 'committed', totalCount: 1 };
  view.pagedController = {
    createViewState: () => ({ phase: 'committed' }),
    dispatchRowAction(_state, callback) {
      return { accepted: true, value: callback() };
    },
    async home() { throw secret; }
  };

  await withGlobals({ console: { error: (...args) => logged.push(args) } }, async () => {
    view.handleContentKeyDown({
      key: 'Home',
      target: view.content,
      preventDefault() {}
    });
    await new Promise(resolve => setImmediate(resolve));
  });

  assert.deepEqual(exposed, ['The Music Library could not complete this action. Please try again.']);
  assert.doesNotMatch(exposed[0], /Private|secret\.flac/);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][1], secret);
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
    async previewImport(value) {
      calls.push(['preview', value]);
      return {
        previewToken: 'preview-1',
        playlistId: 'playlist-1',
        playlistName: 'Million',
        totalCount: 2,
        resolvedCount: 2,
        unresolvedCount: 0,
        unresolvedItems: []
      };
    },
    async commitImport(preview) {
      calls.push(['commit', preview.previewToken]);
      return { playlistId: preview.playlistId, playlistName: preview.playlistName };
    },
    async cancelImportPreview(preview) {
      calls.push(['cancel', preview.previewToken]);
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
    ['preview', file],
    ['commit', 'preview-1'],
    ['navigate', { type: 'playlist', key: 'playlist-1', title: 'Million' }]
  ]);
});

test('paged playlist import cancels hidden staging when confirmation is declined', async () => {
  const calls = [];
  const preview = {
    previewToken: 'preview-1',
    playlistId: 'playlist-1',
    playlistName: 'Declined',
    totalCount: 1,
    resolvedCount: 1,
    unresolvedCount: 0,
    unresolvedItems: []
  };
  const manager = createPagedManager();
  manager.playlists = {
    async previewImport(source) {
      calls.push(['preview', source]);
      return preview;
    },
    async commitImport() {
      assert.fail('declined imports must not publish the staged playlist');
    },
    async cancelImportPreview(received) {
      calls.push(['cancel', received.previewToken]);
    }
  };
  const view = new LibraryView({ manager, uiManager: {} });
  view.confirmPlaylistImport = received => {
    calls.push(['confirm', received.playlistName]);
    return false;
  };

  assert.equal(await view.importPagedPlaylistSource('source'), null);
  assert.deepEqual(calls, [
    ['preview', 'source'],
    ['confirm', 'Declined'],
    ['cancel', 'preview-1']
  ]);
});

test('paged playlist import cancels hidden staging when commit fails', async () => {
  const calls = [];
  const preview = {
    previewToken: 'preview-2',
    playlistId: 'playlist-2',
    playlistName: 'Failed',
    totalCount: 1,
    resolvedCount: 1,
    unresolvedCount: 0,
    unresolvedItems: []
  };
  const manager = createPagedManager();
  manager.playlists = {
    async previewImport() { return preview; },
    async commitImport() {
      calls.push(['commit']);
      throw new Error('commit failed');
    },
    async cancelImportPreview(received) {
      calls.push(['cancel', received.previewToken]);
    }
  };
  const view = new LibraryView({ manager, uiManager: {} });
  view.confirmPlaylistImport = () => true;

  await assert.rejects(view.importPagedPlaylistSource('source'), /commit failed/);
  assert.deepEqual(calls, [['commit'], ['cancel', 'preview-2']]);
});

function createCompressedFolderBrowseState(view, path, segments) {
  return {
    key: `folder-1\0${path}`,
    browseGeneration: view.folderBrowseGeneration,
    children: [{
      name: segments[0],
      segments,
      directTrackCount: 0,
      recursiveTrackCount: 5
    }],
    cursor: null,
    hasMore: false,
    nodeExists: true
  };
}

function createCompressedFolderChildrenState(view, path, segments) {
  return {
    ...createCompressedFolderBrowseState(view, path, segments),
    requestId: view.folderBrowseRequestId,
    intentId: view.navigationIntentId,
    loading: false,
    error: false
  };
}

function createFolderDirectoryTestSection(path) {
  const section = new PagedDomElement('section');
  section.dataset.folderBrowseKey = `folder-1\0${path}`;
  section.querySelectorAll = selector => selector === '.library-folder-directory-row'
    ? section.children.flatMap(child => child.children || [])
      .filter(child => child.className === 'library-folder-directory-row')
    : [];
  return section;
}

function connectFolderRowFocus(view, section, row, document) {
  row.focus = options => {
    row.focusOptions = options;
    document.activeElement = row;
  };
  view.content.querySelector = selector => (
    selector === '.library-folder-directory-section' ? section : null
  );
}

test('compressed folder rows join segments and activate their deepest path', () => {
  return withGlobals({
    document: { createElement: tagName => new PagedDomElement(tagName) }
  }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' };
    view.folderChildrenState = createCompressedFolderChildrenState(view, '', ['A', 'B', 'C']);
    const section = createFolderDirectoryTestSection('');

    view.renderFolderDirectorySection(section, 0);

    const row = section.children[0].children[0];
    const nameText = row.innerHTML.match(
      /<span class="library-folder-directory-name">([^<]*)<\/span>/
    )?.[1];
    assert.equal(nameText, 'A / B / C');
    assert.equal(row.dataset.folderPath, 'A/B/C');
    assert.equal(row.dataset.folderFirstPath, 'A');

    row.listeners.get('click')();
    assert.equal(view.detail.path, 'A/B/C');
  });
});

test('compressed folder rows restore focus by first path after one-level Back', async () => {
  const document = {
    body: { classList: { contains: () => false } },
    createElement: tagName => new PagedDomElement(tagName),
    activeElement: null
  };
  await withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A/B/C', title: 'Music' };
    view.content = new PagedDomElement('main');

    assert.equal(view.navigateBack(), true);
    assert.equal(view.detail.path, 'A/B');
    assert.equal(view.pendingFolderFocusPath, 'A/B/C');

    view.folderChildrenState = createCompressedFolderChildrenState(view, 'A/B', ['C', 'D']);
    const section = createFolderDirectoryTestSection('A/B');
    view.renderFolderDirectorySection(section, 0);
    const row = section.querySelectorAll('.library-folder-directory-row')[0];
    assert.equal(row.dataset.folderPath, 'A/B/C/D');
    assert.equal(row.dataset.folderFirstPath, 'A/B/C');
    connectFolderRowFocus(view, section, row, document);

    assert.equal(view.focusPendingFolderRow(section), true);
    assert.equal(document.activeElement, row);
    assert.deepEqual(row.focusOptions, { preventScroll: true });
    assert.equal(view.pendingFolderFocusPath, null);
  });
});

test('compressed folder rows restore ancestor focus after their deepest segment changes', async () => {
  const document = {
    body: { classList: { contains: () => false } },
    createElement: tagName => new PagedDomElement(tagName),
    activeElement: null
  };
  await withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A/B/C', title: 'Music' };
    view.content = new PagedDomElement('main');

    view.navigateToFolderPath('');
    assert.equal(view.detail.path, '');
    assert.equal(view.pendingFolderFocusPath, 'A');

    view.folderChildrenState = createCompressedFolderChildrenState(view, '', ['A', 'B', 'D']);
    const section = createFolderDirectoryTestSection('');
    view.renderFolderDirectorySection(section, 0);
    const row = section.querySelectorAll('.library-folder-directory-row')[0];
    assert.equal(row.dataset.folderPath, 'A/B/D');
    assert.equal(row.dataset.folderFirstPath, 'A');
    connectFolderRowFocus(view, section, row, document);

    assert.equal(view.focusPendingFolderRow(section), true);
    assert.equal(document.activeElement, row);
    assert.equal(view.pendingFolderFocusPath, null);
  });
});

test('pending compressed-folder focus is scoped to its monitored folder', async () => {
  const document = {
    body: { classList: { contains: () => false } },
    createElement: tagName => new PagedDomElement(tagName),
    activeElement: null
  };
  await withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.folderBrowseMode = 'tree';
    view.detail = { type: 'folderNode', folderId: 'folder-x', path: 'A/B/C', title: 'X' };
    view.content = new PagedDomElement('main');

    view.navigateToFolderPath('');
    assert.equal(view.pendingFolderFocusPath, 'A');
    assert.equal(view.pendingFolderFocusFolderId, 'folder-x');

    view.navigateToDetail(
      { type: 'folderNode', folderId: 'folder-y', path: '', title: 'Y' },
      null,
      { pushHistory: false }
    );
    assert.equal(view.pendingFolderFocusPath, 'A');
    assert.equal(view.pendingFolderFocusFolderId, 'folder-x');

    view.folderChildrenState = {
      ...createCompressedFolderChildrenState(view, '', ['A', 'Other']),
      key: 'folder-y\0'
    };
    const section = createFolderDirectoryTestSection('');
    section.dataset.folderBrowseKey = 'folder-y\0';
    view.renderFolderDirectorySection(section, 0);
    const row = section.querySelectorAll('.library-folder-directory-row')[0];
    assert.equal(row.dataset.folderFirstPath, 'A');
    connectFolderRowFocus(view, section, row, document);

    assert.equal(view.focusPendingFolderRow(section), false);
    assert.equal(document.activeElement, null);
    assert.equal(row.focusOptions, undefined);
  });
});

test('mobile folder popstate restores focus to a compressed chain row by first path', async () => {
  const document = {
    body: { classList: { contains: name => name === 'layout-mobile' || name === 'view-library' } },
    createElement: tagName => new PagedDomElement(tagName),
    activeElement: null
  };
  const history = { state: null, replaceState() {}, pushState() {} };
  await withGlobals({ document, history }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A/B/C', title: 'Music' };
    const rootKey = 'folder-1\0';
    view.folderNavigationPositions.set(rootKey, {
      currentView: 'folders',
      detail: { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' },
      pagedPosition: { contentScrollTop: 720 },
      folderBrowseState: createCompressedFolderBrowseState(view, '', ['A', 'B', 'C'])
    });
    const state = {
      effetuneLibrary: true,
      index: 0,
      depth: 0,
      snapshot: {
        currentView: 'folders',
        detail: { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' },
        searchQuery: '',
        pagedPosition: { contentScrollTop: 720 }
      }
    };

    view.handleMobilePopState({ state });

    assert.equal(view.detail.path, '');
    assert.equal(view.pendingFolderFocusPath, 'A');
    const section = createFolderDirectoryTestSection('');
    view.content = {
      scrollTop: 0,
      querySelector: selector => selector === '.library-folder-directory-section' ? section : null
    };
    view.renderFolderDirectorySection(section, 0);
    const row = section.querySelectorAll('.library-folder-directory-row')[0];
    assert.equal(row.dataset.folderPath, 'A/B/C');
    assert.equal(row.dataset.folderFirstPath, 'A');
    connectFolderRowFocus(view, section, row, document);

    assert.equal(view.focusPendingFolderRow(section), true);
    assert.equal(document.activeElement, row);
    assert.deepEqual(row.focusOptions, { preventScroll: true });
    assert.equal(view.pendingFolderFocusPath, null);
  });
});

test('mobile popstate clears pending compressed-folder focus before leaving folder detail', async () => {
  const document = {
    body: { classList: { contains: name => name === 'layout-mobile' || name === 'view-library' } }
  };
  const history = { state: null, replaceState() {}, pushState() {} };
  await withGlobals({ document, history }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A/B/C', title: 'Music' };

    view.handleMobilePopState({
      state: {
        effetuneLibrary: true,
        index: 1,
        depth: 1,
        snapshot: {
          currentView: 'folders',
          detail: { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' },
          searchQuery: ''
        }
      }
    });
    assert.equal(view.pendingFolderFocusPath, 'A');

    view.handleMobilePopState({
      state: {
        effetuneLibrary: true,
        index: 0,
        depth: 0,
        snapshot: { currentView: 'folders', detail: null, searchQuery: '' }
      }
    });

    assert.equal(view.pendingFolderFocusPath, null);
  });
});

test('desktop Back restores a compressed child row and clears pending focus when leaving folders', () => {
  const document = {
    body: { classList: { contains: () => false } },
    createElement: tagName => new PagedDomElement(tagName)
  };
  return withGlobals({ document }, () => {
    const view = new LibraryView({ manager: createPagedManager(), uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: '', title: 'Music' };
    view.content = new PagedDomElement('main');
    view.folderChildrenState = createCompressedFolderChildrenState(view, '', ['A', 'B', 'C']);
    const rootSection = createFolderDirectoryTestSection('');
    view.renderFolderDirectorySection(rootSection, 0);
    rootSection.children[0].children[0].listeners.get('click')();
    assert.equal(view.detail.path, 'A/B/C');

    assert.equal(view.navigateBack(), true);
    assert.equal(view.detail.path, 'A/B');

    view.folderChildrenState = createCompressedFolderChildrenState(view, 'A/B', ['C']);
    const parentSection = createFolderDirectoryTestSection('A/B');
    view.renderFolderDirectorySection(parentSection, 0);
    const rows = parentSection.children[0].children;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dataset.folderPath, 'A/B/C');
    assert.equal(rows[0].dataset.folderFirstPath, 'A/B/C');

    assert.equal(view.navigateBack(), true);
    assert.equal(view.detail.path, 'A');
    assert.equal(view.navigateBack(), true);
    assert.equal(view.detail.path, '');
    assert.equal(view.pendingFolderFocusPath, 'A');
    assert.equal(view.navigateBack(), true);
    assert.equal(view.detail, null);
    assert.equal(view.pendingFolderFocusPath, null);
  });
});

test('missing compressed folder nodes recover to a cached ancestor row', async () => {
  const document = {
    body: { classList: { contains: () => false } },
    createElement: tagName => new PagedDomElement(tagName)
  };
  await withGlobals({ document }, async () => {
    const manager = createPagedManager();
    manager.browseFolderChildren = async () => ({
      children: [], hasMore: false, cursor: null, nodeExists: false
    });
    const view = new LibraryView({ manager, uiManager: {} });
    view.render = () => {};
    view.currentView = 'folders';
    view.detail = { type: 'folderNode', folderId: 'folder-1', path: 'A/B/C', title: 'Music' };
    view.content = { scrollTop: 0, querySelector() { return null; } };
    const parentKey = 'folder-1\0A/B';
    view.folderNavigationPositions.set(parentKey, {
      currentView: 'folders',
      detail: { type: 'folderNode', folderId: 'folder-1', path: 'A/B', title: 'Music' },
      pagedPosition: { contentScrollTop: 320 },
      folderBrowseState: createCompressedFolderBrowseState(view, 'A/B', ['C', 'D'])
    });

    await view.loadFolderChildren(new PagedDomElement('section'), 0);

    assert.equal(view.detail.path, 'A/B');
    assert.equal(view.pendingFolderFocusPath, 'A/B/C');
    const restored = view.getCurrentFolderChildrenState(parentKey);
    assert.deepEqual(restored.children[0].segments, ['C', 'D']);
    const section = createFolderDirectoryTestSection('A/B');
    view.renderFolderDirectorySection(section, 0);
    const row = section.children[0].children[0];
    assert.equal(row.dataset.folderPath, 'A/B/C/D');
    assert.equal(row.dataset.folderFirstPath, 'A/B/C');
  });
});
