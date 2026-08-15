import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadParamSpecs } from '../../scripts/gen-dsp-params.mjs';
import { runWasmPipelineCase } from './runners.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('./automation-mixed.fixture.json', import.meta.url),
  'utf8'
));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function expandPattern(pattern, frames) {
  const splits = [];
  let total = 0;
  let index = 0;
  while (total < frames) {
    const next = Math.min(pattern[index % pattern.length], frames - total);
    splits.push(next);
    total += next;
    index++;
  }
  return splits;
}

function createInput(channels, frames) {
  const input = new Float32Array(channels * frames);
  for (let channel = 0; channel < channels; channel++) {
    for (let frame = 0; frame < frames; frame++) {
      const impulse = frame % 97 === channel * 11 ? 0.35 : 0;
      input[channel * frames + frame] =
        0.18 * Math.sin((frame + 1) * (channel + 1) * 0.071) + impulse;
    }
  }
  return input;
}

function maximumDifference(left, right) {
  assert.equal(left.length, right.length);
  let maximum = 0;
  for (let index = 0; index < left.length; index++) {
    maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  }
  return maximum;
}

test('mixed automation pipeline preserves output and parameter state across host partitions', async () => {
  assert.deepEqual(fixture.pipeline.slice(0, 2).map(plugin => plugin.type), [
    'FDNReverbPlugin', 'FiveBandDynamicEQ'
  ]);
  assert.equal(fixture.pipeline.some(plugin => plugin.residentClass === 'C'), true);
  assert.equal(fixture.pipeline.some(plugin => plugin.residentClass === 'D'), true);

  const schemas = new Map(loadParamSpecs().map(schema => [schema.type, schema]));
  const pipeline = fixture.pipeline.map(plugin => ({
    definition: { type: plugin.type },
    enabled: plugin.enabled,
    inputBus: 0,
    outputBus: 0,
    channel: null,
    params: structuredClone(plugin.parameters)
  }));
  const input = createInput(fixture.channels, fixture.frames);
  const results = [];

  for (const partition of fixture.partitions) {
    const blockSplits = expandPattern(partition.pattern, fixture.frames);
    results.push({ name: partition.name, result: await runWasmPipelineCase({
      pipeline,
      schemas,
      testCase: {
        sampleRate: fixture.sampleRate,
        channels: fixture.channels,
        frames: fixture.frames,
        blockSize: Math.max(...blockSplits),
        blockSplits,
        seed: BigInt(fixture.seed),
        events: fixture.events.map(event => ({
          frame: event.frame,
          plugin: event.plugin,
          params: structuredClone(event.parameters)
        })),
        captureFinalState: true
      },
      input,
      repoRoot
    }) });
  }

  const reference = results[0].result;
  for (const candidate of results.slice(1)) {
    const difference = maximumDifference(reference.output, candidate.result.output);
    assert.ok(difference <= fixture.tolerance,
      `${candidate.name} maximum difference ${difference} exceeds ${fixture.tolerance}`);
    assert.deepEqual(candidate.result.state, reference.state);
  }
});
