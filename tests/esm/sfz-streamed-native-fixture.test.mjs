import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseSfz } from '../../js/sfz/parser.js';
import { packStreamedSfzAsset } from '../../js/sfz/asset.js';
import { openSf2Source } from '../../js/sf2/source.js';
import { sf2SamplerRegions } from '../../js/sf2/asset.js';
import { createSf2Fixture } from '../helpers/sf2-fixture.mjs';

const runner = process.env.SFZ_STREAM_BANK_TEST_RUNNER;
test('native bank consumes compiler-produced streamed metadata and rejects unimplemented modulation routes', { skip: !runner }, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'effetune-stream-bank-')));
  try {
    for (const routes of [false, true]) {
      const parsed = await parseSfz({ selectedPath: 'a.sfz', hasSample: () => true, onDiagnostic: null,
        readText: async () => `<region> sample=a.wav key=60 offset=4090 ${routes ? 'volume_oncc1=3' : ''}
          <region> sample=a.wav key=61 direction=reverse end=15000
          <region> sample=b.wav key=62 offset=16777217 end=16777219` });
      const samples = new Map([['a.wav', { frames: 16384, channels: 1, sampleRate: 48000, revision: 'a'.repeat(64) }],
        ['b.wav', { frames: 16777223, channels: 1, sampleRate: 44100, revision: 'f'.repeat(64) }]]);
      const descriptor = packStreamedSfzAsset(parsed.regions, samples, { cacheSlots: 8, modulation: parsed.modulation });
      const bytes = Buffer.alloc(4 + descriptor.payload.byteLength);
      bytes.writeUInt32LE(descriptor.footprintBytes); Buffer.from(descriptor.payload).copy(bytes, 4);
      const file = path.join(root, 'bank.bin'); await writeFile(file, bytes);
      const result = spawnSync(runner, routes ? [file, 'reject'] : [file], { encoding: 'utf8', timeout: 10000, windowsHide: true });
      assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    }
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
});

test('native SF2 bank consumes the actual parser/compiler collection wire with a rendering capability gate', { skip: !runner }, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'effetune-sf2-bank-')));
  try {
    const fixture = createSf2Fixture();
    const source = await openSf2Source({ size: fixture.length, revision: 'fixture',
      readRange: async (offset, length) => new Uint8Array(fixture.subarray(offset, offset + length)) });
    const presets = [{ bank: 65535, program: 65535, firstRegion: 0, regionCount: 0 }, ...source.compiled.presets];
    const samples = new Map(source.samples.map(sample => [sample.path, {
      frames: sample.frames, channels: 1, sampleRate: sample.sampleRate, revision: '0'.repeat(64)
    }]));
    const descriptor = packStreamedSfzAsset(sf2SamplerRegions(source), samples, { cacheSlots: 8,
      sourceProfile: source.compiled.sourceProfile, presets, modulation: source.compiled });
    const bytes = Buffer.alloc(4 + descriptor.payload.byteLength);
    bytes.writeUInt32LE(descriptor.footprintBytes); Buffer.from(descriptor.payload).copy(bytes, 4);
    const file = path.join(root, 'bank.bin'); await writeFile(file, bytes);
    const result = spawnSync(runner, [file, 'sf2'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
});
