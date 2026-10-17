const KIND_ORDER = ['pipeline', 'plugin', 'visualizer', 'ir', 'measurement'];
const RESTORE_BLOCKING_STATUSES = new Set(['missing', 'unavailable']);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fallbackTranslate(key, fallback, params = {}) {
  const translated = globalThis.window?.uiManager?.t?.(key, params);
  const source = translated && translated !== key ? translated : fallback;
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    source
  );
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function kindLabel(t, kind) {
  const labels = {
    pipeline: ['backupRestore.kind.pipeline', 'Pipeline presets'],
    plugin: ['backupRestore.kind.plugin', 'Effect presets'],
    visualizer: ['backupRestore.kind.visualizer', 'Visualizer presets'],
    ir: ['backupRestore.kind.ir', 'Impulse responses'],
    measurement: ['backupRestore.kind.measurement', 'Measurements']
  };
  const [key, fallback] = labels[kind] || ['backupRestore.kind.other', 'Other'];
  return t(key, fallback);
}

function statusLabel(t, item) {
  if (!item.status) return '';
  const labels = {
    add: ['backupRestore.status.add', 'Add'],
    reuse: ['backupRestore.status.reuse', 'Use existing'],
    rename: ['backupRestore.status.rename', 'Rename to {name}'],
    missing: ['backupRestore.status.missing', 'Required data is missing'],
    unavailable: ['backupRestore.status.unavailable', 'Unavailable in this environment']
  };
  const [key, fallback] = labels[item.status] || ['', item.status];
  return key ? t(key, fallback, { name: item.targetName || item.name }) : fallback;
}

