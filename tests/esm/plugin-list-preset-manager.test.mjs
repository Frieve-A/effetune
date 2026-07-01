import assert from 'node:assert/strict';
import test from 'node:test';

import { PresetManager } from '../../js/ui/plugin-list/preset-manager.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

class FakeElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = options.id ?? '';
    this.className = options.className ?? '';
    this.textContent = options.textContent ?? '';
    this.title = '';
    this.value = '';
    this.draggable = false;
    this.style = {};
    this.dataset = options.dataset ?? {};
    this.children = [];
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.removed = false;
    this.scrollTop = options.scrollTop ?? 0;
    this.rect = options.rect ?? { top: 20, right: 120 };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(type, event = {}) {
    return Promise.all((this.listeners.get(type) || []).map(listener => listener({ target: this, ...event })));
  }

  remove() {
    this.removed = true;
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    }
  }

  getBoundingClientRect() {
    return this.rect;
  }

  matches(selector) {
    if (selector === this.tagName.toLowerCase()) return true;
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return false;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches?.(selector)) return child;
      const match = child.querySelector?.(selector);
      if (match) return match;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matches?.(selector)) matches.push(child);
      matches.push(...(child.querySelectorAll?.(selector) ?? []));
    }
    return matches;
  }
}

function createDocument() {
  return {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createTextNode(text) {
      return {
        nodeType: 3,
        textContent: text,
        parentNode: null
      };
    }
  };
}

function createPluginListManager(options = {}) {
  const calls = [];
  const pluginList = options.pluginList ?? new FakeElement('div', { scrollTop: 40 });
  const collapsedCategories = { ...(options.collapsedCategories ?? {}) };
  const manager = {
    calls,
    pluginList,
    collapseManager: {
      collapsedCategories,
      toggleCategoryCollapse(category) {
        calls.push(['toggleCategoryCollapse', category]);
      }
    },
    dragDropManager: {
      setupPresetItemDragEvents(item, presetName, isUserPreset) {
        calls.push(['setupPresetItemDragEvents', presetName, isUserPreset, item.textContent]);
      }
    },
    searchManager: {
      currentTab: options.currentTab ?? 'effects'
    },
    hideLoadingSpinner() {
      calls.push(['hideLoadingSpinner']);
    }
  };

  return manager;
}

function createWindow(calls, options = {}) {
  const windowRef = {
    uiManager: options.uiManager === false ? null : {
      t(key, params) {
        calls.push(['translate', key, params ?? null]);
        return params?.count !== undefined ? `T:${key}:${params.count}` : `T:${key}`;
      },
      setError(message, isError) {
        calls.push(['setError', message, isError]);
      }
    },
    pipelineManager: options.pipelineManager,
    audioManager: options.audioManager,
    pluginManager: options.pluginManager
  };
  return windowRef;
}

async function withPresetGlobals(calls, options, callback) {
  await withGlobals({
    document: options.document ?? createDocument(),
    window: options.window ?? createWindow(calls, options),
    fetch: options.fetch ?? (async () => ({
      text: async () => [
        '[categories]',
        'Tone: Tone presets',
        '[presets]',
        'warm: Warm|Tone|Warm preset'
      ].join('\n')
    })),
    console: options.console ?? {
      log: (...args) => calls.push(['consoleLog', ...args]),
      warn: (...args) => calls.push(['consoleWarn', ...args]),
      error: (...args) => calls.push(['consoleError', ...args])
    }
  }, callback);
}

function createPluginFactory(calls, options = {}) {
  const availability = options.availability ?? (() => true);
  return {
    isPluginAvailable(name) {
      calls.push(['isPluginAvailable', name]);
      const value = availability(name, calls.filter(call => call[0] === 'isPluginAvailable').length);
      if (value instanceof Error) throw value;
      return value;
    },
    createPlugin(name) {
      calls.push(['createPlugin', name]);
      if (options.throwFor?.includes(name)) {
        throw new Error(`cannot create ${name}`);
      }
      return {
        id: calls.filter(call => call[0] === 'createPlugin').length,
        name,
        enabled: true,
        parameters: {},
        inputBus: null,
        outputBus: null,
        channel: null,
        setEnabled(value) {
          calls.push(['setEnabled', name, value]);
          this.enabled = value;
        },
        setParameters(params) {
          calls.push(['setParameters', name, params]);
          Object.assign(this.parameters, params);
        }
      };
    }
  };
}

