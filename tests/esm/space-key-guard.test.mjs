import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleSpaceKeyDown,
  installSpaceKeyGuard,
  isPlainSpaceKeyEvent,
  needsSpaceDefault
} from '../../js/utils/space-key-guard.js';

function createTarget({ tagName, type, isContentEditable = false } = {}) {
  return {
    tagName,
    type,
    isContentEditable,
    getAttribute(name) {
      return name === 'type' ? type : undefined;
    }
  };
}

function createEvent(target, overrides = {}) {
  const event = {
    key: ' ',
    target,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...overrides
  };
  return event;
}

function createDocument() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, handler, capture) {
      listeners.push({ type, handler, capture });
    },
    removeEventListener(type, handler, capture) {
      const index = listeners.findIndex(entry =>
        entry.type === type && entry.handler === handler && entry.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatch(event) {
      for (const entry of listeners) entry.handler(event);
      return event;
    }
  };
}

test('plain Space on a non-editable target loses the page-scroll default', () => {
  const event = createEvent(createTarget({ tagName: 'BODY' }));
  assert.equal(handleSpaceKeyDown(event), true);
  assert.equal(event.prevented, true);
});

test('legacy Spacebar key names are treated as Space', () => {
  const event = createEvent(createTarget({ tagName: 'DIV' }), { key: 'Spacebar' });
  assert.equal(handleSpaceKeyDown(event), true);
  assert.equal(event.prevented, true);
});

test('keys other than Space are left untouched', () => {
  const event = createEvent(createTarget({ tagName: 'BODY' }), { key: 'a' });
  assert.equal(handleSpaceKeyDown(event), false);
  assert.equal(event.prevented, false);
});

test('modified Space presses keep their browser behavior', () => {
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    const event = createEvent(createTarget({ tagName: 'BODY' }), { [modifier]: true });
    assert.equal(handleSpaceKeyDown(event), false, modifier);
    assert.equal(event.prevented, false, modifier);
  }
});

test('Shift+Space still loses the page-scroll default', () => {
  const event = createEvent(createTarget({ tagName: 'BODY' }), { shiftKey: true });
  assert.equal(handleSpaceKeyDown(event), true);
  assert.equal(event.prevented, true);
});

test('Space during IME composition is left to the input method', () => {
  const composing = createEvent(createTarget({ tagName: 'DIV' }), { isComposing: true });
  assert.equal(handleSpaceKeyDown(composing), false);
  assert.equal(composing.prevented, false);

  const legacyComposing = createEvent(createTarget({ tagName: 'DIV' }), { keyCode: 229 });
  assert.equal(handleSpaceKeyDown(legacyComposing), false);
  assert.equal(legacyComposing.prevented, false);
});

test('an event without a key is not mistaken for Space', () => {
  assert.equal(isPlainSpaceKeyEvent(null), false);
  assert.equal(isPlainSpaceKeyEvent({}), false);
});

test('Space keeps typing into text fields and activating controls', () => {
  assert.equal(needsSpaceDefault(createTarget({ tagName: 'TEXTAREA' })), true);
  assert.equal(needsSpaceDefault(createTarget({ tagName: 'BUTTON' })), true);
  assert.equal(needsSpaceDefault(createTarget({ tagName: 'SELECT' })), true);
  assert.equal(needsSpaceDefault(createTarget({ tagName: 'INPUT', type: 'text' })), true);
  assert.equal(needsSpaceDefault(createTarget({ tagName: 'INPUT', type: 'checkbox' })), true);
  assert.equal(needsSpaceDefault(createTarget({ tagName: 'DIV', isContentEditable: true })), true);
});

test('an input without a type attribute is treated as a text field', () => {
  const target = { tagName: 'INPUT' };
  assert.equal(needsSpaceDefault(target), true);
});

test('Space on a slider or a plain element is cancelled', () => {
  assert.equal(needsSpaceDefault(createTarget({ tagName: 'INPUT', type: 'range' })), false);
  assert.equal(needsSpaceDefault(createTarget({ tagName: 'DIV' })), false);
  assert.equal(needsSpaceDefault(null), false);
});

test('the guard listens in the capture phase and can be removed', () => {
  const documentRef = createDocument();
  const uninstall = installSpaceKeyGuard(documentRef);
  assert.equal(documentRef.listeners.length, 1);
  assert.equal(documentRef.listeners[0].type, 'keydown');
  assert.equal(documentRef.listeners[0].capture, true);

  const event = documentRef.dispatch(createEvent(createTarget({ tagName: 'BODY' })));
  assert.equal(event.prevented, true);

  uninstall();
  assert.equal(documentRef.listeners.length, 0);
  const afterRemoval = documentRef.dispatch(createEvent(createTarget({ tagName: 'BODY' })));
  assert.equal(afterRemoval.prevented, false);
});

test('installing without a document is a no-op', () => {
  const uninstall = installSpaceKeyGuard(undefined);
  assert.doesNotThrow(() => uninstall());
});

test('a document without removeEventListener does not break uninstall', () => {
  const documentRef = { addEventListener() {} };
  const uninstall = installSpaceKeyGuard(documentRef);
  assert.doesNotThrow(() => uninstall());
});
