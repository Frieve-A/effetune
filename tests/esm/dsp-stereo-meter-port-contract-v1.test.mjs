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
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'analyzer', 'stereo_meter');
const schemaPath = path.join(pluginRoot, 'params.json');
const goldenDir = path.join(pluginRoot, 'golden');
const kernelPath = path.join(pluginRoot, 'kernel.cpp');
const rendererPath = path.join(repoRoot, 'plugins', 'analyzer', 'stereo_meter.js');
const jsEngineHash = '97a79673cad8706f90c9ed247f2b980798abd44ff953627a4bcd494b7eddc5ca';

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

function near(actual, expected, tolerance = 2e-5) {
  return Math.abs(actual - expected) <= tolerance;
}

test('Stereo Meter schema freezes legacy window key, bounds, default, and hash', async () => {
  const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const schema = validateParamSpec(raw, schemaPath);
  assert.equal(schema.type, 'StereoMeterPlugin');
  assert.equal(schema.hash, 0xb0de3212);
  assert.equal(schema.floatCount, 1);
  assert.deepEqual(
    raw.fields.map(({ name, key, kind, min, max, default: defaultValue }) => ({
      name, key, kind, min, max, default: defaultValue
    })),
    [
      { name: 'windowTime', key: 'wt', kind: 'float', min: 0.01, max: 1, default: 0.1 }
    ]
  );
});

test('Stereo Meter passthrough goldens are exact, current, and below 2 MiB', async () => {
  assert.ok(await directoryBytes(goldenDir) <= DEFAULT_GOLDEN_BUDGET_BYTES);
  const goldens = await readGoldenSet(goldenDir);
  assert.equal(goldens.length, 6);
  assert.ok(goldens.some(item => item.metadata.channels === 1));
  assert.ok(goldens.some(item => item.metadata.channels === 4));
  assert.ok(goldens.some(item => item.metadata.blockSize === 83));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 192000));
  assert.ok(goldens.some(item => item.metadata.params.wt === 1));
  assert.ok(goldens.some(item => item.metadata.events.length > 0));
  for (const golden of goldens) {
    assert.equal(golden.metadata.jsEngineHash, jsEngineHash);
    assert.deepEqual(golden.expected, inputFor(golden.metadata));
  }

  const result = await runParityCli([
    '--root', repoRoot,
    '--type', 'StereoMeterPlugin',
    '--self-check'
  ], { log() {} });
  assert.equal(result.results.length, 6);
  assert.equal(result.results.every(item => item.comparison.pass), true);
});

test('Stereo Meter legacy fallback freezes planar XY, angle, cadence, and decay', async () => {
  const session = await createReferenceSession('StereoMeterPlugin', { repoRoot });
  const plugin = session.plugin;
  plugin.setWindowTime(0);
  assert.equal(plugin.windowTime, 0.01);
  plugin.setWindowTime(2);
  assert.equal(plugin.windowTime, 1);
  plugin.setWindowTime(0.01);

  const state = {};
  const first = new Float32Array(20);
  first.fill(0.5);
  let output = plugin.executeProcessor(state, first, {
    ...plugin.getParameters(),
    channelCount: 2,
    blockSize: 10,
    sampleRate: 1000
  }, 1);
  assert.equal(output.measurements.currentPosition, 10);
  assert.equal(output.measurements.sampleRate, 1000);
  for (let index = 0; index < 10; index++) {
    assert.equal(output.measurements.xBuffer[index], 0);
    assert.equal(output.measurements.yBuffer[index], 1);
  }
  assert.ok(near(output.measurements.peakBuffer[270], 1));

  output = plugin.executeProcessor(state, new Float32Array(20), {
    ...plugin.getParameters(),
    channelCount: 2,
    blockSize: 10,
    sampleRate: 1000
  }, 1.1);
  assert.ok(near(output.measurements.peakBuffer[270], 0.7943282));
  assert.match(plugin.processorString, /measurementInterval = 1 \/ 60/);
});

test('Stereo Meter kernel and renderer freeze the bounded v2 sample-delta contract', async () => {
  const [kernel, renderer] = await Promise.all([
    fs.readFile(kernelPath, 'utf8'),
    fs.readFile(rendererPath, 'utf8')
  ]);
  assert.match(kernel, /kTelemetryVersion = 2u/);
  assert.match(kernel, /kPayloadHeaderBytes = 8u/);
  assert.match(kernel, /kMaxDeltaSamples = 8000u/);
  assert.match(kernel, /kMaxPayloadBytes == 65464u/);
  assert.match(kernel, /coordinateToFloat\(right - left\)/);
  assert.doesNotMatch(kernel, /telemetry_write_phase_/);
  assert.doesNotMatch(kernel, /std::(?:fabs|max|min)\s*\(/);

  const processBody = /void process\([\s\S]*?\n  }\n\n  void writeTelemetry/.exec(kernel)?.[0];
  assert.ok(processBody);
  assert.doesNotMatch(processBody, /(?:resize|reserve|\bnew\b)/);
  const payloadBody = /void buildPayload\([\s\S]*?\n  }\n\n  std::vector/.exec(kernel)?.[0];
  assert.ok(payloadBody);
  assert.doesNotMatch(payloadBody, /(?:resize|reserve|\bnew\b)/);

  assert.match(renderer, /STEREO_FIELD_TELEMETRY_VERSION = 2/);
  assert.match(renderer, /STEREO_FIELD_MAX_DELTA_SAMPLES = 8000/);
  const sampleHandlerStart = renderer.indexOf('\n  handleDspStereoFieldTelemetry(frame) {');
  const sampleHandlerEnd = renderer.indexOf('\n  onMessage(message) {', sampleHandlerStart);
  const sampleHandlerBody = renderer.slice(sampleHandlerStart, sampleHandlerEnd);
  assert.ok(sampleHandlerStart >= 0 && sampleHandlerEnd > sampleHandlerStart);
  assert.match(sampleHandlerBody, /sequence !== expectedSequence/);
  assert.match(sampleHandlerBody, /resetDspSampleBuffers/);
  assert.match(sampleHandlerBody, /xBuffer: this\.dspXBuffer/);
  assert.match(sampleHandlerBody, /yBuffer: this\.dspYBuffer/);
  assert.match(renderer, /const weight = Math\.exp/);
  assert.match(renderer, /Draw every sample in the selected window with the original age grading/);

  const coordinateBytesPerSecond = 96000 * 8;
  const fixedFrameBytes = (16 + 1464 + 3) & ~3;
  assert.equal(coordinateBytesPerSecond, 768000);
  assert.equal(fixedFrameBytes, 1480);
  assert.ok(coordinateBytesPerSecond + fixedFrameBytes * 60 < 900000);
});
