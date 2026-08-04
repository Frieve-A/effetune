import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { OfflineProcessor } from '../../js/audio/offline-processor.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginBaseSource = await fs.readFile(
  path.join(repoRoot, 'plugins', 'plugin-base.js'),
  'utf8'
);

// The four Lo-Fi codec simulators are WASM-only and declare supportedChannelModes,
// so the engine silently passes audio through whenever it cannot run them. Each
// one must therefore surface the bypass reason in its own UI.
const CODEC_SIMULATORS = [
  {
    file: path.join('plugins', 'lofi', 'mp3_codec_simulator.js'),
    globalName: 'MP3CodecSimulatorPlugin'
  },
  {
    file: path.join('plugins', 'lofi', 'bluetooth_sbc_simulator.js'),
    globalName: 'BluetoothSBCSimulatorPlugin'
  },
  {
    file: path.join('plugins', 'lofi', 'gsm_full_rate_simulator.js'),
    globalName: 'GSMFullRateSimulatorPlugin'
  },
  {
    file: path.join('plugins', 'lofi', 'g726_adpcm_simulator.js'),
    globalName: 'G726ADPCMSimulatorPlugin'
  }
];

const BYPASS_REASONS = [
  'unsupportedSampleRate',
  'unsupportedChannelMode',
  'wasmUnavailable',
  'rolloutDisabled',
  'runtimeFallback'
];

const pluginSources = new Map(await Promise.all(CODEC_SIMULATORS.map(async simulator => [
  simulator.globalName,
  await fs.readFile(path.join(repoRoot, simulator.file), 'utf8')
])));

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  add(...names) {
    const classes = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    for (const name of names) classes.add(name);
    this.owner.className = [...classes].join(' ');
  }

  contains(name) {
    return this.owner.className.split(/\s+/).includes(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.attributes = new Map();
    this.dataset = {};
    this.textContent = '';
    this.hidden = false;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }

  addEventListener(type, listener) {
    this[`on${type}`] = listener;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  querySelectorAll(selector) {
    const matches = element => (selector.startsWith('.')
      ? element.classList.contains(selector.slice(1))
      : element.tagName === selector.toUpperCase());
    const results = [];
    const visit = element => {
      for (const child of element.children) {
        if (matches(child)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

const fakeDocument = {
  body: new FakeElement('body'),
  documentElement: new FakeElement('html'),
  createElement: tagName => new FakeElement(tagName)
};

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

function loadCodecSimulator(globalName) {
  const window = {};
  const context = vm.createContext({
    window,
    document: fakeDocument,
    console,
    setTimeout,
    clearTimeout,
    MutationObserver: FakeMutationObserver,
    globalThis: null
  });
  context.globalThis = context;
  vm.runInContext(
    `${pluginBaseSource}\n;globalThis.PluginBase = PluginBase;`,
    context,
    { filename: 'plugin-base.js' }
  );
  vm.runInContext(pluginSources.get(globalName), context, { filename: globalName });
  const Plugin = window[globalName];
  assert.equal(typeof Plugin, 'function', `${globalName} was not registered on window`);
  const plugin = new Plugin();
  plugin.id = 7;
  return plugin;
}

function statusElement(container) {
  return container.querySelector('.plugin-execution-status');
}

function sendExecutionState(plugin, state, reason) {
  plugin.onMessage({
    type: 'dspExecutionState',
    pluginId: plugin.id,
    pluginType: plugin.constructor.name,
    validated: true,
    state,
    reason
  });
}

for (const { globalName } of CODEC_SIMULATORS) {
  test(`${globalName} tells the user why it was bypassed`, () => {
    for (const reason of BYPASS_REASONS) {
      const plugin = loadCodecSimulator(globalName);
      const container = plugin.createUI();
      const status = statusElement(container);
      assert.ok(status, `${globalName} must render an execution status element`);
      assert.equal(status.textContent, '', 'status starts empty while execution is pending');
      assert.equal(status.hidden, true);

      sendExecutionState(plugin, 'bypassed', reason);
      assert.notEqual(
        status.textContent,
        '',
        `${globalName} must explain the ${reason} bypass`
      );
      assert.equal(status.hidden, false);
      assert.match(status.textContent, new RegExp(`${plugin.name} is bypassed\\.`));
      assert.match(status.textContent, /Audio remains unchanged\./);
    }
  });

  test(`${globalName} shows no status text once it runs`, () => {
    const plugin = loadCodecSimulator(globalName);
    const container = plugin.createUI();
    const status = statusElement(container);

    sendExecutionState(plugin, 'bypassed', 'wasmUnavailable');
    assert.notEqual(status.textContent, '');

    sendExecutionState(plugin, 'active', null);
    assert.equal(status.textContent, '');
    assert.equal(status.hidden, true);
  });

  test(`${globalName} ignores execution states addressed to another plugin`, () => {
    const plugin = loadCodecSimulator(globalName);
    const container = plugin.createUI();
    const status = statusElement(container);

    plugin.onMessage({
      type: 'dspExecutionState',
      pluginId: plugin.id + 1,
      pluginType: plugin.constructor.name,
      validated: true,
      state: 'bypassed',
      reason: 'wasmUnavailable'
    });
    plugin.onMessage({
      type: 'dspExecutionState',
      pluginId: plugin.id,
      pluginType: plugin.constructor.name,
      validated: false,
      state: 'bypassed',
      reason: 'wasmUnavailable'
    });
    assert.equal(status.textContent, '');
  });
}

test('an unrecognised bypass reason leaves the status line silent', () => {
  const plugin = loadCodecSimulator('MP3CodecSimulatorPlugin');
  const container = plugin.createUI();
  const status = statusElement(container);

  sendExecutionState(plugin, 'bypassed', 'somethingElse');
  assert.equal(status.textContent, '');
  assert.equal(status.hidden, true);
});

// The same supportedChannelModes declaration that bypasses these plugins during
// playback has to bypass them during file export, or the exported file quietly
// stops matching what the user heard.
function runOfflineBlock(plugin, { blockSize = 4, outputChannelCount = 2 } = {}) {
  const processor = new OfflineProcessor();
  const inputBlock = new Float32Array(blockSize * outputChannelCount).fill(0.25);
  let processorRan = false;
  plugin.executeProcessor = (_context, data) => {
    processorRan = true;
    return data.map(() => 0.5);
  };
  const output = processor.processOfflineHybridBlock({
    session: null,
    pipeline: [plugin],
    inputBlock,
    sampleRate: 48000,
    outputChannelCount,
    blockSize,
    offset: 0,
    pluginContexts: new Map(),
    createContext: () => ({})
  });
  return { processorRan, input: Array.from(inputBlock), output: Array.from(output) };
}

for (const { globalName } of CODEC_SIMULATORS) {
  test(`${globalName} export matches playback for a declared channel mode`, () => {
    const plugin = loadCodecSimulator(globalName);
    plugin.channel = null;
    const { processorRan, output } = runOfflineBlock(plugin);
    assert.equal(processorRan, true, 'the stereo pair is declared, so it must be processed');
    assert.deepEqual(output, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  for (const channel of ['A', 'L', 'R', '2']) {
    test(`${globalName} export leaves audio unchanged on channel ${channel}`, () => {
      const plugin = loadCodecSimulator(globalName);
      plugin.channel = channel;
      const { processorRan, input, output } = runOfflineBlock(plugin);
      assert.equal(processorRan, false, `channel ${channel} is not a declared mode`);
      assert.deepEqual(output, input, 'a bypassed plugin must not alter the exported signal');
    });
  }
}
