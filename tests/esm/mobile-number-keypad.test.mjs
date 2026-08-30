import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MobileNumberKeypad,
  commitMobileNumberInput,
  editMobileNumberBuffer,
  normalizeMobileNumberBuffer
} from '../../js/ui/mobile-number-keypad.js';

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = options.bubbles === true;
  }
}

class FakeDocument {
  constructor() {
    this.defaultView = { Event: FakeEvent };
    this.listeners = new Map();
    this.bodyClasses = new Set(['layout-mobile']);
    this.body = {
      classList: {
        add: name => this.bodyClasses.add(name),
        contains: name => this.bodyClasses.has(name),
        remove: name => this.bodyClasses.delete(name)
      }
    };
    this.activeElement = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(candidate => candidate !== listener));
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  contains() {
    return true;
  }
}

test('replaces the preset value on the first digit and preserves its sign', () => {
  let state = { buffer: '0.6', replaceOnNextDigit: true };
  state = editMobileNumberBuffer(state, '2');
  state = editMobileNumberBuffer(state, 'decimal');
  state = editMobileNumberBuffer(state, '5');
  assert.deepEqual(state, { buffer: '2.5', replaceOnNextDigit: false });

  state = { buffer: '3', replaceOnNextDigit: true };
  state = editMobileNumberBuffer(state, 'toggle-sign');
  state = editMobileNumberBuffer(state, '7');
  assert.deepEqual(state, { buffer: '-7', replaceOnNextDigit: false });
});

test('supports clear, backspace, decimal, and leading-zero edits', () => {
  let state = { buffer: '-12', replaceOnNextDigit: false };
  state = editMobileNumberBuffer(state, 'backspace');
  assert.equal(state.buffer, '-1');
  state = editMobileNumberBuffer(state, 'clear');
  state = editMobileNumberBuffer(state, 'decimal');
  state = editMobileNumberBuffer(state, '6');
  assert.equal(state.buffer, '0.6');

  state = { buffer: '0', replaceOnNextDigit: false };
  state = editMobileNumberBuffer(state, '4');
  assert.equal(state.buffer, '4');
});

test('normalizes only complete finite values', () => {
  assert.equal(normalizeMobileNumberBuffer('-3.0'), '-3');
  assert.equal(normalizeMobileNumberBuffer('0.60'), '0.6');
  assert.equal(normalizeMobileNumberBuffer(''), null);
  assert.equal(normalizeMobileNumberBuffer('-'), null);
  assert.equal(normalizeMobileNumberBuffer('Infinity'), null);
});

test('commits through the existing input, change, and blur event flow', () => {
  const documentRef = new FakeDocument();
  const events = [];
  const input = {
    value: '1',
    dispatchEvent(event) {
      events.push([event.type, event.bubbles]);
      return true;
    }
  };

  assert.equal(commitMobileNumberInput(input, '-3.0', documentRef), true);
  assert.equal(input.value, '-3');
  assert.deepEqual(events, [
    ['input', true],
    ['change', true],
    ['blur', false]
  ]);
  assert.equal(commitMobileNumberInput(input, '-', documentRef), false);
  assert.equal(events.length, 3);
});

test('suppresses the native keyboard while open and restores the input on commit', () => {
  const documentRef = new FakeDocument();
  const keypad = new MobileNumberKeypad({ documentRef });
  const attributes = new Map([['inputmode', 'decimal']]);
  const classes = new Set();
  const events = [];
  const input = {
    value: '0.6',
    readOnly: false,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name)
    },
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    dispatchEvent(event) {
      events.push(event.type);
      return true;
    }
  };
  keypad.buildView = () => {
    keypad.root = { hidden: true };
    keypad.display = {
      textContent: '',
      classList: { toggle() {} }
    };
    keypad.okButton = { disabled: false };
    keypad.numberButtons = [{ focus() {} }];
  };
  keypad.updateLabels = () => {};

  keypad.open(input);
  assert.equal(input.readOnly, true);
  assert.equal(attributes.get('inputmode'), 'none');
  assert.equal(classes.has('mobile-number-keypad-target'), true);
  assert.equal(keypad.root.hidden, false);

  const keyEvent = {
    key: '2',
    prevented: 0,
    stopped: 0,
    preventDefault() {
      this.prevented++;
    },
    stopPropagation() {
      this.stopped++;
    }
  };
  documentRef.dispatch('keydown', keyEvent);
  assert.equal(keyEvent.prevented, 1);
  assert.equal(keyEvent.stopped, 1);
  assert.equal(keypad.commit(), true);
  assert.equal(input.value, '2');
  assert.equal(input.readOnly, false);
  assert.equal(attributes.get('inputmode'), 'decimal');
  assert.equal(classes.has('mobile-number-keypad-target'), false);
  assert.deepEqual(events, ['input', 'change', 'blur']);
  assert.equal(keypad.root.hidden, true);
  assert.equal(documentRef.bodyClasses.has('mobile-number-keypad-open'), false);
  keypad.dispose();
});

