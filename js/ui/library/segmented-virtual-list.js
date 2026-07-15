export const MAX_VIRTUAL_SEGMENT_PX = 8_000_000;

export class SegmentedVirtualListGeometry {
  constructor({ rowCount = 0, rowHeight, maxSegmentPx = MAX_VIRTUAL_SEGMENT_PX } = {}) {
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
      throw new RangeError('rowCount must be a non-negative safe integer');
    }
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
      throw new RangeError('rowHeight must be a positive number');
    }
    if (!Number.isSafeInteger(maxSegmentPx) || maxSegmentPx < rowHeight) {
      throw new RangeError('maxSegmentPx must fit at least one row');
    }

    this.rowCount = rowCount;
    this.rowHeight = rowHeight;
    this.maxSegmentPx = maxSegmentPx;
    this.rowsPerSegment = Math.max(1, Math.floor(maxSegmentPx / rowHeight));
    this.segmentCount = Math.ceil(rowCount / this.rowsPerSegment);
  }

  locateOrdinal(ordinal) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= this.rowCount) {
      throw new RangeError('ordinal is outside the virtual list');
    }
    const segmentIndex = Math.floor(ordinal / this.rowsPerSegment);
    const segmentStartOrdinal = segmentIndex * this.rowsPerSegment;
    return {
      ordinal,
      segmentIndex,
      segmentStartOrdinal,
      ordinalInSegment: ordinal - segmentStartOrdinal,
      offsetPx: (ordinal - segmentStartOrdinal) * this.rowHeight
    };
  }

  getSegment(segmentIndex) {
    if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= this.segmentCount) {
      throw new RangeError('segmentIndex is outside the virtual list');
    }
    const startOrdinal = segmentIndex * this.rowsPerSegment;
    const endOrdinal = Math.min(this.rowCount, startOrdinal + this.rowsPerSegment);
    return {
      segmentIndex,
      startOrdinal,
      endOrdinal,
      rowCount: endOrdinal - startOrdinal,
      heightPx: (endOrdinal - startOrdinal) * this.rowHeight
    };
  }

  createWindow(anchorOrdinal = 0) {
    if (this.rowCount === 0) {
      return {
        firstSegmentIndex: 0,
        lastSegmentIndex: -1,
        startOrdinal: 0,
        endOrdinal: 0,
        heightPx: 0,
        anchorOffsetPx: 0
      };
    }

    const anchor = this.locateOrdinal(Math.min(anchorOrdinal, this.rowCount - 1));
    const firstSegmentIndex = Math.max(0, anchor.segmentIndex - 1);
    const lastSegmentIndex = Math.min(this.segmentCount - 1, anchor.segmentIndex + 1);
    const first = this.getSegment(firstSegmentIndex);
    const last = this.getSegment(lastSegmentIndex);
    const startOrdinal = first.startOrdinal;
    const endOrdinal = last.endOrdinal;

    return {
      firstSegmentIndex,
      lastSegmentIndex,
      anchorSegmentIndex: anchor.segmentIndex,
      startOrdinal,
      endOrdinal,
      heightPx: (endOrdinal - startOrdinal) * this.rowHeight,
      anchorOffsetPx: (anchorOrdinal - startOrdinal) * this.rowHeight
    };
  }

  getRenderRange({ window, scrollTop, viewportHeight, bufferRows = 10 }) {
    if (!window || window.endOrdinal <= window.startOrdinal) {
      return { startOrdinal: 0, endOrdinal: 0, translateY: 0 };
    }
    const safeScrollTop = Math.max(0, Number(scrollTop) || 0);
    const safeViewportHeight = Math.max(0, Number(viewportHeight) || 0);
    const firstVisible = window.startOrdinal + Math.floor(safeScrollTop / this.rowHeight);
    const visibleRows = Math.ceil(safeViewportHeight / this.rowHeight);
    const startOrdinal = Math.max(window.startOrdinal, firstVisible - bufferRows);
    const endOrdinal = Math.min(window.endOrdinal, firstVisible + visibleRows + bufferRows);
    return {
      startOrdinal,
      endOrdinal,
      translateY: (startOrdinal - window.startOrdinal) * this.rowHeight,
      firstVisibleOrdinal: Math.max(window.startOrdinal, Math.min(window.endOrdinal - 1, firstVisible))
    };
  }

  getScrollTopForOrdinal(window, ordinal, viewportOffsetPx = 0) {
    if (!window || window.endOrdinal <= window.startOrdinal) return 0;
    const safeOrdinal = Math.max(window.startOrdinal, Math.min(window.endOrdinal - 1, ordinal));
    return Math.max(0, ((safeOrdinal - window.startOrdinal) * this.rowHeight) - viewportOffsetPx);
  }

  rebaseWindow({ window, scrollTop, viewportHeight = 0 } = {}) {
    if (!window || this.rowCount === 0) {
      return { changed: false, window: this.createWindow(0), scrollTop: 0, anchorOrdinal: 0 };
    }
    const range = this.getRenderRange({ window, scrollTop, viewportHeight, bufferRows: 0 });
    const anchorOrdinal = range.firstVisibleOrdinal;
    const anchorSegment = this.locateOrdinal(anchorOrdinal).segmentIndex;
    const currentSegment = window.anchorSegmentIndex ?? Math.floor(
      (window.firstSegmentIndex + window.lastSegmentIndex) / 2
    );
    if (anchorSegment === currentSegment || this.segmentCount <= 3) {
      return { changed: false, window, scrollTop, anchorOrdinal };
    }
    const viewportOffsetPx = ((anchorOrdinal - window.startOrdinal) * this.rowHeight) - Math.max(0, Number(scrollTop) || 0);
    const nextWindow = this.createWindow(anchorOrdinal);
    return {
      changed: true,
      window: nextWindow,
      scrollTop: this.getScrollTopForOrdinal(nextWindow, anchorOrdinal, viewportOffsetPx),
      anchorOrdinal
    };
  }
}
