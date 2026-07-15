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
    this.exclusions = new Set();
    this.trackUidBytes = 4;
    this.exclusionBytes = 4;
    this.range = null;
  }

  clear() {
    this.mode = 'explicit';
    this.trackUids.clear();
    this.exclusions.clear();
    this.trackUidBytes = 4;
    this.exclusionBytes = 4;
    this.range = null;
  }

  selectAll() {
    this.mode = 'all';
    this.trackUids.clear();
    this.exclusions.clear();
    this.trackUidBytes = 4;
    this.exclusionBytes = 4;
    this.range = null;
  }

  selectRange(startUid, endUid, { startOrdinal = null, endOrdinal = null } = {}) {
    this.mode = 'range';
    this.trackUids.clear();
    this.exclusions.clear();
    this.trackUidBytes = 4;
    this.exclusionBytes = 4;
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

  setSelected(trackUid, selected) {
    if (this.mode === 'explicit') {
      if (selected && !this.trackUids.has(trackUid)) {
        this.trackUidBytes = addSparseUid(this.trackUids, trackUid, this.trackUidBytes);
      } else if (!selected && this.trackUids.delete(trackUid)) {
        this.trackUidBytes -= serializedUidBytes(trackUid);
      }
    } else {
      if (!selected && !this.exclusions.has(trackUid)) {
        this.exclusionBytes = addSparseUid(this.exclusions, trackUid, this.exclusionBytes);
      } else if (selected && this.exclusions.delete(trackUid)) {
        this.exclusionBytes -= serializedUidBytes(trackUid);
      }
    }
  }

  isSelected(trackUid, { inRange = false, ordinal = null } = {}) {
    if (this.mode === 'explicit') return this.trackUids.has(trackUid);
    if (this.mode === 'all') return !this.exclusions.has(trackUid);
    const ordinalInRange = Number.isSafeInteger(ordinal) &&
      Number.isSafeInteger(this.range?.minimumOrdinal) &&
      ordinal >= this.range.minimumOrdinal && ordinal <= this.range.maximumOrdinal;
    return (inRange || ordinalInRange) && !this.exclusions.has(trackUid);
  }

  toDescriptor() {
    if (this.mode === 'explicit') {
      return validateSelectionDescriptor({
        mode: 'explicit',
        contextToken: this.contextToken,
        trackUids: [...this.trackUids]
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
      exclusions: [...this.exclusions]
    });
  }
}

function addSparseUid(collection, uid, currentBytes) {
  if (typeof uid !== 'string' || uid.length === 0) {
    throw createRepositoryError('invalidSelection', 'Selection UIDs must be non-empty strings');
  }
  const nextCount = collection.size + 1;
  const nextBytes = currentBytes + serializedUidBytes(uid);
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
