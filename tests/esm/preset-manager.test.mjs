import assert from 'node:assert/strict';
import test from 'node:test';

import { PresetManager } from '../../js/preset-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createConsole(calls) {
  return {
    ...console,
    error(...args) {
      calls.push(['consoleError', ...args]);
    },
    warn(...args) {
      calls.push(['consoleWarn', ...args]);
    }
  };
}

async function withPresetGlobals(options, callback) {
  const calls = [];
  const globals = {
    console: createConsole(calls)
  };

  if ('fetch' in options) {
    globals.fetch = options.fetch;
  }

  if ('window' in options) {
    globals.window = options.window;
  }

  return withGlobals(globals, async () => callback({ calls }));
}

function createResponse(data, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() {
      return data;
    },
    async text() {
      return options.text ?? data;
    }
  };
}

function createPlugin(name, calls, options = {}) {
  const plugin = {
    name,
    parameters: null,
    setParameters(params) {
      this.parameters = { ...params };
      calls.push(['setParameters', name, { ...params }]);
    }
  };

  if (options.withSetEnabled !== false) {
    plugin.setEnabled = function setEnabled(enabled) {
      this.enabled = enabled;
      calls.push(['setEnabled', name, enabled]);
    };
  }

  return plugin;
}

function createPipelineManagers(calls, options = {}) {
  const created = [];
  const sectionAvailability = [...(options.sectionAvailability ?? [true])];
  const sectionCreateResults = [...(options.sectionCreateResults ?? [])];
  const pluginsByName = options.pluginsByName ?? {};
  const pipelineManager = {
    expandedPlugins: new Set(),
    updatePipelineUI(force) {
      calls.push(['updatePipelineUI', force]);
    },
    updateWorkletPlugins() {
      calls.push(['updateWorkletPlugins']);
    },
    historyManager: options.historyManager === false
      ? null
      : {
          saveState() {
            calls.push(['saveState']);
          }
        }
  };

  const pluginManager = {
    isPluginAvailable(name) {
      calls.push(['isPluginAvailable', name]);
      if (options.isPluginAvailableError) throw options.isPluginAvailableError;
      if (name !== 'Section') return options.availablePlugins?.has(name) ?? true;
      return sectionAvailability.length > 0 ? sectionAvailability.shift() : false;
    },
    createPlugin(name) {
      calls.push(['createPlugin', name]);
      if (options.throwFor?.has(name)) {
        throw new Error(`Cannot create ${name}`);
      }
      if (name === 'Section' && sectionCreateResults.length > 0) {
        const result = sectionCreateResults.shift();
        if (result instanceof Error) throw result;
        created.push(result);
        return result;
      }
      const plugin = pluginsByName[name] ?? createPlugin(
        name,
        calls,
        { withSetEnabled: !options.noSetEnabledFor?.has(name) }
      );
      created.push(plugin);
      return plugin;
    }
  };

  return {
    created,
    audioManager: {
      pipeline: options.pipeline ?? []
    },
    pluginManager,
    pipelineManager
  };
}

const PRESETS_TEXT = `
loose entry before any section

# a comment
[categories]
Tone: Tone shaping
Dynamics: Dynamic processors
[presets]
tone/basic: Basic Tone|Tone|Simple tone preset
ghost/path: Ghost Preset|Missing|Category is absent
dyn/smooth: Smooth Dynamics|Dynamics|Gentle compressor
`;

test('loads and parses preset definitions including ignored lines and missing categories', async () => {
  const manager = new PresetManager();
  assert.deepEqual(manager.presetCategories, {});
  assert.deepEqual([...manager.presetDefinitions], []);

  const parsed = manager.parsePresetsDefinition(PRESETS_TEXT);
  assert.deepEqual(parsed.categories, {
    Tone: {
      description: 'Tone shaping',
      presets: ['Basic Tone']
    },
    Dynamics: {
      description: 'Dynamic processors',
      presets: ['Smooth Dynamics']
    }
  });
  assert.deepEqual(parsed.presetDefinitions.get('Basic Tone'), {
    path: 'presets/tone/basic',
    category: 'Tone',
    description: 'Simple tone preset'
  });
  assert.deepEqual(parsed.presetDefinitions.get('Ghost Preset'), {
    path: 'presets/ghost/path',
    category: 'Missing',
    description: 'Category is absent'
  });

  await withPresetGlobals({
    fetch(url) {
      assert.equal(url, 'presets/presets.txt');
      return Promise.resolve(createResponse(PRESETS_TEXT, { text: PRESETS_TEXT }));
    }
  }, async () => {
    const loaded = await manager.loadPresets();
    assert.deepEqual(loaded.categories, parsed.categories);
    assert.deepEqual([...loaded.presetDefinitions], [...parsed.presetDefinitions]);
    assert.equal(manager.presetCategories, loaded.categories);
    assert.equal(manager.presetDefinitions, loaded.presetDefinitions);
  });

  await withPresetGlobals({
    fetch() {
      throw new Error('network failed');
    }
  }, async ({ calls }) => {
    const failed = await manager.loadPresets();
    assert.deepEqual(failed.categories, {});
    assert.deepEqual([...failed.presetDefinitions], []);
    assert.equal(calls[0][0], 'consoleError');
  });
});

