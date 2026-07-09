import {
  MUSIC_LIBRARY_UI_STORAGE_KEY,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST
} from '../../library/constants.js';

const VIEW_LABELS = {
  tracks: 'library.nav.tracks',
  albums: 'library.nav.albums',
  artists: 'library.nav.artists',
  genres: 'library.nav.genres',
  folders: 'library.nav.folders',
  playlists: 'library.nav.playlists',
  recent: 'library.nav.recentlyAdded'
};

const TRACK_SORT_COLUMNS = [
  { key: 'title', labelKey: 'library.column.title' },
  { key: 'artist', labelKey: 'library.column.artist' },
  { key: 'album', labelKey: 'library.column.album' },
  { key: 'genre', labelKey: 'library.column.genre' },
  { key: 'duration', labelKey: 'library.column.duration' }
];

const ICONS = {
  play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  shuffle: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/></svg>',
  next: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 5v14l9-7z"/><path d="M17 5h2v14h-2z"/></svg>',
  queue: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h11M4 18h7"/><path d="M17 15v6M14 18h6"/></svg>',
  back: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  add: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h4"/><path d="M6 22v-4H2"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  duplicate: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  drag: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 16h10l1-16"/></svg>',
  up: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
  down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>',
  export: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  import: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>',
  more: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  close: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

const PLAYLIST_ITEM_DRAG_TYPE = 'application/x-effetune-playlist-item-index';
const FOCUSABLE_DIALOG_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
let libraryDialogId = 0;
const PLAYLIST_PICKER_FOCUS_TIMEOUT_MS = 1000;
const DESKTOP_LIBRARY_MIN_HEIGHT_PX = 360;
const DESKTOP_LIBRARY_BOTTOM_GAP_PX = 20;

export class LibraryView {
  constructor({ manager, uiManager }) {
    this.manager = manager;
    this.uiManager = uiManager;
    this.root = null;
    this.nav = null;
    this.content = null;
    this.status = null;
    this.searchInput = null;
    this.currentView = 'tracks';
    this.detail = null;
    this.searchQuery = '';
    this.sort = 'artist';
    this.sortDirection = 'asc';
    this.detailSortOverride = false;
    this.loadUIState();
    this.unsubscribe = [];
    this.lastScanState = null;
    this.trackScrollCleanup = null;
    this.desktopLayoutHeightCleanup = null;
    this.refreshDesktopLayoutHeightObservers = null;
    this.desktopLayoutHeightFrame = null;
    this.desktopLayoutHeightFrameType = null;
    this.renderVersion = 0;
    this.pendingBreakpointRebuild = false;
    this.playlistMenu = null;
    this.playlistMenuCleanup = null;
    this.playlistMenuReturnFocus = null;
    this.contextMenu = null;
    this.contextMenuCleanup = null;
    this.contextMenuReturnFocus = null;
    this.selectedTrackIds = new Set();
    this.lastSelectedTrackId = null;
    this.currentVisibleTrackIds = [];
    this.focusedTrackId = null;
    this.nowPlayingTrackId = null;
    this.queueUndoAvailable = false;
    this.searchComposing = false;
    this.mobileHistoryInitialized = false;
    this.mobileHistoryDepth = 0;
    this.suppressPopStateCount = 0;
    this.mobileSelectionMode = false;
    this.typeJumpBuffer = '';
    this.typeJumpTimer = null;
    this.renderScheduled = false;
    this.libraryReturnFocus = null;
  }

  mount() {
    if (this.root) return this.root;
    this.root = document.createElement('section');
    this.root.id = 'libraryView';
    this.root.className = 'library-view';
    this.root.setAttribute('aria-label', this.t('library.title'));
    this.root.innerHTML = `
      <aside class="library-nav" aria-label="${escapeHtml(this.t('library.title'))}"></aside>
      <div class="library-main">
        <header class="library-header">
          <div class="library-search-wrap">
            <input class="library-search" type="search" autocomplete="off" spellcheck="false">
          </div>
          <div class="library-header-actions">
            <button type="button" class="library-button library-add-folder">${ICONS.add}<span>${escapeHtml(this.t('library.action.addFolder'))}</span></button>
            <button type="button" class="library-icon-button library-rescan" title="${escapeHtml(this.t('library.action.rescan'))}" aria-label="${escapeHtml(this.t('library.action.rescan'))}">${ICONS.refresh}</button>
          </div>
        </header>
        <div class="library-content" tabindex="0"></div>
        <footer class="library-status"></footer>
      </div>
    `;
    const mainContainer = document.querySelector('.main-container');
    mainContainer?.parentNode?.insertBefore(this.root, mainContainer.nextSibling);
    this.nav = this.root.querySelector('.library-nav');
    this.content = this.root.querySelector('.library-content');
    this.status = this.root.querySelector('.library-status');
    this.searchInput = this.root.querySelector('.library-search');
    this.searchInput.placeholder = this.t('library.search.placeholder');
    this.searchInput.addEventListener('compositionstart', () => {
      this.searchComposing = true;
    });
    this.searchInput.addEventListener('compositionend', () => {
      this.searchComposing = false;
      this.searchQuery = this.searchInput.value;
      this.detail = null;
      this.render();
    });
    this.searchInput.addEventListener('input', () => {
      if (this.searchComposing) return;
      this.searchQuery = this.searchInput.value;
      this.detail = null;
      this.render();
    });
    this.searchInput.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.searchInput.value) {
        event.preventDefault();
        this.searchInput.value = '';
        this.searchQuery = '';
        this.detail = null;
        this.render();
      }
    });
    this.content.addEventListener('keydown', event => this.handleContentKeyDown(event));
    this.content.addEventListener('dragover', event => this.handlePlaylistFileDragOver(event));
    this.content.addEventListener('drop', event => this.handlePlaylistFileDrop(event));
    document.addEventListener('keydown', event => this.handleGlobalLibraryKeyDown(event));
    globalThis.window?.addEventListener?.('popstate', event => this.handleMobilePopState(event));
    this.root.querySelector('.library-add-folder')?.addEventListener('click', () => this.handleAddFolder());
    this.root.querySelector('.library-rescan')?.addEventListener('click', () => this.manager.scanFolders());
    this.unsubscribe.push(
      this.manager.addListener('ready', () => this.render()),
      this.manager.addListener('catalog-changed', () => this.scheduleRender()),
      this.manager.addListener('folders-changed', () => this.render()),
      this.manager.addListener('playlists-changed', () => this.render()),
      this.manager.addListener('queue-replaced', () => {
        this.queueUndoAvailable = true;
        this.renderStatus();
      }),
      this.manager.addListener('queue-restored', () => {
        this.queueUndoAvailable = false;
        this.renderStatus();
      }),
      this.manager.addListener('scan-state', state => {
        this.lastScanState = state;
        this.renderStatus();
      }),
      this.manager.addListener('folder-add-rejected', info => this.handleFolderAddRejected(info))
    );
    this.render();
    return this.root;
  }

  loadUIState() {
    try {
      const state = JSON.parse(globalThis.localStorage?.getItem(MUSIC_LIBRARY_UI_STORAGE_KEY) || '{}');
      if (state.sort) this.sort = state.sort;
      if (state.sortDirection === 'asc' || state.sortDirection === 'desc') {
        this.sortDirection = state.sortDirection;
      }
    } catch (_) {
      // UI preferences are optional; invalid stored state falls back to defaults.
    }
  }

  saveUIState() {
    try {
      globalThis.localStorage?.setItem(MUSIC_LIBRARY_UI_STORAGE_KEY, JSON.stringify({
        sort: this.sort,
        sortDirection: this.sortDirection
      }));
    } catch (_) {
      // Ignore storage failures so private browsing or quota issues do not block the library.
    }
  }

  show(options = {}) {
    const { focusSearch = true, returnFocus = null } = options || {};
    this.mount();
    this.captureLibraryReturnFocus(returnFocus || document.activeElement);
    document.body.classList.add('view-library');
    this.startDesktopLayoutHeightTracking();
    this.updateDesktopLayoutHeight();
    this.syncNowPlayingTrack();
    this.render();
    if (focusSearch) this.searchInput?.focus();
  }

  hide(options = {}) {
    const { restoreFocus = true, returnFocus = null, fallbackFocus = null } = options || {};
    const shouldRestoreFocus = restoreFocus && this.shouldRestoreLibraryFocus();
    this.pendingBreakpointRebuild = false;
    this.closeContextMenu({ restoreFocus: false });
    this.closePlaylistMenu({ restoreFocus: false });
    this.stopDesktopLayoutHeightTracking();
    // Tear down the track-table scroll/resize listeners so the window 'resize'
    // handler does not survive teardown and re-render the hidden view.
    this.trackScrollCleanup?.();
    this.trackScrollCleanup = null;
    if (this.mobileHistoryDepth > 0 && typeof globalThis.history?.go === 'function') {
      this.suppressPopStateCount += 1;
      globalThis.history.go(-this.mobileHistoryDepth);
    }
    this.mobileHistoryDepth = 0;
    this.mobileHistoryInitialized = false;
    document.body.classList.remove('view-library');
    if (shouldRestoreFocus) {
      const target = getRestorableFocusElement(returnFocus) ||
        getRestorableFocusElement(this.libraryReturnFocus) ||
        getRestorableFocusElement(fallbackFocus) ||
        getRestorableFocusElement(this.uiManager?.openLibraryButton) ||
        getRestorableFocusElement(this.uiManager?.mobileNav?.getViewButton?.('library'));
      target?.focus?.();
    }
    this.libraryReturnFocus = null;
  }

  startDesktopLayoutHeightTracking() {
    if (this.desktopLayoutHeightCleanup) {
      this.refreshDesktopLayoutHeightObservers?.();
      this.updateDesktopLayoutHeight();
      return;
    }

    const scheduleUpdate = () => this.scheduleDesktopLayoutHeightUpdate();
    const observedElements = new Set();
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleUpdate)
      : null;
    const observeElement = element => {
      if (!element || observedElements.has(element)) return;
      resizeObserver?.observe?.(element);
      observedElements.add(element);
    };
    const refreshObservedElements = () => {
      observeElement(this.root);
      observeElement(globalThis.document?.querySelector?.('.audio-player'));
      observeElement(globalThis.document?.querySelector?.('.double-blind-test'));
      observeElement(getAppVersionDisplayElement());
      scheduleUpdate();
    };
    const mutationObserver = typeof MutationObserver === 'function' && globalThis.document?.body
      ? new MutationObserver(refreshObservedElements)
      : null;

    globalThis.window?.addEventListener?.('resize', scheduleUpdate);
    globalThis.window?.visualViewport?.addEventListener?.('resize', scheduleUpdate);
    mutationObserver?.observe?.(globalThis.document.body, { childList: true });
    this.refreshDesktopLayoutHeightObservers = refreshObservedElements;
    this.desktopLayoutHeightCleanup = () => {
      globalThis.window?.removeEventListener?.('resize', scheduleUpdate);
      globalThis.window?.visualViewport?.removeEventListener?.('resize', scheduleUpdate);
      resizeObserver?.disconnect?.();
      mutationObserver?.disconnect?.();
      this.cancelDesktopLayoutHeightFrame();
      this.refreshDesktopLayoutHeightObservers = null;
      this.desktopLayoutHeightCleanup = null;
      this.resetDesktopLayoutHeight();
    };
    refreshObservedElements();
    this.updateDesktopLayoutHeight();
  }

  stopDesktopLayoutHeightTracking() {
    this.desktopLayoutHeightCleanup?.();
  }

  scheduleDesktopLayoutHeightUpdate() {
    if (this.desktopLayoutHeightFrame != null) return;
    const run = () => {
      this.desktopLayoutHeightFrame = null;
      this.desktopLayoutHeightFrameType = null;
      if (this.desktopLayoutHeightCleanup) this.updateDesktopLayoutHeight();
    };
    if (typeof requestAnimationFrame === 'function') {
      this.desktopLayoutHeightFrameType = 'animation';
      this.desktopLayoutHeightFrame = requestAnimationFrame(run);
    } else {
      this.desktopLayoutHeightFrameType = 'timeout';
      this.desktopLayoutHeightFrame = setTimeout(run, 0);
    }
  }

  cancelDesktopLayoutHeightFrame() {
    if (this.desktopLayoutHeightFrame == null) return;
    if (this.desktopLayoutHeightFrameType === 'animation' && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.desktopLayoutHeightFrame);
    } else {
      clearTimeout(this.desktopLayoutHeightFrame);
    }
    this.desktopLayoutHeightFrame = null;
    this.desktopLayoutHeightFrameType = null;
  }

  updateDesktopLayoutHeight() {
    if (!this.root) return;
    if (isMobileLayout()) {
      this.resetDesktopLayoutHeight();
      return;
    }
    const viewportHeight = getViewportHeight();
    if (!(viewportHeight > 0)) {
      this.resetDesktopLayoutHeight();
      return;
    }
    const viewportTop = getViewportTop();
    const rect = this.root.getBoundingClientRect?.();
    const top = Number.isFinite(rect?.top) ? rect.top : 0;
    const bottomReservedHeight = getElementOuterBlockSize(getAppVersionDisplayElement());
    const availableHeight = Math.floor(viewportTop + viewportHeight - top - bottomReservedHeight - DESKTOP_LIBRARY_BOTTOM_GAP_PX);
    const height = availableHeight > DESKTOP_LIBRARY_MIN_HEIGHT_PX
      ? availableHeight
      : DESKTOP_LIBRARY_MIN_HEIGHT_PX;
    setStyleProperty(this.root, '--library-desktop-height', `${height}px`);
  }

  resetDesktopLayoutHeight() {
    removeStyleProperty(this.root, '--library-desktop-height');
  }

  syncContentScrollbarInset() {
    if (!this.root || !this.content) return;
    const offsetWidth = Number(this.content.offsetWidth);
    const clientWidth = Number(this.content.clientWidth);
    const scrollbarWidth = Number.isFinite(offsetWidth) && Number.isFinite(clientWidth)
      ? Math.max(0, offsetWidth - clientWidth)
      : 0;
    setStyleProperty(this.root, '--library-content-scrollbar-width', `${scrollbarWidth}px`);
  }

  toggle(options = {}) {
    if (document.body.classList.contains('view-library')) {
      this.hide(options);
    } else {
      this.show(options);
    }
  }

  captureLibraryReturnFocus(candidate) {
    const target = getRestorableFocusElement(candidate);
    if (!target || target === document.body || this.root?.contains?.(target)) return;
    this.libraryReturnFocus = target;
  }

  shouldRestoreLibraryFocus() {
    const active = document.activeElement;
    return !active ||
      active === document.body ||
      this.root?.contains?.(active) ||
      this.contextMenu?.contains?.(active) ||
      this.playlistMenu?.contains?.(active);
  }

  hasActiveDialog() {
    return Boolean(getActiveLibraryDialogBackdrop());
  }

  isLibraryVisible() {
    return Boolean(this.root && this.root.isConnected !== false && document.body?.classList.contains('view-library'));
  }

  flushPendingBreakpointRebuild() {
    if (!this.pendingBreakpointRebuild) return;
    if (this.playlistMenu || this.contextMenu || this.hasActiveDialog?.()) return;
    this.pendingBreakpointRebuild = false;
    if (this.isLibraryVisible()) this.render();
  }

  syncNowPlayingTrack() {
    this.nowPlayingTrackId = this.getCurrentPlayerTrackId();
  }

  getCurrentPlayerTrackId() {
    const state = this.uiManager?.audioPlayer?.stateManager?.getStateSnapshot?.();
    const playlist = Array.isArray(state?.playlist) ? state.playlist : [];
    const currentTrack = state?.currentTrack || playlist[state?.currentTrackIndex ?? -1] || null;
    return currentTrack?.libraryTrackId || null;
  }

  setNowPlayingTrack(trackId) {
    const nextId = trackId || null;
    if (this.nowPlayingTrackId === nextId) return;
    this.nowPlayingTrackId = nextId;
    this.refreshRenderedNowPlaying();
    this.renderStatus();
  }

  async showTrack(trackId, options = {}) {
    const track = this.manager.getTrackById(trackId);
    if (!track) return false;
    const target = options.view === 'artist'
      ? this.getTrackArtistDetail(track)
      : (track.albumKey ? { type: 'album', key: track.albumKey } : null);
    if (target) {
      this.navigateToDetail(target, target.type === 'artist' ? 'artists' : 'albums');
    } else {
      this.navigateToView('tracks');
    }
    this.focusedTrackId = trackId;
    this.setSelection([trackId]);
    this.show({
      focusSearch: options.focusSearch ?? false,
      returnFocus: options.returnFocus
    });
    this.scrollTrackIntoView(trackId);
    return true;
  }

  getTrackArtistDetail(track) {
    const key = track?.artistDisplayKey || track?.artistKey || '';
    const title = this.getTrackArtistLabel(track);
    return key ? { type: 'artist', key, title } : null;
  }

  getTrackArtistLabel(track) {
    return track?.artist || track?.albumArtist || this.t('library.unknownArtist');
  }

  getTrackAlbumLabel(track) {
    return track?.album || this.t('library.unknownAlbum');
  }

  scrollTrackIntoView(trackId) {
    const index = this.currentVisibleTrackIds.indexOf(trackId);
    if (index < 0 || !this.content) return;
    const table = this.content.querySelector?.('.library-track-table');
    const header = table?.querySelector?.('.library-track-header');
    const top = (table?.offsetTop || 0) + (header?.offsetHeight || 40) + (index * this.getTrackRowHeight());
    this.content.scrollTop = top > 48 ? top - 48 : 0;
    if (typeof Event === 'function' && this.content.dispatchEvent) {
      this.content.dispatchEvent(new Event('scroll'));
    }
    const refresh = () => {
      this.refreshRenderedSelection();
      this.refreshRenderedFocus();
      this.refreshRenderedNowPlaying();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(refresh);
    } else {
      refresh();
    }
  }

  scheduleRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    const run = () => {
      this.renderScheduled = false;
      this.render();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, 0);
    }
  }

  render() {
    if (!this.root) return;
    this.pendingBreakpointRebuild = false;
    const renderVersion = ++this.renderVersion;
    this.syncNowPlayingTrack();
    this.closePlaylistMenu({ restoreFocus: false });
    this.closeContextMenu();
    this.trackScrollCleanup?.();
    this.trackScrollCleanup = null;
    // Clear the visible track list so keyboard actions do not operate on a
    // stale list in views without a track table; createTrackTable repopulates it.
    this.currentVisibleTrackIds = [];
    this.renderNav();
    if (this.searchQuery.trim()) {
      this.renderSearch();
    } else if (this.detail?.type === 'playlist') {
      this.renderPlaylistDetail(this.detail.key, renderVersion);
    } else if (this.detail?.type === 'album') {
      this.renderAlbumDetail(this.detail.key);
    } else if (this.detail?.type === 'artist') {
      this.renderArtistDetail(this.detail.key);
    } else if (this.detail?.type === 'genre') {
      this.renderTrackList(this.manager.getGenreTracks(this.detail.key), this.detail.title);
    } else if (this.detail?.type === 'folder') {
      this.renderTrackList(this.manager.getFolderTracks(this.detail.key), this.detail.title);
    } else if (this.currentView === 'albums') {
      this.renderAlbums();
    } else if (this.currentView === 'artists') {
      this.renderArtists();
    } else if (this.currentView === 'genres') {
      this.renderGenres();
    } else if (this.currentView === 'folders') {
      this.renderFolders();
    } else if (this.currentView === 'playlists') {
      this.renderPlaylists(renderVersion);
    } else if (this.currentView === 'recent') {
      this.renderTrackList(this.manager.getRecentlyAdded(500), this.t('library.nav.recentlyAdded'));
    } else {
      this.renderTrackList(
        this.manager.getTracks({ sort: this.sort, direction: this.sortDirection }),
        this.t('library.nav.tracks'),
        { applyCurrentSort: false }
      );
    }
    this.renderStatus();
  }

  renderNav() {
    const counts = this.manager.getCounts();
    const items = ['tracks', 'albums', 'artists', 'genres', 'folders', 'recent', 'playlists'];
    this.nav.innerHTML = items.map(view => {
      const count = view === 'tracks' ? counts.tracks :
        view === 'albums' ? counts.albums :
          view === 'artists' ? counts.artists :
            view === 'genres' ? counts.genres :
              view === 'folders' ? this.manager.getFolders().length : '';
      const active = this.currentView === view;
      return `<button type="button" class="library-nav-item ${active ? 'active' : ''}" data-view="${view}"${active ? ' aria-current="page"' : ''}>
        <span>${escapeHtml(this.t(VIEW_LABELS[view]))}</span>
        ${count !== '' ? `<span class="library-count">${count}</span>` : ''}
      </button>`;
    }).join('');
    this.nav.querySelectorAll('[data-view]').forEach(button => {
      button.addEventListener('click', () => {
        this.navigateToView(button.dataset.view);
      });
    });
  }

  getNavigationSnapshot() {
    return {
      currentView: this.currentView,
      detail: this.detail ? { ...this.detail } : null,
      searchQuery: this.searchQuery,
      focusedTrackId: this.focusedTrackId
    };
  }

  applyNavigationSnapshot(snapshot = {}) {
    this.currentView = snapshot.currentView || 'tracks';
    this.detail = snapshot.detail ? { ...snapshot.detail } : null;
    this.detailSortOverride = false;
    this.searchQuery = snapshot.searchQuery || '';
    this.focusedTrackId = snapshot.focusedTrackId || this.focusedTrackId || null;
    if (this.searchInput) this.searchInput.value = this.searchQuery;
    this.clearSelection({ keepMobileSelectionMode: false });
    this.render();
  }

  pushMobileHistory(previousSnapshot = null) {
    if (!isMobileLayout() || typeof globalThis.history?.pushState !== 'function') return;
    if (!this.mobileHistoryInitialized && typeof globalThis.history.replaceState === 'function') {
      globalThis.history.replaceState({
        ...(globalThis.history.state || {}),
        effetuneLibrary: true,
        snapshot: previousSnapshot || this.getNavigationSnapshot()
      }, '');
      this.mobileHistoryInitialized = true;
    }
    globalThis.history.pushState({
      effetuneLibrary: true,
      snapshot: this.getNavigationSnapshot()
    }, '');
    this.mobileHistoryDepth += 1;
  }

  navigateToView(view, { pushHistory = true } = {}) {
    const previousSnapshot = this.getNavigationSnapshot();
    this.currentView = view || 'tracks';
    this.detail = null;
    this.detailSortOverride = false;
    this.searchQuery = '';
    this.clearSelection({ keepMobileSelectionMode: false });
    if (this.searchInput) this.searchInput.value = '';
    if (pushHistory) this.pushMobileHistory(previousSnapshot);
    this.render();
  }

  navigateToDetail(detail, view = detail?.type, { pushHistory = true } = {}) {
    if (!detail) {
      this.navigateToView(view || this.currentView, { pushHistory });
      return;
    }
    const previousSnapshot = this.getNavigationSnapshot();
    this.currentView = view || (detail.type === 'album' ? 'albums' :
      detail.type === 'artist' ? 'artists' :
        detail.type === 'playlist' ? 'playlists' :
          detail.type === 'genre' ? 'genres' :
            detail.type === 'folder' ? 'folders' : this.currentView);
    this.detail = { ...detail };
    this.detailSortOverride = false;
    this.searchQuery = '';
    this.clearSelection({ keepMobileSelectionMode: false });
    if (this.searchInput) this.searchInput.value = '';
    if (pushHistory) this.pushMobileHistory(previousSnapshot);
    this.render();
  }

  navigateBack({ fromPopState = false } = {}) {
    if (isMobileLayout() && !fromPopState && this.mobileHistoryDepth > 0 && typeof globalThis.history?.back === 'function') {
      globalThis.history.back();
      return true;
    }
    if (!this.detail && !this.searchQuery) return false;
    this.detail = null;
    this.searchQuery = '';
    this.clearSelection({ keepMobileSelectionMode: false });
    if (this.searchInput) this.searchInput.value = '';
    this.render();
    return true;
  }

  handleMobilePopState(event) {
    if (this.suppressPopStateCount > 0) {
      this.suppressPopStateCount -= 1;
      return;
    }
    if (!isMobileLayout() || !document.body?.classList.contains('view-library')) return;
    const snapshot = event.state?.effetuneLibrary ? event.state.snapshot : null;
    if (!snapshot) return;
    this.mobileHistoryDepth = Math.max(0, this.mobileHistoryDepth - 1);
    this.applyNavigationSnapshot(snapshot);
  }

  renderSearch() {
    const result = this.manager.search(this.searchQuery);
    const total = result.trackIds.length;
    this.content.innerHTML = `
      <div class="library-section-head">
        <h2>${escapeHtml(this.t('library.search.results'))}</h2>
        <span>${total} ${escapeHtml(this.t('library.status.tracks'))}</span>
      </div>
    `;
    if (total === 0) {
      this.content.appendChild(this.emptyState(this.t('library.state.noResults', { query: this.searchQuery })));
      return;
    }
    if (result.albums?.length) {
      this.content.appendChild(this.createSearchEntitySection('library.nav.albums', result.albums, album => {
        this.navigateToDetail({ type: 'album', key: album.key }, 'albums');
      }));
    }
    if (result.artists?.length) {
      this.content.appendChild(this.createSearchEntitySection('library.nav.artists', result.artists, artist => {
        this.navigateToDetail({ type: 'artist', key: artist.key }, 'artists');
      }));
    }
    const tracks = this.manager.getTracks({
      ids: result.trackIds,
      sort: this.sort,
      direction: this.sortDirection
    });
    const trackIds = tracks.map(track => track.id);
    this.content.appendChild(this.createActionBar(trackIds));
    this.content.appendChild(this.createTrackTable(tracks));
  }

  createSearchEntitySection(labelKey, items, onOpen) {
    const section = document.createElement('section');
    section.className = 'library-search-section';
    section.innerHTML = `<h3>${escapeHtml(this.t(labelKey))}</h3>`;
    const list = document.createElement('div');
    list.className = 'library-simple-list library-search-entity-list';
    items.forEach(item => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'library-simple-row';
      row.innerHTML = `<span>${escapeHtml(item.name)}</span><span>${item.trackIds?.length || 0} ${escapeHtml(this.t('library.status.tracks'))}</span>`;
      row.addEventListener('click', () => onOpen(item));
      list.appendChild(row);
    });
    section.appendChild(list);
    return section;
  }

  getTracksForCurrentSort(tracks) {
    const source = Array.isArray(tracks) ? tracks : [];
    const ids = source.map(track => track?.id).filter(Boolean);
    if (ids.length && typeof this.manager.getTracks === 'function') {
      return this.manager.getTracks({
        ids,
        sort: this.sort,
        direction: this.sortDirection
      });
    }
    return [...source];
  }

  renderTrackList(tracks, title, options = {}) {
    const displayTracks = options.applyCurrentSort === false ? (Array.isArray(tracks) ? tracks : []) : this.getTracksForCurrentSort(tracks);
    this.content.innerHTML = `
      <div class="library-section-head">
        ${this.detail ? `<button type="button" class="library-icon-button library-back">${ICONS.back}</button>` : ''}
        <h2>${escapeHtml(title)}</h2>
        <span>${displayTracks.length} ${escapeHtml(this.t('library.status.tracks'))}</span>
      </div>
    `;
    this.content.querySelector('.library-back')?.addEventListener('click', () => {
      this.navigateBack();
    });
    if (displayTracks.length === 0) {
      this.content.appendChild(this.emptyState(this.t('library.state.empty'), this.manager.getCounts().tracks === 0));
      return;
    }
    const ids = displayTracks.map(track => track.id);
    this.content.appendChild(this.createActionBar(ids));
    this.content.appendChild(this.createTrackTable(displayTracks));
  }

  renderAlbums() {
    const albums = this.manager.getAlbums();
    this.content.innerHTML = `<div class="library-section-head"><h2>${escapeHtml(this.t('library.nav.albums'))}</h2><span>${albums.length}</span></div>`;
    if (!albums.length) {
      this.content.appendChild(this.emptyState(this.t('library.state.empty')));
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'library-album-grid';
    albums.forEach(album => {
      const card = document.createElement('div');
      card.className = 'library-album-card';

      const artwork = document.createElement('div');
      artwork.className = 'library-artwork';
      artwork.dataset.artworkId = album.artworkId || '';
      if (!album.artworkId) {
        artwork.appendChild(document.createElement('span'));
      }

      const title = document.createElement('div');
      title.className = 'library-card-title';
      title.textContent = album.name;

      const subtitle = document.createElement('div');
      subtitle.className = 'library-card-subtitle';
      subtitle.textContent = `${album.artist}${album.year ? ` · ${album.year}` : ''}`;

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'library-album-open';
      openButton.setAttribute('aria-label', album.name);
      openButton.addEventListener('click', () => {
        this.navigateToDetail({ type: 'album', key: album.key }, 'albums');
      });

      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'library-card-play';
      playButton.title = this.t('library.action.play');
      playButton.setAttribute('aria-label', `${this.t('library.action.play')} ${album.name}`);
      playButton.innerHTML = ICONS.play;
      playButton.addEventListener('click', () => {
        const trackIds = this.manager.getAlbumTracks(album.key).map(track => track.id);
        this.manager.playTrackIds(trackIds);
      });

      card.appendChild(artwork);
      card.appendChild(title);
      card.appendChild(subtitle);
      card.appendChild(openButton);
      card.appendChild(playButton);
      this.renderArtwork(artwork, album.artworkId);
      grid.appendChild(card);
    });
    this.content.appendChild(grid);
  }

  async renderArtwork(container, artworkId) {
    if (!container || !artworkId) return;
    try {
      const url = await this.manager.getArtworkThumbURL(artworkId);
      if (!url || container.dataset?.artworkId !== artworkId) return;
      const img = document.createElement('img');
      img.className = 'library-artwork-image';
      img.alt = '';
      img.src = url;
      const placeholder = container.querySelector?.('span');
      if (placeholder?.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
      }
      if (typeof container.prepend === 'function') {
        container.prepend(img);
      } else {
        container.appendChild(img);
      }
    } catch (_) {
      // Artwork is optional; keep the placeholder when a cached thumbnail is unavailable.
    }
  }

  renderAlbumDetail(albumKey) {
    const album = this.manager.getAlbums().find(item => item.key === albumKey);
    const albumTracks = this.manager.getAlbumTracks(albumKey);
    const tracks = this.detailSortOverride ? this.getTracksForCurrentSort(albumTracks) : albumTracks;
    if (!album) {
      this.detail = null;
      this.renderAlbums();
      return;
    }
    this.content.innerHTML = `
      <div class="library-detail-head">
        <button type="button" class="library-icon-button library-back">${ICONS.back}</button>
        <div class="library-artwork library-artwork-large" data-artwork-id="${escapeHtml(album.artworkId || '')}">${album.artworkId ? '' : '<span></span>'}</div>
        <div>
          <h2>${escapeHtml(album.name)}</h2>
          <p>${escapeHtml(album.artist)} · ${tracks.length} ${escapeHtml(this.t('library.status.tracks'))}${album.year ? ` · ${album.year}` : ''}</p>
        </div>
      </div>
    `;
    this.renderArtwork(this.content.querySelector('.library-artwork-large'), album.artworkId);
    this.content.querySelector('.library-back')?.addEventListener('click', () => {
      this.navigateBack();
    });
    this.content.appendChild(this.createActionBar(tracks.map(track => track.id)));
    this.content.appendChild(this.createTrackTable(tracks));
  }

  renderArtists() {
    const artists = this.manager.getArtists();
    this.content.innerHTML = `<div class="library-section-head"><h2>${escapeHtml(this.t('library.nav.artists'))}</h2><span>${artists.length}</span></div>`;
    if (!artists.length) {
      this.content.appendChild(this.emptyState(this.t('library.state.empty')));
      return;
    }
    const list = document.createElement('div');
    list.className = 'library-simple-list';
    artists.forEach(artist => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-simple-row';
      button.innerHTML = `<span>${escapeHtml(artist.name)}</span><span>${artist.albumKeys.size} ${escapeHtml(this.t('library.status.albums'))} · ${artist.trackIds.length} ${escapeHtml(this.t('library.status.tracks'))}</span>`;
      button.addEventListener('click', () => {
        this.navigateToDetail({ type: 'artist', key: artist.key }, 'artists');
      });
      list.appendChild(button);
    });
    this.content.appendChild(list);
  }

  renderArtistDetail(artistKey) {
    const artist = this.manager.getArtists().find(item => item.key === artistKey);
    const tracks = this.manager.getArtistTracks(artistKey);
    if (!artist && !tracks.length) {
      this.detail = null;
      this.renderArtists();
      return;
    }
    const title = artist?.name || this.detail?.title || tracks[0]?.artist || tracks[0]?.albumArtist || this.t('library.nav.artists');
    this.renderTrackList(tracks, title);
  }

  renderGenres() {
    const genres = this.manager.getGenres();
    this.content.innerHTML = `<div class="library-section-head"><h2>${escapeHtml(this.t('library.nav.genres'))}</h2><span>${genres.length}</span></div>`;
    if (!genres.length) {
      this.content.appendChild(this.emptyState(this.t('library.state.empty')));
      return;
    }
    const list = document.createElement('div');
    list.className = 'library-simple-list';
    genres.forEach(genre => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-simple-row';
      button.innerHTML = `<span>${escapeHtml(genre.name)}</span><span>${genre.trackIds.length}</span>`;
      button.addEventListener('click', () => {
        this.navigateToDetail({ type: 'genre', key: genre.key, title: genre.name }, 'genres');
      });
      list.appendChild(button);
    });
    this.content.appendChild(list);
  }

  renderFolders() {
    const folders = this.manager.getFolders();
    this.content.innerHTML = `<div class="library-section-head"><h2>${escapeHtml(this.t('library.nav.folders'))}</h2></div>`;
    if (!folders.length) {
      this.renderEmptyLibrary();
      return;
    }
    const list = document.createElement('div');
    list.className = 'library-folder-list';
    folders.forEach(folder => {
      const row = document.createElement('div');
      row.className = 'library-folder-row';
      row.innerHTML = `
        <button type="button" class="library-folder-main">
          <strong>${escapeHtml(folder.displayName)}</strong>
          <span>${escapeHtml(folder.path || folder.kind)} · ${folder.trackCount} ${escapeHtml(this.t('library.status.tracks'))}</span>
        </button>
        <span class="library-badge ${folder.status || 'never-scanned'}">${escapeHtml(this.t(`library.state.${folder.status || 'neverScanned'}`))}</span>
        ${(folder.status === 'missing' || folder.status === 'needs-permission') ? `<button type="button" class="library-button library-folder-reconnect">${escapeHtml(this.t('library.action.reconnect'))}</button>` : ''}
        <button type="button" class="library-button library-folder-rescan">${escapeHtml(this.t('library.action.rescan'))}</button>
        <button type="button" class="library-button library-folder-remove">${escapeHtml(this.t('library.action.removeFolder'))}</button>
      `;
      row.querySelector('.library-folder-main')?.addEventListener('click', () => {
        this.navigateToDetail({ type: 'folder', key: folder.id, title: folder.displayName }, 'folders');
      });
      row.querySelector('.library-folder-rescan')?.addEventListener('click', () => this.manager.scanFolders([folder.id]));
      row.querySelector('.library-folder-reconnect')?.addEventListener('click', async () => {
        if (await this.manager.requestFolderAccess(folder.id)) {
          await this.manager.scanFolders([folder.id]);
        }
      });
      row.querySelector('.library-folder-remove')?.addEventListener('click', () => {
        if (confirm(this.t('library.confirm.removeFolder'))) {
          this.manager.removeFolder(folder.id);
        }
      });
      list.appendChild(row);
    });
    this.content.appendChild(list);
  }

  async renderPlaylists(renderVersion = this.renderVersion) {
    this.content.innerHTML = `
      <div class="library-section-head">
        <h2>${escapeHtml(this.t('library.nav.playlists'))}</h2>
        <div class="library-header-actions">
          <button type="button" class="library-button library-import-playlist">${ICONS.import}<span>${escapeHtml(this.t('library.action.importPlaylist'))}</span></button>
          <button type="button" class="library-button library-new-playlist">${ICONS.add}<span>${escapeHtml(this.t('library.action.newPlaylist'))}</span></button>
        </div>
      </div>
    `;
    const playlists = await this.manager.playlists.list();
    if (renderVersion !== this.renderVersion || this.currentView !== 'playlists' || this.searchQuery.trim() || this.detail) {
      return;
    }
    this.content.innerHTML = `
      <div class="library-section-head">
        <h2>${escapeHtml(this.t('library.nav.playlists'))}</h2>
        <div class="library-header-actions">
          <button type="button" class="library-button library-import-playlist">${ICONS.import}<span>${escapeHtml(this.t('library.action.importPlaylist'))}</span></button>
          <button type="button" class="library-button library-new-playlist">${ICONS.add}<span>${escapeHtml(this.t('library.action.newPlaylist'))}</span></button>
        </div>
      </div>
    `;
    this.content.querySelector('.library-new-playlist')?.addEventListener('click', async () => {
      const name = await this.promptText('library.prompt.playlistName', this.t('library.action.newPlaylist'));
      if (name) await this.manager.playlists.create(name);
      this.render();
    });
    this.content.querySelector('.library-import-playlist')?.addEventListener('click', () => this.handleImportPlaylist());
    if (!playlists.length) {
      this.content.appendChild(this.emptyState(this.t('library.state.noPlaylists')));
      return;
    }
    const list = document.createElement('div');
    list.className = 'library-simple-list';
    playlists.forEach(playlist => {
      const row = document.createElement('div');
      row.className = 'library-folder-row';
      row.innerHTML = `
        <button type="button" class="library-folder-main">
          <strong>${escapeHtml(playlist.name)}</strong>
          <span>${playlist.items.length} ${escapeHtml(this.t('library.status.tracks'))}</span>
        </button>
        <button type="button" class="library-button library-playlist-play">${ICONS.play}<span>${escapeHtml(this.t('library.action.play'))}</span></button>
      `;
      row.querySelector('.library-folder-main')?.addEventListener('click', () => {
        this.navigateToDetail({ type: 'playlist', key: playlist.id }, 'playlists');
      });
      row.querySelector('.library-playlist-play')?.addEventListener('click', () => {
        this.playPlaylistItems(playlist.items);
      });
      list.appendChild(row);
    });
    this.content.appendChild(list);
  }

  async renderPlaylistDetail(playlistId, renderVersion = this.renderVersion) {
    const playlist = await this.manager.playlists.get(playlistId);
    if (renderVersion !== this.renderVersion || this.detail?.type !== 'playlist') return;
    if (!playlist) {
      this.navigateToView('playlists');
      return;
    }
    const resolvedIds = this.getResolvedPlaylistTrackIds(playlist.items);
    const unresolvedCount = (playlist.items || []).length - resolvedIds.length;
    this.content.innerHTML = `
      <div class="library-section-head">
        <button type="button" class="library-icon-button library-back">${ICONS.back}</button>
        <h2>${escapeHtml(playlist.name)}</h2>
        <span>${resolvedIds.length} ${escapeHtml(this.t('library.status.tracks'))}${unresolvedCount ? ` · ${unresolvedCount} ${escapeHtml(this.t('library.status.unresolved'))}` : ''}</span>
      </div>
      <div class="library-action-bar">
        <button type="button" class="library-button library-playlist-play">${ICONS.play}<span>${escapeHtml(this.t('library.action.play'))}</span></button>
        <button type="button" class="library-button library-playlist-shuffle">${ICONS.shuffle}<span>${escapeHtml(this.t('library.action.shuffle'))}</span></button>
        <button type="button" class="library-button library-playlist-next">${ICONS.next}<span>${escapeHtml(this.t('library.action.playNext'))}</span></button>
        <button type="button" class="library-button library-playlist-queue">${ICONS.queue}<span>${escapeHtml(this.t('library.action.addToQueue'))}</span></button>
        <button type="button" class="library-button library-playlist-duplicate">${ICONS.duplicate}<span>${escapeHtml(this.t('library.action.duplicate'))}</span></button>
        <button type="button" class="library-button library-playlist-rename">${ICONS.edit}<span>${escapeHtml(this.t('library.action.rename'))}</span></button>
        <label class="library-checkbox library-playlist-export-relative-wrap">
          <input type="checkbox" class="library-playlist-export-relative" checked>
          <span>${escapeHtml(this.t('library.option.relativePaths'))}</span>
        </label>
        <button type="button" class="library-button library-playlist-export-m3u8">${ICONS.export}<span>${escapeHtml(this.t('library.action.exportM3U8'))}</span></button>
        <button type="button" class="library-button library-playlist-export-xspf">${ICONS.export}<span>${escapeHtml(this.t('library.action.exportXSPF'))}</span></button>
        <button type="button" class="library-button library-playlist-delete">${ICONS.trash}<span>${escapeHtml(this.t('library.action.delete'))}</span></button>
      </div>
    `;
    this.content.querySelector('.library-back')?.addEventListener('click', () => {
      this.navigateBack();
    });
    this.content.querySelector('.library-playlist-play')?.addEventListener('click', () => this.playPlaylistItems(playlist.items));
    this.content.querySelector('.library-playlist-shuffle')?.addEventListener('click', () => this.playPlaylistItems(playlist.items, { shuffle: true }));
    this.content.querySelector('.library-playlist-next')?.addEventListener('click', () => this.enqueuePlaylistItems(playlist.items, 'next'));
    this.content.querySelector('.library-playlist-queue')?.addEventListener('click', () => this.enqueuePlaylistItems(playlist.items, 'queue'));
    this.content.querySelector('.library-playlist-duplicate')?.addEventListener('click', () => this.handleDuplicatePlaylist(playlist));
    this.content.querySelector('.library-playlist-rename')?.addEventListener('click', () => this.handleRenamePlaylist(playlist));
    this.content.querySelector('.library-playlist-delete')?.addEventListener('click', () => this.handleDeletePlaylist(playlist));
    this.content.querySelector('.library-playlist-export-m3u8')?.addEventListener('click', () => this.handleExportPlaylist(playlist, 'm3u8'));
    this.content.querySelector('.library-playlist-export-xspf')?.addEventListener('click', () => this.handleExportPlaylist(playlist, 'xspf'));
    if (!playlist.items?.length) {
      this.content.appendChild(this.emptyState(this.t('library.state.noPlaylists')));
      return;
    }
    this.content.appendChild(this.createPlaylistItemTable(playlist));
  }

  createPlaylistItemTable(playlist) {
    const table = document.createElement('div');
    table.className = 'library-playlist-table';
    const resolvedIds = this.getResolvedPlaylistTrackIds(playlist.items);
    (playlist.items || []).forEach((item, index) => {
      const track = item.trackId ? this.manager.getTrackById(item.trackId) : null;
      const unresolved = item.unresolved || {};
      const row = document.createElement('div');
      row.className = `library-playlist-row ${track ? '' : 'unresolved'}`;
      row.dataset.index = String(index);
      row.draggable = true;
      row.innerHTML = `
        <button type="button" class="library-row-play" ${track ? '' : 'disabled'} title="${escapeHtml(this.t('library.action.play'))}">${ICONS.play}</button>
        <span class="library-track-title">${escapeHtml(track?.title || unresolved.title || unresolved.sourceLine || this.t('library.status.unresolved'))}</span>
        <span>${escapeHtml(track?.artist || unresolved.artist || '')}</span>
        <span>${escapeHtml(track?.album || unresolved.album || unresolved.relativePathHint || '')}</span>
        <span>${formatDuration(track?.durationSec || unresolved.durationSec)}</span>
        <div class="library-playlist-row-actions">
          <button type="button" class="library-icon-button library-item-drag" title="${escapeHtml(this.t('library.action.reorder'))}" aria-label="${escapeHtml(this.t('library.action.reorder'))}">${ICONS.drag}</button>
          ${track ? '' : `<button type="button" class="library-icon-button library-item-locate" title="${escapeHtml(this.t('library.action.locate'))}" aria-label="${escapeHtml(this.t('library.action.locate'))}">${ICONS.refresh}</button>`}
          <button type="button" class="library-icon-button library-item-up" title="${escapeHtml(this.t('library.action.moveUp'))}" ${index === 0 ? 'disabled' : ''}>${ICONS.up}</button>
          <button type="button" class="library-icon-button library-item-down" title="${escapeHtml(this.t('library.action.moveDown'))}" ${index === playlist.items.length - 1 ? 'disabled' : ''}>${ICONS.down}</button>
          <button type="button" class="library-icon-button library-item-remove" title="${escapeHtml(this.t('library.action.remove'))}">${ICONS.trash}</button>
        </div>
      `;
      row.querySelector('.library-row-play')?.addEventListener('click', () => {
        if (track) this.manager.playTrackIds([track.id]);
      });
      if (track) {
        row.addEventListener('contextmenu', event => {
          this.openContextMenu(event, track, resolvedIds, resolvedIds.indexOf(track.id), {
            playlist,
            playlistItemIndex: index
          });
        });
      }
      row.querySelector('.library-item-up')?.addEventListener('click', () => this.movePlaylistItem(playlist, index, -1));
      row.querySelector('.library-item-down')?.addEventListener('click', () => this.movePlaylistItem(playlist, index, 1));
      row.querySelector('.library-item-locate')?.addEventListener('click', () => this.handleLocatePlaylistItem(playlist, index));
      row.querySelector('.library-item-remove')?.addEventListener('click', () => this.removePlaylistItem(playlist, index));
      row.addEventListener('dragstart', event => this.handlePlaylistItemDragStart(event, index));
      row.addEventListener('dragover', event => this.handlePlaylistItemDragOver(event));
      row.addEventListener('dragleave', event => this.handlePlaylistItemDragLeave(event));
      row.addEventListener('drop', event => this.handlePlaylistItemDrop(event, playlist, index));
      row.addEventListener('dragend', event => this.handlePlaylistItemDragEnd(event));
      table.appendChild(row);
    });
    return table;
  }

  getResolvedPlaylistTrackIds(items = []) {
    return items.map(item => item?.trackId).filter(id => id && this.manager.getTrackById(id));
  }

  playPlaylistItems(items = [], options = {}) {
    const ids = this.getResolvedPlaylistTrackIds(items);
    if (ids.length) {
      this.manager.playTrackIds(ids, options);
    } else {
      this.uiManager?.setError?.(this.t('library.state.noResolvedTracks'), true);
    }
  }

  enqueuePlaylistItems(items = [], mode = 'queue') {
    const ids = this.getResolvedPlaylistTrackIds(items);
    if (!ids.length) {
      this.uiManager?.setError?.(this.t('library.state.noResolvedTracks'), true);
      return;
    }
    if (mode === 'next') {
      this.manager.playNext(ids);
    } else {
      this.manager.addToQueue(ids);
    }
  }

  async movePlaylistItem(playlist, index, delta) {
    const items = [...(playlist.items || [])];
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    await this.manager.playlists.replaceItems(playlist.id, items);
    this.render();
  }

  async movePlaylistItemToIndex(playlist, fromIndex, targetIndex) {
    const items = [...(playlist.items || [])];
    if (fromIndex < 0 || fromIndex >= items.length) return;
    const boundedTarget = Math.max(0, Math.min(targetIndex, items.length));
    if (fromIndex === boundedTarget || fromIndex + 1 === boundedTarget) return;
    const [item] = items.splice(fromIndex, 1);
    const insertIndex = fromIndex < boundedTarget ? boundedTarget - 1 : boundedTarget;
    items.splice(insertIndex, 0, item);
    await this.manager.playlists.replaceItems(playlist.id, items);
    this.render();
  }

  async removePlaylistItem(playlist, index) {
    const items = [...(playlist.items || [])];
    items.splice(index, 1);
    await this.manager.playlists.replaceItems(playlist.id, items);
    this.render();
  }

  handlePlaylistItemDragStart(event, index) {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(PLAYLIST_ITEM_DRAG_TYPE, String(index));
    event.dataTransfer.setData('text/plain', `playlist-item:${index}`);
    event.currentTarget?.classList?.add('dragging');
  }

  handlePlaylistItemDragOver(event) {
    if (!isPlaylistItemDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget?.classList?.add('drag-over');
  }

  handlePlaylistItemDragLeave(event) {
    event.currentTarget?.classList?.remove('drag-over');
  }

  async handlePlaylistItemDrop(event, playlist, targetIndex) {
    if (!isPlaylistItemDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget?.classList?.remove('drag-over');
    const fromIndex = Number.parseInt(event.dataTransfer.getData(PLAYLIST_ITEM_DRAG_TYPE), 10);
    if (!Number.isInteger(fromIndex)) return;
    const rect = event.currentTarget?.getBoundingClientRect?.();
    let insertIndex = targetIndex;
    if (rect && Number.isFinite(event.clientY) && event.clientY > rect.top + rect.height / 2) {
      insertIndex += 1;
    }
    await this.movePlaylistItemToIndex(playlist, fromIndex, insertIndex);
  }

  handlePlaylistItemDragEnd(event) {
    event.currentTarget?.classList?.remove('dragging');
    event.currentTarget?.classList?.remove('drag-over');
    this.content?.querySelectorAll?.('.library-playlist-row')?.forEach(row => {
      row.classList?.remove('dragging');
      row.classList?.remove('drag-over');
    });
  }

  async handleDuplicatePlaylist(playlist) {
    const name = this.t('library.playlist.copyName', { name: playlist.name });
    const duplicate = await this.manager.playlists.duplicate(playlist.id, name);
    if (duplicate) {
      this.navigateToDetail({ type: 'playlist', key: duplicate.id }, 'playlists');
    }
  }

  async handleLocatePlaylistItem(playlist, index) {
    const result = await this.manager.resolvePlaylistItem?.(playlist.id, index);
    if (result?.status === 'resolved') {
      this.render();
      return;
    }
    this.uiManager?.setError?.(this.t('library.state.noMatchingTrack'), true);
  }

  async handleRenamePlaylist(playlist) {
    const name = await this.promptText('library.prompt.renamePlaylist', playlist.name);
    if (!name || name === playlist.name) return;
    await this.manager.playlists.rename(playlist.id, name);
    this.render();
  }

  async handleDeletePlaylist(playlist) {
    if (!confirm(this.t('library.confirm.deletePlaylist', { name: playlist.name }))) return;
    await this.manager.playlists.delete(playlist.id);
    this.navigateToView('playlists');
  }

  async openAddToPlaylistMenu(anchor, trackIds, options = {}) {
    this.closePlaylistMenu({ restoreFocus: false });
    const renderVersion = this.renderVersion;
    const viewState = {
      currentView: this.currentView,
      detailType: this.detail?.type || '',
      detailKey: this.detail?.key || '',
      searchQuery: this.searchQuery || ''
    };
    const returnFocus = getRestorableFocusElement(options.returnFocus) || getRestorableFocusElement(anchor);
    const playlists = await this.manager.playlists.list();
    if (this.isPlaylistMenuRequestStale(anchor, renderVersion, viewState)) return;

    const menu = document.createElement('div');
    menu.className = 'library-playlist-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', this.t('library.action.addToPlaylist'));
    menu.innerHTML = `
      <button type="button" class="library-playlist-menu-item library-playlist-menu-new" role="menuitem">${ICONS.add}<span>${escapeHtml(this.t('library.action.newPlaylist'))}</span></button>
      ${playlists.map(playlist => `<button type="button" class="library-playlist-menu-item" role="menuitem" data-playlist-id="${escapeHtml(playlist.id)}"><span>${escapeHtml(playlist.name)}</span><small>${playlist.items.length}</small></button>`).join('')}
    `;
    menu.querySelector('.library-playlist-menu-new')?.addEventListener('click', async () => {
      const name = await this.promptText('library.prompt.playlistName', this.t('library.action.newPlaylist'));
      if (name) {
        this.closePlaylistMenu();
        await this.manager.playlists.create(name, trackIds);
      }
    });
    menu.querySelectorAll('[data-playlist-id]').forEach(button => {
      button.addEventListener('click', async () => {
        this.closePlaylistMenu();
        await this.manager.playlists.addTracks(button.dataset.playlistId, trackIds);
      });
    });
    menu.addEventListener('keydown', keyEvent => this.handleMenuKeyDown(keyEvent, () => this.closePlaylistMenu()));
    const actionBar = anchor?.closest?.('.library-action-bar') || this.content.querySelector?.('.library-action-bar');
    if (this.isPlaylistMenuRequestStale(anchor, renderVersion, viewState)) return;
    this.playlistMenuReturnFocus = returnFocus;
    if (actionBar?.after) {
      actionBar.after(menu);
    } else if (this.content.firstChild && this.content.insertBefore) {
      this.content.insertBefore(menu, this.content.firstChild);
    } else {
      this.content.appendChild(menu);
    }
    this.playlistMenu = menu;
    const closeOnPointerDown = pointerEvent => {
      if (menu.contains?.(pointerEvent.target)) return;
      this.closePlaylistMenu();
    };
    document.addEventListener?.('pointerdown', closeOnPointerDown);
    this.playlistMenuCleanup = () => {
      document.removeEventListener?.('pointerdown', closeOnPointerDown);
    };
    menu.scrollIntoView?.({ block: 'nearest' });
    menu.querySelector('button:not(:disabled)')?.focus?.();
  }

  isPlaylistMenuRequestStale(anchor, renderVersion, viewState) {
    if (renderVersion !== this.renderVersion) return true;
    if (!this.content || this.content.isConnected === false || this.root?.isConnected === false) return true;
    if (anchor?.isConnected === false) return true;
    return this.currentView !== viewState.currentView ||
      (this.detail?.type || '') !== viewState.detailType ||
      (this.detail?.key || '') !== viewState.detailKey ||
      (this.searchQuery || '') !== viewState.searchQuery;
  }

  closePlaylistMenu(options = {}) {
    const { restoreFocus = true, flushPendingBreakpointRebuild = true } = options || {};
    const returnFocus = this.playlistMenuReturnFocus;
    this.playlistMenuCleanup?.();
    this.playlistMenuCleanup = null;
    removeElement(this.playlistMenu);
    this.playlistMenu = null;
    this.playlistMenuReturnFocus = null;
    if (restoreFocus) getRestorableFocusElement(returnFocus)?.focus?.();
    if (flushPendingBreakpointRebuild) this.flushPendingBreakpointRebuild();
  }

  openContextMenu(event, track, trackIds, index, context = {}) {
    event.preventDefault();
    this.closeContextMenu();
    if (!this.selectedTrackIds.has(track.id)) {
      this.setSelection([track.id]);
    }
    const selectedIds = this.getSelectedTrackIds(trackIds, track.id);
    const artistDetail = this.getTrackArtistDetail(track);
    const menu = document.createElement('div');
    menu.className = 'library-context-menu';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${Math.max(4, event.clientX || 0)}px`;
    menu.style.top = `${Math.max(4, event.clientY || 0)}px`;
    menu.innerHTML = `
      <button type="button" role="menuitem" data-action="play">${ICONS.play}<span>${escapeHtml(this.t('library.action.play'))}</span></button>
      <button type="button" role="menuitem" data-action="next">${ICONS.next}<span>${escapeHtml(this.t('library.action.playNext'))}</span></button>
      <button type="button" role="menuitem" data-action="queue">${ICONS.queue}<span>${escapeHtml(this.t('library.action.addToQueue'))}</span></button>
      <button type="button" role="menuitem" data-action="playlist">${ICONS.add}<span>${escapeHtml(this.t('library.action.addToPlaylist'))}</span></button>
      <hr>
      <button type="button" role="menuitem" data-action="album" ${track.albumKey ? '' : 'disabled'}><span>${escapeHtml(this.t('library.action.goToAlbum'))}</span></button>
      <button type="button" role="menuitem" data-action="artist" ${artistDetail ? '' : 'disabled'}><span>${escapeHtml(this.t('library.action.goToArtist'))}</span></button>
      ${this.manager.canShowInFolder?.() ? `<button type="button" role="menuitem" data-action="folder"><span>${escapeHtml(this.t('library.action.showInFolder'))}</span></button>` : ''}
      <button type="button" role="menuitem" data-action="properties"><span>${escapeHtml(this.t('library.action.properties'))}</span></button>
      ${context.playlist ? `<button type="button" role="menuitem" data-action="remove-playlist"><span>${escapeHtml(this.t('library.action.removeFromPlaylist'))}</span></button>` : ''}
    `;
    menu.querySelector('[data-action="play"]')?.addEventListener('click', () => {
      const startIndex = selectedIds.length === trackIds.length ? index : 0;
      this.manager.playTrackIds(selectedIds, { startIndex });
      this.closeContextMenu();
    });
    menu.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      this.manager.playNext(selectedIds);
      this.closeContextMenu();
    });
    menu.querySelector('[data-action="queue"]')?.addEventListener('click', () => {
      this.manager.addToQueue(selectedIds);
      this.closeContextMenu();
    });
    menu.querySelector('[data-action="playlist"]')?.addEventListener('click', async () => {
      const returnFocus = this.contextMenuReturnFocus;
      this.closeContextMenu({ restoreFocus: false, flushPendingBreakpointRebuild: false });
      await this.openAddToPlaylistMenu(returnFocus, selectedIds, { returnFocus });
    });
    menu.querySelector('[data-action="album"]')?.addEventListener('click', () => {
      this.closeContextMenu();
      this.navigateToDetail({ type: 'album', key: track.albumKey }, 'albums');
    });
    menu.querySelector('[data-action="artist"]')?.addEventListener('click', () => {
      this.closeContextMenu();
      if (artistDetail) this.navigateToDetail(artistDetail, 'artists');
    });
    menu.querySelector('[data-action="folder"]')?.addEventListener('click', async () => {
      await this.manager.showTrackInFolder?.(track.id);
      this.closeContextMenu();
    });
    menu.querySelector('[data-action="properties"]')?.addEventListener('click', () => {
      const returnFocus = this.contextMenuReturnFocus;
      this.closeContextMenu({ restoreFocus: false, flushPendingBreakpointRebuild: false });
      this.showTrackProperties(track, { returnFocus });
    });
    menu.querySelector('[data-action="remove-playlist"]')?.addEventListener('click', async () => {
      await this.removePlaylistItem(context.playlist, context.playlistItemIndex);
      this.closeContextMenu();
    });
    document.body.appendChild(menu);
    this.contextMenu = menu;
    if (isMobileLayout()) {
      menu.classList.add('library-action-sheet');
      menu.style.left = '';
      menu.style.top = '';
    }
    this.contextMenuReturnFocus = context.returnFocus || event.currentTarget || event.target || null;
    menu.addEventListener('keydown', keyEvent => this.handleMenuKeyDown(keyEvent, () => this.closeContextMenu()));
    const closeOnPointerDown = pointerEvent => {
      if (menu.contains?.(pointerEvent.target)) return;
      this.closeContextMenu();
    };
    const closeOnKeyDown = keyEvent => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        this.closeContextMenu();
      }
    };
    document.addEventListener?.('pointerdown', closeOnPointerDown);
    document.addEventListener?.('keydown', closeOnKeyDown);
    this.contextMenuCleanup = () => {
      document.removeEventListener?.('pointerdown', closeOnPointerDown);
      document.removeEventListener?.('keydown', closeOnKeyDown);
    };
    if (!menu.classList.contains('library-action-sheet')) {
      clampMenuToViewport(menu);
    }
    menu.querySelector('button:not(:disabled)')?.focus?.();
  }

  showTrackProperties(track, options = {}) {
    const folder = this.manager.getFolders().find(item => item.id === track.folderId);
    const path = folder?.path ? `${folder.path.replace(/[\\/]+$/, '')}/${track.relativePath}` : (track.relativePath || track.fileName || '');
    const rows = [
      ['library.properties.title', track.title],
      ['library.properties.artist', track.artist || track.albumArtist],
      ['library.properties.album', track.album],
      ['library.properties.genre', track.genre],
      ['library.properties.year', track.year],
      ['library.properties.track', formatTrackNumber(track)],
      ['library.properties.duration', formatDuration(track.durationSec)],
      ['library.properties.file', track.fileName],
      ['library.properties.path', path],
      ['library.properties.format', track.codec || track.format || track.container],
      ['library.properties.sampleRate', formatNumber(track.sampleRate, ' Hz')],
      ['library.properties.bitDepth', formatNumber(track.bitsPerSample || track.bitDepth, ' bit')],
      ['library.properties.bitrate', formatNumber(track.bitrate ? Math.round(track.bitrate / 1000) : null, ' kbps')]
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');

    const backdrop = document.createElement('div');
    const dialogId = nextDialogId('library-properties');
    backdrop.className = 'library-dialog-backdrop';
    backdrop.innerHTML = `
      <div class="library-properties-dialog" role="dialog" aria-modal="true" aria-labelledby="${dialogId}-title">
        <div class="library-properties-head">
          <h2 id="${dialogId}-title">${escapeHtml(this.t('library.properties.heading'))}</h2>
          <button type="button" class="library-icon-button library-dialog-close" aria-label="${escapeHtml(this.t('library.dialog.close'))}">${ICONS.close}</button>
        </div>
        <dl class="library-properties-list">
          ${rows.map(([label, value]) => `<div><dt>${escapeHtml(this.t(label))}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
        </dl>
      </div>
    `;
    let onKeyDown = null;
    let restoreDialogFocus = null;
    const close = () => {
      if (onKeyDown) document.removeEventListener?.('keydown', onKeyDown);
      removeElement(backdrop);
      restoreDialogFocus?.();
      this.flushPendingBreakpointRebuild();
    };
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) close();
    });
    backdrop.querySelector('.library-dialog-close')?.addEventListener('click', close);
    onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener?.('keydown', onKeyDown);
    document.body.appendChild(backdrop);
    restoreDialogFocus = setupModalFocus(backdrop, backdrop.querySelector('.library-dialog-close'), options.returnFocus);
  }

  closeContextMenu(options = {}) {
    const { restoreFocus = true, flushPendingBreakpointRebuild = true } = options || {};
    const returnFocus = this.contextMenuReturnFocus;
    this.contextMenuCleanup?.();
    this.contextMenuCleanup = null;
    removeElement(this.contextMenu);
    this.contextMenu = null;
    this.contextMenuReturnFocus = null;
    if (restoreFocus) returnFocus?.focus?.();
    if (flushPendingBreakpointRebuild) this.flushPendingBreakpointRebuild();
  }

  handleMenuKeyDown(event, close) {
    const items = Array.from(event.currentTarget.querySelectorAll?.('button:not(:disabled)') || []);
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation?.();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation?.();
      if (!items.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = items[(index + step + items.length) % items.length] || items[0];
      next?.focus?.();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation?.();
      if (!items.length) return;
      const step = event.shiftKey ? -1 : 1;
      const next = items[(index + step + items.length) % items.length] || items[0];
      next?.focus?.();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation?.();
      (event.key === 'Home' ? items[0] : items.at(-1))?.focus?.();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation?.();
      (items[index] || document.activeElement)?.click?.();
    }
  }

  setSelection(ids = []) {
    this.selectedTrackIds = new Set(ids);
    this.lastSelectedTrackId = ids.at(-1) || null;
    if (!this.selectedTrackIds.size) this.mobileSelectionMode = false;
    this.updateMobileSelectionMode();
    this.refreshRenderedSelection();
  }

  clearSelection({ keepMobileSelectionMode = false } = {}) {
    this.selectedTrackIds.clear();
    this.lastSelectedTrackId = null;
    if (!keepMobileSelectionMode) this.mobileSelectionMode = false;
    this.updateMobileSelectionMode();
    this.refreshRenderedSelection();
    this.renderStatus();
  }

  startMobileSelection(trackId) {
    this.mobileSelectionMode = true;
    this.setSelection([trackId]);
  }

  toggleMobileTrackSelection(trackId) {
    const next = new Set(this.selectedTrackIds);
    if (next.has(trackId)) {
      next.delete(trackId);
    } else {
      next.add(trackId);
    }
    this.selectedTrackIds = next;
    this.lastSelectedTrackId = trackId;
    if (!this.selectedTrackIds.size) this.mobileSelectionMode = false;
    this.updateMobileSelectionMode();
    this.refreshRenderedSelection();
  }

  updateMobileSelectionMode() {
    setClass(this.root, 'mobile-selection-mode', Boolean(this.mobileSelectionMode && this.selectedTrackIds.size));
  }

  getSelectedTrackIds(fallbackIds = [], fallbackId = null) {
    const visibleSet = new Set(fallbackIds);
    const selected = [...this.selectedTrackIds].filter(id => visibleSet.has(id));
    return selected.length ? selected : (fallbackId ? [fallbackId] : fallbackIds);
  }

  getActionTrackIds(trackIds) {
    return this.getSelectedTrackIds(trackIds);
  }

  handleTrackSelection(event, trackIds, trackId, index) {
    if (event.shiftKey && this.lastSelectedTrackId) {
      const anchor = trackIds.indexOf(this.lastSelectedTrackId);
      if (anchor >= 0) {
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        this.setSelection(trackIds.slice(start, end + 1));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(this.selectedTrackIds);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      this.selectedTrackIds = next;
      this.lastSelectedTrackId = trackId;
      this.refreshRenderedSelection();
      return;
    }
    this.setSelection([trackId]);
  }

  refreshRenderedSelection() {
    this.content?.querySelectorAll?.('.library-track-row').forEach(row => {
      const selected = this.selectedTrackIds.has(row.dataset.trackId);
      setClass(row, 'selected', selected);
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
      const checkbox = row.querySelector?.('.library-mobile-select');
      if (checkbox) checkbox.textContent = selected ? '✓' : '';
    });
    this.renderStatus();
  }

  refreshRenderedFocus() {
    this.content?.querySelectorAll?.('.library-track-row').forEach(row => {
      const focused = this.focusedTrackId && row.dataset.trackId === this.focusedTrackId;
      setClass(row, 'focused', focused);
      row.tabIndex = focused ? 0 : -1;
    });
  }

  refreshRenderedNowPlaying() {
    this.content?.querySelectorAll?.('.library-track-row').forEach(row => {
      const active = Boolean(this.nowPlayingTrackId && row.dataset.trackId === this.nowPlayingTrackId);
      setClass(row, 'now-playing', active);
      if (active) {
        row.setAttribute('aria-current', 'true');
      } else {
        row.removeAttribute?.('aria-current');
      }
      const indicator = row.querySelector?.('.library-now-playing-indicator');
      if (indicator) indicator.hidden = !active;
    });
  }

  handleContentKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'f') {
      event.preventDefault();
      this.searchInput?.focus();
      this.searchInput?.select?.();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'a') {
      if (this.currentVisibleTrackIds.length) {
        event.preventDefault();
        this.setSelection(this.currentVisibleTrackIds);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (this.contextMenu) {
        event.preventDefault();
        this.closeContextMenu();
        return;
      }
      if (this.playlistMenu) {
        event.preventDefault();
        this.closePlaylistMenu();
        return;
      }
      if (this.selectedTrackIds.size) {
        event.preventDefault();
        this.clearSelection({ keepMobileSelectionMode: false });
        return;
      }
      if (this.searchQuery) {
        event.preventDefault();
        this.searchQuery = '';
        if (this.searchInput) this.searchInput.value = '';
        this.render();
        return;
      }
      if (this.detail) {
        event.preventDefault();
        this.navigateBack();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && this.detail && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.navigateBack();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) {
      // Views without a track list (albums, artists, ...) keep native scrolling.
      if (!this.currentVisibleTrackIds.length) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 :
        event.key === 'ArrowUp' ? -1 :
          event.key === 'PageDown' ? 10 :
            event.key === 'PageUp' ? -10 :
              event.key === 'Home' ? -Infinity : Infinity;
      this.moveFocusedTrack(delta);
      return;
    }
    if (event.key === 'Enter') {
      // Let buttons, links, and form controls handle Enter themselves; only
      // treat Enter as "play focused track" when it targets a track row or
      // the content container itself.
      if (event.target !== this.content && event.target?.closest?.('button, a, input, select, textarea, [role="menuitem"]')) {
        return;
      }
      const trackId = this.focusedTrackId || this.currentVisibleTrackIds[0];
      const index = this.currentVisibleTrackIds.indexOf(trackId);
      if (index >= 0) {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          this.manager.addToQueue([trackId]);
        } else if (event.shiftKey) {
          this.manager.playNext([trackId]);
        } else {
          this.manager.playTrackIds(this.currentVisibleTrackIds, { startIndex: index });
        }
      }
      return;
    }
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.searchInput?.focus();
      this.searchInput?.select?.();
      return;
    }
    if (event.key?.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditableTarget(event.target)) {
      if (event.key === ' ') return;
      event.preventDefault();
      event.stopPropagation?.();
      this.focusTrackByPrefix(event.key);
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const trackId = this.currentVisibleTrackIds.includes(this.focusedTrackId)
        ? this.focusedTrackId
        : this.currentVisibleTrackIds[0];
      const track = trackId ? this.manager.getTrackById(trackId) : null;
      if (!track) return;
      event.preventDefault();
      const index = this.currentVisibleTrackIds.indexOf(trackId);
      const rect = this.content?.getBoundingClientRect?.() || { left: 16, top: 16 };
      const returnFocus = this.content?.querySelector?.(`.library-track-row[data-track-id="${cssEscape(trackId)}"]`) || null;
      this.openContextMenu({
        preventDefault() {},
        clientX: rect.left + 24,
        clientY: rect.top + 48
      }, track, this.currentVisibleTrackIds, index, { returnFocus });
    }
  }

  handleGlobalLibraryKeyDown(event) {
    if (!document.body?.classList.contains('view-library') || isEditableTarget(event.target)) return;
    if (event.key === '/' || ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'f')) {
      event.preventDefault();
      this.searchInput?.focus();
      this.searchInput?.select?.();
    }
  }

  moveFocusedTrack(delta) {
    if (!this.currentVisibleTrackIds.length) return;
    const currentIndex = Math.max(0, this.currentVisibleTrackIds.indexOf(this.focusedTrackId));
    const nextIndex = delta === Infinity ? this.currentVisibleTrackIds.length - 1 :
      delta === -Infinity ? 0 :
        Math.max(0, Math.min(this.currentVisibleTrackIds.length - 1, currentIndex + delta));
    this.focusTrackAtIndex(nextIndex);
  }

  focusTrackByPrefix(prefix) {
    const nextPrefix = String(prefix || '');
    if (nextPrefix === ' ' && !this.typeJumpBuffer) return;
    if (this.typeJumpTimer) clearTimeout(this.typeJumpTimer);
    this.typeJumpBuffer = `${this.typeJumpBuffer}${nextPrefix.replace(/ /g, '')}`;
    this.typeJumpTimer = setTimeout(() => {
      this.typeJumpBuffer = '';
      this.typeJumpTimer = null;
    }, 1000);
    const needle = this.typeJumpBuffer.toLocaleLowerCase();
    if (!needle || !this.currentVisibleTrackIds.length) return;
    const start = Math.max(0, this.currentVisibleTrackIds.indexOf(this.focusedTrackId) + 1);
    const ids = [...this.currentVisibleTrackIds.slice(start), ...this.currentVisibleTrackIds.slice(0, start)];
    const matchId = ids.find(id => this.manager.getTrackById(id)?.title?.toLocaleLowerCase().startsWith(needle));
    const index = this.currentVisibleTrackIds.indexOf(matchId);
    if (index >= 0) this.focusTrackAtIndex(index);
  }

  focusTrackAtIndex(index) {
    const trackId = this.currentVisibleTrackIds[index];
    if (!trackId) return;
    this.focusedTrackId = trackId;
    this.scrollTrackIntoView(trackId);
    this.refreshRenderedFocus();
    const row = this.content?.querySelector?.(`.library-track-row[data-track-id="${cssEscape(trackId)}"]`);
    row?.focus?.();
  }

  async handleImportPlaylist() {
    try {
      const file = await this.pickPlaylistFile();
      if (!file) return;
      const preview = this.manager.previewPlaylistImport(file);
      if (!this.confirmPlaylistImport(preview)) return;
      const result = await this.manager.commitPlaylistImport(preview);
      this.navigateToDetail({ type: 'playlist', key: result.playlist.id }, 'playlists');
    } catch (error) {
      this.uiManager?.setError?.(error.message || String(error), true);
    }
  }

  confirmPlaylistImport(preview) {
    if (typeof confirm !== 'function') return true;
    const total = preview.totalCount || preview.resolvedCount + preview.unresolvedCount;
    const lines = [
      this.t('library.importPreview.message', {
        name: preview.playlistName,
        resolved: preview.resolvedCount,
        total
      })
    ];
    if (preview.unresolvedCount) {
      lines.push('', this.t('library.importPreview.unresolved'));
      const unresolved = preview.unresolvedItems.slice(0, 5).map(item => item.entry?.path || item.entry?.sourceLine || item.entry?.title || '');
      lines.push(...unresolved.filter(Boolean).map(value => `- ${value}`));
      const remaining = preview.unresolvedCount - unresolved.length;
      if (remaining > 0) {
        lines.push(this.t('library.importPreview.moreUnresolved', { count: remaining }));
      }
    }
    return confirm(lines.join('\n'));
  }

  handlePlaylistFileDragOver(event) {
    if (!hasPlaylistFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  async handlePlaylistFileDrop(event) {
    if (!hasPlaylistFiles(event.dataTransfer)) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []);
    const playlistFile = files.find(file => isPlaylistFileName(file.name));
    if (!playlistFile) return;
    try {
      const content = await playlistFile.arrayBuffer();
      const preview = this.manager.previewPlaylistImport({
        content,
        fileName: playlistFile.name,
        playlistPath: playlistFile.name
      });
      if (!this.confirmPlaylistImport(preview)) return;
      const result = await this.manager.commitPlaylistImport(preview);
      this.navigateToDetail({ type: 'playlist', key: result.playlist.id }, 'playlists');
    } catch (error) {
      this.uiManager?.setError?.(error.message || String(error), true);
    }
  }

  async pickPlaylistFile() {
    if (window.electronAPI?.showOpenDialog && window.electronAPI?.readFile) {
      const result = await window.electronAPI.showOpenDialog({
        title: this.t('library.action.importPlaylist'),
        properties: ['openFile'],
        filters: [{ name: 'Playlists', extensions: ['m3u', 'm3u8', 'pls', 'xspf'] }]
      });
      const filePath = result?.filePaths?.[0];
      if (result?.canceled || !filePath) return null;
      const readResult = await window.electronAPI.readFile(filePath, true);
      if (!readResult?.success) {
        throw new Error(readResult?.error || 'Failed to read playlist.');
      }
      return {
        content: base64ToUint8Array(readResult.content),
        fileName: filePath.split(/[\\/]/).pop(),
        playlistPath: filePath
      };
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.m3u,.m3u8,.pls,.xspf';
    input.style.display = 'none';
    let settled = false;
    let cleanup = () => {};
    const picked = new Promise(resolve => {
      let focusTimeout = null;
      const settle = file => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(file || null);
      };
      const onChange = () => settle(input.files?.[0] || null);
      const onCancel = () => settle(null);
      const onWindowFocus = () => {
        if (focusTimeout) clearTimeout(focusTimeout);
        focusTimeout = setTimeout(() => settle(input.files?.[0] || null), PLAYLIST_PICKER_FOCUS_TIMEOUT_MS);
      };
      cleanup = () => {
        input.removeEventListener?.('change', onChange);
        input.removeEventListener?.('cancel', onCancel);
        window.removeEventListener?.('focus', onWindowFocus);
        if (focusTimeout) {
          clearTimeout(focusTimeout);
          focusTimeout = null;
        }
        removeElement(input);
      };
      input.addEventListener('change', onChange);
      input.addEventListener('cancel', onCancel);
      window.addEventListener?.('focus', onWindowFocus);
    });
    try {
      document.body.appendChild(input);
      input.click();
      const file = await picked;
      if (!file) return null;
      return {
        content: await file.arrayBuffer(),
        fileName: file.name,
        playlistPath: file.name
      };
    } finally {
      cleanup();
    }
  }

  async handleExportPlaylist(playlist, format) {
    try {
      const isXspf = format === 'xspf';
      const dialogTitle = this.t(isXspf ? 'library.action.exportXSPF' : 'library.action.exportM3U8');
      const filters = [{ name: 'Playlists', extensions: [isXspf ? 'xspf' : 'm3u8'] }];
      const fileName = `${sanitizeFileName(playlist.name)}.${isXspf ? 'xspf' : 'm3u8'}`;
      if (window.electronAPI?.showSaveDialog && window.electronAPI?.saveFile) {
        const result = await window.electronAPI.showSaveDialog({
          title: dialogTitle,
          defaultPath: fileName,
          filters
        });
        if (result?.canceled || !result?.filePath) return;
        const text = await this.manager.exportPlaylist(playlist.id, {
          format,
          targetPath: result.filePath,
          preferRelative: this.shouldExportRelativePaths()
        });
        const saveResult = await window.electronAPI.saveFile(result.filePath, text);
        if (!saveResult?.success) {
          throw new Error(saveResult?.error || 'Failed to save playlist.');
        }
        return;
      }
      const text = await this.manager.exportPlaylist(playlist.id, { format });
      await this.savePlaylistFile(text, fileName, format);
    } catch (error) {
      this.uiManager?.setError?.(error.message || String(error), true);
    }
  }

  shouldExportRelativePaths() {
    const checkbox = this.content?.querySelector?.('.library-playlist-export-relative');
    return checkbox ? Boolean(checkbox.checked) : true;
  }

  async savePlaylistFile(text, fileName, format = 'm3u8') {
    const isXspf = format === 'xspf';
    const dialogTitle = this.t(isXspf ? 'library.action.exportXSPF' : 'library.action.exportM3U8');
    const filters = [{ name: 'Playlists', extensions: [isXspf ? 'xspf' : 'm3u8'] }];
    if (window.electronAPI?.showSaveDialog && window.electronAPI?.saveFile) {
      const result = await window.electronAPI.showSaveDialog({
        title: dialogTitle,
        defaultPath: fileName,
        filters
      });
      if (result?.canceled || !result?.filePath) return;
      const saveResult = await window.electronAPI.saveFile(result.filePath, text);
      if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'Failed to save playlist.');
      }
      return;
    }

    const mimeType = isXspf ? 'application/xspf+xml;charset=utf-8' : 'audio/x-mpegurl;charset=utf-8';
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    removeElement(link);
    URL.revokeObjectURL(url);
  }

  promptText(key, fallbackValue = '') {
    // window.prompt() is unavailable in Electron renderers, so use a modal
    // text-input dialog instead. Resolves with '' when the user cancels.
    return new Promise(resolve => {
      const label = this.t(key);
      const backdrop = document.createElement('div');
      const dialogId = nextDialogId('library-prompt');
      backdrop.className = 'library-dialog-backdrop';
      backdrop.innerHTML = `
        <form class="library-properties-dialog library-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="${dialogId}-title">
          <div class="library-properties-head">
            <h2 id="${dialogId}-title">${escapeHtml(label)}</h2>
            <button type="button" class="library-icon-button library-dialog-close" aria-label="${escapeHtml(this.t('library.dialog.close'))}">${ICONS.close}</button>
          </div>
          <div class="library-prompt-body" style="display: grid; gap: 12px; padding: 14px;">
            <label for="${dialogId}-input" style="position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;">${escapeHtml(label)}</label>
            <input id="${dialogId}-input" class="library-search library-prompt-input" type="text" autocomplete="off" spellcheck="false">
            <div class="library-prompt-actions" style="display: flex; justify-content: flex-end; gap: 8px;">
              <button type="button" class="library-button library-prompt-cancel">${escapeHtml(this.t('library.action.cancel'))}</button>
              <button type="submit" class="library-button library-prompt-ok">${escapeHtml(this.t('library.state.ok'))}</button>
            </div>
          </div>
        </form>
      `;
      const input = backdrop.querySelector('.library-prompt-input');
      if (input) input.value = fallbackValue == null ? '' : String(fallbackValue);
      let settled = false;
      let restoreDialogFocus = null;
      const finish = value => {
        if (settled) return;
        settled = true;
        removeElement(backdrop);
        restoreDialogFocus?.();
        this.flushPendingBreakpointRebuild();
        resolve(value == null ? '' : String(value).trim());
      };
      backdrop.addEventListener('click', event => {
        if (event.target === backdrop) finish(null);
      });
      backdrop.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation?.();
          finish(null);
        }
      });
      backdrop.querySelector('form')?.addEventListener('submit', event => {
        event.preventDefault();
        finish(input?.value);
      });
      backdrop.querySelector('.library-dialog-close')?.addEventListener('click', () => finish(null));
      backdrop.querySelector('.library-prompt-cancel')?.addEventListener('click', () => finish(null));
      document.body.appendChild(backdrop);
      restoreDialogFocus = setupModalFocus(backdrop, input);
      input?.select?.();
    });
  }

  renderSortHeader(column) {
    const active = this.sort === column.key;
    const direction = this.sortDirection === 'desc' ? 'desc' : 'asc';
    const label = this.t(column.labelKey);
    const ariaSort = active ? (direction === 'desc' ? 'descending' : 'ascending') : 'none';
    const ariaLabel = active
      ? this.t(direction === 'desc' ? 'library.sort.sortedDescending' : 'library.sort.sortedAscending', { column: label })
      : this.t('library.sort.sortBy', { column: label });
    const indicator = active ? ICONS[direction === 'desc' ? 'down' : 'up'] : '';
    return `
      <span class="library-sort-cell${active ? ' active' : ''}" role="columnheader" aria-sort="${ariaSort}">
        <button type="button" class="library-sort-button${active ? ' active' : ''}" data-sort="${escapeHtml(column.key)}" aria-label="${escapeHtml(ariaLabel)}">
          <span class="library-sort-label">${escapeHtml(label)}</span>
          <span class="library-sort-indicator" aria-hidden="true">${indicator}</span>
        </button>
      </span>
    `;
  }

  createTrackTable(tracks) {
    this.trackScrollCleanup?.();
    this.trackScrollCleanup = null;
    const table = document.createElement('div');
    table.className = 'library-track-table';
    table.setAttribute('role', 'grid');
    table.setAttribute('aria-multiselectable', 'true');
    table.setAttribute('aria-colcount', String(TRACK_SORT_COLUMNS.length + 2));
    table.setAttribute('aria-rowcount', String(tracks.length + 1));
    const header = document.createElement('div');
    header.className = 'library-track-header';
    header.setAttribute('role', 'row');
    header.setAttribute('aria-rowindex', '1');
    header.innerHTML = `
      <span class="library-track-control-header" role="columnheader" aria-label="${escapeHtml(this.t('library.action.play'))}"></span>
      ${TRACK_SORT_COLUMNS.map(column => this.renderSortHeader(column)).join('')}
      <span class="library-track-control-header" role="columnheader" aria-label="${escapeHtml(this.t('library.action.more'))}"></span>
    `;
    table.appendChild(header);
    header.querySelectorAll('[data-sort]').forEach(button => {
      button.addEventListener('click', () => {
        const sort = button.dataset.sort;
        this.sortDirection = this.sort === sort && this.sortDirection === 'asc' ? 'desc' : 'asc';
        this.sort = sort;
        this.saveUIState();
        if (this.detail?.type === 'album') this.detailSortOverride = true;
        this.render();
      });
    });

    const trackIds = tracks.map(track => track.id);
    this.currentVisibleTrackIds = trackIds;
    if (!this.focusedTrackId || !trackIds.includes(this.focusedTrackId)) {
      this.focusedTrackId = trackIds[0] || null;
    }
    const rowHeight = this.getTrackRowHeight();
    const virtual = document.createElement('div');
    virtual.className = 'library-track-virtual';
    virtual.style.height = `${tracks.length * rowHeight}px`;
    const rows = document.createElement('div');
    rows.className = 'library-track-rows';
    virtual.appendChild(rows);
    table.appendChild(virtual);

    let renderedStart = -1;
    let renderedEnd = -1;
    const renderWindow = () => {
      const viewportHeight = this.content?.clientHeight || 640;
      const scrollTop = this.content?.scrollTop || 0;
      const tableTop = table.offsetTop || 0;
      const headerHeight = header.offsetHeight || 40;
      const relativeTop = scrollTop > tableTop + headerHeight ? scrollTop - tableTop - headerHeight : 0;
      const bufferRows = 16;
      const start = Math.max(0, Math.floor(relativeTop / rowHeight) - bufferRows);
      const visibleCount = Math.ceil(viewportHeight / rowHeight) + bufferRows * 2;
      const end = Math.min(tracks.length, start + visibleCount);
      if (start === renderedStart && end === renderedEnd) return;
      renderedStart = start;
      renderedEnd = end;
      rows.innerHTML = '';
      rows.style.transform = `translateY(${start * rowHeight}px)`;
      for (let index = start; index < end; index += 1) {
        rows.appendChild(this.createTrackRow(tracks[index], index, trackIds, rowHeight));
      }
    };
    const onScroll = () => renderWindow();
    const onResize = () => {
      this.syncContentScrollbarInset();
      const nextHeight = this.getTrackRowHeight();
      if (nextHeight !== rowHeight) {
        // A breakpoint crossed. Rebuilding via render() would tear down an open
        // menu/dialog and reset scroll, so defer the rebuild while one is open.
        if (this.playlistMenu || this.contextMenu || this.hasActiveDialog?.()) {
          this.pendingBreakpointRebuild = true;
          return;
        }
        this.render();
        return;
      }
      renderedStart = -1;
      renderedEnd = -1;
      renderWindow();
    };
    this.content?.addEventListener('scroll', onScroll);
    globalThis.window?.addEventListener?.('resize', onResize);
    this.trackScrollCleanup = () => {
      this.content?.removeEventListener('scroll', onScroll);
      globalThis.window?.removeEventListener?.('resize', onResize);
    };
    renderWindow();
    return table;
  }

  createTrackRow(track, index, trackIds, rowHeight) {
    const row = document.createElement('div');
    const selected = this.selectedTrackIds.has(track.id);
    const nowPlaying = this.nowPlayingTrackId === track.id;
    const focused = this.focusedTrackId === track.id;
    row.className = `library-track-row ${selected ? 'selected' : ''} ${focused ? 'focused' : ''} ${nowPlaying ? 'now-playing' : ''}`;
    row.setAttribute('role', 'row');
    row.setAttribute('aria-rowindex', String(index + 2));
    row.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (nowPlaying) row.setAttribute('aria-current', 'true');
    row.dataset.trackId = track.id;
    row.draggable = true;
    row.tabIndex = focused ? 0 : -1;
    row.style.height = `${rowHeight}px`;
    const artistName = this.getTrackArtistLabel(track);
    const albumName = this.getTrackAlbumLabel(track);
    const artistDetail = this.getTrackArtistDetail(track);
    const mobileMeta = [artistName, formatDuration(track.durationSec)].filter(Boolean).join(' · ');
    const artistCell = artistDetail
      ? `<span class="library-gridcell library-artist-cell" role="gridcell"><button type="button" class="library-link library-artist-link">${escapeHtml(artistName)}</button></span>`
      : `<span class="library-gridcell library-artist-cell" role="gridcell">${escapeHtml(artistName)}</span>`;
    const albumCell = track.albumKey
      ? `<span class="library-gridcell library-album-cell" role="gridcell"><button type="button" class="library-link library-album-link">${escapeHtml(albumName)}</button></span>`
      : `<span class="library-gridcell library-album-cell" role="gridcell">${escapeHtml(albumName)}</span>`;
    row.innerHTML = `
      <span class="library-gridcell library-track-play-cell" role="gridcell"><button type="button" class="library-row-play" title="${escapeHtml(this.t('library.action.play'))}">${ICONS.play}</button><span class="library-mobile-select" aria-hidden="true"></span></span>
      <span class="library-gridcell library-track-title" role="gridcell"><span class="library-now-playing-indicator" aria-hidden="true" ${nowPlaying ? '' : 'hidden'}>♪</span><span class="library-track-title-text">${escapeHtml(track.title)}</span><span class="library-track-mobile-meta">${escapeHtml(mobileMeta)}</span></span>
      ${artistCell}
      ${albumCell}
      <span class="library-gridcell library-genre-cell" role="gridcell">${escapeHtml(track.genre || '')}</span>
      <span class="library-gridcell library-duration-cell" role="gridcell">${formatDuration(track.durationSec)}</span>
      <span class="library-gridcell library-track-more-cell" role="gridcell"><button type="button" class="library-icon-button library-row-more" title="${escapeHtml(this.t('library.action.more'))}" aria-label="${escapeHtml(this.t('library.action.more'))}">${ICONS.more}</button></span>
    `;
    let suppressNextClick = false;
    let touchTimer = null;
    const clearTouchTimer = () => {
      if (!touchTimer) return;
      clearTimeout(touchTimer);
      touchTimer = null;
    };
    row.addEventListener('click', event => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }
      if (event.target.closest?.('button')) return;
      if (isMobileLayout() && this.mobileSelectionMode) {
        event.preventDefault();
        this.toggleMobileTrackSelection(track.id);
        return;
      }
      if (isMobileLayout() && !this.selectedTrackIds.size && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        this.manager.playTrackIds(trackIds, { startIndex: index });
        return;
      }
      this.handleTrackSelection(event, trackIds, track.id, index);
    });
    row.addEventListener('focus', () => {
      this.focusedTrackId = track.id;
      this.refreshRenderedFocus();
    });
    row.addEventListener('dblclick', () => this.manager.playTrackIds(trackIds, { startIndex: index }));
    row.addEventListener('contextmenu', event => {
      const touchPending = touchTimer !== null;
      clearTouchTimer();
      if (touchPending && isMobileLayout()) {
        event.preventDefault?.();
        suppressNextClick = true;
        this.startMobileSelection(track.id);
        return;
      }
      this.openContextMenu(event, track, trackIds, index);
    });
    row.addEventListener('dragstart', event => this.handleTrackDragStart(event, trackIds, track.id));
    row.addEventListener('touchstart', event => {
      touchTimer = setTimeout(() => {
        touchTimer = null;
        if (isMobileLayout()) {
          event.preventDefault?.();
          suppressNextClick = true;
          this.startMobileSelection(track.id);
        } else {
          const touch = event.touches?.[0] || {};
          this.openContextMenu({
            preventDefault: () => event.preventDefault?.(),
            clientX: touch.clientX || 12,
            clientY: touch.clientY || 12
          }, track, trackIds, index);
        }
      }, 520);
    }, { passive: false });
    row.addEventListener('touchend', () => {
      clearTouchTimer();
    });
    row.addEventListener('touchmove', () => {
      clearTouchTimer();
    });
    row.querySelector('.library-row-play')?.addEventListener('click', () => this.manager.playTrackIds(trackIds, { startIndex: index }));
    row.querySelector('.library-row-more')?.addEventListener('click', event => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect?.() || { left: 16, bottom: 16 };
      this.openContextMenu({
        preventDefault() {},
        clientX: rect.left,
        clientY: rect.bottom + 4
      }, track, trackIds, index, { returnFocus: event.currentTarget });
    });
    row.querySelector('.library-artist-link')?.addEventListener('click', event => {
      event.stopPropagation();
      if (artistDetail) {
        this.navigateToDetail(artistDetail, 'artists');
      }
    });
    row.querySelector('.library-album-link')?.addEventListener('click', event => {
      event.stopPropagation();
      if (track.albumKey) {
        this.navigateToDetail({ type: 'album', key: track.albumKey }, 'albums');
      }
    });
    return row;
  }

  handleTrackDragStart(event, visibleTrackIds, trackId) {
    const ids = this.getSelectedTrackIds(visibleTrackIds, trackId);
    if (!ids.length || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-effetune-library-tracks', JSON.stringify(ids));
    event.dataTransfer.setData('text/plain', ids.join('\n'));
  }

  getTrackRowHeight() {
    return document.body?.classList.contains('layout-mobile') ? 56 : 40;
  }

  createActionBar(trackIds) {
    const bar = document.createElement('div');
    bar.className = 'library-action-bar';
    bar.innerHTML = `
      <button type="button" class="library-button library-action-play">${ICONS.play}<span>${escapeHtml(this.t('library.action.play'))}</span></button>
      <button type="button" class="library-button library-action-next">${ICONS.next}<span>${escapeHtml(this.t('library.action.playNext'))}</span></button>
      <button type="button" class="library-button library-action-queue">${ICONS.queue}<span>${escapeHtml(this.t('library.action.addToQueue'))}</span></button>
      <button type="button" class="library-button library-action-playlist">${ICONS.add}<span>${escapeHtml(this.t('library.action.addToPlaylist'))}</span></button>
    `;
    bar.querySelector('.library-action-play')?.addEventListener('click', () => this.manager.playTrackIds(this.getActionTrackIds(trackIds)));
    bar.querySelector('.library-action-next')?.addEventListener('click', () => this.manager.playNext(this.getActionTrackIds(trackIds)));
    bar.querySelector('.library-action-queue')?.addEventListener('click', () => this.manager.addToQueue(this.getActionTrackIds(trackIds)));
    bar.querySelector('.library-action-playlist')?.addEventListener('click', event => this.openAddToPlaylistMenu(event.currentTarget, this.getActionTrackIds(trackIds)));
    return bar;
  }

  renderEmptyLibrary() {
    this.content.appendChild(this.emptyState(this.t('library.state.empty'), true));
  }

  emptyState(message, withAction = false) {
    const empty = document.createElement('div');
    empty.className = 'library-empty';
    empty.innerHTML = `
      <div class="library-empty-icon" aria-hidden="true"></div>
      <h2>${escapeHtml(message)}</h2>
      ${withAction ? `<button type="button" class="library-button library-empty-add">${ICONS.add}<span>${escapeHtml(this.t('library.action.addFolder'))}</span></button>` : ''}
    `;
    empty.querySelector('.library-empty-add')?.addEventListener('click', () => this.handleAddFolder());
    return empty;
  }

  async handleAddFolder() {
    let rejected = false;
    const unsubscribe = this.manager.addListener?.('folder-add-rejected', () => {
      rejected = true;
    });
    try {
      const folder = await this.manager.addFolder();
      if (folder && !rejected) {
        this.navigateToView('tracks');
      }
    } catch (error) {
      this.uiManager.setError(error.message || String(error), true);
    } finally {
      unsubscribe?.();
    }
  }

  handleFolderAddRejected(info = {}) {
    if (info.reason === 'merge-canceled') return;
    const name = info.folder?.displayName || info.folder?.path || '';
    const existing = info.existing?.displayName || info.existing?.path || '';
    const key = info.reason === 'same-root' ? 'library.error.folderAlreadyAdded' : 'library.error.folderInsideExisting';
    this.uiManager?.setError?.(this.t(key, { name, existing }), true);
  }

  renderStatus(scanState = this.lastScanState) {
    if (!this.status) return;
    this.syncContentScrollbarInset();
    const counts = this.manager.getCounts();
    const parts = [
      `${counts.tracks} ${this.t('library.status.tracks')}`,
      `${counts.albums} ${this.t('library.status.albums')}`
    ];
    if (this.selectedTrackIds.size) {
      parts.push(this.t('library.status.selected', { count: this.selectedTrackIds.size }));
    }
    if (scanState?.phase === 'scanning') {
      parts.push(`${this.t('library.state.scanning')} ${scanState.parsed || 0}/${scanState.found || 0}`);
    } else if (scanState?.phase === 'error') {
      parts.push(scanState.error || this.t('library.state.scanError'));
    }
    this.status.innerHTML = `<span>${escapeHtml(parts.join(' · '))}</span>`;
    if (this.queueUndoAvailable) {
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'library-status-button';
      undo.textContent = this.t('library.action.undoQueueReplace');
      undo.addEventListener('click', async () => {
        if (await this.manager.restorePlaybackQueue?.()) {
          this.queueUndoAvailable = false;
          this.renderStatus();
        }
      });
      this.status.appendChild(undo);
    }
    if (this.nowPlayingTrackId && this.manager.getTrackById(this.nowPlayingTrackId)) {
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'library-status-button';
      jump.textContent = this.t('library.action.jumpToNowPlaying');
      jump.addEventListener('click', () => this.showTrack(this.nowPlayingTrackId));
      this.status.appendChild(jump);
    }
    if (scanState?.phase === 'scanning' && scanState.scanId) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'library-status-button library-status-cancel';
      cancel.textContent = this.t('library.action.cancel');
      cancel.addEventListener('click', () => this.manager.cancelScan(scanState.scanId));
      this.status.appendChild(cancel);
    }
  }

  t(key, params = {}) {
    const text = this.uiManager?.t ? this.uiManager.t(key, params) : key;
    return text === key ? fallbackText(key, params) : text;
  }
}

