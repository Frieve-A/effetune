import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBenchCli } from '../../tools/dsp-parity/bench.mjs';
import {
  generateAllGoldens,
  productionNativeRunnerHash,
  requireG726PromotionConformance,
  requireGsmPromotionConformance,
  requireMp3PromotionConformance,
  requireSbcPromotionConformance,
  runGenerateCli
} from '../../tools/dsp-parity/generate.mjs';
import {
  assertMp3LogicalFieldsMatch,
  compareMp3DecoderToProductionPcm,
  decodeMp3LogicalFixture,
  defaultMp3ProductionDiagnosticPath,
  generateMp3ConformanceFixture,
  MP3_CONFORMANCE_FIXTURES,
  MP3_CONFORMANCE_PROVENANCE,
  MP3_SYNTHESIS_PCM_CONVENTION,
  parseMp3ConformanceFixture,
  readMp3ProductionDiagnostic,
  verifyMp3FixtureWithDecoder
} from '../../tools/dsp-parity/mp3-conformance.mjs';
import { loadReferencePlugin } from '../../tools/dsp-parity/node-host.mjs';
import { discoverGoldenTargets, runParityCli } from '../../tools/dsp-parity/run.mjs';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { computeLayoutHash, validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  encodeNativeControl,
  NATIVE_CONTROL_ASSET_HEADER_BYTES,
  NATIVE_CONTROL_ASSET_VERSION,
  NATIVE_CONTROL_HEADER_BYTES,
  NATIVE_CONTROL_STRUCTURED_HEADER_BYTES,
  NATIVE_CONTROL_STRUCTURED_VERSION,
  isNativeDirectReferenceEngine,
  packParams,
  packStructuredParams,
  paramsLayoutHash,
  pinnedNativeDirectReferenceHash,
  runNativeCase,
  seedWords
} from '../../tools/dsp-parity/runners.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('IR direct parity reference uses its v3 identity and pinned source hash', async () => {
  const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'reverb', 'ir_reverb');
  const schema = JSON.parse(await fs.readFile(path.join(pluginRoot, 'params.json'), 'utf8'));
  const index = JSON.parse(await fs.readFile(
    path.join(pluginRoot, 'golden', 'index.json'),
    'utf8'
  ));
  const referenceEngine = 'native-ir-direct-double-v3';
  const referenceHash =
    '774ded205afffa4abe9af33a297fd97a7065cb439183a44cdad3007e4a7a6ff1';

  assert.equal(schema.parityReference, referenceEngine);
  assert.equal(isNativeDirectReferenceEngine(referenceEngine), true);
  assert.equal(isNativeDirectReferenceEngine('native-ir-direct-double-v2'), false);
  assert.equal(pinnedNativeDirectReferenceHash(referenceEngine), referenceHash);
  for (const fileName of index.cases) {
    const metadata = JSON.parse(await fs.readFile(
      path.join(pluginRoot, 'golden', fileName),
      'utf8'
    ));
    assert.equal(metadata.referenceEngine, referenceEngine, fileName);
    assert.equal(metadata.referenceHash, referenceHash, fileName);
  }
});

async function requireMp3ProductionDiagnostic(t) {
  const diagnosticPath = defaultMp3ProductionDiagnosticPath(repoRoot);
  try {
    await fs.access(diagnosticPath);
  } catch {
    t.skip(`MP3 native production diagnostic is unavailable at ${diagnosticPath}`);
    return null;
  }
  return diagnosticPath;
}

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

test('production native promotion rejects implicit generation and never uses the bypass JS reference', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-native-promotion-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const schemaPath = path.join(tempDir, 'params.json');
  const casesPath = path.join(tempDir, 'cases.json');
  const missingRunner = path.join(tempDir, 'missing-native-runner.exe');
  await Promise.all([
    fs.writeFile(schemaPath, JSON.stringify({
      type: 'VolumePlugin',
      parityReference: 'production-native-promoted-v1',
      tolerance: { policy: 'per-sample', abs: 1e-6 },
      fields: [{ name: 'volume', key: 'vl', kind: 'float', min: -60, max: 24, default: 0 }]
    })),
    fs.writeFile(casesPath, JSON.stringify({
      cases: [{ id: 'volume-impulse', stimulus: 'imp', frames: 32, params: { vl: -6 } }]
    }))
  ]);

  await assert.rejects(
    () => runGenerateCli([
      '--root', repoRoot,
      '--type', 'VolumePlugin',
      '--schema', schemaPath,
      '--cases', casesPath
    ], { log() {} }),
    /requires explicit --promote-production-native/
  );
  await assert.rejects(
    () => runGenerateCli([
      '--root', repoRoot,
      '--type', 'VolumePlugin',
      '--schema', schemaPath,
      '--cases', casesPath,
      '--promote-production-native',
      '--native-runner', missingRunner
    ], { log() {} }),
    /Native DSP parity runner is unavailable/
  );
});

