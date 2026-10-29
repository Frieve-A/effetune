import { IntegratedRemoteEffects } from '../remote/integrated-remote-effects.js';
import { NetworkPlaybackAdapter } from './playback-adapter.js';
import { PwaDeviceRegistration } from './pwa-registration.js';
import { NetworkMusicSettings } from './settings-view.js';
import { isPwaNetworkArtworkUrl } from './pwa-connection.js';
import { escapeHtml } from '../utils/escape-html.js';
import { ICONS, LIBRARY_SEARCH_DEBOUNCE_MS, PAGED_DEFAULT_SELECT_ALL_LIMIT, getLibraryEnterOperation, isMobileLayout } from '../ui/library/library-view-shared.js';
import { LIBRARY_NAV_VIEWS, VIEW_LABELS, FILE_SORT_COLUMNS, libraryNavItem, libraryEntityCard, libraryFolderMain, libraryDetailHeading, createLibraryBreadcrumbs, createLibraryEntityGridGeometry, createLibrarySortControl, librarySortHeader, TRACK_COLUMNS, libraryButton, libraryMain, librarySectionHeading, libraryTrackHeader, libraryTrackCells, libraryFolderCells, createLibraryMessage, bindLibraryTrackPointer, bindLibrarySearchInput } from '../ui/library/library-view-components.js';

const LABELS = {
  'networkMusic.player': 'Playback device', 'networkMusic.library': 'Library',
  'networkMusic.local': 'This device', 'networkMusic.refresh': 'Refresh',
  'networkMusic.unavailable': 'Unavailable', 'networkMusic.connecting': 'Connecting',
  'networkMusic.back': 'Back', 'networkMusic.untitled': 'Untitled',
  'networkMusic.unsupported': 'Unsupported format',
  'library.action.play': 'Play', 'library.action.playNext': 'Play Next',
  'library.action.addToQueue': 'Add to Queue',
  'library.paged.selectAll': 'Select All', 'library.paged.deselectAll': 'Deselect All',
  'library.action.more': 'More', 'library.playlist.system.favorites': 'Favorites',
  'library.column.trackNo': 'Track No.', 'library.column.title': 'Title',
  'library.column.artist': 'Artist', 'library.column.album': 'Album',
  'library.column.genre': 'Genre', 'library.column.duration': 'Time',
  'library.paged.loading': 'Loading library…', 'library.paged.loadFailed': 'Unable to load the library page.',
  'library.paged.retry': 'Retry', 'library.state.emptyFolder': 'This folder is empty.',
  'library.queue.previousPage': 'Previous page', 'library.queue.nextPage': 'Next page',
  'library.search.results': 'Search Results', 'library.status.tracks': 'tracks',
  'library.paged.selectTrack': 'Select {title}', 'library.state.noResults': 'No results for "{query}"',
  'networkMusic.search': 'Search {name}', 'networkMusic.pwa.addDevice': 'Add device…'
};
Object.assign(LABELS, Object.fromEntries(LIBRARY_NAV_VIEWS.map((id, index) => [VIEW_LABELS[id],
  ['Tracks', 'Albums', 'Artists', 'Genres', 'Subfolders', 'Files', 'Folders', 'Recently Added', 'Playlists'][index]])), {
  'library.sort.label': 'Sort', 'library.sort.name': 'Name', 'library.sort.ascending': 'Ascending',
  'library.sort.descending': 'Descending', 'library.sort.added': 'Date Added', 'library.column.path': 'Path',
  'library.sort.sortBy': 'Sort by {column}', 'library.sort.sortedAscending': '{column}, ascending',
  'library.sort.sortedDescending': '{column}, descending',
  'library.browse.viewTree': 'Tree', 'library.browse.viewFlat': 'Flat', 'library.sort.serverOrder': 'Server Order'
});
const SORT_PROPERTIES = { title: 'dc:title', name: 'dc:title', artist: 'upnp:artist', album: 'upnp:album',
  genre: 'upnp:genre', trackNo: 'upnp:originalTrackNumber', duration: 'res@duration', added: 'et:addedAt', path: 'et:displayPath' };
const ENTITY_CLASSES = { album: 'object.container.album.musicAlbum', artist: 'object.container.person.musicArtist',
  genre: 'object.container.genre.musicGenre', playlist: 'object.container.playlistContainer', folder: 'object.container.storageFolder' };

function containerType(item) {
  return Object.keys(ENTITY_CLASSES).find(type => item?.upnpClass === ENTITY_CLASSES[type] || item?.upnpClass?.startsWith(`${ENTITY_CLASSES[type]}.`));
}

export class NetworkMusicView {
  constructor({ controller, uiManager }) {
    this.controller = controller;
    this.uiManager = uiManager;
    this.t = (key, params) => uiManager.t(key, params);
    this.libraryRenderToken = 0;
    this.lastPlayerId = null;
    this.lastLibraryId = null;
  }

