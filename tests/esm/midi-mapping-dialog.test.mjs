import assert from 'node:assert/strict';
import test from 'node:test';

import { MidiMappingDialog } from '../../js/midi/midi-mapping-dialog.js';
import { MidiMappingStore } from '../../js/midi/midi-mapping-store.js';
import { ParamAdapter } from '../../js/midi/param-adapter.js';

function element() {
  return {
    children: [],
    listeners: new Map(),
    dataset: {},
    classList: { toggle() {}, add() {} },
    value: '',
    setAttribute(name, value) { this[name] = value; },
    replaceChildren(...children) {
      this.children = children;
      children.forEach(child => { child.parentElement = this; });
    },
    appendChild(child) {
      if (child && typeof child === 'object') child.parentElement = this;
      this.children.push(child);
      return child;
    },
    append(...children) {
      children.forEach(child => {
        if (child && typeof child === 'object') child.parentElement = this;
      });
      this.children.push(...children);
    },
    addEventListener(type, callback) { this.listeners.set(type, callback); }
  };
}

function mappingList(content) {
  const section = content.children.find(child => child.className?.includes('midi-mapping-section'));
  return section?.children.find(child => child.className?.includes('midi-mapping-list'));
}

function descendants(elementRef) {
  return elementRef.children.flatMap(child => [child, ...descendants(child)]);
}

test('dialog numbers repeated parameter titles and offers Enabled', () => {
  const catalog = {
    TestPlugin: [
      { key: 'band', element: 0, title: 'Band Gain', unit: 'dB', containerKey: '', memberKey: '', field: 'g0' },
      { key: 'band', element: 1, title: 'Band Gain', unit: 'dB', containerKey: '', memberKey: '', field: 'g1' }
    ]
  };
  const documentRef = {
    createElement() { return element(); }
  };
  const dialog = new MidiMappingDialog({
    manager: { adapter: new ParamAdapter({ catalog }) },
    windowRef: { document: documentRef }
  });
  const select = element();
  dialog.populateParameterSelect(select, 'TestPlugin', { param: 'band', element: 1 });
  assert.deepEqual(select.children.map(option => option.textContent), [
    'Enabled', 'Band Gain 1 (dB)', 'Band Gain 2 (dB)'
  ]);
  assert.equal(select.value, 'band:1');
});

test('dialog exposes the two global operations', () => {
  const documentRef = { createElement() { return element(); } };
  const dialog = new MidiMappingDialog({
    manager: { adapter: new ParamAdapter({ catalog: {} }) },
    windowRef: { document: documentRef }
  });
  const select = element();
  dialog.populateParameterSelect(select, '_global', { param: 'abToggle', element: 0 });
  assert.deepEqual(select.children.map(option => option.textContent), ['Master Bypass', 'A/B Toggle']);
  assert.equal(select.value, 'abToggle:0');
});

test('dialog resolves plugin labels, default targets, and real-value detail ranges', async () => {
  class TestPlugin {}
  const descriptor = {
    key: 'gain', element: 0, title: 'Gain', unit: 'dB', containerKey: '', memberKey: '', field: 'gn',
    kind: 'float', normalization: 'linear', minimum: -12, maximum: 12, step: 0.5
  };
  const documentRef = {
    createElement() { return element(); }
  };
  const updates = [];
  const adapter = new ParamAdapter({ catalog: { TestPlugin: [descriptor] } });
  const dialog = new MidiMappingDialog({
    manager: {
      adapter,
      store: { updateMapping: async (...args) => { updates.push(args); } }
    },
    windowRef: {
      document: documentRef,
      uiManager: { t: key => key },
      pluginManager: { pluginClasses: { Test: TestPlugin } },
      audioManager: { pipeline: [{ constructor: { name: 'TestPlugin' } }] }
    }
  });
  assert.deepEqual(dialog.pluginTypes(), [{ type: 'TestPlugin', label: 'Test' }]);
  assert.deepEqual(dialog.defaultTarget(), {
    type: 'TestPlugin', instance: 'first', param: 'gain', element: 0
  });
  assert.deepEqual(dialog.firstTargetForType('TestPlugin'), {
    type: 'TestPlugin', instance: 'first', param: 'gain', element: 0
  });
  const details = dialog.renderDetails({
    id: 'one', source: { kind: 'cc', mode: 'abs' },
    target: { type: 'TestPlugin', instance: 'first', param: 'gain', element: 0 },
    map: { lo: -12, hi: 12, sensitivity: 1, dir: 1 }
  });
  const minInput = details.children[0].children[0];
  assert.equal(minInput.min, '-12');
  assert.equal(minInput.max, '12');
  assert.equal(minInput.step, '0.5');
  minInput.listeners.get('change')({ target: { value: '-6' } });
  await Promise.resolve();
  assert.equal(updates[0][1].map.lo, -6);
});

