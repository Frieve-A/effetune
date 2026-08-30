import assert from 'node:assert/strict';
import test from 'node:test';

import { MidiControllerManager } from '../../js/midi/midi-controller-manager.js';

function harness(mappings, { requestMidiAccess } = {}) {
  let requests = 0;
  let stateAdds = 0;
  let stateRemoves = 0;
  let feedbackStarts = 0;
  const input = { name: 'Input', state: 'connected', onmidimessage: null };
  const access = {
    inputs: new Map([['input', input]]), outputs: new Map(),
    addEventListener() { stateAdds++; }, removeEventListener() { stateRemoves++; }
  };
  const navigatorRef = {
    requestMIDIAccess: async () => {
      requests++;
      return requestMidiAccess ? requestMidiAccess() : access;
    },
    getGamepads: () => []
  };
  const store = {
    mappings, devices: [],
    async initialize() {},
    subscribe(listener) { this.listener = listener; return () => { this.unsubscribed = true; }; },
    getDeviceProtocol() { return 'generic'; }
  };
  const localInputSources = {
    syncSubscriptions() {},
    startLearn(callback, cancelCallback) {
      this.learnCallback = callback;
      this.cancelCallback = cancelCallback;
    },
    cancelLearn() {}, dispose() {}
  };
  const engine = { setGamepadPoller() {}, dispose() {}, onSourceEvent() {} };
  const mcuProtocol = {
    startFeedbackPoller() { feedbackStarts++; },
    stopFeedbackPoller() {},
    dispose() {}
  };
  const schedulerSyncs = [];
  const automationScheduler = {
    sync(value) { schedulerSyncs.push(value); },
    dispose() {
      this.disposed = true;
      this.disposeCalls = (this.disposeCalls || 0) + 1;
    }
  };
  const manager = new MidiControllerManager({
    windowRef: {}, navigatorRef, store, localInputSources, engine, mcuProtocol, automationScheduler
  });
  return {
    manager,
    store,
    automationScheduler,
    schedulerSyncs,
    localInputSources,
    access,
    input,
    requests: () => requests,
    feedbackStarts: () => feedbackStarts,
    stateAdds: () => stateAdds,
    stateRemoves: () => stateRemoves
  };
}

test('opening the dialog and adding automation do not request MIDI; Learn does', async () => {
  const { manager, input, requests, stateAdds, stateRemoves } = harness([]);
  await manager.initialize({});
  assert.equal(requests(), 0);
  await manager.setDialogOpen(true);
  assert.equal(requests(), 0);
  manager.store.mappings.push({
    id: 'timer', device: '', source: { kind: 'timer', intervalMs: 1000 },
    target: { type: 'TestPlugin', instance: 'first', param: 'gain', element: 0 },
    map: { lo: 0, hi: 1, behavior: 'direct', amount: 1 }
  });
  manager.store.listener();
  await Promise.resolve();
  assert.equal(requests(), 0);
  await manager.startLearn(() => {});
  assert.equal(requests(), 1);
  assert.equal(typeof input.onmidimessage, 'function');
  assert.equal(stateAdds(), 1);
  await manager.setDialogOpen(false);
  assert.equal(input.onmidimessage, null);
  assert.equal(stateRemoves(), 1);
  manager.dispose();
});

test('saved physical MIDI mappings request access during initialization', async () => {
  const { manager, requests } = harness([{
    id: 'cc', device: 'Input', source: { kind: 'cc', channel: 0, number: 1, mode: 'abs' }
  }]);
  await manager.initialize({});
  assert.equal(requests(), 1);
  manager.dispose();
});

test('disposing during a pending MIDI permission request prevents runtime restart', async () => {
  let resolvePermission;
  const permission = new Promise(resolve => { resolvePermission = resolve; });
  const physicalMapping = {
    id: 'cc', device: 'Input', source: { kind: 'cc', channel: 0, number: 1, mode: 'abs' }
  };
  const {
    manager, store, access, input, automationScheduler, schedulerSyncs,
    requests, feedbackStarts, stateAdds
  } = harness([physicalMapping], { requestMidiAccess: () => permission });
  let changes = 0;
  manager.onChange(() => { changes++; });

  const initializing = manager.initialize({});
  await Promise.resolve();
  assert.equal(requests(), 1);

  manager.dispose();
  manager.dispose();
  const syncsAfterDispose = schedulerSyncs.length;
  store.listener();
  resolvePermission(access);
  await initializing;
  await Promise.resolve();

  assert.equal(manager.midiAccess, null);
  assert.equal(input.onmidimessage, null);
  assert.equal(stateAdds(), 0);
  assert.equal(feedbackStarts(), 0);
  assert.equal(changes, 0);
  assert.equal(schedulerSyncs.length, syncsAfterDispose);
  assert.equal(automationScheduler.disposeCalls, 1);
});

