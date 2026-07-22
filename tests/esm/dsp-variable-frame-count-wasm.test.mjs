import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { buildDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { createReferenceSession } from '../../tools/dsp-parity/node-host.mjs';
import { comparePerSample, formatComparison } from '../../tools/dsp-parity/tolerance.mjs';

const SAMPLE_RATE = 48000;
const CHANNEL_COUNT = 2;
const MIN_FRAME_COUNT = 4;
const MAX_FRAME_COUNT = 128;
const VARIABLE_FRAME_COUNTS = Array.from(
  { length: MAX_FRAME_COUNT - MIN_FRAME_COUNT + 1 },
  (_, index) => MIN_FRAME_COUNT + index
);
VARIABLE_FRAME_COUNTS.push(70);
const TOTAL_FRAME_COUNT = VARIABLE_FRAME_COUNTS.reduce((total, count) => total + count, 0);
const FIXED_FRAME_COUNTS = Array(TOTAL_FRAME_COUNT / MAX_FRAME_COUNT).fill(MAX_FRAME_COUNT);
const SEED_LOW = 0x89abcdef;
const SEED_HIGH = 0x01234567;
const SEED = (BigInt(SEED_HIGH) << 32n) | BigInt(SEED_LOW);
const WASM_ARTIFACTS = ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm'];
const KERNEL_TOLERANCES = readKernelTolerances();
const STRICT_INVARIANCE_CASES = [
  {
    id: 'BitCrusher default',
    kernelName: 'BitCrusherPlugin',
    params: {},
    parityTolerance: readPerSampleTolerance('../../dsp/plugins/lofi/bit_crusher/params.json')
  },
  {
    id: 'NoiseBlender default',
    kernelName: 'NoiseBlenderPlugin',
    params: {},
    parityTolerance: readPerSampleTolerance('../../dsp/plugins/lofi/noise_blender/params.json')
  },
  {
    id: 'HardClipping default',
    kernelName: 'HardClippingPlugin',
    params: {},
    parityTolerance: readPerSampleTolerance(
      '../../dsp/plugins/saturation/hard_clipping/params.json'
    )
  },
  {
    id: 'Expander default',
    kernelName: 'ExpanderPlugin',
    params: {},
    parityTolerance: readPerSampleTolerance('../../dsp/plugins/dynamics/expander/params.json')
  },
  {
    id: 'AutoLeveler active attenuation',
    kernelName: 'AutoLevelerPlugin',
    params: { tg: -36, ng: -36, at: 1, gt: -96 },
    parityTolerance: readPerSampleTolerance(
      '../../dsp/plugins/dynamics/auto_leveler/params.json'
    )
  },
  {
    id: 'MultibandExpander default',
    kernelName: 'MultibandExpanderPlugin',
    params: {},
    parityTolerance: readPerSampleTolerance(
      '../../dsp/plugins/dynamics/multiband_expander/params.json'
    )
  },
  {
    id: 'BitCrusher TPDF',
    kernelName: 'BitCrusherPlugin',
    params: { bd: 8, td: true, zf: SAMPLE_RATE, be: 10, sd: 11 },
    parityTolerance: readPerSampleTolerance('../../dsp/plugins/lofi/bit_crusher/params.json')
  }
];

function readPerSampleTolerance(relativePath) {
  const schema = JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
  assert.equal(schema.tolerance?.policy, 'per-sample', `${schema.type} tolerance policy`);
  return schema.tolerance;
}

function readKernelTolerances() {
  const root = new URL('../../dsp/plugins/', import.meta.url);
  const relativePaths = fs.readdirSync(root, { recursive: true });
  const tolerances = new Map();
  for (const relativePath of relativePaths) {
    if (!relativePath.endsWith('params.json')) continue;
    const schemaUrl = new URL(relativePath.replaceAll('\\', '/'), root);
    const schema = JSON.parse(fs.readFileSync(schemaUrl, 'utf8'));
    assert.ok(Number.isFinite(schema.tolerance?.abs), `${schema.type} absolute tolerance`);
    assert.equal(tolerances.has(schema.type), false, `${schema.type} duplicate schema`);
    tolerances.set(schema.type, schema.tolerance);
  }
  return tolerances;
}

function fillInput(audio, frameCount, processedFrames) {
  audio.fill(0);
  for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
    const channelOffset = channel * frameCount;
    const frequency = channel === 0 ? 997 : 1499;
    for (let frame = 0; frame < frameCount; frame++) {
      audio[channelOffset + frame] = Math.sin(
        2 * Math.PI * frequency * (processedFrames + frame) / SAMPLE_RATE
      ) * 0.125;
    }
  }
}

