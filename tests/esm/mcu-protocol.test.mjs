import assert from 'node:assert/strict';
import test from 'node:test';

import { McuProtocol } from '../../js/midi/mcu-protocol.js';
import { ParamAdapter } from '../../js/midi/param-adapter.js';

test('MCU decoding handles faders, signed V-Pots, buttons, and touch', () => {
  const mcu = new McuProtocol();
  assert.deepEqual(mcu.decode([0xe2, 0x00, 0x40]), { kind: 'mcuFader', channel: 2, value: 8192 });
  assert.deepEqual(mcu.decode([0xb0, 16, 1]), { kind: 'mcuVpot', channel: 0, number: 0, delta: 1 });
  assert.deepEqual(mcu.decode([0xb0, 16, 65]), { kind: 'mcuVpot', channel: 0, number: 0, delta: -1 });
  assert.deepEqual(mcu.decode([0x90, 104, 127]), { kind: 'mcuTouch', channel: 0, number: 104, pressed: true });
  assert.deepEqual(mcu.decode([0x80, 42, 0]), { kind: 'mcuButton', channel: 0, number: 42, pressed: false });
  assert.deepEqual(mcu.decode([0x90, 42, 0]), { kind: 'mcuButton', channel: 0, number: 42, pressed: false });
});

test('MCU feedback encodes documented boundaries and suppresses touched faders', () => {
  const sent = [];
  const output = { send(message) { sent.push(message); } };
  const mcu = new McuProtocol({ now: () => 10 });
  assert.equal(mcu.sendFader(output, 'MCU', 2, 8192 / 16383), true);
  mcu.sendVpotRing(output, 'MCU', 0, 0);
  mcu.sendVpotRing(output, 'MCU', 0, 0.5);
  mcu.sendVpotRing(output, 'MCU', 0, 1);
  assert.deepEqual(sent, [
    [0xe2, 0x00, 0x40],
    [0xb0, 48, 1],
    [0xb0, 48, 6],
    [0xb0, 48, 11]
  ]);
  mcu.setTouched('MCU', 2, true);
  assert.equal(mcu.sendFader(output, 'MCU', 2, 0.5), false);
});

test('MCU poller sends only changed first-wins feedback and stops cleanly', () => {
  const sent = [];
  const output = { send(message) { sent.push(message); } };
  const mapping = {
    id: 'button', device: 'MCU',
    source: { kind: 'mcuButton', channel: 0, number: 42 },
    target: { type: '_global', param: 'masterBypass', instance: 'first', element: 0 }
  };
  let intervalCallback;
  let cleared = false;
  let connected = true;
  const mcu = new McuProtocol({
    engine: { resolveTargets: () => [] },
    adapter: {},
    store: {
      mappings: [mapping, { ...mapping, id: 'duplicate' }],
      getDeviceProtocol: () => 'mcu'
    },
    getOutput: () => connected ? output : null,
    windowRef: { pipelineManager: { core: { enabled: false } } },
    setIntervalFn(callback) { intervalCallback = callback; return 7; },
    clearIntervalFn(id) { assert.equal(id, 7); cleared = true; }
  });
  mcu.startFeedbackPoller();
  intervalCallback();
  intervalCallback();
  assert.deepEqual(sent, [[0x90, 42, 127]]);
  connected = false;
  mcu.startFeedbackPoller();
  connected = true;
  mcu.startFeedbackPoller();
  intervalCallback();
  assert.deepEqual(sent, [[0x90, 42, 127], [0x90, 42, 127]]);
  mcu.stopFeedbackPoller();
  assert.equal(cleared, true);
});

test('MCU faders resend the latest feedback after touch is released', () => {
  const sent = [];
  const output = { send(message) { sent.push(message); } };
  const mapping = {
    id: 'fader', device: 'MCU',
    source: { kind: 'mcuFader', channel: 0, number: 0 },
    target: { type: 'TestPlugin', param: 'gain', instance: 'first', element: 0 }
  };
  const mcu = new McuProtocol({
    engine: { resolveTargets: () => [{}] },
    adapter: {
      resolve: () => ({ descriptor: { kind: 'float', normalization: 'linear', minimum: 0, maximum: 1 } }),
      read: () => 0.8
    },
    store: { mappings: [mapping], getDeviceProtocol: () => 'mcu' },
    getOutput: () => output
  });
  mcu.setTouched('MCU', 0, true);
  mcu.pollFeedback();
  assert.deepEqual(sent, []);
  mcu.setTouched('MCU', 0, false);
  mcu.pollFeedback();
  assert.deepEqual(sent, [[0xe0, 50, 102]]);
});

