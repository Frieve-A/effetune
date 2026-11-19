import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
const sources = ['plugins/plugin-base.js', 'plugins/fir-asset-eq.js', 'plugins/eq/headphone_eq.js']
  .map(relativePath => [relativePath, read(relativePath)]);
const GRID_SIZE = 241;

// Stand-in for the DOM nodes and editor the UI builds; it keeps the last listener per type.
const element = () => {
  const listeners = {};
  return {
    style: {}, dataset: {}, listeners, classList: { toggle() {}, remove() {} }, querySelectorAll: () => [],
    append() {}, appendChild() {}, replaceChildren() {}, setAttribute() {},
    addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener() {}
  };
};

// globals: extra realm globals such as fetch; created collects the elements the UI builds.
function loadPlugin(globals = {}, created = []) {
  const MutationObserver = class { observe() {} disconnect() {} };
  const editor = { createUI: element, dispose() {}, syncFrom() {}, updateMarkers() {} };
  const context = vm.createContext({
    window: { ...element(), RoomEqPlugin: { createAdditionalEqEditor: () => editor } },
    document: {
      body: element(),
      createElement: () => {
        const node = element();
        created.push(node);
        return node;
      }
    },
    MutationObserver, console, setTimeout, clearTimeout, URL, ...globals
  });
  context.window.window = context.window;
  for (const [filename, source] of sources) vm.runInContext(source, context, { filename });
  return context.window.HeadphoneEQPlugin;
}

// Builds the UI with stubbed controls and graph; returns the search field.
function createUI(plugin, created) {
  for (const name of ['createParameterControl', 'createLogarithmicParameterControl', 'createCheckboxControl']) {
    plugin[name] = element;
  }
  plugin._createFirControls = () => [];
  plugin.createResponsiveGraph = () => ({
    canvas: { ...element(), getContext: () => null }, container: element(), dispose() {}
  });
  plugin.createUI();
  return created.find(node => node.className === 'headphone-eq-search');
}

function createPlugin() {
  const Plugin = loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  return { Plugin, plugin };
}

// Runs designs through a stub designer and records their sources and staged assets.
// settle() waits for a scheduled design and acknowledges its asset as ready.
function stubDesign(plugin) {
  const designs = [];
  const staged = [];
  const designer = {
    design: async (config, designSources) => {
      designs.push(designSources);
      return { payload: new ArrayBuffer(32), previews: [] };
    },
    close() {}
  };
  plugin._getRuntime = async () => ({
    createRoomEqDesigner: () => designer,
    selectedIrChannelCount: () => 2,
    estimateIrKernelCommitFootprint: () => 64,
    IR_ASSET_TOPOLOGY: { mono: 1 }
  });
  plugin.setWasmAsset = (slot, descriptor) => staged.push(descriptor);
  plugin._isCurrentWasmAssetOperation = () => true;
  const settle = async () => {
    // Parameter changes design after a 150 ms debounce.
    for (let wait = 0; wait < 50 && plugin._candidateAssetRevision === null; wait += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.notEqual(plugin._candidateAssetRevision, null, 'a design was staged');
    plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);
  };
  return { designs, staged, settle };
}

// Grid index 120 lies at the geometric middle of 20 Hz-20 kHz.
const MIDDLE = 20 * Math.sqrt(1000);
// Arrays from the plugin realm compared as plain data.
const plain = value => JSON.parse(JSON.stringify(value));
const curve = value => Array.from({ length: GRID_SIZE }, (_, index) => value + index / 10);

test('Headphone EQ reads raw and target from an AutoEq result CSV', () => {
  const Plugin = loadPlugin();
  const header = 'frequency,raw,error,smoothed,error_smoothed,equalization,parametric_eq,' +
    'fixed_band_eq,equalized_raw,equalized_smoothed,target';
  const rows = [20, MIDDLE, 20000].map((frequency, index) =>
    [frequency, 1 + index, 9, 9, 9, 9, 9, 9, 9, 9, -index].join(','));
  const { response, target } = Plugin.parseResponseFile([header, ...rows].join('\r\n'));

  assert.equal(response.length, GRID_SIZE);
  assert.deepEqual([response[0], response[120], response[240]], [1, 2, 3]);
  assert.deepEqual([target[0], target[120], target[240]], [0, -1, -2]);

  // A target file prefers its target column and falls back to raw.
  assert.equal(Plugin.parseResponseFile([header, ...rows].join('\n'), 'target').response[240], -2);
  assert.equal(Plugin.parseResponseFile('frequency,raw\n20,4\n20000,4', 'target').response[0], 4);
});

