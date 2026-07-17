import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  MUSIC_LIBRARY_SCHEMA_VERSION as V2_VERSION,
  MUSIC_LIBRARY_V2_WEB_DATABASE,
  MUSIC_LIBRARY_V2_WEB_OPFS_DIRECTORY
} from '../../js/library/repository/schema-v2.js';
import {
  MUSIC_LIBRARY_SCHEMA_VERSION,
  MUSIC_LIBRARY_V3_WEB_DATABASE,
  MUSIC_LIBRARY_V3_WEB_OPFS_DIRECTORY,
  getMusicLibraryV3InitializationSql
} from '../../js/library/repository/schema-v3.js';

test('schema v3 uses independent persistent names while schema v2 remains unchanged', () => {
  assert.equal(V2_VERSION, 2);
  assert.equal(MUSIC_LIBRARY_V2_WEB_DATABASE, 'catalog-v2.sqlite3');
  assert.equal(MUSIC_LIBRARY_V2_WEB_OPFS_DIRECTORY, 'effetune-music-library-sqlite-v2');
  assert.equal(MUSIC_LIBRARY_SCHEMA_VERSION, 3);
  assert.equal(MUSIC_LIBRARY_V3_WEB_DATABASE, 'catalog-v3.sqlite3');
  assert.equal(MUSIC_LIBRARY_V3_WEB_OPFS_DIRECTORY, 'effetune-music-library-sqlite-v3');
});

test('schema v3 enforces plain and CUE relational identity checks', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(getMusicLibraryV3InitializationSql({ includePragmas: false }));
    database.prepare(`
      INSERT INTO folders(id, kind, display_name, status, added_at)
      VALUES ('folder', 'web-fsa', 'Folder', 'ok', 1)
    `).run();
    const insert = database.prepare(`
      INSERT INTO tracks(
        track_uid, folder_id, relative_path, source_kind, entry_key, cue_relative_path,
        start_frame, end_frame, cue_signature, file_name, title, metadata_parser_version,
        added_at, updated_at, search_text
      ) VALUES (?, 'folder', 'album.wav', ?, ?, ?, ?, ?, ?, 'album.wav', ?, 'v3', 1, 1, ?)
    `);
    insert.run('plain', 'file', null, null, null, null, null, 'Album', 'album');
    assert.throws(() => insert.run('plain-duplicate', 'file', null, null, null, null, null, 'Duplicate', 'duplicate'));
    insert.run('cue-1', 'cue-track', 'cue:disc.cue#1', 'disc.cue', 0, 750, 'sig', 'One', 'one');
    insert.run('cue-2', 'cue-track', 'cue:disc.cue#2', 'disc.cue', 750, null, 'sig', 'Two', 'two');
    assert.throws(() => insert.run(
      'cue-duplicate', 'cue-track', 'cue:disc.cue#1', 'disc.cue', 0, 10, 'sig', 'Duplicate', 'duplicate'
    ));
    assert.throws(() => insert.run(
      'cue-bad-range', 'cue-track', 'cue:disc.cue#3', 'disc.cue', 10, 10, 'sig', 'Bad', 'bad'
    ));
    assert.throws(() => insert.run(
      'plain-with-cue-data', 'file', 'cue:disc.cue#3', null, null, null, null, 'Bad', 'bad'
    ));
    assert.equal(database.prepare('SELECT count(*) AS count FROM tracks').get().count, 3);
  } finally {
    database.close();
  }
});

test('scan_logical_seen keys generations by logical storage identity', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(getMusicLibraryV3InitializationSql({ includePragmas: false }));
    database.prepare(`
      INSERT INTO folders(id, kind, display_name, status, added_at)
      VALUES ('folder', 'web-fsa', 'Folder', 'ok', 1)
    `).run();
    database.prepare(`INSERT INTO scan_runs(id, status, started_at) VALUES ('scan', 'running', 1)`).run();
    database.prepare(`
      INSERT INTO scan_run_folders(
        scan_id, folder_id, generation, expected_lifecycle_version, status
      ) VALUES ('scan', 'folder', 1, 0, 'enumerating')
    `).run();
    const insert = database.prepare(`
      INSERT INTO scan_logical_seen(
        scan_id, folder_id, logical_storage_id, relative_path, observation_sequence,
        source_kind, entry_key, cue_relative_path, start_frame, end_frame, cue_signature, metadata_json
      ) VALUES ('scan', 'folder', ?, 'album.wav', ?, 'cue-track', ?, 'disc.cue', ?, ?, 'sig', '{}')
    `);
    insert.run('cue:disc.cue#1', 0, 'cue:disc.cue#1', 0, 10);
    insert.run('cue:disc.cue#2', 1, 'cue:disc.cue#2', 10, null);
    assert.throws(() => insert.run('cue:disc.cue#1', 2, 'cue:disc.cue#1', 20, null));
  } finally {
    database.close();
  }
});

test('Electron and Web expose the same bounded CUE staging actions', async () => {
  const [electron, web, host, repository] = await Promise.all([
    readFile(new URL('../../electron/library-catalog-worker.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../../electron/library-catalog-host.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../../js/library/repository/web-catalog-repository.js', import.meta.url), 'utf8')
  ]);
  const actions = [
    'reset', 'clear', 'append-entries', 'list-files', 'get-file', 'update-observations',
    'resolve-references', 'stage-sheet', 'list-sources', 'update-source',
    'list-sheets', 'get-source-metadata', 'validate-sheet', 'accept-sheet', 'list-logical'
  ];
  for (const action of actions) {
    assert.match(electron, new RegExp(`case '${action}'`));
    assert.match(web, new RegExp(`case '${action}'`));
  }
  assert.doesNotMatch(electron, /case 'reconcile-logical'/);
  assert.doesNotMatch(web, /case 'reconcile-logical'/);
  assert.match(host, /cueDirectoryStage\(options\)/);
  assert.match(repository, /cueDirectoryStage\(request\)/);
});
