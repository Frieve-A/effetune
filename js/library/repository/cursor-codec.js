import { assertRepositoryContract, createRepositoryError } from './contract-errors.js';

export const CURSOR_VERSION = 1;
export const QUERY_FINGERPRINT_VERSION = 1;

const CURSOR_FIELDS = Object.freeze([
  'cursorVersion',
  'queryFingerprint',
  'snapshotVersion',
  'sortSpecId',
  'continuation',
  'tuple'
]);
const FINGERPRINT_FIELDS = Object.freeze(['endpoint', 'query', 'version']);

export function createQueryFingerprint({ endpoint, query }) {
  assertRepositoryContract(typeof endpoint === 'string' && endpoint.length > 0, 'invalidQueryFingerprint', 'Query endpoint must be a non-empty string');
  assertRepositoryContract(isPlainObject(query), 'invalidQueryFingerprint', 'Query fingerprint input must be an object');
  const payload = {
    version: QUERY_FINGERPRINT_VERSION,
    endpoint,
    query: canonicalizeJson(query)
  };
  return `q${QUERY_FINGERPRINT_VERSION}.${encodeBase64Url(JSON.stringify(payload))}`;
}

export function decodeQueryFingerprint(fingerprint) {
  assertRepositoryContract(typeof fingerprint === 'string' && fingerprint.startsWith(`q${QUERY_FINGERPRINT_VERSION}.`), 'invalidQueryFingerprint', 'Query fingerprint version is invalid');
  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(fingerprint.slice(fingerprint.indexOf('.') + 1)));
  } catch (error) {
    throw createRepositoryError('invalidQueryFingerprint', 'Query fingerprint payload is invalid', {
      cause: error?.message || String(error)
    });
  }
  assertExactFields(payload, FINGERPRINT_FIELDS, 'invalidQueryFingerprint');
  assertRepositoryContract(payload.version === QUERY_FINGERPRINT_VERSION, 'invalidQueryFingerprint', 'Query fingerprint version is invalid');
  assertRepositoryContract(typeof payload.endpoint === 'string' && payload.endpoint.length > 0, 'invalidQueryFingerprint', 'Query fingerprint endpoint is invalid');
  assertRepositoryContract(isPlainObject(payload.query), 'invalidQueryFingerprint', 'Query fingerprint query is invalid');
  return payload;
}

export function encodeCursor({
  queryFingerprint,
  snapshotVersion,
  sortSpecId,
  continuation,
  tuple
}, descriptor) {
  const envelope = validateCursorEnvelope({
    cursorVersion: CURSOR_VERSION,
    queryFingerprint,
    snapshotVersion,
    sortSpecId,
    continuation,
    tuple
  }, { descriptor });
  return `c${CURSOR_VERSION}.${encodeBase64Url(JSON.stringify(envelope))}`;
}

export function decodeCursor(cursor, {
  endpoint,
  queryFingerprint,
  snapshotVersion,
  sortSpecId,
  continuation,
  descriptor
}) {
  assertRepositoryContract(typeof cursor === 'string' && cursor.startsWith(`c${CURSOR_VERSION}.`), 'malformedCursor', 'Cursor version is invalid');
  let envelope;
  try {
    envelope = JSON.parse(decodeBase64Url(cursor.slice(cursor.indexOf('.') + 1)));
  } catch (error) {
    throw createRepositoryError('malformedCursor', 'Cursor payload is invalid', {
      cause: error?.message || String(error)
    });
  }
  validateCursorEnvelope(envelope, { descriptor });
  const fingerprint = decodeQueryFingerprint(envelope.queryFingerprint);
  assertRepositoryContract(fingerprint.endpoint === endpoint, 'cursorEndpointMismatch', 'Cursor endpoint does not match the query endpoint');
  assertRepositoryContract(envelope.queryFingerprint === queryFingerprint, 'cursorQueryMismatch', 'Cursor query does not match the active query');
  assertRepositoryContract(envelope.snapshotVersion === snapshotVersion, 'STALE_CURSOR', 'Cursor snapshot is stale');
  assertRepositoryContract(envelope.sortSpecId === sortSpecId, 'cursorSortMismatch', 'Cursor sort does not match the active query');
  if (continuation !== undefined) {
    assertRepositoryContract(envelope.continuation === continuation, 'cursorDirectionMismatch', 'Cursor continuation direction does not match the request');
  }
  assertRepositoryContract(descriptor.endpoint === endpoint && descriptor.id === sortSpecId, 'cursorContractMismatch', 'Cursor descriptor does not match the endpoint and sort contract');
  return envelope;
}

export function validateCursorEnvelope(envelope, { descriptor }) {
  assertRepositoryContract(isPlainObject(envelope), 'malformedCursor', 'Cursor envelope must be an object');
  assertExactFields(envelope, CURSOR_FIELDS, 'malformedCursor');
  assertRepositoryContract(envelope.cursorVersion === CURSOR_VERSION, 'malformedCursor', 'Cursor envelope version is invalid');
  decodeQueryFingerprint(envelope.queryFingerprint);
  assertRepositoryContract(Number.isSafeInteger(envelope.snapshotVersion) && envelope.snapshotVersion >= 0, 'malformedCursor', 'Cursor snapshotVersion is invalid');
  assertRepositoryContract(typeof envelope.sortSpecId === 'string' && envelope.sortSpecId.length > 0, 'malformedCursor', 'Cursor sortSpecId is invalid');
  assertRepositoryContract(envelope.continuation === 'after' || envelope.continuation === 'before', 'malformedCursor', 'Cursor continuation is invalid');
  assertRepositoryContract(descriptor && typeof descriptor.validateTuple === 'function', 'cursorContractMismatch', 'Cursor requires a canonical order descriptor');
  descriptor.validateTuple(envelope.tuple);
  return envelope;
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (isPlainObject(value)) {
    const canonical = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      assertRepositoryContract(item !== undefined, 'invalidQueryFingerprint', 'Query fingerprint values cannot be undefined');
      canonical[key] = canonicalizeJson(item);
    }
    return canonical;
  }
  assertRepositoryContract(
    value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)),
    'invalidQueryFingerprint',
    'Query fingerprint contains an unsupported value'
  );
  return value;
}

function assertExactFields(value, expectedFields, code) {
  assertRepositoryContract(isPlainObject(value), code, 'Encoded value must be an object');
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  assertRepositoryContract(actual.length === expected.length && actual.every((field, index) => field === expected[index]), code, 'Encoded value has unknown or missing fields', {
    actual,
    expected
  });
}

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  assertRepositoryContract(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value), 'malformedCursor', 'Encoded payload is not base64url');
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
