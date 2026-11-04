import {
  catalogState,
  bindCatalogPlatform,
  ACTIVE_PLAYLIST_TRACK_CLAUSE,
  ACTIVE_TRACK_FOLDER_CLAUSE,
  DEFAULT_CONTEXT_TTL_MS,
  DEFAULT_CONTEXT_WAL_CAP_BYTES,
  DEFAULT_MAX_CONTEXTS,
  DIRECTORY_RESPONSE_BYTE_BUDGET,
  DURABLE_OPERATION_KINDS,
  MAX_ARTWORK_RAW_BYTES,
  MAX_CONTEXTS,
  MAX_CONTEXT_TTL_MS,
  MAX_CONTEXT_WAL_CAP_BYTES,
  MAX_DIRECTORY_PATH_CHARACTERS,
  MAX_QUERY_LIMIT,
  MAX_RESPONSE_BYTES,
  MAX_WRITE_BATCH_ROWS,
  MIN_CONTEXT_TTL_MS,
  MIN_CONTEXT_WAL_CAP_BYTES,
  PLAYLIST_RESOLUTION_CANDIDATE_LIMIT,
  PROTOCOL_VERSION,
  RECENT_TRACK_LIMIT,
  SEARCH_FIELDS,
  TERMINAL_OPERATION_PHASES,
  advanceScanMetadataCursor,
  appendOperationSnapshotItems,
  appendPlaybackSequenceItems,
  appendPlaylistImportRecords,
  appendPlaylistItems,
  appendSequencePlaylistPage,
  assertAllowedFields,
  assertExactFields,
  assertSchemaSearchFields,
  beginArtworkUtilitySession,
  bindArtworkSourceDetails,
  claimArtworkSource,
  claimMetadataParse,
  claimMetadataParseBatch,
  cleanupPlaylistItems,
  clearCueScanStageRows,
  closeDatabase,
  commitScanSeenBatch,
  completeMetadataParseBatch,
  completeMetadataParseFailure,
  completeMetadataParseSuccess,
  completeOperation,
  completePendingScanSweepRecovery,
  completeScanFolder,
  completeScanFolderNoSweep,
  contexts,
  countEntityContextRows,
  createCatalogError,
  createDirectoryAncestors,
  createKeysetSql,
  createNoChangeResult,
  createOperationSnapshot,
  createOperationTargetIdentity,
  createOrder,
  createOrderBySql,
  createPhysicalSourceKey,
  createPlaybackSequence,
  createPlaylist,
  createPlaylistContextFilter,
  createPlaylistKeysetSql,
  createPlaylistOrder,
  createPlaylistTrackPageSelection,
  createPlaylistWithItems,
  createSortKey,
  createTrigramFtsQuery,
  cueDirectoryStage,
  duplicatePlaylist,
  encodeBoundaryCursor,
  enqueueScanSweep,
  ensureDirectoriesSynchronized,
  ensureFolderDeletionJob,
  ensurePlaylistContextCounts,
  evictArtworkCache,
  finalizePlaylistImportPage,
  finalizeScanEnumeration,
  gcOperationSnapshots,
  gcPlaylistItems,
  gcTerminalOperations,
  getArtworkTrack,
  getAutomaticPlaylistImportState,
  getCachedArtwork,
  getContextCount,
  getCounts,
  getFavoriteTrackUids,
  getOperationStatus,
  getScanFolderTrackCount,
  getSystemPlaylists,
  getTrack,
  getTrackStorageIdentity,
  hasDeletionMaintenanceWork,
  listMetadataCandidates,
  markDirectoriesSynchronized,
  markScanEnumerationIneligible,
  normalizeBoundedInteger,
  normalizeContextQuery,
  normalizeDirectoryPath,
  normalizeQueryLimit,
  normalizeRelativePath,
  normalizeWriteLimit,
  optionalNullableNonNegativeInteger,
  parseFolderDirKey,
  parseStoredJson,
  pauseScanFolder,
  pendingEntityAggregationScans,
  pendingScanInvalidations,
  pendingScanSweepRecoveries,
  pickCounts,
  playlistPathSuffixScore,
  preflightArtworkBatch,
  preflightScanBatch,
  prepareSequencePlaylistSave,
  publishArtwork,
  publishPlaylist,
  queryEntities,
  queryOperationSnapshot,
  queryPlaybackSequence,
  queryPlaylistItems,
  queryTracks,
  queryTransportDescriptorPage,
  quoteFtsLiteral,
  readContextPage,
  readContextPageAtOrdinal,
  readCounts,
  recordArtworkFailure,
  recordOperationProgress,
  recordRecentlyPlayed,
  recordScanErrors,
  recoverInterruptedMetadataClaims,
  recoverInterruptedScans,
  releaseOperationSnapshots,
  removeLegacyPlaybackOperations,
  removePlaylistItem,
  removeTrackArtworkReferences,
  removeTrackEntityMemberships,
  renamePlaylist,
  reorderPlaylistItem,
  repairBlockedDeletionItems,
  requestOperationCancel,
  requeueLatestMetadata,
  requireActiveScanFolder,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireString,
  resolveCuePlaylistTrack,
  resolveEntityAnchor,
  runDeletionMaintenanceTurn,
  runFolderDeletionChunk,
  runScanSweep,
  scheduleArtworkStagingGc,
  scheduleDeletionMaintenance,
  sealOperationSnapshot,
  sealPlaybackSequence,
  setTrackFavorite,
  stripOrderFields,
  tombstonePlaylist,
  trackFieldExpression,
  transitionOperation,
  upsertFolders,
  upsertTracks,
  validateBoundedStringList
} from './catalog-runtime-core.js';

import * as schema from './schema-v3.js';
import * as canonicalOrder from './canonical-order.js';
import * as orderContract from './catalog-order-contract.js';
import * as cursorCodec from './cursor-codec.js';
import * as queryContract from './query-contract.js';
import * as transportShuffle from './transport-shuffle.js';
import * as searchNormalizer from '../search-normalizer.js';
import { isTrackCoverRelativePath } from '../metadata/cue-cover.js';
import { sha256Hex } from './sha256.js';

const textEncoder = new TextEncoder();
const threadId = 'web';
catalogState.workerData = {};
const utf8ByteLength = value => textEncoder.encode(String(value)).byteLength;
const hexToBytes = value => {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};
const Buffer = Object.freeze({
  byteLength: utf8ByteLength,
  from(value, encoding) {
    if (encoding === 'hex') return hexToBytes(value);
    if (value instanceof Uint8Array) return value.slice();
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    return textEncoder.encode(String(value));
  }
});
const createHash = algorithm => {
  if (algorithm !== 'sha256') throw new TypeError('Only SHA-256 is supported');
  let value;
  return {
    update(bytes) {
      value = bytes;
      return this;
    },
    digest(format) {
      if (format !== 'hex') throw new TypeError('Only hexadecimal digests are supported');
      return sha256Hex(value);
    }
  };
};
const randomUUID = () => {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw createCatalogError('cryptoUnavailable', 'Secure catalog IDs are unavailable');
  }
  return globalThis.crypto.randomUUID();
};

