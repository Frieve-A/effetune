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
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'lofi', 'sw_radio_simulator');
const pluginSourcePath = path.join(repoRoot, 'plugins', 'lofi', 'sw_radio_simulator.js');

const TAP_SW_RADIO_SIMULATOR = 18;
const TELEMETRY_BYTES = 24;

function createStubPluginBase(id) {
  return class PluginBase {
    constructor() {
      this.enabled = true;
      this.id = id;
    }
    registerProcessor(processor) { this.processorString = processor; }
    updateParameters() {}
    cleanup() {}
    canRunAnimation() { return true; }
    requestPowerAnimationFrame() { return 0; }
    getSerializableParameters() { return this.getParameters(); }
    getWorkletPluginData(parameters) { return parameters; }
    parseFiniteNumber(value, minimum, maximum, fallback) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
    }
    isAllowedEnum(value, allowed, previous) {
      return allowed.includes(value) ? value : previous;
    }
  };
}

async function loadPlugin({ id = 12, hub = null, clock = null } = {}) {
  const source = await fs.readFile(pluginSourcePath, 'utf8');
  const now = clock ?? { value: 1000 };
  const context = {
    PluginBase: createStubPluginBase(id),
    performance: { now: () => now.value },
    cancelAnimationFrame: () => {},
    window: hub ? { dspTelemetryHub: hub } : {}
  };
  vm.runInNewContext(source, context);
  return { plugin: new context.window.SWRadioSimulatorPlugin(), context, now };
}

function telemetryPayload({
  carrierPreAgcDb = -30, agcGainDb = 20, modPercent = 85, fadeDb = -12,
  staticCount = 0, clipCount = 0, bytes = TELEMETRY_BYTES
} = {}) {
  const payload = new DataView(new ArrayBuffer(bytes));
  payload.setFloat32(0, carrierPreAgcDb, true);
  payload.setFloat32(4, agcGainDb, true);
  payload.setFloat32(8, modPercent, true);
  payload.setFloat32(12, fadeDb, true);
  if (bytes >= 24) {
    payload.setUint32(16, staticCount, true);
    payload.setUint32(20, clipCount, true);
  }
  return payload;
}

