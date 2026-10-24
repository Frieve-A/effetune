import {
  cssEscape,
  getActiveLibraryDialogBackdrop,
  getLibraryEnterOperation,
  isEditableTarget,
  isMobileLayout,
  isTextEditingTarget
} from './library-view-shared.js';

export const keyboardMethods = {
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
        this.runPagedKeyboardCommand(event, () => this.activatePagedFocused(getLibraryEnterOperation(event)));
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
  },

  handleGlobalLibraryKeyDown(event) {
    if (!document.body?.classList.contains('view-library')) return;
    if (this.uiManager?.networkMusic && this.uiManager.networkMusic.selectedLibraryId !== 'local') return;
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
  },

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
  },

  dispatchPagedKeyboardAction(event, callback) {
    const row = event?.target?.closest?.('.library-paged-row');
    if (row) return this.dispatchPagedRowAction(row, callback);
    if (!this.pagedController) return { accepted: true, value: callback() };
    return this.pagedController.dispatchRowAction(this.pagedController.createViewState(), callback);
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
};