const normalizePosixPath = value => {
  const absolute = String(value).startsWith('/');
  const parts = [];
  for (const part of String(value).replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}` || (absolute ? '/' : '.');
};
const posix = Object.freeze({
  basename(value, suffix = '') {
    const name = normalizePosixPath(value).split('/').at(-1) ?? '';
    return suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  },
  dirname(value) {
    const normalized = normalizePosixPath(value);
    const index = normalized.lastIndexOf('/');
    return index < 0 ? '.' : index === 0 ? '/' : normalized.slice(0, index);
  },
  extname(value) {
    const name = this.basename(value);
    const index = name.lastIndexOf('.');
    return index <= 0 ? '' : name.slice(index);
  }
});
const path = Object.freeze({
  posix,
  sep: '/',
  isAbsolute: value => String(value).startsWith('/'),
  normalize: normalizePosixPath,
  resolve: (...parts) => normalizePosixPath(`/${parts.join('/')}`),
  dirname: posix.dirname,
  relative(from, to) {
    const base = normalizePosixPath(from).split('/').filter(Boolean);
    const target = normalizePosixPath(to).split('/').filter(Boolean);
    while (base[0] === target[0]) {
      base.shift();
      target.shift();
    }
    return [...base.map(() => '..'), ...target].join('/');
  }
});
const fs = Object.freeze({
  mkdirSync() {},
  statSync() { return { size: 0 }; },
  statfsSync() {
    const blocks = Math.max(0, Math.floor(Number(catalogState.storageEstimate.quota) || 0));
    const usedBlocks = Math.max(0, Math.floor(Number(catalogState.storageEstimate.usage) || 0));
    return { bsize: 1, blocks, bavail: Math.max(0, blocks - usedBlocks) };
  },
  realpathSync: Object.assign(value => value, { native: value => value })
});

const MAX_REQUEST_BYTES = 1024 * 1024;
const SUBFOLDER_CAPTION_SQL = `COALESCE(
  (SELECT root.display_name || ' / ' FROM folders root WHERE root.id = e.folder_id),
  ''
) || e.relative_path`;

const ENTITY_DEFINITIONS = Object.freeze({
  album: Object.freeze({
    table: 'albums',
    scope: 'albums',
    fixedClauses: Object.freeze([
      createActiveEntityMembershipClause('track_albums', 'album_key')
    ]),
    stableIdColumn: 'album_key',
    stableIdField: 'albumKey',
    defaultSort: 'name',
    searchColumns: Object.freeze(['sort_name', 'sort_artist']),
    publicSelection: Object.freeze([
      'e.album_key AS albumKey',
      'e.identity_version AS identityVersion',
      'e.name',
      'e.artist',
      `${createActiveAlbumYearExpression()} AS year`,
      createActiveAggregateSelection('track_albums', 'album_key', 'count(*)', 'track_count', 'trackCount'),
      createActiveAggregateSelection(
        'track_albums', 'album_key', 'COALESCE(SUM(active_track.duration_sec), 0)',
        'total_duration_sec', 'totalDurationSec'
      ),
      createActiveRepresentativeTrackSelection('track_albums', 'album_key'),
      'e.representative_artwork_id AS representativeArtworkId'
    ]),
    sorts: Object.freeze({
      name: Object.freeze([
        Object.freeze({ field: 'sortName', column: 'sort_name', type: 'text', nulls: 'last' }),
        Object.freeze({ field: 'sortArtist', column: 'sort_artist', type: 'text', nulls: 'last' })
      ]),
      artist: Object.freeze([
        Object.freeze({ field: 'sortArtist', column: 'sort_artist', type: 'text', nulls: 'last' }),
        Object.freeze({ field: 'sortName', column: 'sort_name', type: 'text', nulls: 'last' })
      ]),
      year: Object.freeze([
        Object.freeze({
          field: 'year',
          column: 'year',
          expression: createActiveAlbumYearExpression(),
          type: 'number',
          nulls: 'last'
        }),
        Object.freeze({ field: 'sortName', column: 'sort_name', type: 'text', nulls: 'last' })
      ]),
      trackCount: Object.freeze([
        Object.freeze({
          field: 'trackCount',
          column: 'track_count',
          expression: createActiveAggregateExpression('track_albums', 'album_key', 'count(*)', 'track_count'),
          type: 'number',
          nulls: 'last'
        }),
        Object.freeze({ field: 'sortName', column: 'sort_name', type: 'text', nulls: 'last' })
      ]),
      duration: Object.freeze([
        Object.freeze({
          field: 'totalDurationSec',
          column: 'total_duration_sec',
          expression: createActiveAggregateExpression(
            'track_albums', 'album_key', 'COALESCE(SUM(active_track.duration_sec), 0)', 'total_duration_sec'
          ),
          type: 'number',
          nulls: 'last'
        }),
        Object.freeze({ field: 'sortName', column: 'sort_name', type: 'text', nulls: 'last' })
      ])
    })
  }),
  artist: Object.freeze({
    table: 'artists',
    scope: 'artists',
    fixedClauses: Object.freeze([
      createActiveEntityMembershipClause('track_artists', 'artist_key')
    ]),
    stableIdColumn: 'artist_key',
    stableIdField: 'artistKey',
    defaultSort: 'name',
    searchColumns: Object.freeze(['sort_name']),
    publicSelection: Object.freeze([
      'e.artist_key AS artistKey',
      'e.identity_version AS identityVersion',
      'e.name',
      createActiveAggregateSelection('track_artists', 'artist_key', 'count(*)', 'track_count', 'trackCount'),
      createActiveAggregateSelection(
        'track_artists', 'artist_key', 'COALESCE(SUM(active_track.duration_sec), 0)',
        'total_duration_sec', 'totalDurationSec'
      ),
      createActiveRepresentativeTrackSelection('track_artists', 'artist_key'),
      'e.representative_artwork_id AS representativeArtworkId'
    ]),
    sorts: createNamedEntitySorts('track_artists', 'artist_key')
  }),
  genre: Object.freeze({
    table: 'genres',
    scope: 'genres',
    fixedClauses: Object.freeze([
      createActiveEntityMembershipClause('track_genres', 'genre_key')
    ]),
    stableIdColumn: 'genre_key',
    stableIdField: 'genreKey',
    defaultSort: 'name',
    searchColumns: Object.freeze(['sort_name']),
    publicSelection: Object.freeze([
      'e.genre_key AS genreKey',
      'e.identity_version AS identityVersion',
      'e.name',
      createActiveAggregateSelection('track_genres', 'genre_key', 'count(*)', 'track_count', 'trackCount'),
      createActiveAggregateSelection(
        'track_genres', 'genre_key', 'COALESCE(SUM(active_track.duration_sec), 0)',
        'total_duration_sec', 'totalDurationSec'
      ),
      createActiveRepresentativeTrackSelection('track_genres', 'genre_key'),
      'e.representative_artwork_id AS representativeArtworkId'
    ]),
    sorts: createNamedEntitySorts('track_genres', 'genre_key')
  }),
  folder: Object.freeze({
    table: 'folders',
    scope: 'folders',
    fixedClauses: Object.freeze(["e.status <> 'removed'"]),
    stableIdColumn: 'id',
    stableIdField: 'id',
    defaultSort: 'name',
    searchColumns: Object.freeze(['sort_name']),
    publicSelection: Object.freeze([
      'e.id',
      'e.kind',
      'NULL AS path',
      'e.display_name AS displayName',
      "CASE WHEN e.status = 'offline' THEN 'needs-permission' ELSE e.status END AS status",
      'e.scan_generation AS scanGeneration',
      'e.lifecycle_version AS lifecycleVersion',
      'e.added_at AS addedAt',
      'e.last_scan_at AS lastScanAt',
      '(SELECT count(*) FROM tracks active_track WHERE active_track.folder_id = e.id) AS trackCount'
    ]),
    sorts: Object.freeze({
      name: Object.freeze([
        Object.freeze({ field: 'sortName', column: 'sort_name', type: 'text', nulls: 'last' })
      ]),
      added: Object.freeze([
        Object.freeze({ field: 'addedAt', column: 'added_at', type: 'number', nulls: 'last' })
      ])
    })
  }),
  subfolder: Object.freeze({
    table: 'subfolders',
    scope: 'subfolders',
    fixedClauses: Object.freeze([
      createActiveEntityMembershipClause('track_subfolders', 'subfolder_key'),
      "EXISTS(SELECT 1 FROM folders active_folder WHERE active_folder.id = e.folder_id AND active_folder.status <> 'removed')"
    ]),
    stableIdColumn: 'subfolder_key',
    stableIdField: 'subfolderKey',
    defaultSort: 'path',
    searchColumns: Object.freeze(['sort_name']),
    publicSelection: Object.freeze([
      'e.subfolder_key AS subfolderKey',
      'e.folder_id AS folderId',
      'e.identity_version AS identityVersion',
      'e.display_name AS name',
      'e.display_name AS displayName',
      `${SUBFOLDER_CAPTION_SQL} AS caption`,
      createActiveAggregateSelection('track_subfolders', 'subfolder_key', 'count(*)', 'track_count', 'trackCount'),
      createActiveAggregateSelection(
        'track_subfolders', 'subfolder_key', 'COALESCE(SUM(active_track.duration_sec), 0)',
        'total_duration_sec', 'totalDurationSec'
      ),
      createActiveRepresentativeTrackSelection('track_subfolders', 'subfolder_key'),
      'e.representative_artwork_id AS representativeArtworkId'
    ]),
    sorts: Object.freeze({
      ...createNamedEntitySorts('track_subfolders', 'subfolder_key'),
      path: Object.freeze([
        Object.freeze({ field: 'folderSortKey', column: 'folder_id', type: 'text', nulls: 'last' }),
        Object.freeze({ field: 'subfolderSortPath', column: 'relative_path', type: 'text', nulls: 'last' })
      ])
    })
  }),
  playlist: Object.freeze({
    table: 'playlists',
    scope: 'playlists',
    stableIdColumn: 'id',
    stableIdField: 'id',
    defaultSort: 'name',
    searchColumns: Object.freeze(['sort_name']),
    publicSelection: Object.freeze([
      'e.id',
      'e.name',
      'e.state',
      'e.version',
      'e.created_at AS createdAt',
      'e.updated_at AS updatedAt',
      `(SELECT count(*)
        FROM playlist_items visible_item
        LEFT JOIN operation_jobs visible_operation
          ON visible_operation.operation_id = visible_item.pending_operation_id
        WHERE visible_item.playlist_id = e.id
          AND (visible_item.pending_operation_id IS NULL OR (
            visible_operation.committed = 1 AND visible_operation.terminal_kind = 'success'
          ))) AS itemCount`
    ]),
    fixedClauses: Object.freeze([
      "e.state = 'active'"
    ]),
    sorts: Object.freeze({
      name: Object.freeze([
        Object.freeze({ field: 'sortName', column: 'sort_name', type: 'text', nulls: 'last' })
      ]),
      updated: Object.freeze([
        Object.freeze({ field: 'updatedAt', column: 'updated_at', type: 'number', nulls: 'last' })
      ]),
      created: Object.freeze([
        Object.freeze({ field: 'createdAt', column: 'created_at', type: 'number', nulls: 'last' })
      ])
    })
  })
});

function createNamedEntitySorts(membershipTable, keyColumn) {
  const nameField = { field: 'sortName', column: 'sort_name', type: 'text', nulls: 'last' };
  return Object.freeze({
    name: Object.freeze([Object.freeze(nameField)]),
    trackCount: Object.freeze([
      Object.freeze({
        field: 'trackCount',
        column: 'track_count',
        expression: createActiveAggregateExpression(membershipTable, keyColumn, 'count(*)', 'track_count'),
        type: 'number',
        nulls: 'last'
      }),
      Object.freeze(nameField)
    ]),
    duration: Object.freeze([
      Object.freeze({
        field: 'totalDurationSec',
        column: 'total_duration_sec',
        expression: createActiveAggregateExpression(
          membershipTable, keyColumn, 'COALESCE(SUM(active_track.duration_sec), 0)', 'total_duration_sec'
        ),
        type: 'number',
        nulls: 'last'
      }),
      Object.freeze(nameField)
    ])
  });
}

function createActiveEntityMembershipClause(membershipTable, keyColumn) {
  return `(
    NOT EXISTS(
      SELECT 1 FROM ${membershipTable} any_membership
      WHERE any_membership.${keyColumn} = e.${keyColumn}
    )
    OR EXISTS(
      SELECT 1 FROM ${membershipTable} active_membership
      JOIN tracks active_track ON active_track.track_uid = active_membership.track_uid
      JOIN folders active_folder ON active_folder.id = active_track.folder_id
        AND active_folder.status <> 'removed'
      WHERE active_membership.${keyColumn} = e.${keyColumn}
    )
  )`;
}

function createActiveAggregateSelection(membershipTable, keyColumn, aggregateExpression, fallbackColumn, alias) {
  return `${createActiveAggregateExpression(
    membershipTable, keyColumn, aggregateExpression, fallbackColumn
  )} AS ${alias}`;
}

function createActiveAggregateExpression(membershipTable, keyColumn, aggregateExpression, fallbackColumn) {
  const fallbackExpression = fallbackColumn ? `e.${fallbackColumn}` : 'NULL';
  return `(CASE
    WHEN EXISTS(
      SELECT 1 FROM ${membershipTable} any_membership
      WHERE any_membership.${keyColumn} = e.${keyColumn}
    ) THEN (
      SELECT ${aggregateExpression}
      FROM ${membershipTable} active_membership
      JOIN tracks active_track ON active_track.track_uid = active_membership.track_uid
      JOIN folders active_folder ON active_folder.id = active_track.folder_id
        AND active_folder.status <> 'removed'
      WHERE active_membership.${keyColumn} = e.${keyColumn}
    )
    ELSE ${fallbackExpression}
  END)`;
}

function createActiveAlbumYearExpression() {
  return createActiveAggregateExpression(
    'track_albums', 'album_key', 'MIN(active_track.year)', null
  );
}

function createActiveRepresentativeTrackSelection(membershipTable, keyColumn) {
  return `(
    SELECT active_membership.track_uid
    FROM ${membershipTable} active_membership
    JOIN tracks active_track ON active_track.track_uid = active_membership.track_uid
    JOIN folders active_folder ON active_folder.id = active_track.folder_id
      AND active_folder.status <> 'removed'
    WHERE active_membership.${keyColumn} = e.${keyColumn}
    ORDER BY (active_track.artwork_id IS NOT NULL) DESC, active_membership.track_uid
    LIMIT 1
  ) AS representativeTrackUid`;
}

catalogState.databasePath = schema.MUSIC_LIBRARY_V3_WEB_DATABASE;
catalogState.modules = { schema, canonicalOrder, orderContract, cursorCodec, queryContract, searchNormalizer, transportShuffle };
const contextWalByteCache = new Map();
catalogState.contextTtlMs = DEFAULT_CONTEXT_TTL_MS;
catalogState.maxContexts = DEFAULT_MAX_CONTEXTS;
catalogState.contextWalCapBytes = DEFAULT_CONTEXT_WAL_CAP_BYTES;
export async function initializeWebSqliteRuntime(databaseAdapter, {
  contextTtlMs: requestedContextTtlMs,
  maxContexts: requestedMaxContexts,
  contextWalCapBytes: requestedContextWalCapBytes,
  onEvent = () => {},
  storageManager = globalThis.navigator?.storage
} = {}) {
  if (catalogState.database) throw createCatalogError('alreadyOpen', 'Web SQLite catalog is already open');
  catalogState.workerData = {
    dbPath: schema.MUSIC_LIBRARY_V3_WEB_DATABASE,
    contextTtlMs: requestedContextTtlMs,
    maxContexts: requestedMaxContexts,
    contextWalCapBytes: requestedContextWalCapBytes
  };
  catalogState.contextTtlMs = normalizeBoundedInteger(requestedContextTtlMs, DEFAULT_CONTEXT_TTL_MS, MIN_CONTEXT_TTL_MS, MAX_CONTEXT_TTL_MS, 'invalidContextTtl');
  catalogState.maxContexts = normalizeBoundedInteger(requestedMaxContexts, DEFAULT_MAX_CONTEXTS, 1, MAX_CONTEXTS, 'invalidMaxContexts');
  catalogState.contextWalCapBytes = normalizeBoundedInteger(requestedContextWalCapBytes, DEFAULT_CONTEXT_WAL_CAP_BYTES, MIN_CONTEXT_WAL_CAP_BYTES, MAX_CONTEXT_WAL_CAP_BYTES, 'invalidContextWalCap');
  catalogState.runtimeEventSink = onEvent;
  if (storageManager?.estimate) catalogState.storageEstimate = await storageManager.estimate();
  catalogState.database = databaseAdapter;
  catalogState.databasePath = schema.MUSIC_LIBRARY_V3_WEB_DATABASE;
  catalogState.closed = false;
  catalogState.activeArtworkUtilitySession = null;
  catalogState.contextCounter = 0;
  catalogState.scopeVersions = Object.create(null);
  contexts.clear();
  contextWalByteCache.clear();
  pendingEntityAggregationScans.clear();
  pendingScanSweepRecoveries.clear();
  pendingScanInvalidations.clear();
  assertSchemaSearchFields(schema.MUSIC_LIBRARY_SEARCH_FIELDS);
  catalogState.database.exec(schema.getMusicLibraryV3InitializationSql({ journalMode: 'persist' }));
  catalogState.database.prepare('DELETE FROM artwork_claims').run();
  verifyPragmas();
  initializeMetadata(schema.MUSIC_LIBRARY_SCHEMA_VERSION, schema.MUSIC_LIBRARY_COLLATION_VERSION);
  ensureDirectoriesSynchronized();
  recoverInterruptedOperations();
  removeLegacyPlaybackOperations();
  recoverInterruptedScans();
  recoverInterruptedMetadataClaims({
    metadataStatus: 'retryable-error',
    errorCode: 'service-interrupted',
    preserveLastKnownGood: true,
    updateDerivedData: false
  });
  scheduleDeletionMaintenance();

  return getCapabilities();
}


function verifyPragmas() {
  catalogState.database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = PERSIST;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -16384;
    PRAGMA soft_heap_limit = 268435456;
    PRAGMA locking_mode = EXCLUSIVE;
  `);
  if (Number(catalogState.database.prepare('PRAGMA foreign_keys').get().foreign_keys) !== 1) {
    throw createCatalogError('sqliteCapabilityMissing', 'SQLite foreign key enforcement is unavailable');
  }
  const journalMode = String(catalogState.database.prepare('PRAGMA journal_mode').get().journal_mode || '').toLowerCase();
  if (journalMode !== 'persist') {
    throw createCatalogError('sqliteCapabilityMissing', 'SQLite rollback journal mode is unavailable');
  }
  if (Number(catalogState.database.prepare('PRAGMA synchronous').get().synchronous) !== 1) {
    throw createCatalogError('sqliteCapabilityMissing', 'SQLite normal synchronous mode is unavailable');
  }
  const compileOptions = catalogState.database.prepare('PRAGMA compile_options').all();
  if (!compileOptions.some(row => String(row.compile_options || '').includes('ENABLE_FTS5'))) {
    throw createCatalogError('sqliteCapabilityMissing', 'SQLite FTS5 support is unavailable');
  }
  catalogState.database.prepare("SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'cap' LIMIT 1").all();
  catalogState.database.prepare("SELECT rowid FROM tracks_prefix_fts WHERE tracks_prefix_fts MATCH 'ca*' LIMIT 1").all();
}

function initializeMetadata(expectedSchemaVersion, expectedCollationVersion) {
  const getMeta = catalogState.database.prepare('SELECT value FROM meta WHERE key = ?');
  const insertMeta = catalogState.database.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)');
  insertMeta.run('schema_version', String(expectedSchemaVersion));
  const actualSchemaVersion = Number(getMeta.get('schema_version').value);
  if (actualSchemaVersion !== expectedSchemaVersion) {
    throw createCatalogError('schemaVersionMismatch', 'Catalog schema version does not match this application');
  }
  insertMeta.run('catalog_version', '0');
  catalogState.catalogVersion = Number(getMeta.get('catalog_version').value);
  if (!Number.isSafeInteger(catalogState.catalogVersion) || catalogState.catalogVersion < 0) {
    throw createCatalogError('catalogCorrupt', 'Catalog version metadata is invalid');
  }
  for (const scope of ['artwork', 'tracks', 'folders', 'subfolders', 'albums', 'artists', 'genres', 'playlists']) {
    const key = `scope_version:${scope}`;
    insertMeta.run(key, '0');
    const value = Number(getMeta.get(key).value);
    catalogState.scopeVersions[scope] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  ({ catalogVersion: catalogState.catalogVersion, scopeVersions: catalogState.scopeVersions } = orderContract.ensureCatalogSortKeyVersion(catalogState.database, {
    expectedVersion: expectedCollationVersion,
    catalogVersion: catalogState.catalogVersion,
    scopeVersions: catalogState.scopeVersions,
    createKey: createSortKey
  }));
}

