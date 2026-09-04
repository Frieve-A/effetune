import assert from 'node:assert/strict';
import test from 'node:test';

import { openIrLibraryBrowser } from '../../js/ir-library/browser.js';
import {
  createConsoleHarness,
  replaceGlobal
} from '../helpers/global-test-utils.mjs';

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = {};
    this.className = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.clickCount = 0;
    this._textContent = '';
    this.canvasCalls = [];
  }

  set textContent(value) {
    this._textContent = String(value);
    if (value === '') this.children = [];
  }

  get textContent() { return this._textContent; }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    if (this.tagName === 'SELECT' && !this.value) this.value = child.value;
    return child;
  }

  append(...children) { children.forEach(child => this.appendChild(child)); }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  removeAttribute(name) { delete this.attributes[name]; }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, event = {}) {
    await Promise.all((this.listeners.get(type) || []).map(listener => listener({ target: this, ...event })));
  }

  focus() {
    this.focused = true;
    if (globalThis.document) globalThis.document.activeElement = this;
  }

  querySelectorAll() {
    return flatten(this).slice(1).filter(element =>
      !element.disabled && !element.hidden &&
      (element.tagName === 'BUTTON' || element.tagName === 'INPUT' || element.tagName === 'SELECT' ||
        (element.attributes.tabindex !== undefined && element.attributes.tabindex !== '-1'))
    );
  }

  click() {
    this.clickCount += 1;
    return this.dispatch('click');
  }

  getContext() {
    if (this.tagName !== 'CANVAS') return null;
    const call = name => (...args) => this.canvasCalls.push([name, ...args]);
    return {
      clearRect: call('clearRect'),
      beginPath: call('beginPath'),
      moveTo: call('moveTo'),
      lineTo: call('lineTo'),
      stroke: call('stroke'),
      set strokeStyle(value) { this._strokeStyle = value; }
    };
  }
}

