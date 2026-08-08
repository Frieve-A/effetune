import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import { readGoldenSet } from '../../tools/dsp-parity/golden-io.mjs';
import { XorShift64 } from '../../tools/dsp-parity/stimuli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'lofi', 'am_radio_simulator');

test('AM Radio Simulator freezes the parameter layout and representative parity matrix', async () => {
  const schemaPath = path.join(pluginRoot, 'params.json');
  const [schemaText, casesText] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(pluginRoot, 'cases.json'), 'utf8')
  ]);
  const raw = JSON.parse(schemaText);
  const schema = validateParamSpec(raw, schemaPath);
  const cases = JSON.parse(casesText).cases;

  assert.equal(schema.type, 'AMRadioSimulatorPlugin');
  assert.equal(schema.floatCount, 21);
  assert.deepEqual(raw.fields.map(({ key }) => key),
    ['rd', 'tb', 'pe', 'md', 'cp', 'sm', 'sg', 'sk', 'fd', 'st', 'in', 'io',
      'tn', 'bw', 'ag', 'dt', 'hm', 'hz', 'sp', 'og', 'mx']);
  assert.deepEqual(raw.fields.find(field => field.key === 'sm').values, ['Mono', 'C-QUAM']);
  assert.deepEqual(raw.fields.find(field => field.key === 'ag').values, ['Slow', 'Mid', 'Fast']);
  assert.deepEqual(raw.fields.find(field => field.key === 'hz').values, ['50', '60']);
  assert.deepEqual(raw.fields.find(field => field.key === 'sp').values, ['Off', 'Small', 'Table']);
  assert.deepEqual(
    Object.fromEntries(['min', 'max'].map(key =>
      [key, raw.fields.find(field => field.key === 'tn')[key]])),
    { min: -30, max: 30 });

  assert.equal(cases.length, 21);
  assert.ok(cases.every(item => item.params?.fr === true));
  // The transmitter switch must stay frozen in both directions, and the case
  // has to start with the carrier off: the cold-start branch that seeds the AGC
  // from a dead carrier only runs on the first block, so a case that starts on
  // never reaches it and the branch would go unrendered.
  const radioCase = cases.find(item => item.id === 'radio-startup-and-shutdown');
  assert.equal(radioCase.params.rd, false);
  assert.deepEqual(radioCase.events.map(event => [event.frame, event.params.rd]),
    [[129, true], [321, false]]);
  assert.ok(cases.some(item => item.sampleRate === 44100 && item.channels === 1));
  assert.ok(cases.some(item => item.sampleRate === 48000));
  assert.ok(cases.some(item => item.sampleRate === 192000));
  assert.ok(cases.some(item => item.blockSize === 1));
  assert.ok(cases.some(item => item.channels === 4 && item.channelMode === 'all4'));
  assert.ok(cases.some(item => item.events?.some(event => event.params.sp)));
  assert.ok(cases.some(item => item.params.sm === 'C-QUAM'));
  assert.ok(cases.some(item => item.events?.some(event => event.params.sm === 'C-QUAM')));
  assert.ok(cases.some(item => item.params.md === 125 && item.params.dt === 20));
  assert.ok(cases.some(item => item.params.tn === 30));
  // A mid-case Static Rate step covers the pending-deadline rescale path.
  assert.ok(cases.some(item =>
    item.params.st === 0.125 && item.events?.some(event => event.params.st === 100)));
  assert.deepEqual(
    Object.fromEntries(['stimulus', 'sampleRate', 'frames'].map(key => [key, cases[14][key]])),
    { stimulus: 'noise', sampleRate: 48000, frames: 40001 }
  );

  // The goldens must be regenerated whenever the JS reference engine changes, so pin the
  // recorded engine hash: a stale golden set fails here instead of silently passing parity.
  const goldens = await readGoldenSet(path.join(pluginRoot, 'golden'));
  assert.equal(goldens.length, 21);
  assert.ok(goldens.every(item =>
    item.metadata.jsEngineHash ===
      'bd11b599a0a95ec78f19832e1dcd426e2848d3bd9122ad7d1918138efa9c78a5'
  ));
});

