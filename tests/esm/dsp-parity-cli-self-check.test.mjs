import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBenchCli } from '../../tools/dsp-parity/bench.mjs';
import { generateAllGoldens, runGenerateCli } from '../../tools/dsp-parity/generate.mjs';
import { loadReferencePlugin } from '../../tools/dsp-parity/node-host.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { computeLayoutHash, validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  encodeNativeControl,
  NATIVE_CONTROL_HEADER_BYTES,
  NATIVE_CONTROL_STRUCTURED_HEADER_BYTES,
  NATIVE_CONTROL_STRUCTURED_VERSION,
  packParams,
  packStructuredParams,
  paramsLayoutHash,
  runNativeCase,
  seedWords
} from '../../tools/dsp-parity/runners.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('generator self-check executes an unported legacy plugin twice deterministically', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-unported-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const pluginsDir = path.join(tempRoot, 'plugins');
  const delayDir = path.join(pluginsDir, 'delay');
  await fs.mkdir(delayDir, { recursive: true });
  await Promise.all([
    fs.copyFile(path.join(repoRoot, 'plugins', 'plugin-base.js'), path.join(pluginsDir, 'plugin-base.js')),
    fs.copyFile(
      path.join(repoRoot, 'plugins', 'delay', 'time_alignment.js'),
      path.join(delayDir, 'time_alignment.js')
    ),
    fs.writeFile(
      path.join(pluginsDir, 'plugins.txt'),
      'delay/time_alignment: Time Alignment | Delay | TimeAlignmentPlugin\n'
    )
  ]);
  const messages = [];
  const result = await runGenerateCli([
    '--root', tempRoot,
    '--type', 'TimeAlignmentPlugin',
    '--self-check',
    '--stimulus', 'noise',
    '--frames', '256'
  ], { log(message) { messages.push(message); } });
  assert.equal(result.selfCheck, true);
  assert.equal(result.caseCount, 1);
  assert.match(messages[0], /^PASS self-check-noise:/);
});

test('JS reference hashes ignore source line-ending differences', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-line-endings-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const pluginsDir = path.join(tempRoot, 'plugins');
  const delayDir = path.join(pluginsDir, 'delay');
  await fs.mkdir(delayDir, { recursive: true });
  const [baseSource, pluginSource] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'plugins', 'plugin-base.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'plugins', 'delay', 'time_alignment.js'), 'utf8')
  ]);
  const basePath = path.join(pluginsDir, 'plugin-base.js');
  const pluginPath = path.join(delayDir, 'time_alignment.js');
  await Promise.all([
    fs.writeFile(basePath, baseSource.replace(/\r\n?/g, '\n')),
    fs.writeFile(pluginPath, pluginSource.replace(/\r\n?/g, '\n')),
    fs.writeFile(
      path.join(pluginsDir, 'plugins.txt'),
      'delay/time_alignment: Time Alignment | Delay | TimeAlignmentPlugin\n'
    )
  ]);
  const lf = await loadReferencePlugin('TimeAlignmentPlugin', { repoRoot: tempRoot });

  await Promise.all([
    fs.writeFile(basePath, baseSource.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n')),
    fs.writeFile(pluginPath, pluginSource.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'))
  ]);
  const crlf = await loadReferencePlugin('TimeAlignmentPlugin', { repoRoot: tempRoot });

  assert.equal(crlf.jsEngineHash, lf.jsEngineHash);
});

test('JS benchmark mode reports a finite realtime factor without DSP artifacts', async () => {
  const result = await runBenchCli([
    '--root', repoRoot,
    '--type', 'VolumePlugin',
    '--modes', 'js',
    '--sample-rates', '48000',
    '--channels', '2',
    '--duration', '0.01',
    '--warmup', '0',
    '--repetitions', '1'
  ], { log() {} });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].mode, 'js');
  assert.ok(Number.isFinite(result.results[0].realtimeFactor));
  assert.ok(result.results[0].realtimeFactor > 0);
});

test('generated golden files pass the legacy self-check runner', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-cli-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const schemaPath = path.join(tempDir, 'params.json');
  const casesPath = path.join(tempDir, 'cases.json');
  const goldenDir = path.join(tempDir, 'golden');
  await fs.writeFile(schemaPath, JSON.stringify({
    type: 'VolumePlugin',
    tolerance: { policy: 'per-sample', abs: 1e-6 },
    fields: [{ name: 'volume', key: 'vl', kind: 'float', min: -60, max: 24, default: 0 }]
  }));
  await fs.writeFile(casesPath, JSON.stringify({
    cases: [{ id: 'volume-impulse', stimulus: 'imp', frames: 256, params: { vl: -6 } }]
  }));

  const generated = await runGenerateCli([
    '--root', repoRoot,
    '--type', 'VolumePlugin',
    '--schema', schemaPath,
    '--cases', casesPath,
    '--output', goldenDir
  ], { log() {} });
  assert.equal(generated.caseCount, 1);

  const checked = await runParityCli([
    '--root', repoRoot,
    '--type', 'VolumePlugin',
    '--schema', schemaPath,
    '--golden', goldenDir,
    '--self-check'
  ], { log() {} });
  assert.equal(checked.results.length, 1);
  assert.equal(checked.results[0].comparison.pass, true);
});

