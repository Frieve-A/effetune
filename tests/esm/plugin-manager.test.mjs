import assert from 'node:assert/strict';
import test from 'node:test';

import { PluginManager } from '../../js/plugin-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeLoadElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.src = '';
    this.href = '';
    this.rel = '';
    this.onload = null;
    this.onerror = null;
  }
}

function createLoaderHarness(options = {}) {
  const calls = [];
  const appended = [];
  const documentRef = {
    createElement(tagName) {
      calls.push(['createElement', tagName]);
      return new FakeLoadElement(tagName);
    },
    head: {
      appendChild(element) {
        appended.push(element);
        const url = element.src || element.href;
        calls.push(['appendChild', element.tagName, url]);
        if (options.throwOnAppend?.has(url)) {
          throw new Error(`append failed: ${url}`);
        }
        if (options.errorOnLoad?.has(url)) {
          element.onerror?.(new Error(`load failed: ${url}`));
        } else {
          element.onload?.();
        }
      }
    }
  };

  const windowRef = {
    uiManager: options.uiManager === false ? null : {
      updateLoadingProgress(percent) {
        calls.push(['progress', percent]);
      }
    },
    ...options.window
  };

  const nativeConsole = globalThis.console;

  return {
    calls,
    appended,
    globals: {
      document: documentRef,
      window: windowRef,
      fetch(url) {
        calls.push(['fetch', url]);
        if (options.fetchError) {
          throw options.fetchError;
        }
        return Promise.resolve({
          text() {
            calls.push(['text']);
            return Promise.resolve(options.pluginsText);
          }
        });
      },
      console: {
        ...nativeConsole,
        error(...args) {
          calls.push(['consoleError', ...args]);
        },
        warn(...args) {
          calls.push(['consoleWarn', ...args]);
        }
      }
    }
  };
}

const PLUGINS_TEXT = `
# comments and blank lines are ignored

[categories]
Dynamics: Dynamic range tools
EQ: Equalizers

[plugins]
compressor: Compressor|Dynamics|CompressorPlugin|css
tone: Tone|EQ|TonePlugin|
missing: Missing|EQ|MissingPlugin|
throwing: Throwing|EQ|ThrowingPlugin|
`;

test('availability, creation, and default parameter capture handle guard and error paths', async () => {
  const manager = new PluginManager();

  assert.equal(manager.isPluginAvailable('Compressor'), false);
  assert.equal(manager.isPluginAvailable(''), '');
  assert.equal(manager.isPluginAvailable(null), null);
  assert.equal(manager.isPluginAvailable(42), false);

  await withGlobals({
    console: {
      ...console,
      error() {},
      warn() {}
    }
  }, async () => {
    assert.throws(() => manager.createPlugin('Missing'), /not available/);
  });

  class TestPlugin {
    constructor() {
      this.name = 'Test Plugin';
    }

    getParameters() {
      return {
        type: 'internal',
        id: 999,
        enabled: true,
        inputBus: 0,
        outputBus: 1,
        channel: 'L',
        gain: 2,
        nested: { amount: 3 }
      };
    }
  }

  manager.pluginClasses.Compressor = TestPlugin;
  assert.equal(manager.isPluginAvailable('Compressor'), true);

  const plugin = manager.createPlugin('Compressor');
  assert.equal(plugin.id, 1);
  assert.deepEqual(plugin.defaultParameters, { gain: 2, nested: { amount: 3 } });
  assert.equal(manager.nextPluginId, 2);

  const noParameters = {};
  manager.captureDefaultParameters(noParameters);
  assert.deepEqual(noParameters.defaultParameters, {});

  const throwing = {
    name: 'Throwing',
    getParameters() {
      const cyclic = {};
      cyclic.self = cyclic;
      return cyclic;
    }
  };
  const warnCalls = [];
  await withGlobals({
    console: {
      ...console,
      warn(...args) {
        warnCalls.push(args);
      }
    }
  }, async () => {
    manager.captureDefaultParameters(throwing);
  });
  assert.deepEqual(throwing.defaultParameters, {});
  assert.equal(warnCalls.length, 1);
});

test('new plugins inherit the current power UI gate', async () => {
  const manager = new PluginManager();
  class VisualPlugin {
    constructor() {
      this.name = 'Visual';
      this.powerUiValues = [];
    }

    setPowerUiEnabled(value) {
      this.powerUiValues.push(value);
    }
  }
  manager.pluginClasses.Visual = VisualPlugin;

  await withGlobals({
    window: {
      audioManager: {
        powerPolicyController: {
          getDspUiActivityAllowed() { return false; }
        }
      }
    }
  }, async () => {
    const plugin = manager.createPlugin('Visual');
    assert.deepEqual(plugin.powerUiValues, [false]);
  });
});