test('SW Radio Simulator freezes the parameter layout and representative parity matrix', async () => {
  const schemaPath = path.join(pluginRoot, 'params.json');
  const [schemaText, casesText] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(pluginRoot, 'cases.json'), 'utf8')
  ]);
  const raw = JSON.parse(schemaText);
  const schema = validateParamSpec(raw, schemaPath);
  const cases = JSON.parse(casesText).cases;

  assert.equal(schema.type, 'SWRadioSimulatorPlugin');
  assert.equal(schema.floatCount, 24);
  assert.deepEqual(raw.fields.map(({ key }) => key),
    ['rd', 'tb', 'pe', 'md', 'cp', 'sg', 'sk', 'fd', 'ds', 'st', 'in', 'io',
      'tn', 'bw', 'de', 'ag', 'dt', 'hm', 'hz', 'sp', 'og', 'mx', 'mo', 'bf']);
  assert.deepEqual(raw.fields.find(field => field.key === 'de').values,
    ['Envelope', 'Synchronous']);
  assert.deepEqual(raw.fields.find(field => field.key === 'ag').values, ['Slow', 'Mid', 'Fast']);
  assert.deepEqual(raw.fields.find(field => field.key === 'hz').values, ['50', '60']);
  assert.deepEqual(raw.fields.find(field => field.key === 'sp').values, ['Off', 'Small', 'Table']);
  // The mode enum order is the wire enum index, so it is frozen alongside the BFO range.
  assert.deepEqual(raw.fields.find(field => field.key === 'mo').values, ['AM', 'USB', 'LSB']);
  assert.equal(raw.fields.find(field => field.key === 'mo').default, 'AM');
  assert.deepEqual(
    (({ min, max, default: fallback }) => ({ min, max, default: fallback }))(
      raw.fields.find(field => field.key === 'bf')),
    { min: -1000, max: 1000, default: 0 });
  // Shortwave-specific ranges: delay spread is new, Doppler reaches 10 Hz, the heterodyne
  // offset drops to 0.1 kHz, and the narrow IF caps tuning at +/-5 kHz.
  assert.deepEqual(
    Object.fromEntries(['ds', 'fd', 'io', 'tn', 'bw'].map(key => {
      const field = raw.fields.find(item => item.key === key);
      return [key, { min: field.min, max: field.max, default: field.default }];
    })),
    {
      ds: { min: 0.2, max: 8, default: 1.4 },
      fd: { min: 0.1, max: 10, default: 0.5 },
      io: { min: 0.1, max: 10, default: 1 },
      tn: { min: -5, max: 5, default: 0 },
      bw: { min: 2, max: 10, default: 6 }
    });
  assert.equal(raw.fields.find(field => field.key === 'sk').default, 55);

  assert.equal(cases.length, 28);
  assert.ok(cases.every(item => item.params?.fr === true));
  // The transmitter shutdown path must stay frozen: a steady off-air case and
  // a case that switches the carrier off mid-render and brings it back.
  assert.ok(cases.some(item => item.params.rd === false));
  assert.ok(cases.some(item =>
    item.events?.some(event => event.params.rd === false) &&
    item.events?.some(event => event.params.rd === true)));
  assert.ok(cases.some(item => item.sampleRate === 44100 && item.channels === 1));
  assert.ok(cases.some(item => item.sampleRate === 48000));
  assert.ok(cases.some(item => item.sampleRate === 192000));
  assert.ok(cases.some(item => item.blockSize === 1));
  assert.ok(cases.some(item => item.channels === 4 && item.channelMode === 'all4'));
  assert.ok(cases.some(item => item.stimulus === 'silence'));
  assert.ok(cases.some(item => item.params.mx === 0));
  assert.ok(cases.some(item => item.events?.some(event => event.params.sp)));
  // Deep selective fading, heterodyne whistle, flutter, and both detector modes are covered.
  assert.ok(cases.some(item => item.params.sk === 100 && item.params.ds === 8));
  assert.ok(cases.some(item => item.params.io === 0.1 && item.params.in === 0));
  assert.ok(cases.some(item => item.params.fd === 10 && item.params.ds === 0.2));
  assert.ok(cases.some(item => item.params.de === 'Synchronous'));
  assert.ok(cases.some(item => item.events?.some(event => event.params.de === 'Synchronous')));
  assert.ok(cases.some(item => item.params.md === 125 && item.params.dt === 20));
  // A mid-case Static Rate step covers the pending-deadline rescale path.
  assert.ok(cases.some(item =>
    item.params.st === 0.125 && item.events?.some(event => event.params.st === 100)));
  // Both sidebands, a mid-stream mode switch, and the two inert corners are covered.
  assert.ok(cases.some(item => item.params.mo === 'USB'));
  assert.ok(cases.some(item => item.params.mo === 'LSB'));
  assert.ok(cases.some(item => item.events?.some(event => 'mo' in event.params)));
  assert.ok(cases.some(item =>
    (item.params.mo ?? 'AM') === 'AM' && item.params.bf !== undefined && item.params.bf !== 0));
  assert.ok(cases.some(item => item.params.mo === 'USB' && item.params.de === 'Synchronous'));

  // The goldens must be regenerated whenever the JS reference engine changes, so pin the
  // recorded engine hash: a stale golden set fails here instead of silently passing parity.
  const goldens = await readGoldenSet(path.join(pluginRoot, 'golden'));
  assert.equal(goldens.length, 28);
  assert.ok(goldens.every(item =>
    item.metadata.jsEngineHash ===
      '057ff68858c214fa77d9af89f342a5753262727495db72bbb54266532ee8ce8a'
  ));
});

