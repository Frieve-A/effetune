import { escapeHtml } from '../../utils/escape-html.js';
import {
  ICONS,
  PLAYLIST_PICKER_FOCUS_TIMEOUT_MS,
  WEB_PLAYLIST_BLOB_EXPORT_MAX_BYTES,
  WebPlaylistExportLimitError,
  assertElectronFileResult,
  encodePlaylistExportChunk,
  hasPlaylistFiles,
  isPlaylistFileName,
  nextDialogId,
  removeElement,
  sanitizeFileName,
  setupModalFocus
} from './library-view-shared.js';

export const playlistIoMethods = {
  async handleImportPlaylist() {
    try {
      const file = await this.pickPagedPlaylistFile();
      if (!file) return;
      await this.importPagedPlaylistSource(file);
    } catch (error) {
      this.reportActionFailure(error);
    }
  },

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
  },

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
  },

  handlePlaylistFileDragOver(event) {
    if (!hasPlaylistFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  },

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
  },

  async pickPagedPlaylistFile() {
    if (window.electronAPI?.libraryCatalogV1?.pickPlaylistImport) {
      const result = await window.electronAPI.libraryCatalogV1.pickPlaylistImport();
      if (result?.canceled || !result?.source) return null;
      return result.source;
    }
    return this.pickBrowserPlaylistFile();
  },

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
  },

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
      if (Number.isSafeInteger(result?.skippedTrackCount) && result.skippedTrackCount > 0) {
        const message = this.t('library.paged.exportSkippedTracks', {
          count: result.skippedTrackCount
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
  },

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
  },

  shouldExportRelativePaths() {
    const checkbox = this.content?.querySelector?.('.library-playlist-export-relative');
    return checkbox ? Boolean(checkbox.checked) : true;
  },

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
};
