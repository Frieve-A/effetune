import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PAGED_GRID_MAX_RENDERED_CARDS,
  SegmentedVirtualGridGeometry
} from '../../js/ui/library/segmented-virtual-grid.js';

test('million-item responsive grid keeps cards and segment geometry bounded', () => {
  const desktop = new SegmentedVirtualGridGeometry({ itemCount: 1_000_001, containerWidth: 1200 });
  const mobile = new SegmentedVirtualGridGeometry({ itemCount: 1_000_001, containerWidth: 360 });
  assert.ok(desktop.columns > mobile.columns);

  const window = desktop.createWindow(900_000);
  const range = desktop.getRenderRange({
    window,
    scrollTop: window.anchorOffsetPx,
    viewportHeight: 900,
    bufferRows: 2
  });
  assert.ok(range.endOrdinal - range.startOrdinal <= PAGED_GRID_MAX_RENDERED_CARDS);
  assert.ok(window.heightPx <= 24_000_000);
  const layout = desktop.getItemLayout(range.startOrdinal, window);
  assert.ok(layout.leftPercent >= 0 && layout.leftPercent < 100);
  assert.equal(layout.widthPercent, 100 / desktop.columns);
  assert.equal(layout.leftOffsetPx, layout.column * (desktop.columnGap / desktop.columns));
  assert.equal(
    layout.widthReductionPx,
    (desktop.columns - 1) * (desktop.columnGap / desktop.columns)
  );
});

test('grid card widths stay identical while gaps exclude the outer edges', () => {
  const geometry = new SegmentedVirtualGridGeometry({ itemCount: 4, containerWidth: 800 });
  const window = geometry.createWindow();
  const layouts = Array.from({ length: geometry.columns }, (_, ordinal) => (
    geometry.getItemLayout(ordinal, window)
  ));
  const cardWidthPx = (
    800 - geometry.columnGap * (geometry.columns - 1)
  ) / geometry.columns;

  assert.equal(layouts[0].leftPercent, 0);
  assert.equal(layouts[0].leftOffsetPx, 0);
  assert.ok(layouts.every(layout => layout.widthPercent === layouts[0].widthPercent));
  assert.ok(layouts.every(layout => layout.widthReductionPx === layouts[0].widthReductionPx));
  for (let index = 1; index < layouts.length; index += 1) {
    const previousRight = (
      layouts[index - 1].leftPercent / 100 * 800 +
      layouts[index - 1].leftOffsetPx + cardWidthPx
    );
    const currentLeft = layouts[index].leftPercent / 100 * 800 + layouts[index].leftOffsetPx;
    assert.equal(currentLeft - previousRight, geometry.columnGap);
  }
  const last = layouts.at(-1);
  assert.equal(last.leftPercent / 100 * 800 + last.leftOffsetPx + cardWidthPx, 800);
});

test('five-million-item grid resolves the final card exactly', () => {
  const geometry = new SegmentedVirtualGridGeometry({ itemCount: 5_000_000, containerWidth: 760 });
  const lastOrdinal = geometry.itemCount - 1;
  const window = geometry.createWindow(lastOrdinal);
  const layout = geometry.getItemLayout(lastOrdinal, window);
  assert.equal((layout.row * geometry.columns) + layout.column, lastOrdinal);
  assert.ok(layout.topPx >= 0 && layout.topPx < window.heightPx);
});

test('grid height and overscroll converge on the final populated row', () => {
  const geometry = new SegmentedVirtualGridGeometry({
    itemCount: 1_000,
    containerWidth: 1_200,
    rowHeight: 224
  });
  const viewportHeight = 480;
  const window = geometry.createWindow(geometry.itemCount - 1);
  const maximumScrollTop = window.heightPx - viewportHeight;

  assert.equal(geometry.rowCount, Math.ceil(geometry.itemCount / geometry.columns));
  assert.equal(window.heightPx, geometry.rowCount * geometry.rowHeight);
  const finalRange = geometry.getRenderRange({
    window,
    scrollTop: maximumScrollTop,
    viewportHeight,
    bufferRows: 2
  });
  const overscrolledRange = geometry.getRenderRange({
    window,
    scrollTop: window.heightPx * 2,
    viewportHeight,
    bufferRows: 2
  });

  assert.equal(finalRange.endOrdinal, geometry.itemCount);
  assert.ok(finalRange.startOrdinal < finalRange.endOrdinal);
  assert.deepEqual(overscrolledRange, finalRange);
  const rebased = geometry.list.rebaseWindow({
    window,
    scrollTop: window.heightPx * 2,
    viewportHeight
  });
  assert.equal(rebased.changed, true);
  assert.equal(rebased.scrollTop, maximumScrollTop);
});
