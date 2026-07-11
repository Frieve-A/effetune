const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const {
  createTempDir,
  loadFreshModule
} = require('../helpers/cjs-module-utils.cjs');

function writeFile(filePath, content = 'audio') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function arrayBufferBytes(arrayBuffer) {
  return Array.from(new Uint8Array(arrayBuffer));
}

function decodeWindows1252(bytes) {
  return new TextDecoder('windows-1252').decode(Uint8Array.from(bytes));
}

function decodeLatin1(bytes) {
  return String.fromCharCode(...bytes);
}

function decodeHighBitsCleared(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x00) end -= 1;
  return String.fromCharCode(...bytes.slice(0, end).map(byte => byte & 0x7f));
}

function decodeUtf8AsWindows1252(text) {
  return decodeWindows1252(new TextEncoder().encode(text));
}

function createChunk(id, data) {
  const payload = Buffer.from(data);
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return payload.length % 2
    ? Buffer.concat([header, payload, Buffer.from([0])])
    : Buffer.concat([header, payload]);
}

function createRiffInfoWave(tags) {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(44100, 4);
  fmt.writeUInt32LE(88200, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const infoPayload = Buffer.concat([
    Buffer.from('INFO', 'ascii'),
    ...tags.map(tag => createChunk(tag.id, tag.data))
  ]);
  const chunks = [
    createChunk('fmt ', fmt),
    createChunk('data', Buffer.alloc(0)),
    createChunk('LIST', infoPayload)
  ];
  const riffSize = 4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(riffSize, 4);
  header.write('WAVE', 8, 4, 'ascii');
  return Buffer.concat([header, ...chunks]);
}

function createDirectoryLink(targetPath, linkPath) {
  try {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch {
    return false;
  }
}

function removeDirectoryLink(linkPath) {
  try {
    fs.unlinkSync(linkPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    fs.rmdirSync(linkPath);
  }
}

async function waitForCondition(predicate, message) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true, message);
}

async function runWithScanner(metadataModule, callback) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'music-metadata') {
      return metadataModule;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const scanner = loadFreshModule('../../electron/library-scanner.js');
    return await callback(scanner);
  } finally {
    Module._load = originalLoad;
  }
}

test('scanLibrary skips unchanged files and builds fallback records for changed audio files', async () => {
  const root = createTempDir('effetune-library-scan');
  const knownPath = path.join(root, 'known.mp3');
  const newPath = path.join(root, 'Album', 'New.FLAC');
  writeFile(knownPath, 'known');
  writeFile(newPath, 'changed');
  writeFile(path.join(root, 'Album', 'cover.jpg'), Buffer.from([4, 5, 6]));
  writeFile(path.join(root, 'node_modules', 'ignored.mp3'), 'ignored');
  writeFile(path.join(root, '.hidden', 'ignored.flac'), 'ignored');
  writeFile(path.join(root, 'notes.txt'), 'ignored');
  const knownStat = fs.statSync(knownPath);
  const events = [];

  await runWithScanner({}, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }],
    knownFiles: [{
      folderId: 'f_music',
      relativePath: 'known.mp3',
      size: knownStat.size,
      mtimeMs: knownStat.mtimeMs
    }],
    batchIntervalMs: 1
  }, event => {
    events.push(event);
  }));

  const batchEvents = events.filter(event => event.type === 'batch');
  const tracks = batchEvents.flatMap(event => event.tracks);
  const artworks = batchEvents.flatMap(event => event.artworks || []);
  const seenFiles = events.filter(event => event.type === 'seen-files').flatMap(event => event.files || []);
  const skipped = events.filter(event => event.type === 'skipped').reduce((sum, event) => sum + event.count, 0);
  const done = events.find(event => event.type === 'done');

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].folderId, 'f_music');
  assert.equal(tracks[0].relativePath, 'Album/New.FLAC');
  assert.equal(tracks[0].fileName, 'New.FLAC');
  assert.equal(tracks[0].ext, 'flac');
  assert.equal(tracks[0].title, 'New');
  assert.equal(tracks[0].codec, 'FLAC');
  assert.equal(tracks[0].artworkMime, 'image/jpeg');
  assert.equal(tracks[0].artworkSourceKind, 'folder-image');
  assert.equal(tracks[0].artworkBytes, null);
  assert.equal(artworks.length, 1);
  assert.equal(tracks[0].artworkId, artworks[0].id);
  assert.equal(artworks[0].mime, 'image/jpeg');
  assert.equal(artworks[0].sourceKind, 'folder-image');
  assert.deepEqual(arrayBufferBytes(artworks[0].bytes), [4, 5, 6]);
  assert.equal(skipped, 1);
  assert.equal(done.found, 2);
  assert.deepEqual(seenFiles.map(file => `${file.folderId}:${file.relativePath}`).sort(), [
    'f_music:Album/New.FLAC',
    'f_music:known.mp3'
  ]);
  assert.equal(done.seenFiles, undefined);
  assert.equal(done.seenPaths, undefined);
});

test('scanLibrary chunks seen files separately from the done event', async () => {
  const root = createTempDir('effetune-library-seen-files-chunks');
  writeFile(path.join(root, 'one.mp3'), 'one');
  writeFile(path.join(root, 'two.mp3'), 'two');
  writeFile(path.join(root, 'three.mp3'), 'three');
  const events = [];

  await runWithScanner({}, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }],
    seenFilesBatchSize: 2
  }, event => {
    events.push(event);
  }));

  const seenEvents = events.filter(event => event.type === 'seen-files');
  const done = events.find(event => event.type === 'done');
  assert.deepEqual(seenEvents.map(event => event.files.length), [2, 1]);
  assert.deepEqual(seenEvents.flatMap(event => event.files.map(file => file.relativePath)).sort(), [
    'one.mp3',
    'three.mp3',
    'two.mp3'
  ]);
  assert.equal(done.seenFiles, undefined);
  assert.equal(done.seenPaths, undefined);
});

test('scanLibrary preserves decomposed Unicode relative paths for filesystem reads', async t => {
  const root = createTempDir('effetune-library-unicode-path');
  const decomposedName = 'Cafe\u0301.mp3';
  const composedName = decomposedName.normalize('NFC');
  assert.notEqual(decomposedName, composedName);
  writeFile(path.join(root, decomposedName), Buffer.from([21, 22, 23]));

  const [actualName] = fs.readdirSync(root);
  if (actualName !== decomposedName) {
    t.skip('filesystem did not preserve the decomposed Unicode filename');
    return;
  }

  await runWithScanner({}, async scanner => {
    const events = [];
    await scanner.scanLibrary({
      roots: [{ folderId: 'f_music', path: root }]
    }, event => {
      events.push(event);
    });

    const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
    assert.equal(track.relativePath, decomposedName);
    assert.notEqual(track.relativePath, composedName);
    assert.deepEqual(
      arrayBufferBytes(await scanner.readFileBytes(path.join(root, track.relativePath))),
      [21, 22, 23]
    );
  });
});

test('scanLibrary keeps composed and decomposed sibling paths distinct', async t => {
  const root = createTempDir('effetune-library-unicode-siblings');
  const decomposedName = 'Cafe\u0301.mp3';
  const composedName = decomposedName.normalize('NFC');
  assert.notEqual(decomposedName, composedName);
  const decomposedPath = path.join(root, decomposedName);
  const composedPath = path.join(root, composedName);
  writeFile(composedPath, 'audio');
  writeFile(decomposedPath, 'audio');
  const fixedTime = new Date('2024-02-03T04:05:06.000Z');
  fs.utimesSync(composedPath, fixedTime, fixedTime);
  fs.utimesSync(decomposedPath, fixedTime, fixedTime);

  const actualNames = fs.readdirSync(root);
  if (!actualNames.includes(composedName) || !actualNames.includes(decomposedName)) {
    t.skip('filesystem did not preserve both Unicode-normalized sibling filenames');
    return;
  }

  const composedStat = fs.statSync(composedPath);
  const decomposedStat = fs.statSync(decomposedPath);
  if (composedStat.size !== decomposedStat.size || composedStat.mtimeMs !== decomposedStat.mtimeMs) {
    t.skip('filesystem did not preserve matching stats for Unicode sibling filenames');
    return;
  }

  await runWithScanner({}, async scanner => {
    const allEvents = [];
    await scanner.scanLibrary({
      roots: [{ folderId: 'f_music', path: root }]
    }, event => {
      allEvents.push(event);
    });

    const tracks = allEvents.filter(event => event.type === 'batch').flatMap(event => event.tracks);
    const relativePaths = tracks.map(track => track.relativePath).sort();
    assert.deepEqual(relativePaths, [decomposedName, composedName].sort());
    assert.equal(new Set(tracks.map(track => track.id)).size, 2);
    assert.equal(tracks.find(track => track.relativePath === composedName).id, scanner.createTrackId('f_music', composedName));
    assert.equal(tracks.find(track => track.relativePath === decomposedName).id, scanner.createTrackId('f_music', decomposedName));

    const knownEvents = [];
    const knownResult = await scanner.scanLibrary({
      roots: [{ folderId: 'f_music', path: root }],
      knownFiles: [{
        folderId: 'f_music',
        relativePath: composedName,
        size: composedStat.size,
        mtimeMs: composedStat.mtimeMs
      }]
    }, event => {
      knownEvents.push(event);
    });
    const changedTracks = knownEvents.filter(event => event.type === 'batch').flatMap(event => event.tracks);
    assert.equal(knownResult.skipped, 1);
    assert.equal(changedTracks.length, 1);
    assert.equal(changedTracks[0].relativePath, decomposedName);
  });
});

test('scanLibrary reuses folder artwork bytes and de-duplicates batch artwork payloads', async () => {
  const root = createTempDir('effetune-library-folder-artwork-cache');
  const albumPath = path.join(root, 'Album');
  const coverPath = path.join(albumPath, 'cover.jpg');
  writeFile(path.join(albumPath, 'one.mp3'), 'one');
  writeFile(path.join(albumPath, 'two.flac'), 'two');
  writeFile(path.join(albumPath, 'three.ogg'), 'three');
  writeFile(coverPath, Buffer.from([10, 11, 12, 13]));
  const events = [];
  const originalOpen = fs.promises.open;
  let coverReads = 0;

  fs.promises.open = async function patchedOpen(filePath, ...args) {
    if (typeof filePath === 'string' && path.resolve(filePath) === path.resolve(coverPath)) {
      coverReads += 1;
    }
    return originalOpen.call(this, filePath, ...args);
  };

  try {
    await runWithScanner({}, scanner => scanner.scanLibrary({
      roots: [{ folderId: 'f_music', path: root }],
      batchSize: 10,
      batchIntervalMs: Number.MAX_SAFE_INTEGER
    }, event => {
      events.push(event);
    }));
  } finally {
    fs.promises.open = originalOpen;
  }

  const batchEvents = events.filter(event => event.type === 'batch');
  assert.equal(coverReads, 1);
  assert.equal(batchEvents.length, 1);
  assert.equal(batchEvents[0].tracks.length, 3);
  assert.equal(batchEvents[0].artworks.length, 1);
  assert.equal(batchEvents[0].artworks[0].refCount, 3);
  assert.deepEqual(arrayBufferBytes(batchEvents[0].artworks[0].bytes), [10, 11, 12, 13]);
  const artworkIds = new Set(batchEvents[0].tracks.map(track => track.artworkId));
  assert.equal(artworkIds.size, 1);
  for (const track of batchEvents[0].tracks) {
    assert.equal(track.artworkBytes, null);
    assert.equal(track.artworkMime, 'image/jpeg');
    assert.equal(track.artworkSourceKind, 'folder-image');
  }
});

test('readArtworkBytes evicts folder artwork buffers when the shared cache exceeds its byte budget', async () => {
  const root = createTempDir('effetune-library-folder-artwork-lru');
  const coverPaths = [];
  for (let index = 1; index <= 4; index += 1) {
    const albumPath = path.join(root, `Album ${index}`);
    writeFile(path.join(albumPath, 'track.mp3'), `track-${index}`);
    const coverPath = path.join(albumPath, 'cover.jpg');
    writeFile(coverPath, Buffer.from([index, index, index, index]));
    coverPaths.push(coverPath);
  }

  const originalOpen = fs.promises.open;
  const coverReads = new Map();
  fs.promises.open = async function patchedOpen(filePath, ...args) {
    const matchedCover = coverPaths.find(coverPath => path.resolve(filePath) === path.resolve(coverPath));
    if (matchedCover) {
      coverReads.set(matchedCover, (coverReads.get(matchedCover) || 0) + 1);
    }
    return originalOpen.call(this, filePath, ...args);
  };

  try {
    await runWithScanner({}, async scanner => {
      const artworkCache = new Map();
      const options = {
        artworkCache,
        maxFolderArtworkCacheBytes: 8
      };
      for (let index = 1; index <= 4; index += 1) {
        const bytes = await scanner.readArtworkBytes(path.join(root, `Album ${index}`, 'track.mp3'), options);
        assert.deepEqual(arrayBufferBytes(bytes), [index, index, index, index]);
      }
      assert.deepEqual(
        arrayBufferBytes(await scanner.readArtworkBytes(path.join(root, 'Album 1', 'track.mp3'), options)),
        [1, 1, 1, 1]
      );
      assert.deepEqual(
        arrayBufferBytes(await scanner.readArtworkBytes(path.join(root, 'Album 4', 'track.mp3'), options)),
        [4, 4, 4, 4]
      );
    });
  } finally {
    fs.promises.open = originalOpen;
  }

  assert.equal(coverReads.get(coverPaths[0]), 2);
  assert.equal(coverReads.get(coverPaths[1]), 1);
  assert.equal(coverReads.get(coverPaths[2]), 1);
  assert.equal(coverReads.get(coverPaths[3]), 1);
});

