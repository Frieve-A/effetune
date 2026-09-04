import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  prepareCrosstalkPlant,
  validateCrosstalkSources
} from '../../js/crosstalk-cancellation/design-core.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function elementStub() {
  return {
    addEventListener() {}, appendChild() {}, append() {}, remove() {}, replaceChildren() {},
    setAttribute() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: { setProperty() {} }, children: [], dataset: {}, options: [], value: '',
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

async function loadPlugin() {
  const document = {
    body: elementStub(), documentElement: elementStub(), visibilityState: 'visible',
    createElement: elementStub, getElementById() { return null; }, querySelector() { return null; },
    querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {}
  };
  const sandbox = {
    window: {}, document, console, structuredClone,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    setTimeout, clearTimeout, setInterval, clearInterval
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;
  const context = vm.createContext(sandbox);
  for (const file of ['plugins/plugin-base.js', 'plugins/spatial/crosstalk_cancellation.js']) {
    vm.runInContext(await fs.readFile(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  }
  return context.window.CrosstalkCancellationPlugin;
}

function designResult(config, payload = new ArrayBuffer(64)) {
  return {
    type: 'result',
    payload,
    config: { ...config, filterDelaySamples: config.taps / 2 },
    diagnostics: {
      maxGainDb: 10.25,
      maxGainLimitDb: config.maxGainDb,
      tapsWarning: false,
      lowFrequencyClamped: false,
      effectiveLowFrequency: config.lowFrequency
    }
  };
}

function measurementFixture(id, reference = 'audio-context') {
  return {
    id,
    measurement: { id: id.split('::ch=')[0], points: [{ id: 'point-1' }] },
    impulses: [{
      pointId: 'point-1', data: Float32Array.of(1, 0, 0, 0), sampleRate: 48000,
      onsetIndex: 1, trimStartSamples: 0, outputTimeReference: reference
    }]
  };
}

function alignedMeasurementFixture(id, trimStartSamples, onsetIndex, reference = 'audio-context') {
  const data = new Float32Array(384);
  data[onsetIndex] = 1;
  return {
    id,
    measurement: { id: id.split('::ch=')[0], points: [{ id: 'point-1' }] },
    impulses: [{
      pointId: 'point-1', data, sampleRate: 48000, onsetIndex, trimStartSamples,
      outputTimeReference: reference
    }]
  };
}

test('constructor is headless-safe and declares the WASM stereo-pair contract', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.deepEqual([...Plugin.executionCapabilities.supportedSampleRates],
    [44100, 48000, 88200, 96000, 176400, 192000]);
  assert.deepEqual([...Plugin.executionCapabilities.supportedChannelModes], ['stereo-pair']);
  assert.equal(Plugin.executionCapabilities.requiresWasm, true);
  assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');
  const audio = new Float32Array([1, -1]);
  assert.equal(plugin.process({}, audio), audio);
  let designerCloses = 0;
  let storeCloses = 0;
  let assetClears = 0;
  plugin._designer = { close() { designerCloses += 1; } };
  plugin._measurementStore = { close() { storeCloses += 1; } };
  plugin.clearWasmAsset = slot => { assert.equal(slot, 0); assetClears += 1; };
  plugin.cleanup();
  assert.equal(designerCloses, 1);
  assert.equal(storeCloses, 1);
  assert.equal(assetClears, 1);
});

test('state round-trip clamps IDs and derives fd from tp on every input path', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  const longId = `measurement::ch=${'x'.repeat(200)}`;
  plugin.setSerializedParameters({
    en: true, ll: longId, lr: 'right::ch=left', rl: 'left::ch=right', rr: 'right::ch=right',
    tp: 8192, rg: 31, mg: 9, fl: 180, fh: 7500, wl: 11, st: 62, og: -1.5, lt: '256',
    fd: 17
  });
  const state = plugin.getSerializableParameters();
  assert.equal(state.ll.length, 160);
  assert.equal(state.lr, 'right::ch=left');
  assert.equal(state.rl, 'left::ch=right');
  assert.equal(state.rr, 'right::ch=right');
  assert.equal(state.tp, 8192);
  assert.equal(state.fd, 4096);
  assert.equal(state.rg, 31);
  assert.equal(state.mg, 9);
  assert.equal(state.fl, 180);
  assert.equal(state.fh, 7500);
  assert.equal(state.wl, 11);
  assert.equal(state.st, 62);
  assert.equal(state.og, -1.5);
  assert.equal(state.lt, '256');
  plugin.setParameters({ fd: 1 });
  assert.equal(plugin.fd, 4096);
  plugin.cleanup();
});

test('design triggers distinguish redesign, runtime controls, latency resend, and sample-rate changes',
  async () => {
    const Plugin = await loadPlugin();
    const plugin = new Plugin();
    let designs = 0;
    let restages = 0;
    plugin._scheduleDesign = () => { designs += 1; };
    plugin._stageDesign = async () => { restages += 1; return true; };
    plugin._lastDesign = designResult(plugin._designConfig());

    plugin.setParameters({ st: 45, og: -3 });
    assert.equal(designs, 0);
    assert.equal(restages, 0);
    plugin.setParameters({ lt: '512' });
    assert.equal(designs, 0);
    assert.equal(restages, 1);
    plugin.setParameters({ tp: 2048 });
    assert.equal(designs, 1);
    assert.equal(plugin.fd, 1024);
    plugin.getParameters({ sampleRate: 96000, commitSampleRate: true });
    assert.equal(designs, 2);
    plugin.cleanup();
  });

test('fewer than four assignments clear the resident asset without starting a design', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  let clears = 0;
  plugin.clearWasmAsset = slot => { assert.equal(slot, 0); clears += 1; return 0; };
  plugin.ll = 'left::ch=left';
  plugin._scheduleDesign(0);
  assert.equal(clears, 1);
  assert.equal(plugin._designPending, false);
  assert.equal(plugin._lastDesign, null);
  plugin.cleanup();
});

test('measurement resolution preserves selected virtual IDs in the P1 source contract', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const ids = ['left::ch=left', 'right::ch=left', 'left::ch=right', 'right::ch=right'];
  const fixtures = new Map(ids.map(id => [id, measurementFixture(id)]));
  const store = {
    async getMeasurement(id) { return fixtures.get(id).measurement; },
    async getImpulseResponses(id) { return fixtures.get(id).impulses; }
  };
  const sources = await plugin._sourcesFor(store, ids);
  assert.deepEqual(Object.keys(sources), ['ll', 'lr', 'rl', 'rr']);
  assert.equal(sources.ll.id, ids[0]);
  assert.equal(sources.lr.id, ids[1]);
  assert.equal(sources.rl.id, ids[2]);
  assert.equal(sources.rr.id, ids[3]);
  plugin.cleanup();
});