test('dialog sensitivity uses exactly the values accepted by the mapping store', async () => {
  const updates = [];
  const documentRef = { createElement() { return element(); } };
  const dialog = new MidiMappingDialog({
    manager: {
      adapter: new ParamAdapter({ catalog: { TestPlugin: [
        {
          key: 'gain', element: 0, title: 'Gain', unit: 'dB', containerKey: '', memberKey: '',
          field: 'gn', kind: 'float', normalization: 'linear', minimum: -12, maximum: 12, step: 0.5
        }
      ] } }),
      store: { async updateMapping(...args) { updates.push(args); } }
    },
    windowRef: { document: documentRef }
  });
  const details = dialog.renderDetails({
    id: 'sensitivity',
    source: { kind: 'cc', channel: 0, number: 1, mode: 'rel2c' },
    target: { type: 'TestPlugin', instance: 'first', param: 'gain', element: 0 },
    map: { lo: -12, hi: 12, sensitivity: 1, dir: 1, buttonMode: 'toggle' }
  });
  const field = details.children.find(child => child.textContent === 'Sensitivity');
  const select = field.children[0];
  assert.deepEqual(select.children.map(option => option.value), ['0.25', '0.5', '1', '2', '4']);
  assert.equal(select.value, '1');
  for (const value of ['0.25', '0.5', '1', '2', '4']) {
    select.listeners.get('change')({ target: { value } });
  }
  assert.deepEqual(updates, [0.25, 0.5, 1, 2, 4].map(sensitivity => [
    'sensitivity', { map: { sensitivity } }
  ]));
});

test('dialog keeps duplicate MIDI keys out of device labels and mapping summaries', () => {
  const key = 'Twin\0' + '2';
  const protocolReads = [];
  const protocolWrites = [];
  const manager = {
    adapter: new ParamAdapter({ catalog: {} }),
    isSupported: () => true,
    listInputs: () => [{ name: 'Twin', key, connected: true }],
    listGamepads: () => [],
    getDeviceDisplayName: deviceKey => deviceKey === key ? 'Twin' : deviceKey,
    setDeviceProtocol: async (...args) => { protocolWrites.push(args); },
    store: {
      mappings: [],
      getDeviceProtocol(deviceKey) { protocolReads.push(deviceKey); return 'generic'; },
      async removeMapping() {}
    },
    engine: { getTargetKind: () => 'bool' }
  };
  const dialog = new MidiMappingDialog({
    manager,
    windowRef: { document: { createElement() { return element(); } } }
  });
  const devices = dialog.renderDevices();
  assert.equal(devices.children[1].children[0].children[0].textContent, '● Twin');
  assert.deepEqual(protocolReads, [key]);
  const protocol = devices.children[1].children[0].children[1].children[0].children[0];
  protocol.listeners.get('change')({ target: { value: 'mcu' } });
  assert.deepEqual(protocolWrites, [[key, 'mcu']]);

  const row = dialog.renderMapping({
    id: 'duplicate', device: key,
    source: { kind: 'note', channel: 0, number: 1 },
    target: { type: '_global', instance: 'first', param: 'masterBypass', element: 0 },
    map: { lo: 0, hi: 1, sensitivity: 1, dir: 1, buttonMode: 'toggle' }
  });
  assert.equal(row.children[0].children[0].children.at(-1), ' — Twin');
});