test('scanLibrary rejects folder artwork that grows after descriptor stat without readFile allocation', async () => {
  const root = createTempDir('effetune-library-folder-artwork-race');
  const audioPath = path.join(root, 'track.mp3');
  const coverPath = path.join(root, 'cover.jpg');
  writeFile(audioPath, 'audio');
  writeFile(coverPath, Buffer.from([1, 2, 3, 4]));

  await runWithScanner({}, async scanner => {
    const originalStat = fs.promises.stat;
    const originalReadFile = fs.promises.readFile;
    let mutated = false;
    let coverReadFileCalls = 0;
    fs.promises.stat = async function patchedStat(filePath, ...args) {
      const stat = await originalStat.call(this, filePath, ...args);
      if (!mutated && typeof filePath === 'string' && path.resolve(filePath) === path.resolve(coverPath)) {
        mutated = true;
        fs.truncateSync(coverPath, scanner.MAX_ARTWORK_BYTES + 1);
      }
      return stat;
    };
    fs.promises.readFile = async function patchedReadFile(filePath, ...args) {
      if (typeof filePath === 'string' && path.resolve(filePath) === path.resolve(coverPath)) {
        coverReadFileCalls += 1;
      }
      return originalReadFile.call(this, filePath, ...args);
    };

    try {
      const events = [];
      await scanner.scanLibrary({
        roots: [{ folderId: 'f_music', path: root }]
      }, event => {
        events.push(event);
      });

      const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
      const artworks = events.filter(event => event.type === 'batch').flatMap(event => event.artworks || []);
      assert.equal(mutated, true);
      assert.equal(coverReadFileCalls, 0);
      assert.equal(track.artworkBytes, null);
      assert.equal(track.artworkMime, null);
      assert.equal(track.artworkSourceKind, null);
      assert.deepEqual(artworks, []);
    } finally {
      fs.promises.stat = originalStat;
      fs.promises.readFile = originalReadFile;
    }
  });
});

test('scanLibrary maps music metadata without loading embedded artwork by default', async () => {
  const root = createTempDir('effetune-library-metadata');
  const audioPath = path.join(root, 'track.flac');
  writeFile(audioPath, 'metadata');
  const parseCalls = [];
  const metadataModule = {
    async parseFile(filePath, options) {
      parseCalls.push([filePath, options]);
      return {
        common: {
          title: 'Mapped Title',
          artists: ['Artist A', 'Artist B'],
          albumartist: 'Various Artists',
          album: 'Mapped Album',
          genre: ['Jazz', 'Fusion'],
          year: 2024,
          track: { no: 3, of: 9 },
          disk: { no: 1, of: 2 },
          titlesort: 'Title Sort',
          albumsort: 'Album Sort',
          albumartistsort: 'Album Artist Sort',
          picture: [{
            type: 'Cover (front)',
            format: 'image/png',
            data: Buffer.from([7, 8, 9])
          }]
        },
        format: {
          duration: 42.5,
          sampleRate: 48000,
          bitrate: 320000,
          bitsPerSample: 24,
          numberOfChannels: 2,
          codec: 'FLAC'
        }
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }]
  }, event => {
    events.push(event);
  }));

  const batchEvent = events.find(event => event.type === 'batch');
  const track = batchEvent.tracks[0];

  assert.equal(parseCalls.length, 1);
  assert.deepEqual(parseCalls[0][1], { duration: false, skipCovers: true });
  assert.equal(track.title, 'Mapped Title');
  assert.equal(track.artist, 'Artist A; Artist B');
  assert.equal(track.albumArtist, 'Various Artists');
  assert.equal(track.album, 'Mapped Album');
  assert.equal(track.genre, 'Jazz');
  assert.equal(track.year, 2024);
  assert.equal(track.trackNo, 3);
  assert.equal(track.trackOf, 9);
  assert.equal(track.discNo, 1);
  assert.equal(track.discOf, 2);
  assert.equal(track.compilation, true);
  assert.equal(track.sortTitle, 'Title Sort');
  assert.equal(track.sortAlbum, 'Album Sort');
  assert.equal(track.sortAlbumArtist, 'Album Artist Sort');
  assert.equal(track.durationSec, 42.5);
  assert.equal(track.sampleRate, 48000);
  assert.equal(track.bitrate, 320000);
  assert.equal(track.bitsPerSample, 24);
  assert.equal(track.channels, 2);
  assert.equal(track.codec, 'FLAC');
  assert.equal(track.artworkId, null);
  assert.equal(track.artworkMime, null);
  assert.equal(track.artworkSourceKind, null);
  assert.equal(track.artworkBytes, null);
  assert.deepEqual(batchEvent.artworks, []);
});

test('scanLibrary prefers explicit native track totals over malformed common numbers', async () => {
  const root = createTempDir('effetune-library-native-track-number');
  const audioPath = path.join(root, 'track.mp3');
  writeFile(audioPath, 'metadata');
  const metadataModule = {
    async parseFile() {
      return {
        common: {
          title: 'Mapped Title',
          track: { no: 32, of: null },
          disk: { no: null, of: null }
        },
        native: {
          'ID3v2.3': [
            { id: 'TRCK', value: '03/12' },
            { id: 'TPOS', value: '1/2' }
          ]
        },
        format: {}
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }]
  }, event => {
    events.push(event);
  }));

  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.trackNo, 3);
  assert.equal(track.trackOf, 12);
  assert.equal(track.discNo, 1);
  assert.equal(track.discOf, 2);
});

test('scanLibrary prefers ID3v2 track numbers over malformed common ID3v1 numbers', async () => {
  const root = createTempDir('effetune-library-native-id3v2-track-number');
  const audioPath = path.join(root, 'track.mp3');
  writeFile(audioPath, 'metadata');
  const metadataModule = {
    async parseFile() {
      return {
        common: {
          title: 'Mapped Title',
          track: { no: 32, of: null },
          disk: { no: null, of: null }
        },
        native: {
          'ID3v2.3': [
            { id: 'TRCK', value: '03' }
          ],
          ID3v1: [
            { id: 'track', value: 32 }
          ]
        },
        format: {}
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }]
  }, event => {
    events.push(event);
  }));

  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.trackNo, 3);
  assert.equal(track.trackOf, null);
});

test('scanLibrary prefers modern native text fields over malformed common values', async () => {
  const root = createTempDir('effetune-library-native-text-fields');
  const audioPath = path.join(root, 'track.mp3');
  writeFile(audioPath, 'metadata');
  const metadataModule = {
    async parseFile() {
      return {
        common: {
          title: 'Legacy Title',
          artists: ['Legacy Artist'],
          albumartist: 'Legacy Album Artist',
          album: 'Legacy Album',
          genre: ['Legacy Genre'],
          year: 1999,
          compilation: false,
          titlesort: 'Legacy Sort Title',
          albumsort: 'Legacy Sort Album',
          albumartistsort: 'Legacy Sort Album Artist'
        },
        native: {
          APEv2: [
            { id: 'TITLE', value: 'APE Title' },
            { id: 'ARTIST', value: 'APE Artist' }
          ],
          'ID3v2.3': [
            { id: 'TIT2', value: 'Native Title' },
            { id: 'TPE1', value: 'Native Artist' },
            { id: 'TPE2', value: 'Native Album Artist' },
            { id: 'TALB', value: 'Native Album' },
            { id: 'TCON', value: 'Native Genre' },
            { id: 'TDRC', value: '2024-12-25' },
            { id: 'TSOT', value: 'Native Sort Title' },
            { id: 'TSOA', value: 'Native Sort Album' },
            { id: 'TSO2', value: 'Native Sort Album Artist' },
            { id: 'TCMP', value: '1' }
          ],
          ID3v1: [
            { id: 'title', value: 'ID3v1 Title' },
            { id: 'artist', value: 'ID3v1 Artist' },
            { id: 'album', value: 'ID3v1 Album' },
            { id: 'genre', value: 'ID3v1 Genre' },
            { id: 'year', value: '1999' }
          ]
        },
        format: {}
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }]
  }, event => {
    events.push(event);
  }));

  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.title, 'Native Title');
  assert.equal(track.artist, 'Native Artist');
  assert.equal(track.albumArtist, 'Native Album Artist');
  assert.equal(track.album, 'Native Album');
  assert.equal(track.genre, 'Native Genre');
  assert.equal(track.year, 2024);
  assert.equal(track.compilation, true);
  assert.equal(track.sortTitle, 'Native Sort Title');
  assert.equal(track.sortAlbum, 'Native Sort Album');
  assert.equal(track.sortAlbumArtist, 'Native Sort Album Artist');
});

test('scanLibrary does not let ID3v1 text override common text', async () => {
  const root = createTempDir('effetune-library-id3v1-text-fallback');
  const audioPath = path.join(root, 'track.mp3');
  writeFile(audioPath, 'metadata');
  const metadataModule = {
    async parseFile() {
      return {
        common: {
          title: 'Long Common Title',
          artists: ['Long Common Artist'],
          album: 'Long Common Album',
          genre: ['Long Common Genre']
        },
        native: {
          ID3v1: [
            { id: 'title', value: 'Truncated Title' },
            { id: 'artist', value: 'Truncated Artist' },
            { id: 'album', value: 'Truncated Album' },
            { id: 'genre', value: 'Truncated Genre' }
          ]
        },
        format: {}
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }]
  }, event => {
    events.push(event);
  }));

  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.title, 'Long Common Title');
  assert.equal(track.artist, 'Long Common Artist');
  assert.equal(track.album, 'Long Common Album');
  assert.equal(track.genre, 'Long Common Genre');
});

test('scanLibrary keeps decoded common genre over numeric ID3 genre codes', async () => {
  const root = createTempDir('effetune-library-id3-genre-code');
  const audioPath = path.join(root, 'track.mp3');
  writeFile(audioPath, 'metadata');
  const metadataModule = {
    async parseFile() {
      return {
        common: {
          title: 'Mapped Title',
          genre: ['Rock']
        },
        native: {
          'ID3v2.3': [
            { id: 'TCON', value: '17' }
          ]
        },
        format: {}
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }]
  }, event => {
    events.push(event);
  }));

  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.genre, 'Rock');
});

test('scanLibrary repairs legacy Japanese mojibake in metadata text', async () => {
  const root = createTempDir('effetune-library-japanese-mojibake');
  writeFile(path.join(root, 'mojibake.mp3'), 'metadata');
  const metadataModule = {
    async parseFile() {
      return {
        common: {
          title: '\u201A\u00B1\u201A\u00F1\u201A\u00C9\u201A\u00BF\u201A\u00CD',
          artist: '\u0083A\u0081[\u0083e\u0083B\u0083X\u0083g',
          album: 'Plain Album'
        },
        format: {}
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }]
  }, event => {
    events.push(event);
  }));

  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.title, 'こんにちは');
  assert.equal(track.artist, 'アーティスト');
  assert.equal(track.album, 'Plain Album');
});

