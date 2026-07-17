import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_BUFFER_SOURCE_BYTES,
  choosePlaybackMode,
  normalizePlaybackSourceDescriptor
} from '../../js/ui/audio-player/playback-source-policy.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeFile {
  constructor(size) {
    this.size = size;
    this.reads = 0;
  }

  async arrayBuffer() {
    this.reads += 1;
    return new ArrayBuffer(this.size);
  }
}

test('playback policy gives regions priority over bounded buffer capabilities', () => {
  const descriptor = normalizePlaybackSourceDescriptor({
    path: 'album.wav',
    byteLength: 1024,
    readBytes: async () => new ArrayBuffer(1024),
    startFrame: 0,
    endFrame: null
  });

  assert.equal(descriptor.endFrame, null);
  assert.deepEqual(choosePlaybackMode(descriptor), {
    mode: 'media',
    allowMediaFallback: false,
    reason: 'region-must-stream'
  });
});

test('playback policy selects bounded buffers and a one-way media fallback', () => {
  const descriptor = normalizePlaybackSourceDescriptor({
    path: 'small.wav',
    byteLength: MAX_BUFFER_SOURCE_BYTES,
    readBytes: async () => new ArrayBuffer(0)
  });

  assert.deepEqual(choosePlaybackMode(descriptor), {
    mode: 'buffer',
    allowMediaFallback: true,
    reason: 'bounded-buffer-source'
  });
});

test('oversize and unknown sources never select byte reads', () => {
  let reads = 0;
  const oversize = normalizePlaybackSourceDescriptor({
    path: 'large.wav',
    byteLength: MAX_BUFFER_SOURCE_BYTES + 1,
    readBytes: async () => { reads += 1; }
  });
  const unknown = normalizePlaybackSourceDescriptor({
    path: 'https://example.test/stream.wav',
    readBytes: async () => { reads += 1; }
  });

  assert.equal(choosePlaybackMode(oversize).mode, 'media');
  assert.equal(choosePlaybackMode(unknown).mode, 'media');
  assert.equal(reads, 0);
});

test('bytes-only sources are bufferable only through the shared threshold', () => {
  assert.equal(choosePlaybackMode(normalizePlaybackSourceDescriptor({
    bytes: new Uint8Array(4)
  })).mode, 'buffer');
  assert.equal(choosePlaybackMode({
    byteLength: MAX_BUFFER_SOURCE_BYTES + 1,
    bytes: { byteLength: MAX_BUFFER_SOURCE_BYTES + 1 },
    mediaSource: null
  }).mode, 'unavailable');
});

test('normalizer derives byte lengths without reading files or creating URLs', async () => {
  const file = new FakeFile(123);
  await withGlobals({ File: FakeFile }, async () => {
    const descriptor = normalizePlaybackSourceDescriptor({ file });
    assert.equal(descriptor.byteLength, 123);
    assert.equal(descriptor.mediaSource, file);
    assert.equal(file.reads, 0);
    await descriptor.readBytes();
    assert.equal(file.reads, 1);
  });

  assert.equal(normalizePlaybackSourceDescriptor({ data: new ArrayBuffer(7) }).byteLength, 7);
  assert.equal(normalizePlaybackSourceDescriptor({ data: new Uint8Array(9) }).byteLength, 9);
});