test('store resolution preserves measured relative delays through plant preparation', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  const fixtures = [
    alignedMeasurementFixture('left::ch=left', 20, 10),
    alignedMeasurementFixture('right::ch=left', 41, 9),
    alignedMeasurementFixture('left::ch=right', 28, 8),
    alignedMeasurementFixture('right::ch=right', 34, 8)
  ];
  const records = new Map(fixtures.map(fixture => [fixture.id, fixture]));
  const store = {
    async getMeasurement(id) { return records.get(id).measurement; },
    async getImpulseResponses(id) { return records.get(id).impulses; }
  };
  const sources = await plugin._sourcesFor(store, fixtures.map(fixture => fixture.id));
  const plant = prepareCrosstalkPlant({
    config: {
      sampleRate: 48000, taps: 1024, regularization: 50, maxGainDb: 12,
      lowFrequency: 200, highFrequency: 6000, directWindowMs: 8
    },
    sources
  });
  assert.ok(Math.abs((plant.delays.rl - plant.delays.ll) - 6 / 48000) < 1e-12);
  assert.ok(Math.abs((plant.delays.lr - plant.delays.rr) - 8 / 48000) < 1e-12);
  const relativePhase = (first, second, bin) => Math.atan2(
    first.imag[bin] * second.real[bin] - first.real[bin] * second.imag[bin],
    first.real[bin] * second.real[bin] + first.imag[bin] * second.imag[bin]
  );
  const phaseGradient = (first, second) =>
    relativePhase(first, second, 40) - relativePhase(first, second, 20);
  assert.ok(Math.abs(
    phaseGradient(plant.spectra.rl, plant.spectra.ll) + 2 * Math.PI * 20 * 6 / plant.fftSize
  ) < 1e-6);
  assert.ok(Math.abs(
    phaseGradient(plant.spectra.lr, plant.spectra.rr) + 2 * Math.PI * 20 * 8 / plant.fftSize
  ) < 1e-6);
  plugin.cleanup();
});