test('SW Radio Simulator reference is deterministic tooling while normal fallback is transparent', async () => {
  const { plugin } = await loadPlugin();
  const serializable = plugin.getSerializableParameters();
  const runtime = plugin.getWorkletPluginData(plugin.getParameters());
  const defaultKeys = ['tb', 'pe', 'md', 'cp', 'sg', 'sk', 'fd', 'ds', 'st', 'in', 'io',
    'tn', 'bw', 'de', 'ag', 'dt', 'hm', 'hz', 'sp', 'og', 'mx'];
  assert.deepEqual(Object.fromEntries(defaultKeys.map(key => [key, serializable[key]])), {
    tb: 4.5, pe: 50, md: 90, cp: 6, sg: -15, sk: 55, fd: 0.5, ds: 1.4, st: 2, in: -47, io: 1,
    tn: 0, bw: 6, de: 'Envelope', ag: 'Fast', dt: 50, hm: -80, hz: '50', sp: 'Small',
    og: 0, mx: 100
  });
  assert.equal('fr' in plugin.getParameters(), true);
  assert.equal('fr' in serializable, false);
  assert.equal('fr' in runtime, false);

  const bounds = {
    tb: [2, 10], pe: [0, 100], md: [10, 125], cp: [0, 20], sg: [-50, 0], sk: [0, 100],
    fd: [0.1, 10], ds: [0.2, 8], st: [0, 100], in: [-80, 0], io: [0.1, 10], tn: [-5, 5],
    bw: [2, 10], dt: [20, 500], hm: [-80, -20], og: [-24, 24], mx: [0, 100]
  };
  for (const [key, [minimum, maximum]] of Object.entries(bounds)) {
    plugin.setParameters({ [key]: -1e9 });
    assert.equal(plugin[key], minimum, `${key} clamps low`);
    plugin.setParameters({ [key]: 1e9 });
    assert.equal(plugin[key], maximum, `${key} clamps high`);
    plugin.setParameters({ [key]: 'not a number' });
    assert.equal(plugin[key], maximum, `${key} rejects garbage`);
  }
  plugin.setParameters({ de: 'Synchronous' });
  plugin.setParameters({ de: 'Product Detector' });
  assert.equal(plugin.de, 'Synchronous');
  plugin.setParameters({ ag: 'Turbo' });
  assert.equal(plugin.ag, 'Fast');
  plugin.setParameters({ sp: 'Console' });
  assert.equal(plugin.sp, 'Small');
  plugin.setParameters({ hz: 400 });
  assert.equal(plugin.hz, '50');
  plugin.setParameters(Object.fromEntries(defaultKeys.map(key => [key, serializable[key]])));

  plugin.setParameters({ mx: 100, enabled: true });
  assert.equal(plugin.getTemporalCapability(), 'must-process');
  plugin.setParameters({ mx: 0 });
  assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');
  plugin.setParameters({ mx: 100, enabled: false });
  assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');
  plugin.setParameters({ enabled: true });

  const processor = new Function('data', 'parameters', 'context', plugin.processorString);
  const audio = new Float32Array([0.25, -0.5, 0.75, -1]);
  const expected = [...audio];
  const bypassed = processor(audio, {
    ...plugin.getParameters(), sampleRate: 48000, blockSize: 4, channelCount: 1
  }, {});
  assert.deepEqual([...bypassed], expected);
  assert.deepEqual(bypassed.measurements, { bypass: true });
  const withoutRng = processor(new Float32Array([0.25, -0.5]), {
    ...plugin.getParameters(), fr: true, sampleRate: 48000, blockSize: 2, channelCount: 1
  }, {});
  assert.deepEqual(withoutRng.measurements, { bypass: true });

  // The AGC cold start is the stationary expectation of the pre-AGC IF magnitude, so the
  // +42 dB ceiling is only reached when the channel is genuinely empty; a co-channel carrier
  // inside the IF passband holds the starting gain down exactly as it does once settled.
  const maximumGain = processor(new Float32Array(1), {
    ...plugin.getParameters(), fr: true, enabled: true, sg: -50, in: -80,
    sampleRate: 48000, blockSize: 1, channelCount: 1
  }, { __seededRandom: () => 0.5 });
  assert.equal(maximumGain.measurements.agcGainDb, 42);
  const interferedGain = processor(new Float32Array(1), {
    ...plugin.getParameters(), fr: true, enabled: true, sg: -50, in: -35,
    sampleRate: 48000, blockSize: 1, channelCount: 1
  }, { __seededRandom: () => 0.5 });
  assert.ok(interferedGain.measurements.agcGainDb > 28 &&
    interferedGain.measurements.agcGainDb < 30,
  `interference caps the cold-start gain, got ${interferedGain.measurements.agcGainDb}`);

  const render = (blockSize, totalFrames, overrides = {}, seed = null) => {
    const rng = seed === null ? null : new XorShift64(BigInt(seed));
    const runContext = {
      __seededRandom: rng === null ? () => 0.4142135 : () => rng.nextFloat()
    };
    const parameters = {
      ...plugin.getParameters(), fr: true, enabled: true, ...overrides,
      sampleRate: 96000, blockSize, channelCount: 2
    };
    const rendered = [];
    let measurements = null;
    for (let offset = 0; offset < totalFrames; offset += blockSize) {
      const block = new Float32Array(blockSize * 2);
      for (let frame = 0; frame < blockSize; frame++) {
        block[frame] = Math.sin((offset + frame) * 0.041) * 0.35;
        block[blockSize + frame] = Math.cos((offset + frame) * 0.017) * 0.28;
      }
      const output = processor(block, parameters, runContext);
      for (let frame = 0; frame < blockSize; frame++) rendered.push(output[frame]);
      measurements = output.measurements;
    }
    return { rendered, measurements };
  };
  const wideBlocks = render(128, 512);
  const singleFrameBlocks = render(1, 512);
  assert.deepEqual(wideBlocks.rendered, singleFrameBlocks.rendered);
  assert.equal(wideBlocks.rendered.every(Number.isFinite), true);
  const seededRuns = [1, 2, 3, 4, 5].map(seed => render(128, 512, {}, seed).rendered);
  assert.notDeepEqual(seededRuns[0], seededRuns[1]);
  assert.notDeepEqual(seededRuns[1], seededRuns[2]);
  assert.notDeepEqual(seededRuns[3], seededRuns[4]);
  assert.deepEqual(Object.keys(wideBlocks.measurements).sort(),
    ['agcGainDb', 'carrierPreAgcDb', 'clipCount', 'fadeDb', 'modPercent', 'staticCount']);
  assert.equal('stereoBlend' in wideBlocks.measurements, false);

  // The synchronous detector is a distinct audio path but shares the pre-detector AGC and
  // S-meter carrier estimate, so those telemetry scalars must be unchanged.
  const synchronous = render(128, 512, { de: 'Synchronous' });
  assert.notDeepEqual(synchronous.rendered, wideBlocks.rendered);
  assert.deepEqual(
    ['carrierPreAgcDb', 'agcGainDb', 'fadeDb'].map(key => synchronous.measurements[key]),
    ['carrierPreAgcDb', 'agcGainDb', 'fadeDb'].map(key => wideBlocks.measurements[key]));

  // The fading taps are drawn from their stationary distribution rather than left at zero. On a
  // pure skywave path a zeroed pair nulls both sky modes, so the fade telemetry after a single
  // frame would sit exactly on its -80 dB floor for every seed; a seeded pair reports a finite
  // depth that moves with the seed.
  const firstFrameFadeDb = seed => {
    const rng = new XorShift64(BigInt(seed));
    return processor(new Float32Array(1), {
      ...plugin.getParameters(), fr: true, enabled: true, sk: 100,
      sampleRate: 48000, blockSize: 1, channelCount: 1
    }, { __seededRandom: () => rng.nextFloat() }).measurements.fadeDb;
  };
  const fadeFromLowSeed = firstFrameFadeDb(1);
  const fadeFromHighSeed = firstFrameFadeDb(2);
  assert.ok(fadeFromLowSeed > -79 && fadeFromHighSeed > -79,
    `seeded fading taps leave the -80 dB floor, got ${fadeFromLowSeed} and ${fadeFromHighSeed}`);
  assert.ok(Math.abs(fadeFromLowSeed - fadeFromHighSeed) > 1,
    `the seeded fade depth follows the seed, got ${fadeFromLowSeed} and ${fadeFromHighSeed}`);

  // The AGC cold start is analytic: it seeds the detector with the stationary RMS of the pre-AGC
  // IF magnitude the channel is about to deliver. What a cold-start guard can state is therefore
  // the seed error in decibels - how far the AGC still has to walk once the channel is running -
  // and not the output envelope. The envelope is set by the zero-state edge the IF, detector and
  // DC blocker produce while their states fill from zero: on the default settings and with the
  // stimulus rendered here that edge lands at 0.54 ms and reaches 2.4x the settled peak
  // (-7.1 dBFS). The AM Radio Simulator produces the same edge from the same mechanism and a
  // larger one (0.31 ms, 3.8x the settled peak, -1.3 dBFS), so it is inherited receiver
  // behaviour rather than anything this plugin's cold start introduces.
  const coldStart = (overrides, sampleRate = 96000) => {
    const runContext = { __seededRandom: () => 0.4142135 };
    const parameters = {
      ...plugin.getParameters(), fr: true, enabled: true, ...overrides,
      sampleRate, channelCount: 2
    };
    const transientFrames = Math.round(sampleRate * 0.1);
    const settleFrom = Math.round(sampleRate * 0.5);
    const settled = [];
    let seedDb = null;
    let transientPeak = 0;
    let settledPeak = 0;
    let offset = 0;
    while (offset < sampleRate) {
      // The first block is a single frame, so the telemetry it reports is the analytic seed
      // itself: exactly one control tick has run and nothing has had time to move it.
      const blockSize = offset === 0 ? 1 : Math.min(128, sampleRate - offset);
      const block = new Float32Array(blockSize * 2);
      for (let frame = 0; frame < blockSize; frame++) {
        block[frame] = Math.sin((offset + frame) * 0.041) * 0.35;
        block[blockSize + frame] = Math.cos((offset + frame) * 0.017) * 0.28;
      }
      const output = processor(block, { ...parameters, blockSize }, runContext);
      for (let frame = 0; frame < blockSize; frame++) {
        const magnitude = Math.abs(output[frame]);
        const position = offset + frame;
        if (position < transientFrames) {
          if (magnitude > transientPeak) transientPeak = magnitude;
        } else if (position >= settleFrom && magnitude > settledPeak) {
          settledPeak = magnitude;
        }
      }
      if (seedDb === null) seedDb = output.measurements.carrierPreAgcDb;
      if (offset >= settleFrom) settled.push(output.measurements.carrierPreAgcDb);
      offset += blockSize;
    }
    const sorted = settled.slice().sort((left, right) => left - right);
    const middle = sorted.length >> 1;
    const median = sorted.length % 2 === 1 ? sorted[middle] :
      0.5 * (sorted[middle - 1] + sorted[middle]);
    return { errorDb: seedDb - median, transientPeak, settledPeak };
  };

  // Where a non-fading co-channel interferer sets the level, the settled telemetry is the
  // stationary RMS to a fraction of a decibel. A 64-seed sweep measured the worst |seed error|
  // at 0.34 dB on the skywave corner, 0.54 dB detuned and 2.27 dB on the wide corner, so 4 dB
  // is 1.8x the largest measured case.
  const SEED_ERROR_LIMIT_DB = 4;
  // On the default settings the fading station sets the level instead. The pre-AGC telemetry is
  // an attack/release envelope follower, so its settled reading sits above the stationary RMS
  // the seed models and moves with the fading realisation: the same sweep measured the default
  // seed error inside [-6.85, +5.43] dB. 10 dB is 1.46x that measured worst case.
  const FADED_SEED_ERROR_LIMIT_DB = 10;
  // Absolute sanity bound on the cold-start output peak. Full-strength QRM at unity output gain
  // settles above full scale on the interfered corners by design, so this only catches a seed
  // that opens the receiver by an order of magnitude. The sweep peaked at 1.59 across all four
  // corners, so 2.5 is 1.57x the measured worst case.
  const COLD_START_PEAK_LIMIT = 2.5;
  const coldStartCorners = [
    // The shipped defaults: no corner selection, so a broken seed cannot hide behind one.
    { name: 'default', overrides: {}, limitDb: FADED_SEED_ERROR_LIMIT_DB },
    // A pure skywave path with full-strength co-channel QRM inside the IF passband.
    { name: 'skywave', overrides: { sk: 100, in: 0 }, limitDb: SEED_ERROR_LIMIT_DB },
    // Detuning past a narrow IF pushes the interferer carrier out of the passband while its
    // 4.5 kHz programme sidebands stay inside, so this corner separates an interferer modelled
    // as a bare carrier from the modulated station it actually is.
    { name: 'detuned', overrides: { bw: 2, tn: 2.5, in: 0 }, limitDb: SEED_ERROR_LIMIT_DB },
    // The widest IF with the interferer offset all the way out and the wanted station at its
    // floor: the sideband density itself then varies by ~51 dB at 48 kHz (~40 dB at 96 kHz)
    // across the passband, so a single sample taken at the offset underestimates the passband
    // average by up to ~17 dB at 96 kHz - this corner is the one that separates a single-point
    // density sample from the passband average.
    { name: 'wide', overrides: { bw: 10, io: 10, in: 0, sg: -50 }, limitDb: SEED_ERROR_LIMIT_DB }
  ];
  for (const corner of coldStartCorners) {
    const measured = coldStart(corner.overrides);
    assert.ok(measured.settledPeak > 0.05,
      `${corner.name} settled reference is usable, got ${measured.settledPeak}`);
    assert.ok(Math.abs(measured.errorDb) < corner.limitDb,
      `${corner.name} cold-start seed error is ${measured.errorDb} dB against ${corner.limitDb} dB`);
    assert.ok(measured.transientPeak < COLD_START_PEAK_LIMIT,
      `${corner.name} cold start peaks at ${measured.transientPeak}`);
  }

  // Shortwave reception is mono: both wet channels carry the identical detector output.
  const monoOutput = processor((() => {
    const block = new Float32Array(32);
    for (let frame = 0; frame < 16; frame++) {
      block[frame] = Math.sin(frame * 0.041) * 0.35;
      block[16 + frame] = Math.cos(frame * 0.017) * 0.28;
    }
    return block;
  })(), {
    ...plugin.getParameters(), fr: true, enabled: true,
    sampleRate: 48000, blockSize: 16, channelCount: 2
  }, { __seededRandom: () => 0.5 });
  for (let frame = 0; frame < 16; frame++) {
    assert.equal(monoOutput[frame], monoOutput[16 + frame]);
  }

  // Pair mode leaves channels beyond the first two untouched.
  const pairOutput = processor((() => {
    const block = new Float32Array(32);
    for (let frame = 0; frame < 8; frame++) {
      block[frame] = 0.4;
      block[8 + frame] = -0.4;
      block[16 + frame] = 0.9;
      block[24 + frame] = -0.9;
    }
    return block;
  })(), {
    ...plugin.getParameters(), fr: true, enabled: true,
    sampleRate: 48000, blockSize: 8, channelCount: 4
  }, { __seededRandom: () => 0.5 });
  for (let frame = 0; frame < 8; frame++) {
    assert.equal(pairOutput[16 + frame], Math.fround(0.9));
    assert.equal(pairOutput[24 + frame], Math.fround(-0.9));
  }
});

