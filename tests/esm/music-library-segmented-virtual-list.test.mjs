import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_VIRTUAL_SEGMENT_PX,
  SegmentedVirtualListGeometry
} from '../../js/ui/library/segmented-virtual-list.js';

test('segmented geometry keeps a five million row scroll window below the browser pixel limit', () => {
  const geometry = new SegmentedVirtualListGeometry({ rowCount: 5_000_000, rowHeight: 56 });
  const ordinal = 4_321_987;
  const location = geometry.locateOrdinal(ordinal);
  const window = geometry.createWindow(ordinal);

  assert.equal(location.ordinal, ordinal);
  assert.ok(location.offsetPx < MAX_VIRTUAL_SEGMENT_PX);
  assert.ok(window.startOrdinal <= ordinal);
  assert.ok(window.endOrdinal > ordinal);
  assert.ok(window.heightPx <= MAX_VIRTUAL_SEGMENT_PX * 3);
  assert.equal(window.anchorOffsetPx, (ordinal - window.startOrdinal) * 56);
});

test('segmented geometry preserves exact first and last row locations', () => {
  const geometry = new SegmentedVirtualListGeometry({ rowCount: 1_000_001, rowHeight: 40 });
  const first = geometry.locateOrdinal(0);
  const last = geometry.locateOrdinal(1_000_000);

  assert.deepEqual(first, {
    ordinal: 0,
    segmentIndex: 0,
    segmentStartOrdinal: 0,
    ordinalInSegment: 0,
    offsetPx: 0
  });
  assert.equal(last.segmentIndex, geometry.segmentCount - 1);
  assert.equal(last.segmentStartOrdinal + last.ordinalInSegment, 1_000_000);
});

test('render range stays bounded to the active three-segment window', () => {
  const geometry = new SegmentedVirtualListGeometry({ rowCount: 5_000_000, rowHeight: 40 });
  const window = geometry.createWindow(2_500_000);
  const range = geometry.getRenderRange({
    window,
    scrollTop: window.anchorOffsetPx,
    viewportHeight: 800,
    bufferRows: 12
  });

  assert.equal(range.startOrdinal, 2_500_000 - 12);
  assert.equal(range.endOrdinal, 2_500_000 + 20 + 12);
  assert.ok(range.startOrdinal >= window.startOrdinal);
  assert.ok(range.endOrdinal <= window.endOrdinal);
});

test('scroll rebasing preserves the exact logical row while changing physical segments', () => {
  const geometry = new SegmentedVirtualListGeometry({ rowCount: 5_000_000, rowHeight: 40 });
  const firstWindow = geometry.createWindow(0);
  const target = geometry.rowsPerSegment + 25;
  const physicalTop = (target - firstWindow.startOrdinal) * geometry.rowHeight;
  const rebased = geometry.rebaseWindow({
    window: firstWindow,
    scrollTop: physicalTop,
    viewportHeight: 800
  });

  assert.equal(rebased.changed, true);
  assert.equal(rebased.anchorOrdinal, target);
  assert.equal(
    rebased.window.startOrdinal + Math.floor(rebased.scrollTop / geometry.rowHeight),
    target
  );
  for (let segment = rebased.window.firstSegmentIndex; segment <= rebased.window.lastSegmentIndex; segment += 1) {
    assert.ok(geometry.getSegment(segment).heightPx <= MAX_VIRTUAL_SEGMENT_PX);
  }
});

test('scrolling to physical zero from the final segment returns to the first row', () => {
  const geometry = new SegmentedVirtualListGeometry({ rowCount: 5_000_000, rowHeight: 40 });
  const finalWindow = geometry.createWindow(geometry.rowCount - 1);
  assert.ok(finalWindow.startOrdinal > 0);

  const rebased = geometry.rebaseWindow({
    window: finalWindow,
    scrollTop: 0,
    viewportHeight: 800
  });

  assert.equal(rebased.changed, true);
  assert.equal(rebased.window.startOrdinal, 0);
  assert.equal(rebased.scrollTop, 0);
  assert.equal(rebased.anchorOrdinal, 0);
});

test('empty geometry returns an empty render window', () => {
  const geometry = new SegmentedVirtualListGeometry({ rowCount: 0, rowHeight: 40 });
  const window = geometry.createWindow();

  assert.deepEqual(window, {
    firstSegmentIndex: 0,
    lastSegmentIndex: -1,
    startOrdinal: 0,
    endOrdinal: 0,
    heightPx: 0,
    anchorOffsetPx: 0
  });
  assert.deepEqual(
    geometry.getRenderRange({ window, scrollTop: 0, viewportHeight: 800 }),
    { startOrdinal: 0, endOrdinal: 0, translateY: 0 }
  );
});

test('segmented geometry rejects unsafe dimensions and ordinals', () => {
  assert.throws(() => new SegmentedVirtualListGeometry({ rowCount: -1, rowHeight: 40 }), RangeError);
  assert.throws(() => new SegmentedVirtualListGeometry({ rowCount: 1, rowHeight: 0 }), RangeError);
  assert.throws(
    () => new SegmentedVirtualListGeometry({ rowCount: 1, rowHeight: 40, maxSegmentPx: 20 }),
    RangeError
  );

  const geometry = new SegmentedVirtualListGeometry({ rowCount: 2, rowHeight: 40 });
  assert.throws(() => geometry.locateOrdinal(2), RangeError);
  assert.throws(() => geometry.getSegment(geometry.segmentCount), RangeError);
});