test('source validation rejects old, multi-point, mismatched, duplicate, and timed-reference inputs',
  () => {
    const validSources = () => Object.fromEntries([
      alignedMeasurementFixture('left::ch=left', 20, 10),
      alignedMeasurementFixture('right::ch=left', 41, 9),
      alignedMeasurementFixture('left::ch=right', 28, 8),
      alignedMeasurementFixture('right::ch=right', 34, 8)
    ].map((fixture, index) => [['ll', 'lr', 'rl', 'rr'][index], fixture]));
    const rejects = (mutate, code) => {
      const sources = validSources();
      mutate(sources);
      assert.throws(() => validateCrosstalkSources(sources), error => error.code === code);
    };

    rejects(sources => { delete sources.ll.impulses[0].trimStartSamples; },
      'old-measurement-format');
    rejects(sources => { sources.ll.measurement.points.push({ id: 'point-2' }); },
      'multiple-measurement-points');
    rejects(sources => { sources.rl.id = 'other-session::ch=right'; },
      'left-ear-session-mismatch');
    rejects(sources => { sources.lr.id = sources.ll.id; },
      'duplicate-measurement-assignment');
    rejects(sources => { sources.ll.impulses[0].outputTimeReference = 'media-element'; },
      'media-element-time-reference');
    rejects(sources => { delete sources.ll.impulses[0].outputTimeReference; },
      'unknown-output-time-reference');
  });

test('unsupported output timing references map to actionable user messages', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  assert.match(plugin._designErrorMessage({ code: 'media-element-time-reference' }),
    /default or direct audio output.*measure again/i);
  assert.match(plugin._designErrorMessage({ code: 'unknown-output-time-reference' }),
    /supported output timing reference.*default or direct audio output/i);
  assert.match(plugin._designErrorMessage({ code: 'old-measurement-format' }), /old format/i);
  plugin.cleanup();
});

test('offline design errors resolve to user-facing text in every supported locale', async () => {
  const key = 'crosstalkCancellation.error.design';
  const locales = ['en', 'ja', 'zh', 'es', 'hi', 'ar', 'pt', 'ru', 'ko', 'fr'];
  for (const locale of locales) {
    const source = await fs.readFile(path.join(repoRoot, 'js', 'locales', `${locale}.json5`),
      'utf8');
    const entry = source.split(/\r?\n/)
      .find(line => line.trimStart().startsWith(`"${key}":`));
    const message = entry ? JSON.parse(`{${entry.replace(/,\s*$/, '')}}`)[key] : undefined;
    assert.equal(typeof message, 'string', `${locale}.json5 has no ${key}`);
    assert.notEqual(message.trim(), '', `${locale}.json5 has an empty ${key}`);
    assert.notEqual(message, key, `${locale}.json5 exposes the internal key`);
  }
});

