import assert from 'node:assert/strict';
import test from 'node:test';

import { StateManager } from '../../js/ui/audio-player/state-manager.js';

test('state history stores bounded scalar diagnostics without playback resources', () => {
  const manager = new StateManager({ gaplessPlayback: true });
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const file = new Blob([bytes], { type: 'audio/wav' });
  const buffer = {
    length: 48000,
    numberOfChannels: 2,
    sampleRate: 48000,
    getChannelData: () => new Float32Array(48000)
  };
  const track = { name: 'Resource track', file, bytes, decoded: buffer };

  manager.updatePlaylist([track]);
  manager.updateState({ debugBuffer: buffer, debugBytes: bytes }, 'resource_debug');
  manager.updateState({ debugBuffer: null, debugBytes: null }, 'resource_cleanup');
  const resourceHistory = manager.getStateHistory();
  const summaries = JSON.stringify(resourceHistory);
  assert.match(summaries, /Array\(1\)/);
  assert.match(summaries, /AudioBuffer\(2ch, 48000 frames, 48000Hz\)/);
  assert.match(summaries, /Uint8Array\(4 bytes\)/);
  for (let index = 0; index < 110; index += 1) {
    manager.updateState({ currentTrackPosition: index + 1 }, 'bounded_history');
  }

  const history = manager.getStateHistory();
  assert.equal(history.length, 100);
  for (const entry of [...resourceHistory, ...history]) {
    assert.equal(typeof entry.timestamp, 'number');
    assert.equal(typeof entry.source, 'string');
    for (const value of Object.values(entry.changes)) {
      assert.ok(value.from === null || ['string', 'number', 'boolean'].includes(typeof value.from));
      assert.ok(value.to === null || ['string', 'number', 'boolean'].includes(typeof value.to));
      assert.notEqual(value.from, track);
      assert.notEqual(value.to, track);
      assert.notEqual(value.from, file);
      assert.notEqual(value.to, file);
      assert.notEqual(value.from, bytes);
      assert.notEqual(value.to, bytes);
      assert.notEqual(value.from, buffer);
      assert.notEqual(value.to, buffer);
    }
  }
});
