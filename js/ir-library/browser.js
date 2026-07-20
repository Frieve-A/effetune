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
  importInput.accept = 'audio/*,.wav,.wave,.aif,.aiff,.flac,.mp3,.ogg,.m4a';
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

  const status = element('div', 'ir-library-status');
  status.setAttribute('role', 'status');
  dialog.appendChild(status);
  const list = element('div', 'ir-library-list');
  dialog.appendChild(list);

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
        const confirmed = window.confirm?.(translate('irLibrary.confirm.delete',
          'Delete “{name}” from the library? This cannot be undone.', { name: entry.fileLabel })) ?? true;
        if (!confirmed) return;
        try {
          const result = await service.delete(entry.irId, {
            isInUse: irId => {
              const plugins = collectUniquePipelinePlugins(
                audioManager?.pipelineA,
                audioManager?.pipelineB,
                audioManager?.pipeline
              );
              return collectExternalAssetInfo(plugins).some(info =>
                info.ids.includes(irId) || info.protectedIds.includes(irId));
            }
          });
          status.textContent = result.reason === 'in-use'
            ? translate('irLibrary.status.inUse',
              'This impulse response is in use by an effect pipeline and cannot be deleted.')
            : result.removed
              ? translate('irLibrary.status.deleted', 'Impulse response deleted.')
              : translate('irLibrary.status.deleteFailed', 'The impulse response could not be deleted.');
          await render();
        } catch (error) {
          reportFailure(translate('irLibrary.error.delete',
            'The impulse response could not be deleted. Please try again.'), error);
        }
      });
      actions.append(load, remove);
      row.appendChild(actions);
      list.appendChild(row);
    }
  };

  const importFiles = async (files, fromFolder = false) => {
    try {
      const result = await service.importFiles(files);
      status.textContent = fromFolder
        ? formatImportResult(result, 'irLibrary.status.folderResult',
          '{imported} imported, {failed} failed.', false)
        : formatImportResult(result, 'irLibrary.status.importResult',
          '{imported} imported, {failed} failed, {unsupported} unsupported.', true);
      await render();
    } catch (error) {
      reportFailure(fromFolder
        ? translate('irLibrary.error.importFolder',
          'The folder could not be imported. Please try again.')
        : translate('irLibrary.error.importFiles',
          'The selected files could not be imported. Please try again.'), error);
    }
  };
  importButton.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    await importFiles(Array.from(importInput.files || []));
    importInput.value = '';
  });
  folderInput.addEventListener('change', async () => {
    await importFiles(Array.from(folderInput.files || []), true);
    folderInput.value = '';
  });
  folderButton.addEventListener('click', async () => {
    if (window.electronAPI) {
      folderInput.click();
      return;
    }
    if (typeof window.showDirectoryPicker !== 'function') {
      status.textContent = translate('irLibrary.status.folderUnavailable',
        'Folder import is not available here. Choose the audio files instead.');
      return;
    }
    try {
      const directory = await window.showDirectoryPicker({ mode: 'read' });
      const result = await service.importDirectory(directory);
      status.textContent = formatImportResult(result, 'irLibrary.status.folderResult',
        '{imported} imported, {failed} failed.', false);
      await render();
    } catch (error) {
      if (error?.name !== 'AbortError') {
        reportFailure(translate('irLibrary.error.importFolder',
          'The folder could not be imported. Please try again.'), error);
      }
    }
  });
  search.addEventListener('input', render);
  sort.addEventListener('change', render);

  let closed = false;
  function closeDialog() {
    if (closed) return;
    closed = true;
    overlay.remove();
    previousFocus?.focus?.();
    onClose?.();
  }
  close.addEventListener('click', closeDialog);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeDialog();
  });
  overlay.addEventListener('keydown', event => {
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
  document.body.appendChild(overlay);
  render();
  search.focus();
  return { element: overlay, close: closeDialog, render };
}
