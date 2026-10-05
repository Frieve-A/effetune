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
import { escapeHtml } from '../../utils/escape-html.js';
import { folderBrowseMethods } from './library-view-folder-browse.js';
import { navigationMethods } from './library-view-navigation.js';
import { menusMethods } from './library-view-menus.js';
import { keyboardMethods } from './library-view-keyboard.js';
import { playlistIoMethods } from './library-view-playlist-io.js';
import {
  DETAIL_VIEW_BY_TYPE,
  ICONS,
  LIBRARY_SEARCH_DEBOUNCE_MS,
  PAGED_SEARCH_ENTITY_TYPES,
  createFolderDirKey,
  decodeFolderDirKey,
  formatDuration,
  getActiveLibraryDialogBackdrop,
  getRestorableFocusElement,
  isCueTrackDetails,
  isMobileLayout,
  removeElement,
  setClass
} from './library-view-shared.js';

export {
  WEB_PLAYLIST_BLOB_EXPORT_MAX_BYTES,
  WebPlaylistExportLimitError,
  getPagedPlaylistTarget,
  createFolderDirKey,
  decodeFolderDirKey
} from './library-view-shared.js';

const VIEW_LABELS = {
  tracks: 'library.nav.tracks',
  albums: 'library.nav.albums',
  artists: 'library.nav.artists',
  genres: 'library.nav.genres',
  subfolders: 'library.nav.subfolders',
  files: 'library.nav.files',
  folders: 'library.nav.folders',
  playlists: 'library.nav.playlists',
  recent: 'library.nav.recentlyAdded'
};
const LIBRARY_NAV_VIEWS = Object.freeze([
  'tracks', 'albums', 'artists', 'genres', 'subfolders', 'files', 'folders', 'recent', 'playlists'
]);

const TRACK_SORT_COLUMNS = [
  { key: 'trackNo', labelKey: 'library.column.trackNo' },
  { key: 'title', labelKey: 'library.column.title' },
  { key: 'artist', labelKey: 'library.column.artist' },
  { key: 'album', labelKey: 'library.column.album' },
  { key: 'genre', labelKey: 'library.column.genre' },
  { key: 'duration', labelKey: 'library.column.duration' }
];
const RECENT_SORT_COLUMNS = [
  ...TRACK_SORT_COLUMNS,
  { key: 'added', labelKey: 'library.sort.added' }
];
const FILE_SORT_COLUMNS = [
  { key: 'path', labelKey: 'library.column.path' },
  { key: 'duration', labelKey: 'library.column.duration' }
];

