'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CUE_MAX_BYTES,
  LocalPlaybackIngress,
  admitLocalPlaybackPaths,
  resolveElectronCueSelection
} = require('../../electron/local-playback-ingress.cjs');

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-direct-cue-'));
}

function writeFixture(root, name, contents = '') {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function cueText(source = 'album.wav') {
  return [
    'PERFORMER "Album Artist"',
    'TITLE "Album Title"',
    `FILE "${source}" WAVE`,
    '  TRACK 01 AUDIO',
    '    TITLE "First"',
    '    INDEX 01 00:00:00',
    '  TRACK 02 AUDIO',
    '    TITLE "Second"',
    '    INDEX 01 00:10:00'
  ].join('\n');
}

function metadataFactory(calls, implementation = async () => ({
  durationSec: 20,
  sampleRate: 96000,
  channels: 2,
  codec: 'PCM'
})) {
  return () => ({
    async parse(request) {
      calls.push(request);
      return implementation(request);
    },
    async close() {}
  });
}

test('normal local playback admission returns canonical scalar descriptors without reading bytes', async t => {
  const root = createTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = writeFixture(root, 'first.wav', 'small');
  const second = writeFixture(root, 'second.flac', 'larger');

  const descriptors = await admitLocalPlaybackPaths([first, second]);

  assert.deepEqual(descriptors.map(item => ({
    path: item.path,
    byteLength: item.byteLength,
    name: item.name
  })), [
    { path: fs.realpathSync(first), byteLength: 5, name: 'first.wav' },
    { path: fs.realpathSync(second), byteLength: 6, name: 'second.flac' }
  ]);
});

test('Electron direct CUE resolves logical tracks atomically and parses each physical source once', async t => {
  const root = createTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cuePath = writeFixture(root, 'album.cue', cueText());
  const audioPath = writeFixture(root, 'album.wav', 'metadata-reader-fixture');
  const metadataCalls = [];

  const tracks = await resolveElectronCueSelection(cuePath, {
    metadataParserFactory: metadataFactory(metadataCalls)
  });

  assert.equal(metadataCalls.length, 1);
  assert.equal(metadataCalls[0].path, fs.realpathSync(audioPath));
  assert.deepEqual(tracks.map(track => ({
    path: track.path,
    byteLength: track.byteLength,
    title: track.meta.title,
    startFrame: track.startFrame,
    endFrame: track.endFrame,
    durationSec: track.durationSec,
    physicalSourceKey: track.physicalSourceKey
  })), [
    {
      path: fs.realpathSync(audioPath),
      byteLength: 23,
      title: 'First',
      startFrame: 0,
      endFrame: 750,
      durationSec: 10,
      physicalSourceKey: fs.realpathSync(audioPath)
    },
    {
      path: fs.realpathSync(audioPath),
      byteLength: 23,
      title: 'Second',
      startFrame: 750,
      endFrame: null,
      durationSec: 10,
      physicalSourceKey: fs.realpathSync(audioPath)
    }
  ]);
});

test('Electron direct CUE rejects mixed selections and files above the bounded CUE limit', async t => {
  const root = createTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cuePath = writeFixture(root, 'album.cue', cueText());
  const audioPath = writeFixture(root, 'album.wav', 'audio');
  const ingress = new LocalPlaybackIngress({ metadataParserFactory: metadataFactory([]) });

  await assert.rejects(
    ingress.resolveSelection([cuePath, audioPath]),
    error => error?.code === 'cue-selection-mixed'
  );

  fs.writeFileSync(cuePath, Buffer.alloc(CUE_MAX_BYTES + 1));
  await assert.rejects(
    resolveElectronCueSelection(cuePath, { metadataParserFactory: metadataFactory([]) }),
    error => error?.code === 'cue-too-large'
  );
});

test('Electron direct CUE rejects source replacement detected after metadata parsing', async t => {
  const root = createTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cuePath = writeFixture(root, 'album.cue', cueText());
  const audioPath = writeFixture(root, 'album.wav', 'before');

  await assert.rejects(resolveElectronCueSelection(cuePath, {
    metadataParserFactory: metadataFactory([], async () => {
      fs.appendFileSync(audioPath, '-changed');
      return { durationSec: 20 };
    })
  }), error => error?.code === 'cue-source-unavailable');
});

test('Electron direct CUE rejects rename-and-replace of the selected pathname during its read', async t => {
  const root = createTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cuePath = writeFixture(root, 'album.cue', cueText());
  const replacementPath = writeFixture(root, 'replacement.cue', cueText());
  writeFixture(root, 'album.wav', 'audio');
  let readCompleted = false;
  const filesystem = {
    ...fs.promises,
    async open(filePath, flags) {
      const handle = await fs.promises.open(filePath, flags);
      return {
        close: () => handle.close(),
        stat: () => handle.stat(),
        async read(...args) {
          const result = await handle.read(...args);
          readCompleted = true;
          return result;
        }
      };
    },
    async stat(filePath) {
      if (readCompleted && path.resolve(filePath) === path.resolve(cuePath)) {
        return fs.promises.stat(replacementPath);
      }
      return fs.promises.stat(filePath);
    }
  };

  await assert.rejects(resolveElectronCueSelection(cuePath, {
    filesystem,
    metadataParserFactory: metadataFactory([])
  }), error => error?.code === 'cue-file-changed');
});

test('LocalPlaybackIngress cancel and dispose abort active metadata and close the parser once', async t => {
  const root = createTempDirectory();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cuePath = writeFixture(root, 'album.cue', cueText());
  writeFixture(root, 'album.wav', 'audio');
  let notifyParseStarted;
  const parseStarted = new Promise(resolve => {
    notifyParseStarted = resolve;
  });
  let closeCount = 0;
  const ingress = new LocalPlaybackIngress({
    metadataParserFactory: () => ({
      parse({ signal }) {
        notifyParseStarted();
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      async close() {
        closeCount += 1;
      }
    })
  });

  const selection = ingress.resolveSelection([cuePath]);
  await parseStarted;
  ingress.cancel();
  ingress.cancel();
  await assert.rejects(selection, error => error?.code === 'selection-stale');
  assert.equal(closeCount, 1);

  ingress.dispose();
  ingress.dispose();
  assert.equal(ingress.isDisposed(), true);
  assert.throws(() => ingress.beginRequest(), error => error?.code === 'selection-stale');
});
