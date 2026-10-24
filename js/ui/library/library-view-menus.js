import { escapeHtml } from '../../utils/escape-html.js';
import {
  ICONS,
  LIBRARY_SEARCH_DEBOUNCE_MS,
  clampMenuToViewport,
  formatCueTrackRegion,
  formatDuration,
  formatNumber,
  formatTrackNumber,
  getPagedPlaylistTarget,
  getRestorableFocusElement,
  isCueTrackDetails,
  isMobileLayout,
  joinDisplayPath,
  nextDialogId,
  removeElement,
  setClass,
  setupModalFocus
} from './library-view-shared.js';

export const menusMethods = {
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
  },

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
  },

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
  },

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
  },

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
  },

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
    const playbackDisabled = canRunSelectionAction && !this.localPlaybackUnavailable ? '' : ' disabled';
    const playDisabled = canRunSelectionAction && !this.localPlaybackUnavailable && Number.isSafeInteger(actionIntent.currentOrdinal)
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
      <button type="button" role="menuitem" data-action="next"${playbackDisabled}>${ICONS.next}<span>${escapeHtml(this.t('library.action.playNext'))}</span></button>
      <button type="button" role="menuitem" data-action="queue"${playbackDisabled}>${ICONS.queue}<span>${escapeHtml(this.t('library.action.addToQueue'))}</span></button>
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
  },

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
  },

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
  },

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
  },

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
  },

  clearSelection({ keepMobileSelectionMode = false } = {}) {
    this.pagedController?.clearSelection?.();
    if (!keepMobileSelectionMode) this.pagedMobileSelectionActive = false;
    this.refreshPagedMobileSelectionMode();
    this.renderStatus();
  },

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
};