test('Headphone EQ reads headerless text with mixed separators, comments, and unordered points', () => {
  const Plugin = loadPlugin();
  const text = [
    '* Exported measurement',
    '20000;6',
    `${MIDDLE}\t3`,
    '20 0',
    `${MIDDLE}, 99`,
    '# trailing comment'
  ].join('\n');
  const { response, target } = Plugin.parseResponseFile(text);

  assert.equal(target, null);
  assert.deepEqual([response[0], response[120], response[240]], [0, 3, 6]);
  // Between the points the level follows log frequency.
  assert.equal(response[60], 1.5);
});

test('Headphone EQ rejects files without a usable response', () => {
  const Plugin = loadPlugin();
  for (const text of [
    '',
    '  \n\n',
    '1000 0',
    '1000 0\n1500 1',
    '\u0000\u0001\u0002PK\u0003\u0004',
    'frequency,error\n20,0\n20000,0'
  ]) {
    assert.throws(() => Plugin.parseResponseFile(text), { name: 'Error' }, JSON.stringify(text));
  }
  assert.throws(() => Plugin.parseResponseFile('frequency,error\n20,0\n20000,0', 'target'));
});

test('Headphone EQ round-trips its state and ignores invalid curves', () => {
  const { Plugin, plugin } = createPlugin();
  plugin.setParameters({
    ca: 80, uf: 12000, mb: 3, sm: 0.33, ah: false, pm: 'lin', tp: 65536, lt: '256',
    ta1: 'ls', fa1: 250, ga1: -4, qa1: 1.5, ea3: false,
    mr: curve(1), mt: curve(0), mn: 'HD 600', tn: 'Harman'
  });
  const parameters = plugin.getParameters();

  const copy = new Plugin();
  copy._scheduleDesign = () => {};
  copy.setParameters(parameters);
  assert.deepEqual(copy.getParameters(), parameters);
  assert.equal(copy._externalAssetSignature(), plugin._externalAssetSignature());

  plugin.setParameters({ mr: curve(0).slice(1) });
  plugin.setParameters({ mr: [...curve(0).slice(1), Number.NaN] });
  plugin.setParameters({ ta1: 'hs', qa1: 9 });
  assert.deepEqual(plain(plugin.mr), curve(1));
  assert.equal(plugin.qa1, 2);
});

test('Headphone EQ leaves empty curves out of the saved state', () => {
  const { plugin } = createPlugin();
  const serialized = plugin.getSerializableParameters();
  for (const key of ['mr', 'mt', 'mn', 'tn']) assert.equal(key in serialized, false, key);

  plugin.setParameters({ mr: curve(1), mt: curve(0), mn: 'A', tn: 'B' });
  assert.equal(plugin.getSerializableParameters().mr.length, GRID_SIZE);
  // A saved state without curves clears the loaded ones.
  plugin.setSerializedParameters(serialized);
  assert.deepEqual(plain([plugin.mr, plugin.mt, plugin.mn, plugin.tn]), [[], [], '', '']);
});

test('Headphone EQ designs a pass-through filter until a target is loaded', () => {
  const { plugin } = createPlugin();
  const sourcesSeen = [];
  const designer = { design: (config, designSources) => sourcesSeen.push(designSources) };

  plugin.setParameters({ mr: curve(1), mn: 'HD 600' });
  plugin._design(designer, plugin._designConfig());
  assert.deepEqual(plain(sourcesSeen.at(-1)), [null]);

  const measurementOnly = plugin._externalAssetSignature();
  plugin.setParameters({ mt: curve(0), tn: 'Harman' });
  plugin._design(designer, plugin._designConfig());
  const [source] = sourcesSeen.at(-1);
  assert.equal(source.measurement.averageFrequencyResponse.length, GRID_SIZE);
  assert.ok(Math.abs(source.measurement.averageFrequencyResponse[5][1] - 1) < 1e-9);
  assert.notEqual(plugin._externalAssetSignature(), measurementOnly);

  const withTarget = plugin._externalAssetSignature();
  plugin.setParameters({ mr: curve(2) });
  assert.notEqual(plugin._externalAssetSignature(), withTarget);
});

