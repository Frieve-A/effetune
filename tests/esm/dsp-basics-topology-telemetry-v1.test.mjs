import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

test('Basics topology telemetry frame IDs are centrally reserved', () => {
  assert.equal(TelemetryFrameType.TAP_CHANNEL_COUNT, 9);
  assert.equal(TelemetryFrameType.TAP_MULTI_CHANNEL_LEVELS, 10);
});

function createHub() {
  const subscriptions = [];
  let unsubscribeCalls = 0;
  return {
    subscriptions,
    get unsubscribeCalls() { return unsubscribeCalls; },
    subscribe(tapId, frameType, callback) {
      const subscription = { tapId, frameType, callback, active: true };
      subscriptions.push(subscription);
      return () => {
        if (!subscription.active) return;
        subscription.active = false;
        unsubscribeCalls++;
      };
    },
    emit(frame) {
      for (const subscription of subscriptions) {
        if (subscription.active) subscription.callback(frame);
      }
    }
  };
}

function loadPlugin(relativePath, exportName, { hub = null, now = () => 1000 } = {}) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const calls = [];
  const windowRef = { dspTelemetryHub: hub };
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = null;
      this._sectionEnabled = true;
    }
    registerProcessor(processor) { this.processorString = processor; }
    updateParameters() { calls.push(['updateParameters']); }
    _setupMessageHandler() { calls.push(['baseSetupMessageHandler']); }
    cleanup() { calls.push(['baseCleanup']); }
  }
  vm.runInNewContext(source, {
    window: windowRef,
    PluginBase,
    console,
    performance: { now },
    Float32Array,
    Int16Array,
    Int8Array,
    Uint8Array,
    DataView,
    ArrayBuffer
  }, { filename: relativePath });
  return { Plugin: windowRef[exportName], calls };
}

function channelCountFrame(channels, { frameType = 9, version = 1, bytes = 4 } = {}) {
  const payload = new DataView(new ArrayBuffer(bytes));
  if (bytes >= 4) payload.setUint32(0, channels, true);
  return { frameType, formatVersion: version, payload };
}

function multiChannelFrame(channels, { frameType = 10, version = 1, trailing = 0 } = {}) {
  const payload = new DataView(new ArrayBuffer(4 + channels.length * 8 + trailing));
  payload.setUint8(0, channels.length);
  for (let channel = 0; channel < channels.length; channel++) {
    const offset = 4 + channel * 8;
    payload.setFloat32(offset, channels[channel].peak, true);
    payload.setUint8(offset + 4, channels[channel].muted ? 1 : 0);
  }
  return { frame: { frameType, formatVersion: version, payload }, payload };
}

test('Channel Divider consumes strict type-9 frames and retains processBuffer fallback', () => {
  const hub = createHub();
  const runtime = loadPlugin(
    '../../plugins/basics/channel_divider.js',
    'ChannelDividerPlugin',
    { hub }
  );
  const plugin = new runtime.Plugin();
  plugin.id = 31;
  const uiUpdates = [];
  plugin._updateErrorUI = () => uiUpdates.push('error');
  plugin._updateBandOptions = () => uiUpdates.push('bands');
  plugin.updateCrossoverControls = () => uiUpdates.push('crossovers');
  plugin.getParameters();

  assert.equal(hub.subscriptions.length, 1);
  assert.deepEqual(
    [hub.subscriptions[0].tapId, hub.subscriptions[0].frameType],
    [31, 9]
  );
  hub.emit(channelCountFrame(6));
  assert.equal(plugin.maxBands, 3);
  assert.equal(plugin.errorState, null);
  assert.deepEqual(uiUpdates, ['error', 'bands', 'crossovers']);

  const invalidFrames = [
    channelCountFrame(4, { frameType: 10 }),
    channelCountFrame(4, { version: 2 }),
    channelCountFrame(4, { bytes: 8 }),
    channelCountFrame(0),
    channelCountFrame(9),
    { frameType: 9, formatVersion: 1, payload: new Uint8Array(4) }
  ];
  for (const frame of invalidFrames) {
    assert.equal(plugin.parseDspChannelCountTelemetryFrame(frame), null);
  }

  plugin.onMessage({
    type: 'processBuffer',
    pluginId: 31,
    measurements: { channels: 8 }
  });
  assert.equal(plugin.maxBands, 4);
  assert.match(plugin.processorString, /data\.measurements = \{ channels: channelCount \}/);
  plugin.cleanup();
  assert.equal(hub.unsubscribeCalls, 1);
  assert.ok(runtime.calls.some(call => call[0] === 'baseCleanup'));
});

