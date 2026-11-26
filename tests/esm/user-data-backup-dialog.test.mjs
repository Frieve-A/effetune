import assert from 'node:assert/strict';
import test from 'node:test';

import { __test, openUserDataBackupDialog } from '../../js/user-data-backup/dialog.js';
import { ANDROID_ORIGIN, getAndroidBridge } from '../../js/android/bridge.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class Element {
  constructor(tagName, text = '') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.value = '';
    this.type = '';
    this._textContent = text;
    this._classes = new Set();
    this.classList = {
      add: name => this._classes.add(name),
      remove: name => this._classes.delete(name),
      contains: name => this._classes.has(name),
      toggle: (name, force) => {
        const enabled = force ?? !this._classes.has(name);
        if (enabled) this._classes.add(name);
        else this._classes.delete(name);
        return enabled;
      }
    };
  }

  set className(value) {
    this._className = value;
    this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get className() { return [...this._classes].join(' '); }
  set textContent(value) {
    this._textContent = String(value);
    if (value === '') {
      const active = globalThis.document?.activeElement;
      if (active && this.children.some(child => child.contains(active))) {
        globalThis.document.activeElement = null;
      }
      this.children.forEach(child => { child.parentNode = null; });
      this.children = [];
    }
  }
  get textContent() { return this._textContent; }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  remove() {
    if (globalThis.document?.activeElement && this.contains(globalThis.document.activeElement)) {
      globalThis.document.activeElement = null;
    }
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  contains(node) {
    return this === node || this.children.some(child => child.contains(node));
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) await listener({ target: this, preventDefault() {}, ...event });
  }
  click() { return this.dispatch('click'); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  querySelectorAll() { return []; }
  focus() { globalThis.document.activeElement = this; }
}

const flatten = root => [root, ...root.children.flatMap(flatten)];
const byClass = (root, name) => flatten(root).filter(node => node.classList.contains(name));
const rowNamed = (root, name) => byClass(root, 'backup-restore-row').find(row =>
  flatten(row).some(node => node.tagName === 'STRONG' && node.textContent === name));
const groupNamed = (root, name) => byClass(root, 'backup-restore-group').find(group =>
  flatten(group).some(node => node.tagName === 'H3' && node.textContent === name));
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

function restorePlan(items, keys) {
  const selected = new Set(keys);
  return {
    items: items.map(item => ({ ...item, status: 'add', targetName: item.name, selected: selected.has(item.key) })),
    selectedKeys: selected
  };
}

test('backup dialog preserves filtered selections and removes parents with a cleared required dependency', async () => {
  const body = new Element('body');
  const documentRef = {
    body,
    activeElement: null,
    createElement: tag => new Element(tag),
    createTextNode: text => new Element('#text', text)
  };
  const items = [
    { key: 'pipeline:Room', kind: 'pipeline', name: 'Room', available: true, bytes: 20,
      dependencies: [{ key: 'ir:Hall', required: true }, { key: 'measurement:Sofa', required: false }] },
    { key: 'plugin:Gain:Warm', kind: 'plugin', pluginName: 'Gain', name: 'Warm', available: true, bytes: 5, dependencies: [] },
    { key: 'ir:Hall', kind: 'ir', name: 'Hall.wav', available: true, bytes: 40, dependencies: [] },
    { key: 'measurement:Sofa', kind: 'measurement', name: 'Sofa', available: true, bytes: 50, dependencies: [] }
  ];
  const select = (catalog, keys) => {
    const selected = new Set(keys);
    let changed;
    do {
      changed = false;
      for (const item of catalog.items) {
        if (!selected.has(item.key)) continue;
        for (const dependency of item.dependencies || []) {
          if (dependency.required && !selected.has(dependency.key)) {
            selected.add(dependency.key);
            changed = true;
          }
        }
      }
    } while (changed);
    return selected;
  };
  const service = {
    async listBackup() { return { items, unavailable: [], maxBytes: 256 * 1024 * 1024 }; },
    select,
    async planRestore() { throw new Error('not used'); }
  };

  await withGlobals({ document: documentRef, window: { uiManager: null } }, async () => {
    const modal = openUserDataBackupDialog({ service });
    await nextTurn();
    const summary = byClass(modal.element, 'backup-restore-selection-summary')[0];
    assert.match(summary.textContent, /^4 selected/);

    const search = flatten(modal.element).find(node => node.type === 'search');
    search.value = 'room';
    await search.dispatch('input');
    assert.equal(byClass(modal.element, 'backup-restore-row').length, 1);
    assert.match(summary.textContent, /^4 selected/, 'filtering must not clear hidden selections');

    search.value = '';
    await search.dispatch('input');
    const irCheckbox = flatten(rowNamed(modal.element, 'Hall.wav')).find(node => node.type === 'checkbox');
    irCheckbox.checked = false;
    await irCheckbox.dispatch('change');
    await nextTurn();
    assert.match(summary.textContent, /^2 selected/);
    assert.equal(flatten(rowNamed(modal.element, 'Room')).find(node => node.type === 'checkbox').checked, false);
    assert.equal(flatten(rowNamed(modal.element, 'Sofa')).find(node => node.type === 'checkbox').checked, true,
      'clearing a required dependency must not clear an unrelated optional dependency');

    const embed = byClass(modal.element, 'backup-restore-options')[0].children
      .flatMap(label => label.children).filter(node => node.type === 'checkbox');
    assert.equal(embed.length, 2);
    assert.equal(embed.every(input => input.checked), true);
  });
});

test('Android backup status waits for the picker, write and share results', async t => {
  const documentRef = { body: new Element('body'), createElement: tag => new Element(tag),
    createTextNode: text => new Element('#text', text) };
  const windowRef = { location: { origin: ANDROID_ORIGIN }, effetuneAndroid: { postMessage() {} } };
  const item = { key: 'pipeline:A', name: 'A', kind: 'pipeline', available: true, dependencies: [] };
  const service = {
    listBackup: async () => ({ items: [item], maxBytes: 1024 }),
    select: (_, keys) => new Set(keys),
    createBackup: async () => ({ blob: new Blob([new Uint8Array(256 * 1024 + 1)]), fileName: 'test.effetune_backup' })
  };
  await withGlobals({ document: documentRef, window: windowRef }, async () => {
    let pick, write, share;
    const commands = [];
    t.mock.method(getAndroidBridge(), 'request', command => {
      commands.push(command);
      return { 'documents.pick': pick, 'documents.write': write, 'documents.share': share }[command].promise;
    });
    const modal = openUserDataBackupDialog({ service });
    await nextTurn();
    const run = byClass(modal.element, 'backup-restore-primary')[0];
    const status = byClass(modal.element, 'backup-restore-status')[0];
    const progress = byClass(modal.element, 'backup-restore-progress')[0];
    for (const outcome of ['cancel', 'partial', 'fail', 'save', 'share']) {
      pick = deferred();
      write = deferred();
      share = deferred();
      commands.length = 0;
      await run.click();
      await nextTurn();
      assert.deepEqual(commands, ['documents.pick']);
      assert.equal(run.disabled, true);
      assert.equal(progress.hidden, true);
      if (outcome === 'cancel') pick.reject(new DOMException('Cancelled', 'AbortError'));
      else {
        pick.resolve({ uri: 'content://backup', share: outcome === 'share' });
        await nextTurn();
        assert.equal(commands.at(-1), 'documents.write');
        assert.equal(run.disabled, true);
        assert.equal(progress.hidden, false);
        assert.equal(status.textContent, 'Saving backup…');
        if (outcome === 'partial') await progress.children.find(child => child.tagName === 'BUTTON').click();
        if (outcome === 'fail') write.reject(new Error('Provider unavailable'));
        else write.resolve({});
        if (outcome === 'share') {
          await nextTurn();
          assert.equal(commands.at(-1), 'documents.share');
          assert.equal(run.disabled, true);
          share.resolve({});
        }
      }
      await nextTurn();
      assert.equal(status.textContent, {
        cancel: 'Backup stopped. No backup file was created.',
        partial: 'Saving stopped. An incomplete backup file may remain. Delete it and try again.',
        fail: 'The backup could not be created. Check available storage and try again.',
        save: 'Backup created with 1 items.',
        share: 'The sharing screen was opened for your backup.'
      }[outcome]);
      if (outcome === 'partial') assert.deepEqual(commands, ['documents.pick', 'documents.write']);
      assert.equal(run.disabled, false);
    }
  });
});

test('selection helpers keep required-parent behavior small and deterministic', () => {
  const items = [
    { key: 'parent', name: 'Parent', dependencies: [{ key: 'child', required: true }] },
    { key: 'optional', name: 'Optional', dependencies: [{ key: 'child', required: false }] },
    { key: 'child', name: 'Child', dependencies: [] }
  ];
  assert.deepEqual([...__test.removeWithParents(items, new Set(['parent', 'optional', 'child']), 'child')], ['optional']);
  assert.deepEqual(__test.selectedRequiredBy(items, new Set(['parent', 'child'])).get('child'), ['Parent']);
  assert.equal(__test.formatBytes(1048576), '1.0 MB');
});

test('selection rerenders preserve item and group focus so keyboard handling continues', async () => {
  const body = new Element('body');
  const opener = new Element('button');
  body.appendChild(opener);
  const documentRef = {
    body,
    activeElement: opener,
    createElement: tag => new Element(tag),
    createTextNode: text => new Element('#text', text)
  };
  const items = [
    { key: 'pipeline:A', kind: 'pipeline', name: 'A', available: true, dependencies: [] },
    { key: 'pipeline:B', kind: 'pipeline', name: 'B', available: true, dependencies: [] }
  ];
  const service = {
    async listBackup() { return { items, unavailable: [], maxBytes: 256 * 1024 * 1024 }; },
    select(catalog, keys) { return new Set(keys); },
    async planRestore() { throw new Error('not used'); }
  };

  await withGlobals({ document: documentRef, window: { uiManager: null } }, async () => {
    const modal = openUserDataBackupDialog({ service });
    await nextTurn();

    const originalA = flatten(rowNamed(modal.element, 'A')).find(node => node.type === 'checkbox');
    originalA.focus();
    originalA.checked = false;
    await originalA.dispatch('change');
    await nextTurn();
    const replacementA = flatten(rowNamed(modal.element, 'A')).find(node => node.type === 'checkbox');
    assert.notEqual(replacementA, originalA, 'the test DOM must model destructive list replacement');
    assert.equal(modal.element.contains(originalA), false);
    assert.equal(documentRef.activeElement, replacementA);

    const group = groupNamed(modal.element, 'Pipeline presets');
    const clear = flatten(group).find(node => node.tagName === 'BUTTON' && node.textContent === 'Clear');
    clear.focus();
    await clear.click();
    await nextTurn();
    const updatedGroup = groupNamed(modal.element, 'Pipeline presets');
    const updatedClear = flatten(updatedGroup).find(node => node.tagName === 'BUTTON' && node.textContent === 'Clear');
    const selectAll = flatten(updatedGroup)
      .find(node => node.tagName === 'BUTTON' && node.textContent === 'Select all');
    assert.equal(updatedClear.disabled, true);
    assert.equal(documentRef.activeElement, selectAll, 'clearing a category should move focus to its enabled action');

    flatten(rowNamed(modal.element, 'B')).find(node => node.type === 'checkbox').focus();
    await modal.element.dispatch('keydown', { key: 'Escape' });
    assert.equal(modal.element.parentNode, null);
    assert.equal(documentRef.activeElement, opener);
  });
});

test('restore waits for the latest selection plan and discards older plan results', async () => {
  const body = new Element('body');
  const documentRef = {
    body,
    activeElement: null,
    createElement: tag => new Element(tag),
    createTextNode: text => new Element('#text', text)
  };
  const items = [
    { key: 'pipeline:A', kind: 'pipeline', name: 'A', available: true, dependencies: [] },
    { key: 'pipeline:B', kind: 'pipeline', name: 'B', available: true, dependencies: [] }
  ];
  const pending = [];
  const restored = [];
  let planningCalls = 0;
  const service = {
    async listBackup() { return { items: [], unavailable: [], maxBytes: 256 * 1024 * 1024 }; },
    select(catalog, keys) { return new Set(keys); },
    async openBackup() { return { items, unavailable: [], maxBytes: 256 * 1024 * 1024 }; },
    planRestore(catalog, keys) {
      planningCalls += 1;
      if (planningCalls === 1) return restorePlan(items, keys);
      const request = deferred();
      pending.push({ ...request, keys: new Set(keys) });
      return request.promise;
    },
    async restore(plan) {
      restored.push([...plan.selectedKeys]);
      return { added: [], reused: [], renamed: [], failed: [], unprocessed: [], cancelled: false };
    }
  };

  await withGlobals({ document: documentRef, window: { uiManager: null } }, async () => {
    const modal = openUserDataBackupDialog({ service });
    await nextTurn();
    const restoreTab = flatten(modal.element).find(node => node.textContent === 'Restore from file');
    await restoreTab.click();
    assert.ok(flatten(modal.element).some(node => node.textContent === 'Choose backup file…'));
    assert.equal(byClass(modal.element, 'backup-restore-empty').length, 0);
    const fileInput = flatten(modal.element).find(node => node.type === 'file');
    fileInput.files = [{ name: 'selection.effetune_backup' }];
    await fileInput.dispatch('change');
    await nextTurn();

    const runButton = byClass(modal.element, 'backup-restore-primary')[0];
    const a = flatten(rowNamed(modal.element, 'A')).find(node => node.type === 'checkbox');
    a.focus();
    a.checked = false;
    await a.dispatch('change');
    const replacementA = flatten(rowNamed(modal.element, 'A')).find(node => node.type === 'checkbox');
    assert.equal(documentRef.activeElement, replacementA);
    const search = flatten(modal.element).find(node => node.type === 'search');
    search.focus();
    await runButton.click();
    assert.deepEqual(restored, [], 'restore must stay blocked while the new plan is pending');
    assert.equal(runButton.disabled, true);

    pending[0].resolve(restorePlan(items, pending[0].keys));
    await nextTurn();
    assert.equal(documentRef.activeElement, search,
      'completed planning must not steal focus after the user moves away');
    assert.equal(runButton.disabled, false);
    await runButton.click();
    await nextTurn();
    assert.deepEqual(restored, [['pipeline:B']]);

    const latestA = flatten(rowNamed(modal.element, 'A')).find(node => node.type === 'checkbox');
    latestA.checked = true;
    await latestA.dispatch('change');
    const latestB = flatten(rowNamed(modal.element, 'B')).find(node => node.type === 'checkbox');
    latestB.checked = false;
    await latestB.dispatch('change');
    pending[2].resolve(restorePlan(items, pending[2].keys));
    await nextTurn();
    pending[1].resolve(restorePlan(items, pending[1].keys));
    await nextTurn();
    const summary = byClass(modal.element, 'backup-restore-selection-summary')[0];
    assert.match(summary.textContent, /^1 selected/);
    assert.equal(flatten(rowNamed(modal.element, 'A')).find(node => node.type === 'checkbox').checked, true);
    assert.equal(flatten(rowNamed(modal.element, 'B')).find(node => node.type === 'checkbox').checked, false);
  });
});

test('restore selection planning failures are visible and keep execution disabled', async () => {
  const body = new Element('body');
  const documentRef = {
    body,
    activeElement: null,
    createElement: tag => new Element(tag),
    createTextNode: text => new Element('#text', text)
  };
  const items = [{ key: 'pipeline:A', kind: 'pipeline', name: 'A', available: true, dependencies: [] }];
  let planningCalls = 0;
  const service = {
    async listBackup() { return { items: [], unavailable: [], maxBytes: 256 * 1024 * 1024 }; },
    select(catalog, keys) { return new Set(keys); },
    async openBackup() { return { items, unavailable: [], maxBytes: 256 * 1024 * 1024 }; },
    async planRestore(catalog, keys) {
      planningCalls += 1;
      if (planningCalls === 1) return restorePlan(items, keys);
      throw new Error('planning failed');
    }
  };

  await withGlobals({ document: documentRef, window: { uiManager: null } }, async () => {
    const modal = openUserDataBackupDialog({ service });
    await nextTurn();
    await flatten(modal.element).find(node => node.textContent === 'Restore from file').click();
    const fileInput = flatten(modal.element).find(node => node.type === 'file');
    fileInput.files = [{ name: 'selection.effetune_backup' }];
    await fileInput.dispatch('change');
    await nextTurn();
    const checkbox = flatten(rowNamed(modal.element, 'A')).find(node => node.type === 'checkbox');
    checkbox.checked = false;
    await checkbox.dispatch('change');
    await nextTurn();
    const status = byClass(modal.element, 'backup-restore-status')[0];
    const runButton = byClass(modal.element, 'backup-restore-primary')[0];
    assert.equal(status.textContent, 'The selection could not be updated. Try again.');
    assert.equal(runButton.disabled, true);
  });
});