test('scanLibrary uses clean Japanese context to repair legacy CP932 ID3 text without forcing other scripts', async () => {
  const root = createTempDir('effetune-library-cp932-context');
  const cases = [
    {
      fileName: 'ando.mp3',
      title: 'ロマンチック',
      artist: decodeLatin1([0x88, 0xc0, 0x93, 0xa1, 0x97, 0x54, 0x8e, 0x71]),
      album: 'Middle Tempo Magic',
      expectedArtist: '安藤裕子',
      expectedAlbum: 'Middle Tempo Magic'
    },
    {
      fileName: 'mori.mp3',
      title: '土曜日の嘘',
      artist: decodeLatin1([0x90, 0x58, 0x8e, 0x52, 0x92, 0xbc, 0x91, 0xbe, 0x98, 0x4e]),
      album: decodeLatin1([0x8c, 0x86, 0x8d, 0xec, 0x90, 0xef, 0x20, 0x32, 0x30, 0x30, 0x31, 0x81, 0x60, 0x32, 0x30, 0x30, 0x35, 0x20, 0x5b, 0x42, 0x6f, 0x6e, 0x75, 0x73, 0x20, 0x44, 0x69, 0x73, 0x63, 0x5d]),
      expectedArtist: '森山直太朗',
      expectedAlbum: '傑作撰 2001～2005 [Bonus Disc]'
    },
    {
      fileName: 'denki.mp3',
      title: '聖☆おじさん',
      artist: decodeLatin1([0x93, 0x64, 0x8b, 0x43, 0x83, 0x4f, 0x83, 0x8b, 0x81, 0x5b, 0x83, 0x94, 0x81, 0x7e, 0x83, 0x58, 0x83, 0x60, 0x83, 0x83, 0x83, 0x5f, 0x83, 0x89, 0x83, 0x70, 0x81, 0x5b]),
      album: decodeLatin1([0x93, 0x64, 0x8b, 0x43, 0x83, 0x4f, 0x83, 0x8b, 0x81, 0x5b, 0x83, 0x75, 0x81, 0x7e, 0x83, 0x58, 0x83, 0x60, 0x83, 0x83, 0x83, 0x5f, 0x83, 0x89, 0x83, 0x70, 0x81, 0x5b]),
      expectedArtist: '電気グルーヴ×スチャダラパー',
      expectedAlbum: '電気グルーブ×スチャダラパー'
    },
    {
      fileName: '01-もどかしさが奏でるブルース.mp3',
      title: 'もどかしさが奏でるブルース',
      artist: decodeLatin1([0x95, 0x97, 0x96, 0xa1, 0x93, 0xb0]),
      album: decodeLatin1([0x95, 0x97, 0x96, 0xa1, 0x93, 0xb0]),
      expectedArtist: '風味堂',
      expectedAlbum: '風味堂'
    },
    {
      fileName: '13-人生一路.mp3',
      title: decodeLatin1([0x90, 0x6c, 0x90, 0xb6, 0x88, 0xea, 0x98, 0x48]),
      artist: decodeLatin1([0x94, 0xfc, 0x8b, 0xf3, 0x82, 0xd0, 0x82, 0xce, 0x82, 0xe8]),
      album: decodeLatin1([0x94, 0xfc, 0x8b, 0xf3, 0x82, 0xd0, 0x82, 0xce, 0x82, 0xe8, 0x20, 0x83, 0x58, 0x83, 0x79, 0x83, 0x56, 0x83, 0x83, 0x83, 0x8b, 0x83, 0x78, 0x83, 0x58, 0x83, 0x67]),
      expectedTitle: '人生一路',
      expectedArtist: '美空ひばり',
      expectedAlbum: '美空ひばり スペシャルベスト'
    },
    {
      fileName: '11-歩.mp3',
      relativePath: '北島三郎/ベスト16/11-歩.mp3',
      title: decodeLatin1([0x95, 0xe0]),
      artist: decodeLatin1([0x96, 0x6b, 0x93, 0x87, 0x8e, 0x4f, 0x98, 0x59]),
      album: decodeLatin1([0x83, 0x78, 0x83, 0x58, 0x83, 0x67, 0x31, 0x36]),
      expectedTitle: '歩',
      expectedArtist: '北島三郎',
      expectedAlbum: 'ベスト16'
    },
    {
      fileName: '02-竹.mp3',
      relativePath: '北島三郎/ベスト16/02-竹.mp3',
      title: decodeLatin1([0x92, 0x7c]),
      artist: decodeLatin1([0x96, 0x6b, 0x93, 0x87, 0x8e, 0x4f, 0x98, 0x59]),
      album: decodeLatin1([0x83, 0x78, 0x83, 0x58, 0x83, 0x67, 0x31, 0x36]),
      expectedTitle: '竹',
      expectedArtist: '北島三郎',
      expectedAlbum: 'ベスト16'
    },
    {
      fileName: '03-橋.mp3',
      relativePath: '北島三郎/ベスト16/03-橋.mp3',
      title: decodeLatin1([0x8b, 0xb4]),
      artist: decodeLatin1([0x96, 0x6b, 0x93, 0x87, 0x8e, 0x4f, 0x98, 0x59]),
      album: decodeLatin1([0x83, 0x78, 0x83, 0x58, 0x83, 0x67, 0x31, 0x36]),
      expectedTitle: '橋',
      expectedArtist: '北島三郎',
      expectedAlbum: 'ベスト16'
    },
    {
      fileName: '09-夢.mp3',
      relativePath: '北島三郎/ベスト16/09-夢.mp3',
      title: decodeLatin1([0x96, 0xb2]),
      artist: decodeLatin1([0x96, 0x6b, 0x93, 0x87, 0x8e, 0x4f, 0x98, 0x59]),
      album: decodeLatin1([0x83, 0x78, 0x83, 0x58, 0x83, 0x67, 0x31, 0x36]),
      expectedTitle: '夢',
      expectedArtist: '北島三郎',
      expectedAlbum: 'ベスト16'
    },
    {
      fileName: '01-童神.mp3',
      relativePath: '花_花/コモリウタ/01-童神.mp3',
      title: decodeLatin1([0x93, 0xb6, 0x90, 0x5f]),
      artist: decodeLatin1([0x89, 0xd4, 0x2a, 0x89, 0xd4]),
      albumArtist: decodeLatin1([0x89, 0xd4, 0x81, 0x96, 0x89, 0xd4]),
      album: decodeLatin1([0x83, 0x52, 0x83, 0x82, 0x83, 0x8a, 0x83, 0x45, 0x83, 0x5e]),
      expectedTitle: '童神',
      expectedArtist: '花*花',
      expectedAlbumArtist: '花＊花',
      expectedAlbum: 'コモリウタ'
    },
    {
      fileName: '01-ピアノ協奏曲 第一番変ホ長調 アレグロ・マエストーソ.mp3',
      relativePath: 'FRANZ LISZT/ロマン派の巨匠/01-ピアノ協奏曲 第一番変ホ長調 アレグロ・マエストーソ.mp3',
      title: 'ピアノ協奏曲 第一番変ホ長調 アレグロ・マエストーソ',
      artist: 'FRANZ LISZT',
      albumArtist: decodeLatin1([0x83, 0x8a, 0x83, 0x58, 0x83, 0x67]),
      album: decodeLatin1([0x83, 0x8d, 0x83, 0x7d, 0x83, 0x93, 0x94, 0x68, 0x82, 0xcc, 0x8b, 0x90, 0x8f, 0xa0]),
      expectedArtist: 'FRANZ LISZT',
      expectedAlbumArtist: 'リスト',
      expectedAlbum: 'ロマン派の巨匠'
    },
    {
      fileName: '01-釣りに行こう.mp3',
      relativePath: 'THE BOOM/Singles＋ (Bonus Tracks)/01-釣りに行こう.mp3',
      title: '釣りに行こう',
      artist: 'THE BOOM',
      album: decodeLatin1([...Buffer.from('Singles', 'ascii'), 0x81, 0x7b, ...Buffer.from(' (Bonus Tracks)', 'ascii')]),
      expectedArtist: 'THE BOOM',
      expectedAlbum: 'Singles＋ (Bonus Tracks)'
    },
    {
      fileName: '01-Theme of 018.mp3',
      relativePath: 'SMAP/Poｐ Uｐ SMAP/01-Theme of 018.mp3',
      title: 'Theme of 018',
      artist: 'SMAP',
      album: decodeLatin1([0x50, 0x6f, 0x82, 0x90, 0x20, 0x55, 0x82, 0x90, 0x20, 0x53, 0x4d, 0x41, 0x50]),
      expectedArtist: 'SMAP',
      expectedAlbum: 'Poｐ Uｐ SMAP'
    },
    {
      fileName: '01-カルロス・ディ・サルリ楽団 _ エル・チョクロ.mp3',
      relativePath: 'Omnibus/Ｔｈｅ　Ｂｅｓｔ　ｏｆ　Ａｒｇｅｎｔｉｎｅ　Ｔａｎｇｏ/01-カルロス・ディ・サルリ楽団 _ エル・チョクロ.mp3',
      title: 'カルロス・ディ・サルリ楽団 / エル・チョクロ',
      artist: 'omnibus',
      album: decodeLatin1([
        0x82, 0x73, 0x82, 0x88, 0x82, 0x85, 0x81, 0x40,
        0x82, 0x61, 0x82, 0x85, 0x82, 0x93, 0x82, 0x94,
        0x81, 0x40, 0x82, 0x8f, 0x82, 0x86, 0x81, 0x40,
        0x82, 0x60, 0x82, 0x92, 0x82, 0x87, 0x82, 0x85,
        0x82, 0x8e, 0x82, 0x94, 0x82, 0x89, 0x82, 0x8e,
        0x82, 0x85, 0x81, 0x40, 0x82, 0x73, 0x82, 0x81,
        0x82, 0x8e, 0x82, 0x87, 0x82, 0x8f
      ]),
      expectedArtist: 'omnibus',
      expectedAlbum: 'Ｔｈｅ　Ｂｅｓｔ　ｏｆ　Ａｒｇｅｎｔｉｎｅ　Ｔａｎｇｏ'
    },
    {
      fileName: 'chinese-artist.mp3',
      title: '日本語タイトル',
      artist: decodeLatin1([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7]),
      album: 'Mixed Script Album',
      expectedArtist: '你好世界',
      expectedAlbum: 'Mixed Script Album'
    },
    {
      fileName: 'korean-artist.mp3',
      title: '日本語タイトル',
      artist: decodeLatin1([0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4]),
      album: 'Mixed Script Album',
      expectedArtist: '안녕하세요',
      expectedAlbum: 'Mixed Script Album'
    }
  ];
  const byFileName = new Map(cases.map(item => [item.fileName, item]));
  for (const item of cases) {
    writeFile(path.join(root, item.relativePath || item.fileName), 'metadata');
  }
  const metadataModule = {
    async parseFile(filePath) {
      const item = byFileName.get(path.basename(filePath));
      return {
        common: {
          title: item.title,
          artist: item.artist,
          albumartist: item.albumArtist,
          album: item.album
        },
        format: {}
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }],
    batchSize: cases.length,
    languageHints: { language: 'ja' }
  }, event => {
    events.push(event);
  }));

  const tracks = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  const byName = new Map(tracks.map(track => [track.fileName, track]));
  for (const item of cases) {
    assert.equal(byName.get(item.fileName).title, item.expectedTitle || item.title);
    assert.equal(byName.get(item.fileName).artist, item.expectedArtist);
    if (item.expectedAlbumArtist !== undefined) {
      assert.equal(byName.get(item.fileName).albumArtist, item.expectedAlbumArtist);
    }
    assert.equal(byName.get(item.fileName).album, item.expectedAlbum);
  }
});

test('scanLibrary reads raw CP932 RIFF INFO tags from WAV before string data is lost', async () => {
  const root = createTempDir('effetune-library-wav-riff-info-cp932');
  const artistBytes = Buffer.from('95bd89ea837d838a834a00', 'hex');
  const albumBytes = Buffer.from('83828369a5838a8354202081608367838a83728385815b836781458367834481458369836283678145834c8393834f81458352815b838b816000', 'hex');
  const wavPath = path.join(
    root,
    '平賀マリカ',
    'モナ･リサ ～トリビュート・トゥ・ナット・キング・コール～',
    'ddcb130163-3_1_01.wav'
  );
  writeFile(wavPath, createRiffInfoWave([
    { id: 'INAM', data: Buffer.from('MONA LISA\0', 'ascii') },
    { id: 'IART', data: artistBytes },
    { id: 'IPRD', data: albumBytes }
  ]));
  const metadataModule = {
    async parseFile() {
      return {
        common: {
          title: 'MONA LISA',
          artist: decodeHighBitsCleared([...artistBytes]),
          album: decodeHighBitsCleared([...albumBytes])
        },
        native: {
          exif: [
            { id: 'INAM', value: 'MONA LISA' },
            { id: 'IART', value: decodeHighBitsCleared([...artistBytes]) },
            { id: 'IPRD', value: decodeHighBitsCleared([...albumBytes]) }
          ]
        },
        format: {
          container: 'WAVE',
          codec: 'PCM'
        }
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }],
    languageHints: { language: 'ja' }
  }, event => {
    events.push(event);
  }));

  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.title, 'MONA LISA');
  assert.equal(track.artist, '平賀マリカ');
  assert.equal(track.albumArtist, '平賀マリカ');
  assert.equal(track.album, 'モナ･リサ  ～トリビュート・トゥ・ナット・キング・コール～');
});

test('scanLibrary maps alternate RIFF INFO title, album, and date ids', async () => {
  const root = createTempDir('effetune-library-wav-riff-info-alternate-ids');
  const wavPath = path.join(root, 'alternate.wav');
  writeFile(wavPath, createRiffInfoWave([
    { id: 'TITL', data: Buffer.from('Alternate Title\0', 'ascii') },
    { id: 'IART', data: Buffer.from('Alternate Artist\0', 'ascii') },
    { id: 'IRPD', data: Buffer.from('Alternate Album\0', 'ascii') },
    { id: 'ICRD', data: Buffer.from('2021-04-03\0', 'ascii') }
  ]));
  const metadataModule = {
    async parseFile() {
      return {
        common: {},
        native: {},
        format: {
          container: 'WAVE',
          codec: 'PCM'
        }
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }]
  }, event => {
    events.push(event);
  }));

  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.title, 'Alternate Title');
  assert.equal(track.artist, 'Alternate Artist');
  assert.equal(track.albumArtist, 'Alternate Artist');
  assert.equal(track.album, 'Alternate Album');
  assert.equal(track.year, 2021);
});

test('scanLibrary repairs legacy metadata mojibake for other scripts', async () => {
  const root = createTempDir('effetune-library-metadata-mojibake');
  const cases = [
    {
      fileName: 'cyrillic.mp3',
      title: decodeWindows1252([0xd0, 0x9f, 0xd1, 0x80, 0xd0, 0xb8, 0xd0, 0xb2, 0xd0, 0xb5, 0xd1, 0x82]),
      expected: 'Привет'
    },
    {
      fileName: 'korean.mp3',
      title: decodeWindows1252([0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4]),
      expected: '안녕하세요'
    },
    {
      fileName: 'chinese.mp3',
      title: decodeWindows1252([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7]),
      expected: '你好世界'
    },
    {
      fileName: 'greek.mp3',
      title: decodeWindows1252([0xce, 0x93, 0xce, 0xb5, 0xce, 0xb9, 0xce, 0xac]),
      expected: 'Γειά'
    },
    {
      fileName: 'arabic.mp3',
      title: decodeWindows1252([0xd9, 0x85, 0xd8, 0xb1, 0xd8, 0xad, 0xd8, 0xa8, 0xd8, 0xa7]),
      expected: 'مرحبا'
    },
    {
      fileName: 'hebrew.mp3',
      title: decodeWindows1252([0xd7, 0xa9, 0xd7, 0x9c, 0xd7, 0x95, 0xd7, 0x9d]),
      expected: 'שלום'
    },
    {
      fileName: 'utf8-western.mp3',
      title: decodeWindows1252([0x42, 0x65, 0x79, 0x6f, 0x6e, 0x63, 0xc3, 0xa9]),
      expected: 'Beyoncé'
    }
  ];
  const byFileName = new Map(cases.map(item => [item.fileName, item]));
  for (const item of cases) {
    writeFile(path.join(root, item.fileName), 'metadata');
  }
  const metadataModule = {
    async parseFile(filePath) {
      const item = byFileName.get(path.basename(filePath));
      return {
        common: {
          title: item.title
        },
        format: {}
      };
    }
  };
  const events = [];

  await runWithScanner(metadataModule, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }],
    batchSize: cases.length
  }, event => {
    events.push(event);
  }));

  const tracks = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  const byName = new Map(tracks.map(track => [track.fileName, track]));
  for (const item of cases) {
    assert.equal(byName.get(item.fileName).title, item.expected);
  }
});