test('loads preset data and rethrows missing or failed preset file loads', async () => {
  const manager = new PresetManager();
  manager.presetDefinitions.set('Basic', { path: 'presets/basic' });

  await withPresetGlobals({
    fetch(url) {
      assert.equal(url, 'presets/basic.effetune_preset');
      return Promise.resolve(createResponse({ pipeline: [] }));
    }
  }, async () => {
    assert.deepEqual(await manager.loadPresetData('Basic'), { pipeline: [] });
  });

  await withPresetGlobals({}, async ({ calls }) => {
    await assert.rejects(
      () => manager.loadPresetData('Missing'),
      /Preset "Missing" not found/
    );
    assert.equal(calls[0][0], 'consoleError');
  });

  await withPresetGlobals({
    fetch() {
      return Promise.resolve(createResponse(null, { ok: false, status: 503 }));
    }
  }, async ({ calls }) => {
    await assert.rejects(
      () => manager.loadPresetData('Basic'),
      /Failed to load preset file: 503/
    );
    assert.equal(calls[0][0], 'consoleError');
  });
});

test('adds a preset at the end with section labels, plugin parameters, and history state', async () => {
  const manager = new PresetManager();
  manager.loadPresetData = async presetName => {
    assert.equal(presetName, 'Full Chain');
    return {
      pipeline: [
        {
          name: 'Equalizer',
          parameters: { gain: 2 },
          enabled: false,
          inputBus: 1,
          outputBus: 2,
          channel: 'L'
        },
        {
          name: 'Limiter',
          parameters: { threshold: -3 },
          enabled: 1
        },
        {
          name: 'Meter',
          parameters: { speed: 'fast' }
        },
        {
          name: 'Broken',
          parameters: {}
        }
      ]
    };
  };

  await withPresetGlobals({ window: {} }, async ({ calls }) => {
    const section = createPlugin('Section', calls);
    const limiter = createPlugin('Limiter', calls, { withSetEnabled: false });
    const managers = createPipelineManagers(calls, {
      sectionCreateResults: [section],
      pluginsByName: { Limiter: limiter },
      throwFor: new Set(['Broken'])
    });
    globalThis.window.audioManager = managers.audioManager;
    globalThis.window.pluginManager = managers.pluginManager;
    globalThis.window.pipelineManager = managers.pipelineManager;

    assert.equal(await manager.addPresetToPipeline('Full Chain'), true);

    assert.deepEqual(managers.audioManager.pipeline.map(plugin => plugin.name), [
      'Section',
      'Equalizer',
      'Limiter',
      'Meter'
    ]);
    assert.deepEqual(section.parameters, { cm: 'Full Chain' });
    const equalizer = managers.audioManager.pipeline[1];
    assert.deepEqual(equalizer.parameters, { gain: 2, enabled: false });
    assert.equal(equalizer.inputBus, 1);
    assert.equal(equalizer.outputBus, 2);
    assert.equal(equalizer.channel, 'L');
    assert.equal(equalizer.enabled, false);
    assert.deepEqual(limiter.parameters, { threshold: -3, enabled: 1 });
    assert.equal(limiter.enabled, true);
    assert.equal(managers.pipelineManager.expandedPlugins.size, 4);
    assert.ok(calls.some(call => call[0] === 'consoleWarn' && String(call[1]).includes('Broken')));
    assert.ok(calls.some(call => call[0] === 'updatePipelineUI' && call[1] === true));
    assert.ok(calls.some(call => call[0] === 'updateWorkletPlugins'));
    assert.ok(calls.some(call => call[0] === 'saveState'));
  });
});