function stageParameters(binding, kernelName, instanceId, params = {}) {
  const packer = DSP_PARAM_PACKERS.get(kernelName);
  assert.ok(packer, `${kernelName} parameter packer`);
  assert.equal(
    binding.instanceSetParams(instanceId, packer.pack(params), packer.hash),
    0,
    `${kernelName} parameters`
  );
  if (packer.packBytes) {
    assert.equal(
      binding.instanceSetParamBytes(instanceId, packer.packBytes(params), packer.hash),
      0,
      `${kernelName} structured parameters`
    );
  }
  assert.equal(binding.instanceSetSeed(instanceId, SEED_LOW, SEED_HIGH), 0);
}

function configurePipeline(binding, kernelName, instanceId) {
  const descriptor = buildDspPipelineDescriptor([
    { enabled: true, inputBus: 0, outputBus: 0, channel: 'A' }
  ], {
    getInstanceId() {
      return instanceId;
    }
  });
  assert.equal(
    binding.pipelineConfigure(descriptor),
    0,
    `${kernelName} pipeline configuration`
  );
}

function warmUpInstance(binding, arena, kernelName, instanceId) {
  configurePipeline(binding, kernelName, instanceId);
  fillInput(arena.combined, MAX_FRAME_COUNT, 0);
  assert.equal(
    binding.pipelineProcess(CHANNEL_COUNT, MAX_FRAME_COUNT, 0, false),
    0,
    `${kernelName} warmup`
  );
}

function processSequence(binding, arena, kernelName, instanceId, frameCounts, startFrame) {
  configurePipeline(binding, kernelName, instanceId);
  const output = new Float32Array(CHANNEL_COUNT * TOTAL_FRAME_COUNT);
  let processedFrames = 0;

  for (const frameCount of frameCounts) {
    fillInput(arena.combined, frameCount, startFrame + processedFrames);
    assert.equal(
      binding.pipelineProcess(
        CHANNEL_COUNT, frameCount, (startFrame + processedFrames) / SAMPLE_RATE, false
      ),
      0,
      `${kernelName} pipeline rejected ${frameCount} frames`
    );

    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const sourceOffset = channel * frameCount;
      const targetOffset = channel * TOTAL_FRAME_COUNT + processedFrames;
      const channelOutput = arena.combined.subarray(sourceOffset, sourceOffset + frameCount);
      for (const sample of channelOutput) {
        assert.ok(
          Number.isFinite(sample),
          `${kernelName} produced a non-finite sample at ${frameCount} frames`
        );
      }
      output.set(channelOutput, targetOffset);
    }
    processedFrames += frameCount;
  }

  assert.equal(processedFrames, TOTAL_FRAME_COUNT);
  return output;
}

async function processReferenceSequence(session, frameCounts) {
  const output = new Float32Array(CHANNEL_COUNT * TOTAL_FRAME_COUNT);
  let processedFrames = 0;

  for (const frameCount of frameCounts) {
    const input = new Float32Array(CHANNEL_COUNT * frameCount);
    fillInput(input, frameCount, processedFrames);
    const block = await session.process(input, {
      sampleRate: SAMPLE_RATE,
      frames: frameCount,
      channels: CHANNEL_COUNT,
      blockSize: frameCount
    });
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const sourceOffset = channel * frameCount;
      const targetOffset = channel * TOTAL_FRAME_COUNT + processedFrames;
      output.set(block.subarray(sourceOffset, sourceOffset + frameCount), targetOffset);
    }
    processedFrames += frameCount;
  }

  assert.equal(processedFrames, TOTAL_FRAME_COUNT);
  return output;
}

function assertPerSample(expected, actual, tolerance, message) {
  const comparison = comparePerSample(expected, actual, tolerance);
  assert.ok(comparison.pass, `${message}: ${formatComparison(comparison)}`);
}