function createPipelineRuntime(calls, userPresets, options = {}) {
  const expandedPlugins = new Set();
  const pipelineManager = {
    presetManager: {
      async getPresets() {
        calls.push(['getPresets']);
        if (options.throwPresets) throw new Error('preset read failed');
        return userPresets;
      }
    },
    expandedPlugins,
    updatePipelineUI(force) {
      calls.push(['updatePipelineUI', force]);
    },
    updateWorkletPlugins() {
      calls.push(['updateWorkletPlugins']);
    },
    historyManager: options.history === false ? null : {
      saveState() {
        calls.push(['saveState']);
      }
    }
  };
  const audioManager = { pipeline: options.pipeline ?? [] };
  return { pipelineManager, audioManager, expandedPlugins };
}

test('initPresetManager loads real system preset definitions once', async () => {
  const calls = [];
  const pluginListManager = createPluginListManager();
  const manager = new PresetManager(pluginListManager);

  await withPresetGlobals(calls, {}, async () => {
    await manager.initPresetManager();
    assert.deepEqual(manager.presetManager.presetCategories.Tone.presets, ['Warm']);
    assert.equal(manager.presetManager.presetDefinitions.get('Warm').description, 'Warm preset');

    const loaded = manager.presetManager;
    await manager.initPresetManager();
    assert.equal(manager.presetManager, loaded);
  });
});

test('system preset list renders categories, translated counts, and recovers from initialization errors', async () => {
  const calls = [];
  const pluginListManager = createPluginListManager();
  const manager = new PresetManager(pluginListManager);
  manager.presetManager = {
    presetCategories: {
      Tone: { description: 'Tone presets', presets: ['Warm', 'Missing'] },
      Dynamics: { description: 'Dynamics presets', presets: [] }
    },
    presetDefinitions: new Map([
      ['Warm', { description: 'Warm preset' }]
    ])
  };

  await withPresetGlobals(calls, {}, async () => {
    await manager.initSystemPresetList();
  });

  assert.equal(pluginListManager.pluginList.children[0].className, 'plugin-list-content');
  assert.equal(pluginListManager.pluginList.children[0].children.length, 2);
  assert.equal(pluginListManager.pluginList.children[1].textContent, 'T:ui.systemPresetsAvailable:2');
  assert.equal(pluginListManager.collapseManager.collapsedCategories.Tone, false);
  assert.ok(pluginListManager.calls.some(call => call[0] === 'setupPresetItemDragEvents' && call[1] === 'Warm'));
  assert.deepEqual(pluginListManager.calls.filter(call => call[0] === 'hideLoadingSpinner'), [['hideLoadingSpinner']]);

  const errorCalls = [];
  const errorManager = new PresetManager(createPluginListManager());
  errorManager.initPresetManager = async () => {
    throw new Error('load failed');
  };
  await withPresetGlobals(errorCalls, {
    console: {
      error(...args) {
        errorCalls.push(['consoleError', args[0], args[1].message]);
      }
    }
  }, async () => {
    await errorManager.initSystemPresetList();
  });
  assert.deepEqual(errorCalls, [['consoleError', 'Error initializing system preset list:', 'load failed']]);
  assert.deepEqual(errorManager.pluginListManager.calls, [['hideLoadingSpinner']]);

  const fallbackManager = new PresetManager(createPluginListManager());
  fallbackManager.presetManager = {
    presetCategories: {},
    presetDefinitions: new Map()
  };
  await withPresetGlobals([], { uiManager: false }, async () => {
    await fallbackManager.initSystemPresetList();
  });
  assert.equal(fallbackManager.pluginList.children[1].textContent, '0 system presets available');
});