test('SW Radio Simulator parses only finite 24-byte telemetry v1 frames', async () => {
  const { plugin } = await loadPlugin({ id: 18 });
  const payload = telemetryPayload({
    carrierPreAgcDb: -35, agcGainDb: 18, modPercent: 92, fadeDb: -7,
    staticCount: 3, clipCount: 5
  });
  assert.deepEqual(
    { ...plugin.parseDspTelemetryFrame({
      frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1, payload
    }) },
    { carrierPreAgcDb: -35, agcGainDb: 18, modPercent: 92, fadeDb: -7,
      staticCount: 3, clipCount: 5 }
  );

  assert.equal(plugin.parseDspTelemetryFrame(null), null);
  assert.equal(plugin.parseDspTelemetryFrame({}), null);
  for (const frameType of [15, 16, 17, 19]) {
    assert.equal(plugin.parseDspTelemetryFrame({
      frameType, formatVersion: 1, payload
    }), null, `frame type ${frameType} is rejected`);
  }
  for (const formatVersion of [0, 2, 3]) {
    assert.equal(plugin.parseDspTelemetryFrame({
      frameType: TAP_SW_RADIO_SIMULATOR, formatVersion, payload
    }), null, `format version ${formatVersion} is rejected`);
  }
  for (const bytes of [16, 20, 28, 32]) {
    assert.equal(plugin.parseDspTelemetryFrame({
      frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1,
      payload: new DataView(new ArrayBuffer(bytes))
    }), null, `${bytes}-byte payload is rejected`);
  }
  assert.equal(plugin.parseDspTelemetryFrame({
    frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1,
    payload: new ArrayBuffer(TELEMETRY_BYTES)
  }), null);

  for (const offset of [0, 4, 8, 12]) {
    for (const invalidValue of [Number.NaN, Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY]) {
      const invalid = new DataView(payload.buffer.slice(0));
      invalid.setFloat32(offset, invalidValue, true);
      assert.equal(plugin.parseDspTelemetryFrame({
        frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1, payload: invalid
      }), null, `non-finite float at offset ${offset} is rejected`);
    }
  }

  // Full-scale u32 counters stay integral rather than being coerced to a float32.
  const saturated = telemetryPayload({ staticCount: 0xffffffff, clipCount: 0xfffffffe });
  const parsed = plugin.parseDspTelemetryFrame({
    frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1, payload: saturated
  });
  assert.deepEqual([parsed.staticCount, parsed.clipCount], [0xffffffff, 0xfffffffe]);
});

