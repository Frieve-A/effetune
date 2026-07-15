import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  buildCanonicalTuple,
  compareCanonicalTuples,
  createCanonicalOrderDescriptor,
  createKeysetPredicate,
  ENTITY_KINDS,
  validateCanonicalTuple
} from '../../js/library/repository/canonical-order.js';
import { LibraryRepositoryError } from '../../js/library/repository/contract-errors.js';
import {
  createQueryFingerprint,
  CURSOR_VERSION,
  decodeCursor,
  decodeQueryFingerprint,
  encodeCursor,
  validateCursorEnvelope
} from '../../js/library/repository/cursor-codec.js';
import { coalesceInvalidations } from '../../js/library/repository/invalidation.js';
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  MAX_QUERY_RESPONSE_BYTES,
  measureJsonBytes,
  normalizeQueryLimit,
  validatePageResponse
} from '../../js/library/repository/query-contract.js';
import {
  getMusicLibraryV2InitializationSql,
  MUSIC_LIBRARY_COLLATION_VERSION,
  MUSIC_LIBRARY_SEARCH_FIELDS,
  MUSIC_LIBRARY_SCHEMA_VERSION,
  MUSIC_LIBRARY_V2_ARTWORK_DIRECTORY,
  MUSIC_LIBRARY_V2_CACHE_DIRECTORY,
  MUSIC_LIBRARY_V2_DESKTOP_DATABASE_PATH,
  MUSIC_LIBRARY_V2_DESKTOP_DIRECTORY,
  MUSIC_LIBRARY_V2_SCHEMA_SQL,
  MUSIC_LIBRARY_V2_SESSION_SCHEMA_SQL,
  MUSIC_LIBRARY_V2_WEB_DATABASE,
  MUSIC_LIBRARY_V2_WEB_OPFS_DIRECTORY
} from '../../js/library/repository/schema-v2.js';
import {
  getCanonicalUidPayloadByteLength,
  MAX_INLINE_SELECTION_BYTES,
  MAX_INLINE_SELECTION_UIDS,
  validateSelectionDescriptor
} from '../../js/library/repository/selection-descriptor.js';
import {
  createCompactSearchText,
  foldKana,
  includesAllTokens,
  normalizeSearchText,
  tokenizeSearchQuery
} from '../../js/library/search-normalizer.js';

function assertErrorCode(callback, code) {
  assert.throws(callback, error => {
    assert.ok(error instanceof LibraryRepositoryError);
    assert.equal(error.code, code);
    return true;
  });
}

test('compact search text retains distinct word prefixes while deduplicating path metadata', () => {
  assert.equal(createCompactSearchText([
    'midnight signal',
    'horizon artist',
    'horizon artist',
    'rock',
    'music/horizon artist/midnight signal.flac'
  ]), 'rock\nmusic/horizon artist/midnight signal.flac');
  assert.equal(createCompactSearchText(['art', 'earth']), 'art\nearth');
});

test('search text normalization folds width, case, accents, kana, and whitespace', () => {
  assert.equal(foldKana('カタカナ A'), 'かたかな A');
  assert.equal(normalizeSearchText('  ＣＡＦÉ　カタカナ  '), 'cafe かたかな');
  assert.deepEqual(tokenizeSearchQuery('  Midnight　SIGNAL  '), ['midnight', 'signal']);
  assert.deepEqual(tokenizeSearchQuery(''), []);
  assert.equal(includesAllTokens('midnight signal', ['midnight', 'signal']), true);
  assert.equal(includesAllTokens('midnight signal', ['missing']), false);
  assert.equal(includesAllTokens('', []), true);
});

function createTrackOrder(overrides = {}) {
  return createCanonicalOrderDescriptor({
    id: 'tracks.artist.v1',
    endpoint: 'tracks',
    fields: [
      { field: 'artistKey', type: 'text', direction: 'asc', nulls: 'last' },
      { field: 'year', type: 'number', direction: 'desc', nulls: 'first' }
    ],
    stableIdField: 'trackUid',
    entityKind: 'track',
    ...overrides
  });
}

