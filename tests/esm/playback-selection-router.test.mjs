import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWebPlaybackSelection } from '../../js/ui/playback-selection-router.js';

class SelectionFile {
  constructor(name, contents, { size = null, lastModified = 1, forbidRead = false } = {}) {
    this.name = name;
    this.contents = new TextEncoder().encode(contents);
    this.size = size ?? this.contents.byteLength;
    this.lastModified = lastModified;
    this.forbidRead = forbidRead;
    this.readCount = 0;
  }

  async arrayBuffer() {
    this.readCount += 1;
    if (this.forbidRead) throw new Error('audio bytes must stay lazy');
    return this.contents.slice().buffer;
  }
}

function cueFile(source = 'album.wav') {
  return new SelectionFile('album.cue', [
    'PERFORMER "Album Artist"',
    'TITLE "Album Title"',
    `FILE "${source}" WAVE`,
    '  TRACK 01 AUDIO',
    '    TITLE "First"',
    '    INDEX 01 00:00:00',
    '  TRACK 02 AUDIO',
    '    TITLE "Second"',
    '    INDEX 01 00:10:00'
  ].join('\n'));
}

test('normal Web selection preserves the existing File inputs without reading them', async () => {
  const first = new SelectionFile('first.mp3', 'one', { forbidRead: true });
  const second = new SelectionFile('second.flac', 'two', { forbidRead: true });

  const selection = await resolveWebPlaybackSelection([first, second]);

  assert.equal(selection.kind, 'normal');
  assert.deepEqual(selection.tracks, [first, second]);
  assert.equal(first.readCount, 0);
  assert.equal(second.readCount, 0);
});

test('Web direct CUE returns logical tracks with request-scoped physical ownership and lazy 2 GB audio', async () => {
  const cue = cueFile();
  const album = new SelectionFile('album.wav', '', {
    size: 2 * 1024 * 1024 * 1024,
    forbidRead: true
  });
  const metadataCalls = [];
  const selection = await resolveWebPlaybackSelection([cue, album], {
    requestKey: 'request-7',
    metadataParserFactory: filesystem => ({
      async parse({ relativePath }) {
        metadataCalls.push(relativePath);
        assert.equal(await filesystem.getFile(relativePath), album);
        return { durationSec: 20, sampleRate: 96000, channels: 2, codec: 'PCM' };
      }
    })
  });

  assert.equal(selection.kind, 'cue');
  assert.deepEqual(metadataCalls, ['album.wav']);
  assert.equal(cue.readCount, 1);
  assert.equal(album.readCount, 0);
  assert.deepEqual(selection.tracks.map(track => ({
    file: track.file,
    byteLength: track.byteLength,
    title: track.meta.title,
    startFrame: track.startFrame,
    endFrame: track.endFrame,
    durationSec: track.durationSec,
    physicalSourceKey: track.physicalSourceKey
  })), [
    {
      file: album,
      byteLength: album.size,
      title: 'First',
      startFrame: 0,
      endFrame: 750,
      durationSec: 10,
      physicalSourceKey: 'request-7:0'
    },
    {
      file: album,
      byteLength: album.size,
      title: 'Second',
      startFrame: 750,
      endFrame: null,
      durationSec: 10,
      physicalSourceKey: 'request-7:0'
    }
  ]);
});

test('Web direct CUE resolves referenced audio when only the CUE file was selected', async () => {
  const cue = cueFile();
  const album = new SelectionFile('album.wav', '', { size: 100, forbidRead: true });
  const providerCalls = [];
  const selection = await resolveWebPlaybackSelection([cue], {
    cueSourceProvider: async request => {
      providerCalls.push(request);
      return [album];
    },
    metadataParserFactory: filesystem => ({
      async parse({ relativePath }) {
        assert.equal(await filesystem.getFile(relativePath), album);
        return { durationSec: 20 };
      }
    })
  });

  assert.equal(selection.kind, 'cue');
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].cueFile, cue);
  assert.equal(providerCalls[0].parsedCue.ok, true);
  assert.deepEqual(selection.tracks.map(track => track.file), [album, album]);
});

test('Web direct CUE accepts selected sibling artwork without reading audio bytes', async () => {
  const cue = cueFile();
  const album = new SelectionFile('album.wav', '', { size: 100, forbidRead: true });
  const cover = new SelectionFile('COVER.PNG', 'selected-cover');
  const selection = await resolveWebPlaybackSelection([cue, album, cover], {
    metadataParserFactory: () => ({ async parse() { return { durationSec: 20 }; } })
  });

  assert.equal(album.readCount, 0);
  assert.equal(cover.readCount, 1);
  assert.equal(selection.tracks[0].meta.picture.format, 'image/png');
  assert.equal(new TextDecoder().decode(selection.tracks[0].meta.picture.data), 'selected-cover');
  assert.equal(selection.tracks[0].meta.picture, selection.tracks[1].meta.picture);
});

test('Web direct CUE atomically rejects missing, extra, multiple, and oversized selections', async () => {
  const cue = cueFile();
  const album = new SelectionFile('album.wav', '', { forbidRead: true });
  const extra = new SelectionFile('extra.flac', '', { forbidRead: true });
  const duplicateCue = new SelectionFile('other.cue', 'FILE "album.wav" WAVE');
  const oversizedCue = cueFile();
  oversizedCue.size = 1024 * 1024 + 1;
  const unrelatedImage = new SelectionFile('poster.jpg', 'image');
  const metadataParserFactory = () => ({ async parse() { return { durationSec: 20 }; } });

  await assert.rejects(
    resolveWebPlaybackSelection([cue], { metadataParserFactory }),
    error => error?.code === 'cueSelectionSourceAccessRequired' &&
      error?.diagnosticCode === 'cue-no-accessible-audio-files'
  );
  await assert.rejects(
    resolveWebPlaybackSelection([cue, album, extra], { metadataParserFactory }),
    error => error?.code === 'cueSelectionMixed'
  );
  await assert.rejects(
    resolveWebPlaybackSelection([cue, duplicateCue, album], { metadataParserFactory }),
    error => error?.code === 'cueSelectionMixed'
  );
  await assert.rejects(
    resolveWebPlaybackSelection([oversizedCue, album], { metadataParserFactory }),
    error => error?.code === 'cueSelectionTooLarge' && error?.diagnosticCode === 'cue-too-large'
  );
  await assert.rejects(
    resolveWebPlaybackSelection([cue, album, unrelatedImage], { metadataParserFactory }),
    error => error?.code === 'cueSelectionMixed'
  );
});

test('Web direct CUE preserves parser, reference, and duration failure reasons', async () => {
  const album = new SelectionFile('album.wav', '', { forbidRead: true });
  const invalidCue = new SelectionFile('album.cue', 'not a cue sheet');

  await assert.rejects(
    resolveWebPlaybackSelection([invalidCue, album]),
    error => error?.code === 'cueSelectionInvalid' &&
      error?.diagnosticCode === 'cue-unsupported-command'
  );
  await assert.rejects(
    resolveWebPlaybackSelection([cueFile('missing.wav'), album]),
    error => error?.code === 'cueSelectionInvalid' &&
      error?.diagnosticCode === 'cue-missing-reference'
  );
  await assert.rejects(
    resolveWebPlaybackSelection([cueFile(), album], {
      metadataParserFactory: () => ({ async parse() { return { durationSec: null }; } })
    }),
    error => error?.code === 'cueSelectionInvalid' &&
      error?.diagnosticCode === 'cue-source-duration-unavailable'
  );
});