test('scanLibrary preserves clean accented Latin metadata with single-byte language hints', async () => {
  const cases = [
    {
      name: 'french-cyrillic-hint',
      title: 'Éçàùîô',
      languageHints: { language: 'ru' }
    },
    {
      name: 'cafe-cyrillic-hint',
      title: 'Café',
      languageHints: { language: 'ru' }
    },
    {
      name: 'german-greek-hint',
      title: 'Grüße',
      languageHints: { language: 'el' }
    }
  ];

  for (const item of cases) {
    const root = createTempDir(`effetune-library-clean-accented-latin-${item.name}`);
    writeFile(path.join(root, 'track.mp3'), 'metadata');
    const events = [];

    await runWithScanner({
      async parseFile() {
        return {
          common: { title: item.title },
          format: {}
        };
      }
    }, scanner => scanner.scanLibrary({
      roots: [{ folderId: 'f_music', path: root }],
      languageHints: item.languageHints
    }, event => {
      events.push(event);
    }));

    const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
    assert.equal(track.title, item.title);
  }
});

test('scanLibrary preserves ambiguous legacy metadata code pages without corruption markers', async () => {
  const legacyRussian = decodeWindows1252([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
  const preservedRoot = createTempDir('effetune-library-hinted-mojibake-preserved');
  writeFile(path.join(preservedRoot, 'russian.mp3'), 'metadata');
  const preservedEvents = [];

  await runWithScanner({
    async parseFile() {
      return {
        common: { title: legacyRussian },
        format: {}
      };
    }
  }, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: preservedRoot }]
  }, event => {
    preservedEvents.push(event);
  }));

  const [preservedTrack] = preservedEvents.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(preservedTrack.title, legacyRussian);

  const cases = [
    {
      name: 'russian',
      title: legacyRussian,
      languageHints: { language: 'ru' },
      expected: legacyRussian
    },
    {
      name: 'greek',
      title: decodeWindows1252([0xc3, 0xe5, 0xe9, 0xdc]),
      languageHints: { language: 'en', browserLanguage: 'el-GR' },
      expected: decodeWindows1252([0xc3, 0xe5, 0xe9, 0xdc])
    },
    {
      name: 'arabic',
      title: decodeWindows1252([0xe3, 0xd1, 0xcd, 0xc8, 0xc7]),
      languageHints: { language: 'ar' },
      expected: decodeWindows1252([0xe3, 0xd1, 0xcd, 0xc8, 0xc7])
    },
    {
      name: 'hindi',
      title: decodeUtf8AsWindows1252('नमस्ते'),
      languageHints: { language: 'en', browserLanguage: 'hi-IN' },
      expected: 'नमस्ते'
    }
  ];

  for (const item of cases) {
    const root = createTempDir(`effetune-library-hinted-mojibake-${item.name}`);
    writeFile(path.join(root, 'track.mp3'), 'metadata');
    const events = [];
    await runWithScanner({
      async parseFile() {
        return {
          common: { title: item.title },
          format: {}
        };
      }
    }, scanner => scanner.scanLibrary({
      roots: [{ folderId: 'f_music', path: root }],
      languageHints: item.languageHints
    }, event => {
      events.push(event);
    }));

    const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
    assert.equal(track.title, item.expected);
  }
});

test('scanLibrary flushes embedded artwork while parsing and clamps oversized batch artwork limits', async () => {
  const root = createTempDir('effetune-library-artwork-budget');
  const trackCount = 6;
  for (let index = 1; index <= trackCount; index += 1) {
    writeFile(path.join(root, `${String(index).padStart(2, '0')}.flac`), `audio-${index}`);
  }

  let parseCalls = 0;
  await runWithScanner({
    async parseFile(filePath) {
      parseCalls += 1;
      const index = Number(path.basename(filePath, path.extname(filePath)));
      return {
        common: {
          title: `Track ${index}`,
          picture: [{
            format: 'image/png',
            data: Buffer.alloc(16 * 1024 * 1024, index)
          }]
        },
        format: { duration: index }
      };
    }
  }, async scanner => {
    const batchSummaries = [];
    await scanner.scanLibrary({
      roots: [{ folderId: 'f_music', path: root }],
      concurrency: 1,
      batchSize: 1000,
      batchIntervalMs: Number.MAX_SAFE_INTEGER,
      maxBatchArtworkBytes: Number.MAX_SAFE_INTEGER,
      skipCovers: false
    }, event => {
      if (event.type !== 'batch') return;
      const artworkBytes = event.artworks.reduce((sum, artwork) => sum + artwork.bytes.byteLength, 0);
      batchSummaries.push({
        artworkBytes,
        artworkCount: event.artworks.length,
        parseCallsAtEmit: parseCalls,
        trackCount: event.tracks.length
      });
      for (const track of event.tracks) {
        assert.equal(track.artworkBytes, null);
      }
    });

    assert.equal(parseCalls, trackCount);
    assert.equal(batchSummaries.length, 2);
    assert.equal(batchSummaries[0].parseCallsAtEmit < trackCount, true);
    assert.equal(batchSummaries[0].artworkBytes, scanner.DEFAULT_MAX_BATCH_ARTWORK_BYTES);
    assert.equal(batchSummaries[0].artworkCount, 4);
    assert.equal(batchSummaries[0].trackCount, 4);
    assert.equal(batchSummaries[1].artworkCount, 2);
    assert.equal(batchSummaries[1].trackCount, 2);
    for (const summary of batchSummaries) {
      assert.equal(summary.artworkBytes <= scanner.DEFAULT_MAX_BATCH_ARTWORK_BYTES, true);
    }
  });
});

test('scanLibrary worker path drops oversized embedded artwork before posting metadata', async () => {
  const root = createTempDir('effetune-library-worker-artwork-limit');
  const audioPath = path.join(root, 'worker.flac');
  const metadataModulePath = path.join(root, 'fake-metadata.mjs');
  writeFile(audioPath, 'worker');
  fs.writeFileSync(metadataModulePath, `
import { isMainThread } from 'node:worker_threads';

export async function parseFile() {
  if (isMainThread) {
    throw new Error('direct metadata parsing should not run in this test');
  }
  return {
    common: {
      title: 'Worker Oversized',
      picture: [{
        type: 'Cover (front)',
        description: 'front cover',
        format: 'image/png',
        data: new Uint8Array(65),
        marker: () => 1
      }]
    },
    format: { duration: 9 }
  };
}
`);

  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
    if (request === 'music-metadata') return metadataModulePath;
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'music-metadata') {
      const error = new Error('music-metadata is ESM-only in this test');
      error.code = 'ERR_REQUIRE_ESM';
      throw error;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const scanner = loadFreshModule('../../electron/library-scanner.js');
    const events = [];
    const result = await scanner.scanLibrary({
      roots: [{ folderId: 'f_music', path: root }],
      concurrency: 1,
      skipCovers: false,
      maxArtworkBytes: 64
    }, event => {
      events.push(event);
    });

    const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
    const artworks = events.filter(event => event.type === 'batch').flatMap(event => event.artworks || []);
    assert.equal(result.parseErrors, 0);
    assert.equal(track.title, 'Worker Oversized');
    assert.equal(track.durationSec, 9);
    assert.equal(track.artworkBytes, null);
    assert.equal(track.artworkMime, null);
    assert.equal(track.artworkSourceKind, null);
    assert.deepEqual(artworks, []);
  } finally {
    Module._resolveFilename = originalResolveFilename;
    Module._load = originalLoad;
  }
});

test('scanLibrary aborts without a done event when the signal is canceled', async () => {
  const root = createTempDir('effetune-library-abort');
  writeFile(path.join(root, 'a.mp3'), 'a');
  writeFile(path.join(root, 'b.flac'), 'b');
  const controller = new AbortController();
  const events = [];

  await runWithScanner({}, async scanner => {
    await assert.rejects(
      scanner.scanLibrary({
        roots: [{ folderId: 'f_music', path: root }],
        signal: controller.signal
      }, event => {
        events.push(event);
        if (event.type === 'enumerate-progress') {
          controller.abort();
        }
      }),
      { name: 'AbortError' }
    );
  });

  assert.equal(events.some(event => event.type === 'done'), false);
});

test('library-scan-cancel interrupts a hung metadata parse and emits a canceled terminal event', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-hung-parse-cancel');
  const selectedPath = path.join(root, 'Selected Music');
  writeFile(path.join(selectedPath, 'hung.mp3'), 'hung');
  let resolveParseStarted;
  const parseStarted = new Promise(resolve => {
    resolveParseStarted = resolve;
  });

  await runWithScanner({
    parseFile() {
      resolveParseStarted();
      return new Promise(() => {});
    }
  }, async scanner => {
    const handlers = new Map();
    const sentEvents = [];
    const registration = registerLibraryIpcHandlers({
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    }, {
      app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
      dialog: {
        async showOpenDialog() {
          return { canceled: false, filePaths: [selectedPath] };
        }
      },
      shell: { showItemInFolder() {} },
      getMainWindow: () => null,
      scanner
    });

    await handlers.get('library-select-folder')({});
    const ipcEvent = {
      sender: {
        send(channel, payload) {
          sentEvents.push([channel, payload]);
        }
      }
    };
    const startResult = await handlers.get('library-scan-start')(ipcEvent, {
      scanId: 'scan_hung_parse',
      roots: [{ folderId: 'f_music', path: selectedPath }]
    });
    assert.equal(startResult.success, true);
    await parseStarted;

    assert.deepEqual(await handlers.get('library-scan-cancel')({}, 'scan_hung_parse'), {
      success: true,
      scanId: 'scan_hung_parse',
      canceled: true
    });

    await waitForCondition(() => {
      return sentEvents.some(([, event]) => event.type === 'error' && event.canceled === true) &&
        !registration.activeScans.has('scan_hung_parse');
    }, 'hung parse scan should emit canceled error and leave activeScans');

    const [, canceledEvent] = sentEvents.find(([, event]) => event.type === 'error' && event.canceled === true);
    assert.equal(canceledEvent.scanId, 'scan_hung_parse');
    assert.equal(canceledEvent.fatal, false);
    assert.match(canceledEvent.reason, /canceled/i);
    assert.equal(sentEvents.some(([, event]) => event.type === 'done'), false);
  });
});

test('scanLibrary times out a hung metadata parse and emits a fallback track', async () => {
  const root = createTempDir('effetune-library-hung-parse-timeout');
  writeFile(path.join(root, 'timeout.flac'), 'timeout');
  const events = [];

  const result = await runWithScanner({
    parseFile() {
      return new Promise(() => {});
    }
  }, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }],
    parseFileTimeoutMs: 5
  }, event => {
    events.push(event);
  }));

  const parseError = events.find(event => event.type === 'parse-error');
  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);

  assert.equal(result.parsed, 1);
  assert.equal(result.parseErrors, 1);
  assert.match(parseError.reason, /timed out/);
  assert.equal(track.title, 'timeout');
  assert.equal(events.some(event => event.type === 'done'), true);
});

