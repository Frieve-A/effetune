import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCaseMatrix,
  readParamsSchema,
  validateCase
} from './cases.mjs';
import {
  createGoldenArtifacts,
  encodeFloat32LE,
  readGoldenSet,
  writeFloat32File,
  writeGoldenSet
} from './golden-io.mjs';
import { generateStimulus, noiseSeedForCase } from './stimuli.mjs';

export const TUBE_ORACLE_SOURCE_SHA256 =
  '6FAF406E293B06AC2B0B140A9E3DFD7CBAD2035E2EC54D9B48626BBF4EF2A887';
export const TUBE_ORACLE_WASM_SHA256 =
  '8D63B37C0D7181A01EB48B074A7AD2E7194588A1D57BF9C5890F67CE756AE76D';
export const TUBE_ORACLE_SAMPLE_RATE = 96000;
export const TUBE_ORACLE_CHANNELS = 2;
export const TUBE_ORACLE_BLOCK_SIZE = 128;
export const TUBE_ORACLE_FACTOR = 4;
export const TUBE_ORACLE_FIR_LENGTH = 257;
export const TUBE_ORACLE_SLOW_WINDOW = 24;
export const TUBE_STANDARD_ORACLE_MANIFEST_VERSION = 1;
export const TUBE_STANDARD_GOLDEN_MAX_ABS = 1e-5;
export const TUBE_STANDARD_ORACLE_MANIFEST_NAME = 'standard-oracle-v1.json';
export const TUBE_TORTURE_ORACLE_MANIFEST_VERSION = 1;
export const TUBE_TORTURE_ORACLE_MANIFEST_NAME = 'torture-oracle-v1.json';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(here, '..', '..');
const tubeType = 'TubeSimulatorPlugin';
const relativeFixtureRoot = path.join(
  'tests', 'fixtures', 'tube-simulator', 'p3-baseline-v1'
);
const relativeOracleRoot = path.join(
  relativeFixtureRoot, 'oracle'
);
const relativeCasesPath = path.join(
  relativeFixtureRoot, 'cases.json'
);
const relativeSchemaPath = path.join(
  relativeFixtureRoot, 'params.json'
);
const relativeGoldenRoot = path.join(
  relativeFixtureRoot, 'golden'
);
export const TUBE_STANDARD_PRODUCTION_CASE_IDS = Object.freeze([
  'default-silence',
  'default-impulse',
  'default-sine',
  'default-noise',
  'minimum-drive-12ax7',
  'lower-range-corners',
  'dry-output-gain-isolation',
  'half-mix-wet-output'
]);
const telemetryFields = [
  'absoluteOutputSum',
  'vk1',
  'vk2',
  'bPlus',
  'ia1',
  'ia2',
  'ig1',
  'ig2',
  'iRa1',
  'iRa2'
];
const observationFields = ['vk1', 'vk2', 'bPlus', 'ia1', 'ia2'];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function float32Sha256(values) {
  return sha256(encodeFloat32LE(values));
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function frozenOracleDescriptor(verified) {
  return {
    manifest: toPosix(path.join(relativeOracleRoot, 'build-manifest.json')),
    source: toPosix(path.join(relativeOracleRoot, 'path2-shape.cpp')),
    sourceSha256: verified.sourceSha256,
    wasm: toPosix(path.join(relativeOracleRoot, 'path2-shape.wasm')),
    wasmSha256: verified.wasmSha256,
    generator: 'tools/dsp-parity/tube-simulator-oracle.mjs',
    generatorSha256: verified.generatorSha256
  };
}

export function selectTubeStandardProductionCases(cases) {
  check(Array.isArray(cases), 'Tube Simulator production projection requires a case array');
  const casesById = new Map();
  for (const testCase of cases) {
    check(
      testCase && typeof testCase.id === 'string',
      'Tube Simulator production projection found a case without an ID'
    );
    check(
      !casesById.has(testCase.id),
      `Tube Simulator production projection found duplicate case ${testCase.id}`
    );
    casesById.set(testCase.id, testCase);
  }
  return TUBE_STANDARD_PRODUCTION_CASE_IDS.map(id => {
    const testCase = casesById.get(id);
    check(testCase, `Tube Simulator production projection is missing case ${id}`);
    const driveValues = [
      testCase.params?.dr,
      ...(testCase.events ?? []).map(event => event.params?.dr)
    ].filter(value => value !== undefined);
    check(
      driveValues.every(value => value <= 0),
      `Tube Simulator production projection case ${id} contains positive Drive`
    );
    return testCase;
  });
}

function maximumAbsoluteDifference(left, right) {
  check(left.length === right.length, 'Tube Simulator comparison lengths differ');
  let maximum = 0;
  for (let index = 0; index < left.length; index++) {
    const difference = Math.abs(left[index] - right[index]);
    check(Number.isFinite(difference), `Tube Simulator comparison is non-finite at ${index}`);
    if (difference > maximum) maximum = difference;
  }
  return maximum;
}

function standardGoldenTolerance() {
  return {
    abs: TUBE_STANDARD_GOLDEN_MAX_ABS,
    policy: 'per-sample'
  };
}

function serializableSeed(seed) {
  return `0x${seed.toString(16)}`;
}

function normalizeParams(params = {}) {
  return {
    dr: params.dr ?? 0,
    tp: params.tp ?? '12AX7',
    bi: params.bi ?? 0,
    pv: params.pv ?? 250,
    sz: params.sz ?? 10,
    su: params.su ?? 10,
    og: params.og ?? 0,
    mx: params.mx ?? 100
  };
}

function tubeIndex(tube) {
  const index = ['12AX7', '12AT7', '12AU7'].indexOf(tube);
  if (index < 0) throw new Error(`Unknown Tube Simulator tube ${tube}`);
  return index;
}

function parameterArguments(params) {
  const normalized = normalizeParams(params);
  return [
    normalized.dr,
    tubeIndex(normalized.tp),
    normalized.bi,
    normalized.pv,
    normalized.sz,
    normalized.su,
    normalized.og,
    normalized.mx
  ];
}

function toSafeCounter(value, label) {
  if (typeof value === 'bigint') {
    check(value <= BigInt(Number.MAX_SAFE_INTEGER), `${label} exceeds the safe integer range`);
    return Number(value);
  }
  check(Number.isSafeInteger(value), `${label} is not a safe integer`);
  return value;
}

function copyBlock(source, totalFrames, startFrame) {
  const block = new Float64Array(TUBE_ORACLE_CHANNELS * TUBE_ORACLE_BLOCK_SIZE);
  for (let channel = 0; channel < TUBE_ORACLE_CHANNELS; channel++) {
    const sourceOffset = channel * totalFrames + startFrame;
    const targetOffset = channel * TUBE_ORACLE_BLOCK_SIZE;
    for (let frame = 0; frame < TUBE_ORACLE_BLOCK_SIZE; frame++) {
      block[targetOffset + frame] = source[sourceOffset + frame];
    }
  }
  return block;
}

function storeBlock(target, block, totalFrames, startFrame) {
  for (let channel = 0; channel < TUBE_ORACLE_CHANNELS; channel++) {
    const sourceOffset = channel * TUBE_ORACLE_BLOCK_SIZE;
    const targetOffset = channel * totalFrames + startFrame;
    for (let frame = 0; frame < TUBE_ORACLE_BLOCK_SIZE; frame++) {
      target[targetOffset + frame] = Math.fround(block[sourceOffset + frame]);
    }
  }
}

export function makeTubeContractSignal(frames, phase = 0, scale = 0.7) {
  const signal = new Float32Array(frames * TUBE_ORACLE_CHANNELS);
  for (let channel = 0; channel < TUBE_ORACLE_CHANNELS; channel++) {
    const offset = channel * frames;
    for (let frame = 0; frame < frames; frame++) {
      const index = frame + phase + channel * 17;
      signal[offset + frame] = scale *
        (0.63 * Math.sin(index * 0.071) + 0.29 * Math.cos(index * 0.113));
    }
  }
  return signal;
}

export async function verifyTubeOracle(repoRoot = DEFAULT_REPO_ROOT) {
  const oracleRoot = path.join(repoRoot, relativeOracleRoot);
  const manifestPath = path.join(oracleRoot, 'build-manifest.json');
  const sourcePath = path.join(oracleRoot, 'path2-shape.cpp');
  const wasmPath = path.join(oracleRoot, 'path2-shape.wasm');
  const [manifestBytes, sourceBytes, wasmBytes, generatorBytes] = await Promise.all([
    fs.readFile(manifestPath),
    fs.readFile(sourcePath),
    fs.readFile(wasmPath),
    fs.readFile(fileURLToPath(import.meta.url))
  ]);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const sourceHash = sha256(sourceBytes);
  const wasmHash = sha256(wasmBytes);
  const generatorHash = sha256(generatorBytes);

  check(
    manifest.artifacts.source.sha256 === TUBE_ORACLE_SOURCE_SHA256,
    'Tube Simulator oracle manifest source SHA is not the frozen value'
  );
  check(
    manifest.artifacts.wasm.sha256 === TUBE_ORACLE_WASM_SHA256,
    'Tube Simulator oracle manifest WASM SHA is not the frozen value'
  );
  check(
    sourceHash === TUBE_ORACLE_SOURCE_SHA256,
    `Tube Simulator oracle source SHA mismatch: ${sourceHash}`
  );
  check(
    wasmHash === TUBE_ORACLE_WASM_SHA256,
    `Tube Simulator oracle WASM SHA mismatch: ${wasmHash}`
  );

  const module = await WebAssembly.compile(wasmBytes);
  check(
    WebAssembly.Module.imports(module).length === 0,
    'Tube Simulator oracle WASM unexpectedly requires imports'
  );
  return {
    manifest,
    manifestPath,
    sourcePath,
    wasmPath,
    sourceSha256: sourceHash,
    wasmSha256: wasmHash,
    generatorSha256: generatorHash,
    module
  };
}

export async function createTubeOracleSession({
  repoRoot = DEFAULT_REPO_ROOT,
  params = {},
  verified = null
} = {}) {
  const oracle = verified ?? await verifyTubeOracle(repoRoot);
  const instance = await WebAssembly.instantiate(oracle.module);
  const wasm = instance.exports;
  check(
    wasm.path2_prepare(
      TUBE_ORACLE_SAMPLE_RATE,
      TUBE_ORACLE_BLOCK_SIZE,
      TUBE_ORACLE_CHANNELS,
      TUBE_ORACLE_FACTOR,
      TUBE_ORACLE_FIR_LENGTH,
      TUBE_ORACLE_SLOW_WINDOW
    ) === 1,
    'Tube Simulator oracle prepare failed'
  );
  check(wasm.path2_parameter_count() === 8, 'Tube Simulator oracle parameter count is not eight');
  let currentParams = normalizeParams(params);

  function setParameters(nextParams) {
    currentParams = normalizeParams({ ...currentParams, ...nextParams });
    check(
      wasm.path2_set_parameters(...parameterArguments(currentParams)) === 1,
      'Tube Simulator oracle rejected parameters'
    );
  }

  function reset() {
    wasm.path2_reset();
    check(wasm.path2_tube_reset_pending() === 0, 'Tube Simulator oracle reset remained pending');
  }

  function checkpoint() {
    const telemetry = Array.from(
      new Float64Array(wasm.memory.buffer, wasm.path2_telemetry_ptr(), telemetryFields.length)
    );
    return {
      accumulatorCount: [
        wasm.path2_observation_end_slow_phase(0),
        wasm.path2_observation_end_slow_phase(1)
      ],
      slowPublishCount: toSafeCounter(wasm.path2_slow_updates(), 'slow publish count'),
      telemetry,
      finiteFaults: toSafeCounter(wasm.path2_finite_faults(), 'finite fault count'),
      safetyLimits: toSafeCounter(wasm.path2_safety_limits(), 'safety limit count'),
      persistentFinite: wasm.path2_persistent_domain_finite() === 1
    };
  }

  function processBlock(input) {
    check(
      input.length === TUBE_ORACLE_CHANNELS * TUBE_ORACLE_BLOCK_SIZE,
      'Tube Simulator oracle blocks must contain 128 channel-major stereo frames'
    );
    for (let channel = 0; channel < TUBE_ORACLE_CHANNELS; channel++) {
      const target = new Float64Array(
        wasm.memory.buffer,
        wasm.path2_input_ptr(channel),
        TUBE_ORACLE_BLOCK_SIZE
      );
      const offset = channel * TUBE_ORACLE_BLOCK_SIZE;
      target.set(input.subarray(offset, offset + TUBE_ORACLE_BLOCK_SIZE));
    }
    check(wasm.path2_process() === 1, 'Tube Simulator oracle process failed');
    const output = new Float32Array(input.length);
    for (let channel = 0; channel < TUBE_ORACLE_CHANNELS; channel++) {
      const source = new Float64Array(
        wasm.memory.buffer,
        wasm.path2_output_ptr(channel),
        TUBE_ORACLE_BLOCK_SIZE
      );
      const offset = channel * TUBE_ORACLE_BLOCK_SIZE;
      for (let frame = 0; frame < TUBE_ORACLE_BLOCK_SIZE; frame++) {
        output[offset + frame] = Math.fround(source[frame]);
      }
    }
    return output;
  }

  function observations() {
    const values = new Float32Array(
      observationFields.length * TUBE_ORACLE_CHANNELS * TUBE_ORACLE_BLOCK_SIZE
    );
    let targetOffset = 0;
    for (let field = 0; field < observationFields.length; field++) {
      for (let channel = 0; channel < TUBE_ORACLE_CHANNELS; channel++) {
        const source = new Float64Array(
          wasm.memory.buffer,
          wasm.path2_host_observation_ptr(field, channel),
          TUBE_ORACLE_BLOCK_SIZE
        );
        for (let frame = 0; frame < TUBE_ORACLE_BLOCK_SIZE; frame++) {
          values[targetOffset++] = Math.fround(source[frame]);
        }
      }
    }
    return values;
  }

  async function process(input) {
    check(input instanceof Float32Array, 'Tube Simulator oracle input must be Float32');
    const frames = input.length / TUBE_ORACLE_CHANNELS;
    check(
      Number.isInteger(frames) && frames > 0 && frames % TUBE_ORACLE_BLOCK_SIZE === 0,
      'Tube Simulator oracle input length must be a positive multiple of 128 stereo frames'
    );
    const output = new Float32Array(input.length);
    check(wasm.path2_begin_observation() === 1, 'Tube Simulator oracle observation start failed');
    for (let startFrame = 0; startFrame < frames; startFrame += TUBE_ORACLE_BLOCK_SIZE) {
      const block = copyBlock(input, frames, startFrame);
      storeBlock(output, processBlock(block), frames, startFrame);
    }
    return output;
  }

  setParameters(currentParams);
  reset();
  return {
    oracle,
    wasm,
    get params() {
      return { ...currentParams };
    },
    setParameters,
    reset,
    checkpoint,
    processBlock,
    process,
    observations
  };
}

export async function createTubeWasmSession({
  repoRoot = DEFAULT_REPO_ROOT,
  variant = 'baseline',
  params = {},
  maximumFrames = TUBE_ORACLE_BLOCK_SIZE,
  resetAfterInitialParameters = true
} = {}) {
  const artifactName = variant === 'simd'
    ? 'effetune-dsp.simd.wasm'
    : 'effetune-dsp.wasm';
  const artifactPath = path.join(repoRoot, 'plugins', 'dsp', artifactName);
  const module = await WebAssembly.compile(await fs.readFile(artifactPath));
  const instance = await WebAssembly.instantiate(module, {
    env: { emscripten_notify_memory_growth() {} }
  });
  const wasm = instance.exports;
  const engine = wasm.et_engine_create();
  check(engine !== 0, `${variant} Tube Simulator WASM engine creation failed`);
  check(
    wasm.et_engine_prepare(
      engine,
      TUBE_ORACLE_SAMPLE_RATE,
      TUBE_ORACLE_CHANNELS,
      maximumFrames,
      64 * 1024
    ) === 0,
    `${variant} Tube Simulator WASM prepare failed`
  );
  const typeBytes = new TextEncoder().encode('TubeSimulatorPlugin\0');
  const typePointer = wasm.et_scratch_ptr(engine);
  new Uint8Array(wasm.memory.buffer, typePointer, typeBytes.length).set(typeBytes);
  const dspInstance = wasm.et_instance_create(engine, typePointer);
  check(dspInstance !== 0, `${variant} Tube Simulator WASM instance creation failed`);
  const paramsPointer = wasm.malloc(8 * Float32Array.BYTES_PER_ELEMENT);
  check(paramsPointer !== 0, `${variant} Tube Simulator WASM parameter allocation failed`);
  let currentParams = normalizeParams(params);

  function setParameters(nextParams) {
    currentParams = normalizeParams({ ...currentParams, ...nextParams });
    const packed = new Float32Array([
      currentParams.dr,
      tubeIndex(currentParams.tp),
      currentParams.bi,
      currentParams.pv,
      currentParams.sz,
      currentParams.su,
      currentParams.og,
      currentParams.mx
    ]);
    new Float32Array(wasm.memory.buffer, paramsPointer, packed.length).set(packed);
    check(
      wasm.et_instance_set_params(
        engine,
        dspInstance,
        paramsPointer,
        packed.length,
        0x5e01129f,
        0
      ) === 0,
      `${variant} Tube Simulator WASM parameter staging failed`
    );
  }

  function processBlock(input) {
    const frames = input.length / TUBE_ORACLE_CHANNELS;
    check(
      Number.isInteger(frames) && frames > 0 && frames <= maximumFrames,
      `${variant} Tube Simulator WASM block has invalid frame count`
    );
    const audioPointer = wasm.et_arena_combined_ptr(engine);
    const audio = new Float32Array(wasm.memory.buffer, audioPointer, input.length);
    audio.set(input);
    check(
      wasm.et_instance_process(
        engine,
        dspInstance,
        audioPointer,
        TUBE_ORACLE_CHANNELS,
        frames,
        0
      ) === 0,
      `${variant} Tube Simulator WASM process failed`
    );
    return Float32Array.from(audio);
  }

  function reset() {
    check(
      wasm.et_instance_reset(engine, dspInstance) === 0,
      `${variant} Tube Simulator WASM reset failed`
    );
  }

  function stageAndReset(nextParams = currentParams) {
    setParameters(nextParams);
    processBlock(new Float32Array(TUBE_ORACLE_CHANNELS));
    reset();
  }

  function process(input, partitions = [TUBE_ORACLE_BLOCK_SIZE]) {
    check(input instanceof Float32Array, `${variant} Tube Simulator WASM input must be Float32`);
    check(
      Array.isArray(partitions) && partitions.length > 0 &&
        partitions.every(frames =>
          Number.isInteger(frames) && frames > 0 && frames <= maximumFrames),
      `${variant} Tube Simulator WASM partitions are invalid`
    );
    const totalFrames = input.length / TUBE_ORACLE_CHANNELS;
    check(
      Number.isInteger(totalFrames) && totalFrames > 0,
      `${variant} Tube Simulator WASM input shape is invalid`
    );
    const output = new Float32Array(input.length);
    let startFrame = 0;
    let partitionIndex = 0;
    while (startFrame < totalFrames) {
      let blockFrames = partitions[partitionIndex % partitions.length];
      if (blockFrames > totalFrames - startFrame) blockFrames = totalFrames - startFrame;
      const block = new Float32Array(blockFrames * TUBE_ORACLE_CHANNELS);
      for (let channel = 0; channel < TUBE_ORACLE_CHANNELS; channel++) {
        const sourceOffset = channel * totalFrames + startFrame;
        block.set(
          input.subarray(sourceOffset, sourceOffset + blockFrames),
          channel * blockFrames
        );
      }
      const rendered = processBlock(block);
      for (let channel = 0; channel < TUBE_ORACLE_CHANNELS; channel++) {
        const targetOffset = channel * totalFrames + startFrame;
        const sourceOffset = channel * blockFrames;
        output.set(
          rendered.subarray(sourceOffset, sourceOffset + blockFrames),
          targetOffset
        );
      }
      startFrame += blockFrames;
      partitionIndex++;
    }
    return output;
  }

  function destroy() {
    wasm.free(paramsPointer);
    wasm.et_instance_destroy(engine, dspInstance);
    wasm.et_engine_destroy(engine);
  }

  if (resetAfterInitialParameters) {
    stageAndReset(currentParams);
  } else {
    setParameters(currentParams);
  }
  return {
    artifactPath,
    variant,
    wasm,
    engine,
    dspInstance,
    get params() {
      return { ...currentParams };
    },
    setParameters,
    reset,
    stageAndReset,
    processBlock,
    process,
    destroy
  };
}

function validateStandardOracleCase(testCase) {
  check(
    testCase.sampleRate === TUBE_ORACLE_SAMPLE_RATE,
    `${testCase.id} does not use the frozen 96000 Hz oracle rate`
  );
  check(
    testCase.channels === TUBE_ORACLE_CHANNELS,
    `${testCase.id} does not use the frozen stereo oracle shape`
  );
  check(
    testCase.blockSize === TUBE_ORACLE_BLOCK_SIZE,
    `${testCase.id} does not use the frozen 128-frame oracle block size`
  );
  check(
    testCase.frames > 0 && testCase.frames % TUBE_ORACLE_BLOCK_SIZE === 0,
    `${testCase.id} does not end on a 128-frame oracle boundary`
  );
  for (const event of testCase.events ?? []) {
    check(
      Number.isInteger(event.frame) &&
        event.frame >= 0 &&
        event.frame < testCase.frames &&
        event.frame % TUBE_ORACLE_BLOCK_SIZE === 0,
      `${testCase.id} has an event outside a 128-frame oracle boundary`
    );
  }
}

async function renderStandardOracleCase(testCase, {
  repoRoot,
  verified,
  golden
}) {
  validateStandardOracleCase(testCase);
  const seed = noiseSeedForCase(testCase.caseIndex);
  const input = generateStimulus({
    id: testCase.stimulus,
    sampleRate: testCase.sampleRate,
    frames: testCase.frames,
    channels: testCase.channels,
    caseIndex: testCase.caseIndex,
    seed
  });
  const session = await createTubeOracleSession({
    repoRoot,
    params: testCase.params,
    verified
  });
  check(
    session.wasm.path2_begin_observation() === 1,
    `${testCase.id} could not begin the frozen oracle observation`
  );

  const output = new Float32Array(input.length);
  const events = [...(testCase.events ?? [])].sort((left, right) => left.frame - right.frame);
  let eventIndex = 0;
  for (
    let startFrame = 0;
    startFrame < testCase.frames;
    startFrame += TUBE_ORACLE_BLOCK_SIZE
  ) {
    while (eventIndex < events.length && events[eventIndex].frame === startFrame) {
      session.setParameters(events[eventIndex].params);
      if (session.wasm.path2_tube_reset_pending() === 1) session.reset();
      eventIndex++;
    }
    const block = copyBlock(input, testCase.frames, startFrame);
    storeBlock(output, session.processBlock(block), testCase.frames, startFrame);
  }
  check(eventIndex === events.length, `${testCase.id} did not consume every parameter event`);

  const checkpoint = session.checkpoint();
  check(
    checkpoint.telemetry.length === telemetryFields.length &&
      checkpoint.telemetry.every(Number.isFinite),
    `${testCase.id} did not produce ten finite telemetry fields`
  );
  check(
    checkpoint.accumulatorCount.every(value =>
      Number.isInteger(value) && value >= 0 && value < TUBE_ORACLE_SLOW_WINDOW),
    `${testCase.id} produced an invalid slow phase`
  );
  check(checkpoint.finiteFaults === 0, `${testCase.id} recorded finite faults`);
  check(checkpoint.safetyLimits === 0, `${testCase.id} recorded safety limits`);
  check(checkpoint.persistentFinite, `${testCase.id} left non-finite persistent state`);

  if (!golden) {
    return { seed, output, events, checkpoint };
  }
  check(golden.metadata.caseIndex === testCase.caseIndex, `${testCase.id} case index drifted`);
  check(golden.metadata.seed === serializableSeed(seed), `${testCase.id} seed drifted`);
  check(golden.metadata.stimulus === testCase.stimulus, `${testCase.id} stimulus drifted`);
  check(golden.metadata.blockSize === TUBE_ORACLE_BLOCK_SIZE, `${testCase.id} block size drifted`);
  const expectedTolerance = standardGoldenTolerance();
  check(
    golden.metadata.tolerance?.abs === expectedTolerance.abs &&
      golden.metadata.tolerance?.policy === expectedTolerance.policy &&
      Object.keys(golden.metadata.tolerance).length === Object.keys(expectedTolerance).length,
    `${testCase.id} golden tolerance differs from the fixed standard oracle limit`
  );
  const maximumAbsoluteError = maximumAbsoluteDifference(output, golden.expected);
  check(
    maximumAbsoluteError <= TUBE_STANDARD_GOLDEN_MAX_ABS,
    `${testCase.id} differs from the frozen oracle by ${maximumAbsoluteError}`
  );

  return {
    descriptor: {
      id: testCase.id,
      stimulus: testCase.stimulus,
      caseIndex: testCase.caseIndex,
      seed: serializableSeed(seed),
      sampleRate: testCase.sampleRate,
      channels: testCase.channels,
      frames: testCase.frames,
      blockSize: testCase.blockSize,
      params: testCase.params,
      events,
      input: {
        format: 'Float32LE',
        floats: input.length,
        sha256: float32Sha256(input)
      },
      oracleOutput: {
        format: 'Float32LE',
        floats: output.length,
        sha256: float32Sha256(output)
      },
      committedGolden: {
        binary: golden.metadata.binary,
        floats: golden.expected.length,
        sha256: float32Sha256(golden.expected),
        tolerance: expectedTolerance,
        maximumAbsoluteError
      },
      endCheckpoint: checkpoint
    },
    maximumAbsoluteError
  };
}

async function buildTubeStandardOracleManifest({
  repoRoot,
  goldenDir,
  verified
}) {
  const schemaPath = path.join(repoRoot, relativeSchemaPath);
  const [schema, goldens, casesBytes] = await Promise.all([
    readParamsSchema(schemaPath),
    readGoldenSet(goldenDir),
    fs.readFile(path.join(repoRoot, relativeCasesPath))
  ]);
  check(schema.type === tubeType, `Tube Simulator fixture schema type is ${schema.type}`);
  const cases = await loadCaseMatrix(schema, schemaPath, {
    repoRoot,
    casesPath: relativeCasesPath
  });
  cases.forEach(validateCase);
  check(cases.length === 13, `Tube Simulator oracle expected 13 cases, found ${cases.length}`);
  check(goldens.length === 13, `Tube Simulator oracle expected 13 goldens, found ${goldens.length}`);
  const goldensById = new Map(goldens.map(golden => [golden.metadata.id, golden]));
  check(goldensById.size === 13, 'Tube Simulator golden IDs are not unique');

  const rendered = [];
  for (const testCase of cases) {
    rendered.push(await renderStandardOracleCase(testCase, {
      repoRoot,
      verified,
      golden: goldensById.get(testCase.id)
    }));
  }
  const worst = rendered.reduce(
    (current, entry) =>
      entry.maximumAbsoluteError > current.maximumAbsoluteError ? entry : current,
    rendered[0]
  );
  return {
    manifest: {
      formatVersion: TUBE_STANDARD_ORACLE_MANIFEST_VERSION,
      type: tubeType,
      outputBoundary: 'Float32LE',
      oracleBlockSize: TUBE_ORACLE_BLOCK_SIZE,
      comparison: {
        policy: 'per-sample',
        maximumAbsoluteError: TUBE_STANDARD_GOLDEN_MAX_ABS
      },
      generation: {
        command:
          'node tools/dsp-parity/tube-simulator-oracle.mjs --generate-standard-goldens',
        order: [
          'amended-oracle-preflight',
          'standard-golden-generation',
          'amended-oracle-postflight'
        ]
      },
      oracle: frozenOracleDescriptor(verified),
      caseMatrix: {
        path: toPosix(relativeCasesPath),
        sha256: sha256(casesBytes),
        count: cases.length
      },
      telemetryFields,
      slowState: {
        phaseField: 'endCheckpoint.accumulatorCount',
        counterField: 'endCheckpoint.slowPublishCount',
        windowEndpoints: TUBE_ORACLE_SLOW_WINDOW
      },
      measured: {
        worstAbsoluteError: worst.maximumAbsoluteError,
        worstCase: worst.descriptor.id,
        exactCaseCount: rendered.filter(entry => entry.maximumAbsoluteError === 0).length
      },
      cases: rendered.map(entry => entry.descriptor)
    },
    caseCount: rendered.length,
    worstAbsoluteError: worst.maximumAbsoluteError,
    worstCase: worst.descriptor.id,
    exactCaseCount: rendered.filter(entry => entry.maximumAbsoluteError === 0).length
  };
}

export async function writeTubeStandardOracleManifest({
  repoRoot = DEFAULT_REPO_ROOT,
  goldenDir = path.join(repoRoot, relativeGoldenRoot)
} = {}) {
  const verified = await verifyTubeOracle(repoRoot);
  const built = await buildTubeStandardOracleManifest({ repoRoot, goldenDir, verified });
  const manifestPath = path.join(goldenDir, TUBE_STANDARD_ORACLE_MANIFEST_NAME);
  await fs.writeFile(manifestPath, jsonBuffer(built.manifest));
  return { ...built, manifestPath, verified };
}

export async function verifyTubeStandardGoldens({
  repoRoot = DEFAULT_REPO_ROOT,
  goldenDir = path.join(repoRoot, relativeGoldenRoot)
} = {}) {
  const verified = await verifyTubeOracle(repoRoot);
  const manifestPath = path.join(goldenDir, TUBE_STANDARD_ORACLE_MANIFEST_NAME);
  const [manifestBytes, built] = await Promise.all([
    fs.readFile(manifestPath),
    buildTubeStandardOracleManifest({ repoRoot, goldenDir, verified })
  ]);
  const committed = JSON.parse(manifestBytes.toString('utf8'));
  check(
    JSON.stringify(committed) === JSON.stringify(built.manifest),
    'Tube Simulator standard oracle manifest drifted; run the oracle preflight before JS golden generation'
  );
  return { ...built, manifestPath, verified };
}

export async function generateTubeStandardGoldens({
  repoRoot = DEFAULT_REPO_ROOT
} = {}) {
  const verified = await verifyTubeOracle(repoRoot);
  const schemaPath = path.join(repoRoot, relativeSchemaPath);
  const schema = await readParamsSchema(schemaPath);
  const cases = await loadCaseMatrix(schema, schemaPath, {
    repoRoot,
    casesPath: relativeCasesPath
  });
  cases.forEach(validateCase);
  check(cases.length === 13, `Tube Simulator oracle expected 13 cases, found ${cases.length}`);

  const rendered = [];
  for (const testCase of cases) {
    const result = await renderStandardOracleCase(testCase, {
      repoRoot,
      verified,
      golden: null
    });
    rendered.push({
      testCase: { ...testCase, seed: result.seed },
      output: result.output,
      referenceEngine: 'amended-p3-path2-wasm',
      referenceHash: verified.wasmSha256
    });
  }
  const outputDir = path.join(repoRoot, relativeGoldenRoot);
  const artifacts = createGoldenArtifacts({
    type: tubeType,
    schemaTolerance: standardGoldenTolerance(),
    cases: rendered
  });
  const written = await writeGoldenSet(outputDir, artifacts, { type: tubeType });
  const manifest = await writeTubeStandardOracleManifest({ repoRoot, goldenDir: outputDir });
  return {
    outputDir,
    caseCount: written.caseCount,
    totalBytes: written.totalBytes,
    worstAbsoluteError: manifest.worstAbsoluteError
  };
}

function jsonBuffer(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function describeVector(name, values) {
  const bytes = encodeFloat32LE(values);
  return {
    file: `${name}.f32`,
    floats: values.length,
    bytes: bytes.byteLength,
    sha256: sha256(bytes)
  };
}

export async function buildTubeTwoRateGoldens({
  repoRoot = DEFAULT_REPO_ROOT
} = {}) {
  const verified = await verifyTubeOracle(repoRoot);

  const canonicalParams = {
    dr: 18,
    tp: '12AU7',
    bi: -13,
    pv: 267,
    sz: 6.8,
    su: 14,
    og: -1.5,
    mx: 84
  };
  const canonicalInput = makeTubeContractSignal(1152, 73);
  const canonical = await createTubeOracleSession({
    repoRoot,
    params: canonicalParams,
    verified
  });
  const canonicalOutput = await canonical.process(canonicalInput);
  const canonicalCheckpoint = canonical.checkpoint();

  const resetParams = {
    dr: 7,
    tp: '12AX7',
    bi: 8,
    pv: 255,
    sz: 9,
    su: 12,
    og: 1,
    mx: 91
  };
  const resetPrefixInput = makeTubeContractSignal(128, 101);
  const resetSuffixInput = makeTubeContractSignal(384, 401);
  const resetSession = await createTubeOracleSession({
    repoRoot,
    params: resetParams,
    verified
  });
  const resetPrefixOutput = await resetSession.process(resetPrefixInput);
  const beforeResetCheckpoint = resetSession.checkpoint();
  resetSession.reset();
  const afterResetCheckpoint = resetSession.checkpoint();
  const resetSuffixOutput = await resetSession.process(resetSuffixInput);
  const resetEndCheckpoint = resetSession.checkpoint();
  const freshResetSession = await createTubeOracleSession({
    repoRoot,
    params: resetParams,
    verified
  });
  const freshSuffixOutput = await freshResetSession.process(resetSuffixInput);
  check(
    Buffer.from(resetSuffixOutput.buffer).equals(Buffer.from(freshSuffixOutput.buffer)),
    'Tube Simulator oracle reset output differs from a fresh instance'
  );

  const eventInitialParams = {
    dr: 13,
    tp: '12AX7',
    bi: 0,
    pv: 250,
    sz: 10,
    su: 10,
    og: 0,
    mx: 100
  };
  const eventParams = { bi: 29, su: 27 };
  const eventPrefixInput = makeTubeContractSignal(128, 211, 0.9);
  const eventSuffixInput = makeTubeContractSignal(128, 339, 0.9);
  const eventSession = await createTubeOracleSession({
    repoRoot,
    params: eventInitialParams,
    verified
  });
  const eventPrefixOutput = await eventSession.process(eventPrefixInput);
  const eventBeforeCheckpoint = eventSession.checkpoint();
  eventSession.setParameters(eventParams);
  const eventSuffixOutput = await eventSession.process(eventSuffixInput);
  const eventObservations = eventSession.observations();
  const eventEndCheckpoint = eventSession.checkpoint();

  const vectorValues = {
    canonicalInput,
    canonicalOutput,
    resetPrefixInput,
    resetPrefixOutput,
    resetSuffixInput,
    resetSuffixOutput,
    eventPrefixInput,
    eventPrefixOutput,
    eventSuffixInput,
    eventSuffixOutput,
    eventObservations
  };
  const vectors = {
    canonicalInput: describeVector('two-rate-canonical-input', canonicalInput),
    canonicalOutput: describeVector('two-rate-canonical-output', canonicalOutput),
    resetPrefixInput: describeVector('two-rate-reset-prefix-input', resetPrefixInput),
    resetPrefixOutput: describeVector(
      'two-rate-reset-prefix-output',
      resetPrefixOutput
    ),
    resetSuffixInput: describeVector('two-rate-reset-suffix-input', resetSuffixInput),
    resetSuffixOutput: describeVector(
      'two-rate-reset-suffix-output',
      resetSuffixOutput
    ),
    eventPrefixInput: describeVector('two-rate-event-prefix-input', eventPrefixInput),
    eventPrefixOutput: describeVector(
      'two-rate-event-prefix-output',
      eventPrefixOutput
    ),
    eventSuffixInput: describeVector('two-rate-event-suffix-input', eventSuffixInput),
    eventSuffixOutput: describeVector(
      'two-rate-event-suffix-output',
      eventSuffixOutput
    ),
    eventObservations: describeVector(
      'two-rate-event-observations',
      eventObservations
    )
  };

  const contract = {
    formatVersion: 1,
    type: 'TubeSimulatorPlugin',
    sampleRate: TUBE_ORACLE_SAMPLE_RATE,
    channels: TUBE_ORACLE_CHANNELS,
    oracleBlockSize: TUBE_ORACLE_BLOCK_SIZE,
    factor: TUBE_ORACLE_FACTOR,
    slowWindowEndpoints: TUBE_ORACLE_SLOW_WINDOW,
    outputBoundary: 'Float32',
    oracle: frozenOracleDescriptor(verified),
    telemetryFields,
    observationLayout: {
      order: 'field-major, then channel-major, then frame',
      fields: observationFields,
      frames: TUBE_ORACLE_BLOCK_SIZE
    },
    vectors,
    canonicalExact128: {
      params: resetParams,
      frames: TUBE_ORACLE_BLOCK_SIZE,
      input: 'resetPrefixInput',
      output: 'resetPrefixOutput'
    },
    cases: [
      {
        id: 'six-frame-nonaligned-partition',
        params: canonicalParams,
        frames: 1152,
        canonicalBlockSize: TUBE_ORACLE_BLOCK_SIZE,
        comparisonPartitions: [5, 7, 4, 11, 1],
        input: 'canonicalInput',
        output: 'canonicalOutput',
        checkpoint: canonicalCheckpoint
      },
      {
        id: 'reset-discards-partial-window',
        params: resetParams,
        prefixFrames: 128,
        suffixFrames: 384,
        beforeResetCheckpoint,
        afterResetCheckpoint,
        endCheckpoint: resetEndCheckpoint,
        prefixInput: 'resetPrefixInput',
        prefixOutput: 'resetPrefixOutput',
        suffixInput: 'resetSuffixInput',
        suffixOutput: 'resetSuffixOutput'
      },
      {
        id: 'mid-window-parameter-event',
        initialParams: eventInitialParams,
        eventParams,
        prefixFrames: 128,
        suffixFrames: 128,
        publishAfterEventHostFrames: 4,
        beforeEventCheckpoint: eventBeforeCheckpoint,
        endCheckpoint: eventEndCheckpoint,
        prefixInput: 'eventPrefixInput',
        prefixOutput: 'eventPrefixOutput',
        suffixInput: 'eventSuffixInput',
        suffixOutput: 'eventSuffixOutput',
        observations: 'eventObservations'
      }
    ]
  };
  return { contract, vectorValues, verified };
}

export async function generateTubeTwoRateGoldens({
  repoRoot = DEFAULT_REPO_ROOT,
  outputDir = path.join(repoRoot, relativeGoldenRoot)
} = {}) {
  const built = await buildTubeTwoRateGoldens({ repoRoot });
  await fs.mkdir(outputDir, { recursive: true });
  for (const [key, values] of Object.entries(built.vectorValues)) {
    await writeFloat32File(path.join(outputDir, built.contract.vectors[key].file), values);
  }
  const contractPath = path.join(outputDir, 'two-rate-contract-v1.json');
  await fs.writeFile(contractPath, jsonBuffer(built.contract));
  return { ...built, contractPath, outputDir };
}

export async function verifyTubeTwoRateGoldens({
  repoRoot = DEFAULT_REPO_ROOT,
  goldenDir = path.join(repoRoot, relativeGoldenRoot)
} = {}) {
  const built = await buildTubeTwoRateGoldens({ repoRoot });
  const contractPath = path.join(goldenDir, 'two-rate-contract-v1.json');
  const committed = JSON.parse(await fs.readFile(contractPath, 'utf8'));
  check(
    JSON.stringify(committed) === JSON.stringify(built.contract),
    'Tube Simulator two-rate contract differs from the frozen oracle'
  );

  const vectorEntries = Object.entries(built.vectorValues);
  check(vectorEntries.length === 11, `Tube Simulator expected 11 two-rate vectors, found ${vectorEntries.length}`);
  for (const [key, values] of vectorEntries) {
    const descriptor = committed.vectors[key];
    check(descriptor, `Tube Simulator two-rate contract is missing ${key}`);
    const committedBytes = await fs.readFile(path.join(goldenDir, descriptor.file));
    check(
      committedBytes.equals(encodeFloat32LE(values)),
      `Tube Simulator two-rate vector ${key} differs from the frozen oracle`
    );
  }

  const checkpointCount = committed.cases.reduce(
    (count, testCase) =>
      count + Object.keys(testCase).filter(key => key.toLowerCase().endsWith('checkpoint')).length,
    0
  );
  return {
    ...built,
    contract: committed,
    contractPath,
    outputDir: goldenDir,
    vectorCount: vectorEntries.length,
    checkpointCount,
    eventObservationFloats: built.vectorValues.eventObservations.length
  };
}

const TUBE_TORTURE_PRE_ROLL_FRAMES = 422400;
const TUBE_TORTURE_ACTIVE_FRAMES = 3072;
const TUBE_TORTURE_AMPLITUDE = 0.753565929453;
const TUBE_TORTURE_FREQUENCY = 20;
const TUBE_TORTURE_FIXTURE_NAME = 'torture-oracle-active-output.f32';
const TUBE_TORTURE_PARAMS = {
  dr: 0,
  tp: '12AT7',
  bi: -50,
  pv: 300,
  sz: 0.6,
  su: 0.1,
  og: 0,
  mx: 100
};

export async function buildTubeTortureOracleFixture({
  repoRoot = DEFAULT_REPO_ROOT
} = {}) {
  const verified = await verifyTubeOracle(repoRoot);
  const session = await createTubeOracleSession({
    repoRoot,
    params: TUBE_TORTURE_PARAMS,
    verified
  });
  const zero = new Float32Array(TUBE_ORACLE_CHANNELS * TUBE_ORACLE_BLOCK_SIZE);
  for (
    let offset = 0;
    offset < TUBE_TORTURE_PRE_ROLL_FRAMES;
    offset += TUBE_ORACLE_BLOCK_SIZE
  ) {
    session.processBlock(zero);
  }

  const output = new Float32Array(TUBE_ORACLE_CHANNELS * TUBE_TORTURE_ACTIVE_FRAMES);
  for (
    let offset = 0;
    offset < TUBE_TORTURE_ACTIVE_FRAMES;
    offset += TUBE_ORACLE_BLOCK_SIZE
  ) {
    const block = new Float32Array(TUBE_ORACLE_CHANNELS * TUBE_ORACLE_BLOCK_SIZE);
    for (let channel = 0; channel < TUBE_ORACLE_CHANNELS; channel++) {
      const channelOffset = channel * TUBE_ORACLE_BLOCK_SIZE;
      for (let frame = 0; frame < TUBE_ORACLE_BLOCK_SIZE; frame++) {
        const phase = 2 * Math.PI * TUBE_TORTURE_FREQUENCY * (offset + frame) /
          TUBE_ORACLE_SAMPLE_RATE;
        block[channelOffset + frame] = Math.sin(phase) >= 0
          ? TUBE_TORTURE_AMPLITUDE
          : -TUBE_TORTURE_AMPLITUDE;
      }
    }
    storeBlock(
      output,
      session.processBlock(block),
      TUBE_TORTURE_ACTIVE_FRAMES,
      offset
    );
  }
  const descriptor = describeVector('torture-oracle-active-output', output);
  const manifest = {
    formatVersion: TUBE_TORTURE_ORACLE_MANIFEST_VERSION,
    type: tubeType,
    outputBoundary: 'Float32LE',
    generation: {
      command:
        'node tools/dsp-parity/tube-simulator-oracle.mjs --write-torture-fixture',
      conditions: {
        params: TUBE_TORTURE_PARAMS,
        sampleRate: TUBE_ORACLE_SAMPLE_RATE,
        channels: TUBE_ORACLE_CHANNELS,
        blockSize: TUBE_ORACLE_BLOCK_SIZE,
        factor: TUBE_ORACLE_FACTOR,
        firLength: TUBE_ORACLE_FIR_LENGTH,
        slowWindowEndpoints: TUBE_ORACLE_SLOW_WINDOW,
        preRoll: {
          frames: TUBE_TORTURE_PRE_ROLL_FRAMES,
          input: 'stereo silence'
        },
        active: {
          frames: TUBE_TORTURE_ACTIVE_FRAMES,
          input: 'identical-channel bipolar square wave',
          amplitude: TUBE_TORTURE_AMPLITUDE,
          frequencyHz: TUBE_TORTURE_FREQUENCY,
          phaseOriginFrame: 0,
          polarity: 'sin(phase) >= 0 ? +amplitude : -amplitude'
        }
      }
    },
    oracle: frozenOracleDescriptor(verified),
    fixture: descriptor
  };
  return { output, descriptor, manifest, verified };
}

export async function writeTubeTortureOracleFixture({
  repoRoot = DEFAULT_REPO_ROOT,
  goldenDir = path.join(repoRoot, relativeGoldenRoot)
} = {}) {
  const built = await buildTubeTortureOracleFixture({ repoRoot });
  const fixturePath = path.join(goldenDir, TUBE_TORTURE_FIXTURE_NAME);
  const manifestPath = path.join(goldenDir, TUBE_TORTURE_ORACLE_MANIFEST_NAME);
  await writeFloat32File(fixturePath, built.output);
  await fs.writeFile(manifestPath, jsonBuffer(built.manifest));
  return { ...built, fixturePath, manifestPath };
}

export async function verifyTubeTortureOracleFixture({
  repoRoot = DEFAULT_REPO_ROOT,
  goldenDir = path.join(repoRoot, relativeGoldenRoot)
} = {}) {
  const built = await buildTubeTortureOracleFixture({ repoRoot });
  const fixturePath = path.join(goldenDir, TUBE_TORTURE_FIXTURE_NAME);
  const manifestPath = path.join(goldenDir, TUBE_TORTURE_ORACLE_MANIFEST_NAME);
  const [committedBytes, manifestBytes] = await Promise.all([
    fs.readFile(fixturePath),
    fs.readFile(manifestPath)
  ]);
  const committed = JSON.parse(manifestBytes.toString('utf8'));
  check(
    JSON.stringify(committed) === JSON.stringify(built.manifest),
    'Tube Simulator torture oracle manifest differs from the frozen oracle'
  );
  check(
    committedBytes.equals(encodeFloat32LE(built.output)),
    'Tube Simulator torture oracle fixture differs byte-for-byte from the frozen oracle'
  );
  return { ...built, manifest: committed, fixturePath, manifestPath };
}

export async function runTubeOracleCli(argv = process.argv.slice(2)) {
  if (argv.includes('--write-standard-manifest')) {
    const result = await writeTubeStandardOracleManifest();
    console.log(
      `Wrote Tube Simulator standard oracle manifest for ${result.caseCount} cases ` +
      `(worst abs ${result.worstAbsoluteError})`
    );
    return result;
  }
  if (argv.includes('--verify-standard-goldens')) {
    const result = await verifyTubeStandardGoldens();
    console.log(
      `Tube Simulator standard oracle verified ${result.caseCount} cases ` +
      `(worst abs ${result.worstAbsoluteError})`
    );
    return result;
  }
  if (argv.includes('--generate-standard-goldens')) {
    return generateTubeStandardGoldens();
  }
  if (argv.includes('--verify-two-rate-goldens')) {
    const result = await verifyTubeTwoRateGoldens();
    console.log(
      `Tube Simulator two-rate oracle verified ${result.vectorCount} vectors, ` +
      `${result.checkpointCount} checkpoints, and ` +
      `${result.eventObservationFloats} event-observation values`
    );
    return result;
  }
  if (argv.includes('--write-torture-fixture')) {
    const result = await writeTubeTortureOracleFixture();
    console.log(
      `Wrote Tube Simulator torture oracle fixture ${result.descriptor.sha256} ` +
      `to ${result.fixturePath}`
    );
    return result;
  }
  if (argv.includes('--verify-torture-fixture')) {
    const result = await verifyTubeTortureOracleFixture();
    console.log(
      `Tube Simulator torture oracle fixture verified ${result.descriptor.floats} floats ` +
      `(${result.descriptor.sha256})`
    );
    return result;
  }
  const verifyOnly = argv.includes('--verify');
  if (verifyOnly) {
    const verified = await verifyTubeOracle();
    console.log(
      `Tube Simulator oracle verified: source=${verified.sourceSha256} ` +
      `wasm=${verified.wasmSha256}`
    );
    return verified;
  }
  const result = await generateTubeTwoRateGoldens();
  console.log(`Wrote Tube Simulator two-rate goldens to ${result.outputDir}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTubeOracleCli().catch(error => {
    console.error(`Tube Simulator oracle failed: ${error.message}`);
    process.exitCode = 1;
  });
}
