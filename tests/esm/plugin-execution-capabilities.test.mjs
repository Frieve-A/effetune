import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachPluginExecutionCapabilities,
  getPluginExecutionCapabilities
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