function createPage(overrides = {}) {
  return {
    rows: [{ trackUid: 't_one', title: 'One' }],
    nextCursor: null,
    previousCursor: null,
    totalCount: 1,
    catalogVersion: 4,
    contextToken: 'ctx_tracks',
    ...overrides
  };
}

function base64UrlEncodeJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

test('query contract enforces bounded limits and exact page shape', () => {
  assert.equal(normalizeQueryLimit(), DEFAULT_QUERY_LIMIT);
  assert.equal(normalizeQueryLimit(MAX_QUERY_LIMIT), MAX_QUERY_LIMIT);
  for (const invalid of [0, -1, 1.5, MAX_QUERY_LIMIT + 1, '200']) {
    assertErrorCode(() => normalizeQueryLimit(invalid), 'invalidLimit');
  }

  const validated = validatePageResponse(createPage());
  assert.equal(validated.response.rows.length, 1);
  assert.equal(validated.byteLength, measureJsonBytes(createPage()));
  validatePageResponse(createPage({ totalCount: { pending: true }, nextCursor: 'next', previousCursor: 'previous' }));
  validatePageResponse(createPage({ totalCount: 3, resolvedCount: 2, unresolvedCount: 1 }));

  assertErrorCode(() => validatePageResponse(createPage({ rows: [{}, {}] }), { limit: 1 }), 'pageLimitExceeded');
  assertErrorCode(() => validatePageResponse({ ...createPage(), extra: true }), 'invalidPage');
  assertErrorCode(() => validatePageResponse(createPage({ resolvedCount: 1 })), 'invalidPage');
  assertErrorCode(() => validatePageResponse(createPage({ resolvedCount: -1, unresolvedCount: 2 })), 'invalidPage');
  assertErrorCode(() => validatePageResponse(createPage({ resolvedCount: 1, unresolvedCount: 1 })), 'invalidPage');
  assertErrorCode(() => validatePageResponse(createPage({ nextCursor: '' })), 'invalidPage');
  assertErrorCode(() => validatePageResponse(createPage({ previousCursor: 3 })), 'invalidPage');
  assertErrorCode(() => validatePageResponse(createPage({ totalCount: -1 })), 'invalidPage');
  assertErrorCode(() => validatePageResponse(createPage({ totalCount: { pending: false } })), 'invalidPage');
  assertErrorCode(() => validatePageResponse(createPage({ catalogVersion: -1 })), 'invalidPage');
  assertErrorCode(() => validatePageResponse(createPage({ contextToken: '' })), 'invalidPage');
  assertErrorCode(() => validatePageResponse(null), 'invalidPage');
});

test('query response guard rejects oversized and unserializable pages', () => {
  const oversized = createPage({ rows: [{ text: 'x'.repeat(MAX_QUERY_RESPONSE_BYTES) }] });
  assertErrorCode(() => validatePageResponse(oversized), 'responseTooLarge');
  assertErrorCode(() => measureJsonBytes({ value: 1n }), 'unserializableResponse');
  assertErrorCode(() => measureJsonBytes(undefined), 'unserializableResponse');
});

