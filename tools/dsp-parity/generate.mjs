import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseArgs, positiveInteger, isMain, formatBytes } from './cli.mjs';
import {
  DEFAULT_REPO_ROOT,
  buildDefaultCaseMatrix,
  discoverCasePlan,
  findPluginDefinition
} from './cases.mjs';
import {
  createGoldenArtifacts,
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet,
  writeGoldenSet
} from './golden-io.mjs';
import { createReferenceSession, executeReferenceCase } from './node-host.mjs';
import {
  defaultNativeRunnerPath,
  isNativeDirectReferenceEngine,
  isProductionNativePromotedReferenceEngine,
  runNativeCase,
  runNativeReferenceCase
} from './runners.mjs';
import { discoverGoldenTargets } from './run.mjs';
import { generateStimulus, noiseSeedForCase, STIMULUS_IDS } from './stimuli.mjs';
import { comparePerSample, formatComparison } from './tolerance.mjs';
import {
  assertMp3LogicalFieldsMatch,
  compareMp3DecoderToProductionPcm,
  decodeMp3LogicalFixture,
  generateMp3ConformanceFixture,
  MP3_CONFORMANCE_FIXTURES,
  readMp3ProductionDiagnostic,
  verifyMp3FixtureWithDecoder
} from './mp3-conformance.mjs';

const TUBE_SIMULATOR_TYPE = 'TubeSimulatorPlugin';
const G726_SIMULATOR_TYPE = 'G726ADPCMSimulatorPlugin';
const GSM_FULL_RATE_SIMULATOR_TYPE = 'GSMFullRateSimulatorPlugin';
const MP3_SIMULATOR_TYPE = 'MP3CodecSimulatorPlugin';
const BLUETOOTH_SBC_SIMULATOR_TYPE = 'BluetoothSBCSimulatorPlugin';

// The Bluetooth SIG SBC conformance packages are not redistributable, so the promotion gate pins the
// isolated official inputs by digest instead of storing them. These digests identify the exact
// fixtures the recorded gate was accepted against; a mismatch means
// the operator re-derived different material and the recorded gate no longer applies.
const SBC_CONFORMANCE_FIXTURES = Object.freeze([
  Object.freeze({
    file: 'stereo.sbc',
    label: 'Stereo isolated frame',
    sha256: 'b7101cf4b266fe5cdc80cd3b3db87157e8430bbdaa2b823264ab34456d7140d2'
  }),
  Object.freeze({
    file: 'stereo.wav',
    label: 'Stereo official decoder output',
    sha256: '42990589f026c94a760f115866f8b7c5046a2eac0e61b27736e295f853a3e844'
  }),
  Object.freeze({
    file: 'joint.sbc',
    label: 'Joint Stereo isolated frame',
    sha256: '8199d53d39e202207e215067636539fa1ee329055eaed1db14fabec2e8a447a2'
  }),
  Object.freeze({
    file: 'joint.wav',
    label: 'Joint Stereo official decoder output',
    sha256: '000cfc79bcb68db4777b236da5faad6a694206d23d16ac9c89ad63b3b5722cf5'
  })
]);

function usage() {
  return [
    'Usage: node tools/dsp-parity/generate.mjs (--type <PluginType> | --all) [options]',
    '  --all                  regenerate every existing golden set and update the shared base guard',
    '  --promote-production-native  explicitly use the production native kernel as the approved reference',
    '  --g726-vector-dir <path>      official Appendix II root required for G.726 promotion',
    '  --g726-conformance-runner <path>  G.726 native conformance test required for promotion',
    '  --g726-state-digest-file <path>   external STL state digests required for G.726 promotion',
    '  --gsm-vector-dir <path>       official ETSI GSM-FR sequence root required for promotion',
    '  --gsm-conformance-runner <path>  GSM-FR native conformance test required for promotion',
    '  --gsm-reference-codec <path>  independent FFmpeg/libgsm executable required for promotion',
    '  --gsm-phase0-evidence <path>  accepted GSM-FR Phase 0 result JSON required for promotion',
    '  --mp3-decoder <path>          independent MP3 decoder required for MP3 promotion',
    '  --mp3-diagnostic-runner <path> MP3 native production diagnostic required for promotion',
    '  --sbc-conformance-runner <path>  Bluetooth SBC native conformance test required for promotion',
    '  --sbc-fixture-dir <path>      isolated official SIG SBC/WAV conformance inputs required for promotion',
    '  --sbc-reference-decoder <path>  official v1.5 SBC decoder required for the encoder round trip',
    '  --self-check           execute the JS reference twice without requiring a DSP schema',
    '  --schema <path>        override params.json discovery',
    '  --cases <path>         override cases.json discovery',
    '  --output <directory>   override the plugin golden directory',
    '  --stimulus <id>        restrict generation to one standard stimulus',
    '  --frames <count>       override case lengths (useful for a quick self-check)',
    '  --limit-cases <count>  process only the first cases',
    '  --budget <bytes>       golden budget (default 2 MiB)'
  ].join('\n');
}