test('dialog lets button mappings choose momentary boolean control', async () => {
  const boolDescriptor = {
    key: 'active', element: 0, title: 'Active', unit: '', containerKey: '', memberKey: '',
    field: 'ac', kind: 'bool'
  };
  const updates = [];
  const documentRef = { createElement() { return element(); } };
  const adapter = new ParamAdapter({ catalog: { TestPlugin: [boolDescriptor] } });
  const manager = {
    adapter,
    engine: { getTargetKind: () => 'bool' },
    store: { updateMapping: async (...args) => { updates.push(args); } }
  };
  const dialog = new MidiMappingDialog({ manager, windowRef: { document: documentRef } });
  const details = dialog.renderDetails({
    id: 'button',
    source: { kind: 'note' },
    target: { type: 'TestPlugin', param: 'active', element: 0 },
    map: { lo: 0, hi: 1, sensitivity: 1, dir: 1, buttonMode: 'toggle' }
  });
  const buttonModeField = details.children.at(-1);
  assert.equal(buttonModeField.textContent, 'Button Mode');
  const buttonMode = buttonModeField.children[0];
  assert.equal(buttonMode['aria-label'], 'Button Mode');
  buttonMode.listeners.get('change')({ target: { value: 'momentary' } });
  await Promise.resolve();
  assert.equal(updates[0][1].map.buttonMode, 'momentary');
});

test('changing a parameter resets Min and Max to its real value range', async () => {
  class TestPlugin {}
  const catalog = {
    TestPlugin: [
      {
        key: 'gain', element: 0, title: 'Gain', unit: 'dB', containerKey: '', memberKey: '',
        field: 'gn', kind: 'float', normalization: 'linear', minimum: -12, maximum: 12, step: 0.5
      },
      {
        key: 'frequency', element: 0, title: 'Frequency', unit: 'Hz', containerKey: '', memberKey: '',
        field: 'fr', kind: 'float', normalization: 'log', minimum: 20, maximum: 20000, step: 1
      }
    ]
  };
  const updates = [];
  const adapter = new ParamAdapter({ catalog });
  const dialog = new MidiMappingDialog({
    manager: {
      adapter,
      engine: { getTargetKind: () => 'float' },
      store: {
        updateMapping: async (...args) => { updates.push(args); },
        removeMapping: async () => {}
      }
    },
    windowRef: {
      document: { createElement() { return element(); } },
      pluginManager: { pluginClasses: { Test: TestPlugin } }
    }
  });
  dialog.render = () => {};
  const row = dialog.renderMapping({
    id: 'one', device: 'Controller', source: { kind: 'cc', channel: 0, number: 1, mode: 'abs' },
    target: { type: 'TestPlugin', instance: 'first', param: 'gain', element: 0 },
    map: { lo: -12, hi: 12, sensitivity: 1, dir: 1, buttonMode: 'toggle' }
  });
  const paramSelect = row.children[1].children[0].children[2].children[0];
  await paramSelect.listeners.get('change')({ target: { value: 'frequency:0' } });
  assert.deepEqual(updates[0][1], {
    target: { type: 'TestPlugin', instance: 'first', param: 'frequency', element: 0 },
    map: { lo: 20, hi: 20000, amount: 1 }
  });
  const typeSelect = row.children[1].children[0].children[0].children[0];
  await typeSelect.listeners.get('change')({ target: { value: '_global' } });
  assert.deepEqual(updates[1][1], {
    target: { type: '_global', instance: 'first', param: 'masterBypass', element: 0 },
    map: { lo: 0, hi: 1, amount: 1, behavior: 'direct' }
  });
});