test('canonical order descriptor shares tuple, comparison, and keyset semantics', () => {
  const descriptor = createTrackOrder();
  const rows = [
    { trackUid: 't_null', artistKey: null, year: 2020 },
    { trackUid: 't_old', artistKey: 'artist-a', year: 1990 },
    { trackUid: 't_new_b', artistKey: 'artist-a', year: 2020 },
    { trackUid: 't_new_a', artistKey: 'artist-a', year: 2020 },
    { trackUid: 't_year_null', artistKey: 'artist-a', year: null }
  ];
  const sorted = [...rows].sort(descriptor.compareRows);
  assert.deepEqual(sorted.map(row => row.trackUid), [
    't_year_null',
    't_new_a',
    't_new_b',
    't_old',
    't_null'
  ]);

  const tuple = descriptor.buildTuple(rows[2]);
  assert.deepEqual(tuple, [
    { type: 'text', nullRank: 0, value: 'artist-a' },
    { type: 'number', nullRank: 1, value: 2020 },
    { type: 'uid', nullRank: 0, value: 't_new_b' },
    { type: 'entityKind', nullRank: 0, value: 'track' }
  ]);
  assert.equal(descriptor.validateTuple(tuple), tuple);
  assert.equal(validateCanonicalTuple(descriptor, tuple), tuple);
  assert.deepEqual(buildCanonicalTuple(descriptor, rows[2]), tuple);
  assert.equal(compareCanonicalTuples(descriptor, tuple, descriptor.buildTuple(rows[1])), -1);

  const after = descriptor.createKeysetPredicate(descriptor.buildTuple(rows[3]), 'after');
  const before = createKeysetPredicate(descriptor, descriptor.buildTuple(rows[3]), 'before');
  assert.deepEqual(sorted.filter(after).map(row => row.trackUid), ['t_new_b', 't_old', 't_null']);
  assert.deepEqual(sorted.map(descriptor.buildTuple).filter(before).map(item => item.at(-2).value), ['t_year_null']);
  assertErrorCode(() => createKeysetPredicate(descriptor, tuple, 'sideways'), 'invalidContinuation');
});

test('canonical order validates mixed kinds, null ranks, types, and descriptor fields', () => {
  const mixed = createCanonicalOrderDescriptor({
    id: 'search.mixed.v1',
    endpoint: 'search',
    fields: [{ field: 'kindRank', type: 'number' }],
    stableIdField: 'id',
    allowedEntityKinds: ['artist', 'album']
  });
  const artist = mixed.buildTuple({ id: 'same', kindRank: 0, entityKind: 'artist' });
  const album = mixed.buildTuple({ id: 'same', kindRank: 0, entityKind: 'album' });
  assert.equal(mixed.compareTuples(artist, album), 1);
  assert.deepEqual(ENTITY_KINDS.slice(0, 3), ['track', 'album', 'artist']);
  assertErrorCode(() => mixed.buildTuple({ id: 'x', kindRank: 0, entityKind: 'track' }), 'invalidEntityKind');
  assertErrorCode(() => mixed.buildTuple({ id: '', kindRank: 0, entityKind: 'artist' }), 'invalidOrderDescriptor');
  assertErrorCode(() => mixed.buildTuple({ id: 'x', kindRank: Infinity, entityKind: 'artist' }), 'invalidOrderRow');
  assertErrorCode(() => mixed.validateTuple([...artist, { type: 'text', nullRank: 0, value: 'extra' }]), 'invalidCursorTuple');
  assertErrorCode(() => mixed.validateTuple([{ ...artist[0], nullRank: 1 }, ...artist.slice(1)]), 'invalidCursorTuple');
  assertErrorCode(() => mixed.validateTuple([{ ...artist[0], type: 'text' }, ...artist.slice(1)]), 'invalidCursorTuple');
  assertErrorCode(() => mixed.validateTuple([...artist.slice(0, -1), { ...artist.at(-1), value: 'track' }]), 'invalidCursorTuple');
  assertErrorCode(() => mixed.validateTuple([{ ...artist[0], extra: true }, ...artist.slice(1)]), 'invalidCursorTuple');

  const bytes = createCanonicalOrderDescriptor({
    id: 'bytes.v1',
    endpoint: 'bytes',
    fields: [
      { field: 'sortKey', type: 'bytes', direction: 'desc', nulls: 'last' },
      { field: 'active', type: 'boolean' }
    ],
    stableIdField: 'id',
    entityKind: 'playlist',
    stableIdDirection: 'desc',
    entityKindDirection: 'desc'
  });
  assert.equal(bytes.compareRows(
    { id: 'b', sortKey: 'YQ', active: true },
    { id: 'a', sortKey: 'YQ', active: true }
  ), -1);
  assertErrorCode(() => bytes.buildTuple({ id: 'a', sortKey: '+bad', active: true }), 'invalidOrderRow');
  assertErrorCode(() => bytes.buildTuple({ id: 'a', sortKey: 'YQ', active: 1 }), 'invalidOrderRow');

  const invalidDescriptors = [
    {},
    { id: 'x', endpoint: 'x', fields: [], stableIdField: 'id', entityKind: 'track' },
    { id: 'x', endpoint: 'x', fields: [{ field: 'x', type: 'date' }], stableIdField: 'id', entityKind: 'track' },
    { id: 'x', endpoint: 'x', fields: [{ field: 'x', type: 'text', direction: 'up' }], stableIdField: 'id', entityKind: 'track' },
    { id: 'x', endpoint: 'x', fields: [{ field: 'x', type: 'text', nulls: 'middle' }], stableIdField: 'id', entityKind: 'track' },
    { id: 'x', endpoint: 'x', fields: [{ field: 'x', type: 'text', extra: true }], stableIdField: 'id', entityKind: 'track' },
    { id: 'x', endpoint: 'x', fields: [{ field: 'x', type: 'text' }], stableIdField: 'id', allowedEntityKinds: ['unknown'] },
    { id: 'x', endpoint: 'x', fields: [{ field: 'x', type: 'text' }], stableIdField: 'id', entityKind: 'track', allowedEntityKinds: ['track', 'album'] },
    { id: 'x', endpoint: 'x', fields: [{ field: 'x', type: 'text' }], stableIdField: 'id', entityKind: 'track', stableIdDirection: 'up' }
  ];
  invalidDescriptors.forEach(input => assertErrorCode(() => createCanonicalOrderDescriptor(input), 'invalidOrderDescriptor'));
});