test('user preset list handles translated, fallback, empty, and error states', async () => {
  const successCalls = [];
  const successManager = new PresetManager(createPluginListManager());
  successManager.getUserPresetsData = async () => [
    { name: 'Alpha', description: 'User preset' },
    { name: 'Beta', description: 'User preset' }
  ];

  await withPresetGlobals(successCalls, {}, async () => {
    await successManager.initUserPresetList();
  });
  assert.equal(successManager.pluginList.children[1].textContent, 'T:ui.userPresetsAvailable:2');
  assert.deepEqual(successManager.pluginListManager.calls.filter(call => call[0] === 'hideLoadingSpinner'), [['hideLoadingSpinner']]);

  const fallbackManager = new PresetManager(createPluginListManager());
  fallbackManager.getUserPresetsData = async () => [];
  await withPresetGlobals([], { uiManager: false }, async () => {
    await fallbackManager.initUserPresetList();
  });
  assert.equal(fallbackManager.pluginList.children[1].textContent, '0 user presets available');

  const nullDataManager = new PresetManager(createPluginListManager());
  nullDataManager.getUserPresetsData = async () => null;
  await withPresetGlobals([], { uiManager: false }, async () => {
    await nullDataManager.initUserPresetList();
  });
  assert.equal(nullDataManager.pluginList.children[1].textContent, '0 user presets available');

  const errorCalls = [];
  const errorManager = new PresetManager(createPluginListManager());
  errorManager.getUserPresetsData = async () => {
    throw new Error('user presets failed');
  };
  await withPresetGlobals(errorCalls, {
    console: {
      error(...args) {
        errorCalls.push(['consoleError', args[0], args[1].message]);
      }
    }
  }, async () => {
    await errorManager.initUserPresetList();
  });
  assert.deepEqual(errorCalls, [['consoleError', 'Error initializing user preset list:', 'user presets failed']]);
  assert.deepEqual(errorManager.pluginListManager.calls, [['hideLoadingSpinner']]);
});

test('category rows and preset items wire collapse, drag, hover, and fallback tooltips', async () => {
  const calls = [];
  const pluginListManager = createPluginListManager({ collapsedCategories: { Closed: true, Open: false } });
  const manager = new PresetManager(pluginListManager);
  manager.presetManager = {
    async addPresetToPipeline(name) {
      calls.push(['addPresetToPipeline', name]);
    }
  };

  await withPresetGlobals(calls, {}, async () => {
    const closedRow = manager.createCategoryRow('Closed', 3);
    assert.equal(closedRow.querySelector('.plugin-category-items').style.display, 'none');
    assert.equal(closedRow.querySelector('.category-effects-count').style.display, 'block');

    const openRow = manager.createCategoryRow('Open', 2, 'presets');
    assert.equal(openRow.querySelector('.plugin-category-items').style.display, 'flex');
    assert.equal(openRow.querySelector('.category-effects-count').textContent, '2 presets');
    await openRow.children[0].dispatchEvent('click');
    assert.ok(pluginListManager.calls.some(call => call[0] === 'toggleCategoryCollapse' && call[1] === 'Open'));

    const item = manager.createPresetItem('Warm', { description: 'Warm preset' });
    assert.equal(item.draggable, true);
    assert.equal(item.querySelector('.plugin-description').textContent, 'Warm preset');
    await item.dispatchEvent('dblclick');
    await item.dispatchEvent('mouseenter');
    assert.equal(item.style.backgroundColor, '#3a3a3a');
    await item.dispatchEvent('mouseleave');
    assert.equal(item.style.backgroundColor, '');
    assert.equal(item.querySelector('.plugin-description').style.left, '130px');

    const noDescriptionItem = new FakeElement('div');
    manager.setupPresetItemEvents(noDescriptionItem, 'No Description');
    await noDescriptionItem.dispatchEvent('mouseenter');
  });

  assert.deepEqual(calls, [['addPresetToPipeline', 'Warm']]);
  assert.ok(pluginListManager.calls.some(call => call[0] === 'setupPresetItemDragEvents' && call[2] === false));
});

