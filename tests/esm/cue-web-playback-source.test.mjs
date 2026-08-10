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

test('Web play resolves a deep source ordinal before materializing the preceding queue', async () => {
  const tracks = Array.from({ length: 6 }, (_, index) => ({
    trackUid: `track-${index + 1}`,
    title: `Track ${index + 1}`,
    artist: 'Artist',
    albumArtist: 'Artist',
    album: 'Album',
    artworkId: null
  }));
  let releaseRead;
  let signalReadStarted;
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  const readStarted = new Promise(resolve => { signalReadStarted = resolve; });
  const sequenceItems = [];
  let nextId = 0;
  let ordinalReads = 0;
  const coordinator = new WebLibraryServiceCoordinator({
    idFactory: () => `id-${++nextId}`,
    repository: {
      async queryTracks() { return { rows: [] }; },
      async retainContext() { return { retained: true }; },
      async releaseRetainedContext() { return { released: true }; },
      async readContextPageAtOrdinal({ ordinal }) {
        ordinalReads += 1;
        return { rows: [tracks[ordinal]], catalogVersion: 1, pageStartOrdinal: ordinal };
      },
      async readContextPage() {
        signalReadStarted();
        await readGate;
        return { rows: tracks, catalogVersion: 1, nextCursor: null };
      },
      async createPlaybackSequence() {},
      async appendPlaybackSequenceItems({ items }) { sequenceItems.push(...items); },
      async sealPlaybackSequence() {}
    }
  });
  const receipt = await coordinator.start({
    operationKind: 'play',
    selectionDescriptor: { mode: 'all', contextToken: 'context-1', exclusions: [] },
    target: {},
    options: { currentOrdinal: 5, sourceOrdinal: 5 }
  });

  await readStarted;
  let timeoutId;
  try {
    const provisionalEntry = await Promise.race([
      coordinator.getProvisionalEntry(receipt.operationId),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Provisional entry was not resolved early')), 1_000);
      })
    ]);
    assert.equal(provisionalEntry.trackUid, 'track-6');
    assert.equal(provisionalEntry.ordinal, 5);
    assert.equal(ordinalReads, 1);
  } finally {
    clearTimeout(timeoutId);
    releaseRead();
  }

  const status = await coordinator.waitForTerminal(receipt.operationId);
  assert.equal(status.terminalKind, 'succeeded');
  assert.equal(sequenceItems[5].entryInstanceId, status.result.result.firstEntry.entryInstanceId);
  coordinator.close();
});