function downloadable(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function selectedRequiredBy(items, selectedKeys) {
  const result = new Map();
  for (const item of items) {
    if (!selectedKeys.has(item.key)) continue;
    for (const dependency of item.dependencies || []) {
      if (!dependency.required || !selectedKeys.has(dependency.key)) continue;
      const parents = result.get(dependency.key) || [];
      parents.push(item.name);
      result.set(dependency.key, parents);
    }
  }
  return result;
}

function removeWithParents(items, selectedKeys, key) {
  const next = new Set(selectedKeys);
  const pending = [key];
  while (pending.length) {
    const removed = pending.pop();
    if (!next.delete(removed)) continue;
    for (const item of items) {
      if (!next.has(item.key)) continue;
      if ((item.dependencies || []).some(dependency => dependency.required && dependency.key === removed)) {
        pending.push(item.key);
      }
    }
  }
  return next;
}

function resultItems(result, key) {
  return Array.isArray(result?.[key]) ? result[key] : [];
}

export function openUserDataBackupDialog({ service, translate = fallbackTranslate, onRestored } = {}) {
  if (!service) throw new TypeError('User data backup service is required.');
  const t = (key, fallback, params) => translate(key, fallback, params || {});
  const previousFocus = document.activeElement;
  const overlay = element('div', 'backup-restore-overlay');
  const dialog = element('section', 'backup-restore-dialog');
  dialog.tabIndex = -1;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'backupRestoreTitle');
  overlay.appendChild(dialog);

  const header = element('div', 'backup-restore-header');
  const heading = element('div');
  const title = element('h2', '', t('backupRestore.title', 'Backup / Restore'));
  title.id = 'backupRestoreTitle';
  const intro = element('p', '', t(
    'backupRestore.intro',
    'Move saved presets, impulse responses, and measurements between EffeTune installations.'
  ));
  heading.append(title, intro);
  const closeButton = element('button', 'backup-restore-close', t('backupRestore.action.close', 'Close'));
  closeButton.type = 'button';
  header.append(heading, closeButton);
  dialog.appendChild(header);

  const modeTabs = element('div', 'backup-restore-tabs');
  modeTabs.setAttribute('role', 'tablist');
  const backupTab = element('button', 'active', t('backupRestore.mode.backup', 'Create backup'));
  const restoreTab = element('button', '', t('backupRestore.mode.restore', 'Restore from file'));
  backupTab.type = restoreTab.type = 'button';
  backupTab.setAttribute('role', 'tab');
  restoreTab.setAttribute('role', 'tab');
  backupTab.setAttribute('aria-selected', 'true');
  restoreTab.setAttribute('aria-selected', 'false');
  modeTabs.append(backupTab, restoreTab);
  dialog.appendChild(modeTabs);

  const restorePicker = element('div', 'backup-restore-picker');
  restorePicker.hidden = true;
  const fileInput = element('input');
  fileInput.type = 'file';
  fileInput.accept = '.effetune_backup,application/zip';
  fileInput.hidden = true;
  const chooseFile = element('button', '', t('backupRestore.action.chooseFile', 'Choose backup file…'));
  chooseFile.type = 'button';
  const chosenFile = element('span', 'backup-restore-file-name', t('backupRestore.file.none', 'No file selected'));
  restorePicker.append(chooseFile, chosenFile, fileInput);
  dialog.appendChild(restorePicker);

  const options = element('div', 'backup-restore-options');
  const embedMeasurement = element('input');
  embedMeasurement.type = 'checkbox';
  embedMeasurement.checked = true;
  const embedMeasurementLabel = element('label');
  embedMeasurementLabel.append(embedMeasurement, document.createTextNode(t(
    'backupRestore.embed.measurements', 'Include measurement data'
  )));
  const embedIr = element('input');
  embedIr.type = 'checkbox';
  embedIr.checked = true;
  const embedIrLabel = element('label');
  embedIrLabel.append(embedIr, document.createTextNode(t(
    'backupRestore.embed.ir', 'Include impulse response data'
  )));
  options.append(embedMeasurementLabel, embedIrLabel);
  dialog.appendChild(options);

  const referenceWarning = element('p', 'backup-restore-warning');
  referenceWarning.hidden = true;
  dialog.appendChild(referenceWarning);

  const controls = element('div', 'backup-restore-controls');
  const search = element('input');
  search.type = 'search';
  search.placeholder = t('backupRestore.search.placeholder', 'Search saved data');
  search.setAttribute('aria-label', t('backupRestore.search.aria', 'Search saved data'));
  const selectionSummary = element('span', 'backup-restore-selection-summary');
  selectionSummary.setAttribute('aria-live', 'polite');
  selectionSummary.setAttribute('aria-atomic', 'true');
  controls.append(search, selectionSummary);
  dialog.appendChild(controls);

  const unavailable = element('div', 'backup-restore-unavailable');
  unavailable.setAttribute('role', 'status');
  dialog.appendChild(unavailable);
  const list = element('div', 'backup-restore-list');
  dialog.appendChild(list);
  const status = element('div', 'backup-restore-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  dialog.appendChild(status);

  const progressArea = element('div', 'backup-restore-progress');
  progressArea.hidden = true;
  const progress = element('progress');
  progress.max = 1;
  progress.setAttribute('aria-label', t('backupRestore.progress.aria', 'Backup or restore progress'));
  const progressText = element('span');
  const cancelButton = element('button', '', t('backupRestore.action.cancel', 'Cancel'));
  cancelButton.type = 'button';
  progressArea.append(progress, progressText, cancelButton);
  dialog.appendChild(progressArea);

  const resultArea = element('section', 'backup-restore-result');
  resultArea.hidden = true;
  dialog.appendChild(resultArea);
  const actions = element('div', 'backup-restore-actions');
  const runButton = element('button', 'backup-restore-primary', t('backupRestore.action.create', 'Create backup'));
  runButton.type = 'button';
  actions.append(runButton);
  dialog.appendChild(actions);

  let mode = 'backup';
  let catalog = null;
  let items = [];
  let selectedKeys = new Set();
  let restorePlan = null;
  let controller = null;
  let busy = false;
  let closed = false;
  let selectionRevision = 0;
  let selectionPending = false;
  let selectionValid = false;

  const isSelectable = item => item.available !== false &&
    (mode !== 'restore' || !RESTORE_BLOCKING_STATUSES.has(item.status));

  const effectiveBytes = item => {
    if (item.kind === 'ir' && !embedIr.checked) return 0;
    if (item.kind === 'measurement' && !embedMeasurement.checked) return 0;
    return Number(item.bytes) || 0;
  };

  const renderReferenceWarning = () => {
    const omitted = [];
    if (!embedMeasurement.checked) omitted.push(t('backupRestore.kind.measurement', 'Measurements'));
    if (!embedIr.checked) omitted.push(t('backupRestore.kind.ir', 'Impulse responses'));
    referenceWarning.hidden = omitted.length === 0 || mode !== 'backup';
    referenceWarning.textContent = referenceWarning.hidden ? '' : t(
      'backupRestore.embed.warning',
      '{types} will be saved as references only. The backup will need matching data at the restore destination.',
      { types: omitted.join(', ') }
    );
  };

  const renderUnavailable = () => {
    unavailable.textContent = '';
    for (const entry of catalog?.unavailable || []) {
      const message = element('p');
      message.textContent = t('backupRestore.unavailable', '{type}: {reason}', {
        type: kindLabel(t, entry.kind), reason: entry.reason || t('backupRestore.reason.unknown', 'Could not be read')
      });
      unavailable.appendChild(message);
    }
  };

  const updateSummary = () => {
    const selected = items.filter(item => selectedKeys.has(item.key));
    const bytes = selected.reduce((sum, item) => sum + effectiveBytes(item), 0);
    const exceedsLimit = mode === 'backup' && Number(catalog?.maxBytes) > 0 && bytes > catalog.maxBytes;
    selectionSummary.textContent = t(
      'backupRestore.selection.summary',
      '{count} selected · about {size}',
      { count: selected.length, size: formatBytes(bytes) }
    );
    selectionSummary.dataset.overLimit = String(exceedsLimit);
    if (exceedsLimit) {
      status.textContent = t(
        'backupRestore.selection.tooLarge',
        'This selection is over the {size} backup limit. Clear some items and create separate backups.',
        { size: formatBytes(catalog.maxBytes) }
      );
    } else if (status.dataset.limitMessage === 'true') {
      status.textContent = '';
    }
    status.dataset.limitMessage = String(exceedsLimit);
    runButton.disabled = busy || selectionPending || !selectionValid || exceedsLimit || selected.length === 0 ||
      (mode === 'restore' && !restorePlan);
  };

  const applySelection = async nextKeys => {
    if (!catalog) return;
    const revision = ++selectionRevision;
    const selectionMode = mode;
    selectedKeys = new Set(nextKeys);
    selectionPending = true;
    selectionValid = false;
    if (selectionMode === 'restore') restorePlan = null;
    renderList();
    try {
      if (selectionMode === 'backup') {
        const selected = await service.select(catalog, nextKeys);
        if (revision !== selectionRevision || mode !== selectionMode) return;
        selectedKeys = selected instanceof Set ? selected : new Set(selected || []);
      } else {
        const plan = await service.planRestore(catalog, nextKeys);
        if (revision !== selectionRevision || mode !== selectionMode) return;
        restorePlan = plan;
        items = restorePlan.items || catalog.items || [];
        selectedKeys = new Set(items.filter(item => item.selected).map(item => item.key));
      }
      selectionValid = true;
      if (status.dataset.selectionError === 'true') status.textContent = '';
      status.dataset.selectionError = 'false';
    } catch (error) {
      if (revision !== selectionRevision || mode !== selectionMode) return;
      status.dataset.selectionError = 'true';
      reportError(t(
        'backupRestore.error.selection',
        'The selection could not be updated. Try again.'
      ), error);
    } finally {
      if (revision === selectionRevision && mode === selectionMode) {
        selectionPending = false;
        renderList();
      }
    }
  };

  const renderList = () => {
    const activeControl = document.activeElement;
    const restoreListFocus = activeControl && list.contains(activeControl);
    const activeItemKey = activeControl?.dataset.focusItemKey;
    const activeGroupKind = activeControl?.dataset.focusGroupKind;
    const activeGroupAction = activeControl?.dataset.focusGroupAction;
    let matchingControl = null;
    let groupFallback = null;
    list.textContent = '';
    const query = search.value.trim().toLocaleLowerCase();
    const requiredBy = selectedRequiredBy(items, selectedKeys);
    for (const kind of KIND_ORDER) {
      const kindItems = items.filter(item => item.kind === kind);
      if (!kindItems.length) continue;
      const section = element('section', 'backup-restore-group');
      const groupHeader = element('div', 'backup-restore-group-header');
      groupHeader.appendChild(element('h3', '', kindLabel(t, kind)));
      const selectAll = element('button', '', t('backupRestore.action.selectAll', 'Select all'));
      selectAll.type = 'button';
      const clearAll = element('button', '', t('backupRestore.action.clearAll', 'Clear'));
      clearAll.type = 'button';
      selectAll.dataset.focusGroupKind = kind;
      selectAll.dataset.focusGroupAction = 'select';
      clearAll.dataset.focusGroupKind = kind;
      clearAll.dataset.focusGroupAction = 'clear';
      selectAll.disabled = busy || !kindItems.some(isSelectable);
      clearAll.disabled = busy || !kindItems.some(item => selectedKeys.has(item.key));
      if (activeGroupKind === kind) {
        matchingControl = activeGroupAction === 'clear' ? clearAll : selectAll;
        groupFallback = activeGroupAction === 'clear' ? selectAll : clearAll;
      }
      selectAll.addEventListener('click', () => {
        const next = new Set(selectedKeys);
        kindItems.filter(isSelectable).forEach(item => next.add(item.key));
        void applySelection(next);
      });
      clearAll.addEventListener('click', () => {
        let next = new Set(selectedKeys);
        kindItems.forEach(item => { next = removeWithParents(items, next, item.key); });
        void applySelection(next);
      });
      groupHeader.append(selectAll, clearAll);
      section.appendChild(groupHeader);
      let visibleCount = 0;
      for (const item of kindItems) {
        const searchable = `${item.name || ''} ${item.pluginName || ''}`.toLocaleLowerCase();
        if (query && !searchable.includes(query)) continue;
        visibleCount += 1;
        const row = element('label', 'backup-restore-row');
        row.dataset.selected = String(selectedKeys.has(item.key));
        row.dataset.available = String(isSelectable(item));
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.focusItemKey = item.key;
        checkbox.checked = selectedKeys.has(item.key);
        checkbox.disabled = busy || !isSelectable(item);
        if (activeItemKey === item.key) matchingControl = checkbox;
        checkbox.setAttribute('aria-label', t('backupRestore.item.select', 'Select {name}', { name: item.name }));
        checkbox.addEventListener('change', () => {
          let next = new Set(selectedKeys);
          if (checkbox.checked) {
            next.add(item.key);
            for (const dependency of item.dependencies || []) {
              if (dependency.required) continue;
              const dependentItem = items.find(candidate => candidate.key === dependency.key);
              if (dependentItem && isSelectable(dependentItem)) next.add(dependency.key);
            }
          }
          else next = removeWithParents(items, next, item.key);
          void applySelection(next);
        });
        const detail = element('span', 'backup-restore-row-detail');
        const name = element('strong', '', item.name || t('backupRestore.item.unnamed', 'Unnamed item'));
        detail.appendChild(name);
        const metadata = [];
        if (item.pluginName) metadata.push(item.pluginName);
        if (mode === 'backup' && ((item.kind === 'ir' && !embedIr.checked) ||
            (item.kind === 'measurement' && !embedMeasurement.checked))) {
          metadata.push(t('backupRestore.item.referenceOnly', 'Reference only'));
        } else if (item.bytes) {
          metadata.push(formatBytes(item.bytes));
        }
        const parents = requiredBy.get(item.key);
        if (parents?.length) metadata.push(t('backupRestore.item.required', 'Required by {names}', {
          names: parents.join(', ')
        }));
        const restoreStatus = statusLabel(t, item);
        if (restoreStatus) metadata.push(restoreStatus);
        if (item.applicable === false && item.applyReason) metadata.push(item.applyReason);
        if (item.reason) metadata.push(item.reason);
        if (metadata.length) detail.appendChild(element('span', 'backup-restore-row-meta', metadata.join(' · ')));
        row.append(checkbox, detail);
        section.appendChild(row);
      }
      if (!visibleCount) section.appendChild(element('p', 'backup-restore-empty', t(
        'backupRestore.search.empty', 'No matching items in this category.'
      )));
      list.appendChild(section);
    }
    if (!items.length) list.appendChild(element('p', 'backup-restore-empty', t(
      'backupRestore.empty', 'No saved data is available.'
    )));
    renderReferenceWarning();
    updateSummary();
    if (restoreListFocus) {
      const focusTarget = matchingControl && !matchingControl.disabled
        ? matchingControl
        : (groupFallback && !groupFallback.disabled ? groupFallback : search);
      focusTarget.focus();
    }
  };

  const showResult = result => {
    resultArea.textContent = '';
    resultArea.hidden = false;
    resultArea.appendChild(element('h3', '', t('backupRestore.result.title', 'Result')));
    const definitions = [
      ['added', 'backupRestore.result.added', 'Added'],
      ['reused', 'backupRestore.result.reused', 'Used existing'],
      ['renamed', 'backupRestore.result.renamed', 'Renamed'],
      ['failed', 'backupRestore.result.failed', 'Failed'],
      ['unprocessed', 'backupRestore.result.unprocessed', 'Not processed']
    ];
    for (const [key, labelKey, fallback] of definitions) {
      const entries = resultItems(result, key);
      if (!entries.length) continue;
      const block = element('div', 'backup-restore-result-group');
      block.appendChild(element('strong', '', `${t(labelKey, fallback)}: ${entries.length}`));
      const names = entries.map(entry => {
        const target = entry.targetName && entry.targetName !== entry.name ? ` → ${entry.targetName}` : '';
        const reason = entry.reason ? ` (${entry.reason})` : '';
        const mirror = entry.mirrorWarning
          ? ` (${typeof entry.mirrorWarning === 'string'
            ? entry.mirrorWarning
            : t('backupRestore.result.mirrorWarning', 'Saved, but its automatic desktop mirror could not be updated.')})`
          : '';
        return `${entry.name || entry.key}${target}${reason}${mirror}`;
      });
      block.appendChild(element('p', '', names.join(', ')));
      resultArea.appendChild(block);
    }
  };

  const setBusy = value => {
    // Disabling the focused control would otherwise send keyboard events to the page.
    if (value && dialog.contains(document.activeElement)) dialog.focus();
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    backupTab.disabled = value;
    restoreTab.disabled = value;
    chooseFile.disabled = value;
    search.disabled = value;
    embedMeasurement.disabled = value;
    embedIr.disabled = value;
    closeButton.disabled = value;
    progressArea.hidden = !value;
    renderList();
  };

  const reportError = (message, error) => {
    console.error('User data backup operation failed:', error);
    status.textContent = message;
  };

  const loadBackupCatalog = async () => {
    setBusy(true);
    status.textContent = t('backupRestore.status.reading', 'Reading saved data…');
    try {
      catalog = await service.listBackup();
      items = catalog.items || [];
      const initial = new Set(items.filter(item => item.available !== false).map(item => item.key));
      selectedKeys = await service.select(catalog, initial);
      if (!(selectedKeys instanceof Set)) selectedKeys = new Set(selectedKeys || []);
      selectionValid = true;
      renderUnavailable();
      status.textContent = '';
    } catch (error) {
      catalog = null;
      items = [];
      selectedKeys.clear();
      selectionValid = false;
      reportError(t(
        'backupRestore.error.read',
        'Some saved data could not be read. Close this window and try again.'
      ), error);
    } finally {
      setBusy(false);
    }
  };

  const openFile = async file => {
    ++selectionRevision;
    selectionPending = false;
    selectionValid = false;
    setBusy(true);
    resultArea.hidden = true;
    status.textContent = t('backupRestore.status.opening', 'Checking backup file…');
    try {
      catalog = await service.openBackup(file);
      const initial = new Set((catalog.items || []).filter(item => item.available !== false).map(item => item.key));
      restorePlan = await service.planRestore(catalog, initial);
      items = restorePlan.items || catalog.items || [];
      selectedKeys = new Set(items.filter(item => item.selected).map(item => item.key));
      selectionValid = true;
      renderUnavailable();
      chosenFile.textContent = file.name;
      status.textContent = '';
    } catch (error) {
      catalog = null;
      restorePlan = null;
      items = [];
      selectedKeys.clear();
      selectionValid = false;
      chosenFile.textContent = t('backupRestore.file.none', 'No file selected');
      reportError(t(
        'backupRestore.error.open',
        'That backup file could not be opened. Choose an EffeTune backup file and try again.'
      ), error);
    } finally {
      fileInput.value = '';
      setBusy(false);
    }
  };

  const updateProgress = value => {
    const completed = Number(value?.completed) || 0;
    const total = Math.max(1, Number(value?.total) || 1);
    progress.max = total;
    progress.value = completed;
    progressText.textContent = t('backupRestore.progress', '{completed} of {total}: {name}', {
      completed, total, name: value?.currentName || ''
    });
  };

  const run = async () => {
    if (!catalog || !selectedKeys.size || busy || selectionPending || !selectionValid ||
        (mode === 'restore' && !restorePlan)) return;
    controller = new AbortController();
    resultArea.hidden = true;
    setBusy(true);
    status.textContent = mode === 'backup'
      ? t('backupRestore.status.creating', 'Creating backup…')
      : t('backupRestore.status.restoring', 'Restoring selected data…');
    updateProgress({ completed: 0, total: selectedKeys.size, currentName: '' });
    try {
      if (mode === 'backup') {
        const output = await service.createBackup(catalog, selectedKeys, {
          embedMeasurements: embedMeasurement.checked,
          embedIr: embedIr.checked,
          signal: controller.signal,
          onProgress: updateProgress
        });
        downloadable(output.blob, output.fileName);
        const count = output.result?.count ?? selectedKeys.size;
        status.textContent = t('backupRestore.success.created', 'Backup created with {count} items.', { count });
      } else {
        const result = await service.restore(restorePlan, {
          signal: controller.signal,
          onProgress: updateProgress
        });
        showResult(result);
        status.textContent = result.cancelled
          ? t('backupRestore.status.cancelled', 'Restore stopped. Items already completed were kept.')
          : t('backupRestore.success.restored', 'Restore finished.');
        await onRestored?.(result);
      }
    } catch (error) {
      const cancelled = controller.signal.aborted || error?.name === 'AbortError';
      if (cancelled) {
        status.textContent = mode === 'backup'
          ? t('backupRestore.status.backupCancelled', 'Backup stopped. No backup file was created.')
          : t('backupRestore.status.cancelled', 'Restore stopped. Items already completed were kept.');
      } else {
        reportError(mode === 'backup'
          ? t('backupRestore.error.create', 'The backup could not be created. Check available storage and try again.')
          : t('backupRestore.error.restore', 'The selected data could not be fully restored. Review the result and try again.'), error);
      }
    } finally {
      controller = null;
      setBusy(false);
    }
  };

  const changeMode = nextMode => {
    if (busy || mode === nextMode) return;
    mode = nextMode;
    const backup = mode === 'backup';
    backupTab.classList.toggle('active', backup);
    restoreTab.classList.toggle('active', !backup);
    backupTab.setAttribute('aria-selected', String(backup));
    restoreTab.setAttribute('aria-selected', String(!backup));
    options.hidden = !backup;
    restorePicker.hidden = backup;
    runButton.textContent = backup
      ? t('backupRestore.action.create', 'Create backup')
      : t('backupRestore.action.restore', 'Restore selected');
    catalog = null;
    restorePlan = null;
    items = [];
    selectedKeys.clear();
    ++selectionRevision;
    selectionPending = false;
    selectionValid = false;
    resultArea.hidden = true;
    unavailable.textContent = '';
    status.textContent = '';
    renderList();
    if (backup) void loadBackupCatalog();
  };

  const finishClose = () => {
    if (closed || busy) return;
    closed = true;
    overlay.remove();
    previousFocus?.focus?.();
  };

  closeButton.addEventListener('click', finishClose);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) finishClose();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation?.();
      event.preventDefault();
      finishClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
    )).filter(node => !node.hidden && node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  backupTab.addEventListener('click', () => changeMode('backup'));
  restoreTab.addEventListener('click', () => changeMode('restore'));
  chooseFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    if (file) void openFile(file);
  });
  search.addEventListener('input', renderList);
  embedMeasurement.addEventListener('change', renderList);
  embedIr.addEventListener('change', renderList);
  cancelButton.addEventListener('click', () => controller?.abort());
  runButton.addEventListener('click', () => void run());

  document.body.appendChild(overlay);
  renderList();
  backupTab.focus();
  void loadBackupCatalog();
  return { element: overlay, close: finishClose };
}

export const __test = { removeWithParents, selectedRequiredBy, formatBytes };
