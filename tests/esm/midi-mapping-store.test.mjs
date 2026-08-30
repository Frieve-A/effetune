import assert from 'node:assert/strict';
import test from 'node:test';

import { createMappingId, MidiMappingStore } from '../../js/midi/midi-mapping-store.js';
import { ParamAdapter } from '../../js/midi/param-adapter.js';

class TestPlugin {}

const descriptor = {
  key: 'gain', element: 0, field: 'gn', containerKey: '', memberKey: '',
  kind: 'float', normalization: 'linear', minimum: -12, maximum: 12, step: 0.5, default: 0
};

function mapping(overrides = {}) {
  return {
    id: 'one',
    device: 'Controller',
    source: { kind: 'cc', channel: 0, number: 1, mode: 'abs' },
    target: { type: 'TestPlugin', instance: 'first', param: 'gain', element: 0 },
    map: { lo: -12, hi: 12, sensitivity: 1, dir: 1, buttonMode: 'toggle' },
    ...overrides
  };
}

test('mapping IDs require secure randomness and prefer randomUUID', () => {
  let fallbackCalls = 0;
  assert.equal(createMappingId({
    randomUUID: () => '12345678-1234-4567-89ab-123456789abc',
    getRandomValues() { fallbackCalls++; }
  }), 'm-12345678-1234-4567-89ab-123456789abc');
  assert.equal(fallbackCalls, 0);

  const fallbackId = createMappingId({
    getRandomValues(bytes) {
      bytes.fill(0);
      return bytes;
    }
  });
  assert.equal(fallbackId, 'm-00000000-0000-4000-8000-000000000000');
  assert.throws(() => createMappingId({}), /Secure randomness/);
});

test('MidiMappingStore validates targets and sanitizes map options', async () => {
  let saved;
  const store = new MidiMappingStore({
    pluginManager: { pluginClasses: { Test: TestPlugin } },
    adapter: new ParamAdapter({ catalog: { TestPlugin: [descriptor] } }),
    loadConfigFn: async () => ({
      midiController: {
        version: 1,
        devices: [],
        mappings: [
          mapping({ map: { lo: -40, hi: 70, sensitivity: 9, dir: 0, buttonMode: 'bad' } }),
          mapping({ id: 'bad', target: { type: '_global', param: 'undo', element: 0 } })
        ]
      }
    }),
    saveConfigFn: async (_electron, patch) => { saved = patch; return true; }
  });
  await store.initialize();
  assert.equal(store.mappings.length, 1);
  assert.deepEqual(store.mappings[0].map, {
    lo: -12, hi: 12, sensitivity: 1, dir: 1, buttonMode: 'toggle', behavior: 'direct', amount: 0.5
  });
  await store.addMapping(mapping({ id: 'global', device: '', source: { kind: 'key', keyCombo: 'G' }, target: { type: '_global', instance: 'first', param: 'abToggle', element: 0 } }));
  assert.equal(saved.midiController.mappings.length, 2);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications++; });
  assert.equal(await store.updateMapping('one', { map: { sensitivity: 2 } }), true);
  assert.equal(store.snapshot().mappings[0].map.sensitivity, 2);
  assert.equal(await store.setDeviceProtocol('Controller', 'mcu'), true);
  assert.equal(store.getDeviceProtocol('Controller'), 'mcu');
  assert.deepEqual(saved.midiController.devices, [{ key: 'Controller', protocol: 'mcu' }]);
  assert.equal(await store.removeMapping('global'), true);
  assert.equal(await store.removeMapping('missing'), false);
  assert.ok(notifications >= 3);
  unsubscribe();
});

test('MidiMappingStore reports every persistence failure while retaining runtime state and retrying snapshots', async () => {
  let saveSucceeds = false;
  let failures = 0;
  const snapshots = [];
  const store = new MidiMappingStore({
    pluginManager: { pluginClasses: { Test: TestPlugin } },
    adapter: new ParamAdapter({ catalog: { TestPlugin: [descriptor] } }),
    loadConfigFn: async () => ({ midiController: { version: 1, devices: [], mappings: [] } }),
    saveConfigFn: async (_electron, patch) => {
      snapshots.push(patch.midiController);
      return saveSucceeds;
    },
    onPersistenceFailure: () => { failures++; }
  });
  await store.initialize();
  const notifications = [];
  store.subscribe(snapshot => notifications.push(snapshot));

  const added = await store.addMapping(mapping({
    id: 'timer', device: '', source: { kind: 'timer', intervalMs: 1000 },
    map: { lo: 0, hi: 1, behavior: 'randomWalk', amount: 0.1 }
  }));

  assert.equal(added.id, 'timer');
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0].mappings[0].source, {
    kind: 'timer', schedule: 'interval', intervalMs: 1000
  });
  assert.equal(await store.updateMapping('timer', { map: { amount: 0.2 } }), false);
  assert.equal(await store.setDeviceProtocol('Controller', 'mcu'), false);
  assert.equal(await store.removeMapping('timer'), false);
  assert.equal(failures, 4);
  assert.equal(notifications.length, 4);

  saveSucceeds = true;
  await store.addMapping(mapping({ id: 'retry' }));
  assert.equal(failures, 4, 'successful saves must not show a persistence warning');
  assert.deepEqual(snapshots.at(-1).devices, [{ key: 'Controller', protocol: 'mcu' }]);
  assert.deepEqual(snapshots.at(-1).mappings.map(saved => saved.id), ['retry']);
});