test('scanLibrary aborts cancellable metadata parsing on timeout', async () => {
  const root = createTempDir('effetune-library-cancellable-parse-timeout');
  writeFile(path.join(root, 'timeout.mp3'), 'timeout');
  let abortSignals = 0;
  let aborts = 0;
  const events = [];

  await runWithScanner({
    parseFile(_filePath, options) {
      assert.equal(options.duration, false);
      assert.equal(options.skipCovers, true);
      assert.equal(Object.prototype.propertyIsEnumerable.call(options, 'abortSignal'), false);
      assert.ok(options.abortSignal);
      abortSignals += 1;
      return new Promise((resolve, reject) => {
        options.abortSignal.addEventListener('abort', () => {
          aborts += 1;
          reject(Object.assign(new Error('parser aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    }
  }, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }],
    parseFileTimeoutMs: 5
  }, event => {
    events.push(event);
  }));

  const parseError = events.find(event => event.type === 'parse-error');
  assert.equal(abortSignals, 1);
  assert.equal(aborts, 1);
  assert.match(parseError.reason, /timed out/);
});

test('readArtworkBytes times out a hung embedded artwork parse and falls back to folder artwork', async () => {
  const root = createTempDir('effetune-library-read-artwork-timeout');
  const audioPath = path.join(root, 'timeout.mp3');
  writeFile(audioPath, 'timeout');
  writeFile(path.join(root, 'cover.jpg'), Buffer.from([31, 32, 33]));
  let parseCalls = 0;

  await runWithScanner({
    parseFile() {
      parseCalls += 1;
      return new Promise(() => {});
    }
  }, async scanner => {
    const bytes = await scanner.readArtworkBytes(audioPath, { parseFileTimeoutMs: 5 });
    assert.deepEqual(arrayBufferBytes(bytes), [31, 32, 33]);
  });

  assert.equal(parseCalls, 1);
});

test('readArtworkBytes rejects missing audio under a linked parent without folder artwork fallback', async t => {
  const root = createTempDir('effetune-library-missing-linked-artwork');
  const outsidePath = path.join(root, 'Outside Music');
  const linkPath = path.join(root, 'linked-outside');
  const missingAudioPath = path.join(linkPath, 'missing.mp3');
  writeFile(path.join(outsidePath, 'cover.jpg'), Buffer.from([91, 92, 93]));
  if (!createDirectoryLink(outsidePath, linkPath)) {
    t.skip('directory links are not available in this environment');
    return;
  }

  let parseCalls = 0;
  await runWithScanner({
    parseFile() {
      parseCalls += 1;
      throw new Error('missing target should be rejected before metadata parsing');
    }
  }, async scanner => {
    await assert.rejects(
      scanner.readArtworkBytes(missingAudioPath),
      error => error && error.code === 'ENOENT'
    );
  });
  assert.equal(parseCalls, 0);
});

test('scanLibrary skips directory links that point outside the scan root', async t => {
  const root = createTempDir('effetune-library-link-scan');
  const outside = createTempDir('effetune-library-link-outside');
  const linkPath = path.join(root, 'linked-outside');
  writeFile(path.join(outside, 'secret.mp3'), 'secret');
  if (!createDirectoryLink(outside, linkPath)) {
    t.skip('directory links are not available in this environment');
    return;
  }

  const events = [];
  const result = await runWithScanner({}, scanner => scanner.scanLibrary({
    roots: [{ folderId: 'f_music', path: root }]
  }, event => {
    events.push(event);
  }));

  assert.equal(result.found, 0);
  assert.equal(result.parsed, 0);
  assert.equal(events.some(event => event.type === 'batch'), false);
  assert.equal(events.some(event => event.type === 'seen-files'), false);
  assert.equal(events.find(event => event.type === 'done').seenPaths, undefined);
});

test('scanLibrary reports bad roots as nonfatal when another root can be scanned', async () => {
  const root = createTempDir('effetune-library-mixed-roots');
  const goodRoot = path.join(root, 'Good');
  const missingRoot = path.join(root, 'Missing');
  writeFile(path.join(goodRoot, 'song.mp3'), 'audio');
  const events = [];

  const result = await runWithScanner({}, scanner => scanner.scanLibrary({
    roots: [
      { folderId: 'f_missing', path: missingRoot },
      { folderId: 'f_good', path: goodRoot }
    ]
  }, event => {
    events.push(event);
  }));

  const rootError = events.find(event => event.type === 'error' && event.folderId === 'f_missing');
  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(rootError.fatal, false);
  assert.equal(rootError.category, 'missing');
  assert.equal(track.folderId, 'f_good');
  assert.equal(track.relativePath, 'song.mp3');
  assert.equal(result.found, 1);
});

test('scanLibrary emits a fatal error when every root is bad', async () => {
  const root = createTempDir('effetune-library-all-bad-roots');
  const events = [];

  await runWithScanner({}, async scanner => {
    await assert.rejects(
      scanner.scanLibrary({
        roots: [{ folderId: 'f_missing', path: path.join(root, 'Missing') }]
      }, event => {
        events.push(event);
      }),
      /ENOENT|no such file|cannot find/i
    );
  });

  const fatal = events.find(event => event.type === 'error');
  assert.equal(fatal.folderId, 'f_missing');
  assert.equal(fatal.fatal, true);
});

test('readFileBytes enforces maximum byte counts before allocating buffers', async () => {
  const root = createTempDir('effetune-library-read-limit');
  const audioPath = path.join(root, 'track.mp3');
  writeFile(audioPath, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));

  await runWithScanner({}, async scanner => {
    assert.deepEqual(arrayBufferBytes(await scanner.readFileBytes(audioPath, {
      offset: 2,
      length: 3,
      maxBytes: 3
    })), [2, 3, 4]);
    await assert.rejects(
      scanner.readFileBytes(audioPath, { maxBytes: 4 }),
      /exceeds maximum read size/
    );
    await assert.rejects(
      scanner.readFileBytes(audioPath, { offset: 2, length: 5, maxBytes: 4 }),
      /exceeds maximum read size/
    );
  });
});

test('scanLibrary annotates files above the library playback read limit', async () => {
  await runWithScanner({}, async scanner => {
    const root = createTempDir('effetune-library-large-playback');
    const audioPath = path.join(root, 'large.flac');
    writeFile(audioPath, Buffer.from([7]));
    fs.truncateSync(audioPath, scanner.MAX_READ_FILE_BYTES + 1);
    const events = [];

    await scanner.scanLibrary({
      roots: [{ folderId: 'f_music', path: root }]
    }, event => {
      events.push(event);
    });

    const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
    assert.equal(track.size, scanner.MAX_READ_FILE_BYTES + 1);
    assert.match(track.libraryPlaybackUnsupportedReason, /256 MiB/);
    await assert.rejects(
      scanner.readFileBytes(audioPath),
      error => error && error.code === 'ERR_LIBRARY_READ_LIMIT' && /256 MiB/.test(error.message)
    );
    assert.deepEqual(arrayBufferBytes(await scanner.readFileBytes(audioPath, { offset: 0, length: 1 })), [7]);
  });
});

test('registerLibraryIpcHandlers wires folder, scan, read, and show channels', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-handlers');
  const selectedPath = path.join(root, 'Selected Music');
  const audioPath = path.join(selectedPath, 'track.mp3');
  const textPath = path.join(selectedPath, 'notes.txt');
  const artworkPath = path.join(selectedPath, 'cover.jpg');
  const outsidePath = path.join(root, 'outside.mp3');
  writeFile(audioPath, '0123456789');
  writeFile(textPath, 'not audio');
  writeFile(artworkPath, Buffer.from([9, 9, 9]));
  writeFile(outsidePath, 'outside');
  const canonicalAudioPath = fs.realpathSync(audioPath);

  const handlers = new Map();
  const shellCalls = [];
  const sentEvents = [];
  let cancelCalled = false;
  let resolveScanPromise;
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  const scanner = {
    createLibraryScan(request, sink) {
      assert.equal(request.scanId, 'scan_1');
      sink({ type: 'progress', parsed: 0, total: 1 });
      return {
        scanId: request.scanId,
        promise: new Promise(resolve => {
          resolveScanPromise = resolve;
        }),
        cancel() {
          cancelCalled = true;
        }
      };
    },
    async readArtworkBytes(filePath) {
      assert.equal(filePath, canonicalAudioPath);
      return toArrayBuffer(Buffer.from([1, 2, 3]));
    },
    async readFileBytes(filePath, options) {
      assert.equal(filePath, canonicalAudioPath);
      assert.deepEqual(options, { offset: 2, length: 4 });
      return toArrayBuffer(Buffer.from([2, 3, 4, 5]));
    }
  };

  registerLibraryIpcHandlers(ipcMain, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog(mainWindow, options) {
        assert.deepEqual(mainWindow, { id: 'main-window' });
        assert.deepEqual(options.properties, ['openDirectory']);
        assert.equal(options.defaultPath, root);
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: {
      showItemInFolder(filePath) {
        shellCalls.push(filePath);
      }
    },
    getMainWindow: () => ({ id: 'main-window' }),
    scanner
  });

  for (const channel of [
    'library-select-folder',
    'library-validate-roots',
    'library-scan-start',
    'library-scan-cancel',
    'library-read-artwork',
    'library-read-file-bytes',
    'library-show-in-folder',
    'library-save-folders',
    'library-load-folders'
  ]) {
    assert.equal(handlers.has(channel), true);
  }

  assert.deepEqual(await handlers.get('library-select-folder')({}), {
    canceled: false,
    path: path.resolve(selectedPath)
  });

  const validation = await handlers.get('library-validate-roots')(
    {},
    [selectedPath, path.join(selectedPath, 'missing'), root]
  );
  assert.equal(validation[0].exists, true);
  assert.equal(validation[0].readable, true);
  assert.equal(validation[0].isDirectory, true);
  assert.equal(validation[1].exists, false);
  assert.equal(validation[1].readable, false);
  assert.equal(validation[2].exists, false);
  assert.equal(validation[2].readable, false);
  assert.match(validation[2].error, /outside the selected music library folders/);

  const ipcEvent = {
    sender: {
      send(channel, payload) {
        sentEvents.push([channel, payload]);
      }
    }
  };
  assert.deepEqual(await handlers.get('library-scan-start')(ipcEvent, {
    scanId: 'scan_1',
    roots: [{ folderId: 'f_music', path: selectedPath }]
  }), { success: true, scanId: 'scan_1' });
  assert.deepEqual(sentEvents, [[
    'library-scan-event',
    { type: 'progress', parsed: 0, total: 1, scanId: 'scan_1' }
  ]]);
  const duplicateScan = await handlers.get('library-scan-start')(ipcEvent, {
    scanId: 'scan_duplicate',
    roots: [{ folderId: 'f_music', path: selectedPath }]
  });
  assert.equal(duplicateScan.success, false);
  assert.equal(duplicateScan.activeScanId, 'scan_1');
  assert.match(duplicateScan.error, /already running/);
  assert.deepEqual(await handlers.get('library-scan-cancel')({}, 'scan_1'), {
    success: true,
    scanId: 'scan_1',
    canceled: true
  });
  assert.equal(cancelCalled, true);

  assert.deepEqual(arrayBufferBytes(await handlers.get('library-read-artwork')({}, { path: audioPath })), [1, 2, 3]);
  assert.deepEqual(arrayBufferBytes(await handlers.get('library-read-file-bytes')({}, {
    path: audioPath,
    offset: 2,
    length: 4
  })), [2, 3, 4, 5]);
  await assert.rejects(
    handlers.get('library-read-file-bytes')({}, { path: textPath }),
    /requires a supported audio file/
  );
  await assert.rejects(
    handlers.get('library-read-artwork')({}, { path: textPath }),
    /requires a supported audio file/
  );
  await assert.rejects(
    handlers.get('library-read-artwork')({}, { path: artworkPath }),
    /requires a supported audio file/
  );
  assert.deepEqual(await handlers.get('library-show-in-folder')({}, audioPath), { success: true });
  assert.deepEqual(shellCalls, [canonicalAudioPath]);
  await assert.rejects(
    handlers.get('library-read-file-bytes')({}, { path: outsidePath }),
    /outside the selected music library folders/
  );
  const blockedScan = await handlers.get('library-scan-start')(ipcEvent, {
    scanId: 'scan_blocked',
    roots: [{ folderId: 'f_outside', path: root }]
  });
  assert.equal(blockedScan.success, false);
  assert.match(blockedScan.error, /outside the selected music library folders/);

  const mirrorResult = await handlers.get('library-save-folders')({}, [{
    id: 'f_music',
    kind: 'electron',
    displayName: 'Music',
    path: selectedPath,
    handle: { ignored: true },
    files: [{ ignored: true }],
    status: 'ok'
  }]);
  assert.equal(mirrorResult.success, true);
  assert.equal(mirrorResult.count, 1);
  const mirror = await handlers.get('library-load-folders')({});
  assert.equal(mirror.success, true);
  assert.equal(mirror.folders.length, 1);
  assert.equal(mirror.folders[0].path, selectedPath);
  assert.equal('handle' in mirror.folders[0], false);
  assert.equal('files' in mirror.folders[0], false);

  resolveScanPromise();
  await new Promise(resolve => setImmediate(resolve));
});

test('library-validate-roots caps input paths before validation', async () => {
  const {
    MAX_LIBRARY_SCAN_STRING_LENGTH,
    MAX_LIBRARY_VALIDATE_ROOTS,
    registerLibraryIpcHandlers
  } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-validate-cap');
  const selectedPath = path.join(root, 'Selected Music');
  writeFile(path.join(selectedPath, 'track.mp3'), 'audio');
  const handlers = new Map();

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {}
  });

  await handlers.get('library-select-folder')({});
  const validation = await handlers.get('library-validate-roots')({}, [
    'r'.repeat(MAX_LIBRARY_SCAN_STRING_LENGTH + 1),
    ...new Array(MAX_LIBRARY_VALIDATE_ROOTS + 5).fill(selectedPath)
  ]);

  assert.equal(validation.length, MAX_LIBRARY_VALIDATE_ROOTS - 1);
  assert.equal(validation.every(item => item.path === path.resolve(selectedPath)), true);
  assert.equal(validation.every(item => item.exists && item.readable && item.isDirectory), true);
});

test('library-save-folders caps input before filtering folders', async () => {
  const {
    MAX_LIBRARY_FOLDERS_MIRROR_FOLDERS,
    registerLibraryIpcHandlers
  } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-save-cap');
  const selectedPath = path.join(root, 'Selected Music');
  writeFile(path.join(selectedPath, 'track.mp3'), 'audio');
  const handlers = new Map();

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {}
  });

  await handlers.get('library-select-folder')({});
  const throwingFolder = {};
  Object.defineProperty(throwingFolder, 'path', {
    get() {
      throw new Error('folder beyond cap should not be inspected');
    }
  });
  const folders = Array.from({ length: MAX_LIBRARY_FOLDERS_MIRROR_FOLDERS }, (_, index) => ({
    id: `f_music_${index}`,
    kind: 'electron',
    displayName: `Music ${index}`,
    path: selectedPath,
    status: 'ok'
  }));
  folders.push(throwingFolder);

  const saveResult = await handlers.get('library-save-folders')({}, folders);

  assert.equal(saveResult.success, true);
  assert.equal(saveResult.count, MAX_LIBRARY_FOLDERS_MIRROR_FOLDERS);
  assert.equal(saveResult.folders.length, MAX_LIBRARY_FOLDERS_MIRROR_FOLDERS);
});