test('inserts before a non-section plugin and appends an end section without history', async () => {
  const manager = new PresetManager();
  manager.loadPresetData = async () => ({
    pipeline: [
      { name: 'Compressor', parameters: { ratio: 2 } }
    ]
  });

  await withPresetGlobals({ window: {} }, async ({ calls }) => {
    const endSection = createPlugin('Section', calls);
    const existing = { name: 'Output' };
    const managers = createPipelineManagers(calls, {
      pipeline: [existing],
      historyManager: false,
      sectionAvailability: [false, true],
      sectionCreateResults: [endSection]
    });
    globalThis.window.audioManager = managers.audioManager;
    globalThis.window.pluginManager = managers.pluginManager;
    globalThis.window.pipelineManager = managers.pipelineManager;

    await manager.addPresetToPipeline('Insert Chain', 0);

    assert.deepEqual(managers.audioManager.pipeline.map(plugin => plugin.name), [
      'Compressor',
      'Section',
      'Output'
    ]);
    assert.deepEqual(endSection.parameters, { cm: '' });
    assert.equal(managers.pipelineManager.expandedPlugins.size, 2);
    assert.equal(calls.some(call => call[0] === 'saveState'), false);
  });
});

test('skips end sections when inserting before a section plugin', async () => {
  const manager = new PresetManager();
  manager.loadPresetData = async () => ({
    pipeline: [
      { name: 'Analyzer', parameters: {} }
    ]
  });

  await withPresetGlobals({ window: {} }, async ({ calls }) => {
    const existingSection = { name: 'Section' };
    const managers = createPipelineManagers(calls, {
      pipeline: [existingSection],
      historyManager: false,
      sectionAvailability: [false]
    });
    globalThis.window.audioManager = managers.audioManager;
    globalThis.window.pluginManager = managers.pluginManager;
    globalThis.window.pipelineManager = managers.pipelineManager;

    await manager.addPresetToPipeline('Before Section', 0);

    assert.deepEqual(managers.audioManager.pipeline.map(plugin => plugin.name), [
      'Analyzer',
      'Section'
    ]);
    assert.equal(calls.filter(call => call[0] === 'isPluginAvailable').length, 1);
  });
});

test('continues when section labels cannot be created', async () => {
  const manager = new PresetManager();
  manager.loadPresetData = async () => ({
    pipeline: [
      { name: 'Filter', parameters: { frequency: 1000 } }
    ]
  });

  await withPresetGlobals({ window: {} }, async ({ calls }) => {
    const existing = { name: 'Output' };
    const managers = createPipelineManagers(calls, {
      pipeline: [existing],
      historyManager: false,
      sectionAvailability: [true, true],
      sectionCreateResults: [
        new Error('start section failed'),
        new Error('end section failed')
      ]
    });
    globalThis.window.audioManager = managers.audioManager;
    globalThis.window.pluginManager = managers.pluginManager;
    globalThis.window.pipelineManager = managers.pipelineManager;

    await manager.addPresetToPipeline('Warn Chain', 0);

    assert.deepEqual(managers.audioManager.pipeline.map(plugin => plugin.name), [
      'Filter',
      'Output'
    ]);
    assert.equal(calls.filter(call => call[0] === 'consoleWarn').length, 2);
  });
});

test('rejects invalid preset payloads and missing managers', async () => {
  const manager = new PresetManager();

  for (const data of [{}, { pipeline: {} }]) {
    manager.loadPresetData = async () => data;
    await withPresetGlobals({ window: {} }, async ({ calls }) => {
      await assert.rejects(
        () => manager.addPresetToPipeline('Bad Chain'),
        /Invalid preset data format/
      );
      assert.equal(calls[0][0], 'consoleError');
    });
  }

  manager.loadPresetData = async () => ({ pipeline: [] });

  const missingManagerCases = [
    { audioManager: null, pluginManager: {}, pipelineManager: {} },
    { audioManager: { pipeline: [] }, pluginManager: null, pipelineManager: {} },
    { audioManager: { pipeline: [] }, pluginManager: {}, pipelineManager: null }
  ];

  for (const windowRef of missingManagerCases) {
    await withPresetGlobals({ window: windowRef }, async ({ calls }) => {
      await assert.rejects(
        () => manager.addPresetToPipeline('Missing Managers'),
        /Required managers not available/
      );
      assert.equal(calls[0][0], 'consoleError');
    });
  }
});