test('Add Automation chooses a numeric target and creates a safe one-second timer', async () => {
  class TestPlugin {}
  const catalog = {
    TestPlugin: [
      {
        key: 'active', element: 0, title: 'Active', unit: '', containerKey: '', memberKey: '',
        field: 'ac', kind: 'bool'
      },
      {
        key: 'gain', element: 0, title: 'Gain', unit: 'dB', containerKey: '', memberKey: '',
        field: 'gn', kind: 'float', normalization: 'linear', minimum: -12, maximum: 12, step: 0.5
      }
    ]
  };
  const added = [];
  const frames = [];
  const store = {
    mappings: [],
    async addMapping(mapping) {
      added.push(mapping);
      const saved = { ...mapping, id: 'automation' };
      this.mappings.push(saved);
      return saved;
    }
  };
  const dialog = new MidiMappingDialog({
    manager: {
      adapter: new ParamAdapter({ catalog }),
      store,
      isSupported: () => false,
      listInputs: () => [],
      listGamepads: () => []
    },
    windowRef: {
      document: { createElement() { return element(); } },
      pluginManager: { pluginClasses: { Test: TestPlugin } },
      audioManager: { pipeline: [{ constructor: { name: 'TestPlugin' } }] },
      requestAnimationFrame(callback) { frames.push(callback); }
    }
  });
  dialog.content = element();
  dialog.content.scrollHeight = 640;
  dialog.render();
  assert.equal(dialog.content.children.some(child => child.className?.includes('midi-mapping-list')), false);
  await dialog.addAutomationMapping();
  const list = mappingList(dialog.content);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].dataset.mappingId, 'automation');
  assert.equal(dialog.content.scrollTop || 0, 0);
  assert.equal(frames.length, 1);
  frames[0]();
  assert.equal(dialog.content.scrollTop, 640);
  assert.deepEqual(added, [{
    device: '',
    source: { kind: 'timer', schedule: 'interval', intervalMs: 1000 },
    target: { type: 'TestPlugin', instance: 'first', param: 'gain', element: 0 },
    map: {
      lo: -12, hi: 12, amount: 0.5, sensitivity: 1, dir: 1,
      buttonMode: 'toggle', behavior: 'direct'
    }
  }]);
});

test('changing an automation target type immediately rebuilds its parameter options and range', async () => {
  class TestPlugin {}
  class AlternatePlugin {}
  const catalog = {
    TestPlugin: [{
      key: 'gain', element: 0, title: 'Gain', unit: 'dB', containerKey: '', memberKey: '',
      field: 'gn', kind: 'float', normalization: 'linear', minimum: -12, maximum: 12, step: 0.5
    }],
    AlternatePlugin: [{
      key: 'frequency', element: 0, title: 'Frequency', unit: 'Hz', containerKey: '', memberKey: '',
      field: 'fr', kind: 'float', normalization: 'log', minimum: 20, maximum: 20000, step: 10
    }]
  };
  const store = {
    mappings: [{
      id: 'timer', device: '', source: { kind: 'timer', schedule: 'interval', intervalMs: 1000 },
      target: { type: 'TestPlugin', instance: 'last', param: 'gain', element: 0 },
      map: {
        lo: -6, hi: 6, amount: 0.5, sensitivity: 1, dir: 1,
        buttonMode: 'toggle', behavior: 'direct'
      }
    }],
    async updateMapping(id, patch) {
      const index = this.mappings.findIndex(mapping => mapping.id === id);
      const current = this.mappings[index];
      this.mappings[index] = {
        ...current,
        ...patch,
        target: { ...current.target, ...(patch.target || {}) },
        map: { ...current.map, ...(patch.map || {}) }
      };
      return true;
    }
  };
  const dialog = new MidiMappingDialog({
    manager: {
      adapter: new ParamAdapter({ catalog }),
      store,
      isSupported: () => false,
      listInputs: () => [],
      listGamepads: () => []
    },
    windowRef: {
      document: { createElement() { return element(); } },
      pluginManager: { pluginClasses: { Test: TestPlugin, Alternate: AlternatePlugin } }
    }
  });
  dialog.content = element();
  dialog.render();
  let list = mappingList(dialog.content);
  let typeSelect = list.children[0].children[1].children[0].children[0].children[0];
  await typeSelect.listeners.get('change')({ target: { value: 'AlternatePlugin' } });

  list = mappingList(dialog.content);
  const controls = list.children[0].children[1].children[0];
  const parameterSelect = controls.children[2].children[0];
  assert.deepEqual(controls.children.map(field => field.textContent), [
    'Effect', 'Instance', 'Parameter'
  ]);
  assert.deepEqual(controls.children.map(field => field.className), [
    'midi-field midi-target-type-field',
    'midi-field midi-target-instance-field',
    'midi-field midi-target-parameter-field'
  ]);
  const renderedControls = descendants(list.children[0]).filter(node =>
    node.className?.includes('config-select') || node.className?.includes('preset-dialog-rename-input')
  );
  assert.equal(renderedControls.length > 0, true);
  assert.equal(renderedControls.every(control =>
    control.parentElement?.className?.split(/\s+/).includes('midi-field') && control.parentElement.textContent
  ), true);
  assert.deepEqual(parameterSelect.children.map(option => option.value), ['frequency:0']);
  assert.equal(parameterSelect.value, 'frequency:0');
  assert.deepEqual(store.mappings[0].target, {
    type: 'AlternatePlugin', instance: 'last', param: 'frequency', element: 0
  });
  assert.deepEqual(
    { lo: store.mappings[0].map.lo, hi: store.mappings[0].map.hi, amount: store.mappings[0].map.amount },
    { lo: 20, hi: 20000, amount: 10 }
  );
});

