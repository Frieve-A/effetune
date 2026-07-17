import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  dispatchWebSqliteCommand,
  initializeWebSqliteRuntime
} from '../../js/library/repository/web-sqlite-runtime.js';
import { normalizeSearchText } from '../../js/library/search-normalizer.js';

function insertCueTrack(database, { folderId = 'folder', trackUid, entryKey, title, startFrame }) {
  const relativePath = 'Album/Image.flac';
  const artist = 'Cue Artist';
  database.prepare(`
    INSERT INTO tracks(
      track_uid, folder_id, relative_path, source_kind, entry_key, cue_relative_path,
      start_frame, end_frame, cue_signature, file_identity, file_name, size, mtime_ms,
      title, artist, duration_sec, metadata_parser_version, added_at, updated_at,
      search_text, normalized_basename, normalized_title, normalized_artist, duration_bucket
    ) VALUES (?, ?, ?, 'cue-track', ?, 'Album/disc.cue', ?, ?, 'cue-signature',
      'cue-image', 'Image.flac', 1000, 2000, ?, ?, 10, 'test-v3', 1, 1, ?, ?, ?, ?, 10)
  `).run(
    trackUid,
    folderId,
    relativePath,
    entryKey,
    startFrame,
    startFrame + 750,
    title,
    artist,
    `${title} ${artist}`,
    normalizeSearchText('Image.flac'),
    normalizeSearchText(title),
    normalizeSearchText(artist)
  );
}

function receiveImport(playlistId) {
  return dispatchWebSqliteCommand('receiveOperation', {
    clientRequestId: `request:${playlistId}`,
    requestDigest: `digest:${playlistId}`,
    canonicalRequestVersion: 1,
    operationKind: 'previewPlaylistImport',
    target: { playlistId },
    expectedTargetVersion: 0,
    sourceContextToken: null,
    sourceSequenceIds: [],
    sourceSequenceItemCount: 0,
    buildDeadlineAt: 20_000,
    receivedAt: 10_000
  });
}

