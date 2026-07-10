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
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'analyzer', 'spectrum_analyzer');
const schemaPath = path.join(pluginRoot, 'params.json');
const goldenDir = path.join(pluginRoot, 'golden');
const kernelPath = path.join(pluginRoot, 'kernel.cpp');
const jsEngineHash = '20b7e59ee92de56571f250ca850d2bc5dfc3442485a805765e1393af6e652512';

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

test('Spectrum Analyzer schema freezes legacy keys, bounds, defaults, and hash', async () => {
  const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const schema = validateParamSpec(raw, schemaPath);
  assert.equal(schema.type, 'SpectrumAnalyzerPlugin');
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

test('Spectrum Analyzer passthrough goldens are exact, current, and below 2 MiB', async () => {
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
    '--type', 'SpectrumAnalyzerPlugin',
    '--self-check'
  ], { log() {} });
  assert.equal(result.results.length, 6);
  assert.equal(result.results.every(item => item.comparison.pass), true);
});

test('Spectrum Analyzer legacy fallback freezes Hann DC/AC correction and peak decay', async () => {
  const session = await createReferenceSession('SpectrumAnalyzerPlugin', { repoRoot });
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
  assert.ok(near(plugin.peaks[8], 0));

  plugin.process({
    measurements: { buffer: [new Float32Array(size)], bufferPosition: 0, time: 1.1, sampleRate }
  });
  assert.ok(near(plugin.peaks[8], -2));

  plugin.process({
    measurements: {
      buffer: [new Float32Array(size).fill(1)],
      bufferPosition: 0,
      time: 1.2,
      sampleRate
    }
  });
  assert.ok(near(plugin.spectrum[0], 0));

  const state = {};
  const data = new Float32Array(size);
  data.fill(1, 0, size / 2);
  data.fill(-1, size / 2);
  const output = plugin.executeProcessor(state, data, {
    ...plugin.getParameters(),
    channelCount: 2,
    blockSize: size / 2,
    sampleRate
  }, 2);
  assert.equal(output.measurements.bufferPosition, size / 2);
  assert.deepEqual(Array.from(output.measurements.buffer[0]), new Array(size).fill(0));
});

test('Spectrum Analyzer kernel keeps FFT resources bounded to prepare and freezes v1 payload rules', async () => {
  const source = await fs.readFile(kernelPath, 'utf8');
  assert.match(source, /pffft_new_setup/);
  assert.match(source, /pffft_transform_ordered/);
  assert.match(source, /kMaximumPayloadBinCount = 8190u/);
  assert.match(source, /kFlagBinsTruncated/);
  assert.match(source, /kMaximumPayloadBytes =\s*\n?\s*kPayloadHeaderBytes \+ kMaximumPayloadBinCount \* 8u/);
  assert.doesNotMatch(source, /std::(?:fabs|max|min)\s*\(/);

  const processBody = /void process\([\s\S]*?\n  }\n\n  void writeTelemetry/.exec(source)?.[0];
  assert.ok(processBody);
  assert.doesNotMatch(processBody, /(?:resize|new_setup|aligned_malloc|\bnew\b)/);
  const analyzeBody = /void analyze\([\s\S]*?\n  }\n\n  std::array/.exec(source)?.[0];
  assert.ok(analyzeBody);
  assert.doesNotMatch(analyzeBody, /(?:resize|new_setup|aligned_malloc|\bnew\b)/);
});
