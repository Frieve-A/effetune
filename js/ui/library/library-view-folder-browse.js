import { libraryFolderCells, createLibraryBreadcrumbs } from './library-view-components.js';
import { escapeHtml } from '../../utils/escape-html.js';
import { createFolderNavigationKey, isMobileLayout } from './library-view-shared.js';

export const folderBrowseMethods = {
  createFolderBrowseHeaderControls() {
    const controls = document.createElement('div');
    controls.className = 'library-folder-browse-controls';
    const segments = this.detail.path ? this.detail.path.split('/') : [];
    const crumbs = [{ label: this.detail.title || this.t('library.nav.folders'), path: '' }];
    let pathValue = '';
    for (const segment of segments) {
      pathValue = pathValue === '' ? segment : `${pathValue}/${segment}`;
      crumbs.push({ label: segment, path: pathValue });
    }
    const breadcrumbs = createLibraryBreadcrumbs(crumbs, this.detail.title || this.t('library.nav.folders'), this.detail.path, path => this.navigateToFolderPath(path));
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'library-button library-folder-view-toggle';
    const nextMode = this.folderBrowseMode === 'tree' ? 'flat' : 'tree';
    toggle.textContent = this.t(nextMode === 'tree' ? 'library.browse.viewTree' : 'library.browse.viewFlat');
    toggle.addEventListener('click', () => this.setFolderBrowseMode(nextMode));
    controls.append(breadcrumbs, toggle);
    return controls;
  },

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
  },

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
      this.pendingFolderFocusFolderId = this.detail.folderId;
    } else {
      this.pendingFolderFocusPath = null;
      this.pendingFolderFocusFolderId = null;
    }
    this.navigateToDetail({ ...this.detail, path }, null, {
      pushHistory,
      folderBrowseState: targetSnapshot?.folderBrowseState ?? null
    });
  },

  isFolderTreeBrowse() {
    return this.detail?.type === 'folderNode' && this.folderBrowseMode === 'tree' &&
      !this.searchQuery.trim();
  },

  createFolderDirectorySection(directTrackCount) {
    const section = document.createElement('section');
    section.className = 'library-folder-directory-section';
    section.dataset.folderBrowseKey = createFolderNavigationKey(this.detail.folderId, this.detail.path);
    this.renderFolderDirectorySection(section, directTrackCount);
    if (!this.getCurrentFolderChildrenState(section.dataset.folderBrowseKey)) {
      void this.loadFolderChildren(section, directTrackCount, { append: false });
    }
    return section;
  },

  getCurrentFolderChildrenState(key) {
    const state = this.folderChildrenState;
    if (!state || state.key !== key || state.requestId !== this.folderBrowseRequestId ||
        state.intentId !== this.navigationIntentId ||
        state.browseGeneration !== this.folderBrowseGeneration) return null;
    return state;
  },

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
  },

  saveCurrentFolderNavigationPosition() {
    if (this.detail?.type !== 'folderNode') return;
    const key = createFolderNavigationKey(this.detail.folderId, this.detail.path);
    const snapshot = this.getNavigationSnapshot();
    const folderBrowseState = this.createFolderBrowseSnapshot(key);
    this.folderNavigationPositions.set(key, folderBrowseState
      ? { ...snapshot, folderBrowseState }
      : snapshot);
  },

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
  },

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
  },

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
      const segments = Array.isArray(child.segments) && child.segments.length > 0
        ? child.segments
        : [child.name];
      const basePath = this.detail.path;
      const deepestPath = segments.reduce(
        (acc, segment) => acc === '' ? segment : `${acc}/${segment}`,
        basePath
      );
      const firstPath = basePath === '' ? segments[0] : `${basePath}/${segments[0]}`;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'library-folder-directory-row';
      row.dataset.folderPath = deepestPath;
      row.dataset.folderFirstPath = firstPath;
      row.innerHTML = libraryFolderCells(segments.join(' / '), child.recursiveTrackCount);
      row.addEventListener('click', () => this.navigateToFolderPath(deepestPath));
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
  },

  focusPendingFolderRow(section) {
    const focusPath = this.pendingFolderFocusPath;
    const liveSection = this.content?.querySelector?.('.library-folder-directory-section');
    if (!focusPath || !section || section !== liveSection ||
        this.detail?.folderId !== this.pendingFolderFocusFolderId) return false;
    const focusTarget = [...section.querySelectorAll?.('.library-folder-directory-row') || []]
      .find(row => row.dataset.folderPath === focusPath || row.dataset.folderFirstPath === focusPath);
    if (!focusTarget || typeof focusTarget.focus !== 'function') return false;
    focusTarget.focus({ preventScroll: true });
    if (globalThis.document?.activeElement !== focusTarget) return false;
    this.pendingFolderFocusPath = null;
    this.pendingFolderFocusFolderId = null;
    return true;
  },

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
  },

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
};
