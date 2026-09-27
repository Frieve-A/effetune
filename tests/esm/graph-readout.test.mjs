import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../plugins/graph-readout.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(source, { window });
const { format, pathValueAt, seriesValueAt, historyValueAt, columnValueAt } = window.GraphReadout;
// Copy results out of the vm realm so deepEqual compares plain objects.
const place = options => ({ ...window.GraphReadout.place(options) });
const toSurface = (...args) => ({ ...window.GraphReadout.toSurface(...args) });
const fromSurface = (...args) => ({ ...window.GraphReadout.fromSurface(...args) });

const rectOf = (left, top, width, height) => ({ left, top, width, height });

test('format handles each unit boundary and non-finite values', () => {
  assert.equal(format.frequency(42.5), '42.5 Hz');
  assert.equal(format.frequency(440), '440 Hz');
  assert.equal(format.frequency(1234), '1.23 kHz');
  assert.equal(format.frequency(12345), '12.3 kHz');
  assert.equal(format.frequency(NaN), '—');

  assert.equal(format.db(-3.21), '−3.2 dB');
  assert.equal(format.db(3.21), '3.2 dB');
  assert.equal(format.db(2, { signed: true }), '+2.0 dB');
  assert.equal(format.db(-2, { signed: true }), '−2.0 dB');
  assert.equal(format.db(-Infinity), '−∞ dB');
  assert.equal(format.db(-0.01, { signed: true }), '+0.0 dB', 'no negative zero');
  assert.equal(format.number(-0.001), '0.00');
  assert.equal(format.db(Infinity), '—');

  assert.equal(format.time(1.234), '1.23 ms');
  assert.equal(format.time(-12.34), '−12.3 ms');
  assert.equal(format.time(1500), '1.50 s');
  assert.equal(format.time(null), '—');

  assert.equal(format.note(440), 'A4 +0¢');
  assert.equal(format.note(466.1638), 'A#4 +0¢');
  assert.equal(format.note(450), 'A4 +39¢');
  assert.equal(format.note(430), 'A4 −40¢');
  assert.equal(format.note(0), '—');

  assert.equal(format.degrees(-45.4), '−45°');
  assert.equal(format.number(1.234), '1.23');
  assert.equal(format.number(-1.5, 1), '−1.5');
  assert.equal(format.percent(0.5), '50%');
  assert.equal(format.percent(NaN), '—');
});

test('pathValueAt interpolates inside segments and never across a moveTo gap', () => {
  let d = 'M 0,10 L 10,20 L 20,0 M 30,5 L 40,15';
  const path = { getAttribute: () => d };
  assert.equal(pathValueAt(path, 5), 15);
  assert.equal(pathValueAt(path, 15), 10);
  assert.equal(pathValueAt(path, 25), null);
  assert.equal(pathValueAt(path, 35), 10);
  assert.equal(pathValueAt(path, -1), null);
  assert.equal(pathValueAt(path, 41), null);
  d = 'M0,0L10,100';
  assert.equal(pathValueAt(path, 5), 50, 'a changed d attribute is re-parsed');
});

test('seriesValueAt interpolates between ascending xs and returns null outside or next to gaps', () => {
  const xs = [0, 10, 10, 30, 40, 50];
  const ys = [0, 20, 50, NaN, 5, 15];
  assert.equal(seriesValueAt(xs, ys, 0), 0, 'the first point is inside');
  assert.equal(seriesValueAt(xs, ys, 5), 10);
  assert.equal(seriesValueAt(xs, ys, 45), 10);
  assert.equal(seriesValueAt(xs, ys, 50), 15, 'the last point is inside');
  assert.equal(seriesValueAt(xs, ys, -0.1), null);
  assert.equal(seriesValueAt(xs, ys, 50.1), null);
  assert.equal(seriesValueAt(xs, ys, NaN), null);
  assert.equal(seriesValueAt(xs, ys, 20), null, 'next to a non-finite value');
  assert.equal(seriesValueAt([], [], 0), null);
  assert.equal(seriesValueAt([5, 5], [1, 2], 5), 1, 'a zero-width step takes its first value');
});

