import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { getCurrentJsEngineHash } from './js-engine-hash-helper.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';
import { createReferenceSession, loadReferencePlugin } from '../../tools/dsp-parity/node-host.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const reverbRoot = path.join(repoRoot, 'dsp', 'plugins', 'reverb');
const ports = [
  {
    type: 'DattorroPlateReverbPlugin',
    folder: 'dattorro_plate_reverb',
    hash: 0x22bc806f,
    keys: ['pd', 'bw', 'id1', 'id2', 'dc', 'dd1', 'dp', 'md', 'mr', 'wm', 'dm'],
    defaults: [10, 0.9995, 0.75, 0.625, 0.5, 0.7, 0.0005, 1, 1, 30, 100],
    caseIds: [
      'default-impulse',
      'minimum-controls-44100',
      'maximum-controls-192000',
      'mono-wet-96000',
      'eight-channel-routing',
      'predelay-boundaries',
      'state-preserving-parameter-events',
      'one-frame-blocks',
      'odd-block-modulation'
    ]
  },
  {
    type: 'FDNReverbPlugin',
    folder: 'fdn_reverb',
    hash: 0x68a00ea5,
    keys: ['rt', 'dt', 'pd', 'bd', 'ds', 'hd', 'lc', 'md', 'mr', 'df', 'wm', 'dm', 'sw'],
    defaults: [1.2, 8, 10, 20, 5, 6, 100, 3, 0.3, 100, 30, 100, 100],
    caseIds: [
      'default-impulse',
      'minimum-controls-44100',
      'maximum-controls-192000',
      'density-five-boundary',
      'eight-channel-shared-tank-96000',
      'mono-wet',
      'density-state-transitions',
      'predelay-full-ring',
      'one-frame-blocks-seeded'
    ]
  },
  {
    type: 'RSReverbPlugin',
    folder: 'rs_reverb',
    hash: 0xc3be374c,
    keys: ['pd', 'rs', 'rt', 'ds', 'df', 'dp', 'hd', 'ld', 'mx'],
    defaults: [10, 10, 2.4, 8, 0.7, 80, 2000, 200, 16],
    caseIds: [
      'default-impulse',
      'minimum-controls-44100',
      'maximum-controls-192000',
      'density-four-wet',
      'eight-channel-independent-tanks-96000',
      'room-size-reset-events',
      'predelay-parameter-active',
      'state-preserving-parameter-events',
      'one-frame-blocks-seeded'
    ]
  }
];

async function directoryBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

async function readPort(port) {
  const root = path.join(reverbRoot, port.folder);
  const schemaPath = path.join(root, 'params.json');
  const [schemaText, casesText, kernel] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(root, 'cases.json'), 'utf8'),
    fs.readFile(path.join(root, 'kernel.cpp'), 'utf8')
  ]);
  return {
    root,
    schema: validateParamSpec(JSON.parse(schemaText), schemaPath),
    rawSchema: JSON.parse(schemaText),
    cases: JSON.parse(casesText),
    kernel
  };
}

test('reverb schemas and generated packers freeze each source ABI', async () => {
  for (const port of ports) {
    const { schema, rawSchema } = await readPort(port);
    assert.equal(schema.type, port.type);
    assert.equal(schema.hash, port.hash);
    assert.equal(schema.floatCount, port.keys.length);
    assert.equal(schema.tolerance.abs, 0.0001);
    assert.deepEqual(rawSchema.fields.map(field => field.key), port.keys);

    const packer = DSP_PARAM_PACKERS.get(port.type);
    assert.ok(packer, port.type);
    assert.equal(packer.hash, port.hash);
    assert.equal(packer.floatCount, port.keys.length);
    assert.deepEqual(packer.pack(), Float32Array.from(port.defaults));
  }
});