test('production native promotion provenance hashes the runner that is actually selected', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-native-runner-hash-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const runnerPath = path.join(tempDir, 'approved-native-runner.bin');
  const bytes = Buffer.from('approved production native runner\n');
  await fs.writeFile(runnerPath, bytes);

  const expected = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  assert.equal(await productionNativeRunnerHash(repoRoot, runnerPath), expected);
  assert.equal(await productionNativeRunnerHash(repoRoot, runnerPath), expected);
});

test('G.726 production-native promotion requires the official conformance gate inputs', () => {
  assert.throws(
    () => requireG726PromotionConformance('G726ADPCMSimulatorPlugin', repoRoot, {
      'promote-production-native': true
    }),
    /requires --g726-vector-dir, --g726-conformance-runner, and --g726-state-digest-file/
  );
  assert.doesNotThrow(() => requireG726PromotionConformance('VolumePlugin', repoRoot, {
    'promote-production-native': true
  }));
});

test('GSM-FR production-native promotion requires Phase 0, ETSI, and independent gates', async () => {
  await assert.rejects(
    () => requireGsmPromotionConformance('GSMFullRateSimulatorPlugin', repoRoot, {
      'promote-production-native': true
    }),
    /requires --gsm-vector-dir, --gsm-conformance-runner, --gsm-reference-codec, and --gsm-phase0-evidence/
  );
  await assert.doesNotReject(() =>
    requireGsmPromotionConformance('VolumePlugin', repoRoot, {
      'promote-production-native': true
    }));
});

test('Bluetooth SBC production-native promotion requires the SIG decoder and round-trip gates', async () => {
  await assert.rejects(
    () => requireSbcPromotionConformance('BluetoothSBCSimulatorPlugin', repoRoot, {
      'promote-production-native': true
    }),
    /requires --sbc-conformance-runner, --sbc-fixture-dir, and --sbc-reference-decoder/
  );
  // The gate is inert for other plugin types and for non-promotion generation, so it can stay
  // wired into the shared promotion path without touching unrelated golden regeneration.
  await assert.doesNotReject(() =>
    requireSbcPromotionConformance('VolumePlugin', repoRoot, {
      'promote-production-native': true
    }));
  await assert.doesNotReject(() =>
    requireSbcPromotionConformance('BluetoothSBCSimulatorPlugin', repoRoot, {}));
});

test('GSM-FR golden generation refuses its pass-through JavaScript shell', async () => {
  await assert.rejects(
    () => runGenerateCli([
      '--root', repoRoot,
      '--type', 'GSMFullRateSimulatorPlugin',
      '--limit-cases', '1'
    ], { log() {} }),
    /requires explicit --promote-production-native/
  );
});

test('G.726 is included in full parity discovery after production promotion', async () => {
  const targets = await discoverGoldenTargets(repoRoot);
  assert.equal(targets.some(target => target.type === 'G726ADPCMSimulatorPlugin'), true);
  await fs.access(path.join(
    repoRoot, 'dsp', 'plugins', 'lofi', 'g726_adpcm_simulator', 'params.json'));
});

test('GSM-FR is included in full parity discovery after production promotion', async () => {
  const targets = await discoverGoldenTargets(repoRoot);
  assert.equal(targets.some(target => target.type === 'GSMFullRateSimulatorPlugin'), true);
  await fs.access(path.join(
    repoRoot, 'dsp', 'plugins', 'lofi', 'gsm_full_rate_simulator', 'golden', 'index.json'));
});

