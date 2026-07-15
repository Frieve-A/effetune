import { assertRepositoryContract } from './contract-errors.js';

export const MAX_INLINE_SELECTION_UIDS = 4096;
export const MAX_INLINE_SELECTION_BYTES = 256 * 1024;

const MODE_FIELDS = Object.freeze({
  all: Object.freeze(['contextToken', 'exclusions', 'mode']),
  range: Object.freeze(['contextToken', 'endUid', 'exclusions', 'mode', 'startUid']),
  explicit: Object.freeze(['contextToken', 'mode', 'trackUids'])
});

export function validateSelectionDescriptor(descriptor) {
  assertRepositoryContract(isPlainObject(descriptor), 'invalidSelection', 'Selection descriptor must be an object');
  assertRepositoryContract(Object.hasOwn(MODE_FIELDS, descriptor.mode), 'invalidSelection', 'Selection mode is invalid');
  assertExactFields(descriptor, MODE_FIELDS[descriptor.mode]);
  assertUid(descriptor.contextToken, 'contextToken');

  if (descriptor.mode === 'explicit') {
    const trackUids = normalizeUidCollection(descriptor.trackUids, 'trackUids');
    enforceSparseBounds([trackUids]);
    return Object.freeze({ mode: 'explicit', contextToken: descriptor.contextToken, trackUids: Object.freeze(trackUids) });
  }

  const exclusions = normalizeUidCollection(descriptor.exclusions, 'exclusions');
  enforceSparseBounds([exclusions]);
  if (descriptor.mode === 'all') {
    return Object.freeze({ mode: 'all', contextToken: descriptor.contextToken, exclusions: Object.freeze(exclusions) });
  }

  assertUid(descriptor.startUid, 'startUid');
  assertUid(descriptor.endUid, 'endUid');
  return Object.freeze({
    mode: 'range',
    contextToken: descriptor.contextToken,
    startUid: descriptor.startUid,
    endUid: descriptor.endUid,
    exclusions: Object.freeze(exclusions)
  });
}

export function getCanonicalUidPayloadByteLength(uidFields) {
  assertRepositoryContract(Array.isArray(uidFields), 'invalidSelection', 'UID fields must be an array');
  let byteLength = 0;
  for (const field of uidFields) {
    const values = normalizeUidCollection(field, 'UID field');
    byteLength += 4;
    for (const value of values) {
      byteLength += 4 + new TextEncoder().encode(value).byteLength;
      assertRepositoryContract(Number.isSafeInteger(byteLength), 'selectionTooLarge', 'Selection byte length exceeds the supported integer range');
    }
  }
  return byteLength;
}

function enforceSparseBounds(fields) {
  const uidCount = fields.reduce((count, field) => count + field.length, 0);
  assertRepositoryContract(uidCount <= MAX_INLINE_SELECTION_UIDS, 'selectionTooLarge', 'Sparse selection exceeds the UID limit', {
    uidCount,
    maximumUids: MAX_INLINE_SELECTION_UIDS,
    suggestedModes: ['all', 'range']
  });
  const byteLength = getCanonicalUidPayloadByteLength(fields);
  assertRepositoryContract(byteLength <= MAX_INLINE_SELECTION_BYTES, 'selectionTooLarge', 'Sparse selection exceeds the byte limit', {
    byteLength,
    maximumBytes: MAX_INLINE_SELECTION_BYTES,
    suggestedModes: ['all', 'range']
  });
}

function normalizeUidCollection(value, field) {
  const values = value instanceof Set ? [...value] : value;
  assertRepositoryContract(Array.isArray(values), 'invalidSelection', `${field} must be an array or Set`);
  const seen = new Set();
  for (const uid of values) {
    assertUid(uid, field);
    assertRepositoryContract(!seen.has(uid), 'duplicateSelectionUid', `${field} contains a duplicate UID`, { uid });
    seen.add(uid);
  }
  return [...values];
}

function assertUid(value, field) {
  assertRepositoryContract(typeof value === 'string' && value.length > 0, 'invalidSelection', `${field} must contain non-empty strings`);
}

function assertExactFields(value, expectedFields) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  assertRepositoryContract(actual.length === expected.length && actual.every((field, index) => field === expected[index]), 'invalidSelection', 'Selection descriptor has unknown or missing fields', {
    actual,
    expected
  });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