test('reverb case matrices and JavaScript goldens remain deterministic', async () => {
  for (const port of ports) {
    const loaded = await readPort(port);
    assert.deepEqual(loaded.cases.cases.map(item => item.id), port.caseIds);
    assert.equal(loaded.cases.cases.find(item => item.id === 'maximum-controls-192000')
      .sampleRate, 192000);
    assert.ok(loaded.cases.cases.some(item => item.channels === 8));
    assert.ok(loaded.cases.cases.some(item => item.blockSize === 1));
    assert.ok(loaded.cases.cases.some(item => item.events?.length > 0));

    const goldenRoot = path.join(loaded.root, 'golden');
    assert.ok(await directoryBytes(goldenRoot) <= DEFAULT_GOLDEN_BUDGET_BYTES);
    const goldens = await readGoldenSet(goldenRoot);
    const jsEngineHash = await getCurrentJsEngineHash(port.type, repoRoot);
    assert.equal(goldens.length, 9);
    assert.ok(goldens.every(item => item.metadata.type === port.type));
    assert.ok(goldens.every(item => item.metadata.jsEngineHash === jsEngineHash));
    assert.ok(goldens.every(item => item.expected.length ===
      item.metadata.frameCount * item.metadata.channels));
    assert.ok(goldens.every(item => item.expected.every(Number.isFinite)));

    const result = await runParityCli([
      '--root', repoRoot,
      '--type', port.type,
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, 9);
    assert.ok(result.results.every(item => item.comparison.pass));
  }
});

test('reverb reviewed cases pin routing, state, and active predelay behavior', async () => {
  const dattorro = await readPort(ports[0]);
  const fdn = await readPort(ports[1]);
  const rs = await readPort(ports[2]);
  assert.equal(dattorro.cases.cases.find(item => item.id === 'eight-channel-routing')
    .channels, 8);
  assert.equal(fdn.cases.cases.find(item => item.id === 'density-five-boundary')
    .params.dt, 5);
  assert.equal(fdn.cases.cases.find(item => item.id === 'eight-channel-shared-tank-96000')
    .channels, 8);
  const activePredelay = rs.cases.cases.find(item =>
    item.id === 'predelay-parameter-active');
  assert.ok(activePredelay.events.every(event =>
    Object.keys(event.params).every(key => key === 'pd')));
  const roomEvents = rs.cases.cases.find(item => item.id === 'room-size-reset-events');
  assert.ok(roomEvents.events.every(event =>
    Object.keys(event.params).every(key => key === 'rs')));
});

test('reverb kernels and native tests pin realtime lifecycle and capacity contracts', async () => {
  const [registry, nativeTest, cmake, readme, ...loadedPorts] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8'),
    fs.readFile(path.join(reverbRoot, 'reverb_native_test.cpp'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'CMakeLists.txt'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'README.md'), 'utf8'),
    ...ports.map(readPort)
  ]);

  for (let index = 0; index < ports.length; ++index) {
    const port = ports[index];
    const source = loadedPorts[index].kernel;
    const processStart = source.indexOf('  void process(');
    const processEnd = source.indexOf('\nprivate:', processStart);
    assert.ok(processStart >= 0 && processEnd > processStart, port.type);
    const processBody = source.slice(processStart, processEnd);
    assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
    assert.doesNotMatch(processBody, /std::(?:fabs|max|min)\s*\(/);
    assert.match(registry, new RegExp(
      `EFFETUNE_PLUGIN\\(${port.type}, reverb/${port.folder}\\)`));
  }

  const dattorro = loadedPorts[0].kernel;
  assert.match(dattorro, /preparePreDelay\(pre_delay_samples\)/);
  assert.match(dattorro, /const double signal_delay = pre_delay_ramp_\.value\(frame\)/);
  assert.match(dattorro, /readPreDelay\(input, pre_delay_position, signal_delay\)/);
  assert.match(dattorro, /input \/= static_cast<double>\(channel_count\)/);

  const fdn = loadedPorts[1].kernel;
  const fdnPrepare = fdn.slice(fdn.indexOf('  void prepare('), fdn.indexOf('  void reset('));
  assert.match(fdnPrepare, /clearRuntimeState\(\)/);
  assert.doesNotMatch(fdnPrepare, /random_\.seed/);
  assert.match(fdn, /random_\.seed\(selected_seed_low_, selected_seed_high_\)/);
  assert.match(fdn, /pre_delay_\.resize\(pre_delay_length_\)/);
  assert.match(fdn, /input \/= static_cast<double>\(channel_count\)/);

  const rs = loadedPorts[2].kernel;
  const rsPrepare = rs.slice(rs.indexOf('  void prepare('), rs.indexOf('  void reset('));
  assert.match(rsPrepare, /if \(comb_delays_ready_\)/);
  assert.match(rsPrepare, /configureCombDelays\(configured_room_size_\)/);
  assert.doesNotMatch(rsPrepare, /random_\.seed/);
  assert.match(rs, /params_\.preDelay/);
  assert.match(rs, /comb_line_capacities_\[line\]/);
  assert.match(rs, /comb_line_offsets_\[line\]/);

  assert.match(nativeTest, /allocation_guard::Scope allocation_scope/);
  assert.match(nativeTest, /testExplicitReset\(dattorro/);
  assert.match(nativeTest, /testFdnSampleRateRngTransition/);
  assert.match(nativeTest, /testRsSampleRateTransition/);
  assert.match(nativeTest, /rs_buffer_bytes == 8912032u/);
  assert.match(nativeTest, /rs_buffer_bytes < kRsPayloadBudget/);
  assert.match(cmake, /effetune_dsp_reverb_tests/);
  assert.match(readme, /^#### RS Reverb$/m);
  assert.match(readme, /\| Storage \| Float32 samples \| Bytes \|[\s\S]*\| Complete instance \| 4,456,016 \| 17,824,064 \|/);
});

async function renderReverb(type, params, {
  channels = 1, frames = 7200, sampleRate = 48000, events = [], impulse = true
} = {}) {
  const session = await createReferenceSession(type, { params });
  const input = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; channel++) {
    if (impulse) {
      input[channel * frames] = 1;
    } else {
      for (let frame = 0; frame < frames; frame++) {
        input[channel * frames + frame] = 0.25 * Math.sin(2 * Math.PI * 100 * frame / sampleRate);
      }
    }
  }
  const output = await session.process(input, { sampleRate, frames, channels, blockSize: 127, events });
  assert.ok(output.every(Number.isFinite), `${type} output must remain finite`);
  return { output, session };
}

function estimateReverbTime(output, sampleRate) {
  // Extrapolate RT60 from the -5 to -35 dB portion of the integrated impulse energy.
  const energy = new Float64Array(output.length);
  let total = 0;
  for (let frame = output.length - 1; frame >= 0; frame--) {
    energy[frame] = total += output[frame] * output[frame];
  }
  assert.ok(total > 0, 'the wet impulse response must contain energy');
  const start = energy.findIndex(value => value <= total * 10 ** -0.5);
  const end = energy.findIndex(value => value <= total * 10 ** -3.5);
  assert.ok(start >= 0 && end > start, 'the rendered tail must reach -35 dB');
  return 2 * (end - start) / sampleRate;
}

test('RS damping preserves the requested reverb time in the passband', async t => {
  const cases = [
    { name: 'default damping', sampleRate: 48000, params: {} },
    { name: 'long tail', sampleRate: 48000, params: { rt: 6 } },
    { name: 'small room', sampleRate: 44100, params: { rs: 2 } },
    { name: 'narrow damping band', sampleRate: 96000, params: { dp: 100, hd: 1000, ld: 500 } },
    { name: 'high sample rate', sampleRate: 192000, params: {} },
    { name: 'damping disabled', sampleRate: 48000, params: { dp: 0 } }
  ];
  for (const { name, sampleRate, params } of cases) {
    await t.test(name, async () => {
      const reverbTime = params.rt ?? 2.4;
      const frames = Math.ceil(sampleRate * reverbTime * 2);
      const { output } = await renderReverb('RSReverbPlugin', { ...params, pd: 0, mx: 100 }, {
        sampleRate, frames, channels: 2
      });
      for (let channel = 0; channel < 2; channel++) {
        const measured = estimateReverbTime(output.subarray(channel * frames, (channel + 1) * frames), sampleRate);
        assert.ok(measured > reverbTime * 0.8 && measured < reverbTime * 1.2,
          `channel ${channel}: expected about ${reverbTime}s, measured ${measured}s`);
      }
    });
  }
});

test('RS predelay adds the requested delay without delaying its dry path', async () => {
  const params = { pd: 0, rs: 2, dp: 0, mx: 100 };
  const { output: immediate } = await renderReverb('RSReverbPlugin', params);
  const { output: delayed } = await renderReverb('RSReverbPlugin', { ...params, pd: 40 });
  const delay = 1920;
  assert.equal(immediate.findIndex(value => value !== 0), Math.ceil(19 * 0.2 * 48));
  assert.equal(delayed.findIndex(value => value !== 0),
    immediate.findIndex(value => value !== 0) + delay);
  assert.deepEqual(delayed.subarray(delay), immediate.subarray(0, immediate.length - delay));
  const { output: dry } = await renderReverb('RSReverbPlugin', { ...params, pd: 40, mx: 0 });
  assert.equal(dry[0], 1);
  assert.ok(dry.subarray(1).every(value => value === 0));
});

test('RS predelay ramps once per frame and channel changes resize independent tanks', async () => {
  const params = { pd: 0, rs: 2, dp: 0, mx: 100 };
  const options = { impulse: false, events: [{ frame: 1800, params: { pd: 40 } }] };
  const mono = await renderReverb('RSReverbPlugin', params, options);
  const surround = await renderReverb('RSReverbPlugin', params, { ...options, channels: 8 });
  assert.deepEqual(surround.output.subarray(0, mono.output.length), mono.output);
  assert.notDeepEqual(surround.output.subarray(mono.output.length, mono.output.length * 2), mono.output);
  const { session } = mono;
  const frames = 3200;
  const input = new Float32Array(frames * 8);
  for (let channel = 0; channel < 8; channel++) input[channel * frames] = 1;
  const output = await session.process(input, { sampleRate: 48000, frames, channels: 8 });
  assert.ok(output.every(Number.isFinite));
  for (let channel = 0; channel < 8; channel++) {
    assert.ok(output.subarray(channel * frames, (channel + 1) * frames).some(value => value !== 0));
  }
  assert.equal(session.inspectProcessorState().combDelays.length, 64);
});

test('RS sample-rate reprepare initializes the predelay ramp for the new buffer', async () => {
  const loaded = await loadReferencePlugin('RSReverbPlugin', { repoRoot });
  const plugin = new loaded.PluginClass();
  plugin.setParameters({ pd: 50, rs: 2, mx: 100 });
  const context = {};
  const process = (sampleRate, input) => plugin.executeProcessor(context, input, {
    ...plugin.getParameters(),
    type: 'RSReverbPlugin',
    enabled: true,
    channelCount: 1,
    blockSize: input.length,
    sampleRate
  });

  process(192000, new Float32Array([0.5]));
  assert.equal(context.preDelayBuffer[0].buffer.length, 9601);
  const output = process(48000, new Float32Array(4096));
  assert.equal(context.preDelayBuffer[0].buffer.length, 2401);
  assert.ok(output.every(Number.isFinite));
});

test('RS Low Damp removes low frequencies only while damping is enabled', async () => {
  const params = { pd: 0, rs: 2, rt: 1, dp: 100, hd: 20000, mx: 100 };
  const options = { frames: 24000, impulse: false };
  const energy = output => output.subarray(12000).reduce((sum, value) => sum + value * value, 0);
  const low = await renderReverb('RSReverbPlugin', { ...params, ld: 20 }, options);
  const high = await renderReverb('RSReverbPlugin', { ...params, ld: 500 }, options);
  assert.ok(energy(high.output) < energy(low.output) * 0.25, '500 Hz Low Damp must cut 100 Hz by at least 6 dB');
  const offLow = await renderReverb('RSReverbPlugin', { ...params, dp: 0, ld: 20 });
  const offHigh = await renderReverb('RSReverbPlugin', { ...params, dp: 0, ld: 500 });
  assert.deepEqual(offLow.output, offHigh.output);
});

test('FDN shared tank and predelay advance independently of channel count', async () => {
  const params = { pd: 10, wm: 100, dm: 0, sw: 0 };
  const { output: mono } = await renderReverb('FDNReverbPlugin', params);
  assert.ok(mono.some(value => value !== 0));
  for (const channels of [2, 8]) {
    const { output, session } = await renderReverb('FDNReverbPlugin', params, { channels });
    for (let channel = 0; channel < channels; channel++) {
      assert.deepEqual(output.subarray(channel * mono.length, (channel + 1) * mono.length), mono);
    }
    assert.equal(session.inspectProcessorState().preDelayBuffer.pos, mono.length % 4800);
  }
});
