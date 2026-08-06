import test from 'node:test';
import assert from 'node:assert/strict';

import { executeReferenceCase } from '../../tools/dsp-parity/node-host.mjs';
import { XorShift64 } from '../../tools/dsp-parity/stimuli.mjs';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;

function dcInput(channels, frames) {
  const input = new Float32Array(channels * frames);
  for (let ch = 0; ch < channels; ch++) {
    input.fill((ch + 1) / 8, ch * frames, (ch + 1) * frames);
  }
  return input;
}

function noiseInput(channels, frames, seed = 0x5eedn) {
  const rng = new XorShift64(seed);
  const input = new Float32Array(channels * frames);
  for (let index = 0; index < input.length; index++) {
    input[index] = rng.nextFloat() * 2 - 1;
  }
  return input;
}

async function process(type, params, input, { channels, frames, blockSize = BLOCK_SIZE }) {
  const { output } = await executeReferenceCase(
    type,
    { params, channels, frames, sampleRate: SAMPLE_RATE, blockSize },
    input
  );
  return output;
}

function extractPair(input, channels, frames, pair) {
  const slice = new Float32Array(2 * frames);
  slice.set(input.subarray((2 * pair) * frames, (2 * pair + 1) * frames), 0);
  slice.set(input.subarray((2 * pair + 1) * frames, (2 * pair + 2) * frames), frames);
  return slice;
}

test('StereoBalance applies the pair gain law on multichannel buses', async () => {
  const frames = 512;
  for (const channels of [2, 4, 6, 8]) {
    for (const bl of [-1, -0.5, 0.25, 1]) {
      const leftGain = bl <= 0 ? 1 : 1 - bl;
      const rightGain = bl >= 0 ? 1 : 1 + bl;
      const input = dcInput(channels, frames);
      const output = await process('StereoBalancePlugin', { bl }, input, { channels, frames });
      for (let ch = 0; ch < channels; ch++) {
        const gain = (ch & 1) === 0 ? leftGain : rightGain;
        const expected = Math.fround(((ch + 1) / 8) * gain);
        for (let i = 0; i < frames; i++) {
          assert.equal(output[ch * frames + i], expected, `channels=${channels} bl=${bl} ch=${ch}`);
        }
      }
    }
  }
});

test('StereoBalance on all channels matches per-pair application', async () => {
  const frames = 1024;
  for (const channels of [4, 6, 8]) {
    for (const bl of [-0.7, 0.3]) {
      const input = noiseInput(channels, frames);
      const full = await process('StereoBalancePlugin', { bl }, input, { channels, frames });
      for (let pair = 0; pair < channels / 2; pair++) {
        const pairInput = extractPair(input, channels, frames, pair);
        const pairOutput = await process('StereoBalancePlugin', { bl }, pairInput, {
          channels: 2,
          frames
        });
        assert.ok(pairOutput.some(value => value !== 0));
        assert.deepEqual(
          full.subarray((2 * pair) * frames, (2 * pair + 2) * frames),
          pairOutput,
          `channels=${channels} bl=${bl} pair=${pair}`
        );
      }
    }
  }
});

test('MultibandBalance routes band gains by pair, not channel 0 vs the rest', async () => {
  const channels = 4;
  const frames = 4096;
  const params = { bands: [
    { balance: -100 }, { balance: -100 }, { balance: -100 }, { balance: -100 }, { balance: -100 }
  ] };
  const input = dcInput(channels, frames);
  const output = await process('MultibandBalancePlugin', params, input, { channels, frames });
  // Hard-left doubles the left of every pair and silences the right of every pair.
  for (let ch = 0; ch < channels; ch++) {
    const expected = (ch & 1) === 0 ? 2 * ((ch + 1) / 8) : 0;
    for (let i = frames - BLOCK_SIZE; i < frames; i++) {
      const value = output[ch * frames + i];
      assert.ok(Math.abs(value - expected) < 1e-4, `ch=${ch} value=${value} expected=${expected}`);
    }
  }
  assert.ok(output.some(value => value > 0.4));
});

test('MultibandBalance on all channels matches per-pair application', async () => {
  const frames = 2048;
  const params = { bands: [
    { balance: 80 }, { balance: -60 }, { balance: 40 }, { balance: -20 }, { balance: 100 }
  ] };
  for (const channels of [4, 6]) {
    const input = noiseInput(channels, frames);
    const full = await process('MultibandBalancePlugin', params, input, { channels, frames });
    for (let pair = 0; pair < channels / 2; pair++) {
      const pairInput = extractPair(input, channels, frames, pair);
      const pairOutput = await process('MultibandBalancePlugin', params, pairInput, {
        channels: 2,
        frames
      });
      assert.ok(pairOutput.some(value => value !== 0));
      assert.deepEqual(
        full.subarray((2 * pair) * frames, (2 * pair + 2) * frames),
        pairOutput,
        `channels=${channels} pair=${pair}`
      );
    }
  }
});