test('SW Radio Simulator subscribes to tap 18 and rebases counters without false spikes', async () => {
  const subscriptions = [];
  let unsubscribed = 0;
  const hub = {
    subscribe(tapId, frameType, callback) {
      subscriptions.push({ tapId, frameType, callback });
      return () => { unsubscribed++; };
    }
  };
  const clock = { value: 1000 };
  const { plugin } = await loadPlugin({ id: 42, hub, clock });

  assert.equal(plugin.ensureDspTelemetrySubscription(), true);
  assert.deepEqual(
    { tapId: subscriptions[0].tapId, frameType: subscriptions[0].frameType },
    { tapId: 42, frameType: TAP_SW_RADIO_SIMULATOR });
  // Repeated calls are idempotent: the same hub and tap id must not resubscribe.
  assert.equal(plugin.ensureDspTelemetrySubscription(), true);
  plugin.getParameters();
  plugin.onMessage({ type: 'noop' });
  assert.equal(subscriptions.length, 1);
  assert.equal(unsubscribed, 0);

  const deliver = frame => subscriptions[0].callback(frame);
  deliver({
    frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1,
    payload: telemetryPayload({
      carrierPreAgcDb: -41.5, agcGainDb: 26.5, modPercent: 88, fadeDb: -18.25,
      staticCount: 10, clipCount: 4
    })
  });
  assert.deepEqual({ ...plugin.hudValues }, {
    carrierPreAgcDb: -41.5, agcGainDb: 26.5, modPercent: 88, fadeDb: -18.25,
    staticRate: 0, clipRate: 0
  });
  assert.equal(plugin.lastTelemetryAt, 1000);

  // Cumulative counters become per-second rates over the measured interval.
  clock.value = 1500;
  deliver({
    frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1,
    payload: telemetryPayload({
      carrierPreAgcDb: -41.5, agcGainDb: 26.5, modPercent: 88, fadeDb: -18.25,
      staticCount: 20, clipCount: 6
    })
  });
  assert.deepEqual([plugin.hudValues.staticRate, plugin.hudValues.clipRate], [20, 4]);
  assert.equal(plugin.eventFlashUntil, 1680);

  // A kernel reset rewinds the counters; the baseline is re-armed instead of spiking.
  clock.value = 2000;
  deliver({
    frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1,
    payload: telemetryPayload({ staticCount: 0, clipCount: 0 })
  });
  assert.deepEqual([plugin.hudValues.staticRate, plugin.hudValues.clipRate], [0, 0]);
  clock.value = 2500;
  deliver({
    frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1,
    payload: telemetryPayload({ staticCount: 5, clipCount: 1 })
  });
  assert.deepEqual([plugin.hudValues.staticRate, plugin.hudValues.clipRate], [10, 2]);

  // Long stalls between frames are ignored rather than reported as a stale rate.
  clock.value = 20000;
  deliver({
    frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1,
    payload: telemetryPayload({ staticCount: 900, clipCount: 900 })
  });
  assert.deepEqual([plugin.hudValues.staticRate, plugin.hudValues.clipRate], [10, 2]);
  assert.equal(plugin.lastTelemetryAt, 20000);

  // Malformed frames never disturb the HUD state.
  const before = { ...plugin.hudValues };
  const stateBefore = { at: plugin.lastTelemetryAt, counters: { ...plugin.lastCounters } };
  deliver({ frameType: 17, formatVersion: 1, payload: telemetryPayload({ staticCount: 1 }) });
  deliver({
    frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 2,
    payload: telemetryPayload({ staticCount: 1 })
  });
  deliver({
    frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1,
    payload: telemetryPayload({ bytes: 28 })
  });
  deliver({
    frameType: TAP_SW_RADIO_SIMULATOR, formatVersion: 1,
    payload: telemetryPayload({ fadeDb: Number.NaN })
  });
  assert.deepEqual({ ...plugin.hudValues }, before);
  assert.deepEqual(
    { at: plugin.lastTelemetryAt, counters: { ...plugin.lastCounters } }, stateBefore);

  plugin.cleanup();
  assert.equal(unsubscribed, 1);
  assert.equal(plugin._dspTelemetryUnsubscribe, null);
});

