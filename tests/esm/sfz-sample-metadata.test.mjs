import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSfz } from '../../js/sfz/parser.js';
import { readSfzWaveLoop, prepareSfzLoopMetadata } from '../../js/sfz/sample-metadata.js';
import { prepareSfzSamples } from '../../js/sfz/service.js';
import { SFZ_REGION_FIELDS } from '../../js/sfz/asset.js';

function wave() {
  const bytes = new Uint8Array(128), view = new DataView(bytes.buffer);
  const id = (offset, name) => bytes.set(new TextEncoder().encode(name), offset);
  id(0, 'RIFF'); view.setUint32(4, 120, true); id(8, 'WAVE');
  id(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 48000, true); view.setUint32(28, 96000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  id(36, 'data'); view.setUint32(40, 16, true);
  id(60, 'smpl'); view.setUint32(64, 60, true); view.setUint32(96, 1, true);
  view.setUint32(112, 2, true); view.setUint32(116, 8, true);
  return bytes;
}
const reader = bytes => ({ size: bytes.length, readRange: async (offset, length) => bytes.slice(offset, offset + length) });
const parse = source => parseSfz({ selectedPath: 'instrument.sfz', readText: async () => source, hasSample: () => true, onDiagnostic: null });

test('WAVE first-loop metadata uses exact inclusive addresses and only reads descriptors', async () => {
  const bytes = wave(), reads = [];
  const metadata = await readSfzWaveLoop({ size: bytes.length, readRange: async (offset, length) => {
    reads.push([offset, length]); return bytes.slice(offset, offset + length);
  } }, 1024);
  assert.deepEqual(metadata, { start: 2, end: 8, type: 'forward', plays: 0 });
  assert.ok(reads.every(([offset]) => offset < 44 || offset >= 60), 'PCM data is skipped');
  assert.ok(reads.every(([, length]) => length <= 60));
});

test('control loop correction affects only metadata, with authored endpoints and modes overriding it', async () => {
  const parsed = await parse('<control> loop_end_offset=-1 <region> sample=tone.wav ' +
    '<region> sample=tone.wav loop_start=3 loop_end=6 loop_mode=loop_sustain ' +
    '<region> sample=tone.wav loop_mode=one_shot');
  const prepared = await prepareSfzLoopMetadata(parsed, async () => reader(wave()), 1024);
  assert.deepEqual(prepared.regions.map(region => [region.loop_start, region.loop_end, region.loop_mode]),
    [[1, 7, 2], [3, 6, 3], [1, 7, 1]]);
  assert.deepEqual(prepared.modulation.diagnostics, []);
  await assert.rejects(parse('<region> sample=tone.wav loop_end_offset=-1'), { code: 'prepare' });
});

test('resident asset receives corrected metadata loop geometry through the real preparation path', async () => {
  const parsed = await parse('<control> loop_end_offset=-1 <region> sample=tone.wav');
  const prepared = await prepareSfzSamples(parsed, async () => wave(), async () => ({ sampleRate: 48000,
    channels: [new Float32Array(8)] }), 1024 * 1024, null);
  const words = new Uint32Array(prepared.descriptor.payload, 32), values = new Float32Array(prepared.descriptor.payload, 32);
  assert.equal(words[12 + SFZ_REGION_FIELDS.indexOf('loop_start')], 1);
  assert.equal(words[12 + SFZ_REGION_FIELDS.indexOf('loop_end')], 7);
  assert.equal(values[12 + SFZ_REGION_FIELDS.indexOf('loop_mode')], 2);
});
