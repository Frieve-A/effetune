import assert from 'node:assert/strict';
import test from 'node:test';
import { bindNumberInput, updateRangeFill } from '../../js/ui/range-fill.js';
import { commitMobileNumberInput } from '../../js/ui/mobile-number-keypad.js';

test('classic plugins and mobile commits use the shared number binding', () => {
  assert.equal(globalThis.bindEffeTuneNumberInput, bindNumberInput);
  const input = Object.assign(new EventTarget(), { value: '-10' });
  const slider = { value: '20' };
  const values = [];
  const applied = bindNumberInput(input, slider, -30, 0, -10,
    value => values.push(value), value => value + 30, value => value.toFixed(1));
  const documentRef = { defaultView: { Event } };

  assert.equal(commitMobileNumberInput(input, '-50', documentRef), true);
  assert.equal(input.value, '-30.0');
  assert.equal(slider.value, 0);
  assert.equal(applied.value, -30);
  assert.deepEqual(values, [-30]);

  assert.equal(commitMobileNumberInput(input, '-20', documentRef), true);
  assert.equal(input.value, '-20.0');
  assert.equal(slider.value, 10);
  assert.equal(applied.value, -20);
  assert.deepEqual(values, [-30, -20]);
});

function fill(min, max, value, origin) {
  const properties = new Map();
  updateRangeFill({
    min: String(min), max: String(max), value: String(value),
    dataset: origin === undefined ? {} : { rangeFillOrigin: String(origin) },
    matches: selector => selector === 'input[type="range"]',
    style: { setProperty: (key, value) => properties.set(key, value) }
  });
  return [properties.get('--et-range-origin'), properties.get('--et-range-fill')];
}

test('bipolar slider fills extend from zero in symmetric and asymmetric ranges', () => {
  assert.deepEqual(fill(-12, 12, -6), ['50%', '25%']);
  assert.deepEqual(fill(-12, 12, 0), ['50%', '50%']);
  assert.deepEqual(fill(-12, 12, 6), ['50%', '75%']);
  assert.deepEqual(fill(-10, 30, -10), ['25%', '0%']);
  assert.deepEqual(fill(-10, 30, 0), ['25%', '25%']);
  assert.deepEqual(fill(-10, 30, 30), ['25%', '100%']);
});

test('one-sided ranges retain their minimum as the fill origin', () => {
  assert.deepEqual(fill(0, 100, 30), ['0%', '30%']);
  assert.deepEqual(fill(20, 20000, 20), ['0%', '0%']);
  assert.deepEqual(fill(-60, 0, -30), ['0%', '50%']);
  assert.deepEqual(fill(-200, 200, 100), ['50%', '75%']);
});

test('ratio fills use the explicit origin in slider coordinates', () => {
  const [neutralOrigin, neutralValue] = fill(0.5, 20, 1, 1).map(Number.parseFloat);
  assert.equal(neutralOrigin, neutralValue);
  assert.ok(Math.abs(neutralOrigin - 100 / 39) < 1e-10);
  const [origin, below] = fill(0.05, 20, 0.5, 1).map(Number.parseFloat);
  assert.ok(below < origin);
  const [, above] = fill(0.05, 20, 2, 1).map(Number.parseFloat);
  assert.ok(above > origin);
  assert.deepEqual(fill(0, 100, 50, 50), ['50%', '50%']);
  const [dynamicOrigin, dynamicValue] = fill(-100, 200, 0);
  assert.equal(dynamicOrigin, dynamicValue);
  assert.deepEqual(fill(1, 100, 1), ['0%', '0%']);
});