async function nativeDirectReferenceHash(repoRoot, referenceEngine) {
  // These v1 identities predate per-engine hashing; a semantic change requires a new version.
  if (referenceEngine === 'native-ir-direct-double-v1') {
    return 'ebb984943707d4c0ba8839367722c6250b22bea01dd7479fca2a5b2e720244d7';
  }
  if (referenceEngine === 'native-room-eq-direct-double-v1') {
    return '83045565caf287233033c9a0221826e637f07068df1af63eb59cb246b274133f';
  }
  const source = await fs.readFile(path.join(repoRoot, 'dsp', 'test', 'parity_runner.cpp'), 'utf8');
  return crypto.createHash('sha256').update(source.replace(/\r\n?/g, '\n')).digest('hex');
}

export async function productionNativeRunnerHash(repoRoot, runnerPath) {
  const resolvedRunner = path.resolve(
    repoRoot,
    runnerPath ?? defaultNativeRunnerPath(repoRoot)
  );
  let bytes;
  try {
    bytes = await fs.readFile(resolvedRunner);
  } catch (error) {
    throw new Error(
      `Native DSP parity runner is unavailable at ${resolvedRunner}. Build the native DSP runner before promotion.`,
      { cause: error }
    );
  }
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function productionNativeGenerationCommand(type) {
  if (type === G726_SIMULATOR_TYPE) {
    return `node tools/dsp-parity/generate.mjs --type ${type} --promote-production-native ` +
      '--g726-vector-dir <official-appendix-ii-root> ' +
      '--g726-conformance-runner <native-conformance-test> ' +
      '--g726-state-digest-file <external-stl-state-digests>';
  }
  if (type === GSM_FULL_RATE_SIMULATOR_TYPE) {
    return `node tools/dsp-parity/generate.mjs --type ${type} --promote-production-native ` +
      '--gsm-vector-dir <official-etsi-gsm-fr-root> ' +
      '--gsm-conformance-runner <native-conformance-test> ' +
      '--gsm-reference-codec <independent-ffmpeg-libgsm> ' +
      '--gsm-phase0-evidence <accepted-phase0-result-json>';
  }
  if (type === MP3_SIMULATOR_TYPE) {
    return `node tools/dsp-parity/generate.mjs --type ${type} --promote-production-native ` +
      '--mp3-decoder <independent-mp3-decoder>';
  }
  return `node tools/dsp-parity/generate.mjs --type ${type} --promote-production-native`;
}

export async function requireMp3PromotionConformance(type, args, environment = process.env,
  repoRoot = DEFAULT_REPO_ROOT) {
  if (type !== MP3_SIMULATOR_TYPE || args['promote-production-native'] !== true) return;
  const decoder = args['mp3-decoder'] ?? environment.EFFETUNE_MP3_DECODER;
  if (!decoder) {
    throw new Error(
      'MP3 golden promotion requires --mp3-decoder so all non-zero syntax families pass the independent decoder hard gate'
    );
  }
  const diagnosticRunner = args['mp3-diagnostic-runner'] ??
    environment.EFFETUNE_MP3_DIAGNOSTIC;
  const coverage = {
    tables: new Set(), usesLinbits: false, usesCount1: false, usesMultipleRegions: false,
    usesScfsi: false, lsfLong: false, lsfShort: false,
    maximumAbsoluteError: 0, maximumRmsError: 0
  };
  for (const spec of MP3_CONFORMANCE_FIXTURES) {
    const production = await readMp3ProductionDiagnostic(spec, diagnosticRunner, repoRoot);
    const fixture = generateMp3ConformanceFixture(spec, production);
    const parsed = decodeMp3LogicalFixture(fixture.bytes);
    if (!parsed.frames.every(frame => frame.logicalChannels.every(channel =>
      channel.part3Length > 0 && channel.quantized.some(value => value !== 0)))) {
      throw new Error(`MP3 conformance fixture ${spec.id} lacks non-zero logical coding fields`);
    }
    assertMp3LogicalFieldsMatch(fixture, parsed);
    for (const frame of parsed.frames) {
      coverage.usesScfsi ||= frame.scfsi.some(value => value !== 0);
      for (const channel of frame.logicalChannels) {
        coverage.usesCount1 ||= channel.count1 > 0;
        coverage.lsfLong ||= frame.profile === 'mpeg2' && channel.blockType === 0;
        coverage.lsfShort ||= frame.profile === 'mpeg2' && channel.blockType === 2;
        const points = channel.blockType === 0
          ? [0, ...channel.boundaryLines, channel.bigValues * 2]
          : [0, channel.boundaryLines[0], channel.bigValues * 2];
        let usedRegions = 0;
        for (let region = 0; region + 1 < points.length; region++) {
          if (points[region] === points[region + 1]) continue;
          usedRegions++;
          const table = channel.tableSelect[region];
          coverage.tables.add(table);
          if (table >= 16) {
            for (let line = points[region]; line < points[region + 1]; line++) {
              if (Math.abs(channel.quantized[line]) >= 15) coverage.usesLinbits = true;
            }
          }
        }
        coverage.usesMultipleRegions ||= usedRegions > 1;
      }
    }
    const decoded = await verifyMp3FixtureWithDecoder(fixture.bytes, decoder);
    const comparison = compareMp3DecoderToProductionPcm(fixture, decoded);
    coverage.maximumAbsoluteError = Math.max(
      coverage.maximumAbsoluteError, comparison.maximumAbsoluteError);
    coverage.maximumRmsError = Math.max(coverage.maximumRmsError, comparison.rmsError);
  }
  if (coverage.tables.size < 3 || !coverage.usesLinbits || !coverage.usesCount1 ||
      !coverage.usesMultipleRegions || !coverage.usesScfsi || !coverage.lsfLong ||
      !coverage.lsfShort) {
    throw new Error('MP3 production fixtures do not cover Huffman/linbits/count1/regions/SCFSI and LSF long+short syntax');
  }
  return { ...coverage, tables: [...coverage.tables].sort((first, second) => first - second) };
}

export function requireG726PromotionConformance(type, repoRoot, args) {
  if (type !== G726_SIMULATOR_TYPE || args['promote-production-native'] !== true) return;
  const vectorDir = args['g726-vector-dir'];
  const runner = args['g726-conformance-runner'];
  const stateDigestFile = args['g726-state-digest-file'];
  if (!vectorDir || !runner || !stateDigestFile) {
    throw new Error(
      'G.726 golden promotion requires --g726-vector-dir, --g726-conformance-runner, and --g726-state-digest-file so official output and independent STL state are hard gates'
    );
  }
  const resolvedRunner = path.resolve(repoRoot, runner);
  const result = spawnSync(resolvedRunner, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      EFFETUNE_G726_VECTOR_DIR: path.resolve(repoRoot, vectorDir),
      EFFETUNE_G726_STATE_DIGEST_FILE: path.resolve(repoRoot, stateDigestFile),
      EFFETUNE_G726_REQUIRE_STATE_EXACT: '1'
    },
    encoding: 'utf8'
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || '').trim();
    throw new Error(`G.726 official output/state conformance gate failed${detail ? `: ${detail}` : ''}`);
  }
}