  element(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  label(key, params = {}) {
    const translated = this.t(key, params);
    return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value),
      translated && translated !== key ? translated : LABELS[key] ?? key);
  }

  button(key, action) {
    const button = this.element('button', 'library-button', this.label(key));
    button.title = this.t(key);
    button.type = 'button';
    button.dataset.translationKey = key;
    button.addEventListener('click', () => this.run(action));
    return button;
  }

  run(action) {
    return Promise.resolve().then(action).catch(error => {
      console.error('Network music operation failed:', error);
      this.controller.reportError(error);
    });
  }

  mount() {
    const main = document.querySelector('.main-container');
    if (!main) return;
    const openMusic = document.getElementById('openMusicButton');
    if (!openMusic) return;
    this.root = this.element('div', 'network-playback-target');
    this.playerSelect = this.element('select', 'network-select');
    this.playerSelect.setAttribute('aria-label', this.label('networkMusic.player'));
    this.playerSelect.addEventListener('change', () => {
      if (this.playerSelect.value === 'pwa-add-device' && this.registration) {
        this.playerSelect.value = this.controller.selectedPlayerId;
        this.registration.open();
      } else this.controller.selectPlayer(this.playerSelect.value);
    });
    this.refreshButton = this.button('networkMusic.refresh', async () => {
      await this.controller.discover();
      this.uiManager.showTransientMessage('networkMusic.refreshStarted');
    });
    this.refreshButton.className = 'header-button network-refresh-button';
    this.refreshButton.setAttribute('aria-label', this.label('networkMusic.refresh'));
    this.refreshButton.innerHTML = ICONS.refresh;
    this.root.append(this.playerSelect, this.refreshButton);
    if (this.controller.api.isPwa) {
      this.registration = new PwaDeviceRegistration({ api: this.controller.api, uiManager: this.uiManager });
    }
    openMusic.before(this.root);
    this.remoteControlButton = document.getElementById('remoteControlButton');
    this.remoteControlHome = this.remoteControlButton?.parentNode;
    this.remoteControlNext = this.remoteControlButton?.nextSibling;
    this.effectsContainer = this.element('section', 'network-effects');
    this.effectsContainer.hidden = true;
    main.after(this.effectsContainer);
    this.effects = new IntegratedRemoteEffects({ container: this.effectsContainer, api: this.controller.api.remoteClient,
      reportError: message => this.uiManager.setError(message, true), translate: (key, fallback) => {
      const text = this.t(key);
      return text === key ? fallback : text;
    } });
    this.unsubscribe = this.controller.subscribe(() => this.render());
    this.render();
  }

  attachLibrary(libraryView) {
    if (this.libraryView === libraryView) return;
    this.libraryView = libraryView;
    const root = libraryView.root;
    this.localPlaybackNotice = this.element('div', 'library-message');
    this.localPlaybackNotice.hidden = true;
    this.localPlaybackNotice.setAttribute('role', 'status');
    this.localPlaybackNotice.textContent = this.t('networkMusic.libraryRequired');
    root.querySelector('.library-main').prepend(this.localPlaybackNotice);
    const nav = root.querySelector('.library-nav');
    this.libraryLabel = this.element('label', 'library-source');
    this.libraryLabel.title = this.t('networkMusic.library');
    this.librarySelect = this.element('select', 'library-entity-sort-select');
    this.librarySelect.setAttribute('aria-label', this.label('networkMusic.library'));
    this.librarySelect.addEventListener('change', () => {
      if (this.librarySelect.value === 'pwa-add-source') {
        this.librarySelect.value = this.controller.selectedLibraryId;
        this.openSources();
      } else this.controller.selectLibrary(this.librarySelect.value);
    });
    this.libraryLabel.append(this.librarySelect);
    nav.prepend(this.libraryLabel);
    this.libraryNav = this.element('div', 'network-library-nav');
    nav.append(this.libraryNav);
    const shell = this.element('div');
    shell.innerHTML = libraryMain(libraryButton(this.label('networkMusic.refresh'), {
      className: 'library-rescan', icon: ICONS.refresh, iconOnly: true, title: this.t('networkMusic.refresh')
    }));
    this.libraryPanel = shell.firstElementChild;
    this.libraryPanel.classList.add('network-library-main');
    this.sourcePlaybackNotice = this.element('p', 'library-message');
    this.sourcePlaybackNotice.hidden = true;
    this.sourcePlaybackNotice.setAttribute('role', 'status');
    this.libraryPanel.prepend(this.sourcePlaybackNotice);
    this.libraryContent = this.libraryPanel.querySelector('.library-content');
    this.libraryStatus = this.libraryPanel.querySelector('.library-status');
    this.librarySearch = this.libraryPanel.querySelector('.library-search');
    bindLibrarySearchInput(this.librarySearch, () => this.scheduleLibrarySearch(), () => clearTimeout(this.librarySearchTimer));
    this.libraryPanel.querySelector('.library-rescan').addEventListener('click', () => this.run(() => {
      const location = this.controller.libraryLocations.get(this.controller.selectedLibraryId);
      if (location) location.navCounts = null;
      return this.renderLibrary();
    }));
    this.libraryKeyDown = event => this.handleLibraryKeyDown(event);
    document.addEventListener('keydown', this.libraryKeyDown);
    root.append(this.libraryPanel);
    this.lastLibraryId = null;
    this.render();
  }

  updateSelect(select, entries, selectedId) {
    if (!select) return;
    const options = [{ id: 'local', name: this.label('networkMusic.local') }, ...entries];
    if (!options.some(entry => entry.id === selectedId)) {
      options.push({ id: selectedId, name: select.selectedOptions?.[0]?.textContent || this.controller.selectedPlayer?.name || this.label('networkMusic.unavailable') });
    }
    if (select === this.playerSelect && this.registration) options.push({ id: 'pwa-add-device', name: this.label('networkMusic.pwa.addDevice') });
    if (select === this.librarySelect && this.controller.api.isPwa) options.push({ id: 'pwa-add-source', name: this.t('networkMusic.settings.addSource') });
    const signature = JSON.stringify(options.map(entry => [entry.id, entry.name, entry.available]));
    if (select.dataset.signature !== signature) {
      select.replaceChildren(...options.map(entry => {
        const option = this.element('option', '', entry.name + (entry.available === false ? ` · ${this.label('networkMusic.unavailable')}` : ''));
        option.value = entry.id;
        option.title = option.textContent;
        return option;
      }));
      select.dataset.signature = signature;
    }
    select.value = selectedId;
    select.title = select.selectedOptions?.[0]?.textContent || '';
  }

  render() {
    const controller = this.controller;
    this.updateSelect(this.playerSelect, controller.state.players.map(player => ({
      ...player, available: controller.playerStates.get(player.id)?.available ?? player.available
    })), controller.selectedPlayerId);
    this.updateSelect(this.librarySelect, controller.state.libraries, controller.selectedLibraryId);
    const remote = controller.selectedPlayerId !== 'local';
    document.body.classList.toggle('network-player-selected', remote);
    const main = document.querySelector('.main-container');
    if (main) main.inert = remote;
    if (this.remoteControlButton && this.remoteControlHome) {
      if (remote && this.remoteControlButton.parentNode !== this.root) this.root.prepend(this.remoteControlButton);
      else if (!remote && this.remoteControlButton.parentNode !== this.remoteControlHome) this.remoteControlHome.insertBefore(this.remoteControlButton, this.remoteControlNext);
    }
    const effectsPlayer = remote && controller.selectedPlayer?.isEffeTune === true &&
      controller.selectedPlayer?.capabilities?.effects !== false ? controller.selectedPlayer : null;
    this.effectsContainer.hidden = !effectsPlayer;
    const connectionVersion = JSON.stringify([controller.selectedPlayer?.connectionVersion, controller.selectedPlayer?.authorizationRequired,
      this.controller.api.isPwa ? controller.selectedPlayer?.available : undefined, Boolean(effectsPlayer)]);
    if (this.lastPlayerId !== controller.selectedPlayerId || this.lastConnectionVersion !== connectionVersion) {
      this.lastPlayerId = controller.selectedPlayerId;
      this.lastConnectionVersion = connectionVersion;
      void this.run(() => this.bindPlaybackTarget());
      void this.effects.selectPlayer(effectsPlayer);
    }
    if (effectsPlayer) this.effects.updatePlayerName(effectsPlayer.name);
    this.playbackAdapter?.sync();
    if (this.libraryView) {
      const external = controller.selectedLibraryId !== 'local';
      const localPlaybackUnavailable = controller.api.isPwa === true && remote;
      if (this.libraryView.localPlaybackUnavailable !== localPlaybackUnavailable) {
        this.libraryView.localPlaybackUnavailable = localPlaybackUnavailable;
        this.libraryView.closeContextMenu();
        this.libraryView.refreshPagedActionAvailability?.();
      }
      this.localPlaybackNotice.hidden = !localPlaybackUnavailable;
      this.libraryView.root.classList.toggle('network-library-selected', external);
      this.libraryView.root.querySelector('.library-main').inert = external;
      this.libraryView.nav.inert = external;
      this.libraryPanel.hidden = !external;
      this.libraryNav.hidden = !external;
      const source = controller.state.libraries.find(server => server.id === controller.selectedLibraryId);
      if (this.sourcePlaybackNotice) {
        this.sourcePlaybackNotice.hidden = !remote || source?.externalPlayback !== false;
        this.sourcePlaybackNotice.textContent = this.t('networkMusic.settings.gatewayRequired');
      }
      const capabilities = JSON.stringify([source?.browseViews, source?.searchSupported, source?.sortCaps, source?.available]);
      if (this.lastLibraryId !== controller.selectedLibraryId || this.libraryCapabilities !== capabilities) {
        const previous = controller.libraryLocations.get(this.lastLibraryId);
        if (previous) previous.scrollTop = this.libraryContent.scrollTop;
        this.libraryView.closeContextMenu();
        this.lastLibraryId = controller.selectedLibraryId;
        this.libraryCapabilities = capabilities;
        this.libraryView.root.classList.toggle('mobile-selection-mode', !external && this.libraryView.pagedMobileSelectionActive);
        this.libraryRenderToken += 1;
        if (external) void this.run(() => this.renderLibrary());
      }
    }
    this.updateLibraryTrackActions();
  }

  async bindPlaybackTarget() {
    const playerId = this.controller.selectedPlayerId;
    const generation = this.controller.playerGeneration;
    const local = this.uiManager.audioPlayer ?? (playerId !== 'local' ? await this.uiManager.createAudioPlayer([], false) : null);
    if (!local || generation !== this.controller.playerGeneration) return;
    this.playbackAdapter = playerId === 'local' ? null : new NetworkPlaybackAdapter(this.controller, playerId, local.ui);
    local.ui.setPlaybackTarget(this.playbackAdapter ?? local);
    if (playerId !== 'local' && !local.ui.container) local.ui.createPlayerUI();
  }

  async showPlayer() {
    if (!this.uiManager.audioPlayer?.ui?.container) await this.bindPlaybackTarget();
  }

  openSources() {
    this.closeSources();
    const dialog = this.element('dialog', 'pwa-device-dialog');
    this.sourceDialog = dialog;
    dialog.append(this.element('h2', '', this.t('networkMusic.settings.subsonic')));
    this.sourceSettings = new NetworkMusicSettings({ root: dialog, api: this.controller.api, translate: this.t });
    void this.sourceSettings.mount();
    const close = this.button('networkMusic.pwa.close', () => this.closeSources());
    close.textContent = this.t('networkMusic.pwa.close');
    dialog.append(close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.closeSources(); });
    document.body.append(dialog);
    dialog.showModal();
  }

  closeSources() {
    this.sourceSettings?.dispose();
    this.sourceSettings = null;
    this.sourceDialog?.close();
    this.sourceDialog?.remove();
    this.sourceDialog = null;
  }

  scheduleLibrarySearch() {
    clearTimeout(this.librarySearchTimer);
    const serverId = this.controller.selectedLibraryId;
    if (!this.controller.state.libraries.find(server => server.id === serverId)?.searchSupported) return;
    const generation = ++this.libraryRenderToken;
    const query = this.librarySearch.value.trim();
    this.librarySearchTimer = setTimeout(() => {
      if (generation !== this.libraryRenderToken || serverId !== this.controller.selectedLibraryId) return;
      const location = this.controller.libraryLocations.get(serverId);
      Object.assign(location, { query, start: 0, pageStarts: [], scrollTop: 0 });
      void this.run(() => this.renderLibrary());
    }, LIBRARY_SEARCH_DEBOUNCE_MS);
  }

  locationSnapshot(location) {
    const { objectId, title, start, pageStarts, query, sort, direction, container, viewId } = location;
    return { objectId, title, start, pageStarts: [...pageStarts], query, sort, direction, container, viewId, scrollTop: this.libraryContent.scrollTop };
  }

  navigateLibraryView(view) {
    const location = this.controller.libraryLocations.get(this.controller.selectedLibraryId);
    location.views ??= {};
    if (location.viewId) location.views[location.viewId] = { ...this.locationSnapshot(location), trail: [...location.trail] };
    Object.assign(location, location.views[view.id] ?? {
      viewId: view.id, objectId: view.objectId, title: this.label(VIEW_LABELS[view.id]),
      start: 0, pageStarts: [], trail: [], query: '', sort: undefined, direction: undefined, container: null, scrollTop: 0
    });
    return this.renderLibrary();
  }

  openLibraryContainer(item) {
    const location = this.controller.libraryLocations.get(this.controller.selectedLibraryId);
    location.trail.push(this.locationSnapshot(location));
    Object.assign(location, { objectId: item.id, title: item.title, container: item, start: 0, pageStarts: [], query: '', sort: undefined, direction: undefined, scrollTop: 0 });
    return this.renderLibrary();
  }

  renderLibraryNav(server, location) {
    const views = server?.browseViews ?? [];
    const signature = JSON.stringify(views.map(view => [view, this.label(VIEW_LABELS[view.id])]));
    if (this.libraryNav.dataset.signature !== signature) {
      this.libraryNav.innerHTML = views.map(view => libraryNavItem(view.id, this.label(VIEW_LABELS[view.id]), location.viewId === view.id)).join('');
      this.libraryNav.dataset.signature = signature;
      for (const button of this.libraryNav.querySelectorAll('[data-view]')) {
        button.addEventListener('click', () => this.run(() => this.navigateLibraryView(views.find(view => view.id === button.dataset.view))));
      }
    }
    for (const button of this.libraryNav.querySelectorAll('[data-view]')) {
      const active = button.dataset.view === location.viewId;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
      button.title = this.t(VIEW_LABELS[button.dataset.view]);
    }
    if (isMobileLayout() && this.libraryNav.dataset.activeView !== location.viewId) this.libraryNav.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.libraryNav.dataset.activeView = location.viewId || '';
  }

  async updateLibraryNavCounts(server, location, generation) {
    const counts = location.navCounts ??= new Map();
    for (const element of this.libraryNav.querySelectorAll('.library-count')) {
      element.hidden = true;
      element.textContent = '';
    }
    await Promise.all((server?.browseViews ?? []).filter(view => view.id !== 'recent').map(async view => {
      if (!counts.has(view.objectId)) {
        counts.set(view.objectId, this.controller.api.networkMusicBrowse({
          serverId: server.id, objectId: view.objectId, start: 0, count: 1
        }).then(page => Number.isSafeInteger(page.total) &&
          (page.total > 0 || page.total === 0 && page.items.length === 0) ? page.total : null)
          .catch(error => {
            console.warn('Network library count is unavailable:', error);
            return null;
          }));
      }
      const count = await counts.get(view.objectId);
      if (generation !== this.libraryRenderToken || server.id !== this.controller.selectedLibraryId) return;
      for (const button of this.libraryNav.querySelectorAll('[data-view]')) {
        if (button.dataset.view !== view.id) continue;
        const element = button.querySelector('.library-count');
        element.hidden = count === null;
        element.textContent = count === null ? '' : String(count);
      }
    }));
  }

  librarySortFields(server, location) {
    if (containerType(location.container) === 'playlist' && !location.query) return [];
    const entities = !location.container && ['albums', 'artists', 'genres', 'subfolders', 'folders', 'playlists'].includes(location.viewId) && !location.query;
    const columns = entities ? [{ key: 'name', labelKey: 'library.sort.name' }]
      : location.viewId === 'files' && !location.container ? FILE_SORT_COLUMNS
        : location.viewId === 'recent' && !location.container ? [...TRACK_COLUMNS, { key: 'added', labelKey: 'library.sort.added' }] : TRACK_COLUMNS;
    const caps = server?.sortCaps ?? [];
    return columns.filter(column => caps.includes('*') || caps.includes(SORT_PROPERTIES[column.key])).map(column => ({ ...column, sort: column.key }));
  }

  applyLibrarySort(sort, direction) {
    const location = this.controller.libraryLocations.get(this.controller.selectedLibraryId);
    direction ??= location.sort === sort && location.direction === 'asc' ? 'desc' : 'asc';
    Object.assign(location, { sort, direction, start: 0, pageStarts: [], scrollTop: 0 });
    return this.renderLibrary();
  }

  setLibraryArtwork(element, url) {
    if (!element || !url) return;
    const image = this.element('img', 'library-artwork-image');
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => { image.remove(); element.classList.add('library-artwork-error'); });
    if (isPwaNetworkArtworkUrl(url)) image.crossOrigin = 'anonymous';
    image.src = url;
    element.replaceChildren(image);
  }

  createLibraryContainerGrid(items, location, generation) {
    const mediaCards = location.viewId !== 'folders' || Boolean(location.container) || Boolean(location.query);
    const grid = this.element('div', 'library-paged-grid library-paged-entities');
    grid.setAttribute('role', 'list');
    for (const item of items) {
      const row = this.element('div', `library-paged-row library-paged-entity-card${mediaCards ? ' library-paged-media-card' : ' library-paged-folder-row'}`);
      row.setAttribute('role', 'listitem');
      const title = item.title || this.label('networkMusic.untitled');
      const count = Number.isSafeInteger(item.trackCount) ? `${item.trackCount} ${this.label('library.status.tracks')}` : '';
      const caption = [containerType(item) === 'album' ? item.artist : item.displayPath, count].filter(Boolean).join(' · ');
      const knownCollection = this.controller.state.libraries.find(server => server.id === this.controller.selectedLibraryId)?.browseViews?.length > 0;
      row.innerHTML = mediaCards ? libraryEntityCard(title, caption, { playLabel: knownCollection ? this.label('library.action.play') : '' }) : libraryFolderMain(title, caption);
      this.setLibraryArtwork(row.querySelector('.library-paged-artwork'), item.artwork);
      row.querySelector('.library-paged-entity-open, .library-paged-folder-main').addEventListener('click', () => {
        if (generation === this.libraryRenderToken) void this.run(() => this.openLibraryContainer(item));
      });
      row.querySelector('.library-card-play')?.addEventListener('click', event => {
        event.stopPropagation();
        if (generation === this.libraryRenderToken) void this.run(() => this.playLibraryContainer(item));
      });
      const playButton = row.querySelector('.library-card-play');
      if (playButton) playButton.title = this.t('library.action.play');
      grid.append(row);
    }
    const layout = () => {
      const geometry = createLibraryEntityGridGeometry(items.length, this.libraryContent.clientWidth, mediaCards);
      grid.style.position = 'relative';
      grid.style.height = `${geometry.rowCount * geometry.rowHeight}px`;
      [...grid.children].forEach((row, index) => {
        const position = geometry.getItemLayout(index, geometry.createWindow());
        Object.assign(row.style, { position: 'absolute', top: `${position.topPx}px`, left: `calc(${position.leftPercent}% + ${position.leftOffsetPx}px)`, width: `calc(${position.widthPercent}% - ${position.widthReductionPx}px)`, height: `${geometry.rowHeight}px` });
      });
    };
    this.libraryGridObserver = new ResizeObserver(layout);
    this.libraryGridObserver.observe(this.libraryContent);
    layout();
    return grid;
  }

  libraryBrowseRequest(serverId, location, start = location.start) {
    return { serverId, objectId: location.query ? '0' : location.objectId, start, count: 100,
      ...(location.query ? { query: location.query } : {}),
      ...(location.sort ? { sortCriteria: `${location.direction === 'desc' ? '-' : '+'}${SORT_PROPERTIES[location.sort]}` } : {}) };
  }

  playLibraryContainer(item) {
    return this.playLibraryContext({ objectId: item.id });
  }

  renderPlaybackPreparation() {
    if (!this.libraryView?.updatePagedActionToast) return;
    if (!this.playbackToast) {
      this.playbackToast = this.element('section', 'library-paged-action-toast');
      this.playbackToast.setAttribute('role', 'status');
      this.playbackToast.setAttribute('aria-live', 'polite');
      this.playbackToast.setAttribute('aria-atomic', 'true');
      this.libraryView.root.append(this.playbackToast);
    }
    this.libraryView.updatePagedActionToast(this.playbackToast, this.playbackPreparation.state, () => {
      const job = this.playbackPreparation;
      if (!job.state.canCancel) return;
      job.cancelled = true;
      job.state = { ...job.state, status: 'terminal', terminalKind: 'cancelled', canCancel: false };
      this.renderPlaybackPreparation();
    });
  }

  async runLibraryPlayback(operationKind, prepare) {
    if (this.playbackPreparation && this.playbackPreparation.state.status !== 'terminal') return { accepted: false };
    clearTimeout(this.playbackToastTimer);
    const source = this.controller.libraryGeneration;
    const target = this.controller.playerGeneration;
    const job = { cancelled: false, state: { operationKind, status: 'active', phase: 'SNAPSHOTTING', processed: 0, canCancel: true } };
    this.playbackPreparation = job;
    const isCurrent = () => !job.cancelled && this.playbackPreparation === job &&
      source === this.controller.libraryGeneration && target === this.controller.playerGeneration && !this.controller.disposed;
    const update = state => {
      if (this.playbackPreparation !== job || job.cancelled) return;
      job.state = { ...job.state, ...state };
      this.renderPlaybackPreparation();
    };
    this.renderPlaybackPreparation();
    try {
      const result = await prepare({ isCurrent, onProgress: update,
        onCommit: () => update({ phase: this.controller.selectedPlayerId === 'local' ? 'COMMITTING' : 'PREPARING_PLAYER',
          processed: null, total: null, canCancel: false }) });
      update({ status: 'terminal', terminalKind: !isCurrent() || result?.accepted === false ? 'cancelled' : 'succeeded', canCancel: false });
      return result;
    } catch (error) {
      update({ status: 'terminal', terminalKind: 'failed', result: { error }, canCancel: false });
      if (!job.cancelled) throw error;
    } finally {
      if (this.playbackPreparation === job) {
        this.playbackToastTimer = setTimeout(() => { this.playbackToast?.remove(); this.playbackToast = null; }, 5000);
        this.playbackToastTimer.unref?.();
      }
    }
  }

  async playLibraryContext(location, sourceOrdinal = null, { operationKind = 'play', includes = () => true, currentSourceOrdinal = sourceOrdinal } = {}) {
    if (this.controller.selectedPlayerId === 'local') this.uiManager.beginPlaybackSelectionGestureResume?.();
    return this.runLibraryPlayback(operationKind, async preparation => {
      const serverId = this.controller.selectedLibraryId;
      const sourceGeneration = this.controller.libraryGeneration;
      const targetGeneration = this.controller.playerGeneration;
      // Cancel on navigation, not on redraws of the same library selection.
      const selectionKey = this.librarySelectionKey;
      const request = this.libraryBrowseRequest(serverId, location, 0);
      const maximum = this.controller.queueTracksMax;
      const items = [];
      let unavailableTrack;
      let start = sourceOrdinal === null ? 0 : Math.max(0, sourceOrdinal - Math.floor(maximum / 2));
      let startIndex = currentSourceOrdinal === null ? 0 : -1;
      // Keep row playback within capacity while retaining the clicked occurrence and nearby tracks.
      // Explicit collection playback still requires the entire collection to fit.
      while (true) {
        if (!preparation.isCurrent()) return { accepted: false };
        const page = await this.controller.api.networkMusicBrowse({ ...request, start, count: Math.min(100, maximum - items.length + (sourceOrdinal === null ? 1 : 0)) });
        if (!preparation.isCurrent() || sourceGeneration !== this.controller.libraryGeneration || targetGeneration !== this.controller.playerGeneration || selectionKey !== this.librarySelectionKey) return { accepted: false };
        for (const [ordinal, track] of page.items.entries()) {
          if (track.isContainer || !includes(start + ordinal)) continue;
          if (!this.controller.canPlayItem(track)) {
            if (start + ordinal === currentSourceOrdinal) return this.reportUnavailableTrack(track);
            unavailableTrack ??= track;
            continue;
          }
          if (start + ordinal === currentSourceOrdinal) startIndex = items.length;
          items.push({ ...(this.controller.api.isPwa ? track : {}), serverId, trackId: track.id });
        }
        if (items.length > maximum) throw Object.assign(new Error('The collection exceeds the playback queue limit.'), { code: 'queueTooLarge' });
        preparation.onProgress({ phase: 'SNAPSHOTTING', processed: items.length });
        if (sourceOrdinal !== null && items.length === maximum) break;
        start += page.items.length;
        if (!page.items.length || Number.isSafeInteger(page.total) && page.total > 0 && start >= page.total) break;
      }
      if (items.length && startIndex >= 0) return this.controller.playItems(items, operationKind, startIndex, preparation);
      if (!items.length && unavailableTrack) return this.reportUnavailableTrack(unavailableTrack);
    });
  }

  async renderLibrary() {
    clearTimeout(this.librarySearchTimer);
    this.libraryGridObserver?.disconnect();
    const serverId = this.controller.selectedLibraryId;
    const generation = ++this.libraryRenderToken;
    const server = this.controller.state.libraries.find(item => item.id === serverId);
    const location = this.controller.libraryLocations.get(serverId) ?? { objectId: '0', start: 0, pageStarts: [], trail: [], query: '' };
    location.pageStarts ??= [];
    if (!location.viewId && !location.trail.length && server?.browseViews?.length) {
      const view = server.browseViews[0];
      Object.assign(location, { viewId: view.id, objectId: view.objectId, title: this.label(VIEW_LABELS[view.id]) });
    }
    this.controller.libraryLocations.set(serverId, location);
    this.renderLibraryNav(server, location);
    void this.updateLibraryNavCounts(server, location, generation);
    this.libraryView.closeContextMenu();
    this.libraryRows = [];
    const selectionKey = JSON.stringify([serverId, location.objectId, location.query, location.sort, location.direction]);
    const newSelection = selectionKey !== this.librarySelectionKey;
    if (newSelection) {
      this.librarySelectionKey = selectionKey;
      this.librarySelection = new Set();
      this.librarySelectionAll = false;
      this.libraryView.root.classList.remove('mobile-selection-mode');
    }
    this.selectionAnchor = null;
    this.librarySearch.value = location.query;
    this.librarySearch.placeholder = this.label('networkMusic.search', { name: server?.name || this.label('networkMusic.library') });
    this.librarySearch.title = this.t('networkMusic.search', { name: server?.name || '' });
    this.librarySearch.setAttribute('aria-label', this.librarySearch.placeholder);
    this.librarySearch.parentElement.hidden = !server?.searchSupported;
    this.libraryContent.setAttribute('aria-busy', 'true');
    this.libraryContent.replaceChildren(createLibraryMessage(this.label('library.paged.loading')));
    this.libraryStatus.replaceChildren();
    let page;
    try {
      page = await this.controller.api.networkMusicBrowse(this.libraryBrowseRequest(serverId, location));
    } catch (error) {
      if (generation !== this.libraryRenderToken || serverId !== this.controller.selectedLibraryId) return;
      this.libraryContent.setAttribute('aria-busy', 'false');
      this.libraryContent.replaceChildren(createLibraryMessage(error?.code === 'sharingRequired' && this.controller.api.isPwa
        ? this.label('networkMusic.pwa.notShared') : this.label('library.paged.loadFailed'), {
        error: true, retryLabel: this.label('library.paged.retry'), retry: () => this.run(() => this.renderLibrary())
      }));
      throw error;
    }
    if (generation !== this.libraryRenderToken || serverId !== this.controller.selectedLibraryId) return;
    this.libraryContent.setAttribute('aria-busy', 'false');
    const total = Number.isSafeInteger(page.total) && (page.total > 0 || page.items.length === 0) ? page.total : null;
    if (newSelection && total !== null && total <= PAGED_DEFAULT_SELECT_ALL_LIMIT && (location.container || location.query)) {
      this.librarySelectionAll = true;
    }
    const range = `${location.start + (page.items.length ? 1 : 0)}–${location.start + page.items.length}`;
    const detailType = location.container && location.viewId === 'subfolders' ? 'subfolder' : containerType(location.container);
    const hasDetailArtwork = !location.query && ['album', 'artist', 'genre', 'subfolder'].includes(detailType);
    const header = this.element('div', hasDetailArtwork ? 'library-detail-head library-paged-detail-head' : 'library-section-head');
    const heading = location.query ? this.label('library.search.results') : location.container?.title || (location.viewId ? this.label(VIEW_LABELS[location.viewId]) : location.title) || server?.name || this.label('networkMusic.library');
    header.innerHTML = hasDetailArtwork ? libraryDetailHeading(heading, total, this.label('library.status.tracks'), this.label('networkMusic.back'))
      : librarySectionHeading(heading, total === null ? range : `${range} / ${total}`, location.trail.length ? this.label('networkMusic.back') : '');
    this.setLibraryArtwork(header.querySelector('.library-paged-detail-artwork'), location.container?.artwork || page.items.find(item => item.artwork)?.artwork);
    header.querySelector('.library-back')?.addEventListener('click', () => this.run(() => {
      Object.assign(location, location.trail.pop());
      return this.renderLibrary();
    }));
    const shell = this.element('section', 'library-paged-attempt');
    shell.append(header);
    const sortFields = this.librarySortFields(server, location);
    if (sortFields.length && (!page.items.some(item => !item.isContainer) || isMobileLayout() || location.viewId === 'recent')) {
      const sortControl = createLibrarySortControl(sortFields, location, value => {
        const [sort, direction] = value.split(':');
        void this.run(() => this.applyLibrarySort(sort, direction));
      }, key => this.label(key));
      const select = sortControl.querySelector('select');
      const option = this.element('option', '', this.label('library.sort.serverOrder'));
      option.value = ':';
      select.prepend(option);
      select.value = location.sort ? `${location.sort}:${location.direction}` : ':';
      select.title = this.t('library.sort.label');
      header.classList.add('library-section-head-sortable');
      header.append(sortControl);
    }
    if (location.trail.length && !location.query) {
      header.classList.add('library-folder-detail-head');
      const controls = this.element('div', 'library-folder-browse-controls');
      const crumbs = [...location.trail, this.locationSnapshot(location)].map((entry, index) => ({ label: entry.container?.title || (entry.viewId ? this.label(VIEW_LABELS[entry.viewId]) : entry.title) || server?.name || this.label('networkMusic.library'), path: index }));
      controls.append(createLibraryBreadcrumbs(crumbs, heading, location.trail.length, index => this.run(() => {
        Object.assign(location, location.trail[index]);
        location.trail.splice(index);
        return this.renderLibrary();
      })));
      if (location.container?.treeObjectId && location.container?.flatObjectId) {
        const flat = location.objectId === location.container.flatObjectId;
        const toggle = this.button(flat ? 'library.browse.viewTree' : 'library.browse.viewFlat', () => {
          Object.assign(location, { objectId: flat ? location.container.treeObjectId : location.container.flatObjectId, start: 0, pageStarts: [], scrollTop: 0 });
          return this.renderLibrary();
        });
        toggle.classList.add('library-folder-view-toggle');
        controls.append(toggle);
      }
      header.append(controls);
    }
    const folders = page.items.filter(item => item.isContainer);
    const cardItems = folders.filter(item => {
      const type = containerType(item);
      return ['album', 'artist', 'genre', 'playlist'].includes(type) || (!location.container && ['subfolders', 'folders'].includes(location.viewId));
    });
    if (cardItems.length) shell.append(this.createLibraryContainerGrid(cardItems, location, generation));
    const directories = folders.filter(item => !cardItems.includes(item));
    if (directories.length) {
      const list = this.element('div', 'library-folder-directory-list');
      for (const item of directories) {
        const row = this.element('button', 'library-folder-directory-row');
        row.type = 'button';
        row.innerHTML = libraryFolderCells(item.title || this.label('networkMusic.untitled'), item.childCount ?? '');
        row.addEventListener('click', () => this.run(() => this.openLibraryContainer(item)));
        list.append(row);
      }
      const section = this.element('section', 'library-folder-directory-section');
      section.append(this.element('h3', '', this.label('library.nav.folders')), list);
      shell.append(section);
    }
    const trackEntries = page.items.map((item, ordinal) => ({ item, sourceOrdinal: location.start + ordinal })).filter(({ item }) => !item.isContainer);
    const tracks = trackEntries.map(({ item }) => item);
    if (tracks.length) {
      if (folders.length) shell.append(this.element('h3', 'library-folder-tracks-heading', this.label('library.nav.tracks')));
      this.libraryActionBar = this.element('div', 'library-action-bar library-paged-actions');
      this.libraryActionBar.innerHTML = [
        ['library.paged.selectAll', 'select-all'], ['library.paged.deselectAll', 'deselect-all'],
        ['library.action.play', 'play', ICONS.play], ['library.action.playNext', 'playNext', ICONS.next], ['library.action.addToQueue', 'queue', ICONS.queue]
      ].map(([key, action, icon]) => libraryButton(this.label(key), { className: `library-paged-${action}`, icon, title: this.t(key) })).join('');
      this.libraryActionBar.querySelector('.library-paged-select-all').addEventListener('click', () => {
        this.librarySelectionAll = true;
        this.librarySelection.clear();
        this.updateLibraryTrackActions();
      });
      this.libraryActionBar.querySelector('.library-paged-deselect-all').addEventListener('click', () => {
        this.librarySelectionAll = false;
        this.librarySelection.clear();
        this.updateLibraryTrackActions();
      });
      for (const action of ['play', 'playNext', 'queue']) this.libraryActionBar.querySelector(`.library-paged-${action}`).addEventListener('click', () => this.run(() => this.playLibrarySelection(serverId, action)));
      shell.append(this.libraryActionBar);
      const grid = this.element('div', 'library-paged-semantic-grid');
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-multiselectable', 'true');
      grid.setAttribute('aria-rowcount', String(tracks.length + 1));
      const fileRow = location.viewId === 'files' && !location.container && !location.query;
      const trackHeader = this.element('div', `library-track-header library-paged-track-header${fileRow ? ' library-file-row' : ''}`);
      trackHeader.setAttribute('role', 'row');
      trackHeader.innerHTML = libraryTrackHeader((fileRow ? FILE_SORT_COLUMNS : TRACK_COLUMNS).map(column => sortFields.some(field => field.key === column.key)
        ? librarySortHeader(column, location, (key, params) => this.label(key, params))
        : `<span class="library-sort-cell" role="columnheader"><span class="library-sort-label">${escapeHtml(this.label(column.labelKey))}</span></span>`).join(''), {
        selectLabel: this.label('library.paged.selectAll'), favoriteLabel: this.label('library.playlist.system.favorites'), moreLabel: this.label('library.action.more')
      });
      for (const button of trackHeader.querySelectorAll('[data-sort]')) {
        const column = (fileRow ? FILE_SORT_COLUMNS : TRACK_COLUMNS).find(column => column.key === button.dataset.sort);
        button.title = this.t('library.sort.sortBy', { column: this.t(column.labelKey) });
        button.addEventListener('click', () => this.run(() => this.applyLibrarySort(button.dataset.sort)));
      }
      const rows = this.element('div', 'library-paged-grid library-paged-tracks');
      rows.setAttribute('role', 'rowgroup');
      for (const [ordinal, { item, sourceOrdinal }] of trackEntries.entries()) {
        const row = this.element('div', `library-paged-row${fileRow ? ' library-file-row' : ''}`);
        row.setAttribute('role', 'row');
        row.setAttribute('aria-rowindex', String(ordinal + 2));
        row.tabIndex = ordinal === 0 ? 0 : -1;
        row.dataset.trackId = item.id;
        const title = (fileRow ? item.displayPath : item.title) || item.title || this.label('networkMusic.untitled');
        const duration = String(item.resources?.[0]?.duration || '').split(':').map(Number);
        row.innerHTML = libraryTrackCells({ ...item, durationSec: item.durationSec ?? (duration.length === 3 ? duration[0] * 3600 + duration[1] * 60 + duration[2] : 0) }, {
          title, fileRow, selectLabel: this.label('library.paged.selectTrack', { title }), moreLabel: this.label('library.action.more'),
          artist: item.artistObjectId ? `<button type="button" class="library-link library-artist-link">${escapeHtml(item.artist || '')}</button>` : escapeHtml(item.artist || ''),
          album: item.albumObjectId ? `<button type="button" class="library-link library-album-link">${escapeHtml(item.album || '')}</button>` : escapeHtml(item.album || '')
        });
        for (const type of ['artist', 'album']) row.querySelector(`.library-${type}-link`)?.addEventListener('click', () => {
          if (generation === this.libraryRenderToken) void this.run(() => this.openLibraryContainer({ id: item[`${type}ObjectId`], title: item[type], upnpClass: ENTITY_CLASSES[type], isContainer: true, artwork: item.artwork }));
        });
        bindLibraryTrackPointer(row, {
          isSelected: () => this.isLibraryTrackSelected(ordinal),
          select: (selected, options) => generation === this.libraryRenderToken
            ? this.selectLibraryTrack(ordinal, selected, options) : { accepted: false },
          play: () => generation === this.libraryRenderToken
            ? this.controller.canPlayItem(item)
              ? this.run(() => this.playLibraryContext(location, sourceOrdinal)) : this.reportUnavailableTrack(item)
            : undefined,
          contextMenu: (event, returnFocus = row) => this.openLibraryTrackMenu(event, ordinal, serverId, returnFocus),
          selectionMode: () => this.libraryView.root.classList.contains('mobile-selection-mode'),
          enterSelectionMode: () => {
            if (generation === this.libraryRenderToken) this.libraryView.root.classList.add('mobile-selection-mode');
          }
        });
        this.libraryRows.push({ item, row, sourceOrdinal });
        rows.append(row);
      }
      if (detailType !== 'playlist' || location.query) grid.append(trackHeader);
      grid.append(rows);
      shell.append(grid);
    } else this.libraryActionBar = null;
    if (!page.items.length) {
      shell.append(this.libraryView.emptyState(location.query ? this.label('library.state.noResults', { query: location.query }) : this.label('library.state.emptyFolder'), false));
    }
    const paging = this.element('div', 'library-action-bar library-pagination');
    const previous = this.button('library.queue.previousPage', () => { location.start = location.pageStarts.pop() ?? 0; location.scrollTop = 0; return this.renderLibrary(); });
    const next = this.button('library.queue.nextPage', () => { location.pageStarts.push(location.start); location.start += page.items.length; location.scrollTop = 0; return this.renderLibrary(); });
    previous.disabled = location.pageStarts.length === 0;
    next.disabled = page.items.length === 0 || (total !== null && location.start + page.items.length >= total);
    if (!previous.disabled || !next.disabled) { paging.append(previous, next); shell.append(paging); }
    this.libraryContent.replaceChildren(shell);
    this.libraryContent.scrollTop = location.scrollTop || 0;
    this.libraryStatus.textContent = total === null ? range : `${range} / ${total}`;
    this.updateLibraryTrackActions();
  }

  isLibraryTrackSelected(ordinal) {
    const sourceOrdinal = this.libraryRows[ordinal].sourceOrdinal ?? ordinal;
    return this.librarySelectionAll ? !this.librarySelection.has(sourceOrdinal) : this.librarySelection.has(sourceOrdinal);
  }

  usesLibraryContextAction() {
    const location = this.controller.libraryLocations.get(this.controller.selectedLibraryId);
    return (isMobileLayout() && !this.libraryView?.root.classList.contains('mobile-selection-mode') || containerType(location?.container) === 'playlist') &&
      this.libraryRows?.length > 0;
  }

  selectLibraryTrack(ordinal, selected, { exclusive = false, extend = false } = {}) {
    const { item } = this.libraryRows[ordinal];
    if (!this.controller.canPlayItem(item)) return { accepted: false };
    if (exclusive) {
      this.librarySelection.clear();
      this.librarySelectionAll = false;
    }
    const first = extend && this.selectionAnchor !== null ? Math.min(this.selectionAnchor, ordinal) : ordinal;
    const last = extend && this.selectionAnchor !== null ? Math.max(this.selectionAnchor, ordinal) : ordinal;
    for (let index = first; index <= last; index += 1) {
      const track = this.libraryRows[index].item;
      if (!this.controller.canPlayItem(track)) continue;
      const sourceOrdinal = this.libraryRows[index].sourceOrdinal ?? index;
      if (selected !== Boolean(this.librarySelectionAll)) this.librarySelection.add(sourceOrdinal);
      else this.librarySelection.delete(sourceOrdinal);
    }
    if (!extend) this.selectionAnchor = ordinal;
    this.updateLibraryTrackActions();
  }

  playLibrarySelection(serverId, action, ordinal = null, focusedOnly = false) {
    if (ordinal !== null && !this.controller.canPlayItem(this.libraryRows[ordinal].item)) {
      return this.reportUnavailableTrack(this.libraryRows[ordinal].item);
    }
    const focused = ordinal !== null && (focusedOnly || !this.isLibraryTrackSelected(ordinal));
    if (!focused && (this.librarySelectionAll || this.librarySelection.size === 0 && this.usesLibraryContextAction())) {
      const excluded = new Set(this.librarySelection);
      return this.playLibraryContext(this.controller.libraryLocations.get(serverId), null, {
        operationKind: action, includes: sourceOrdinal => !excluded.has(sourceOrdinal),
        currentSourceOrdinal: ordinal === null ? null : this.libraryRows[ordinal].sourceOrdinal ?? ordinal
      });
    }
    const ordinals = focused ? [ordinal]
      : this.libraryRows.flatMap((_, index) => this.isLibraryTrackSelected(index) ? [index] : []);
    if (!focused && this.librarySelection.size > ordinals.length) {
      const selected = new Set(this.librarySelection);
      return this.playLibraryContext(this.controller.libraryLocations.get(serverId), null, {
        operationKind: action, includes: sourceOrdinal => selected.has(sourceOrdinal),
        currentSourceOrdinal: ordinal === null ? null : this.libraryRows[ordinal].sourceOrdinal ?? ordinal
      });
    }
    const playable = ordinals.filter(index => this.controller.canPlayItem(this.libraryRows[index].item));
    const references = playable.map(index => ({ ...(this.controller.api.isPwa ? this.libraryRows[index].item : {}), serverId, trackId: this.libraryRows[index].item.id }));
    if (references.length) return this.runLibraryPlayback(action,
      preparation => this.controller.playItems(references, action, Math.max(0, playable.indexOf(ordinal)), preparation));
  }

  reportUnavailableTrack(item) {
    this.uiManager.setError(this.controller.unavailableItemKey(item), true);
    return { accepted: false };
  }

  openLibraryTrackMenu(event, ordinal, serverId, returnFocus) {
    event.preventDefault();
    this.libraryView.closeContextMenu();
    const menu = this.element('div', 'library-context-menu');
    menu.setAttribute('role', 'menu');
    menu.style.left = `${Math.max(4, event.clientX || 0)}px`;
    menu.style.top = `${Math.max(4, event.clientY || 0)}px`;
    for (const [key, action, icon] of [['library.action.play', 'play', ICONS.play], ['library.action.playNext', 'playNext', ICONS.next], ['library.action.addToQueue', 'queue', ICONS.queue]]) {
      const button = this.button(key, () => {
        this.libraryView.closeContextMenu();
        return this.playLibrarySelection(serverId, action, ordinal,
          isMobileLayout() && !this.libraryView.root.classList.contains('mobile-selection-mode'));
      });
      button.innerHTML = `${icon}<span>${escapeHtml(this.label(key))}</span>`;
      button.setAttribute('role', 'menuitem');
      menu.append(button);
    }
    this.libraryView.presentContextMenu(menu, event, { returnFocus });
  }

  refreshLibraryNowPlaying() {
    const local = this.controller.selectedPlayerId === 'local';
    const state = local ? this.uiManager.audioPlayer?.stateManager?.getStateSnapshot?.()
      : this.controller.playerStates.get(this.controller.selectedPlayerId);
    const current = local ? state?.currentTrack || state?.playlist?.[state?.currentTrackIndex]
      : state?.queue?.find(track => track.id === state.currentId);
    const reference = current?.meta?.networkLibrary;
    const entry = current?.meta?.openHomeQueueEntry;
    const uris = new Set([current?.uri, entry?.uri].filter(Boolean));
    const mediaKeys = new Set(current?.mediaKeys ?? []);
    const metadata = current?.metadata || entry?.metadata;
    if (metadata) {
      const parsed = new DOMParser().parseFromString(metadata, 'application/xml');
      for (const resource of parsed.getElementsByTagNameNS('*', 'res')) uris.add(resource.textContent.trim());
    }
    for (const { item, row } of this.libraryRows ?? []) {
      const playing = reference ? reference.serverId === this.controller.selectedLibraryId && reference.trackId === (item.trackId || item.id)
        : (item.mediaKeys ?? []).some(key => mediaKeys.has(key)) || (item.resources ?? []).some(resource => uris.has(resource.uri));
      row.classList.toggle('now-playing', playing);
      if (playing) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
      const indicator = row.querySelector('.library-now-playing-indicator');
      if (indicator) indicator.hidden = !playing;
    }
  }

  updateLibraryTrackActions() {
    for (const [ordinal, { item, row }] of (this.libraryRows ?? []).entries()) {
      const playable = this.controller.canPlayItem(item);
      if (!playable && !this.librarySelectionAll) this.librarySelection.delete(this.libraryRows[ordinal].sourceOrdinal ?? ordinal);
      const selected = playable && this.isLibraryTrackSelected(ordinal);
      row.classList.toggle('selected', selected);
      row.classList.toggle('library-paged-unresolved', !playable);
      row.setAttribute('aria-selected', String(selected));
      const unavailableKey = this.controller.unavailableItemKey(item);
      row.title = playable ? '' : this.t(unavailableKey);
      const checkbox = row.querySelector('.library-paged-select');
      checkbox.checked = selected;
      checkbox.disabled = !playable;
      const more = row.querySelector('.library-paged-row-more');
      more.title = this.t(playable ? 'library.action.more' : unavailableKey);
    }
    const hasSelection = this.librarySelectionAll
      ? this.libraryRows?.some(({ item }, ordinal) => this.controller.canPlayItem(item) && this.isLibraryTrackSelected(ordinal))
      : this.librarySelection?.size > 0;
    for (const action of ['deselect-all', 'play', 'playNext', 'queue']) {
      const button = this.libraryActionBar?.querySelector(`.library-paged-${action}`);
      if (button) button.disabled = !hasSelection && (action === 'deselect-all' || !this.usesLibraryContextAction());
    }
    const selectAll = this.libraryActionBar?.querySelector('.library-paged-select-all');
    if (selectAll) selectAll.disabled = !this.libraryRows.some(({ item }) => this.controller.canPlayItem(item));
    this.refreshLibraryNowPlaying();
  }

  handleLibraryKeyDown(event) {
    if (event.defaultPrevented || this.controller.selectedLibraryId === 'local' || !document.body.classList.contains('view-library')) return;
    const editable = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');
    if (!editable && (event.key === '/' || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f')) {
      if (this.librarySearch.parentElement.hidden) return;
      event.preventDefault();
      this.librarySearch.focus();
      this.librarySearch.select();
      return;
    }
    if (editable || !this.libraryContent.contains(event.target)) return;
    const location = this.controller.libraryLocations.get(this.controller.selectedLibraryId);
    if ((event.key === 'Backspace' || event.key === 'ArrowLeft') && location?.trail.length && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      Object.assign(location, location.trail.pop());
      void this.run(() => this.renderLibrary());
      return;
    }
    const entityTarget = event.target?.closest?.('.library-paged-entity-open, .library-paged-folder-main');
    if (entityTarget && ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) {
      const buttons = [...this.libraryContent.querySelectorAll('.library-paged-entity-open, .library-paged-folder-main')];
      const index = buttons.indexOf(entityTarget);
      const delta = ['PageDown', 'PageUp'].includes(event.key) ? Math.max(1, Math.floor(this.libraryContent.clientHeight / 224)) : 1;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : Math.max(0, Math.min(buttons.length - 1, index + (['ArrowDown', 'PageDown'].includes(event.key) ? delta : -delta)));
      buttons[next]?.focus();
      event.preventDefault();
      return;
    }
    if (event.target?.closest?.('button, a, [role="menuitem"]')) return;
    const index = this.libraryRows.findIndex(({ row }) => row === event.target.closest('.library-paged-row'));
    if (event.key === 'Escape') {
      this.librarySelectionAll = false;
      this.librarySelection.clear();
      this.libraryView.root.classList.remove('mobile-selection-mode');
      this.updateLibraryTrackActions();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      this.libraryActionBar?.querySelector('.library-paged-select-all').click();
    } else if (index >= 0 && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.libraryRows.length - 1 : Math.max(0, Math.min(this.libraryRows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      this.libraryRows.forEach(({ row }, ordinal) => { row.tabIndex = ordinal === next ? 0 : -1; });
      this.libraryRows[next].row.focus();
      if (event.shiftKey) this.selectLibraryTrack(next, true, { extend: true });
    } else if (index >= 0 && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) {
      const { row } = this.libraryRows[index];
      const rect = row.getBoundingClientRect();
      this.openLibraryTrackMenu({ preventDefault() {}, clientX: rect.left + 24, clientY: rect.top + 24 }, index, this.controller.selectedLibraryId, row);
    } else if (index >= 0 && (event.key === 'Enter' || event.key === ' ')) {
      if (event.key === 'Enter') void this.run(() => this.playLibrarySelection(this.controller.selectedLibraryId, getLibraryEnterOperation(event), index, true));
      else this.selectLibraryTrack(index, !this.isLibraryTrackSelected(index));
    } else return;
    event.preventDefault();
  }

  updateUITexts() {
    if (!this.root) return;
    if (this.localPlaybackNotice) this.localPlaybackNotice.textContent = this.t('networkMusic.libraryRequired');
    this.playerSelect.setAttribute('aria-label', this.label('networkMusic.player'));
    this.refreshButton?.setAttribute('aria-label', this.label('networkMusic.refresh'));
    this.librarySelect?.setAttribute('aria-label', this.label('networkMusic.library'));
    if (this.libraryLabel) this.libraryLabel.title = this.t('networkMusic.library');
    for (const root of [this.root, this.libraryView?.root]) {
      for (const button of root?.querySelectorAll('[data-translation-key]') ?? []) button.title = this.t(button.dataset.translationKey);
    }
    this.render();
    if (this.controller.selectedLibraryId !== 'local') void this.run(() => this.renderLibrary());
  }

  dispose() {
    if (this.playbackPreparation) this.playbackPreparation.cancelled = true;
    clearTimeout(this.playbackToastTimer);
    this.playbackToast?.remove();
    this.closeSources();
    this.libraryRenderToken += 1;
    this.libraryGridObserver?.disconnect();
    clearTimeout(this.librarySearchTimer);
    this.unsubscribe?.();
    document.removeEventListener('keydown', this.libraryKeyDown);
    this.libraryPanel?.remove();
    this.libraryLabel?.remove();
    this.libraryNav?.remove();
    this.localPlaybackNotice?.remove();
    this.uiManager.audioPlayer?.ui?.setPlaybackTarget();
    this.effects?.dispose();
    this.registration?.dispose();
    if (this.remoteControlButton && this.remoteControlHome) this.remoteControlHome.insertBefore(this.remoteControlButton, this.remoteControlNext);
    this.root?.remove();
    this.effectsContainer?.remove();
  }
}