function recoverInterruptedOperations() {
  const now = Date.now();
  const result = JSON.stringify({
    state: 'interrupted',
    code: 'service-interrupted',
    finishedAt: now
  });
  const releasedContexts = runDurableTransaction(() => {
    const interrupted = catalogState.database.prepare(`
      SELECT operation_id AS operationId, source_context_token AS sourceContextToken,
        context_released AS contextReleased
      FROM operation_jobs
      WHERE terminal_kind IS NULL
        AND phase NOT IN (${TERMINAL_OPERATION_PHASES.map(() => '?').join(', ')})
    `).all(...TERMINAL_OPERATION_PHASES);
    catalogState.database.prepare(`
      UPDATE operation_jobs
      SET phase = 'INTERRUPTED',
          terminal_kind = 'interrupted',
          terminal_code = 'service-interrupted',
          terminal_result_json = ?,
          context_released = 1,
          updated_at = ?,
          finished_at = ?
      WHERE terminal_kind IS NULL
        AND phase NOT IN (${TERMINAL_OPERATION_PHASES.map(() => '?').join(', ')})
    `).run(result, now, now, ...TERMINAL_OPERATION_PHASES);
    for (const operation of interrupted) releaseOperationSnapshots(operation.operationId);
    catalogState.database.prepare(`
      UPDATE playlists
      SET state = CASE WHEN state = 'building' THEN 'deleted' ELSE state END,
        building_operation_id = NULL,
        updated_at = ?
      WHERE building_operation_id IN (
        SELECT operation_id FROM operation_jobs
        WHERE terminal_kind = 'interrupted' AND finished_at = ?
      )
    `).run(now, now);
    return interrupted
      .filter(operation => !operation.contextReleased && operation.sourceContextToken)
      .map(operation => operation.sourceContextToken);
  });
  const releaseOwner = catalogState.database.prepare(`
    UPDATE query_contexts
    SET owner_count = CASE WHEN owner_count > 0 THEN owner_count - 1 ELSE 0 END,
      expires_at = CASE WHEN release_requested = 1 AND owner_count <= 1 THEN 0 ELSE expires_at END
    WHERE context_token = ?
  `);
  for (const contextToken of releasedContexts) {
    releaseOwner.run(contextToken);
    const context = contexts.get(contextToken);
    if (!context) continue;
    context.ownerCount = Math.max(0, (context.ownerCount ?? 1) - 1);
    if (context.ownerCount === 0 && context.releaseRequested) contexts.delete(contextToken);
  }
}

export function dispatchWebSqliteCommand(command, payload) {
  switch (command) {
    case 'getCapabilities': return getCapabilities();
    case 'getCounts': return getCounts(payload);
    case 'getRuntimeDiagnostics': return getRuntimeDiagnostics(payload);
    case 'upsertFolders': return upsertFolders(payload);
    case 'upsertTracks': return upsertTracks(payload);
    case 'deleteTracks': return deleteTracks(payload);
    case 'createContext': return createContext(payload);
    case 'getContextCount': return getContextCount(payload);
    case 'queryTracks': return queryTracks(payload);
    case 'browseFolderChildren': return browseFolderChildren(payload);
    case 'queryEntities': return queryEntities(payload);
    case 'readContextPage': return readContextPage(payload);
    case 'readContextPageAtOrdinal': return readContextPageAtOrdinal(payload);
    case 'resolveEntityAnchor': return resolveEntityAnchor(payload);
    case 'retainContext': return retainContext(payload);
    case 'releaseRetainedContext': return releaseRetainedContext(payload);
    case 'releaseContext': return releaseContext(payload);
    case 'cleanupExpiredContextItems': return cleanupExpiredContextItems(payload);
    case 'getTrack': return getTrack(payload);
    case 'getTrackStorageIdentity': return getTrackStorageIdentity(payload);
    case 'resolvePlaylistExportSource': return resolvePlaylistExportSource(payload);
    case 'getCachedArtwork': return getCachedArtwork(payload);
    case 'beginArtworkUtilitySession': return beginArtworkUtilitySession(payload);
    case 'getArtworkSource': return getArtworkSource(payload);
    case 'claimArtworkSource': return claimArtworkSource(payload);
    case 'bindArtworkSourceDetails': return bindArtworkSourceDetails(payload);
    case 'preflightArtworkBatch': return preflightArtworkBatch(payload);
    case 'publishArtwork': return publishArtwork(payload);
    case 'recordArtworkFailure': return recordArtworkFailure(payload);
    case 'scheduleArtworkStagingGc': return scheduleArtworkStagingGc(payload);
    case 'evictArtworkCache': return evictArtworkCache(payload);
    case 'resolvePlaybackSource': return resolvePlaybackSource(payload);
    case 'listScanFolders': return listScanFolders(payload);
    case 'getScanFolderTrackCount': return getScanFolderTrackCount(payload);
    case 'beginScanFolder': return beginScanFolder(payload);
    case 'preflightScanBatch': return preflightScanBatch(payload);
    case 'commitScanSeenBatch': return commitScanSeenBatch(payload);
    case 'cueDirectoryStage': return cueDirectoryStage(payload);
    case 'listMetadataCandidates': return listMetadataCandidates(payload);
    case 'advanceScanMetadataCursor': return advanceScanMetadataCursor(payload);
    case 'markScanEnumerationIneligible': return markScanEnumerationIneligible(payload);
    case 'recordScanErrors': return recordScanErrors(payload);
    case 'finalizeScanEnumeration': return finalizeScanEnumeration(payload);
    case 'enqueueScanSweep': return enqueueScanSweep(payload);
    case 'runScanSweep': return runScanSweep(payload);
    case 'completeScanFolder': return completeScanFolder(payload);
    case 'completeScanFolderNoSweep': return completeScanFolderNoSweep(payload);
    case 'pauseScanFolder': return pauseScanFolder(payload);
    case 'claimMetadataParse': return claimMetadataParse(payload);
    case 'claimMetadataParseBatch': return claimMetadataParseBatch(payload);
    case 'completeMetadataParseSuccess': return completeMetadataParseSuccess(payload);
    case 'completeMetadataParseFailure': return completeMetadataParseFailure(payload);
    case 'completeMetadataParseBatch': return completeMetadataParseBatch(payload);
    case 'requeueLatestMetadata': return requeueLatestMetadata(payload);
    case 'recoverInterruptedMetadataClaims': return recoverInterruptedMetadataClaims(payload);
    case 'removeScanFolder': return removeScanFolder(payload);
    case 'receiveOperation': return receiveOperation(payload);
    case 'getOperationStatus': return getOperationStatus(payload);
    case 'requestOperationCancel': return requestOperationCancel(payload);
    case 'transitionOperation': return transitionOperation(payload);
    case 'recordOperationProgress': return recordOperationProgress(payload);
    case 'completeOperation': return completeOperation(payload);
    case 'gcTerminalOperations': return gcTerminalOperations(payload);
    case 'createOperationSnapshot': return createOperationSnapshot(payload);
    case 'appendOperationSnapshotItems': return appendOperationSnapshotItems(payload);
    case 'sealOperationSnapshot': return sealOperationSnapshot(payload);
    case 'queryOperationSnapshot': return queryOperationSnapshot(payload);
    case 'gcOperationSnapshots': return gcOperationSnapshots(payload);
    case 'createPlaybackSequence': return createPlaybackSequence(payload);
    case 'appendPlaybackSequenceItems': return appendPlaybackSequenceItems(payload);
    case 'sealPlaybackSequence': return sealPlaybackSequence(payload);
    case 'queryPlaybackSequence': return queryPlaybackSequence(payload);
    case 'queryTransportDescriptorPage': return queryTransportDescriptorPage(payload);
    case 'createPlaylist': return createPlaylist(payload);
    case 'createPlaylistWithItems': return createPlaylistWithItems(payload);
    case 'recordRecentlyPlayed': return recordRecentlyPlayed(payload);
    case 'setTrackFavorite': return setTrackFavorite(payload);
    case 'getFavoriteTrackUids': return getFavoriteTrackUids(payload);
    case 'getSystemPlaylists': return getSystemPlaylists(payload);
    case 'renamePlaylist': return renamePlaylist(payload);
    case 'reorderPlaylistItem': return reorderPlaylistItem(payload);
    case 'removePlaylistItem': return removePlaylistItem(payload);
    case 'duplicatePlaylist': return duplicatePlaylist(payload);
    case 'prepareSequencePlaylistSave': return prepareSequencePlaylistSave(payload);
    case 'getAutomaticPlaylistImportState': return getAutomaticPlaylistImportState(payload);
    case 'prepareAutomaticPlaylistImport': return prepareAutomaticPlaylistImport(payload);
    case 'appendSequencePlaylistPage': return appendSequencePlaylistPage(payload);
    case 'appendPlaylistItems': return appendPlaylistItems(payload);
    case 'appendPlaylistImportRecords': return appendPlaylistImportRecords(payload);
    case 'finalizePlaylistImportPage': return finalizePlaylistImportPage(payload);
    case 'publishPlaylist': return publishPlaylist(payload);
    case 'queryPlaylistItems': return queryPlaylistItems(payload);
    case 'tombstonePlaylist': return tombstonePlaylist(payload);
    case 'cleanupPlaylistItems': return cleanupPlaylistItems(payload);
    case 'gcPlaylistItems': return gcPlaylistItems(payload);
    case 'resumeFolderDeletionJobs': return resumeFolderDeletionJobs(payload);
    case 'repairInterruptedDeletionItems': return repairInterruptedDeletionItems(payload);
    case 'checkIntegrity': return checkIntegrity(payload);
    case 'close': return closeCatalog(payload);
    default: throw createCatalogError('unknownCommand', 'Catalog command is not supported');
  }
}

function getCapabilities() {
  return {
    backend: 'sqlite-wasm-opfs-sahpool',
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: catalogState.modules.schema.MUSIC_LIBRARY_SCHEMA_VERSION,
    databaseSyncInWorker: true,
    fts5: true,
    trigram: true,
    shortTokenSearch: true,
    shortSearchMode: 'word-prefix',
    entityTypes: Object.keys(ENTITY_DEFINITIONS),
    maxPageRows: MAX_QUERY_LIMIT,
    maxPageBytes: MAX_RESPONSE_BYTES,
    maxWriteRows: MAX_WRITE_BATCH_ROWS,
    searchFields: [...SEARCH_FIELDS],
    maxQueryLimit: MAX_QUERY_LIMIT,
    maxWriteBatchRows: MAX_WRITE_BATCH_ROWS,
    maxRequestBytes: MAX_REQUEST_BYTES,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    contextTtlMs: catalogState.contextTtlMs,
    maxContexts: catalogState.maxContexts,
    contextWalCapBytes: catalogState.contextWalCapBytes
  };
}

function getRuntimeDiagnostics(payload = {}) {
  assertExactFields(payload, [], 'invalidDiagnosticRequest');
  return {
    wasmMemoryBytes: Number(catalogState.database.sqlite3?.wasm?.memory?.buffer?.byteLength ?? 0)
  };
}

function deleteTracks(payload) {
  assertExactFields(payload, ['trackUids'], 'invalidTrackBatch');
  const trackUids = validateBoundedStringList(payload.trackUids, 'trackUids', MAX_WRITE_BATCH_ROWS, 512);
  if (trackUids.length === 0) return createNoChangeResult();
  const readTrack = catalogState.database.prepare(`
    SELECT track_uid AS trackUid, track_key AS trackKey, search_text AS searchText,
      folder_id AS folderId, relative_path AS relativePath
    FROM tracks WHERE track_uid = ?
  `);
  const deleteTrack = catalogState.database.prepare('DELETE FROM tracks WHERE track_uid = ?');
  return commitMutation(['tracks', 'albums', 'artists', 'genres', 'subfolders'], 'delete-tracks', () => {
    let deletedCount = 0;
    for (const trackUid of trackUids) {
      const row = readTrack.get(trackUid);
      if (!row) continue;
      removeTrackEntityMemberships(trackUid);
      removeTrackArtworkReferences(trackUid);
      deleteTrack.run(trackUid);
      updateDirectoryMembership(row, null);
      deletedCount += 1;
    }
    markDirectoriesSynchronized();
    return { deletedCount };
  });
}

function createContext(payload) {
  const query = normalizeContextQuery(payload);
  pruneExpiredContexts();
  const leasedContextCount = Number(catalogState.database.prepare(`
    SELECT count(*) AS count FROM query_contexts WHERE expires_at > ? OR owner_count > 0
  `).get(Date.now()).count);
  if (leasedContextCount >= catalogState.maxContexts) {
    throw createCatalogError('tooManyContexts', 'Catalog context lease limit reached', { maximum: catalogState.maxContexts });
  }
  const queryFingerprint = catalogState.modules.cursorCodec.createQueryFingerprint({
    endpoint: query.endpoint,
    query: {
      endpoint: query.endpoint,
      query: query.queryText,
      sort: query.sort,
      direction: query.direction,
      scope: query.scope,
      includeSystemPlaylists: query.includeSystemPlaylists
    }
  });
  const token = `ctx_${threadId}_${Date.now().toString(36)}_${(++catalogState.contextCounter).toString(36)}`;
  const now = Date.now();
  const context = {
    token,
    ...query,
    queryFingerprint,
    snapshotVersion: catalogState.catalogVersion,
    visibleScopeVersions: Object.fromEntries(
      query.relevantScopeNames.map(scope => [scope, catalogState.scopeVersions[scope]])
    ),
    createdAt: now,
    lastAccessAt: now,
    expiresAt: now + catalogState.contextTtlMs,
    walStartBytes: 0,
    database: catalogState.database,
    ownerCount: 0,
    releaseRequested: false,
    snapshotOverflow: false,
    shadowCount: 0,
    totalCount: null,
    resolvedCount: null,
    unresolvedCount: null
  };
  catalogState.database.prepare(`
    INSERT INTO query_contexts(
      context_token, endpoint, entity_type, query_text, sort_name, direction,
      scope_json, query_fingerprint, snapshot_version, visible_scope_versions_json,
      created_at, last_access_at, expires_at, owner_count, release_requested,
      shadow_count, snapshot_overflow, total_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL)
  `).run(
    token, query.endpoint, query.entityType, query.queryText, query.sort, query.direction,
    JSON.stringify(query.scope), queryFingerprint, catalogState.catalogVersion,
    JSON.stringify(context.visibleScopeVersions), now, now, context.expiresAt
  );
  contexts.set(token, context);
  contextWalByteCache.set(token, { shadowCount: 0, bytes: 0 });
  return {
    contextToken: token,
    catalogVersion: context.snapshotVersion,
    totalCount: { pending: true },
    expiresAt: context.expiresAt
  };
}