test('MCU feedback returns the mapped physical position for parameter subranges', () => {
  const linear = {
    key: 'linear', element: 0, field: 'linear', containerKey: '', memberKey: '',
    kind: 'float', normalization: 'linear', minimum: 0, maximum: 100, step: 1, default: 0
  };
  const logarithmic = {
    key: 'logarithmic', element: 0, field: 'logarithmic', containerKey: '', memberKey: '',
    kind: 'float', normalization: 'log', minimum: 10, maximum: 10000, step: 1, default: 10
  };
  const enumeration = {
    key: 'enumeration', element: 0, field: 'enumeration', containerKey: '', memberKey: '',
    kind: 'enum', normalization: 'enum', minimum: 0, maximum: 3, step: 1, stepCount: 3,
    values: ['low', 'middle', 'high', 'maximum'], default: 'low'
  };
  const values = { linear: 35, logarithmic: Math.sqrt(100 * 1000), enumeration: 'high' };
  const target = {
    getSerializableParameters() { return values; }
  };
  const mappings = [
    {
      id: 'linear', device: 'MCU', source: { kind: 'mcuFader', channel: 0, number: 0 },
      target: { type: 'FeedbackPlugin', param: 'linear', element: 0 }, map: { lo: 20, hi: 80 }
    },
    {
      id: 'logarithmic', device: 'MCU', source: { kind: 'mcuFader', channel: 1, number: 0 },
      target: { type: 'FeedbackPlugin', param: 'logarithmic', element: 0 }, map: { lo: 100, hi: 1000 }
    },
    {
      id: 'enum', device: 'MCU', source: { kind: 'mcuVpot', channel: 0, number: 2 },
      target: { type: 'FeedbackPlugin', param: 'enumeration', element: 0 }, map: { lo: 'maximum', hi: 'middle' }
    },
    {
      id: 'equal', device: 'MCU', source: { kind: 'mcuFader', channel: 3, number: 0 },
      target: { type: 'FeedbackPlugin', param: 'linear', element: 0 }, map: { lo: 20, hi: 20 }
    }
  ];
  const adapter = new ParamAdapter({ catalog: { FeedbackPlugin: [linear, logarithmic, enumeration] } });
  const mcu = new McuProtocol({
    engine: { resolveTargets: () => [target] },
    adapter,
    store: { mappings, getDeviceProtocol: () => 'mcu' }
  });
  assert.ok(Math.abs(mcu.readFeedback(mappings[0]).normalized - 0.25) < 1e-12);
  assert.ok(Math.abs(mcu.readFeedback(mappings[1]).normalized - 0.5) < 1e-12);
  assert.equal(mcu.readFeedback(mappings[2]).normalized, 0.5);
  assert.equal(mcu.readFeedback(mappings[3]).normalized, 0);
});

test('MCU default interval wrappers preserve the global native receiver when starting and stopping', () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const calls = [];
  try {
    globalThis.setInterval = function nativeSetInterval(...args) {
      assert.equal(this, globalThis);
      calls.push({ kind: 'set', args });
      return 1;
    };
    globalThis.clearInterval = function nativeClearInterval(...args) {
      assert.equal(this, globalThis);
      calls.push({ kind: 'clear', args });
    };
    const mcu = new McuProtocol({
      engine: { resolveTargets: () => [] },
      adapter: {},
      store: {
        mappings: [{
          id: 'feedback', device: 'MCU', source: { kind: 'mcuButton', channel: 0, number: 42 },
          target: { type: '_global', param: 'masterBypass', instance: 'first', element: 0 }
        }],
        getDeviceProtocol: () => 'mcu'
      },
      getOutput: () => ({ send() {} })
    });
    mcu.startFeedbackPoller();
    mcu.stopFeedbackPoller();
    assert.deepEqual(calls.map(call => [call.kind, call.args.at(-1)]), [['set', 100], ['clear', 1]]);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