test('AM Radio Simulator reference is deterministic tooling while normal fallback is transparent', async () => {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'am_radio_simulator.js'), 'utf8');
  class PluginBase {
    constructor() {
      this.enabled = true;
      this.id = 11;
    }
    registerProcessor(processor) { this.processorString = processor; }
    updateParameters() {}
    getSerializableParameters() { return this.getParameters(); }
    getWorkletPluginData(parameters) { return parameters; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
    }
  }
  const context = {
    PluginBase,
    performance: { now: () => 1000 },
    window: { dspTelemetryHub: null }
  };
  vm.runInNewContext(source, context);
  const plugin = new context.window.AMRadioSimulatorPlugin();
  const serializable = plugin.getSerializableParameters();
  const runtime = plugin.getWorkletPluginData(plugin.getParameters());
  const defaultKeys = ['tb', 'pe', 'md', 'cp', 'sm', 'sg', 'sk', 'fd', 'st', 'in', 'io',
    'tn', 'bw', 'ag', 'dt', 'hm', 'hz', 'sp', 'og', 'mx'];
  assert.deepEqual(Object.fromEntries(defaultKeys.map(key => [key, serializable[key]])), {
    tb: 6, pe: 50, md: 90, cp: 6, sm: 'Mono', sg: -12, sk: 1, fd: 0.15, st: 0.3, in: -65, io: 9,
    tn: 0, bw: 12, ag: 'Fast', dt: 50, hm: -70, hz: '50', sp: 'Table', og: 0, mx: 100
  });
  assert.equal('fr' in serializable, false);
  assert.equal('fr' in runtime, false);
  plugin.setParameters({ tn: 100 });
  assert.equal(plugin.tn, 30);
  plugin.setParameters({ tn: -100 });
  assert.equal(plugin.tn, -30);

  const parameters = {
    ...plugin.getParameters(),
    sampleRate: 48000,
    blockSize: 4,
    channelCount: 1
  };
  const audio = new Float32Array([0.25, -0.5, 0.75, -1]);
  const expected = [...audio];
  const processor = new Function('data', 'parameters', 'context', plugin.processorString);
  const result = processor(audio, parameters, {});
  assert.deepEqual([...result], expected);
  assert.deepEqual(result.measurements, { bypass: true });

  const maximumGainParameters = {
    ...plugin.getParameters(), fr: true, enabled: true, sg: -50,
    sampleRate: 48000, blockSize: 1, channelCount: 1
  };
  const maximumGainResult = processor(
    new Float32Array(1), maximumGainParameters, { __seededRandom: () => 0.5 });
  assert.equal(maximumGainResult.measurements.agcGainDb, 42);

  const renderSeed = seed => {
    const rng = new XorShift64(BigInt(seed));
    const source = new Float32Array(128);
    for (let frame = 0; frame < source.length; frame++) {
      source[frame] = Math.sin(frame * 0.071) * 0.3;
    }
    return [...processor(source, {
      ...plugin.getParameters(), fr: true, enabled: true,
      sampleRate: 48000, blockSize: 128, channelCount: 1
    }, { __seededRandom: () => rng.nextFloat() })];
  };
  const seededRuns = [1, 2, 3, 4, 5].map(renderSeed);
  assert.notDeepEqual(seededRuns[0], seededRuns[1]);
  assert.notDeepEqual(seededRuns[1], seededRuns[2]);
  assert.notDeepEqual(seededRuns[3], seededRuns[4]);

  const render384k = sm => {
    const referenceContext = { __seededRandom: () => 0.314159265 };
    const referenceParameters = {
      ...plugin.getParameters(), fr: true, enabled: true, sm,
      sampleRate: 384000, blockSize: 128, channelCount: 2
    };
    const rendered = [];
    let measurements = null;
    for (let offset = 0; offset < 1024; offset += 128) {
      const block = new Float32Array(256);
      for (let frame = 0; frame < 128; frame++) {
        block[frame] = Math.sin((offset + frame) * 0.071) * 0.3;
        block[128 + frame] = Math.cos((offset + frame) * 0.037) * 0.2;
      }
      const output = processor(block, referenceParameters, referenceContext);
      rendered.push(...output);
      measurements = output.measurements;
    }
    return { rendered, measurements };
  };
  const mono384k = render384k('Mono');
  const cquam384k = render384k('C-QUAM');
  assert.deepEqual(cquam384k.rendered, mono384k.rendered);
  assert.equal(cquam384k.rendered.every(Number.isFinite), true);
  assert.equal(cquam384k.measurements.stereoBlend, 0);

  const transitionedContext = { __seededRandom: () => 0.271828182 };
  const continuousContext = { __seededRandom: () => 0.271828182 };
  const monoParameters = {
    ...plugin.getParameters(), fr: true, enabled: true, sm: 'Mono',
    sampleRate: 96000, blockSize: 128, channelCount: 2
  };
  for (let offset = 0; offset < 1024; offset += 128) {
    const block = new Float32Array(256);
    for (let frame = 0; frame < 128; frame++) {
      block[frame] = Math.sin((offset + frame) * 0.043) * 0.25;
      block[128 + frame] = Math.cos((offset + frame) * 0.029) * 0.2;
    }
    processor(block.slice(), monoParameters, transitionedContext);
    processor(block.slice(), monoParameters, continuousContext);
  }
  const transitionSample = new Float32Array([0.125, -0.25]);
  const cquamParameters = { ...monoParameters, sm: 'C-QUAM', blockSize: 1 };
  const singleMonoParameters = { ...monoParameters, blockSize: 1 };
  const transitionedSample = processor(
    transitionSample.slice(), cquamParameters, transitionedContext);
  const continuousSample = processor(
    transitionSample.slice(), singleMonoParameters, continuousContext);
  assert.deepEqual([...transitionedSample], [...continuousSample]);
});

