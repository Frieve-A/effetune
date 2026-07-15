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
});

test('five-million-item grid resolves the final card exactly', () => {
  const geometry = new SegmentedVirtualGridGeometry({ itemCount: 5_000_000, containerWidth: 760 });
  const lastOrdinal = geometry.itemCount - 1;
  const window = geometry.createWindow(lastOrdinal);
  const layout = geometry.getItemLayout(lastOrdinal, window);
  assert.equal((layout.row * geometry.columns) + layout.column, lastOrdinal);
  assert.ok(layout.topPx >= 0 && layout.topPx < window.heightPx);
});
