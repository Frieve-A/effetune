import assert from 'node:assert/strict';
import test from 'node:test';

import { installRangePrecisionControl } from '../../js/ui/range-precision-controller.js';

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = options.bubbles === true;
  }
}

class FakeControl {
  constructor(documentRef, {
    id = '',
    type = 'range',
    min = '0',
    max = '100',
    step = '1',
    value = '0',
    vertical = false
  } = {}) {
    this.ownerDocument = documentRef;
    this.id = id;
    this.type = type;
    this.min = min;
    this.max = max;
    this.step = step;
    this.value = value;
    this.disabled = false;
    this.dataset = {};
    this.style = { cursor: '' };
    this.listeners = new Map();
    this.events = [];
    this.capturedPointerId = null;
    this.releasedPointerId = null;
    this.focused = false;
    this.vertical = vertical;
    this.classList = {
      contains: className => className === 'vertical-slider' && this.vertical
    };
  }

  matches(selector) {
    return selector === 'input[type="range"]' &&
      this.type === 'range';
  }

  getBoundingClientRect() {
    return this.vertical
      ? { width: 20, height: 200 }
      : { width: 200, height: 20 };
  }

  focus() {
    this.focused = true;
  }

  setPointerCapture(pointerId) {
    this.capturedPointerId = pointerId;
  }

  releasePointerCapture(pointerId) {
    this.releasedPointerId = pointerId;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    event.target = this;
    for (const listener of this.listeners.get(event.type) || []) {
      listener(event);
    }
    return true;
  }
}

class FakeDocument {
  constructor() {
    this.defaultView = { Event: FakeEvent };
    this.listeners = new Map();
    this.elementsById = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(candidate => candidate !== listener));
  }

  getElementById(id) {
    return this.elementsById.get(id) || null;
  }

  add(control) {
    if (control.id) this.elementsById.set(control.id, control);
    return control;
  }

  dispatchPointer(type, overrides = {}) {
    const event = {
      target: overrides.target,
      pointerId: overrides.pointerId ?? 1,
      clientX: overrides.clientX ?? 0,
      clientY: overrides.clientY ?? 0,
      button: overrides.button ?? 0,
      shiftKey: overrides.shiftKey === true,
      isPrimary: overrides.isPrimary ?? true,
      prevented: 0,
      preventDefault() {
        this.prevented++;
      }
    };
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
    return event;
  }
}

test('keeps native range dragging unchanged without Shift', () => {
  const documentRef = new FakeDocument();
  const slider = documentRef.add(new FakeControl(documentRef, {
    min: '0',
    max: '10',
    step: '0.1',
    value: '1'
  }));
  const dispose = installRangePrecisionControl(documentRef);

  const down = documentRef.dispatchPointer('pointerdown', {
    target: slider,
    clientX: 20
  });
  documentRef.dispatchPointer('pointermove', {
    target: slider,
    clientX: 40
  });

  assert.equal(down.prevented, 0);
  assert.equal(slider.value, '1');
  assert.deepEqual(slider.events, []);
  dispose();
});

test('adjusts a horizontal range by one step per four pixels with Shift', () => {
  const documentRef = new FakeDocument();
  const slider = documentRef.add(new FakeControl(documentRef, {
    min: '0',
    max: '10',
    step: '0.1',
    value: '1'
  }));
  const dispose = installRangePrecisionControl(documentRef);

  const down = documentRef.dispatchPointer('pointerdown', {
    target: slider,
    clientX: 20,
    shiftKey: true
  });
  const move = documentRef.dispatchPointer('pointermove', {
    target: slider,
    clientX: 29
  });

  assert.equal(down.prevented, 1);
  assert.equal(move.prevented, 1);
  assert.equal(slider.value, '1.2');
  assert.deepEqual(slider.events, ['input']);
  assert.equal(slider.focused, true);
  assert.equal(slider.capturedPointerId, 1);
  assert.equal(slider.style.cursor, 'ew-resize');

  documentRef.dispatchPointer('pointerup', { target: slider, clientX: 29 });

  assert.deepEqual(slider.events, ['input', 'change']);
  assert.equal(slider.releasedPointerId, 1);
  assert.equal(slider.style.cursor, '');
  dispose();
});

test('uses upward movement for vertical sliders and clamps repeated moves', () => {
  const documentRef = new FakeDocument();
  const slider = documentRef.add(new FakeControl(documentRef, {
    min: '-1',
    max: '0.2',
    step: '0.1',
    value: '0',
    vertical: true
  }));
  const dispose = installRangePrecisionControl(documentRef);

  documentRef.dispatchPointer('pointerdown', {
    target: slider,
    clientY: 100,
    shiftKey: true
  });
  documentRef.dispatchPointer('pointermove', {
    target: slider,
    clientY: 91
  });
  documentRef.dispatchPointer('pointermove', {
    target: slider,
    clientY: 80
  });

  assert.equal(slider.value, '0.2');
  assert.deepEqual(slider.events, ['input']);
  assert.equal(slider.style.cursor, 'ns-resize');

  documentRef.dispatchPointer('pointercancel', { target: slider });
  assert.deepEqual(slider.events, ['input']);
  assert.equal(slider.style.cursor, '');
  dispose();
});

test('updates the semantic number input configured for a logarithmic range', () => {
  const documentRef = new FakeDocument();
  const slider = documentRef.add(new FakeControl(documentRef, {
    id: 'ratio-slider',
    min: '0',
    max: '100',
    step: '0.1',
    value: '50'
  }));
  const valueInput = documentRef.add(new FakeControl(documentRef, {
    id: 'ratio-value',
    type: 'number',
    min: '0.05',
    max: '20',
    step: '0.01',
    value: '0.5'
  }));
  slider.dataset.rangeFineTarget = valueInput.id;
  slider.dataset.rangeFineMin = '0.05';
  slider.dataset.rangeFineMax = '20';
  slider.dataset.rangeFineStep = '0.01';
  valueInput.addEventListener('input', () => {
    slider.value = `position-for-${valueInput.value}`;
  });
  const dispose = installRangePrecisionControl(documentRef);

  documentRef.dispatchPointer('pointerdown', {
    target: slider,
    clientX: 10,
    shiftKey: true
  });
  documentRef.dispatchPointer('pointermove', {
    target: slider,
    clientX: 18
  });
  documentRef.dispatchPointer('pointerup', {
    target: slider,
    clientX: 18
  });

  assert.equal(valueInput.value, '0.52');
  assert.equal(slider.value, 'position-for-0.52');
  assert.deepEqual(valueInput.events, ['input', 'change']);
  assert.deepEqual(slider.events, []);
  dispose();
});

test('installs only one delegated controller per document', () => {
  const documentRef = new FakeDocument();
  const firstDispose = installRangePrecisionControl(documentRef);
  const secondDispose = installRangePrecisionControl(documentRef);

  assert.equal(firstDispose, secondDispose);
  assert.equal(documentRef.listeners.get('pointerdown').length, 1);

  firstDispose();
  assert.equal(documentRef.listeners.get('pointerdown').length, 0);
});