test('AM Radio Simulator parses only finite telemetry v1 and v2 frames with exact payloads', async () => {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'am_radio_simulator.js'), 'utf8');
  class PluginBase {
    constructor() { this.enabled = true; this.id = 17; }
    registerProcessor() {}
  }
  const context = { PluginBase, performance: { now: () => 1000 }, window: {} };
  vm.runInNewContext(source, context);
  const plugin = new context.window.AMRadioSimulatorPlugin();
  const v1Payload = new DataView(new ArrayBuffer(24));
  v1Payload.setFloat32(0, -35, true);
  v1Payload.setFloat32(4, 18, true);
  v1Payload.setFloat32(8, 92, true);
  v1Payload.setFloat32(12, -7, true);
  v1Payload.setUint32(16, 3, true);
  v1Payload.setUint32(20, 5, true);
  assert.deepEqual(
    { ...plugin.parseDspTelemetryFrame({ frameType: 17, formatVersion: 1, payload: v1Payload }) },
    { carrierPreAgcDb: -35, agcGainDb: 18, modPercent: 92, fadeDb: -7,
      staticCount: 3, clipCount: 5 }
  );

  const v2Payload = new DataView(new ArrayBuffer(28));
  v2Payload.setFloat32(0, -28, true);
  v2Payload.setFloat32(4, 12, true);
  v2Payload.setFloat32(8, 88, true);
  v2Payload.setFloat32(12, -4, true);
  v2Payload.setFloat32(16, 0.75, true);
  v2Payload.setUint32(20, 7, true);
  v2Payload.setUint32(24, 11, true);
  assert.deepEqual(
    { ...plugin.parseDspTelemetryFrame({ frameType: 17, formatVersion: 2, payload: v2Payload }) },
    { carrierPreAgcDb: -28, agcGainDb: 12, modPercent: 88, fadeDb: -4,
      staticCount: 7, clipCount: 11, stereoBlend: 0.75 }
  );

  assert.equal(plugin.parseDspTelemetryFrame({
    frameType: 16, formatVersion: 2, payload: v2Payload
  }), null);
  assert.equal(plugin.parseDspTelemetryFrame({
    frameType: 17, formatVersion: 3, payload: v2Payload
  }), null);
  assert.equal(plugin.parseDspTelemetryFrame({
    frameType: 17, formatVersion: 1, payload: new DataView(new ArrayBuffer(20))
  }), null);
  assert.equal(plugin.parseDspTelemetryFrame({
    frameType: 17, formatVersion: 1, payload: new DataView(new ArrayBuffer(28))
  }), null);
  assert.equal(plugin.parseDspTelemetryFrame({
    frameType: 17, formatVersion: 2, payload: new DataView(new ArrayBuffer(24))
  }), null);
  assert.equal(plugin.parseDspTelemetryFrame({
    frameType: 17, formatVersion: 2, payload: new DataView(new ArrayBuffer(32))
  }), null);

  for (const offset of [0, 4, 8, 12, 16]) {
    const invalid = new DataView(v2Payload.buffer.slice(0));
    invalid.setFloat32(offset, offset === 16 ? Number.POSITIVE_INFINITY : Number.NaN, true);
    assert.equal(plugin.parseDspTelemetryFrame({
      frameType: 17, formatVersion: 2, payload: invalid
    }), null);
  }
  const invalidV1 = new DataView(v1Payload.buffer.slice(0));
  invalidV1.setFloat32(0, Number.NaN, true);
  assert.equal(plugin.parseDspTelemetryFrame({
    frameType: 17, formatVersion: 1, payload: invalidV1
  }), null);
});

