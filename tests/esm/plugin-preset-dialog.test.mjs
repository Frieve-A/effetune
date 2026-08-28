import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PluginPresetDialog,
  PluginPresetProvider
} from '../../js/ui/pipeline/plugin-preset-dialog.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createDeferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

class FakeElement {
  constructor(tagName, documentRef) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = documentRef;
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.style = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this._textContent = '';
    this._className = '';
    this.classes = new Set();
    this.classList = {
      add: name => {
        this.classes.add(name);
        this._className = [...this.classes].join(' ');
      },
      contains: name => this.classes.has(name)
    };
  }

  set className(value) {
    this._className = value;
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() { return this._className; }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() { return this._textContent; }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  querySelectorAll(selector) {
    const classNames = selector.split(',').map(part => part.trim().replace(/^\./, ''));
    const matches = [];
    const visit = element => {
      for (const child of element.children || []) {
        if (classNames.some(className => child.classList?.contains(className))) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  contains(target) {
    for (let current = target; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  getAttribute(name) {
    return this[name] ?? null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  async dispatch(type, event = {}) {
    const eventRef = {
      key: event.key,
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...event
    };
    for (const listener of this.listeners.get(type) || []) await listener(eventRef);
  }

  focus() {
    this.focused = true;
    this.ownerDocument.activeElement = this;
  }
  select() { this.selected = true; }
}

function findByClass(root, className) {
  if (root.classList?.contains(className)) return root;
  for (const child of root.children || []) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

function findAllByClass(root, className, results = []) {
  if (root.classList?.contains(className)) results.push(root);
  for (const child of root.children || []) findAllByClass(child, className, results);
  return results;
}

function createDocument() {
  const listeners = new Map();
  const documentRef = {
    listeners,
    body: null,
    createElement(tagName) { return new FakeElement(tagName, documentRef); },
    querySelector(selector) {
      return selector === '.preset-dialog' ? findByClass(documentRef.body, 'preset-dialog') : null;
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    }
  };
  documentRef.body = new FakeElement('body', documentRef);
  return documentRef;
}

function createCore(calls) {
  const historyManager = {
    historySuppressionDepth: 0,
    get isHistorySuppressed() { return this.historySuppressionDepth > 0; },
    withHistorySuppressed(callback) {
      calls.push(['withHistorySuppressed']);
      this.historySuppressionDepth++;
      try {
        return callback();
      } finally {
        this.historySuppressionDepth--;
      }
    },
    saveState() { calls.push(['saveState']); }
  };
  return {
    pipelineManager: { historyManager },
    routingDialog: {
      positionDialog(dialog, button) { calls.push(['positionDialog', dialog.className, button.className]); }
    },
    updateWorkletPlugin(plugin) { calls.push(['updateWorkletPlugin', plugin.name]); }
  };
}

async function withDialogGlobals(callback, options = {}) {
  const documentRef = createDocument();
  const calls = [];
  const timers = [];
  const storage = new Map();
  const windowRef = {
    confirm: options.confirm ?? (() => true),
    uiManager: options.withUi === false ? null : {
      t: key => `t:${key}`,
      showTransientMessage: (...args) => calls.push(['message', ...args])
    }
  };
  await withGlobals({
    document: documentRef,
    window: windowRef,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    setTimeout(fn) {
      if (options.deferTimers) {
        const timer = { fn, cleared: false };
        timers.push(timer);
        return timers.length;
      }
      fn();
      return 1;
    },
    clearTimeout(id) {
      calls.push(['clearTimeout', id]);
      if (options.deferTimers && timers[id - 1]) timers[id - 1].cleared = true;
    }
  }, () => callback({ documentRef, windowRef, calls, storage, timers }));
}

test('plugin provider isolates persistence fields and applies presets with one history entry', async () => {
  const calls = [];
  class TestPlugin {
    static getSystemPresetGroups() {
      return [{ label: 'Group', presets: [{ id: 'system', label: 'System', params: { gain: 3 } }] }];
    }
  }
  const plugin = new TestPlugin();
  Object.assign(plugin, {
    name: 'Tone',
    getActiveSystemPresetId: () => 'system',
    getSerializableParameters: () => ({ gain: 5, enabled: true, ib: 1, ob: 2, ch: 'L' }),
    setParameters(params) { calls.push(['setParameters', params]); },
    syncUIControls() { calls.push(['syncUIControls']); }
  });
  const stored = { User: { gain: 7 } };
  const store = {
    async getForPlugin(name) { calls.push(['getForPlugin', name]); return structuredClone(stored); },
    async save(...args) { calls.push(['storeSave', ...args]); return true; },
    async rename(...args) { calls.push(['storeRename', ...args]); return true; },
    async remove(...args) { calls.push(['storeRemove', ...args]); return true; }
  };

  await withDialogGlobals(async () => {
    const core = createCore(calls);
    const provider = new PluginPresetProvider(core, plugin, store);
    assert.equal(provider.getTitleKey(), 'ui.title.effectPresets');
    assert.equal(provider.getDefaultSaveName(), '');
    assert.equal(provider.getActiveSystemPresetId(), 'system');
    assert.equal(provider.getActiveUserPresetName(), '');
    assert.equal(provider.getPresetContext(), plugin);
    assert.equal(provider.getSystemPresetGroups()[0].presets[0].id, 'system');
    assert.deepEqual(await provider.listUserPresetNames(), ['User']);
    assert.equal(await provider.applyUserPreset('Missing'), false);
    assert.equal(await provider.applyUserPreset('User'), true);
    assert.equal(await provider.applySystemPreset('system'), true);
    assert.equal(await provider.applySystemPreset('missing'), false);
    assert.equal(calls.filter(call => call[0] === 'saveState').length, 2);
    assert.equal(calls.filter(call => call[0] === 'withHistorySuppressed').length, 2);
    assert.equal(core.pipelineManager.historyManager.isHistorySuppressed, false);

    assert.equal(await provider.saveUserPreset('Saved'), true);
    const saveCall = calls.find(call => call[0] === 'storeSave');
    assert.deepEqual(saveCall.slice(1), ['Tone', 'Saved', { gain: 5 }]);
    assert.equal(await provider.renameUserPreset('User', 'Renamed'), true);
    assert.equal(await provider.deleteUserPresets(['Renamed']), true);
  });
});

test('plugin user presets use serialized restoration without changing pipeline-owned state', async () => {
  const calls = [];
  const plugin = {
    name: 'IR Reverb',
    id: 41,
    enabled: false,
    inputBus: 2,
    outputBus: 3,
    channel: 'R',
    setParameters() { calls.push(['setParameters']); },
    setSerializedParameters(parameters) {
      calls.push(['setSerializedParameters', parameters]);
      this.libraryReads = (this.libraryReads || 0) + 1;
      this.ir = parameters.ir;
    }
  };
  const store = {
    getForPlugin: async () => ({ Library: { ir: 'a'.repeat(24), cr: 'full' } })
  };

  await withDialogGlobals(async () => {
    const provider = new PluginPresetProvider(createCore(calls), plugin, store);
    assert.equal(await provider.applyUserPreset('Library'), true);
  });

  assert.deepEqual(calls.filter(call => call[0] === 'setSerializedParameters'), [[
    'setSerializedParameters', { ir: 'a'.repeat(24), cr: 'full' }
  ]]);
  assert.equal(calls.some(call => call[0] === 'setParameters'), false);
  assert.equal(plugin.libraryReads, 1);
  assert.equal(plugin.ir, 'a'.repeat(24));
  assert.deepEqual(
    { id: plugin.id, enabled: plugin.enabled, inputBus: plugin.inputBus,
      outputBus: plugin.outputBus, channel: plugin.channel },
    { id: 41, enabled: false, inputBus: 2, outputBus: 3, channel: 'R' }
  );
});

test('plugin preset application restores scoped suppression when parameter application throws', async () => {
  const calls = [];
  class ThrowingPlugin {
    static getSystemPresetGroups() {
      return [{ presets: [{ id: 'broken', label: 'Broken', params: {} }] }];
    }
  }
  const plugin = new ThrowingPlugin();
  Object.assign(plugin, {
    name: 'Broken',
    setParameters() { throw new Error('parameter failure'); }
  });

  await withDialogGlobals(async () => {
    const core = createCore(calls);
    const provider = new PluginPresetProvider(core, plugin, {
      getForPlugin: async () => ({})
    });
    await assert.rejects(provider.applySystemPreset('broken'), /parameter failure/);
    assert.equal(core.pipelineManager.historyManager.isHistorySuppressed, false);
    assert.equal(calls.some(call => call[0] === 'saveState'), false);
  });
});

test('detached plugin providers cannot apply or save presets, and close only their dialog', async () => {
  const calls = [];
  const pendingPreset = createDeferred();
  class TestPlugin {
    static getSystemPresetGroups() {
      return [{ presets: [{ id: 'one', label: 'One', params: { gain: 1 } }] }];
    }
  }
  const plugin = new TestPlugin();
  Object.assign(plugin, {
    name: 'Test',
    setParameters() { calls.push(['setParameters']); },
    getSerializableParameters: () => ({ gain: 0 })
  });

  await withDialogGlobals(async ({ documentRef }) => {
    const core = createCore(calls);
    core.audioManager = { pipeline: [plugin] };
    const provider = new PluginPresetProvider(core, plugin, {
      getForPlugin: () => pendingPreset.promise, save: async () => true
    });
    const controller = new PluginPresetDialog(core);
    const dialog = await controller.showPlugin(plugin, documentRef.createElement('button'));

    const applyingUserPreset = provider.applyUserPreset('Saved');
    core.audioManager.pipeline = [];
    pendingPreset.resolve({ Saved: { gain: 1 } });
    assert.equal(await applyingUserPreset, false);
    controller.closeIfPluginDetached();
    assert.equal(documentRef.querySelector('.preset-dialog'), null);
    assert.equal(await provider.applySystemPreset('one'), false);
    assert.equal(await provider.saveUserPreset('Saved'), false);
    assert.equal(calls.some(call => call[0] === 'setParameters'), false);
    assert.equal(calls.some(call => call[0] === 'updateWorkletPlugin'), false);

    const pipelineProvider = {
      getTitleKey: () => 'ui.title.pipelinePresets',
      getSystemPresetGroups: () => [],
      getDefaultSaveName: () => '',
      listUserPresetNames: async () => [],
      saveUserPreset: async () => true,
      errorKeys: { save: 'save', delete: 'delete' }
    };
    await controller.show(pipelineProvider, documentRef.createElement('button'));
    controller.closeIfPluginDetached();
    assert.ok(documentRef.querySelector('.preset-dialog'));
    controller.close();
    assert.equal(dialog.parentNode, null);
  });
});

test('plugin provider supports custom system hooks and missing optional hooks', async () => {
  const calls = [];
  class HookPlugin {
    static getSystemPresetGroups() {
      return [{ label: null, presets: [{ id: 'hook', label: 'Hook', params: {} }] }];
    }
  }
  const plugin = new HookPlugin();
  Object.assign(plugin, {
    name: 'Hooked',
    getSerializableParameters: () => ({}),
    setParameters() {},
    applySystemPreset(id) { calls.push(['hook', id]); return true; }
  });
  await withDialogGlobals(async () => {
    const provider = new PluginPresetProvider(createCore(calls), plugin, {
      getForPlugin: async () => ({}), save: async () => true, rename: async () => true, remove: async () => true
    });
    assert.equal(provider.getActiveSystemPresetId(), '');
    assert.equal(await provider.applySystemPreset('hook'), true);
  });

  const plain = { constructor: {}, name: 'Plain' };
  const provider = new PluginPresetProvider({ pipelineManager: null }, plain, { getForPlugin: async () => ({}) });
  assert.deepEqual(provider.getSystemPresetGroups(), []);
  assert.equal(provider.getActiveSystemPresetId(), '');
});

test('plugin provider identifies matching nested system presets and ignores declared UI state', () => {
  class MatchingPlugin {
    static getSystemPresetGroups() {
      return [{ label: '', presets: [{
        id: 'matching', label: 'Matching', params: { settings: { amount: 4 }, sr: 0 }
      }] }];
    }

    static getPresetComparisonExcludedKeys() { return ['sr']; }
  }
  const plugin = new MatchingPlugin();
  plugin.getParameters = () => ({ settings: { amount: 4 }, sr: 48000 });
  const provider = new PluginPresetProvider({ pipelineManager: null }, plugin, { getForPlugin: async () => ({}) });
  assert.equal(provider.getActiveSystemPresetId(), 'matching');
  plugin.getParameters = () => ({ settings: { amount: 5 }, sr: 48000 });
  assert.equal(provider.getActiveSystemPresetId(), '');
});

test('dialog shares one store across plugin providers so concurrent mutations are serialized', async () => {
  await withDialogGlobals(async ({ storage }) => {
    const controller = new PluginPresetDialog(createCore([]));
    controller.show = async provider => provider;
    const plugin = name => ({
      name,
      getSerializableParameters: () => ({ gain: name === 'First' ? 1 : 2 })
    });
    const firstProvider = await controller.showPlugin(plugin('First'));
    const secondProvider = await controller.showPlugin(plugin('Second'));

    assert.equal(firstProvider.store, secondProvider.store);
    assert.equal(await Promise.all([
      firstProvider.saveUserPreset('Saved'),
      secondProvider.saveUserPreset('Saved')
    ]).then(results => results.every(Boolean)), true);
    assert.deepEqual(JSON.parse(storage.get('effetune_plugin_presets')), {
      First: { Saved: { gain: 1 } },
      Second: { Saved: { gain: 2 } }
    });
  });
});

test('dialog renders both modes and drives save, rename, apply, delete, focus, and close workflows', async () => {
  await withDialogGlobals(async ({ documentRef, calls }) => {
    const providerCalls = [];
    let names = ['<Unsafe>', 'Second'];
    let activeSystemId = 'one';
    const provider = {
      getTitleKey: () => 'ui.title.pipelinePresets',
      getSystemPresetGroups: () => [{
        label: 'System Group',
        presets: [{ id: 'one', label: 'System One' }, { id: 'two', label: 'System Two' }]
      }],
      getActiveSystemPresetId: () => activeSystemId,
      getDefaultSaveName: () => 'Current',
      listUserPresetNames: async () => names,
      applySystemPreset: async id => providerCalls.push(['system', id]),
      applyUserPreset: async name => {
        providerCalls.push(['user', name]);
        activeSystemId = 'two';
      },
      saveUserPreset: async name => { providerCalls.push(['save', name]); names = [...names, name]; return true; },
      renameUserPreset: async (oldName, newName) => { providerCalls.push(['rename', oldName, newName]); return true; },
      deleteUserPresets: async selected => { providerCalls.push(['delete', selected]); names = []; return true; },
      errorKeys: { save: 'save.error', delete: 'delete.error' }
    };
    const core = createCore(calls);
    const dialogController = new PluginPresetDialog(core);
    const anchor = documentRef.createElement('button');
    anchor.className = 'anchor';
    const dialog = await dialogController.show(provider, anchor, { focusSaveName: true });
    const header = findByClass(dialog, 'preset-dialog-header');
    assert.equal(header.textContent, 't:ui.title.pipelinePresets');
    assert.equal(header.children[0].textContent, '✕');
    assert.equal(header.children[0].classList.contains('routing-dialog-close'), true);
    assert.equal(findByClass(dialog, 'preset-dialog-name-input').focused, true);
    assert.equal(findByClass(dialog, 'preset-dialog-name-input').selected, true);
    const userSection = findAllByClass(dialog, 'preset-dialog-section').at(-1);
    assert.equal(userSection.children[1].classList.contains('preset-dialog-save-row'), true);
    assert.match(findByClass(dialog, 'preset-dialog-save-button').innerHTML, /^<svg /);
    assert.equal(findAllByClass(dialog, 'preset-dialog-system-preset')[0].classList.contains('active'), true);
    assert.equal(findAllByClass(dialog, 'preset-dialog-user-row').length, 2);
    assert.equal(findByClass(dialog, 'preset-dialog-user-preset').textContent, '<Unsafe>');

    await findByClass(dialog, 'preset-dialog-system-preset').dispatch('click');
    await findByClass(dialog, 'preset-dialog-user-preset').dispatch('click');
    const systemButtonsAfterUserApply = findAllByClass(dialog, 'preset-dialog-system-preset');
    assert.equal(systemButtonsAfterUserApply[0].classList.contains('active'), false);
    assert.equal(systemButtonsAfterUserApply[1].classList.contains('active'), true);
    assert.equal(findByClass(dialog, 'preset-dialog-user-preset').classList.contains('active'), false);
    assert.equal(findByClass(dialog, 'preset-dialog-user-row').children[0].getAttribute('aria-label'), '<Unsafe>');
    const nameInput = findByClass(dialog, 'preset-dialog-name-input');
    nameInput.value = ' New Name ';
    await nameInput.dispatch('input');
    await findByClass(dialog, 'preset-dialog-save-button').dispatch('click');
    assert.ok(providerCalls.some(call => call[0] === 'save' && call[1] === 'New Name'));
    assert.equal(nameInput.value, ' New Name ');
    assert.equal(findByClass(dialog, 'preset-dialog-save-button').disabled, false);

    const renameButton = findByClass(dialog, 'preset-dialog-rename-button');
    await renameButton.dispatch('click');
    const renameInput = findByClass(dialog, 'preset-dialog-rename-input');
    renameInput.value = 'Renamed';
    await renameInput.dispatch('keydown', { key: 'Enter' });
    assert.ok(providerCalls.some(call => call[0] === 'rename'));

    const rows = findAllByClass(dialog, 'preset-dialog-user-row');
    for (const row of rows.slice(0, 2)) {
      const checkbox = row.children[0];
      checkbox.checked = true;
      await checkbox.dispatch('change');
    }
    await findByClass(dialog, 'preset-dialog-delete-button').dispatch('click');
    assert.equal(providerCalls.filter(call => call[0] === 'delete').length, 1);

    const outside = documentRef.createElement('div');
    documentRef.listeners.get('click')({ target: outside });
    assert.equal(documentRef.querySelector('.preset-dialog'), null);
  });
});

test('arrow keys apply adjacent presets, wrap at the ends, and keep navigation focus', async () => {
  await withDialogGlobals(async ({ documentRef }) => {
    const applied = [];
    const provider = {
      getTitleKey: () => 'title',
      getSystemPresetGroups: () => [{
        presets: [
          { id: 'one', label: 'System One' },
          { id: 'two', label: 'System Two' }
        ]
      }],
      getActiveSystemPresetId: () => 'one',
      getDefaultSaveName: () => '',
      listUserPresetNames: async () => ['User'],
      applySystemPreset: async id => { applied.push(['system', id]); },
      applyUserPreset: async name => { applied.push(['user', name]); },
      saveUserPreset: async () => true,
      errorKeys: { save: 'save', delete: 'delete' }
    };
    const controller = new PluginPresetDialog(createCore([]));
    const dialog = await controller.show(provider, documentRef.createElement('button'));
    assert.equal(documentRef.activeElement.textContent, 'System One');

    let prevented = 0;
    await dialog.dispatch('keydown', {
      key: 'ArrowDown',
      target: dialog,
      preventDefault() { prevented += 1; }
    });
    assert.deepEqual(applied.at(-1), ['system', 'two']);
    assert.equal(documentRef.activeElement.textContent, 'System Two');

    await dialog.dispatch('keydown', { key: 'ArrowDown', target: documentRef.activeElement });
    assert.deepEqual(applied.at(-1), ['user', 'User']);
    assert.equal(documentRef.activeElement.textContent, 'User');

    await dialog.dispatch('keydown', { key: 'ArrowDown', target: documentRef.activeElement });
    assert.deepEqual(applied.at(-1), ['system', 'one']);
    assert.equal(documentRef.activeElement.textContent, 'System One');

    await dialog.dispatch('keydown', { key: 'ArrowUp', target: documentRef.activeElement });
    assert.deepEqual(applied.at(-1), ['user', 'User']);
    assert.equal(documentRef.activeElement.textContent, 'User');
    assert.equal(prevented, 1);

    const callCount = applied.length;
    await dialog.dispatch('keydown', {
      key: 'ArrowDown',
      target: findByClass(dialog, 'preset-dialog-name-input')
    });
    assert.equal(applied.length, callCount);
  });
});

test('dialog focuses the current preset on open and remembers the last applied preset by context', async () => {
  await withDialogGlobals(async ({ documentRef }) => {
    const context = {};
    let names = ['Other', 'User'];
    let activeUser = 'User';
    let activeSystem = 'one';
    const createProvider = () => ({
      getTitleKey: () => 'title',
      getPresetContext: () => context,
      getSystemPresetGroups: () => [{
        presets: [
          { id: 'one', label: 'System One' },
          { id: 'two', label: 'System Two' }
        ]
      }],
      getActiveSystemPresetId: () => activeSystem,
      getActiveUserPresetName: () => activeUser,
      getDefaultSaveName: () => '',
      listUserPresetNames: async () => names,
      applySystemPreset: async () => true,
      applyUserPreset: async () => true,
      saveUserPreset: async () => true,
      errorKeys: { save: 'save', delete: 'delete' }
    });
    const controller = new PluginPresetDialog(createCore([]));
    let dialog = await controller.show(createProvider(), documentRef.createElement('button'));
    assert.equal(documentRef.activeElement.textContent, 'User');

    const other = findAllByClass(dialog, 'preset-dialog-user-preset')
      .find(button => button.textContent === 'Other');
    await other.dispatch('click');
    assert.equal(documentRef.activeElement.textContent, 'Other');

    activeUser = '';
    dialog = await controller.show(createProvider(), documentRef.createElement('button'));
    assert.equal(documentRef.activeElement.textContent, 'Other');

    names = ['User'];
    activeSystem = 'two';
    await controller.show(createProvider(), documentRef.createElement('button'));
    assert.equal(documentRef.activeElement.textContent, 'System Two');
  });
});

test('a delayed show cannot install a stale close handler over the current dialog', async () => {
  await withDialogGlobals(async ({ documentRef, timers }) => {
    let resolveFirstNames;
    const firstNames = new Promise(resolve => { resolveFirstNames = resolve; });
    const provider = listUserPresetNames => ({
      getTitleKey: () => 'title',
      getSystemPresetGroups: () => null,
      getDefaultSaveName: () => '',
      listUserPresetNames,
      saveUserPreset: async () => true,
      errorKeys: { save: 'save', delete: 'delete' }
    });
    const controller = new PluginPresetDialog(createCore([]));
    const firstShow = controller.show(provider(() => firstNames), documentRef.createElement('button'));
    await Promise.resolve();
    const secondDialog = await controller.show(provider(async () => []), documentRef.createElement('button'));
    resolveFirstNames([]);
    await firstShow;

    for (const timer of timers) if (!timer.cleared) timer.fn();
    assert.equal(documentRef.listeners.size, 1);
    documentRef.listeners.get('click')({ target: findByClass(secondDialog, 'preset-dialog-content') });
    assert.equal(documentRef.querySelector('.preset-dialog'), secondDialog);
  }, { deferTimers: true });
});

test('only the latest overlapping content render commits its sections', async () => {
  await withDialogGlobals(async ({ documentRef }) => {
    const nameLists = [createDeferred(), createDeferred()];
    let listIndex = 0;
    const provider = {
      getSystemPresetGroups: () => [{ presets: [{ id: 'system', label: 'System' }] }],
      getActiveSystemPresetId: () => '',
      listUserPresetNames: () => nameLists[listIndex++].promise,
      applySystemPreset: async () => true,
      applyUserPreset: async () => true,
      deleteUserPresets: async () => true,
      errorKeys: { save: 'save', delete: 'delete' }
    };
    const controller = new PluginPresetDialog(createCore([]));
    const dialog = documentRef.createElement('div');
    dialog.className = 'preset-dialog';
    const content = documentRef.createElement('div');
    dialog.appendChild(content);
    documentRef.body.appendChild(dialog);

    const firstRender = controller.renderContent(content, provider, controller.generation);
    const latestRender = controller.renderContent(content, provider, controller.generation);
    nameLists[1].resolve(['Latest']);
    await latestRender;
    nameLists[0].resolve(['Stale']);
    await firstRender;

    assert.equal(findAllByClass(content, 'preset-dialog-section').length, 2);
    assert.equal(findAllByClass(content, 'preset-dialog-system-preset').length, 1);
    assert.deepEqual(
      findAllByClass(content, 'preset-dialog-user-preset').map(button => button.textContent),
      ['Latest']
    );
  });
});

test('a completed operation from a closed dialog cannot invalidate a newer pending render', async () => {
  await withDialogGlobals(async ({ documentRef }) => {
    const pendingSave = createDeferred();
    const pendingNewNames = createDeferred();
    const oldProvider = {
      getTitleKey: () => 'title',
      getSystemPresetGroups: () => null,
      getDefaultSaveName: () => '',
      listUserPresetNames: async () => ['Old'],
      saveUserPreset: () => pendingSave.promise,
      errorKeys: { save: 'save', delete: 'delete' }
    };
    const newProvider = {
      getTitleKey: () => 'title',
      getSystemPresetGroups: () => null,
      getDefaultSaveName: () => '',
      listUserPresetNames: () => pendingNewNames.promise,
      errorKeys: { save: 'save', delete: 'delete' }
    };
    const controller = new PluginPresetDialog(createCore([]));
    const anchor = documentRef.createElement('button');
    const oldDialog = await controller.show(oldProvider, anchor);
    const nameInput = findByClass(oldDialog, 'preset-dialog-name-input');
    nameInput.value = 'Saved';
    await nameInput.dispatch('input');
    const oldSave = findByClass(oldDialog, 'preset-dialog-save-button').dispatch('click');
    await Promise.resolve();

    controller.close();
    const newShow = controller.show(newProvider, anchor);
    await Promise.resolve();
    pendingSave.resolve(true);
    await oldSave;
    pendingNewNames.resolve(['Latest']);
    const newDialog = await newShow;

    assert.deepEqual(
      findAllByClass(newDialog, 'preset-dialog-user-preset').map(button => button.textContent),
      ['Latest']
    );
  });
});

test('dialog handles empty system and user lists, cancellation, invalid names, and provider errors', async () => {
  await withDialogGlobals(async ({ documentRef, windowRef, calls }) => {
    let confirmResult = false;
    windowRef.confirm = () => confirmResult;
    const provider = {
      getTitleKey: () => 'key',
      getSystemPresetGroups: () => null,
      getDefaultSaveName: () => '',
      listUserPresetNames: async () => ['Only'],
      applyUserPreset: async () => {},
      saveUserPreset: async () => false,
      renameUserPreset: async () => false,
      deleteUserPresets: async () => false,
      errorKeys: { save: 'save.error', delete: 'delete.error' }
    };
    const controller = new PluginPresetDialog(createCore(calls));
    const anchor = documentRef.createElement('button');
    const dialog = await controller.show(provider, anchor);
    assert.equal(findByClass(dialog, 'preset-dialog-system-preset'), null);

    const nameInput = findByClass(dialog, 'preset-dialog-name-input');
    nameInput.value = '__proto__';
    await nameInput.dispatch('input');
    assert.equal(findByClass(dialog, 'preset-dialog-save-button').disabled, true);
    nameInput.value = 'Valid';
    await nameInput.dispatch('keydown', { key: 'Enter' });
    assert.ok(calls.some(call => call[0] === 'message' && call[1] === 'save.error'));

    await findByClass(dialog, 'preset-dialog-rename-button').dispatch('click');
    const renameInput = findByClass(dialog, 'preset-dialog-rename-input');
    await renameInput.dispatch('keydown', { key: 'Escape' });

    const checkbox = findByClass(dialog, 'preset-dialog-user-row').children[0];
    checkbox.checked = true;
    await checkbox.dispatch('change');
    await findByClass(dialog, 'preset-dialog-delete-button').dispatch('click');
    assert.equal(calls.some(call => call[1] === 'delete.error'), false);
    confirmResult = true;
    await findByClass(dialog, 'preset-dialog-delete-button').dispatch('click');
    assert.ok(calls.some(call => call[1] === 'delete.error'));

    provider.listUserPresetNames = async () => [];
    await controller.renderContent(findByClass(dialog, 'preset-dialog-content'), provider, controller.generation);
    assert.ok(findByClass(dialog, 'preset-dialog-empty'));
    provider.handlesErrors = true;
    controller.reportError(provider, 'ignored');
  });

  await withDialogGlobals(async ({ documentRef, calls }) => {
    const controller = new PluginPresetDialog(createCore(calls));
    const header = controller.createHeader({ getTitleKey: () => 'missing' });
    assert.equal(header.textContent, 'Effect Presets');
    await header.children[0].dispatch('click');
  }, { withUi: false });
});