function fallbackText(key, params = {}) {
  const map = {
    'library.title': 'Music Library',
    'library.nav.tracks': 'Tracks',
    'library.nav.albums': 'Albums',
    'library.nav.artists': 'Artists',
    'library.nav.genres': 'Genres',
    'library.nav.folders': 'Folders',
    'library.nav.playlists': 'Playlists',
    'library.nav.recentlyAdded': 'Recently Added',
    'library.search.placeholder': 'Search library',
    'library.search.results': 'Search Results',
    'library.action.addFolder': 'Add Music Folder',
    'library.action.rescan': 'Rescan',
    'library.action.removeFolder': 'Remove',
    'library.action.play': 'Play',
    'library.action.shuffle': 'Shuffle',
    'library.action.playNext': 'Play Next',
    'library.action.addToQueue': 'Add to Queue',
    'library.action.addToPlaylist': 'Add to Playlist',
    'library.action.newPlaylist': 'New Playlist',
    'library.action.importPlaylist': 'Import Playlist',
    'library.action.exportM3U8': 'Export M3U8',
    'library.action.exportXSPF': 'Export XSPF',
    'library.action.rename': 'Rename',
    'library.action.duplicate': 'Duplicate',
    'library.action.delete': 'Delete',
    'library.action.reorder': 'Reorder',
    'library.action.locate': 'Locate',
    'library.action.moveUp': 'Move Up',
    'library.action.moveDown': 'Move Down',
    'library.action.remove': 'Remove',
    'library.action.goToAlbum': 'Go to Album',
    'library.action.goToArtist': 'Go to Artist',
    'library.action.showInFolder': 'Show in Folder',
    'library.action.showInLibrary': 'Show in Library',
    'library.action.saveQueueAsPlaylist': 'Save Queue as Playlist',
    'library.action.jumpToNowPlaying': 'Jump to Now Playing',
    'library.action.undoQueueReplace': 'Undo Queue Replace',
    'library.action.properties': 'Properties',
    'library.action.more': 'More',
    'library.action.removeFromPlaylist': 'Remove from Playlist',
    'library.action.reconnect': 'Reconnect',
    'library.action.cancel': 'Cancel',
    'library.dialog.close': 'Close',
    'library.properties.heading': 'Track Properties',
    'library.properties.title': 'Title',
    'library.properties.artist': 'Artist',
    'library.properties.album': 'Album',
    'library.properties.genre': 'Genre',
    'library.properties.year': 'Year',
    'library.properties.track': 'Track',
    'library.properties.duration': 'Duration',
    'library.properties.file': 'File',
    'library.properties.path': 'Path',
    'library.properties.format': 'Format',
    'library.properties.sampleRate': 'Sample rate',
    'library.properties.bitDepth': 'Bit depth',
    'library.properties.bitrate': 'Bitrate',
    'library.importPreview.message': `Import "${params.name || 'Playlist'}"?\nResolved ${params.resolved || 0}/${params.total || 0} tracks.`,
    'library.importPreview.unresolved': 'Unresolved tracks:',
    'library.importPreview.moreUnresolved': `${params.count || 0} more unresolved tracks`,
    'library.playlist.copyName': `Copy of ${params.name || 'Playlist'}`,
    'library.option.relativePaths': 'Relative paths',
    'library.prompt.queuePlaylistName': 'Queue',
    'library.prompt.playlistName': 'Playlist name',
    'library.prompt.renamePlaylist': 'Rename playlist',
    'library.status.tracks': 'tracks',
    'library.status.albums': 'albums',
    'library.status.unresolved': 'unresolved',
    'library.unknownArtist': UNKNOWN_ARTIST,
    'library.unknownAlbum': UNKNOWN_ALBUM,
    'library.status.selected': `${params.count || 0} selected`,
    'library.status.moreTracks': `${params.count || 0} more`,
    'library.state.empty': 'Build your music library',
    'library.state.noResults': `No results for "${params.query || ''}"`,
    'library.state.noPlaylists': 'No playlists yet',
    'library.state.noResolvedTracks': 'This playlist has no available tracks.',
    'library.state.noMatchingTrack': 'No matching track was found in the current library.',
    'library.state.scanning': 'Scanning',
    'library.state.scanError': 'Scan failed',
    'library.state.ok': 'OK',
    'library.state.missing': 'Missing',
    'library.state.needs-permission': 'Reconnect',
    'library.state.never-scanned': 'Not scanned',
    'library.state.neverScanned': 'Not scanned',
    'library.column.title': 'Title',
    'library.column.artist': 'Artist',
    'library.column.album': 'Album',
    'library.column.genre': 'Genre',
    'library.column.duration': 'Time',
    'library.sort.sortBy': `Sort by ${params.column || ''}`,
    'library.sort.sortedAscending': `${params.column || ''} sorted ascending`,
    'library.sort.sortedDescending': `${params.column || ''} sorted descending`,
    'library.confirm.removeFolder': 'Remove this folder from the catalog? Files on disk will not be deleted.',
    'library.confirm.deletePlaylist': 'Delete this playlist?',
    'library.error.folderAlreadyAdded': `${params.name || 'This folder'} is already in your library.`,
    'library.error.folderInsideExisting': `${params.name || 'This folder'} is already included in ${params.existing || 'an existing folder'}.`
  };
  return map[key] || key;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setClass(element, className, enabled) {
  if (!element?.classList) return;
  if (typeof element.classList.toggle === 'function') {
    element.classList.toggle(className, enabled);
  } else if (enabled) {
    element.classList.add?.(className);
  } else {
    element.classList.remove?.(className);
  }
}

function getViewportHeight() {
  const visualViewportHeight = Number(globalThis.window?.visualViewport?.height);
  if (Number.isFinite(visualViewportHeight) && visualViewportHeight > 0) return visualViewportHeight;
  const innerHeight = Number(globalThis.window?.innerHeight);
  if (Number.isFinite(innerHeight) && innerHeight > 0) return innerHeight;
  const documentHeight = Number(globalThis.document?.documentElement?.clientHeight);
  return Number.isFinite(documentHeight) && documentHeight > 0 ? documentHeight : 0;
}

function getViewportTop() {
  const offsetTop = Number(globalThis.window?.visualViewport?.offsetTop);
  return Number.isFinite(offsetTop) ? offsetTop : 0;
}

function getAppVersionDisplayElement() {
  const versionElement = globalThis.document?.getElementById?.('app-version');
  return versionElement?.parentElement || versionElement?.parentNode || null;
}

function getElementOuterBlockSize(element) {
  if (!element) return 0;
  const style = getComputedStyleSafe(element);
  if (style?.display === 'none') return 0;
  const rect = element.getBoundingClientRect?.();
  const height = Number(rect?.height);
  const marginTop = parseCssPixelValue(style?.marginTop);
  const marginBottom = parseCssPixelValue(style?.marginBottom);
  return (Number.isFinite(height) && height > 0 ? height : 0) + marginTop + marginBottom;
}

function getComputedStyleSafe(element) {
  const getComputedStyle = globalThis.window?.getComputedStyle || globalThis.getComputedStyle;
  try {
    return typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
  } catch (_) {
    return null;
  }
}

function parseCssPixelValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function setStyleProperty(element, name, value) {
  if (!element?.style) return;
  if (typeof element.style.setProperty === 'function') {
    element.style.setProperty(name, value);
  } else {
    element.style[name] = value;
  }
}

function removeStyleProperty(element, name) {
  if (!element?.style) return;
  if (typeof element.style.removeProperty === 'function') {
    element.style.removeProperty(name);
  } else {
    delete element.style[name];
  }
}

function isMobileLayout() {
  return globalThis.document?.body?.classList.contains('layout-mobile');
}

function isEditableTarget(target) {
  const tagName = target?.tagName?.toLowerCase?.() || '';
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || Boolean(target?.isContentEditable);
}

function getRestorableFocusElement(element) {
  if (!element || typeof element.focus !== 'function') return null;
  if (element.disabled || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return null;
  if ('isConnected' in element && !element.isConnected) return null;
  return element;
}

function getActiveLibraryDialogBackdrop() {
  const fromQuery = document.querySelector?.('.library-dialog-backdrop');
  if (fromQuery) return fromQuery;
  return Array.from(document.body?.children || [])
    .find(element => hasClassName(element, 'library-dialog-backdrop')) || null;
}

function hasClassName(element, className) {
  if (element?.classList?.contains?.(className)) return true;
  return String(element?.className || '').split(/\s+/).includes(className);
}

function nextDialogId(prefix) {
  libraryDialogId += 1;
  return `${prefix}-${libraryDialogId}`;
}

function setupModalFocus(backdrop, initialFocus = null, returnFocus = null) {
  const previousFocus = getRestorableFocusElement(returnFocus) || getRestorableFocusElement(document.activeElement);
  const onKeyDown = event => {
    if (event.key !== 'Tab') return;
    const focusable = getFocusableDialogElements(backdrop);
    if (!focusable.length) {
      event.preventDefault?.();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !focusable.includes(active)) {
        event.preventDefault?.();
        last.focus?.();
      }
      return;
    }
    if (active === last || !focusable.includes(active)) {
      event.preventDefault?.();
      first.focus?.();
    }
  };
  backdrop.addEventListener?.('keydown', onKeyDown);
  (initialFocus || getFocusableDialogElements(backdrop)[0] || backdrop).focus?.();
  return () => {
    backdrop.removeEventListener?.('keydown', onKeyDown);
    getRestorableFocusElement(previousFocus)?.focus?.();
  };
}

function getFocusableDialogElements(container) {
  return Array.from(container?.querySelectorAll?.(FOCUSABLE_DIALOG_SELECTOR) || [])
    .filter(element => !element.disabled && !element.hidden && element.getAttribute?.('aria-hidden') !== 'true');
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatTrackNumber(track) {
  if (!track?.trackNo) return '';
  return track.trackOf ? `${track.trackNo}/${track.trackOf}` : String(track.trackNo);
}

function formatNumber(value, suffix = '') {
  return Number.isFinite(value) ? `${value}${suffix}` : '';
}

function base64ToUint8Array(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function sanitizeFileName(value) {
  return String(value || 'playlist')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/./g, char => char.charCodeAt(0) < 32 ? '_' : char)
    .replace(/\s+/g, ' ')
    .trim() || 'playlist';
}

function removeElement(element) {
  if (!element) return;
  if (typeof element.remove === 'function') {
    element.remove();
  } else {
    element.parentNode?.removeChild?.(element);
  }
}

function isPlaylistFileName(name = '') {
  return /\.(m3u8?|pls|xspf)$/i.test(String(name));
}

function hasPlaylistFiles(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []);
  if (files.some(file => isPlaylistFileName(file.name))) return true;
  const types = Array.from(dataTransfer?.types || []);
  return types.includes('Files') && files.length === 0;
}

function isPlaylistItemDrag(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  return types.includes(PLAYLIST_ITEM_DRAG_TYPE);
}

function clampMenuToViewport(menu) {
  if (!menu?.style || typeof window === 'undefined') return;
  const rect = menu.getBoundingClientRect?.();
  if (!rect) return;
  const maxLeft = Math.max(4, (window.innerWidth || 0) - rect.width - 4);
  const maxTop = Math.max(4, (window.innerHeight || 0) - rect.height - 4);
  const left = Number.parseFloat(menu.style.left) || 0;
  const top = Number.parseFloat(menu.style.top) || 0;
  menu.style.left = `${Math.min(Math.max(4, left), maxLeft)}px`;
  menu.style.top = `${Math.min(Math.max(4, top), maxTop)}px`;
}