test('Headphone EQ stages a pass-through filter at the set latency when its UI is created', async () => {
  const created = [];
  const plugin = new (loadPlugin({}, created))();
  const { designs, staged, settle } = stubDesign(plugin);
  createUI(plugin, created);
  await settle();

  assert.deepEqual(plain(designs), [[null]]);
  assert.equal(staged.length, 1);
  assert.equal(staged[0].headBlock, 128);
  assert.equal(plugin._statusMessage, 'Load a headphone measurement to start.');
});

test('Headphone EQ restages the pass-through filter at a new latency after a lone measurement', async () => {
  const plugin = new (loadPlugin())();
  const { designs, staged, settle } = stubDesign(plugin);
  plugin._scheduleDesign(0);
  await settle();
  await plugin._loadFile({ name: 'HD 600.txt', text: async () => '20 0\n20000 0' }, 'measurement');
  plugin.setParameters({ lt: '512' });
  await settle();
  assert.equal(designs.length, 1);
  assert.deepEqual(plain(staged.map(descriptor => descriptor.headBlock)), [128, 512]);
});

test('Headphone EQ status follows every parameter change, including unchanged design input', async () => {
  const plugin = new (loadPlugin())();
  const { staged, settle } = stubDesign(plugin);
  // The design staged when the UI is created.
  plugin._scheduleDesign(0);
  await settle();
  const load = (name, text, mode = 'measurement') => plugin._loadFile({ name, text: async () => text }, mode);
  const flat = '20 0\n20000 0';
  const status = () => plugin._statusMessage;

  // A measurement alone keeps the pass-through design.
  await load('HD 600.txt', flat);
  assert.equal(staged.length, 1);
  assert.equal(status(), 'Load a target curve to apply the correction.');
  await load('Harman.csv', 'frequency,raw\n20,0\n20000,0', 'target');
  await settle();
  assert.equal(status(), 'Correction for HD 600 toward Harman is ready.');
  // The same curve under another name.
  await load('HD 600 copy.txt', flat);
  assert.equal(status(), 'Correction for HD 600 copy toward Harman is ready.');

  // A failed read keeps the loaded data; reading the same file again recovers.
  await load('broken.txt', 'PK');
  assert.equal(plugin._statusState, 'error');
  await load('HD 600 copy.txt', flat);
  assert.equal(status(), 'Correction for HD 600 copy toward Harman is ready.');
  assert.equal(staged.length, 2);

  // Presets: measurement only, then no curves at all.
  plugin.setSerializedParameters({ mr: plugin.mr, mn: 'HD 600' });
  await settle();
  assert.equal(status(), 'Load a target curve to apply the correction.');
  plugin.setSerializedParameters({});
  assert.equal(status(), 'Load a headphone measurement to start.');
  assert.equal(staged.length, 3);

  // After a failed design, loading again retries it.
  plugin._failDesign('failed');
  await load('HD 600.txt', flat);
  await settle();
  assert.equal(status(), 'Load a target curve to apply the correction.');
  assert.equal(staged.length, 4);
});

test('Headphone EQ evaluates the target adjust at the current sample rate', () => {
  const { plugin } = createPlugin();
  const rates = [];
  plugin._adjustEditor = {
    _sampleRate: plugin._sampleRate,
    syncFrom(bands, sampleRate) { this._sampleRate = sampleRate; },
    calculateBandResponse() {
      rates.push(this._sampleRate);
      return 0;
    }
  };
  plugin.setParameters({ ga0: 3 });
  plugin.getParameters({ sampleRate: 96000, commitSampleRate: true });
  plugin._adjustCurve([1000]);
  assert.deepEqual(rates, [96000]);
});

