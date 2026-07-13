import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { createReferenceSession } from '../../tools/dsp-parity/node-host.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginDirectory = path.join(
  repoRoot, 'dsp', 'plugins', 'modulation', 'pitch_shifter'
);

function testSignal(frames, channels, phase) {
  const signal = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; ++channel) {
    const offset = channel * frames;
    for (let frame = 0; frame < frames; ++frame) {
      signal[offset + frame] = Math.fround(
        0.57 * Math.sin((frame + phase + channel * 7) * 0.173) +
        0.21 * Math.cos((frame + phase * 3 + channel) * 0.071)
      );
    }
  }
  return signal;
}

async function directoryBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

test('Pitch Shifter schema and host packer freeze integer controls', async () => {
  const schemaPath = path.join(pluginDirectory, 'params.json');
  const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const schema = validateParamSpec(raw, schemaPath);
  assert.equal(schema.type, 'PitchShifterPlugin');
  assert.equal(schema.hash, 0x7719fdb6);
  assert.equal(schema.floatCount, 4);
  assert.deepEqual(
    raw.fields.map(({ name, key, kind }) => [name, key, kind]),
    [
      ['pitchShift', 'ps', 'int'],
      ['fineTune', 'ft', 'int'],
      ['windowSize', 'ws', 'int'],
      ['crossfadeTime', 'xf', 'float']
    ]
  );

  const descriptor = DSP_PARAM_PACKERS.get('PitchShifterPlugin');
  assert.ok(descriptor);
  assert.equal(descriptor.hash, schema.hash);
  assert.equal(descriptor.floatCount, 4);
  assert.deepEqual([...descriptor.pack({})], [0, 0, 150, 35]);
  assert.deepEqual(
    [...descriptor.pack({ ps: -6, ft: 50, ws: 500, xf: 20.1 })],
    [-6, 50, 500, Math.fround(20.1)]
  );
});

test('Pitch Shifter goldens preserve buffered state and shape resets within budget', async () => {
  const goldenDirectory = path.join(pluginDirectory, 'golden');
  assert.ok(await directoryBytes(goldenDirectory) <= DEFAULT_GOLDEN_BUDGET_BYTES);
  const goldens = await readGoldenSet(goldenDirectory);
  assert.equal(goldens.length, 10);
  assert.deepEqual(
    new Set(goldens.map(item => item.metadata.id)),
    new Set([
      'upward-default-window',
      'downward-maximum-window-mono',
      'fine-tune-only',
      'pitch-factor-bypass-freezes-state',
      'pitch-state-preserving-events',
      'window-shape-resets',
      'crossfade-shape-resets',
      'one-frame-blocks-44k1',
      'all4-96k-flat-window',
      'maximum-capacity-192k-all4'
    ])
  );
  for (const golden of goldens) {
    assert.equal(golden.metadata.type, 'PitchShifterPlugin');
    assert.equal(
      golden.metadata.jsEngineHash,
      '24b5f11f1abf2a32d77a8a7b98f9b4a0111739381e676775d657211b98472805'
    );
    assert.ok(golden.expected.every(Number.isFinite));
  }
  assert.deepEqual(
    new Set(goldens.map(item => item.metadata.sampleRate)),
    new Set([44100, 48000, 96000, 192000])
  );
  assert.ok(goldens.some(item => item.metadata.channels === 1));
  assert.ok(goldens.some(item => item.metadata.channels === 4));
  assert.ok(goldens.some(item => item.metadata.blockSize === 1));
  assert.ok(goldens.some(item => item.metadata.events.length > 0));
  const active = goldens.find(
    item => item.metadata.id === 'downward-maximum-window-mono'
  );
  assert.ok(active.expected.some(sample => sample !== 0));
});