test('library-read-artwork IPC applies the parse timeout and returns folder artwork after a hung parse', async () => {
  const root = createTempDir('effetune-library-read-artwork-ipc-timeout');
  const selectedPath = path.join(root, 'Selected Music');
  const audioPath = path.join(selectedPath, 'timeout.mp3');
  writeFile(audioPath, 'timeout');
  writeFile(path.join(selectedPath, 'cover.jpg'), Buffer.from([41, 42, 43]));
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  let parseCalls = 0;

  await runWithScanner({
    parseFile() {
      parseCalls += 1;
      return new Promise(() => {});
    }
  }, async () => {
    const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
    registerLibraryIpcHandlers(ipcMain, {
      app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
      dialog: {
        async showOpenDialog() {
          return { canceled: false, filePaths: [selectedPath] };
        }
      },
      shell: { showItemInFolder() {} },
      getMainWindow: () => null
    });

    await handlers.get('library-select-folder')({});
    const bytes = await handlers.get('library-read-artwork')({}, {
      path: audioPath,
      parseFileTimeoutMs: 5
    });
    assert.deepEqual(arrayBufferBytes(bytes), [41, 42, 43]);
  });

  assert.equal(parseCalls, 1);
});

test('library-read-artwork IPC rejects over global and per-sender concurrency caps', async () => {
  const {
    MAX_LIBRARY_READ_GLOBAL_CONCURRENCY,
    MAX_LIBRARY_READ_SENDER_CONCURRENCY,
    registerLibraryIpcHandlers
  } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-artwork-concurrency');
  const selectedPath = path.join(root, 'Selected Music');
  const audioPath = path.join(selectedPath, 'track.mp3');
  writeFile(audioPath, 'audio');
  const canonicalAudioPath = fs.realpathSync(audioPath);
  const handlers = new Map();
  let pendingArtworkReads = [];
  let artworkReadCalls = 0;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      async readArtworkBytes(filePath) {
        artworkReadCalls += 1;
        assert.equal(filePath, canonicalAudioPath);
        return await new Promise(resolve => {
          pendingArtworkReads.push(() => resolve(toArrayBuffer(Buffer.from([4, 5, 6]))));
        });
      }
    }
  });

  await handlers.get('library-select-folder')({});
  const globalReads = [];
  for (let index = 0; index < MAX_LIBRARY_READ_GLOBAL_CONCURRENCY; index += 1) {
    globalReads.push(handlers.get('library-read-artwork')({ sender: { index } }, { path: audioPath }));
  }
  await waitForCondition(
    () => pendingArtworkReads.length === MAX_LIBRARY_READ_GLOBAL_CONCURRENCY,
    'global artwork reads did not start'
  );
  await assert.rejects(
    handlers.get('library-read-artwork')({ sender: { capped: true } }, { path: audioPath }),
    /Too many library artwork read requests/
  );
  pendingArtworkReads.splice(0).forEach(resolve => resolve());
  await Promise.all(globalReads);

  pendingArtworkReads = [];
  const sender = { id: 'same-sender' };
  const senderReads = [];
  for (let index = 0; index < MAX_LIBRARY_READ_SENDER_CONCURRENCY; index += 1) {
    senderReads.push(handlers.get('library-read-artwork')({ sender }, { path: audioPath }));
  }
  await waitForCondition(
    () => pendingArtworkReads.length === MAX_LIBRARY_READ_SENDER_CONCURRENCY,
    'per-sender artwork reads did not start'
  );
  await assert.rejects(
    handlers.get('library-read-artwork')({ sender }, { path: audioPath }),
    /for this window/
  );
  pendingArtworkReads.splice(0).forEach(resolve => resolve());
  await Promise.all(senderReads);
  assert.equal(artworkReadCalls, MAX_LIBRARY_READ_GLOBAL_CONCURRENCY + MAX_LIBRARY_READ_SENDER_CONCURRENCY);
});

test('library-read-file-bytes IPC rejects requests over active byte budgets', async () => {
  const {
    MAX_LIBRARY_READ_SENDER_ACTIVE_BYTES,
    registerLibraryIpcHandlers
  } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-read-byte-budget');
  const selectedPath = path.join(root, 'Selected Music');
  const audioPath = path.join(selectedPath, 'track.mp3');
  writeFile(audioPath, 'audio');
  const canonicalAudioPath = fs.realpathSync(audioPath);
  const handlers = new Map();
  const pendingReads = [];
  let readCalls = 0;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      async readFileBytes(filePath) {
        readCalls += 1;
        assert.equal(filePath, canonicalAudioPath);
        return await new Promise(resolve => {
          pendingReads.push(() => resolve(toArrayBuffer(Buffer.from([1, 2, 3]))));
        });
      }
    }
  });

  await handlers.get('library-select-folder')({});
  const sender = { id: 'byte-budget-sender' };
  const firstRead = handlers.get('library-read-file-bytes')({ sender }, {
    path: audioPath,
    maxBytes: MAX_LIBRARY_READ_SENDER_ACTIVE_BYTES
  });
  await waitForCondition(() => pendingReads.length === 1, 'first byte read did not start');

  await assert.rejects(
    handlers.get('library-read-file-bytes')({ sender }, {
      path: audioPath,
      length: 1
    }),
    /active byte budget/
  );
  pendingReads.splice(0).forEach(resolve => resolve());
  assert.deepEqual(arrayBufferBytes(await firstRead), [1, 2, 3]);
  assert.equal(readCalls, 1);
});

test('library-scan-start rejects empty roots before creating a scan', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-empty-scan');
  const handlers = new Map();
  let scanCalls = 0;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        throw new Error('dialog should not open');
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan() {
        scanCalls += 1;
        throw new Error('scan should not start');
      }
    }
  });

  const result = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_empty',
    roots: []
  });

  assert.equal(result.success, false);
  assert.equal(result.scanId, 'scan_empty');
  assert.match(result.error, /at least one root/);
  assert.equal(scanCalls, 0);
});

test('library-scan-cancel cancels a pending scan while root validation is blocked', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-pending-cancel');
  const selectedPath = path.join(root, 'Selected Music');
  writeFile(path.join(selectedPath, 'track.mp3'), 'audio');
  const handlers = new Map();
  let scanCalls = 0;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan() {
        scanCalls += 1;
        throw new Error('scan should not start after pending cancel');
      }
    }
  });

  await handlers.get('library-select-folder')({});

  const originalRealpath = fs.promises.realpath;
  let blockNextRealpath = false;
  let releaseRealpath;
  let realpathStarted;
  const realpathStartedPromise = new Promise(resolve => {
    realpathStarted = resolve;
  });
  fs.promises.realpath = async function patchedRealpath(filePath, ...args) {
    if (blockNextRealpath) {
      blockNextRealpath = false;
      realpathStarted();
      return await new Promise(resolve => {
        releaseRealpath = () => {
          resolve(path.resolve(filePath));
        };
      });
    }
    return originalRealpath.call(this, filePath, ...args);
  };

  try {
    blockNextRealpath = true;
    const startPromise = handlers.get('library-scan-start')({}, {
      scanId: 'scan_pending_cancel',
      roots: [{ folderId: 'f_music', path: selectedPath }]
    });
    await realpathStartedPromise;

    assert.deepEqual(await handlers.get('library-scan-cancel')({}, 'scan_pending_cancel'), {
      success: true,
      scanId: 'scan_pending_cancel',
      canceled: true
    });
    releaseRealpath();

    const startResult = await startPromise;
    assert.equal(startResult.success, false);
    assert.equal(startResult.scanId, 'scan_pending_cancel');
    assert.equal(startResult.canceled, true);
    assert.match(startResult.error, /canceled/);
    assert.equal(scanCalls, 0);
  } finally {
    fs.promises.realpath = originalRealpath;
    if (releaseRealpath) releaseRealpath();
  }
});

test('library-scan-start cancels a pending scan when the sender is destroyed before creation', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-pending-destroyed');
  const selectedPath = path.join(root, 'Selected Music');
  writeFile(path.join(selectedPath, 'track.mp3'), 'audio');
  const handlers = new Map();
  let scanCalls = 0;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan() {
        scanCalls += 1;
        throw new Error('scan should not start after sender destruction');
      }
    }
  });

  await handlers.get('library-select-folder')({});

  let destroyed = false;
  const destroyedListeners = [];
  const ipcEvent = {
    sender: {
      isDestroyed: () => destroyed,
      once(name, listener) {
        if (name === 'destroyed') destroyedListeners.push(listener);
      },
      removeListener(name, listener) {
        const index = destroyedListeners.indexOf(listener);
        if (index !== -1) destroyedListeners.splice(index, 1);
      },
      send() {
        throw new Error('events should not be sent after sender destruction');
      }
    }
  };

  const originalRealpath = fs.promises.realpath;
  let blockNextRealpath = false;
  let releaseRealpath;
  let realpathStarted;
  const realpathStartedPromise = new Promise(resolve => {
    realpathStarted = resolve;
  });
  fs.promises.realpath = async function patchedRealpath(filePath, ...args) {
    if (blockNextRealpath) {
      blockNextRealpath = false;
      realpathStarted();
      return await new Promise(resolve => {
        releaseRealpath = () => resolve(path.resolve(filePath));
      });
    }
    return originalRealpath.call(this, filePath, ...args);
  };

  try {
    blockNextRealpath = true;
    const startPromise = handlers.get('library-scan-start')(ipcEvent, {
      scanId: 'scan_pending_destroyed',
      roots: [{ folderId: 'f_music', path: selectedPath }]
    });
    await realpathStartedPromise;
    assert.equal(destroyedListeners.length, 1);

    destroyed = true;
    destroyedListeners[0]();
    releaseRealpath();

    const startResult = await startPromise;
    assert.equal(startResult.success, false);
    assert.equal(startResult.scanId, 'scan_pending_destroyed');
    assert.equal(startResult.canceled, true);
    assert.match(startResult.error, /canceled/);
    assert.equal(scanCalls, 0);
    assert.equal(destroyedListeners.length, 0);
  } finally {
    fs.promises.realpath = originalRealpath;
    if (releaseRealpath) releaseRealpath();
  }
});

test('library-scan-start rejects oversized scanId before creating a scan', async () => {
  const {
    MAX_LIBRARY_SCAN_ID_LENGTH,
    registerLibraryIpcHandlers
  } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-oversized-scan-id');
  const handlers = new Map();
  let scanCalls = 0;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        throw new Error('dialog should not open');
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan() {
        scanCalls += 1;
        throw new Error('scan should not start');
      }
    }
  });

  const result = await handlers.get('library-scan-start')({}, {
    scanId: 's'.repeat(MAX_LIBRARY_SCAN_ID_LENGTH + 1),
    roots: [{ folderId: 'f_music', path: root }]
  });

  assert.equal(result.success, false);
  assert.equal(result.scanId, null);
  assert.match(result.error, /scanId is too long/);
  assert.equal(scanCalls, 0);
});

test('library-scan-start rejects oversized roots before creating a scan', async () => {
  const {
    MAX_LIBRARY_SCAN_ROOTS,
    MAX_LIBRARY_SCAN_STRING_LENGTH,
    registerLibraryIpcHandlers
  } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-oversized-roots');
  const handlers = new Map();
  let scanCalls = 0;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        throw new Error('dialog should not open');
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan() {
        scanCalls += 1;
        throw new Error('scan should not start');
      }
    }
  });

  const tooManyRoots = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_too_many_roots',
    roots: new Array(MAX_LIBRARY_SCAN_ROOTS + 1)
  });
  const tooLongRootPath = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_too_long_root',
    roots: [{ folderId: 'f_music', path: 'r'.repeat(MAX_LIBRARY_SCAN_STRING_LENGTH + 1) }]
  });

  assert.equal(tooManyRoots.success, false);
  assert.equal(tooManyRoots.scanId, 'scan_too_many_roots');
  assert.match(tooManyRoots.error, /at most .* roots/);
  assert.equal(tooLongRootPath.success, false);
  assert.equal(tooLongRootPath.scanId, 'scan_too_long_root');
  assert.match(tooLongRootPath.error, /roots\[0\]\.path is too long/);
  assert.equal(scanCalls, 0);
});

test('library-scan-start rejects oversized knownFiles before creating a scan', async () => {
  const {
    MAX_LIBRARY_SCAN_KNOWN_FILES,
    MAX_LIBRARY_SCAN_STRING_LENGTH,
    registerLibraryIpcHandlers
  } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-oversized-known-files');
  const handlers = new Map();
  let scanCalls = 0;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        throw new Error('dialog should not open');
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan() {
        scanCalls += 1;
        throw new Error('scan should not start');
      }
    }
  });

  const tooManyKnownFiles = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_too_many_known',
    roots: [{ folderId: 'f_music', path: root }],
    knownFiles: new Array(MAX_LIBRARY_SCAN_KNOWN_FILES + 1)
  });
  const tooLongKnownFilePath = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_too_long_known',
    roots: [{ folderId: 'f_music', path: root }],
    knownFiles: [{
      folderId: 'f_music',
      relativePath: 'k'.repeat(MAX_LIBRARY_SCAN_STRING_LENGTH + 1)
    }]
  });

  assert.equal(tooManyKnownFiles.success, false);
  assert.equal(tooManyKnownFiles.scanId, 'scan_too_many_known');
  assert.match(tooManyKnownFiles.error, /at most .* known files/);
  assert.equal(tooLongKnownFilePath.success, false);
  assert.equal(tooLongKnownFilePath.scanId, 'scan_too_long_known');
  assert.match(tooLongKnownFilePath.error, /knownFiles\[0\]\.relativePath is too long/);
  assert.equal(scanCalls, 0);
});