test('Headphone EQ reads AutoEQ index entries', () => {
  const Plugin = loadPlugin();
  const entries = Plugin.parseAutoEqIndex([
    '# Index',
    'This is a list of all the headphones.',
    '- [1MORE Aero (ANC Off)](./HypetheSonics/GRAS%20RA0045%20in-ear/1MORE%20Aero%20(ANC%20Off)) ' +
      'by HypetheSonics on GRAS RA0045',
    '- [HD 650](./oratory1990/over-ear/HD%20650) by oratory1990 on GRAS 43AG-7',
    '- [HD 650](./oratory1990/over-ear/HD%20650%20copy) by oratory1990 on GRAS 43AG-7',
    '- [64 Audio A12t (m15 Apex module)](./oratory1990/in-ear/64%20Audio%20A12t%20(m15%20Apex%20module)) ' +
      'by oratory1990',
    '- [64 Audio A12t](./crinacle/Bruel%20&%20Kjaer%204620%20in-ear/64%20Audio%20A12t) by crinacle on ' +
      'Bruel & Kjaer 4620',
    '- [Broken](./nowhere'
  ].join('\r\n'));

  assert.deepEqual(plain(entries), [
    {
      label: '1MORE Aero (ANC Off) — HypetheSonics on GRAS RA0045',
      url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/HypetheSonics/' +
        'GRAS%20RA0045%20in-ear/1MORE%20Aero%20(ANC%20Off)/1MORE%20Aero%20(ANC%20Off).csv',
      name: '1MORE Aero (ANC Off) (HypetheSonics)'
    },
    {
      label: 'HD 650 — oratory1990 on GRAS 43AG-7',
      url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/' +
        'over-ear/HD%20650/HD%20650.csv',
      name: 'HD 650 (oratory1990)'
    },
    {
      label: '64 Audio A12t (m15 Apex module) — oratory1990',
      url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/in-ear/' +
        '64%20Audio%20A12t%20(m15%20Apex%20module)/64%20Audio%20A12t%20(m15%20Apex%20module).csv',
      name: '64 Audio A12t (m15 Apex module) (oratory1990)'
    }
  ]);
});

test('Headphone EQ turns GitHub page links into raw file links', () => {
  const Plugin = loadPlugin();
  const raw = 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/over-ear/HD%20650';
  assert.equal(Plugin.toRawUrl('https://github.com/jaakkopasanen/AutoEq/blob/master/results/oratory1990/' +
    'over-ear/HD%20650/HD%20650.csv'), `${raw}/HD%20650.csv`);
  assert.equal(Plugin.toRawUrl('https://github.com/jaakkopasanen/AutoEq/tree/master/results/oratory1990/' +
    'over-ear/HD%20650'), `${raw}/HD%20650.csv`);
  for (const url of [`${raw}/HD%20650.csv`, 'https://example.com/hd650.txt']) {
    assert.equal(Plugin.toRawUrl(url), url);
  }
});

test('Headphone EQ loads named text into the measurement and its target', async () => {
  const { plugin } = createPlugin();
  assert.equal(await plugin._loadText('frequency,raw,target\n20,90,1\n20000,90,1', 'HD 650 (oratory1990)',
    'measurement'), true);
  assert.deepEqual(plain([plugin.mn, plugin.tn, plugin.mr[0], plugin.mt[240]]),
    ['HD 650 (oratory1990)', 'HD 650 (oratory1990) target', 90, 1]);
  assert.equal(await plugin._loadText('PK', 'broken', 'measurement'), false);
  assert.equal(plugin.mn, 'HD 650 (oratory1990)');
});

test('Headphone EQ downloads the index once and loads a picked headphone', async () => {
  const requests = [];
  const index = '- [HD 650](./oratory1990/over-ear/HD%20650) by oratory1990 on GRAS 43AG-7';
  const missingUrl = 'https://example.com/missing.csv';
  const fetch = async url => {
    requests.push(url);
    if (url === missingUrl) return { ok: false, status: 404 };
    return { ok: true, text: async () => (url.endsWith('INDEX.md') ? index : 'frequency,raw\n20,80\n20000,80') };
  };
  const created = [];
  const plugin = new (loadPlugin({ fetch }, created))();
  plugin._scheduleDesign = () => {};
  const search = createUI(plugin, created);
  search.listeners.focus();
  search.listeners.focus();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests.length, 1);
  assert.equal(plugin._statusMessage, 'Load a headphone measurement to start.');

  // Partial input does nothing.
  search.value = 'HD 6';
  await search.listeners.change();
  assert.equal(requests.length, 1);

  search.value = 'HD 650 — oratory1990 on GRAS 43AG-7';
  await search.listeners.change();
  assert.equal(requests[1], 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/' +
    'over-ear/HD%20650/HD%20650.csv');
  assert.deepEqual(plain([plugin.mn, plugin.mr[0], search.value]), ['HD 650 (oratory1990)', 80, '']);

  // A failed download keeps the curves and the input.
  search.value = missingUrl;
  await search.listeners.change();
  assert.equal(plugin._statusState, 'error');
  assert.match(plugin._statusMessage, /could not be downloaded/);
  assert.deepEqual(plain([plugin.mn, search.value]), ['HD 650 (oratory1990)', missingUrl]);
});