test('manager synchronizes and disposes its automation scheduler', async () => {
  const { manager, store, automationScheduler, schedulerSyncs } = harness([]);
  await manager.initialize({});
  assert.equal(schedulerSyncs.length, 1);
  assert.equal(schedulerSyncs[0], store.mappings);
  store.mappings = [{ id: 'clock', source: { kind: 'clock' } }];
  store.listener();
  await Promise.resolve();
  assert.equal(schedulerSyncs.length, 2);
  assert.equal(schedulerSyncs[1], store.mappings);
  manager.dispose();
  assert.equal(automationScheduler.disposed, true);
  assert.equal(store.unsubscribed, true);
});

test('manager-created store reports persistence failures through the localized UI error path', () => {
  const errors = [];
  const manager = new MidiControllerManager({
    windowRef: { uiManager: { setError: (...args) => errors.push(args) } },
    navigatorRef: {},
    engine: { dispose() {} },
    localInputSources: { cancelLearn() {}, dispose() {} },
    mcuProtocol: { dispose() {} },
    automationScheduler: { dispose() {} }
  });
  manager.store.onPersistenceFailure();
  assert.deepEqual(errors, [['error.controllerMappingSaveFailed', true]]);
  manager.dispose();
});

test('generic MIDI parser treats Note On velocity zero as release', () => {
  const { manager } = harness([]);
  assert.deepEqual(manager.parseGenericMessage([0x90, 60, 0]), {
    source: { kind: 'note', channel: 0, number: 60 },
    value: { pressed: false, velocity: 0 }
  });
  assert.deepEqual(manager.parseGenericMessage([0xb2, 7, 99]), {
    source: { kind: 'cc', channel: 2, number: 7 }, value: 99
  });
  assert.deepEqual(manager.parseGenericMessage([0xe1, 0, 64]), {
    source: { kind: 'pitchbend', channel: 1 }, value: 8192
  });
  assert.equal(manager.parseGenericMessage([0xf8]), null);
});

test('manager lists connected devices, emits changes, and resolves matching outputs', async () => {
  const { manager } = harness([]);
  const output = { name: 'Out', state: 'connected' };
  manager.midiAccess = {
    inputs: new Map([['in', { name: 'In', state: 'connected' }]]),
    outputs: new Map([['out', output]])
  };
  manager.navigator.getGamepads = () => [{ id: 'Pad', connected: true }, null];
  let state;
  const remove = manager.onChange(next => { state = next; });
  manager.emitChange();
  assert.deepEqual(manager.listInputs(), [{ name: 'In', key: 'In', index: 0, connected: true }]);
  assert.deepEqual(manager.listOutputs(), [{ name: 'Out', key: 'Out', index: 0, connected: true }]);
  assert.deepEqual(manager.listGamepads(), [{ name: 'Pad', connected: true }]);
  assert.equal(manager.findOutput('Out'), output);
  assert.equal(state.gamepads[0].name, 'Pad');
  assert.equal(manager.isSupported(), true);
  remove();
});

test('same-name MIDI ports use one connection-order key across input, Learn, protocol, and output', async () => {
  const { manager, store } = harness([]);
  const input1 = { id: 'input-1', name: 'Twin', state: 'connected', onmidimessage: null };
  const input2 = { id: 'input-2', name: 'Twin', state: 'connected', onmidimessage: null };
  const output1 = { id: 'output-1', name: 'Twin', state: 'connected' };
  const output2 = { id: 'output-2', name: 'Twin', state: 'connected' };
  const protocols = new Map();
  store.getDeviceProtocol = key => protocols.get(key) || 'generic';
  store.setDeviceProtocol = async (key, protocol) => {
    protocols.set(key, protocol);
    return true;
  };
  manager.midiAccess = {
    inputs: new Map([['in-1', input1], ['in-2', input2]]),
    outputs: new Map([['out-1', output1], ['out-2', output2]])
  };

  const inputs = manager.listInputs();
  const outputs = manager.listOutputs();
  assert.deepEqual(inputs.map(input => input.name), ['Twin', 'Twin']);
  assert.deepEqual(outputs.map(output => output.name), ['Twin', 'Twin']);
  assert.equal(inputs[0].key, 'Twin');
  assert.notEqual(inputs[1].key, inputs[0].key);
  assert.deepEqual(outputs.map(output => output.key), inputs.map(input => input.key));
  assert.equal(manager.getDeviceDisplayName(inputs[1].key), 'Twin');

  await manager.setDeviceProtocol(inputs[1].key, 'mcu');
  assert.equal(store.getDeviceProtocol(inputs[0].key), 'generic');
  assert.equal(store.getDeviceProtocol(inputs[1].key), 'mcu');
  assert.equal(manager.findOutput(inputs[0].key), output1);
  assert.equal(manager.findOutput(inputs[1].key), output2);

  manager.midiAccess.inputs.delete('in-1');
  manager.midiAccess.outputs.delete('out-1');
  assert.equal(manager.listInputs()[0].key, inputs[1].key);
  assert.equal(manager.listOutputs()[0].key, outputs[1].key);
  assert.equal(manager.findOutput(inputs[0].key), null);
  assert.equal(manager.findOutput(inputs[1].key), output2);
  assert.equal(store.getDeviceProtocol(inputs[1].key), 'mcu');

  const protocolReads = [];
  store.getDeviceProtocol = key => {
    protocolReads.push(key);
    return 'generic';
  };
  const learned = [];
  await manager.startLearn(result => learned.push(result));
  manager.onMidiMessage(input2, { data: [0xb0, 7, 100] });
  assert.equal(learned[0].device, inputs[1].key);

  const applied = [];
  manager.engine.onSourceEvent = (...args) => applied.push(args);
  manager.onMidiMessage(input2, { data: [0xb0, 8, 101] });
  assert.equal(applied[0][0], inputs[1].key);
  assert.deepEqual(protocolReads, [inputs[1].key, inputs[1].key]);

  const reconnectedInput1 = {
    id: 'input-1', name: 'Twin', state: 'connected', onmidimessage: null
  };
  const reconnectedOutput1 = { id: 'output-1', name: 'Twin', state: 'connected' };
  manager.midiAccess.inputs.set('in-1-reconnected', reconnectedInput1);
  manager.midiAccess.outputs.set('out-1-reconnected', reconnectedOutput1);
  assert.deepEqual(manager.listInputs().map(input => input.key), [inputs[1].key, inputs[0].key]);
  assert.deepEqual(manager.listOutputs().map(output => output.key), [outputs[1].key, outputs[0].key]);
  assert.equal(manager.findOutput(inputs[0].key), reconnectedOutput1);
  assert.equal(manager.findOutput(inputs[1].key), output2);
  manager.dispose();
});

