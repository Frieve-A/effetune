import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { packSfzAsset } from '../dist/internal/js/sfz/asset.js';
import { SoundFontBank, prepareSoundFont } from '../dist/soundfont.js';
import { createSf2Fixture } from '../../../../tests/helpers/sf2-fixture.mjs';

// Run with EFFETUNE_UPDATE_SOUNDFONT_FIXTURES=1 to regenerate the tracked fixtures.
const update = process.env.EFFETUNE_UPDATE_SOUNDFONT_FIXTURES === '1';
const common = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'common');
const tinySf2Path = path.join(common, 'soundfont-tiny.sf2');
const sineBankPath = path.join(common, 'soundfont-sine-v1.etsf');

function tinySf2() {
  const pcm16 = Array.from({ length: 64 }, (_, frame) => Math.round(Math.sin(2 * Math.PI * frame / 48) * 8192));
  return new Uint8Array(createSf2Fixture({ keyRange: [0, 127], pcm16 }));
}

// Must match syntheticSfzAsset for `sfz-sine-v1` in tools/dsp-parity/runners.mjs.
function sineBank() {
  const sampleRate = 48000, sampleFrames = 4096, samples = new Float32Array(sampleFrames);
  for (let frame = 0; frame < sampleFrames; frame++) {
    samples[frame] = Math.round(Math.sin(2 * Math.PI * 1000 * frame / sampleRate) * 0.2 * 32768) / 32768;
  }
  const region = {
    sample: 'synthetic-sine', seqGroup: 0, lokey: 0, hikey: 127, lovel: 1, hivel: 127,
    lorand: 0, hirand: 1, seq_length: 1, seq_position: 1,
    pitch_keycenter: 83, pitch_keytrack: 100, transpose: 0, tune: 0,
    volume: 0, pan: 0, amp_veltrack: 0, offset: 0, end: sampleFrames - 1,
    loop_mode: 2, loop_start: 0, loop_end: sampleFrames - 1,
    ampeg_attack: 0, ampeg_hold: 0, ampeg_decay: 0, ampeg_sustain: 100, ampeg_release: 0.001
  };
  const { payload } = packSfzAsset([region], new Map([['synthetic-sine', { sampleRate, channels: [samples] }]]));
  return new SoundFontBank(payload, []).toBytes();
}

async function matchFixture(file, bytes) {
  if (update) await writeFile(file, bytes);
  assert.deepEqual(new Uint8Array(await readFile(file)), bytes, `${path.basename(file)} is stale; regenerate the fixtures`);
}

function wav16(samples, sampleRate) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples.length * 2, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => bytes.writeInt16LE(value, 44 + index * 2));
  return bytes;
}

test('tiny SF2 prepares into a resident ETSF1 bank that round-trips', async () => {
  const sf2 = tinySf2();
  await matchFixture(tinySf2Path, sf2);
  const bank = await prepareSoundFont(sf2);
  assert.ok(bank.pages.length > 0);
  assert.equal(new Uint32Array(bank.payload, 32)[14], bank.pages.length + 2);
  const bytes = bank.toBytes();
  assert.deepEqual(SoundFontBank.fromBytes(bytes).toBytes(), bytes);
  assert.deepEqual((await prepareSoundFont(sf2)).toBytes(), bytes);
  assert.deepEqual((await prepareSoundFont(tinySf2Path)).toBytes(), bytes);
  assert.throws(() => SoundFontBank.fromBytes(bytes.subarray(0, bytes.length - 4)), /damaged/);
});

test('a payload shorter than the native control block is reported as damaged', () => {
  for (const payloadBytes of [32, 52]) {
    const bytes = new Uint8Array(16 + payloadBytes), view = new DataView(bytes.buffer);
    [0x46535445, 1, payloadBytes, 0, 0x31415445, 1, (payloadBytes - 32) / 4]
      .forEach((word, index) => view.setUint32(index * 4, word, true));
    assert.throws(() => SoundFontBank.fromBytes(bytes), /damaged/);
  }
});