test('Web direct and durable playlist resolution keep plain and CUE candidates separate', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-cue-playlist-'));
  const database = new DatabaseSync(path.join(directory, 'catalog.sqlite'));
  let runtimeOpen = false;
  t.after(() => {
    if (runtimeOpen) dispatchWebSqliteCommand('close', {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await initializeWebSqliteRuntime(database, {
    storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
  });
  runtimeOpen = true;
  dispatchWebSqliteCommand('upsertFolders', { folders: [{
    id: 'folder', kind: 'web-fsa', displayName: 'Music', path: '/fsa/folder',
    status: 'ok', scanGeneration: 0, lifecycleVersion: 0, addedAt: 1, lastScanAt: null
  }, {
    id: 'folder-other', kind: 'web-fsa', displayName: 'Other', path: '/fsa/other',
    status: 'ok', scanGeneration: 0, lifecycleVersion: 0, addedAt: 2, lastScanAt: null
  }] });
  insertCueTrack(database, {
    trackUid: 'cue-first', entryKey: 'cue:Album/disc.cue#1', title: 'First Cue', startFrame: 0
  });
  insertCueTrack(database, {
    trackUid: 'cue-second', entryKey: 'cue:Album/disc.cue#2', title: 'Second Cue', startFrame: 750
  });
  insertCueTrack(database, {
    folderId: 'folder-other', trackUid: 'cue-second-other',
    entryKey: 'cue:Album/disc.cue#2', title: 'Second Cue', startFrame: 750
  });
  dispatchWebSqliteCommand('createPlaylistWithItems', {
    playlistId: 'cue-source-removal', name: 'CUE source removal', createdAt: 9_999,
    items: [{ trackUid: 'cue-second-other' }]
  });

  const directPlaylistId = 'direct-plain';
  const directOperation = receiveImport(directPlaylistId);
  dispatchWebSqliteCommand('createPlaylist', {
    playlistId: directPlaylistId, name: 'Direct plain',
    operationId: directOperation.operationId, createdAt: 10_000
  });
  dispatchWebSqliteCommand('appendPlaylistImportRecords', {
    origin: null, playlistId: directPlaylistId, operationId: directOperation.operationId,
    records: [{ type: 'entry', entry: { path: 'Album/Image.flac' } }]
  });
  const direct = dispatchWebSqliteCommand('finalizePlaylistImportPage', {
    playlistId: directPlaylistId, operationId: directOperation.operationId,
    afterPosition: 0, limit: 10
  });
  assert.equal(direct.resolvedCount, 0);
  assert.equal(direct.keptCount, 1);

  dispatchWebSqliteCommand('createPlaylistWithItems', {
    playlistId: 'cue-provenance', name: 'CUE provenance', createdAt: 10_001,
    items: [
      { unresolved: {
        sourceKind: 'cue-track', entryKey: 'cue:Album/disc.cue#2',
        cueProvenance: { folderId: 'folder', entryKey: 'cue:Album/disc.cue#2' },
        basename: 'Image.flac', title: 'Second Cue', artist: 'Cue Artist', durationSec: 10
      } },
      { unresolved: {
        sourceKind: 'cue-track', entryKey: 'cue:Old/disc.cue#9',
        cueProvenance: { entryKey: 'cue:Old/disc.cue#9' },
        basename: 'Image.flac', title: 'First Cue', artist: 'Cue Artist', durationSec: 10
      } },
      { unresolved: {
        sourceKind: 'cue-track', entryKey: 'cue:Album/disc.cue#1',
        cueProvenance: { folderId: 'folder-before-reregistration', entryKey: 'cue:Album/disc.cue#1' },
        basename: 'Image.flac', title: 'First Cue', artist: 'Cue Artist', durationSec: 10
      } },
      { unresolved: {
        sourceLine: 'Album/Image.flac', relativePathHint: 'Album/Image.flac',
        basename: 'Image.flac', title: 'First Cue', artist: 'Cue Artist', durationSec: 10
      } }
    ]
  });
  const scan = dispatchWebSqliteCommand('beginScanFolder', {
    scanId: 'cue-playlist-scan', folderId: 'folder', normalizedRoot: '/fsa/folder',
    expectedLifecycleVersion: 0, resume: false, rootEnumerationRequired: true,
    continuityBroken: false, sweepEligibility: 'INELIGIBLE'
  });
  dispatchWebSqliteCommand('completeScanFolderNoSweep', {
    scanId: 'cue-playlist-scan', folderId: 'folder', generation: scan.generation,
    expectedLifecycleVersion: 0, status: 'completed-no-sweep', sweepBlockReason: 'test-no-sweep'
  });

  let rows;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    rows = database.prepare(`
      SELECT track_uid AS trackUid, unresolved_json AS unresolvedJson
      FROM playlist_items WHERE playlist_id = 'cue-provenance' ORDER BY position
    `).all();
    if (rows[0].trackUid && rows[1].trackUid && rows[2].trackUid) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(rows[0].trackUid, 'cue-second');
  assert.equal(rows[1].trackUid, 'cue-first');
  assert.equal(rows[2].trackUid, 'cue-first');
  assert.equal(rows[3].trackUid, null);
  assert.equal(JSON.parse(rows[3].unresolvedJson).basename, 'Image.flac');

  const storage = dispatchWebSqliteCommand('getTrackStorageIdentity', { trackUid: 'cue-first' });
  assert.equal(storage.durationSec, 10);

  assert.deepEqual(dispatchWebSqliteCommand('removeScanFolder', {
    folderId: 'folder-other', expectedLifecycleVersion: 0
  }), {
    folderId: 'folder-other', lifecycleVersion: 1, deleted: 1, hasMore: false
  });
  const removed = dispatchWebSqliteCommand('queryPlaylistItems', {
    playlistId: 'cue-source-removal', afterPosition: null, limit: 10
  });
  assert.equal(removed.items[0].trackUid, null);
  assert.equal(removed.items[0].unresolved.reason, 'source-removed');
  assert.deepEqual(removed.items[0].unresolved.cueProvenance, {
    folderId: 'folder-other',
    entryKey: 'cue:Album/disc.cue#2',
    cueRelativePath: 'Album/disc.cue',
    relativePath: 'Album/Image.flac',
    startFrame: 750,
    endFrame: 1500
  });
});