test('automation mappings expose only source-relevant controls and numeric parameters', async () => {
  class TestPlugin {}
  const catalog = {
    TestPlugin: [
      {
        key: 'active', element: 0, title: 'Active', unit: '', containerKey: '', memberKey: '',
        field: 'ac', kind: 'bool'
      },
      {
        key: 'gain', element: 0, title: 'Gain', unit: 'dB', containerKey: '', memberKey: '',
        field: 'gn', kind: 'float', normalization: 'linear', minimum: -12, maximum: 12, step: 0.5
      }
    ]
  };
  const updates = [];
  const adapter = new ParamAdapter({ catalog });
  const dialog = new MidiMappingDialog({
    manager: {
      adapter,
      store: {
        async updateMapping(...args) { updates.push(args); },
        async removeMapping() {}
      }
    },
    windowRef: {
      document: { createElement() { return element(); } },
      pluginManager: { pluginClasses: { Test: TestPlugin } }
    }
  });
  dialog.render = () => {};
  const timer = {
    id: 'timer', device: '', source: { kind: 'timer', intervalMs: 5000 },
    target: { type: 'TestPlugin', instance: 'first', param: 'gain', element: 0 },
    map: {
      lo: -6, hi: 6, sensitivity: 1, dir: -1, buttonMode: 'toggle',
      behavior: 'direct', amount: 0.5
    }
  };
  const row = dialog.renderMapping(timer);
  const targetControls = row.children[1].children[0];
  assert.deepEqual(
    targetControls.children[2].children[0].children.map(option => option.textContent),
    ['Gain (dB)']
  );
  const details = row.children[1].children[1];
  assert.equal(details.children[0].children[0]['aria-label'], 'Source');
  assert.equal(details.children[1].textContent, 'Schedule');
  assert.equal(details.children[2].textContent, 'Interval (seconds)');
  assert.equal(details.children.some(child => child.textContent === 'Sensitivity'), false);
  assert.equal(details.children.some(child => child.textContent === 'Action'), true);
  assert.equal(details.children.some(child => child.textContent === 'Amount (dB)'), true);

  const instanceSelect = targetControls.children[1].children[0];
  await instanceSelect.listeners.get('change')({ target: { value: 'all' } });
  assert.deepEqual(updates.at(-1)[1], { target: { instance: 'all' } });

  const clockDetails = dialog.renderDetails({
    ...timer,
    source: { kind: 'clock', component: 'minute', shape: 'sin' },
    map: { ...timer.map, behavior: 'direct' }
  });
  assert.equal(clockDetails.children.some(child => child.textContent === 'Time part'), true);
  assert.equal(clockDetails.children.some(child => child.textContent === 'Wave'), true);
  assert.equal(clockDetails.children.some(child => child.textContent === 'Interval (seconds)'), false);
  assert.equal(clockDetails.children.some(child => child.textContent === 'Action'), false);
  assert.equal(clockDetails.children.some(child => child.textContent === 'Amount (dB)'), false);

  const buttonDetails = dialog.renderDetails({
    ...timer,
    device: '',
    source: { kind: 'key', keyCombo: 'K' },
    map: { ...timer.map, behavior: 'randomWalk' }
  });
  assert.equal(buttonDetails.children.some(child => child.textContent === 'Sensitivity'), true);
  assert.equal(buttonDetails.children.some(child => child.textContent === 'Action'), true);
  assert.equal(buttonDetails.children.some(child => child.textContent === 'Amount (dB)'), true);
});

