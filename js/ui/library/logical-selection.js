import { createRepositoryError } from '../../library/repository/contract-errors.js';
import {
  MAX_INLINE_SELECTION_BYTES,
  MAX_INLINE_SELECTION_UIDS,
  validateSelectionDescriptor
} from '../../library/repository/selection-descriptor.js';

export class LogicalSelection {
  constructor(contextToken) {
    if (typeof contextToken !== 'string' || contextToken.length === 0) {
      throw new TypeError('contextToken must be a non-empty string');
    }
    this.contextToken = contextToken;
    this.mode = 'explicit';
    this.trackUids = new Set();
    this.trackOrdinals = new Map();
    this.exclusions = new Set();
    this.exclusionOrdinals = new Map();
    this.inclusions = new Set();
    this.inclusionOrdinals = new Map();
    this.trackUidBytes = 4;
    this.exclusionBytes = 4;
    this.inclusionBytes = 4;
    this.range = null;
  }

  clear() {
    this.mode = 'explicit';
    this.trackUids.clear();
    this.trackOrdinals.clear();
    this.exclusions.clear();
    this.exclusionOrdinals.clear();
    this.inclusions.clear();
    this.inclusionOrdinals.clear();
    this.trackUidBytes = 4;
    this.exclusionBytes = 4;
    this.inclusionBytes = 4;
    this.range = null;
  }

  selectAll() {
    this.mode = 'all';
    this.trackUids.clear();
    this.trackOrdinals.clear();
    this.exclusions.clear();
    this.exclusionOrdinals.clear();
    this.inclusions.clear();
    this.inclusionOrdinals.clear();
    this.trackUidBytes = 4;
    this.exclusionBytes = 4;
    this.inclusionBytes = 4;
    this.range = null;
  }

  selectRange(startUid, endUid, { startOrdinal = null, endOrdinal = null } = {}) {
    this.mode = 'range';
    this.trackUids.clear();
    this.trackOrdinals.clear();
    this.exclusions.clear();
    this.exclusionOrdinals.clear();
    this.inclusions.clear();
    this.inclusionOrdinals.clear();
    this.trackUidBytes = 4;
    this.exclusionBytes = 4;
    this.inclusionBytes = 4;
    this.range = {
      startUid,
      endUid,
      minimumOrdinal: Number.isSafeInteger(startOrdinal) && Number.isSafeInteger(endOrdinal)
        ? Math.min(startOrdinal, endOrdinal)
        : null,
      maximumOrdinal: Number.isSafeInteger(startOrdinal) && Number.isSafeInteger(endOrdinal)
        ? Math.max(startOrdinal, endOrdinal)
        : null
    };
    this.toDescriptor();
  }

  setSelected(trackUid, selected, { ordinal = null, inRange = false } = {}) {
    if (this.mode === 'explicit') {
      if (selected && !this.trackUids.has(trackUid)) {
        this.trackUidBytes = addSparseUid(this.trackUids, trackUid, this.trackUidBytes);
      } else if (!selected && this.trackUids.delete(trackUid)) {
        this.trackUidBytes -= serializedUidBytes(trackUid);
        this.trackOrdinals.delete(trackUid);
      }
      if (selected && Number.isSafeInteger(ordinal) && ordinal >= 0) {
        this.trackOrdinals.set(trackUid, ordinal);
      }
    } else if (this.mode === 'all') {
      if (!selected && !this.exclusions.has(trackUid)) {
        this.exclusionBytes = addSparseUid(this.exclusions, trackUid, this.exclusionBytes);
      } else if (selected && this.exclusions.delete(trackUid)) {
        this.exclusionBytes -= serializedUidBytes(trackUid);
      }
      if (!selected && Number.isSafeInteger(ordinal) && ordinal >= 0) {
        this.exclusionOrdinals.set(trackUid, ordinal);
      } else if (selected) {
        this.exclusionOrdinals.delete(trackUid);
      }
    } else {
      const belongsToRange = inRange || this.isOrdinalInRange(ordinal) ||
        trackUid === this.range?.startUid || trackUid === this.range?.endUid ||
        (!selected && !Number.isSafeInteger(ordinal) && !this.inclusions.has(trackUid));
      if (belongsToRange) {
        if (selected && this.exclusions.delete(trackUid)) {
          this.exclusionBytes -= serializedUidBytes(trackUid);
        } else if (!selected && !this.exclusions.has(trackUid)) {
          this.exclusionBytes = addSparseUid(this.exclusions, trackUid, this.exclusionBytes, {
            otherCount: this.inclusions.size,
            otherBytes: this.inclusionBytes
          });
        }
        if (!selected && Number.isSafeInteger(ordinal) && ordinal >= 0) {
          this.exclusionOrdinals.set(trackUid, ordinal);
        } else if (selected) {
          this.exclusionOrdinals.delete(trackUid);
        }
        if (this.inclusions.delete(trackUid)) this.inclusionBytes -= serializedUidBytes(trackUid);
        this.inclusionOrdinals.delete(trackUid);
      } else if (selected) {
        if (this.exclusions.delete(trackUid)) this.exclusionBytes -= serializedUidBytes(trackUid);
        this.exclusionOrdinals.delete(trackUid);
        if (!this.inclusions.has(trackUid)) {
          this.inclusionBytes = addSparseUid(this.inclusions, trackUid, this.inclusionBytes, {
            otherCount: this.exclusions.size,
            otherBytes: this.exclusionBytes
          });
        }
        if (Number.isSafeInteger(ordinal) && ordinal >= 0) {
          this.inclusionOrdinals.set(trackUid, ordinal);
        }
      } else if (this.inclusions.delete(trackUid)) {
        this.inclusionBytes -= serializedUidBytes(trackUid);
        this.inclusionOrdinals.delete(trackUid);
      }
    }
  }