test('AM Radio Simulator drives the HUD stereo lamp from subscribed v2 telemetry', async () => {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'am_radio_simulator.js'), 'utf8');
  let subscription = null;
  class PluginBase {
    constructor() { this.enabled = true; this.id = 17; }
    registerProcessor() {}
    canRunAnimation() { return true; }
  }
  const context = {
    PluginBase,
    performance: { now: () => 1000 },
    window: {
      dspTelemetryHub: {
        subscribe(tapId, frameType, callback) {
          subscription = { tapId, frameType, callback };
          return () => {};
        }
      }
    }
  };
  vm.runInNewContext(source, context);
  const plugin = new context.window.AMRadioSimulatorPlugin();
  assert.equal(plugin.ensureDspTelemetrySubscription(), true);
  assert.deepEqual({ tapId: subscription.tapId, frameType: subscription.frameType }, {
    tapId: 17, frameType: 17
  });

  const payload = new DataView(new ArrayBuffer(28));
  payload.setFloat32(0, -28, true);
  payload.setFloat32(4, 12, true);
  payload.setFloat32(8, 88, true);
  payload.setFloat32(12, -4, true);
  payload.setFloat32(16, 0.75, true);
  payload.setUint32(20, 7, true);
  payload.setUint32(24, 11, true);
  subscription.callback({ frameType: 17, formatVersion: 2, payload });
  assert.equal(plugin.hudValues.stereoBlend, 0.75);

  const lampState = { blend: null, active: false, label: null };
  plugin.stereoLamp = {
    style: { setProperty: (name, value) => { if (name === '--stereo-blend') lampState.blend = value; } },
    classList: { toggle: (name, value) => { if (name === 'active') lampState.active = value; } },
    setAttribute: (name, value) => { if (name === 'aria-label') lampState.label = value; }
  };
  const drawn = [];
  const fills = [];
  const drawingContext = {
    clearRect() {},
    fillRect(...args) { fills.push({ style: this.fillStyle, args }); },
    strokeRect() {},
    fillText: text => drawn.push(String(text))
  };
  plugin.hudCanvas = {
    width: 600,
    height: 120,
    clientWidth: 600,
    getContext: () => drawingContext
  };
  plugin.executionState = { state: 'active', reason: null };
  plugin.drawHud();
  assert.deepEqual(lampState, {
    blend: '0.75', active: true, label: 'Stereo reception on'
  });
  assert.ok(drawn.includes('S4.1'));
  const meterTracks = fills.filter(fill => fill.style === '#363636');
  const meterLevels = fills.filter(fill => fill.style === '#69c8ff');
  assert.equal(meterTracks.length, 4);
  assert.equal(meterLevels.length, 4);
  assert.ok(Math.abs(meterLevels[0].args[2] / meterTracks[0].args[2] - 22 / 56) < 1e-12);
  assert.ok(Math.abs(meterLevels[2].args[2] / meterTracks[2].args[2] - 88 / 160) < 1e-12);

  fills.length = 0;
  plugin.eventFlashUntil = 1180;
  plugin.drawHud();
  const eventTrack = fills.filter(fill => fill.style === '#363636')[3];
  const eventLevel = fills.find(fill => fill.style === '#ffb347');
  assert.ok(eventLevel);
  assert.ok(Math.abs(eventLevel.args[2] / eventTrack.args[2] - 76 / 86) < 1e-12);
  for (const state of ['bypassed', 'pending']) {
    plugin.executionState = { state, reason: state === 'bypassed' ? 'wasmUnavailable' : null };
    plugin.drawHud();
    assert.deepEqual(lampState, {
      blend: '0', active: false, label: 'Stereo reception off'
    });
  }
});