test('MP3 packed conformance fixtures deterministically encode valid MPEG-1 and MPEG-2 frame sequences', async t => {
  const diagnosticPath = await requireMp3ProductionDiagnostic(t);
  if (!diagnosticPath) return;
  assert.equal(MP3_CONFORMANCE_FIXTURES.length, 4);
  assert.equal(MP3_CONFORMANCE_PROVENANCE.redistributedExternalBytes, false);
  assert.match(MP3_CONFORMANCE_PROVENANCE.fixtureOrigin,
    /immutable-native-production-logical-frame/);
  assert.match(MP3_CONFORMANCE_PROVENANCE.syntaxReference, /ISO\/IEC/);
  for (const spec of MP3_CONFORMANCE_FIXTURES) {
    const first = generateMp3ConformanceFixture(spec,
      await readMp3ProductionDiagnostic(spec, diagnosticPath, repoRoot));
    const second = generateMp3ConformanceFixture(spec,
      await readMp3ProductionDiagnostic(spec, diagnosticPath, repoRoot));
    assert.deepEqual(first.bytes, second.bytes, `${spec.id} regeneration changed`);

    const parsed = parseMp3ConformanceFixture(first.bytes);
    assert.equal(parsed.length, 4);
    assert.deepEqual(new Set(parsed.map(frame => frame.paddingSlotBytes)), new Set([0, 1]));
    assert.ok(parsed.every(frame => frame.profile === spec.profile));
    assert.ok(parsed.every(frame => frame.channels === spec.channels));
    assert.ok(parsed.every(frame => frame.jointStereo === spec.jointStereo));
    assert.ok(parsed.every(frame => frame.part23Lengths.every(length => length > 0)));
    assert.ok(parsed.every(frame =>
      frame.pcmSamples === (spec.profile === 'mpeg1' ? 1152 : 576)));
    for (let index = 0; index < parsed.length; index++) {
      assert.equal(parsed[index].frameBytes, first.frames[index].frameBytes);
      assert.equal(parsed[index].physicalMainDataAreaBits,
        first.frames[index].physicalMainDataAreaBits);
      assert.equal(parsed[index].mainDataBegin, first.frames[index].mainDataBegin);
      assert.ok(first.frames[index].logicalAduBits > 0);
      assert.equal(
        first.frames[index].reservoirBeforeBits +
          first.frames[index].physicalMainDataAreaBits,
        first.frames[index].logicalAduBits +
          first.frames[index].reservoirAfterBits +
          first.frames[index].ancillaryBits,
        `${spec.id} frame ${index} does not conserve packed main-data bits`
      );
      if (index + 1 < parsed.length) {
        assert.equal(
          parsed[index + 1].mainDataBegin * 8,
          first.frames[index].reservoirAfterBits,
          `${spec.id} frame ${index} reservoir cursor does not match packed bits`
        );
      }
    }
    if (spec.reservoir) {
      assert.equal(parsed[0].mainDataBegin, 0);
      assert.ok(parsed.slice(1).some(frame => frame.mainDataBegin > 0));
    } else {
      assert.ok(parsed.every(frame => frame.mainDataBegin === 0));
    }
    const logical = decodeMp3LogicalFixture(first.bytes);
    assert.equal(assertMp3LogicalFieldsMatch(first, logical), true);
    assert.ok(first.frames.some(frame => frame.productionDecodedPcm.some(sample => sample !== 0)),
      `${spec.id} production PCM is silent`);
    assert.ok(logical.frames.every(frame => frame.logicalChannels.every(channel =>
      channel.part3Length > 0 && channel.quantized.some(value => value !== 0))));
  }
});

test('MP3 packed conformance parser rejects an impossible reservoir back-pointer', async t => {
  const diagnosticPath = await requireMp3ProductionDiagnostic(t);
  if (!diagnosticPath) return;
  const spec = MP3_CONFORMANCE_FIXTURES[0];
  const fixture = generateMp3ConformanceFixture(spec,
    await readMp3ProductionDiagnostic(spec, diagnosticPath, repoRoot));
  const malformed = fixture.bytes.slice();
  malformed[4] = 0xff;
  malformed[5] |= 0x80;
  assert.throws(() => parseMp3ConformanceFixture(malformed), /back-pointer exceeds/);
});

