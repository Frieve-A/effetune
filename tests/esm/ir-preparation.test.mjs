import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIrAssetPayload,
  IR_ASSET_HEADER_BYTES,
  IR_ASSET_MAGIC,
  IR_ASSET_TOPOLOGY
} from '../../js/ir-library/ir-asset-payload.js';
import {
  emitPreparedIr,
  getIrPreparationTransferables,
  prepareIr
} from '../../js/ir-library/ir-preparation.js';

function channelEnergy(channel) {
  let energy = 0;
  for (const sample of channel) energy += sample * sample;
  return energy;
}

function exponentialIr({ frames, sampleRate, rt60Seconds }) {
  const samples = new Float32Array(frames);
  const slope = -Math.log(1000) / (sampleRate * rt60Seconds);
  for (let frame = 0; frame < frames; frame += 1) samples[frame] = Math.exp(slope * frame);
  return samples;
}

test('IR payload builder emits the ETA1 header and channel-major samples', () => {
  const payload = buildIrAssetPayload({
    channels: [new Float32Array([1, -0.5]), new Float32Array([0.25, 0.75])],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.independent
  });
  const view = new DataView(payload);

  assert.equal(payload.byteLength, IR_ASSET_HEADER_BYTES + 4 * Float32Array.BYTES_PER_ELEMENT);
  assert.equal(view.getUint32(0, true), IR_ASSET_MAGIC);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), 2);
  assert.equal(view.getUint32(12, true), 48000);
  assert.equal(view.getUint32(16, true), IR_ASSET_TOPOLOGY.independent);
  assert.equal(view.getUint32(20, true), 0);
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => view.getFloat32(IR_ASSET_HEADER_BYTES + index * 4, true)),
    [1, -0.5, 0.25, 0.75]
  );
});

test('IR payload builder places matrix paths before sample data', () => {
  const payload = buildIrAssetPayload({
    channels: [new Float32Array([0.5]), new Float32Array([-0.25])],
    sampleRate: 96000,
    topology: IR_ASSET_TOPOLOGY.matrix,
    paths: [
      { inputSlot: 0, outputSlot: 1, irChannel: 0 },
      { inputSlot: 1, outputSlot: 0, irChannel: 1 }
    ]
  });
  const view = new DataView(payload);

  assert.equal(view.getUint32(20, true), 2);
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => view.getUint32(IR_ASSET_HEADER_BYTES + index * 4, true)),
    [0, 1, 0, 1, 0, 1]
  );
  assert.equal(view.getFloat32(IR_ASSET_HEADER_BYTES + 24, true), 0.5);
  assert.equal(view.getFloat32(IR_ASSET_HEADER_BYTES + 28, true), -0.25);
});

test('IR payload builder rejects malformed assets before allocation', () => {
  assert.throws(() => buildIrAssetPayload({ channels: [], sampleRate: 48000 }), /channels/);
  assert.throws(() => buildIrAssetPayload({
    channels: [new Float32Array([1]), new Float32Array([1, 2])],
    sampleRate: 48000
  }), /equally sized/);
  assert.throws(() => buildIrAssetPayload({
    channels: [new Float32Array([Number.NaN])],
    sampleRate: 48000
  }), /finite/);
  assert.throws(() => buildIrAssetPayload({
    channels: [new Float32Array([1])],
    sampleRate: 0
  }), /sample rate/);
  assert.throws(() => buildIrAssetPayload({
    channels: [new Float32Array([1])],
    sampleRate: 48000,
    topology: 9
  }), /topology/);
  assert.throws(() => buildIrAssetPayload({
    channels: [new Float32Array([1])],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.matrix,
    paths: []
  }), /Matrix topology/);
});

test('IR preparation trims silence, cuts the direct impulse, and preserves its input', () => {
  const input = new Float32Array(256);
  input[32] = 1;
  for (let frame = 33; frame < input.length; frame += 1) {
    input[frame] = 0.25 * Math.exp(-(frame - 33) / 40);
  }
  const before = input.slice();

  const result = prepareIr({
    channels: [input],
    sampleRate: 48000,
    options: { directCut: true }
  });

  assert.deepEqual(input, before);
  assert.equal(result.analysis.onsetFrame, 32);
  assert.equal(result.analysis.leadingSilenceFrames, 32);
  assert.equal(result.analysis.cutFrame, 32);
  assert.equal(result.analysis.sourceStartFrame, 33);
  assert.equal(result.channels[0][0], 0);
  assert.ok(channelEnergy(result.channels[0]) < 1);
  assert.equal(result.asset.frames, 223);
  assert.equal(new DataView(result.payload).getUint32(0, true), IR_ASSET_MAGIC);
});