async function createTwoPluginParityFixture(t) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-all-types-'));
  t.after(() => fs.rm(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 25
  }));
  const pluginsDir = path.join(tempRoot, 'plugins');
  const pluginBasicsDir = path.join(pluginsDir, 'basics');
  const dspBasicsDir = path.join(tempRoot, 'dsp', 'plugins', 'basics');
  const basePath = path.join(pluginsDir, 'plugin-base.js');
  const muteCasesPath = path.join(dspBasicsDir, 'mute', 'cases.json');
  const volumeCasesPath = path.join(dspBasicsDir, 'volume', 'cases.json');
  await Promise.all([
    fs.mkdir(pluginBasicsDir, { recursive: true }),
    fs.mkdir(path.join(dspBasicsDir, 'mute'), { recursive: true }),
    fs.mkdir(path.join(dspBasicsDir, 'skipped'), { recursive: true }),
    fs.mkdir(path.join(dspBasicsDir, 'volume'), { recursive: true })
  ]);
  await Promise.all([
    fs.copyFile(path.join(repoRoot, 'plugins', 'plugin-base.js'), basePath),
    fs.copyFile(path.join(repoRoot, 'plugins', 'basics', 'mute.js'), path.join(pluginBasicsDir, 'mute.js')),
    fs.copyFile(path.join(repoRoot, 'plugins', 'basics', 'volume.js'), path.join(pluginBasicsDir, 'volume.js')),
    fs.writeFile(path.join(pluginsDir, 'plugins.txt'), [
      'basics/mute: Mute | Basics | MutePlugin',
      'basics/volume: Volume | Basics | VolumePlugin',
      ''
    ].join('\n')),
    fs.writeFile(path.join(dspBasicsDir, 'mute', 'params.json'), JSON.stringify({
      type: 'MutePlugin',
      tolerance: { policy: 'per-sample', abs: 0 },
      fields: []
    })),
    fs.writeFile(muteCasesPath, JSON.stringify({
      cases: [{ id: 'mute-impulse', stimulus: 'imp', frames: 32, blockSize: 16 }]
    })),
    fs.writeFile(path.join(dspBasicsDir, 'volume', 'params.json'), JSON.stringify({
      type: 'VolumePlugin',
      tolerance: { policy: 'per-sample', abs: 1e-6 },
      fields: [{ name: 'volume', key: 'vl', kind: 'float', min: -60, max: 24, default: 0 }]
    })),
    fs.writeFile(volumeCasesPath, JSON.stringify({
      cases: [{ id: 'volume-impulse', stimulus: 'imp', frames: 32, blockSize: 16 }]
    })),
    fs.writeFile(path.join(dspBasicsDir, 'skipped', 'params.json'), JSON.stringify({
      type: 'SkippedPlugin',
      fields: []
    }))
  ]);
  return {
    tempRoot,
    basePath,
    muteCasesPath,
    volumeCasesPath,
    guardPath: path.join(tempRoot, 'dsp', 'plugins', 'golden-base-hash.json'),
    muteGoldenDir: path.join(dspBasicsDir, 'mute', 'golden'),
    volumeGoldenDir: path.join(dspBasicsDir, 'volume', 'golden')
  };
}

async function snapshotTree(root) {
  const snapshot = {};
  const pending = [''];
  while (pending.length > 0) {
    const relativeDirectory = pending.pop();
    const directory = path.join(root, relativeDirectory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) pending.push(relativePath);
      else snapshot[relativePath] = await fs.readFile(path.join(root, relativePath));
    }
  }
  return snapshot;
}

async function snapshotCommittedGoldens(fixture) {
  return {
    mute: await snapshotTree(fixture.muteGoldenDir),
    volume: await snapshotTree(fixture.volumeGoldenDir),
    guard: await fs.readFile(fixture.guardPath)
  };
}