test('preset item double-click failures and user item events report UI errors', async () => {
  const calls = [];
  const pluginListManager = createPluginListManager();
  const manager = new PresetManager(pluginListManager);
  manager.presetManager = {
    async addPresetToPipeline() {
      throw new Error('system add failed');
    }
  };

  await withPresetGlobals(calls, {
    console: {
      error(...args) {
        calls.push(['consoleError', args[0], args[1].message]);
      }
    }
  }, async () => {
    const systemItem = manager.createPresetItem('Broken', { description: 'Broken preset' });
    await systemItem.dispatchEvent('dblclick');

    const shortUserItem = manager.createUserPresetItem('Short Name', 'Short Name');
    assert.equal(shortUserItem.textContent, 'Short Name');
    assert.equal(shortUserItem.title, '');

    manager.addUserPresetToPipeline = async presetName => {
      calls.push(['addUserPresetToPipeline', presetName]);
    };
    await shortUserItem.dispatchEvent('dblclick');

    manager.addUserPresetToPipeline = async () => {
      throw new Error('user add failed');
    };
    const longUserItem = manager.createUserPresetItem('This preset name is very long', 'Long description');
    assert.equal(longUserItem.textContent, 'This preset name ...');
    assert.equal(longUserItem.title, 'This preset name is very long');
    await longUserItem.dispatchEvent('dblclick');
    await longUserItem.dispatchEvent('mouseenter');
    assert.equal(longUserItem.querySelector('.plugin-description').style.top, '20px');
    await longUserItem.dispatchEvent('mouseleave');

    const noDescriptionItem = new FakeElement('div');
    manager.setupUserPresetItemEvents(noDescriptionItem, 'No Description');
    await noDescriptionItem.dispatchEvent('mouseenter');
  });

  assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'Error adding preset: system add failed'));
  assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'Error adding user preset: user add failed'));
  assert.ok(pluginListManager.calls.some(call => call[0] === 'setupPresetItemDragEvents' && call[2] === true));

  await withPresetGlobals([], { uiManager: false, console: { error() {} } }, async () => {
    const silentSystemItem = manager.createPresetItem('Silent Broken', { description: 'Broken preset' });
    await silentSystemItem.dispatchEvent('dblclick');

    const silentUserItem = manager.createUserPresetItem('Silent User', 'Silent User');
    await silentUserItem.dispatchEvent('dblclick');
  });
});

test('getUserPresetsData handles missing managers, sorted output, and read failures', async () => {
  const calls = [];
  const manager = new PresetManager(createPluginListManager());

  await withPresetGlobals(calls, { window: createWindow(calls, { pipelineManager: null }) }, async () => {
    assert.deepEqual(await manager.getUserPresetsData(), []);
  });

  const noPresetManagerWindow = createWindow(calls, { pipelineManager: {} });
  await withPresetGlobals(calls, { window: noPresetManagerWindow }, async () => {
    assert.deepEqual(await manager.getUserPresetsData(), []);
  });

  const pipelineManager = {
    presetManager: {
      async getPresets() {
        return { Zebra: {}, Alpha: {} };
      }
    }
  };
  await withPresetGlobals(calls, { window: createWindow(calls, { pipelineManager }) }, async () => {
    assert.deepEqual(await manager.getUserPresetsData(), [
      { name: 'Alpha', description: 'User preset', isUserPreset: true },
      { name: 'Zebra', description: 'User preset', isUserPreset: true }
    ]);
  });

  const errorCalls = [];
  const failingPipelineManager = {
    presetManager: {
      async getPresets() {
        throw new Error('read failed');
      }
    }
  };
  await withPresetGlobals(errorCalls, {
    window: createWindow(errorCalls, { pipelineManager: failingPipelineManager }),
    console: {
      error(...args) {
        errorCalls.push(['consoleError', args[0], args[1].message]);
      }
    }
  }, async () => {
    assert.deepEqual(await manager.getUserPresetsData(), []);
  });
  assert.deepEqual(errorCalls, [['consoleError', 'Error getting user presets:', 'read failed']]);
});