test('online and offline assets use one identical external signature contract', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin.ll = 'left::ch=left';
  plugin.lr = 'right::ch=left';
  plugin.rl = 'left::ch=right';
  plugin.rr = 'right::ch=right';
  const config = plugin._designConfig();
  const onlineResult = designResult(config);
  const runtime = {
    IR_ASSET_TOPOLOGY: { trueStereo: 3 },
    estimateIrKernelCommitFootprint: () => 4096,
    createCrosstalkCancellationDesigner: () => ({
      design: async requested => designResult(requested),
      close() {}
    })
  };
  plugin._getRuntime = async () => runtime;
  plugin.setWasmAsset = (slot, descriptor) => {
    assert.equal(slot, 0);
    plugin._testLiveAsset = descriptor;
    return 1;
  };
  plugin._lastDesign = onlineResult;
  assert.equal(await plugin._stageDesign(onlineResult), true);
  const live = plugin._testLiveAsset;
  assert.equal(live.pathCount, 0);
  assert.equal(live.inputCount, 0);
  assert.equal(live.processingChannels, 2);

  const sources = {
    ll: measurementFixture(plugin.ll), lr: measurementFixture(plugin.lr),
    rl: measurementFixture(plugin.rl), rr: measurementFixture(plugin.rr)
  };
  const offline = await plugin.createOfflineDspState({
    sampleRate: 48000,
    offlineDspAssetRequirement: {
      required: true, generation: plugin._designGeneration, ids: plugin._slotIds(), sources
    }
  });
  const offlineAsset = offline.assets.get(0);
  assert.equal(offlineAsset.externalAssetSignature, live.externalAssetSignature);
  assert.equal(offline.parameters.fd, 2048);
  assert.equal(offlineAsset.warmupSamples, 2176);
  plugin.cleanup();
});

test('designer wrapper supersedes an older request and cleanup closes runtime resources', async () => {
  const { createCrosstalkCancellationDesigner } = await import(
    '../../js/crosstalk-cancellation/designer.js');
  const posted = [];
  let terminated = 0;
  const worker = {
    postMessage(message) { posted.push(message); },
    terminate() { terminated += 1; },
    onmessage: null,
    onerror: null
  };
  const designer = createCrosstalkCancellationDesigner({ workerFactory: () => worker });
  const first = designer.design({ taps: 1024 }, {});
  const second = designer.design({ taps: 2048 }, {});
  await assert.rejects(first, error => error.code === 'design-superseded');
  worker.onmessage({ data: {
    type: 'result', requestId: posted[1].requestId, payload: new ArrayBuffer(32),
    config: { taps: 2048, filterDelaySamples: 1024 }, diagnostics: {}
  } });
  assert.equal((await second).config.filterDelaySamples, 1024);
  designer.close();
  assert.equal(terminated, 1);
});

test('ear-group slots stay on one measurement and unusable entries are never offered', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  const channels = [
    { id: 'left-ear::ch=left', name: 'XTC L [Ch 1]', hasIr: true },
    { id: 'left-ear::ch=right', name: 'XTC L [Ch 2]', hasIr: true },
    { id: 'right-ear::ch=left', name: 'XTC R [Ch 1]', hasIr: true },
    { id: 'right-ear::ch=right', name: 'XTC R [Ch 2]', hasIr: true }
  ];
  plugin._measurementEntries = [
    ...channels,
    { id: 'single-speaker', name: 'XTC mono', hasIr: true },
    { id: 'no-ir::ch=left', name: 'No IR [Ch 1]', hasIr: false },
    { id: 'no-ir::ch=right', name: 'No IR [Ch 2]', hasIr: false }
  ];
  const options = [];
  plugin._measurementSelects.set('ll', {
    value: '',
    replaceChildren() { options.length = 0; },
    appendChild(option) { options.push(option); }
  });
  plugin._renderMeasurementOptions();
  // A single-channel measurement can never fill both slots of an ear group, so it
  // is not offered instead of failing the design after the fact.
  assert.deepEqual(options.map(option => option.value), ['', ...channels.map(entry => entry.id)]);

  // The canonical assignment: the L-speaker slot takes the lower output channel.
  assert.equal(plugin._partnerSlotAssignment('ll', 'left-ear::ch=left').rl, 'left-ear::ch=right');
  assert.equal(plugin._partnerSlotAssignment('rr', 'right-ear::ch=right').lr, 'right-ear::ch=left');

  // Whatever a slot is set to, its ear group follows onto that one measurement,
  // so the left/right-ear session mismatch cannot be produced from the UI.
  for (const slot of ['ll', 'lr', 'rl', 'rr']) {
    for (const entry of channels) {
      plugin.setParameters({ [slot]: entry.id, ...plugin._partnerSlotAssignment(slot, entry.id) });
      const pair = slot === 'll' || slot === 'rl' ? ['ll', 'rl'] : ['lr', 'rr'];
      const ids = pair.map(key => plugin[key]);
      assert.equal(plugin._baseMeasurementId(ids[0]), plugin._baseMeasurementId(entry.id));
      assert.equal(plugin._baseMeasurementId(ids[1]), plugin._baseMeasurementId(entry.id));
      assert.notEqual(ids[0], ids[1]);
    }
  }

  // An already consistent group is left untouched.
  plugin.setParameters({ ll: 'left-ear::ch=left', rl: 'left-ear::ch=right' });
  assert.equal(plugin._partnerSlotAssignment('ll', 'left-ear::ch=left'), null);
  assert.equal(plugin._partnerSlotAssignment('rl', 'left-ear::ch=right'), null);
  plugin.cleanup();
});

