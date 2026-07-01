import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodePipelineState,
  encodePipelineState
} from '../../js/utils/pipeline-state-codec.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('encodePipelineState and decodePipelineState round-trip unicode state with native encoders', () => {
  const state = {
    name: '測定 Preset 🎧',
    pipeline: [
      { name: 'Volume', enabled: true, parameters: { gain: -3.5 } },
      { name: 'EQ', enabled: false, parameters: { label: '低域' } }
    ]
  };

  assert.deepEqual(decodePipelineState(encodePipelineState(state)), state);
});

test('encodePipelineState chunks large UTF-8 payloads without corrupting data', () => {
  const state = {
    name: 'Large',
    payload: 'a'.repeat(0x9000) + '終端'
  };

  assert.deepEqual(decodePipelineState(encodePipelineState(state)), state);
});

test('codec falls back when TextEncoder and TextDecoder are unavailable', async () => {
  const state = {
    name: 'Fallback',
    pipeline: [{ name: 'Stereo', parameters: { comment: '日本語' } }]
  };

  await withGlobals({
    TextEncoder: undefined,
    TextDecoder: undefined
  }, async () => {
    assert.deepEqual(decodePipelineState(encodePipelineState(state)), state);
  });
});