test('switching a random timer to Clock resets behavior in the same validated update', async () => {
  class TestPlugin {}
  const descriptor = {
    key: 'gain', element: 0, title: 'Gain', unit: 'dB', containerKey: '', memberKey: '',
    field: 'gn', kind: 'float', normalization: 'linear', minimum: -12, maximum: 12, step: 0.5
  };
  const adapter = new ParamAdapter({ catalog: { TestPlugin: [descriptor] } });
  const store = new MidiMappingStore({
    pluginManager: { pluginClasses: { Test: TestPlugin } },
    adapter,
    isElectron: false,
    loadConfigFn: async () => ({}),
    saveConfigFn: async () => true
  });
  await store.initialize({
    midiController: {
      version: 1,
      devices: [],
      mappings: [{
        id: 'random-timer',
        device: '',
        source: { kind: 'timer', schedule: 'interval', intervalMs: 1000 },
        target: { type: 'TestPlugin', instance: 'first', param: 'gain', element: 0 },
        map: {
          lo: -12, hi: 12, sensitivity: 1, dir: 1, buttonMode: 'toggle',
          behavior: 'randomWalk', amount: 0.5
        }
      }]
    }
  });
  const dialog = new MidiMappingDialog({
    manager: { adapter, store },
    windowRef: {
      document: { createElement() { return element(); } },
      pluginManager: { pluginClasses: { Test: TestPlugin } }
    }
  });
  dialog.render = () => {};
  const sourceSelect = dialog.renderDetails(store.mappings[0]).children[0].children[0];
  await sourceSelect.listeners.get('change')({ target: { value: 'clock' } });
  assert.deepEqual(store.mappings[0].source, {
    kind: 'clock', component: 'hour', shape: 'ramp'
  });
  assert.equal(store.mappings[0].map.behavior, 'direct');
  assert.equal(store.mappings[0].map.lo, -12);
  assert.equal(store.mappings[0].map.hi, 12);
  assert.equal(store.mappings[0].map.amount, 0.5);
});

