import {
  collectExternalAssetInfo,
  collectUniquePipelinePlugins
} from '../ui/pipeline/external-asset-info.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function translate(key, fallback, params = {}) {
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

function formatBadge(entry) {
  const channels = entry.channels
    ? translate('irLibrary.badge.channels', '{count} ch', { count: entry.channels })
    : translate('irLibrary.badge.channelsUnknown', 'channels unknown');
  const rate = entry.sampleRate
    ? `${Math.round(entry.sampleRate / 100) / 10} kHz`
    : translate('irLibrary.badge.rateUnknown', 'rate unknown');
  const length = entry.frames && entry.sampleRate
    ? `${(entry.frames / entry.sampleRate).toFixed(2)} s`
    : translate('irLibrary.badge.lengthUnknown', 'length unknown');
  const topologyLabels = {
    mono: ['irReverb.option.mono', 'Mono'],
    independent: ['irReverb.option.independent', 'Independent'],
    'true-stereo': ['irReverb.option.trueStereo', 'True Stereo'],
    matrix: ['irReverb.option.diagonalMatrix', 'Diagonal Matrix']
  };
  const topologyLabel = Object.prototype.hasOwnProperty.call(topologyLabels, entry.topology)
    ? topologyLabels[entry.topology]
    : null;
  const topology = topologyLabel
    ? translate(topologyLabel[0], topologyLabel[1])
    : translate('irLibrary.badge.topologyUnknown', 'unknown');
  return `${channels} · ${topology} · ${length} · ${rate}`;
}