  isSelected(trackUid, { inRange = false, ordinal = null } = {}) {
    if (this.mode === 'explicit') return this.trackUids.has(trackUid);
    if (this.mode === 'all') return !this.exclusions.has(trackUid);
    const belongsToRange = inRange || this.isOrdinalInRange(ordinal) ||
      trackUid === this.range?.startUid || trackUid === this.range?.endUid;
    return this.inclusions.has(trackUid) || (belongsToRange && !this.exclusions.has(trackUid));
  }

  isOrdinalInRange(ordinal) {
    return Number.isSafeInteger(ordinal) &&
      Number.isSafeInteger(this.range?.minimumOrdinal) &&
      ordinal >= this.range.minimumOrdinal && ordinal <= this.range.maximumOrdinal;
  }

  getSelectedOrdinal(trackUid, ordinal) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 ||
        !this.isSelected(trackUid, { ordinal })) return null;
    if (this.mode === 'explicit') {
      const trackUids = [...this.trackUids];
      if (trackUids.every(uid => this.trackOrdinals.has(uid))) {
        trackUids.sort((left, right) => this.trackOrdinals.get(left) - this.trackOrdinals.get(right));
      }
      const selectedOrdinal = trackUids.indexOf(trackUid);
      return selectedOrdinal < 0 ? null : selectedOrdinal;
    }
    if (this.mode === 'all') {
      if ([...this.exclusions].some(uid => !this.exclusionOrdinals.has(uid))) return null;
      const excludedBefore = [...this.exclusionOrdinals.values()].filter(value => value < ordinal).length;
      return ordinal - excludedBefore;
    }
    const minimum = this.range?.minimumOrdinal;
    const maximum = this.range?.maximumOrdinal;
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) ||
        [...this.exclusions].some(uid => !this.exclusionOrdinals.has(uid)) ||
        [...this.inclusions].some(uid => !this.inclusionOrdinals.has(uid))) return null;
    const rangeBefore = Math.max(0, Math.min(maximum + 1, ordinal) - minimum);
    const excludedBefore = [...this.exclusionOrdinals.values()].filter(value => (
      value >= minimum && value <= maximum && value < ordinal
    )).length;
    const includedBefore = [...this.inclusionOrdinals.values()].filter(value => (
      (value < minimum || value > maximum) && value < ordinal
    )).length;
    return rangeBefore - excludedBefore + includedBefore;
  }

  getProjection({ totalCount = null } = {}) {
    if (this.mode === 'explicit') {
      return Object.freeze({ hasAny: this.trackUids.size > 0, selectedCount: this.trackUids.size });
    }
    if (this.mode === 'all') {
      if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
        return Object.freeze({ hasAny: true, selectedCount: null });
      }
      const selectedCount = Math.max(0, totalCount - this.exclusions.size);
      return Object.freeze({ hasAny: selectedCount > 0, selectedCount });
    }

    let rangeCount = null;
    if (Number.isSafeInteger(this.range?.minimumOrdinal) && Number.isSafeInteger(this.range?.maximumOrdinal)) {
      rangeCount = this.range.maximumOrdinal - this.range.minimumOrdinal + 1;
    }
    const selectedCount = rangeCount === null
      ? null
      : Math.max(0, rangeCount - this.exclusions.size) + this.inclusions.size;
    let hasAny = selectedCount === null ? this.inclusions.size > 0 : selectedCount > 0;
    if (selectedCount === null && !hasAny) {
      const endpoints = new Set([this.range?.startUid, this.range?.endUid].filter(Boolean));
      hasAny = [...endpoints].some(uid => !this.exclusions.has(uid));
      if (!hasAny && endpoints.size > 1) hasAny = true;
    }
    return Object.freeze({ hasAny, selectedCount });
  }

  toDescriptor() {
    if (this.mode === 'explicit') {
      const trackUids = [...this.trackUids];
      if (trackUids.every(trackUid => this.trackOrdinals.has(trackUid))) {
        trackUids.sort((left, right) => this.trackOrdinals.get(left) - this.trackOrdinals.get(right));
      }
      return validateSelectionDescriptor({
        mode: 'explicit',
        contextToken: this.contextToken,
        trackUids
      });
    }
    if (this.mode === 'all') {
      return validateSelectionDescriptor({
        mode: 'all',
        contextToken: this.contextToken,
        exclusions: [...this.exclusions]
      });
    }
    return validateSelectionDescriptor({
      mode: 'range',
      contextToken: this.contextToken,
      startUid: this.range?.startUid,
      endUid: this.range?.endUid,
      exclusions: [...this.exclusions],
      inclusions: [...this.inclusions]
    });
  }
}

function addSparseUid(collection, uid, currentBytes, { otherCount = 0, otherBytes = 0 } = {}) {
  if (typeof uid !== 'string' || uid.length === 0) {
    throw createRepositoryError('invalidSelection', 'Selection UIDs must be non-empty strings');
  }
  const nextCount = collection.size + 1 + otherCount;
  const nextBytes = currentBytes + serializedUidBytes(uid) + otherBytes;
  if (nextCount > MAX_INLINE_SELECTION_UIDS || nextBytes > MAX_INLINE_SELECTION_BYTES) {
    throw createRepositoryError('selectionTooLarge', 'Sparse selection exceeds the inline limit', {
      uidCount: nextCount,
      byteLength: nextBytes,
      maximumUids: MAX_INLINE_SELECTION_UIDS,
      maximumBytes: MAX_INLINE_SELECTION_BYTES,
      suggestedModes: ['all', 'range']
    });
  }
  collection.add(uid);
  return nextBytes;
}

function serializedUidBytes(uid) {
  return 4 + new TextEncoder().encode(uid).byteLength;
}
