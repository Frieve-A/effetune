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
import { runParityCli } from '../../tools/dsp-parity/run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const reverbRoot = path.join(repoRoot, 'dsp', 'plugins', 'reverb');
const ports = [
  {
    type: 'DattorroPlateReverbPlugin',
    folder: 'dattorro_plate_reverb',
    hash: 0x22bc806f,
    keys: ['pd', 'bw', 'id1', 'id2', 'dc', 'dd1', 'dp', 'md', 'mr', 'wm', 'dm'],
    defaults: [10, 0.9995, 0.75, 0.625, 0.5, 0.7, 0.0005, 1, 1, 30, 100],
    jsEngineHash: '24c3f5334ca9cc1517d25b259a640a8b37e98359e1db7206259184bc39940f23',
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
    jsEngineHash: 'a50d1a4fc340427f53a41e2f5941692f9d5e003cb480888c21ed123a7444c84d',
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
    jsEngineHash: '217ad270ced7aa43a0969563883e52da1e80af136d0ae62fd61b21e97b7c1c8b',
    caseIds: [
      'default-impulse',
      'minimum-controls-44100',
      'maximum-controls-192000',
      'density-four-wet',
      'eight-channel-independent-tanks-96000',
      'room-size-reset-events',
      'predelay-parameter-ignored',
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
    assert.equal(goldens.length, 9);
    assert.ok(goldens.every(item => item.metadata.type === port.type));
    assert.ok(goldens.every(item => item.metadata.jsEngineHash === port.jsEngineHash));
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

test('reverb reviewed cases pin routing, state, and legacy parameter behavior', async () => {
  const dattorro = await readPort(ports[0]);
  const fdn = await readPort(ports[1]);
  const rs = await readPort(ports[2]);
  assert.equal(dattorro.cases.cases.find(item => item.id === 'eight-channel-routing')
    .channels, 8);
  assert.equal(fdn.cases.cases.find(item => item.id === 'density-five-boundary')
    .params.dt, 5);
  assert.equal(fdn.cases.cases.find(item => item.id === 'eight-channel-shared-tank-96000')
    .channels, 8);
  const ignoredPredelay = rs.cases.cases.find(item =>
    item.id === 'predelay-parameter-ignored');
  assert.ok(ignoredPredelay.events.every(event =>
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
  assert.match(dattorro,
    /pre_delay_samples > 0u && pre_delay_samples < pre_delay_size_/);
  assert.match(dattorro, /input \/= static_cast<double>\(channel_count\)/);

  const fdn = loadedPorts[1].kernel;
  const fdnPrepare = fdn.slice(fdn.indexOf('  void prepare('), fdn.indexOf('  void reset('));
  assert.match(fdnPrepare, /clearRuntimeState\(\)/);
  assert.doesNotMatch(fdnPrepare, /random_\.seed/);
  assert.match(fdn, /random_\.seed\(selected_seed_low_, selected_seed_high_\)/);
  assert.match(fdn,
    /if\s*\(\s*active_channel_count_\s*!=\s*channel_count\s*\)\s*resetPreDelay\s*\(\s*channel_count\s*\)\s*;/);

  const rs = loadedPorts[2].kernel;
  const rsPrepare = rs.slice(rs.indexOf('  void prepare('), rs.indexOf('  void reset('));
  assert.match(rsPrepare, /if \(randomized_delays_ready_\)/);
  assert.match(rsPrepare, /updateActiveCombLengths\(\)/);
  assert.doesNotMatch(rsPrepare, /random_\.seed/);
  assert.doesNotMatch(rs, /params_\.preDelay/);
  assert.match(rs, /comb_line_capacities_\[line\]/);
  assert.match(rs, /comb_line_offsets_\[line\]/);

  assert.match(nativeTest, /allocation_guard::Scope allocation_scope/);
  assert.match(nativeTest, /testExplicitReset\(dattorro/);
  assert.match(nativeTest, /testFdnSampleRateRngTransition/);
  assert.match(nativeTest, /testRsSampleRateTransition/);
  assert.match(nativeTest, /rs_buffer_bytes == 8785920u/);
  assert.match(nativeTest, /rs_buffer_bytes < kRsPayloadBudget/);
  assert.match(cmake, /effetune_dsp_reverb_tests/);
  assert.match(readme, /### RS Reverb Capacity Decision/);
  assert.match(readme, /8,785,920 bytes/);
});