test('independent decoder accepts every MP3 packed conformance fixture', {
  skip: !process.env.EFFETUNE_MP3_DECODER
}, async t => {
  const diagnosticPath = await requireMp3ProductionDiagnostic(t);
  if (!diagnosticPath) return;
  for (const spec of MP3_CONFORMANCE_FIXTURES) {
    const fixture = generateMp3ConformanceFixture(spec,
      await readMp3ProductionDiagnostic(spec, diagnosticPath, repoRoot));
    const result = await verifyMp3FixtureWithDecoder(
      fixture.bytes,
      process.env.EFFETUNE_MP3_DECODER
    );
    assert.ok(result.pcmSamples > 0, `${spec.id} decoded no PCM samples`);
    assert.ok(result.maximumAbsoluteSample > 1e-6, `${spec.id} decoded to silence`);
    const logical = decodeMp3LogicalFixture(fixture.bytes);
    assert.equal(assertMp3LogicalFieldsMatch(fixture, logical), true);
    const comparison = compareMp3DecoderToProductionPcm(fixture, result);
    assert.ok(comparison.expectedPcmSamples > 0);
    assert.ok(comparison.decodedPcmSamples > 0);
    assert.equal(comparison.knownDecoderDelaySamples,
      MP3_SYNTHESIS_PCM_CONVENTION.knownDecoderDelaySamples);
    assert.equal(comparison.synthesisGain,
      MP3_SYNTHESIS_PCM_CONVENTION.independentDecoderGain);
    // Matches the recalibrated float-state residue bounds in mp3-conformance.mjs
    // (measured max 4.21e-6 / rms 7.17e-7 after the unity-gain synthesis fix).
    assert.ok(comparison.maximumAbsoluteError <= 5e-6);
    assert.ok(comparison.rmsError <= 1e-6);
  }
});

test('MP3 production-native promotion requires the independent decoder hard gate', async () => {
  await assert.rejects(
    requireMp3PromotionConformance('MP3CodecSimulatorPlugin', {
      'promote-production-native': true
    }, {}),
    /requires --mp3-decoder/
  );
  await assert.doesNotReject(requireMp3PromotionConformance('VolumePlugin', {
    'promote-production-native': true
  }));
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

test('native control version 3 carries one asset begin record and payload', () => {
  const schema = {
    type: 'AssetFixturePlugin',
    fields: [{ name: 'gain', key: 'gn', kind: 'float', default: 1 }]
  };
  const assetBytes = Uint8Array.from({ length: 40 }, (_, index) => index);
  const control = encodeNativeControl(schema, {
    sampleRate: 96000,
    frames: 512,
    channels: 2,
    blockSize: 63,
    params: { gn: 0.5 },
    asset: {
      slot: 0,
      format: 1,
      channels: 2,
      frames: 1,
      topology: 2,
      headBlock: 128,
      rateDivider: 2,
      pathCount: 0,
      inputCount: 0,
      bytes: assetBytes
    }
  });
  const view = new DataView(control.buffer, control.byteOffset, control.byteLength);
  assert.equal(view.getUint32(4, true), NATIVE_CONTROL_ASSET_VERSION);
  assert.equal(view.getUint32(32, true), 0);
  assert.equal(view.getUint32(36, true), 0);
  assert.deepEqual(
    Array.from({ length: 10 }, (_, index) => view.getUint32(40 + index * 4, true)),
    [0, 1, 2, 1, 2, 128, 2, 0, 0, assetBytes.byteLength]
  );
  assert.equal(view.getUint32(80, true), 0);
  assert.equal(view.getFloat32(NATIVE_CONTROL_ASSET_HEADER_BYTES, true), 0.5);
  assert.deepEqual(
    [...control.subarray(NATIVE_CONTROL_ASSET_HEADER_BYTES + 4)],
    [...assetBytes]
  );
});

test('parity seeds cross the ABI as two unsigned 32-bit words', () => {
  assert.deepEqual(seedWords(0x123456789abcdef0n), {
    low: 0x9abcdef0,
    high: 0x12345678
  });
  assert.deepEqual(seedWords(0n), { low: 0xeffe7a5e, high: 0 });
});