test('addUserPresetsCategory initializes user state and preserves existing collapsed state', async () => {
  const manager = new PresetManager(createPluginListManager());
  const contentContainer = new FakeElement('div');

  await withPresetGlobals([], {}, async () => {
    await manager.addUserPresetsCategory(contentContainer, [{ name: 'Alpha' }]);
  });
  assert.equal(manager.pluginListManager.collapseManager.collapsedCategories.User, false);
  assert.equal(contentContainer.children[0].querySelector('.plugin-item').textContent, 'Alpha');

  const collapsedManager = new PresetManager(createPluginListManager({ collapsedCategories: { User: true } }));
  const collapsedContainer = new FakeElement('div');
  await withPresetGlobals([], {}, async () => {
    await collapsedManager.addUserPresetsCategory(collapsedContainer, [{ name: 'Beta' }]);
  });
  assert.equal(collapsedManager.pluginListManager.collapseManager.collapsedCategories.User, true);
  assert.equal(collapsedContainer.children[0].querySelector('.plugin-category-items').style.display, 'none');
});

test('addUserPresetToPipeline inserts new-format presets with section labels and end sections', async () => {
  const calls = [];
  const userPresets = {
    Wide: {
      pipeline: [{
        name: 'Gain',
        enabled: false,
        inputBus: 1,
        outputBus: 2,
        channel: 'L',
        parameters: { gain: -3 }
      }]
    }
  };
  const runtime = createPipelineRuntime(calls, userPresets, {
    pipeline: [{ name: 'Existing' }]
  });
  const pluginManager = createPluginFactory(calls);
  const manager = new PresetManager(createPluginListManager());

  await withPresetGlobals(calls, {
    window: createWindow(calls, {
      pipelineManager: runtime.pipelineManager,
      audioManager: runtime.audioManager,
      pluginManager
    })
  }, async () => {
    assert.equal(await manager.addUserPresetToPipeline('Wide', 0), true);
  });

  assert.deepEqual(runtime.audioManager.pipeline.map(plugin => plugin.name), ['Section', 'Gain', 'Section', 'Existing']);
  assert.equal(runtime.expandedPlugins.size, 3);
  assert.ok(calls.some(call => call[0] === 'setParameters' && call[1] === 'Section' && call[2].cm === 'Wide'));
  assert.ok(calls.some(call => call[0] === 'setEnabled' && call[1] === 'Gain' && call[2] === false));
  assert.deepEqual(calls.slice(-3), [
    ['updatePipelineUI', true],
    ['updateWorkletPlugins'],
    ['saveState']
  ]);
});

test('addUserPresetToPipeline supports old-format presets, creation failures, section skips, and no history', async () => {
  const calls = [];
  const userPresets = {
    Legacy: {
      plugins: [
        { nm: 'EQ', ib: 0, ob: 3, ch: 'A', freq: 1000 },
        { nm: 'Bad', en: false }
      ]
    }
  };
  const runtime = createPipelineRuntime(calls, userPresets, {
    history: false,
    pipeline: []
  });
  const pluginManager = createPluginFactory(calls, {
    availability: () => false,
    throwFor: ['Bad']
  });
  const manager = new PresetManager(createPluginListManager());

  await withPresetGlobals(calls, {
    window: createWindow(calls, {
      pipelineManager: runtime.pipelineManager,
      audioManager: runtime.audioManager,
      pluginManager
    }),
    console: {
      warn(...args) {
        calls.push(['consoleWarn', args[0], args[1].message]);
      }
    }
  }, async () => {
    assert.equal(await manager.addUserPresetToPipeline('Legacy'), true);
  });

  assert.deepEqual(runtime.audioManager.pipeline.map(plugin => plugin.name), ['EQ']);
  assert.equal(runtime.audioManager.pipeline[0].inputBus, 0);
  assert.equal(runtime.audioManager.pipeline[0].outputBus, 3);
  assert.equal(runtime.audioManager.pipeline[0].channel, 'A');
  assert.ok(calls.some(call => call[0] === 'consoleWarn' && call[0] === 'consoleWarn'));
  assert.equal(calls.some(call => call[0] === 'saveState'), false);

  const sectionCalls = [];
  const sectionRuntime = createPipelineRuntime(sectionCalls, {
    InsertsBeforeSection: { pipeline: [{ name: 'EQ', parameters: {} }] }
  }, {
    history: false,
    pipeline: [{ name: 'Section' }]
  });
  await withPresetGlobals(sectionCalls, {
    window: createWindow(sectionCalls, {
      pipelineManager: sectionRuntime.pipelineManager,
      audioManager: sectionRuntime.audioManager,
      pluginManager: createPluginFactory(sectionCalls, { availability: () => false })
    })
  }, async () => {
    await manager.addUserPresetToPipeline('InsertsBeforeSection', 0);
  });
  assert.deepEqual(sectionRuntime.audioManager.pipeline.map(plugin => plugin.name), ['EQ', 'Section']);
});