const PAGED_PLAYLIST_ITEM_DRAG_TYPE = 'application/x-effetune-playlist-item-key';
const DESKTOP_LIBRARY_MIN_HEIGHT_PX = 360;
const DESKTOP_LIBRARY_BOTTOM_GAP_PX = 20;
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
const PAGED_MOBILE_READ_AHEAD_PAGES = 2;
const PAGED_ACTION_PHASE_KEYS = Object.freeze({
  RECEIVED: 'library.job.phase.received',
  SNAPSHOTTING: 'library.job.phase.snapshotting',
  MATERIALIZING: 'library.job.phase.materializing',
  READY: 'library.job.phase.ready',
  CANCEL_REQUESTED: 'library.job.phase.cancel_requested',
  COMMITTING: 'library.job.phase.committing',
  STARTING_PLAYBACK: 'library.job.phase.starting_playback'
});
const CUE_SCAN_WARNING_KEYS = Object.freeze({
  'cue-invalid': 'library.paged.cueScanWarningInvalid',
  'cue-unsupported': 'library.paged.cueScanWarningUnsupported',
  'cue-too-large': 'library.paged.cueScanWarningTooLarge'
});
export const PAGED_RENDERED_ROW_LIMIT = 80;

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
    this.fileSort = 'path';
    this.fileSortDirection = 'asc';
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
    this.pendingFolderFocusFolderId = null;
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
      if (FILE_SORT_COLUMNS.some(column => column.key === state.fileSort)) this.fileSort = state.fileSort;
      if (state.fileSortDirection === 'asc' || state.fileSortDirection === 'desc') {
        this.fileSortDirection = state.fileSortDirection;
      }
      if (RECENT_SORT_COLUMNS.some(column => column.key === state.recentSort)) this.recentSort = state.recentSort;
      if (state.recentSortDirection === 'asc' || state.recentSortDirection === 'desc') {
        this.recentSortDirection = state.recentSortDirection;
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
        fileSort: this.fileSort,
        fileSortDirection: this.fileSortDirection,
        recentSort: this.recentSort,
        recentSortDirection: this.recentSortDirection,
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
    const rendered = this.render();
    if (focusSearch) this.searchInput?.focus();
    return rendered;
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
    const pageReady = this.renderPagedLibrary(renderVersion);
    return Promise.all([pageReady, this.renderPagedStatus()]);
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
      this.pagedRenderReady = this.pagedController.start(query, {
        preserveStaleSelection,
        defaultSelectAllLimit: selectAllByDefault ? PAGED_DEFAULT_SELECT_ALL_LIMIT : null
      });
      return this.pagedRenderReady;
    }
    this.renderPagedState(this.pagedState ?? this.pagedController.createViewState());
    return this.pagedRenderReady;
  }

  getPagedQuery() {
    const trackSort = this.getTrackSort();
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
        sort: trackSort.sort,
        direction: trackSort.direction,
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
      sort: trackSort.sort,
      direction: trackSort.direction,
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
        const count = view === 'recent' ? null : counts?.[view === 'files' ? 'tracks' : view];
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
      const count = view === 'recent' ? null : counts?.[view === 'files' ? 'tracks' : view];
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
    } else if (!this.detail && ['tracks', 'files', 'folders', 'recent'].includes(this.currentView)) {
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
    // An explicit Back position wins over the anchorless-query reset: folders that
    // contain only subfolders have no row to anchor but still need their scroll back.
    let targetScrollTop = this.pagedContentScrollTop;
    if (hasNavigationScrollTop) targetScrollTop = Math.max(0, navigationScrollTop);
    else if (this.pagedResetScrollOnCommit) targetScrollTop = 0;
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
      : isTrackQuery && !query.scope?.playlistId && isMobileLayout()
        ? this.createTrackSortControl(query) : null;
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

  createEntitySortControl(entityType) {
    const fields = ENTITY_SORT_FIELDS[entityType];
    if (!fields) return null;
    return this.createSortControl(fields, this.getEntitySort(entityType), value => {
      this.applyEntitySort(entityType, value);
    });
  }

  createTrackSortControl(query) {
    const columns = this.currentView === 'recent' && !this.detail
      ? RECENT_SORT_COLUMNS : this.getTrackSortColumns();
    const fields = columns.map(column => ({
      sort: column.key, labelKey: column.labelKey
    }));
    return this.createSortControl(fields, query, value => {
      const [sort, direction] = value.split(':');
      this.applyTrackSort(sort, direction);
    });
  }

  createSortControl(fields, preference, applySort) {
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
      applySort(event.currentTarget?.value ?? select.value);
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
    header.className = `library-track-header library-paged-track-header${this.isFileTrackView() ? ' library-file-row' : ''}`;
    header.setAttribute('role', 'row');
    header.setAttribute('aria-rowindex', '1');
    header.innerHTML = `
      <span class="library-track-control-header" role="columnheader" aria-label="${escapeHtml(this.t('library.paged.selectAll'))}"></span>
      <span class="library-track-control-header" role="columnheader" aria-label="${escapeHtml(this.t('library.playlist.system.favorites'))}"></span>
      ${this.getTrackSortColumns().map(column => this.renderSortHeader(column)).join('')}
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
    const isFileRow = isTrackQuery && this.isFileTrackView();
    const primaryTitle = (isFileRow ? item.path || item.relativePath : item.title) || item.fileName || trackUid || (
      unresolvedPlaylistItem ? this.t('library.state.missing') : ''
    );
    const cueLabel = isFileRow && isCueTrackDetails(item)
      ? [item.trackNo, item.title].filter(Boolean).join('. ')
      : '';
    const trackTitle = cueLabel ? `${primaryTitle} [${cueLabel}]` : primaryTitle;
    const nowPlaying = isTrackQuery && this.nowPlayingTrackId === trackUid;
    const canFavorite = Boolean(trackUid && !unresolvedPlaylistItem);
    const favorite = canFavorite && this.favoriteTrackUids?.has(trackUid) === true;
    const isFirstPlaylistItem = this.detail?.type === 'playlist' && ordinal === 0;
    const isLastPlaylistItem = this.detail?.type === 'playlist' &&
      Number.isSafeInteger(state.totalCount) && ordinal === state.totalCount - 1;
    row.className = `library-paged-row${isTrackQuery ? '' : ' library-paged-entity-card'}${isMediaCard ? ' library-paged-media-card' : ''}${isFolder ? ' library-paged-folder-row' : ''}${systemPlaylist ? ' library-system-playlist-card' : ''}${unresolvedPlaylistItem ? ' library-paged-unresolved' : ''}${nowPlaying ? ' now-playing' : ''}`;
    if (isFileRow) row.className += ' library-file-row';
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
        ${isFileRow ? '' : `<span class="library-track-number-cell" role="gridcell">${escapeHtml(item.trackNo ?? '')}</span>`}
        <span class="library-track-title" role="gridcell"${isFileRow ? ` title="${escapeHtml(trackTitle)}"` : ''}><span class="library-now-playing-indicator" aria-hidden="true" ${nowPlaying ? '' : 'hidden'}>♪</span><span class="library-track-title-text">${escapeHtml(trackTitle)}</span>${unresolvedPlaylistItem ? `<span id="${unresolvedStatusId}" class="library-badge missing library-paged-unresolved-status">${escapeHtml(this.t('library.state.missing'))}</span>` : ''}</span>
        ${isFileRow ? '' : `<span class="library-artist-cell" role="gridcell">${artistDetail ? `<button type="button" class="library-link library-artist-link">${escapeHtml(this.getTrackArtistLabel(item))}</button>` : escapeHtml(item.artist || item.albumArtist || '')}</span>
        <span class="library-album-cell" role="gridcell">${item.albumKey ? `<button type="button" class="library-link library-album-link">${escapeHtml(this.getTrackAlbumLabel(item))}</button>` : escapeHtml(item.album || '')}</span>
        <span class="library-genre-cell" role="gridcell">${escapeHtml(item.genre || '')}</span>`}
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
        this.uiManager.beginPlaybackSelectionGestureResume?.();
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
      request: { options: { currentOrdinal: ordinal, sourceOrdinal: ordinal } },
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
      sourceOrdinal: ordinal,
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
          options: {
            ...(request.options || {}),
            currentOrdinal: intent.currentOrdinal,
            sourceOrdinal: intent.sourceOrdinal
          }
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

  isFileTrackView() {
    return this.currentView === 'files' && !this.detail;
  }

  getTrackSortColumns() {
    return this.isFileTrackView() ? FILE_SORT_COLUMNS : TRACK_SORT_COLUMNS;
  }

  getTrackSort() {
    if (this.detail?.type === 'album' && !this.detailSortOverride && !this.searchQuery.trim()) {
      return { sort: 'album', direction: 'asc' };
    }
    if (this.currentView === 'recent' && !this.detail) {
      return { sort: this.recentSort ?? 'added', direction: this.recentSortDirection ?? 'desc' };
    }
    return this.isFileTrackView()
      ? { sort: this.fileSort ?? 'path', direction: this.fileSortDirection ?? 'asc' }
      : { sort: this.sort, direction: this.sortDirection };
  }

  renderSortHeader(column) {
    const preference = this.getTrackSort();
    const active = preference.sort === column.key;
    const direction = preference.direction === 'desc' ? 'desc' : 'asc';
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

  applyTrackSort(sort, direction) {
    const columns = this.currentView === 'recent' && !this.detail
      ? RECENT_SORT_COLUMNS : this.getTrackSortColumns();
    if (!columns.some(column => column.key === sort)) return;
    const preference = this.getTrackSort();
    direction ??= preference.sort === sort && preference.direction === 'asc' ? 'desc' : 'asc';
    if (direction !== 'asc' && direction !== 'desc') return;
    if (this.isFileTrackView()) {
      this.fileSort = sort;
      this.fileSortDirection = direction;
    } else if (this.currentView === 'recent' && !this.detail) {
      this.recentSort = sort;
      this.recentSortDirection = direction;
    } else {
      this.sortDirection = direction;
      this.sort = sort;
    }
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

Object.assign(LibraryView.prototype,
  folderBrowseMethods,
  navigationMethods,
  menusMethods,
  keyboardMethods,
  playlistIoMethods
);

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
    'library.nav.files': 'Files',
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
    'library.job.phase.starting_playback': 'Starting playback',
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
    'library.column.trackNo': 'Track No.',
    'library.column.path': 'Full path',
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
    'library.sort.added': 'Added',
    'library.sort.ascending': 'Ascending',
    'library.sort.descending': 'Descending',
    'library.sort.sortBy': `Sort by ${params.column || ''}`,
    'library.sort.sortedAscending': `${params.column || ''} sorted ascending`,
    'library.sort.sortedDescending': `${params.column || ''} sorted descending`,
    'library.confirm.removeFolder': 'Remove this folder from the catalog? Files on disk will not be deleted.',
    'library.confirm.deletePlaylist': 'Delete this playlist?',
    'library.error.actionFailed': 'The Music Library could not complete this action. Please try again.',
    'library.error.playbackStartTimeout': 'Playback could not start because loading the track stopped. Please try again.',
    'library.error.playbackStartFailed': 'Playback could not start. Please try again.',
    'library.error.folderAlreadyAdded': `${params.name || 'This folder'} is already in your library.`,
    'library.error.folderInsideExisting': `${params.name || 'This folder'} is already included in ${params.existing || 'an existing folder'}.`
  };
  return map[key] || key;
}

function isPagedPlaybackOperation(operationKind) {
  return operationKind === 'play' || operationKind === 'playNext' || operationKind === 'queue';
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