test('SW Radio Simulator tolerates a missing or hostile telemetry hub', async () => {
  const { plugin: noHub } = await loadPlugin();
  assert.equal(noHub.ensureDspTelemetrySubscription(), false);
  noHub.cleanup();

  const { plugin: refusing } = await loadPlugin({ hub: { subscribe: () => null } });
  assert.equal(refusing.ensureDspTelemetrySubscription(), false);

  const { plugin: throwing } = await loadPlugin({
    hub: { subscribe: () => { throw new Error('hub is down'); } }
  });
  assert.equal(throwing.ensureDspTelemetrySubscription(), false);

  const { plugin: failingUnsubscribe } = await loadPlugin({
    hub: { subscribe: () => () => { throw new Error('stale'); } }
  });
  assert.equal(failingUnsubscribe.ensureDspTelemetrySubscription(), true);
  failingUnsubscribe.cleanup();
  assert.equal(failingUnsubscribe._dspTelemetryUnsubscribe, null);
});

test('SW Radio Simulator drives the HUD from measurements and validated execution state', async () => {
  const clock = { value: 5000 };
  const { plugin } = await loadPlugin({ id: 23, clock });
  assert.deepEqual({ ...plugin.executionState }, { state: 'pending', reason: null });

  // Unvalidated execution-state messages are ignored.
  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 23, state: 'bypassed', reason: 'wasmUnavailable'
  });
  assert.equal(plugin.executionState.state, 'pending');
  assert.equal(plugin.executionStateReceived, false);

  // The JavaScript reference path feeds the same schema through processBuffer.
  plugin.onMessage({
    type: 'processBuffer', pluginId: 23,
    measurements: {
      carrierPreAgcDb: -22.5, agcGainDb: 9.5, modPercent: 74, fadeDb: -3.5,
      staticCount: 2, clipCount: 1
    }
  });
  assert.deepEqual(
    ['carrierPreAgcDb', 'agcGainDb', 'modPercent', 'fadeDb'].map(key => plugin.hudValues[key]),
    [-22.5, 9.5, 74, -3.5]);
  assert.equal(plugin.lastTelemetryAt, 5000);
  plugin.onMessage({ type: 'processBuffer', pluginId: 999, measurements: { fadeDb: -60 } });
  plugin.onMessage({ type: 'processBuffer', pluginId: 23, measurements: { bypass: true } });
  assert.equal(plugin.hudValues.fadeDb, -3.5);

  const drawn = [];
  const fills = [];
  const drawingContext = {
    clearRect() {},
    fillRect(...args) { fills.push({ style: this.fillStyle, args }); },
    strokeRect() {},
    fillText: text => drawn.push(String(text))
  };
  plugin.hudCanvas = {
    width: 900, height: 120, clientWidth: 900, getContext: () => drawingContext
  };

  plugin.drawHud();
  assert.ok(drawn.includes('S METER'));
  assert.ok(drawn.includes('FADE'));
  assert.ok(drawn.includes('AGC GAIN'));
  assert.ok(drawn.includes('MOD / EVENTS'));
  assert.ok(drawn.includes('-3.5 dB'));
  assert.ok(drawn.includes('+9.5 dB'));
  assert.ok(drawn.includes('S4.9'));

  const meterTracks = fills.filter(fill => fill.style === '#363636');
  const meterLevels = fills.filter(fill => fill.style === '#69c8ff');
  assert.equal(meterTracks.length, 4);
  assert.equal(meterLevels.length, 4);
  assert.ok(Math.abs(meterLevels[0].args[2] / meterTracks[0].args[2] - 27.5 / 56) < 1e-12);
  assert.ok(Math.abs(meterLevels[3].args[2] / meterTracks[3].args[2] - 74 / 160) < 1e-12);

  fills.length = 0;
  plugin.eventFlashUntil = clock.value + 180;
  plugin.drawHud();
  const eventTrack = fills.filter(fill => fill.style === '#363636')[3];
  const eventLevel = fills.find(fill => fill.style === '#ffb347');
  assert.ok(eventLevel);
  assert.ok(Math.abs(eventLevel.args[2] / eventTrack.args[2] - 74 / 160) < 1e-12);

  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 23, validated: true,
    state: 'active', reason: null
  });
  assert.equal(plugin.executionStateReceived, true);
  assert.equal(plugin.executionState.state, 'active');

  plugin.onMessage({
    type: 'dspExecutionState', pluginId: 23, validated: true,
    state: 'bypassed', reason: 'wasmUnavailable'
  });
  assert.deepEqual({ ...plugin.executionState },
    { state: 'bypassed', reason: 'wasmUnavailable' });
  drawn.length = 0;
  plugin.drawHud();
  assert.ok(drawn.includes('WASM is required'));

  plugin.executionState = { state: 'pending', reason: null };
  drawn.length = 0;
  plugin.drawHud();
  assert.ok(drawn.some(text => text.startsWith('Loading SW radio')));

  plugin.executionState = { state: 'active', reason: null };
  clock.value = 20000;
  drawn.length = 0;
  plugin.drawHud();
  assert.ok(drawn.includes('Waiting for audio'));

  plugin.enabled = false;
  drawn.length = 0;
  plugin.drawHud();
  assert.ok(drawn.includes('Effect is off'));

  plugin.hudCanvas = null;
  plugin.drawHud();
});