test('parity CLI discovers every DSP schema with a committed golden set when type is omitted', async t => {
  const { tempRoot } = await createTwoPluginParityFixture(t);

  for (const type of ['MutePlugin', 'VolumePlugin']) {
    await runGenerateCli(['--root', tempRoot, '--type', type], { log() {} });
  }
  const generated = await runGenerateCli(['--root', tempRoot, '--all'], { log() {} });
  assert.deepEqual(generated.types, ['MutePlugin', 'VolumePlugin']);
  const messages = [];
  const checked = await runParityCli([
    '--root', tempRoot,
    '--self-check'
  ], { log(message) { messages.push(message); } });

  assert.deepEqual(checked.types, ['MutePlugin', 'VolumePlugin']);
  assert.deepEqual(checked.results.map(result => result.type), ['MutePlugin', 'VolumePlugin']);
  assert.equal(checked.results.every(result => result.comparison.pass), true);
  assert.equal(messages.some(message => message.includes('MutePlugin/mute-impulse')), true);
  assert.equal(messages.some(message => message.includes('VolumePlugin/volume-impulse')), true);
});

test('shared plugin base guard advances only after complete all-golden generation', async t => {
  const fixture = await createTwoPluginParityFixture(t);
  const { tempRoot, basePath, volumeCasesPath, guardPath } = fixture;
  await assert.rejects(
    () => runGenerateCli(['--root', tempRoot, '--all', '--limit-cases', '1'], { log() {} }),
    /--all cannot be combined with --limit-cases/
  );

  for (const type of ['MutePlugin', 'VolumePlugin']) {
    await runGenerateCli(['--root', tempRoot, '--type', type], { log() {} });
  }
  await assert.rejects(() => fs.access(guardPath), error => error.code === 'ENOENT');
  await runGenerateCli(['--root', tempRoot, '--all'], { log() {} });
  const originalGuard = await fs.readFile(guardPath, 'utf8');

  const baseSource = await fs.readFile(basePath, 'utf8');
  await fs.writeFile(basePath, `${baseSource}\n// Updated base revision for the freshness test.\n`);
  await runGenerateCli([
    '--root', tempRoot,
    '--type', 'MutePlugin',
    '--limit-cases', '1',
    '--output', path.join(tempRoot, 'partial-golden')
  ], { log() {} });
  assert.equal(await fs.readFile(guardPath, 'utf8'), originalGuard);
  await assert.rejects(
    () => runParityCli([
      '--root', tempRoot,
      '--type', 'VolumePlugin',
      '--self-check'
    ], { log() {} }),
    /plugin-base\.js changed since goldens were generated/
  );

  const volumeCases = await fs.readFile(volumeCasesPath, 'utf8');
  const beforeFailedGeneration = await snapshotCommittedGoldens(fixture);
  await fs.writeFile(volumeCasesPath, '{');
  await assert.rejects(
    () => runGenerateCli(['--root', tempRoot, '--all'], { log() {} })
  );
  assert.deepEqual(await snapshotCommittedGoldens(fixture), beforeFailedGeneration);

  const muteCases = JSON.parse(await fs.readFile(fixture.muteCasesPath, 'utf8'));
  muteCases.cases[0].id = 'mute-impulse-updated';
  const restoredVolumeCases = JSON.parse(volumeCases);
  restoredVolumeCases.cases[0].id = 'volume-impulse-updated';
  await Promise.all([
    fs.writeFile(fixture.muteCasesPath, JSON.stringify(muteCases)),
    fs.writeFile(volumeCasesPath, JSON.stringify(restoredVolumeCases))
  ]);
  await runGenerateCli(['--root', tempRoot, '--all'], { log() {} });
  const afterSuccessfulGeneration = await snapshotCommittedGoldens(fixture);
  assert.notDeepEqual(afterSuccessfulGeneration.mute, beforeFailedGeneration.mute);
  assert.notDeepEqual(afterSuccessfulGeneration.volume, beforeFailedGeneration.volume);
  assert.notDeepEqual(afterSuccessfulGeneration.guard, beforeFailedGeneration.guard);
  assert.notEqual(await fs.readFile(guardPath, 'utf8'), originalGuard);
  const checked = await runParityCli([
    '--root', tempRoot,
    '--self-check'
  ], { log() {} });
  assert.equal(checked.results.every(result => result.comparison.pass), true);
});