test('cursor codec binds the canonical envelope to endpoint, query, snapshot, sort, and continuation', () => {
  const descriptor = createTrackOrder();
  const queryFingerprint = createQueryFingerprint({
    endpoint: 'tracks',
    query: { scope: null, direction: 'asc', tokens: ['café'], sort: 'artist' }
  });
  const equivalentFingerprint = createQueryFingerprint({
    endpoint: 'tracks',
    query: { tokens: ['café'], sort: 'artist', direction: 'asc', scope: null }
  });
  assert.equal(queryFingerprint, equivalentFingerprint);
  assert.equal(decodeQueryFingerprint(queryFingerprint).endpoint, 'tracks');

  const tuple = descriptor.buildTuple({ trackUid: 't_cafe', artistKey: 'artist', year: 2024 });
  const cursor = encodeCursor({
    queryFingerprint,
    snapshotVersion: 12,
    sortSpecId: descriptor.id,
    continuation: 'after',
    tuple
  }, descriptor);
  const expected = {
    endpoint: 'tracks',
    queryFingerprint,
    snapshotVersion: 12,
    sortSpecId: descriptor.id,
    continuation: 'after',
    descriptor
  };
  const decoded = decodeCursor(cursor, expected);
  assert.equal(decoded.cursorVersion, CURSOR_VERSION);
  assert.deepEqual(decoded.tuple, tuple);

  const otherQuery = createQueryFingerprint({ endpoint: 'tracks', query: { sort: 'title' } });
  assertErrorCode(() => decodeCursor(cursor, { ...expected, endpoint: 'albums' }), 'cursorEndpointMismatch');
  assertErrorCode(() => decodeCursor(cursor, { ...expected, queryFingerprint: otherQuery }), 'cursorQueryMismatch');
  assertErrorCode(() => decodeCursor(cursor, { ...expected, snapshotVersion: 13 }), 'STALE_CURSOR');
  assertErrorCode(() => decodeCursor(cursor, { ...expected, sortSpecId: 'tracks.title.v1' }), 'cursorSortMismatch');
  assertErrorCode(() => decodeCursor(cursor, { ...expected, continuation: 'before' }), 'cursorDirectionMismatch');
  assertErrorCode(() => decodeCursor(cursor, { ...expected, descriptor: createTrackOrder({ endpoint: 'other' }) }), 'cursorContractMismatch');
});