test('Direct Cut leaves wet-tail samples at the uncut level', () => {
  const input = new Float32Array(512);
  input[32] = 1;
  for (let frame = 33; frame < input.length; frame += 1) {
    input[frame] = 0.2 * Math.exp(-(frame - 33) / 100);
  }

  const uncut = prepareIr({ channels: [input], sampleRate: 48000 });
  const cut = prepareIr({
    channels: [input],
    sampleRate: 48000,
    options: { directCut: true }
  });
  const sourceOffset = cut.analysis.sourceStartFrame - uncut.analysis.sourceStartFrame;

  assert.ok(sourceOffset > 0);
  assert.ok(channelEnergy(cut.channels[0]) < channelEnergy(uncut.channels[0]));
  assert.ok(Math.abs(
    cut.analysis.initialNormalizationGains[0] - uncut.analysis.initialNormalizationGains[0]
  ) < 1e-6);
  assert.ok(Math.abs(
    cut.analysis.finalNormalizationGains[0] - uncut.analysis.finalNormalizationGains[0]
  ) < 1e-6);
  for (let frame = 64; frame < cut.channels[0].length; frame += 37) {
    assert.ok(Math.abs(cut.channels[0][frame] - uncut.channels[0][frame + sourceOffset]) < 1e-6);
  }

  const decayedUncut = prepareIr({
    channels: [input],
    sampleRate: 48000,
    options: { decayPercent: 200 }
  });
  const decayedCut = prepareIr({
    channels: [input],
    sampleRate: 48000,
    options: { decayPercent: 200, directCut: true }
  });
  for (let frame = 64; frame < decayedCut.channels[0].length; frame += 37) {
    assert.ok(Math.abs(
      decayedCut.channels[0][frame] - decayedUncut.channels[0][frame + sourceOffset]
    ) < 1e-6);
  }

  const shapedOptions = { decayPercent: 200, trimPercent: 60, maxFrames: 200 };
  const shapedUncut = prepareIr({
    channels: [input],
    sampleRate: 48000,
    options: shapedOptions
  });
  const shapedCut = prepareIr({
    channels: [input],
    sampleRate: 48000,
    options: { ...shapedOptions, directCut: true }
  });
  assert.ok(Math.abs(
    shapedCut.analysis.finalNormalizationGains[0] -
      shapedUncut.analysis.finalNormalizationGains[0]
  ) < 1e-5);
});

test('IR preparation reshapes exponential decay and bounds graph analysis', () => {
  const sampleRate = 1000;
  const input = exponentialIr({ frames: 4000, sampleRate, rt60Seconds: 1 });
  const original = prepareIr({ channels: [input], sampleRate });
  const extended = prepareIr({
    channels: [input],
    sampleRate,
    options: { decayPercent: 200, analysisPoints: 250 }
  });

  assert.ok(Math.abs(original.analysis.rt60Seconds - 1) < 0.03);
  assert.ok(Math.abs(extended.analysis.rt60Seconds - 2) < 0.08);
  assert.equal(extended.analysis.envelope.length, 250);
  assert.equal(extended.analysis.edcDb.length, 250);
  assert.equal(extended.analysis.sampleFrames.length, 250);
  assert.ok(extended.analysis.edcDb[0] > -0.001);
  assert.ok(extended.analysis.edcDb.at(-1) < extended.analysis.edcDb[0]);
});

test('IR preparation applies trim and max-frame fade before building a transferable payload', () => {
  const input = exponentialIr({ frames: 5000, sampleRate: 48000, rt60Seconds: 0.1 });
  const result = prepareIr({
    channels: [input, input.slice()],
    sampleRate: 48000,
    options: {
      topology: IR_ASSET_TOPOLOGY.independent,
      trimPercent: 75,
      maxFrames: 1000
    }
  });
  const transfers = getIrPreparationTransferables(result);

  assert.equal(result.frames, 1000);
  assert.equal(result.analysis.truncated, true);
  assert.equal(result.channels[0].at(-1), 0);
  assert.equal(result.channels[1].at(-1), 0);
  assert.ok(Math.abs(channelEnergy(result.channels[0]) - 1) < 1e-5);
  assert.ok(result.analysis.envelope.length <= 2000);
  const expectedL1 = result.channels[0].reduce((sum, sample) => sum + Math.abs(sample), 0);
  assert.ok(Math.abs(result.analysis.l1GainUpperBound - expectedL1) < 1e-5);
  assert.ok(Number.isFinite(result.analysis.l1GainUpperBoundDb));
  assert.ok(transfers.includes(result.payload));
  assert.ok(transfers.includes(result.channels[0].buffer));
  assert.equal(new Set(transfers).size, transfers.length);
  assert.equal(result.asset.byteLength, IR_ASSET_HEADER_BYTES + 2 * 1000 * 4);
});