test('addUserPresetToPipeline reports invalid setup, data, and availability failures', async () => {
  const manager = new PresetManager(createPluginListManager());
  const calls = [];

  await withPresetGlobals(calls, {
    window: createWindow(calls, { pipelineManager: null }),
    console: {
      error(...args) {
        calls.push(['consoleError', args[0], args[1].message]);
      }
    }
  }, async () => {
    await assert.rejects(() => manager.addUserPresetToPipeline('Missing'), /Pipeline manager/);
  });

  const missingPresetRuntime = createPipelineRuntime(calls, {});
  await withPresetGlobals(calls, {
    window: createWindow(calls, {
      pipelineManager: missingPresetRuntime.pipelineManager,
      audioManager: missingPresetRuntime.audioManager,
      pluginManager: createPluginFactory(calls)
    })
  }, async () => {
    await assert.rejects(() => manager.addUserPresetToPipeline('Missing'), /not found/);
  });

  const missingManagersRuntime = createPipelineRuntime(calls, {
    Present: { pipeline: [] }
  });
  await withPresetGlobals(calls, {
    window: createWindow(calls, { pipelineManager: missingManagersRuntime.pipelineManager })
  }, async () => {
    await assert.rejects(() => manager.addUserPresetToPipeline('Present'), /Required managers/);
  });

  const missingPluginManagerRuntime = createPipelineRuntime(calls, {
    PresentAudioOnly: { pipeline: [] }
  });
  await withPresetGlobals(calls, {
    window: createWindow(calls, {
      pipelineManager: missingPluginManagerRuntime.pipelineManager,
      audioManager: missingPluginManagerRuntime.audioManager
    }),
    console: { error() {} }
  }, async () => {
    await assert.rejects(() => manager.addUserPresetToPipeline('PresentAudioOnly'), /Required managers/);
  });

  const invalidRuntime = createPipelineRuntime(calls, {
    Invalid: { nope: true }
  });
  await withPresetGlobals(calls, {
    window: createWindow(calls, {
      pipelineManager: invalidRuntime.pipelineManager,
      audioManager: invalidRuntime.audioManager,
      pluginManager: createPluginFactory(calls)
    })
  }, async () => {
    await assert.rejects(() => manager.addUserPresetToPipeline('Invalid'), /Invalid preset data format/);
  });

  const warningCalls = [];
  const warningRuntime = createPipelineRuntime(warningCalls, {
    NoSections: { pipeline: [{ name: 'EQ', parameters: {} }] }
  }, {
    pipeline: [{ name: 'Existing' }]
  });
  const warningPluginManager = createPluginFactory(warningCalls, {
    availability: (name, callCount) => callCount <= 2 ? new Error(`section check ${callCount}`) : true
  });
  await withPresetGlobals(warningCalls, {
    window: createWindow(warningCalls, {
      pipelineManager: warningRuntime.pipelineManager,
      audioManager: warningRuntime.audioManager,
      pluginManager: warningPluginManager
    }),
    console: {
      warn(...args) {
        warningCalls.push(['consoleWarn', args[0], args[1].message]);
      },
      error() {}
    }
  }, async () => {
    await manager.addUserPresetToPipeline('NoSections', 0);
  });
  assert.ok(warningCalls.some(call => call[0] === 'consoleWarn' && call[1] === 'Section plugin not available for preset labeling:'));
  assert.ok(warningCalls.some(call => call[0] === 'consoleWarn' && call[1] === 'Section plugin not available for end section:'));

  const noEndSectionCalls = [];
  const noEndSectionRuntime = createPipelineRuntime(noEndSectionCalls, {
    NoEndSection: { pipeline: [{ name: 'EQ', parameters: {} }] }
  }, {
    pipeline: [{ name: 'Existing' }]
  });
  await withPresetGlobals(noEndSectionCalls, {
    window: createWindow(noEndSectionCalls, {
      pipelineManager: noEndSectionRuntime.pipelineManager,
      audioManager: noEndSectionRuntime.audioManager,
      pluginManager: createPluginFactory(noEndSectionCalls, {
        availability: (name, callCount) => callCount === 1
      })
    })
  }, async () => {
    await manager.addUserPresetToPipeline('NoEndSection', 0);
  });
  assert.deepEqual(noEndSectionRuntime.audioManager.pipeline.map(plugin => plugin.name), ['Section', 'EQ', 'Existing']);
});