test('cursor codec rejects malformed envelope and fingerprint structures', () => {
  const descriptor = createTrackOrder();
  const queryFingerprint = createQueryFingerprint({ endpoint: 'tracks', query: { sort: 'artist' } });
  const tuple = descriptor.buildTuple({ trackUid: 't_one', artistKey: 'artist', year: 2020 });
  const envelope = {
    cursorVersion: CURSOR_VERSION,
    queryFingerprint,
    snapshotVersion: 1,
    sortSpecId: descriptor.id,
    continuation: 'after',
    tuple
  };
  assert.equal(validateCursorEnvelope(envelope, { descriptor }), envelope);

  assertErrorCode(() => validateCursorEnvelope({ ...envelope, unknown: true }, { descriptor }), 'malformedCursor');
  assertErrorCode(() => validateCursorEnvelope({ ...envelope, cursorVersion: 2 }, { descriptor }), 'malformedCursor');
  assertErrorCode(() => validateCursorEnvelope({ ...envelope, snapshotVersion: -1 }, { descriptor }), 'malformedCursor');
  assertErrorCode(() => validateCursorEnvelope({ ...envelope, sortSpecId: '' }, { descriptor }), 'malformedCursor');
  assertErrorCode(() => validateCursorEnvelope({ ...envelope, continuation: 'next' }, { descriptor }), 'malformedCursor');
  assertErrorCode(() => validateCursorEnvelope(envelope, { descriptor: null }), 'cursorContractMismatch');
  assertErrorCode(() => decodeCursor('not-a-cursor', {}), 'malformedCursor');
  assertErrorCode(() => decodeCursor(`c1.${base64UrlEncodeJson({ broken: true })}`, {}), 'malformedCursor');
  assertErrorCode(() => decodeCursor('c1.invalid*', {}), 'malformedCursor');

  assertErrorCode(() => createQueryFingerprint({ endpoint: '', query: {} }), 'invalidQueryFingerprint');
  assertErrorCode(() => createQueryFingerprint({ endpoint: 'x', query: [] }), 'invalidQueryFingerprint');
  assertErrorCode(() => createQueryFingerprint({ endpoint: 'x', query: { bad: undefined } }), 'invalidQueryFingerprint');
  assertErrorCode(() => createQueryFingerprint({ endpoint: 'x', query: { bad: Infinity } }), 'invalidQueryFingerprint');
  assertErrorCode(() => decodeQueryFingerprint('q2.invalid'), 'invalidQueryFingerprint');
  assertErrorCode(() => decodeQueryFingerprint('q1.invalid*'), 'invalidQueryFingerprint');
  assertErrorCode(() => decodeQueryFingerprint(`q1.${base64UrlEncodeJson({ version: 1, endpoint: 'x', query: {}, extra: true })}`), 'invalidQueryFingerprint');
});

test('selection descriptors preserve compact all and range forms and bound sparse identities', () => {
  const all = validateSelectionDescriptor({ mode: 'all', contextToken: 'ctx_million', exclusions: new Set(['t_skip']) });
  assert.deepEqual(all, { mode: 'all', contextToken: 'ctx_million', exclusions: ['t_skip'] });
  const range = validateSelectionDescriptor({
    mode: 'range',
    contextToken: 'ctx_million',
    startUid: 't_first',
    endUid: 't_last',
    inclusions: ['t_outside', 't_excluded'],
    exclusions: ['t_excluded']
  });
  assert.equal(range.endUid, 't_last');
  assert.deepEqual(range.inclusions, ['t_outside']);

  const atLimit = Array.from({ length: MAX_INLINE_SELECTION_UIDS }, (_, index) => `t_${index}`);
  assert.equal(validateSelectionDescriptor({ mode: 'explicit', contextToken: 'ctx', trackUids: atLimit }).trackUids.length, MAX_INLINE_SELECTION_UIDS);
  assertErrorCode(() => validateSelectionDescriptor({ mode: 'explicit', contextToken: 'ctx', trackUids: [...atLimit, 'overflow'] }), 'selectionTooLarge');
  assertErrorCode(() => validateSelectionDescriptor({ mode: 'explicit', contextToken: 'ctx', trackUids: ['same', 'same'] }), 'duplicateSelectionUid');
  assertErrorCode(() => validateSelectionDescriptor({ mode: 'all', contextToken: 'ctx', exclusions: ['same', 'same'] }), 'duplicateSelectionUid');
  assertErrorCode(() => validateSelectionDescriptor({ mode: 'explicit', contextToken: 'ctx', trackUids: [null] }), 'invalidSelection');
  assertErrorCode(() => validateSelectionDescriptor({ mode: 'unknown', contextToken: 'ctx' }), 'invalidSelection');
  assertErrorCode(() => validateSelectionDescriptor({ mode: 'all', contextToken: 'ctx', exclusions: [], extra: true }), 'invalidSelection');
  assertErrorCode(() => validateSelectionDescriptor({ mode: 'range', contextToken: 'ctx', startUid: '', endUid: 'x', exclusions: [] }), 'invalidSelection');
});