for (const artifact of WASM_ARTIFACTS) {
  test(`all registered kernels preserve output across frame counts in ${artifact}`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, CHANNEL_COUNT, MAX_FRAME_COUNT, 4096), 0);

      const capabilities = binding.getCapabilities();
      const invarianceFailures = [];
      for (const kernel of capabilities.kernels) {
        const fixedInstanceId = binding.createInstance(kernel.name);
        assert.notEqual(fixedInstanceId, 0, `${kernel.name} fixed-size instance`);
        try {
          const variableInstanceId = binding.createInstance(kernel.name);
          assert.notEqual(variableInstanceId, 0, `${kernel.name} variable-size instance`);
          try {
            const arena = binding.getArenaViews();
            stageParameters(binding, kernel.name, fixedInstanceId);
            stageParameters(binding, kernel.name, variableInstanceId);
            warmUpInstance(binding, arena, kernel.name, fixedInstanceId);
            warmUpInstance(binding, arena, kernel.name, variableInstanceId);
            const fixedOutput = processSequence(
              binding, arena, kernel.name, fixedInstanceId, FIXED_FRAME_COUNTS, MAX_FRAME_COUNT
            );
            const variableOutput = processSequence(
              binding, arena, kernel.name, variableInstanceId, VARIABLE_FRAME_COUNTS,
              MAX_FRAME_COUNT
            );
            const tolerance = KERNEL_TOLERANCES.get(kernel.name);
            assert.ok(tolerance, `${kernel.name} tolerance`);
            const comparison = comparePerSample(fixedOutput, variableOutput, tolerance);
            if (!comparison.pass) {
              invarianceFailures.push(
                `${kernel.name}: ${formatComparison(comparison)}`
              );
            }
          } finally {
            binding.destroyInstance(variableInstanceId);
          }
        } finally {
          binding.destroyInstance(fixedInstanceId);
        }
      }

      assert.deepEqual(invarianceFailures, []);
      assert.equal(binding.memoryGrowthViolation, false);
    } finally {
      binding.close();
    }
  });
}

async function createStrictReferenceOutput(testCase) {
  const fixedSession = await createReferenceSession(testCase.kernelName, {
    params: testCase.params,
    seed: SEED
  });
  const variableSession = await createReferenceSession(testCase.kernelName, {
    params: testCase.params,
    seed: SEED
  });
  const fixedOutput = await processReferenceSequence(fixedSession, FIXED_FRAME_COUNTS);
  const variableOutput = await processReferenceSequence(variableSession, VARIABLE_FRAME_COUNTS);
  assertPerSample(
    fixedOutput, variableOutput, { abs: 0 }, `${testCase.id} JS reference changed`
  );
  return fixedOutput;
}

function processStrictWasmCase(binding, artifact, testCase) {
  const fixedInstanceId = binding.createInstance(testCase.kernelName);
  const variableInstanceId = binding.createInstance(testCase.kernelName);
  assert.notEqual(fixedInstanceId, 0, `${artifact} ${testCase.id} fixed-size instance`);
  assert.notEqual(variableInstanceId, 0, `${artifact} ${testCase.id} variable-size instance`);
  try {
    const arena = binding.getArenaViews();
    stageParameters(binding, testCase.kernelName, fixedInstanceId, testCase.params);
    stageParameters(binding, testCase.kernelName, variableInstanceId, testCase.params);
    const fixedOutput = processSequence(
      binding, arena, testCase.kernelName, fixedInstanceId, FIXED_FRAME_COUNTS, 0
    );
    const variableOutput = processSequence(
      binding, arena, testCase.kernelName, variableInstanceId, VARIABLE_FRAME_COUNTS, 0
    );
    assertPerSample(
      fixedOutput,
      variableOutput,
      { abs: 0 },
      `${artifact} ${testCase.id} changed across frame counts`
    );
    return fixedOutput;
  } finally {
    binding.destroyInstance(variableInstanceId);
    binding.destroyInstance(fixedInstanceId);
  }
}

test('target plugins are strictly frame-count invariant across JS and WASM', async () => {
  const referenceOutputs = new Map();
  for (const testCase of STRICT_INVARIANCE_CASES) {
    referenceOutputs.set(testCase.id, await createStrictReferenceOutput(testCase));
  }

  let baselineOutputs = null;
  for (const artifact of WASM_ARTIFACTS) {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const binding = await instantiateDsp(bytes);
    try {
      assert.notEqual(binding.createEngine(), 0);
      assert.equal(binding.prepare(SAMPLE_RATE, CHANNEL_COUNT, MAX_FRAME_COUNT, 4096), 0);
      const artifactOutputs = new Map();
      for (const testCase of STRICT_INVARIANCE_CASES) {
        const output = processStrictWasmCase(binding, artifact, testCase);
        artifactOutputs.set(testCase.id, output);
        assertPerSample(
          referenceOutputs.get(testCase.id),
          output,
          testCase.parityTolerance,
          `${artifact} ${testCase.id} diverged from the JS reference`
        );
        if (baselineOutputs !== null) {
          assertPerSample(
            baselineOutputs.get(testCase.id),
            output,
            { abs: 0 },
            `baseline and SIMD WASM diverged for ${testCase.id}`
          );
        }
      }
      if (baselineOutputs === null) baselineOutputs = artifactOutputs;
      assert.equal(binding.memoryGrowthViolation, false);
    } finally {
      binding.close();
    }
  }
});
