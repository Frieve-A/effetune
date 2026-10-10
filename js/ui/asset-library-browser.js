import {
  collectExternalAssetInfo,
  collectUniquePipelinePlugins
} from './pipeline/external-asset-info.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function translateLibraryMessage(key, fallback, params = {}) {
  const translated = globalThis.window?.uiManager?.t?.(key, params);
  if (translated && translated !== key) return translated;
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    fallback
  );
}

const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'
]);

// Text entry keeps its own editing shortcuts (select all, and so on); only the
// dialog-wide keys that a text field never uses stay available while typing.
function isTextEntryTarget(target) {
  const tag = target?.tagName?.toLowerCase?.();
  if (tag === 'textarea') return true;
  if (tag === 'input') return !NON_TEXT_INPUT_TYPES.has(target.type?.toLowerCase?.());
  return target?.isContentEditable === true;
}

export function openAssetLibraryBrowser({
  service, onLoad, audioManager, onClose, returnFocus, translate, formatBadge, decorateEntry,
  accept, folderAccept = accept, folderFallback = false, chooseFiles, chooseFolder, kind,
  readOnly = false
} = {}) {
  if (!service) throw new TypeError('Asset library service is required.');
  const previousFocus = returnFocus ?? document.activeElement;
  const overlay = element('div', 'ir-library-overlay');
  const dialog = element('div', 'ir-library-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', translate('aria.dialog', 'Impulse response library'));
  overlay.appendChild(dialog);

  const header = element('div', 'ir-library-header');
  header.appendChild(element('h2', '', translate('title', 'Impulse Response Library')));
  const close = element('button', '', translate('action.close', 'Close'));
  close.type = 'button';
  header.appendChild(close);
  dialog.appendChild(header);

  const controls = element('div', 'ir-library-controls');
  const search = element('input');
  search.type = 'search';
  search.placeholder = translate('search.placeholder', 'Search filenames');
  search.setAttribute('aria-label', translate('aria.search', 'Search impulse responses'));
  const sort = element('select');
  sort.setAttribute('aria-label', translate('aria.sort', 'Sort impulse responses'));
  for (const [value, label] of [
    ['filename', translate('sort.filename', 'Filename')],
    ['recent', translate('sort.recent', 'Recently imported')]
  ]) {
    const option = element('option', '', label);
    option.value = value;
    sort.appendChild(option);
  }
  const importInput = element('input');
  importInput.type = 'file';
  importInput.multiple = true;
  importInput.accept = accept;
  importInput.hidden = true;
  const folderInput = element('input');
  folderInput.type = 'file';
  folderInput.multiple = true;
  folderInput.accept = folderAccept;
  folderInput.webkitdirectory = true;
  folderInput.hidden = true;
  const importButton = element('button', 'ir-library-primary-action',
    translate('action.importFiles', 'Import files…'));
  importButton.type = 'button';
  const folderButton = element('button', '', translate('action.importFolder', 'Import folder…'));
  folderButton.type = 'button';
  controls.append(search, sort);
  if (!readOnly) controls.append(importButton, folderButton, importInput, folderInput);
  dialog.appendChild(controls);

  const selectionControls = element('div', 'ir-library-selection-controls');
  const selectionCount = element('span', 'ir-library-selection-count');
  selectionCount.setAttribute('aria-live', 'polite');
  selectionCount.setAttribute('aria-atomic', 'true');
  const selectAll = element('button', '', translate('action.selectAll', 'Select all'));
  selectAll.type = 'button';
  const deselectAll = element('button', '', translate('action.deselectAll', 'Deselect all'));
  deselectAll.type = 'button';
  const deleteSelected = element('button', 'ir-library-danger-action',
    translate('action.deleteSelected', 'Delete selected'));
  deleteSelected.type = 'button';
  selectionControls.append(selectionCount, selectAll, deselectAll, deleteSelected);
  if (!readOnly) dialog.appendChild(selectionControls);

  const status = element('div', 'ir-library-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  dialog.appendChild(status);
  const importProgress = element('div', 'ir-library-import-progress');
  importProgress.hidden = true;
  const progressBar = element('progress', 'ir-library-progress');
  progressBar.max = 1;
  progressBar.setAttribute('aria-label', translate('aria.importProgress', 'Import progress'));
  const cancelImport = element('button', 'ir-library-danger-action',
    translate('action.cancelImport', 'Cancel import'));
  cancelImport.type = 'button';
  importProgress.append(progressBar, cancelImport);
  if (!readOnly) dialog.appendChild(importProgress);
  const list = element('div', 'ir-library-list');
  dialog.appendChild(list);

  let closed = false;
  let closeRequested = false;
  let activeImport = null;
  let deleteInProgress = false;
  let renderRevision = 0;
  let visibleEntries = [];
  const selectedIds = new Set();

  const isAssetInUse = id => {
    const plugins = collectUniquePipelinePlugins(
      audioManager?.pipelineA,
      audioManager?.pipelineB,
      audioManager?.pipeline
    );
    return collectExternalAssetInfo(plugins).some(info =>
      (!kind || info.kind === kind) && (info.ids.includes(id) || info.protectedIds.includes(id)));
  };

  const updateSelectionUi = () => {
    selectionCount.textContent = translate('selection.count', '{count} selected', {
      count: selectedIds.size
    });
    const busy = Boolean(activeImport) || deleteInProgress;
    selectAll.disabled = busy || visibleEntries.every(entry => selectedIds.has(entry.id));
    deselectAll.disabled = selectedIds.size === 0 || busy;
    deleteSelected.disabled = selectedIds.size === 0 || busy;
  };

  const reportFailure = (message, error) => {
    console.error('Asset library operation failed:', error);
    status.textContent = message;
  };

  const formatImportResult = (result, key, fallback, includeUnsupported) => {
    const summary = translate(key, fallback, {
      imported: result.imported.length,
      failed: result.failedCount,
      ...(includeUnsupported && { unsupported: result.unsupportedCount })
    });
    if (!result.failureCodes?.includes('file-too-large')) return summary;
    return `${summary} ${translate('error.fileTooLarge',
      'The selected impulse response is too large. Choose a shorter impulse response and try again.')}`;
  };

  const render = async () => {
    const revision = ++renderRevision;
    let entries;
    try {
      entries = await service.list({ query: search.value, sort: sort.value });
    } catch (error) {
      if (!closed && revision === renderRevision) reportFailure(translate('error.list',
        'The library could not be read. Please try again.'), error);
      return;
    }
    if (closed || revision !== renderRevision) return;
    visibleEntries = entries;
    list.textContent = '';
    if (!entries.length) list.appendChild(element('p', 'ir-library-empty',
      translate('empty', 'No matching impulse responses.')));
    for (const entry of entries) {
      const row = element('article', 'ir-library-entry');
      const selection = element('input', 'ir-library-entry-selection');
      selection.type = 'checkbox';
      selection.checked = selectedIds.has(entry.id);
      selection.disabled = Boolean(activeImport) || deleteInProgress;
      selection.setAttribute('aria-label', translate('aria.select',
        'Select {name}', { name: entry.name }));
      row.setAttribute('data-selected', String(selection.checked));
      selection.addEventListener('change', () => {
        if (selection.checked) selectedIds.add(entry.id);
        else selectedIds.delete(entry.id);
        row.setAttribute('data-selected', String(selection.checked));
        updateSelectionUi();
      });
      if (!readOnly) row.appendChild(selection);
      const summary = element('div', 'ir-library-entry-summary');
      summary.appendChild(element('strong', '', entry.name));
      const badge = element('span', 'ir-library-badge', formatBadge(entry));
      summary.appendChild(badge);
      row.appendChild(summary);
      decorateEntry?.(row, entry, badge);
      const actions = element('div', 'ir-library-actions');
      const load = element('button', 'ir-library-primary-action', translate('action.load', 'Load'));
      const remove = element('button', 'ir-library-danger-action', translate('action.delete', 'Delete'));
      load.disabled = Boolean(activeImport) || deleteInProgress;
      remove.disabled = Boolean(activeImport) || deleteInProgress;
      load.addEventListener('click', async () => {
        try {
          const loaded = await onLoad?.(entry);
          if (loaded === false) {
            status.textContent = translate('error.load',
              'The impulse response could not be loaded. Try importing it again or choose another one.');
            return;
          }
          closeDialog();
        } catch (error) {
          reportFailure(translate('error.load',
            'The impulse response could not be loaded. Try importing it again or choose another one.'), error);
        }
      });
      remove.addEventListener('click', async () => {
        if (activeImport || deleteInProgress) return;
        const confirmed = window.confirm?.(translate('confirm.delete',
          'Delete “{name}” from the library? This cannot be undone.', { name: entry.name })) ?? true;
        if (!confirmed) return;
        setDeleteUiActive(true);
        await render();
        try {
          const result = await service.delete(entry.id, {
            isInUse: isAssetInUse
          });
          if (result.removed) selectedIds.delete(entry.id);
          status.textContent = result.reason === 'in-use'
            ? translate('status.inUse',
              'This impulse response is in use by an effect pipeline and cannot be deleted.')
            : result.removed
              ? translate('status.deleted', 'Impulse response deleted.')
              : translate('status.deleteFailed', 'The impulse response could not be deleted.');
        } catch (error) {
          reportFailure(translate('error.delete',
            'The impulse response could not be deleted. Please try again.'), error);
        } finally {
          setDeleteUiActive(false);
          await render();
        }
      });
      actions.appendChild(load);
      if (!readOnly) actions.appendChild(remove);
      row.appendChild(actions);
      list.appendChild(row);
    }
    updateSelectionUi();
  };

  const setImportUiActive = active => {
    importProgress.hidden = !active;
    dialog.setAttribute('aria-busy', String(active));
    importButton.disabled = false;
    folderButton.disabled = false;
    cancelImport.disabled = false;
    updateSelectionUi();
  };

  const setDeleteUiActive = active => {
    deleteInProgress = active;
    dialog.setAttribute('aria-busy', String(active));
    search.disabled = active;
    sort.disabled = active;
    importButton.disabled = active;
    folderButton.disabled = active;
    close.disabled = active;
    updateSelectionUi();
  };

  const updateImportProgress = (operation, progress) => {
    if (activeImport !== operation || operation.cancelRequested) return;
    operation.importedCount = progress.importedCount || 0;
    operation.failedCount = progress.failedCount || 0;
    if (progress.phase === 'scanning') {
      progressBar.removeAttribute('value');
      const message = translate('status.scanningFolder',
        'Searching folder… {scanned} files checked, {found} supported.', {
          scanned: progress.scannedCount || 0,
          found: progress.supportedCount || 0
        });
      status.textContent = message;
      progressBar.setAttribute('aria-valuetext', message);
      return;
    }
    const total = progress.totalCount || 0;
    const completed = progress.completedCount || 0;
    progressBar.max = Math.max(1, total);
    progressBar.value = completed;
    const params = {
      completed,
      total,
      imported: progress.importedCount || 0,
      failed: progress.failedCount || 0
    };
    const currentName = progress.currentFiles?.join(' + ');
    const message = currentName
      ? translate('status.importingFile',
        'Importing “{name}”… {completed} of {total} complete ({imported} imported, {failed} failed).',
        { ...params, name: currentName })
      : translate('status.importing',
        'Importing… {completed} of {total} complete ({imported} imported, {failed} failed).', params);
    status.textContent = message;
    progressBar.setAttribute('aria-valuetext', message);
    if (progress.entry) void render();
  };

  const requestImportStop = () => {
    const operation = activeImport;
    if (!operation || operation.cancelRequested) return true;
    const confirmed = window.confirm?.(translate('confirm.cancelImport',
      'An import is still in progress. Stop it? Items already imported will remain in the library.')) ?? true;
    if (!confirmed) return false;
    operation.cancelRequested = true;
    status.textContent = translate('status.stoppingImport', 'Stopping import…');
    progressBar.setAttribute('aria-valuetext', status.textContent);
    importButton.disabled = true;
    folderButton.disabled = true;
    cancelImport.disabled = true;
    return true;
  };

  const runImport = async (runner, fromFolder = false) => {
    if (deleteInProgress) return null;
    if (activeImport) {
      const previous = activeImport;
      if (!previous.cancelRequested && !requestImportStop()) return null;
      await previous.promise;
      if (activeImport) return runImport(runner, fromFolder);
    }
    if (closed || closeRequested) return null;
    const operation = { cancelRequested: false, promise: null, importedCount: 0, failedCount: 0 };
    activeImport = operation;
    setImportUiActive(true);
    status.textContent = fromFolder
      ? translate('status.scanningFolder',
        'Searching folder… {scanned} files checked, {found} supported.', { scanned: 0, found: 0 })
      : translate('status.preparingImport', 'Preparing import…');
    progressBar.removeAttribute('value');
    progressBar.setAttribute('aria-valuetext', status.textContent);
    void render();
    operation.promise = (async () => {
      let result = null;
      try {
        result = await runner({
          isCurrent: () => !operation.cancelRequested && !closed,
          onProgress: progress => updateImportProgress(operation, progress)
        });
        if (operation.cancelRequested) {
          status.textContent = translate('status.importCancelled',
            'Import stopped. {imported} imported, {failed} failed.', {
              imported: result.imported.length,
              failed: result.failedCount
            });
        } else {
          status.textContent = fromFolder
            ? formatImportResult(result, 'status.folderResult',
              '{imported} imported, {failed} failed.', false)
            : formatImportResult(result, 'status.importResult',
              '{imported} imported, {failed} failed, {unsupported} unsupported.', true);
        }
      } catch (error) {
        if (operation.cancelRequested) {
          status.textContent = translate('status.importCancelled',
            'Import stopped. {imported} imported, {failed} failed.', {
              imported: operation.importedCount,
              failed: operation.failedCount
            });
        } else if (error?.name !== 'AbortError' && error?.code !== 'cancelled') {
          reportFailure(fromFolder
            ? translate('error.importFolder',
              'The folder could not be imported. Please try again.')
            : translate('error.importFiles',
              'The selected files could not be imported. Please try again.'), error);
        }
      } finally {
        if (activeImport === operation) {
          activeImport = null;
          setImportUiActive(false);
          await render();
        }
      }
      return result;
    })();
    return operation.promise;
  };

  const chooseImportSource = input => {
    if (deleteInProgress) return;
    if (activeImport && !requestImportStop()) return;
    input.click();
  };

  deleteSelected.addEventListener('click', async () => {
    if (!selectedIds.size || activeImport || deleteInProgress) return;
    const ids = [...selectedIds];
    const confirmed = window.confirm?.(translate('confirm.deleteSelected',
      'Delete {count} selected impulse responses from the library? This cannot be undone.', {
        count: ids.length
      })) ?? true;
    if (!confirmed) return;

    const result = { deleted: 0, inUse: 0, failed: 0 };
    setDeleteUiActive(true);
    status.textContent = translate('status.deletingSelected',
      'Deleting {count} selected impulse responses…', { count: ids.length });
    await render();
    try {
      for (const id of ids) {
        try {
          const deletion = await service.delete(id, { isInUse: isAssetInUse });
          if (deletion.reason === 'in-use') result.inUse += 1;
          else if (deletion.removed) result.deleted += 1;
          else result.failed += 1;
        } catch (error) {
          console.error('Asset library operation failed:', error);
          result.failed += 1;
        }
      }
    } finally {
      selectedIds.clear();
      setDeleteUiActive(false);
      status.textContent = translate('status.bulkDeleteResult',
        '{deleted} deleted, {inUse} in use, {failed} failed.', result);
      await render();
    }
  });

  cancelImport.addEventListener('click', requestImportStop);
  importButton.addEventListener('click', () => chooseFiles
    ? runImport(chooseFiles) : chooseImportSource(importInput));
  importInput.addEventListener('change', async () => {
    const files = Array.from(importInput.files || []);
    importInput.value = '';
    if (files.length) await runImport(options => service.importFiles(files, options));
  });
  folderInput.addEventListener('change', async () => {
    const files = Array.from(folderInput.files || []);
    folderInput.value = '';
    if (files.length) await runImport(options => service.importFiles(files, options), true);
  });
  folderButton.addEventListener('click', async () => {
    if (deleteInProgress) return;
    if (chooseFolder) {
      await runImport(chooseFolder, true);
      return;
    }
    if (window.electronAPI || folderFallback && typeof window.showDirectoryPicker !== 'function') {
      chooseImportSource(folderInput);
      return;
    }
    if (typeof window.showDirectoryPicker !== 'function') {
      status.textContent = translate('status.folderUnavailable',
        'Folder import is not available here. Choose the audio files instead.');
      return;
    }
    if (activeImport && !requestImportStop()) return;
    try {
      const directory = await window.showDirectoryPicker({ mode: 'read' });
      await runImport(options => service.importDirectory(directory, options), true);
    } catch (error) {
      if (error?.name !== 'AbortError' && error?.code !== 'cancelled') {
        reportFailure(translate('error.importFolder',
          'The folder could not be imported. Please try again.'), error);
      }
    }
  });
  search.addEventListener('input', () => {
    selectedIds.clear();
    return render();
  });
  sort.addEventListener('change', render);

  const selectVisibleEntries = () => {
    if (activeImport || deleteInProgress) return;
    selectedIds.clear();
    for (const entry of visibleEntries) selectedIds.add(entry.id);
    return render();
  };
  selectAll.addEventListener('click', selectVisibleEntries);
  deselectAll.addEventListener('click', () => {
    if (activeImport || deleteInProgress) return;
    selectedIds.clear();
    return render();
  });

  const finishClose = () => {
    if (closed) return;
    closed = true;
    const restoreFocus = !document.activeElement || overlay.contains?.(document.activeElement) !== false;
    overlay.remove();
    window.removeEventListener?.('beforeunload', handleBeforeUnload);
    if (restoreFocus) previousFocus?.focus?.();
    onClose?.();
  };

  async function closeDialog() {
    if (closed || closeRequested || deleteInProgress) return;
    if (activeImport) {
      if (!requestImportStop()) return;
      closeRequested = true;
      await activeImport?.promise;
    }
    finishClose();
  }
  close.addEventListener('click', closeDialog);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeDialog();
  });
  overlay.addEventListener('keydown', event => {
    if (!readOnly && (event.ctrlKey || event.metaKey) && !event.altKey && event.key?.toLowerCase() === 'a') {
      if (activeImport || deleteInProgress || isTextEntryTarget(event.target)) return;
      event.preventDefault?.();
      selectVisibleEntries();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault?.();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll?.(
      'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) || []).filter(node => !node.hidden);
    if (!focusable.length) {
      event.preventDefault?.();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault?.();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault?.();
      first.focus();
    }
  });
  const handleBeforeUnload = event => {
    if (!activeImport && !deleteInProgress) return;
    event.preventDefault?.();
    event.returnValue = '';
  };
  window.addEventListener?.('beforeunload', handleBeforeUnload);
  document.body.appendChild(overlay);
  updateSelectionUi();
  render();
  search.focus();
  return {
    element: overlay, close: closeDialog, render,
    dispose() {
      if (activeImport) activeImport.cancelRequested = true;
      finishClose();
    }
  };
}