test('AM Radio Simulator follows validated pending, active, and bypassed execution states', async () => {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'am_radio_simulator.js'), 'utf8');
  class PluginBase {
    constructor() { this.enabled = true; this.id = 23; }
    registerProcessor() {}
  }
  const context = { PluginBase, performance: { now: () => 1000 }, window: {} };
  vm.runInNewContext(source, context);
  const plugin = new context.window.AMRadioSimulatorPlugin();
  assert.equal(plugin.executionState.state, 'pending');
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 23,
    state: 'bypassed', reason: 'wasmUnavailable'
  });
  assert.equal(plugin.executionState.state, 'pending');
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 23, validated: true,
    state: 'active', reason: null
  });
  assert.equal(plugin.executionState.state, 'active');
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 23, validated: true,
    state: 'bypassed', reason: 'wasmUnavailable'
  });
  assert.deepEqual({ ...plugin.executionState }, {
    state: 'bypassed', reason: 'wasmUnavailable'
  });
});

test('AM Radio Simulator remains supported at 384 kHz without relaxing Room EQ', async () => {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'audio-processor.js'), 'utf8');
  let ProcessorClass = null;
  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  }
  vm.runInNewContext(source, {
    ArrayBuffer,
    DataView,
    Float32Array,
    Map,
    Set,
    Uint8Array,
    AudioWorkletProcessor,
    console: { log() {}, warn() {}, error() {} },
    sampleRate: 384000,
    registerProcessor(name, constructor) {
      if (name === 'plugin-processor') ProcessorClass = constructor;
    }
  });
  const processor = new ProcessorClass({
    processorOptions: { initialOutputChannelCount: 2, lowLatencyMode: false }
  });
  processor.dspEnableTypesReceived = true;
  processor.dspEnabledTypes = new Set(['AMRadioSimulatorPlugin', 'RoomEqPlugin']);
  processor.dspLive = true;
  processor.wasmKernels = new Map([
    ['AMRadioSimulatorPlugin', {}],
    ['RoomEqPlugin', {}]
  ]);
  processor.wasmInstances = new Map([
    [17, { ready: true }],
    [18, { ready: true }]
  ]);

  assert.deepEqual(
    { ...processor.wasmOnlyExecutionState({
      id: 17,
      type: 'AMRadioSimulatorPlugin',
      executionCapabilities: { requiresWasm: true }
    }) },
    { state: 'active', reason: null }
  );
  assert.deepEqual(
    { ...processor.wasmOnlyExecutionState({
      id: 18,
      type: 'RoomEqPlugin',
      executionCapabilities: {
        requiresWasm: true,
        supportedSampleRates: [48000]
      }
    }) },
    { state: 'bypassed', reason: 'unsupportedSampleRate' }
  );
});