const flatten = root => [root, ...root.children.flatMap(flatten)];
const byClass = (root, className) => flatten(root).filter(element => element.className === className);
const buttons = root => flatten(root).filter(element => element.tagName === 'BUTTON');
const button = (root, text) => buttons(root).find(element => element.textContent === text);
const rowName = row => flatten(row).find(element => element.tagName === 'STRONG')?.textContent;
const deferred = () => {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
};
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('IR library modal executes filename filtering, sorting, actions, previews, and cleanup', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  globalThis.document = { body, createElement: tagName => new Element(tagName) };
  globalThis.window = {};

  const entries = [
    {
      irId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileLabel: 'Alpha.wav', importedAt: '2026-01-01T00:00:00Z',
      channels: 2, topology: 'independent', frames: 48000, sampleRate: 48000
    },
    {
      irId: 'bbbbbbbbbbbbbbbbbbbbbbbb', fileLabel: 'Bravo.wav', importedAt: '2026-03-01T00:00:00Z',
      channels: 1, topology: 'mono', frames: 24000, sampleRate: 48000
    },
    {
      irId: 'cccccccccccccccccccccccc', fileLabel: 'Zulu.wav', importedAt: '2026-02-01T00:00:00Z',
      channels: 4, topology: 'true-stereo', frames: 96000, sampleRate: 48000
    },
    {
      irId: 'dddddddddddddddddddddddd', fileLabel: 'Yankee.wav', importedAt: '2025-12-01T00:00:00Z',
      channels: 4, topology: 'matrix', frames: 96000, sampleRate: 48000
    }
  ];
  const calls = [];
  const service = {
    list({ query = '', sort = 'filename' }) {
      const filtered = entries.filter(entry => !query ||
        entry.fileLabel.toLowerCase().includes(query.toLowerCase()));
      return filtered.sort(sort === 'recent'
        ? (left, right) => right.importedAt.localeCompare(left.importedAt)
        : (left, right) => left.fileLabel.localeCompare(right.fileLabel));
    },
    async readAnalysis(id) {
      calls.push(['analysis', id]);
      return { edc: new Float32Array([0, -20, -60]) };
    },
    async delete(id, options) {
      const inUse = options.isInUse(id);
      calls.push(['delete', id, inUse]);
      return inUse ? { removed: false, reason: 'in-use' } : { removed: true, reason: null };
    }
  };

  try {
    const inUsePlugin = {
      externalAssetInfo: {
        missing: false,
        kind: 'IR',
        ids: ['bbbbbbbbbbbbbbbbbbbbbbbb'],
        protectedIds: ['bbbbbbbbbbbbbbbbbbbbbbbb'],
        names: ['Bravo.wav']
      }
    };
    const pendingPlugin = {
      externalAssetInfo: {
        ids: [],
        names: [],
        protectedIds: ['aaaaaaaaaaaaaaaaaaaaaaaa']
      }
    };
    const modal = openIrLibraryBrowser({
      service,
      audioManager: {
        pipelineA: [pendingPlugin],
        pipelineB: [inUsePlugin],
        pipeline: []
      }
    });
    await modal.render();
    await Promise.resolve();
    const fileInputs = flatten(modal.element).filter(element =>
      element.tagName === 'INPUT' && element.type === 'file');
    assert.equal(fileInputs.length, 2);
    assert.equal(fileInputs.every(input => input.accept.includes('.irs')), true);
    assert.deepEqual(byClass(modal.element, 'ir-library-entry').map(rowName),
      ['Alpha.wav', 'Bravo.wav', 'Yankee.wav', 'Zulu.wav']);
    assert.equal(calls.filter(call => call[0] === 'analysis').length >= 4, true);
    assert.equal(byClass(modal.element, 'ir-library-decay').every(canvas =>
      canvas.canvasCalls.some(call => call[0] === 'stroke')), true);
    const badges = new Map(byClass(modal.element, 'ir-library-entry').map(row => [
      rowName(row), byClass(row, 'ir-library-badge')[0].textContent
    ]));
    assert.match(badges.get('Alpha.wav'), /Independent/);
    assert.match(badges.get('Bravo.wav'), /Mono/);
    assert.match(badges.get('Yankee.wav'), /Diagonal Matrix/);
    assert.match(badges.get('Zulu.wav'), /True Stereo/);
    assert.doesNotMatch([...badges.values()].join(' '), /true-stereo|independent|matrix/);

    const search = flatten(modal.element).find(element => element.tagName === 'INPUT' && element.type === 'search');
    search.value = 'bravo';
    await search.dispatch('input');
    await Promise.resolve();
    assert.deepEqual(byClass(modal.element, 'ir-library-entry').map(rowName), ['Bravo.wav']);

    search.value = '';
    const sort = flatten(modal.element).find(element => element.tagName === 'SELECT');
    sort.value = 'recent';
    await sort.dispatch('change');
    await Promise.resolve();
    assert.deepEqual(byClass(modal.element, 'ir-library-entry').map(rowName),
      ['Bravo.wav', 'Zulu.wav', 'Alpha.wav', 'Yankee.wav']);

    const bravo = byClass(modal.element, 'ir-library-entry').find(row => rowName(row) === 'Bravo.wav');
    await button(bravo, 'Delete').click();
    assert.equal(calls.some(call => call[0] === 'delete' && call[1] === 'bbbbbbbbbbbbbbbbbbbbbbbb'), true);
    assert.match(byClass(modal.element, 'ir-library-status')[0].textContent, /in use/);

    let alpha = byClass(modal.element, 'ir-library-entry').find(row => rowName(row) === 'Alpha.wav');
    await button(alpha, 'Delete').click();
    let alphaDelete = calls.filter(call => call[0] === 'delete' &&
      call[1] === 'aaaaaaaaaaaaaaaaaaaaaaaa').at(-1);
    assert.equal(alphaDelete[2], true);
    assert.match(byClass(modal.element, 'ir-library-status')[0].textContent, /in use/);

    pendingPlugin.externalAssetInfo.protectedIds = [];
    alpha = byClass(modal.element, 'ir-library-entry').find(row => rowName(row) === 'Alpha.wav');
    await button(alpha, 'Delete').click();
    alphaDelete = calls.filter(call => call[0] === 'delete' &&
      call[1] === 'aaaaaaaaaaaaaaaaaaaaaaaa').at(-1);
    assert.equal(alphaDelete[2], false);

    modal.close();
    assert.equal(body.children.includes(modal.element), false);

    let loaded = null;
    const loadModal = openIrLibraryBrowser({ service, onLoad: entry => { loaded = entry; } });
    await loadModal.render();
    const alphaRow = byClass(loadModal.element, 'ir-library-entry').find(row => rowName(row) === 'Alpha.wav');
    await button(alphaRow, 'Load').click();
    assert.equal(loaded.irId, 'aaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(body.children.includes(loadModal.element), false);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('IR library modal selects multiple entries and deletes them in one confirmed operation', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  const confirmations = [false, true];
  const confirmationMessages = [];
  const deleteCalls = [];
  const diagnostics = [];
  const restoreConsole = replaceGlobal('console', createConsoleHarness({
    error: (...args) => diagnostics.push(args)
  }));
  const entries = [
    {
      irId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileLabel: 'Alpha.wav', importedAt: '2026-01-01T00:00:00Z',
      channels: 2, topology: 'independent', frames: 48000, sampleRate: 48000
    },
    {
      irId: 'bbbbbbbbbbbbbbbbbbbbbbbb', fileLabel: 'Bravo.wav', importedAt: '2026-03-01T00:00:00Z',
      channels: 1, topology: 'mono', frames: 24000, sampleRate: 48000
    },
    {
      irId: 'cccccccccccccccccccccccc', fileLabel: 'Charlie.wav', importedAt: '2026-02-01T00:00:00Z',
      channels: 4, topology: 'true-stereo', frames: 96000, sampleRate: 48000
    }
  ];
  globalThis.document = { body, createElement: tagName => new Element(tagName) };
  globalThis.window = {
    confirm(message) {
      confirmationMessages.push(message);
      return confirmations.shift();
    }
  };
  const service = {
    list({ query = '', sort = 'filename' } = {}) {
      return entries.filter(entry => !query || entry.fileLabel.toLowerCase().includes(query.toLowerCase()))
        .sort(sort === 'recent'
          ? (left, right) => right.importedAt.localeCompare(left.importedAt)
          : (left, right) => left.fileLabel.localeCompare(right.fileLabel));
    },
    async readAnalysis() { return null; },
    async delete(id, options) {
      const inUse = options.isInUse(id);
      deleteCalls.push([id, inUse]);
      if (inUse) return { removed: false, reason: 'in-use' };
      if (id === 'cccccccccccccccccccccccc') throw new Error('raw bulk delete diagnostic');
      const index = entries.findIndex(entry => entry.irId === id);
      entries.splice(index, 1);
      return { removed: true, reason: null };
    }
  };
  const inUsePlugin = {
    externalAssetInfo: {
      missing: false,
      kind: 'IR',
      ids: ['bbbbbbbbbbbbbbbbbbbbbbbb'],
      protectedIds: [],
      names: ['Bravo.wav']
    }
  };

  try {
    const modal = openIrLibraryBrowser({
      service,
      audioManager: { pipelineA: [inUsePlugin], pipelineB: [], pipeline: [] }
    });
    await modal.render();
    const deleteSelected = button(modal.element, 'Delete selected');
    const selectionCount = byClass(modal.element, 'ir-library-selection-count')[0];
    assert.equal(deleteSelected.disabled, true);
    assert.equal(selectionCount.textContent, '0 selected');

    const select = async name => {
      const row = byClass(modal.element, 'ir-library-entry').find(item => rowName(item) === name);
      const checkbox = byClass(row, 'ir-library-entry-selection')[0];
      assert.equal(checkbox.attributes['aria-label'], `Select ${name}`);
      checkbox.checked = true;
      await checkbox.dispatch('change');
    };
    await select('Alpha.wav');
    await select('Bravo.wav');
    assert.equal(selectionCount.textContent, '2 selected');

    const sort = flatten(modal.element).find(element => element.tagName === 'SELECT');
    sort.value = 'recent';
    await sort.dispatch('change');
    assert.equal(byClass(modal.element, 'ir-library-entry-selection')
      .filter(checkbox => checkbox.checked).length, 2);

    const search = flatten(modal.element).find(element => element.type === 'search');
    search.value = 'alpha';
    await search.dispatch('input');
    assert.equal(selectionCount.textContent, '0 selected');
    assert.equal(byClass(modal.element, 'ir-library-entry-selection')[0].checked, false);

    let selectAllPrevented = 0;
    const selectAll = (target = modal.element) => modal.element.dispatch('keydown', {
      key: 'a',
      ctrlKey: true,
      target,
      preventDefault() { selectAllPrevented += 1; }
    });
    await selectAll(search);
    assert.equal(selectAllPrevented, 0);
    assert.equal(selectionCount.textContent, '0 selected');
    await selectAll();
    assert.equal(selectionCount.textContent, '1 selected');

    search.value = '';
    await search.dispatch('input');
    await selectAll();
    assert.equal(selectAllPrevented, 2);
    assert.equal(byClass(modal.element, 'ir-library-entry-selection')
      .every(checkbox => checkbox.checked), true);
    assert.equal(deleteSelected.disabled, false);
    assert.equal(selectionCount.textContent, '3 selected');

    await deleteSelected.click();
    assert.deepEqual(deleteCalls, []);
    assert.equal(selectionCount.textContent, '3 selected');

    await deleteSelected.click();
    assert.deepEqual(deleteCalls, [
      ['bbbbbbbbbbbbbbbbbbbbbbbb', true],
      ['cccccccccccccccccccccccc', false],
      ['aaaaaaaaaaaaaaaaaaaaaaaa', false]
    ]);
    assert.match(confirmationMessages[0], /3 selected impulse responses/);
    assert.equal(byClass(modal.element, 'ir-library-status')[0].textContent,
      '1 deleted, 1 in use, 1 failed.');
    assert.doesNotMatch(byClass(modal.element, 'ir-library-status')[0].textContent,
      /raw bulk delete diagnostic/);
    assert.deepEqual(byClass(modal.element, 'ir-library-entry').map(rowName),
      ['Bravo.wav', 'Charlie.wav']);
    assert.equal(byClass(modal.element, 'ir-library-entry-selection')
      .every(checkbox => checkbox.checked === false), true);
    assert.equal(selectionCount.textContent, '0 selected');
    assert.equal(deleteSelected.disabled, true);
    assert.equal(diagnostics.length, 1);
  } finally {
    restoreConsole();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('IR library modal refreshes the visible entries immediately after file and folder imports', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  const entries = [];
  const createEntry = (irId, fileLabel) => ({
    irId,
    fileLabel,
    importedAt: '2026-07-20T00:00:00Z',
    channels: 2,
    topology: 'independent',
    frames: 48000,
    sampleRate: 48000
  });
  const fileEntry = createEntry('aaaaaaaaaaaaaaaaaaaaaaaa', 'File Hall');
  const folderEntry = createEntry('bbbbbbbbbbbbbbbbbbbbbbbb', 'Folder Room');
  globalThis.document = { body, createElement: tagName => new Element(tagName) };
  globalThis.window = { async showDirectoryPicker() { return {}; } };
  const service = {
    list() { return [...entries]; },
    async readAnalysis() { return null; },
    async importFiles() {
      entries.push(fileEntry);
      return { imported: [fileEntry], failedCount: 0, unsupportedCount: 0, failureCodes: [] };
    },
    async importDirectory() {
      entries.push(folderEntry);
      return { imported: [folderEntry], failedCount: 0, unsupportedCount: 0, failureCodes: [] };
    }
  };

  try {
    const modal = openIrLibraryBrowser({ service });
    await modal.render();
    assert.deepEqual(byClass(modal.element, 'ir-library-entry').map(rowName), []);

    const fileInput = flatten(modal.element).find(element =>
      element.tagName === 'INPUT' && element.type === 'file');
    fileInput.files = [{ name: 'File Hall.wav' }];
    await fileInput.dispatch('change');
    assert.deepEqual(byClass(modal.element, 'ir-library-entry').map(rowName), ['File Hall']);

    await button(modal.element, 'Import folder…').click();
    assert.deepEqual(byClass(modal.element, 'ir-library-entry').map(rowName), ['File Hall', 'Folder Room']);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('IR library modal shows per-item progress and adds each completed import to the visible list', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  const entries = [];
  const firstReady = deferred();
  const secondReady = deferred();
  const createEntry = (irId, fileLabel) => ({
    irId,
    fileLabel,
    importedAt: '2026-07-20T00:00:00Z',
    channels: 2,
    topology: 'independent',
    frames: 48000,
    sampleRate: 48000
  });
  const firstEntry = createEntry('aaaaaaaaaaaaaaaaaaaaaaaa', 'First Hall.wav');
  const secondEntry = createEntry('bbbbbbbbbbbbbbbbbbbbbbbb', 'Second Hall.wav');
  globalThis.document = { body, createElement: tagName => new Element(tagName) };
  globalThis.window = {};
  const service = {
    list() { return [...entries]; },
    async readAnalysis() { return null; },
    async importFiles(files, options) {
      options.onProgress({
        phase: 'importing', completedCount: 0, totalCount: 2,
        importedCount: 0, failedCount: 0, currentFiles: [files[0].name]
      });
      await firstReady.promise;
      entries.push(firstEntry);
      options.onProgress({
        phase: 'importing', completedCount: 1, totalCount: 2,
        importedCount: 1, failedCount: 0, entry: firstEntry
      });
      options.onProgress({
        phase: 'importing', completedCount: 1, totalCount: 2,
        importedCount: 1, failedCount: 0, currentFiles: [files[1].name]
      });
      await secondReady.promise;
      entries.push(secondEntry);
      options.onProgress({
        phase: 'importing', completedCount: 2, totalCount: 2,
        importedCount: 2, failedCount: 0, entry: secondEntry
      });
      return {
        imported: [firstEntry, secondEntry], failedCount: 0,
        unsupportedCount: 0, failureCodes: []
      };
    }
  };

  try {
    const modal = openIrLibraryBrowser({ service });
    await modal.render();
    const fileInput = flatten(modal.element).find(element =>
      element.tagName === 'INPUT' && element.type === 'file' && !element.webkitdirectory);
    fileInput.files = [{ name: 'First Hall.wav' }, { name: 'Second Hall.wav' }];
    const importing = fileInput.dispatch('change');
    await nextTurn();

    const progressRegion = byClass(modal.element, 'ir-library-import-progress')[0];
    const progress = byClass(modal.element, 'ir-library-progress')[0];
    const status = byClass(modal.element, 'ir-library-status')[0];
    assert.equal(progressRegion.hidden, false);
    assert.equal(progress.max, 2);
    assert.equal(progress.value, 0);
    assert.match(status.textContent, /First Hall\.wav.*0 of 2/);

    firstReady.resolve();
    await nextTurn();
    assert.deepEqual(byClass(modal.element, 'ir-library-entry').map(rowName), ['First Hall.wav']);
    assert.equal(progress.value, 1);
    assert.match(status.textContent, /Second Hall\.wav.*1 of 2/);
    assert.equal(button(modal.element, 'Load').disabled, true);
    assert.equal(button(modal.element, 'Delete').disabled, true);

    secondReady.resolve();
    await importing;
    assert.deepEqual(byClass(modal.element, 'ir-library-entry').map(rowName),
      ['First Hall.wav', 'Second Hall.wav']);
    assert.equal(progressRegion.hidden, true);
    assert.equal(status.textContent, '2 imported, 0 failed, 0 unsupported.');
    assert.equal(button(modal.element, 'Load').disabled, false);
    assert.equal(button(modal.element, 'Delete').disabled, false);
  } finally {
    firstReady.resolve();
    secondReady.resolve();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('IR library modal shows live folder scanning progress before imports begin', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  const scanStarted = deferred();
  const finishScan = deferred();
  globalThis.document = { body, createElement: tagName => new Element(tagName) };
  globalThis.window = { async showDirectoryPicker() { return {}; } };
  const service = {
    list() { return []; },
    async readAnalysis() { return null; },
    async importDirectory(directory, options) {
      options.onProgress({ phase: 'scanning', scannedCount: 12, supportedCount: 4 });
      scanStarted.resolve();
      await finishScan.promise;
      return { imported: [], failedCount: 0, unsupportedCount: 0, failureCodes: [] };
    }
  };

  try {
    const modal = openIrLibraryBrowser({ service });
    const importing = button(modal.element, 'Import folder…').click();
    await scanStarted.promise;
    assert.equal(byClass(modal.element, 'ir-library-import-progress')[0].hidden, false);
    assert.equal(byClass(modal.element, 'ir-library-dialog')[0].attributes['aria-busy'], 'true');
    assert.equal(byClass(modal.element, 'ir-library-progress')[0].attributes.value, undefined);
    assert.match(byClass(modal.element, 'ir-library-status')[0].textContent,
      /12 files checked, 4 supported/);

    finishScan.resolve();
    await importing;
    assert.equal(byClass(modal.element, 'ir-library-import-progress')[0].hidden, true);
  } finally {
    finishScan.resolve();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('IR library modal confirms before a new folder selection stops the current import', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  const importStarted = deferred();
  const finishImport = deferred();
  const confirmations = [false, true];
  const confirmationMessages = [];
  let importOptions;
  globalThis.document = { body, createElement: tagName => new Element(tagName) };
  globalThis.window = {
    electronAPI: {},
    confirm(message) {
      confirmationMessages.push(message);
      return confirmations.shift();
    }
  };
  const service = {
    list() { return []; },
    async readAnalysis() { return null; },
    async importFiles(files, options) {
      importOptions = options;
      options.onProgress({
        phase: 'importing', completedCount: 0, totalCount: files.length,
        importedCount: 0, failedCount: 0, currentFiles: [files[0].name]
      });
      importStarted.resolve();
      await finishImport.promise;
      return {
        imported: [], failedCount: 0, unsupportedCount: 0,
        failureCodes: []
      };
    }
  };

  try {
    const modal = openIrLibraryBrowser({ service });
    const fileInputs = flatten(modal.element).filter(element =>
      element.tagName === 'INPUT' && element.type === 'file');
    const fileInput = fileInputs.find(element => !element.webkitdirectory);
    const folderInput = fileInputs.find(element => element.webkitdirectory);
    fileInput.files = [{ name: 'Current.wav' }];
    const importing = fileInput.dispatch('change');
    await importStarted.promise;

    await button(modal.element, 'Import folder…').click();
    assert.equal(folderInput.clickCount, 0);
    assert.equal(importOptions.isCurrent(), true);

    await button(modal.element, 'Import folder…').click();
    assert.equal(folderInput.clickCount, 1);
    assert.equal(importOptions.isCurrent(), false);
    assert.equal(confirmationMessages.length, 2);
    assert.match(confirmationMessages[0], /already imported.*remain/i);

    finishImport.resolve();
    await importing;
    assert.equal(byClass(modal.element, 'ir-library-status')[0].textContent,
      'Import stopped. 0 imported, 0 failed.');
  } finally {
    finishImport.resolve();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('IR library modal waits for a confirmed in-progress import to stop before closing', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  const importStarted = deferred();
  const finishImport = deferred();
  const confirmations = [false, true];
  let importOptions;
  globalThis.document = { body, createElement: tagName => new Element(tagName) };
  globalThis.window = { confirm() { return confirmations.shift(); } };
  const service = {
    list() { return []; },
    async readAnalysis() { return null; },
    async importFiles(files, options) {
      importOptions = options;
      importStarted.resolve();
      await finishImport.promise;
      return {
        imported: [], failedCount: 0, unsupportedCount: 0,
        failureCodes: []
      };
    }
  };

  try {
    const modal = openIrLibraryBrowser({ service });
    const fileInput = flatten(modal.element).find(element =>
      element.tagName === 'INPUT' && element.type === 'file' && !element.webkitdirectory);
    fileInput.files = [{ name: 'Slow.wav' }];
    const importing = fileInput.dispatch('change');
    await importStarted.promise;

    await button(modal.element, 'Close').click();
    assert.equal(body.children.includes(modal.element), true);
    assert.equal(importOptions.isCurrent(), true);

    const closing = button(modal.element, 'Close').click();
    await nextTurn();
    assert.equal(importOptions.isCurrent(), false);
    assert.equal(body.children.includes(modal.element), true);

    finishImport.resolve();
    await Promise.all([importing, closing]);
    assert.equal(body.children.includes(modal.element), false);
  } finally {
    finishImport.resolve();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('IR library modal imports Electron folders through a directory file input', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  const entries = [];
  const importedFiles = [];
  let directoryPickerCalls = 0;
  const folderEntry = {
    irId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    fileLabel: 'Folder Room.wav',
    importedAt: '2026-07-20T00:00:00Z',
    channels: 2,
    topology: 'independent',
    frames: 48000,
    sampleRate: 48000
  };
  globalThis.document = { body, createElement: tagName => new Element(tagName) };
  globalThis.window = {
    electronAPI: {},
    async showDirectoryPicker() {
      directoryPickerCalls += 1;
      return {};
    }
  };
  const service = {
    list() { return [...entries]; },
    async readAnalysis() { return null; },
    async importFiles(files) {
      importedFiles.push(...files);
      entries.push(folderEntry);
      return { imported: [folderEntry], failedCount: 0, unsupportedCount: 0, failureCodes: [] };
    },
    async importDirectory() {
      throw new Error('Electron folder imports must not use the browser directory picker.');
    }
  };

  try {
    const modal = openIrLibraryBrowser({ service });
    await modal.render();
    const folderInput = flatten(modal.element).find(element =>
      element.tagName === 'INPUT' && element.type === 'file' && element.webkitdirectory === true);
    assert.ok(folderInput);
    assert.equal(folderInput.hidden, true);
    assert.equal(folderInput.multiple, true);

    await button(modal.element, 'Import folder…').click();
    assert.equal(folderInput.clickCount, 1);
    assert.equal(directoryPickerCalls, 0);

    const file = { name: 'Folder Room.wav', webkitRelativePath: 'Room/Folder Room.wav' };
    folderInput.files = [file];
    await folderInput.dispatch('change');
    assert.deepEqual(importedFiles, [file]);
    assert.equal(byClass(modal.element, 'ir-library-status')[0].textContent, '1 imported, 0 failed.');
    assert.deepEqual(byClass(modal.element, 'ir-library-entry').map(rowName), ['Folder Room.wav']);
    assert.equal(folderInput.value, '');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('IR library modal keeps failed loads open and reports operation failures without exposing raw errors', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  const diagnostics = [];
  const restoreConsole = replaceGlobal('console', createConsoleHarness({
    error: (...args) => diagnostics.push(args)
  }));
  const entry = {
    irId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    fileLabel: 'Alpha.wav',
    importedAt: '2026-01-01T00:00:00Z',
    channels: 2,
    topology: 'independent',
    frames: 48000,
    sampleRate: 48000
  };
  globalThis.document = { body, createElement: tagName => new Element(tagName) };
  globalThis.window = {
    async showDirectoryPicker() { return {}; }
  };
  const service = {
    list() { return [entry]; },
    async readAnalysis() { return null; },
    async delete() { throw new Error('raw delete diagnostic'); },
    async importFiles() { throw new Error('raw file diagnostic'); },
    async importDirectory() { throw new Error('raw folder diagnostic'); }
  };

  try {
    let loadResult = false;
    const modal = openIrLibraryBrowser({
      service,
      onLoad: async () => {
        if (loadResult instanceof Error) throw loadResult;
        return loadResult;
      }
    });
    await modal.render();
    const status = byClass(modal.element, 'ir-library-status')[0];
    const row = byClass(modal.element, 'ir-library-entry')[0];

    await button(row, 'Load').click();
    assert.equal(status.textContent,
      'The impulse response could not be loaded. Try importing it again or choose another one.');
    assert.equal(body.children.includes(modal.element), true);
    loadResult = new Error('raw load diagnostic');
    await button(row, 'Load').click();
    assert.equal(status.textContent,
      'The impulse response could not be loaded. Try importing it again or choose another one.');
    assert.doesNotMatch(status.textContent, /raw load diagnostic/);
    assert.equal(body.children.includes(modal.element), true);

    await button(row, 'Delete').click();
    assert.equal(status.textContent, 'The impulse response could not be deleted. Please try again.');
    assert.doesNotMatch(status.textContent, /raw delete diagnostic/);

    const fileInput = flatten(modal.element).find(element => element.tagName === 'INPUT' && element.type === 'file');
    fileInput.files = [{ name: 'broken.wav' }];
    await fileInput.dispatch('change');
    assert.equal(status.textContent, 'The selected files could not be imported. Please try again.');
    assert.doesNotMatch(status.textContent, /raw file diagnostic/);

    await button(modal.element, 'Import folder…').click();
    assert.equal(status.textContent, 'The folder could not be imported. Please try again.');
    assert.doesNotMatch(status.textContent, /raw folder diagnostic/);
    assert.equal(diagnostics.length, 4);
  } finally {
    restoreConsole();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('IR library modal explains oversized file and folder imports without exposing failure codes', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  globalThis.document = { body, createElement: tagName => new Element(tagName) };
  globalThis.window = { async showDirectoryPicker() { return {}; } };
  const oversizedResult = {
    imported: [],
    failedCount: 1,
    unsupportedCount: 0,
    failureCodes: ['file-too-large']
  };
  const service = {
    list() { return []; },
    async importFiles() { return oversizedResult; },
    async importDirectory() { return oversizedResult; }
  };

  try {
    const modal = openIrLibraryBrowser({ service });
    await modal.render();
    const status = byClass(modal.element, 'ir-library-status')[0];
    const fileInput = flatten(modal.element).find(element => element.tagName === 'INPUT' && element.type === 'file');
    fileInput.files = [{ name: 'huge.wav' }];
    await fileInput.dispatch('change');
    assert.match(status.textContent, /too large.*shorter impulse response/i);
    assert.doesNotMatch(status.textContent, /file-too-large|RangeError|268435456/);

    await button(modal.element, 'Import folder…').click();
    assert.match(status.textContent, /too large.*shorter impulse response/i);
    assert.doesNotMatch(status.textContent, /file-too-large|RangeError|268435456/);
    modal.close();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('IR library modal confirms deletion, traps focus, restores focus, and closes with Escape', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const body = new Element('body');
  const trigger = new Element('button');
  const confirmations = [false, true];
  const deleteCalls = [];
  const entry = {
    irId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    fileLabel: 'Accessible Hall.wav',
    importedAt: '2026-01-01T00:00:00Z',
    channels: 2,
    topology: 'independent',
    frames: 48000,
    sampleRate: 48000
  };
  globalThis.document = {
    body,
    activeElement: trigger,
    createElement: tagName => new Element(tagName)
  };
  globalThis.window = {
    confirm() { return confirmations.shift(); }
  };
  const service = {
    list() { return [entry]; },
    async readAnalysis() { return null; },
    async delete(id) {
      deleteCalls.push(id);
      return { removed: true, reason: null };
    }
  };

  try {
    const modal = openIrLibraryBrowser({ service });
    await modal.render();
    const search = flatten(modal.element).find(element => element.type === 'search');
    const sort = flatten(modal.element).find(element => element.tagName === 'SELECT');
    assert.equal(search.attributes['aria-label'], 'Search impulse responses');
    assert.equal(sort.attributes['aria-label'], 'Sort impulse responses');

    const remove = button(modal.element, 'Delete');
    await remove.click();
    assert.deepEqual(deleteCalls, []);
    await remove.click();
    assert.deepEqual(deleteCalls, [entry.irId]);

    const dialog = byClass(modal.element, 'ir-library-dialog')[0];
    const focusable = dialog.querySelectorAll();
    const first = focusable[0];
    const last = focusable.at(-1);
    let prevented = 0;
    last.focus();
    await modal.element.dispatch('keydown', { key: 'Tab', preventDefault() { prevented += 1; } });
    assert.equal(document.activeElement, first);
    first.focus();
    await modal.element.dispatch('keydown', {
      key: 'Tab',
      shiftKey: true,
      preventDefault() { prevented += 1; }
    });
    assert.equal(document.activeElement, last);
    assert.equal(prevented, 2);

    await modal.element.dispatch('keydown', { key: 'Escape', preventDefault() { prevented += 1; } });
    assert.equal(body.children.includes(modal.element), false);
    assert.equal(document.activeElement, trigger);
    assert.equal(prevented, 3);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
