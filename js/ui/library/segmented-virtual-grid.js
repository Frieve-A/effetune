import { SegmentedVirtualListGeometry } from './segmented-virtual-list.js';

export const PAGED_GRID_MAX_RENDERED_CARDS = 96;

export class SegmentedVirtualGridGeometry {
  constructor({
    itemCount = 0,
    containerWidth,
    minimumCardWidth = 176,
    columnGap = 16,
    rowHeight = 224,
    maximumColumns = 12
  } = {}) {
    if (!Number.isSafeInteger(itemCount) || itemCount < 0) {
      throw new RangeError('itemCount must be a non-negative safe integer');
    }
    if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
      throw new RangeError('containerWidth must be positive');
    }
    if (!Number.isFinite(minimumCardWidth) || minimumCardWidth <= 0) {
      throw new RangeError('minimumCardWidth must be positive');
    }
    if (!Number.isFinite(columnGap) || columnGap < 0) {
      throw new RangeError('columnGap must be non-negative');
    }
    this.itemCount = itemCount;
    this.columnGap = columnGap;
    this.columns = Math.max(1, Math.min(
      maximumColumns,
      Math.floor((containerWidth + columnGap) / (minimumCardWidth + columnGap))
    ));
    this.rowCount = Math.ceil(itemCount / this.columns);
    this.rowHeight = rowHeight;
    this.list = new SegmentedVirtualListGeometry({ rowCount: this.rowCount, rowHeight });
  }

  createWindow(anchorItemOrdinal = 0) {
    const anchorRow = this.itemCount === 0
      ? 0
      : Math.floor(Math.min(anchorItemOrdinal, this.itemCount - 1) / this.columns);
    return this.list.createWindow(anchorRow);
  }

  getRenderRange(options) {
    const range = this.list.getRenderRange(options);
    const startOrdinal = Math.min(this.itemCount, range.startOrdinal * this.columns);
    const uncappedEnd = Math.min(this.itemCount, range.endOrdinal * this.columns);
    const endOrdinal = Math.min(uncappedEnd, startOrdinal + PAGED_GRID_MAX_RENDERED_CARDS);
    return {
      ...range,
      startOrdinal,
      endOrdinal,
      firstVisibleOrdinal: Math.min(
        Math.max(0, this.itemCount - 1),
        range.firstVisibleOrdinal * this.columns
      )
    };
  }

  getItemLayout(itemOrdinal, window) {
    if (!Number.isSafeInteger(itemOrdinal) || itemOrdinal < 0 || itemOrdinal >= this.itemCount) {
      throw new RangeError('itemOrdinal is outside the virtual grid');
    }
    const row = Math.floor(itemOrdinal / this.columns);
    const column = itemOrdinal % this.columns;
    const gapSharePx = this.columnGap / this.columns;
    return {
      row,
      column,
      topPx: (row - window.startOrdinal) * this.rowHeight,
      leftPercent: (column / this.columns) * 100,
      leftOffsetPx: column * gapSharePx,
      widthPercent: 100 / this.columns,
      widthReductionPx: (this.columns - 1) * gapSharePx
    };
  }

}