function resolveTrackContextOrdinal(context, { entityId, prefix, mode }) {
  if (context.scope?.playlistId) return resolvePlaylistContextOrdinal(context, entityId);
  const order = createOrder(context.sort, context.direction);
  const source = createContextTrackSource(context);
  const base = createContextFilter(context);
  const where = [...base.clauses];
  const bindings = [...base.bindings];
  if (mode === 'prefix') {
    if (prefix === null) return null;
    where.push('substr(t.normalized_title, 1, length(?)) = ?');
    bindings.push(prefix, prefix);
  } else {
    if (entityId === null) return null;
    where.push('t.track_uid = ?');
    bindings.push(entityId);
  }
  const row = catalogState.database.prepare(`
    SELECT ${createTrackPageSelection(order)}
    FROM ${source.sql} t${source.indexHint}
    WHERE ${where.join(' AND ')}
    ORDER BY ${createOrderBySql(order, false)}
    LIMIT 1
  `).get(...source.bindings, ...bindings);
  if (!row) return null;
  const normalized = normalizePageRow(row);
  const keyset = createKeysetSql(order, order.descriptor.buildTuple(normalized), 'before');
  const count = catalogState.database.prepare(`
    SELECT count(*) AS count FROM ${source.sql} t${source.indexHint}
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
  `).get(...source.bindings, ...base.bindings, ...keyset.bindings);
  return { ordinal: Number(count.count), entityId: normalized.trackUid };
}

function resolvePlaylistContextOrdinal(context, entityId) {
  if (entityId === null) return null;
  const order = createPlaylistOrder();
  const source = createContextTrackSource(context);
  const base = createPlaylistContextFilter(context);
  const row = catalogState.database.prepare(`
    SELECT ${createPlaylistTrackPageSelection()}
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN ${source.sql} t${source.indexHint} ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${[...base.clauses, 'CAST(i.item_key AS TEXT) = ?'].join(' AND ')}
    ORDER BY i.position, CAST(i.item_key AS TEXT)
    LIMIT 1
  `).get(...source.bindings, ...base.bindings, entityId);
  if (!row) return null;
  const normalized = normalizePageRow(row);
  const keyset = createPlaylistKeysetSql(order, order.descriptor.buildTuple(normalized), 'before');
  const count = catalogState.database.prepare(`
    SELECT count(*) AS count
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN ${source.sql} t${source.indexHint} ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
  `).get(...source.bindings, ...base.bindings, ...keyset.bindings);
  return { ordinal: Number(count.count), entityId: normalized.playlistItemKey };
}

function executeContextPage(
  context,
  order,
  { continuation, cursorTuple, limit, offset = null, pageStartOrdinal = null }
) {
  const source = createContextTrackSource(context);
  const base = createContextFilter(context);
  const keyset = cursorTuple ? createKeysetSql(order, cursorTuple, continuation) : { sql: '', bindings: [] };
  const where = [...base.clauses];
  if (keyset.sql) where.push(keyset.sql);
  const reverse = continuation === 'before';
  const orderBy = createOrderBySql(order, reverse);
  const offsetSql = offset === null ? '' : ' OFFSET ?';
  const bindings = [...source.bindings, ...base.bindings, ...keyset.bindings, limit + 1];
  if (offset !== null) bindings.push(offset);
  const rows = catalogState.database.prepare(`
    SELECT ${createTrackPageSelection(order)}
    FROM ${source.sql} t${source.indexHint}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${orderBy}
    LIMIT ?${offsetSql}
  `).all(...bindings).map(row => normalizePageRow(row, order));
  const hasExtra = rows.length > limit;
  if (hasExtra) rows.pop();
  if (reverse) rows.reverse();

  let hasBefore = false;
  let hasAfter = false;
  if (rows.length > 0) {
    hasBefore = offset !== null
      ? pageStartOrdinal > 0
      : contextHasRows(context, order, order.descriptor.buildTuple(rows[0]), 'before');
    hasAfter = offset !== null
      ? pageStartOrdinal + rows.length < context.totalCount
      : contextHasRows(context, order, order.descriptor.buildTuple(rows.at(-1)), 'after');
  }
  if (continuation === 'after' && hasExtra) hasAfter = true;
  if (continuation === 'before' && hasExtra) hasBefore = true;

  const response = {
    rows: rows.map(stripOrderFields),
    nextCursor: hasAfter ? encodeBoundaryCursor(context, order, rows.at(-1), 'after') : null,
    previousCursor: hasBefore ? encodeBoundaryCursor(context, order, rows[0], 'before') : null,
    totalCount: Number.isSafeInteger(context.totalCount) ? context.totalCount : { pending: true },
    catalogVersion: context.snapshotVersion,
    contextToken: context.token
  };
  catalogState.modules.queryContract.validatePageResponse(response, { limit });
  return response;
}

function executePlaylistContextPage(
  context,
  { continuation, cursorTuple, limit, offset = null, pageStartOrdinal = null }
) {
  const counts = ensurePlaylistContextCounts(context);
  const order = createPlaylistOrder();
  const source = createContextTrackSource(context);
  const base = createPlaylistContextFilter(context);
  const keyset = cursorTuple
    ? createPlaylistKeysetSql(order, cursorTuple, continuation)
    : { sql: '', bindings: [] };
  const where = [...base.clauses];
  if (keyset.sql) where.push(keyset.sql);
  const reverse = continuation === 'before';
  const offsetSql = offset === null ? '' : ' OFFSET ?';
  const bindings = [...source.bindings, ...base.bindings, ...keyset.bindings, limit + 1];
  if (offset !== null) bindings.push(offset);
  const rows = catalogState.database.prepare(`
    SELECT ${createPlaylistTrackPageSelection()}
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN ${source.sql} t${source.indexHint} ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${where.join(' AND ')}
    ORDER BY i.position ${reverse ? 'DESC' : 'ASC'},
      CAST(i.item_key AS TEXT) ${reverse ? 'DESC' : 'ASC'}
    LIMIT ?${offsetSql}
  `).all(...bindings).map(row => normalizePageRow(row));
  const hasExtra = rows.length > limit;
  if (hasExtra) rows.pop();
  if (reverse) rows.reverse();

  let hasBefore = false;
  let hasAfter = false;
  if (rows.length > 0) {
    hasBefore = offset !== null
      ? pageStartOrdinal > 0
      : playlistContextHasRows(context, order.descriptor.buildTuple(rows[0]), 'before');
    hasAfter = offset !== null
      ? pageStartOrdinal + rows.length < context.totalCount
      : playlistContextHasRows(context, order.descriptor.buildTuple(rows.at(-1)), 'after');
  }
  if (continuation === 'after' && hasExtra) hasAfter = true;
  if (continuation === 'before' && hasExtra) hasBefore = true;
  const response = {
    rows: rows.map(stripOrderFields),
    nextCursor: hasAfter ? encodeBoundaryCursor(context, order, rows.at(-1), 'after') : null,
    previousCursor: hasBefore ? encodeBoundaryCursor(context, order, rows[0], 'before') : null,
    totalCount: counts.totalCount,
    resolvedCount: counts.resolvedCount,
    unresolvedCount: counts.unresolvedCount,
    catalogVersion: context.snapshotVersion,
    contextToken: context.token
  };
  catalogState.modules.queryContract.validatePageResponse(response, { limit });
  return response;
}

function playlistContextHasRows(context, tuple, continuation) {
  const source = createContextTrackSource(context);
  const base = createPlaylistContextFilter(context);
  const keyset = createPlaylistKeysetSql(createPlaylistOrder(), tuple, continuation);
  return Boolean(catalogState.database.prepare(`
    SELECT 1 AS found
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN ${source.sql} t${source.indexHint} ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
    LIMIT 1
  `).get(...source.bindings, ...base.bindings, ...keyset.bindings));
}

function contextHasRows(context, order, tuple, continuation) {
  const source = createContextTrackSource(context);
  const base = createContextFilter(context);
  const keyset = createKeysetSql(order, tuple, continuation);
  const where = [...base.clauses, keyset.sql];
  return Boolean(catalogState.database.prepare(`
    SELECT 1 AS found FROM ${source.sql} t${source.indexHint}
    WHERE ${where.join(' AND ')}
    LIMIT 1
  `).get(...source.bindings, ...base.bindings, ...keyset.bindings));
}

function countContextRows(context) {
  if (context.entityType !== 'track') return countEntityContextRows(context);
  if (context.scope?.playlistId) return countPlaylistContextRows(context);
  const source = createContextTrackSource(context);
  const base = createContextFilter(context);
  const row = catalogState.database.prepare(`
    SELECT count(*) AS count FROM ${source.sql} t${source.indexHint}
    ${base.clauses.length ? `WHERE ${base.clauses.join(' AND ')}` : ''}
  `).get(...source.bindings, ...base.bindings);
  return Number(row.count);
}

function countPlaylistContextRows(context) {
  const source = createContextTrackSource(context);
  const filter = createPlaylistContextFilter(context);
  const row = catalogState.database.prepare(`
    SELECT count(*) AS totalCount,
      COALESCE(sum(CASE WHEN ${ACTIVE_PLAYLIST_TRACK_CLAUSE} THEN 1 ELSE 0 END), 0) AS resolvedCount
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN ${source.sql} t${source.indexHint} ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${filter.clauses.join(' AND ')}
  `).get(...source.bindings, ...filter.bindings);
  context.totalCount = Number(row.totalCount);
  context.resolvedCount = Number(row.resolvedCount);
  context.unresolvedCount = context.totalCount - context.resolvedCount;
  return context.totalCount;
}

function createContextTrackSource(context) {
  if (!Number.isSafeInteger(context.shadowCount)) {
    const row = catalogState.database.prepare(`
      SELECT shadow_count AS shadowCount FROM query_contexts WHERE context_token = ?
    `).get(context.token);
    context.shadowCount = Number(row?.shadowCount ?? 0);
  }
  context.hasBeforeImages = context.shadowCount > 0;
  if (!context.hasBeforeImages) {
    const folderDirKey = context.scope?.folderDirKey;
    const isRootDirectory = folderDirKey && parseFolderDirKey(folderDirKey).path === '';
    return {
      sql: 'tracks',
      bindings: [],
      indexHint: isRootDirectory ? ' INDEXED BY tracks_root_direct_by_folder' : ''
    };
  }
  return {
    sql: `(
      SELECT t.track_key, t.track_uid, t.folder_id, t.relative_path, t.source_kind, t.entry_key,
        t.cue_relative_path, t.start_frame, t.end_frame, t.title, t.artist, t.album_artist,
        t.album, t.genre, t.year, t.disc_no, t.track_no, t.duration_sec, t.added_at,
        t.metadata_status, t.artwork_id, t.sort_title, t.sort_album_artist,
        t.sort_album, t.sort_genre, t.search_text, t.normalized_title, t.album_key, t.artist_key,
        t.genre_key, t.subfolder_key, 0 AS is_context_shadow
      FROM tracks t
      WHERE NOT EXISTS (
        SELECT 1 FROM query_context_track_before_images b
        WHERE b.context_token = ? AND b.track_uid = t.track_uid
      )
      UNION ALL
      SELECT b.track_key, b.track_uid, b.folder_id, b.relative_path, b.source_kind, b.entry_key,
        b.cue_relative_path, b.start_frame, b.end_frame, b.title, b.artist, b.album_artist,
        b.album, b.genre, b.year, b.disc_no, b.track_no, b.duration_sec, b.added_at,
        b.metadata_status, b.artwork_id, b.sort_title, b.sort_album_artist,
        b.sort_album, b.sort_genre, b.search_text, b.normalized_title, b.album_key, b.artist_key,
        b.genre_key, b.subfolder_key, 1 AS is_context_shadow
      FROM query_context_track_before_images b
      WHERE b.context_token = ? AND b.existed = 1
    )`,
    bindings: [context.token, context.token],
    indexHint: ''
  };
}

function createContextFilter(context) {
  const clauses = [context.scope?.playlistId
    ? '1 = 1'
    : ACTIVE_TRACK_FOLDER_CLAUSE];
  const bindings = [];
  if (context.scope) {
    if (context.scope.folderDirKey) {
      const { folderId, path: directoryPath } = parseFolderDirKey(context.scope.folderDirKey);
      clauses.push('t.folder_id = ?');
      bindings.push(folderId);
      if (directoryPath === '') {
        clauses.push("instr(t.relative_path, '/') = 0");
      } else {
        clauses.push("t.relative_path >= ? || '/' AND t.relative_path < ? || '0'");
        clauses.push("instr(substr(t.relative_path, length(?) + 2), '/') = 0");
        bindings.push(directoryPath, directoryPath, directoryPath);
      }
    } else if (context.scope.folderId) {
      clauses.push('t.folder_id = ?');
      bindings.push(context.scope.folderId);
    } else if (context.scope.trackUids) {
      if (context.scope.trackUids.length === 0) clauses.push('0 = 1');
      else {
        clauses.push(`t.track_uid IN (${context.scope.trackUids.map(() => '?').join(', ')})`);
        bindings.push(...context.scope.trackUids);
      }
    } else if (context.scope.albumKey) {
      clauses.push('t.album_key = ?');
      bindings.push(context.scope.albumKey);
    } else if (context.scope.artistKey) {
      clauses.push(`EXISTS (
        SELECT 1 FROM track_artists scoped_artist
        WHERE scoped_artist.track_uid = t.track_uid AND scoped_artist.artist_key = ?
      )`);
      bindings.push(context.scope.artistKey);
    } else if (context.scope.genreKey) {
      clauses.push('t.genre_key = ?');
      bindings.push(context.scope.genreKey);
    } else if (context.scope.subfolderKey) {
      clauses.push('t.subfolder_key = ?');
      bindings.push(context.scope.subfolderKey);
    } else if (context.scope.recent) {
      const recentTrackUids = ensureRecentTrackUids(context);
      if (recentTrackUids.length === 0) clauses.push('0 = 1');
      else {
        clauses.push(`t.track_uid IN (${recentTrackUids.map(() => '?').join(', ')})`);
        bindings.push(...recentTrackUids);
      }
    }
  }
  const longTokens = context.tokens.filter(token => Array.from(token).length >= 3);
  if (longTokens.length > 0) {
    clauses.push(context.hasBeforeImages ? `(t.is_context_shadow = 1 OR t.track_key IN (
      SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?
    ))` : `t.track_key IN (
      SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?
    )`);
    bindings.push(createTrigramFtsQuery(longTokens));
  }
  const shortTokens = context.tokens.filter(token => Array.from(token).length <= 2);
  if (shortTokens.length > 0) {
    clauses.push(context.hasBeforeImages ? `(t.is_context_shadow = 1 OR t.track_key IN (
      SELECT rowid FROM tracks_prefix_fts WHERE tracks_prefix_fts MATCH ?
    ))` : `t.track_key IN (
      SELECT rowid FROM tracks_prefix_fts WHERE tracks_prefix_fts MATCH ?
    )`);
    bindings.push(shortTokens.map(token => `${quoteFtsLiteral(token)}*`).join(' AND '));
  }
  for (const token of context.tokens) {
    clauses.push('instr(t.search_text, ?) > 0');
    bindings.push(token);
  }
  return { clauses, bindings };
}