// A real <select> refuses a value that no option carries, so the stub has to do the
// same: an assignment the option list dropped must not look like a held selection.
function selectStub() {
  const options = [];
  let value = '';
  return {
    options,
    replaceChildren() { options.length = 0; },
    appendChild(option) { options.push(option); },
    get value() { return value; },
    set value(next) { value = options.some(option => option.value === next) ? next : ''; }
  };
}

function channelEntries() {
  return [
    { id: 'left-ear::ch=left', name: 'Left ear [Ch 1]', hasIr: true },
    { id: 'left-ear::ch=right', name: 'Left ear [Ch 2]', hasIr: true },
    { id: 'right-ear::ch=left', name: 'Right ear [Ch 1]', hasIr: true },
    { id: 'right-ear::ch=right', name: 'Right ear [Ch 2]', hasIr: true }
  ];
}

test('a concurrent design open leaves the measurement list on the one store', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  const entries = channelEntries();
  const selects = new Map(['ll', 'lr', 'rl', 'rr'].map(key => [key, selectStub()]));
  plugin._measurementSelects = selects;
  plugin.ll = 'left-ear::ch=left';
  plugin.rl = 'left-ear::ch=right';
  plugin.lr = 'right-ear::ch=left';
  plugin.rr = 'right-ear::ch=right';

  let opens = 0;
  let closes = 0;
  let release = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  // Every open is its own connection, exactly as the store client hands them out.
  plugin._getRuntime = async () => ({
    async openMeasurementStore() {
      opens += 1;
      await gate;
      return {
        async refresh() {},
        listMeasurements() { return entries; },
        close() { closes += 1; }
      };
    }
  });

  // The list refresh and the startup design both reach the store while it is opening.
  const listed = plugin._refreshMeasurements(false);
  const design = plugin._getMeasurementStore(true);
  release();
  const [, designStore] = await Promise.all([listed, design]);

  assert.equal(opens, 1);
  assert.equal(closes, 0);
  assert.equal(designStore, plugin._measurementStore);
  assert.equal(plugin._measurementsLoaded, true);
  for (const [key, select] of selects) assert.equal(select.value, plugin[key]);
  plugin.cleanup();
});

test('assignments applied before the list arrives are shown as loading, not missing', async () => {
  const Plugin = await loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  const select = selectStub();
  plugin._measurementSelects = new Map([['ll', select]]);

  // Restoring a pipeline sets the assignment while the store is still opening.
  plugin.setParameters({ ll: 'left-ear::ch=left' });
  assert.equal(select.value, 'left-ear::ch=left');
  assert.equal(select.options.at(-1).textContent, 'Loading measurements…');

  // Once the list is in, an assignment it does not carry is genuinely missing.
  plugin._measurementEntries = channelEntries();
  plugin._measurementsLoaded = true;
  plugin.setParameters({ ll: 'deleted::ch=left' });
  assert.equal(select.value, 'deleted::ch=left');
  assert.equal(select.options.at(-1).textContent, 'Measurement not found: deleted::ch=left');

  // And an assignment it does carry stays a real option.
  plugin.setParameters({ ll: 'left-ear::ch=right' });
  assert.equal(select.value, 'left-ear::ch=right');
  plugin.cleanup();
});