test('AM Radio Simulator integration keeps fixed anti-alias stages and accessible UI wiring', async () => {
  const [
    plugin, css, registry, cmake, rollout, telemetry, readme, worklet, audioManager,
    executionCapabilities
  ] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'plugins', 'lofi', 'am_radio_simulator.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'plugins', 'lofi', 'am_radio_simulator.css'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'CMakeLists.txt'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio', 'dsp-rollout.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio', 'telemetry-hub.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'README.md'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'plugins', 'audio-processor.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio-manager.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio', 'plugin-execution-capabilities.js'), 'utf8')
  ]);
  assert.match(plugin, /AM_RADIO_SIMULATOR_TAP_STATUS\s*=\s*17/);
  assert.match(plugin, /AM_RADIO_SIMULATOR_TELEMETRY_VERSION\s*=\s*2/);
  assert.match(plugin, /AM_RADIO_SIMULATOR_TELEMETRY_BYTES\s*=\s*28/);
  assert.match(plugin, /txInterp: makeBank\(2\)/);
  assert.match(plugin, /for \(let phase = 0; phase < 3; phase\+\+\)[\s\S]*asymmetricLimit\(interpolated\)/);
  assert.match(plugin, /detectorInterpI: makeBank\(3\)[\s\S]*detectorDecimation: makeBank\(2\)/);
  assert.match(plugin, /for \(let phase = 0; phase < 5; phase\+\+\)[\s\S]*detectorStep\(state, interpolatedI, interpolatedQ\)/);
  assert.match(plugin, /agcDetectorStage1[\s\S]*agcDetectorStage2/);
  assert.doesNotMatch(plugin, /detectedCarrier/);
  assert.match(plugin, /MAXIMUM_DIGITAL_TUNING_HZ\s*=\s*15000/);
  assert.match(plugin, /stationTuningGain[\s\S]*interfererTuningGain/);
  assert.match(plugin, /startSpeakerTransition[\s\S]*speakerTransitionRemaining/);
  assert.match(plugin, /const blend = 0\.5 - 0\.5 \* Math\.cos\(PI \* progress\)/);
  assert.match(plugin, /setAttribute\('role', 'tablist'\)/);
  assert.match(plugin, /setAttribute\('aria-controls'/);
  assert.match(plugin, /setAttribute\('aria-labelledby'/);
  assert.match(plugin, /createRadioGroup\('Speaker', \['Small', 'Table', 'Off'\]/);
  assert.match(plugin, /requestPowerAnimationFrame/);
  assert.match(plugin, /AM radio processing is unavailable in this environment/);
  assert.doesNotMatch(plugin, /WASM is required/);
  assert.match(css, /body\.layout-mobile \.am-radio-simulator-tab/);
  assert.match(registry, /EFFETUNE_PLUGIN\(AMRadioSimulatorPlugin, lofi\/am_radio_simulator\)/);
  assert.match(cmake, /effetune_dsp_am_radio_simulator_tests[\s\S]*am_radio_simulator\/native_test\.cpp/);
  assert.match(rollout, /'AMRadioSimulatorPlugin'/);
  assert.match(telemetry, /TAP_AM_RADIO_SIMULATOR:\s*17/);
  assert.match(readme, /Type 17\s*\(`TAP_AM_RADIO_SIMULATOR`\)/);
  assert.match(executionCapabilities,
    /\['AMRadioSimulatorPlugin', UNBOUNDED_WASM_EXECUTION_CAPABILITIES\]/);
  assert.doesNotMatch(worklet, /AMRadioSimulatorPlugin/);
  assert.doesNotMatch(audioManager, /AMRadioSimulatorPlugin/);
});
