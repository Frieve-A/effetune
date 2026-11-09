import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

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
        options.onAppend?.(element, url);
        if (options.deferLoad) return;
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
    [0, 6, 13, 19, 25, 31, 38, 44, 50, 56, 63, 69, 75, 81, 88, 94, 100]
  );
  assert.deepEqual(harness.appended.filter(element => element.tagName === 'SCRIPT')
    .slice(0, 6).map(element => element.src),
  [
    'plugins/plugin-base.js',
    'plugins/graph-point-interaction.js',
    'plugins/frequency-axis.js',
    'plugins/spectrum-overlay.js',
    'plugins/frequency-preview.js',
    'plugins/graph-readout.js'
  ]);
  assert.ok(harness.appended.some(element => element.href === 'plugins/spectrum-overlay.css'));
  assert.ok(harness.appended.some(element => element.href === 'plugins/graph-readout.css'));
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

test('loadPlugins appends every resource before any load completes and keeps script order', async () => {
  const harness = createLoaderHarness({ pluginsText: PLUGINS_TEXT, deferLoad: true });
  await withGlobals(harness.globals, async () => {
    const manager = new PluginManager();
    let settled = false;
    const loading = manager.loadPlugins().then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));

    const scripts = harness.appended.filter(element => element.tagName === 'SCRIPT');
    assert.equal(harness.appended.length, scripts.length + 3);
    assert.ok(scripts.every(element => element.async === false));
    assert.deepEqual(scripts.slice(-4).map(element => element.src), [
      'plugins/compressor.js',
      'plugins/tone.js',
      'plugins/missing.js',
      'plugins/throwing.js'
    ]);
    assert.equal(scripts[0].src, 'plugins/plugin-base.js');
    assert.equal(settled, false);

    for (const element of harness.appended) element.onload();
    await loading;
  });
});

test('loadPlugins handles a missing UI manager and fetch-level failures', async () => {
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


test('both SFZ plugin definitions load after their shared base independently of sibling order', async () => {
  let sandbox;
  class PluginBase {
    constructor(name, description) { this.name = name; this.description = description; this.enabled = true; }
    registerProcessor() {}
    getParameters() { return { type: this.constructor.name, enabled: true }; }
  }
  const harness = createLoaderHarness({
    pluginsText: '[categories]\nOthers: Instruments\n[plugins]\nothers/soundfont_player: SoundFont Player|Others|SoundFontPlayerPlugin\nothers/sfz_note_player: SoundFont Note Player|Others|SFZNotePlayerPlugin',
    onAppend(element, url) {
      if (element.tagName !== 'SCRIPT' || (!url.includes('sfz') && !url.includes('soundfont'))) return;
      const source = fs.readFileSync(new URL('../../' + url, import.meta.url), 'utf8');
      vm.runInContext(source, sandbox, { filename: url });
    }
  });
  sandbox = vm.createContext({ PluginBase, window: harness.globals.window });
  const manager = new PluginManager();
  await withGlobals(harness.globals, async () => {
    await manager.loadPlugins();
    assert.equal(manager.createPlugin('SoundFont Player').constructor.name, 'SoundFontPlayerPlugin');
    assert.equal(manager.createPlugin('SoundFont Note Player').constructor.name, 'SFZNotePlayerPlugin');
  });
  const scripts = harness.appended.filter(element => element.tagName === 'SCRIPT').map(element => element.src);
  assert.ok(scripts.indexOf('plugins/sfz-instrument.js') < scripts.indexOf('plugins/others/soundfont_player.js'));
  const { SFZInstrumentPlugin, SoundFontPlayerPlugin, SFZNotePlayerPlugin } = harness.globals.window;
  assert.equal(Object.getPrototypeOf(SoundFontPlayerPlugin.prototype), SFZInstrumentPlugin.prototype);
  assert.equal(Object.getPrototypeOf(SFZNotePlayerPlugin.prototype), SFZInstrumentPlugin.prototype);
});
