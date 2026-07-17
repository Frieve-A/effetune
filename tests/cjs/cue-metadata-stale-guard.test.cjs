'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');

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

test('CUE metadata completion requires logical identity and the current cue signature', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-cue-stale-'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
  t.after(async () => {
    await host.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  await host.upsertFolders([{
    id: 'folder', kind: 'electron', displayName: 'Music', path: directory,
    status: 'ok', lifecycleVersion: 0
  }]);
  await host.beginScanFolder({
    scanId: 'scan', folderId: 'folder', normalizedRoot: directory,
    expectedLifecycleVersion: 0, resume: false, rootEnumerationRequired: true,
    continuityBroken: false, sweepEligibility: 'PENDING'
  });
  const base = {
    folderId: 'folder', trackUid: null, logicalStorageId: 'cue:disc.cue#1',
    lifecycleVersion: 0, generation: 1, relativePath: 'album.wav',
    parserVersion: 'cue-test-v3', signature: { fileIdentity: 'source', size: 100, mtimeMs: 10 },
    sourceKind: 'cue-track', entryKey: 'cue:disc.cue#1', cueRelativePath: 'disc.cue',
    startFrame: 0, endFrame: null, explicitRescan: false
  };
  const first = await host.claimMetadataParse({ ...base, cueSignature: 'cue-signature-1' });
  assert.ok(first.claim);
  const second = await host.claimMetadataParse({
    ...base,
    trackUid: first.claim.trackUid,
    cueSignature: 'cue-signature-2'
  });
  assert.ok(second.claim);
  assert.equal((await host.completeMetadataParseSuccess(completion(first.claim, 'Stale'))).committed, false);
  assert.deepEqual(await host.requeueLatestMetadata({
    folderId: first.claim.folderId,
    logicalStorageId: first.claim.logicalStorageId,
    relativePath: first.claim.relativePath,
    staleClaim: first.claim,
    maxItems: 1
  }), { requeued: 0 });
  assert.equal((await host.getTrack(second.claim.trackUid)).metadataStatus, 'parsing');
  assert.equal((await host.completeMetadataParseSuccess(completion(second.claim, 'Current'))).committed, true);
  assert.deepEqual(await host.requeueLatestMetadata({
    folderId: first.claim.folderId,
    logicalStorageId: first.claim.logicalStorageId,
    relativePath: first.claim.relativePath,
    staleClaim: first.claim,
    maxItems: 1
  }), { requeued: 0 });
  const track = await host.getTrack(second.claim.trackUid);
  assert.equal(track.title, 'Current');
  assert.equal(track.metadataStatus, 'ok');
  assert.equal(track.sourceKind, 'cue-track');
  assert.equal(track.entryKey, 'cue:disc.cue#1');
  assert.equal(track.cueRelativePath, 'disc.cue');
});