test('parsePluginsDefinition builds category and plugin maps from supported sections', () => {
  const manager = new PluginManager();
  const { categories, pluginDefinitions } = manager.parsePluginsDefinition(PLUGINS_TEXT);

  assert.deepEqual(Object.keys(categories), ['Dynamics', 'EQ']);
  assert.deepEqual(categories.Dynamics, {
    description: 'Dynamic range tools',
    plugins: ['Compressor']
  });
  assert.deepEqual(categories.EQ.plugins, ['Tone', 'Missing', 'Throwing']);
  assert.deepEqual(pluginDefinitions.get('Compressor'), {
    path: 'plugins/compressor',
    category: 'Dynamics',
    className: 'CompressorPlugin',
    hasCSS: true
  });
  assert.equal(pluginDefinitions.get('Tone').hasCSS, false);
});

test('loadPlugins loads resources, tracks progress, registers classes, and tolerates failed files', async () => {
  const manager = new PluginManager();
  class CompressorPlugin {
    getParameters() {
      return { ratio: 4 };
    }
  }
  class TonePlugin {
    getParameters() {
      return { tone: 1 };
    }
  }

  const harness = createLoaderHarness({
    pluginsText: PLUGINS_TEXT,
    errorOnLoad: new Set(['plugins/tone.js', 'plugins/compressor.css']),
    window: {
      CompressorPlugin,
      TonePlugin
    }
  });
  Object.defineProperty(harness.globals.window, 'ThrowingPlugin', {
    configurable: true,
    get() {
      throw new Error('class getter failed');
    }
  });

  await withGlobals(harness.globals, async () => {
    const result = await manager.loadPlugins();
    assert.equal(result.pluginClasses.Compressor, CompressorPlugin);
    assert.equal(result.pluginClasses.Tone, TonePlugin);
    assert.equal(result.pluginClasses.Missing, undefined);
    assert.equal(result.effectCategories.EQ.plugins.length, 3);
  });

  assert.deepEqual(
    harness.calls.filter(call => call[0] === 'fetch'),
    [['fetch', 'plugins/plugins.txt']]
  );
  assert.ok(harness.calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Failed to load script')));
  assert.ok(harness.calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Failed to load CSS')));
  assert.ok(harness.calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Plugin class MissingPlugin not found')));
  assert.ok(harness.calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Failed to initialize plugin Throwing')));
  assert.deepEqual(
    harness.calls.filter(call => call[0] === 'progress').map(call => call[1]),
    [0, 17, 33, 50, 67, 83, 100]
  );
});

test('loadPlugins cache-busts dynamic resources on the development server', async () => {
  const manager = new PluginManager();
  class CompressorPlugin {
    getParameters() {
      return { ratio: 4 };
    }
  }

  const harness = createLoaderHarness({
    pluginsText: PLUGINS_TEXT,
    window: {
      EFFECTUNE_DEV_SERVER: true,
      CompressorPlugin
    }
  });

  class FixedDate extends Date {
    static now() {
      return 46655;
    }
  }

  await withGlobals({
    ...harness.globals,
    Date: FixedDate
  }, async () => {
    await manager.loadPlugins();
  });

  assert.deepEqual(
    harness.calls.filter(call => call[0] === 'fetch'),
    [['fetch', 'plugins/plugins.txt?dev=zzz']]
  );
  assert.ok(harness.calls.some(call => call[0] === 'appendChild' && call[2] === 'plugins/plugin-base.js?dev=zzz'));
  assert.ok(harness.calls.some(call => call[0] === 'appendChild' && call[2] === 'plugins/compressor.js?dev=zzz'));
  assert.ok(harness.calls.some(call => call[0] === 'appendChild' && call[2] === 'plugins/compressor.css?dev=zzz'));
});

test('loadPlugins catches base, JS batch, CSS batch, and fetch-level failures', async () => {
  await withGlobals(createLoaderHarness({
    pluginsText: PLUGINS_TEXT,
    throwOnAppend: new Set(['plugins/plugin-base.js'])
  }).globals, async () => {
    const manager = new PluginManager();
    await manager.loadPlugins();
  });

  const jsBatchHarness = createLoaderHarness({
    pluginsText: PLUGINS_TEXT,
    throwOnAppend: new Set(['plugins/tone.js'])
  });
  await withGlobals(jsBatchHarness.globals, async () => {
    const manager = new PluginManager();
    await manager.loadPlugins();
  });
  assert.ok(jsBatchHarness.calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error loading JS files')));

  const cssBatchHarness = createLoaderHarness({
    pluginsText: PLUGINS_TEXT,
    throwOnAppend: new Set(['plugins/compressor.css'])
  });
  await withGlobals(cssBatchHarness.globals, async () => {
    const manager = new PluginManager();
    await manager.loadPlugins();
  });
  assert.ok(cssBatchHarness.calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error loading CSS files')));

  const noUiHarness = createLoaderHarness({
    pluginsText: PLUGINS_TEXT,
    uiManager: false
  });
  await withGlobals(noUiHarness.globals, async () => {
    const manager = new PluginManager();
    await manager.loadPlugins();
  });
  assert.equal(noUiHarness.calls.some(call => call[0] === 'progress'), false);

  const fetchHarness = createLoaderHarness({
    pluginsText: '',
    fetchError: new Error('network failed')
  });
  await withGlobals(fetchHarness.globals, async () => {
    const manager = new PluginManager();
    await assert.rejects(() => manager.loadPlugins(), /network failed/);
  });
  assert.ok(fetchHarness.calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error loading plugins')));
});