test('keeps Tab focus cycling through enabled keypad buttons', () => {
  const documentRef = new FakeDocument();
  const keypad = new MobileNumberKeypad({ documentRef });
  const focusCalls = [];
  const buttons = [
    { disabled: false, focus: options => {
      focusCalls.push(['first', options]);
      documentRef.activeElement = buttons[0];
    } },
    { disabled: true, focus: () => focusCalls.push(['disabled']) },
    { disabled: false, focus: options => {
      focusCalls.push(['last', options]);
      documentRef.activeElement = buttons[2];
    } }
  ];
  keypad.target = {};
  keypad.dialog = { querySelectorAll: () => buttons };

  documentRef.activeElement = buttons[0];
  const forward = {
    key: 'Tab',
    shiftKey: false,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented++; },
    stopPropagation() { this.stopped++; }
  };
  documentRef.dispatch('keydown', forward);
  assert.equal(documentRef.activeElement, buttons[2]);
  assert.deepEqual(focusCalls, [['last', { preventScroll: true }]]);
  assert.equal(forward.prevented, 1);
  assert.equal(forward.stopped, 1);

  const backward = {
    key: 'Tab',
    shiftKey: true,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented++; },
    stopPropagation() { this.stopped++; }
  };
  documentRef.dispatch('keydown', backward);
  assert.equal(documentRef.activeElement, buttons[0]);
  assert.deepEqual(focusCalls, [
    ['last', { preventScroll: true }],
    ['first', { preventScroll: true }]
  ]);
  assert.equal(backward.prevented, 1);
  assert.equal(backward.stopped, 1);
  keypad.dispose();
});

test('intercepts only enabled effect parameter number inputs on pointerdown', () => {
  const documentRef = new FakeDocument();
  let enabled = true;
  const keypad = new MobileNumberKeypad({ documentRef, isEnabled: () => enabled });
  const input = {
    disabled: false,
    readOnly: false,
    matches: selector => selector === '.plugin-parameter-ui input[type="number"]'
  };
  let opened = null;
  keypad.open = target => {
    opened = target;
  };
  const pointer = {
    target: input,
    button: 0,
    isPrimary: true,
    prevented: 0,
    preventDefault() {
      this.prevented++;
    }
  };

  documentRef.dispatch('pointerdown', pointer);
  assert.equal(opened, input);
  assert.equal(pointer.prevented, 1);

  opened = null;
  enabled = false;
  documentRef.dispatch('pointerdown', pointer);
  assert.equal(opened, null);
  assert.equal(pointer.prevented, 1);

  keypad.dispose();
  assert.equal(documentRef.listeners.get('pointerdown').length, 0);
});

test('defines a three-column, touch-sized mobile keypad overlay', async () => {
  const css = await readFile(new URL('../../effetune-mobile.css', import.meta.url), 'utf8');
  assert.match(css, /\.mobile-number-keypad-overlay\s*\{[^}]*position:\s*fixed;[^}]*touch-action:\s*none;/s);
  assert.match(css, /\.mobile-number-keypad-keys\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
  assert.match(css, /\.mobile-number-keypad-button\s*\{[^}]*min-height:\s*48px;/s);
});