test('library-scan-start forwards only allowlisted scan request payload', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-scan-allowlist');
  const selectedPath = path.join(root, 'Selected Music');
  writeFile(path.join(selectedPath, 'track.mp3'), 'audio');
  const handlers = new Map();
  let forwardedRequest = null;
  const knownMtimeMs = Date.now();

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan(request) {
        forwardedRequest = request;
        return {
          scanId: request.scanId,
          promise: Promise.resolve(),
          cancel() {}
        };
      }
    }
  });

  await handlers.get('library-select-folder')({});
  const startResult = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_allowlist',
    roots: [
      null,
      [],
      { folderId: 'missing_path' },
      { folderId: 'empty_path', path: '' },
      {
        folderId: 'f_music',
        id: 'f_music_alias',
        path: selectedPath,
        handle: { shouldNotForward: true },
        hugePayload: 'x'.repeat(1024)
      }
    ],
    folders: [{ handle: { shouldNotForward: true } }],
    knownFiles: [
      null,
      [],
      { folderId: 'f_music', relativePath: 'missing-size.mp3' },
      { folderId: 42, relativePath: 'bad-folder.mp3', size: 1, mtimeMs: 2 },
      { folderId: 'f_music', relativePath: 42, size: 1, mtimeMs: 2 },
      {
        folderId: 'f_music',
        relativePath: 'track.mp3',
        size: 5,
        mtimeMs: knownMtimeMs,
        trackId: 'track_ok',
        artworkId: 'art_ok',
        payload: { shouldNotForward: true }
      }
    ],
    batchSize: 25,
    languageHints: {
      language: 'ru',
      languagePreference: 'auto',
      browserLanguage: 'el-GR',
      browserLanguages: ['ru-RU', 42, '', 'x'.repeat(65), 'ja-JP'],
      payload: { shouldNotForward: true }
    },
    unknownLargeProperty: 'x'.repeat(4096)
  });

  assert.equal(startResult.success, true);
  assert.deepEqual(Object.keys(forwardedRequest).sort(), [
    'batchSize',
    'knownFiles',
    'languageHints',
    'roots',
    'scanId'
  ]);
  assert.deepEqual(forwardedRequest.roots, [{
    folderId: 'f_music',
    id: 'f_music_alias',
    path: path.resolve(selectedPath)
  }]);
  assert.deepEqual(forwardedRequest.knownFiles, [{
    folderId: 'f_music',
    relativePath: 'track.mp3',
    size: 5,
    mtimeMs: knownMtimeMs,
    trackId: 'track_ok',
    artworkId: 'art_ok'
  }]);
  assert.deepEqual(forwardedRequest.languageHints, {
    language: 'ru',
    languagePreference: 'auto',
    browserLanguage: 'el-GR',
    browserLanguages: ['ru-RU', 'ja-JP']
  });
});

test('library-scan-start emits nonfatal errors for blocked roots and scans allowed roots', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-mixed-allowed-roots');
  const selectedPath = path.join(root, 'Selected Music');
  const outsidePath = path.join(root, 'Outside Music');
  writeFile(path.join(selectedPath, 'track.mp3'), 'audio');
  writeFile(path.join(outsidePath, 'blocked.mp3'), 'blocked');
  const handlers = new Map();
  const sentEvents = [];
  let scanCalls = 0;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan(request) {
        scanCalls += 1;
        assert.deepEqual(request.roots.map(scanRoot => scanRoot.path), [path.resolve(selectedPath)]);
        return {
          scanId: request.scanId,
          promise: Promise.resolve(),
          cancel() {}
        };
      }
    }
  });

  await handlers.get('library-select-folder')({});
  const startResult = await handlers.get('library-scan-start')({
    sender: {
      send(channel, payload) {
        sentEvents.push([channel, payload]);
      }
    }
  }, {
    scanId: 'scan_mixed_roots',
    roots: [
      { folderId: 'f_blocked', path: outsidePath },
      { folderId: 'f_allowed', path: selectedPath }
    ]
  });

  assert.equal(startResult.success, true);
  assert.equal(scanCalls, 1);
  assert.deepEqual(sentEvents, [[
    'library-scan-event',
    {
      scanId: 'scan_mixed_roots',
      type: 'error',
      fatal: false,
      folderId: 'f_blocked',
      path: outsidePath,
      reason: 'Path is outside the selected music library folders',
      category: 'permission-denied'
    }
  ]]);
});

test('library-scan-start enforces a global active scan cap', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-scan-cap');
  const selectedPath = path.join(root, 'Selected Music');
  const firstPath = path.join(selectedPath, 'First');
  const secondPath = path.join(selectedPath, 'Second');
  const thirdPath = path.join(selectedPath, 'Third');
  fs.mkdirSync(firstPath, { recursive: true });
  fs.mkdirSync(secondPath, { recursive: true });
  fs.mkdirSync(thirdPath, { recursive: true });
  const handlers = new Map();
  const resolvers = [];
  let scanCalls = 0;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan(request) {
        scanCalls += 1;
        return {
          scanId: request.scanId,
          promise: new Promise(resolve => {
            resolvers.push(resolve);
          }),
          cancel() {}
        };
      }
    }
  });

  await handlers.get('library-select-folder')({});
  assert.equal((await handlers.get('library-scan-start')({}, {
    scanId: 'scan_first',
    roots: [{ folderId: 'f_first', path: firstPath }]
  })).success, true);
  assert.equal((await handlers.get('library-scan-start')({}, {
    scanId: 'scan_second',
    roots: [{ folderId: 'f_second', path: secondPath }]
  })).success, true);

  const capped = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_third',
    roots: [{ folderId: 'f_third', path: thirdPath }]
  });
  assert.equal(capped.success, false);
  assert.match(capped.error, /Too many library scans/);
  assert.equal(scanCalls, 2);

  resolvers.forEach(resolve => resolve());
  await new Promise(resolve => setImmediate(resolve));
});

test('library-scan-start emits a fatal event for non-cancel scanner rejections', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-fatal-scan');
  const selectedPath = path.join(root, 'Selected Music');
  writeFile(path.join(selectedPath, 'track.mp3'), 'audio');
  const handlers = new Map();
  const sentEvents = [];
  let rejectScanPromise;

  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan(request) {
        return {
          scanId: request.scanId,
          promise: new Promise((resolve, reject) => {
            rejectScanPromise = reject;
          }),
          cancel() {}
        };
      }
    }
  });

  await handlers.get('library-select-folder')({});
  const ipcEvent = {
    sender: {
      send(channel, payload) {
        sentEvents.push([channel, payload]);
      }
    }
  };

  const startResult = await handlers.get('library-scan-start')(ipcEvent, {
    scanId: 'scan_rejects',
    roots: [{ folderId: 'f_music', path: selectedPath }]
  });
  assert.equal(startResult.success, true);

  rejectScanPromise(new Error('scanner failed after start'));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(sentEvents, [[
    'library-scan-event',
    {
      scanId: 'scan_rejects',
      type: 'error',
      fatal: true,
      canceled: false,
      reason: 'scanner failed after start'
    }
  ]]);
});

test('main-owned persisted folder mirror rehydrates read and scan access', async () => {
  const {
    registerLibraryIpcHandlers,
    writeLibraryFoldersMirror
  } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-seed');
  const selectedPath = path.join(root, 'Selected Music');
  const audioPath = path.join(selectedPath, 'track.mp3');
  writeFile(audioPath, 'seeded');
  const canonicalAudioPath = fs.realpathSync(audioPath);
  await writeLibraryFoldersMirror({ getPath: () => root }, [{
    id: 'f_music',
    kind: 'electron',
    displayName: 'Music',
    path: selectedPath,
    status: 'ok'
  }]);

  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  let scanCalls = 0;
  let readCalls = 0;
  const scanner = {
    createLibraryScan(request) {
      scanCalls += 1;
      return {
        scanId: request.scanId,
        promise: Promise.resolve(),
        cancel() {}
      };
    },
    async readArtworkBytes() {
      throw new Error('artwork should not be read');
    },
    async readFileBytes(filePath) {
      readCalls += 1;
      assert.equal(filePath, canonicalAudioPath);
      return toArrayBuffer(Buffer.from([9, 8, 7]));
    }
  };

  registerLibraryIpcHandlers(ipcMain, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner
  });

  const loadedMirror = await handlers.get('library-load-folders')({});
  assert.equal(loadedMirror.success, true);
  assert.equal(loadedMirror.folders.length, 1);
  assert.equal(loadedMirror.folders[0].path, selectedPath);

  assert.deepEqual(arrayBufferBytes(await handlers.get('library-read-file-bytes')({}, {
    path: audioPath
  })), [9, 8, 7]);
  const scanResult = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_rehydrated',
    roots: [{ folderId: 'f_music', path: selectedPath }]
  });
  assert.equal(scanResult.success, true);
  const saveResult = await handlers.get('library-save-folders')({}, [{
    id: 'f_music',
    kind: 'electron',
    displayName: 'Music',
    path: selectedPath,
    status: 'ok'
  }]);
  assert.equal(saveResult.success, true);
  assert.equal(saveResult.count, 1);
  assert.equal(readCalls, 1);
  assert.equal(scanCalls, 1);
});

test('persisted mirror entries without a canonical trust marker do not widen allowed roots', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-forged-mirror');
  const selectedPath = path.join(root, 'Selected Music');
  const audioPath = path.join(selectedPath, 'track.mp3');
  writeFile(audioPath, 'forged');
  fs.writeFileSync(path.join(root, 'library-folders.json'), JSON.stringify({
    version: 2,
    updatedAt: Date.now(),
    folders: [{
      id: 'f_music',
      kind: 'electron',
      displayName: 'Music',
      path: selectedPath,
      status: 'ok'
    }]
  }));

  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  let readCalls = 0;
  let scanCalls = 0;
  const scanner = {
    createLibraryScan() {
      scanCalls += 1;
      throw new Error('scan should not start for a forged mirror');
    },
    async readFileBytes() {
      readCalls += 1;
      throw new Error('read should not be granted for a forged mirror');
    }
  };

  registerLibraryIpcHandlers(ipcMain, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        throw new Error('dialog should not open');
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner
  });

  const loadedMirror = await handlers.get('library-load-folders')({});
  assert.equal(loadedMirror.success, true);
  assert.equal(loadedMirror.folders.length, 1);
  assert.equal(loadedMirror.folders[0].status, 'needs-permission');
  await assert.rejects(
    handlers.get('library-read-file-bytes')({}, { path: audioPath }),
    /No library folder has been selected|outside the selected music library folders/
  );
  const scanResult = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_forged_mirror',
    roots: [{ folderId: 'f_music', path: selectedPath }]
  });
  assert.equal(scanResult.success, false);
  assert.match(scanResult.error, /No library folder has been selected|outside the selected music library folders/);
  assert.equal(readCalls, 0);
  assert.equal(scanCalls, 0);
});

test('persisted linked folder roots require permission after their canonical target changes', async t => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-retargeted-link');
  const originalTarget = path.join(root, 'Original Target');
  const changedTarget = path.join(root, 'Changed Target');
  const linkPath = path.join(root, 'Linked Music');
  const changedAudioPath = path.join(linkPath, 'changed.mp3');
  writeFile(path.join(originalTarget, 'original.mp3'), 'original');
  writeFile(path.join(changedTarget, 'changed.mp3'), 'changed');
  if (!createDirectoryLink(originalTarget, linkPath)) {
    t.skip('directory links are not available in this environment');
    return;
  }

  const firstHandlers = new Map();
  registerLibraryIpcHandlers({
    handle(channel, handler) {
      firstHandlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [linkPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan() {
        return {
          scanId: 'unused',
          promise: Promise.resolve(),
          cancel() {}
        };
      }
    }
  });

  await firstHandlers.get('library-select-folder')({});
  const saveResult = await firstHandlers.get('library-save-folders')({}, [{
    id: 'f_linked',
    kind: 'electron',
    displayName: 'Linked Music',
    path: linkPath,
    status: 'ok'
  }]);
  assert.equal(saveResult.success, true);
  assert.equal(saveResult.count, 1);
  assert.equal(path.resolve(saveResult.folders[0].canonicalPath), path.resolve(await fs.promises.realpath(originalTarget)));

  removeDirectoryLink(linkPath);
  if (!createDirectoryLink(changedTarget, linkPath)) {
    t.skip('directory links could not be retargeted in this environment');
    return;
  }

  const secondHandlers = new Map();
  let readCalls = 0;
  let scanCalls = 0;
  registerLibraryIpcHandlers({
    handle(channel, handler) {
      secondHandlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        throw new Error('dialog should not open');
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      createLibraryScan() {
        scanCalls += 1;
        throw new Error('scan should not start for a retargeted linked root');
      },
      async readFileBytes() {
        readCalls += 1;
        throw new Error('read should not be granted for a retargeted linked root');
      }
    }
  });

  const loadedMirror = await secondHandlers.get('library-load-folders')({});
  assert.equal(loadedMirror.success, true);
  assert.equal(loadedMirror.folders.length, 1);
  assert.equal(loadedMirror.folders[0].status, 'needs-permission');
  await assert.rejects(
    secondHandlers.get('library-read-file-bytes')({}, { path: changedAudioPath }),
    /No library folder has been selected|outside the selected music library folders/
  );
  const scanResult = await secondHandlers.get('library-scan-start')({}, {
    scanId: 'scan_retargeted_link',
    roots: [{ folderId: 'f_linked', path: linkPath }]
  });
  assert.equal(scanResult.success, false);
  assert.match(scanResult.error, /No library folder has been selected|outside the selected music library folders/);
  assert.equal(readCalls, 0);
  assert.equal(scanCalls, 0);
});