test('timer schedule controls save explicit shapes and show Expired until a future edit re-arms once', async () => {
  class TestPlugin {}
  const descriptor = {
    key: 'gain', element: 0, title: 'Gain', unit: 'dB', containerKey: '', memberKey: '',
    field: 'gn', kind: 'float', normalization: 'linear', minimum: -12, maximum: 12, step: 0.5
  };
  const updates = [];
  const dialog = new MidiMappingDialog({
    manager: {
      adapter: new ParamAdapter({ catalog: { TestPlugin: [descriptor] } }),
      store: {
        async updateMapping(...args) { updates.push(args); },
        async removeMapping() {}
      }
    },
    windowRef: {
      document: { createElement() { return element(); } },
      pluginManager: { pluginClasses: { Test: TestPlugin } }
    },
    nowDate: () => new Date(2026, 7, 30, 12, 0, 0)
  });
  dialog.render = () => {};
  const base = {
    id: 'timer', device: '',
    target: { type: 'TestPlugin', instance: 'first', param: 'gain', element: 0 },
    map: {
      lo: -12, hi: 12, sensitivity: 1, dir: 1, buttonMode: 'toggle',
      behavior: 'direct', amount: 0.5
    }
  };

  const intervalDetails = dialog.renderDetails({
    ...base,
    source: { kind: 'timer', schedule: 'interval', intervalMs: 2_147_483_647 }
  });
  const scheduleSelect = intervalDetails.children[1].children[0];
  const intervalInput = intervalDetails.children[2].children[0];
  assert.equal(scheduleSelect['aria-label'], 'Schedule');
  assert.equal(intervalInput.min, '1');
  assert.equal(intervalInput.max, '2147483.647');
  assert.equal(intervalInput.step, '0.001');
  intervalInput.listeners.get('change')({ target: { value: '2147483.647' } });
  await Promise.resolve();
  assert.deepEqual(updates.at(-1)[1], { source: { intervalMs: 2_147_483_647 } });

  await scheduleSelect.listeners.get('change')({ target: { value: 'once' } });
  assert.deepEqual(updates.at(-1)[1], {
    source: {
      kind: 'timer', schedule: 'once', date: '2026-08-30',
      hour: 12, minute: 1, second: 0
    }
  });
  await scheduleSelect.listeners.get('change')({ target: { value: 'daily' } });
  assert.deepEqual(updates.at(-1)[1], {
    source: { kind: 'timer', schedule: 'daily', hour: 12, minute: 1, second: 0 }
  });

  const expiredDetails = dialog.renderDetails({
    ...base,
    source: {
      kind: 'timer', schedule: 'once', date: '2026-08-30',
      hour: 11, minute: 59, second: 59
    }
  });
  assert.equal(expiredDetails.children.some(child => child.textContent === 'Expired'), true);
  const dateInput = expiredDetails.children.find(child => child.textContent === 'Date').children[0];
  const timeInput = expiredDetails.children.find(child => child.textContent === 'Time').children[0];
  assert.equal(dateInput.value, '2026-08-30');
  assert.equal(timeInput.value, '11:59:59');
  assert.equal(timeInput.step, '1');
  await dateInput.listeners.get('change')({ target: { value: '2026-08-31' } });
  assert.deepEqual(updates.at(-1)[1], { source: { date: '2026-08-31' } });
  await timeInput.listeners.get('change')({ target: { value: '12:30:45' } });
  assert.deepEqual(updates.at(-1)[1], {
    source: { hour: 12, minute: 30, second: 45 }
  });

  const futureDetails = dialog.renderDetails({
    ...base,
    source: {
      kind: 'timer', schedule: 'once', date: '2026-08-31',
      hour: 12, minute: 30, second: 45
    }
  });
  assert.equal(futureDetails.children.some(child => child.textContent === 'Expired'), false);

  const onceRow = dialog.renderMapping({
    ...base,
    source: {
      kind: 'timer', schedule: 'once', date: '2026-08-31',
      hour: 12, minute: 30, second: 45
    }
  });
  assert.equal(onceRow.children[0].children[0].textContent, 'Timer: once on 2026-08-31 at 12:30:45');
  const dailyRow = dialog.renderMapping({
    ...base,
    source: { kind: 'timer', schedule: 'daily', hour: 18, minute: 0, second: 5 }
  });
  assert.equal(dailyRow.children[0].children[0].textContent, 'Timer: daily at 18:00:05');
});

