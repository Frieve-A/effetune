import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeTrueStereoPair,
  parseTrueStereoSide
} from '../../js/ir-library/ir-true-stereo-pair.js';

test('true-stereo pair naming recognizes matching L/R and Left/Right suffixes', () => {
  assert.deepEqual(parseTrueStereoSide('Stone Room_L.wav'), {
    base: 'stone room',
    displayBase: 'Stone Room',
    side: 'left'
  });
  assert.equal(parseTrueStereoSide('Stone Room_Right.aiff').side, 'right');
  assert.equal(parseTrueStereoSide('unlabelled.wav'), null);
});

test('true-stereo pair merge emits LL LR RL RR order and pads the shorter capture', () => {
  const merged = mergeTrueStereoPair([
    {
      name: 'Hall_R.wav',
      pcm: { channels: [new Float32Array([3]), new Float32Array([4, 5])], sampleRate: 48000 }
    },
    {
      name: 'Hall_L.wav',
      pcm: { channels: [new Float32Array([1, 2]), new Float32Array([2])], sampleRate: 48000 }
    }
  ]);
  assert.equal(merged.topologyHint, 'true-stereo');
  assert.equal(Object.hasOwn(merged, 'name'), false);
  assert.deepEqual(merged.channels.map(channel => Array.from(channel)), [
    [1, 2], [2, 0], [3, 0], [4, 5]
  ]);
});

test('true-stereo pair merge rejects ambiguous pairs and non-stereo files', () => {
  const stereo = { channels: [new Float32Array([1]), new Float32Array([1])], sampleRate: 48000 };
  assert.throws(() => mergeTrueStereoPair([
    { name: 'One_L.wav', pcm: stereo },
    { name: 'Two_R.wav', pcm: stereo }
  ]), /matching names/);
  assert.throws(() => mergeTrueStereoPair([
    { name: 'One_L.wav', pcm: stereo },
    { name: 'One_R.wav', pcm: { channels: [new Float32Array([1])], sampleRate: 48000 } }
  ]), /exactly two/);
});