test('Pitch Shifter reference freezes unity/disabled state and resets on shape', async () => {
  const active = { ps: -4, ft: 0, ws: 80, xf: 20 };
  const paused = await createReferenceSession('PitchShifterPlugin', {
    repoRoot,
    params: active
  });
  const uninterrupted = await createReferenceSession('PitchShifterPlugin', {
    repoRoot,
    params: active
  });
  const prefix = testSignal(7001, 2, 3);
  await paused.process(prefix, {
    sampleRate: 48000, frames: 7001, channels: 2, blockSize: 127
  });
  await uninterrupted.process(prefix, {
    sampleRate: 48000, frames: 7001, channels: 2, blockSize: 127
  });

  paused.plugin.ps = 0;
  paused.plugin.ws = 500;
  paused.plugin.xf = 40;
  const unityBypass = testSignal(257, 4, 7103);
  assert.deepEqual(
    await paused.process(unityBypass, {
      sampleRate: 48000, frames: 257, channels: 4, blockSize: 61
    }),
    unityBypass
  );

  paused.plugin.ps = active.ps;
  paused.plugin.ws = active.ws;
  paused.plugin.xf = active.xf;
  paused.plugin.enabled = false;
  const disabledBypass = testSignal(193, 2, 7411);
  assert.deepEqual(
    await paused.process(disabledBypass, {
      sampleRate: 48000, frames: 193, channels: 2, blockSize: 47
    }),
    disabledBypass
  );
  paused.plugin.enabled = true;

  const suffix = testSignal(2049, 2, 7801);
  assert.deepEqual(
    await paused.process(suffix, {
      sampleRate: 48000, frames: 2049, channels: 2, blockSize: 113
    }),
    await uninterrupted.process(suffix, {
      sampleRate: 48000, frames: 2049, channels: 2, blockSize: 113
    })
  );

  const underrun = await createReferenceSession('PitchShifterPlugin', {
    repoRoot,
    params: active
  });
  const initial = await underrun.process(testSignal(61, 2, 11), {
    sampleRate: 48000, frames: 61, channels: 2, blockSize: 61
  });
  assert.equal(initial.every(sample => sample === 0), true);

  const evolved = await createReferenceSession('PitchShifterPlugin', {
    repoRoot,
    params: active
  });
  await evolved.process(prefix, {
    sampleRate: 48000, frames: 7001, channels: 2, blockSize: 127
  });
  evolved.plugin.ws = 100;
  evolved.plugin.xf = 25;
  const fresh = await createReferenceSession('PitchShifterPlugin', {
    repoRoot,
    params: { ps: -4, ft: 0, ws: 100, xf: 25 }
  });
  const changedInput = testSignal(5001, 4, 9001);
  assert.deepEqual(
    await evolved.process(changedInput, {
      sampleRate: 48000, frames: 5001, channels: 4, blockSize: 97
    }),
    await fresh.process(changedInput, {
      sampleRate: 48000, frames: 5001, channels: 4, blockSize: 97
    })
  );
});

test('Pitch Shifter kernel preallocates the full documented capacity', async () => {
  const source = await fs.readFile(path.join(pluginDirectory, 'kernel.cpp'), 'utf8');
  const processStart = source.indexOf('  void process(');
  const processEnd = source.indexOf('\nprivate:', processStart);
  assert.ok(processStart >= 0 && processEnd > processStart);
  const processBody = source.slice(processStart, processEnd);
  assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
  assert.doesNotMatch(processBody, /std::(?:fabs|abs|max|min)\s*\(/);
  assert.match(source, /kMaximumWindowMilliseconds = 500\.0/);
  assert.match(source, /max_buffer_size_ = max_window_size_ \* 3u/);
  assert.match(source, /output_buffers_\.resize\(channels \* max_buffer_size_\)/);
  assert.match(source, /final_output_\.resize\(channels \* max_frames_\)/);
  assert.match(source, /std::vector<float> input_buffers_/);
  assert.match(source, /std::vector<float> output_buffers_/);
  assert.match(source, /std::vector<float> windowed_frames_/);
  assert.match(source, /std::vector<double> output_read_positions_/);
  assert.match(source, /including old data/);
  assert.ok(
    processBody.indexOf('if (pitch_factor == 1.0)') <
      processBody.indexOf('resetForShape(')
  );

  const registry = await fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8');
  assert.match(registry, /EFFETUNE_PLUGIN\(PitchShifterPlugin, modulation\/pitch_shifter\)/);

  const decision = await fs.readFile(path.join(repoRoot, 'dsp', 'README.md'), 'utf8');
  assert.match(decision, /Pitch Shifter Capacity Decision/);
  assert.match(decision, /15,360,000 bytes/);
  assert.match(decision, /64 MiB maximum memory/);
  assert.match(decision, /capacity is intentionally not reduced/);
});