test('Matrix consumes strict type-9 frames and keeps route-message fallback', () => {
  const hub = createHub();
  const runtime = loadPlugin('../../plugins/basics/matrix.js', 'MatrixPlugin', { hub });
  const plugin = new runtime.Plugin();
  plugin.id = 32;
  const channelCounts = [];
  plugin.updateChannelAvailability = channels => channelCounts.push(channels);
  plugin.getParameters();

  hub.emit(channelCountFrame(4));
  assert.deepEqual(channelCounts, [4]);
  assert.equal(plugin.parseDspChannelCountTelemetryFrame(channelCountFrame(8)), 8);
  assert.equal(plugin.parseDspChannelCountTelemetryFrame(channelCountFrame(2, { bytes: 5 })), null);
  plugin.onMessage({
    type: 'processBuffer',
    pluginId: 32,
    measurements: { channels: 6 }
  });
  assert.deepEqual(channelCounts, [4, 6]);
  assert.match(plugin.processorString, /outputData\[outputIndex\] \+=/);

  plugin.id = 44;
  plugin.getParameters();
  assert.equal(hub.unsubscribeCalls, 1);
  assert.equal(hub.subscriptions.at(-1).tapId, 44);
  plugin.cleanup();
  assert.equal(hub.unsubscribeCalls, 2);
});

test('Multi Channel Panel copies exact type-10 records and rejects reserved bytes', () => {
  const hub = createHub();
  const runtime = loadPlugin(
    '../../plugins/basics/multi_channel_panel.js',
    'MultiChannelPanelPlugin',
    { hub }
  );
  const plugin = new runtime.Plugin();
  plugin.id = 33;
  const messages = [];
  plugin.process = message => messages.push(message);
  plugin.getParameters();

  const telemetry = multiChannelFrame([
    { peak: 0.25, muted: false },
    { peak: 0.75, muted: true }
  ]);
  hub.emit(telemetry.frame);
  telemetry.payload.setFloat32(4, 99, true);
  telemetry.payload.setUint8(16, 0);
  assert.equal(messages.length, 1);
  assert.deepEqual(
    Array.from(messages[0].measurements.channels, channel => ({ ...channel })),
    [
      { peak: 0.25, muted: false },
      { peak: 0.75, muted: true }
    ]
  );

  const badHeader = multiChannelFrame([{ peak: 1, muted: false }]);
  badHeader.payload.setUint8(1, 1);
  const badRecord = multiChannelFrame([{ peak: 1, muted: false }]);
  badRecord.payload.setUint8(9, 1);
  const badMute = multiChannelFrame([{ peak: 1, muted: false }]);
  badMute.payload.setUint8(8, 2);
  const badPeak = multiChannelFrame([{ peak: 1, muted: false }]);
  badPeak.payload.setFloat32(4, Number.NaN, true);
  const negativePeak = multiChannelFrame([{ peak: 1, muted: false }]);
  negativePeak.payload.setFloat32(4, -1, true);
  const empty = multiChannelFrame([]);
  const invalidFrames = [
    multiChannelFrame([{ peak: 1, muted: false }], { frameType: 9 }).frame,
    multiChannelFrame([{ peak: 1, muted: false }], { version: 2 }).frame,
    multiChannelFrame([{ peak: 1, muted: false }], { trailing: 4 }).frame,
    badHeader.frame,
    badRecord.frame,
    badMute.frame,
    badPeak.frame,
    negativePeak.frame,
    empty.frame,
    { frameType: 10, formatVersion: 1, payload: new Uint8Array(12) }
  ];
  for (const frame of invalidFrames) {
    assert.equal(plugin.parseDspMultiChannelLevelsTelemetryFrame(frame), null);
  }

  const fallback = {
    type: 'processBuffer',
    measurements: { channels: [{ peak: 0.5, muted: false }] }
  };
  plugin.onMessage(fallback);
  assert.equal(messages.at(-1), fallback);
  assert.match(plugin.processorString, /currentBlockPeakValues\[ch\] = windowPeak/);
  plugin.cleanup();
  assert.equal(hub.unsubscribeCalls, 1);
});