function runGsmReferenceCodec(executable, arguments_, label) {
  const result = spawnSync(executable, arguments_, {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8').trim()
      : String(result.stderr || result.error?.message || '').trim();
    throw new Error(`GSM-FR independent reference ${label} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function requireAcceptedGsmPhase0(evidence, source) {
  const trials = evidence?.benchmark?.results?.flatMap(result => result.cpuTrials ?? []) ?? [];
  if (evidence?.gate !== 'gsm-full-rate-realtime-v1' || evidence.valid !== true ||
      evidence.passed !== true || evidence.thresholds?.hardLimitPercent !== 15 ||
      trials.length !== 18 || trials.some(trial =>
        !Number.isFinite(trial.cpuUtilizationPercent) || trial.cpuUtilizationPercent >= 15)) {
    throw new Error(`GSM-FR Phase 0 evidence is not an accepted 18-trial result: ${source}`);
  }
}

export async function requireGsmPromotionConformance(type, repoRoot, args) {
  if (type !== GSM_FULL_RATE_SIMULATOR_TYPE ||
      args['promote-production-native'] !== true) return;
  const vectorDir = args['gsm-vector-dir'];
  const runner = args['gsm-conformance-runner'];
  const referenceCodec = args['gsm-reference-codec'];
  const evidencePath = args['gsm-phase0-evidence'];
  if (!vectorDir || !runner || !referenceCodec || !evidencePath) {
    throw new Error(
      'GSM-FR golden promotion requires --gsm-vector-dir, --gsm-conformance-runner, --gsm-reference-codec, and --gsm-phase0-evidence so official bit-exact conformance, an independent codec, and accepted Phase 0 performance are hard gates'
    );
  }

  const resolvedVectorDir = path.resolve(repoRoot, vectorDir);
  const resolvedRunner = path.resolve(repoRoot, runner);
  const resolvedReference = path.resolve(repoRoot, referenceCodec);
  const resolvedEvidence = path.resolve(repoRoot, evidencePath);
  let evidence;
  try {
    evidence = JSON.parse(await fs.readFile(resolvedEvidence, 'utf8'));
  } catch (error) {
    throw new Error(`GSM-FR Phase 0 evidence is unavailable or invalid: ${resolvedEvidence}`,
      { cause: error });
  }
  requireAcceptedGsmPhase0(evidence, resolvedEvidence);

  const conformance = spawnSync(resolvedRunner, [], {
    cwd: repoRoot,
    env: { ...process.env, ETSI_GSM_FR_VECTOR_DIR: resolvedVectorDir },
    encoding: 'utf8',
    windowsHide: true
  });
  if (conformance.error || conformance.status !== 0) {
    const detail =
      (conformance.stderr || conformance.stdout || conformance.error?.message || '').trim();
    throw new Error(
      `GSM-FR official ETSI encoder/decoder conformance gate failed${detail ? `: ${detail}` : ''}`
    );
  }

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-gsm-promotion-'));
  try {
    for (let sequence = 1; sequence <= 4; sequence++) {
      const stem = `Seq0${sequence}`;
      const officialPacked = path.join(temporaryRoot, `${stem}.gsm`);
      const packed = spawnSync(resolvedRunner,
        ['--write-packed', officialPacked, String(sequence)], {
          cwd: repoRoot,
          env: { ...process.env, ETSI_GSM_FR_VECTOR_DIR: resolvedVectorDir },
          encoding: 'utf8',
          windowsHide: true
        });
      if (packed.error || packed.status !== 0) {
        const detail = (packed.stderr || packed.stdout || packed.error?.message || '').trim();
        throw new Error(
          `GSM-FR official packed-frame adapter failed for ${stem}${detail ? `: ${detail}` : ''}`
        );
      }
      const encoded = runGsmReferenceCodec(resolvedReference, [
        '-v', 'error', '-f', 's16le', '-ar', '8000', '-ac', '1',
        '-i', path.join(resolvedVectorDir, `${stem}.inp`),
        '-c:a', 'libgsm', '-f', 'gsm', 'pipe:1'
      ], `encoder ${stem}`);
      const expected = await fs.readFile(officialPacked);
      if (!encoded.equals(expected)) {
        throw new Error(`GSM-FR independent reference encoder disagrees with ${stem}`);
      }
    }

    const sequence3Packed = path.join(temporaryRoot, 'Seq03.gsm');
    const decoded = runGsmReferenceCodec(resolvedReference, [
      '-v', 'error', '-f', 'gsm', '-i', sequence3Packed,
      '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'
    ], 'decoder Seq03');
    const expectedDecoded = await fs.readFile(path.join(resolvedVectorDir, 'Seq03.out'));
    if (!decoded.equals(expectedDecoded)) {
      throw new Error('GSM-FR independent reference decoder disagrees with Seq03');
    }
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function runSbcConformanceRunner(runnerPath, repoRoot, arguments_, label) {
  const result = spawnSync(runnerPath, arguments_, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || '').trim();
    throw new Error(`SBC ${label} conformance gate failed${detail ? `: ${detail}` : ''}`);
  }
}

function runSbcReferenceDecoder(executable, output, input, label) {
  const result = spawnSync(executable, [`-o${output}`, input], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || '').trim();
    throw new Error(
      `SBC official reference decoder failed for ${label}${detail ? `: ${detail}` : ''}`
    );
  }
}

export async function requireSbcPromotionConformance(type, repoRoot, args) {
  if (type !== BLUETOOTH_SBC_SIMULATOR_TYPE || args['promote-production-native'] !== true) return;
  const runner = args['sbc-conformance-runner'];
  const fixtureDir = args['sbc-fixture-dir'];
  const referenceDecoder = args['sbc-reference-decoder'];
  if (!runner || !fixtureDir || !referenceDecoder) {
    throw new Error(
      'Bluetooth SBC golden promotion requires --sbc-conformance-runner, --sbc-fixture-dir, and --sbc-reference-decoder so the official SIG decoder gate and the production encoder round trip are hard gates'
    );
  }

  const resolvedRunner = path.resolve(repoRoot, runner);
  const resolvedFixtureDir = path.resolve(repoRoot, fixtureDir);
  const resolvedDecoder = path.resolve(repoRoot, referenceDecoder);
  const fixtures = new Map();
  for (const fixture of SBC_CONFORMANCE_FIXTURES) {
    const fixturePath = path.join(resolvedFixtureDir, fixture.file);
    let bytes;
    try {
      bytes = await fs.readFile(fixturePath);
    } catch (error) {
      throw new Error(
        `SBC conformance fixture ${fixture.label} is unavailable: ${fixturePath}`,
        { cause: error }
      );
    }
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== fixture.sha256) {
      throw new Error(
        `SBC conformance fixture ${fixture.label} is not the recorded official material: ${fixturePath} hashes to sha256:${digest}`
      );
    }
    fixtures.set(fixture.file, fixturePath);
  }

  runSbcConformanceRunner(resolvedRunner, repoRoot, [
    '--stereo', fixtures.get('stereo.sbc'), fixtures.get('stereo.wav'),
    '--joint', fixtures.get('joint.sbc'), fixtures.get('joint.wav')
  ], 'official decoder');

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-sbc-promotion-'));
  try {
    const encodedStereo = path.join(temporaryRoot, 'encoded-stereo.sbc');
    const encodedJoint = path.join(temporaryRoot, 'encoded-joint.sbc');
    runSbcConformanceRunner(resolvedRunner, repoRoot, [
      '--encode-stereo', fixtures.get('stereo.wav'), encodedStereo,
      '--encode-joint', fixtures.get('joint.wav'), encodedJoint
    ], 'production encoder');

    const decodedStereo = path.join(temporaryRoot, 'encoded-stereo.wav');
    const decodedJoint = path.join(temporaryRoot, 'encoded-joint.wav');
    runSbcReferenceDecoder(resolvedDecoder, decodedStereo, encodedStereo, 'Stereo');
    runSbcReferenceDecoder(resolvedDecoder, decodedJoint, encodedJoint, 'Joint Stereo');

    runSbcConformanceRunner(resolvedRunner, repoRoot, [
      '--stereo', encodedStereo, decodedStereo,
      '--joint', encodedJoint, decodedJoint
    ], 'production encoder interoperability');
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function filterCases(cases, args) {
  let selected = cases;
  if (args.stimulus) {
    if (!STIMULUS_IDS.includes(args.stimulus)) throw new Error(`Unknown stimulus ${args.stimulus}`);
    selected = selected.filter(testCase => testCase.stimulus === args.stimulus);
  }
  if (args.frames !== undefined) {
    const frames = positiveInteger(args.frames, 'frames');
    selected = selected.map(testCase => ({ ...testCase, frames, fullLength: false }));
  }
  if (args['limit-cases'] !== undefined) {
    selected = selected.slice(0, positiveInteger(args['limit-cases'], 'limit-cases'));
  }
  if (selected.length === 0) throw new Error('No parity cases matched the requested filters');
  return selected.map((testCase, caseIndex) => ({ ...testCase, caseIndex }));
}

async function unportedSelfCheckCases(type, repoRoot, args) {
  const session = await createReferenceSession(type, { repoRoot });
  const params = typeof session.plugin.getParameters === 'function' ? session.plugin.getParameters() : {};
  const sampleRate = positiveInteger(args['sample-rate'], 'sample-rate', 48000);
  const frames = positiveInteger(args.frames, 'frames', sampleRate);
  const stimuli = args.stimulus ? [args.stimulus] : STIMULUS_IDS;
  if (stimuli.some(id => !STIMULUS_IDS.includes(id))) throw new Error(`Unknown stimulus ${args.stimulus}`);
  return stimuli.map((stimulus, caseIndex) => ({
    id: `self-check-${stimulus}`,
    stimulus,
    sampleRate,
    frames,
    channels: positiveInteger(args.channels, 'channels', 2),
    channelMode: 'stereo',
    channel: null,
    blockSize: positiveInteger(args['block-size'], 'block-size', 128),
    params,
    caseIndex
  }));
}

async function executeGoldenReferenceCase(type, testCase, input, options) {
  if (type !== TUBE_SIMULATOR_TYPE) {
    return executeReferenceCase(type, testCase, input, options);
  }
  const session = await createReferenceSession(type, {
    ...options,
    params: testCase.params,
    caseIndex: testCase.caseIndex ?? 0,
    seed: testCase.seed ?? noiseSeedForCase(testCase.caseIndex ?? 0)
  });
  session.plugin.fr = true;
  const output = await session.process(input, testCase);
  return {
    output,
    jsEngineHash: session.jsEngineHash,
    baseSourceHash: session.baseSourceHash
  };
}

export async function generateGoldens({
  type,
  repoRoot = DEFAULT_REPO_ROOT,
  schemaPath = null,
  casesPath = null,
  outputDir = null,
  selfCheck = false,
  args = {},
  log = console.log
}) {
  if (!type) throw new Error(`Missing --type.\n${usage()}`);
  const definition = await findPluginDefinition(type, repoRoot);
  const plan = await discoverCasePlan({
    type: definition.type,
    repoRoot,
    schemaPath,
    casesPath,
    fullFrames: args.frames ? positiveInteger(args.frames, 'frames') : undefined,
    shortFrames: args.frames ? positiveInteger(args.frames, 'frames') : undefined
  });
  let cases = plan.schema
    ? plan.cases
    : await unportedSelfCheckCases(definition.type, repoRoot, args);
  if (!plan.schema && !selfCheck) {
    throw new Error(`No params.json was found for ${definition.type}. Use --self-check for an unported plugin.`);
  }
  cases = filterCases(cases, args);
  const nativeDirectReference = isNativeDirectReferenceEngine(plan.schema?.parityReference);
  const productionNativeReference =
    isProductionNativePromotedReferenceEngine(plan.schema?.parityReference);
  const promotionRequested = args['promote-production-native'] === true;
  if (productionNativeReference && !promotionRequested) {
    throw new Error(
      `${definition.type} requires explicit --promote-production-native; its bypass JS processor cannot be used as a golden reference`
    );
  }
  if (promotionRequested && !productionNativeReference) {
    throw new Error(
      `--promote-production-native requires parityReference production-native-promoted-v1 in ${definition.type}'s params.json`
    );
  }
  requireG726PromotionConformance(definition.type, repoRoot, args);
  await requireGsmPromotionConformance(definition.type, repoRoot, args);
  await requireMp3PromotionConformance(definition.type, args, process.env, repoRoot);
  await requireSbcPromotionConformance(definition.type, repoRoot, args);
  const nativeReference = nativeDirectReference || productionNativeReference;
  const referenceHash = productionNativeReference
    ? await productionNativeRunnerHash(repoRoot, args['native-runner'])
    : nativeDirectReference
      ? await nativeDirectReferenceHash(repoRoot, plan.schema.parityReference)
      : null;
  const generationCommand = productionNativeReference
    ? productionNativeGenerationCommand(definition.type)
    : undefined;
  const generated = [];
  let baseSourceHash = null;
  for (const testCase of cases) {
    const seed = noiseSeedForCase(testCase.caseIndex);
    const normalizedCase = { ...testCase, seed };
    const input = generateStimulus({
      id: testCase.stimulus,
      sampleRate: testCase.sampleRate,
      frames: testCase.frames,
      channels: testCase.channels,
      caseIndex: testCase.caseIndex,
      seed
    });
    const first = productionNativeReference
      ? {
          output: await runNativeCase({
            type: definition.type,
            testCase: normalizedCase,
            input,
            schema: plan.schema,
            repoRoot,
            runnerPath: args['native-runner'] ?? undefined
          }),
          jsEngineHash: undefined,
          baseSourceHash: null
        }
      : nativeDirectReference
      ? {
          output: await runNativeReferenceCase({
            type: definition.type,
            testCase: normalizedCase,
            input,
            schema: plan.schema,
            repoRoot,
            runnerPath: args['native-runner'] ?? undefined
          }),
          jsEngineHash: undefined,
          baseSourceHash: null
        }
      : await executeGoldenReferenceCase(definition.type, normalizedCase, input, { repoRoot });
    if (selfCheck) {
      const second = productionNativeReference
        ? {
            output: await runNativeCase({
              type: definition.type,
              testCase: normalizedCase,
              input,
              schema: plan.schema,
              repoRoot,
              runnerPath: args['native-runner'] ?? undefined
            })
          }
        : nativeDirectReference
        ? {
            output: await runNativeReferenceCase({
              type: definition.type,
              testCase: normalizedCase,
              input,
              schema: plan.schema,
              repoRoot,
              runnerPath: args['native-runner'] ?? undefined
            })
          }
        : await executeGoldenReferenceCase(definition.type, normalizedCase, input, { repoRoot });
      const comparison = comparePerSample(first.output, second.output, { abs: 0, rel: 0 });
      log(`${comparison.pass ? 'PASS' : 'FAIL'} ${testCase.id}: ${formatComparison(comparison)}`);
      if (!comparison.pass) throw new Error(`JS reference self-check failed for ${testCase.id}`);
    }
    if (!nativeReference && baseSourceHash !== null && first.baseSourceHash !== baseSourceHash) {
      throw new Error('plugins/plugin-base.js changed during golden generation; run it again');
    }
    generated.push({
      testCase: normalizedCase,
      output: first.output,
      jsEngineHash: first.jsEngineHash,
      referenceEngine: nativeReference ? plan.schema.parityReference : undefined,
      referenceHash: nativeReference ? referenceHash : undefined,
      generationCommand
    });
    if (!nativeReference) baseSourceHash = first.baseSourceHash;
  }

  if (selfCheck) {
    return { type: definition.type, selfCheck: true, caseCount: generated.length, cases: generated };
  }
  const artifacts = createGoldenArtifacts({
    type: definition.type,
    schemaTolerance: plan.schema.tolerance,
    cases: generated
  });
  const resolvedOutput = outputDir
    ? path.resolve(repoRoot, outputDir)
    : path.join(path.dirname(plan.schemaPath), 'golden');
  const result = await writeGoldenSet(resolvedOutput, artifacts, {
    budgetBytes: positiveInteger(args.budget, 'budget', DEFAULT_GOLDEN_BUDGET_BYTES),
    type: definition.type
  });
  log(`Wrote ${result.caseCount} golden cases for ${definition.type} to ${resolvedOutput} (${formatBytes(result.totalBytes)})`);
  return {
    type: definition.type,
    selfCheck: false,
    outputDir: resolvedOutput,
    pluginBaseHash: baseSourceHash,
    ...result
  };
}

const ALL_GENERATION_INCOMPATIBLE_OPTIONS = [
  'type', 'schema', 'cases', 'output', 'self-check', 'stimulus', 'frames',
  'limit-cases', 'sample-rate', 'channels', 'block-size', 'promote-production-native',
  'g726-vector-dir', 'g726-conformance-runner', 'g726-state-digest-file',
  'mp3-decoder', 'mp3-diagnostic-runner',
  'sbc-conformance-runner', 'sbc-fixture-dir', 'sbc-reference-decoder'
];

async function writePluginBaseGuard(baseHashPath, pluginBaseHash) {
  await fs.mkdir(path.dirname(baseHashPath), { recursive: true });
  await fs.writeFile(baseHashPath, `${JSON.stringify({
    formatVersion: 1,
    pluginBaseHash
  }, null, 2)}\n`);
}

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function rollBackPromotions(entries, rename) {
  const errors = [];
  for (const entry of [...entries].reverse()) {
    if (entry.stagedMoved) {
      try {
        await rename(entry.livePath, entry.stagedPath);
      } catch {
        try {
          await fs.rm(entry.livePath, { recursive: entry.directory, force: true });
        } catch (removeError) {
          errors.push(removeError);
        }
      }
    }
    if (entry.liveMoved) {
      try {
        await rename(entry.backupPath, entry.livePath);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  return errors;
}

async function promoteStagedArtifacts(entries, rename) {
  const attempted = [];
  try {
    for (const entry of entries) {
      attempted.push(entry);
      entry.hadLive = await pathExists(entry.livePath);
      if (entry.hadLive) {
        await rename(entry.livePath, entry.backupPath);
        entry.liveMoved = true;
      }
      await rename(entry.stagedPath, entry.livePath);
      entry.stagedMoved = true;
    }
  } catch (error) {
    const rollbackErrors = await rollBackPromotions(attempted, rename);
    const detail = rollbackErrors.length > 0
      ? `; rollback also encountered ${rollbackErrors.length} error(s)`
      : '';
    const promotionError = new Error(
      `Failed to promote the complete DSP golden set${detail}`,
      { cause: error }
    );
    promotionError.rollbackErrors = rollbackErrors;
    throw promotionError;
  }
}

export async function generateAllGoldens({
  repoRoot = DEFAULT_REPO_ROOT,
  args = {},
  log = console.log,
  rename = fs.rename
} = {}) {
  const incompatible = ALL_GENERATION_INCOMPATIBLE_OPTIONS.filter(name => args[name] !== undefined);
  if (incompatible.length > 0) {
    throw new Error(`--all cannot be combined with ${incompatible.map(name => `--${name}`).join(', ')}`);
  }
  const targets = await discoverGoldenTargets(repoRoot);
  if (targets.length === 0) {
    throw new Error('No existing DSP golden sets were found for --all generation');
  }

  const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins');
  const transactionRoot = await fs.mkdtemp(path.join(pluginsRoot, '.golden-all-'));
  const stagedRoot = path.join(transactionRoot, 'staged');
  const backupRoot = path.join(transactionRoot, 'backup');
  const guardPath = path.join(pluginsRoot, 'golden-base-hash.json');
  const stagedGuardPath = path.join(stagedRoot, 'golden-base-hash.json');
  const results = [];
  const stagedTargets = [];
  let pluginBaseHash = null;
  let retainTransaction = false;

  try {
    await Promise.all([fs.mkdir(stagedRoot), fs.mkdir(backupRoot)]);
    for (const [index, target] of targets.entries()) {
      const number = String(index + 1).padStart(3, '0');
      const stagedOutput = path.join(stagedRoot, number);
      await fs.cp(target.goldenDir, stagedOutput, { recursive: true });
      const result = await generateGoldens({
        type: target.type,
        repoRoot,
        schemaPath: target.schemaPath,
        outputDir: stagedOutput,
        args,
        log
      });
      if (result.pluginBaseHash !== null && pluginBaseHash !== null &&
          result.pluginBaseHash !== pluginBaseHash) {
        throw new Error('plugins/plugin-base.js changed during --all generation; run it again');
      }
      const validatedCases = await readGoldenSet(stagedOutput);
      if (validatedCases.length !== result.caseCount) {
        throw new Error(`Staged golden validation found an incomplete set for ${target.type}`);
      }
      if (result.pluginBaseHash !== null) pluginBaseHash = result.pluginBaseHash;
      stagedTargets.push({ target, stagedOutput, number });
      results.push({ ...result, outputDir: target.goldenDir });
    }

    await writePluginBaseGuard(stagedGuardPath, pluginBaseHash);
    const stagedGuard = JSON.parse(await fs.readFile(stagedGuardPath, 'utf8'));
    if (stagedGuard.pluginBaseHash !== pluginBaseHash) {
      throw new Error('Staged plugin base guard validation failed');
    }

    const promotionEntries = stagedTargets.map(({ target, stagedOutput, number }) => ({
      livePath: target.goldenDir,
      stagedPath: stagedOutput,
      backupPath: path.join(backupRoot, number),
      directory: true,
      liveMoved: false,
      stagedMoved: false
    }));
    promotionEntries.push({
      livePath: guardPath,
      stagedPath: stagedGuardPath,
      backupPath: path.join(backupRoot, 'golden-base-hash.json'),
      directory: false,
      liveMoved: false,
      stagedMoved: false
    });
    await promoteStagedArtifacts(promotionEntries, rename);
    log(`Updated ${results.length} golden sets and the shared plugin base guard atomically`);
    return { all: true, types: results.map(result => result.type), results, pluginBaseHash };
  } catch (error) {
    if (error.rollbackErrors?.length > 0) {
      retainTransaction = true;
      log(`Retained incomplete DSP golden transaction for recovery at ${transactionRoot}`);
    }
    throw error;
  } finally {
    if (!retainTransaction) {
      try {
        await fs.rm(transactionRoot, { recursive: true, force: true });
      } catch (error) {
        log(`Warning: unable to remove DSP golden staging directory ${transactionRoot}: ${error.message}`);
      }
    }
  }
}

export async function runGenerateCli(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  const repoRoot = args.root ? path.resolve(args.root) : DEFAULT_REPO_ROOT;
  if (args.all === true) {
    return generateAllGoldens({
      repoRoot,
      args,
      log: message => io.log(message)
    });
  }
  return generateGoldens({
    type: args.type,
    repoRoot,
    schemaPath: args.schema ?? null,
    casesPath: args.cases ?? null,
    outputDir: args.output ?? null,
    selfCheck: args['self-check'] === true,
    args,
    log: message => io.log(message)
  });
}

if (isMain(import.meta.url)) {
  runGenerateCli().catch(error => {
    console.error(`DSP golden generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
