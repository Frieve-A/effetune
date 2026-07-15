'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MetadataWorkerPool } = require('../../electron/library-metadata-worker-pool.cjs');
const { validateParseMessage } = require('../../electron/library-metadata-worker.cjs');

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
  const info = Buffer.concat([
    Buffer.from('INFO', 'ascii'),
    ...tags.map(tag => createChunk(tag.id, tag.data))
  ]);
  const chunks = [
    createChunk('fmt ', fmt),
    createChunk('data', Buffer.alloc(4)),
    createChunk('LIST', info)
  ];
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(4 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  header.write('WAVE', 8, 4, 'ascii');
  return Buffer.concat([header, ...chunks]);
}

test('metadata workers reject invalid path requests', async () => {
  assert.throws(() => validateParseMessage({
    type: 'parse', requestId: 1, filePath: 'relative.wav', relativePath: 'relative.wav',
    skipCovers: true, languageHints: null
  }), error => error?.code === 'invalidMetadataRequest');

  const pool = new MetadataWorkerPool({ workerCount: 2 });
  await assert.rejects(pool.parse({
    path: 'relative.wav', relativePath: 'relative.wav', skipCovers: true
  }), error => error?.code === 'invalidMetadataRequest');
  await pool.close();
});

test('Electron catalog metadata worker restores v2 CP932 RIFF INFO decoding', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-metadata-worker-'));
  const filePath = path.join(temporary, 'Mona Lisa.wav');
  await fs.writeFile(filePath, createRiffInfoWave([
    { id: 'INAM', data: Buffer.from('MONA LISA\0', 'ascii') },
    { id: 'IART', data: Buffer.from('95bd89ea837d838a834a00', 'hex') }
  ]));
  const pool = new MetadataWorkerPool({ workerCount: 2, timeoutMs: 10_000 });
  t.after(async () => {
    await pool.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const result = await pool.parse({
    path: filePath,
    relativePath: '平賀マリカ/Mona Lisa.wav',
    skipCovers: true,
    languageHints: { language: 'ja', browserLanguage: 'ja-JP' }
  });

  assert.equal(result.title, 'MONA LISA');
  assert.equal(result.artist, '平賀マリカ');
  assert.equal(result.albumArtist, '平賀マリカ');
});

test('Electron catalog metadata worker maps alternate RIFF INFO identifiers', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-metadata-worker-alternate-riff-'));
  const filePath = path.join(temporary, 'alternate.wav');
  await fs.writeFile(filePath, createRiffInfoWave([
    { id: 'TITL', data: Buffer.from('Alternate Title\0', 'ascii') },
    { id: 'IART', data: Buffer.from('Alternate Artist\0', 'ascii') },
    { id: 'IRPD', data: Buffer.from('Alternate Album\0', 'ascii') },
    { id: 'ICRD', data: Buffer.from('2021-04-03\0', 'ascii') }
  ]));
  const pool = new MetadataWorkerPool({ workerCount: 2, timeoutMs: 10_000 });
  t.after(async () => {
    await pool.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const result = await pool.parse({
    path: filePath,
    relativePath: 'alternate.wav',
    skipCovers: true
  });

  assert.equal(result.title, 'Alternate Title');
  assert.equal(result.artist, 'Alternate Artist');
  assert.equal(result.albumArtist, 'Alternate Artist');
  assert.equal(result.album, 'Alternate Album');
  assert.equal(result.year, 2021);
});