test('IR payload emission reuses full prepared PCM and restores a formerly limited tail', () => {
  const full = new Float32Array([1, 0.8, 0.6, 0.4, 0.2, 0.1]);
  const original = full.slice();
  const other = new Float32Array([0, 0, 0, 0, 0, 0]);
  const limited = emitPreparedIr({
    channels: [full, other],
    sampleRate: 48000,
    options: { topology: IR_ASSET_TOPOLOGY.independent, maxFrames: 3 }
  });
  const restoredMono = emitPreparedIr({
    channels: [full, other],
    sampleRate: 48000,
    options: { topology: IR_ASSET_TOPOLOGY.mono, maxFrames: 6 }
  });

  assert.equal(limited.frames, 3);
  assert.equal(limited.analysis.truncated, true);
  assert.equal(restoredMono.frames, 6);
  assert.equal(restoredMono.asset.channels, 1);
  assert.equal(restoredMono.channels[0][0], 1);
  assert.ok(Math.abs(restoredMono.channels[0][5] - 0.1) < 1e-6);
  assert.deepEqual(full, original);
});

test('true-stereo preparation preserves capture balance with one joint normalization gain', () => {
  const channels = [1, 2, 3, 4].map(value => new Float32Array([value, 0, 0, 0]));
  const result = prepareIr({
    channels,
    sampleRate: 48000,
    options: { topology: IR_ASSET_TOPOLOGY.trueStereo }
  });
  const amplitudes = result.channels.map(channel => channel[0]);
  assert.ok(Math.abs(amplitudes[1] / amplitudes[0] - 2) < 1e-6);
  assert.ok(Math.abs(amplitudes[2] / amplitudes[0] - 3) < 1e-6);
  assert.ok(Math.abs(amplitudes[3] / amplitudes[0] - 4) < 1e-6);
  assert.equal(new Set(result.analysis.finalNormalizationGains).size, 1);
  assert.equal(result.asset.topology, IR_ASSET_TOPOLOGY.trueStereo);
});

test('IR preparation bounds wet gain by every route entering the loudest output', () => {
  const mono = emitPreparedIr({
    channels: [new Float32Array([1, -1]), new Float32Array([4, 0])],
    sampleRate: 48000,
    options: { topology: IR_ASSET_TOPOLOGY.mono }
  });
  assert.equal(mono.analysis.l1GainUpperBound, 2);

  const independent = emitPreparedIr({
    channels: [new Float32Array([1]), new Float32Array([2])],
    sampleRate: 48000,
    options: { topology: IR_ASSET_TOPOLOGY.independent }
  });
  assert.equal(independent.analysis.l1GainUpperBound, 2);

  const trueStereo = emitPreparedIr({
    channels: Array.from({ length: 4 }, () => new Float32Array([1])),
    sampleRate: 48000,
    options: { topology: IR_ASSET_TOPOLOGY.trueStereo }
  });
  assert.equal(trueStereo.analysis.l1GainUpperBound, 2);
  assert.ok(Math.abs(trueStereo.analysis.l1GainUpperBoundDb - 6.020599913279624) < 1e-12);

  const matrix = emitPreparedIr({
    channels: [1, 2, 4].map(value => new Float32Array([value])),
    sampleRate: 48000,
    options: {
      topology: IR_ASSET_TOPOLOGY.matrix,
      paths: [
        { inputSlot: 0, outputSlot: 0, irChannel: 0 },
        { inputSlot: 1, outputSlot: 0, irChannel: 2 },
        { inputSlot: 0, outputSlot: 1, irChannel: 1 }
      ]
    }
  });
  assert.equal(matrix.analysis.l1GainUpperBound, 5);
});

test('matrix emission writes the exact diagonal route table before samples', () => {
  const channels = [0.5, 0.25, 0.125].map(value => new Float32Array([value, 0]));
  const paths = [
    { inputSlot: 0, outputSlot: 0, irChannel: 0 },
    { inputSlot: 1, outputSlot: 1, irChannel: 1 },
    { inputSlot: 2, outputSlot: 2, irChannel: 2 }
  ];
  const result = emitPreparedIr({
    channels,
    sampleRate: 48000,
    options: { topology: IR_ASSET_TOPOLOGY.matrix, paths }
  });
  const view = new DataView(result.payload);
  assert.equal(view.getUint32(20, true), 3);
  assert.equal(result.asset.pathCount, 3);
  assert.equal(result.asset.inputCount, 3);
  assert.deepEqual(
    Array.from({ length: 9 }, (_, index) => view.getUint32(32 + index * 4, true)),
    [0, 0, 0, 1, 1, 1, 2, 2, 2]
  );
});
