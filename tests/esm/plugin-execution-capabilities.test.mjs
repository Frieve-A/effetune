import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachPluginExecutionCapabilities,
  getPluginExecutionCapabilities,
  getPluginExecutionChannelMode,
  getPluginExecutionUnsupportedReason
} from '../../js/audio/plugin-execution-capabilities.js';

test('plugin execution capabilities prefer class declarations over compatibility metadata', () => {
  class RoomEqPlugin {}
  class CustomWasmPlugin {
    static executionCapabilities = Object.freeze({
      requiresWasm: true,
      supportedChannelModes: Object.freeze(['stereo-pair'])
    });
  }

  assert.deepEqual(
    getPluginExecutionCapabilities(new RoomEqPlugin()).supportedSampleRates,
    [44100, 48000, 88200, 96000, 176400, 192000]
  );
  assert.equal(
    getPluginExecutionCapabilities(new CustomWasmPlugin()),
    CustomWasmPlugin.executionCapabilities
  );
});

test('plugin execution capabilities attach only declared runtime metadata', () => {
  class CustomWasmPlugin {
    static executionCapabilities = Object.freeze({ requiresWasm: true });
  }
  class OrdinaryPlugin {}

  const wasmPayload = { id: 1 };
  const ordinaryPayload = { id: 2 };
  assert.equal(
    attachPluginExecutionCapabilities(new CustomWasmPlugin(), wasmPayload),
    wasmPayload
  );
  assert.equal(
    wasmPayload.executionCapabilities,
    CustomWasmPlugin.executionCapabilities
  );
  assert.equal(
    attachPluginExecutionCapabilities(new OrdinaryPlugin(), ordinaryPayload),
    ordinaryPayload
  );
  assert.equal('executionCapabilities' in ordinaryPayload, false);
});

test('execution eligibility shares rate and channel-mode decisions', () => {
  const capabilities = Object.freeze({
    requiresWasm: true,
    supportedSampleRates: Object.freeze([48000, 96000]),
    supportedChannelModes: Object.freeze(['mono', 'stereo-pair'])
  });
  assert.equal(getPluginExecutionChannelMode(null, 1), 'mono');
  assert.equal(getPluginExecutionChannelMode(null, 2), 'stereo-pair');
  assert.equal(getPluginExecutionChannelMode('34', 3), null);
  assert.equal(getPluginExecutionChannelMode('34', 4), 'stereo-pair');
  assert.equal(getPluginExecutionUnsupportedReason(capabilities, {
    sampleRate: 44100,
    channelMode: 'stereo-pair'
  }), 'unsupportedSampleRate');
  assert.equal(getPluginExecutionUnsupportedReason(capabilities, {
    sampleRate: 48000,
    channelMode: 'all'
  }), 'unsupportedChannelMode');
  assert.equal(getPluginExecutionUnsupportedReason(capabilities, {
    sampleRate: 96000,
    channelMode: 'mono'
  }), null);
});