function updateDirectoryMembership(previous, next) {
  if (previous && next && previous.folderId === next.folderId && previous.relativePath === next.relativePath) {
    return;
  }
  if (previous) {
    const ancestors = createDirectoryAncestors(previous.relativePath);
    const decrement = catalogState.database.prepare(`
      UPDATE directories SET
        direct_track_count = direct_track_count - ?,
        recursive_track_count = recursive_track_count - 1
      WHERE folder_id = ? AND relative_path = ?
    `);
    const removeEmpty = catalogState.database.prepare(`
      DELETE FROM directories
      WHERE folder_id = ? AND relative_path = ? AND recursive_track_count = 0
    `);
    for (let index = 0; index < ancestors.length; index += 1) {
      const relativePath = ancestors[index].relativePath;
      decrement.run(index === ancestors.length - 1 ? 1 : 0, previous.folderId, relativePath);
      removeEmpty.run(previous.folderId, relativePath);
    }
  }
  if (next) {
    const ancestors = createDirectoryAncestors(next.relativePath);
    const increment = catalogState.database.prepare(`
      INSERT INTO directories(
        folder_id, relative_path, parent_path, name, direct_track_count, recursive_track_count
      ) VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(folder_id, relative_path) DO UPDATE SET
        direct_track_count = direct_track_count + excluded.direct_track_count,
        recursive_track_count = recursive_track_count + 1
    `);
    for (let index = 0; index < ancestors.length; index += 1) {
      const ancestor = ancestors[index];
      increment.run(
        next.folderId, ancestor.relativePath, ancestor.parentPath, ancestor.name,
        index === ancestors.length - 1 ? 1 : 0
      );
    }
  }
}

function browseFolderChildren(payload) {
  assertAllowedFields(payload, ['folderId', 'path', 'limit', 'cursor'], 'invalidDirectoryBrowse');
  const folderId = requireString(payload.folderId, 'folderId', 512);
  const directoryPath = normalizeDirectoryPath(payload.path, 'path');
  const limit = payload.limit === undefined ? MAX_QUERY_LIMIT : normalizeQueryLimit(payload.limit);
  let cursor = null;
  if (payload.cursor !== undefined && payload.cursor !== null) {
    cursor = requireString(payload.cursor, 'cursor', MAX_DIRECTORY_PATH_CHARACTERS);
    if (cursor.includes('/')) {
      throw createCatalogError('invalidDirectoryBrowse', 'Folder cursor must be a single path segment');
    }
  }
  const folder = catalogState.database.prepare(
    "SELECT 1 AS present FROM folders WHERE id = ? AND status <> 'removed'"
  ).get(folderId);
  if (!folder) throw createCatalogError('folderNotFound', 'Music folder does not exist');
  const nodeExists = directoryPath === '' || Boolean(catalogState.database.prepare(`
    SELECT 1 AS present FROM directories WHERE folder_id = ? AND relative_path = ?
  `).get(folderId, directoryPath));
  const sql = cursor === null ? `
    SELECT name, direct_track_count AS directTrackCount,
      recursive_track_count AS recursiveTrackCount
    FROM directories
    WHERE folder_id = ? AND parent_path = ?
    ORDER BY name
    LIMIT ?
  ` : `
    SELECT name, direct_track_count AS directTrackCount,
      recursive_track_count AS recursiveTrackCount
    FROM directories
    WHERE folder_id = ? AND parent_path = ? AND name > ?
    ORDER BY name
    LIMIT ?
  `;
  const rows = cursor === null
    ? catalogState.database.prepare(sql).all(folderId, directoryPath, limit + 1)
    : catalogState.database.prepare(sql).all(folderId, directoryPath, cursor, limit + 1);
  const peekOnlyChild = catalogState.database.prepare(`
    SELECT name, direct_track_count AS directTrackCount,
      recursive_track_count AS recursiveTrackCount
    FROM directories
    WHERE folder_id = ? AND parent_path = ?
    ORDER BY name
    LIMIT 2
  `);
  const children = [];
  let responseBytes = 128;
  for (const row of rows) {
    if (children.length >= limit) break;
    const segments = [row.name];
    let currentRelPath = directoryPath === '' ? row.name : `${directoryPath}/${row.name}`;
    let directTrackCount = Number(row.directTrackCount);
    let recursiveTrackCount = Number(row.recursiveTrackCount);
    while (directTrackCount === 0 && segments.length < 64) {
      const nestedRows = peekOnlyChild.all(folderId, currentRelPath);
      if (nestedRows.length !== 1) break;
      const nested = nestedRows[0];
      const nestedRelPath = `${currentRelPath}/${nested.name}`;
      if (nestedRelPath.length > MAX_DIRECTORY_PATH_CHARACTERS) break;
      segments.push(nested.name);
      currentRelPath = nestedRelPath;
      directTrackCount = Number(nested.directTrackCount);
      recursiveTrackCount = Number(nested.recursiveTrackCount);
    }
    const child = {
      name: row.name,
      segments,
      directTrackCount,
      recursiveTrackCount
    };
    const childBytes = utf8ByteLength(JSON.stringify(child)) + 1;
    if (children.length > 0 && responseBytes + childBytes > DIRECTORY_RESPONSE_BYTE_BUDGET) break;
    children.push(child);
    responseBytes += childBytes;
  }
  const hasMore = rows.length > children.length;
  return {
    children,
    hasMore,
    cursor: hasMore && children.length > 0 ? children.at(-1).name : null,
    nodeExists
  };
}

function ensureRecentTrackUids(context) {
  if (!Array.isArray(context.recentTrackUids)) {
    const source = createContextTrackSource(context);
    context.recentTrackUids = catalogState.database.prepare(`
      SELECT t.track_uid AS trackUid
      FROM ${source.sql} t${source.indexHint}
      WHERE ${ACTIVE_TRACK_FOLDER_CLAUSE}
      ORDER BY t.added_at DESC, t.track_uid DESC
      LIMIT ?
    `).all(...source.bindings, RECENT_TRACK_LIMIT).map(row => row.trackUid);
  }
  return context.recentTrackUids;
}

function trackOrderColumn(field) {
  if (field === 'pathSort') return `CAST((SELECT COALESCE(root.display_name, '') FROM folders root WHERE root.id = t.folder_id) || '/' || t.relative_path AS BLOB)`;
  const columns = {
    sortTitle: 'sort_title',
    sortAlbumArtist: 'sort_album_artist',
    sortAlbum: 'sort_album',
    sortGenre: 'sort_genre',
    addedAt: 'added_at'
  };
  if (Object.hasOwn(columns, field)) return columns[field];
  if (field === 'discSort') return `COALESCE(t.disc_no, ${catalogState.modules.orderContract.MISSING_TRACK_NUMBER_SORT})`;
  if (field === 'trackSort') return `COALESCE(t.track_no, ${catalogState.modules.orderContract.MISSING_TRACK_NUMBER_SORT})`;
  if (field === 'durationSort') return 'COALESCE(t.duration_sec, 1.7976931348623157e+308)';
  throw createCatalogError('invalidSort', 'Catalog track sort field is not supported');
}

function createTrackPageSelection(order) {
  const orderFields = order.fields.map(field => {
    const fieldExpression = trackFieldExpression(field);
    const expression = field.type === 'bytes' ? `hex(${fieldExpression})` : fieldExpression;
    return `${expression} AS ${field.field}`;
  });
  return [
    't.track_uid AS trackUid',
    't.folder_id AS folderId',
    't.relative_path AS relativePath',
    `(SELECT COALESCE(root.display_name, '') FROM folders root WHERE root.id = t.folder_id) AS rootPath`,
    `t.folder_id || char(0) || t.relative_path AS physicalSourceKey`,
    't.source_kind AS sourceKind',
    't.entry_key AS entryKey',
    't.cue_relative_path AS cueRelativePath',
    't.start_frame AS startFrame',
    't.end_frame AS endFrame',
    't.album_key AS albumKey',
    't.artist_key AS artistKey',
    't.genre_key AS genreKey',
    't.subfolder_key AS subfolderKey',
    't.title',
    't.artist',
    't.album_artist AS albumArtist',
    't.album',
    't.genre',
    't.year',
    't.disc_no AS discNo',
    't.track_no AS trackNo',
    't.duration_sec AS durationSec',
    't.added_at AS addedAt',
    't.metadata_status AS metadataStatus',
    't.artwork_id AS artworkId',
    ...orderFields
  ].join(', ');
}

function normalizePageRow(row) {
  if (row.rootPath !== undefined && row.relativePath !== undefined) {
    row.path = `${row.rootPath}/${row.relativePath}`;
    delete row.rootPath;
    delete row.relativePath;
  }
  return {
    ...row,
    startFrame: row.startFrame == null ? null : Number(row.startFrame),
    endFrame: row.endFrame == null ? null : Number(row.endFrame),
    entityKind: 'track'
  };
}

function releaseContext(payload) {
  assertExactFields(payload, ['contextToken'], 'invalidContext');
  const token = requireString(payload.contextToken, 'contextToken', 512);
  const row = catalogState.database.prepare(`
    SELECT owner_count AS ownerCount FROM query_contexts WHERE context_token = ?
  `).get(token);
  if (!row) return { released: false };
  const context = contexts.get(token);
  if (Number(row.ownerCount) > 0) {
    if (context) context.releaseRequested = true;
    catalogState.database.prepare(`
      UPDATE query_contexts SET release_requested = 1 WHERE context_token = ?
    `).run(token);
    return { released: true, retained: true };
  }
  closeContext(context);
  contexts.delete(token);
  catalogState.database.prepare(`
    UPDATE query_contexts SET release_requested = 1, expires_at = 0 WHERE context_token = ?
  `).run(token);
  return { released: true };
}

function retainContext(payload) {
  assertExactFields(payload, ['contextToken'], 'invalidContext');
  const context = getContext(payload.contextToken);
  context.ownerCount = (context.ownerCount ?? 0) + 1;
  catalogState.database.prepare(`
    UPDATE query_contexts SET owner_count = owner_count + 1 WHERE context_token = ?
  `).run(context.token);
  return { retained: true };
}

function releaseRetainedContext(payload) {
  assertExactFields(payload, ['contextToken'], 'invalidContext');
  const token = requireString(payload.contextToken, 'contextToken', 512);
  const context = contexts.get(token);
  if (!context || (context.ownerCount ?? 0) === 0) return { released: false };
  context.ownerCount -= 1;
  catalogState.database.prepare(`
    UPDATE query_contexts
    SET owner_count = CASE WHEN owner_count > 0 THEN owner_count - 1 ELSE 0 END,
      expires_at = CASE WHEN release_requested = 1 AND owner_count <= 1 THEN 0 ELSE expires_at END
    WHERE context_token = ?
  `).run(token);
  if (context.ownerCount === 0 && (
    context.releaseRequested || context.expiresAt <= Date.now() || context.snapshotOverflow
  )) {
    closeContext(context);
    contexts.delete(token);
  }
  return { released: true };
}

function getContext(contextToken) {
  pruneExpiredContexts();
  const token = requireString(contextToken, 'contextToken', 512);
  let context = contexts.get(token);
  if (!context) {
    const row = catalogState.database.prepare(`
      SELECT context_token AS token, endpoint, entity_type AS entityType,
        query_text AS queryText, sort_name AS sort, direction, scope_json AS scopeJson,
        query_fingerprint AS queryFingerprint, snapshot_version AS snapshotVersion,
        visible_scope_versions_json AS visibleScopeVersionsJson,
        created_at AS createdAt, last_access_at AS lastAccessAt, expires_at AS expiresAt,
        owner_count AS ownerCount, release_requested AS releaseRequested,
        shadow_count AS shadowCount, snapshot_overflow AS snapshotOverflow,
        total_count AS totalCount
      FROM query_contexts WHERE context_token = ?
    `).get(token);
    if (row) {
      context = {
        ...row,
        scope: parseStoredJson(row.scopeJson),
        visibleScopeVersions: parseStoredJson(row.visibleScopeVersionsJson),
        relevantScopeNames: Object.keys(parseStoredJson(row.visibleScopeVersionsJson)),
        database: catalogState.database,
        ownerCount: Number(row.ownerCount),
        releaseRequested: Boolean(row.releaseRequested),
        snapshotOverflow: Boolean(row.snapshotOverflow),
        shadowCount: Number(row.shadowCount),
        totalCount: row.totalCount === null ? null : Number(row.totalCount),
        walStartBytes: 0
      };
      contexts.set(token, context);
    }
  }
  if (!context) throw createCatalogError('STALE_CURSOR', 'Catalog context has expired');
  const storedState = catalogState.database.prepare(`
    SELECT snapshot_overflow AS snapshotOverflow, shadow_count AS shadowCount
    FROM query_contexts WHERE context_token = ?
  `).get(token);
  if (!storedState) {
    closeContext(context);
    contexts.delete(token);
    throw createCatalogError('STALE_CURSOR', 'Catalog context has expired');
  }
  context.snapshotOverflow = Boolean(storedState.snapshotOverflow);
  context.shadowCount = Number(storedState.shadowCount);
  const now = Date.now();
  const stableScopeRequired = context.entityType !== 'track' || Boolean(context.scope?.playlistId || context.scope?.artistKey);
  const relevantScopeChanged = stableScopeRequired && Object.entries(context.visibleScopeVersions).some(
    ([scope, version]) => (catalogState.scopeVersions[scope] ?? 0) !== version
  );
  if (context.expiresAt <= now || context.snapshotOverflow || relevantScopeChanged ||
      readWalBytes(context.token, context.shadowCount) > catalogState.contextWalCapBytes) {
    context.expiresAt = 0;
    catalogState.database.prepare('UPDATE query_contexts SET expires_at = 0 WHERE context_token = ?').run(token);
    if ((context.ownerCount ?? 0) === 0) {
      closeContext(context);
      contexts.delete(token);
    }
    throw createCatalogError('STALE_CURSOR', 'Catalog context snapshot has expired');
  }
  context.lastAccessAt = now;
  catalogState.database.prepare('UPDATE query_contexts SET last_access_at = ? WHERE context_token = ?').run(now, token);
  return context;
}