function drawDecay(canvas, analysis) {
  const context = canvas.getContext?.('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const series = analysis?.edc;
  if (!series?.length) return;
  context.strokeStyle = '#00ff00';
  context.beginPath();
  for (let index = 0; index < series.length; index += 1) {
    const x = index / Math.max(1, series.length - 1) * canvas.width;
    const value = Math.max(-80, Math.min(0, series[index]));
    const y = -value / 80 * canvas.height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

export function openIrLibraryBrowser({ service, onLoad, audioManager, onClose } = {}) {
  if (!service) throw new TypeError('IR library service is required.');
  const previousFocus = document.activeElement;
  const overlay = element('div', 'ir-library-overlay');
  const dialog = element('div', 'ir-library-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', translate('irLibrary.aria.dialog', 'Impulse response library'));
  overlay.appendChild(dialog);

  const header = element('div', 'ir-library-header');
  header.appendChild(element('h2', '', translate('irLibrary.title', 'Impulse Response Library')));
  const close = element('button', '', translate('irLibrary.action.close', 'Close'));
  close.type = 'button';
  header.appendChild(close);
  dialog.appendChild(header);

  const controls = element('div', 'ir-library-controls');
  const search = element('input');
  search.type = 'search';
  search.placeholder = translate('irLibrary.search.placeholder', 'Search filenames');
  search.setAttribute('aria-label', translate('irLibrary.aria.search', 'Search impulse responses'));
  const sort = element('select');
  sort.setAttribute('aria-label', translate('irLibrary.aria.sort', 'Sort impulse responses'));
  for (const [value, label] of [
    ['filename', translate('irLibrary.sort.filename', 'Filename')],
    ['recent', translate('irLibrary.sort.recent', 'Recently imported')]
  ]) {
    const option = element('option', '', label);
    option.value = value;
    sort.appendChild(option);
  }
  const importInput = element('input');
  importInput.type = 'file';
  importInput.multiple = true;
  importInput.accept = 'audio/*,.wav,.wave,.aif,.aiff,.flac,.mp3,.ogg,.m4a,.irs';
  importInput.hidden = true;
  const folderInput = element('input');
  folderInput.type = 'file';
  folderInput.multiple = true;
  folderInput.accept = importInput.accept;
  folderInput.webkitdirectory = true;
  folderInput.hidden = true;
  const importButton = element('button', 'ir-library-primary-action',
    translate('irLibrary.action.importFiles', 'Import files…'));
  importButton.type = 'button';
  const folderButton = element('button', '', translate('irLibrary.action.importFolder', 'Import folder…'));
  folderButton.type = 'button';
  controls.append(search, sort, importButton, folderButton, importInput, folderInput);
  dialog.appendChild(controls);

  const selectionControls = element('div', 'ir-library-selection-controls');
  const selectionCount = element('span', 'ir-library-selection-count');
  selectionCount.setAttribute('aria-live', 'polite');
  selectionCount.setAttribute('aria-atomic', 'true');
  const deleteSelected = element('button', 'ir-library-danger-action',
    translate('irLibrary.action.deleteSelected', 'Delete selected'));
  deleteSelected.type = 'button';
  selectionControls.append(selectionCount, deleteSelected);
  dialog.appendChild(selectionControls);

  const status = element('div', 'ir-library-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  dialog.appendChild(status);
  const importProgress = element('div', 'ir-library-import-progress');
  importProgress.hidden = true;
  const progressBar = element('progress', 'ir-library-progress');
  progressBar.max = 1;
  progressBar.setAttribute('aria-label', translate('irLibrary.aria.importProgress', 'Import progress'));
  const cancelImport = element('button', 'ir-library-danger-action',
    translate('irLibrary.action.cancelImport', 'Cancel import'));
  cancelImport.type = 'button';
  importProgress.append(progressBar, cancelImport);
  dialog.appendChild(importProgress);
  const list = element('div', 'ir-library-list');
  dialog.appendChild(list);

  let closed = false;
  let closeRequested = false;
  let activeImport = null;
  let deleteInProgress = false;
  const selectedIds = new Set();

  const isIrInUse = irId => {
    const plugins = collectUniquePipelinePlugins(
      audioManager?.pipelineA,
      audioManager?.pipelineB,
      audioManager?.pipeline
    );
    return collectExternalAssetInfo(plugins).some(info =>
      info.ids.includes(irId) || info.protectedIds.includes(irId));
  };

  const updateSelectionUi = () => {
    selectionCount.textContent = translate('irLibrary.selection.count', '{count} selected', {
      count: selectedIds.size
    });
    deleteSelected.disabled = selectedIds.size === 0 || Boolean(activeImport) || deleteInProgress;
  };

  const reportFailure = (message, error) => {
    console.error('IR library operation failed:', error);
    status.textContent = message;
  };

  const formatImportResult = (result, key, fallback, includeUnsupported) => {
    const summary = translate(key, fallback, {
      imported: result.imported.length,
      failed: result.failedCount,
      ...(includeUnsupported && { unsupported: result.unsupportedCount })
    });
    if (!result.failureCodes?.includes('file-too-large')) return summary;
    return `${summary} ${translate('irLibrary.error.fileTooLarge',
      'The selected impulse response is too large. Choose a shorter impulse response and try again.')}`;
  };

  const render = async () => {
    list.textContent = '';
    const entries = service.list({ query: search.value, sort: sort.value });
    if (!entries.length) list.appendChild(element('p', 'ir-library-empty',
      translate('irLibrary.empty', 'No matching impulse responses.')));
    for (const entry of entries) {
      const row = element('article', 'ir-library-entry');
      const selection = element('input', 'ir-library-entry-selection');
      selection.type = 'checkbox';
      selection.checked = selectedIds.has(entry.irId);
      selection.disabled = Boolean(activeImport) || deleteInProgress;
      selection.setAttribute('aria-label', translate('irLibrary.aria.select',
        'Select {name}', { name: entry.fileLabel }));
      row.setAttribute('data-selected', String(selection.checked));
      selection.addEventListener('change', () => {
        if (selection.checked) selectedIds.add(entry.irId);
        else selectedIds.delete(entry.irId);
        row.setAttribute('data-selected', String(selection.checked));
        updateSelectionUi();
      });
      row.appendChild(selection);
      const summary = element('div', 'ir-library-entry-summary');
      summary.appendChild(element('strong', '', entry.fileLabel));
      summary.appendChild(element('span', 'ir-library-badge', formatBadge(entry)));
      row.appendChild(summary);
      const decay = element('canvas', 'ir-library-decay');
      decay.width = 160;
      decay.height = 40;
      decay.setAttribute('aria-label', translate('irLibrary.aria.decayPreview',
        'Decay preview for {name}', { name: entry.fileLabel }));
      row.appendChild(decay);
      service.readAnalysis(entry.irId).then(analysis => drawDecay(decay, analysis));
      const actions = element('div', 'ir-library-actions');
      const load = element('button', 'ir-library-primary-action', translate('irLibrary.action.load', 'Load'));
      const remove = element('button', 'ir-library-danger-action', translate('irLibrary.action.delete', 'Delete'));
      load.disabled = Boolean(activeImport) || deleteInProgress;
      remove.disabled = Boolean(activeImport) || deleteInProgress;
      load.addEventListener('click', async () => {
        try {
          const loaded = await onLoad?.(entry);
          if (loaded === false) {
            status.textContent = translate('irLibrary.error.load',
              'The impulse response could not be loaded. Try importing it again or choose another one.');
            return;
          }
          closeDialog();
        } catch (error) {
          reportFailure(translate('irLibrary.error.load',
            'The impulse response could not be loaded. Try importing it again or choose another one.'), error);
        }
      });
      remove.addEventListener('click', async () => {
        if (activeImport || deleteInProgress) return;
        const confirmed = window.confirm?.(translate('irLibrary.confirm.delete',
          'Delete “{name}” from the library? This cannot be undone.', { name: entry.fileLabel })) ?? true;
        if (!confirmed) return;
        setDeleteUiActive(true);
        await render();
        try {
          const result = await service.delete(entry.irId, {
            isInUse: isIrInUse
          });
          if (result.removed) selectedIds.delete(entry.irId);
          status.textContent = result.reason === 'in-use'
            ? translate('irLibrary.status.inUse',
              'This impulse response is in use by an effect pipeline and cannot be deleted.')
            : result.removed
              ? translate('irLibrary.status.deleted', 'Impulse response deleted.')
              : translate('irLibrary.status.deleteFailed', 'The impulse response could not be deleted.');
        } catch (error) {
          reportFailure(translate('irLibrary.error.delete',
            'The impulse response could not be deleted. Please try again.'), error);
        } finally {
          setDeleteUiActive(false);
          await render();
        }
      });
      actions.append(load, remove);
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
      const message = translate('irLibrary.status.scanningFolder',
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
      ? translate('irLibrary.status.importingFile',
        'Importing “{name}”… {completed} of {total} complete ({imported} imported, {failed} failed).',
        { ...params, name: currentName })
      : translate('irLibrary.status.importing',
        'Importing… {completed} of {total} complete ({imported} imported, {failed} failed).', params);
    status.textContent = message;
    progressBar.setAttribute('aria-valuetext', message);
    if (progress.entry) void render();
  };

  const requestImportStop = () => {
    const operation = activeImport;
    if (!operation || operation.cancelRequested) return true;
    const confirmed = window.confirm?.(translate('irLibrary.confirm.cancelImport',
      'An import is still in progress. Stop it? Items already imported will remain in the library.')) ?? true;
    if (!confirmed) return false;
    operation.cancelRequested = true;
    status.textContent = translate('irLibrary.status.stoppingImport', 'Stopping import…');
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
      ? translate('irLibrary.status.scanningFolder',
        'Searching folder… {scanned} files checked, {found} supported.', { scanned: 0, found: 0 })
      : translate('irLibrary.status.preparingImport', 'Preparing import…');
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
          status.textContent = translate('irLibrary.status.importCancelled',
            'Import stopped. {imported} imported, {failed} failed.', {
              imported: result.imported.length,
              failed: result.failedCount
            });
        } else {
          status.textContent = fromFolder
            ? formatImportResult(result, 'irLibrary.status.folderResult',
              '{imported} imported, {failed} failed.', false)
            : formatImportResult(result, 'irLibrary.status.importResult',
              '{imported} imported, {failed} failed, {unsupported} unsupported.', true);
        }
      } catch (error) {
        if (operation.cancelRequested) {
          status.textContent = translate('irLibrary.status.importCancelled',
            'Import stopped. {imported} imported, {failed} failed.', {
              imported: operation.importedCount,
              failed: operation.failedCount
            });
        } else {
          reportFailure(fromFolder
            ? translate('irLibrary.error.importFolder',
              'The folder could not be imported. Please try again.')
            : translate('irLibrary.error.importFiles',
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
    const confirmed = window.confirm?.(translate('irLibrary.confirm.deleteSelected',
      'Delete {count} selected impulse responses from the library? This cannot be undone.', {
        count: ids.length
      })) ?? true;
    if (!confirmed) return;

    const result = { deleted: 0, inUse: 0, failed: 0 };
    setDeleteUiActive(true);
    status.textContent = translate('irLibrary.status.deletingSelected',
      'Deleting {count} selected impulse responses…', { count: ids.length });
    await render();
    try {
      for (const irId of ids) {
        try {
          const deletion = await service.delete(irId, { isInUse: isIrInUse });
          if (deletion.reason === 'in-use') result.inUse += 1;
          else if (deletion.removed) result.deleted += 1;
          else result.failed += 1;
        } catch (error) {
          console.error('IR library operation failed:', error);
          result.failed += 1;
        }
      }
    } finally {
      selectedIds.clear();
      setDeleteUiActive(false);
      status.textContent = translate('irLibrary.status.bulkDeleteResult',
        '{deleted} deleted, {inUse} in use, {failed} failed.', result);
      await render();
    }
  });

  cancelImport.addEventListener('click', requestImportStop);
  importButton.addEventListener('click', () => chooseImportSource(importInput));
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
    if (window.electronAPI) {
      chooseImportSource(folderInput);
      return;
    }
    if (typeof window.showDirectoryPicker !== 'function') {
      status.textContent = translate('irLibrary.status.folderUnavailable',
        'Folder import is not available here. Choose the audio files instead.');
      return;
    }
    if (activeImport && !requestImportStop()) return;
    try {
      const directory = await window.showDirectoryPicker({ mode: 'read' });
      await runImport(options => service.importDirectory(directory, options), true);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        reportFailure(translate('irLibrary.error.importFolder',
          'The folder could not be imported. Please try again.'), error);
      }
    }
  });
  search.addEventListener('input', () => {
    selectedIds.clear();
    render();
  });
  sort.addEventListener('change', render);

  const finishClose = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    window.removeEventListener?.('beforeunload', handleBeforeUnload);
    previousFocus?.focus?.();
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
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key?.toLowerCase() === 'a') {
      if (activeImport || deleteInProgress || isTextEntryTarget(event.target)) return;
      event.preventDefault?.();
      selectedIds.clear();
      for (const entry of service.list({ query: search.value, sort: sort.value })) {
        selectedIds.add(entry.irId);
      }
      render();
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
  return { element: overlay, close: closeDialog, render };
}