test('selection byte accounting includes field and item length framing at exact boundaries', () => {
  const uidAtLimit = 'x'.repeat(MAX_INLINE_SELECTION_BYTES - 8);
  assert.equal(getCanonicalUidPayloadByteLength([[uidAtLimit]]), MAX_INLINE_SELECTION_BYTES);
  assert.equal(getCanonicalUidPayloadByteLength([['x'.repeat(MAX_INLINE_SELECTION_BYTES - 9)]]), MAX_INLINE_SELECTION_BYTES - 1);
  assert.equal(getCanonicalUidPayloadByteLength([['x'.repeat(MAX_INLINE_SELECTION_BYTES - 7)]]), MAX_INLINE_SELECTION_BYTES + 1);
  validateSelectionDescriptor({ mode: 'explicit', contextToken: 'ctx', trackUids: [uidAtLimit] });
  assertErrorCode(() => validateSelectionDescriptor({
    mode: 'explicit',
    contextToken: 'ctx',
    trackUids: [`${uidAtLimit}x`]
  }), 'selectionTooLarge');
  assertErrorCode(() => getCanonicalUidPayloadByteLength('not-fields'), 'invalidSelection');
});

test('scope invalidation coalescing unions scopes and keeps each newest scope state', () => {
  assert.deepEqual(coalesceInvalidations(), {
    catalogVersion: 0,
    changedScopes: [],
    scopeVersions: {},
    counts: {}
  });
  const merged = coalesceInvalidations([
    {
      catalogVersion: 9,
      changedScopes: ['tracks', 'albums'],
      scopeVersions: { tracks: 3, albums: 2 },
      counts: { tracks: 100, albums: 10 }
    },
    {
      catalogVersion: 10,
      changedScopes: ['playlists', 'artwork'],
      scopeVersions: { playlists: 4, artwork: 1 },
      counts: { playlists: 5 }
    },
    {
      catalogVersion: 8,
      changedScopes: ['tracks'],
      scopeVersions: { tracks: 4 },
      counts: { tracks: 101 }
    },
    {
      catalogVersion: 11,
      changedScopes: ['albums'],
      scopeVersions: { albums: 2 },
      counts: { albums: 11 }
    }
  ]);
  assert.deepEqual(merged, {
    catalogVersion: 11,
    changedScopes: ['tracks', 'albums', 'playlists', 'artwork'],
    scopeVersions: { tracks: 4, albums: 2, playlists: 4, artwork: 1 },
    counts: { tracks: 101, albums: 11, playlists: 5 }
  });

  const invalid = {
    catalogVersion: -1,
    changedScopes: ['tracks'],
    scopeVersions: { tracks: 1 },
    counts: { tracks: 1 }
  };
  assertErrorCode(() => coalesceInvalidations(invalid), 'invalidInvalidation');
  assertErrorCode(() => coalesceInvalidations({ ...invalid, catalogVersion: 1, changedScopes: ['tracks', 'tracks'] }), 'invalidInvalidation');
  assertErrorCode(() => coalesceInvalidations({ ...invalid, catalogVersion: 1, scopeVersions: {} }), 'invalidInvalidation');
  assertErrorCode(() => coalesceInvalidations({ ...invalid, catalogVersion: 1, counts: {} }), 'invalidInvalidation');
  assertErrorCode(() => coalesceInvalidations({ ...invalid, catalogVersion: 1, counts: { tracks: -1 } }), 'invalidInvalidation');
  assertErrorCode(() => coalesceInvalidations({ ...invalid, catalogVersion: 1, counts: { tracks: 1, artwork: 1 } }), 'invalidInvalidation');
  assertErrorCode(() => coalesceInvalidations({ ...invalid, catalogVersion: 1, extra: true }), 'invalidInvalidation');
});