function pruneExpiredContexts() {
  const now = Date.now();
  for (const [token, context] of contexts) {
    if ((context.expiresAt <= now || context.snapshotOverflow ||
         readWalBytes(context.token) > catalogState.contextWalCapBytes) &&
        (context.ownerCount ?? 0) === 0) {
      closeContext(context);
      contexts.delete(token);
    }
  }
}

function cleanupExpiredContextItems(payload = {}) {
  assertAllowedFields(payload, ['limit'], 'invalidContext');
  const limit = normalizeWriteLimit(payload.limit ?? 500);
  const context = catalogState.database.prepare(`
    SELECT context_token AS contextToken FROM query_contexts
    WHERE expires_at <= ? AND owner_count = 0
    ORDER BY expires_at, context_token LIMIT 1
  `).get(Date.now());
  if (!context) return { deletedItemCount: 0, deletedContextCount: 0, hasMore: false };
  const deleted = catalogState.database.prepare(`
    DELETE FROM query_context_track_before_images
    WHERE rowid IN (
      SELECT rowid FROM query_context_track_before_images
      WHERE context_token = ? ORDER BY track_uid LIMIT ?
    )
  `).run(context.contextToken, limit);
  const remaining = Number(catalogState.database.prepare(`
    SELECT count(*) AS count FROM query_context_track_before_images WHERE context_token = ?
  `).get(context.contextToken).count);
  let deletedContextCount = 0;
  if (remaining === 0) {
    catalogState.database.prepare('DELETE FROM query_contexts WHERE context_token = ?').run(context.contextToken);
    contexts.delete(context.contextToken);
    contextWalByteCache.delete(context.contextToken);
    deletedContextCount = 1;
  }
  return {
    deletedItemCount: Number(deleted.changes),
    deletedContextCount,
    hasMore: remaining > 0 || deletedContextCount === 1
  };
}

function withContextDatabase(context, callback) {
  return callback(context.database ?? catalogState.database);
}

function closeContext(context) {
  if (!context) return;
  contextWalByteCache.delete(context.token);
  context.database = null;
}

function readWalBytes(contextToken = null, knownShadowCount = null) {
  if (!catalogState.database) return 0;
  let shadowCount = knownShadowCount;
  if (contextToken !== null && !Number.isSafeInteger(shadowCount)) {
    const state = catalogState.database.prepare(`
      SELECT shadow_count AS shadowCount FROM query_contexts WHERE context_token = ?
    `).get(contextToken);
    if (!state) {
      contextWalByteCache.delete(contextToken);
      return 0;
    }
    shadowCount = Number(state.shadowCount);
  }
  const cached = contextToken === null ? null : contextWalByteCache.get(contextToken);
  if (cached?.shadowCount === shadowCount) return cached.bytes;
  const row = catalogState.database.prepare(`
    SELECT COALESCE(sum(
      length(COALESCE(track_uid, '')) + length(COALESCE(title, '')) +
      length(COALESCE(artist, '')) + length(COALESCE(album_artist, '')) +
      length(COALESCE(album, '')) + length(COALESCE(genre, '')) +
      length(COALESCE(search_text, '')) + length(COALESCE(sort_title, X'')) +
      length(COALESCE(sort_album_artist, X'')) + length(COALESCE(sort_album, X'')) +
      length(COALESCE(sort_genre, X'')) + 128
    ), 0) AS bytes
    FROM query_context_track_before_images
    WHERE ? IS NULL OR context_token = ?
  `).get(contextToken, contextToken);
  const bytes = Number(row?.bytes ?? 0);
  if (contextToken !== null) contextWalByteCache.set(contextToken, { shadowCount, bytes });
  return bytes;
}

function receiveOperation(payload) {
  assertAllowedFields(payload, [
    'clientRequestId',
    'requestDigest',
    'canonicalRequestVersion',
    'operationKind',
    'target',
    'expectedTargetVersion',
    'sourceContextToken',
    'sourceSequenceIds',
    'sourceSequenceItemCount',
    'buildDeadlineAt',
    'receivedAt'
  ], 'invalidOperationRequest');
  const clientRequestId = requireString(payload.clientRequestId, 'clientRequestId', 512);
  const requestDigest = requireString(payload.requestDigest, 'requestDigest', 512);
  const canonicalRequestVersion = requirePositiveInteger(
    payload.canonicalRequestVersion,
    'canonicalRequestVersion'
  );
  const operationKind = requireString(payload.operationKind, 'operationKind', 128);
  if (!DURABLE_OPERATION_KINDS.has(operationKind)) {
    throw createCatalogError('invalidOperationKind', 'Operation kind is not durable');
  }
  const targetIdentity = createOperationTargetIdentity(payload.target);
  const expectedTargetVersion = optionalNullableNonNegativeInteger(
    payload.expectedTargetVersion,
    'expectedTargetVersion'
  );
  const receivedAt = requireNonNegativeInteger(payload.receivedAt, 'receivedAt');
  const sourceContextToken = payload.sourceContextToken == null
    ? null
    : requireString(payload.sourceContextToken, 'sourceContextToken', 512);
  const sourceSequenceIds = validateBoundedStringList(payload.sourceSequenceIds ?? [], 'sourceSequenceIds', 256, 512);
  if (new Set(sourceSequenceIds).size !== sourceSequenceIds.length) {
    throw createCatalogError('invalidOperationRequest', 'Source sequence ownership contains duplicates');
  }
  const sourceSequenceItemCount = requireNonNegativeInteger(payload.sourceSequenceItemCount ?? 0, 'sourceSequenceItemCount');
  const sourceFreeOperation = operationKind === 'importPlaylist' || operationKind === 'previewPlaylistImport';
  if (!sourceFreeOperation && sourceContextToken === null && (sourceSequenceIds.length === 0 || sourceSequenceItemCount === 0)) {
    throw createCatalogError('invalidOperationRequest', 'Operation requires a catalog context or source sequence');
  }
  const buildDeadlineAt = requireNonNegativeInteger(payload.buildDeadlineAt, 'buildDeadlineAt');
  if (buildDeadlineAt <= receivedAt) throw createCatalogError('invalidOperationRequest', 'Operation build deadline must be in the future');

  const known = catalogState.database.prepare(`
    SELECT operation_id, request_digest, terminal_kind, terminal_result_json
    FROM operation_jobs WHERE client_request_id = ?
  `).get(clientRequestId);
  if (known) {
    if (known.request_digest !== requestDigest) return { kind: 'requestIdReuse' };
    return known.terminal_kind !== null
      ? { kind: 'terminal', result: parseStoredJson(known.terminal_result_json) }
      : { kind: 'active', operationId: known.operation_id };
  }
  const sourceContext = sourceContextToken === null ? null : getContext(sourceContextToken);
  const estimatedItemCount = sourceContext === null
    ? sourceSequenceItemCount
    : Number(sourceContext.totalCount ?? 0);
  const estimatedRequiredBytes = estimatedItemCount * 160 + 64 * 1024;
  try {
    const stats = fs.statfsSync(path.dirname(catalogState.workerData.dbPath));
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(availableBytes) || availableBytes < estimatedRequiredBytes + 4 * 1024 * 1024) {
      return {
        kind: 'insufficientStorage',
        availableBytes: Number.isFinite(availableBytes) ? availableBytes : 0,
        requiredAvailableBytes: estimatedRequiredBytes + 4 * 1024 * 1024
      };
    }
  } catch {
    return { kind: 'insufficientStorage', availableBytes: 0, requiredAvailableBytes: estimatedRequiredBytes };
  }

  const result = runDurableTransaction(() => {
    const existing = catalogState.database.prepare(`
      SELECT operation_id, request_digest, terminal_kind, terminal_result_json
      FROM operation_jobs WHERE client_request_id = ?
    `).get(clientRequestId);
    if (existing) {
      if (existing.request_digest !== requestDigest) return { kind: 'requestIdReuse' };
      if (existing.terminal_kind !== null) {
        return { kind: 'terminal', result: parseStoredJson(existing.terminal_result_json) };
      }
      return { kind: 'active', operationId: existing.operation_id };
    }

    const heavy = operationKind === 'previewPlaylistImport' ? 0 : 1;
    const active = heavy === 0 ? null : catalogState.database.prepare(`
      SELECT operation_id FROM operation_jobs
      WHERE heavy = 1 AND terminal_kind IS NULL
      LIMIT 1
    `).get();
    if (active) return { kind: 'busy', activeOperationId: active.operation_id };

    const operationId = randomUUID();
    catalogState.database.prepare(`
      INSERT INTO operation_jobs(
        operation_id, client_request_id, request_digest, canonical_request_version,
        operation_kind, target_identity, expected_target_version, phase, heavy,
        committed, source_context_token, build_deadline_at, reserved_terminal_bytes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, 0, ?, ?, ?, ?, ?)
    `).run(
      operationId,
      clientRequestId,
      requestDigest,
      canonicalRequestVersion,
      operationKind,
      targetIdentity,
      expectedTargetVersion,
      heavy,
      sourceContextToken,
      buildDeadlineAt,
      64 * 1024,
      receivedAt,
      receivedAt
    );
    const sourceSequence = catalogState.database.prepare(`
      SELECT state FROM playback_sequences WHERE id = ?
    `);
    for (const sequenceId of sourceSequenceIds) {
      const sequence = sourceSequence.get(sequenceId);
      if (!sequence || sequence.state !== 'active') {
        throw createCatalogError('sequenceNotFound', 'Source playback sequence does not exist');
      }
    }
    if (sourceContext) {
      catalogState.database.prepare(`
        UPDATE query_contexts
        SET owner_count = owner_count + 1,
          expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END
        WHERE context_token = ?
      `).run(buildDeadlineAt, buildDeadlineAt, sourceContext.token);
    }
    return { kind: 'created', operationId };
  });
  if (result.kind === 'created' && sourceContext) {
    sourceContext.ownerCount = (sourceContext.ownerCount ?? 0) + 1;
    sourceContext.expiresAt = Math.max(sourceContext.expiresAt, buildDeadlineAt);
  }
  return result;
}

function releaseOperationContext(operationId, operation) {
  if (operation.contextReleased || !operation.sourceContextToken) return;
  catalogState.database.prepare(`
    UPDATE query_contexts
    SET owner_count = CASE WHEN owner_count > 0 THEN owner_count - 1 ELSE 0 END,
      expires_at = CASE WHEN release_requested = 1 AND owner_count <= 1 THEN 0 ELSE expires_at END
    WHERE context_token = ?
  `).run(operation.sourceContextToken);
  const context = contexts.get(operation.sourceContextToken);
  if (context) {
    context.ownerCount = Math.max(0, (context.ownerCount ?? 1) - 1);
    if (context.ownerCount === 0 && context.releaseRequested) {
      closeContext(context);
      contexts.delete(operation.sourceContextToken);
    }
  }
  catalogState.database.prepare('UPDATE operation_jobs SET context_released = 1 WHERE operation_id = ?').run(operationId);
}