test('place prefers top-right, avoids occupied rects in order and keeps a clear previous corner', () => {
  const area = rectOf(0, 0, 200, 100);
  const bounds = { width: 200, height: 100 };
  const size = { width: 50, height: 20 };
  assert.deepEqual(place({ area, size, bounds }), { corner: 'top-right', left: 146, top: 4 });

  const toggle = rectOf(150, 0, 50, 30);
  assert.equal(place({ area, size, bounds, occupied: [toggle] }).corner, 'top-left');
  const pointer = rectOf(0, 0, 60, 30);
  assert.equal(place({ area, size, bounds, occupied: [toggle, pointer] }).corner, 'bottom-right');
  // Touch band: the finger covers the right half from above the touch point to the bottom.
  const touchBand = rectOf(100, 0, 100, 100);
  assert.equal(place({ area, size, bounds, occupied: [touchBand] }).corner, 'top-left');

  assert.equal(place({ area, size, bounds, previous: 'bottom-left' }).corner, 'bottom-left');
  assert.equal(place({ area, size, bounds, previous: 'bottom-left', occupied: [rectOf(0, 70, 60, 30)] }).corner,
    'top-right');

  const everywhere = [rectOf(0, 0, 200, 100), rectOf(140, 0, 10, 10)];
  assert.equal(place({ area, size, bounds, occupied: everywhere }).corner, 'top-left', 'least overlap wins');

  const wide = place({ area: rectOf(-20, -10, 300, 200), size, bounds });
  assert.deepEqual([wide.left, wide.top], [150, 0], 'candidates stay inside the mount');
});

test('surface units convert to and from client px for canvases and SVG viewBoxes', () => {
  const clientRect = { left: 10, top: 20, width: 400, height: 200 };
  // Canvas drawn in device px (DPR 2): surface units are canvas.width/height.
  const canvas = { width: 800, height: 400, getBoundingClientRect: () => clientRect };
  assert.deepEqual(toSurface(canvas, 110, 70), { x: 200, y: 100 });
  assert.deepEqual(fromSurface(canvas, 200, 100), { x: 110, y: 70 });
  // A setTransform(dpr) canvas uses the same surface units; its CSS-px value is x / dpr.
  const cssX = toSurface(canvas, 110, 70).x / 2;
  assert.equal(cssX, 100);

  const svg = {
    viewBox: { baseVal: { x: -10, y: 5, width: 100, height: 50 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 })
  };
  assert.deepEqual(toSurface(svg, 100, 50), { x: 40, y: 30 });
  assert.deepEqual(fromSurface(svg, 40, 30), { x: 100, y: 50 });

  const bareSvg = { viewBox: { baseVal: { x: 0, y: 0, width: 0, height: 0 } }, getBoundingClientRect: () => clientRect };
  assert.deepEqual(toSurface(bareSvg, 110, 70), { x: 100, y: 50 });
});

test('historyValueAt holds the edge value after the newest sample and interpolates only short gaps', () => {
  const times = [0, 0.5, 1, 3, 3.5, NaN];
  const values = [0, 10, 20, 40, NaN, 99];
  // Newest finite sample is t = 3 (index 3); the NaN value and NaN time behind it are skipped.
  assert.equal(historyValueAt(times, values, 3, -1), -1);
  assert.equal(historyValueAt(times, values, 10, -1), -1);
  assert.equal(historyValueAt(times, values, 0.25, -1), 5);
  assert.equal(historyValueAt(times, values, 0.75, -1), 15);
  assert.ok(Number.isNaN(historyValueAt(times, values, 2, -1)), 'a gap longer than 1 s is not bridged');
  assert.ok(Number.isNaN(historyValueAt(times, values, -1, -1)), 'before the oldest sample');
  assert.ok(Number.isNaN(historyValueAt([0, 1], [NaN, 5], 0.5, -1)), 'next to a non-finite value');
  assert.equal(historyValueAt([0, 0, 1], [1, 2, 3], 0, -1), 2, 'equal times take the newer value');
  assert.ok(Number.isNaN(historyValueAt([0, 1], [NaN, NaN], 0.5, -1)), 'no finite sample');
});

test('columnValueAt interpolates between pixel columns and returns null outside or next to gaps', () => {
  const values = [0, 10, NaN, 30];
  assert.equal(columnValueAt(values, 0), 0);
  assert.equal(columnValueAt(values, 0.5), 5);
  assert.equal(columnValueAt(values, 1), 10);
  assert.equal(columnValueAt(values, 3), 30, 'the last column is inside');
  assert.equal(columnValueAt(values, 1.5), null);
  assert.equal(columnValueAt(values, 2), null);
  assert.equal(columnValueAt(values, -0.1), null);
  assert.equal(columnValueAt(values, 3.1), null);
  assert.equal(columnValueAt(values, NaN), null);
  assert.equal(columnValueAt([], 0), null);
});
