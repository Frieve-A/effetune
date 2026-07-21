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
import {
  SYSTEM_PLAYLIST_IDS,
  isSystemPlaylistId,
  systemPlaylistLabelKey
} from '../../library/playlists/system-playlists.js';

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
const LIBRARY_NAV_VIEWS = Object.freeze([
  'tracks', 'albums', 'artists', 'genres', 'subfolders', 'folders', 'recent', 'playlists'
]);

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
  recent: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  star: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/></svg>',
  starFilled: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.7 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4-4.7-4.6 6.5-.9z"/></svg>',
  more: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  close: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

const PAGED_PLAYLIST_ITEM_DRAG_TYPE = 'application/x-effetune-playlist-item-key';
const FOCUSABLE_DIALOG_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
let libraryDialogId = 0;
const PLAYLIST_PICKER_FOCUS_TIMEOUT_MS = 1000;
const DESKTOP_LIBRARY_MIN_HEIGHT_PX = 360;
const DESKTOP_LIBRARY_BOTTOM_GAP_PX = 20;
const LIBRARY_SEARCH_DEBOUNCE_MS = 100;
const PAGED_ACTION_TOAST_DELAY_MS = 750;
const PAGED_DEFAULT_SELECT_ALL_LIMIT = 300;
const PAGED_DEFAULT_SELECT_ALL_SCOPE_KEYS = Object.freeze([
  'albumKey', 'artistKey', 'genreKey', 'subfolderKey', 'playlistId', 'folderDirKey'
]);
const PAGED_GRID_MIN_CARD_WIDTH_PX = 176;
const PAGED_GRID_MAX_COLUMNS = 12;
const PAGED_GRID_GAP_PX = 16;
const PAGED_MEDIA_CARD_VERTICAL_CHROME_PX = 48;
const PAGED_CARD_SCOPE_KEYS = Object.freeze({
  album: 'albumKey',
  artist: 'artistKey',
  genre: 'genreKey',
  subfolder: 'subfolderKey',
  playlist: 'playlistId'
});
const PAGED_ARTWORK_DETAIL_TYPES = Object.freeze(['album', 'artist', 'genre', 'subfolder']);
const DETAIL_VIEW_BY_TYPE = Object.freeze({
  album: 'albums',
  artist: 'artists',
  genre: 'genres',
  subfolder: 'subfolders',
  folder: 'folders',
  playlist: 'playlists'
});
const PAGED_ENTITY_TYPE_BY_VIEW = Object.freeze(Object.fromEntries(
  Object.entries(DETAIL_VIEW_BY_TYPE).map(([entityType, view]) => [view, entityType])
));
const ENTITY_SORT_FIELDS = Object.freeze({
  album: Object.freeze([
    Object.freeze({ sort: 'name', labelKey: 'library.sort.name' }),
    Object.freeze({ sort: 'artist', labelKey: 'library.column.artist' }),
    Object.freeze({ sort: 'year', labelKey: 'library.sort.year' }),
    Object.freeze({ sort: 'trackCount', labelKey: 'library.sort.trackCount' }),
    Object.freeze({ sort: 'duration', labelKey: 'library.sort.duration' })
  ]),
  artist: Object.freeze([
    Object.freeze({ sort: 'name', labelKey: 'library.sort.name' }),
    Object.freeze({ sort: 'trackCount', labelKey: 'library.sort.trackCount' }),
    Object.freeze({ sort: 'duration', labelKey: 'library.sort.duration' })
  ]),
  genre: Object.freeze([
    Object.freeze({ sort: 'name', labelKey: 'library.sort.name' }),
    Object.freeze({ sort: 'trackCount', labelKey: 'library.sort.trackCount' }),
    Object.freeze({ sort: 'duration', labelKey: 'library.sort.duration' })
  ]),
  subfolder: Object.freeze([
    Object.freeze({ sort: 'path', labelKey: 'library.sort.path' }),
    Object.freeze({ sort: 'name', labelKey: 'library.sort.name' }),
    Object.freeze({ sort: 'trackCount', labelKey: 'library.sort.trackCount' }),
    Object.freeze({ sort: 'duration', labelKey: 'library.sort.duration' })
  ]),
  playlist: Object.freeze([
    Object.freeze({ sort: 'name', labelKey: 'library.sort.name' }),
    Object.freeze({ sort: 'updated', labelKey: 'library.sort.updated' }),
    Object.freeze({ sort: 'created', labelKey: 'library.sort.created' })
  ])
});
const DEFAULT_ENTITY_SORTS = Object.freeze({
  album: Object.freeze({ sort: 'name', direction: 'asc' }),
  artist: Object.freeze({ sort: 'name', direction: 'asc' }),
  genre: Object.freeze({ sort: 'name', direction: 'asc' }),
  subfolder: Object.freeze({ sort: 'path', direction: 'asc' }),
  playlist: Object.freeze({ sort: 'name', direction: 'asc' })
});
const PAGED_SEARCH_ENTITY_TYPES = Object.freeze(['album', 'artist', 'playlist']);
const PAGED_MOBILE_READ_AHEAD_PAGES = 2;
const PAGED_ACTION_PHASE_KEYS = Object.freeze({
  RECEIVED: 'library.job.phase.received',
  SNAPSHOTTING: 'library.job.phase.snapshotting',
  MATERIALIZING: 'library.job.phase.materializing',
  READY: 'library.job.phase.ready',
  CANCEL_REQUESTED: 'library.job.phase.cancel_requested',
  COMMITTING: 'library.job.phase.committing'
});
const CUE_SCAN_WARNING_KEYS = Object.freeze({
  'cue-invalid': 'library.paged.cueScanWarningInvalid',
  'cue-unsupported': 'library.paged.cueScanWarningUnsupported',
  'cue-too-large': 'library.paged.cueScanWarningTooLarge'
});
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
    this.pagedManagerMissing = getMissingPagedManagerMethods(manager);
    this.pagedController = null;
    this.pagedQueryKey = null;
    this.pagedState = null;
    this.pagedAnchor = null;
    this.pagedViewportOrdinal = 0;
    this.pagedViewportOffsetPx = 0;
    this.pagedContentScrollTop = 0;
    this.pagedResetScrollOnCommit = true;
    this.pagedScrollToAnchorOnCommit = true;
    this.pagedRestorePending = false;
    this.pagedAnchorRestoreRequestId = 0;
    this.pagedAnchorRestoreInProgress = false;
    this.pagedRestartPreservesSelection = false;
    this.pagedPendingFocusKey = null;
    this.pagedPendingEntityJump = null;
    this.pagedArtworkLoader = null;
    this.pagedDetailArtworkLoader = null;
    this.pagedArtworkLoaderAttemptKey = null;
    this.pagedFocusParked = false;
    this.pagedPublishedAnnouncementIds = new Set();
    this.pagedFocusedOrdinal = 0;
    this.pagedFocusedEntityId = null;
    this.pagedMobileSelectionActive = false;
    this.pagedOperationContexts = new Map();
    this.pagedActionToastToken = null;
    this.pagedActionToastTimer = null;
    this.pagedActionToastVisible = false;
    this.queueUndoAvailable = this.manager.canUndoPlaybackSession?.() === true;
    this.pagedActionController = this.createPagedActionController();
    this.root = null;
    this.nav = null;
    this.content = null;
    this.status = null;
    this.searchInput = null;
    this.currentView = 'tracks';
    this.detail = null;
    this.searchQuery = '';
    this.searchEntityType = null;
    this.searchEntityReturnView = null;
    this.sort = 'artist';
    this.sortDirection = 'asc';
    this.entitySorts = createDefaultEntitySorts();
    this.detailSortOverride = false;
    this.folderBrowseMode = 'tree';
    this.loadUIState();
    this.unsubscribe = [];
    this.lastScanState = null;
    this.activeScanStates = new Map();
    this.folderScanStates = new Map();
    this.lastCueWarningNotificationScanId = null;
    this.removingFolderIds = new Set();
    this.folderRemovalProgress = new Map();
    this.deferredCatalogInvalidationScopes = null;
    this.trackScrollCleanup = null;
    this.desktopLayoutHeightCleanup = null;
    this.refreshDesktopLayoutHeightObservers = null;
    this.desktopLayoutHeightFrame = null;
    this.desktopLayoutHeightFrameType = null;
    this.renderVersion = 0;
    this.pagedPublishedPhase = null;
    this.pagedPublishedState = null;
    this.pagedPublishedResultSignature = null;
    this.pagedPublishedSearchQuery = '';
    this.pausePagedWindowRendering = null;
    this.refreshPagedWindow = null;
    this.pendingBreakpointRebuild = false;
    this.playlistMenu = null;
    this.playlistMenuCleanup = null;
    this.playlistMenuReturnFocus = null;
    this.contextMenu = null;
    this.contextMenuCleanup = null;
    this.contextMenuReturnFocus = null;
    this.renderedPageTrackIds = [];
    this.nowPlayingTrackId = null;
    this.favoriteTrackUids = new Set();
    this.favoriteStateRequestId = 0;
    this.favoriteMutationDepth = 0;
    this.searchComposing = false;
    this.searchDebounceTimer = null;
    this.mobileHistoryInitialized = false;
    this.mobileHistoryDepth = 0;
    this.mobileHistoryIndex = 0;
    this.navigationReturnSnapshot = null;
    this.searchEntityReturnSnapshot = null;
    this.pendingPagedNavigationPosition = null;
    this.pagedNavigationRestorePosition = null;
    this.suppressPopStateCount = 0;
    this.isViewShown = false;
    this.lastRevealedMobileNavView = null;
    this.typeJumpBuffer = '';
    this.typeJumpTimer = null;
    this.renderScheduled = false;
    this.libraryReturnFocus = null;
    this.navigationIntentId = 0;
    this.folderBrowseRequestId = 0;
    this.folderBrowseGeneration = 0;
    this.folderChildrenState = null;
    this.folderNavigationPositions = new Map();
    this.pendingFolderFocusPath = null;
    this.pagedPaginationFailureOrdinal = null;
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
      if (event.key === 'Escape' && this.handleLibraryEscape(event)) {
        event.stopPropagation?.();
      }
    });
    this.content.addEventListener('keydown', event => this.handleContentKeyDown(event));
    this.content.addEventListener('dragover', event => this.handlePlaylistFileDragOver(event));
    this.content.addEventListener('drop', event => this.handlePlaylistFileDrop(event));
    document.addEventListener('keydown', event => this.handleGlobalLibraryKeyDown(event));
    globalThis.window?.addEventListener?.('popstate', event => this.handleMobilePopState(event));
    this.root.querySelector('.library-add-folder')?.addEventListener('click', () => {
      this.runLibraryCommand(() => this.handleAddFolder(), { logMessage: 'Music Library folder add failed:' });
    });
    this.root.querySelector('.library-rescan')?.addEventListener('click', () => {
      this.runLibraryCommand(() => this.handleScanFolders(), { logMessage: 'Music Library rescan failed:' });
    });
    if (typeof this.manager.addListener === 'function') {
      this.unsubscribe.push(
        this.manager.addListener('ready', () => {
          void this.refreshSystemPlaylistState();
          this.render();
        }),
        this.manager.addListener('catalog-changed', event => this.handleCatalogInvalidation(event)),
        this.manager.addListener('playlists-changed', event => this.handlePlaylistsChanged(event)),
        this.manager.addListener('scan-state', state => this.handleScanState(state)),
        this.manager.addListener('folder-removal-state', state => this.handleFolderRemovalState(state))
      );
    }
    void this.refreshSystemPlaylistState();
    this.render();
    return this.root;
  }

  updateUITexts() {
    if (!this.root) return;
    const title = this.t('library.title');
    this.root.setAttribute('aria-label', title);
    this.nav?.setAttribute('aria-label', title);
    if (this.searchInput) this.searchInput.placeholder = this.t('library.search.placeholder');

    const addFolderLabel = this.root.querySelector('.library-add-folder span');
    if (addFolderLabel) addFolderLabel.textContent = this.t('library.action.addFolder');

    const rescanButton = this.root.querySelector('.library-rescan');
    if (rescanButton) {
      const rescanLabel = this.t('library.action.rescan');
      rescanButton.title = rescanLabel;
      rescanButton.setAttribute('aria-label', rescanLabel);
    }

    this.render();
  }

  createPagedActionController() {
    const required = [
      'getLibraryOperationStatus', 'cancelLibraryOperation', 'subscribeLibraryOperation'
    ];
    if (!required.every(method => typeof this.manager?.[method] === 'function')) return null;
    return new DurableActionController({
      service: this.manager,
      onStateChange: state => this.handlePagedActionStateChange(state)
    });
  }

  handlePagedActionStateChange(state) {
    if (state?.status === 'terminal' && state.operationId) {
      const contextToken = this.pagedOperationContexts.get(state.operationId);
      if (contextToken) {
        this.pagedOperationContexts.delete(state.operationId);
        Promise.resolve(this.manager.releaseContext(contextToken)).catch(error => {
          console.warn('Failed to release a completed card playback context:', error);
        });
      }
    }
    const queueUndoAvailable = this.manager.canUndoPlaybackSession?.() === true;
    if (queueUndoAvailable !== this.queueUndoAvailable) {
      this.queueUndoAvailable = queueUndoAvailable;
      this.renderStatus();
    } else {
      const undoButton = this.status?.querySelector?.('.library-status-queue-undo');
      if (undoButton) undoButton.disabled = this.isPagedActionBusy();
    }
    this.updatePagedActionToastVisibility(state);
    this.renderPagedActionToast();
  }

  updatePagedActionToastVisibility(state) {
    const actionToken = state?.actionToken ?? null;
    if (actionToken !== this.pagedActionToastToken) {
      clearTimeout(this.pagedActionToastTimer);
      this.pagedActionToastTimer = null;
      this.pagedActionToastVisible = false;
      this.pagedActionToastToken = actionToken;
    }

    if (['starting', 'active'].includes(state?.status)) {
      if (!this.pagedActionToastVisible && this.pagedActionToastTimer == null) {
        this.pagedActionToastTimer = setTimeout(() => {
          this.pagedActionToastTimer = null;
          const current = this.pagedActionController?.state;
          if (!['starting', 'active'].includes(current?.status)) return;
          this.pagedActionToastVisible = true;
          this.renderPagedActionToast();
        }, PAGED_ACTION_TOAST_DELAY_MS);
      }
      return;
    }

    clearTimeout(this.pagedActionToastTimer);
    this.pagedActionToastTimer = null;
    this.pagedActionToastVisible = Boolean(state?.status === 'waiting' ||
      state?.status === 'cancelling' ||
      (state?.status === 'terminal' && state.terminalKind !== 'succeeded'));
  }

  handleCatalogInvalidation(event) {
    this.invalidateFolderBrowseCaches(event?.changedScopes);
    if (this.isCatalogRefreshDeferred()) {
      this.deferredCatalogInvalidationScopes ??= new Set();
      for (const scope of event?.changedScopes ?? []) {
        this.deferredCatalogInvalidationScopes.add(scope);
      }
      return;
    }
    const query = this.getPagedQuery();
    const dependentQueries = (this.searchQuery || '').trim() && query.endpoint === 'tracks'
      ? PAGED_SEARCH_ENTITY_TYPES.map(entityType => ({ endpoint: 'entities', entityType }))
      : [];
    const decision = getPagedInvalidationDecision(query, event, dependentQueries);
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

  invalidateFolderBrowseCaches(changedScopes = []) {
    const scopes = Array.isArray(changedScopes) ? changedScopes : [];
    const navigationPositions = this.folderNavigationPositions instanceof Map
      ? this.folderNavigationPositions
      : null;
    const invalidateAll = scopes.includes('tracks') || scopes.includes('folders');
    const folderIds = new Set(scopes
      .filter(scope => typeof scope === 'string' && scope.startsWith('folder:'))
      .map(scope => scope.slice('folder:'.length))
      .filter(Boolean));
    if (!invalidateAll && folderIds.size === 0) return;

    if (invalidateAll) {
      this.folderBrowseGeneration = (this.folderBrowseGeneration ?? 0) + 1;
      this.folderChildrenState = null;
      navigationPositions?.clear();
      return;
    }

    for (const key of navigationPositions?.keys() ?? []) {
      const separator = key.indexOf('\0');
      if (separator >= 0 && folderIds.has(key.slice(0, separator))) {
        navigationPositions.delete(key);
      }
    }
    const currentFolderId = this.detail?.type === 'folderNode' ? this.detail.folderId : null;
    const stateFolderId = this.folderChildrenState?.key?.split('\0', 1)[0] ?? null;
    if (folderIds.has(currentFolderId) || folderIds.has(stateFolderId)) {
      this.folderBrowseGeneration = (this.folderBrowseGeneration ?? 0) + 1;
      this.folderChildrenState = null;
    }
  }

  handlePlaylistsChanged(event) {
    const scopes = Array.isArray(event?.changedScopes) ? event.changedScopes : [];
    if (scopes.some(scope => scope === 'playlists' || scope === `playlist:${SYSTEM_PLAYLIST_IDS.favorites}`)) {
      if ((this.favoriteMutationDepth ?? 0) > 0) {
        return;
      }
      void this.refreshFavoriteTrackUids();
    }
  }

  async refreshSystemPlaylistState() {
    await this.refreshFavoriteTrackUids();
  }

  async refreshFavoriteTrackUids() {
    if (typeof this.manager?.playlists?.getFavoriteTrackUids !== 'function') return;
    const requestId = ++this.favoriteStateRequestId;
    try {
      const result = await this.manager.playlists.getFavoriteTrackUids();
      if (requestId !== this.favoriteStateRequestId) return;
      this.favoriteTrackUids = new Set(Array.isArray(result) ? result : result?.trackUids ?? []);
      this.refreshRenderedFavoriteStates();
    } catch (error) {
      if (requestId === this.favoriteStateRequestId) {
        console.warn('Unable to refresh favorite tracks:', error);
      }
    }
  }

  handleScanState(state) {
    this.updateTrackedScanStates(state);
    this.lastScanState = this.getCombinedActiveScanState() ?? state;
    this.reportCueScanWarnings(state);
    this.refreshPagedFolderScanState();
    this.renderStatus();
    this.flushDeferredCatalogInvalidation();
  }

  updateTrackedScanStates(state) {
    if (!state || typeof state !== 'object') return;
    this.activeScanStates ??= new Map();
    this.folderScanStates ??= new Map();
    const scanId = typeof state.scanId === 'string' && state.scanId
      ? state.scanId
      : '__unidentified-scan__';
    const previous = this.activeScanStates.get(scanId);
    const folderIds = [...new Set([
      ...getScanStateFolderIds(previous),
      ...getScanStateFolderIds(state)
    ])];
    const trackedState = { ...previous, ...state, folderIds };

    if (state.phase === 'scanning') {
      this.activeScanStates.delete(scanId);
      this.activeScanStates.set(scanId, trackedState);
    } else {
      this.activeScanStates.delete(scanId);
    }
    for (const folderId of folderIds) this.folderScanStates.set(folderId, trackedState);
  }

  getCombinedActiveScanState() {
    const states = [...(this.activeScanStates?.values?.() ?? [])];
    if (states.length === 0) return null;
    const latest = states.at(-1);
    return {
      ...latest,
      phase: 'scanning',
      folderIds: [...new Set(states.flatMap(getScanStateFolderIds))],
      found: states.reduce((total, state) => total + Number(state.found ?? 0), 0),
      parsed: states.reduce((total, state) => total + Number(state.parsed ?? 0), 0)
    };
  }

  getTrackedFolderScanState(folderId) {
    const active = [...(this.activeScanStates?.values?.() ?? [])]
      .findLast(state => getScanStateFolderIds(state).includes(folderId));
    return active ?? this.folderScanStates?.get?.(folderId) ?? null;
  }

  reportCueScanWarnings(state) {
    if (state?.phase !== 'done' || !Array.isArray(state.warnings)) return;
    const warnings = state.warnings.filter(warning =>
      CUE_SCAN_WARNING_KEYS[warning?.category] &&
      Number.isSafeInteger(warning?.count) && warning.count > 0);
    if (warnings.length === 0) return;
    if (state.scanId && state.scanId === this.lastCueWarningNotificationScanId) return;
    if (state.scanId) this.lastCueWarningNotificationScanId = state.scanId;
    const count = warnings.reduce((total, warning) => total + warning.count, 0);
    const message = [
      this.t('library.paged.cueScanWarningSummary', { count }),
      ...warnings.map(warning => this.t(CUE_SCAN_WARNING_KEYS[warning.category], {
        count: warning.count
      })),
      this.t('library.paged.cueScanWarningAction')
    ].join(' ');
    this.uiManager?.setError?.(message, false);
    this.announcePagedStatus(message);
  }

  handleFolderRemovalState(state) {
    if (!state?.folderId) return;
    this.removingFolderIds ??= new Set();
    this.folderRemovalProgress ??= new Map();
    if (state.phase === 'removing') {
      this.removingFolderIds.add(state.folderId);
      this.folderRemovalProgress.set(state.folderId, {
        deleted: state.deleted,
        total: state.total
      });
    } else {
      this.removingFolderIds.delete(state.folderId);
      this.folderRemovalProgress.delete(state.folderId);
    }
    this.refreshPagedFolderScanState();
    this.renderStatus();
    if (state.phase !== 'removing') this.flushDeferredCatalogInvalidation();
  }

  isCatalogRefreshDeferred() {
    const scanInProgress = this.activeScanStates instanceof Map
      ? this.activeScanStates.size > 0
      : this.lastScanState?.phase === 'scanning';
    return scanInProgress ||
      (this.removingFolderIds?.size ?? 0) > 0 ||
      (this.favoriteMutationDepth ?? 0) > 0;
  }

  flushDeferredCatalogInvalidation() {
    if (this.isCatalogRefreshDeferred() || !this.deferredCatalogInvalidationScopes) return;
    const changedScopes = [...this.deferredCatalogInvalidationScopes];
    this.deferredCatalogInvalidationScopes = null;
    this.handleCatalogInvalidation({ changedScopes });
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
      this.entitySorts ??= createDefaultEntitySorts();
      const state = JSON.parse(globalThis.localStorage?.getItem(MUSIC_LIBRARY_UI_STORAGE_KEY) || '{}');
      if (state.sort) this.sort = state.sort;
      if (state.sortDirection === 'asc' || state.sortDirection === 'desc') {
        this.sortDirection = state.sortDirection;
      }
      for (const entityType of Object.keys(DEFAULT_ENTITY_SORTS)) {
        const preference = state.entitySorts?.[entityType];
        if (isSupportedEntitySort(entityType, preference)) {
          this.entitySorts[entityType] = {
            sort: preference.sort,
            direction: preference.direction
          };
        }
      }
      if (state.folderBrowseMode === 'tree' || state.folderBrowseMode === 'flat') {
        this.folderBrowseMode = state.folderBrowseMode;
      }
    } catch (_) {
      // UI preferences are optional; invalid stored state falls back to defaults.
    }
  }

  saveUIState() {
    try {
      globalThis.localStorage?.setItem(MUSIC_LIBRARY_UI_STORAGE_KEY, JSON.stringify({
        sort: this.sort,
        sortDirection: this.sortDirection,
        entitySorts: this.entitySorts,
        folderBrowseMode: this.folderBrowseMode
      }));
    } catch (_) {
      // Ignore storage failures so private browsing or quota issues do not block the library.
    }
  }

  show(options = {}) {
    this.invalidateNavigationIntent();
    const { focusSearch = true, returnFocus = null, initialView } = options || {};
    this.isViewShown = false;
    this.lastRevealedMobileNavView = null;
    if (initialView !== undefined) {
      this.currentView = normalizeMusicLibraryStartupView(initialView);
      this.detail = null;
      this.detailSortOverride = false;
      this.searchQuery = '';
      this.searchEntityType = null;
      this.searchEntityReturnView = null;
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
    this.invalidateNavigationIntent();
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = null;
    if (this.pagedController) {
      this.capturePagedAnchor();
      this.pagedAnchorRestoreRequestId += 1;
      this.pagedAnchorRestoreInProgress = false;
      this.pagedRestorePending = false;
      void this.pagedController.destroy();
      this.pagedController = null;
      this.pagedQueryKey = null;
      this.pagedState = null;
    }
    this.pagedMobileSelectionActive = false;
    this.refreshPagedMobileSelectionMode();
    this.pendingBreakpointRebuild = false;
    this.closeContextMenu({ restoreFocus: false });
    this.closePlaylistMenu({ restoreFocus: false });
    this.stopDesktopLayoutHeightTracking();
    // Tear down the track-table scroll/resize listeners so the window 'resize'
    // handler does not survive teardown and re-render the hidden view.
    this.trackScrollCleanup?.();
    this.trackScrollCleanup = null;
    this.destroyPagedArtworkLoader();
    if (this.mobileHistoryDepth > 0 && typeof globalThis.history?.go === 'function') {
      this.suppressPopStateCount += 1;
      globalThis.history.go(-this.mobileHistoryDepth);
    }
    this.mobileHistoryDepth = 0;
    this.mobileHistoryIndex = 0;
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
    const intentId = this.beginNavigationIntent();
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      if (!this.isNavigationIntentCurrent(intentId)) return;
      this.searchDebounceTimer = null;
      this.searchQuery = this.searchInput?.value || '';
      if (!this.searchQuery.trim()) {
        this.searchEntityType = null;
        this.searchEntityReturnView = null;
      }
      if (this.detail?.type !== 'folderNode') this.detail = null;
      this.render();
    }, LIBRARY_SEARCH_DEBOUNCE_MS);
  }

  beginNavigationIntent() {
    this.retirePendingFolderBrowse();
    this.navigationIntentId += 1;
    return this.navigationIntentId;
  }

  invalidateNavigationIntent() {
    this.retirePendingFolderBrowse();
    this.navigationIntentId += 1;
  }

  retirePendingFolderBrowse() {
    if (!this.folderChildrenState?.loading) return;
    const liveSection = this.content?.querySelector?.('.library-folder-directory-section');
    if (liveSection?.dataset.folderBrowseKey === this.folderChildrenState.key) {
      const more = liveSection.querySelector?.('.library-folder-directory-more');
      if (more) {
        more.disabled = false;
        more.removeAttribute?.('aria-busy');
      }
    }
    this.folderChildrenState = null;
  }

  isNavigationIntentCurrent(intentId) {
    return intentId === this.navigationIntentId;
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
    this.preserveContentScroll(() => {
      setStyleProperty(this.root, '--library-desktop-height', `${height}px`);
    });
  }

  resetDesktopLayoutHeight() {
    this.preserveContentScroll(() => {
      removeStyleProperty(this.root, '--library-desktop-height');
    });
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

  preserveContentScroll(update) {
    if (typeof update !== 'function') return undefined;
    const content = this.content;
    if (!content) return update();
    const scrollTop = Number(content.scrollTop) || 0;
    let result;
    try {
      result = update();
    } finally {
      if (content === this.content) {
        content.scrollTop = scrollTop;
        this.pagedContentScrollTop = scrollTop;
      }
    }
    return result;
  }

  focusWithoutContentScroll(element) {
    if (!element?.focus) return;
    this.preserveContentScroll(() => element.focus({ preventScroll: true }));
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
    const intentId = this.beginNavigationIntent();
    const track = await this.manager.getTrack(trackId);
    if (!this.isNavigationIntentCurrent(intentId) || !track) return false;
    const target = options.view === 'artist'
      ? this.getTrackArtistDetail(track)
      : (track.albumKey ? { type: 'album', key: track.albumKey } : null);
    if (target) {
      this.navigateToDetail(target, target.type === 'artist' ? 'artists' : 'albums');
    } else {
      this.navigateToView('tracks');
    }
    this.pagedPendingEntityJump = { entityKind: 'track', entityId: trackId };
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
    this.pagedPendingEntityJump = { entityKind: 'track', entityId: trackId };
    if (this.pagedState?.phase === 'committed') {
      const jump = this.pagedPendingEntityJump;
      this.pagedPendingEntityJump = null;
      void this.jumpPagedToEntity(jump.entityKind, jump.entityId);
    }
  }

  async jumpPagedToEntity(entityKind, entityId) {
    const intentId = this.navigationIntentId;
    const controller = this.pagedController;
    const result = await controller?.jumpToEntity(entityKind, entityId);
    if (!this.isNavigationIntentCurrent(intentId) || controller !== this.pagedController) {
      return { accepted: false, reason: 'stale-page' };
    }
    if (!result?.accepted) return result;
    if (Number.isSafeInteger(result.ordinal)) this.pagedViewportOrdinal = result.ordinal;
    if (entityKind === 'track' && Number.isSafeInteger(result.ordinal)) {
      this.pagedController.toggleSelection(entityId, true, { ordinal: result.ordinal });
    }
    this.pagedViewportOffsetPx = 0;
    this.pagedScrollToAnchorOnCommit = true;
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
    const pendingPagedNavigationPosition = this.pendingPagedNavigationPosition;
    this.pendingPagedNavigationPosition = null;
    const queryFingerprint = JSON.stringify(this.getPagedQuery());
    const restoresPagedNavigationPosition =
      pendingPagedNavigationPosition?.queryFingerprint === queryFingerprint;
    if (restoresPagedNavigationPosition) {
      this.pagedNavigationRestorePosition = {
        ...pendingPagedNavigationPosition,
        anchor: pendingPagedNavigationPosition.anchor
          ? { ...pendingPagedNavigationPosition.anchor }
          : null
      };
    } else if (this.pagedNavigationRestorePosition?.queryFingerprint !== queryFingerprint) {
      this.pagedNavigationRestorePosition = null;
    }
    if (
      !restoresPagedNavigationPosition &&
      this.pagedState?.phase === 'committed' &&
      this.pagedQueryKey === queryFingerprint
    ) {
      this.pagedContentScrollTop = Number(this.content?.scrollTop) || 0;
      this.capturePagedAnchor();
    }
    this.pendingBreakpointRebuild = false;
    const renderVersion = ++this.renderVersion;
    this.syncNowPlayingTrack();
    this.closePlaylistMenu({ restoreFocus: false });
    this.closeContextMenu();
    this.pausePagedWindowRendering?.();
    // Clear the visible row identities before the paged view commits its next snapshot.
    this.renderedPageTrackIds = [];
    if (restoresPagedNavigationPosition) {
      this.pagedAnchor = pendingPagedNavigationPosition.anchor
        ? { ...pendingPagedNavigationPosition.anchor }
        : null;
      this.pagedViewportOrdinal = Number.isSafeInteger(pendingPagedNavigationPosition.viewportOrdinal)
        ? pendingPagedNavigationPosition.viewportOrdinal
        : 0;
      this.pagedViewportOffsetPx = Number(pendingPagedNavigationPosition.viewportOffsetPx) || 0;
      this.pagedContentScrollTop = Number(pendingPagedNavigationPosition.contentScrollTop) || 0;
      this.pagedResetScrollOnCommit = false;
      this.pagedScrollToAnchorOnCommit = false;
    }
    this.renderPagedLibrary(renderVersion);
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
    const selectAllByDefault = query.endpoint === 'tracks' && (
      Boolean(query.query) || PAGED_DEFAULT_SELECT_ALL_SCOPE_KEYS.some(key => Boolean(query.scope?.[key]))
    );
    if (!this.pagedController) {
      this.pagedController = new PagedLibraryViewController({
        manager: this.manager,
        runtime: globalThis.electronAPI ? 'electron' : 'web',
        onRowsInvalidated: () => this.deactivatePublishedPagedAttempt(),
        onCacheChange: () => this.refreshPagedWindow?.(),
        onStateChange: state => {
          if (renderVersion > this.renderVersion) return;
          this.pagedState = state;
          if (state.phase === 'committed' && this.pagedAnchorRestoreInProgress) return;
          if (state.phase === 'committed' && this.pagedRestorePending) {
            this.pagedRestorePending = false;
            void this.restorePagedAnchor();
            return;
          }
          this.renderPagedState(state);
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
      this.clearPagedPaginationFailure();
      this.setPagedMobileSelectionActive(false);
      const canRestore = this.pagedAnchor?.queryFingerprint === queryKey;
      const preserveStaleSelection = this.pagedRestartPreservesSelection;
      this.pagedRestartPreservesSelection = false;
      this.pagedAnchorRestoreRequestId += 1;
      this.pagedAnchorRestoreInProgress = false;
      this.pagedQueryKey = queryKey;
      if (!canRestore) {
        this.pagedViewportOrdinal = 0;
        this.pagedViewportOffsetPx = 0;
        this.pagedContentScrollTop = 0;
      }
      this.pagedFocusedOrdinal = 0;
      this.pagedFocusedEntityId = null;
      this.pagedPendingFocusKey = null;
      this.pagedResetScrollOnCommit = !canRestore;
      this.pagedScrollToAnchorOnCommit = false;
      this.pagedRestorePending = canRestore;
      void this.pagedController.start(query, {
        preserveStaleSelection,
        defaultSelectAllLimit: selectAllByDefault ? PAGED_DEFAULT_SELECT_ALL_LIMIT : null
      });
      return;
    }
    this.renderPagedState(this.pagedState ?? this.pagedController.createViewState());
  }

  getPagedQuery() {
    if (this.searchQuery.trim() && PAGED_SEARCH_ENTITY_TYPES.includes(this.searchEntityType)) {
      const preference = this.getEntitySort(this.searchEntityType);
      return {
        endpoint: 'entities',
        entityType: this.searchEntityType,
        query: this.searchQuery.trim(),
        sort: preference.sort,
        direction: preference.direction,
        scope: null
      };
    }
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
      if (this.detail.type === 'folderNode') {
        return {
          endpoint: 'tracks',
          query: '',
          sort: this.sort,
          direction: this.sortDirection,
          scope: this.folderBrowseMode === 'flat'
            ? { folderKey: this.detail.folderId }
            : { folderDirKey: createFolderDirKey(this.detail.folderId, this.detail.path) }
        };
      }
      const scopeKey = this.detail.type === 'playlist' ? 'playlistId' : `${this.detail.type}Key`;
      const useAlbumTrackOrder = this.detail.type === 'album' && !this.detailSortOverride;
      return {
        endpoint: 'tracks',
        query: '',
        sort: useAlbumTrackOrder ? 'album' : this.sort,
        direction: useAlbumTrackOrder ? 'asc' : this.sortDirection,
        scope: { [scopeKey]: this.detail.key }
      };
    }
    const entityType = PAGED_ENTITY_TYPE_BY_VIEW[this.currentView];
    if (entityType) {
      const preference = this.getEntitySort(entityType);
      return {
        endpoint: 'entities',
        entityType,
        query: '',
        sort: preference.sort,
        direction: preference.direction,
        scope: null,
        ...(entityType === 'playlist' ? { includeSystemPlaylists: true } : {})
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

  getEntitySort(entityType) {
    return this.entitySorts?.[entityType] ?? {
      sort: entityType === 'subfolder' ? 'path' : 'name',
      direction: this.sortDirection
    };
  }

  applyEntitySort(entityType, value) {
    const [sort, direction] = String(value || '').split(':');
    const preference = { sort, direction };
    if (!isSupportedEntitySort(entityType, preference)) return false;
    const current = this.getEntitySort(entityType);
    if (current.sort === sort && current.direction === direction) return false;
    this.entitySorts[entityType] = preference;
    this.saveUIState();
    this.render();
    return true;
  }

  renderPagedNav() {
    const nav = this.nav;
    this.updateNav();
    Promise.resolve(this.manager.getCounts()).then(counts => {
      if (this.nav === nav) this.updateNav(counts);
    }).catch(() => {});
  }

  updateNav(counts) {
    if (!this.nav) return;
    let buttons = [...this.nav.querySelectorAll('[data-view]')];
    const hasExpectedButtons = buttons.length === LIBRARY_NAV_VIEWS.length &&
      buttons.every((button, index) => button.dataset.view === LIBRARY_NAV_VIEWS[index]);

    if (!hasExpectedButtons) {
      this.nav.innerHTML = LIBRARY_NAV_VIEWS.map(view => {
        const count = view === 'recent' ? null : counts?.[view];
        const active = this.currentView === view;
        return `<button type="button" class="library-nav-item${active ? ' active' : ''}" data-view="${view}"${active ? ' aria-current="page"' : ''}>
          <span class="library-nav-label">${escapeHtml(this.t(VIEW_LABELS[view]))}</span>
          <span class="library-count"${Number.isSafeInteger(count) ? '' : ' hidden'}>${Number.isSafeInteger(count) ? count : ''}</span>
        </button>`;
      }).join('');
      buttons = [...this.nav.querySelectorAll('[data-view]')];
      buttons.forEach(button => {
        button.addEventListener('click', () => this.navigateToView(button.dataset.view));
      });
    }

    buttons.forEach(button => {
      const view = button.dataset.view;
      const active = this.currentView === view;
      if (active) {
        button.classList.add('active');
        if (button.getAttribute('aria-current') !== 'page') {
          button.setAttribute('aria-current', 'page');
        }
      } else {
        button.classList.remove('active');
        button.removeAttribute('aria-current');
      }

      const label = button.querySelector('.library-nav-label');
      const translatedLabel = this.t(VIEW_LABELS[view]);
      if (label && label.textContent !== translatedLabel) label.textContent = translatedLabel;

      if (counts === undefined) return;
      const count = view === 'recent' ? null : counts?.[view];
      const countElement = button.querySelector('.library-count');
      if (!countElement) return;
      const showCount = Number.isSafeInteger(count);
      countElement.hidden = !showCount;
      const countText = showCount ? String(count) : '';
      if (countElement.textContent !== countText) countElement.textContent = countText;
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

  renderPagedUnavailable(missingMethods) {
    if (!this.content) return;
    this.trackScrollCleanup?.();
    this.trackScrollCleanup = null;
    console.error('Music Library paged service is unavailable:', missingMethods);
    this.content.setAttribute('aria-busy', 'false');
    this.content.innerHTML = `
      <section class="library-paged-error" role="alert">
        <h2>${escapeHtml(this.t('library.title'))}</h2>
        <p>${escapeHtml(this.t('library.paged.serviceUnavailable'))}</p>
      </section>
    `;
  }

  createPagedSearchEntitySections(state, { showEmptyWhenNoResults = false } = {}) {
    const container = document.createElement('div');
    container.className = 'library-paged-search-entities';
    container.setAttribute('aria-live', 'polite');
    const previousContainer = this.content?.querySelector?.('.library-paged-search-entities');
    const previousChildren = previousContainer && !previousContainer.hidden
      ? [...(previousContainer.childNodes ?? previousContainer.children ?? [])]
      : [];
    if (previousChildren.length > 0) {
      container.replaceChildren(...previousChildren);
      container.pagedSearchEntitySignature = previousContainer.pagedSearchEntitySignature ?? null;
    }
    void this.loadPagedSearchEntitySections(container, state, { showEmptyWhenNoResults });
    return container;
  }

  refreshPagedSearchEntitySections(state, { showEmptyWhenNoResults = false } = {}) {
    const container = this.content?.querySelector?.('.library-paged-search-entities');
    if (!container) return null;
    return this.loadPagedSearchEntitySections(container, state, { showEmptyWhenNoResults });
  }

  loadPagedSearchEntitySections(container, state, { showEmptyWhenNoResults = false } = {}) {
    const query = this.searchQuery.trim();
    const load = () => {
      container.setAttribute('aria-busy', 'true');
      container.inert = true;
      container.setAttribute('aria-hidden', 'true');
      return this.loadPagedSearchEntities(query).then(groups => {
        if (!this.isCurrentPagedAttempt(state) || this.searchQuery.trim() !== query) return;
        container.setAttribute('aria-busy', 'false');
        container.inert = false;
        container.removeAttribute?.('aria-hidden');
        const visibleGroups = groups.filter(group => group.rows.length > 0);
        const mode = showEmptyWhenNoResults && groups.failedCount > 0
          ? 'error'
          : visibleGroups.length > 0
            ? 'groups'
            : showEmptyWhenNoResults ? 'empty' : 'hidden';
        const signature = mode === 'groups'
          ? JSON.stringify(['groups', visibleGroups.map(group => [group.entityType, group.rows])])
          : mode === 'empty' ? JSON.stringify(['empty', query]) : mode;
        if (container.pagedSearchEntitySignature === signature) {
          container.hidden = mode === 'hidden';
          return;
        }
        if (showEmptyWhenNoResults && groups.failedCount > 0) {
          const failure = document.createElement('section');
          failure.className = 'library-paged-error library-paged-search-error';
          failure.setAttribute('role', 'alert');
          failure.innerHTML = `
            <p>${escapeHtml(this.t('library.paged.loadFailed'))}</p>
            <button type="button" class="library-button library-paged-search-retry">${escapeHtml(this.t('library.paged.retry'))}</button>
          `;
          failure.querySelector('.library-paged-search-retry')?.addEventListener('click', () => {
            void load();
          });
          container.replaceChildren(failure);
          container.hidden = false;
          container.pagedSearchEntitySignature = signature;
          return;
        }
        if (!visibleGroups.length) {
          if (showEmptyWhenNoResults) {
            container.replaceChildren(this.createPagedEmptyState());
            container.hidden = false;
          } else {
            container.replaceChildren();
            container.hidden = true;
          }
          container.pagedSearchEntitySignature = signature;
          return;
        }
        const fragment = document.createDocumentFragment?.() ?? document.createElement('div');
        for (const group of visibleGroups) {
          const section = document.createElement('section');
          section.className = 'library-search-section';
          const header = document.createElement('div');
          header.className = 'library-search-section-head';
          const heading = document.createElement('h3');
          heading.textContent = this.t(VIEW_LABELS[DETAIL_VIEW_BY_TYPE[group.entityType]]);
          const showAll = document.createElement('button');
          showAll.type = 'button';
          showAll.className = 'library-button library-search-show-all';
          showAll.textContent = this.t('library.search.showAll');
          showAll.addEventListener('click', () => this.navigateToSearchEntityResults(group.entityType));
          header.appendChild(heading);
          header.appendChild(showAll);
          section.appendChild(header);
          const list = document.createElement('div');
          list.className = 'library-simple-list library-search-entity-list';
          for (const item of group.rows) {
            const entityId = this.getPagedEntityId(item);
            if (!entityId) continue;
            const title = item.name || item.displayName || entityId;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'library-simple-row';
            button.innerHTML = `<span>${escapeHtml(title)}</span><span>${escapeHtml(this.getPagedEntityCaption(item, group.entityType))}</span>`;
            button.addEventListener('click', () => this.navigateToDetail({
              type: group.entityType,
              key: entityId,
              title,
              ...(typeof item.representativeTrackUid === 'string'
                ? { representativeTrackUid: item.representativeTrackUid }
                : {})
            }));
            list.appendChild(button);
          }
          section.appendChild(list);
          fragment.appendChild(section);
        }
        container.replaceChildren(fragment);
        container.hidden = false;
        container.pagedSearchEntitySignature = signature;
      }).catch(error => {
        if (!this.isCurrentPagedAttempt(state) || this.searchQuery.trim() !== query) return;
        console.warn('Unable to load Music Library entity search results:', error);
        container.setAttribute('aria-busy', 'false');
        container.inert = false;
        container.removeAttribute?.('aria-hidden');
        container.replaceChildren();
        container.hidden = true;
      });
    };
    return load();
  }

  createPagedEmptyState() {
    const query = this.getPagedQuery();
    const isSearch = Boolean(this.searchQuery.trim());
    let scope = 'collection';
    let message = this.t('library.state.empty');
    let withAction = false;

    if (isSearch) {
      scope = 'search';
      message = this.t('library.state.noResults', { query: this.searchQuery.trim() });
    } else if (this.detail?.type === 'playlist') {
      scope = 'playlist';
      message = this.t('library.state.noResolvedTracks');
    } else if (query.endpoint === 'entities' && query.entityType === 'playlist') {
      scope = 'playlists';
      message = this.t('library.state.noPlaylists');
    } else if (query.endpoint === 'entities' && query.entityType === 'subfolder') {
      scope = 'subfolders';
      message = this.t('library.state.noSubfolders');
    } else if (!this.detail && ['tracks', 'folders', 'recent'].includes(this.currentView)) {
      scope = 'library';
      withAction = true;
    }

    const empty = this.emptyState(message, withAction);
    empty.classList?.add?.('library-paged-empty');
    empty.dataset.emptyScope = scope;
    return empty;
  }

  async loadPagedSearchEntities(query) {
    const settled = await Promise.allSettled(PAGED_SEARCH_ENTITY_TYPES.map(async entityType => {
      let contextToken = null;
      try {
        const page = await this.manager.queryEntities({
          type: entityType,
          query,
          sort: 'name',
          direction: 'asc',
          scope: null,
          cursor: null
        });
        contextToken = page?.contextToken ?? null;
        return { entityType, rows: Array.isArray(page?.rows) ? page.rows : [] };
      } finally {
        if (contextToken) {
          await Promise.resolve(this.manager.releaseContext(contextToken)).catch(error => {
            console.warn('Unable to release a Music Library search context:', error);
          });
        }
      }
    }));
    const groups = [];
    let failedCount = 0;
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        groups.push(result.value);
      } else {
        failedCount += 1;
        console.warn(`Unable to load Music Library ${PAGED_SEARCH_ENTITY_TYPES[index]} search results:`, result.reason);
      }
    });
    Object.defineProperty(groups, 'failedCount', { value: failedCount, enumerable: false });
    return groups;
  }

  markPagedRowsInert() {
    if (!this.content) return;
    const activeElement = globalThis.document?.activeElement;
    let invalidatedFocus = false;
    this.content.querySelectorAll?.('.library-paged-row').forEach(row => {
      if (activeElement && row.contains?.(activeElement)) invalidatedFocus = true;
      row.inert = true;
      row.setAttribute('aria-hidden', 'true');
      row.setAttribute('aria-disabled', 'true');
    });
    if (invalidatedFocus) {
      this.pagedFocusParked = true;
      this.focusWithoutContentScroll(this.content);
    } else if (activeElement !== this.content) {
      this.pagedFocusParked = false;
    }
  }

  deactivatePublishedPagedAttempt() {
    const publishedAttempt = this.content?.querySelector?.('.library-paged-attempt');
    if (!publishedAttempt) return;
    publishedAttempt.inert = true;
    publishedAttempt.setAttribute('aria-disabled', 'true');
    if (publishedAttempt.contains?.(globalThis.document?.activeElement)) {
      this.pagedFocusParked = true;
      this.focusWithoutContentScroll(this.content);
    }
  }

  async restorePagedAnchor() {
    const anchor = this.pagedAnchor;
    const controller = this.pagedController;
    const queryKey = this.pagedQueryKey;
    const intentId = this.navigationIntentId;
    const restoreRequestId = ++this.pagedAnchorRestoreRequestId;
    this.pagedAnchorRestoreInProgress = true;
    let result;
    try {
      result = await controller?.restoreAnchor(anchor);
    } catch (error) {
      if (
        restoreRequestId !== this.pagedAnchorRestoreRequestId ||
        controller !== this.pagedController ||
        queryKey !== this.pagedQueryKey ||
        !this.isNavigationIntentCurrent(intentId)
      ) {
        return { accepted: false, reason: 'stale-page' };
      }
      this.pagedAnchorRestoreInProgress = false;
      if (this.handlePagedSnapshotExpiry(error)) {
        return { accepted: false, reason: 'snapshot-expired', error };
      }
      console.error('Music Library position restore failed:', error);
      result = { accepted: false, reason: 'restore-failed', error };
    }
    if (
      restoreRequestId !== this.pagedAnchorRestoreRequestId ||
      controller !== this.pagedController ||
      queryKey !== this.pagedQueryKey ||
      !this.isNavigationIntentCurrent(intentId)
    ) {
      return { accepted: false, reason: 'stale-page' };
    }
    this.pagedAnchorRestoreInProgress = false;
    if (!result?.accepted) {
      if (result?.reason === 'query-mismatch') {
        this.pagedViewportOrdinal = 0;
        this.pagedViewportOffsetPx = 0;
        this.pagedContentScrollTop = 0;
        this.pagedResetScrollOnCommit = true;
      }
      const state = controller?.createViewState();
      if (state?.phase === 'committed') this.renderPagedCommitted(state);
      return result;
    }
    if (Number.isSafeInteger(result.ordinal)) this.pagedViewportOrdinal = result.ordinal;
    this.pagedViewportOffsetPx = Number(result.viewportOffsetPx) || 0;
    this.pagedScrollToAnchorOnCommit = false;
    this.pagedPendingFocusKey = result.focusKey ?? null;
    this.renderPagedCommitted(controller.createViewState());
    if (this.pagedPendingEntityJump) {
      const jump = this.pagedPendingEntityJump;
      this.pagedPendingEntityJump = null;
      void this.jumpPagedToEntity(jump.entityKind, jump.entityId);
    }
    return result;
  }

  isCurrentPagedAttempt(state) {
    if (!state || !this.pagedController?.firstPage) return false;
    return this.pagedController.firstPage.isCurrent(
      state.queryGeneration,
      state.pageAttemptId
    );
  }

  getPagedResultTypeLabel() {
    const query = this.getPagedQuery();
    if (query.endpoint === 'tracks') return this.t('library.status.tracks');
    const view = DETAIL_VIEW_BY_TYPE[query.entityType];
    return view && VIEW_LABELS[view] ? this.t(VIEW_LABELS[view]) : '';
  }

  getPagedCountStatusText(state, totalCount, fallbackLabel = '') {
    if (this.detail?.type === 'playlist' &&
        Number.isSafeInteger(state.resolvedCount) && Number.isSafeInteger(state.unresolvedCount)) {
      return `${state.resolvedCount} ${this.t('library.status.tracks')}${state.unresolvedCount
        ? ` · ${state.unresolvedCount} ${this.t('library.status.unresolved')}`
        : ''}`;
    }
    return `${totalCount ?? '…'} ${fallbackLabel}`.trim();
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
        ? this.getPagedCountStatusText(state, state.totalCount, this.getPagedResultTypeLabel())
        : state.liveAnnouncement || '';
      this.pagedPublishedAnnouncementIds.clear();
      this.pagedPublishedAnnouncementIds.add(announcementId);
    }
    shell.appendChild(live);
    return shell;
  }

  replacePagedAttemptChildren(currentShell, replacementShell) {
    const currentChildren = [...(currentShell.children ?? [])];
    const replacementChildren = [...(replacementShell.children ?? [])];
    if (currentChildren.some(child => typeof child.replaceWith !== 'function')) {
      currentShell.replaceChildren(...replacementChildren);
      return;
    }
    const sharedLength = Math.min(currentChildren.length, replacementChildren.length);
    for (let index = 0; index < sharedLength; index += 1) {
      currentChildren[index].replaceWith(replacementChildren[index]);
    }
    for (let index = sharedLength; index < replacementChildren.length; index += 1) {
      currentShell.appendChild(replacementChildren[index]);
    }
    for (let index = sharedLength; index < currentChildren.length; index += 1) {
      removeElement(currentChildren[index]);
    }
  }

  publishPagedAttemptDom(state, shell) {
    if (!this.isCurrentPagedAttempt(state)) return false;
    this.content.setAttribute('aria-busy', state.ariaBusy ? 'true' : 'false');
    this.content.removeAttribute?.('aria-rowcount');
    const currentShell = state.phase === 'committed' && this.pagedPublishedPhase === 'committed' &&
      this.pagedPublishedSearchQuery && this.searchQuery.trim()
      ? this.content.querySelector?.('.library-paged-attempt')
      : null;
    if (currentShell && currentShell !== shell) {
      this.replacePagedAttemptChildren(currentShell, shell);
      currentShell.dataset.queryGeneration = String(state.queryGeneration);
      currentShell.dataset.pageAttemptId = String(state.pageAttemptId);
      currentShell.inert = false;
      currentShell.removeAttribute?.('aria-disabled');
    } else {
      this.content.replaceChildren(shell);
    }
    this.pagedPublishedPhase = state.phase ?? null;
    if (state.phase !== 'committed') {
      this.pagedPublishedState = null;
      this.pagedPublishedResultSignature = null;
      this.pagedPublishedSearchQuery = '';
    }
    this.syncContentScrollbarInset();
    return true;
  }

  announcePagedStatus(message) {
    const live = this.content?.querySelector?.('.library-paged-live');
    if (live) live.textContent = String(message || '');
  }

  renderPagedState(state) {
    if (!this.content || !state || !this.isCurrentPagedAttempt(state)) return;
    const preservesCommittedDom = state.phase === 'loading' && this.pagedPublishedPhase === 'committed';
    if (preservesCommittedDom) {
      this.pausePagedWindowRendering?.();
    } else if (state.phase !== 'committed') {
      this.trackScrollCleanup?.();
      this.trackScrollCleanup = null;
    }
    if (state.phase === 'loading') {
      this.content.setAttribute('aria-busy', 'true');
      if (this.pagedPublishedPhase === 'committed') {
        this.deactivatePublishedPagedAttempt();
        return;
      }
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
        this.runLibraryCommand(() => this.pagedController.retry(), {
          logMessage: 'Music Library page retry failed:'
        });
      });
      if (this.pagedFocusParked && globalThis.document?.activeElement === this.content &&
          this.isCurrentPagedAttempt(state)) this.focusWithoutContentScroll(retry);
      return;
    }
    if (state.phase !== 'committed') return;
    this.renderPagedCommitted(state);
  }

  createPagedCommittedSearchSignature(state) {
    const query = this.getPagedQuery();
    const searchQuery = this.searchQuery.trim();
    if (query.endpoint !== 'tracks' || !searchQuery || !Array.isArray(state?.rows) ||
        state.rows.length === 0 || !Number.isSafeInteger(state.totalCount) ||
        (state.pageStartOrdinal ?? 0) !== 0) return null;
    try {
      return JSON.stringify({
        sort: query.sort,
        direction: query.direction,
        scope: query.scope,
        totalCount: state.totalCount,
        currentPageIndex: state.currentPageIndex ?? 0,
        hasNextPage: Boolean(state.nextCursor),
        hasPreviousPage: Boolean(state.previousCursor),
        rows: state.rows
      });
    } catch (_) {
      return null;
    }
  }

  reusePagedCommittedSearchDom(state) {
    const signature = this.createPagedCommittedSearchSignature(state);
    const publishedState = this.pagedPublishedState;
    const searchQuery = this.searchQuery.trim();
    if (!signature || signature !== this.pagedPublishedResultSignature || !publishedState ||
        typeof this.trackScrollCleanup !== 'function' || typeof this.refreshPagedWindow !== 'function' ||
        searchQuery === this.pagedPublishedSearchQuery ||
        (publishedState.queryGeneration === state.queryGeneration &&
          publishedState.pageAttemptId === state.pageAttemptId)) return false;

    const shell = this.content?.querySelector?.('.library-paged-attempt');
    if (!shell) return false;

    for (const key of Object.keys(publishedState)) {
      if (!(key in state)) delete publishedState[key];
    }
    Object.assign(publishedState, state);
    const generation = String(state.queryGeneration);
    const attempt = String(state.pageAttemptId);
    shell.dataset.queryGeneration = generation;
    shell.dataset.pageAttemptId = attempt;
    shell.inert = false;
    shell.removeAttribute?.('aria-disabled');

    const renderedRows = [...(this.content.querySelectorAll?.('.library-paged-row') ?? [])];
    for (const element of this.content.querySelectorAll?.('.library-paged-grid, .library-paged-row') ?? []) {
      element.dataset.queryGeneration = generation;
      element.dataset.pageAttemptId = attempt;
    }
    for (const row of renderedRows) {
      row.inert = false;
      row.removeAttribute?.('aria-hidden');
      row.removeAttribute?.('aria-disabled');
    }

    if (!this.pagedFocusedEntityId && renderedRows.length > 0) {
      this.pagedFocusedOrdinal = Number(renderedRows[0].dataset.ordinal) || 0;
      this.pagedFocusedEntityId = renderedRows[0].dataset.entityId || null;
      renderedRows.forEach((row, index) => { row.tabIndex = index === 0 ? 0 : -1; });
    }
    this.renderedPageTrackIds = renderedRows.map(row => row.dataset.entityId).filter(Boolean);
    this.content.setAttribute('aria-busy', 'false');
    this.content.removeAttribute?.('aria-rowcount');
    this.pagedPublishedPhase = 'committed';
    this.pagedPublishedSearchQuery = searchQuery;
    this.refreshPagedSelectionState();

    const announcementId = state.liveAnnouncementId;
    if (announcementId && !this.pagedPublishedAnnouncementIds.has(announcementId)) {
      this.announcePagedStatus(this.getPagedCountStatusText(
        state,
        state.totalCount,
        this.getPagedResultTypeLabel()
      ));
      this.pagedPublishedAnnouncementIds.clear();
      this.pagedPublishedAnnouncementIds.add(announcementId);
    }

    const previousScrollTop = Number(this.content.scrollTop) || 0;
    if (this.pagedResetScrollOnCommit) {
      this.content.scrollTop = 0;
      this.pagedContentScrollTop = 0;
      if (previousScrollTop !== 0) this.refreshPagedWindow?.();
    }
    this.pagedResetScrollOnCommit = false;
    this.pagedScrollToAnchorOnCommit = false;
    this.refreshPagedSearchEntitySections(state, { showEmptyWhenNoResults: false });
    this.syncContentScrollbarInset();
    return true;
  }

  renderPagedCommitted(state) {
    if (!this.isCurrentPagedAttempt(state)) return;
    if (this.reusePagedCommittedSearchDom(state)) return;
    this.refreshPagedMobileSelectionMode();
    this.trackScrollCleanup?.();
    this.trackScrollCleanup = null;
    this.preparePagedArtworkLoader(state);
    const rows = state.rows;
    const totalCount = Number.isSafeInteger(state.totalCount) ? state.totalCount : null;
    const pagedQuery = this.getPagedQuery();
    const isTrackQuery = pagedQuery.endpoint === 'tracks';
    const isFolderTreeBrowse = this.isFolderTreeBrowse();
    const currentPageStart = Number.isSafeInteger(state.pageStartOrdinal)
      ? state.pageStartOrdinal
      : state.currentPageIndex * this.pagedController.pageLimit;
    const logicalCount = totalCount ?? Math.max(
      currentPageStart + rows.length,
      currentPageStart + (state.nextCursor ? this.pagedController.pageLimit * 2 : rows.length)
    );
    const hasNoTrackSearchResults = isTrackQuery && Boolean(this.searchQuery.trim()) && logicalCount === 0;
    if (logicalCount > 0) {
      this.pagedViewportOrdinal = Math.max(0, Math.min(logicalCount - 1, this.pagedViewportOrdinal));
    } else {
      this.pagedViewportOrdinal = 0;
    }
    const shell = this.createPagedAttemptShell(state);
    shell.appendChild(this.createPagedSectionHeader(state, totalCount, isTrackQuery));
    if (isFolderTreeBrowse) {
      shell.appendChild(this.createFolderDirectorySection(logicalCount));
      const tracksHeading = document.createElement('h3');
      tracksHeading.className = 'library-folder-tracks-heading';
      tracksHeading.textContent = this.t('library.browse.tracksInFolder');
      shell.appendChild(tracksHeading);
    }
    if (this.searchQuery.trim() && isTrackQuery) {
      shell.appendChild(this.createPagedSearchEntitySections(state, {
        showEmptyWhenNoResults: logicalCount === 0
      }));
    }
    const isPlaylistCollection = this.currentView === 'playlists' && !this.detail &&
      !this.searchEntityType && !this.searchQuery.trim();
    if (isPlaylistCollection) {
      shell.appendChild(this.createPagedPlaylistCollectionControls());
    }
    if (this.detail?.type === 'playlist') {
      shell.appendChild(this.createPagedPlaylistControls());
    }
    if (isTrackQuery && !hasNoTrackSearchResults) shell.appendChild(this.createPagedActionBar(state));
    const actionToast = this.createPagedActionToast();
    if (actionToast) shell.appendChild(actionToast);
    const hasTrackSort = isTrackQuery && this.detail?.type !== 'playlist' && !(
      this.currentView === 'recent' && !this.searchQuery.trim() && !this.detail
    );
    if (logicalCount === 0 && !(this.searchQuery.trim() && isTrackQuery) && !isFolderTreeBrowse) {
      shell.appendChild(this.createPagedEmptyState());
    }
    const hasTrackHeader = hasTrackSort && !hasNoTrackSearchResults && !isMobileLayout();
    const gridRoot = isTrackQuery ? document.createElement('div') : null;
    if (gridRoot) {
      gridRoot.className = 'library-paged-semantic-grid';
      gridRoot.setAttribute('role', 'grid');
      gridRoot.setAttribute('aria-multiselectable', 'true');
      gridRoot.setAttribute('aria-rowcount', String(
        totalCount === null ? -1 : totalCount + (hasTrackHeader ? 1 : 0)
      ));
      if (hasTrackHeader) gridRoot.appendChild(this.createPagedTrackHeader());
    }
    const grid = document.createElement('div');
    grid.className = `library-paged-grid ${isTrackQuery ? 'library-paged-tracks' : 'library-paged-entities'}${this.detail?.type === 'playlist' ? ' library-paged-playlist-items' : ''}`;
    grid.setAttribute('role', isTrackQuery ? 'presentation' : 'list');
    grid.dataset.queryGeneration = String(state.queryGeneration);
    grid.dataset.pageAttemptId = String(state.pageAttemptId);
    const rowHeight = this.getTrackRowHeight();
    const listGeometry = isTrackQuery
      ? new SegmentedVirtualListGeometry({ rowCount: logicalCount, rowHeight })
      : null;
    const gridContainerWidth = Math.max(
      PAGED_GRID_MIN_CARD_WIDTH_PX,
      this.content.clientWidth || this.root?.clientWidth || PAGED_GRID_MIN_CARD_WIDTH_PX
    );
    const gridColumns = Math.max(1, Math.min(
      PAGED_GRID_MAX_COLUMNS,
      Math.floor(
        (gridContainerWidth + PAGED_GRID_GAP_PX) /
        (PAGED_GRID_MIN_CARD_WIDTH_PX + PAGED_GRID_GAP_PX)
      )
    ));
    const gridCardWidth = (
      gridContainerWidth - PAGED_GRID_GAP_PX * (gridColumns - 1)
    ) / gridColumns;
    const baseGridRowHeight = isMobileLayout() ? 196 : 224;
    const gridRowHeight = PAGED_CARD_SCOPE_KEYS[pagedQuery.entityType]
      ? Math.max(
          baseGridRowHeight,
          Math.ceil(
            gridCardWidth + PAGED_MEDIA_CARD_VERTICAL_CHROME_PX + PAGED_GRID_GAP_PX
          )
        )
      : baseGridRowHeight;
    const gridGeometry = isTrackQuery || logicalCount === 0
      ? null
      : new SegmentedVirtualGridGeometry({
          itemCount: logicalCount,
          containerWidth: gridContainerWidth,
          minimumCardWidth: PAGED_GRID_MIN_CARD_WIDTH_PX,
          columnGap: PAGED_GRID_GAP_PX,
          rowHeight: gridRowHeight,
          maximumColumns: PAGED_GRID_MAX_COLUMNS
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
    if (isTrackQuery) rowLayer.setAttribute('role', 'rowgroup');
    grid.appendChild(rowLayer);
    if (gridRoot) {
      gridRoot.appendChild(grid);
      shell.appendChild(gridRoot);
    } else {
      shell.appendChild(grid);
    }
    let active = true;
    let rendering = false;
    let renderScheduled = false;
    let renderFrameId = null;
    let renderTimerId = null;
    let preparedRangeKey = null;
    let renderedTrackRangeKey = null;
    let renderedTrackRows = new Map();
    let previousFirstVisibleOrdinal = this.pagedViewportOrdinal;
    let scrollDirection = 1;
    const renderWindow = ({ preparing = false, physicalScrollTopOverride = null } = {}) => {
      if (!active || rendering || !segmentWindow || !scrollGeometry ||
          !this.isCurrentPagedAttempt(state) || this.pagedState?.phase !== 'committed') return;
      rendering = true;
      if (logicalCount === 0) {
        this.renderedPageTrackIds = [];
        if (preparing || preparedRangeKey !== 'empty') {
          rowLayer.replaceChildren();
        }
        renderedTrackRows.clear();
        renderedTrackRangeKey = 'empty';
        preparedRangeKey = preparing ? 'empty' : null;
        rendering = false;
        return;
      }
      let physicalScrollTop = Number.isFinite(physicalScrollTopOverride)
        ? Math.max(0, physicalScrollTopOverride)
        : Math.max(0, (this.content.scrollTop || 0) - (grid.offsetTop || 0));
      const rebased = scrollGeometry.rebaseWindow({
        window: segmentWindow,
        scrollTop: physicalScrollTop,
        viewportHeight: this.content.clientHeight || rowHeight * 12
      });
      if (rebased.changed) {
        segmentWindow = rebased.window;
        grid.style.height = `${segmentWindow.heightPx}px`;
        physicalScrollTop = rebased.scrollTop;
        if (!preparing) this.content.scrollTop = (grid.offsetTop || 0) + physicalScrollTop;
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
      if (range.firstVisibleOrdinal !== previousFirstVisibleOrdinal) {
        scrollDirection = range.firstVisibleOrdinal < previousFirstVisibleOrdinal ? -1 : 1;
        previousFirstVisibleOrdinal = range.firstVisibleOrdinal;
      }
      this.pagedViewportOrdinal = range.firstVisibleOrdinal;
      if (!preparing) {
        const activeRow = globalThis.document?.activeElement?.closest?.('.library-paged-row');
        if (activeRow && rowLayer.contains?.(activeRow) &&
            activeRow.dataset.queryGeneration === String(state.queryGeneration) &&
            activeRow.dataset.pageAttemptId === String(state.pageAttemptId)) {
          this.pagedPendingFocusKey = activeRow.dataset.entityId || null;
        }
      }
      const cachedRows = this.pagedController.getCachedRows(range.startOrdinal, range.endOrdinal);
      const cachedOrdinals = new Set(cachedRows.map(({ ordinal }) => ordinal));
      let missingOrdinal = null;
      for (let ordinal = range.startOrdinal; ordinal < range.endOrdinal; ordinal += 1) {
        if (!cachedOrdinals.has(ordinal)) {
          missingOrdinal = ordinal;
          break;
        }
      }
      const focusedEntityIsRendered = cachedRows.some(({ row }) => (
        (isTrackQuery ? this.getPagedTrackIdentity(row) : this.getPagedEntityId(row)) === this.pagedFocusedEntityId
      ));
      const needsRenderedRovingTarget = !this.pagedPendingFocusKey && !focusedEntityIsRendered;
      if (cachedRows.length && (!this.pagedFocusedEntityId || needsRenderedRovingTarget)) {
        this.pagedFocusedOrdinal = cachedRows[0].ordinal;
        this.pagedFocusedEntityId = isTrackQuery
          ? this.getPagedTrackIdentity(cachedRows[0].row)
          : this.getPagedEntityId(cachedRows[0].row);
      }
      this.renderedPageTrackIds = isTrackQuery
        ? cachedRows.map(({ row }) => this.getPagedTrackIdentity(row)).filter(Boolean)
        : [];
      const rangeKey = `${segmentWindow.startOrdinal}:${range.startOrdinal}:${range.endOrdinal}`;
      const reusingPreparedRows = !preparing && preparedRangeKey === rangeKey;
      const trackRowsUnchanged = isTrackQuery && renderedTrackRangeKey === rangeKey &&
        cachedRows.length === renderedTrackRows.size &&
        cachedRows.every(({ ordinal, row }) => renderedTrackRows.get(ordinal)?._pagedItem === row);
      if (isTrackQuery && !trackRowsUnchanged) {
        const nextRows = new Map();
        const elements = [];
        for (const { ordinal, row } of cachedRows) {
          let element = renderedTrackRows.get(ordinal);
          if (element?._pagedItem !== row) {
            element = this.createPagedRow(row, ordinal, state, true, {
              rowIndexOffset: hasTrackHeader ? 1 : 0
            });
          }
          element.style.position = 'absolute';
          element.style.top = `${(ordinal - segmentWindow.startOrdinal) * rowHeight}px`;
          element.style.height = `${rowHeight}px`;
          element.tabIndex = this.getPagedTrackIdentity(row) === this.pagedFocusedEntityId ? 0 : -1;
          nextRows.set(ordinal, element);
          elements.push(element);
        }
        rowLayer.replaceChildren(...elements);
        renderedTrackRows = nextRows;
        renderedTrackRangeKey = rangeKey;
      } else if (!isTrackQuery && !reusingPreparedRows) {
        if (!preparing) this.markPagedRowsInert();
        this.pagedArtworkLoader?.resetTargets();
        rowLayer.replaceChildren();
        for (const { ordinal, row } of cachedRows) {
          const element = this.createPagedRow(row, ordinal, state, isTrackQuery, {
            rowIndexOffset: hasTrackHeader ? 1 : 0
          });
          element.style.position = 'absolute';
          const layout = gridGeometry.getItemLayout(ordinal, segmentWindow);
          element.style.top = `${layout.topPx}px`;
          element.style.left = layout.leftOffsetPx === 0
            ? `${layout.leftPercent}%`
            : `calc(${layout.leftPercent}% + ${layout.leftOffsetPx}px)`;
          element.style.width = layout.widthReductionPx === 0
            ? `${layout.widthPercent}%`
            : `calc(${layout.widthPercent}% - ${layout.widthReductionPx}px)`;
          element.style.height = `${gridGeometry.rowHeight}px`;
          rowLayer.appendChild(element);
        }
      }
      preparedRangeKey = preparing ? rangeKey : null;
      if (!preparing && this.pagedPendingFocusKey) {
        const focusRow = [...rowLayer.querySelectorAll?.('.library-paged-row') || []].find(row => (
          row.dataset.entityId === this.pagedPendingFocusKey
        ));
        if (focusRow) {
          this.pagedPendingFocusKey = null;
          const focusTarget = isTrackQuery
            ? focusRow
            : focusRow.querySelector?.('.library-paged-entity-open, .library-paged-folder-main');
          focusTarget?.focus?.({ preventScroll: true });
        }
      }
      if (!preparing) {
        this.capturePagedAnchorFromOrdinal(
          range.firstVisibleOrdinal,
          segmentWindow,
          isTrackQuery,
          gridGeometry,
          grid.offsetTop || 0,
          this.content.scrollTop || 0
        );
        this.pagedContentScrollTop = Number(this.content.scrollTop) || 0;
      }
      rendering = false;
      if (preparing) return;
      if (missingOrdinal !== null) {
        void this.ensurePagedOrdinal(missingOrdinal);
      } else if (isTrackQuery && isMobileLayout() &&
          typeof this.pagedController.prefetchAroundOrdinal === 'function') {
        void this.pagedController.prefetchAroundOrdinal(range.firstVisibleOrdinal, {
          direction: scrollDirection,
          pageCount: PAGED_MOBILE_READ_AHEAD_PAGES
        }).then(result => {
          if (result?.prefetched) scheduleWindowRender();
        }, error => {
          console.warn('Music Library read-ahead failed:', error);
        });
      }
    };
    const scheduleWindowRender = () => {
      this.pagedContentScrollTop = Number(this.content?.scrollTop) || 0;
      if (renderScheduled) return;
      renderScheduled = true;
      const run = () => {
        renderFrameId = null;
        renderTimerId = null;
        renderScheduled = false;
        renderWindow();
      };
      if (typeof requestAnimationFrame === 'function') renderFrameId = requestAnimationFrame(run);
      else renderTimerId = setTimeout(run, 0);
    };
    const pauseWindowRendering = () => {
      if (renderFrameId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(renderFrameId);
      }
      if (renderTimerId !== null) clearTimeout(renderTimerId);
      renderFrameId = null;
      renderTimerId = null;
      renderScheduled = false;
    };
    const refreshWindow = () => renderWindow();
    const onResize = () => {
      this.pagedContentScrollTop = Number(this.content?.scrollTop) || 0;
      clearTimeout(this.pagedResizeTimer);
      this.pagedResizeTimer = setTimeout(() => {
        this.pagedResizeTimer = null;
        if (this.pagedState?.phase !== 'committed') return;
        this.renderPagedCommitted(this.pagedState);
      }, 100);
    };
    const initialRowOrdinal = isTrackQuery
      ? this.pagedViewportOrdinal
      : Math.floor(this.pagedViewportOrdinal / (gridGeometry?.columns ?? 1));
    const initialRowHeight = isTrackQuery ? rowHeight : gridGeometry?.rowHeight ?? rowHeight;
    const initialPhysicalScrollTop = Math.max(
      0,
      ((initialRowOrdinal - segmentWindow.startOrdinal) * initialRowHeight) -
        this.pagedViewportOffsetPx
    );
    const preparationPhysicalScrollTop = this.pagedResetScrollOnCommit
      ? 0
      : initialPhysicalScrollTop;
    renderWindow({ preparing: true, physicalScrollTopOverride: preparationPhysicalScrollTop });
    if (!this.publishPagedAttemptDom(state, shell)) {
      this.trackScrollCleanup?.();
      this.trackScrollCleanup = null;
      return;
    }
    this.focusPendingFolderRow(this.content.querySelector?.('.library-folder-directory-section'));
    this.pagedPublishedState = state;
    this.pagedPublishedResultSignature = this.createPagedCommittedSearchSignature(state);
    this.pagedPublishedSearchQuery = this.searchQuery.trim();
    const initialScrollTop = Math.max(0, (grid.offsetTop || 0) + initialPhysicalScrollTop);
    const navigationRestorePosition =
      this.pagedNavigationRestorePosition?.queryFingerprint === this.pagedQueryKey
        ? this.pagedNavigationRestorePosition
        : null;
    const navigationScrollTop = Number(navigationRestorePosition?.contentScrollTop);
    const hasNavigationScrollTop = Number.isFinite(navigationScrollTop);
    let targetScrollTop = this.pagedContentScrollTop;
    if (this.pagedResetScrollOnCommit) targetScrollTop = 0;
    else if (hasNavigationScrollTop) targetScrollTop = Math.max(0, navigationScrollTop);
    else if (this.pagedScrollToAnchorOnCommit) targetScrollTop = initialScrollTop;
    this.content.scrollTop = targetScrollTop;
    this.pagedContentScrollTop = Number(this.content.scrollTop) || 0;
    this.pagedResetScrollOnCommit = false;
    this.pagedScrollToAnchorOnCommit = false;
    renderWindow();
    if (navigationRestorePosition) {
      const maximumScrollTop = Math.max(
        0,
        (Number(this.content.scrollHeight) || 0) - (Number(this.content.clientHeight) || 0)
      );
      if (Math.abs(this.content.scrollTop - Math.min(targetScrollTop, maximumScrollTop)) < 1) {
        this.pagedNavigationRestorePosition = null;
      }
    }
    // Attach observers only after the replacement DOM has its final scroll position.
    // Otherwise the transient scroll event caused by replacing a shorter detail view
    // can overwrite the retained collection position before it is restored.
    this.pausePagedWindowRendering = pauseWindowRendering;
    this.refreshPagedWindow = refreshWindow;
    this.content.addEventListener?.('scroll', scheduleWindowRender, { passive: true });
    globalThis.window?.addEventListener?.('resize', onResize);
    this.trackScrollCleanup = () => {
      active = false;
      this.content?.removeEventListener?.('scroll', scheduleWindowRender);
      globalThis.window?.removeEventListener?.('resize', onResize);
      pauseWindowRendering();
      clearTimeout(this.pagedResizeTimer);
      this.pagedResizeTimer = null;
      if (this.pausePagedWindowRendering === pauseWindowRendering) {
        this.pausePagedWindowRendering = null;
      }
      if (this.refreshPagedWindow === refreshWindow) this.refreshPagedWindow = null;
    };
  }

  createPagedSectionHeader(state, totalCount, isTrackQuery) {
    const hasDetailArtwork = PAGED_ARTWORK_DETAIL_TYPES.includes(this.detail?.type);
    const statusText = this.getPagedCountStatusText(
      state,
      totalCount,
      isTrackQuery ? this.t('library.status.tracks') : ''
    );
    const header = document.createElement('div');
    header.className = hasDetailArtwork
      ? 'library-detail-head library-paged-detail-head'
      : 'library-section-head';
    if (hasDetailArtwork) {
      header.innerHTML = `
        <button type="button" class="library-icon-button library-back" title="${escapeHtml(this.t('library.paged.previous'))}" aria-label="${escapeHtml(this.t('library.paged.previous'))}">${ICONS.back}</button>
        <div class="library-paged-artwork library-paged-detail-artwork" aria-hidden="true"><span></span></div>
        <div>
          <h2>${escapeHtml(this.getPagedTitle())}</h2>
          <p>${totalCount ?? '…'} ${escapeHtml(this.t('library.status.tracks'))}</p>
        </div>
      `;
      const representativeTrack = state.rows.find(row => typeof (row.trackUid ?? row.id) === 'string');
      const representativeTrackUid = typeof this.detail.representativeTrackUid === 'string'
        ? this.detail.representativeTrackUid
        : representativeTrack?.trackUid ?? representativeTrack?.id;
      if (representativeTrackUid) {
        if (!this.pagedDetailArtworkLoader) {
          this.pagedDetailArtworkLoader = this.createPagedArtworkLoader();
        }
        this.pagedDetailArtworkLoader?.observe(
          header.querySelector('.library-paged-detail-artwork'),
          representativeTrackUid
        );
      }
    } else {
      header.innerHTML = `
        ${this.detail || this.searchEntityType ? `<button type="button" class="library-icon-button library-back" title="${escapeHtml(this.t('library.paged.previous'))}" aria-label="${escapeHtml(this.t('library.paged.previous'))}">${ICONS.back}</button>` : ''}
        <h2>${escapeHtml(this.getPagedTitle())}</h2>
        <span>${escapeHtml(statusText)}</span>
      `;
    }
    const query = this.getPagedQuery();
    const sortControl = !this.detail && query.endpoint === 'entities'
      ? this.createEntitySortControl(query.entityType)
      : null;
    if (sortControl) {
      header.className += ' library-section-head-sortable';
      header.appendChild(sortControl);
    }
    if (this.detail?.type === 'folderNode' && !this.searchQuery.trim()) {
      header.className += ' library-folder-detail-head';
      header.appendChild(this.createFolderBrowseHeaderControls());
    }
    header.querySelector('.library-back')?.addEventListener('click', () => this.navigateBack());
    return header;
  }

  createFolderBrowseHeaderControls() {
    const controls = document.createElement('div');
    controls.className = 'library-folder-browse-controls';
    const breadcrumbs = document.createElement('nav');
    breadcrumbs.className = 'library-folder-breadcrumbs';
    breadcrumbs.setAttribute('aria-label', this.detail.title || this.t('library.nav.folders'));
    const segments = this.detail.path ? this.detail.path.split('/') : [];
    const crumbs = [{ label: this.detail.title || this.t('library.nav.folders'), path: '' }];
    let pathValue = '';
    for (const segment of segments) {
      pathValue = pathValue === '' ? segment : `${pathValue}/${segment}`;
      crumbs.push({ label: segment, path: pathValue });
    }
    const visibleCrumbs = crumbs.length <= 4
      ? crumbs
      : [crumbs[0], crumbs[1], { label: '…', path: null }, ...crumbs.slice(-2)];
    visibleCrumbs.forEach((crumb, index) => {
      if (index > 0) breadcrumbs.append(' / ');
      if (crumb.path === null) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = crumb.label;
        breadcrumbs.appendChild(ellipsis);
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-folder-breadcrumb';
      button.textContent = crumb.label;
      button.disabled = crumb.path === this.detail.path;
      button.addEventListener('click', () => this.navigateToFolderPath(crumb.path));
      breadcrumbs.appendChild(button);
    });
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'library-button library-folder-view-toggle';
    const nextMode = this.folderBrowseMode === 'tree' ? 'flat' : 'tree';
    toggle.textContent = this.t(nextMode === 'tree' ? 'library.browse.viewTree' : 'library.browse.viewFlat');
    toggle.addEventListener('click', () => this.setFolderBrowseMode(nextMode));
    controls.append(breadcrumbs, toggle);
    return controls;
  }

  setFolderBrowseMode(mode) {
    if ((mode !== 'tree' && mode !== 'flat') || mode === this.folderBrowseMode) return;
    this.capturePagedAnchor();
    this.folderBrowseMode = mode;
    this.folderChildrenState = null;
    this.saveUIState();
    this.invalidateNavigationIntent();
    this.clearSelection({ keepMobileSelectionMode: false });
    this.render();
    if (isMobileLayout() && globalThis.history?.state?.effetuneLibrary) {
      globalThis.history.replaceState({
        ...globalThis.history.state,
        snapshot: this.getNavigationSnapshot()
      }, '');
    }
  }

  navigateToFolderPath(path, { pushHistory = true } = {}) {
    if (this.detail?.type !== 'folderNode' || path === this.detail.path) return;
    const currentPath = this.detail.path;
    this.saveCurrentFolderNavigationPosition();
    const targetKey = createFolderNavigationKey(this.detail.folderId, path);
    const targetSnapshot = this.folderNavigationPositions.get(targetKey);
    const targetPosition = targetSnapshot?.pagedPosition || null;
    this.pendingPagedNavigationPosition = targetPosition;
    const isAncestor = path === '' || currentPath.startsWith(`${path}/`);
    if (isAncestor) {
      const remainder = path === '' ? currentPath : currentPath.slice(path.length + 1);
      const childName = remainder.split('/')[0];
      this.pendingFolderFocusPath = path === '' ? childName : `${path}/${childName}`;
    } else {
      this.pendingFolderFocusPath = null;
    }
    this.navigateToDetail({ ...this.detail, path }, null, {
      pushHistory,
      folderBrowseState: targetSnapshot?.folderBrowseState ?? null
    });
  }

  isFolderTreeBrowse() {
    return this.detail?.type === 'folderNode' && this.folderBrowseMode === 'tree' &&
      !this.searchQuery.trim();
  }

  createFolderDirectorySection(directTrackCount) {
    const section = document.createElement('section');
    section.className = 'library-folder-directory-section';
    section.dataset.folderBrowseKey = createFolderNavigationKey(this.detail.folderId, this.detail.path);
    this.renderFolderDirectorySection(section, directTrackCount);
    if (!this.getCurrentFolderChildrenState(section.dataset.folderBrowseKey)) {
      void this.loadFolderChildren(section, directTrackCount, { append: false });
    }
    return section;
  }

  getCurrentFolderChildrenState(key) {
    const state = this.folderChildrenState;
    if (!state || state.key !== key || state.requestId !== this.folderBrowseRequestId ||
        state.intentId !== this.navigationIntentId ||
        state.browseGeneration !== this.folderBrowseGeneration) return null;
    return state;
  }

  createFolderBrowseSnapshot(key) {
    const state = this.getCurrentFolderChildrenState(key);
    if (!state || state.error || state.loading && state.children.length === 0) return null;
    return {
      key,
      browseGeneration: state.browseGeneration,
      children: state.children.map(child => ({ ...child })),
      cursor: state.cursor,
      hasMore: state.hasMore,
      nodeExists: state.nodeExists
    };
  }

  saveCurrentFolderNavigationPosition() {
    if (this.detail?.type !== 'folderNode') return;
    const key = createFolderNavigationKey(this.detail.folderId, this.detail.path);
    const snapshot = this.getNavigationSnapshot();
    const folderBrowseState = this.createFolderBrowseSnapshot(key);
    this.folderNavigationPositions.set(key, folderBrowseState
      ? { ...snapshot, folderBrowseState }
      : snapshot);
  }

  restoreFolderBrowseSnapshot(snapshot, key) {
    if (!snapshot || snapshot.key !== key || snapshot.browseGeneration !== this.folderBrowseGeneration) return;
    this.folderChildrenState = {
      ...snapshot,
      children: snapshot.children.map(child => ({ ...child })),
      requestId: this.folderBrowseRequestId,
      intentId: this.navigationIntentId,
      loading: false,
      error: false
    };
  }

  createFolderDirectoryFailure(section, directTrackCount, { append }) {
    const failure = document.createElement('div');
    failure.className = append
      ? 'library-folder-directory-status library-folder-directory-append-error'
      : 'library-folder-directory-status';
    const message = document.createElement('span');
    message.textContent = this.t('library.error.actionFailed');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'library-button library-folder-directory-retry';
    retry.textContent = this.t('library.paged.retry');
    retry.addEventListener('click', event => {
      if (this.getCurrentFolderChildrenState(section.dataset.folderBrowseKey)?.loading) {
        event?.preventDefault?.();
        return;
      }
      void this.loadFolderChildren(section, directTrackCount, {
        append,
        preserveFocus: event?.detail === 0
      });
    });
    failure.appendChild(message);
    failure.appendChild(retry);
    return failure;
  }

  renderFolderDirectorySection(section, directTrackCount) {
    if (!section) return false;
    const key = section.dataset.folderBrowseKey;
    const state = this.getCurrentFolderChildrenState(key);
    section.innerHTML = `<h3>${escapeHtml(this.t('library.browse.folders'))}</h3>`;
    if (!state || state.loading && state.children.length === 0) {
      const loading = document.createElement('p');
      loading.className = 'library-folder-directory-status';
      loading.textContent = this.t('library.paged.loading');
      section.appendChild(loading);
      return false;
    }
    if (state.error && state.children.length === 0) {
      section.appendChild(this.createFolderDirectoryFailure(section, directTrackCount, {
        append: false
      }));
      return false;
    }
    const list = document.createElement('div');
    list.className = 'library-folder-directory-list';
    for (const child of state.children) {
      const childPath = this.detail.path === '' ? child.name : `${this.detail.path}/${child.name}`;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'library-folder-directory-row';
      row.dataset.folderPath = childPath;
      row.innerHTML = `
        <span class="library-folder-directory-icon" aria-hidden="true">📁</span>
        <span class="library-folder-directory-name">${escapeHtml(child.name)}</span>
        <span class="library-folder-directory-count">${escapeHtml(String(child.recursiveTrackCount))}</span>
      `;
      row.addEventListener('click', () => this.navigateToFolderPath(childPath));
      list.appendChild(row);
    }
    section.appendChild(list);
    if (state.error) {
      section.appendChild(this.createFolderDirectoryFailure(section, directTrackCount, {
        append: true
      }));
    } else if (state.hasMore) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'library-button library-folder-directory-more';
      more.textContent = this.t('library.paged.next');
      if (state.loading) {
        more.setAttribute('aria-disabled', 'true');
        more.setAttribute('aria-busy', 'true');
      }
      more.addEventListener('click', event => {
        if (this.getCurrentFolderChildrenState(key)?.loading) {
          event?.preventDefault?.();
          return;
        }
        void this.loadFolderChildren(section, directTrackCount, {
          append: true,
          preserveFocus: event?.detail === 0
        });
      });
      section.appendChild(more);
    }
    if (state.children.length === 0 && directTrackCount === 0) {
      const empty = document.createElement('p');
      empty.className = 'library-folder-directory-status';
      empty.textContent = this.t('library.state.emptyFolder');
      section.appendChild(empty);
    }
    return this.focusPendingFolderRow(section);
  }

  focusPendingFolderRow(section) {
    const focusPath = this.pendingFolderFocusPath;
    const liveSection = this.content?.querySelector?.('.library-folder-directory-section');
    if (!focusPath || !section || section !== liveSection) return false;
    const focusTarget = [...section.querySelectorAll?.('.library-folder-directory-row') || []]
      .find(row => row.dataset.folderPath === focusPath);
    if (!focusTarget || typeof focusTarget.focus !== 'function') return false;
    focusTarget.focus({ preventScroll: true });
    if (globalThis.document?.activeElement !== focusTarget) return false;
    this.pendingFolderFocusPath = null;
    return true;
  }

  focusFolderAppendResult(section, key, { previousChildCount, failed = false, preserveFocus = false }) {
    if (!preserveFocus || !section || section.isConnected === false) return false;
    const liveSection = this.content?.querySelector?.('.library-folder-directory-section');
    if (section !== liveSection || section.dataset.folderBrowseKey !== key) return false;
    const rows = [...section.querySelectorAll?.('.library-folder-directory-row') || []];
    const focusTarget = failed
      ? section.querySelector?.('.library-folder-directory-retry')
      : rows[previousChildCount] ??
        section.querySelector?.('.library-folder-directory-more') ??
        rows.at(-1);
    if (!focusTarget || focusTarget.isConnected === false || typeof focusTarget.focus !== 'function') return false;
    focusTarget.focus({ preventScroll: true });
    return globalThis.document?.activeElement === focusTarget;
  }

  async loadFolderChildren(section, directTrackCount, { append = false, preserveFocus = false } = {}) {
    if (!this.isFolderTreeBrowse() || typeof this.manager?.browseFolderChildren !== 'function') return;
    const folderId = this.detail.folderId;
    const path = this.detail.path;
    const key = createFolderNavigationKey(folderId, path);
    const currentState = this.getCurrentFolderChildrenState(key);
    if (currentState?.loading) return;
    const previous = append && currentState
      ? currentState
      : { key, children: [], cursor: null, hasMore: false, nodeExists: true };
    const requestId = ++this.folderBrowseRequestId;
    const browseGeneration = this.folderBrowseGeneration;
    const intentId = this.navigationIntentId;
    this.folderChildrenState = {
      ...previous,
      requestId,
      intentId,
      browseGeneration,
      loading: true,
      error: false
    };
    const liveSection = this.content?.querySelector?.('.library-folder-directory-section');
    const liveMore = append && liveSection?.dataset.folderBrowseKey === key
      ? liveSection.querySelector?.('.library-folder-directory-more')
      : null;
    const liveRetry = liveSection?.dataset.folderBrowseKey === key
      ? liveSection.querySelector?.('.library-folder-directory-retry')
      : null;
    const liveLoadControl = liveMore ?? liveRetry;
    const handoffLoadFocus = Boolean(
      preserveFocus && liveSection && liveLoadControl &&
      liveSection.isConnected !== false && liveLoadControl.isConnected !== false &&
      globalThis.document?.activeElement === liveLoadControl
    );
    if (liveLoadControl) {
      liveLoadControl.setAttribute?.('aria-disabled', 'true');
      liveLoadControl.setAttribute?.('aria-busy', 'true');
    } else {
      this.renderFolderDirectorySection(section, directTrackCount);
    }
    try {
      const result = await this.manager.browseFolderChildren({
        folderId,
        path,
        limit: 500,
        ...(append && previous.cursor ? { cursor: previous.cursor } : {})
      });
      if (requestId !== this.folderBrowseRequestId || browseGeneration !== this.folderBrowseGeneration ||
          !this.isNavigationIntentCurrent(intentId) ||
          key !== createFolderNavigationKey(this.detail?.folderId, this.detail?.path)) return;
      if (result.nodeExists === false) {
        this.folderChildrenState = null;
        const usedMobileHistory = isMobileLayout() && this.mobileHistoryDepth > 0 &&
          typeof globalThis.history?.back === 'function';
        this.navigateBack();
        if (isMobileLayout() && !usedMobileHistory && globalThis.history?.state?.effetuneLibrary) {
          globalThis.history.replaceState({
            ...globalThis.history.state,
            snapshot: this.getNavigationSnapshot()
          }, '');
        }
        return;
      }
      let children = append ? [...previous.children, ...result.children] : [...result.children];
      if (!append && result.hasMore !== true) {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        children.sort((left, right) => collator.compare(left.name, right.name));
      }
      this.folderChildrenState = {
        key,
        requestId,
        intentId,
        browseGeneration,
        children,
        cursor: result.cursor ?? null,
        hasMore: result.hasMore === true,
        nodeExists: true,
        loading: false,
        error: false
      };
      const liveSection = this.content?.querySelector?.('.library-folder-directory-section');
      if (!liveSection || liveSection.isConnected === false || liveSection.dataset.folderBrowseKey !== key) return;
      const previousGrid = this.content?.querySelector?.('.library-paged-grid');
      const previousGridOffset = Number(previousGrid?.offsetTop) || 0;
      const previousScrollTop = Number(this.content?.scrollTop) || 0;
      const preserveTrackViewport = Boolean(previousGrid) && previousScrollTop >= previousGridOffset;
      const focusedPendingRow = this.renderFolderDirectorySection(liveSection, directTrackCount);
      if (!focusedPendingRow) {
        this.focusFolderAppendResult(liveSection, key, {
          previousChildCount: previous.children.length,
          preserveFocus: handoffLoadFocus
        });
      }
      const nextGridOffset = Number(this.content?.querySelector?.('.library-paged-grid')?.offsetTop) || 0;
      if (this.content && preserveTrackViewport && nextGridOffset !== previousGridOffset) {
        this.content.scrollTop = previousScrollTop + nextGridOffset - previousGridOffset;
        this.refreshPagedWindow?.();
      }
    } catch (error) {
      if (requestId !== this.folderBrowseRequestId || browseGeneration !== this.folderBrowseGeneration ||
          !this.isNavigationIntentCurrent(intentId) ||
          key !== createFolderNavigationKey(this.detail?.folderId, this.detail?.path)) return;
      console.warn('Unable to browse music folder contents:', error);
      this.folderChildrenState = {
        ...previous,
        requestId,
        intentId,
        browseGeneration,
        loading: false,
        error: true
      };
      const liveSection = this.content?.querySelector?.('.library-folder-directory-section');
      if (liveSection?.isConnected !== false && liveSection?.dataset.folderBrowseKey === key) {
        const focusedPendingRow = this.renderFolderDirectorySection(liveSection, directTrackCount);
        if (!focusedPendingRow) {
          this.focusFolderAppendResult(liveSection, key, {
            previousChildCount: previous.children.length,
            failed: true,
            preserveFocus: handoffLoadFocus
          });
        }
      }
    }
  }

  createEntitySortControl(entityType) {
    const fields = ENTITY_SORT_FIELDS[entityType];
    if (!fields) return null;
    const preference = this.getEntitySort(entityType);
    const label = document.createElement('label');
    label.className = 'library-entity-sort-control';
    const labelText = document.createElement('span');
    labelText.textContent = this.t('library.sort.label');
    const select = document.createElement('select');
    select.className = 'library-entity-sort-select';
    select.setAttribute('aria-label', this.t('library.sort.label'));
    for (const field of fields) {
      for (const direction of ['asc', 'desc']) {
        const option = document.createElement('option');
        option.value = `${field.sort}:${direction}`;
        option.textContent = `${this.t(field.labelKey)} — ${this.t(
          direction === 'asc' ? 'library.sort.ascending' : 'library.sort.descending'
        )}`;
        option.selected = field.sort === preference.sort && direction === preference.direction;
        select.appendChild(option);
      }
    }
    select.value = `${preference.sort}:${preference.direction}`;
    select.addEventListener('change', event => {
      this.applyEntitySort(entityType, event.currentTarget?.value ?? select.value);
    });
    label.appendChild(labelText);
    label.appendChild(select);
    return label;
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
      entityId: isTrackQuery ? this.getPagedTrackIdentity(item) : this.getPagedEntityId(item),
      viewportOffsetPx,
      focusKey: first?.contains?.(activeElement)
        ? (isTrackQuery ? this.getPagedTrackIdentity(item) : this.getPagedEntityId(item))
        : null
    });
    if (Number.isSafeInteger(ordinal)) this.pagedViewportOrdinal = ordinal;
    this.pagedViewportOffsetPx = Number.isFinite(viewportOffsetPx) ? viewportOffsetPx : 0;
    return this.pagedAnchor;
  }

  capturePagedAnchorFromOrdinal(
    ordinal,
    segmentWindow,
    isTrackQuery,
    gridGeometry,
    gridOffsetTop,
    contentScrollTop
  ) {
    const item = this.pagedController.getCachedRows(ordinal, ordinal + 1)[0]?.row;
    if (!item) return;
    const rowOrdinal = isTrackQuery ? ordinal : Math.floor(ordinal / gridGeometry.columns);
    const rowHeight = isTrackQuery ? this.getTrackRowHeight() : gridGeometry.rowHeight;
    const viewportOffsetPx = (Number(gridOffsetTop) || 0) +
      ((rowOrdinal - segmentWindow.startOrdinal) * rowHeight) -
      (Number(contentScrollTop) || 0);
    this.pagedAnchor = this.pagedController.createAnchor({
      canonicalTuple: item.canonicalTuple ?? null,
      ordinal,
      entityId: isTrackQuery ? this.getPagedTrackIdentity(item) : this.getPagedEntityId(item),
      viewportOffsetPx: Number.isFinite(viewportOffsetPx) ? viewportOffsetPx : 0,
      focusKey: null
    });
    this.pagedViewportOffsetPx = Number.isFinite(viewportOffsetPx) ? viewportOffsetPx : 0;
  }

  async ensurePagedOrdinal(ordinal) {
    const intentId = this.navigationIntentId;
    const controller = this.pagedController;
    try {
      const loadOrdinal = controller.requestViewportOrdinal?.bind(controller) ??
        controller.ensureOrdinal.bind(controller);
      const result = await loadOrdinal(ordinal);
      if (!this.isNavigationIntentCurrent(intentId) || controller !== this.pagedController) {
        return { accepted: false, reason: 'stale-page' };
      }
      if (!result?.accepted && ![
        'end', 'start', 'inactive-page', 'stale-page', 'page-pending'
      ].includes(result?.reason)) {
        console.warn('Music Library position could not be opened:', result);
        this.showPagedPaginationFailure(ordinal);
      } else if (result?.accepted) {
        this.clearPagedPaginationFailure();
      }
      return result;
    } catch (error) {
      if (!this.isNavigationIntentCurrent(intentId) || controller !== this.pagedController) {
        return { accepted: false, reason: 'stale-page' };
      }
      if (this.handlePagedSnapshotExpiry(error)) {
        return { accepted: false, reason: 'snapshot-expired', error };
      }
      console.error('Music Library position load failed:', error);
      this.showPagedPaginationFailure(ordinal);
      return { accepted: false, reason: 'page-failed', error };
    }
  }

  showPagedPaginationFailure(ordinal) {
    this.pagedPaginationFailureOrdinal = ordinal;
    let region = this.content?.querySelector?.('.library-paged-pagination-error');
    if (!region) {
      region = document.createElement('section');
      region.className = 'library-paged-pagination-error';
      region.setAttribute('role', 'alert');
      this.content?.appendChild?.(region);
    }
    region.innerHTML = `
      <span>${escapeHtml(this.t('library.paged.loadFailed'))}</span>
      <button type="button" class="library-button library-paged-pagination-retry">${escapeHtml(this.t('library.paged.retry'))}</button>
    `;
    region.querySelector?.('.library-paged-pagination-retry')?.addEventListener('click', () => {
      const retryOrdinal = this.pagedPaginationFailureOrdinal;
      if (Number.isSafeInteger(retryOrdinal)) void this.ensurePagedOrdinal(retryOrdinal);
    });
  }

  clearPagedPaginationFailure() {
    this.pagedPaginationFailureOrdinal = null;
    this.content?.querySelectorAll?.('.library-paged-pagination-error').forEach(region => {
      region.remove?.();
    });
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
      loadArtwork: artworkId => (loadBlob ? loadBlob(artworkId) : loadUrl(artworkId))
    });
  }

  preparePagedArtworkLoader(state) {
    const attemptKey = `${state.queryGeneration}:${state.pageAttemptId}`;
    if (this.pagedArtworkLoaderAttemptKey !== attemptKey) {
      this.destroyPagedArtworkLoader();
      this.pagedArtworkLoaderAttemptKey = attemptKey;
    } else {
      this.pagedArtworkLoader?.resetTargets();
      this.pagedDetailArtworkLoader?.resetTargets();
    }
    if (!this.pagedArtworkLoader) this.pagedArtworkLoader = this.createPagedArtworkLoader();
  }

  destroyPagedArtworkLoader() {
    this.pagedArtworkLoader?.destroy();
    this.pagedDetailArtworkLoader?.destroy();
    this.pagedArtworkLoader = null;
    this.pagedDetailArtworkLoader = null;
    this.pagedArtworkLoaderAttemptKey = null;
  }

  createPagedActionBar(state) {
    const bar = document.createElement('div');
    bar.className = 'library-action-bar library-paged-actions';
    const hasSelection = this.getPagedSelectionProjection(state).hasAny;
    const actionsDisabled = this.isPagedActionBusy() ||
      typeof this.manager.performSelectionAction !== 'function' ||
      (!hasSelection && !this.usesPagedContextAction(state)) ||
      Boolean(state.staleSelectionDescriptor);
    const disabled = actionsDisabled ? ' disabled' : '';
    const deselectDisabled = hasSelection ? '' : ' disabled';
    const shuffleButton = this.detail?.type === 'playlist'
      ? `<button type="button" class="library-button library-paged-shuffle"${disabled}>${ICONS.shuffle}<span>${escapeHtml(this.t('library.action.shuffle'))}</span></button>`
      : '';
    bar.innerHTML = `
      <button type="button" class="library-button library-paged-select-all">${escapeHtml(this.t('library.paged.selectAll'))}</button>
      <button type="button" class="library-button library-paged-deselect-all"${deselectDisabled}>${escapeHtml(this.t('library.paged.deselectAll'))}</button>
      <button type="button" class="library-button library-paged-play"${disabled}>${ICONS.play}<span>${escapeHtml(this.t('library.action.play'))}</span></button>
      ${shuffleButton}
      <button type="button" class="library-button library-paged-play-next"${disabled}>${ICONS.next}<span>${escapeHtml(this.t('library.action.playNext'))}</span></button>
      <button type="button" class="library-button library-paged-queue"${disabled}>${ICONS.queue}<span>${escapeHtml(this.t('library.action.addToQueue'))}</span></button>
      <button type="button" class="library-button library-paged-add-playlist"${disabled}>${ICONS.add}<span>${escapeHtml(this.t('library.action.addToPlaylist'))}</span></button>
      ${state.staleSelectionDescriptor ? `<span class="library-paged-stale-selection" role="status">${escapeHtml(this.t('library.paged.selectionStale'))}</span><button type="button" class="library-button library-paged-reselect">${escapeHtml(this.t('library.paged.reselect'))}</button>` : ''}
      ${state.selectionRejection ? `<span class="library-paged-selection-error" role="alert">${escapeHtml(this.t('library.paged.selectionTooLarge'))}</span>` : ''}
    `;
    bar.querySelector('.library-paged-select-all')?.addEventListener('click', () => {
      this.pagedController.selectAll();
      this.refreshPagedSelectionState();
    });
    bar.querySelector('.library-paged-deselect-all')?.addEventListener('click', () => {
      this.clearSelection({ keepMobileSelectionMode: true });
      this.refreshPagedSelectionState();
    });
    bar.querySelector('.library-paged-reselect')?.addEventListener('click', event => {
      event.currentTarget.disabled = true;
      this.runLibraryCommand(async () => {
        const result = await this.pagedController.reselectStaleSelection();
        if (!result.accepted) this.announcePagedStatus(this.t('library.paged.reselectFailed'));
        this.renderPagedCommitted(this.pagedController.createViewState());
        return result;
      }, { logMessage: 'Music Library selection rebind failed:' });
    });
    const dispatch = (operationKind, request = {}) => this.startPagedSelectionAction(state, operationKind, request);
    bar.querySelector('.library-paged-play')?.addEventListener('click', () => dispatch('play'));
    bar.querySelector('.library-paged-shuffle')?.addEventListener('click', () => (
      dispatch('play', { options: { seed: createPlaybackShuffleSeed() } })
    ));
    bar.querySelector('.library-paged-play-next')?.addEventListener('click', () => dispatch('playNext'));
    bar.querySelector('.library-paged-queue')?.addEventListener('click', () => dispatch('queue'));
    bar.querySelector('.library-paged-add-playlist')?.addEventListener('click', event => {
      this.runLibraryCommand(() => this.openPagedAddToPlaylistMenu(event.currentTarget, state), {
        logMessage: 'Music Library playlist menu failed:'
      });
    });
    return bar;
  }

  createPagedTrackHeader() {
    const header = document.createElement('div');
    header.className = 'library-track-header library-paged-track-header';
    header.setAttribute('role', 'row');
    header.setAttribute('aria-rowindex', '1');
    header.innerHTML = `
      <span class="library-track-control-header" role="columnheader" aria-label="${escapeHtml(this.t('library.paged.selectAll'))}"></span>
      <span class="library-track-control-header" role="columnheader" aria-label="${escapeHtml(this.t('library.playlist.system.favorites'))}"></span>
      ${TRACK_SORT_COLUMNS.map(column => this.renderSortHeader(column)).join('')}
      <span class="library-track-control-header" role="columnheader" aria-label="${escapeHtml(this.t('library.action.more'))}"></span>
    `;
    header.querySelectorAll('[data-sort]').forEach(button => {
      button.addEventListener('click', () => this.applyTrackSort(button.dataset.sort));
    });
    return header;
  }

  startPagedSelectionAction(state, operationKind, request = {}) {
    if (!this.pagedActionController) return { accepted: false, reason: 'action-unavailable' };
    const clientRequestId = isPagedPlaybackOperation(operationKind)
      ? undefined
      : (request.clientRequestId ?? this.manager.createOperationRequestId?.());
    const operationRequest = freezePagedActionRequest({ ...request, clientRequestId: undefined });
    const projection = this.getPagedSelectionProjection(state);
    const useWholeContext = !projection.hasAny && this.usesPagedContextAction(state);
    const prepared = useWholeContext
      ? this.pagedController.dispatchRowAction(state, () => ({
          operationKind,
          descriptor: Object.freeze({
            mode: 'all',
            contextToken: this.pagedController.contextToken,
            exclusions: []
          }),
          request: operationRequest
        }))
      : this.pagedController.prepareSelectionAction(state, operationKind, operationRequest);
    if (!prepared.accepted || prepared.value?.accepted === false) return prepared;
    const descriptor = prepared.value.descriptor;
    const promise = this.trackPreparedPagedAction({
      clientRequestId,
      operationKind,
      descriptor,
      request: operationRequest,
      targetName: useWholeContext && this.detail?.type === 'playlist'
        ? this.getSystemPlaylistName(
            this.detail.key,
            this.detail.title || this.t('library.nav.playlists')
          )
        : (request.target?.name ?? request.target?.playlistId ?? '')
    });
    return { accepted: true, value: promise };
  }

  trackPreparedPagedAction({
    clientRequestId,
    operationKind,
    descriptor,
    request = {},
    targetName = ''
  }) {
    if (!this.pagedActionController || typeof this.manager.performSelectionAction !== 'function') {
      return Promise.resolve({ kind: 'unavailable' });
    }
    const immutableDescriptor = freezePagedSelectionDescriptor(descriptor);
    const immutableRequest = freezePagedActionRequest(request);
    const requestId = isPagedPlaybackOperation(operationKind)
      ? undefined
      : (clientRequestId ?? this.manager.createOperationRequestId?.());
    return this.pagedActionController.track({
      ...(requestId ? { clientRequestId: requestId } : {}),
      operationKind,
      targetName,
      start: () => this.manager.performSelectionAction(
        operationKind,
        immutableDescriptor,
        requestId ? { ...immutableRequest, clientRequestId: requestId } : immutableRequest
      )
    });
  }

  createPagedActionToast() {
    const state = this.pagedActionController?.state;
    if (!this.pagedActionToastVisible || !state || state.status === 'idle') return null;
    const region = document.createElement('section');
    region.className = 'library-paged-action-toast';
    region.dataset.libraryPagedActionToast = 'true';
    region.tabIndex = -1;
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    this.updatePagedActionToast(region, state);
    return region;
  }

  updatePagedActionToast(region, state = this.pagedActionController?.state) {
    const action = this.t(`library.job.action.${state.operationKind || 'operation'}`);
    const statusText = state.status === 'waiting'
      ? this.t('library.job.waiting')
      : state.status === 'cancelling'
        ? this.t('library.job.cancelling')
        : state.status === 'terminal'
          ? this.t(`library.job.terminal.${state.terminalKind || 'failed'}`)
          : '';
    const operationPhaseKey = state.status === 'terminal'
      ? null
      : PAGED_ACTION_PHASE_KEYS[String(state.phase ?? '').toUpperCase()] ?? null;
    const operationPhase = operationPhaseKey ? this.t(operationPhaseKey) : '';
    const processed = Number.isSafeInteger(state.processed) && state.processed >= 0
      ? state.processed
      : null;
    const total = Number.isSafeInteger(state.total) && state.total >= 0 ? state.total : null;
    const progress = processed === null
      ? ''
      : this.t(total === null ? 'library.job.progressUnknown' : 'library.job.progressKnown', {
          processed,
          ...(total === null ? {} : { total })
        });
    const markup = `
      <strong>${escapeHtml(action)}</strong>
      ${state.targetName ? `<span>${escapeHtml(state.targetName)}</span>` : ''}
      ${statusText ? `<span class="library-paged-action-toast-state">${escapeHtml(statusText)}</span>` : ''}
      ${operationPhase ? `<span class="library-paged-action-toast-phase">${escapeHtml(operationPhase)}</span>` : ''}
      ${progress ? `<span class="library-paged-action-toast-progress">${escapeHtml(progress)}</span>` : ''}
      ${state.canCancel ? `<button type="button" class="library-button library-paged-action-toast-cancel">${escapeHtml(this.t('library.action.cancel'))}</button>` : ''}
    `;
    if (region.innerHTML === markup) return;
    region.innerHTML = markup;
    region.querySelector('.library-paged-action-toast-cancel')?.addEventListener('click', event => {
      event.currentTarget.disabled = true;
      return this.runLibraryCommand(() => this.pagedActionController.cancel(), {
        logMessage: 'Music Library operation cancellation failed:'
      });
    });
  }

  renderPagedActionToast() {
    if (!this.content) return;
    this.refreshPagedActionAvailability();
    const current = this.content.querySelector?.('[data-library-paged-action-toast]');
    if (!this.pagedActionToastVisible) {
      current?.remove?.();
      return;
    }
    if (current) {
      this.updatePagedActionToast(current);
      return;
    }
    const next = this.createPagedActionToast();
    if (next) this.content.querySelector?.('.library-paged-attempt')?.appendChild?.(next);
  }

  isPagedActionBusy() {
    return ['starting', 'active', 'waiting', 'cancelling'].includes(
      this.pagedActionController?.state?.status
    );
  }

  refreshPagedActionAvailability() {
    if (!this.content) return;
    const jobActive = this.isPagedActionBusy();
    const viewState = this.pagedController?.createViewState?.() ?? this.pagedState;
    const hasSelection = this.getPagedSelectionProjection(viewState).hasAny;
    const disabled = jobActive || typeof this.manager.performSelectionAction !== 'function' ||
      (!hasSelection && !this.usesPagedContextAction(viewState)) ||
      Boolean(viewState?.staleSelectionDescriptor);
    const deselectAll = this.content.querySelector?.('.library-paged-deselect-all');
    if (deselectAll) deselectAll.disabled = !hasSelection;
    for (const selector of [
      '.library-paged-play', '.library-paged-shuffle', '.library-paged-play-next',
      '.library-paged-queue', '.library-paged-add-playlist'
    ]) {
      const control = this.content.querySelector?.(selector);
      if (control) control.disabled = disabled;
    }
    const independentPlaybackDisabled = jobActive || typeof this.manager.performSelectionAction !== 'function';
    this.content.querySelectorAll?.('.library-card-play').forEach(control => {
      control.disabled = independentPlaybackDisabled;
    });
  }

  createPagedPlaylistCollectionControls() {
    const controls = document.createElement('div');
    controls.className = 'library-playlist-actions library-paged-playlist-collection-actions';
    controls.innerHTML = `
      <button type="button" class="library-button library-import-playlist">${ICONS.import}<span>${escapeHtml(this.t('library.action.importPlaylist'))}</span></button>
      <button type="button" class="library-button library-new-playlist">${ICONS.add}<span>${escapeHtml(this.t('library.action.newPlaylist'))}</span></button>
    `;
    controls.querySelector('.library-import-playlist')?.addEventListener('click', () => {
      this.runLibraryCommand(() => this.handleImportPlaylist(), {
        logMessage: 'Music Library playlist import command failed:'
      });
    });
    controls.querySelector('.library-new-playlist')?.addEventListener('click', () => {
      this.runLibraryCommand(async () => {
        const name = await this.promptText('library.prompt.playlistName', this.t('library.action.newPlaylist'));
        if (!name) return;
        const playlist = await this.manager.playlists.create(name);
        const playlistId = playlist?.playlistId ?? playlist?.id;
        if (playlistId) this.navigateToDetail({ type: 'playlist', key: playlistId, title: name }, 'playlists');
      }, { logMessage: 'Music Library playlist creation failed:' });
    });
    return controls;
  }

  createPagedPlaylistControls() {
    const systemPlaylist = isSystemPlaylistId(this.detail.key);
    const playlist = {
      id: this.detail.key,
      name: this.getSystemPlaylistName(
        this.detail.key,
        this.detail.title || this.t('library.nav.playlists')
      )
    };
    const controls = document.createElement('div');
    controls.className = 'library-playlist-actions library-paged-playlist-actions';
    controls.dataset.libraryPlaylistExport = 'true';
    controls.tabIndex = -1;
    controls.innerHTML = `
      ${systemPlaylist ? '' : `<button type="button" class="library-button library-playlist-rename">${ICONS.edit}<span>${escapeHtml(this.t('library.action.rename'))}</span></button>`}
      <button type="button" class="library-button library-playlist-duplicate">${ICONS.duplicate}<span>${escapeHtml(this.t('library.action.duplicate'))}</span></button>
      <label class="library-checkbox library-playlist-export-relative-wrap"><input type="checkbox" class="library-playlist-export-relative" checked><span>${escapeHtml(this.t('library.option.relativePaths'))}</span></label>
      <button type="button" class="library-button library-playlist-export-m3u8" data-library-playlist-export>${ICONS.export}<span>${escapeHtml(this.t('library.action.exportM3U8'))}</span></button>
      <button type="button" class="library-button library-playlist-export-xspf">${ICONS.export}<span>${escapeHtml(this.t('library.action.exportXSPF'))}</span></button>
      <button type="button" class="library-button library-playlist-delete">${ICONS.trash}<span>${escapeHtml(this.t('library.action.delete'))}</span></button>
    `;
    controls.querySelector('.library-playlist-rename')?.addEventListener('click', () => {
      this.runLibraryCommand(async () => {
        const name = await this.promptText('library.prompt.renamePlaylist', playlist.name);
        if (!name || name === playlist.name) return;
        await this.manager.playlists.rename(playlist.id, name);
        this.detail = { ...this.detail, title: name };
        this.pagedQueryKey = null;
        this.render();
      }, { logMessage: 'Music Library playlist rename failed:' });
    });
    controls.querySelector('.library-playlist-duplicate')?.addEventListener('click', () => {
      this.runLibraryCommand(async () => {
        const source = await this.manager.playlists.get(playlist.id);
        const suggested = this.t('library.playlist.copyName', { name: playlist.name });
        const name = await this.promptText('library.prompt.playlistName', suggested);
        if (!name) return;
        const duplicated = await this.manager.playlists.duplicate(playlist.id, name, { playlist: source });
        const playlistId = duplicated?.playlistId ?? duplicated?.id;
        if (playlistId) this.navigateToDetail({ type: 'playlist', key: playlistId, title: name }, 'playlists');
      }, { logMessage: 'Music Library playlist duplication failed:' });
    });
    controls.querySelector('.library-playlist-export-m3u8')?.addEventListener('click', () => {
      void this.handleExportPlaylist(playlist, 'm3u8');
    });
    controls.querySelector('.library-playlist-export-xspf')?.addEventListener('click', () => {
      void this.handleExportPlaylist(playlist, 'xspf');
    });
    controls.querySelector('.library-playlist-delete')?.addEventListener('click', () => {
      this.runLibraryCommand(async () => {
        if (typeof confirm === 'function' && !confirm(this.t('library.confirm.deletePlaylist', { name: playlist.name }))) return;
        await this.manager.playlists.delete(playlist.id);
        this.navigateToView('playlists');
      }, { logMessage: 'Music Library playlist deletion failed:' });
    });
    return controls;
  }

  createPagedRow(item, ordinal, state, isTrackQuery, { rowIndexOffset = 0 } = {}) {
    const entityType = isTrackQuery ? null : this.getPagedQuery().entityType;
    const isMediaCard = Boolean(PAGED_CARD_SCOPE_KEYS[entityType]);
    const isFolder = entityType === 'folder';
    const row = document.createElement('div');
    const trackUid = isTrackQuery ? this.getPagedTrackUid(item) : null;
    const entityId = isTrackQuery ? this.getPagedTrackIdentity(item) : this.getPagedEntityId(item);
    const systemPlaylist = entityType === 'playlist' && isSystemPlaylistId(entityId);
    const playlistItemKey = isTrackQuery ? this.getPagedPlaylistMutationKey(item) : null;
    const unresolvedPlaylistItem = isTrackQuery && this.isPagedPlaylistItemUnresolved(item);
    const unresolvedStatusId = unresolvedPlaylistItem
      ? `library-paged-unresolved-${state.queryGeneration}-${state.pageAttemptId}-${ordinal}`
      : null;
    const trackTitle = item.title || item.fileName || trackUid || (
      unresolvedPlaylistItem ? this.t('library.state.missing') : ''
    );
    const nowPlaying = isTrackQuery && this.nowPlayingTrackId === trackUid;
    const canFavorite = Boolean(trackUid && !unresolvedPlaylistItem);
    const favorite = canFavorite && this.favoriteTrackUids?.has(trackUid) === true;
    const isFirstPlaylistItem = this.detail?.type === 'playlist' && ordinal === 0;
    const isLastPlaylistItem = this.detail?.type === 'playlist' &&
      Number.isSafeInteger(state.totalCount) && ordinal === state.totalCount - 1;
    row.className = `library-paged-row${isTrackQuery ? '' : ' library-paged-entity-card'}${isMediaCard ? ' library-paged-media-card' : ''}${isFolder ? ' library-paged-folder-row' : ''}${systemPlaylist ? ' library-system-playlist-card' : ''}${unresolvedPlaylistItem ? ' library-paged-unresolved' : ''}${nowPlaying ? ' now-playing' : ''}`;
    row._pagedItem = item;
    row.dataset.entityId = entityId ?? '';
    if (isTrackQuery) row.dataset.trackId = trackUid ?? '';
    row.dataset.ordinal = String(ordinal);
    row.dataset.queryGeneration = String(state.queryGeneration);
    row.dataset.pageAttemptId = String(state.pageAttemptId);
    row.setAttribute('role', isTrackQuery ? 'row' : 'listitem');
    if (isTrackQuery) row.setAttribute('aria-rowindex', String(ordinal + rowIndexOffset + 1));
    else {
      row.setAttribute('aria-posinset', String(ordinal + 1));
      if (Number.isSafeInteger(state.totalCount)) {
        row.setAttribute('aria-setsize', String(state.totalCount));
      }
    }
    if (unresolvedStatusId) row.setAttribute('aria-describedby', unresolvedStatusId);
    if (nowPlaying) row.setAttribute('aria-current', 'true');
    if (isTrackQuery) {
      row.tabIndex = entityId === this.pagedFocusedEntityId ? 0 : -1;
      row.addEventListener('focus', () => {
        this.pagedFocusedOrdinal = ordinal;
        this.pagedFocusedEntityId = entityId;
      });
    }
    if (isTrackQuery) {
      const selected = this.pagedController.isSelected(entityId, ordinal);
      const artistDetail = this.getTrackArtistDetail(item);
      setClass(row, 'selected', selected);
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
      row.draggable = !isMobileLayout() && (
        this.detail?.type !== 'playlist' || playlistItemKey !== null
      );
      row.innerHTML = `
        <span class="library-paged-select-cell" role="gridcell"><input class="library-paged-select" type="checkbox" aria-label="${escapeHtml(this.t('library.paged.selectTrack', { title: trackTitle }))}"${selected ? ' checked' : ''}></span>
        <span class="library-paged-favorite-cell" role="gridcell">${canFavorite ? `<button type="button" class="library-icon-button library-paged-favorite${favorite ? ' is-favorite' : ''}" data-favorite-track-id="${escapeHtml(trackUid)}" aria-pressed="${favorite ? 'true' : 'false'}" aria-label="${escapeHtml(this.t(favorite ? 'library.action.removeFavorite' : 'library.action.addFavorite'))}" title="${escapeHtml(this.t(favorite ? 'library.action.removeFavorite' : 'library.action.addFavorite'))}">${favorite ? ICONS.starFilled : ICONS.star}</button>` : ''}</span>
        <span class="library-track-title" role="gridcell"><span class="library-now-playing-indicator" aria-hidden="true" ${nowPlaying ? '' : 'hidden'}>♪</span><span class="library-track-title-text">${escapeHtml(trackTitle)}</span>${unresolvedPlaylistItem ? `<span id="${unresolvedStatusId}" class="library-badge missing library-paged-unresolved-status">${escapeHtml(this.t('library.state.missing'))}</span>` : ''}</span>
        <span class="library-artist-cell" role="gridcell">${artistDetail ? `<button type="button" class="library-link library-artist-link">${escapeHtml(this.getTrackArtistLabel(item))}</button>` : escapeHtml(item.artist || item.albumArtist || '')}</span>
        <span class="library-album-cell" role="gridcell">${item.albumKey ? `<button type="button" class="library-link library-album-link">${escapeHtml(this.getTrackAlbumLabel(item))}</button>` : escapeHtml(item.album || '')}</span>
        <span class="library-genre-cell" role="gridcell">${escapeHtml(item.genre || '')}</span>
        <span class="library-duration-cell" role="gridcell">${formatDuration(item.durationSec)}</span>
        <span class="library-paged-more-cell" role="gridcell"><button type="button" class="library-icon-button library-paged-row-more" title="${escapeHtml(this.t('library.action.more'))}" aria-label="${escapeHtml(this.t('library.action.more'))}">${ICONS.more}</button></span>
        ${this.detail?.type === 'playlist' && (item.itemKey ?? item.playlistItemKey) != null ? `<span class="library-paged-playlist-row-actions" role="gridcell">
          <button type="button" class="library-icon-button library-paged-item-up" aria-label="${escapeHtml(this.t('library.action.moveUp'))}"${isFirstPlaylistItem ? ' disabled' : ''}>${ICONS.up}</button>
          <button type="button" class="library-icon-button library-paged-item-down" aria-label="${escapeHtml(this.t('library.action.moveDown'))}"${isLastPlaylistItem ? ' disabled' : ''}>${ICONS.down}</button>
          <button type="button" class="library-icon-button library-paged-item-remove" aria-label="${escapeHtml(this.t('library.action.removeFromPlaylist'))}">${ICONS.trash}</button>
        </span>` : ''}
      `;
      const checkbox = row.querySelector('.library-paged-select');
      row.querySelector('.library-paged-favorite')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const desired = !this.favoriteTrackUids?.has(trackUid);
        this.runLibraryCommand(() => this.setFavoriteTrackUids([trackUid], desired), {
          logMessage: 'Music Library favorite update failed:'
        });
      });
      checkbox?.addEventListener('click', event => {
        checkbox._pagedShiftKey = event.shiftKey === true;
      });
      checkbox?.addEventListener('change', event => {
        this.commitPagedTrackSelection(row, entityId, ordinal, event.target.checked, {
          extend: checkbox._pagedShiftKey === true
        });
        checkbox._pagedShiftKey = false;
      });
      let suppressNextClick = false;
      let longPressHandled = false;
      let touchTimer = null;
      const clearTouchTimer = () => {
        if (touchTimer === null) return;
        clearTimeout(touchTimer);
        touchTimer = null;
      };
      const selectFromLongPress = event => {
        if (!isMobileLayout()) return;
        event.preventDefault?.();
        suppressNextClick = true;
        longPressHandled = true;
        if (this.pagedController.isSelected(entityId, ordinal)) {
          this.setPagedMobileSelectionActive(true);
          return;
        }
        const dispatched = this.commitPagedTrackSelection(row, entityId, ordinal, true, { exclusive: true });
        if (dispatched?.accepted !== false && dispatched?.value?.accepted !== false) {
          this.setPagedMobileSelectionActive(true);
        }
      };
      row.addEventListener('click', event => {
        if (suppressNextClick) {
          suppressNextClick = false;
          event.preventDefault?.();
          event.stopPropagation?.();
          return;
        }
        if (event.target?.closest?.('button, input, a, [role="menuitem"]')) return;
        if (isMobileLayout()) {
          if (this.pagedMobileSelectionActive) {
            const isSelected = this.pagedController.isSelected(entityId, ordinal);
            this.commitPagedTrackSelection(row, entityId, ordinal, !isSelected);
          } else {
            if (event.detail > 1) return;
            this.dispatchPagedRowAction(row, () => this.startPagedTrackPlay(item, ordinal));
          }
          return;
        }
        const additive = event.ctrlKey === true || event.metaKey === true;
        const isSelected = this.pagedController.isSelected(entityId, ordinal);
        this.commitPagedTrackSelection(row, entityId, ordinal, additive ? !isSelected : true, {
          exclusive: !additive && event.shiftKey !== true,
          extend: event.shiftKey === true
        });
      });
      row.addEventListener('dblclick', event => {
        if (event.target?.closest?.('button, input, a, [role="menuitem"]')) return;
        if (isMobileLayout()) return;
        this.dispatchPagedRowAction(row, () => this.startPagedTrackPlay(item, ordinal));
      });
      row.addEventListener('contextmenu', event => {
        const touchPending = touchTimer !== null;
        clearTouchTimer();
        if (isMobileLayout() && (touchPending || longPressHandled)) {
          if (longPressHandled) {
            event.preventDefault?.();
          } else {
            selectFromLongPress(event);
          }
          return;
        }
        this.openPagedTrackContextMenu(event, item, { returnFocus: row, ordinal });
      });
      if (this.detail?.type === 'playlist') {
        row.addEventListener('dragstart', event => this.handlePagedPlaylistItemDragStart(event, item, ordinal));
        row.addEventListener('dragover', event => this.handlePagedPlaylistItemDragOver(event, item));
        row.addEventListener('dragleave', event => this.handlePagedPlaylistItemDragLeave(event));
        row.addEventListener('drop', event => this.handlePagedPlaylistItemDrop(event, row, item));
        row.addEventListener('dragend', event => this.handlePagedPlaylistItemDragEnd(event));
      } else {
        row.addEventListener('dragstart', event => this.handlePagedTrackDragStart(event, trackUid, ordinal));
      }
      row.addEventListener('touchstart', event => {
        clearTouchTimer();
        suppressNextClick = false;
        longPressHandled = false;
        touchTimer = setTimeout(() => {
          touchTimer = null;
          selectFromLongPress(event);
        }, 520);
      }, { passive: false });
      row.addEventListener('touchend', clearTouchTimer);
      row.addEventListener('touchmove', () => {
        clearTouchTimer();
        if (!longPressHandled) suppressNextClick = false;
      });
      row.addEventListener('touchcancel', () => {
        clearTouchTimer();
        if (!longPressHandled) suppressNextClick = false;
      });
      row.querySelector('.library-paged-row-more')?.addEventListener('click', event => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect?.() || { left: 16, bottom: 16 };
        this.openPagedTrackContextMenu({
          preventDefault() {},
          clientX: rect.left,
          clientY: rect.bottom + 4
        }, item, { returnFocus: event.currentTarget, ordinal });
      });
      row.querySelector('.library-artist-link')?.addEventListener('click', event => {
        event.stopPropagation();
        if (artistDetail) this.navigateToDetail(artistDetail);
      });
      row.querySelector('.library-album-link')?.addEventListener('click', event => {
        event.stopPropagation();
        if (item.albumKey) {
          this.navigateToDetail({ type: 'album', key: item.albumKey, title: this.getTrackAlbumLabel(item) });
        }
      });
      const itemKey = playlistItemKey;
      row.querySelector('.library-paged-item-up')?.addEventListener('click', () => {
        this.runPagedRowCommand(row, () => this.manager.playlists.reorderItem(
          this.detail.key,
          itemKey,
          { direction: 'up' },
          { expectedVersion: item.playlistVersion }
        ), { logMessage: 'Music Library playlist reorder failed:' });
      });
      row.querySelector('.library-paged-item-down')?.addEventListener('click', () => {
        this.runPagedRowCommand(row, () => this.manager.playlists.reorderItem(
          this.detail.key,
          itemKey,
          { direction: 'down' },
          { expectedVersion: item.playlistVersion }
        ), { logMessage: 'Music Library playlist reorder failed:' });
      });
      row.querySelector('.library-paged-item-remove')?.addEventListener('click', () => {
        this.runPagedRowCommand(row, () => this.manager.playlists.removeItem(
          this.detail.key,
          itemKey,
          { expectedVersion: item.playlistVersion }
        ), { logMessage: 'Music Library playlist item removal failed:' });
      });
    } else if (isFolder) {
      const folderCaption = this.getPagedEntityCaption(item, entityType);
      row.innerHTML = `
        <button type="button" class="library-paged-folder-main">
          <span class="library-paged-folder-title">${escapeHtml(item.displayName || item.name || entityId)}</span>
          ${folderCaption ? `<span class="library-paged-folder-secondary">${escapeHtml(folderCaption)}</span>` : ''}
        </button>
        <span class="library-badge" data-folder-status></span>
        <span class="library-paged-folder-actions">
          ${(item.status === 'missing' || item.status === 'needs-permission') ? `<button type="button" class="library-button library-paged-folder-reconnect">${escapeHtml(this.t('library.action.reconnect'))}</button>` : ''}
          <button type="button" class="library-button library-paged-folder-rescan">${escapeHtml(this.t('library.action.rescan'))}</button>
          <button type="button" class="library-button library-paged-folder-remove">${escapeHtml(this.t('library.action.removeFolder'))}</button>
        </span>
      `;
      row.querySelector('.library-paged-folder-main')?.addEventListener('click', () => {
        this.dispatchPagedRowAction(row, () => this.navigateToDetail(
          this.createEntityDetail(entityType, entityId, item)
        ));
      });
      row.querySelector('.library-paged-folder-main')?.addEventListener('focus', () => {
        this.pagedFocusedOrdinal = ordinal;
        this.pagedFocusedEntityId = entityId;
      });
      row.querySelector('.library-paged-folder-rescan')?.addEventListener('click', () => {
        return this.dispatchPagedRowAction(row, () => this.handleScanFolders([entityId]))?.value;
      });
      row.querySelector('.library-paged-folder-reconnect')?.addEventListener('click', () => {
        return this.dispatchPagedRowAction(row, () => this.handleReconnectFolder(entityId))?.value;
      });
      row.querySelector('.library-paged-folder-remove')?.addEventListener('click', () => {
        return this.dispatchPagedRowAction(row, () => this.handleRemoveFolder(entityId))?.value;
      });
      row.querySelectorAll?.('.library-paged-folder-actions button').forEach(button => {
        button.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        });
      });
      this.updatePagedFolderRowState(row, item);
    } else {
      const artworkId = typeof (item.representativeTrackUid ?? item.representativeArtworkId ?? item.artworkId) === 'string'
        ? item.representativeTrackUid ?? item.representativeArtworkId ?? item.artworkId
        : '';
      const title = systemPlaylist
        ? this.getSystemPlaylistName(entityId, item.name || item.displayName)
        : item.name || item.displayName || entityId;
      const caption = this.getPagedEntityCaption(item, entityType);
      if (isMediaCard) {
        const playDisabled = this.isPagedActionBusy() ||
          typeof this.manager.performSelectionAction !== 'function';
        const artwork = systemPlaylist
          ? `<span class="library-paged-artwork library-system-playlist-artwork" aria-hidden="true"><span class="library-system-playlist-icon">${entityId === SYSTEM_PLAYLIST_IDS.recentlyPlayed ? ICONS.recent : ICONS.starFilled}</span></span>`
          : '<span class="library-paged-artwork" aria-hidden="true"><span></span></span>';
        row.innerHTML = `
          ${artwork}
          <span class="library-paged-entity-title library-card-title">${escapeHtml(title)}</span>
          <span class="library-card-subtitle">${escapeHtml(caption)}</span>
          <button type="button" class="library-paged-entity-open library-album-open" aria-label="${escapeHtml(title)}"></button>
          <button type="button" class="library-card-play" tabindex="-1" title="${escapeHtml(this.t('library.action.play'))}" aria-label="${escapeHtml(`${this.t('library.action.play')} ${title}`)}"${playDisabled ? ' disabled' : ''}>${ICONS.play}</button>
        `;
      } else {
        row.innerHTML = `
          <button type="button" class="library-paged-entity-open" aria-label="${escapeHtml(title)}">
            <span class="library-paged-artwork" aria-hidden="true"><span></span></span>
            <span class="library-paged-entity-title">${escapeHtml(title)}</span>
          </button>
        `;
      }
      if (artworkId) this.pagedArtworkLoader?.observe(row.querySelector('.library-paged-artwork'), artworkId);
      const openDetail = () => {
        const detail = { type: entityType, key: entityId, title };
        if (PAGED_ARTWORK_DETAIL_TYPES.includes(entityType) &&
            typeof item.representativeTrackUid === 'string') {
          detail.representativeTrackUid = item.representativeTrackUid;
        }
        this.navigateToDetail(detail);
      };
      const open = () => this.dispatchPagedRowAction(row, openDetail);
      const openButton = row.querySelector('.library-paged-entity-open');
      openButton?.addEventListener('focus', () => {
        this.pagedFocusedOrdinal = ordinal;
        this.pagedFocusedEntityId = entityId;
      });
      openButton?.addEventListener('click', open);
      if (isMediaCard) {
        const playButton = row.querySelector('.library-card-play');
        playButton?.addEventListener('keydown', event => event.stopPropagation());
        playButton?.addEventListener('click', event => {
          event.stopPropagation();
          this.dispatchPagedRowAction(row, () => {
            openDetail();
            return this.startPagedEntityPlay(entityType, item);
          });
        });
      }
    }
    return row;
  }

  getPagedFolderStatus(folder, scanState = undefined) {
    if (this.removingFolderIds?.has(folder.id)) {
      return {
        key: 'removingFolder',
        className: 'removing',
        busy: true,
        text: this.getFolderRemovalStatusText(folder.id)
      };
    }
    const effectiveScanState = scanState === undefined
      ? this.getTrackedFolderScanState(folder.id) ?? this.lastScanState
      : scanState;
    const affectedFolderIds = getScanStateFolderIds(effectiveScanState);
    const scanAffectsFolder = affectedFolderIds.includes(folder.id);
    if (scanAffectsFolder && effectiveScanState?.phase === 'scanning') {
      return { key: 'scanning', className: 'scanning', busy: true };
    }
    if (scanAffectsFolder && effectiveScanState?.phase === 'error') {
      return { key: 'scanError', className: 'scan-error', busy: false };
    }
    if (folder.status === 'missing' || folder.status === 'needs-permission') {
      return { key: folder.status, className: folder.status, busy: false };
    }
    if (scanAffectsFolder && effectiveScanState?.phase === 'done' &&
        ['completed', 'completed-no-sweep'].includes(effectiveScanState.status)) {
      return { key: 'ok', className: 'ok', busy: false };
    }
    const status = folder.lastScanAt === null || folder.lastScanAt === undefined
      ? 'never-scanned'
      : 'ok';
    return { key: status, className: status, busy: false };
  }

  updatePagedFolderRowState(row, folder, scanState = undefined) {
    const status = this.getPagedFolderStatus(folder, scanState);
    const badge = row?.querySelector?.('[data-folder-status]');
    if (badge) {
      badge.className = `library-badge ${status.className}`;
      badge.textContent = status.text ?? this.t(`library.state.${status.key}`);
    }
    row?.setAttribute?.('aria-busy', status.busy ? 'true' : 'false');
    for (const selector of [
      '.library-paged-folder-rescan',
      '.library-paged-folder-reconnect',
      '.library-paged-folder-remove'
    ]) {
      const button = row?.querySelector?.(selector);
      if (button) button.disabled = status.busy;
    }
  }

  refreshPagedFolderScanState() {
    this.content?.querySelectorAll?.('.library-paged-folder-row').forEach(row => {
      if (row._pagedItem) this.updatePagedFolderRowState(row, row._pagedItem);
    });
  }

  startPagedEntityPlay(entityType, entity) {
    if (!this.pagedActionController || typeof this.manager.performSelectionAction !== 'function') {
      return Promise.resolve({ kind: 'unavailable' });
    }
    const scopeKey = PAGED_CARD_SCOPE_KEYS[entityType];
    const entityId = this.getPagedEntityId(entity);
    if (!scopeKey || !entityId) return Promise.resolve({ kind: 'unavailable' });
    const targetName = entityType === 'playlist' && isSystemPlaylistId(entityId)
      ? this.getSystemPlaylistName(entityId, entity.name || entity.displayName)
      : entity.name || entity.displayName || '';
    return this.pagedActionController.track({
      operationKind: 'play',
      targetName,
      start: async () => {
        let contextToken = null;
        const releaseContext = async () => {
          if (!contextToken) return;
          const token = contextToken;
          contextToken = null;
          try {
            await this.manager.releaseContext(token);
          } catch (error) {
            console.warn('Failed to release a card playback context:', error);
          }
        };
        try {
          contextToken = await this.manager.createContext({
            endpoint: 'tracks',
            query: '',
            sort: entityType === 'album' ? 'album' : this.sort,
            direction: entityType === 'album' ? 'asc' : this.sortDirection,
            scope: { [scopeKey]: entityId }
          });
          const receipt = await this.manager.performSelectionAction('play', {
            mode: 'all',
            contextToken,
            exclusions: []
          });
          if (['started', 'active'].includes(receipt?.kind) && receipt.operationId) {
            this.pagedOperationContexts.set(receipt.operationId, contextToken);
            contextToken = null;
          } else {
            await releaseContext();
          }
          return receipt;
        } catch (error) {
          await releaseContext();
          throw error;
        }
      }
    });
  }

  startPagedTrackPlay(track, ordinal) {
    if (!this.pagedActionController || typeof this.manager.performSelectionAction !== 'function') {
      return Promise.resolve({ kind: 'unavailable' });
    }
    if (this.isPagedPlaylistItemUnresolved(track)) {
      return Promise.resolve({ kind: 'unavailable', reason: 'unresolved-playlist-item' });
    }
    const contextToken = this.pagedController?.contextToken;
    const trackUid = track?.trackUid ?? track?.id;
    if (!contextToken || !trackUid || !Number.isSafeInteger(ordinal) || ordinal < 0) {
      return Promise.resolve({ kind: 'unavailable' });
    }
    return this.trackPreparedPagedAction({
      operationKind: 'play',
      descriptor: Object.freeze({ mode: 'all', contextToken, exclusions: [] }),
      request: { options: { currentOrdinal: ordinal } },
      targetName: track.title || track.fileName || ''
    });
  }

  createPagedTrackActionIntent(track, ordinal, { allowLogicalSelection = true } = {}) {
    const entityId = this.getPagedTrackIdentity(track);
    const contextToken = this.pagedController?.contextToken;
    if (!entityId || !contextToken || !Number.isSafeInteger(ordinal) || ordinal < 0) return null;
    const liveState = this.pagedController.createViewState?.() ?? this.pagedState;
    const useLogicalSelection = allowLogicalSelection &&
      (!isMobileLayout() || this.pagedMobileSelectionActive) &&
      this.pagedController.isSelected?.(entityId, ordinal) &&
      this.getPagedSelectionProjection(liveState).hasAny;
    const descriptor = freezePagedSelectionDescriptor(useLogicalSelection
      ? this.pagedController.getSelectionDescriptor?.()
      : {
          mode: 'explicit',
          contextToken,
          trackUids: [entityId]
        });
    if (!descriptor || descriptor.contextToken !== contextToken) return null;
    const selectedOrdinal = useLogicalSelection
      ? this.pagedController.getSelectedOrdinal?.(entityId, ordinal)
      : 0;
    return Object.freeze({
      descriptor,
      currentOrdinal: Number.isSafeInteger(selectedOrdinal) && selectedOrdinal >= 0
        ? selectedOrdinal
        : null,
      targetName: track?.title || track?.fileName || ''
    });
  }

  startPagedActionIntent(intent, operationKind, request = {}) {
    if (!intent?.descriptor || !this.pagedActionController ||
        typeof this.manager.performSelectionAction !== 'function' ||
        intent.descriptor.contextToken !== this.pagedController?.contextToken) {
      return Promise.resolve({ kind: 'unavailable' });
    }
    const actionRequest = operationKind === 'play' && Number.isSafeInteger(intent.currentOrdinal)
      ? {
          ...request,
          options: { ...(request.options || {}), currentOrdinal: intent.currentOrdinal }
        }
      : request;
    return this.trackPreparedPagedAction({
      clientRequestId: isPagedPlaybackOperation(operationKind)
        ? undefined
        : this.manager.createOperationRequestId?.(),
      operationKind,
      descriptor: intent.descriptor,
      request: actionRequest,
      targetName: intent.targetName
    });
  }

  commitPagedTrackSelection(row, trackUid, ordinal, selected, { exclusive = false, extend = false } = {}) {
    const dispatched = this.dispatchPagedRowAction(row, () => {
      if (exclusive) this.pagedController.clearSelection();
      return this.pagedController.toggleSelection(trackUid, selected, { ordinal, extend });
    });
    if (dispatched?.accepted === false) return dispatched;
    if (dispatched?.value?.accepted === false) {
      this.announcePagedStatus(this.t('library.paged.selectionTooLarge'));
      return dispatched;
    }
    this.refreshPagedSelectionState();
    return dispatched;
  }

  refreshPagedSelectionState() {
    this.refreshPagedRenderedSelection();
    this.refreshPagedMobileSelectionMode();
    this.refreshPagedActionAvailability();
  }

  refreshPagedRenderedSelection() {
    this.content?.querySelectorAll?.('.library-paged-row[data-track-id]').forEach(row => {
      const entityId = row.dataset.entityId;
      const ordinal = Number(row.dataset.ordinal);
      const selected = this.pagedController.isSelected(entityId, ordinal);
      setClass(row, 'selected', selected);
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
      const checkbox = row.querySelector?.('.library-paged-select');
      if (checkbox) checkbox.checked = selected;
    });
  }

  setPagedMobileSelectionActive(active) {
    this.pagedMobileSelectionActive = Boolean(active);
    this.refreshPagedMobileSelectionMode();
  }

  getPagedSelectionProjection(state = this.pagedState) {
    const totalCount = Number.isSafeInteger(state?.totalCount)
      ? state.totalCount
      : Number.isSafeInteger(this.pagedState?.totalCount) ? this.pagedState.totalCount : null;
    if (typeof this.pagedController?.getSelectionProjection === 'function') {
      return this.pagedController.getSelectionProjection(totalCount);
    }
    if (state?.selectionProjection && typeof state.selectionProjection.hasAny === 'boolean') {
      return state.selectionProjection;
    }
    return Object.freeze({ hasAny: false, selectedCount: 0 });
  }

  usesPagedContextAction(state = this.pagedState) {
    const mobileLayout = isMobileLayout();
    if (mobileLayout && this.pagedMobileSelectionActive) return false;
    const mobileContextAction = mobileLayout;
    const wholePlaylistAction = this.detail?.type === 'playlist';
    if ((!mobileContextAction && !wholePlaylistAction) ||
        this.getPagedQuery().endpoint !== 'tracks' ||
        !this.pagedController?.contextToken) return false;
    const totalCount = state?.totalCount;
    return !Number.isSafeInteger(totalCount) || totalCount > 0;
  }

  refreshPagedMobileSelectionMode() {
    const active = isMobileLayout() && Boolean(this.pagedMobileSelectionActive);
    setClass(this.root, 'mobile-selection-mode', active);
  }

  handlePagedPlaylistItemDragStart(event, item, ordinal = null) {
    const itemKey = this.getPagedPlaylistMutationKey(item);
    const intent = this.createPagedTrackActionIntent(item, ordinal);
    if (!event.dataTransfer || itemKey === null || itemKey === undefined || !intent?.descriptor) return;
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData(PAGED_PLAYLIST_ITEM_DRAG_TYPE, JSON.stringify({
      playlistId: this.detail?.key,
      itemKey
    }));
    event.dataTransfer.setData('application/x-effetune-library-tracks', JSON.stringify({
      selectionDescriptor: intent.descriptor,
      contextToken: intent.descriptor.contextToken
    }));
    event.dataTransfer.setData('text/plain', `playlist-item:${itemKey}`);
    event.currentTarget?.classList?.add('dragging');
  }

  handlePagedPlaylistItemDragOver(event, item) {
    if (!isPagedPlaylistItemDrag(event.dataTransfer) ||
        this.getPagedPlaylistMutationKey(item) === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const row = event.currentTarget;
    this.clearPagedPlaylistDropIndicators();
    const rect = row?.getBoundingClientRect?.();
    const after = Boolean(rect && Number.isFinite(event.clientY) &&
      event.clientY > rect.top + rect.height / 2);
    row?.classList?.toggle('playlist-drop-before', !after);
    row?.classList?.toggle('playlist-drop-after', after);
    if (row?.dataset) row.dataset.playlistDropEdge = after ? 'after' : 'before';
  }

  handlePagedPlaylistItemDragLeave(event) {
    const row = event.currentTarget;
    if (row?.contains?.(event.relatedTarget)) return;
    row?.classList?.remove('playlist-drop-before', 'playlist-drop-after');
    if (row?.dataset) delete row.dataset.playlistDropEdge;
  }

  handlePagedPlaylistItemDrop(event, targetRow, targetItem) {
    if (!isPagedPlaylistItemDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const targetItemKey = this.getPagedPlaylistMutationKey(targetItem);
    const edge = targetRow?.dataset?.playlistDropEdge === 'after' ? 'after' : 'before';
    this.clearPagedPlaylistDropIndicators();
    if (targetItemKey === null || targetItemKey === undefined) return;
    let source;
    try {
      source = JSON.parse(event.dataTransfer.getData(PAGED_PLAYLIST_ITEM_DRAG_TYPE));
    } catch (_) {
      return;
    }
    if (String(source?.playlistId ?? '') !== String(this.detail?.key ?? '') ||
        source?.itemKey === null || source?.itemKey === undefined ||
        String(source.itemKey) === String(targetItemKey)) return;
    const target = edge === 'after'
      ? { afterItemKey: targetItemKey }
      : { beforeItemKey: targetItemKey };
    return this.runPagedRowCommand(targetRow, () => this.manager.playlists.reorderItem(
      this.detail.key,
      source.itemKey,
      target,
      { expectedVersion: targetItem.playlistVersion }
    ), { logMessage: 'Music Library playlist reorder failed:' });
  }

  handlePagedPlaylistItemDragEnd(event) {
    event.currentTarget?.classList?.remove('dragging');
    this.clearPagedPlaylistDropIndicators();
  }

  clearPagedPlaylistDropIndicators() {
    this.content?.querySelectorAll?.('.playlist-drop-before, .playlist-drop-after').forEach(row => {
      row.classList?.remove('playlist-drop-before', 'playlist-drop-after');
      if (row.dataset) delete row.dataset.playlistDropEdge;
    });
  }

  handlePagedTrackDragStart(event, trackUid, ordinal = null) {
    if (!event.dataTransfer || !trackUid) return;
    const descriptor = this.pagedController.getSelectionDescriptor?.();
    const liveState = this.pagedController.createViewState?.() ?? this.pagedState;
    const useLogicalSelection = this.pagedController.isSelected?.(trackUid, ordinal) &&
      this.getPagedSelectionProjection(liveState).hasAny;
    const selectionDescriptor = useLogicalSelection
      ? descriptor
      : Object.freeze({
          mode: 'explicit',
          contextToken: this.pagedController.contextToken,
          trackUids: [trackUid]
        });
    if (!selectionDescriptor?.contextToken) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-effetune-library-tracks', JSON.stringify({
      selectionDescriptor,
      contextToken: selectionDescriptor.contextToken
    }));
    event.dataTransfer.setData('text/plain', trackUid);
  }

  dispatchPagedRowAction(row, callback) {
    return this.pagedController.dispatchRowAction({
      queryGeneration: Number(row.dataset.queryGeneration),
      pageAttemptId: Number(row.dataset.pageAttemptId)
    }, callback);
  }

  runPagedRowCommand(row, callback, options = {}) {
    return this.runLibraryCommand(() => {
      const dispatched = this.dispatchPagedRowAction(row, callback);
      return dispatched?.accepted ? dispatched.value : dispatched;
    }, options);
  }

  getPagedEntityId(item) {
    return item?.albumKey ?? item?.artistKey ?? item?.genreKey ?? item?.subfolderKey ??
      item?.folderId ?? item?.playlistId ?? item?.id ?? null;
  }

  createEntityDetail(entityType, entityId, item) {
    const title = item?.displayName || item?.name || '';
    if (entityType === 'folder') {
      return { type: 'folderNode', folderId: entityId, path: '', title };
    }
    return { type: entityType, key: entityId, title };
  }

  getPagedTrackUid(item) {
    const trackUid = item?.trackUid ?? item?.id;
    return typeof trackUid === 'string' && trackUid ? trackUid : null;
  }

  isPagedPlaylistItemUnresolved(item) {
    return Boolean(
      this.detail?.type === 'playlist' &&
      (!this.getPagedTrackUid(item) || item?.metadataStatus === 'unresolved')
    );
  }

  getPagedTrackIdentity(item) {
    if (this.detail?.type === 'playlist') {
      const itemKey = item?.playlistItemKey ?? item?.itemKey;
      if (itemKey !== null && itemKey !== undefined && String(itemKey)) {
        return String(itemKey);
      }
    }
    return this.getPagedTrackUid(item);
  }

  getPagedPlaylistMutationKey(item) {
    return item?.itemKey ?? item?.playlistItemKey ?? null;
  }

  getPagedEntityCaption(item, entityType) {
    const trackCount = Number.isSafeInteger(item?.trackCount)
      ? `${item.trackCount} ${this.t('library.status.tracks')}`
      : '';
    const playlistCount = Number.isSafeInteger(item?.itemCount)
      ? `${item.itemCount} ${this.t('library.status.tracks')}`
      : '';
    if (entityType === 'album') {
      return [item?.artist, trackCount].filter(Boolean).join(' · ');
    }
    if (entityType === 'subfolder') {
      return [item?.caption, trackCount].filter(Boolean).join(' · ');
    }
    if (entityType === 'folder') {
      return [item?.path || item?.displayPath, trackCount].filter(Boolean).join(' · ');
    }
    if (entityType === 'playlist') return item?.caption || playlistCount;
    return item?.caption || trackCount;
  }

  getSystemPlaylistName(playlistId, fallback = '') {
    const labelKey = systemPlaylistLabelKey(playlistId);
    return labelKey ? this.t(labelKey) : fallback;
  }

  getPagedTitle() {
    if (this.searchEntityType) {
      return this.t(VIEW_LABELS[DETAIL_VIEW_BY_TYPE[this.searchEntityType]] || 'library.search.results');
    }
    if (this.searchQuery.trim()) return this.t('library.search.results');
    if (this.detail?.type === 'playlist' && isSystemPlaylistId(this.detail.key)) {
      return this.getSystemPlaylistName(this.detail.key, this.detail.title);
    }
    if (this.detail?.title) return this.detail.title;
    return this.t(VIEW_LABELS[this.currentView] || 'library.nav.tracks');
  }

  getNavigationSnapshot() {
    const queryFingerprint = JSON.stringify(this.getPagedQuery());
    if (this.pagedState?.phase === 'committed' && this.pagedQueryKey === queryFingerprint) {
      this.pagedContentScrollTop = Number(this.content?.scrollTop) || 0;
      this.capturePagedAnchor();
    }
    const anchor = this.pagedAnchor?.queryFingerprint === queryFingerprint
      ? { ...this.pagedAnchor }
      : null;
    const liveContentScrollTop = Number(this.content?.scrollTop);
    return {
      currentView: this.currentView,
      detail: this.detail ? { ...this.detail } : null,
      searchQuery: this.searchQuery,
      searchEntityType: this.searchEntityType,
      searchEntityReturnView: this.searchEntityReturnView,
      pagedPosition: {
        queryFingerprint,
        anchor,
        viewportOrdinal: this.pagedViewportOrdinal,
        viewportOffsetPx: this.pagedViewportOffsetPx,
        contentScrollTop: Number.isFinite(liveContentScrollTop)
          ? liveContentScrollTop
          : (this.pagedContentScrollTop || 0)
      }
    };
  }

  applyNavigationSnapshot(snapshot = {}, { folderBrowseState = null } = {}) {
    this.invalidateNavigationIntent();
    this.currentView = snapshot.currentView || 'tracks';
    this.detail = normalizeFolderDetail(snapshot.detail);
    if (this.detail?.type === 'folderNode') {
      this.restoreFolderBrowseSnapshot(
        folderBrowseState,
        createFolderNavigationKey(this.detail.folderId, this.detail.path)
      );
    }
    this.detailSortOverride = false;
    this.searchQuery = snapshot.searchQuery || '';
    this.searchEntityType = PAGED_SEARCH_ENTITY_TYPES.includes(snapshot.searchEntityType)
      ? snapshot.searchEntityType
      : null;
    this.searchEntityReturnView = snapshot.searchEntityReturnView || null;
    this.searchEntityReturnSnapshot = null;
    this.pendingPagedNavigationPosition = snapshot.pagedPosition || null;
    if (this.searchInput) this.searchInput.value = this.searchQuery;
    this.clearSelection({ keepMobileSelectionMode: false });
    this.render();
  }

  pushMobileHistory(previousSnapshot = null) {
    if (!isMobileLayout() || typeof globalThis.history?.pushState !== 'function') return;
    if (!this.mobileHistoryInitialized) {
      const currentState = globalThis.history.state;
      if (currentState?.effetuneLibrary && Number.isSafeInteger(currentState.index)) {
        this.mobileHistoryIndex = Math.max(0, currentState.index);
        this.mobileHistoryDepth = Number.isSafeInteger(currentState.depth)
          ? Math.max(0, currentState.depth)
          : Math.max(0, currentState.index);
      } else {
        this.mobileHistoryIndex = 0;
        this.mobileHistoryDepth = 0;
      }
      this.mobileHistoryInitialized = true;
    }
    if (typeof globalThis.history.replaceState === 'function') {
      const currentState = globalThis.history.state;
      globalThis.history.replaceState({
        ...(currentState || {}),
        effetuneLibrary: true,
        index: this.mobileHistoryIndex,
        depth: this.mobileHistoryDepth,
        snapshot: previousSnapshot || currentState?.snapshot || this.getNavigationSnapshot()
      }, '');
    }
    const currentIndex = Number.isSafeInteger(this.mobileHistoryIndex) ? this.mobileHistoryIndex : 0;
    const currentDepth = Number.isSafeInteger(this.mobileHistoryDepth) ? this.mobileHistoryDepth : 0;
    this.mobileHistoryIndex = currentIndex + 1;
    this.mobileHistoryDepth = currentDepth + 1;
    globalThis.history.pushState({
      effetuneLibrary: true,
      index: this.mobileHistoryIndex,
      depth: this.mobileHistoryDepth,
      snapshot: this.getNavigationSnapshot()
    }, '');
  }

  navigateToView(view, { pushHistory = true } = {}) {
    this.invalidateNavigationIntent();
    const previousSnapshot = this.getNavigationSnapshot();
    this.currentView = view || 'tracks';
    this.detail = null;
    this.detailSortOverride = false;
    this.searchQuery = '';
    this.searchEntityType = null;
    this.searchEntityReturnView = null;
    this.searchEntityReturnSnapshot = null;
    this.navigationReturnSnapshot = null;
    this.clearSelection({ keepMobileSelectionMode: false });
    if (this.searchInput) this.searchInput.value = '';
    if (pushHistory) this.pushMobileHistory(previousSnapshot);
    this.render();
  }

  navigateToDetail(detail, view = null, { pushHistory = true, folderBrowseState = null } = {}) {
    if (!detail) {
      this.navigateToView(view || this.currentView, { pushHistory });
      return;
    }
    this.invalidateNavigationIntent();
    const previousSnapshot = this.getNavigationSnapshot();
    const normalizedDetail = normalizeFolderDetail(detail);
    const staysInFolderHierarchy = this.detail?.type === 'folderNode' &&
      normalizedDetail.type === 'folderNode' && this.detail.folderId === normalizedDetail.folderId;
    if (!staysInFolderHierarchy) {
      this.navigationReturnSnapshot = previousSnapshot;
    }
    this.currentView = view || (normalizedDetail.type === 'folderNode'
      ? 'folders'
      : DETAIL_VIEW_BY_TYPE[normalizedDetail.type]) || this.currentView;
    this.detail = normalizedDetail;
    if (normalizedDetail.type === 'folderNode') {
      this.restoreFolderBrowseSnapshot(
        folderBrowseState,
        createFolderNavigationKey(normalizedDetail.folderId, normalizedDetail.path)
      );
    }
    this.detailSortOverride = false;
    this.searchQuery = '';
    this.searchEntityType = null;
    this.searchEntityReturnView = null;
    this.searchEntityReturnSnapshot = null;
    this.clearSelection({ keepMobileSelectionMode: false });
    if (this.searchInput) this.searchInput.value = '';
    if (pushHistory) this.pushMobileHistory(previousSnapshot);
    this.render();
  }

  navigateToSearchEntityResults(entityType, { pushHistory = true } = {}) {
    if (!PAGED_SEARCH_ENTITY_TYPES.includes(entityType) || !this.searchQuery.trim()) return false;
    this.invalidateNavigationIntent();
    const previousSnapshot = this.getNavigationSnapshot();
    this.searchEntityReturnSnapshot = previousSnapshot;
    this.searchEntityReturnView = this.currentView;
    this.currentView = DETAIL_VIEW_BY_TYPE[entityType];
    this.detail = null;
    this.detailSortOverride = false;
    this.searchEntityType = entityType;
    this.clearSelection({ keepMobileSelectionMode: false });
    if (this.searchInput) this.searchInput.value = this.searchQuery;
    if (pushHistory) this.pushMobileHistory(previousSnapshot);
    this.render();
    return true;
  }

  navigateBack({ fromPopState = false } = {}) {
    if (this.detail?.type === 'folderNode' && (this.searchQuery || this.searchInput?.value)) {
      this.invalidateNavigationIntent();
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
      this.searchQuery = '';
      this.searchEntityType = null;
      this.searchEntityReturnView = null;
      if (this.searchInput) this.searchInput.value = '';
      this.render();
      return true;
    }
    if (isMobileLayout() && !fromPopState && this.mobileHistoryDepth > 0 && typeof globalThis.history?.back === 'function') {
      globalThis.history.back();
      return true;
    }
    if (this.searchEntityType) {
      this.invalidateNavigationIntent();
      const returnSnapshot = this.searchEntityReturnSnapshot;
      this.currentView = returnSnapshot?.currentView || this.searchEntityReturnView || 'tracks';
      this.searchEntityType = null;
      this.searchEntityReturnView = null;
      this.searchEntityReturnSnapshot = null;
      this.pendingPagedNavigationPosition = returnSnapshot?.pagedPosition || null;
      this.detail = normalizeFolderDetail(returnSnapshot?.detail);
      this.clearSelection({ keepMobileSelectionMode: false });
      if (this.searchInput) this.searchInput.value = this.searchQuery;
      this.render();
      return true;
    }
    if (this.detail?.type === 'folderNode' && this.detail.path !== '') {
      const childPath = this.detail.path;
      const separator = childPath.lastIndexOf('/');
      const parentPath = separator < 0 ? '' : childPath.slice(0, separator);
      this.navigateToFolderPath(parentPath, { pushHistory: false });
      return true;
    }
    if (!this.detail && !this.searchQuery) return false;
    this.invalidateNavigationIntent();
    const returnSnapshot = this.navigationReturnSnapshot;
    this.detail = null;
    this.searchQuery = '';
    this.searchEntityType = null;
    this.searchEntityReturnView = null;
    this.searchEntityReturnSnapshot = null;
    this.navigationReturnSnapshot = null;
    this.pendingPagedNavigationPosition = returnSnapshot?.pagedPosition || null;
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
    const state = event.state?.effetuneLibrary ? event.state : null;
    const snapshot = state?.snapshot ?? null;
    if (!snapshot) return;
    const currentDetail = this.detail?.type === 'folderNode' ? { ...this.detail } : null;
    const clearCurrentFolderSearch = Boolean(currentDetail && (this.searchQuery || this.searchInput?.value));
    if (Number.isSafeInteger(state.index)) {
      this.mobileHistoryIndex = Math.max(0, state.index);
      this.mobileHistoryDepth = Number.isSafeInteger(state.depth)
        ? Math.max(0, state.depth)
        : this.mobileHistoryIndex;
    } else {
      this.mobileHistoryIndex = Math.max(0, (Number(this.mobileHistoryIndex) || 0) - 1);
      this.mobileHistoryDepth = Math.max(0, (Number(this.mobileHistoryDepth) || 0) - 1);
      globalThis.history?.replaceState?.({
        ...state,
        effetuneLibrary: true,
        index: this.mobileHistoryIndex,
        depth: this.mobileHistoryDepth,
        snapshot
      }, '');
    }
    if (clearCurrentFolderSearch) {
      this.invalidateNavigationIntent();
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
      this.searchQuery = '';
      this.searchEntityType = null;
      this.searchEntityReturnView = null;
      if (this.searchInput) this.searchInput.value = '';
      this.render();
      this.mobileHistoryIndex += 1;
      this.mobileHistoryDepth += 1;
      globalThis.history?.pushState?.({
        effetuneLibrary: true,
        index: this.mobileHistoryIndex,
        depth: this.mobileHistoryDepth,
        snapshot: this.getNavigationSnapshot()
      }, '');
      return;
    }
    const targetDetail = normalizeFolderDetail(snapshot.detail);
    this.saveCurrentFolderNavigationPosition();
    const targetKey = targetDetail?.type === 'folderNode'
      ? createFolderNavigationKey(targetDetail.folderId, targetDetail.path)
      : null;
    const targetFolderBrowseState = targetKey
      ? this.folderNavigationPositions.get(targetKey)?.folderBrowseState ?? null
      : null;
    if (currentDetail && targetDetail?.type === 'folderNode' &&
        currentDetail.folderId === targetDetail.folderId) {
      const separator = currentDetail.path.lastIndexOf('/');
      const parentPath = separator < 0 ? '' : currentDetail.path.slice(0, separator);
      if (targetDetail.path === parentPath) this.pendingFolderFocusPath = currentDetail.path;
    }
    this.applyNavigationSnapshot(snapshot, { folderBrowseState: targetFolderBrowseState });
  }

  async openPagedAddToPlaylistMenu(anchor, state, actionIntent = null) {
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
    const dispatch = (playlistId, expectedTargetVersion, name = '') => {
      const request = { target: { playlistId, name }, expectedTargetVersion };
      return actionIntent
        ? this.startPagedActionIntent(actionIntent, 'addToPlaylist', request)
        : this.startPagedSelectionAction(state, 'addToPlaylist', request);
    };
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
    menu.querySelector('.library-playlist-menu-new')?.addEventListener('click', () => {
      this.runLibraryCommand(async () => {
        const name = await this.promptText('library.prompt.playlistName', this.t('library.action.newPlaylist'));
        if (!name || !this.isCurrentPagedAttempt(state)) return;
        const playlist = await this.manager.playlists.create(name);
        const playlistId = playlist?.playlistId ?? playlist?.id;
        const version = playlist?.version ?? (playlistId ? (await this.manager.playlists.get(playlistId))?.version : null);
        if (playlistId && Number.isSafeInteger(version)) dispatch(playlistId, version, name);
        this.closePlaylistMenu();
      }, { logMessage: 'Music Library playlist creation failed:' });
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
    this.preserveContentScroll(() => {
      actionBar?.after?.(menu);
      if (!menu.parentNode) this.content.appendChild(menu);
      this.playlistMenu = menu;
      this.focusWithoutContentScroll(menu.querySelector('.library-playlist-picker-search'));
    });
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
    try {
      await openQuery('');
    } catch (error) {
      if (!closed) {
        this.closePlaylistMenu();
        this.reportActionFailure(error);
      }
    }
  }

  closePlaylistMenu(options = {}) {
    const { restoreFocus = true, flushPendingBreakpointRebuild = true } = options || {};
    const returnFocus = this.playlistMenuReturnFocus;
    this.preserveContentScroll(() => {
      this.playlistMenuCleanup?.();
      this.playlistMenuCleanup = null;
      removeElement(this.playlistMenu);
      this.playlistMenu = null;
      this.playlistMenuReturnFocus = null;
      if (restoreFocus) {
        getRestorableFocusElement(returnFocus)?.focus?.({ preventScroll: true });
      }
    });
    if (flushPendingBreakpointRebuild) this.flushPendingBreakpointRebuild();
  }

  refreshRenderedFavoriteStates() {
    this.content?.querySelectorAll?.('[data-favorite-track-id]').forEach(button => {
      const trackUid = button.dataset.favoriteTrackId;
      const favorite = this.favoriteTrackUids.has(trackUid);
      button.setAttribute('aria-pressed', favorite ? 'true' : 'false');
      const label = this.t(favorite ? 'library.action.removeFavorite' : 'library.action.addFavorite');
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = favorite ? ICONS.starFilled : ICONS.star;
      setClass(button, 'is-favorite', favorite);
    });
  }

  async setFavoriteTrackUids(trackUids, favorite) {
    this.favoriteTrackUids ??= new Set();
    const uniqueTrackUids = [...new Set(trackUids.filter(trackUid => (
      typeof trackUid === 'string' && trackUid
    )))];
    if (uniqueTrackUids.length === 0) return { kind: 'noop' };
    this.favoriteMutationDepth = (this.favoriteMutationDepth ?? 0) + 1;
    try {
      const previous = new Map(uniqueTrackUids.map(trackUid => [
        trackUid,
        this.favoriteTrackUids.has(trackUid)
      ]));
      for (const trackUid of uniqueTrackUids) {
        if (favorite) this.favoriteTrackUids.add(trackUid);
        else this.favoriteTrackUids.delete(trackUid);
      }
      this.refreshRenderedFavoriteStates();
      const failures = [];
      for (const trackUid of uniqueTrackUids) {
        try {
          const result = await this.manager.playlists.setTrackFavorite(trackUid, favorite);
          if (result?.kind === 'busy') {
            const error = new Error('Favorites is busy');
            error.code = 'playlistBusy';
            failures.push(error);
            if (previous.get(trackUid)) this.favoriteTrackUids.add(trackUid);
            else this.favoriteTrackUids.delete(trackUid);
          }
        } catch (error) {
          failures.push(error);
          if (previous.get(trackUid)) this.favoriteTrackUids.add(trackUid);
          else this.favoriteTrackUids.delete(trackUid);
        }
      }
      this.refreshRenderedFavoriteStates();
      if (failures.length > 0) throw failures[0];
      return { kind: favorite ? 'favorited' : 'unfavorited', count: uniqueTrackUids.length };
    } finally {
      this.favoriteMutationDepth = Math.max(0, (this.favoriteMutationDepth ?? 1) - 1);
      if (this.favoriteMutationDepth === 0) {
        await this.refreshFavoriteTrackUids();
        this.flushDeferredCatalogInvalidation();
      }
    }
  }

  async resolveFavoriteActionTrackUids(intent, track) {
    const fallbackTrackUid = this.getPagedTrackUid(track);
    const descriptor = intent?.descriptor;
    const currentIdentity = this.getPagedTrackIdentity(track);
    if (!descriptor || descriptor.contextToken !== this.pagedController?.contextToken) {
      return fallbackTrackUid ? [fallbackTrackUid] : [];
    }
    if (descriptor.mode === 'explicit' && descriptor.trackUids?.length === 1 &&
        descriptor.trackUids[0] === currentIdentity) {
      return fallbackTrackUid ? [fallbackTrackUid] : [];
    }
    const rows = [];
    const limit = 500;
    const totalCount = Number.isSafeInteger(this.pagedState?.totalCount)
      ? this.pagedState.totalCount
      : null;
    for (let ordinal = 0; ; ordinal += limit) {
      if (totalCount !== null && ordinal >= totalCount) break;
      const page = await this.manager.readContextPageAtOrdinal({
        contextToken: descriptor.contextToken,
        ordinal,
        limit
      });
      const pageRows = Array.isArray(page?.rows) ? page.rows : [];
      rows.push(...pageRows.map(item => ({
        identity: this.getPagedTrackIdentity(item),
        trackUid: this.getPagedTrackUid(item)
      })));
      if (pageRows.length < limit) break;
    }
    const exclusions = new Set(descriptor.exclusions ?? []);
    const inclusions = new Set(descriptor.inclusions ?? []);
    const explicit = new Set(descriptor.trackUids ?? []);
    let rangeStart = -1;
    let rangeEnd = -1;
    if (descriptor.mode === 'range') {
      const first = rows.findIndex(row => row.identity === descriptor.startUid);
      const last = rows.findIndex(row => row.identity === descriptor.endUid);
      if (first >= 0 && last >= 0) {
        rangeStart = Math.min(first, last);
        rangeEnd = Math.max(first, last);
      }
    }
    return [...new Set(rows.flatMap((row, index) => {
      if (!row.trackUid) return [];
      const selected = descriptor.mode === 'all'
        ? !exclusions.has(row.identity)
        : descriptor.mode === 'range'
          ? (inclusions.has(row.identity) || index >= rangeStart && index <= rangeEnd) &&
            !exclusions.has(row.identity)
          : explicit.has(row.identity);
      return selected ? [row.trackUid] : [];
    }))];
  }

  openPagedTrackContextMenu(event, track, context = {}) {
    event.preventDefault();
    this.closeContextMenu();
    const trackUid = this.getPagedTrackUid(track);
    const ordinal = Number.isSafeInteger(context.ordinal)
      ? context.ordinal
      : Number(context.returnFocus?.dataset?.ordinal);
    const viewState = this.pagedController?.createViewState?.() ?? this.pagedState;
    const actionIntent = this.createPagedTrackActionIntent(track, ordinal);
    const canRunSelectionAction = Boolean(
      !this.isPagedActionBusy() &&
      !this.isPagedPlaylistItemUnresolved(track) &&
      actionIntent && typeof this.manager?.performSelectionAction === 'function'
    );
    const disabled = canRunSelectionAction ? '' : ' disabled';
    const playDisabled = canRunSelectionAction && Number.isSafeInteger(actionIntent.currentOrdinal)
      ? ''
      : ' disabled';
    const artistDetail = this.getTrackArtistDetail(track);
    const canShowInFolder = Boolean(trackUid && typeof this.manager?.showTrackInFolder === 'function');
    const canFavorite = Boolean(trackUid && !this.isPagedPlaylistItemUnresolved(track));
    const favorite = canFavorite && this.favoriteTrackUids?.has(trackUid) === true;
    const menu = document.createElement('div');
    menu.className = 'library-context-menu';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${Math.max(4, event.clientX || 0)}px`;
    menu.style.top = `${Math.max(4, event.clientY || 0)}px`;
    menu.innerHTML = `
      <button type="button" role="menuitem" data-action="play"${playDisabled}>${ICONS.play}<span>${escapeHtml(this.t('library.action.play'))}</span></button>
      <button type="button" role="menuitem" data-action="next"${disabled}>${ICONS.next}<span>${escapeHtml(this.t('library.action.playNext'))}</span></button>
      <button type="button" role="menuitem" data-action="queue"${disabled}>${ICONS.queue}<span>${escapeHtml(this.t('library.action.addToQueue'))}</span></button>
      <button type="button" role="menuitem" data-action="playlist"${disabled}>${ICONS.add}<span>${escapeHtml(this.t('library.action.addToPlaylist'))}</span></button>
      <button type="button" role="menuitem" data-action="favorite"${canFavorite ? '' : ' disabled'}>${favorite ? ICONS.starFilled : ICONS.star}<span>${escapeHtml(this.t(favorite ? 'library.action.removeFavorite' : 'library.action.addFavorite'))}</span></button>
      <hr>
      <button type="button" role="menuitem" data-action="album"${track?.albumKey ? '' : ' disabled'}><span>${escapeHtml(this.t('library.action.goToAlbum'))}</span></button>
      <button type="button" role="menuitem" data-action="artist"${artistDetail ? '' : ' disabled'}><span>${escapeHtml(this.t('library.action.goToArtist'))}</span></button>
      ${canShowInFolder ? `<button type="button" role="menuitem" data-action="folder"><span>${escapeHtml(this.t('library.action.showInFolder'))}</span></button>` : ''}
      <button type="button" role="menuitem" data-action="properties"><span>${escapeHtml(this.t('library.action.properties'))}</span></button>
    `;
    const startAction = operationKind => {
      if (canRunSelectionAction) this.startPagedActionIntent(actionIntent, operationKind);
      this.closeContextMenu();
    };
    menu.querySelector('[data-action="play"]')?.addEventListener('click', () => startAction('play'));
    menu.querySelector('[data-action="next"]')?.addEventListener('click', () => startAction('playNext'));
    menu.querySelector('[data-action="queue"]')?.addEventListener('click', () => startAction('queue'));
    menu.querySelector('[data-action="playlist"]')?.addEventListener('click', () => {
      const returnFocus = this.contextMenuReturnFocus;
      this.closeContextMenu({ restoreFocus: false, flushPendingBreakpointRebuild: false });
      if (canRunSelectionAction) {
        this.runLibraryCommand(
          () => this.openPagedAddToPlaylistMenu(returnFocus, viewState, actionIntent),
          { logMessage: 'Music Library playlist menu failed:' }
        );
      }
    });
    menu.querySelector('[data-action="favorite"]')?.addEventListener('click', () => {
      const desired = !favorite;
      this.closeContextMenu();
      if (!canFavorite) return;
      this.runLibraryCommand(async () => {
        const trackUids = await this.resolveFavoriteActionTrackUids(actionIntent, track);
        return this.setFavoriteTrackUids(trackUids, desired);
      }, { logMessage: 'Music Library favorite update failed:' });
    });
    menu.querySelector('[data-action="album"]')?.addEventListener('click', () => {
      this.closeContextMenu();
      if (track?.albumKey) {
        this.navigateToDetail({ type: 'album', key: track.albumKey, title: this.getTrackAlbumLabel(track) });
      }
    });
    menu.querySelector('[data-action="artist"]')?.addEventListener('click', () => {
      this.closeContextMenu();
      if (artistDetail) this.navigateToDetail(artistDetail);
    });
    menu.querySelector('[data-action="folder"]')?.addEventListener('click', () => {
      this.runLibraryCommand(async () => {
        await this.manager.showTrackInFolder(trackUid);
        this.closeContextMenu();
      }, { logMessage: 'Music Library show-in-folder command failed:' });
    });
    menu.querySelector('[data-action="properties"]')?.addEventListener('click', () => {
      const returnFocus = this.contextMenuReturnFocus;
      this.closeContextMenu({ restoreFocus: false, flushPendingBreakpointRebuild: false });
      return this.showTrackProperties(track, { returnFocus });
    });
    this.presentContextMenu(menu, event, context);
  }

  presentContextMenu(menu, event, context = {}) {
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
    this.focusWithoutContentScroll(menu.querySelector('button:not(:disabled)'));
  }

  async showTrackProperties(track, options = {}) {
    const intentId = this.beginNavigationIntent();
    let details = track;
    let playbackSource = null;
    const trackUid = track?.trackUid ?? track?.id;
    if (trackUid && typeof this.manager.getTrack === 'function') {
      try {
        details = { ...track, ...(await this.manager.getTrack(trackUid) || {}) };
        if (!this.isNavigationIntentCurrent(intentId)) return false;
        const runtime = this.manager.getRuntimeStatus?.().runtime ?? this.manager.runtime;
        if ((!details.path || isCueTrackDetails(details)) && runtime === 'electron' &&
            typeof this.manager.resolvePlaybackSource === 'function') {
          playbackSource = await this.manager.resolvePlaybackSource(trackUid);
          if (!this.isNavigationIntentCurrent(intentId)) return false;
          details = {
            ...details,
            ...(playbackSource?.path ? { path: playbackSource.path } : {}),
            startFrame: details.startFrame ?? playbackSource?.startFrame,
            endFrame: details.endFrame ?? playbackSource?.endFrame
          };
        }
      } catch (error) {
        if (!this.isNavigationIntentCurrent(intentId)) return false;
        console.warn('Unable to load complete track properties:', error);
      }
    }
    if (!this.isNavigationIntentCurrent(intentId)) return false;
    const folder = typeof this.manager.getFolders === 'function'
      ? this.manager.getFolders().find(item => item.id === details.folderId)
      : null;
    const path = details.path || (folder?.path
      ? joinDisplayPath(folder.path, details.relativePath)
      : (details.relativePath || details.fileName || ''));
    const cueTrack = isCueTrackDetails(details);
    const cuePath = cueTrack && details.cueRelativePath
      ? (folder?.path
          ? joinDisplayPath(folder.path, details.cueRelativePath)
          : details.cueRelativePath)
      : '';
    const rows = [
      ['library.properties.title', details.title],
      ['library.properties.artist', details.artist || details.albumArtist],
      ['library.properties.album', details.album],
      ['library.properties.genre', details.genre],
      ['library.properties.year', details.year],
      ['library.properties.track', formatTrackNumber(details)],
      ['library.properties.duration', formatDuration(details.durationSec)],
      ...(cueTrack ? [
        ['library.properties.sourceType', this.t('library.properties.cueTrack')],
        ['library.properties.cuePath', cuePath],
        ['library.properties.sourcePath', path],
        ['library.properties.region', formatCueTrackRegion(
          details.startFrame,
          details.endFrame,
          this.t('library.properties.sourceEnd')
        )]
      ] : []),
      ['library.properties.file', details.fileName],
      ...(!cueTrack ? [['library.properties.path', path]] : []),
      ['library.properties.format', details.codec || details.format || details.container],
      ['library.properties.sampleRate', formatNumber(details.sampleRate, ' Hz')],
      ['library.properties.bitDepth', formatNumber(details.bitsPerSample || details.bitDepth, ' bit')],
      ['library.properties.bitrate', formatNumber(details.bitrate ? Math.round(details.bitrate / 1000) : null, ' kbps')]
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
    restoreDialogFocus = setupModalFocus(
      backdrop,
      backdrop.querySelector('.library-dialog-close'),
      options.returnFocus,
      this.content
    );
    return true;
  }

  closeContextMenu(options = {}) {
    const { restoreFocus = true, flushPendingBreakpointRebuild = true } = options || {};
    const returnFocus = this.contextMenuReturnFocus;
    this.preserveContentScroll(() => {
      this.contextMenuCleanup?.();
      this.contextMenuCleanup = null;
      removeElement(this.contextMenu);
      this.contextMenu = null;
      this.contextMenuReturnFocus = null;
      if (restoreFocus) returnFocus?.focus?.({ preventScroll: true });
    });
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
      this.focusWithoutContentScroll(next);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation?.();
      if (!items.length) return;
      const step = event.shiftKey ? -1 : 1;
      const next = items[(index + step + items.length) % items.length] || items[0];
      this.focusWithoutContentScroll(next);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation?.();
      this.focusWithoutContentScroll(event.key === 'Home' ? items[0] : items.at(-1));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation?.();
      (items[index] || document.activeElement)?.click?.();
    }
  }

  clearSelection({ keepMobileSelectionMode = false } = {}) {
    this.pagedController?.clearSelection?.();
    if (!keepMobileSelectionMode) this.pagedMobileSelectionActive = false;
    this.refreshPagedMobileSelectionMode();
    this.renderStatus();
  }

  refreshRenderedNowPlaying() {
    this.content?.querySelectorAll?.('.library-paged-row[data-track-id]').forEach(row => {
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
    if (event.key === 'Escape' && this.handleLibraryEscape(event)) {
      event.stopPropagation?.();
      return;
    }
    if (event.key === 'Backspace' && this.detail?.type === 'folderNode' && !isTextEditingTarget(event.target)) {
      event.preventDefault();
      this.navigateBack();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'f') {
      event.preventDefault();
      this.searchInput?.focus();
      this.searchInput?.select?.();
      return;
    }
    const pagedRowTarget = event.target?.closest?.('.library-paged-row');
    const interactiveTarget = event.target?.closest?.(
      'button, a, input, select, textarea, [contenteditable="true"], [role="menuitem"]'
    );
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'a') {
      if (isTextEditingTarget(event.target)) return;
      if (isMobileLayout()) return;
      if (this.pagedState?.phase === 'committed') {
        event.preventDefault();
        this.pagedController.selectAll();
        this.refreshPagedSelectionState();
      }
      return;
    }
    const entityOpenTarget = event.target?.closest?.('.library-paged-entity-open');
    const entityRovingKey = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key) ||
      (event.key?.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey);
    if (interactiveTarget && interactiveTarget !== pagedRowTarget &&
        !(entityOpenTarget && pagedRowTarget && entityRovingKey)) return;
    if (this.pagedState?.phase === 'committed') {
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        this.runPagedKeyboardCommand(event, () => (
          this.seekPagedBoundary(event.key, { extend: event.shiftKey === true })
        ));
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        const pageRows = Math.max(1, Math.floor((this.content?.clientHeight || 480) / this.getTrackRowHeight()));
        const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 :
          event.key === 'PageDown' ? pageRows : -pageRows;
        this.runPagedKeyboardCommand(event, () => (
          this.movePagedFocus(delta, { extend: event.shiftKey === true })
        ));
        return;
      }
      if (event.key === ' ' && this.getPagedQuery().endpoint === 'tracks') {
        event.preventDefault();
        this.togglePagedFocusedSelection({ extend: event.shiftKey === true });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const operationKind = event.ctrlKey || event.metaKey
          ? 'queue'
          : event.shiftKey ? 'playNext' : 'play';
        this.runPagedKeyboardCommand(event, () => this.activatePagedFocused(operationKind));
        return;
      }
    }
    if (event.key === 'ArrowLeft' && (this.detail || this.searchEntityType) &&
        !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.navigateBack();
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
      this.runPagedKeyboardCommand(event, () => this.focusPagedByPrefix(event.key));
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      if (this.getPagedQuery().endpoint !== 'tracks') return;
      const trackId = this.pagedFocusedEntityId || this.renderedPageTrackIds[0];
      const returnFocus = trackId
        ? this.content?.querySelector?.(`.library-paged-row[data-entity-id="${cssEscape(trackId)}"]`)
        : null;
      const track = returnFocus?._pagedItem || null;
      if (!track) return;
      event.preventDefault();
      const rect = returnFocus.getBoundingClientRect?.() ||
        this.content?.getBoundingClientRect?.() || { left: 16, top: 16 };
      this.openPagedTrackContextMenu({
        preventDefault() {},
        clientX: rect.left + 24,
        clientY: (rect.top ?? 16) + 24
      }, track, { returnFocus, ordinal: Number(returnFocus.dataset.ordinal) });
    }
  }

  handleGlobalLibraryKeyDown(event) {
    if (!document.body?.classList.contains('view-library')) return;
    if (event.key === 'Escape' && this.handleLibraryEscape(event)) {
      event.stopImmediatePropagation?.();
      return;
    }
    if (isEditableTarget(event.target)) return;
    if (event.key === '/' || ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'f')) {
      event.preventDefault();
      this.searchInput?.focus();
      this.searchInput?.select?.();
    }
  }

  handleLibraryEscape(event) {
    const dialog = getActiveLibraryDialogBackdrop();
    if (dialog) {
      const close = dialog.querySelector?.('.library-dialog-close, .library-prompt-cancel');
      if (!close) return false;
      event.preventDefault?.();
      close.click?.();
      return true;
    }
    if (this.contextMenu) {
      event.preventDefault?.();
      this.closeContextMenu();
      return true;
    }
    if (this.playlistMenu) {
      event.preventDefault?.();
      this.closePlaylistMenu();
      return true;
    }
    if (this.getPagedSelectionProjection().hasAny || this.pagedMobileSelectionActive) {
      event.preventDefault?.();
      this.clearSelection({ keepMobileSelectionMode: false });
      if (this.pagedState?.phase === 'committed') {
        this.refreshPagedSelectionState();
      }
      return true;
    }
    if (this.searchEntityType) {
      event.preventDefault?.();
      this.navigateBack();
      return true;
    }
    if (this.searchQuery || this.searchInput?.value) {
      event.preventDefault?.();
      this.invalidateNavigationIntent();
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
      this.searchQuery = '';
      this.searchEntityType = null;
      this.searchEntityReturnView = null;
      if (this.searchInput) this.searchInput.value = '';
      this.render();
      return true;
    }
    if (this.detail) {
      event.preventDefault?.();
      this.navigateBack();
      return true;
    }
    return false;
  }

  dispatchPagedKeyboardAction(event, callback) {
    const row = event?.target?.closest?.('.library-paged-row');
    if (row) return this.dispatchPagedRowAction(row, callback);
    if (!this.pagedController) return { accepted: true, value: callback() };
    return this.pagedController.dispatchRowAction(this.pagedController.createViewState(), callback);
  }

  runPagedKeyboardCommand(event, callback) {
    return this.runLibraryCommand(async () => {
      let result = this.dispatchPagedKeyboardAction(event, callback);
      while (result?.accepted === true && Object.prototype.hasOwnProperty.call(result, 'value')) {
        result = await result.value;
      }
      return result;
    }, {
      logMessage: 'Music Library keyboard command failed:'
    });
  }

  async seekPagedBoundary(key, { extend = false } = {}) {
    const intentId = this.navigationIntentId;
    const controller = this.pagedController;
    const result = await (key === 'Home' ? controller?.home() : controller?.end());
    if (!this.isNavigationIntentCurrent(intentId) || controller !== this.pagedController) {
      return { accepted: false, reason: 'stale-page' };
    }
    if (!result?.accepted) return result;
    const ordinal = Number.isSafeInteger(result.ordinal)
      ? result.ordinal
      : key === 'Home' ? 0 : this.pagedViewportOrdinal;
    this.pagedViewportOrdinal = ordinal;
    const item = this.pagedController.getCachedRows(ordinal, ordinal + 1)[0]?.row;
    if (item) {
      const entityId = this.getPagedQuery().endpoint === 'tracks'
        ? this.getPagedTrackIdentity(item)
        : this.getPagedEntityId(item);
      this.pagedFocusedOrdinal = ordinal;
      this.pagedFocusedEntityId = entityId;
      this.pagedPendingFocusKey = entityId;
      if (extend && this.getPagedQuery().endpoint === 'tracks') {
        this.pagedController.toggleSelection(entityId, true, { ordinal, extend: true });
      }
    }
    this.pagedViewportOffsetPx = 0;
    this.pagedScrollToAnchorOnCommit = true;
    this.renderPagedCommitted(this.pagedController.createViewState());
    return result;
  }

  async movePagedFocus(delta, { extend = false } = {}) {
    const intentId = this.navigationIntentId;
    const controller = this.pagedController;
    const total = this.pagedState?.totalCount;
    const maximum = Number.isSafeInteger(total) && total > 0 ? total - 1 : Number.MAX_SAFE_INTEGER;
    const ordinal = Math.max(0, Math.min(maximum, this.pagedFocusedOrdinal + delta));
    const result = await controller.ensureOrdinal(ordinal);
    if (!this.isNavigationIntentCurrent(intentId) || controller !== this.pagedController) {
      return { accepted: false, reason: 'stale-page' };
    }
    if (!result?.accepted) return result;
    const item = this.pagedController.getCachedRows(ordinal, ordinal + 1)[0]?.row;
    if (!item) return { accepted: false, reason: 'row-not-cached' };
    const isTrack = this.getPagedQuery().endpoint === 'tracks';
    const entityId = isTrack ? this.getPagedTrackIdentity(item) : this.getPagedEntityId(item);
    this.pagedFocusedOrdinal = ordinal;
    this.pagedFocusedEntityId = entityId;
    this.pagedViewportOrdinal = ordinal;
    this.pagedPendingFocusKey = entityId;
    if (extend && isTrack) {
      this.pagedController.toggleSelection(entityId, true, { ordinal, extend: true });
    }
    this.pagedScrollToAnchorOnCommit = true;
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
    this.refreshPagedSelectionState();
    return result;
  }

  activatePagedFocused(operationKind = 'play') {
    const item = this.pagedController.getCachedRows(
      this.pagedFocusedOrdinal,
      this.pagedFocusedOrdinal + 1
    )[0]?.row;
    if (!item) return { accepted: false, reason: 'row-not-focused' };
    const identity = this.pagedController.createViewState();
    if (this.getPagedQuery().endpoint === 'tracks') {
      return this.pagedController.dispatchRowAction(identity, () => (
        this.isPagedPlaylistItemUnresolved(item)
          ? Promise.resolve({ kind: 'unavailable', reason: 'unresolved-playlist-item' })
          : this.startPagedActionIntent(
              this.createPagedTrackActionIntent(item, this.pagedFocusedOrdinal, {
                allowLogicalSelection: false
              }),
              operationKind
            )
      ));
    }
    const entityId = this.getPagedEntityId(item);
    const entityType = this.getPagedQuery().entityType;
    return this.pagedController.dispatchRowAction(identity, () => this.navigateToDetail(
      this.createEntityDetail(entityType, entityId, item)
    ));
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
    const intentId = this.navigationIntentId;
    const controller = this.pagedController;
    const result = await controller?.typeJump(this.typeJumpBuffer);
    if (!this.isNavigationIntentCurrent(intentId) || controller !== this.pagedController) {
      return { accepted: false, reason: 'stale-page' };
    }
    if (!result?.accepted) return result;
    if (Number.isSafeInteger(result.ordinal)) this.pagedViewportOrdinal = result.ordinal;
    this.pagedViewportOffsetPx = 0;
    this.pagedScrollToAnchorOnCommit = true;
    const item = Number.isSafeInteger(result.ordinal)
      ? this.pagedController.getCachedRows(result.ordinal, result.ordinal + 1)[0]?.row
      : null;
    const focusKey = item && this.getPagedQuery().endpoint === 'tracks'
      ? this.getPagedTrackIdentity(item)
      : result.focusKey ?? null;
    this.pagedPendingFocusKey = focusKey;
    if (focusKey) {
      this.pagedFocusedOrdinal = result.ordinal;
      this.pagedFocusedEntityId = focusKey;
    }
    this.renderPagedCommitted(this.pagedController.createViewState());
    return result;
  }

  async handleImportPlaylist() {
    try {
      const file = await this.pickPagedPlaylistFile();
      if (!file) return;
      await this.importPagedPlaylistSource(file);
    } catch (error) {
      this.reportActionFailure(error);
    }
  }

  async importPagedPlaylistSource(source) {
    const preview = await this.manager.playlists.previewImport(source);
    let confirmed;
    try {
      confirmed = this.confirmPlaylistImport(preview);
    } catch (error) {
      try {
        await this.manager.playlists.cancelImportPreview(preview);
      } catch (cancelError) {
        console.error('Music Library playlist import preview cancellation failed:', cancelError);
      }
      throw error;
    }
    if (!confirmed) {
      await this.manager.playlists.cancelImportPreview(preview);
      return null;
    }
    let result;
    try {
      result = await this.manager.playlists.commitImport(preview);
    } catch (error) {
      try {
        await this.manager.playlists.cancelImportPreview(preview);
      } catch (cancelError) {
        console.error('Music Library playlist import preview cancellation failed:', cancelError);
      }
      throw error;
    }
    const playlistId = result?.playlistId ?? result?.playlist?.playlistId ?? result?.playlist?.id ?? preview.playlistId;
    if (playlistId) {
      this.navigateToDetail({
        type: 'playlist',
        key: playlistId,
        title: result?.playlistName ?? result?.playlist?.name ?? preview.playlistName
      }, 'playlists');
    }
    return result;
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
      const unresolved = preview.unresolvedItems.slice(0, 5).map(item => (
        item.label || item.entry?.path || item.entry?.sourceLine || item.entry?.title || ''
      ));
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
      const grantDroppedImport = globalThis.window?.electronAPI?.libraryCatalogV1?.grantDroppedPlaylistImport;
      const grantResult = grantDroppedImport ? await grantDroppedImport(playlistFile) : null;
      if (grantDroppedImport && !grantResult?.source) {
        throw new Error(grantResult?.error || 'Failed to authorize the dropped playlist.');
      }
      const source = grantResult?.source ?? playlistFile;
      await this.importPagedPlaylistSource(source);
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
    return this.pickBrowserPlaylistFile();
  }

  async pickBrowserPlaylistFile() {
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
      return await picked;
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
      const sink = await this.createPagedPlaylistExportSink({ fileName, dialogTitle, filters });
      if (!sink) return;
      const result = await this.manager.playlists.exportToSink(playlist.id ?? playlist.playlistId, {
        format,
        relative: this.shouldExportRelativePaths(),
        sink
      });
      if (Number.isSafeInteger(result?.skippedCueCount) && result.skippedCueCount > 0) {
        const message = this.t('library.paged.exportSkippedCueTracks', {
          count: result.skippedCueCount
        });
        this.uiManager?.setError?.(message, false);
        this.announcePagedStatus(message);
      }
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
      let handle;
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: filters[0].name, accept: { 'text/plain': filters[0].extensions.map(value => `.${value}`) } }]
        });
      } catch (error) {
        if (error?.name === 'AbortError') return null;
        throw error;
      }
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
      restoreDialogFocus = setupModalFocus(backdrop, input, null, this.content);
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

  applyTrackSort(sort) {
    if (!TRACK_SORT_COLUMNS.some(column => column.key === sort)) return;
    this.sortDirection = this.sort === sort && this.sortDirection === 'asc' ? 'desc' : 'asc';
    this.sort = sort;
    this.saveUIState();
    if (this.detail?.type === 'album') this.detailSortOverride = true;
    this.render();
  }

  getTrackRowHeight() {
    return document.body?.classList.contains('layout-mobile') ? 56 : 40;
  }

  emptyState(message, withAction = false) {
    const empty = document.createElement('div');
    empty.className = 'library-empty';
    empty.innerHTML = `
      <div class="library-empty-icon" aria-hidden="true"></div>
      <h2>${escapeHtml(message)}</h2>
      ${withAction ? `<button type="button" class="library-button library-empty-add">${ICONS.add}<span>${escapeHtml(this.t('library.action.addFolder'))}</span></button>` : ''}
    `;
    empty.querySelector('.library-empty-add')?.addEventListener('click', () => {
      this.runLibraryCommand(() => this.handleAddFolder(), { logMessage: 'Music Library folder add failed:' });
    });
    return empty;
  }

  async handleAddFolder() {
    try {
      const result = await this.manager.addFolder();
      if (result?.rejected) {
        this.reportFolderRejection(result);
        return false;
      }
      if (result && result.canceled !== true) {
        this.navigateToView('tracks');
        return true;
      }
      return false;
    } catch (error) {
      this.reportActionFailure(error);
    }
  }

  async handleScanFolders(folderIds = null) {
    try {
      return await this.manager.scanFolders({
        folderIds: Array.isArray(folderIds) ? folderIds : null,
        scanReason: 'explicit-rescan'
      });
    } catch (error) {
      this.reportActionFailure(error);
      return null;
    }
  }

  async handleReconnectFolder(folderId) {
    try {
      const result = await this.manager.requestFolderAccess(folderId);
      if (!result || result.canceled === true) return false;
      if (result.rejected) {
        this.reportFolderRejection(result);
        return false;
      }
      if (!result.scan) await this.handleScanFolders([folderId]);
      return true;
    } catch (error) {
      this.reportActionFailure(error);
      return false;
    }
  }

  reportFolderRejection(result) {
    const candidateName = result?.candidate?.displayName || this.t('library.nav.folders');
    const existingName = result?.existing?.displayName || this.t('library.nav.folders');
    const key = result?.reason === 'descendant-root'
      ? 'library.error.folderInsideExisting'
      : 'library.error.folderAlreadyAdded';
    this.uiManager?.setError?.(this.t(key, { name: candidateName, existing: existingName }), true);
  }

  async handleRemoveFolder(folderId) {
    if (typeof confirm === 'function' && !confirm(this.t('library.confirm.removeFolder'))) return false;
    this.removingFolderIds ??= new Set();
    this.folderRemovalProgress ??= new Map();
    if (this.removingFolderIds.has(folderId)) return false;
    this.removingFolderIds.add(folderId);
    this.folderRemovalProgress.set(folderId, { deleted: 0, total: null });
    this.refreshPagedFolderScanState();
    this.renderStatus();
    try {
      await this.manager.removeFolder(folderId);
      return true;
    } catch (error) {
      this.reportActionFailure(error);
      return false;
    } finally {
      this.removingFolderIds.delete(folderId);
      this.folderRemovalProgress.delete(folderId);
      this.refreshPagedFolderScanState();
      this.renderStatus();
      this.flushDeferredCatalogInvalidation();
    }
  }

  renderStatus(scanState = this.lastScanState) {
    if (!this.status) return;
    void this.renderPagedStatus(scanState);
  }

  async renderPagedStatus(scanState = this.lastScanState) {
    const requestVersion = (this.pagedStatusVersion || 0) + 1;
    this.pagedStatusVersion = requestVersion;
    this.syncContentScrollbarInset();
    if (this.removingFolderIds?.size) this.renderPagedStatusContent(scanState);
    try {
      const counts = await this.manager.getCounts();
      if (!this.status || requestVersion !== this.pagedStatusVersion) return;
      this.renderPagedStatusContent(scanState, counts);
    } catch (_) {
      if (!this.status || requestVersion !== this.pagedStatusVersion) return;
      if (this.removingFolderIds?.size) return;
      this.status.textContent = this.t('library.paged.loadFailed');
    }
  }

  renderPagedStatusContent(scanState, counts = null) {
    if (!this.status) return;
    const parts = [];
    if (counts) {
      parts.push(
        `${counts.tracks ?? 0} ${this.t('library.status.tracks')}`,
        `${counts.albums ?? 0} ${this.t('library.status.albums')}`
      );
    }
    const selection = this.getPagedSelectionProjection();
    if (Number.isSafeInteger(selection.selectedCount) && selection.selectedCount > 0) {
      parts.push(this.t('library.status.selected', { count: selection.selectedCount }));
    }
    if (scanState?.phase === 'scanning') {
      parts.push(`${this.t('library.state.scanning')} ${scanState.parsed || 0}/${scanState.found || 0}`);
    } else if (scanState?.phase === 'error') {
      parts.push(this.t('library.state.scanError'));
    }
    if (this.removingFolderIds?.size) parts.push(this.getFolderRemovalStatusText());
    this.status.innerHTML = `<span>${escapeHtml(parts.join(' · '))}</span>`;
    if (this.nowPlayingTrackId) {
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'library-status-button';
      jump.textContent = this.t('library.action.jumpToNowPlaying');
      jump.addEventListener('click', () => this.showTrack(this.nowPlayingTrackId));
      this.status.appendChild(jump);
    }
    if (this.queueUndoAvailable) {
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'library-status-button library-status-queue-undo';
      undo.textContent = this.t('library.action.undoQueueReplace');
      undo.disabled = this.isPagedActionBusy();
      undo.addEventListener('click', () => {
        undo.disabled = true;
        return this.runLibraryCommand(async () => {
          let result;
          try {
            result = await this.manager.undoPlaybackSession?.();
            if (result?.kind !== 'published') {
              this.announcePagedStatus(this.t('library.error.actionFailed'));
            }
            return result;
          } finally {
            this.queueUndoAvailable = this.manager.canUndoPlaybackSession?.() === true;
            this.renderStatus();
          }
        }, {
          failureKey: 'library.error.actionFailed',
          announceFailure: true,
          logMessage: 'Failed to restore the previous playback queue:'
        });
      });
      this.status.appendChild(undo);
    }
    if (scanState?.phase === 'scanning' && scanState.scanId) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'library-status-button library-status-cancel';
      cancel.textContent = this.t('library.action.cancel');
      cancel.addEventListener('click', () => {
        this.runLibraryCommand(() => this.manager.cancelScan(scanState.scanId), {
          logMessage: 'Music Library scan cancellation failed:'
        });
      });
      this.status.appendChild(cancel);
    }
  }

  t(key, params = {}) {
    const text = this.uiManager?.t ? this.uiManager.t(key, params) : key;
    return text === key ? fallbackText(key, params) : text;
  }

  getFolderRemovalStatusText(folderId = null) {
    const label = this.t('library.state.removingFolder');
    const progress = folderId
      ? this.folderRemovalProgress?.get(folderId)
      : aggregateFolderRemovalProgress(this.removingFolderIds, this.folderRemovalProgress);
    if (!progress || !Number.isSafeInteger(progress.total) || progress.total <= 0) return label;
    return `${label} ${progress.deleted}/${progress.total}`;
  }

  runLibraryCommand(command, {
    failureKey = 'library.error.actionFailed',
    announceFailure = false,
    notifyUser = true,
    logMessage = 'Music Library command failed:'
  } = {}) {
    const handleFailure = error => {
      console.error(logMessage, error);
      if (notifyUser) {
        const message = this.t(failureKey);
        if (announceFailure) this.announcePagedStatus(message);
        else this.uiManager?.setError?.(message, true);
      }
      return { accepted: false, reason: 'command-failed' };
    };
    try {
      const result = typeof command === 'function' ? command() : command;
      return Promise.resolve(result).catch(handleFailure);
    } catch (error) {
      return Promise.resolve(handleFailure(error));
    }
  }

  reportActionFailure(error) {
    console.error('Music Library action failed:', error);
    this.uiManager?.setError?.(this.t('library.error.actionFailed'), true);
  }
}

function createDefaultEntitySorts() {
  return Object.fromEntries(Object.entries(DEFAULT_ENTITY_SORTS).map(([entityType, preference]) => [
    entityType,
    { ...preference }
  ]));
}

function freezePagedActionRequest(request = {}) {
  const fields = { ...(request || {}) };
  delete fields.clientRequestId;
  return Object.freeze({
    ...fields,
    ...(fields.options && typeof fields.options === 'object'
      ? { options: Object.freeze({ ...fields.options }) }
      : {}),
    ...(fields.target && typeof fields.target === 'object'
      ? { target: Object.freeze({ ...fields.target }) }
      : {})
  });
}

function freezePagedSelectionDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return descriptor;
  const immutable = { ...descriptor };
  for (const field of ['trackUids', 'exclusions', 'inclusions']) {
    if (Array.isArray(immutable[field])) immutable[field] = Object.freeze([...immutable[field]]);
  }
  return Object.freeze(immutable);
}

function isSupportedEntitySort(entityType, preference) {
  return Boolean(
    preference &&
    (preference.direction === 'asc' || preference.direction === 'desc') &&
    ENTITY_SORT_FIELDS[entityType]?.some(field => field.sort === preference.sort)
  );
}

function aggregateFolderRemovalProgress(folderIds, progressByFolder) {
  if (!folderIds?.size || !progressByFolder) return null;
  let deleted = 0;
  let total = 0;
  for (const folderId of folderIds) {
    const progress = progressByFolder.get(folderId);
    if (!Number.isSafeInteger(progress?.deleted) || !Number.isSafeInteger(progress?.total)) return null;
    deleted += progress.deleted;
    total += progress.total;
  }
  return Number.isSafeInteger(deleted) && Number.isSafeInteger(total) ? { deleted, total } : null;
}

function getScanStateFolderIds(state) {
  if (!state || typeof state !== 'object') return [];
  const folderIds = [
    ...(Array.isArray(state.folderIds) ? state.folderIds : []),
    ...(typeof state.folderId === 'string' ? [state.folderId] : []),
    ...(Array.isArray(state.results) ? state.results.map(result => result?.folderId) : [])
  ];
  return [...new Set(folderIds.filter(folderId => typeof folderId === 'string' && folderId))];
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
    'library.browse.folders': 'Folders',
    'library.browse.tracksInFolder': 'Tracks',
    'library.browse.viewTree': 'Tree view',
    'library.browse.viewFlat': 'Flat view',
    'library.state.emptyFolder': 'This folder is empty.',
    'library.nav.playlists': 'Playlists',
    'library.nav.recentlyAdded': 'Recently Added',
    'library.search.placeholder': 'Search library',
    'library.search.results': 'Search Results',
    'library.search.showAll': 'Show all',
    'library.action.addFolder': 'Add Music Folder',
    'library.action.rescan': 'Rescan',
    'library.action.removeFolder': 'Remove',
    'library.action.play': 'Play',
    'library.action.shuffle': 'Shuffle',
    'library.action.playNext': 'Play Next',
    'library.action.addToQueue': 'Add to Queue',
    'library.action.addToPlaylist': 'Add to Playlist',
    'library.action.addFavorite': 'Add to Favorites',
    'library.action.removeFavorite': 'Remove from Favorites',
    'library.action.newPlaylist': 'New Playlist',
    'library.action.importPlaylist': 'Import Playlist',
    'library.action.exportM3U8': 'Export M3U8',
    'library.action.exportXSPF': 'Export XSPF',
    'library.action.rename': 'Rename',
    'library.action.duplicate': 'Duplicate',
    'library.action.delete': 'Delete',
    'library.action.moveUp': 'Move Up',
    'library.action.moveDown': 'Move Down',
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
    'library.properties.sourceType': 'Source type',
    'library.properties.cueTrack': 'CUE track',
    'library.properties.cuePath': 'CUE path',
    'library.properties.sourcePath': 'Source path',
    'library.properties.region': 'Track region',
    'library.properties.sourceEnd': 'end of source',
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
    'library.playlist.system.recentlyPlayed': 'Recently Played',
    'library.playlist.system.favorites': 'Favorites',
    'library.option.relativePaths': 'Relative paths',
    'library.prompt.queuePlaylistName': 'Queue',
    'library.prompt.playlistName': 'Playlist name',
    'library.prompt.renamePlaylist': 'Rename playlist',
    'library.status.tracks': 'tracks',
    'library.status.unresolved': 'unresolved',
    'library.status.albums': 'albums',
    'library.unknownArtist': UNKNOWN_ARTIST,
    'library.unknownAlbum': UNKNOWN_ALBUM,
    'library.status.selected': `${params.count || 0} selected`,
    'library.paged.loading': 'Loading library…',
    'library.paged.loadFailed': 'Unable to load the library page.',
    'library.paged.retry': 'Retry',
    'library.paged.selectAll': 'Select All',
    'library.paged.deselectAll': 'Deselect All',
    'library.paged.selectionStale': 'The selection belongs to an older Library snapshot.',
    'library.paged.reselect': 'Reselect in Current Results',
    'library.paged.selectionTooLarge': 'This sparse selection is too large. Use Select All or select a contiguous range.',
    'library.paged.exportTooLarge': `This browser limits playlist downloads to ${params.limit || 32} MB. Use the desktop app or a browser with file system access.`,
    'library.paged.exportSkippedCueTracks': `Exported without ${params.count || 0} CUE tracks because M3U8 and XSPF cannot preserve their positions within an album file.`,
    'library.paged.cueScanWarningSummary': `The scan finished, but ${params.count || 0} CUE sheets could not be used.`,
    'library.paged.cueScanWarningInvalid': `${params.count || 0} were invalid or referred to missing or conflicting audio files.`,
    'library.paged.cueScanWarningUnsupported': `${params.count || 0} had no supported audio tracks or used audio files that could not be analyzed.`,
    'library.paged.cueScanWarningTooLarge': `${params.count || 0} were larger than 1 MB.`,
    'library.paged.cueScanWarningAction': 'Correct or replace those CUE sheets, check that their WAV or FLAC files are in the same folder, then rescan.',
    'library.paged.reselectFailed': 'The selection could not be recreated in the current results.',
    'library.paged.playlistVersionUnavailable': 'The playlist changed. Reopen the menu and try again.',
    'library.paged.serviceUnavailable': 'The paged Library service is unavailable.',
    'library.paged.selectTrack': `Select ${params.title || ''}`,
    'library.paged.previous': 'Previous',
    'library.paged.next': 'Next',
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
    'library.job.terminal.interrupted': 'Interrupted',
    'library.job.progressKnown': `${params.processed || 0} / ${params.total || 0}`,
    'library.job.progressUnknown': `${params.processed || 0} processed`,
    'library.state.empty': 'Build your music library',
    'library.state.noResults': `No results for "${params.query || ''}"`,
    'library.state.noSubfolders': 'No subfolders contain music yet.',
    'library.state.noPlaylists': 'No playlists yet',
    'library.state.noResolvedTracks': 'This playlist has no available tracks.',
    'library.state.scanning': 'Scanning',
    'library.state.removingFolder': 'Removing folder',
    'library.state.scanError': 'Scan failed',
    'library.state.ok': 'OK',
    'library.state.missing': 'Missing',
    'library.state.needs-permission': 'Reconnect',
    'library.state.never-scanned': 'Not scanned',
    'library.column.title': 'Title',
    'library.column.artist': 'Artist',
    'library.column.album': 'Album',
    'library.column.genre': 'Genre',
    'library.column.duration': 'Time',
    'library.sort.label': 'Sort',
    'library.sort.name': 'Name',
    'library.sort.path': 'Path',
    'library.sort.year': 'Year',
    'library.sort.trackCount': 'Tracks',
    'library.sort.duration': 'Total duration',
    'library.sort.updated': 'Updated',
    'library.sort.created': 'Created',
    'library.sort.ascending': 'Ascending',
    'library.sort.descending': 'Descending',
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

function isPagedPlaybackOperation(operationKind) {
  return operationKind === 'play' || operationKind === 'playNext' || operationKind === 'queue';
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

function isTextEditingTarget(target) {
  const tagName = target?.tagName?.toLowerCase?.() || '';
  if (tagName === 'textarea' || target?.isContentEditable) return true;
  if (tagName !== 'input') return false;
  const type = String(target?.type || target?.getAttribute?.('type') || 'text').toLowerCase();
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
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

function setupModalFocus(backdrop, initialFocus = null, returnFocus = null, scrollContainer = null) {
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
        focusElementWithoutScroll(last, scrollContainer);
      }
      return;
    }
    if (active === last || !focusable.includes(active)) {
      event.preventDefault?.();
      focusElementWithoutScroll(first, scrollContainer);
    }
  };
  backdrop.addEventListener?.('keydown', onKeyDown);
  focusElementWithoutScroll(initialFocus || getFocusableDialogElements(backdrop)[0] || backdrop, scrollContainer);
  return () => {
    backdrop.removeEventListener?.('keydown', onKeyDown);
    focusElementWithoutScroll(getRestorableFocusElement(previousFocus), scrollContainer);
  };
}

function focusElementWithoutScroll(element, scrollContainer = null) {
  if (!element?.focus) return;
  const scrollTop = Number(scrollContainer?.scrollTop);
  element.focus({ preventScroll: true });
  if (Number.isFinite(scrollTop) && scrollContainer) scrollContainer.scrollTop = scrollTop;
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
  const total = track.trackTotal ?? track.trackOf;
  return total ? `${track.trackNo}/${total}` : String(track.trackNo);
}

function formatNumber(value, suffix = '') {
  return Number.isFinite(value) ? `${value}${suffix}` : '';
}

function joinDisplayPath(root, relativePath) {
  const base = String(root || '').replace(/[\\/]+$/, '');
  const separator = base.includes('\\') ? '\\' : '/';
  const relative = String(relativePath || '').replace(/[\\/]+/g, separator).replace(/^[\\/]+/, '');
  return relative ? `${base}${separator}${relative}` : base;
}

function isCueTrackDetails(value) {
  const sourceKind = value?.sourceKind ?? value?.source_kind;
  const entryKey = value?.entryKey ?? value?.entry_key;
  return sourceKind === 'cue-track' ||
    typeof entryKey === 'string' && entryKey.startsWith('cue:') ||
    Boolean(value?.cueRelativePath && Number.isSafeInteger(value?.startFrame));
}

function formatCueTrackRegion(startFrame, endFrame, sourceEndLabel) {
  if (!Number.isSafeInteger(startFrame) || startFrame < 0) return '';
  const start = formatCueFrameTime(startFrame);
  if (endFrame === null) return `${start} – ${sourceEndLabel}`;
  if (!Number.isSafeInteger(endFrame) || endFrame <= startFrame) return '';
  return `${start} – ${formatCueFrameTime(endFrame)}`;
}

function formatCueFrameTime(frame) {
  const wholeSeconds = Math.floor(frame / 75);
  const milliseconds = Math.round((frame % 75) * 1000 / 75);
  const seconds = wholeSeconds % 60;
  const minutes = Math.floor(wholeSeconds / 60) % 60;
  const hours = Math.floor(wholeSeconds / 3600);
  const clock = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
  return `${clock}.${String(milliseconds).padStart(3, '0')}`;
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

export function createFolderDirKey(folderId, path = '') {
  return `${folderId.length}:${folderId}${path}`;
}

export function decodeFolderDirKey(value) {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf(':');
  const lengthText = value.slice(0, separator);
  if (separator <= 0 || !/^\d+$/.test(lengthText)) return null;
  const folderIdLength = Number(lengthText);
  if (!Number.isSafeInteger(folderIdLength) || folderIdLength <= 0) return null;
  const start = separator + 1;
  const folderId = value.slice(start, start + folderIdLength);
  return folderId.length === folderIdLength ? { folderId, path: value.slice(start + folderIdLength) } : null;
}

function normalizeFolderDetail(detail) {
  if (!detail) return null;
  if (detail.type === 'folder') {
    return {
      type: 'folderNode',
      folderId: detail.folderId ?? detail.key,
      path: '',
      title: detail.title || ''
    };
  }
  return { ...detail };
}

function createFolderNavigationKey(folderId, path) {
  return `${folderId}\0${path}`;
}

export function getPagedInvalidationDecision(query, event, dependentQueries = []) {
  const changedScopes = Array.isArray(event?.changedScopes) ? event.changedScopes : [];
  if (changedScopes.length === 0) return { restart: false, reason: 'no-changed-scope' };
  const relevantScopes = new Set();
  const queries = [query, ...(Array.isArray(dependentQueries) ? dependentQueries : [])].filter(Boolean);
  for (const visibleQuery of queries) {
    if (visibleQuery.endpoint === 'tracks') {
      relevantScopes.add('tracks');
      const playlistId = visibleQuery.scope?.playlistId;
      if (playlistId) {
        relevantScopes.add('playlists');
        relevantScopes.add(`playlist:${playlistId}`);
      }
      const folderId = visibleQuery.scope?.folderKey ?? visibleQuery.scope?.folderId ??
        decodeFolderDirKey(visibleQuery.scope?.folderDirKey)?.folderId;
      if (folderId) {
        relevantScopes.add('folders');
        relevantScopes.add(`folder:${folderId}`);
      }
    } else if (visibleQuery.endpoint === 'entities') {
      const plural = {
        album: 'albums',
        artist: 'artists',
        genre: 'genres',
        folder: 'folders',
        subfolder: 'subfolders',
        playlist: 'playlists'
      }[visibleQuery.entityType];
      if (plural) relevantScopes.add(plural);
    }
  }
  const changedScope = changedScopes.find(scope => relevantScopes.has(scope) || (
    queries.some(visibleQuery => visibleQuery.endpoint === 'entities' && visibleQuery.entityType === 'folder') &&
    scope.startsWith('folder:')
  ) || (
    queries.some(visibleQuery => visibleQuery.endpoint === 'entities' && visibleQuery.entityType === 'playlist') &&
    scope.startsWith('playlist:')
  ));
  return changedScope
    ? { restart: true, reason: 'visible-scope-changed', changedScope }
    : { restart: false, reason: 'unrelated-scope' };
}

export function isPagedSnapshotExpiryError(error) {
  const expiryCodes = new Set([
    'STALE_CURSOR',
    'staleCursor',
    'snapshotExpired',
    'contextExpired',
    'invalidContext'
  ]);
  if (expiryCodes.has(error?.code)) return true;
  return /Catalog (?:context(?: snapshot)? has expired|version is stale)\b/.test(error?.message ?? '');
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

function isPagedPlaylistItemDrag(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  return types.includes(PAGED_PLAYLIST_ITEM_DRAG_TYPE);
}

function createPlaybackShuffleSeed() {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return Math.floor(Math.random() * 0x100000000);
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