test('all-golden promotion rolls earlier replacements back when a later rename fails', async t => {
  const fixture = await createTwoPluginParityFixture(t);
  for (const type of ['MutePlugin', 'VolumePlugin']) {
    await runGenerateCli(['--root', fixture.tempRoot, '--type', type], { log() {} });
  }
  await runGenerateCli(['--root', fixture.tempRoot, '--all'], { log() {} });
  const beforePromotion = await snapshotCommittedGoldens(fixture);
  const baseSource = await fs.readFile(fixture.basePath, 'utf8');
  await fs.writeFile(fixture.basePath, `${baseSource}\n// Force different staged golden metadata.\n`);

  let injected = false;
  const rename = async (source, destination) => {
    if (!injected && destination === fixture.guardPath && source.includes('.golden-all-')) {
      injected = true;
      throw new Error('Injected promotion failure');
    }
    await fs.rename(source, destination);
  };
  await assert.rejects(
    () => generateAllGoldens({ repoRoot: fixture.tempRoot, log() {}, rename }),
    /Failed to promote the complete DSP golden set/
  );
  assert.equal(injected, true);
  assert.deepEqual(await snapshotCommittedGoldens(fixture), beforePromotion);
});

test('all-golden generation leaves committed bytes unchanged when a later set exceeds its budget', async t => {
  const fixture = await createTwoPluginParityFixture(t);
  for (const type of ['MutePlugin', 'VolumePlugin']) {
    await runGenerateCli(['--root', fixture.tempRoot, '--type', type], { log() {} });
  }
  await runGenerateCli(['--root', fixture.tempRoot, '--all'], { log() {} });
  const beforeGeneration = await snapshotCommittedGoldens(fixture);
  const volumeCases = JSON.parse(await fs.readFile(fixture.volumeCasesPath, 'utf8'));
  volumeCases.cases[0].frames = 256;
  await fs.writeFile(fixture.volumeCasesPath, JSON.stringify(volumeCases));

  await assert.rejects(
    () => runGenerateCli([
      '--root', fixture.tempRoot,
      '--all',
      '--budget', '1000'
    ], { log() {} }),
    /exceeding the 1,000-byte budget/
  );
  assert.deepEqual(await snapshotCommittedGoldens(fixture), beforeGeneration);
});

test('native runner hook names the missing executable and required build action', async () => {
  const missing = path.join(repoRoot, 'tmp', 'does-not-exist', 'parity-runner');
  await assert.rejects(
    () => runNativeCase({
      type: 'VolumePlugin',
      testCase: { sampleRate: 48000, frames: 1, channels: 1, blockSize: 1, params: {} },
      input: Float32Array.of(1),
      runnerPath: missing,
      repoRoot
    }),
    error => {
      assert.match(error.message, /Native DSP parity runner is unavailable/);
      assert.match(error.message, /Build the DSP artifacts/);
      assert.match(error.message, /parity-runner/);
      return true;
    }
  );
});

test('parity layout hash matches canonical enum values and order', async () => {
  const schemaPath = path.join(
    repoRoot,
    'dsp',
    'plugins',
    'lofi',
    'digital_error_emulator',
    'params.json'
  );
  const schema = validateParamSpec(
    JSON.parse(await fs.readFile(schemaPath, 'utf8')),
    schemaPath
  );
  const hash = paramsLayoutHash(schema);
  const generated = DSP_PARAM_PACKERS.get(schema.type);
  const metadata = JSON.parse(await fs.readFile(
    path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.meta.json'),
    'utf8'
  ));

  assert.equal(hash, computeLayoutHash(schema.fields, schema.structured));
  assert.equal(hash, generated.hash);
  assert.equal(hash, metadata.kernels.find(kernel => kernel.name === schema.type).hash);

  const enumIndex = schema.fields.findIndex(field => field.kind === 'enum');
  assert.notEqual(enumIndex, -1);
  const withEnumValues = values => ({
    ...schema,
    fields: schema.fields.map((field, index) =>
      index === enumIndex ? { ...field, values } : field)
  });
  const enumValues = schema.fields[enumIndex].values;
  assert.notEqual(paramsLayoutHash(withEnumValues([...enumValues].reverse())), hash);
  assert.notEqual(paramsLayoutHash(withEnumValues([...enumValues, 'changed-value'])), hash);
});

