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

function completion(claim, title) {
  return {
    claim,
    metadata: {
      title, artist: 'Artist', albumArtist: 'Artist', album: 'Album', genre: '',
      year: null, compilation: false, discNo: null, discTotal: null,
      trackNo: 1, trackTotal: 1, durationSec: 10, sampleRate: 48000,
      bitrate: null, bitsPerSample: 24, channels: 2, codec: 'PCM'
    },
    metadataStatus: 'ok',
    clearErrorAndRetryState: true,
    updateLastKnownGood: true,
    updateDerivedData: true,
    deferAggregateRecompute: false
  };
}

test('Web stale completion requeue never overwrites a newer active or completed CUE claim', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-cue-stale-'));
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
  }] });
  const scan = dispatchWebSqliteCommand('beginScanFolder', {
    scanId: 'scan', folderId: 'folder', normalizedRoot: '/fsa/folder',
    expectedLifecycleVersion: 0, resume: false, rootEnumerationRequired: true,
    continuityBroken: false, sweepEligibility: 'PENDING'
  });
  const base = {
    folderId: 'folder', trackUid: null, logicalStorageId: 'cue:disc.cue#1',
    lifecycleVersion: 0, generation: scan.generation, relativePath: 'album.wav',
    parserVersion: scan.parserVersion,
    signature: { fileIdentity: 'source', size: 100, mtimeMs: 10 },
    sourceKind: 'cue-track', entryKey: 'cue:disc.cue#1', cueRelativePath: 'disc.cue',
    startFrame: 0, endFrame: null, explicitRescan: false
  };
  const first = dispatchWebSqliteCommand('claimMetadataParse', {
    ...base, cueSignature: 'cue-signature-1'
  });
  const second = dispatchWebSqliteCommand('claimMetadataParse', {
    ...base, trackUid: first.claim.trackUid, cueSignature: 'cue-signature-2'
  });
  assert.equal(dispatchWebSqliteCommand(
    'completeMetadataParseSuccess', completion(first.claim, 'Stale')
  ).committed, false);
  const requeue = {
    folderId: first.claim.folderId,
    logicalStorageId: first.claim.logicalStorageId,
    relativePath: first.claim.relativePath,
    staleClaim: first.claim,
    maxItems: 1
  };
  assert.deepEqual(dispatchWebSqliteCommand('requeueLatestMetadata', requeue), { requeued: 0 });
  assert.equal(database.prepare(`
    SELECT metadata_status AS status FROM tracks WHERE track_uid = ?
  `).get(second.claim.trackUid).status, 'parsing');

  assert.equal(dispatchWebSqliteCommand(
    'completeMetadataParseSuccess', completion(second.claim, 'Current')
  ).committed, true);
  assert.deepEqual(dispatchWebSqliteCommand('requeueLatestMetadata', requeue), { requeued: 0 });
  assert.deepEqual({ ...database.prepare(`
    SELECT title, metadata_status AS status FROM tracks WHERE track_uid = ?
  `).get(second.claim.trackUid) }, { title: 'Current', status: 'ok' });
});