test('MidiMappingStore canonicalizes integer map endpoints to the descriptor step grid', async () => {
  const integerDescriptor = {
    ...descriptor,
    key: 'steps', field: 'st', kind: 'int', normalization: 'integer',
    minimum: 2, maximum: 14, step: 3, stepCount: 4, default: 2
  };
  let saved;
  const store = new MidiMappingStore({
    pluginManager: { pluginClasses: { Test: TestPlugin } },
    adapter: new ParamAdapter({ catalog: { TestPlugin: [integerDescriptor] } }),
    loadConfigFn: async () => ({ midiController: { version: 1, devices: [], mappings: [] } }),
    saveConfigFn: async (_electron, patch) => { saved = patch; return true; }
  });
  await store.initialize();
  const added = await store.addMapping(mapping({
    target: { type: 'TestPlugin', instance: 'first', param: 'steps', element: 0 },
    map: { lo: 6.4, hi: 99, sensitivity: 1, dir: 1, buttonMode: 'toggle' }
  }));
  assert.deepEqual(added.map, {
    lo: 5, hi: 14, sensitivity: 1, dir: 1, buttonMode: 'toggle', behavior: 'direct', amount: 3
  });
  assert.deepEqual(saved.midiController.mappings[0].map, added.map);
});

test('MidiMappingStore preserves virtual automation fields and rejects invalid target combinations', async () => {
  const integerDescriptor = {
    ...descriptor,
    key: 'steps', field: 'st', kind: 'int', normalization: 'integer',
    minimum: 2, maximum: 14, step: 3, stepCount: 4, default: 2
  };
  const store = new MidiMappingStore({
    pluginManager: { pluginClasses: { Test: TestPlugin } },
    adapter: new ParamAdapter({ catalog: { TestPlugin: [descriptor, integerDescriptor] } }),
    loadConfigFn: async () => ({ midiController: { version: 1, devices: [], mappings: [] } }),
    saveConfigFn: async () => true
  });
  await store.initialize();
  const clock = await store.addMapping(mapping({
    id: 'clock', device: 'wrong-device', source: { kind: 'clock', component: 'minute', shape: 'sin' },
    map: { lo: -6, hi: 6, behavior: 'direct', amount: 0.2 }
  }));
  assert.deepEqual(clock.source, { kind: 'clock', component: 'minute', shape: 'sin' });
  assert.equal(clock.device, '');
  assert.equal(clock.map.amount, 0.2);

  const timer = await store.addMapping(mapping({
    id: 'timer', device: 'wrong-device', source: { kind: 'timer', intervalMs: 500 },
    target: { type: 'TestPlugin', instance: 'first', param: 'steps', element: 0 },
    map: { lo: 2, hi: 14, behavior: 'randomWalk', amount: 4 }
  }));
  assert.deepEqual(timer.source, { kind: 'timer', schedule: 'interval', intervalMs: 1000 });
  assert.equal(timer.map.amount, 3);

  assert.equal(await store.addMapping(mapping({
    id: 'clock-random', source: { kind: 'clock', component: 'hour', shape: 'ramp' },
    map: { lo: 0, hi: 1, behavior: 'random', amount: 0.1 }
  })), null);
  assert.equal(await store.addMapping(mapping({
    id: 'timer-global', device: '', source: { kind: 'timer', intervalMs: 1000 },
    target: { type: '_global', instance: 'first', param: 'abToggle', element: 0 },
    map: { lo: 0, hi: 1, behavior: 'direct', amount: 1 }
  })), null);
});

test('MidiMappingStore normalizes interval, once, and daily timer schedule shapes', async () => {
  const store = new MidiMappingStore({
    pluginManager: { pluginClasses: { Test: TestPlugin } },
    adapter: new ParamAdapter({ catalog: { TestPlugin: [descriptor] } }),
    loadConfigFn: async () => ({ midiController: { version: 1, devices: [], mappings: [] } }),
    saveConfigFn: async () => true
  });
  await store.initialize();
  const interval = await store.addMapping(mapping({
    id: 'interval', device: '', source: { kind: 'timer', intervalMs: 2_147_483_647, date: '2026-01-01' },
    map: { lo: 0, hi: 1, behavior: 'direct', amount: 0.1 }
  }));
  assert.deepEqual(interval.source, { kind: 'timer', schedule: 'interval', intervalMs: 2_147_483_647 });
  const oversizedInterval = await store.addMapping(mapping({
    id: 'oversized-interval', device: '', source: { kind: 'timer', intervalMs: 2_147_483_648 },
    map: { lo: 0, hi: 1, behavior: 'direct', amount: 0.1 }
  }));
  assert.deepEqual(oversizedInterval.source, { kind: 'timer', schedule: 'interval', intervalMs: 1000 });
  const once = await store.addMapping(mapping({
    id: 'once', device: '', source: {
      kind: 'timer', schedule: 'once', date: '2026-02-28', hour: 23, minute: 59, second: 58, intervalMs: 1000
    }, map: { lo: 0, hi: 1, behavior: 'direct', amount: 0.1 }
  }));
  assert.deepEqual(once.source, {
    kind: 'timer', schedule: 'once', date: '2026-02-28', hour: 23, minute: 59, second: 58
  });
  const daily = await store.addMapping(mapping({
    id: 'daily', device: '', source: {
      kind: 'timer', schedule: 'daily', hour: 18, minute: 0, second: 0, date: '2026-01-01', intervalMs: 1000
    }, map: { lo: 0, hi: 1, behavior: 'random', amount: 0.1 }
  }));
  assert.deepEqual(daily.source, { kind: 'timer', schedule: 'daily', hour: 18, minute: 0, second: 0 });
  assert.equal(await store.addMapping(mapping({
    id: 'bad-once', device: '', source: { kind: 'timer', schedule: 'once', date: '2026-02-30', hour: 0, minute: 0, second: 0 }
  })), null);
  assert.equal(await store.addMapping(mapping({
    id: 'bad-daily', device: '', source: { kind: 'timer', schedule: 'daily', hour: 24, minute: 0, second: 0 }
  })), null);
});