test('native control packs initial parameters and cumulative events without schema parsing', () => {
  const schema = {
    type: 'FixturePlugin',
    fields: [
      { name: 'gain', key: 'gn', kind: 'float', count: 1, default: 1 },
      { name: 'enabledBand', key: 'enb', kind: 'bool', count: 1, default: false }
    ]
  };
  const control = encodeNativeControl(schema, {
    sampleRate: 48000,
    frames: 256,
    channels: 2,
    blockSize: 128,
    params: { gn: 2, enb: false },
    events: [
      { frame: 64, params: { gn: 3 } },
      { frame: 192, params: { enb: true } }
    ]
  });
  const view = new DataView(control.buffer, control.byteOffset, control.byteLength);
  assert.equal(control.subarray(0, 4).toString('ascii'), 'ETPC');
  assert.equal(view.getUint32(4, true), 1);
  assert.equal(view.getFloat32(8, true), 48000);
  assert.equal(view.getUint32(12, true), 256);
  assert.equal(view.getUint32(16, true), 2);
  assert.equal(view.getUint32(20, true), 128);
  assert.equal(view.getUint32(28, true), 2);
  assert.equal(view.getUint32(32, true), 2);
  let offset = NATIVE_CONTROL_HEADER_BYTES;
  assert.equal(view.getFloat32(offset, true), 2);
  assert.equal(view.getFloat32(offset + 4, true), 0);
  offset += 8;
  assert.equal(view.getUint32(offset, true), 64);
  assert.equal(view.getFloat32(offset + 4, true), 3);
  assert.equal(view.getFloat32(offset + 8, true), 0);
  offset += 12;
  assert.equal(view.getUint32(offset, true), 192);
  assert.equal(view.getFloat32(offset + 4, true), 3);
  assert.equal(view.getFloat32(offset + 8, true), 1);
  assert.equal(control.byteLength, offset + 12);
});

test('parity packing reads object arrays with flat fallback and nested defaults', () => {
  const schema = {
    type: 'ObjectArrayFixturePlugin',
    fields: [
      {
        name: 'drive', key: 'dr', objectArrayKey: 'bands', memberKey: 'dr',
        kind: 'float', count: 3, default: [1, 2, 3]
      },
      {
        name: 'enabledBand', key: 'en', objectArrayKey: 'bands', memberKey: 'en',
        kind: 'bool', count: 3, default: true
      },
      {
        name: 'trim', key: 'tr', arrayKey: 'trims',
        kind: 'float', count: 3, default: 0
      }
    ]
  };
  assert.deepEqual([...packParams(schema, {
    bands: [
      { dr: 0.25, en: false },
      { dr: 1.25, en: true },
      { dr: 2.25, en: 0 }
    ],
    trims: new Float32Array([4, 5, 6])
  })], [0.25, 1.25, 2.25, 0, 1, 0, 4, 5, 6]);
  assert.deepEqual([...packParams(schema, {
    dr0: 0.5,
    dr1: 1.5,
    dr2: 2.5,
    en0: false,
    en1: 0,
    en2: true,
    tr0: 7,
    tr1: 8,
    tr2: 9
  })], [0.5, 1.5, 2.5, 0, 0, 1, 7, 8, 9]);
  assert.deepEqual([...packParams(schema, {
    bands: [{ dr: 0.75 }],
    dr1: 5,
    en0: false
  })], [0.75, 2, 3, 1, 1, 1, 0, 0, 0]);
});

test('native control version 2 carries bounded structured parameter events', () => {
  const schema = {
    type: 'MatrixPlugin',
    fields: [],
    structured: {
      name: 'matrixRoutes',
      key: 'mx',
      codec: 'matrix-routes-v1',
      maxItems: 1024,
      default: '0011'
    }
  };
  assert.deepEqual([...packStructuredParams(schema, { mx: '00p11' })], [
    1, 0, 2, 0, 0, 0, 0, 1, 1, 1
  ]);
  const control = encodeNativeControl(schema, {
    sampleRate: 48000,
    frames: 128,
    channels: 2,
    blockSize: 128,
    params: { mx: '0011' },
    events: [{ frame: 64, params: { mx: 'p00' } }]
  });
  const view = new DataView(control.buffer, control.byteOffset, control.byteLength);
  assert.equal(view.getUint32(4, true), NATIVE_CONTROL_STRUCTURED_VERSION);
  assert.equal(view.getUint32(28, true), 0);
  assert.equal(view.getUint32(32, true), 10);
  assert.equal(view.getUint32(36, true), 1);
  let offset = NATIVE_CONTROL_STRUCTURED_HEADER_BYTES;
  assert.deepEqual([...control.subarray(offset, offset + 10)], [
    1, 0, 2, 0, 0, 0, 0, 1, 1, 0
  ]);
  offset += 10;
  assert.equal(view.getUint32(offset, true), 64);
  offset += 4;
  assert.equal(view.getUint32(offset, true), 7);
  offset += 4;
  assert.deepEqual([...control.subarray(offset)], [1, 0, 1, 0, 0, 0, 1]);
});

test('parity seeds cross the ABI as two unsigned 32-bit words', () => {
  assert.deepEqual(seedWords(0x123456789abcdef0n), {
    low: 0x9abcdef0,
    high: 0x12345678
  });
  assert.deepEqual(seedWords(0n), { low: 0xeffe7a5e, high: 0 });
});
