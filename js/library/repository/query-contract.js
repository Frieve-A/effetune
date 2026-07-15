import { assertRepositoryContract, createRepositoryError } from './contract-errors.js';

export const DEFAULT_QUERY_LIMIT = 200;
export const MAX_QUERY_LIMIT = 500;
export const MAX_QUERY_RESPONSE_BYTES = 1024 * 1024;

const PAGE_FIELDS = Object.freeze([
  'rows',
  'nextCursor',
  'previousCursor',
  'totalCount',
  'catalogVersion',
  'contextToken'
]);
const PLAYLIST_PAGE_FIELDS = Object.freeze([
  ...PAGE_FIELDS,
  'resolvedCount',
  'unresolvedCount'
]);

export function normalizeQueryLimit(limit = DEFAULT_QUERY_LIMIT) {
  assertRepositoryContract(
    Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_QUERY_LIMIT,
    'invalidLimit',
    `Query limit must be an integer from 1 to ${MAX_QUERY_LIMIT}`,
    { limit, maximum: MAX_QUERY_LIMIT }
  );
  return limit;
}

export function measureJsonBytes(value) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw createRepositoryError('unserializableResponse', 'Query response is not serializable', {
      cause: error?.message || String(error)
    });
  }
  assertRepositoryContract(
    json !== undefined,
    'unserializableResponse',
    'Query response is not serializable'
  );
  return new TextEncoder().encode(json).byteLength;
}

export function validatePageResponse(response, { limit = DEFAULT_QUERY_LIMIT } = {}) {
  const normalizedLimit = normalizeQueryLimit(limit);
  assertRepositoryContract(
    isPlainObject(response),
    'invalidPage',
    'Query page must be an object'
  );
  const hasPlaylistCounts = Object.hasOwn(response, 'resolvedCount') ||
    Object.hasOwn(response, 'unresolvedCount');
  assertExactFields(response, hasPlaylistCounts ? PLAYLIST_PAGE_FIELDS : PAGE_FIELDS, 'invalidPage');
  assertRepositoryContract(Array.isArray(response.rows), 'invalidPage', 'Query page rows must be an array');
  assertRepositoryContract(
    response.rows.length <= normalizedLimit,
    'pageLimitExceeded',
    'Query page contains more rows than requested',
    { rowCount: response.rows.length, limit: normalizedLimit }
  );
  assertNullableString(response.nextCursor, 'nextCursor');
  assertNullableString(response.previousCursor, 'previousCursor');
  assertRepositoryContract(
    isValidTotalCount(response.totalCount),
    'invalidPage',
    'Query page totalCount must be a non-negative integer or { pending: true }'
  );
  assertRepositoryContract(
    Number.isSafeInteger(response.catalogVersion) && response.catalogVersion >= 0,
    'invalidPage',
    'Query page catalogVersion must be a non-negative integer'
  );
  assertRepositoryContract(
    typeof response.contextToken === 'string' && response.contextToken.length > 0,
    'invalidPage',
    'Query page contextToken must be a non-empty string'
  );
  if (hasPlaylistCounts) {
    assertRepositoryContract(
      Number.isSafeInteger(response.resolvedCount) && response.resolvedCount >= 0 &&
      Number.isSafeInteger(response.unresolvedCount) && response.unresolvedCount >= 0,
      'invalidPage',
      'Playlist page counts must be non-negative integers'
    );
    if (Number.isSafeInteger(response.totalCount)) {
      assertRepositoryContract(
        response.resolvedCount + response.unresolvedCount === response.totalCount,
        'invalidPage',
        'Playlist page counts must match totalCount'
      );
    }
  }

  const byteLength = measureJsonBytes(response);
  assertRepositoryContract(
    byteLength <= MAX_QUERY_RESPONSE_BYTES,
    'responseTooLarge',
    'Query page exceeds the response byte limit',
    { byteLength, maximum: MAX_QUERY_RESPONSE_BYTES }
  );
  return { response, byteLength };
}

function assertNullableString(value, field) {
  assertRepositoryContract(
    value === null || (typeof value === 'string' && value.length > 0),
    'invalidPage',
    `${field} must be null or a non-empty string`
  );
}

function isValidTotalCount(value) {
  if (Number.isSafeInteger(value) && value >= 0) return true;
  return isPlainObject(value) &&
    Object.keys(value).length === 1 &&
    value.pending === true;
}

function assertExactFields(object, fields, code) {
  const actual = Object.keys(object).sort();
  const expected = [...fields].sort();
  assertRepositoryContract(
    actual.length === expected.length && actual.every((field, index) => field === expected[index]),
    code,
    'Object fields do not match the query contract',
    { actual, expected }
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
