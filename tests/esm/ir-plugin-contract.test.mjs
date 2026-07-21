import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { IR_ASSET_TOPOLOGY } from '../../js/ir-library/ir-asset-payload.js';
import {
  estimateIrKernelCommitFootprint,
  IR_KERNEL_ASSET_CAPACITY_BYTES,
  maximumIrFramesForKernel,
  resolveIrProcessingConfig,
  selectedIrChannelCount
} from '../../js/ir-library/ir-plugin-contract.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('IR rate and latency resolver enforces the product combinations', () => {
  assert.deepEqual(
    resolveIrProcessingConfig({
      sampleRate: 96000,
      channelCount: 2,
      channelMode: 'auto',
      latency: '128',
      convolutionRate: 'auto'
    }),
    {
      valid: true,
      channelMode: 'indep',
      topology: IR_ASSET_TOPOLOGY.independent,
      assetChannels: 2,
      selectedChannels: 2,
      processingChannels: 2,
      paths: [],
      pathCount: 0,
      inputCount: 0,
      headBlock: 128,
      rateMode: 'half',
      rateDivider: 2,
      sampleRate: 48000
    }
  );
  assert.equal(resolveIrProcessingConfig({
    sampleRate: 192000,
    channelCount: 2,
    latency: '0',
    convolutionRate: 'quarter'
  }).rateDivider, 1);
  assert.equal(resolveIrProcessingConfig({
    sampleRate: 96000,
    channelCount: 1,
    latency: '128',
    convolutionRate: 'quarter'
  }).valid, false);
  assert.equal(resolveIrProcessingConfig({
    sampleRate: 48000,
    channelCount: 4,
    channelMode: 'auto',
    latency: '128',
    convolutionRate: 'full',
    engineChannels: 4,
    selectedChannels: 4
  }).topology, IR_ASSET_TOPOLOGY.independent);
  assert.equal(resolveIrProcessingConfig({
    sampleRate: 48000,
    channelCount: 4,
    channelMode: 'auto',
    latency: '128',
    convolutionRate: 'full'
  }).topology, IR_ASSET_TOPOLOGY.trueStereo);
  assert.equal(resolveIrProcessingConfig({
    sampleRate: 48000,
    channelCount: 4,
    channelMode: 'mono',
    latency: '128',
    convolutionRate: 'full'
  }).valid, true);
});

test('IR topology resolver combines routing selection, channel layout, and explicit mode', () => {
  assert.equal(selectedIrChannelCount(null, 8), 2);
  assert.equal(selectedIrChannelCount('A', 8), 8);
  assert.equal(selectedIrChannelCount('34', 4), 2);
  assert.equal(selectedIrChannelCount('78', 6), 0);

  const explicitTrue = resolveIrProcessingConfig({
    sampleRate: 48000,
    channelCount: 4,
    engineChannels: 2,
    selectedChannels: 2,
    channelMode: 'true'
  });
  assert.equal(explicitTrue.topology, IR_ASSET_TOPOLOGY.trueStereo);
  assert.equal(explicitTrue.assetChannels, 4);
  assert.equal(explicitTrue.pathCount, 0);

  const autoTrue = resolveIrProcessingConfig({
    sampleRate: 48000,
    channelCount: 4,
    engineChannels: 2,
    selectedChannels: 2,
    channelMode: 'auto'
  });
  assert.equal(autoTrue.topology, IR_ASSET_TOPOLOGY.trueStereo);
  assert.equal(autoTrue.channelMode, 'true');

  const plainFour = resolveIrProcessingConfig({
    sampleRate: 48000,
    channelCount: 4,
    engineChannels: 4,
    selectedChannels: 4,
    channelMode: 'auto'
  });
  assert.equal(plainFour.topology, IR_ASSET_TOPOLOGY.independent);

  const diagonal = resolveIrProcessingConfig({
    sampleRate: 48000,
    channelCount: 6,
    engineChannels: 8,
    selectedChannels: 8,
    channelMode: 'auto'
  });
  assert.equal(diagonal.topology, IR_ASSET_TOPOLOGY.matrix);
  assert.equal(diagonal.pathCount, 6);
  assert.equal(diagonal.inputCount, 6);
  assert.deepEqual(diagonal.paths[5], { inputSlot: 5, outputSlot: 5, irChannel: 5 });
});