test('sine fixture matches the current preparation result', async () => {
  await matchFixture(sineBankPath, sineBank());
  assert.equal(SoundFontBank.fromBytes(await readFile(sineBankPath)).pages.length, 0);
});

test('preparation reports a bank larger than maxBytes', async () => {
  await assert.rejects(prepareSoundFont(tinySf2(), { maxBytes: 1024 }), /maxBytes/);
});

test('SFZ paths resolve sample files relative to the SFZ folder', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-soundfont-')));
  try {
    const wav = wav16(Array.from({ length: 512 }, (_, frame) => Math.round(Math.sin(2 * Math.PI * frame / 64) * 8192)), 48000);
    const sfz = Buffer.from('<region> sample=samples/sine.wav\n');
    await mkdir(path.join(root, 'samples'));
    await writeFile(path.join(root, 'samples', 'sine.wav'), wav);
    await writeFile(path.join(root, 'instrument.sfz'), sfz);
    const fromPath = (await prepareSoundFont(path.join(root, 'instrument.sfz'))).toBytes();
    const fromFiles = await prepareSoundFont({ selectedPath: 'instrument.sfz',
      files: new Map([['instrument.sfz', new Uint8Array(sfz)], ['samples/sine.wav', new Uint8Array(wav)]]) });
    assert.deepEqual(fromPath, fromFiles.toBytes());
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('SFZ preparation fails when some sample files are missing', async () => {
  const wav = wav16(Array.from({ length: 512 }, (_, frame) => Math.round(Math.sin(2 * Math.PI * frame / 64) * 8192)), 48000);
  const sfz = Buffer.from('<region> sample=a.wav hikey=63\n<region> sample=missing.wav lokey=64\n');
  await assert.rejects(prepareSoundFont({ selectedPath: 'p.sfz',
    files: new Map([['p.sfz', new Uint8Array(sfz)], ['a.wav', new Uint8Array(wav)]]) }),
  { code: 'missing-samples', message: /1 SFZ sample file was not found: missing\.wav\. .*root/ });
});

test('SFZ paths with a root resolve samples in sibling folders', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-soundfont-')));
  try {
    const wav = wav16(Array.from({ length: 512 }, (_, frame) => Math.round(Math.sin(2 * Math.PI * frame / 64) * 8192)), 48000);
    const sfz = Buffer.from('<control> default_path=../Samples/\n<region> sample=s.wav\n');
    await mkdir(path.join(root, 'Programs'));
    await mkdir(path.join(root, 'Samples'));
    await writeFile(path.join(root, 'Samples', 's.wav'), wav);
    await writeFile(path.join(root, 'Programs', 'p.sfz'), sfz);
    const fromPath = (await prepareSoundFont(path.join(root, 'Programs', 'p.sfz'), { root })).toBytes();
    const fromFiles = await prepareSoundFont({ selectedPath: 'Programs/p.sfz',
      files: new Map([['Programs/p.sfz', new Uint8Array(sfz)], ['Samples/s.wav', new Uint8Array(wav)]]) });
    assert.deepEqual(fromPath, fromFiles.toBytes());
    await assert.rejects(prepareSoundFont(path.join(root, 'Programs', 'p.sfz'), { root: path.join(root, 'Samples') }),
      /not inside the root folder/);
    await assert.rejects(prepareSoundFont(path.join(root, 'Programs', 'p.sfz')),
      { code: 'missing-samples', message: /s\.wav \(outside the root folder\).*root/ });
    for (const missing of ['missing.sf2', 'missing.sfz']) {
      await assert.rejects(prepareSoundFont(path.join(root, missing)), /could not be opened/);
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('createChain names the effect and reference when the resolver returns an unprepared SoundFont', async () => {
  const { createChain } = await import('../dist/index.js');
  const spec = { version: 1, chain: [{ id: 'p', type: 'SoundFontPlayer', parameters: {}, assets: { soundFont: 'gm' } }] };
  await assert.rejects(
    createChain(spec, { assetResolver: () => tinySf2() }),
    (error) => /^p SoundFont gm is not a prepared SoundFont bank\. .*prepareSoundFont\(\)/.test(error.message) && error.cause instanceof Error
  );
});