test('target edits render from synchronous store state before persistence completes', async () => {
  class TestPlugin {}
  class AlternatePlugin {}
  const catalog = {
    TestPlugin: [
      {
        key: 'gain', element: 0, title: 'Gain', unit: 'dB', containerKey: '', memberKey: '',
        field: 'gn', kind: 'float', normalization: 'linear', minimum: -12, maximum: 12, step: 0.5
      }
    ],
    AlternatePlugin: [
      {
        key: 'frequency', element: 0, title: 'Frequency', unit: 'Hz', containerKey: '', memberKey: '',
        field: 'fr', kind: 'int', normalization: 'log', minimum: 20, maximum: 20000, step: 10
      },
      {
        key: 'resonance', element: 0, title: 'Resonance', unit: 'Q', containerKey: '', memberKey: '',
        field: 'rs', kind: 'float', normalization: 'linear', minimum: 0.1, maximum: 10, step: 0.1
      }
    ]
  };
  const persistResolvers = [];
  const mapping = id => ({
    id, device: '', source: { kind: 'timer', intervalMs: 1000 },
    target: { type: 'TestPlugin', instance: 'first', param: 'gain', element: 0 },
    map: {
      lo: -3, hi: 3, sensitivity: 1, dir: 1, buttonMode: 'toggle',
      behavior: 'randomWalk', amount: 2
    }
  });
  const store = {
    mappings: [mapping('timer-1'), mapping('timer-2')],
    rejectNext: false,
    updateMapping(id, patch) {
      if (this.rejectNext) {
        this.rejectNext = false;
        return Promise.resolve(false);
      }
      const index = this.mappings.findIndex(candidate => candidate.id === id);
      const current = this.mappings[index];
      this.mappings[index] = {
        ...current,
        ...patch,
        target: { ...current.target, ...(patch.target || {}) },
        map: { ...current.map, ...(patch.map || {}) }
      };
      return new Promise(resolve => persistResolvers.push(resolve));
    },
    async removeMapping() {}
  };
  const dialog = new MidiMappingDialog({
    manager: {
      adapter: new ParamAdapter({ catalog }),
      store,
      isSupported: () => false,
      listInputs: () => [],
      listGamepads: () => []
    },
    windowRef: {
      document: { createElement() { return element(); } },
      pluginManager: { pluginClasses: { Test: TestPlugin, Alternate: AlternatePlugin } }
    }
  });
  dialog.content = element();
  dialog.render();
  const rowFor = id => mappingList(dialog.content).children.find(row => row.dataset.mappingId === id);
  const controls = rowFor('timer-1').children[1].children[0];
  const instanceSelect = controls.children[1].children[0];
  instanceSelect.value = 'last';
  instanceSelect.listeners.get('change')({ target: instanceSelect });
  const typeSelect = controls.children[0].children[0];
  typeSelect.value = 'AlternatePlugin';
  const typeChange = typeSelect.listeners.get('change')({ target: typeSelect });

  let currentRow = rowFor('timer-1');
  let currentControls = currentRow.children[1].children[0];
  let parameterSelect = currentControls.children[2].children[0];
  assert.notEqual(currentRow, controls.parentElement?.parentElement);
  assert.deepEqual(parameterSelect.children.map(option => option.value), ['frequency:0', 'resonance:0']);
  assert.equal(parameterSelect.value, 'frequency:0');
  assert.deepEqual(store.mappings[0].target, {
    type: 'AlternatePlugin', instance: 'last', param: 'frequency', element: 0
  });
  assert.deepEqual(
    { lo: store.mappings[0].map.lo, hi: store.mappings[0].map.hi, amount: store.mappings[0].map.amount },
    { lo: 20, hi: 20000, amount: 10 }
  );
  assert.deepEqual(store.mappings[1].target, {
    type: 'TestPlugin', instance: 'first', param: 'gain', element: 0
  });

  const currentInstance = currentControls.children[1].children[0];
  currentInstance.value = 'all';
  currentInstance.listeners.get('change')({ target: currentInstance });
  parameterSelect.value = 'resonance:0';
  const parameterChange = parameterSelect.listeners.get('change')({ target: parameterSelect });

  currentRow = rowFor('timer-1');
  currentControls = currentRow.children[1].children[0];
  parameterSelect = currentControls.children[2].children[0];
  assert.equal(parameterSelect.value, 'resonance:0');
  assert.deepEqual(store.mappings[0].target, {
    type: 'AlternatePlugin', instance: 'all', param: 'resonance', element: 0
  });
  assert.deepEqual(
    { lo: store.mappings[0].map.lo, hi: store.mappings[0].map.hi, amount: store.mappings[0].map.amount },
    { lo: 0.1, hi: 10, amount: 0.1 }
  );
  assert.deepEqual(store.mappings[1].target, {
    type: 'TestPlugin', instance: 'first', param: 'gain', element: 0
  });

  persistResolvers.splice(0).forEach(resolve => resolve(true));
  await Promise.all([typeChange, parameterChange]);

  store.rejectNext = true;
  const secondType = rowFor('timer-2').children[1].children[0].children[0].children[0];
  secondType.value = 'AlternatePlugin';
  await secondType.listeners.get('change')({ target: secondType });
  assert.equal(rowFor('timer-2').children[1].children[0].children[0].children[0].value, 'TestPlugin');
});