test('MCU feedback keeps targeting the saved same-name output slot after another port disappears', () => {
  const sent1 = [];
  const sent2 = [];
  const output1 = {
    id: 'output-1', name: 'Twin', state: 'connected', send: message => sent1.push(message)
  };
  const output2 = {
    id: 'output-2', name: 'Twin', state: 'connected', send: message => sent2.push(message)
  };
  const store = {
    mappings: [],
    subscribe() { return () => {}; },
    getDeviceProtocol() { return 'mcu'; }
  };
  const localInputs = { cancelLearn() {}, dispose() {} };
  const engine = { dispose() {}, resolveTargets() { return []; } };
  const scheduler = { dispose() {} };
  const manager = new MidiControllerManager({
    windowRef: { pipelineManager: { core: { enabled: true } } },
    navigatorRef: {}, store, localInputSources: localInputs, engine,
    automationScheduler: scheduler
  });
  manager.midiAccess = {
    inputs: new Map(),
    outputs: new Map([['out-1', output1], ['out-2', output2]])
  };
  const [, second] = manager.listOutputs();
  store.mappings = [{
    id: 'led', device: second.key,
    source: { kind: 'mcuButton', channel: 0, number: 42 },
    target: { type: '_global', instance: 'first', param: 'masterBypass', element: 0 },
    map: { lo: 0, hi: 1 }
  }];
  manager.midiAccess.outputs.delete('out-1');
  manager.mcu.pollFeedback();
  assert.deepEqual(sent1, []);
  assert.deepEqual(sent2, [[0x90, 42, 0]]);
  manager.dispose();
});

test('manager cancels a local Learn request through the shared lifecycle', async () => {
  const { manager, localInputSources } = harness([]);
  await manager.startLearn(() => assert.fail('cancelled Learn must not produce a mapping'));
  assert.equal(manager.learnActive, true);
  localInputSources.cancelCallback();
  assert.equal(manager.learnActive, false);
  manager.dispose();
});

test('Learn captures MIDI input without applying existing mappings, including releases', async () => {
  const { manager } = harness([]);
  const applied = [];
  manager.engine.onSourceEvent = (...args) => applied.push(args);
  const learned = [];
  await manager.startLearn(result => learned.push(result));
  manager.onMidiMessage({ name: 'Input' }, { data: [0x80, 60, 0] });
  assert.deepEqual(applied, []);
  assert.deepEqual(learned, []);
  manager.onMidiMessage({ name: 'Input' }, { data: [0xb0, 7, 100] });
  assert.equal(learned.length, 1);
  assert.deepEqual(applied, []);
  manager.dispose();
});

test('Learn ignores MCU Note Off and Note On velocity-zero button releases', async () => {
  const { manager } = harness([]);
  const learned = [];
  manager.store.getDeviceProtocol = () => 'mcu';
  manager.mcu.decode = data => ({
    kind: 'mcuButton', channel: 0, number: data[1], pressed: data[0] === 0x90 && data[2] > 0
  });
  await manager.startLearn(result => learned.push(result));
  manager.onMidiMessage({ name: 'MCU' }, { data: [0x80, 42, 0] });
  manager.onMidiMessage({ name: 'MCU' }, { data: [0x90, 42, 0] });
  assert.deepEqual(learned, []);
  manager.dispose();
});