test('IR topology footprint includes true-stereo sharing and matrix route metadata', () => {
  const trueStereo = estimateIrKernelCommitFootprint({
    frames: 10000,
    assetChannels: 4,
    topology: IR_ASSET_TOPOLOGY.trueStereo,
    processingChannels: 2,
    headBlock: 128
  });
  const matrix = estimateIrKernelCommitFootprint({
    frames: 10000,
    assetChannels: 4,
    topology: IR_ASSET_TOPOLOGY.matrix,
    processingChannels: 8,
    headBlock: 128,
    pathCount: 8,
    inputCount: 2
  });
  assert.ok(trueStereo > 0);
  assert.ok(matrix > trueStereo);
  const maximum = maximumIrFramesForKernel({
    sourceFrames: 10_000_000,
    assetChannels: 4,
    topology: IR_ASSET_TOPOLOGY.matrix,
    processingChannels: 8,
    headBlock: 128,
    pathCount: 8,
    inputCount: 2
  });
  assert.ok(estimateIrKernelCommitFootprint({
    frames: maximum,
    assetChannels: 4,
    topology: IR_ASSET_TOPOLOGY.matrix,
    processingChannels: 8,
    headBlock: 128,
    pathCount: 8,
    inputCount: 2
  }) <= IR_KERNEL_ASSET_CAPACITY_BYTES);
});

test('IR footprint never under-reports the kernel admission expression at its boundary', () => {
  const config = {
    sourceFrames: 10_000_000,
    assetChannels: 2,
    topology: IR_ASSET_TOPOLOGY.independent,
    processingChannels: 2
  };
  const frames = maximumIrFramesForKernel(config);
  const admitted = estimateIrKernelCommitFootprint({ ...config, frames });
  const rejected = estimateIrKernelCommitFootprint({ ...config, frames: frames + 1 });
  assert.ok(admitted <= IR_KERNEL_ASSET_CAPACITY_BYTES);
  assert.ok(rejected > IR_KERNEL_ASSET_CAPACITY_BYTES);

  const payloadBytes = 32 + frames * config.assetChannels * 4;
  const kernelExpression = payloadBytes + frames * config.assetChannels * 16 + 2 * 1024 * 1024;
  assert.ok(admitted >= kernelExpression);
});

test('IR host limit reflects head-block allocation and remains conservative at each boundary', () => {
  const common = {
    sourceFrames: 10_000_000,
    assetChannels: 2,
    topology: IR_ASSET_TOPOLOGY.independent,
    processingChannels: 2
  };
  const limits = [0, 128, 256, 512, 1024].map(headBlock => ({
    headBlock,
    frames: maximumIrFramesForKernel({ ...common, headBlock })
  }));
  for (const limit of limits) {
    assert.ok(estimateIrKernelCommitFootprint({
      ...common,
      frames: limit.frames,
      headBlock: limit.headBlock
    }) <= IR_KERNEL_ASSET_CAPACITY_BYTES);
    assert.ok(estimateIrKernelCommitFootprint({
      ...common,
      frames: limit.frames + 1,
      headBlock: limit.headBlock
    }) > IR_KERNEL_ASSET_CAPACITY_BYTES);
  }
});

test('IR footprint test detects drift from the kernel conservative admission constants', async () => {
  const kernel = await fs.readFile(
    path.join(repoRoot, 'dsp', 'plugins', 'reverb', 'ir_reverb', 'kernel.cpp'),
    'utf8'
  );
  assert.match(
    kernel,
    /convolver_\.memoryBytes\(\) \+ info\.byteSize > info\.footprintBytes/
  );
  assert.match(kernel, /config\.outputs = info\.processingChannels/);
  assert.doesNotMatch(kernel, /releaseStagingIfPending/);
  assert.doesNotMatch(kernel, /staging_release_pending_/);
  const convolver = await fs.readFile(
    path.join(repoRoot, 'dsp', 'core', 'partitioned_convolver.cpp'),
    'utf8'
  );
  assert.match(convolver, /ir_channels_\) \* partitions_ \* fft_size_/);
  assert.doesNotMatch(convolver, /paths_\.size\(\) \* partitions_ \* fft_size_/);
  const nativeTest = await fs.readFile(
    path.join(repoRoot, 'dsp', 'plugins', 'reverb', 'ir_reverb', 'native_test.cpp'),
    'utf8'
  );
  assert.match(nativeTest, /kConvolverImplUpperBound = 512u/);
  assert.match(nativeTest, /kConvolverStageUpperBound = 512u/);
  assert.match(nativeTest, /kPffftSetupFixedUpperBound = 136u/);
  assert.match(nativeTest, /hostFootprint\(maximum \+ 1u[\s\S]*>\s*kAssetCapacity/);
  assert.match(nativeTest, /convolver\.memoryBytes\(\) \+ payload/);
});
