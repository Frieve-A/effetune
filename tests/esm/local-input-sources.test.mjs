import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalInputSources,
  isTextEditingTarget,
  keyComboFromEvent
} from '../../js/midi/local-input-sources.js';

function fakeWindow() {
  const listeners = new Map();
  return {
    document: { activeElement: null },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    listeners
  };
}

test('keyboard input normalizes modifiers, respects editing, and consumes matches', () => {
  assert.equal(keyComboFromEvent({ key: 'ArrowUp', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+ArrowUp');
  assert.equal(Boolean(isTextEditingTarget({ tagName: 'INPUT' })), true);
  const calls = [];
  const windowRef = fakeWindow();
  const inputs = new LocalInputSources({
    engine: { onSourceEvent(...args) { calls.push(args); return true; }, setGamepadPoller() {}, setContinuousFrame() {} },
    store: { mappings: [] },
    windowRef,
    navigatorRef: { getGamepads: () => [] }
  });
  assert.equal(windowRef.listeners.has('gamepadconnected'), false);
  inputs.syncSubscriptions([{ source: { kind: 'key' } }]);
  const event = {
    key: 'ArrowUp', ctrlKey: true, target: { tagName: 'DIV' }, repeat: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  };
  windowRef.listeners.get('keydown')(event);
  assert.equal(calls[0][1].keyCombo, 'Ctrl+ArrowUp');
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  inputs.dispose();
});

test('Escape cancels learning without creating a key mapping', () => {
  const windowRef = fakeWindow();
  const calls = [];
  const inputs = new LocalInputSources({
    engine: { onSourceEvent() { calls.push('mapped'); }, setGamepadPoller() {}, setContinuousFrame() {} },
    store: { mappings: [] }, windowRef,
    navigatorRef: { getGamepads: () => [] }
  });
  let cancelled = false;
  inputs.startLearn(() => calls.push('learned'), () => { cancelled = true; });
  inputs.syncSubscriptions([], { dialogOpen: true });
  windowRef.listeners.get('keydown')({
    key: 'Escape', target: { tagName: 'DIV' },
    preventDefault() {}, stopImmediatePropagation() {}
  });
  assert.equal(cancelled, true);
  assert.deepEqual(calls, []);
  inputs.dispose();
});

test('Learn suppresses mapped key releases and unrelated gamepad controls', () => {
  const calls = [];
  const gamepad = { id: 'Pad', index: 0, connected: true, buttons: [{ pressed: true }], axes: [1] };
  const windowRef = fakeWindow();
  const inputs = new LocalInputSources({
    engine: { onSourceEvent(...args) { calls.push(args); return true; }, setGamepadPoller() {}, setContinuousFrame() {} },
    store: { mappings: [{ device: '', source: { kind: 'key', keyCombo: 'K' } }] },
    windowRef, navigatorRef: { getGamepads: () => [gamepad] }
  });
  inputs.syncSubscriptions(inputs.store.mappings, { dialogOpen: true });
  inputs.startLearn(() => {});
  windowRef.listeners.get('keyup')({ key: 'K', code: 'KeyK', target: { tagName: 'DIV' } });
  inputs.pollGamepads();
  assert.deepEqual(calls, []);
  inputs.dispose();
});

test('keyup releases the combo captured on keydown even after its modifier is released', () => {
  const calls = [];
  const windowRef = fakeWindow();
  const inputs = new LocalInputSources({
    engine: { onSourceEvent(...args) { calls.push(args); return true; }, setGamepadPoller() {}, setContinuousFrame() {} },
    store: { mappings: [{ device: '', source: { kind: 'key', keyCombo: 'Ctrl+ArrowUp' } }] },
    windowRef, navigatorRef: { getGamepads: () => [] }
  });
  inputs.syncSubscriptions(inputs.store.mappings);
  const down = { key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, target: { tagName: 'DIV' }, preventDefault() {}, stopImmediatePropagation() {} };
  const up = { key: 'ArrowUp', code: 'ArrowUp', ctrlKey: false, target: { tagName: 'DIV' }, preventDefault() {}, stopImmediatePropagation() {} };
  windowRef.listeners.get('keydown')(down);
  windowRef.listeners.get('keyup')(up);
  assert.deepEqual(calls.map(call => [call[1].keyCombo, call[2].pressed]), [
    ['Ctrl+ArrowUp', true], ['Ctrl+ArrowUp', false]
  ]);
  inputs.dispose();
});

test('modifier release and OS repeat do not replace the captured momentary combo', () => {
  const calls = [];
  const windowRef = fakeWindow();
  const inputs = new LocalInputSources({
    engine: {
      onSourceEvent(...args) {
        calls.push(args);
        return args[1]?.keyCombo === 'Ctrl+K';
      },
      setGamepadPoller() {}, setContinuousFrame() {}
    },
    store: { mappings: [{ device: '', source: { kind: 'key', keyCombo: 'Ctrl+K' } }] },
    windowRef, navigatorRef: { getGamepads: () => [] }
  });
  inputs.syncSubscriptions(inputs.store.mappings);
  const keydown = windowRef.listeners.get('keydown');
  const keyup = windowRef.listeners.get('keyup');
  const eventMethods = { preventDefault() {}, stopImmediatePropagation() {} };
  keydown({ key: 'k', code: 'KeyK', ctrlKey: true, repeat: false, target: { tagName: 'DIV' }, ...eventMethods });
  keyup({ key: 'Control', code: 'ControlLeft', ctrlKey: false, target: { tagName: 'DIV' }, ...eventMethods });
  keydown({ key: 'k', code: 'KeyK', ctrlKey: false, repeat: true, target: { tagName: 'DIV' }, ...eventMethods });
  keyup({ key: 'k', code: 'KeyK', ctrlKey: false, target: { tagName: 'DIV' }, ...eventMethods });
  assert.deepEqual(calls
    .filter(call => call[1].keyCombo === 'Ctrl+K')
    .map(call => [call[1].keyCombo, call[2].pressed]), [
    ['Ctrl+K', true], ['Ctrl+K', false]
  ]);
  inputs.dispose();
});

test('known playback shortcuts are flagged during key Learn', () => {
  const windowRef = fakeWindow();
  const inputs = new LocalInputSources({
    engine: { onSourceEvent() {}, setGamepadPoller() {}, setContinuousFrame() {} },
    store: { mappings: [] }, windowRef, navigatorRef: { getGamepads: () => [] }
  });
  let learned;
  inputs.startLearn(result => { learned = result; });
  inputs.syncSubscriptions([], { dialogOpen: true });
  windowRef.listeners.get('keydown')({
    key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, target: { tagName: 'DIV' },
    preventDefault() {}, stopImmediatePropagation() {}
  });
  assert.equal(learned.shortcutConflict, true);
  inputs.dispose();
});

test('gamepad axis learn compares against its start snapshot', () => {
  const gamepad = { id: 'Pad', index: 0, connected: true, buttons: [], axes: [-1] };
  const engine = { setGamepadPoller() {}, setContinuousFrame() {}, onSourceEvent() { return false; } };
  const inputs = new LocalInputSources({
    engine,
    store: { mappings: [] },
    windowRef: fakeWindow(),
    navigatorRef: { getGamepads: () => [gamepad] }
  });
  let learned = null;
  inputs.startLearn(result => { learned = result; });
  inputs.gamepadEnabled = true;
  inputs.pollGamepads();
  assert.equal(learned, null);
  gamepad.axes[0] = -0.4;
  inputs.pollGamepads();
  assert.equal(learned.source.kind, 'gamepadAxis');
  inputs.dispose();
});

test('gamepad button edges release when the device disconnects', () => {
  const calls = [];
  const gamepad = {
    id: 'Pad', index: 0, connected: true,
    buttons: [{ pressed: true }], axes: []
  };
  const windowRef = fakeWindow();
  const engine = {
    setGamepadPoller() {}, setContinuousFrame() {},
    onSourceEvent(...args) { calls.push(args); return true; }
  };
  const mapping = { device: 'Pad', source: { kind: 'gamepadButton', number: 0 } };
  const inputs = new LocalInputSources({
    engine, store: { mappings: [mapping] }, windowRef,
    navigatorRef: { getGamepads: () => [gamepad] }, now: () => 100
  });
  inputs.syncSubscriptions([mapping]);
  inputs.pollGamepads();
  windowRef.listeners.get('gamepaddisconnected')({ gamepad });
  assert.equal(calls[0][2].pressed, true);
  assert.equal(calls[1][2].pressed, false);
  inputs.dispose();
});

test('disconnecting one gamepad does not release another gamepad', () => {
  const calls = [];
  const pads = [
    { id: 'Pad A', index: 0, connected: true, buttons: [{ pressed: true }], axes: [] },
    { id: 'Pad B', index: 1, connected: true, buttons: [{ pressed: true }], axes: [] }
  ];
  const windowRef = fakeWindow();
  const engine = {
    setGamepadPoller() {}, setContinuousFrame() {},
    onSourceEvent(...args) { calls.push(args); return true; }
  };
  const mappings = pads.map(pad => ({
    device: pad.id,
    source: { kind: 'gamepadButton', number: 0 }
  }));
  const inputs = new LocalInputSources({
    engine, store: { mappings }, windowRef,
    navigatorRef: { getGamepads: () => pads }, now: () => 100
  });
  inputs.syncSubscriptions(mappings);
  inputs.pollGamepads();
  windowRef.listeners.get('gamepaddisconnected')({ gamepad: pads[0] });
  const releases = calls.filter(call => call[2].pressed === false);
  assert.deepEqual(releases.map(call => call[0]), ['Pad A']);
  assert.equal(inputs.gamepadStates.has(1), true);
  inputs.dispose();
});