test('refreshPresetsIfVisible and addPresetToPipeline handle visible, hidden, initialized, and lazy states', async () => {
  const manager = new PresetManager(createPluginListManager({ currentTab: 'userPresets' }));
  const existingContent = new FakeElement('div');
  existingContent.className = 'plugin-list-content';
  const existingCount = new FakeElement('div');
  existingCount.id = 'effectCount';
  let queryIndex = 0;
  manager.pluginList.querySelector = selector => {
    queryIndex++;
    if (selector === '.plugin-list-content') return queryIndex === 1 ? existingContent : null;
    if (selector === '#effectCount') return queryIndex === 2 ? existingCount : null;
    return null;
  };
  manager.initUserPresetList = async () => {
    manager.pluginListManager.calls.push(['initUserPresetList']);
  };
  manager.pluginList.scrollTop = 55;

  await manager.refreshPresetsIfVisible();
  assert.equal(existingContent.removed, true);
  assert.equal(existingCount.removed, true);
  assert.equal(manager.pluginList.scrollTop, 55);
  assert.deepEqual(manager.pluginListManager.calls, [['initUserPresetList']]);

  await manager.refreshPresetsIfVisible();
  assert.deepEqual(manager.pluginListManager.calls, [['initUserPresetList'], ['initUserPresetList']]);

  const hiddenManager = new PresetManager(createPluginListManager({ currentTab: 'effects' }));
  hiddenManager.initUserPresetList = async () => {
    throw new Error('should not run');
  };
  await hiddenManager.refreshPresetsIfVisible();

  const systemCalls = [];
  const systemManager = new PresetManager(createPluginListManager());
  systemManager.initPresetManager = async () => {
    systemCalls.push(['initPresetManager']);
    systemManager.presetManager = {
      async addPresetToPipeline(name, index) {
        systemCalls.push(['addPresetToPipeline', name, index]);
        return 'added';
      }
    };
  };
  assert.equal(await systemManager.addPresetToPipeline('Warm', 4), 'added');
  assert.deepEqual(systemCalls, [
    ['initPresetManager'],
    ['addPresetToPipeline', 'Warm', 4]
  ]);

  systemManager.presetManager = {
    async addPresetToPipeline(name, index) {
      systemCalls.push(['directAddPresetToPipeline', name, index]);
      return 'direct';
    }
  };
  assert.equal(await systemManager.addPresetToPipeline('Cool'), 'direct');
  assert.deepEqual(systemCalls.at(-1), ['directAddPresetToPipeline', 'Cool', null]);
});
