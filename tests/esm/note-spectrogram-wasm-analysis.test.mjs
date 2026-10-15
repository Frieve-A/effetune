import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';
import { parseTelemetryPacket } from '../../js/audio/telemetry-hub.js';

const fixtureRoot = new URL('../../dsp/plugins/analyzer/note_spectrogram/fixtures/', import.meta.url);
const metadata = JSON.parse(fs.readFileSync(new URL('analysis-telemetry.json', fixtureRoot), 'utf8'));
const inputBytes = fs.readFileSync(new URL('analysis-telemetry-input.f32', fixtureRoot));
const nativeBytes = fs.readFileSync(new URL('analysis-telemetry-native.bin', fixtureRoot));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const input = new Float32Array(inputBytes.buffer.slice(
  inputBytes.byteOffset, inputBytes.byteOffset + inputBytes.byteLength));
const reference = [];
assert.equal(sha256(inputBytes), metadata.inputSha256);
assert.equal(sha256(nativeBytes), metadata.nativeTelemetrySha256);
assert.equal(input.length, metadata.samples);
assert.equal(parseTelemetryPacket(nativeBytes, nativeBytes.byteLength,
  frame => reference.push(frame)).ok, true);

const pitchRecords = reference.filter(frame => frame.frameType === 24);
const noteRecords = reference.filter(frame => frame.frameType === 31);
const referenceByType = new Map([[24, pitchRecords], [31, noteRecords]]);
assert.ok(pitchRecords.length > 50, 'Native reference must contain sustained pitch analysis');
for (const event of [1, 2, 3]) {
  assert.ok(noteRecords.some(frame => frame.payload.getUint32(28, true) === event),
    `Native reference must contain timbre event ${event}`);
}
assert.ok(pitchRecords.some(frame => {
  for (let offset = 32; offset < 1792; offset += 4) {
    if (frame.payload.getFloat32(offset, true) > .5) return true;
  }
  return false;
}), 'Native reference must contain a detected pitch');

function compareRecord(actual, expected) {
  for (const key of ['frameType', 'formatVersion', 'tapId', 'flags', 'payloadBytes']) {
    assert.equal(actual[key], expected[key], `Telemetry ${key}`);
  }
  const pitch = actual.frameType === 24;
  assert.ok(pitch || actual.frameType === 31);
  const integers = pitch ? [8, 16, 20, 24, 28, 5312, 7076] : [12, 16, 20, 24, 28, 32, 36, 76];
  for (let offset = 0; offset < actual.payloadBytes; offset += 4) {
    if (integers.includes(offset)) {
      assert.equal(actual.payload.getUint32(offset, true), expected.payload.getUint32(offset, true),
        `Type ${actual.frameType} sequence ${actual.sequence} integer at ${offset}`);
      continue;
    }
    const probability = pitch
      ? (offset >= 32 && offset < 1792) || (offset >= 3552 && offset < 5312) ||
        (offset >= 5316 && offset < 7076) || (offset >= 7080 && offset < 8840)
      : offset >= 40 && offset < 76;
    const value = actual.payload.getFloat32(offset, true);
    const target = expected.payload.getFloat32(offset, true);
    assert.ok(Number.isFinite(value), `Type ${actual.frameType} finite float at ${offset}`);
    if (offset < 16 || probability) {
      const tolerance = offset < 16 ? 1e-6 : metadata.probabilityTolerance;
      assert.ok(Math.abs(value - target) <= tolerance,
        `Type ${actual.frameType} sequence ${actual.sequence} float at ${offset}: ${value} vs ${target}`);
    }
  }
}

for (const variant of ['baseline', 'simd']) {
  test(`Note Spectrogram ${variant} te-on pitch and timbre telemetry match native analysis`, async () => {
    const filename = variant === 'simd' ? 'effetune-dsp.simd.wasm' : 'effetune-dsp.wasm';
    const override = process.env[variant === 'simd' ? 'EFFETUNE_NS_SIMD_WASM' : 'EFFETUNE_NS_BASELINE_WASM'];
    const wasm = fs.readFileSync(override || new URL(`../../plugins/dsp/${filename}`, import.meta.url));
    const binding = await instantiateDspBinding(wasm);
    binding.createEngine();
    assert.equal(binding.prepare(metadata.sampleRate, metadata.channels, metadata.blockSize, 262144), 0);
    try {
      const id = binding.createInstance('NoteSpectrogramPlugin');
      assert.ok(id);
      assert.equal(binding.instanceSetTap(id, metadata.tapId), 0);
      assert.equal(binding.setTelemetryRate(metadata.telemetryRate), 0);
      const packer = DSP_PARAM_PACKERS.get('NoteSpectrogramPlugin');
      assert.equal(binding.instanceSetParams(id, packer.pack(metadata.params), packer.hash), 0);
      const packet = new Uint8Array(262144);
      const recordCounts = new Map([[24, 0], [31, 0]]);
      for (let offset = 0; offset < input.length; offset += metadata.blockSize) {
        const { combined, offsets } = binding.getArenaViews();
        const block = input.subarray(offset, offset + metadata.blockSize);
        combined.set(block);
        assert.equal(binding.instanceProcess(id, offsets.combined, metadata.channels,
          metadata.blockSize, offset / metadata.sampleRate), 0);
        const bytes = binding.telemetryRead(packet);
        assert.equal(binding.lastTelemetryDroppedFrames, 0);
        assert.equal(parseTelemetryPacket(packet, bytes, frame => {
          // Consumers dispatch each type separately; flushes may interleave the streams differently.
          // The writer's shared sequence counts both types, so it does not identify a stream record.
          const records = referenceByType.get(frame.frameType);
          const index = recordCounts.get(frame.frameType);
          assert.ok(records && index < records.length, 'WASM emitted an unexpected analysis record');
          compareRecord(frame, records[index]);
          recordCounts.set(frame.frameType, index + 1);
        }).ok, true);
      }
      for (const [type, records] of referenceByType) {
        assert.equal(recordCounts.get(type), records.length,
          `Every native type ${type} analysis record must be emitted in stream order`);
      }
    } finally {
      binding.destroyEngine();
    }
  });
}
