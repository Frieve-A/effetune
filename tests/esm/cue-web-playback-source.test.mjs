import assert from 'node:assert/strict';
import test from 'node:test';

import { WebLibraryServiceCoordinator } from '../../js/library/operations/web-library-service-coordinator.js';

function createCoordinator(track, { sequenceEntry = null } = {}) {
  const file = { name: track.relativePath };
  const repository = {
    async queryTracks() { return { rows: [] }; },
    async queryPlaybackSequence() {
      return { items: sequenceEntry ? [sequenceEntry] : [] };
    },
    async getTrackStorageIdentity(trackUid) {
      assert.equal(trackUid, track.trackUid);
      return track;
    }
  };
  const coordinator = new WebLibraryServiceCoordinator({
    repository,
    sourceProvider: {
      async resolveTrackFile(storageIdentity) {
        assert.equal(storageIdentity, track);
        return file;
      }
    }
  });
  return { coordinator, file };
}

test('Web playback source preserves the plain-file storage descriptor', async () => {
  const track = {
    trackUid: 'track-plain',
    folderId: 'folder-1',
    relativePath: 'Album/Plain.flac',
    sourceKind: 'file',
    entryKey: null,
    cueRelativePath: null,
    startFrame: null,
    endFrame: null,
    durationSec: 183.5,
    physicalSourceKey: 'folder-1\0Album/Plain.flac'
  };
  const { coordinator, file } = createCoordinator(track);

  const source = await coordinator.resolveSequenceEntrySource({ trackUid: track.trackUid });

  assert.deepEqual(source, {
    kind: 'file',
    sequenceId: null,
    ordinal: null,
    entryInstanceId: null,
    trackUid: track.trackUid,
    sourceKind: 'file',
    entryKey: null,
    cueRelativePath: null,
    startFrame: null,
    endFrame: null,
    durationSec: track.durationSec,
    physicalSourceKey: track.physicalSourceKey,
    file
  });
});

test('Web playback source preserves the CUE descriptor including zero and null bounds', async () => {
  const track = {
    trackUid: 'track-cue-1',
    folderId: 'folder-1',
    relativePath: 'Album/Image.flac',
    sourceKind: 'cue-track',
    entryKey: 'cue:Album/Disc.cue#01',
    cueRelativePath: 'Album/Disc.cue',
    startFrame: 0,
    endFrame: null,
    durationSec: 42.5,
    physicalSourceKey: 'folder-1\0Album/Image.flac'
  };
  const sequenceEntry = {
    ordinal: 4,
    entryInstanceId: 'entry-cue-1',
    trackUid: track.trackUid
  };
  const { coordinator, file } = createCoordinator(track, { sequenceEntry });

  const source = await coordinator.resolveSequenceEntrySource({
    sequenceId: 'sequence-1',
    ordinal: sequenceEntry.ordinal,
    entryInstanceId: sequenceEntry.entryInstanceId
  });

  assert.deepEqual(source, {
    kind: 'file',
    sequenceId: 'sequence-1',
    ordinal: 4,
    entryInstanceId: sequenceEntry.entryInstanceId,
    trackUid: track.trackUid,
    sourceKind: 'cue-track',
    entryKey: track.entryKey,
    cueRelativePath: track.cueRelativePath,
    startFrame: 0,
    endFrame: null,
    durationSec: track.durationSec,
    physicalSourceKey: track.physicalSourceKey,
    file
  });
});