test('SQLite v2 schema creates required catalog, scan, playlist, and durability structures', () => {
  assert.equal(MUSIC_LIBRARY_SCHEMA_VERSION, 2);
  assert.equal(MUSIC_LIBRARY_COLLATION_VERSION, 'canonical-sort-key-v1');
  assert.equal(MUSIC_LIBRARY_V2_DESKTOP_DIRECTORY, 'music-library-v2');
  assert.equal(MUSIC_LIBRARY_V2_DESKTOP_DATABASE_PATH, 'music-library-v2/catalog.sqlite');
  assert.equal(MUSIC_LIBRARY_V2_ARTWORK_DIRECTORY, 'music-library-v2/artwork');
  assert.equal(MUSIC_LIBRARY_V2_CACHE_DIRECTORY, 'music-library-v2/cache');
  assert.equal(MUSIC_LIBRARY_V2_WEB_OPFS_DIRECTORY, 'effetune-music-library-sqlite-v2');
  assert.match(MUSIC_LIBRARY_V2_WEB_DATABASE, /v2/);
  assert.deepEqual(MUSIC_LIBRARY_SEARCH_FIELDS, [
    'title', 'artist', 'album_artist', 'album', 'genre', 'file_name', 'relative_path'
  ]);
  assert.equal(
    getMusicLibraryV2InitializationSql({ includePragmas: false }),
    `${MUSIC_LIBRARY_V2_SCHEMA_SQL}\n${MUSIC_LIBRARY_V2_SESSION_SCHEMA_SQL}`
  );
  assert.match(getMusicLibraryV2InitializationSql(), /PRAGMA foreign_keys = ON/);
  const webInitializationSql = getMusicLibraryV2InitializationSql({ journalMode: 'persist' });
  assert.match(webInitializationSql, /PRAGMA journal_mode = PERSIST/);
  assert.match(webInitializationSql, /CREATE TABLE IF NOT EXISTS query_contexts/);
  assert.doesNotMatch(MUSIC_LIBRARY_V2_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS query_contexts/);

  const database = new DatabaseSync(':memory:');
  try {
    database.exec(getMusicLibraryV2InitializationSql());
    const tableNames = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type IN ('table', 'view')
    `).all().map(row => row.name);
    for (const name of [
      'folders',
      'tracks',
      'albums',
      'artists',
      'genres',
      'tracks_fts',
      'tracks_prefix_fts',
      'search_index_control',
      'scan_runs',
      'scan_run_folders',
      'scan_seen',
      'operation_jobs',
      'snapshot_objects',
      'snapshot_object_owners',
      'playlists',
      'playlist_items',
      'deletion_repair_items',
      'artwork_assets',
      'artwork_variants',
      'operation_progress',
      'snapshot_items',
      'metadata_claims',
      'artwork_claims'
    ]) {
      assert.ok(tableNames.includes(name), `missing table ${name}`);
    }
    assert.equal(tableNames.includes('catalog_versions'), false);
    assert.equal(tableNames.includes('undo_records'), false);
    assert.equal(tableNames.includes('query_contexts'), false);
    assert.equal(tableNames.includes('query_context_track_before_images'), false);
    assert.equal(tableNames.includes('playback_sequences'), false);
    assert.equal(tableNames.includes('playback_sequence_items'), false);
    assert.equal(tableNames.includes('transport_state'), false);
    const sessionTableNames = database.prepare(`
      SELECT name FROM sqlite_temp_master WHERE type = 'table'
    `).all().map(row => row.name);
    assert.ok(sessionTableNames.includes('playback_sequences'));
    assert.ok(sessionTableNames.includes('playback_sequence_items'));
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    database.close();
  }

  const webDatabase = new DatabaseSync(':memory:');
  try {
    webDatabase.exec(webInitializationSql);
    const webTableNames = webDatabase.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all().map(row => row.name);
    assert.ok(webTableNames.includes('query_contexts'));
    assert.ok(webTableNames.includes('query_context_track_before_images'));
  } finally {
    webDatabase.close();
  }
});

test('SQLite v2 schema enforces operation, ownership, and playlist invariants', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(getMusicLibraryV2InitializationSql());
    const insertOperation = database.prepare(`
      INSERT INTO operation_jobs(
        operation_id, client_request_id, request_digest, canonical_request_version,
        operation_kind, phase, heavy, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 'playlist-add', 'RECEIVED', ?, 1, 1)
    `);
    insertOperation.run('op_one', 'request_one', 'digest_one', 1);
    assert.throws(() => insertOperation.run('op_two', 'request_two', 'digest_two', 1), /UNIQUE constraint failed/);
    assert.throws(() => insertOperation.run('op_three', 'request_one', 'digest_three', 0), /UNIQUE constraint failed/);
    insertOperation.run('op_light', 'request_light', 'digest_light', 0);

    const insertSnapshot = database.prepare(`
      INSERT INTO snapshot_objects(
        snapshot_id, snapshot_kind, state, staging_operation_id, owner_ref_count, created_at
      ) VALUES (?, 'selection', ?, ?, ?, 1)
    `);
    insertSnapshot.run('snapshot_staging', 'staging', 'op_one', 0);
    insertSnapshot.run('snapshot_sealed', 'sealed', null, 1);
    assert.throws(() => insertSnapshot.run('snapshot_bad_ref', 'sealed', null, -1), /CHECK constraint failed/);
    assert.throws(() => insertSnapshot.run('snapshot_bad_state', 'staging', null, 0), /CHECK constraint failed/);

    database.prepare(`
      INSERT INTO folders(id, kind, display_name, status, added_at)
      VALUES ('folder', 'electron', 'Music', 'ok', 1)
    `).run();
    database.prepare(`
      INSERT INTO tracks(
        track_uid, folder_id, relative_path, file_name, title,
        metadata_parser_version, added_at, updated_at, search_text
      ) VALUES ('track', 'folder', 'Song.flac', 'Song.flac', 'Song', 'parser-1', 1, 1, 'song artist album')
    `).run();
    assert.equal(database.prepare(`
      SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'son'
    `).get().rowid, 1);
    assert.equal(database.prepare(`
      SELECT rowid FROM tracks_prefix_fts WHERE tracks_prefix_fts MATCH 'so*'
    `).get().rowid, 1);
    database.prepare(`UPDATE tracks SET search_text = 'updated creator record' WHERE track_uid = 'track'`).run();
    assert.equal(database.prepare(`
      SELECT count(*) AS count FROM tracks_fts WHERE tracks_fts MATCH 'son'
    `).get().count, 0);
    assert.equal(database.prepare(`
      SELECT count(*) AS count FROM tracks_prefix_fts WHERE tracks_prefix_fts MATCH 'so*'
    `).get().count, 0);
    assert.equal(database.prepare(`
      SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'upd'
    `).get().rowid, 1);
    assert.equal(database.prepare(`
      SELECT rowid FROM tracks_prefix_fts WHERE tracks_prefix_fts MATCH 'up*'
    `).get().rowid, 1);
    database.prepare(`
      INSERT INTO playlists(id, name, state, version, created_at, updated_at)
      VALUES ('playlist', 'List', 'active', 0, 1, 1)
    `).run();
    const insertItem = database.prepare(`
      INSERT INTO playlist_items(playlist_id, position, track_uid, unresolved_json)
      VALUES ('playlist', ?, ?, ?)
    `);
    insertItem.run(10, 'track', null);
    insertItem.run(20, null, '{"sourceLine":"missing.flac"}');
    assert.throws(() => insertItem.run(30, null, null), /CHECK constraint failed/);
    assert.throws(() => insertItem.run(40, 'track', '{}'), /CHECK constraint failed/);
    assert.throws(() => database.prepare('DELETE FROM tracks WHERE track_uid = ?').run('track'), /FOREIGN KEY constraint failed/);
  } finally {
    database.close();
  }
});