function prepareAutomaticPlaylistImport(payload) {
  assertExactFields(payload, [
    'contentDigest', 'createdAt', 'expectedVersion', 'folderId', 'name',
    'operationId', 'playlistId', 'relativePath'
  ], 'invalidPlaylistRequest');
  const folderId = requireString(payload.folderId, 'folderId', 512);
  const relativePath = normalizeRelativePath(
    requireString(payload.relativePath, 'relativePath', 32768)
  ).normalize('NFC');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const contentDigest = requireString(payload.contentDigest, 'contentDigest', 128);
  const expectedVersion = requireNonNegativeInteger(payload.expectedVersion, 'expectedVersion');
  const name = requireString(payload.name, 'name', 4096);
  const createdAt = requireNonNegativeInteger(payload.createdAt, 'createdAt');
  if (!/^sha256:[0-9a-f]{64}$/.test(contentDigest)) {
    throw createCatalogError('invalidPlaylistRequest', 'Automatic playlist content digest is invalid');
  }
  return runDurableTransaction(() => {
    const folder = catalogState.database.prepare('SELECT status FROM folders WHERE id = ?').get(folderId);
    if (!folder || folder.status === 'removed') {
      throw createCatalogError('stalePlaylistOrigin', 'Automatic playlist folder is no longer current');
    }
    const operation = catalogState.database.prepare(`
      SELECT operation_kind AS operationKind, target_identity AS targetIdentity,
        expected_target_version AS expectedVersion, terminal_kind AS terminalKind
      FROM operation_jobs WHERE operation_id = ?
    `).get(operationId);
    if (!operation || operation.terminalKind !== null || operation.operationKind !== 'importPlaylist' ||
        operation.targetIdentity !== `playlist:${playlistId}` ||
        Number(operation.expectedVersion) !== expectedVersion) {
      throw createCatalogError('playlistLeaseMismatch', 'Automatic playlist operation does not match');
    }
    const source = catalogState.database.prepare(`
      SELECT s.playlist_id AS playlistId, s.content_digest AS contentDigest, p.state
      FROM automatic_playlist_sources s
      JOIN playlists p ON p.id = s.playlist_id
      WHERE s.folder_id = ? AND s.relative_path = ?
    `).get(folderId, relativePath);
    if (source && source.playlistId !== playlistId) {
      throw createCatalogError('automaticPlaylistIdentityMismatch', 'Automatic playlist source identity changed');
    }
    if (source?.state === 'active' && source.contentDigest === contentDigest) {
      return { kind: 'unchanged' };
    }
    let playlist = catalogState.database.prepare(`
      SELECT state, version, building_operation_id AS buildingOperationId
      FROM playlists WHERE id = ?
    `).get(playlistId);
    if (expectedVersion === 0 && (!playlist || playlist.state === 'deleted')) {
      if (playlist) {
        catalogState.database.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId);
        catalogState.database.prepare(`
          DELETE FROM automatic_playlist_import_jobs WHERE playlist_id = ?
        `).run(playlistId);
        catalogState.database.prepare("DELETE FROM playlists WHERE id = ? AND state = 'deleted'").run(playlistId);
      }
      catalogState.database.prepare(`
        INSERT INTO playlists(
          id, name, sort_name, state, building_operation_id, version, created_at, updated_at
        ) VALUES (?, ?, ?, 'building', ?, 0, ?, ?)
      `).run(playlistId, name, createSortKey(name), operationId, createdAt, createdAt);
      playlist = { state: 'building', version: 0, buildingOperationId: operationId };
    }
    const validNew = expectedVersion === 0 && playlist?.state === 'building' &&
      playlist.buildingOperationId === operationId && Number(playlist.version) === 0;
    const validReplacement = expectedVersion > 0 && playlist?.state === 'active' &&
      Number(playlist.version) === expectedVersion;
    if (!validNew && !validReplacement) {
      throw createCatalogError('playlistVersionConflict', 'Automatic playlist changed before staging');
    }
    const basePosition = Number(catalogState.database.prepare(`
      SELECT COALESCE(MAX(position), 0) AS position FROM playlist_items WHERE playlist_id = ?
    `).get(playlistId).position);
    catalogState.database.prepare(`
      INSERT INTO automatic_playlist_import_jobs(
        operation_id, folder_id, relative_path, playlist_id, content_digest,
        base_position, expected_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      operationId, folderId, relativePath, playlistId, contentDigest,
      basePosition, expectedVersion
    );
    return { kind: 'prepared', basePosition };
  });
}

function resolveImportedPlaylistTrack(unresolved) {
  if (!unresolved) return null;
  if (unresolved.sourceKind === 'cue-track' || unresolved.cueProvenance != null) {
    return resolveCuePlaylistTrack(unresolved);
  }
  const trustedOriginMatch = resolveImportedTrackFromOrigin(unresolved);
  if (trustedOriginMatch) return trustedOriginMatch;
  const normalize = catalogState.modules.searchNormalizer.normalizeSearchText;
  const requestedPath = unresolved.relativePathHint || unresolved.relativePath || unresolved.sourceLine || '';
  const basename = normalize(unresolved.basename || String(requestedPath).split(/[\\/]/).at(-1) || '');
  let pathCandidates = [];
  if (basename) {
    const exactRequestedPath = normalizePlaylistPortablePath(requestedPath);
    if (exactRequestedPath) {
      const exactRootCandidates = catalogState.database.prepare(`
        WITH requested(path) AS (VALUES (?))
        SELECT t.track_uid AS trackUid
        FROM tracks t
        JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
        CROSS JOIN requested
        WHERE t.source_kind = 'file' AND t.normalized_basename = ? AND (
          requested.path COLLATE NOCASE = (f.display_name || '/' || t.relative_path) OR
          substr(requested.path, -(length(f.display_name) + length(t.relative_path) + 2))
            COLLATE NOCASE = ('/' || f.display_name || '/' || t.relative_path)
        )
        ORDER BY t.track_uid LIMIT 2
      `).all(exactRequestedPath, basename);
      if (exactRootCandidates.length === 1) return exactRootCandidates[0].trackUid;
      const exactRelativeCandidates = catalogState.database.prepare(`
        WITH requested(path) AS (VALUES (?))
        SELECT t.track_uid AS trackUid
        FROM tracks t
        JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
        CROSS JOIN requested
        WHERE t.source_kind = 'file' AND t.normalized_basename = ? AND (
          requested.path COLLATE NOCASE = t.relative_path OR
          substr(requested.path, -(length(t.relative_path) + 1))
            COLLATE NOCASE = ('/' || t.relative_path)
        )
        ORDER BY t.track_uid LIMIT 2
      `).all(exactRequestedPath, basename);
      if (exactRelativeCandidates.length === 1) return exactRelativeCandidates[0].trackUid;
      if (exactRootCandidates.length > 1 || exactRelativeCandidates.length > 1) return null;
    }
    pathCandidates = catalogState.database.prepare(`
      SELECT t.track_uid AS trackUid, t.relative_path AS relativePath, f.display_name AS rootName,
        t.normalized_title AS normalizedTitle, t.normalized_artist AS normalizedArtist,
        t.duration_bucket AS durationBucket
      FROM tracks t
      JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
      WHERE t.source_kind = 'file' AND t.normalized_basename = ? ORDER BY t.track_uid LIMIT ?
    `).all(basename, PLAYLIST_RESOLUTION_CANDIDATE_LIMIT + 1);
    if (pathCandidates.length <= PLAYLIST_RESOLUTION_CANDIDATE_LIMIT) {
      const exact = pathCandidates.filter(track => playlistPortablePathMatches(track, requestedPath));
      if (exact.length === 1) return exact[0].trackUid;
      const scored = pathCandidates.map(track => ({
        track,
        score: playlistPathSuffixScore(track.relativePath, requestedPath)
      }));
      const bestScore = scored.reduce((best, candidate) => Math.max(best, candidate.score), 0);
      const best = scored.filter(candidate => candidate.score === bestScore && candidate.score > 0);
      if (best.length === 1) return best[0].track.trackUid;
      if (pathCandidates.length === 1) return pathCandidates[0].trackUid;
    } else {
      pathCandidates = null;
    }
  }

  const normalizedTitle = normalize(unresolved.title ?? '');
  const normalizedArtist = normalize(unresolved.artist ?? '');
  if (!normalizedTitle || !normalizedArtist) return null;
  const durationBucket = Number.isFinite(unresolved.durationSec) ? Math.round(unresolved.durationSec) : null;
  const metadataCandidates = catalogState.database.prepare(`
    SELECT t.track_uid AS trackUid, t.duration_bucket AS durationBucket
    FROM tracks t
    JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
    WHERE t.source_kind = 'file' AND t.normalized_title = ? AND t.normalized_artist = ?
    ORDER BY t.track_uid LIMIT ?
  `).all(normalizedTitle, normalizedArtist, PLAYLIST_RESOLUTION_CANDIDATE_LIMIT + 1);
  if (metadataCandidates.length > PLAYLIST_RESOLUTION_CANDIDATE_LIMIT) return null;
  const matching = metadataCandidates.filter(track =>
    durationBucket === null || Number(track.durationBucket) === durationBucket
  );
  if (matching.length === 1) return matching[0].trackUid;
  if (pathCandidates && pathCandidates.length > 1) {
    const metadataIds = new Set(matching.map(track => track.trackUid));
    const intersection = pathCandidates.filter(track => metadataIds.has(track.trackUid));
    if (intersection.length === 1) return intersection[0].trackUid;
  }
  return null;
}

function normalizePlaylistPortablePath(value) {
  return String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '')
    .split('/').filter(Boolean).join('/');
}

function normalizePlaylistImportOrigin(value) {
  if (value == null) return null;
  assertExactFields(value, ['folderId', 'playlistRelativePath'], 'invalidPlaylistRequest');
  const origin = {
    folderId: requireString(value.folderId, 'origin.folderId', 512),
    playlistRelativePath: normalizeRelativePath(requireString(
      value.playlistRelativePath,
      'origin.playlistRelativePath',
      32768
    ))
  };
  const folder = catalogState.database.prepare('SELECT status FROM folders WHERE id = ?').get(origin.folderId);
  if (!folder || folder.status === 'removed') {
    throw createCatalogError('stalePlaylistOrigin', 'Playlist import folder origin is no longer current');
  }
  return origin;
}

function resolveImportedTrackFromOrigin(unresolved) {
  const origin = unresolved?.origin;
  if (!origin) return null;
  let normalizedOrigin;
  try {
    normalizedOrigin = normalizePlaylistImportOrigin(origin);
  } catch {
    return null;
  }
  const requested = String(
    unresolved.relativePathHint || unresolved.relativePath || unresolved.sourceLine || ''
  ).trim();
  const relativePath = resolvePlaylistEntryRelativePath(
    normalizedOrigin.playlistRelativePath,
    requested
  );
  if (!relativePath) return null;
  const matches = catalogState.database.prepare(`
    SELECT track_uid AS trackUid FROM tracks t
    JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
    WHERE t.folder_id = ? AND t.source_kind = 'file' AND t.relative_path = ? COLLATE NOCASE
    ORDER BY t.track_uid LIMIT 2
  `).all(normalizedOrigin.folderId, relativePath);
  return matches.length === 1 ? matches[0].trackUid : null;
}

function resolvePlaylistEntryRelativePath(playlistRelativePath, requestedPath) {
  const requested = String(requestedPath ?? '').replaceAll('\\', '/');
  if (!requested || requested.startsWith('/') || /^[A-Za-z]:/.test(requested) || /^[a-z][a-z0-9+.-]*:/iu.test(requested)) {
    return null;
  }
  const parts = path.posix.dirname(playlistRelativePath).split('/').filter(part => part && part !== '.');
  for (const part of requested.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  if (parts.length === 0) return null;
  try {
    return normalizeRelativePath(parts.join('/'));
  } catch {
    return null;
  }
}

function playlistPortablePathMatches(track, requestedPath) {
  const normalizePath = value => catalogState.modules.searchNormalizer.normalizeSearchText(
    String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  ).split('/').filter(Boolean).join('/');
  const requested = normalizePath(requestedPath);
  if (!requested) return false;
  const relativePath = normalizePath(track.relativePath);
  const rootedPath = normalizePath(`${track.rootName || ''}/${track.relativePath || ''}`);
  return requested === relativePath || requested === rootedPath;
}

function runDurableTransaction(callback) {
  catalogState.database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    catalogState.database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      catalogState.database.exec('ROLLBACK');
    } catch {
      // The original write error is the actionable failure.
    }
    throw error;
  }
}

function resolvePlaylistExportSource(payload) {
  assertExactFields(payload, ['trackUid'], 'invalidTrackRequest');
  const trackUid = requireString(payload.trackUid, 'trackUid', 512);
  const row = catalogState.database.prepare(`
    SELECT t.track_uid AS trackUid, t.folder_id AS folderId, t.relative_path AS path,
      t.source_kind AS sourceKind, t.entry_key AS entryKey,
      t.cue_relative_path AS cueRelativePath, t.start_frame AS startFrame, t.end_frame AS endFrame,
      f.display_name AS rootName
    FROM tracks t
    JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
    WHERE t.track_uid = ?
  `).get(trackUid);
  if (!row) throw createCatalogError('trackNotFound', 'Track does not exist');
  return { kind: 'portable-relative', ...row, physicalSourceKey: createPhysicalSourceKey(row.folderId, row.path) };
}

function getArtworkSource(payload) {
  assertExactFields(payload, ['trackUid'], 'invalidArtworkRequest');
  const track = getArtworkTrack(requireString(payload.trackUid, 'trackUid', 512));
  if (!track) return null;
  return {
    folderId: track.folderId,
    lifecycleVersion: Number(track.lifecycleVersion),
    trackUid: track.trackUid,
    sourceKind: 'embedded-file',
    canonicalSourceIdentity: track.relativePath,
    fileIdentity: track.fileIdentity,
    size: Number(track.size),
    mtimeMs: Number(track.mtimeMs),
    embeddedOffset: null,
    embeddedLength: null,
    externalArtworkStat: null,
    extractorVersion: 'web-artwork-v2',
    utilitySessionId: catalogState.activeArtworkUtilitySession,
    trackSourceKind: track.sourceKind,
    cueRelativePath: track.cueRelativePath
  };
}

function artworkClaimMatchesCurrentTrack(claim) {
  if (claim.utilitySessionId !== catalogState.activeArtworkUtilitySession) return false;
  const track = getArtworkTrack(claim.trackUid);
  if (!track || track.folderId !== claim.folderId ||
      Number(track.lifecycleVersion) !== claim.lifecycleVersion ||
      String(track.fileIdentity ?? '') !== claim.fileIdentity ||
      Number(track.size) !== claim.size || Number(track.mtimeMs) !== claim.mtimeMs) return false;
  if (claim.sourceKind === 'embedded-file') {
    const isPreclaim = claim.canonicalSourceIdentity === track.relativePath &&
      claim.embeddedOffset === null && claim.embeddedLength === null;
    const isBoundClaim = claim.canonicalSourceIdentity.startsWith(`${track.relativePath}#embedded:`) &&
      claim.embeddedLength != null && claim.embeddedLength > 0 &&
      claim.embeddedLength <= MAX_ARTWORK_RAW_BYTES && claim.embeddedLength <= claim.size;
    if ((!isPreclaim && !isBoundClaim) || claim.externalArtworkStat !== null) return false;
  } else {
    if (!claim.externalArtworkStat || claim.embeddedOffset !== null || claim.embeddedLength !== null ||
        !isTrackCoverRelativePath(track.sourceKind === 'cue-track' ? track.cueRelativePath : null, track.relativePath, claim.canonicalSourceIdentity)) {
      return false;
    }
  }
  return true;
}

function listScanFolders(payload) {
  assertAllowedFields(payload, ['folderIds', 'includeRemoved'], 'invalidScanFolderRequest');
  const folderIds = payload.folderIds == null
    ? null
    : validateBoundedStringList(payload.folderIds, 'folderIds', 512, 512);
  const clauses = [payload.includeRemoved === true ? '1 = 1' : "status <> 'removed'"];
  const bindings = [];
  if (folderIds) {
    if (folderIds.length === 0) return { folders: [] };
    clauses.push(`id IN (${folderIds.map(() => '?').join(', ')})`);
    bindings.push(...folderIds);
  }
  const folders = catalogState.database.prepare(`
    SELECT id, kind, display_name AS displayName, path, status,
      scan_generation AS scanGeneration, lifecycle_version AS lifecycleVersion,
      added_at AS addedAt, last_scan_at AS lastScanAt
    FROM folders WHERE ${clauses.join(' AND ')} ORDER BY id
  `).all(...bindings).map(row => ({ ...row, lifecycleVersion: Number(row.lifecycleVersion) }));
  return { folders };
}

function beginScanFolder(payload) {
  assertAllowedFields(payload, [
    'scanId', 'folderId', 'normalizedRoot', 'expectedLifecycleVersion', 'resume',
    'rootEnumerationRequired', 'continuityBroken', 'sweepEligibility'
  ], 'invalidScanRequest');
  const scanId = requireString(payload.scanId, 'scanId', 128);
  const folderId = requireString(payload.folderId, 'folderId', 512);
  const lifecycleVersion = requireNonNegativeInteger(payload.expectedLifecycleVersion, 'expectedLifecycleVersion');
  const resume = payload.resume === true;
  completePendingScanSweepRecovery(folderId);
  return runDurableTransaction(() => {
    const folder = requireActiveScanFolder(folderId, lifecycleVersion);
    const existing = catalogState.database.prepare(`
      SELECT generation, status, parser_version AS parserVersion,
        continuity_broken AS continuityBroken, enumeration_error_count AS enumerationErrorCount,
        visited_files AS visitedFiles, committed_batches AS committedBatches,
        metadata_cursor AS metadataCursor
      FROM scan_run_folders WHERE scan_id = ? AND folder_id = ?
    `).get(scanId, folderId);
    let generation;
    if (resume) {
      if (!existing || !['paused', 'interrupted', 'canceled', 'completed-no-sweep'].includes(existing.status)) {
        throw createCatalogError('invalidScanTransition', 'Scan folder cannot resume from its current state');
      }
      generation = Number(existing.generation);
      if (Number(folder.scanGeneration) !== generation) {
        throw createCatalogError('staleScanGeneration', 'A newer folder scan generation already exists');
      }
    } else {
      if (existing) throw createCatalogError('scanAlreadyExists', 'Scan folder already exists');
      generation = Number(folder.scanGeneration) + 1;
      catalogState.database.prepare('UPDATE folders SET scan_generation = ? WHERE id = ?').run(generation, folderId);
      catalogState.database.prepare('DELETE FROM scan_seen WHERE scan_id = ? AND folder_id = ?').run(scanId, folderId);
      catalogState.database.prepare('DELETE FROM scan_logical_seen WHERE scan_id = ? AND folder_id = ?').run(scanId, folderId);
    }
    const now = Date.now();
    catalogState.database.prepare(`
      INSERT INTO scan_runs(id, status, started_at) VALUES (?, 'running', ?)
      ON CONFLICT(id) DO UPDATE SET status = 'running', finished_at = NULL, stop_reason = NULL
    `).run(scanId, now);
    catalogState.database.prepare(`
      INSERT INTO scan_run_folders(
        scan_id, folder_id, generation, expected_lifecycle_version, status,
        continuity_broken, sweep_eligibility, durable_cursor, parser_version,
        sweep_block_reason, enumeration_error_count, visited_files, committed_batches,
        stop_reason, updated_at
      ) VALUES (?, ?, ?, ?, 'enumerating', ?, 'INELIGIBLE', NULL, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(scan_id, folder_id) DO UPDATE SET
        status = 'enumerating', continuity_broken = excluded.continuity_broken,
        sweep_eligibility = 'INELIGIBLE', sweep_block_reason = excluded.sweep_block_reason,
        stop_reason = NULL, updated_at = excluded.updated_at
    `).run(
      scanId, folderId, generation, lifecycleVersion, resume ? 1 : 0,
      existing?.parserVersion ?? 'catalog-metadata-v5', resume ? 'resumed-generation' : null,
      Number(existing?.enumerationErrorCount ?? 0), Number(existing?.visitedFiles ?? 0),
      Number(existing?.committedBatches ?? 0), now
    );
    clearCueScanStageRows({ scanId, folderId });
    return {
      scanId,
      folderId,
      generation,
      lifecycleVersion,
      parserVersion: existing?.parserVersion ?? 'catalog-metadata-v5',
      continuityBroken: resume,
      sweepEligibility: 'INELIGIBLE',
      visitedFiles: resume ? Number(existing?.visitedFiles ?? 0) : 0,
      committedBatches: resume ? Number(existing?.committedBatches ?? 0) : 0,
      metadataCursor: resume && existing?.metadataCursor != null
        ? Number(existing.metadataCursor)
        : null
    };
  });
}

function removeScanFolder(payload) {
  assertAllowedFields(payload, ['folderId', 'expectedLifecycleVersion'], 'invalidFolderRemoval');
  const folderId = requireString(payload.folderId, 'folderId', 512);
  const lifecycleVersion = requireNonNegativeInteger(payload.expectedLifecycleVersion, 'expectedLifecycleVersion');
  const folder = catalogState.database.prepare('SELECT status, lifecycle_version AS lifecycleVersion FROM folders WHERE id = ?').get(folderId);
  if (!folder) throw createCatalogError('folderUnavailable', 'Library folder is unavailable');
  if (folder.status !== 'removed') {
    if (Number(folder.lifecycleVersion) !== lifecycleVersion) {
      throw createCatalogError('staleFolderLifecycle', 'Library folder lifecycle has changed');
    }
    commitMutation(
      ['folders', 'tracks', 'albums', 'artists', 'genres', 'subfolders', 'playlists'],
      'remove-folder-tombstone',
      () => {
      const changed = catalogState.database.prepare(`
        UPDATE folders SET status = 'removed', path = NULL, lifecycle_version = lifecycle_version + 1
        WHERE id = ? AND lifecycle_version = ? AND status <> 'removed'
      `).run(folderId, lifecycleVersion);
      if (Number(changed.changes) !== 1) throw createCatalogError('staleFolderLifecycle', 'Library folder lifecycle has changed');
      hardStaleNormalTrackContexts();
      ensureFolderDeletionJob(folderId, lifecycleVersion + 1);
      return { tombstoned: true };
      }
    );
  } else if (folder.status !== 'removed' || Number(folder.lifecycleVersion) !== lifecycleVersion + 1) {
    throw createCatalogError('staleFolderLifecycle', 'Library folder lifecycle has changed');
  }
  return runFolderDeletionChunk(folderId, lifecycleVersion + 1);
}

function hardStaleNormalTrackContexts() {
  catalogState.database.prepare(`
    UPDATE query_contexts SET snapshot_overflow = 1, expires_at = 0
    WHERE entity_type = 'track' AND json_extract(scope_json, '$.playlistId') IS NULL
  `).run();
  for (const context of contexts.values()) {
    if (context.entityType !== 'track' || context.scope?.playlistId) continue;
    context.snapshotOverflow = true;
    context.expiresAt = 0;
  }
}

function repairInterruptedDeletionItems(payload) {
  assertAllowedFields(payload, ['limit'], 'invalidDeletionRepair');
  const limit = normalizeWriteLimit(payload.limit ?? 500);
  const result = repairBlockedDeletionItems(limit);
  return { ...result, hasMore: result.repaired === limit };
}

function resumeFolderDeletionJobs(payload) {
  assertAllowedFields(payload, ['limit'], 'invalidDeletionRepair');
  const limit = normalizeWriteLimit(payload.limit ?? 1);
  let resumed = 0;
  while (resumed < limit && hasDeletionMaintenanceWork()) {
    runDeletionMaintenanceTurn();
    resumed += 1;
  }
  return { resumed, hasMore: hasDeletionMaintenanceWork() };
}

function checkIntegrity(payload = {}) {
  assertAllowedFields(payload, ['includeStorageBreakdown'], 'invalidIntegrityRequest');
  if (payload.includeStorageBreakdown !== undefined && typeof payload.includeStorageBreakdown !== 'boolean') {
    throw createCatalogError('invalidIntegrityRequest', 'includeStorageBreakdown must be a boolean');
  }
  const foreignKeyErrors = catalogState.database.prepare('PRAGMA foreign_key_check').all();
  const integrityRows = catalogState.database.prepare('PRAGMA integrity_check').all();
  const result = {
    foreignKeyErrors,
    integrityRows,
    ok: foreignKeyErrors.length === 0 && integrityRows.length === 1 &&
      String(Object.values(integrityRows[0])[0]).toLowerCase() === 'ok'
  };
  if (payload.includeStorageBreakdown === true) {
    result.storageBreakdown = catalogState.database.prepare(`
      SELECT name, SUM(pgsize) AS bytes
      FROM dbstat
      GROUP BY name
      ORDER BY bytes DESC, name
      LIMIT 32
    `).all().map(row => ({ name: row.name, bytes: Number(row.bytes) }));
  }
  return result;
}

function resolvePlaybackSource(payload) {
  assertExactFields(payload, ['trackUid'], 'invalidTrackRequest');
  const trackUid = requireString(payload.trackUid, 'trackUid', 512);
  const row = catalogState.database.prepare(`
    SELECT
      t.track_uid AS trackUid,
      t.relative_path AS relativePath,
      t.source_kind AS sourceKind,
      t.entry_key AS entryKey,
      t.cue_relative_path AS cueRelativePath,
      t.start_frame AS startFrame,
      t.end_frame AS endFrame,
      t.duration_sec AS durationSec,
      f.id AS folderId,
      f.path AS rootPath,
      f.lifecycle_version AS lifecycleVersion,
      f.status AS folderStatus
    FROM tracks t
    JOIN folders f ON f.id = t.folder_id
    WHERE t.track_uid = ?
  `).get(trackUid);
  if (!row) throw createCatalogError('trackNotFound', 'Track does not exist');
  if (!row.rootPath || row.folderStatus !== 'ok') {
    throw createCatalogError('sourceUnavailable', 'Track source is unavailable');
  }
  try {
    const root = fs.realpathSync.native(row.rootPath);
    const candidate = fs.realpathSync.native(path.resolve(root, ...row.relativePath.split('/')));
    const relative = path.relative(root, candidate);
    if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw createCatalogError('sourceOutsideLibrary', 'Track source is outside the selected library');
    }
    return {
      kind: 'electron-file',
      trackUid: row.trackUid,
      folderId: row.folderId,
      lifecycleVersion: Number(row.lifecycleVersion),
      path: candidate,
      physicalSourceKey: createPhysicalSourceKey(row.folderId, row.relativePath),
      sourceKind: row.sourceKind,
      entryKey: row.entryKey ?? null,
      cueRelativePath: row.cueRelativePath ?? null,
      startFrame: row.startFrame == null ? null : Number(row.startFrame),
      endFrame: row.endFrame == null ? null : Number(row.endFrame),
      durationSec: row.durationSec == null ? null : Number(row.durationSec)
    };
  } catch (error) {
    if (error && error.code === 'sourceOutsideLibrary') throw error;
    throw createCatalogError('sourceUnavailable', 'Track source is unavailable');
  }
}