test('Headphone EQ keeps the measurement started last when an earlier download finishes after it', async () => {
  const pending = {};
  const fetch = url => new Promise(resolve => {
    pending[url.includes('/A/') ? 'A' : 'B'] = level => resolve({ ok: true, text: async () =>
      `frequency,raw,target
20,${level},${level}
20000,${level},${level}` });
  });
  const plugin = new (loadPlugin({ fetch }))();
  plugin._scheduleDesign = () => {};
  const a = plugin._loadUrl('https://example.com/A/a.csv', 'A');
  const b = plugin._loadUrl('https://example.com/B/b.csv', 'B');
  pending.B(70);
  assert.equal(await b, true);
  pending.A(90);
  assert.equal(await a, false);
  assert.deepEqual(plain([plugin.mn, plugin.tn, plugin.mr[0], plugin.mt[0]]), ['B', 'B target', 70, 70]);
});

test('Headphone EQ clears an index failure when a later focus downloads the list', async () => {
  let fail = true;
  const fetch = async () => (fail ? { ok: false, status: 503 } : {
    ok: true, text: async () => '- [HD 650](./oratory1990/over-ear/HD%20650) by oratory1990'
  });
  const created = [];
  const plugin = new (loadPlugin({ fetch }, created))();
  plugin._scheduleDesign = () => {};
  const search = createUI(plugin, created);
  search.listeners.focus();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(plain([plugin._statusMessage.startsWith('The headphone list'), plugin._statusState]),
    [true, 'error']);

  fail = false;
  search.listeners.focus();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(plain([plugin._statusMessage, plugin._statusState]),
    ['Load a headphone measurement to start.', 'ready']);
});

test('Headphone EQ draws a lone measurement around 0 dB and the correction without headroom', () => {
  const { plugin } = createPlugin();
  plugin.setParameters({ mr: Array(GRID_SIZE).fill(86) });
  for (const value of plugin._graphCurves()[0][1]) assert.ok(Math.abs(value) < 1e-9);

  plugin.setParameters({ mt: curve(0) });
  plugin._adjustEditor = { _sampleRate: plugin._sampleRate, calculateBandResponse: () => 0 };
  plugin._lastDesign = {
    response: plugin._designConfig().response,
    previews: [{
      frequencies: [100, 1000], referenceLevelDb: 80, headroomDb: -3,
      measuredDb: [80, 80], baseCorrectionDb: [1, -2], predictedBaseDb: [80, 80]
    }]
  };
  assert.deepEqual(plain(plugin._graphCurves()[2][1]), [1, -2]);
});

test('Headphone EQ keeps the old design but draws the normalized measurement when another one is loaded', () => {
  const { plugin } = createPlugin();
  plugin._adjustEditor = { _sampleRate: plugin._sampleRate, calculateBandResponse: () => 0 };
  plugin.setParameters({ mr: Array(GRID_SIZE).fill(80), mt: curve(0) });
  const design = {
    response: plugin._designConfig().response,
    previews: [{
      frequencies: [100, 1000], referenceLevelDb: 80, headroomDb: 0,
      measuredDb: [90, 70], baseCorrectionDb: [-10, 10], predictedBaseDb: [80, 80]
    }]
  };
  plugin._lastDesign = design;
  plugin.setParameters({ ea0: !plugin.ea0 });
  assert.equal(plugin._graphCurves()[2][1].length, 2);

  plugin.setParameters({ mr: Array(GRID_SIZE).fill(86), mn: 'B', mt: Array(GRID_SIZE).fill(3), tn: 'B target' });
  assert.equal(plugin._lastDesign, design);
  const [measurement, , correction, corrected] = plugin._graphCurves();
  assert.equal(measurement[1].length, GRID_SIZE);
  for (const value of measurement[1]) assert.ok(Math.abs(value - 3) < 1e-9);
  assert.deepEqual(plain([correction, corrected]), [null, null]);
});
