'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LocalPlaybackIngress, readMidiWrdSidecar } = require('../../electron/local-playback-ingress.cjs');

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-wrd-')));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return root;
}

test('MIDI admission excludes lyrics companions and reads only the matching sibling, including uppercase names', async t => {
  const root = await fixture(t), midi = path.join(root, 'Song.mid'), wrd = path.join(root, 'SONG.WRD');
  await fs.writeFile(midi, 'MIDI');
  await fs.writeFile(wrd, '@START\nLyrics');
  await fs.writeFile(path.join(root, 'Other.wrd'), 'Unrelated');
  const selection = await new LocalPlaybackIngress().resolveSelection([midi, wrd]);
  assert.deepEqual(selection.descriptors.map(item => item.path), [midi]);
  assert.equal(new TextDecoder().decode(await readMidiWrdSidecar(midi)), '@START\nLyrics');
  assert.equal(await readMidiWrdSidecar(path.join(root, 'Other.mp3')), null);
  await fs.unlink(wrd);
  assert.equal(await readMidiWrdSidecar(midi), null);
});

test('KAR admission and matching WRD use the MIDI sibling boundary', async t => {
  const root = await fixture(t), kar = path.join(root, 'Song.KAR'), wrd = path.join(root, 'SONG.WRD');
  await fs.writeFile(kar, 'MIDI');
  await fs.writeFile(wrd, 'KAR sidecar;');
  const selection = await new LocalPlaybackIngress().resolveSelection([kar, wrd]);
  assert.deepEqual(selection.descriptors.map(item => item.path), [kar]);
  assert.equal(new TextDecoder().decode(await readMidiWrdSidecar(kar)), 'KAR sidecar;');
});

test('oversized lyrics and sidecars resolving outside the MIDI folder are ignored', async t => {
  const root = await fixture(t), folder = path.join(root, 'music');
  await fs.mkdir(folder);
  const midi = path.join(folder, 'Song.mid'), wrd = path.join(folder, 'Song.wrd');
  await fs.writeFile(midi, 'MIDI');
  const handle = await fs.open(wrd, 'w');
  await handle.truncate(1024 * 1024 + 1);
  await handle.close();
  assert.equal(await readMidiWrdSidecar(midi), null);
  await fs.unlink(wrd);
  const outside = path.join(root, 'Song.wrd');
  await fs.writeFile(outside, 'Private');
  const filesystem = Object.create(fs);
  filesystem.readdir = async () => ['Song.wrd'];
  filesystem.realpath = async value => value === wrd ? outside : fs.realpath(value);
  filesystem.open = async () => assert.fail('An escaped sidecar must never be opened');
  assert.equal(await readMidiWrdSidecar(midi, { filesystem }), null);
});
