import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginSource = await fs.readFile(
  path.join(repoRoot, 'plugins', 'basics', 'fir_crossover.js'),
  'utf8'
);
const channelDividerSource = await fs.readFile(
  path.join(repoRoot, 'plugins', 'basics', 'channel_divider.js'),
  'utf8'
);
const firCrossoverCss = await fs.readFile(
  path.join(repoRoot, 'plugins', 'basics', 'fir_crossover.css'),
  'utf8'
);
const channelDividerCss = await fs.readFile(
  path.join(repoRoot, 'plugins', 'basics', 'channel_divider.css'),
  'utf8'
);
const localeNames = ['ar', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'];
const localeSources = new Map(await Promise.all(localeNames.map(async locale => [
  locale,
  await fs.readFile(path.join(repoRoot, 'js', 'locales', `${locale}.json5`), 'utf8')
])));

function cssRule(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing CSS rule: ${selector}`);
  const bodyStart = source.indexOf('{', start) + 1;
  return source.slice(bodyStart, source.indexOf('}', bodyStart));
}

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

  toggle(name, force) {
    const present = this.contains(name);
    const enabled = force === undefined ? !present : Boolean(force);
    if (enabled) this.add(name);
    else this.owner.className = this.owner.className
      .split(/\s+/)
      .filter(value => value && value !== name)
      .join(' ');
    return enabled;
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
  }

  appendChild(child) {
    if (child.tagName === '#FRAGMENT') {
      for (const grandchild of [...child.children]) this.appendChild(grandchild);
      child.children = [];
      return child;
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  addEventListener(type, listener) {
    this[`on${type}`] = listener;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (selector === 'label' && current.tagName === 'LABEL') return current;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = element => {
      if (selector === 'input, select') {
        return element.tagName === 'INPUT' || element.tagName === 'SELECT';
      }
      if (selector === 'input') return element.tagName === 'INPUT';
      if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
      return element.tagName === selector.toUpperCase();
    };
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
  createElement: tagName => new FakeElement(tagName),
  createDocumentFragment: () => new FakeElement('#fragment'),
  createTextNode: text => {
    const node = new FakeElement('#text');
    node.textContent = String(text);
    return node;
  }
};

class PluginBase {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.enabled = true;
    this.id = 41;
    this.inputBus = null;
    this.outputBus = null;
    this.channel = null;
    this._wasmAssetOperationRevisions = new Map();
  }

  registerProcessor(source) {
    this.processorSource = source;
  }

  parseFiniteNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  updateParameters() {}

  getParameters() {
    return {
      type: this.constructor.name,
      id: this.id,
      enabled: this.enabled
    };
  }

  getSerializableParameters() {
    const { type, id, ...parameters } = this.getParameters();
    return parameters;
  }

  _setValidatedParameters(params) {
    if (params.enabled !== undefined) this.enabled = Boolean(params.enabled);
  }

  _nextWasmAssetOperationRevision(slot) {
    const revision = (this._wasmAssetOperationRevisions.get(slot) || 0) + 1;
    this._wasmAssetOperationRevisions.set(slot, revision);
    return revision;
  }

  _isCurrentWasmAssetOperation(slot, revision) {
    return this._wasmAssetOperationRevisions.get(slot) === revision;
  }

  setWasmAsset(slot, descriptor) {
    this.asset = { slot, descriptor };
    return this._nextWasmAssetOperationRevision(slot);
  }

  clearWasmAsset() {
    this.asset = null;
  }

  createRadioGroup(label, options, value, setter) {
    const row = fakeDocument.createElement('div');
    row.className = 'parameter-row radio-group';
    const heading = fakeDocument.createElement('label');
    heading.textContent = `${label}:`;
    row.appendChild(heading);
    options.forEach((option, index) => {
      const radio = fakeDocument.createElement('input');
      radio.type = 'radio';
      radio.id = `${this.id}-${label}-${index}`;
      radio.value = option.value;
      radio.checked = option.value === value;
      radio.addEventListener('change', event => {
        if (event.target.checked) setter(event.target.value);
      });
      const optionLabel = fakeDocument.createElement('label');
      optionLabel.htmlFor = radio.id;
      optionLabel.textContent = option.label;
      row.append(radio, optionLabel);
    });
    return row;
  }

  createSelectControl(label, options, value, setter) {
    const row = fakeDocument.createElement('div');
    row.className = 'parameter-row';
    const labelElement = fakeDocument.createElement('label');
    labelElement.textContent = `${label}:`;
    const select = fakeDocument.createElement('select');
    for (const option of options) {
      const optionElement = fakeDocument.createElement('option');
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      select.appendChild(optionElement);
    }
    select.value = value;
    select.addEventListener('change', event => setter(event.target.value));
    row.append(labelElement, select);
    return row;
  }

  createResponsiveGraph() {
    const container = fakeDocument.createElement('div');
    container.className = 'graph-container responsive-graph-container';
    const canvas = fakeDocument.createElement('canvas');
    container.appendChild(canvas);
    return { container, canvas, dispose() {} };
  }

  cleanup() {}
}

function loadPlugin({ channelCount = 8, sampleRate = 48000 } = {}) {
  const window = {
    workletNode: {
      channelCount,
      context: { sampleRate }
    }
  };
  const context = vm.createContext({
    PluginBase,
    window,
    document: fakeDocument,
    console,
    setTimeout,
    clearTimeout,
    globalThis: null
  });
  context.globalThis = context;
  vm.runInContext(pluginSource, context, { filename: 'fir_crossover.js' });
  return { Plugin: window.FIRCrossoverPlugin, context };
}

function loadChannelDividerPlugin() {
  const window = {};
  const context = vm.createContext({
    PluginBase,
    window,
    document: fakeDocument,
    console,
    globalThis: null
  });
  context.globalThis = context;
  vm.runInContext(channelDividerSource, context, { filename: 'channel_divider.js' });
  return window.ChannelDividerPlugin;
}

function installControlStubs(plugin) {
  const radios = [2, 3, 4].map(() => {
    const label = { disabled: false, classList: { toggle: (_name, value) => { label.disabled = value; } } };
    return {
      checked: false,
      disabled: false,
      closest: () => label,
      label
    };
  });
  const controls = [1, 2, 3].map(() => {
    const root = {
      disabled: false,
      classList: { toggle: (_name, value) => { root.disabled = value; } },
      querySelectorAll: () => []
    };
    return {
      root,
      number: { value: '' },
      range: { value: '' },
      slope: { value: '' }
    };
  });
  plugin._bandRadios = radios;
  plugin._crossoverControls = controls;
  return { radios, controls };
}

test('FIR Crossover exposes the requested FIR controls and steep slopes', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  assert.equal(plugin.pm, 'min');
  assert.equal(plugin.tp, 32768);
  assert.equal(plugin.lt, '128');
  assert.equal(plugin.bc, 2);
  plugin.setParameters({
    pm: 'lin',
    tp: 131072,
    lt: 0,
    bc: 4,
    f1: 100,
    f2: 1000,
    f3: 10000,
    s1: -384,
    s2: -288,
    s3: -192
  });
  assert.deepEqual(
    [plugin.pm, plugin.tp, plugin.lt, plugin.bc],
    ['lin', 131072, '0', 4]
  );
  assert.deepEqual(
    [plugin.f1, plugin.f2, plugin.f3, plugin.s1, plugin.s2, plugin.s3],
    [100, 1000, 10000, -384, -288, -192]
  );
  assert.equal(plugin.getParameters().fd, 65536);
  assert.match(pluginSource, /createRadioGroup\('Phase'/);
  assert.match(pluginSource, /-384/);
});

test('FIR filter design errors are translated in every locale', () => {
  for (const [locale, source] of localeSources) {
    assert.match(
      source,
      /"firCrossover\.error\.design"\s*:\s*"[^"]*Taps[^"]*"/,
      `Missing FIR Crossover design error in ${locale}`
    );
    assert.match(
      source,
      /"fiveBandFirPeq\.error\.design"\s*:\s*"[^"]*Taps[^"]*"/,
      `Missing 5Band FIR PEQ design error in ${locale}`
    );
  }
});

test('Channel Divider and FIR Crossover generate standard grouped frequency rows', () => {
  const ChannelDividerPlugin = loadChannelDividerPlugin();
  const channel = new ChannelDividerPlugin();
  const channelParent = fakeDocument.createElement('div');
  const channelRow = channel._createFreqControl(
    channelParent,
    'Freq 1',
    1,
    () => {},
    () => {},
    channel.f1,
    channel.s1
  );

  const { Plugin } = loadPlugin();
  const fir = new Plugin();
  fir._scheduleDesign = () => {};
  const firParent = fakeDocument.createElement('div');
  const firRow = fir._createCrossoverControl(firParent, 1).root;

  for (const row of [channelRow, firRow]) {
    assert.ok(row.classList.contains('parameter-row'));
    assert.deepEqual(
      row.children.map(child =>
        child.tagName === 'INPUT' ? `${child.tagName}:${child.type}` : child.tagName),
      ['LABEL', 'INPUT:range', 'INPUT:number', 'SELECT']
    );
    const [label, range, number, slope] = row.children;
    assert.equal(label.htmlFor, range.id);
    assert.equal(number.type, 'number');
    assert.ok(slope.classList.contains('slope-select'));
  }

  assert.doesNotMatch(channelDividerSource, /channel-divider-frequency-slider-top/);
  assert.doesNotMatch(pluginSource, /fir-crossover-control-top/);
  assert.doesNotMatch(channelDividerCss, /channel-divider-frequency-slider-top/);
  assert.doesNotMatch(firCrossoverCss, /fir-crossover-control-top/);
});

test('FIR Crossover settings use a three-column desktop grid and full phase labels', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  plugin.drawGraph = () => {};
  const ui = plugin.createUI();
  const settings = ui.children.find(child =>
    child.classList.contains('fir-crossover-settings'));

  assert.ok(settings);
  assert.equal(settings.children.length, 3);
  assert.ok(settings.children.every(child => child.classList.contains('parameter-row')));
  assert.deepEqual(
    settings.children[0].children
      .filter(child => child.tagName === 'LABEL')
      .map(label => label.textContent),
    ['Phase:', 'Minimum Phase', 'Linear Phase']
  );

  assert.match(
    cssRule(firCrossoverCss, '.fir-crossover-settings'),
    /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(
    cssRule(firCrossoverCss, 'body.layout-mobile .fir-crossover-settings'),
    /grid-template-columns:\s*1fr/
  );
});

test('FIR Crossover graph follows Channel Divider axes and curve conventions', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin.bc = 2;
  const labels = [];
  const strokes = [];
  const context = {
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    fillStyle: '',
    textAlign: '',
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      strokes.push({ color: this.strokeStyle, width: this.lineWidth });
    },
    fillText(text) {
      labels.push(String(text));
    },
    save() {},
    translate() {},
    rotate() {},
    restore() {}
  };
  plugin.canvas = {
    width: 600,
    height: 240,
    clientWidth: 600,
    getContext: () => context
  };

  plugin.drawGraph();

  assert.ok(labels.includes('Frequency (Hz)'));
  assert.ok(labels.includes('Level (dB)'));
  assert.ok(labels.includes('-48'));
  assert.ok(labels.includes('0'));
  assert.equal(strokes.filter(stroke => stroke.color === '#00ff00').length, plugin.bc);
  assert.ok(strokes.filter(stroke => stroke.color === '#00ff00')
    .every(stroke => stroke.width === 1.5));
});

test('FIR Crossover preserves inactive frequencies and orders them on activation', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  plugin.setParameters({ bc: 2, f1: 10000 });
  assert.deepEqual([plugin.f1, plugin.f2, plugin.f3], [10000, 4000, 8000]);

  plugin.setParameters({ bc: 3 });
  assert.deepEqual([plugin.f1, plugin.f2, plugin.f3], [10000, 10001, 8000]);
});

test('FIR Crossover clamps a 4-band preset to a known 4-channel output', () => {
  const { Plugin } = loadPlugin({ channelCount: 4 });
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  const { radios, controls } = installControlStubs(plugin);
  plugin.setParameters({ bc: 4 });

  assert.equal(plugin.bc, 2);
  assert.equal(plugin.getParameters().bc, 2);
  assert.equal(plugin._designConfig().bandCount, 2);
  assert.equal(plugin._bandMagnitudes(1000).length, 2);
  assert.equal(radios[0].checked, true);
  assert.equal(radios[1].disabled, true);
  assert.equal(radios[2].disabled, true);
  assert.equal(controls[0].root.disabled, false);
  assert.equal(controls[1].root.disabled, true);
  assert.equal(controls[2].root.disabled, true);
});

test('FIR Crossover reduces selected bands when output capacity shrinks from 8 to 4', () => {
  const { Plugin } = loadPlugin({ channelCount: 8 });
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  const { radios, controls } = installControlStubs(plugin);
  plugin.setParameters({ bc: 4 });
  assert.equal(plugin.bc, 4);
  assert.equal(radios[2].checked, true);
  assert.equal(controls[2].root.disabled, false);

  plugin._applyOutputChannelCount(4);
  assert.equal(plugin.bc, 2);
  assert.equal(plugin.getParameters().bc, 2);
  assert.equal(plugin._designConfig().bandCount, 2);
  assert.equal(plugin._bandMagnitudes(1000).length, 2);
  assert.equal(radios[0].checked, true);
  assert.equal(radios[2].disabled, true);
  assert.equal(controls[0].root.disabled, false);
  assert.equal(controls[1].root.disabled, true);
  assert.equal(controls[2].root.disabled, true);
});

test('FIR Crossover stages a matrix asset with one stereo path pair per band', async () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin.bc = 4;
  plugin.tp = 8192;
  plugin._outputChannelCount = 8;
  const pathCount = 8;
  const payload = new ArrayBuffer(32 + pathCount * 12 + plugin.bc * plugin.tp * 4);
  const result = { payload, bandCount: 4 };
  plugin._lastDesign = result;
  plugin._getRuntime = async () => ({
    IR_ASSET_TOPOLOGY: { matrix: 4 },
    estimateIrKernelCommitFootprint: () => payload.byteLength
  });
  assert.equal(await plugin._stageDesign(result), true);
  assert.equal(plugin.asset.slot, 0);
  assert.equal(plugin.asset.descriptor.pathCount, 8);
  assert.equal(plugin.asset.descriptor.inputCount, 2);
  assert.equal(plugin.asset.descriptor.processingChannels, 8);
  assert.equal(plugin.asset.descriptor.headBlock, 128);
  assert.equal(plugin.asset.descriptor.payload, payload);
});

test('FIR Crossover validates channel-count telemetry and bus band limits', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  for (const [channels, bands] of [[4, 2], [6, 3], [8, 4], [10, 4], [12, 4], [14, 4], [16, 4]]) {
    assert.equal(plugin._maximumBandCount(channels), bands);
  }
  for (const channels of [2, 3, 15, 17, 18]) assert.equal(plugin._maximumBandCount(channels), 0);
  const payload = new DataView(new ArrayBuffer(4));
  payload.setUint32(0, 6, true);
  assert.equal(plugin.parseDspChannelCountTelemetryFrame({
    frameType: 9,
    formatVersion: 1,
    payload
  }), 6);
  for (const channels of [16, 17]) {
    payload.setUint32(0, channels, true);
    assert.equal(plugin.parseDspChannelCountTelemetryFrame({ frameType: 9, formatVersion: 1, payload }),
      channels === 16 ? 16 : null);
  }
  plugin._applyOutputChannelCount(6);
  assert.equal(plugin.maxBands, 3);
  assert.equal(plugin._effectiveBandCount(), 2);
  assert.equal(plugin.parseDspChannelCountTelemetryFrame({
    frameType: 9,
    formatVersion: 2,
    payload
  }), null);
});

test('FIR Crossover prepares offline matrix assets for even output widths through sixteen', async () => {
  const { Plugin } = loadPlugin({ channelCount: 16 });
  const plugin = new Plugin();
  plugin.bc = 4;
  const payload = new ArrayBuffer(32);
  plugin._getRuntime = async () => ({
    IR_ASSET_TOPOLOGY: { matrix: 4 },
    estimateIrKernelCommitFootprint: () => 1024,
    createFIRCrossoverDesigner: () => ({ design: async () => ({ payload }), close() {} })
  });
  for (const outputChannelCount of [10, 12, 14, 16]) {
    const state = await plugin.createOfflineDspState({ sampleRate: 96000, outputChannelCount });
    assert.equal(state.offlineDspAssetRequired, true);
    assert.equal(state.assets.get(0).processingChannels, outputChannelCount);
    assert.equal(state.assets.get(0).pathCount, 8);
  }
});
