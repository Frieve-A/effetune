'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new TypeError(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (name === 'help' || name === 'json') {
      args[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError(`Missing value for --${name}`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return [
    'Usage: node tools/library-scale/benchmark-electron-sqlite.cjs [options]',
    '  --size <rows>          row count (safe default: 10000)',
    '  --preset <name>        million or boundary',
    '  --batch-size <rows>    transaction batch size (default: 1000)',
    '  --seed <uint32>        deterministic fixture seed',
    '  --database <path>      new database path (default: in-memory)',
    '  --json                 print JSON',
    '',
    'Run this entry point with the Electron-bundled Node runtime for release evidence.'
  ].join('\n');
}

async function run(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  const sqlite = require('node:sqlite');
  const fixtureUrl = pathToFileURL(path.join(__dirname, 'catalog-fixture.mjs')).href;
  const fixture = await import(fixtureUrl);
  const count = fixture.resolveScaleSize({ size: args.size, preset: args.preset });
  const batchSize = args['batch-size'] === undefined
    ? fixture.DEFAULT_BATCH_SIZE
    : Number(args['batch-size']);
  const seed = args.seed === undefined ? fixture.DEFAULT_FIXTURE_SEED : Number(args.seed);
  const databasePath = args.database ? path.resolve(args.database) : ':memory:';
  if (databasePath !== ':memory:' && fs.existsSync(databasePath)) {
    throw new Error(`Refusing to overwrite existing database: ${databasePath}`);
  }

  const database = new sqlite.DatabaseSync(databasePath);
  const startedAt = process.hrtime.bigint();
  try {
    database.exec('PRAGMA foreign_keys=ON');
    if (databasePath !== ':memory:') database.exec('PRAGMA journal_mode=WAL');
    database.exec(`
      CREATE TABLE tracks(
        track_uid TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album_artist TEXT NOT NULL,
        album TEXT NOT NULL,
        genre TEXT NOT NULL,
        duration_sec REAL NOT NULL,
        UNIQUE(folder_id, relative_path)
      );
      CREATE INDEX tracks_by_title ON tracks(title, track_uid);
      CREATE INDEX tracks_by_artist_album ON tracks(album_artist, album, track_uid);
    `);
    const insert = database.prepare(`
      INSERT INTO tracks(
        track_uid, folder_id, relative_path, file_name, title,
        artist, album_artist, album, genre, duration_sec
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const batch of fixture.catalogBatches({ count, seed, batchSize })) {
      database.exec('BEGIN IMMEDIATE');
      try {
        for (const track of batch) {
          insert.run(
            track.trackUid,
            track.folderId,
            track.relativePath,
            track.fileName,
            track.title,
            track.artist,
            track.albumArtist,
            track.album,
            track.genre,
            track.durationSec
          );
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
    const total = database.prepare('SELECT COUNT(*) AS count FROM tracks').get().count;
    const first = database.prepare(
      'SELECT track_uid FROM tracks ORDER BY title, track_uid LIMIT 1'
    ).get();
    const middle = database.prepare(
      'SELECT track_uid FROM tracks ORDER BY title, track_uid LIMIT 1 OFFSET ?'
    ).get(Math.floor(count / 2));
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const result = {
      runtime: process.versions.electron ? 'electron-node' : 'node',
      nodeVersion: process.versions.node,
      sqliteVersion: database.prepare('SELECT sqlite_version() AS version').get().version,
      databasePath,
      count: Number(total),
      batchSize,
      firstTrackUid: first.track_uid,
      middleTrackUid: middle.track_uid,
      elapsedMs
    };
    io.log(args.json ? JSON.stringify(result, null, 2) : Object.entries(result)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'));
    return result;
  } finally {
    database.close();
  }
}

if (require.main === module) {
  run().catch(error => {
    console.error(`SQLite benchmark failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { run };