test('oversized persisted folder mirror is rejected without startup crash or trust grant', async () => {
  const {
    readLibraryFoldersMirror,
    registerLibraryIpcHandlers
  } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-oversized-mirror');
  const mirrorPath = path.join(root, 'library-folders.json');
  const audioPath = path.join(root, 'Music', 'track.mp3');
  writeFile(audioPath, 'audio');
  fs.writeFileSync(mirrorPath, Buffer.alloc(300 * 1024, 0x20));

  const mirror = await readLibraryFoldersMirror({ getPath: () => root });
  assert.equal(mirror.success, false);
  assert.deepEqual(mirror.folders, []);
  assert.match(mirror.error, /too large/i);

  const handlers = new Map();
  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        throw new Error('dialog should not open');
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {
      async readFileBytes() {
        throw new Error('read should not be granted for an oversized mirror');
      },
      createLibraryScan() {
        throw new Error('scan should not start for an oversized mirror');
      }
    }
  });

  const loadedMirror = await handlers.get('library-load-folders')({});
  assert.equal(loadedMirror.success, false);
  assert.deepEqual(loadedMirror.folders, []);
  await assert.rejects(
    handlers.get('library-read-file-bytes')({}, { path: audioPath }),
    /No library folder has been selected/
  );
});

test('library-save-folders rejects oversized mirror payload and preserves the previous mirror', async () => {
  const {
    MAX_LIBRARY_FOLDERS_MIRROR_BYTES,
    MAX_LIBRARY_FOLDERS_MIRROR_STRING_LENGTH,
    registerLibraryIpcHandlers,
    writeLibraryFoldersMirror
  } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-save-oversized-mirror');
  const selectedPath = path.join(root, 'Selected Music');
  const mirrorPath = path.join(root, 'library-folders.json');
  writeFile(path.join(selectedPath, 'track.mp3'), 'audio');

  await writeLibraryFoldersMirror({ getPath: () => root }, [{
    id: 'f_existing',
    kind: 'electron',
    displayName: 'Existing Music',
    path: selectedPath,
    status: 'ok'
  }]);
  const previousMirror = fs.readFileSync(mirrorPath, 'utf8');

  const handlers = new Map();
  registerLibraryIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  }, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {}
  });

  await handlers.get('library-select-folder')({});
  const largeName = 'x'.repeat(MAX_LIBRARY_FOLDERS_MIRROR_STRING_LENGTH);
  const folderCount = Math.ceil(MAX_LIBRARY_FOLDERS_MIRROR_BYTES / largeName.length) + 2;
  const oversizedFolders = Array.from({ length: folderCount }, (_, index) => ({
    id: `f_large_${index}`,
    kind: 'electron',
    displayName: largeName,
    path: selectedPath,
    status: 'ok'
  }));

  const saveResult = await handlers.get('library-save-folders')({}, oversizedFolders);

  assert.equal(saveResult.success, false);
  assert.equal(saveResult.code, 'ERR_LIBRARY_FOLDERS_MIRROR_TOO_LARGE');
  assert.match(saveResult.error, /too large/i);
  assert.equal(fs.readFileSync(mirrorPath, 'utf8'), previousMirror);
  const loadedMirror = await handlers.get('library-load-folders')({});
  assert.equal(loadedMirror.success, true);
  assert.equal(loadedMirror.folders.length, 1);
  assert.equal(loadedMirror.folders[0].id, 'f_existing');
});

test('library-save-folders immediately removes deleted roots from allowed paths', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-save-removes-root');
  const selectedPath = path.join(root, 'Selected Music');
  const audioPath = path.join(selectedPath, 'track.mp3');
  writeFile(audioPath, 'selected');
  const canonicalAudioPath = fs.realpathSync(audioPath);

  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  let scanCalls = 0;
  const scanner = {
    createLibraryScan(request) {
      scanCalls += 1;
      return {
        scanId: request.scanId,
        promise: Promise.resolve(),
        cancel() {}
      };
    },
    async readArtworkBytes() {
      return toArrayBuffer(Buffer.from([4, 5, 6]));
    },
    async readFileBytes(filePath) {
      assert.equal(filePath, canonicalAudioPath);
      return toArrayBuffer(Buffer.from([1, 2, 3]));
    }
  };
  const shellCalls = [];

  registerLibraryIpcHandlers(ipcMain, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: {
      showItemInFolder(filePath) {
        shellCalls.push(filePath);
      }
    },
    getMainWindow: () => null,
    scanner
  });

  await handlers.get('library-select-folder')({});
  assert.deepEqual(arrayBufferBytes(await handlers.get('library-read-file-bytes')({}, {
    path: audioPath
  })), [1, 2, 3]);

  const saveResult = await handlers.get('library-save-folders')({}, []);
  assert.equal(saveResult.success, true);
  assert.equal(saveResult.count, 0);

  await assert.rejects(
    handlers.get('library-read-artwork')({}, { path: audioPath }),
    /No library folder has been selected|outside the selected music library folders/
  );
  await assert.rejects(
    handlers.get('library-read-file-bytes')({}, { path: audioPath }),
    /No library folder has been selected|outside the selected music library folders/
  );
  await assert.rejects(
    handlers.get('library-show-in-folder')({}, audioPath),
    /No library folder has been selected|outside the selected music library folders/
  );
  const scanResult = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_removed_root',
    roots: [{ folderId: 'f_music', path: selectedPath }]
  });
  assert.equal(scanResult.success, false);
  assert.match(scanResult.error, /No library folder has been selected|outside the selected music library folders/);
  assert.equal(scanCalls, 0);
  assert.deepEqual(shellCalls, []);
});

test('library-save-folders preserves the existing mirror when no root is trusted', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-preserve');
  const mirrorPath = path.join(root, 'library-folders.json');
  fs.writeFileSync(mirrorPath, '{not valid json');

  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };

  registerLibraryIpcHandlers(ipcMain, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        throw new Error('dialog should not open');
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner: {}
  });

  const saveResult = await handlers.get('library-save-folders')({}, [{
    id: 'f_music',
    kind: 'electron',
    displayName: 'Music',
    path: path.join(root, 'Music'),
    status: 'ok'
  }]);
  assert.equal(saveResult.success, true);
  assert.equal(saveResult.skipped, true);
  assert.equal(fs.readFileSync(mirrorPath, 'utf8'), '{not valid json');
});

test('scan events are dropped and the scan is canceled when the sender is destroyed', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-destroyed');
  const selectedPath = path.join(root, 'Selected Music');
  writeFile(path.join(selectedPath, 'track.mp3'), 'audio');

  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  let cancelCalled = false;
  let rejectScanPromise;
  let scanSink;
  const scanner = {
    createLibraryScan(request, sink) {
      scanSink = sink;
      return {
        scanId: request.scanId,
        promise: new Promise((resolve, reject) => {
          rejectScanPromise = reject;
        }),
        cancel() {
          cancelCalled = true;
        }
      };
    }
  };

  registerLibraryIpcHandlers(ipcMain, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner
  });

  let destroyed = false;
  let sentCount = 0;
  const destroyedListeners = [];
  const ipcEvent = {
    sender: {
      isDestroyed: () => destroyed,
      send() {
        if (destroyed) throw new Error('Object has been destroyed');
        sentCount += 1;
      },
      once(name, listener) {
        if (name === 'destroyed') destroyedListeners.push(listener);
      },
      removeListener(name, listener) {
        const index = destroyedListeners.indexOf(listener);
        if (index !== -1) destroyedListeners.splice(index, 1);
      }
    }
  };

  await handlers.get('library-select-folder')({});
  const startResult = await handlers.get('library-scan-start')(ipcEvent, {
    scanId: 'scan_destroyed',
    roots: [{ folderId: 'f_music', path: selectedPath }]
  });
  assert.equal(startResult.success, true);
  assert.equal(destroyedListeners.length, 1);

  scanSink({ type: 'progress', parsed: 1, total: 2 });
  assert.equal(sentCount, 1);

  destroyed = true;
  destroyedListeners[0]();
  assert.equal(cancelCalled, true);

  // Events after destruction are dropped instead of throwing.
  scanSink({ type: 'progress', parsed: 2, total: 2 });
  assert.equal(sentCount, 1);

  // The rejection path must not raise an unhandled rejection via the dead sender.
  rejectScanPromise(new Error('scan failed after window closed'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(destroyedListeners.length, 0);
});

test('registerLibraryIpcHandlers rejects link traversal for read, show, and scan requests', async t => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-link-handlers');
  const selectedPath = path.join(root, 'Selected Music');
  const outsidePath = path.join(root, 'Outside Music');
  const linkPath = path.join(selectedPath, 'linked-outside');
  const linkedAudioPath = path.join(linkPath, 'secret.mp3');
  fs.mkdirSync(selectedPath, { recursive: true });
  writeFile(path.join(outsidePath, 'secret.mp3'), 'secret');
  if (!createDirectoryLink(outsidePath, linkPath)) {
    t.skip('directory links are not available in this environment');
    return;
  }

  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  const scanner = {
    createLibraryScan() {
      throw new Error('scan should not start for link traversal');
    },
    async readArtworkBytes() {
      throw new Error('artwork should not be read for link traversal');
    },
    async readFileBytes() {
      throw new Error('file bytes should not be read for link traversal');
    }
  };

  registerLibraryIpcHandlers(ipcMain, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: {
      showItemInFolder() {
        throw new Error('shell should not show link traversal');
      }
    },
    getMainWindow: () => null,
    scanner
  });

  await handlers.get('library-select-folder')({});
  await assert.rejects(
    handlers.get('library-read-artwork')({}, { path: linkedAudioPath }),
    /outside the selected music library folders/
  );
  await assert.rejects(
    handlers.get('library-read-file-bytes')({}, { path: linkedAudioPath }),
    /outside the selected music library folders/
  );
  await assert.rejects(
    handlers.get('library-show-in-folder')({}, linkedAudioPath),
    /outside the selected music library folders/
  );
  const scanResult = await handlers.get('library-scan-start')({}, {
    scanId: 'scan_linked',
    roots: [{ folderId: 'f_linked', path: linkPath }]
  });
  assert.equal(scanResult.success, false);
  assert.match(scanResult.error, /outside the selected music library folders/);
});

test('registerLibraryIpcHandlers rejects missing audio under a linked parent before scanner or shell access', async t => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-missing-link-handlers');
  const selectedPath = path.join(root, 'Selected Music');
  const outsidePath = path.join(root, 'Outside Music');
  const linkPath = path.join(selectedPath, 'linked-outside');
  const missingAudioPath = path.join(linkPath, 'missing.mp3');
  fs.mkdirSync(selectedPath, { recursive: true });
  writeFile(path.join(outsidePath, 'cover.jpg'), Buffer.from([81, 82, 83]));
  if (!createDirectoryLink(outsidePath, linkPath)) {
    t.skip('directory links are not available in this environment');
    return;
  }

  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  let artworkReadCalls = 0;
  let byteReadCalls = 0;
  let shellCalls = 0;

  registerLibraryIpcHandlers(ipcMain, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: {
      showItemInFolder() {
        shellCalls += 1;
      }
    },
    getMainWindow: () => null,
    scanner: {
      async readArtworkBytes() {
        artworkReadCalls += 1;
        throw new Error('artwork should not be read for a missing linked target');
      },
      async readFileBytes() {
        byteReadCalls += 1;
        throw new Error('file bytes should not be read for a missing linked target');
      }
    }
  });

  await handlers.get('library-select-folder')({});
  await assert.rejects(
    handlers.get('library-read-artwork')({}, { path: missingAudioPath }),
    error => error && error.code === 'ENOENT'
  );
  await assert.rejects(
    handlers.get('library-read-file-bytes')({}, { path: missingAudioPath }),
    error => error && error.code === 'ENOENT'
  );
  await assert.rejects(
    handlers.get('library-show-in-folder')({}, missingAudioPath),
    error => error && error.code === 'ENOENT'
  );
  assert.equal(artworkReadCalls, 0);
  assert.equal(byteReadCalls, 0);
  assert.equal(shellCalls, 0);
});

test('library-save-folders writes the mirror without granting path access', async () => {
  const { registerLibraryIpcHandlers } = loadFreshModule('../../electron/library-handlers.js');
  const root = createTempDir('effetune-library-save-only');
  const selectedPath = path.join(root, 'Selected Music');
  const savedOnlyPath = path.join(root, 'Saved Only');
  const savedOnlyAudioPath = path.join(savedOnlyPath, 'saved.mp3');
  writeFile(path.join(selectedPath, 'selected.mp3'), 'selected');
  writeFile(savedOnlyAudioPath, 'saved');

  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  const scanner = {
    createLibraryScan() {
      throw new Error('scan should not start');
    },
    async readArtworkBytes() {
      throw new Error('artwork should not be read');
    },
    async readFileBytes() {
      throw new Error('saved-only path should not be read');
    }
  };

  registerLibraryIpcHandlers(ipcMain, {
    app: { getPath: name => (name === 'music' || name === 'userData' ? root : '') },
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selectedPath] };
      }
    },
    shell: { showItemInFolder() {} },
    getMainWindow: () => null,
    scanner
  });

  await handlers.get('library-select-folder')({});
  const mirrorResult = await handlers.get('library-save-folders')({}, [{
    id: 'f_saved',
    kind: 'electron',
    displayName: 'Saved Only',
    path: savedOnlyPath,
    status: 'ok'
  }]);
  assert.equal(mirrorResult.success, true);
  assert.equal(mirrorResult.count, 0);
  const loadedMirror = await handlers.get('library-load-folders')({});
  assert.equal(loadedMirror.success, true);
  assert.equal(loadedMirror.folders.length, 0);
  await assert.rejects(
    handlers.get('library-read-file-bytes')({}, { path: savedOnlyAudioPath }),
    /No library folder has been selected|outside the selected music library folders/
  );
});