function closeCatalog(payload) {
  assertExactFields(payload, [], 'invalidCloseRequest');
  if (!catalogState.closed) {
    catalogState.closed = true;
    for (const context of contexts.values()) closeContext(context);
    contexts.clear();
    contextWalByteCache.clear();
    pendingEntityAggregationScans.clear();
    pendingScanSweepRecoveries.clear();
    pendingScanInvalidations.clear();
    closeDatabase();
  }
  return { closed: true };
}

function commitMutation(changedScopes, reason, callback, { deferInvalidationKey = null } = {}) {
  if (catalogState.activeMutationBatch) {
    for (const scope of changedScopes) catalogState.activeMutationBatch.changedScopes.add(scope);
    return callback();
  }
  catalogState.database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    const mutationScopes = [...changedScopes];
    if (mutationScopes.length === 0) {
      catalogState.database.exec('COMMIT');
      return { ...result, ...createNoChangeResult() };
    }
    const nextVersion = catalogState.catalogVersion + 1;
    const nextScopeVersions = { ...catalogState.scopeVersions };
    const updateMeta = catalogState.database.prepare(`
      INSERT INTO meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    updateMeta.run('catalog_version', String(nextVersion));
    for (const scope of mutationScopes) {
      nextScopeVersions[scope] = (nextScopeVersions[scope] || 0) + 1;
      updateMeta.run(`scope_version:${scope}`, String(nextScopeVersions[scope]));
    }
    catalogState.database.exec('COMMIT');
    catalogState.catalogVersion = nextVersion;
    catalogState.scopeVersions = nextScopeVersions;
    const invalidationState = {
      catalogVersion: catalogState.catalogVersion,
      changedScopes: mutationScopes,
      scopeVersions: Object.fromEntries(mutationScopes.map(scope => [scope, catalogState.scopeVersions[scope]]))
    };
    if (deferInvalidationKey != null) {
      const pendingScopes = pendingScanInvalidations.get(deferInvalidationKey) ?? new Set();
      for (const scope of mutationScopes) pendingScopes.add(scope);
      pendingScanInvalidations.set(deferInvalidationKey, pendingScopes);
      return { ...result, ...invalidationState, counts: {} };
    }
    const invalidation = {
      ...invalidationState,
      counts: pickCounts(readCounts(), mutationScopes)
    };
    postMessage({
      protocolVersion: PROTOCOL_VERSION,
      type: 'invalidation',
      payload: invalidation
    });
    return { ...result, ...invalidation };
  } catch (error) {
    try {
      catalogState.database.exec('ROLLBACK');
    } catch {
      // The original write error is the actionable failure.
    }
    throw error;
  }
}

function postMessage(message) {
  catalogState.runtimeEventSink(message);
}

function measureBytes(value, code) {
  try {
    let binaryBytes = 0;
    const json = JSON.stringify(value, (_key, item) => {
      if (ArrayBuffer.isView(item)) {
        binaryBytes += item.byteLength;
        return { binaryByteLength: item.byteLength };
      }
      if (item instanceof ArrayBuffer) {
        binaryBytes += item.byteLength;
        return { binaryByteLength: item.byteLength };
      }
      return item;
    });
    if (json === undefined) throw new Error('undefined');
    return utf8ByteLength(json) + binaryBytes;
  } catch {
    throw createCatalogError(code, 'Catalog message is not serializable');
  }
}

export async function updateWebSqliteStorageEstimate(storageManager = globalThis.navigator?.storage) {
  if (storageManager?.estimate) catalogState.storageEstimate = await storageManager.estimate();
  return { ...catalogState.storageEstimate };
}

bindCatalogPlatform({
  Buffer,
  ENTITY_DEFINITIONS,
  artworkClaimMatchesCurrentTrack,
  commitMutation,
  countContextRows,
  countPlaylistContextRows,
  createActiveEntityMembershipClause,
  createContext,
  createContextFilter,
  createHash,
  executeContextPage,
  executePlaylistContextPage,
  fs,
  getContext,
  isTrackCoverRelativePath,
  measureBytes,
  normalizePlaylistImportOrigin,
  path,
  postMessage,
  randomUUID,
  releaseOperationContext,
  resolveImportedPlaylistTrack,
  resolveTrackContextOrdinal,
  runDurableTransaction,
  trackOrderColumn,
  updateDirectoryMembership,
  withContextDatabase
});
