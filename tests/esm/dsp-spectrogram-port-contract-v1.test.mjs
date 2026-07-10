import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { createReferenceSession } from '../../tools/dsp-parity/node-host.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';
import { generateStimulus } from '../../tools/dsp-parity/stimuli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'analyzer', 'spectrogram');
const schemaPath = path.join(pluginRoot, 'params.json');
const goldenDir = path.join(pluginRoot, 'golden');
const kernelPath = path.join(pluginRoot, 'kernel.cpp');
const rendererPath = path.join(repoRoot, 'plugins', 'analyzer', 'spectrogram.js');
const jsEngineHash = '52bc8f91f442a2af524a84ebe6be6ce80dfa90d2c90883afae6b0c63a28cfc26';

async function directoryBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

function inputFor(metadata) {
  return generateStimulus({
    id: metadata.stimulus,
    sampleRate: metadata.sampleRate,
    frames: metadata.frameCount,
    channels: metadata.channels,
    caseIndex: metadata.caseIndex,
    seed: BigInt(metadata.seed)
  });
}

function near(actual, expected, tolerance = 2e-3) {
  return Math.abs(actual - expected) <= tolerance;
}

test('Spectrogram schema freezes legacy keys, bounds, defaults, and hash', async () => {
  const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const schema = validateParamSpec(raw, schemaPath);
  assert.equal(schema.type, 'SpectrogramPlugin');
  assert.equal(schema.hash, 0xc99dcc20);
  assert.equal(schema.floatCount, 2);
  assert.deepEqual(
    raw.fields.map(({ name, key, kind, min, max, default: defaultValue }) => ({
      name, key, kind, min, max, default: defaultValue
    })),
    [
      { name: 'dBRange', key: 'dr', kind: 'float', min: -144, max: -48, default: -96 },
      { name: 'points', key: 'pt', kind: 'int', min: 8, max: 14, default: 12 }
    ]
  );
});

test('Spectrogram passthrough goldens are exact, current, and below 2 MiB', async () => {
  assert.ok(await directoryBytes(goldenDir) <= DEFAULT_GOLDEN_BUDGET_BYTES);
  const goldens = await readGoldenSet(goldenDir);
  assert.equal(goldens.length, 6);
  assert.ok(goldens.some(item => item.metadata.channels === 1));
  assert.ok(goldens.some(item => item.metadata.channels === 4));
  assert.ok(goldens.some(item => item.metadata.blockSize === 83));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 192000));
  assert.ok(goldens.some(item => item.metadata.params.pt === 14));
  assert.ok(goldens.some(item => item.metadata.events.length > 0));
  for (const golden of goldens) {
    assert.equal(golden.metadata.jsEngineHash, jsEngineHash);
    assert.deepEqual(golden.expected, inputFor(golden.metadata));
  }

  const result = await runParityCli([
    '--root', repoRoot,
    '--type', 'SpectrogramPlugin',
    '--self-check'
  ], { log() {} });
  assert.equal(result.results.length, 6);
  assert.equal(result.results.every(item => item.comparison.pass), true);
});

test('Spectrogram legacy fallback freezes Hann scaling and logarithmic row mapping', async () => {
  const session = await createReferenceSession('SpectrogramPlugin', { repoRoot });
  const plugin = session.plugin;
  plugin.setPoints(8);
  const size = 256;
  const sampleRate = 32000;
  const tone = new Float32Array(size);
  for (let index = 0; index < size; index++) {
    tone[index] = Math.sin(2 * Math.PI * 1000 * index / sampleRate);
  }

  plugin.process({
    measurements: { buffer: [tone], bufferPosition: 0, time: 1, sampleRate }
  });
  assert.ok(near(plugin.spectrum[8], 0));
  assert.ok(near(plugin.spectrum[7], -6.0206));
  assert.ok(near(plugin.spectrum[9], -6.0206));
  assert.equal(plugin.spectrogramBuffer[1023], -144);
  assert.ok(plugin.spectrogramBuffer[123 * 1024 + 1023] > -1.5);
  assert.ok(plugin.spectrogramBuffer[124 * 1024 + 1023] > -1.0);

  const state = {};
  const data = new Float32Array(size);
  const output = plugin.executeProcessor(state, data, {
    ...plugin.getParameters(),
    channelCount: 2,
    blockSize: size / 2,
    sampleRate
  }, 2);
  assert.equal(output.measurements.bufferPosition, size / 2);
  assert.equal(output.measurements.time, 2);
  assert.equal(output.measurements.sampleRate, sampleRate);
});

test('Spectrogram kernel and renderer freeze bounded v1 column behavior', async () => {
  const [kernel, renderer] = await Promise.all([
    fs.readFile(kernelPath, 'utf8'),
    fs.readFile(rendererPath, 'utf8')
  ]);
  assert.match(kernel, /pffft_new_setup/);
  assert.match(kernel, /pffft_transform_ordered/);
  assert.match(kernel, /kPayloadBytes = kPayloadHeaderBytes \+ kCellCount/);
  assert.match(kernel, /kPendingColumnCapacity = 128u/);
  assert.match(kernel, /static_cast<float>\(frame_time\)/);
  assert.match(kernel, /void prepareDisplayFrequencies\(\) noexcept/);
  assert.doesNotMatch(kernel, /std::(?:fabs|max|min)\s*\(/);

  const processBody = /void process\([\s\S]*?\n  }\n\n  void writeTelemetry/.exec(kernel)?.[0];
  assert.ok(processBody);
  assert.doesNotMatch(processBody, /(?:resize|new_setup|aligned_malloc|\bnew\b)/);
  const analysisBody = /void analyze\([\s\S]*?\n  }\n\n  void enqueueColumn/.exec(kernel)?.[0];
  assert.ok(analysisBody);
  assert.doesNotMatch(analysisBody, /(?:resize|new_setup|aligned_malloc|\bnew\b)/);
  const enqueueBody = /void enqueueColumn\([\s\S]*?\n  }\n\n  std::array/.exec(kernel)?.[0];
  assert.ok(enqueueBody);
  assert.doesNotMatch(enqueueBody, /(?:resize|new_setup|aligned_malloc|\bnew\b)/);
  assert.doesNotMatch(enqueueBody, /std::pow/);

  assert.match(renderer, /SPECTROGRAM_PAYLOAD_BYTES = 268/);
  assert.match(renderer, /new Uint8Array\(\s*SPECTROGRAM_CELL_COUNT \* SPECTROGRAM_HISTORY_WIDTH/);
  const handlerBody = /handleDspSpectrogramTelemetry\([\s\S]*?\n    }\n\n    updateSecondMarkers/.exec(renderer)?.[0];
  assert.ok(handlerBody);
  assert.doesNotMatch(handlerBody, /(?:\.fft\(|copyWithin)/);
  assert.match(renderer, /paintDspSpectrogramColumn/);
  assert.match(renderer, /const split = this\.spectrogramWriteColumn/);
});
