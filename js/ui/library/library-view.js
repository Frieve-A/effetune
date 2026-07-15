import {
  MUSIC_LIBRARY_UI_STORAGE_KEY,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
  normalizeMusicLibraryStartupView
} from '../../library/constants.js';
import {
  getMissingPagedManagerMethods,
  PagedLibraryViewController
} from './paged-view-controller.js';
import { SegmentedVirtualListGeometry } from './segmented-virtual-list.js';
import { SegmentedVirtualGridGeometry } from './segmented-virtual-grid.js';
import { PagedArtworkLoader } from './artwork-loader.js';
import { DurableActionController } from './durable-action-controller.js';

const VIEW_LABELS = {
  tracks: 'library.nav.tracks',
  albums: 'library.nav.albums',
  artists: 'library.nav.artists',
  genres: 'library.nav.genres',
  subfolders: 'library.nav.subfolders',
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
const LIBRARY_SEARCH_DEBOUNCE_MS = 100;
export const PAGED_RENDERED_ROW_LIMIT = 80;
export const WEB_PLAYLIST_BLOB_EXPORT_MAX_BYTES = 32 * 1024 * 1024;

export class WebPlaylistExportLimitError extends Error {
  constructor(limitBytes, actualBytes) {
    super(`Playlist export exceeds the ${limitBytes}-byte browser limit.`);
    this.name = 'WebPlaylistExportLimitError';
    this.code = 'playlistExportTooLarge';
    this.limitBytes = limitBytes;
    this.actualBytes = actualBytes;
  }
}

export function getPagedPlaylistTarget(playlist) {
  const playlistId = playlist?.playlistId ?? playlist?.id;
  const expectedTargetVersion = Number(playlist?.version);
  if (typeof playlistId !== 'string' || !playlistId ||
      !Number.isSafeInteger(expectedTargetVersion) || expectedTargetVersion < 0) {
    return { accepted: false, reason: 'playlist-version-unavailable' };
  }
  return {
    accepted: true,
    target: { playlistId, name: playlist?.name ?? '' },
    expectedTargetVersion
  };
}

export class LibraryView {
  constructor({ manager, uiManager }) {
    this.manager = manager;
    this.uiManager = uiManager;
    this.pagedIntegrationRequired = true;
    this.pagedManagerMissing = getMissingPagedManagerMethods(manager);
    this.pagedController = null;
    this.pagedQueryKey = null;
    this.pagedState = null;
    this.pagedRenderOffset = 0;
    this.pagedAnchor = null;
    this.pagedViewportOrdinal = 0;
    this.pagedViewportOffsetPx = 0;
    this.pagedRestorePending = false;
    this.pagedRestartPreservesSelection = false;
    this.pagedPageLoadPending = false;
    this.pagedPendingFocusKey = null;
    this.pagedPendingEntityJump = null;
    this.pagedArtworkLoader = null;
    this.pagedFocusParked = false;
    this.pagedPublishedAnnouncementIds = new Set();
    this.pagedFocusedOrdinal = 0;
    this.pagedFocusedEntityId = null;
    this.pagedActionController = this.createPagedActionController();
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
    this.renderedPageTrackIds = [];
    this.focusedTrackId = null;
    this.nowPlayingTrackId = null;
    this.queueUndoAvailable = false;
    this.searchComposing = false;
    this.searchDebounceTimer = null;
    this.mobileHistoryInitialized = false;
    this.mobileHistoryDepth = 0;
    this.suppressPopStateCount = 0;
    this.mobileSelectionMode = false;
    this.isViewShown = false;
    this.lastRevealedMobileNavView = null;
    this.typeJumpBuffer = '';
    this.typeJumpTimer = null;
    this.renderScheduled = false;
    this.libraryReturnFocus = null;
    this.artworkRequestVersion = 0;
    this.pendingArtworkUrlReleases = new Set();
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
      this.scheduleSearchQuery();
    });
    this.searchInput.addEventListener('input', () => {
      if (this.searchComposing) return;
      this.scheduleSearchQuery();
    });
    this.searchInput.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.searchInput.value) {
        event.preventDefault();
        this.searchInput.value = '';
        this.searchQuery = '';
        this.detail = null;
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = null;
        this.render();
      }
    });
    this.content.addEventListener('keydown', event => this.handleContentKeyDown(event));
    this.content.addEventListener('dragover', event => this.handlePlaylistFileDragOver(event));
    this.content.addEventListener('drop', event => this.handlePlaylistFileDrop(event));
    document.addEventListener('keydown', event => this.handleGlobalLibraryKeyDown(event));
    globalThis.window?.addEventListener?.('popstate', event => this.handleMobilePopState(event));
    this.root.querySelector('.library-add-folder')?.addEventListener('click', () => this.handleAddFolder());
    this.root.querySelector('.library-rescan')?.addEventListener('click', () => this.handleScanFolders());
    if (typeof this.manager.addListener === 'function') {
      this.unsubscribe.push(
        this.manager.addListener('ready', () => this.render()),
        this.manager.addListener('catalog-changed', event => this.handleCatalogInvalidation(event)),
        this.manager.addListener('folders-changed', () => {
          if (!this.pagedIntegrationRequired) this.render();
        }),
        this.manager.addListener('playlists-changed', () => {
          if (!this.pagedIntegrationRequired) this.render();
        }),
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
    }
    this.render();
    if (this.pagedActionController) void this.pagedActionController.recover();
    return this.root;
  }

  createPagedActionController() {
    const required = [
      'lookupLibraryOperation', 'getLibraryOperationStatus',
      'cancelLibraryOperation', 'subscribeLibraryOperation'
    ];
    if (!required.every(method => typeof this.manager?.[method] === 'function')) return null;
    return new DurableActionController({
      service: this.manager,
      onStateChange: () => this.renderPagedJobRegion()
    });
  }

  handleCatalogInvalidation(event) {
    if (!this.pagedIntegrationRequired) {
      this.scheduleRender();
      return;
    }
    const decision = getPagedInvalidationDecision(this.getPagedQuery(), event);
    if (!decision.restart) {
      this.renderPagedNav();
      void this.renderPagedStatus();
      return;
    }
    this.capturePagedAnchor();
    this.pagedController?.markSelectionStale();
    this.pagedRestartPreservesSelection = true;
    this.pagedQueryKey = null;
    this.scheduleRender();
  }

  handlePagedSnapshotExpiry(error) {
    if (!isPagedSnapshotExpiryError(error)) return false;
    this.capturePagedAnchor();
    this.pagedController?.markSelectionStale();
    this.pagedRestartPreservesSelection = true;
    this.pagedQueryKey = null;
    this.scheduleRender();
    return true;
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
    const { focusSearch = true, returnFocus = null, initialView } = options || {};
    this.isViewShown = false;
    this.lastRevealedMobileNavView = null;
    if (initialView !== undefined) {
      this.currentView = normalizeMusicLibraryStartupView(initialView);
      this.detail = null;
      this.detailSortOverride = false;
      this.searchQuery = '';
      if (this.searchInput) this.searchInput.value = '';
    }
    this.mount();
    this.captureLibraryReturnFocus(returnFocus || document.activeElement);
    document.body.classList.add('view-library');
    this.startDesktopLayoutHeightTracking();
    this.updateDesktopLayoutHeight();
    this.syncNowPlayingTrack();
    this.isViewShown = true;
    this.render();
    if (focusSearch) this.searchInput?.focus();
  }

  hide(options = {}) {
    const { restoreFocus = true, returnFocus = null, fallbackFocus = null } = options || {};
    const shouldRestoreFocus = restoreFocus && this.shouldRestoreLibraryFocus();
    this.isViewShown = false;
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = null;
    if (this.pagedIntegrationRequired && this.pagedController) {
      this.capturePagedAnchor();
      void this.pagedController.destroy();
      this.pagedController = null;
      this.pagedQueryKey = null;
      this.pagedState = null;
    }
    this.pendingBreakpointRebuild = false;
    this.closeContextMenu({ restoreFocus: false });
    this.closePlaylistMenu({ restoreFocus: false });
    this.stopDesktopLayoutHeightTracking();
    // Tear down the track-table scroll/resize listeners so the window 'resize'
    // handler does not survive teardown and re-render the hidden view.
    this.trackScrollCleanup?.();
    this.trackScrollCleanup = null;
    this.destroyPagedArtworkLoader();
    this.invalidateArtworkRequests();
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

  scheduleSearchQuery() {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.searchDebounceTimer = null;
      this.searchQuery = this.searchInput?.value || '';
      this.detail = null;
      this.render();
    }, LIBRARY_SEARCH_DEBOUNCE_MS);
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
    const track = this.pagedIntegrationRequired
      ? await this.manager.getTrack(trackId)
      : this.manager.getTrackById(trackId);
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
    if (this.pagedIntegrationRequired) {
      this.pagedPendingEntityJump = { entityKind: 'track', entityId: trackId };
    } else {
      this.setSelection([trackId]);
    }
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
    if (this.pagedIntegrationRequired) {
      this.pagedPendingEntityJump = { entityKind: 'track', entityId: trackId };
      if (this.pagedState?.phase === 'committed') {
        const jump = this.pagedPendingEntityJump;
        this.pagedPendingEntityJump = null;
        void this.jumpPagedToEntity(jump.entityKind, jump.entityId);
      }
      return;
    }
    const index = this.renderedPageTrackIds.indexOf(trackId);
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

  async jumpPagedToEntity(entityKind, entityId) {
    const result = await this.pagedController?.jumpToEntity(entityKind, entityId);
    if (!result?.accepted) return result;
    if (Number.isSafeInteger(result.ordinal)) this.pagedViewportOrdinal = result.ordinal;
    if (entityKind === 'track' && Number.isSafeInteger(result.ordinal)) {
      this.pagedController.toggleSelection(entityId, true, { ordinal: result.ordinal });
    }
    this.pagedViewportOffsetPx = 0;
    this.pagedPendingFocusKey = entityId;
    this.renderPagedCommitted(this.pagedController.createViewState());
    return result;
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
    this.invalidateArtworkRequests();
    this.pendingBreakpointRebuild = false;
    const renderVersion = ++this.renderVersion;
    this.syncNowPlayingTrack();
    this.closePlaylistMenu({ restoreFocus: false });
    this.closeContextMenu();
    this.trackScrollCleanup?.();
    this.trackScrollCleanup = null;
    // Clear the visible track list so keyboard actions do not operate on a
    // stale list in views without a track table; createTrackTable repopulates it.
    this.renderedPageTrackIds = [];
    if (this.pagedIntegrationRequired) {
      this.renderPagedLibrary(renderVersion);
      this.renderStatus();
      return;
    }
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
    } else if (this.detail?.type === 'subfolder') {
      this.renderTrackList(this.manager.getSubfolderTracks(this.detail.key), this.detail.title);
    } else if (this.detail?.type === 'folder') {
      this.renderTrackList(this.manager.getFolderTracks(this.detail.key), this.detail.title);
    } else if (this.currentView === 'albums') {
      this.renderAlbums();
    } else if (this.currentView === 'artists') {
      this.renderArtists();
    } else if (this.currentView === 'genres') {
      this.renderGenres();
    } else if (this.currentView === 'subfolders') {
      this.renderSubfolders();
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

  renderPagedLibrary(renderVersion) {
    this.renderPagedNav();
    if (this.pagedManagerMissing.length > 0) {
      this.renderPagedUnavailable(this.pagedManagerMissing);
      return;
    }
    const query = this.getPagedQuery();
    const queryKey = JSON.stringify(query);
    if (!this.pagedController) {
      this.pagedController = new PagedLibraryViewController({
        manager: this.manager,
        runtime: globalThis.electronAPI ? 'electron' : 'web',
        onRowsInvalidated: () => this.markPagedRowsInert(),
        onStateChange: state => {
          if (renderVersion > this.renderVersion) return;
          this.pagedState = state;
          this.renderPagedState(state);
          if (state.phase === 'committed' && this.pagedRestorePending) {
            this.pagedRestorePending = false;
            void this.restorePagedAnchor();
          }
          if (state.phase === 'committed' && this.pagedPendingEntityJump) {
            const jump = this.pagedPendingEntityJump;
            this.pagedPendingEntityJump = null;
            void this.jumpPagedToEntity(jump.entityKind, jump.entityId);
          }
        },
        seekOrdinal: typeof this.manager.readContextPageAtOrdinal === 'function'
          ? request => this.manager.readContextPageAtOrdinal(request)
          : null,
        seekAnchor: typeof this.manager.resolveEntityAnchor === 'function'
          ? request => this.manager.resolveEntityAnchor(request)
          : null
      });
    }
    if (this.pagedQueryKey !== queryKey) {
      const canRestore = this.pagedAnchor?.queryFingerprint === queryKey;
      const preserveStaleSelection = this.pagedRestartPreservesSelection;
      this.pagedRestartPreservesSelection = false;
      this.pagedQueryKey = queryKey;
      this.pagedRenderOffset = 0;
      this.pagedViewportOrdinal = 0;
      this.pagedViewportOffsetPx = 0;
      this.pagedFocusedOrdinal = 0;
      this.pagedFocusedEntityId = null;
      this.pagedPendingFocusKey = null;
      this.pagedRestorePending = canRestore;
      this.markPagedRowsInert();
      void this.pagedController.start(query, { preserveStaleSelection });
      return;
    }
    this.renderPagedState(this.pagedState ?? this.pagedController.createViewState());
  }

  getPagedQuery() {
    if (this.searchQuery.trim()) {
      return {
        endpoint: 'tracks',
        query: this.searchQuery.trim(),
        sort: this.sort,
        direction: this.sortDirection,
        scope: null
      };
    }
    if (this.detail) {
      const scopeKey = this.detail.type === 'playlist' ? 'playlistId' : `${this.detail.type}Key`;
      return {
        endpoint: 'tracks',
        query: '',
        sort: this.sort,
        direction: this.sortDirection,
        scope: { [scopeKey]: this.detail.key }
      };
    }
    const entityType = {
      albums: 'album',
      artists: 'artist',
      genres: 'genre',
      subfolders: 'subfolder',
      folders: 'folder',
      playlists: 'playlist'
    }[this.currentView];
    if (entityType) {
      return {
        endpoint: 'entities',
        entityType,
        query: '',
        sort: 'name',
        direction: this.sortDirection,
        scope: null
      };
    }
    return {
      endpoint: 'tracks',
      query: '',
      sort: this.currentView === 'recent' ? 'added' : this.sort,
      direction: this.currentView === 'recent' ? 'desc' : this.sortDirection,
      scope: this.currentView === 'recent' ? { recent: true } : null
    };
  }

  renderPagedNav() {
    const items = ['tracks', 'albums', 'artists', 'genres', 'subfolders', 'folders', 'recent', 'playlists'];
    const renderCounts = counts => {
      if (!this.nav) return;
      this.nav.innerHTML = items.map(view => {
        const count = view === 'recent' ? '' : counts?.[view];
        const active = this.currentView === view;
        return `<button type="button" class="library-nav-item ${active ? 'active' : ''}" data-view="${view}"${active ? ' aria-current="page"' : ''}>
          <span>${escapeHtml(this.t(VIEW_LABELS[view]))}</span>
          ${Number.isSafeInteger(count) ? `<span class="library-count">${count}</span>` : ''}
        </button>`;
      }).join('');
      this.nav.querySelectorAll('[data-view]').forEach(button => {
        button.addEventListener('click', () => this.navigateToView(button.dataset.view));
      });
    };
    renderCounts(null);
    Promise.resolve(this.manager.getCounts()).then(renderCounts).catch(() => {});
  }

  renderPagedUnavailable(missingMethods) {
    if (!this.content) return;
    this.content.setAttribute('aria-busy', 'false');
    this.content.innerHTML = `
      <section class="library-paged-error" role="alert">
        <h2>${escapeHtml(this.t('library.title'))}</h2>
        <p>${escapeHtml(this.t('library.paged.serviceUnavailable'))}</p>
        <code>${escapeHtml(missingMethods.join(', '))}</code>
      </section>
    `;
  }

  markPagedRowsInert() {
    if (!this.content) return;
    const activeElement = globalThis.document?.activeElement;
    let invalidatedFocus = false;
    this.content.querySelectorAll?.('.library-paged-row, .library-track-row').forEach(row => {
      if (activeElement && row.contains?.(activeElement)) invalidatedFocus = true;
      row.inert = true;
      row.setAttribute('aria-hidden', 'true');
      row.setAttribute('aria-disabled', 'true');
    });
    if (invalidatedFocus) {
      this.pagedFocusParked = true;
      this.content.focus?.();
    } else if (activeElement !== this.content) {
      this.pagedFocusParked = false;
    }
  }

  async restorePagedAnchor() {
    const anchor = this.pagedAnchor;
    const result = await this.pagedController?.restoreAnchor(anchor);
    if (!result?.accepted) {
      if (result?.reason === 'query-mismatch') {
        this.pagedViewportOrdinal = 0;
        this.pagedViewportOffsetPx = 0;
      }
      return result;
    }
    if (Number.isSafeInteger(result.ordinal)) this.pagedViewportOrdinal = result.ordinal;
    this.pagedViewportOffsetPx = Number(result.viewportOffsetPx) || 0;
    this.pagedPendingFocusKey = result.focusKey ?? null;
    this.renderPagedCommitted(this.pagedController.createViewState());
    return result;
  }

  isCurrentPagedAttempt(state) {
    if (!state || !this.pagedController?.firstPage) return false;
    return this.pagedController.firstPage.isCurrent(
      state.queryGeneration,
      state.pageAttemptId
    );
  }

  createPagedAttemptShell(state) {
    const shell = document.createElement('section');
    shell.className = 'library-paged-attempt';
    shell.dataset.queryGeneration = String(state.queryGeneration);
    shell.dataset.pageAttemptId = String(state.pageAttemptId);
    const live = document.createElement('p');
    live.className = 'library-paged-live';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    const announcementId = state.liveAnnouncementId;
    if (announcementId && !this.pagedPublishedAnnouncementIds.has(announcementId)) {
      live.textContent = state.phase === 'committed' && Number.isSafeInteger(state.totalCount)
        ? `${state.totalCount} ${this.t('library.status.tracks')}`
        : state.liveAnnouncement || '';
      this.pagedPublishedAnnouncementIds.clear();
      this.pagedPublishedAnnouncementIds.add(announcementId);
    }
    shell.appendChild(live);
    return shell;
  }

  publishPagedAttemptDom(state, shell) {
    if (!this.isCurrentPagedAttempt(state)) return false;
    this.content.setAttribute('aria-busy', state.ariaBusy ? 'true' : 'false');
    this.content.setAttribute('aria-rowcount', String(state.ariaRowCount ?? -1));
    this.content.replaceChildren(shell);
    return true;
  }

  announcePagedStatus(message) {
    const live = this.content?.querySelector?.('.library-paged-live');
    if (live) live.textContent = String(message || '');
  }

  renderPagedState(state) {
    if (!this.content || !state || !this.isCurrentPagedAttempt(state)) return;
    if (state.phase === 'loading') {
      this.markPagedRowsInert();
      const shell = this.createPagedAttemptShell(state);
      const status = document.createElement('p');
      status.className = 'library-paged-loading';
      status.setAttribute('role', 'status');
      status.textContent = this.t('library.paged.loading');
      shell.appendChild(status);
      this.publishPagedAttemptDom(state, shell);
      return;
    }
    if (state.phase === 'failed' || state.phase === 'timedOut') {
      console.error('Music Library page load failed:', state.error);
      const shell = this.createPagedAttemptShell(state);
      shell.innerHTML += `
        <section class="library-paged-error" role="alert">
          <p>${escapeHtml(this.t('library.paged.loadFailed'))}</p>
          <button type="button" class="library-button library-paged-retry">${escapeHtml(this.t('library.paged.retry'))}</button>
        </section>
      `;
      this.publishPagedAttemptDom(state, shell);
      const retry = shell.querySelector('.library-paged-retry');
      retry?.addEventListener('click', () => {
        void this.pagedController.retry();
      });
      if (this.pagedFocusParked && globalThis.document?.activeElement === this.content &&
          this.isCurrentPagedAttempt(state)) retry?.focus?.();
      return;
    }
    if (state.phase !== 'committed') return;
    this.renderPagedCommitted(state);
  }

  renderPagedCommitted(state) {
    if (!this.isCurrentPagedAttempt(state)) return;
    this.trackScrollCleanup?.();
    this.trackScrollCleanup = null;
    this.destroyPagedArtworkLoader();
    const rows = state.rows;
    const totalCount = Number.isSafeInteger(state.totalCount) ? state.totalCount : null;
    const isTrackQuery = this.getPagedQuery().endpoint === 'tracks';
    const currentPageStart = Number.isSafeInteger(state.pageStartOrdinal)
      ? state.pageStartOrdinal
      : state.currentPageIndex * this.pagedController.pageLimit;
    const logicalCount = totalCount ?? Math.max(
      currentPageStart + rows.length,
      currentPageStart + (state.nextCursor ? this.pagedController.pageLimit * 2 : rows.length)
    );
    if (logicalCount > 0) {
      this.pagedViewportOrdinal = Math.max(0, Math.min(logicalCount - 1, this.pagedViewportOrdinal));
    } else {
      this.pagedViewportOrdinal = 0;
    }
    const shell = this.createPagedAttemptShell(state);
    shell.innerHTML += `
      <div class="library-section-head">
        ${this.detail ? `<button type="button" class="library-icon-button library-back">${ICONS.back}</button>` : ''}
        <h2>${escapeHtml(this.getPagedTitle())}</h2>
        <span>${totalCount ?? '…'} ${escapeHtml(isTrackQuery ? this.t('library.status.tracks') : '')}</span>
      </div>
    `;
    shell.querySelector('.library-back')?.addEventListener('click', () => this.navigateBack());
    if (this.currentView === 'playlists' && !this.detail) {
      shell.appendChild(this.createPagedPlaylistCollectionControls());
    }
    if (this.detail?.type === 'playlist') {
      shell.appendChild(this.createPagedPlaylistControls());
    }
    if (isTrackQuery) shell.appendChild(this.createPagedActionBar(state));
    const jobRegion = this.createPagedJobRegion();
    if (jobRegion) shell.appendChild(jobRegion);
    const grid = document.createElement('div');
    grid.className = `library-paged-grid ${isTrackQuery ? 'library-paged-tracks' : 'library-paged-entities'}${this.detail?.type === 'playlist' ? ' library-paged-playlist-items' : ''}`;
    grid.setAttribute('role', isTrackQuery ? 'grid' : 'list');
    grid.setAttribute('aria-rowcount', String(totalCount ?? -1));
    grid.dataset.queryGeneration = String(state.queryGeneration);
    grid.dataset.pageAttemptId = String(state.pageAttemptId);
    const rowHeight = this.getTrackRowHeight();
    const listGeometry = isTrackQuery
      ? new SegmentedVirtualListGeometry({ rowCount: logicalCount, rowHeight })
      : null;
    const gridGeometry = isTrackQuery || logicalCount === 0
      ? null
      : new SegmentedVirtualGridGeometry({
          itemCount: logicalCount,
          containerWidth: Math.max(176, this.content.clientWidth || this.root?.clientWidth || 176),
          rowHeight: isMobileLayout() ? 196 : 224
        });
    const scrollGeometry = listGeometry ?? gridGeometry?.list ?? new SegmentedVirtualListGeometry({
      rowCount: 0,
      rowHeight
    });
    let segmentWindow = isTrackQuery
      ? listGeometry.createWindow(this.pagedViewportOrdinal)
      : gridGeometry?.createWindow(this.pagedViewportOrdinal) ?? scrollGeometry.createWindow(0);
    grid.style.height = `${segmentWindow?.heightPx ?? 0}px`;
    const markers = document.createElement('div');
    markers.className = 'library-segment-markers';
    markers.setAttribute('aria-hidden', 'true');
    for (let segmentIndex = segmentWindow.firstSegmentIndex; segmentIndex <= segmentWindow.lastSegmentIndex; segmentIndex += 1) {
      const segment = scrollGeometry.getSegment(segmentIndex);
      const marker = document.createElement('span');
      marker.className = 'library-segment-marker';
      marker.dataset.segmentIndex = String(segmentIndex);
      marker.dataset.segmentHeight = String(segment.heightPx);
      markers.appendChild(marker);
    }
    grid.appendChild(markers);
    const rowLayer = document.createElement('div');
    rowLayer.className = 'library-paged-row-layer';
    grid.appendChild(rowLayer);
    shell.appendChild(grid);
    this.publishPagedAttemptDom(state, shell);
    this.pagedArtworkLoader = this.createPagedArtworkLoader();

    let rendering = false;
    let renderScheduled = false;
    const renderWindow = () => {
      if (rendering || !segmentWindow || !scrollGeometry) return;
      rendering = true;
      if (logicalCount === 0) {
        this.renderedPageTrackIds = [];
        rowLayer.replaceChildren();
        rendering = false;
        return;
      }
      let physicalScrollTop = Math.max(0, (this.content.scrollTop || 0) - (grid.offsetTop || 0));
      const rebased = scrollGeometry.rebaseWindow({
        window: segmentWindow,
        scrollTop: physicalScrollTop,
        viewportHeight: this.content.clientHeight || rowHeight * 12
      });
      if (rebased.changed) {
        segmentWindow = rebased.window;
        grid.style.height = `${segmentWindow.heightPx}px`;
        physicalScrollTop = rebased.scrollTop;
        this.content.scrollTop = (grid.offsetTop || 0) + physicalScrollTop;
      }
      const rawRange = isTrackQuery
        ? listGeometry.getRenderRange({
            window: segmentWindow,
            scrollTop: physicalScrollTop,
            viewportHeight: this.content.clientHeight || rowHeight * 12,
            bufferRows: 10
          })
        : gridGeometry.getRenderRange({
            window: segmentWindow,
            scrollTop: physicalScrollTop,
            viewportHeight: this.content.clientHeight || gridGeometry.rowHeight * 3,
            bufferRows: 2
          });
      const range = isTrackQuery
        ? { ...rawRange, endOrdinal: Math.min(rawRange.endOrdinal, rawRange.startOrdinal + PAGED_RENDERED_ROW_LIMIT) }
        : rawRange;
      this.pagedViewportOrdinal = range.firstVisibleOrdinal;
      const activeRow = globalThis.document?.activeElement?.closest?.('.library-paged-row');
      if (activeRow && rowLayer.contains?.(activeRow) &&
          activeRow.dataset.queryGeneration === String(state.queryGeneration) &&
          activeRow.dataset.pageAttemptId === String(state.pageAttemptId)) {
        this.pagedPendingFocusKey = activeRow.dataset.entityId || null;
      }
      this.markPagedRowsInert();
      rowLayer.replaceChildren();
      const cachedRows = this.pagedController.getCachedRows(range.startOrdinal, range.endOrdinal);
      const focusedEntityIsRendered = cachedRows.some(({ row }) => (
        (isTrackQuery ? row.trackUid ?? row.id : this.getPagedEntityId(row)) === this.pagedFocusedEntityId
      ));
      const needsRenderedRovingTarget = !this.pagedPendingFocusKey && !focusedEntityIsRendered;
      if (cachedRows.length && (!this.pagedFocusedEntityId || needsRenderedRovingTarget)) {
        this.pagedFocusedOrdinal = cachedRows[0].ordinal;
        this.pagedFocusedEntityId = isTrackQuery
          ? cachedRows[0].row.trackUid ?? cachedRows[0].row.id
          : this.getPagedEntityId(cachedRows[0].row);
      }
      this.renderedPageTrackIds = isTrackQuery
        ? cachedRows.map(({ row }) => row.trackUid ?? row.id).filter(Boolean)
        : [];
      for (const { ordinal, row } of cachedRows) {
        const element = this.createPagedRow(row, ordinal, state, isTrackQuery);
        element.style.position = 'absolute';
        if (isTrackQuery) {
          element.style.top = `${(ordinal - segmentWindow.startOrdinal) * rowHeight}px`;
          element.style.height = `${rowHeight}px`;
        } else {
          const layout = gridGeometry.getItemLayout(ordinal, segmentWindow);
          element.style.top = `${layout.topPx}px`;
          element.style.left = `${layout.leftPercent}%`;
          element.style.width = `${layout.widthPercent}%`;
          element.style.height = `${gridGeometry.rowHeight}px`;
        }
        rowLayer.appendChild(element);
      }
      if (this.pagedPendingFocusKey) {
        const focusRow = [...rowLayer.querySelectorAll?.('.library-paged-row') || []].find(row => (
          row.dataset.entityId === this.pagedPendingFocusKey
        ));
        if (focusRow) {
          this.pagedPendingFocusKey = null;
          focusRow.focus?.();
        }
      }
      this.capturePagedAnchorFromOrdinal(
        range.firstVisibleOrdinal,
        physicalScrollTop,
        segmentWindow,
        isTrackQuery,
        gridGeometry
      );
      rendering = false;
      if (Math.floor(range.firstVisibleOrdinal / this.pagedController.pageLimit) !== state.currentPageIndex) {
        void this.ensurePagedOrdinal(range.firstVisibleOrdinal);
      }
    };
    const scheduleWindowRender = () => {
      if (renderScheduled) return;
      renderScheduled = true;
      const run = () => {
        renderScheduled = false;
        renderWindow();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else setTimeout(run, 0);
    };
    const onResize = () => {
      const anchor = this.capturePagedAnchor();
      clearTimeout(this.pagedResizeTimer);
      this.pagedResizeTimer = setTimeout(() => {
        this.pagedResizeTimer = null;
        if (this.pagedState?.phase !== 'committed') return;
        if (anchor && typeof this.manager.resolveEntityAnchor === 'function') {
          void this.restorePagedAnchor().then(result => {
            if (!result?.accepted && this.pagedState?.phase === 'committed') {
              this.renderPagedCommitted(this.pagedState);
            }
          });
        } else {
          this.renderPagedCommitted(this.pagedState);
        }
      }, 100);
    };
    this.content.addEventListener?.('scroll', scheduleWindowRender, { passive: true });
    globalThis.window?.addEventListener?.('resize', onResize);
    this.trackScrollCleanup = () => {
      this.content?.removeEventListener?.('scroll', scheduleWindowRender);
      globalThis.window?.removeEventListener?.('resize', onResize);
      clearTimeout(this.pagedResizeTimer);
      this.pagedResizeTimer = null;
    };
    const initialPhysicalScrollTop = isTrackQuery
      ? listGeometry.getScrollTopForOrdinal(segmentWindow, this.pagedViewportOrdinal, this.pagedViewportOffsetPx)
      : gridGeometry?.getScrollTopForItem(segmentWindow, this.pagedViewportOrdinal, this.pagedViewportOffsetPx) ?? 0;
    this.content.scrollTop = (grid.offsetTop || 0) + initialPhysicalScrollTop;
    this.pagedViewportOffsetPx = 0;
    renderWindow();
  }

  capturePagedAnchor() {
    if (!this.pagedController || this.pagedState?.phase !== 'committed') return this.pagedAnchor;
    const activeElement = globalThis.document?.activeElement;
    const visibleRows = [...(this.content?.querySelectorAll?.('.library-paged-row[data-ordinal]') || [])];
    const contentRect = this.content?.getBoundingClientRect?.();
    const first = visibleRows.find(row => {
      const rect = row.getBoundingClientRect?.();
      return !rect || !contentRect || rect.bottom > contentRect.top;
    }) || visibleRows[0];
    const ordinal = Number(first?.dataset?.ordinal);
    const item = first?._pagedItem ?? this.pagedController.getCachedRows(
      this.pagedViewportOrdinal,
      this.pagedViewportOrdinal + 1
    )[0]?.row;
    if (!item) return this.pagedAnchor;
    const rowRect = first?.getBoundingClientRect?.();
    const viewportOffsetPx = rowRect && contentRect
      ? rowRect.top - contentRect.top
      : this.pagedViewportOffsetPx;
    const isTrackQuery = this.getPagedQuery().endpoint === 'tracks';
    this.pagedAnchor = this.pagedController.createAnchor({
      canonicalTuple: item.canonicalTuple ?? null,
      ordinal: Number.isSafeInteger(ordinal) ? ordinal : this.pagedViewportOrdinal,
      entityId: isTrackQuery ? item.trackUid ?? item.id : this.getPagedEntityId(item),
      viewportOffsetPx,
      focusKey: first?.contains?.(activeElement)
        ? (isTrackQuery ? item.trackUid ?? item.id : this.getPagedEntityId(item))
        : null
    });
    if (Number.isSafeInteger(ordinal)) this.pagedViewportOrdinal = ordinal;
    return this.pagedAnchor;
  }

  capturePagedAnchorFromOrdinal(ordinal, physicalScrollTop, segmentWindow, isTrackQuery, gridGeometry) {
    const item = this.pagedController.getCachedRows(ordinal, ordinal + 1)[0]?.row;
    if (!item) return;
    const rowOrdinal = isTrackQuery ? ordinal : Math.floor(ordinal / gridGeometry.columns);
    const rowHeight = isTrackQuery ? this.getTrackRowHeight() : gridGeometry.rowHeight;
    const viewportOffsetPx = ((rowOrdinal - segmentWindow.startOrdinal) * rowHeight) - physicalScrollTop;
    this.pagedAnchor = this.pagedController.createAnchor({
      canonicalTuple: item.canonicalTuple ?? null,
      ordinal,
      entityId: isTrackQuery ? item.trackUid ?? item.id : this.getPagedEntityId(item),
      viewportOffsetPx: Number.isFinite(viewportOffsetPx) ? viewportOffsetPx : 0,
      focusKey: null
    });
  }

  async ensurePagedOrdinal(ordinal) {
    if (this.pagedPageLoadPending) return { accepted: false, reason: 'page-pending' };
    this.pagedPageLoadPending = true;
    try {
      const result = await this.pagedController.ensureOrdinal(ordinal);
      if (!result?.accepted && !['end', 'start'].includes(result?.reason)) {
        console.warn('Music Library position could not be opened:', result);
        const error = document.createElement('p');
        error.className = 'library-paged-pagination-error';
        error.setAttribute('role', 'alert');
        error.textContent = this.t('library.paged.loadFailed');
        this.content?.appendChild?.(error);
      }
      return result;
    } catch (error) {
      if (this.handlePagedSnapshotExpiry(error)) {
        return { accepted: false, reason: 'snapshot-expired', error };
      }
      const status = document.createElement('p');
      status.className = 'library-paged-pagination-error';
      status.setAttribute('role', 'alert');
      console.error('Music Library position load failed:', error);
      status.textContent = this.t('library.paged.loadFailed');
      this.content?.appendChild?.(status);
      return { accepted: false, reason: 'page-failed', error };
    } finally {
      this.pagedPageLoadPending = false;
    }
  }

  createPagedArtworkLoader() {
    const loadBlob = typeof this.manager.getArtworkThumbBlob === 'function'
      ? artworkId => this.manager.getArtworkThumbBlob(artworkId, { reason: 'viewport' })
      : null;
    const loadUrl = typeof this.manager.getArtworkThumbURL === 'function'
      ? artworkId => this.manager.getArtworkThumbURL(artworkId, { reason: 'viewport' })
      : null;
    if (!loadBlob && !loadUrl) return null;
    return new PagedArtworkLoader({
      loadArtwork: async artworkId => (loadBlob ? await loadBlob(artworkId) : loadUrl(artworkId))
    });
  }

  destroyPagedArtworkLoader() {
    this.pagedArtworkLoader?.destroy();
    this.pagedArtworkLoader = null;
  }

  createPagedActionBar(state) {
    const bar = document.createElement('div');
    bar.className = 'library-action-bar library-paged-actions';
    const descriptor = state.selectionDescriptor;
    const hasSelection = descriptor?.mode !== 'explicit' || descriptor.trackUids?.length > 0;
    const actionsDisabled = typeof this.manager.performSelectionAction !== 'function' ||
      !hasSelection || Boolean(state.staleSelectionDescriptor);
    const disabled = actionsDisabled ? ' disabled' : '';
    bar.innerHTML = `
      <button type="button" class="library-button library-paged-select-all">${escapeHtml(this.t('library.paged.selectAllResults'))}</button>
      <button type="button" class="library-button library-paged-play"${disabled}>${ICONS.play}<span>${escapeHtml(this.t('library.action.play'))}</span></button>
      <button type="button" class="library-button library-paged-play-next"${disabled}>${ICONS.next}<span>${escapeHtml(this.t('library.action.playNext'))}</span></button>
      <button type="button" class="library-button library-paged-queue"${disabled}>${ICONS.queue}<span>${escapeHtml(this.t('library.action.addToQueue'))}</span></button>
      <button type="button" class="library-button library-paged-add-playlist"${disabled}>${ICONS.add}<span>${escapeHtml(this.t('library.action.addToPlaylist'))}</span></button>
      ${state.staleSelectionDescriptor ? `<span class="library-paged-stale-selection" role="status">${escapeHtml(this.t('library.paged.selectionStale'))}</span><button type="button" class="library-button library-paged-reselect">${escapeHtml(this.t('library.paged.reselect'))}</button>` : ''}
      ${state.selectionRejection ? `<span class="library-paged-selection-error" role="alert">${escapeHtml(this.t('library.paged.selectionTooLarge'))}</span>` : ''}
    `;
    bar.querySelector('.library-paged-select-all')?.addEventListener('click', () => {
      this.pagedController.selectAll();
      this.renderPagedCommitted(this.pagedController.createViewState());
    });
    bar.querySelector('.library-paged-reselect')?.addEventListener('click', () => {
      const result = this.pagedController.reselectStaleSelection();
      if (!result.accepted) this.announcePagedStatus(this.t('library.paged.reselectFailed'));
      this.renderPagedCommitted(this.pagedController.createViewState());
    });
    const dispatch = (operationKind, request = {}) => this.startPagedSelectionAction(state, operationKind, request);
    bar.querySelector('.library-paged-play')?.addEventListener('click', () => dispatch('play'));
    bar.querySelector('.library-paged-play-next')?.addEventListener('click', () => dispatch('playNext'));
    bar.querySelector('.library-paged-queue')?.addEventListener('click', () => dispatch('queue'));
    bar.querySelector('.library-paged-add-playlist')?.addEventListener('click', event => {
      void this.openPagedAddToPlaylistMenu(event.currentTarget, state);
    });
    return bar;
  }

  startPagedSelectionAction(state, operationKind, request = {}) {
    const clientRequestId = request.clientRequestId ?? this.manager.createOperationRequestId?.();
    const operationRequest = { ...request, clientRequestId };
    this.pagedActionController?.remember(clientRequestId);
    const dispatched = this.pagedController.dispatchSelectionAction(state, operationKind, operationRequest);
    if (!dispatched.accepted || !this.pagedActionController) return dispatched;
    const startFactory = () => this.startPagedSelectionAction(
      this.pagedController.createViewState(),
      operationKind,
      { ...request, clientRequestId: this.manager.createOperationRequestId?.() }
    );
    void this.pagedActionController.track({
      clientRequestId,
      operationKind,
      targetName: request.target?.name ?? request.target?.playlistId ?? '',
      startResult: Promise.resolve(dispatched.value),
      startFactory
    });
    return dispatched;
  }

  createPagedJobRegion() {
    const state = this.pagedActionController?.state;
    if (!state || state.status === 'idle') return null;
    const region = document.createElement('section');
    region.className = 'library-paged-job';
    region.dataset.libraryPagedJob = 'true';
    region.tabIndex = -1;
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    const action = this.t(`library.job.action.${state.operationKind || 'operation'}`);
    const phase = state.status === 'waiting'
      ? this.t('library.job.waiting')
      : state.status === 'cancelling'
        ? this.t('library.job.cancelling')
        : state.status === 'terminal'
          ? this.t(`library.job.terminal.${state.terminalKind || 'failed'}`)
          : this.t(`library.job.phase.${String(state.phase || 'RECEIVED').toLowerCase()}`);
    const progress = Number.isSafeInteger(state.processed)
      ? Number.isSafeInteger(state.total)
        ? this.t('library.job.progressKnown', { processed: state.processed, total: state.total })
        : this.t('library.job.progressUnknown', { processed: state.processed })
      : '';
    region.innerHTML = `
      <strong>${escapeHtml(action)}</strong>
      ${state.targetName ? `<span>${escapeHtml(state.targetName)}</span>` : ''}
      <span class="library-paged-job-phase">${escapeHtml(phase)}</span>
      ${progress ? `<span class="library-paged-job-progress">${escapeHtml(progress)}</span>` : ''}
      ${state.canCancel ? `<button type="button" class="library-button library-paged-job-cancel">${escapeHtml(this.t('library.action.cancel'))}</button>` : ''}
      ${state.canUndo ? `<button type="button" class="library-button library-paged-job-undo">${escapeHtml(this.t('library.action.undoCancelledPlay'))}</button>` : ''}
      ${state.retryAvailable ? `<button type="button" class="library-button library-paged-job-retry">${escapeHtml(this.t('library.paged.retry'))}</button>` : ''}
    `;
    region.querySelector('.library-paged-job-cancel')?.addEventListener('click', event => {
      event.currentTarget.disabled = true;
      void this.pagedActionController.cancel();
    });
    region.querySelector('.library-paged-job-retry')?.addEventListener('click', event => {
      event.currentTarget.disabled = true;
      void this.pagedActionController.retry();
    });
    region.querySelector('.library-paged-job-undo')?.addEventListener('click', event => {
      event.currentTarget.disabled = true;
      void this.pagedActionController.undo().then(result => {
        if (result?.kind !== 'published') {
          this.announcePagedStatus(this.t('library.error.undoCancelledPlayUnavailable'));
        }
      }).catch(error => {
        console.error('Failed to restore the previous playback queue:', error);
        this.announcePagedStatus(this.t('library.error.undoCancelledPlayUnavailable'));
        this.renderPagedJobRegion();
      });
    });
    return region;
  }

  renderPagedJobRegion() {
    if (!this.content) return;
    this.refreshPagedActionAvailability();
    const current = this.content.querySelector?.('[data-library-paged-job]');
    const activeElement = globalThis.document?.activeElement;
    const focusWasInside = Boolean(current && activeElement && current.contains?.(activeElement));
    const next = this.createPagedJobRegion();
    if (!next) {
      current?.remove?.();
      return;
    }
    if (current?.replaceWith) current.replaceWith(next);
    else this.content.querySelector?.('.library-paged-attempt')?.appendChild?.(next);
    if (focusWasInside) next.focus?.();
  }

  refreshPagedActionAvailability() {
    const actionState = this.pagedActionController?.state;
    const jobActive = ['starting', 'active', 'waiting', 'cancelling'].includes(actionState?.status);
    const viewState = this.pagedController?.createViewState?.() ?? this.pagedState;
    const descriptor = viewState?.selectionDescriptor;
    const hasSelection = descriptor?.mode !== 'explicit' || descriptor?.trackUids?.length > 0;
    const disabled = jobActive || typeof this.manager.performSelectionAction !== 'function' ||
      !hasSelection || Boolean(viewState?.staleSelectionDescriptor);
    for (const selector of [
      '.library-paged-play', '.library-paged-play-next',
      '.library-paged-queue', '.library-paged-add-playlist'
    ]) {
      const control = this.content.querySelector?.(selector);
      if (control) control.disabled = disabled;
    }
  }

  createPagedPlaylistCollectionControls() {
    const controls = document.createElement('div');
    controls.className = 'library-playlist-actions library-paged-playlist-collection-actions';
    controls.innerHTML = `
      <button type="button" class="library-button library-export-playlists" data-library-playlist-export>${ICONS.export}<span>${escapeHtml(this.t('ui.exportPlaylists'))}</span></button>
      <button type="button" class="library-button library-import-playlist">${ICONS.import}<span>${escapeHtml(this.t('library.action.importPlaylist'))}</span></button>
      <button type="button" class="library-button library-new-playlist">${ICONS.add}<span>${escapeHtml(this.t('library.action.newPlaylist'))}</span></button>
    `;
    controls.querySelector('.library-export-playlists')?.addEventListener('click', () => {
      const firstPlaylist = this.content?.querySelector?.('.library-paged-entity-card');
      firstPlaylist?.focus?.();
      this.announcePagedStatus(this.t('library.action.choosePlaylistToExport'));
    });
    controls.querySelector('.library-import-playlist')?.addEventListener('click', () => {
      void this.handleImportPlaylist();
    });
    controls.querySelector('.library-new-playlist')?.addEventListener('click', async () => {
      const name = await this.promptText('library.prompt.playlistName', this.t('library.action.newPlaylist'));
      if (!name) return;
      const playlist = await this.manager.playlists.create(name);
      const playlistId = playlist?.playlistId ?? playlist?.id;
      if (playlistId) this.navigateToDetail({ type: 'playlist', key: playlistId, title: name }, 'playlists');
    });
    return controls;
  }

  createPagedPlaylistControls() {
    const playlist = {
      id: this.detail.key,
      name: this.detail.title || this.t('library.nav.playlists')
    };
    const controls = document.createElement('div');
    controls.className = 'library-playlist-actions library-paged-playlist-actions';
    controls.dataset.libraryPlaylistExport = 'true';
    controls.tabIndex = -1;
    controls.innerHTML = `
      <button type="button" class="library-button library-playlist-rename">${ICONS.edit}<span>${escapeHtml(this.t('library.action.rename'))}</span></button>
      <button type="button" class="library-button library-playlist-duplicate">${ICONS.duplicate}<span>${escapeHtml(this.t('library.action.duplicate'))}</span></button>
      <label class="library-checkbox library-playlist-export-relative-wrap"><input type="checkbox" class="library-playlist-export-relative" checked><span>${escapeHtml(this.t('library.option.relativePaths'))}</span></label>
      <button type="button" class="library-button library-playlist-export-m3u8" data-library-playlist-export>${ICONS.export}<span>${escapeHtml(this.t('library.action.exportM3U8'))}</span></button>
      <button type="button" class="library-button library-playlist-export-xspf">${ICONS.export}<span>${escapeHtml(this.t('library.action.exportXSPF'))}</span></button>
      <button type="button" class="library-button library-playlist-delete">${ICONS.trash}<span>${escapeHtml(this.t('library.action.delete'))}</span></button>
    `;
    controls.querySelector('.library-playlist-rename')?.addEventListener('click', async () => {
      const name = await this.promptText('library.prompt.renamePlaylist', playlist.name);
      if (!name || name === playlist.name) return;
      await this.manager.playlists.rename(playlist.id, name);
      this.detail = { ...this.detail, title: name };
      this.pagedQueryKey = null;
      this.render();
    });
    controls.querySelector('.library-playlist-duplicate')?.addEventListener('click', async () => {
      const source = await this.manager.playlists.get(playlist.id);
      const suggested = this.t('library.playlist.copyName', { name: playlist.name });
      const name = await this.promptText('library.prompt.playlistName', suggested);
      if (!name) return;
      const duplicated = await this.manager.playlists.duplicate(playlist.id, name, { playlist: source });
      const playlistId = duplicated?.playlistId ?? duplicated?.id;
      if (playlistId) this.navigateToDetail({ type: 'playlist', key: playlistId, title: name }, 'playlists');
    });
    controls.querySelector('.library-playlist-export-m3u8')?.addEventListener('click', () => {
      void this.handleExportPlaylist(playlist, 'm3u8');
    });
    controls.querySelector('.library-playlist-export-xspf')?.addEventListener('click', () => {
      void this.handleExportPlaylist(playlist, 'xspf');
    });
    controls.querySelector('.library-playlist-delete')?.addEventListener('click', async () => {
      if (typeof confirm === 'function' && !confirm(this.t('library.confirm.deletePlaylist', { name: playlist.name }))) return;
      await this.manager.playlists.delete(playlist.id);
      this.navigateToView('playlists');
    });
    return controls;
  }

  createPagedRow(item, ordinal, state, isTrackQuery) {
    const row = document.createElement(isTrackQuery ? 'div' : 'button');
    const entityId = isTrackQuery ? item.trackUid ?? item.id : this.getPagedEntityId(item);
    row.className = `library-paged-row${isTrackQuery ? '' : ' library-paged-entity-card'}`;
    row._pagedItem = item;
    row.dataset.entityId = entityId ?? '';
    row.dataset.ordinal = String(ordinal);
    row.dataset.queryGeneration = String(state.queryGeneration);
    row.dataset.pageAttemptId = String(state.pageAttemptId);
    row.setAttribute('role', isTrackQuery ? 'row' : 'listitem');
    row.setAttribute('aria-rowindex', String(ordinal + 1));
    row.tabIndex = entityId === this.pagedFocusedEntityId ? 0 : -1;
    row.addEventListener('focus', () => {
      this.pagedFocusedOrdinal = ordinal;
      this.pagedFocusedEntityId = entityId;
    });
    if (isTrackQuery) {
      row.innerHTML = `
        <input class="library-paged-select" type="checkbox" aria-label="${escapeHtml(this.t('library.paged.selectTrack', { title: item.title || item.fileName || entityId }))}"${this.pagedController.isSelected(entityId, ordinal) ? ' checked' : ''}>
        <button type="button" class="library-paged-row-open">${escapeHtml(item.title || item.fileName || entityId)}</button>
        <span>${escapeHtml(item.artist || '')}</span>
        <span>${escapeHtml(item.album || '')}</span>
        ${this.detail?.type === 'playlist' && (item.itemKey ?? item.playlistItemKey) != null ? `<span class="library-paged-playlist-row-actions">
          <button type="button" class="library-icon-button library-paged-item-up" aria-label="${escapeHtml(this.t('library.action.moveUp'))}">${ICONS.up}</button>
          <button type="button" class="library-icon-button library-paged-item-down" aria-label="${escapeHtml(this.t('library.action.moveDown'))}">${ICONS.down}</button>
          <button type="button" class="library-icon-button library-paged-item-remove" aria-label="${escapeHtml(this.t('library.action.removeFromPlaylist'))}">${ICONS.trash}</button>
        </span>` : ''}
      `;
      const checkbox = row.querySelector('.library-paged-select');
      checkbox?.addEventListener('click', event => {
        checkbox._pagedShiftKey = event.shiftKey === true;
      });
      checkbox?.addEventListener('change', event => {
        const dispatched = this.dispatchPagedRowAction(row, () => this.pagedController.toggleSelection(
          entityId,
          event.target.checked,
          { ordinal, extend: checkbox._pagedShiftKey === true }
        ));
        if (dispatched?.value?.accepted === false) {
          this.announcePagedStatus(this.t('library.paged.selectionTooLarge'));
        }
        checkbox._pagedShiftKey = false;
        this.renderPagedCommitted(this.pagedController.createViewState());
      });
      row.querySelector('.library-paged-row-open')?.addEventListener('click', () => {
        this.dispatchPagedRowAction(row, () => this.manager.performRowAction?.('open', { trackUid: entityId }));
      });
      const itemKey = item.itemKey ?? item.playlistItemKey;
      row.querySelector('.library-paged-item-up')?.addEventListener('click', () => {
        this.dispatchPagedRowAction(row, () => this.manager.playlists.reorderItem(
          this.detail.key,
          itemKey,
          { direction: 'up' },
          { expectedVersion: item.playlistVersion }
        ));
      });
      row.querySelector('.library-paged-item-down')?.addEventListener('click', () => {
        this.dispatchPagedRowAction(row, () => this.manager.playlists.reorderItem(
          this.detail.key,
          itemKey,
          { direction: 'down' },
          { expectedVersion: item.playlistVersion }
        ));
      });
      row.querySelector('.library-paged-item-remove')?.addEventListener('click', () => {
        this.dispatchPagedRowAction(row, () => this.manager.playlists.removeItem(
          this.detail.key,
          itemKey,
          { expectedVersion: item.playlistVersion }
        ));
      });
    } else {
      row.type = 'button';
      const artworkId = typeof (item.representativeTrackUid ?? item.representativeArtworkId ?? item.artworkId) === 'string'
        ? item.representativeTrackUid ?? item.representativeArtworkId ?? item.artworkId
        : '';
      row.innerHTML = `
        <span class="library-paged-artwork" aria-hidden="true"><span></span></span>
        <span class="library-paged-entity-title">${escapeHtml(item.name || item.displayName || entityId)}</span>
      `;
      if (artworkId) this.pagedArtworkLoader?.observe(row.querySelector('.library-paged-artwork'), artworkId);
      row.addEventListener('click', () => {
        this.dispatchPagedRowAction(row, () => this.navigateToDetail({
          type: this.getPagedQuery().entityType,
          key: entityId,
          title: item.name || item.displayName || ''
        }));
      });
    }
    return row;
  }

  dispatchPagedRowAction(row, callback) {
    return this.pagedController.dispatchRowAction({
      queryGeneration: Number(row.dataset.queryGeneration),
      pageAttemptId: Number(row.dataset.pageAttemptId)
    }, callback);
  }

  createPagedNavigation(state, start, end) {
    const controls = document.createElement('div');
    controls.className = 'library-paged-navigation';
    const hasPrevious = start > 0 || Boolean(state.previousCursor);
    const hasNext = end < state.rows.length || Boolean(state.nextCursor);
    controls.innerHTML = `
      <button type="button" class="library-button library-paged-previous"${hasPrevious ? '' : ' disabled'}>${escapeHtml(this.t('library.paged.previous'))}</button>
      <span>${escapeHtml(this.t('library.paged.page', { page: state.currentPageIndex + 1 }))}</span>
      <button type="button" class="library-button library-paged-next"${hasNext ? '' : ' disabled'}>${escapeHtml(this.t('library.paged.next'))}</button>
    `;
    controls.querySelector('.library-paged-previous')?.addEventListener('click', async () => {
      if (start > 0) {
        this.pagedRenderOffset = Math.max(0, start - PAGED_RENDERED_ROW_LIMIT);
        this.renderPagedCommitted(state);
      } else {
        this.pagedRenderOffset = 0;
        await this.pagedController.previousPage();
      }
    });
    controls.querySelector('.library-paged-next')?.addEventListener('click', async () => {
      if (end < state.rows.length) {
        this.pagedRenderOffset = end;
        this.renderPagedCommitted(state);
      } else {
        this.pagedRenderOffset = 0;
        await this.pagedController.nextPage();
      }
    });
    return controls;
  }

  getPagedEntityId(item) {
    return item?.albumKey ?? item?.artistKey ?? item?.genreKey ?? item?.subfolderKey ??
      item?.folderId ?? item?.playlistId ?? item?.id ?? null;
  }

  getPagedTitle() {
    if (this.searchQuery.trim()) return this.t('library.search.results');
    if (this.detail?.title) return this.detail.title;
    return this.t(VIEW_LABELS[this.currentView] || 'library.nav.tracks');
  }

  renderNav() {
    const counts = this.manager.getCounts();
    const items = ['tracks', 'albums', 'artists', 'genres', 'subfolders', 'folders', 'recent', 'playlists'];
    this.nav.innerHTML = items.map(view => {
      const count = view === 'tracks' ? counts.tracks :
        view === 'albums' ? counts.albums :
          view === 'artists' ? counts.artists :
            view === 'genres' ? counts.genres :
              view === 'subfolders' ? (counts.subfolders ?? this.manager.getSubfolders?.().length ?? 0) :
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
    if (!isMobileLayout()) {
      this.lastRevealedMobileNavView = null;
    } else if (
      this.isViewShown &&
      this.lastRevealedMobileNavView !== this.currentView
    ) {
      this.nav.querySelector('[aria-current="page"]')?.scrollIntoView?.({
        block: 'nearest',
        inline: 'nearest'
      });
      this.lastRevealedMobileNavView = this.currentView;
    }
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
            detail.type === 'subfolder' ? 'subfolders' :
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

  invalidateArtworkRequests() {
    this.artworkRequestVersion = (this.artworkRequestVersion || 0) + 1;
    const releases = [...(this.pendingArtworkUrlReleases || [])];
    for (const release of releases) {
      release();
    }
  }

  trackOwnedArtworkURL(url) {
    if (!this.pendingArtworkUrlReleases) {
      this.pendingArtworkUrlReleases = new Set();
    }
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      this.pendingArtworkUrlReleases.delete(release);
      if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // Ignore stale object URLs.
      }
    };
    this.pendingArtworkUrlReleases.add(release);
    return release;
  }

  isArtworkRequestCurrent(container, artworkId, requestVersion) {
    return requestVersion === (this.artworkRequestVersion || 0) &&
      container?.dataset?.artworkId === artworkId;
  }

  showArtworkPlaceholder(container, artworkId, image = null, requestVersion = this.artworkRequestVersion || 0) {
    if (!this.isArtworkRequestCurrent(container, artworkId, requestVersion)) return;
    image?.remove?.();
    if (!container.querySelector?.('span')) {
      container.appendChild(document.createElement('span'));
    }
  }

  async renderArtwork(container, artworkId) {
    if (!container || !artworkId) return;
    const requestVersion = this.artworkRequestVersion || 0;
    let releaseOwnedUrl = null;
    try {
      let url = '';
      if (typeof this.manager.getArtworkThumbBlob === 'function' &&
        typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const blob = await this.manager.getArtworkThumbBlob(artworkId);
        if (!this.isArtworkRequestCurrent(container, artworkId, requestVersion)) return;
        if (!blob) {
          this.showArtworkPlaceholder(container, artworkId, null, requestVersion);
          return;
        }
        url = URL.createObjectURL(blob);
        releaseOwnedUrl = this.trackOwnedArtworkURL(url);
      } else {
        url = await this.manager.getArtworkThumbURL(artworkId);
      }
      if (!url || !this.isArtworkRequestCurrent(container, artworkId, requestVersion)) {
        releaseOwnedUrl?.();
        if (!url) this.showArtworkPlaceholder(container, artworkId, null, requestVersion);
        return;
      }

      const img = document.createElement('img');
      img.className = 'library-artwork-image';
      img.alt = '';
      const release = () => {
        releaseOwnedUrl?.();
        releaseOwnedUrl = null;
      };
      img.addEventListener?.('load', release, { once: true });
      img.addEventListener?.('error', () => {
        release();
        if (this.isArtworkRequestCurrent(container, artworkId, requestVersion)) {
          this.showArtworkPlaceholder(container, artworkId, img, requestVersion);
        }
      }, { once: true });
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
      releaseOwnedUrl?.();
      this.showArtworkPlaceholder(container, artworkId, null, requestVersion);
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

  renderSubfolders() {
    const subfolders = this.manager.getSubfolders();
    this.content.innerHTML = `<div class="library-section-head"><h2>${escapeHtml(this.t('library.nav.subfolders'))}</h2><span>${subfolders.length}</span></div>`;
    if (!subfolders.length) {
      this.content.appendChild(this.emptyState(this.t('library.state.noSubfolders')));
      return;
    }
    const list = document.createElement('div');
    list.className = 'library-simple-list';
    const baseTitles = subfolders.map(subfolder => {
      return [subfolder.rootPath || subfolder.rootName, subfolder.path].filter(Boolean).join(' / ');
    });
    const titleCounts = new Map();
    for (const title of baseTitles) {
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
    const titleOccurrences = new Map();
    subfolders.forEach((subfolder, index) => {
      const baseTitle = baseTitles[index];
      const occurrence = (titleOccurrences.get(baseTitle) || 0) + 1;
      titleOccurrences.set(baseTitle, occurrence);
      const title = titleCounts.get(baseTitle) > 1 ? `${baseTitle} (${occurrence})` : baseTitle;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-simple-row';
      button.innerHTML = `<span>${escapeHtml(title)}</span><span>${subfolder.trackIds.length}</span>`;
      button.addEventListener('click', () => {
        this.navigateToDetail({ type: 'subfolder', key: subfolder.key, title }, 'subfolders');
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
      row.querySelector('.library-folder-rescan')?.addEventListener('click', () => this.handleScanFolders([folder.id]));
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

  async openPagedAddToPlaylistMenu(anchor, state) {
    this.closePlaylistMenu({ restoreFocus: false });
    const menu = document.createElement('div');
    menu.className = 'library-playlist-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', this.t('library.action.addToPlaylist'));
    menu.innerHTML = `
      <input class="library-search library-playlist-picker-search" type="search" autocomplete="off" placeholder="${escapeHtml(this.t('library.search.placeholder'))}">
      <button type="button" class="library-playlist-menu-item library-playlist-menu-new">${ICONS.add}<span>${escapeHtml(this.t('library.action.newPlaylist'))}</span></button>
      <div class="library-playlist-picker-results"></div>
      <div class="library-playlist-picker-navigation">
        <button type="button" class="library-button library-playlist-picker-previous" disabled>${escapeHtml(this.t('library.paged.previous'))}</button>
        <button type="button" class="library-button library-playlist-picker-next" disabled>${escapeHtml(this.t('library.paged.next'))}</button>
      </div>
    `;
    const dispatch = (playlistId, expectedTargetVersion, name = '') => this.startPagedSelectionAction(
      state,
      'addToPlaylist',
      { target: { playlistId, name }, expectedTargetVersion }
    );
    let contextToken = null;
    let currentPage = null;
    let loadGeneration = 0;
    let searchTimer = null;
    let closed = false;
    const results = menu.querySelector('.library-playlist-picker-results');
    const previous = menu.querySelector('.library-playlist-picker-previous');
    const next = menu.querySelector('.library-playlist-picker-next');
    const releaseContext = async () => {
      const token = contextToken;
      contextToken = null;
      if (token) await Promise.resolve(this.manager.playlists.releaseListContext(token)).catch(() => {});
    };
    const bindDestinations = () => {
      results.querySelectorAll('[data-playlist-id]').forEach(button => {
        button.addEventListener('click', () => {
          const destination = getPagedPlaylistTarget({
            playlistId: button.dataset.playlistId,
            version: button.dataset.playlistVersion === '' ? Number.NaN : Number(button.dataset.playlistVersion),
            name: button.dataset.playlistName
          });
          if (!destination.accepted) {
            this.announcePagedStatus(this.t('library.paged.playlistVersionUnavailable'));
            return;
          }
          dispatch(destination.target.playlistId, destination.expectedTargetVersion, destination.target.name);
          this.closePlaylistMenu();
        });
      });
    };
    const renderPage = page => {
      const playlists = Array.isArray(page?.rows) ? page.rows : [];
      results.innerHTML = playlists.map(playlist => `<button type="button" class="library-playlist-menu-item" data-playlist-id="${escapeHtml(playlist.playlistId ?? playlist.id)}" data-playlist-version="${Number.isSafeInteger(playlist.version) ? playlist.version : ''}" data-playlist-name="${escapeHtml(playlist.name)}"><span>${escapeHtml(playlist.name)}</span><small>${Number.isSafeInteger(playlist.itemCount) ? playlist.itemCount : ''}</small></button>`).join('');
      currentPage = page;
      previous.disabled = !page?.previousCursor;
      next.disabled = !page?.nextCursor;
      bindDestinations();
    };
    const loadPage = async cursor => {
      const generation = loadGeneration;
      const token = contextToken;
      if (!token) return;
      const page = await this.manager.playlists.readListContext(token, { cursor, limit: 100 });
      if (closed || generation !== loadGeneration || !this.isCurrentPagedAttempt(state)) return;
      renderPage(page);
    };
    const openQuery = async query => {
      const generation = ++loadGeneration;
      await releaseContext();
      if (closed || generation !== loadGeneration || !this.isCurrentPagedAttempt(state)) return;
      const context = await this.manager.playlists.openListContext({ query });
      if (closed || generation !== loadGeneration || !this.isCurrentPagedAttempt(state)) {
        await Promise.resolve(this.manager.playlists.releaseListContext(context.contextToken)).catch(() => {});
        return;
      }
      contextToken = context.contextToken;
      await loadPage(null);
    };
    menu.querySelector('.library-playlist-menu-new')?.addEventListener('click', async () => {
      const name = await this.promptText('library.prompt.playlistName', this.t('library.action.newPlaylist'));
      if (!name || !this.isCurrentPagedAttempt(state)) return;
      const playlist = await this.manager.playlists.create(name);
      const playlistId = playlist?.playlistId ?? playlist?.id;
      const version = playlist?.version ?? (playlistId ? (await this.manager.playlists.get(playlistId))?.version : null);
      if (playlistId && Number.isSafeInteger(version)) dispatch(playlistId, version, name);
      this.closePlaylistMenu();
    });
    menu.querySelector('.library-playlist-picker-search')?.addEventListener('input', event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchTimer = null;
        void openQuery(event.target.value).catch(error => {
          if (!closed) this.reportActionFailure(error);
        });
      }, LIBRARY_SEARCH_DEBOUNCE_MS);
    });
    previous.addEventListener('click', () => {
      if (currentPage?.previousCursor) void loadPage(currentPage.previousCursor).catch(error => {
        if (!closed) this.reportActionFailure(error);
      });
    });
    next.addEventListener('click', () => {
      if (currentPage?.nextCursor) void loadPage(currentPage.nextCursor).catch(error => {
        if (!closed) this.reportActionFailure(error);
      });
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closePlaylistMenu();
      }
    });
    const actionBar = anchor?.closest?.('.library-action-bar');
    this.playlistMenuReturnFocus = getRestorableFocusElement(anchor);
    actionBar?.after?.(menu);
    if (!menu.parentNode) this.content.appendChild(menu);
    this.playlistMenu = menu;
    const closeOnPointerDown = event => {
      if (!menu.contains?.(event.target)) this.closePlaylistMenu();
    };
    document.addEventListener?.('pointerdown', closeOnPointerDown);
    this.playlistMenuCleanup = () => {
      if (closed) return;
      closed = true;
      loadGeneration += 1;
      clearTimeout(searchTimer);
      document.removeEventListener?.('pointerdown', closeOnPointerDown);
      void releaseContext();
    };
    menu.querySelector('.library-playlist-picker-search')?.focus?.();
    try {
      await openQuery('');
    } catch (error) {
      if (!closed) {
        this.closePlaylistMenu();
        this.reportActionFailure(error);
      }
    }
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
    const pagedRowTarget = event.target?.closest?.('.library-paged-row');
    if (!pagedRowTarget && event.target !== this.content && event.target?.closest?.(
      'button, a, input, select, textarea, [contenteditable="true"], [role="menuitem"]'
    )) return;
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'a') {
      if (this.pagedIntegrationRequired && this.pagedState?.phase === 'committed') {
        event.preventDefault();
        this.pagedController.selectAll();
        this.renderPagedCommitted(this.pagedController.createViewState());
        return;
      }
      if (this.renderedPageTrackIds.length) {
        event.preventDefault();
        this.setSelection(this.renderedPageTrackIds);
      }
      return;
    }
    if (this.pagedIntegrationRequired && this.pagedState?.phase === 'committed') {
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const dispatched = this.dispatchPagedKeyboardAction(event, () => (
          this.seekPagedBoundary(event.key, { extend: event.shiftKey === true })
        ));
        if (dispatched.accepted) void dispatched.value;
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        const pageRows = Math.max(1, Math.floor((this.content?.clientHeight || 480) / this.getTrackRowHeight()));
        const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 :
          event.key === 'PageDown' ? pageRows : -pageRows;
        const dispatched = this.dispatchPagedKeyboardAction(event, () => (
          this.movePagedFocus(delta, { extend: event.shiftKey === true })
        ));
        if (dispatched.accepted) void dispatched.value;
        return;
      }
      if (event.key === ' ' && this.getPagedQuery().endpoint === 'tracks') {
        event.preventDefault();
        this.togglePagedFocusedSelection({ extend: event.shiftKey === true });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        this.activatePagedFocused();
        return;
      }
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
      if (!this.renderedPageTrackIds.length) return;
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
      const trackId = this.focusedTrackId || this.renderedPageTrackIds[0];
      const index = this.renderedPageTrackIds.indexOf(trackId);
      if (index >= 0) {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          this.manager.addToQueue([trackId]);
        } else if (event.shiftKey) {
          this.manager.playNext([trackId]);
        } else {
          this.manager.playTrackIds(this.renderedPageTrackIds, { startIndex: index });
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
      if (this.pagedIntegrationRequired) {
        const dispatched = this.dispatchPagedKeyboardAction(event, () => this.focusPagedByPrefix(event.key));
        if (dispatched.accepted) void dispatched.value;
        return;
      }
      this.focusTrackByPrefix(event.key);
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const trackId = this.renderedPageTrackIds.includes(this.focusedTrackId)
        ? this.focusedTrackId
        : this.renderedPageTrackIds[0];
      const track = trackId ? this.manager.getTrackById(trackId) : null;
      if (!track) return;
      event.preventDefault();
      const index = this.renderedPageTrackIds.indexOf(trackId);
      const rect = this.content?.getBoundingClientRect?.() || { left: 16, top: 16 };
      const returnFocus = this.content?.querySelector?.(`.library-track-row[data-track-id="${cssEscape(trackId)}"]`) || null;
      this.openContextMenu({
        preventDefault() {},
        clientX: rect.left + 24,
        clientY: rect.top + 48
      }, track, this.renderedPageTrackIds, index, { returnFocus });
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

  dispatchPagedKeyboardAction(event, callback) {
    const row = event?.target?.closest?.('.library-paged-row');
    if (row) return this.dispatchPagedRowAction(row, callback);
    if (!this.pagedController) return { accepted: true, value: callback() };
    return this.pagedController.dispatchRowAction(this.pagedController.createViewState(), callback);
  }

  moveFocusedTrack(delta) {
    if (!this.renderedPageTrackIds.length) return;
    const currentIndex = Math.max(0, this.renderedPageTrackIds.indexOf(this.focusedTrackId));
    const nextIndex = delta === Infinity ? this.renderedPageTrackIds.length - 1 :
      delta === -Infinity ? 0 :
        Math.max(0, Math.min(this.renderedPageTrackIds.length - 1, currentIndex + delta));
    this.focusTrackAtIndex(nextIndex);
  }

  async seekPagedBoundary(key, { extend = false } = {}) {
    const result = await (key === 'Home' ? this.pagedController?.home() : this.pagedController?.end());
    if (!result?.accepted) return result;
    const ordinal = Number.isSafeInteger(result.ordinal)
      ? result.ordinal
      : key === 'Home' ? 0 : this.pagedViewportOrdinal;
    this.pagedViewportOrdinal = ordinal;
    const item = this.pagedController.getCachedRows(ordinal, ordinal + 1)[0]?.row;
    if (item) {
      const entityId = this.getPagedQuery().endpoint === 'tracks'
        ? item.trackUid ?? item.id
        : this.getPagedEntityId(item);
      this.pagedFocusedOrdinal = ordinal;
      this.pagedFocusedEntityId = entityId;
      this.pagedPendingFocusKey = entityId;
      if (extend && this.getPagedQuery().endpoint === 'tracks') {
        this.pagedController.toggleSelection(entityId, true, { ordinal, extend: true });
      }
    }
    this.pagedViewportOffsetPx = 0;
    this.renderPagedCommitted(this.pagedController.createViewState());
    return result;
  }

  async movePagedFocus(delta, { extend = false } = {}) {
    const total = this.pagedState?.totalCount;
    const maximum = Number.isSafeInteger(total) && total > 0 ? total - 1 : Number.MAX_SAFE_INTEGER;
    const ordinal = Math.max(0, Math.min(maximum, this.pagedFocusedOrdinal + delta));
    const result = await this.pagedController.ensureOrdinal(ordinal);
    if (!result?.accepted) return result;
    const item = this.pagedController.getCachedRows(ordinal, ordinal + 1)[0]?.row;
    if (!item) return { accepted: false, reason: 'row-not-cached' };
    const isTrack = this.getPagedQuery().endpoint === 'tracks';
    const entityId = isTrack ? item.trackUid ?? item.id : this.getPagedEntityId(item);
    this.pagedFocusedOrdinal = ordinal;
    this.pagedFocusedEntityId = entityId;
    this.pagedViewportOrdinal = ordinal;
    this.pagedPendingFocusKey = entityId;
    if (extend && isTrack) {
      this.pagedController.toggleSelection(entityId, true, { ordinal, extend: true });
    }
    this.renderPagedCommitted(this.pagedController.createViewState());
    return { accepted: true, ordinal, entityId };
  }

  togglePagedFocusedSelection({ extend = false } = {}) {
    const uid = this.pagedFocusedEntityId;
    if (!uid) return { accepted: false, reason: 'row-not-focused' };
    const selected = this.pagedController.isSelected(uid, this.pagedFocusedOrdinal);
    const result = this.pagedController.toggleSelection(uid, !selected, {
      ordinal: this.pagedFocusedOrdinal,
      extend
    });
    if (result?.accepted === false) this.announcePagedStatus(this.t('library.paged.selectionTooLarge'));
    this.renderPagedCommitted(this.pagedController.createViewState());
    return result;
  }

  activatePagedFocused() {
    const item = this.pagedController.getCachedRows(
      this.pagedFocusedOrdinal,
      this.pagedFocusedOrdinal + 1
    )[0]?.row;
    if (!item) return { accepted: false, reason: 'row-not-focused' };
    const identity = this.pagedController.createViewState();
    if (this.getPagedQuery().endpoint === 'tracks') {
      const trackUid = item.trackUid ?? item.id;
      return this.pagedController.dispatchRowAction(identity, () => (
        this.manager.performRowAction?.('open', { trackUid })
      ));
    }
    const entityId = this.getPagedEntityId(item);
    return this.pagedController.dispatchRowAction(identity, () => this.navigateToDetail({
      type: this.getPagedQuery().entityType,
      key: entityId,
      title: item.name || item.displayName || ''
    }));
  }

  async focusPagedByPrefix(prefix) {
    const nextPrefix = String(prefix || '');
    if (nextPrefix === ' ' && !this.typeJumpBuffer) return { accepted: false, reason: 'empty-prefix' };
    if (this.typeJumpTimer) clearTimeout(this.typeJumpTimer);
    this.typeJumpBuffer = `${this.typeJumpBuffer}${nextPrefix.replace(/ /g, '')}`;
    this.typeJumpTimer = setTimeout(() => {
      this.typeJumpBuffer = '';
      this.typeJumpTimer = null;
    }, 1000);
    const result = await this.pagedController?.typeJump(this.typeJumpBuffer);
    if (!result?.accepted) return result;
    if (Number.isSafeInteger(result.ordinal)) this.pagedViewportOrdinal = result.ordinal;
    this.pagedViewportOffsetPx = 0;
    this.pagedPendingFocusKey = result.focusKey ?? null;
    if (result.focusKey) {
      this.pagedFocusedOrdinal = result.ordinal;
      this.pagedFocusedEntityId = result.focusKey;
    }
    this.renderPagedCommitted(this.pagedController.createViewState());
    return result;
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
    if (!needle || !this.renderedPageTrackIds.length) return;
    const start = Math.max(0, this.renderedPageTrackIds.indexOf(this.focusedTrackId) + 1);
    const ids = [...this.renderedPageTrackIds.slice(start), ...this.renderedPageTrackIds.slice(0, start)];
    const matchId = ids.find(id => this.manager.getTrackById(id)?.title?.toLocaleLowerCase().startsWith(needle));
    const index = this.renderedPageTrackIds.indexOf(matchId);
    if (index >= 0) this.focusTrackAtIndex(index);
  }

  focusTrackAtIndex(index) {
    const trackId = this.renderedPageTrackIds[index];
    if (!trackId) return;
    this.focusedTrackId = trackId;
    this.scrollTrackIntoView(trackId);
    this.refreshRenderedFocus();
    const row = this.content?.querySelector?.(`.library-track-row[data-track-id="${cssEscape(trackId)}"]`);
    row?.focus?.();
  }

  async handleImportPlaylist() {
    try {
      if (this.pagedIntegrationRequired) {
        const file = await this.pickPagedPlaylistFile();
        if (!file) return;
        const result = await this.manager.playlists.importFile(file);
        const playlistId = result?.playlistId ?? result?.playlist?.id;
        if (playlistId) this.navigateToDetail({ type: 'playlist', key: playlistId }, 'playlists');
        return;
      }
      const file = await this.pickPlaylistFile();
      if (!file) return;
      const preview = this.manager.previewPlaylistImport(file);
      if (!this.confirmPlaylistImport(preview)) return;
      const result = await this.manager.commitPlaylistImport(preview);
      this.navigateToDetail({ type: 'playlist', key: result.playlist.id }, 'playlists');
    } catch (error) {
      this.reportActionFailure(error);
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
      if (this.pagedIntegrationRequired) {
        const grantDroppedImport = globalThis.window?.electronAPI?.libraryCatalogV1?.grantDroppedPlaylistImport;
        const grantResult = grantDroppedImport ? await grantDroppedImport(playlistFile) : null;
        if (grantDroppedImport && !grantResult?.source) {
          throw new Error(grantResult?.error || 'Failed to authorize the dropped playlist.');
        }
        const source = grantResult?.source ?? playlistFile;
        const result = await this.manager.playlists.importFile(source);
        const playlistId = result?.playlistId ?? result?.playlist?.id;
        if (playlistId) this.navigateToDetail({ type: 'playlist', key: playlistId }, 'playlists');
        return;
      }
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
      this.reportActionFailure(error);
    }
  }

  async pickPagedPlaylistFile() {
    if (window.electronAPI?.libraryCatalogV1?.pickPlaylistImport) {
      const result = await window.electronAPI.libraryCatalogV1.pickPlaylistImport();
      if (result?.canceled || !result?.source) return null;
      return result.source;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.m3u,.m3u8,.pls,.xspf';
    input.style.display = 'none';
    const picked = new Promise(resolve => {
      input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
      input.addEventListener('cancel', () => resolve(null), { once: true });
    });
    document.body.appendChild(input);
    input.click();
    try {
      return await picked;
    } finally {
      removeElement(input);
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
      if (this.pagedIntegrationRequired) {
        const sink = await this.createPagedPlaylistExportSink({ fileName, dialogTitle, filters });
        if (!sink) return;
        await this.manager.playlists.exportToSink(playlist.id ?? playlist.playlistId, {
          format,
          relative: this.shouldExportRelativePaths(),
          sink
        });
        return;
      }
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
      const message = error?.code === 'playlistExportTooLarge'
        ? this.t('library.paged.exportTooLarge', {
            limit: Math.floor((error.limitBytes ?? WEB_PLAYLIST_BLOB_EXPORT_MAX_BYTES) / (1024 * 1024))
          })
        : this.t('library.error.actionFailed');
      console.error('Music Library playlist export failed:', error);
      this.uiManager?.setError?.(message, true);
    }
  }

  async createPagedPlaylistExportSink({ fileName, dialogTitle, filters }) {
    if (window.electronAPI?.beginAtomicFileWrite) {
      const result = await window.electronAPI.showSaveDialog({
        title: dialogTitle,
        defaultPath: fileName,
        filters
      });
      if (result?.canceled || !result?.filePath) return null;
      const session = await window.electronAPI.beginAtomicFileWrite(result.filePath);
      if (!session?.success) throw new Error(session?.error || 'Failed to begin playlist export.');
      return {
        destinationPath: result.filePath,
        write: async chunk => assertElectronFileResult(
          await window.electronAPI.writeAtomicFileChunk(session.token, chunk)
        ),
        commit: async () => assertElectronFileResult(
          await window.electronAPI.commitAtomicFileWrite(session.token)
        ),
        abort: () => window.electronAPI.abortAtomicFileWrite(session.token)
      };
    }
    if (typeof window.showSaveFilePicker === 'function') {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: filters[0].name, accept: { 'text/plain': filters[0].extensions.map(value => `.${value}`) } }]
      });
      const writable = await handle.createWritable({ keepExistingData: false });
      return {
        destinationPath: null,
        write: chunk => writable.write(chunk),
        commit: () => writable.close(),
        abort: () => writable.abort()
      };
    }
    const chunks = [];
    let byteLength = 0;
    let completed = false;
    const mimeType = fileName.toLowerCase().endsWith('.xspf')
      ? 'application/xspf+xml;charset=utf-8'
      : 'audio/x-mpegurl;charset=utf-8';
    return {
      destinationPath: null,
      async write(chunk) {
        if (completed) throw new Error('Playlist export sink is already closed.');
        const bytes = encodePlaylistExportChunk(chunk);
        const nextByteLength = byteLength + bytes.byteLength;
        if (nextByteLength > WEB_PLAYLIST_BLOB_EXPORT_MAX_BYTES) {
          throw new WebPlaylistExportLimitError(WEB_PLAYLIST_BLOB_EXPORT_MAX_BYTES, nextByteLength);
        }
        chunks.push(bytes);
        byteLength = nextByteLength;
      },
      async commit() {
        if (completed) throw new Error('Playlist export sink is already closed.');
        completed = true;
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        removeElement(link);
        URL.revokeObjectURL(url);
        chunks.length = 0;
      },
      async abort() {
        completed = true;
        chunks.length = 0;
        byteLength = 0;
      }
    };
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
    this.renderedPageTrackIds = trackIds;
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
      this.reportActionFailure(error);
    } finally {
      unsubscribe?.();
    }
  }

  async handleScanFolders(folderIds = null) {
    try {
      return await this.manager.scanFolders(folderIds);
    } catch (error) {
      this.reportActionFailure(error);
      return null;
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
    if (this.pagedIntegrationRequired) {
      void this.renderPagedStatus(scanState);
      return;
    }
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
      parts.push(this.t('library.state.scanError'));
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

  async renderPagedStatus(scanState = this.lastScanState) {
    const requestVersion = (this.pagedStatusVersion || 0) + 1;
    this.pagedStatusVersion = requestVersion;
    this.syncContentScrollbarInset();
    try {
      const counts = await this.manager.getCounts();
      if (!this.status || requestVersion !== this.pagedStatusVersion) return;
      const parts = [
        `${counts?.tracks ?? 0} ${this.t('library.status.tracks')}`,
        `${counts?.albums ?? 0} ${this.t('library.status.albums')}`
      ];
      if (scanState?.phase === 'scanning') {
        parts.push(`${this.t('library.state.scanning')} ${scanState.parsed || 0}/${scanState.found || 0}`);
      } else if (scanState?.phase === 'error') {
        parts.push(this.t('library.state.scanError'));
      }
      this.status.innerHTML = `<span>${escapeHtml(parts.join(' · '))}</span>`;
      if (this.nowPlayingTrackId) {
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'library-status-button';
        jump.textContent = this.t('library.action.jumpToNowPlaying');
        jump.addEventListener('click', () => this.showTrack(this.nowPlayingTrackId));
        this.status.appendChild(jump);
      }
    } catch (_) {
      if (!this.status || requestVersion !== this.pagedStatusVersion) return;
      this.status.textContent = this.t('library.state.scanError');
    }
  }

  t(key, params = {}) {
    const text = this.uiManager?.t ? this.uiManager.t(key, params) : key;
    return text === key ? fallbackText(key, params) : text;
  }

  reportActionFailure(error) {
    console.error('Music Library action failed:', error);
    this.uiManager?.setError?.(this.t('library.error.actionFailed'), true);
  }
}

function fallbackText(key, params = {}) {
  const map = {
    'library.title': 'Music Library',
    'library.nav.tracks': 'Tracks',
    'library.nav.albums': 'Albums',
    'library.nav.artists': 'Artists',
    'library.nav.genres': 'Genres',
    'library.nav.subfolders': 'Subfolders',
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
    'library.action.choosePlaylistToExport': 'Choose a playlist to export.',
    'library.action.exportM3U8': 'Export M3U8',
    'library.action.exportXSPF': 'Export XSPF',
    'library.action.rename': 'Rename',
    'ui.exportPlaylists': 'Export Playlists',
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
    'library.action.undoCancelledPlay': 'Restore Previous Queue',
    'library.error.undoCancelledPlayUnavailable': 'The previous queue can no longer be restored.',
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
    'library.paged.loading': 'Loading library…',
    'library.paged.loadFailed': 'Unable to load the library page.',
    'library.paged.retry': 'Retry',
    'library.paged.selectAllResults': 'Select All Results',
    'library.paged.selectionStale': 'The selection belongs to an older Library snapshot.',
    'library.paged.reselect': 'Reselect in Current Results',
    'library.paged.selectionTooLarge': 'This sparse selection is too large. Use Select All Results or select a contiguous range.',
    'library.paged.exportTooLarge': `This browser limits playlist downloads to ${params.limit || 32} MB. Use the desktop app or a browser with file system access.`,
    'library.paged.reselectFailed': 'The selection could not be recreated in the current results.',
    'library.paged.playlistVersionUnavailable': 'The playlist changed. Reopen the menu and try again.',
    'library.paged.serviceUnavailable': 'The paged Library service is unavailable.',
    'library.paged.selectTrack': `Select ${params.title || ''}`,
    'library.paged.previous': 'Previous',
    'library.paged.next': 'Next',
    'library.paged.page': `Page ${params.page || 1}`,
    'library.job.action.operation': 'Library operation',
    'library.job.action.play': 'Build playback queue',
    'library.job.action.playNext': 'Add to Play Next',
    'library.job.action.queue': 'Add to queue',
    'library.job.action.addToPlaylist': 'Add to playlist',
    'library.job.action.importPlaylist': 'Import playlist',
    'library.job.waiting': 'Waiting for the Library service…',
    'library.job.cancelling': 'Cancelling…',
    'library.job.phase.received': 'Request received',
    'library.job.phase.snapshotting': 'Preparing selection',
    'library.job.phase.materializing': 'Writing items',
    'library.job.phase.ready': 'Ready to commit',
    'library.job.phase.cancel_requested': 'Cancellation requested',
    'library.job.phase.committing': 'Committing',
    'library.job.terminal.succeeded': 'Completed',
    'library.job.terminal.failed': 'Failed',
    'library.job.terminal.cancelled': 'Cancelled',
    'library.job.terminal.interrupted': 'Interrupted; retry is available',
    'library.job.progressKnown': `${params.processed || 0} / ${params.total || 0}`,
    'library.job.progressUnknown': `${params.processed || 0} processed`,
    'library.status.moreTracks': `${params.count || 0} more`,
    'library.state.empty': 'Build your music library',
    'library.state.noResults': `No results for "${params.query || ''}"`,
    'library.state.noSubfolders': 'No subfolders contain music yet.',
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
    'library.error.actionFailed': 'The Music Library could not complete this action. Please try again.',
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

function encodePlaylistExportChunk(chunk) {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk.slice(0));
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
  }
  throw new TypeError('Playlist export chunks must be strings or byte arrays.');
}

function sanitizeFileName(value) {
  return String(value || 'playlist')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/./g, char => char.charCodeAt(0) < 32 ? '_' : char)
    .replace(/\s+/g, ' ')
    .trim() || 'playlist';
}

export function getPagedInvalidationDecision(query, event) {
  const changedScopes = Array.isArray(event?.changedScopes) ? event.changedScopes : [];
  if (changedScopes.length === 0) return { restart: false, reason: 'no-changed-scope' };
  const relevantScopes = new Set();
  if (query?.endpoint === 'tracks') {
    relevantScopes.add('tracks');
    const playlistId = query.scope?.playlistId;
    if (playlistId) {
      relevantScopes.add('playlists');
      relevantScopes.add(`playlist:${playlistId}`);
    }
    const folderId = query.scope?.folderKey ?? query.scope?.folderId;
    if (folderId) {
      relevantScopes.add('folders');
      relevantScopes.add(`folder:${folderId}`);
    }
  } else if (query?.endpoint === 'entities') {
    const plural = {
      album: 'albums',
      artist: 'artists',
      genre: 'genres',
      folder: 'folders',
      subfolder: 'subfolders',
      playlist: 'playlists'
    }[query.entityType];
    if (plural) relevantScopes.add(plural);
  }
  const changedScope = changedScopes.find(scope => relevantScopes.has(scope) || (
    query?.endpoint === 'entities' && query.entityType === 'folder' && scope.startsWith('folder:')
  ) || (
    query?.endpoint === 'entities' && query.entityType === 'playlist' && scope.startsWith('playlist:')
  ));
  return changedScope
    ? { restart: true, reason: 'visible-scope-changed', changedScope }
    : { restart: false, reason: 'unrelated-scope' };
}

export function isPagedSnapshotExpiryError(error) {
  return new Set([
    'STALE_CURSOR',
    'staleCursor',
    'snapshotExpired',
    'contextExpired',
    'invalidContext'
  ]).has(error?.code);
}

function assertElectronFileResult(result) {
  if (!result?.success) throw new Error(result?.error || 'Playlist file operation failed.');
  return result;
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