test('SW Radio Simulator integration registers tap 18 across the shipped wiring', async () => {
  const [
    plugin, css, registry, cmake, rollout, telemetry, readme, worklet, audioManager,
    pluginList, executionCapabilities
  ] = await Promise.all([
    fs.readFile(pluginSourcePath, 'utf8'),
    fs.readFile(path.join(repoRoot, 'plugins', 'lofi', 'sw_radio_simulator.css'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'CMakeLists.txt'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio', 'dsp-rollout.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio', 'telemetry-hub.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'README.md'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'plugins', 'audio-processor.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio-manager.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'plugins', 'plugins.txt'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio', 'plugin-execution-capabilities.js'), 'utf8')
  ]);
  const kernel = await fs.readFile(path.join(pluginRoot, 'kernel.cpp'), 'utf8');

  assert.match(plugin, /SW_RADIO_SIMULATOR_TAP_STATUS\s*=\s*18/);
  assert.match(plugin, /SW_RADIO_SIMULATOR_TELEMETRY_VERSION\s*=\s*1/);
  assert.match(plugin, /SW_RADIO_SIMULATOR_TELEMETRY_BYTES\s*=\s*24/);
  assert.match(plugin, /hub\.subscribe\(tapId, SW_RADIO_SIMULATOR_TAP_STATUS/);
  assert.doesNotMatch(plugin, /stereoBlend/);
  assert.match(plugin, /setAttribute\('role', 'tablist'\)/);
  assert.match(plugin, /setAttribute\('aria-controls'/);
  assert.match(plugin, /setAttribute\('aria-labelledby'/);
  assert.match(plugin, /createRadioGroup\('Speaker', \['Small', 'Table', 'Off'\]/);
  assert.match(plugin, /requestPowerAnimationFrame/);
  assert.match(plugin, /WASM is required/);
  assert.match(css, /body\.layout-mobile \.sw-radio-simulator-tab/);
  assert.match(registry, /EFFETUNE_PLUGIN\(SWRadioSimulatorPlugin, lofi\/sw_radio_simulator\)/);
  assert.match(cmake,
    /effetune_dsp_sw_radio_simulator_tests[\s\S]*sw_radio_simulator\/native_test\.cpp/);
  assert.match(rollout, /'SWRadioSimulatorPlugin'/);
  assert.match(telemetry, /TAP_SW_RADIO_SIMULATOR:\s*18/);
  assert.match(readme, /Type 18[^\r\n]*`TAP_SW_RADIO_SIMULATOR`[^\r\n]*exactly 24 bytes/i);
  assert.match(executionCapabilities,
    /\['SWRadioSimulatorPlugin', STANDARD_WASM_EXECUTION_CAPABILITIES\]/);
  assert.doesNotMatch(worklet, /SWRadioSimulatorPlugin/);
  assert.doesNotMatch(audioManager, /SWRadioSimulatorPlugin/);
  assert.match(pluginList,
    /lofi\/sw_radio_simulator: SW Radio Simulator \| Lo-Fi \| SWRadioSimulatorPlugin \| css/);

  // The kernel side of the contract must stay byte-for-byte identical to the parser above.
  assert.match(kernel, /kTelemetryFrameType\s*=\s*18u/);
  assert.match(kernel, /kTelemetryVersion\s*=\s*1u/);
  assert.match(kernel, /kTelemetryPayloadBytes\s*=\s*24u/);
  assert.match(kernel,
    /writeF32\(payload\.data\(\), finiteFloat\(carrier_pre_agc_db_[\s\S]*writeF32\(payload\.data\(\) \+ 4u, finiteFloat\(agc_gain_db_[\s\S]*writeF32\(payload\.data\(\) \+ 8u, finiteFloat\(mod_percent_[\s\S]*writeF32\(payload\.data\(\) \+ 12u, finiteFloat\(fade_db_[\s\S]*writeU32\(payload\.data\(\) \+ 16u, static_count_\);[\s\S]*writeU32\(payload\.data\(\) \+ 20u, clip_count_\);/);
});
