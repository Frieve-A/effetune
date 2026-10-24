'use strict';

let catalogState,
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
  createEntityContextFilter,
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
  isPlainObject,
  listMetadataCandidates,
  markScanEnumerationIneligible,
  normalizeBoundedInteger,
  normalizeContextQuery,
  normalizeDirectoryPath,
  normalizeQueryLimit,
  normalizeRelativePath,
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
  renamePlaylist,
  reorderPlaylistItem,
  requestOperationCancel,
  requeueLatestMetadata,
  requireActiveScanFolder,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireString,
  resolveCuePlaylistTrack,
  resolveEntityAnchor,
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
  validateBoundedStringList;

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { parentPort, threadId, workerData: initialWorkerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { isCueCoverRelativePath } = require('./cue-cover.cjs');
const { querySharedLibrary } = require('./library-shared-query.cjs');

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
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
          expression: createActiveAggregateExpression(
            'track_albums', 'album_key', 'count(*)', 'track_count'
          ),
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
            'track_albums', 'album_key', 'COALESCE(SUM(active_track.duration_sec), 0)',
            'total_duration_sec'
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
      'e.path',
      'e.display_name AS displayName',
      'e.status',
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
        expression: createActiveAggregateExpression(
          membershipTable, keyColumn, 'count(*)', 'track_count'
        ),
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
          membershipTable, keyColumn, 'COALESCE(SUM(active_track.duration_sec), 0)',
          'total_duration_sec'
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

function createActiveAggregateSelection(
  membershipTable,
  keyColumn,
  aggregateExpression,
  fallbackColumn,
  alias
) {
  return `${createActiveAggregateExpression(
    membershipTable,
    keyColumn,
    aggregateExpression,
    fallbackColumn
  )} AS ${alias}`;
}

function createActiveAggregateExpression(
  membershipTable,
  keyColumn,
  aggregateExpression,
  fallbackColumn
) {
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

initialize().catch(error => {
  postMessage({
    protocolVersion: PROTOCOL_VERSION,
    type: 'ready',
    ok: false,
    error: serializeError(error, 'catalogOpenFailed')
  });
  closeDatabase();
  parentPort.close();
});

async function initialize() {
  ({
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
    createEntityContextFilter,
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
    isPlainObject,
    listMetadataCandidates,
    markScanEnumerationIneligible,
    normalizeBoundedInteger,
    normalizeContextQuery,
    normalizeDirectoryPath,
    normalizeQueryLimit,
    normalizeRelativePath,
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
    renamePlaylist,
    reorderPlaylistItem,
    requestOperationCancel,
    requeueLatestMetadata,
    requireActiveScanFolder,
    requireNonNegativeInteger,
    requirePositiveInteger,
    requireString,
    resolveCuePlaylistTrack,
    resolveEntityAnchor,
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
  } = await importModule(path.join(__dirname, '..', 'js', 'library', 'repository', 'catalog-runtime-core.js')));
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
    isCueCoverRelativePath,
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
  catalogState.workerData = initialWorkerData;
  catalogState.contextTtlMs = normalizeBoundedInteger(
    catalogState.workerData && catalogState.workerData.contextTtlMs,
    DEFAULT_CONTEXT_TTL_MS,
    MIN_CONTEXT_TTL_MS,
    MAX_CONTEXT_TTL_MS,
    'invalidContextTtl'
  );
  catalogState.maxContexts = normalizeBoundedInteger(
    catalogState.workerData && catalogState.workerData.maxContexts,
    DEFAULT_MAX_CONTEXTS,
    1,
    MAX_CONTEXTS,
    'invalidMaxContexts'
  );
  catalogState.contextWalCapBytes = normalizeBoundedInteger(
    catalogState.workerData && catalogState.workerData.contextWalCapBytes,
    DEFAULT_CONTEXT_WAL_CAP_BYTES,
    MIN_CONTEXT_WAL_CAP_BYTES,
    MAX_CONTEXT_WAL_CAP_BYTES,
    'invalidContextWalCap'
  );
  if (!catalogState.workerData || catalogState.workerData.protocolVersion !== PROTOCOL_VERSION) {
    throw createCatalogError('protocolMismatch', 'Catalog worker protocol mismatch');
  }
  const dbPath = catalogState.workerData.dbPath;
  if (
    typeof dbPath !== 'string' ||
    !path.isAbsolute(dbPath) ||
    path.resolve(dbPath) !== dbPath ||
    path.normalize(dbPath) !== dbPath
  ) {
    throw createCatalogError('invalidDatabasePath', 'A canonical absolute catalog database path is required');
  }
  catalogState.databasePath = dbPath;

  const repositoryRoot = path.join(__dirname, '..', 'js', 'library', 'repository');
  const [schema, canonicalOrder, orderContract, cursorCodec, queryContract, searchNormalizer, transportShuffle] = await Promise.all([
    importModule(path.join(repositoryRoot, 'schema-v3.js')),
    importModule(path.join(repositoryRoot, 'canonical-order.js')),
    importModule(path.join(repositoryRoot, 'catalog-order-contract.js')),
    importModule(path.join(repositoryRoot, 'cursor-codec.js')),
    importModule(path.join(repositoryRoot, 'query-contract.js')),
    importModule(path.join(__dirname, '..', 'js', 'library', 'search-normalizer.js')),
    importModule(path.join(repositoryRoot, 'transport-shuffle.js'))
  ]);
  catalogState.modules = { schema, canonicalOrder, orderContract, cursorCodec, queryContract, searchNormalizer, transportShuffle };
  assertSchemaSearchFields(schema.MUSIC_LIBRARY_SEARCH_FIELDS);

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  catalogState.database = new DatabaseSync(dbPath);
  catalogState.database.exec(schema.getMusicLibraryV3InitializationSql());
  catalogState.database.prepare('DELETE FROM artwork_claims').run();
  verifyPragmas();
  initializeMetadata(schema.MUSIC_LIBRARY_SCHEMA_VERSION, schema.MUSIC_LIBRARY_COLLATION_VERSION);
  ensureDirectoriesSynchronized();
  recoverInterruptedOperations();
  removeLegacyPlaybackOperations();
  recoverInterruptedScans();

  parentPort.on('message', handleMessage);
  postMessage({
    protocolVersion: PROTOCOL_VERSION,
    type: 'ready',
    ok: true,
    payload: getCapabilities()
  });
  scheduleDeletionMaintenance();
}


function importModule(filePath) {
  return import(pathToFileURL(filePath).href);
}

function verifyPragmas() {
  catalogState.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  if (Number(catalogState.database.prepare('PRAGMA foreign_keys').get().foreign_keys) !== 1) {
    throw createCatalogError('sqliteCapabilityMissing', 'SQLite foreign key enforcement is unavailable');
  }
  const journalMode = String(catalogState.database.prepare('PRAGMA journal_mode').get().journal_mode || '').toLowerCase();
  if (journalMode !== 'wal') {
    throw createCatalogError('sqliteCapabilityMissing', 'SQLite WAL mode is unavailable');
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
  ({ catalogVersion: catalogState.catalogVersion, scopeVersions: catalogState.scopeVersions } = catalogState.modules.orderContract.ensureCatalogSortKeyVersion(catalogState.database, {
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
  for (const contextToken of releasedContexts) {
    const context = contexts.get(contextToken);
    if (!context) continue;
    context.ownerCount = Math.max(0, (context.ownerCount ?? 1) - 1);
    if (context.ownerCount === 0 && context.releaseRequested) contexts.delete(contextToken);
  }
}

function handleMessage(message) {
  let requestId = null;
  try {
    validateRequestEnvelope(message);
    requestId = message.requestId;
    if (catalogState.closed && message.command !== 'close') {
      throw createCatalogError('catalogClosed', 'Catalog worker is closed');
    }
    const payload = dispatchCommand(message.command, message.payload);
    sendResponse(requestId, true, payload);
  } catch (error) {
    if (requestId === null && Number.isSafeInteger(message && message.requestId)) {
      requestId = message.requestId;
    }
    sendResponse(requestId, false, null, error);
  }
}

function validateRequestEnvelope(message) {
  if (!isPlainObject(message)) {
    throw createCatalogError('invalidRequest', 'Catalog request must be an object');
  }
  assertExactFields(message, ['protocolVersion', 'requestId', 'command', 'payload'], 'invalidRequest');
  if (message.protocolVersion !== PROTOCOL_VERSION) {
    throw createCatalogError('protocolMismatch', 'Catalog worker protocol mismatch');
  }
  if (!Number.isSafeInteger(message.requestId) || message.requestId <= 0) {
    throw createCatalogError('invalidRequest', 'Catalog request ID is invalid');
  }
  if (typeof message.command !== 'string' || message.command.length === 0 || message.command.length > 64) {
    throw createCatalogError('invalidRequest', 'Catalog command is invalid');
  }
  if (!isPlainObject(message.payload)) {
    throw createCatalogError('invalidRequest', 'Catalog request payload must be an object');
  }
  const byteLength = measureBytes(message, 'invalidRequest');
  if (byteLength > MAX_REQUEST_BYTES) {
    throw createCatalogError('requestTooLarge', 'Catalog request exceeds the byte limit', {
      byteLength,
      maximum: MAX_REQUEST_BYTES
    });
  }
}

function dispatchCommand(command, payload) {
  switch (command) {
    case 'getCapabilities': return getCapabilities();
    case 'getCounts': return getCounts(payload);
    case 'upsertFolders': return upsertFolders(payload);
    case 'upsertTracks': return upsertTracks(payload);
    case 'createContext': return createContext(payload);
    case 'getContextCount': return getContextCount(payload);
    case 'queryTracks': return queryTracks(payload);
    case 'querySharedLibrary': return querySharedLibrary(catalogState.database, payload, {
      createContextFilter, createEntityContextFilter, normalizeContextQuery, createOrder,
      trackFieldExpression, createSortKey, searchNormalizer: catalogState.modules.searchNormalizer,
      entityDefinitions: ENTITY_DEFINITIONS, recentLimit: RECENT_TRACK_LIMIT
    });
    case 'browseFolderChildren': return browseFolderChildren(payload);
    case 'queryEntities': return queryEntities(payload);
    case 'readContextPage': return readContextPage(payload);
    case 'readContextPageAtOrdinal': return readContextPageAtOrdinal(payload);
    case 'resolveEntityAnchor': return resolveEntityAnchor(payload);
    case 'retainContext': return retainContext(payload);
    case 'releaseRetainedContext': return releaseRetainedContext(payload);
    case 'releaseContext': return releaseContext(payload);
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
    case 'close': return closeCatalog(payload);
    default: throw createCatalogError('unknownCommand', 'Catalog command is not supported');
  }
}

function getCapabilities() {
  return {
    backend: 'node:sqlite-worker',
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: catalogState.modules.schema.MUSIC_LIBRARY_SCHEMA_VERSION,
    databaseSyncThreadId: threadId,
    databaseSyncInWorker: !require('node:worker_threads').isMainThread,
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

function createContext(payload) {
  const query = normalizeContextQuery(payload);
  pruneExpiredContexts();
  if (contexts.size >= catalogState.maxContexts) {
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
  const snapshotDatabase = new DatabaseSync(catalogState.databasePath, { readOnly: true });
  snapshotDatabase.exec('PRAGMA foreign_keys = ON; PRAGMA query_only = ON; BEGIN;');
  snapshotDatabase.prepare('SELECT value FROM meta WHERE key = ?').get('catalog_version');
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
    walStartBytes: readWalBytes(),
    database: snapshotDatabase,
    totalCount: null,
    resolvedCount: null,
    unresolvedCount: null
  };
  contexts.set(token, context);
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
    FROM ${base.tableSql}
    WHERE ${where.join(' AND ')}
    ORDER BY ${createOrderBySql(order, false)}
    LIMIT 1
  `).get(...bindings);
  if (!row) return null;
  const normalized = normalizePageRow(row);
  const keyset = createKeysetSql(order, order.descriptor.buildTuple(normalized), 'before');
  const count = catalogState.database.prepare(`
    SELECT count(*) AS count FROM ${base.tableSql}
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
  `).get(...base.bindings, ...keyset.bindings);
  return { ordinal: Number(count.count), entityId: normalized.trackUid };
}

function resolvePlaylistContextOrdinal(context, entityId) {
  if (entityId === null) return null;
  const order = createPlaylistOrder();
  const base = createPlaylistContextFilter(context);
  const row = catalogState.database.prepare(`
    SELECT ${createPlaylistTrackPageSelection()}
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN tracks t ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${[...base.clauses, 'CAST(i.item_key AS TEXT) = ?'].join(' AND ')}
    ORDER BY i.position, CAST(i.item_key AS TEXT)
    LIMIT 1
  `).get(...base.bindings, entityId);
  if (!row) return null;
  const normalized = normalizePageRow(row);
  const keyset = createPlaylistKeysetSql(order, order.descriptor.buildTuple(normalized), 'before');
  const count = catalogState.database.prepare(`
    SELECT count(*) AS count
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN tracks t ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
  `).get(...base.bindings, ...keyset.bindings);
  return { ordinal: Number(count.count), entityId: normalized.playlistItemKey };
}

function executeContextPage(
  context,
  order,
  { continuation, cursorTuple, limit, offset = null, pageStartOrdinal = null }
) {
  const base = createContextFilter(context);
  const keyset = cursorTuple ? createKeysetSql(order, cursorTuple, continuation) : { sql: '', bindings: [] };
  const where = [...base.clauses];
  if (keyset.sql) where.push(keyset.sql);
  const reverse = continuation === 'before';
  const orderBy = createOrderBySql(order, reverse);
  const offsetSql = offset === null ? '' : ' OFFSET ?';
  const bindings = [...base.bindings, ...keyset.bindings, limit + 1];
  if (offset !== null) bindings.push(offset);
  const rows = catalogState.database.prepare(`
    SELECT ${createTrackPageSelection(order)}
    FROM ${base.tableSql}
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
  const base = createPlaylistContextFilter(context);
  const keyset = cursorTuple
    ? createPlaylistKeysetSql(order, cursorTuple, continuation)
    : { sql: '', bindings: [] };
  const where = [...base.clauses];
  if (keyset.sql) where.push(keyset.sql);
  const reverse = continuation === 'before';
  const offsetSql = offset === null ? '' : ' OFFSET ?';
  const bindings = [...base.bindings, ...keyset.bindings, limit + 1];
  if (offset !== null) bindings.push(offset);
  const rows = catalogState.database.prepare(`
    SELECT ${createPlaylistTrackPageSelection()}
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN tracks t ON t.track_uid = i.track_uid
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
  const base = createPlaylistContextFilter(context);
  const keyset = createPlaylistKeysetSql(createPlaylistOrder(), tuple, continuation);
  return Boolean(catalogState.database.prepare(`
    SELECT 1 AS found
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN tracks t ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
    LIMIT 1
  `).get(...base.bindings, ...keyset.bindings));
}

function contextHasRows(context, order, tuple, continuation) {
  const base = createContextFilter(context);
  const keyset = createKeysetSql(order, tuple, continuation);
  const where = [...base.clauses, keyset.sql];
  return Boolean(catalogState.database.prepare(`
    SELECT 1 AS found FROM ${base.tableSql}
    WHERE ${where.join(' AND ')}
    LIMIT 1
  `).get(...base.bindings, ...keyset.bindings));
}

function countContextRows(context) {
  if (context.entityType !== 'track') return countEntityContextRows(context);
  if (context.scope?.playlistId) return countPlaylistContextRows(context);
  const base = createContextFilter(context);
  const row = catalogState.database.prepare(`
    SELECT count(*) AS count FROM ${base.tableSql}
    ${base.clauses.length ? `WHERE ${base.clauses.join(' AND ')}` : ''}
  `).get(...base.bindings);
  return Number(row.count);
}

function countPlaylistContextRows(context) {
  const filter = createPlaylistContextFilter(context);
  const row = catalogState.database.prepare(`
    SELECT count(*) AS totalCount,
      COALESCE(sum(CASE WHEN ${ACTIVE_PLAYLIST_TRACK_CLAUSE} THEN 1 ELSE 0 END), 0) AS resolvedCount
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN tracks t ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${filter.clauses.join(' AND ')}
  `).get(...filter.bindings);
  context.totalCount = Number(row.totalCount);
  context.resolvedCount = Number(row.resolvedCount);
  context.unresolvedCount = context.totalCount - context.resolvedCount;
  return context.totalCount;
}

function createContextFilter(context) {
  const clauses = [context.scope?.playlistId
    ? '1 = 1'
    : ACTIVE_TRACK_FOLDER_CLAUSE];
  const bindings = [];
  let tableSql = 'tracks t';
  if (context.scope) {
    if (context.scope.folderDirKey) {
      const { folderId, path: directoryPath } = parseFolderDirKey(context.scope.folderDirKey);
      clauses.push('t.folder_id = ?');
      bindings.push(folderId);
      if (directoryPath === '') {
        tableSql = 'tracks t INDEXED BY tracks_root_direct_by_folder';
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
    clauses.push(`t.track_key IN (
      SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ?
    )`);
    bindings.push(createTrigramFtsQuery(longTokens));
  }
  const shortTokens = context.tokens.filter(token => Array.from(token).length <= 2);
  if (shortTokens.length > 0) {
    clauses.push(`t.track_key IN (
      SELECT rowid FROM tracks_prefix_fts WHERE tracks_prefix_fts MATCH ?
    )`);
    bindings.push(shortTokens.map(token => `${quoteFtsLiteral(token)}*`).join(' AND '));
  }
  for (const token of context.tokens) {
    clauses.push('instr(t.search_text, ?) > 0');
    bindings.push(token);
  }
  return { clauses, bindings, tableSql };
}

function updateDirectoryMembership(previous, next) {
  if (previous && next && previous.folderId === next.folderId && previous.relativePath === next.relativePath) return;
  if (previous) {
    const ancestors = createDirectoryAncestors(previous.relativePath);
    const decrement = catalogState.database.prepare(`
      UPDATE directories SET direct_track_count = direct_track_count - ?,
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
  if (next) incrementDirectoryMembership(next);
}

function incrementDirectoryMembership(track) {
  const ancestors = createDirectoryAncestors(track.relativePath);
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
      track.folderId, ancestor.relativePath, ancestor.parentPath, ancestor.name,
      index === ancestors.length - 1 ? 1 : 0
    );
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
    const childBytes = Buffer.byteLength(JSON.stringify(child), 'utf8') + 1;
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
    context.recentTrackUids = catalogState.database.prepare(`
      SELECT t.track_uid AS trackUid
      FROM tracks t
      JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
      ORDER BY t.added_at DESC, t.track_uid DESC
      LIMIT ?
    `).all(RECENT_TRACK_LIMIT).map(row => row.trackUid);
  }
  return context.recentTrackUids;
}

function trackOrderColumn(field) {
  if (field === 'pathSort') return `CAST(RTRIM((SELECT COALESCE(root.path, root.display_name, '') FROM folders root WHERE root.id = t.folder_id), '${path.sep}') || '${path.sep}' || REPLACE(t.relative_path, '/', '${path.sep}') AS BLOB)`;
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
    `(SELECT COALESCE(root.path, root.display_name, '') FROM folders root WHERE root.id = t.folder_id) AS rootPath`,
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
    row.path = path.join(row.rootPath, ...row.relativePath.split('/'));
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
  const context = contexts.get(token);
  if (!context) return { released: false };
  if ((context.ownerCount ?? 0) > 0) {
    context.releaseRequested = true;
    return { released: true, retained: true };
  }
  closeContext(context);
  return { released: contexts.delete(token) };
}

function retainContext(payload) {
  assertExactFields(payload, ['contextToken'], 'invalidContext');
  const context = getContext(payload.contextToken);
  context.ownerCount = (context.ownerCount ?? 0) + 1;
  return { retained: true };
}

function releaseRetainedContext(payload) {
  assertExactFields(payload, ['contextToken'], 'invalidContext');
  const token = requireString(payload.contextToken, 'contextToken', 512);
  const context = contexts.get(token);
  if (!context || (context.ownerCount ?? 0) === 0) return { released: false };
  context.ownerCount -= 1;
  if (context.ownerCount === 0 && context.releaseRequested) {
    closeContext(context);
    contexts.delete(token);
  }
  return { released: true };
}

function getContext(contextToken) {
  pruneExpiredContexts();
  const token = requireString(contextToken, 'contextToken', 512);
  const context = contexts.get(token);
  if (!context) throw createCatalogError('STALE_CURSOR', 'Catalog context has expired');
  const now = Date.now();
  if (context.expiresAt <= now || readWalBytes() - context.walStartBytes > catalogState.contextWalCapBytes) {
    closeContext(context);
    contexts.delete(token);
    throw createCatalogError('STALE_CURSOR', 'Catalog context snapshot has expired');
  }
  context.lastAccessAt = now;
  return context;
}

function pruneExpiredContexts() {
  const now = Date.now();
  for (const [token, context] of contexts) {
    if ((context.expiresAt <= now || readWalBytes() - context.walStartBytes > catalogState.contextWalCapBytes) &&
        (context.ownerCount ?? 0) === 0) {
      closeContext(context);
      contexts.delete(token);
    }
  }
}

function withContextDatabase(context, callback) {
  const authorityDatabase = catalogState.database;
  catalogState.database = context.database;
  try {
    return callback();
  } finally {
    catalogState.database = authorityDatabase;
  }
}

function closeContext(context) {
  if (!context?.database) return;
  try {
    context.database.exec('ROLLBACK');
  } catch {
    // The read transaction may already have been closed during shutdown.
  }
  try {
    context.database.close();
  } catch {
    // Closing a failed read connection is best effort.
  }
  context.database = null;
}

function readWalBytes() {
  try {
    return fs.statSync(`${catalogState.databasePath}-wal`).size;
  } catch {
    return 0;
  }
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

  if (sourceContext) {
    sourceContext.ownerCount = (sourceContext.ownerCount ?? 0) + 1;
    sourceContext.expiresAt = Math.max(sourceContext.expiresAt, buildDeadlineAt);
  }
  try {
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
    return { kind: 'created', operationId };
    });
    if (result.kind !== 'created' && sourceContext) sourceContext.ownerCount = Math.max(0, sourceContext.ownerCount - 1);
    return result;
  } catch (error) {
    if (sourceContext) sourceContext.ownerCount = Math.max(0, sourceContext.ownerCount - 1);
    throw error;
  }
}

function releaseOperationContext(operationId, operation) {
  if (operation.contextReleased || !operation.sourceContextToken) return;
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
        catalogState.database.prepare('DELETE FROM playlists WHERE id = ? AND state = \'deleted\'').run(playlistId);
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
    pathCandidates = catalogState.database.prepare(`
      SELECT t.track_uid AS trackUid, t.relative_path AS relativePath, f.path AS rootPath,
        t.normalized_title AS normalizedTitle, t.normalized_artist AS normalizedArtist,
        t.duration_bucket AS durationBucket
      FROM tracks t
      JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
      WHERE t.source_kind = 'file' AND t.normalized_basename = ? ORDER BY t.track_uid LIMIT ?
    `).all(basename, PLAYLIST_RESOLUTION_CANDIDATE_LIMIT + 1);
    if (pathCandidates.length <= PLAYLIST_RESOLUTION_CANDIDATE_LIMIT) {
      const exact = pathCandidates.filter(track => playlistAbsolutePathMatches(track, requestedPath));
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

function playlistAbsolutePathMatches(track, requestedPath) {
  let requested;
  try {
    const raw = String(requestedPath || '');
    requested = raw.toLowerCase().startsWith('file:') ? fileURLToPath(raw) : raw;
  } catch {
    return false;
  }
  if (!path.isAbsolute(requested) || !path.isAbsolute(track.rootPath || '')) return false;
  const root = path.resolve(track.rootPath);
  const candidate = path.resolve(root, ...String(track.relativePath || '').split('/'));
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(candidate) === normalize(requested);
}

function normalizePlaylistImportOrigin(value) {
  if (value == null) return null;
  assertExactFields(value, [
    'folderId', 'playlistRelativePath', 'playlistCanonicalPath', 'root'
  ], 'invalidPlaylistRequest');
  const origin = {
    folderId: requireString(value.folderId, 'origin.folderId', 512),
    playlistRelativePath: normalizeRelativePath(requireString(
      value.playlistRelativePath,
      'origin.playlistRelativePath',
      32768
    )),
    playlistCanonicalPath: requireString(value.playlistCanonicalPath, 'origin.playlistCanonicalPath', 32768),
    root: requireString(value.root, 'origin.root', 32768)
  };
  if (!path.isAbsolute(origin.root) || !path.isAbsolute(origin.playlistCanonicalPath)) {
    throw createCatalogError('invalidPlaylistRequest', 'Playlist import origin paths must be absolute');
  }
  const folder = catalogState.database.prepare(`
    SELECT path, status FROM folders WHERE id = ?
  `).get(origin.folderId);
  if (!folder || folder.status === 'removed' || !samePlatformPath(folder.path, origin.root)) {
    throw createCatalogError('stalePlaylistOrigin', 'Playlist import folder origin is no longer current');
  }
  const expected = path.resolve(origin.root, ...origin.playlistRelativePath.split('/'));
  if (!samePlatformPath(expected, origin.playlistCanonicalPath) || !pathIsContained(origin.root, expected)) {
    throw createCatalogError('invalidPlaylistRequest', 'Playlist import origin escaped its folder root');
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
  if (!requested) return null;
  let decoded = requested;
  try {
    if (decoded.toLowerCase().startsWith('file:')) decoded = fileURLToPath(decoded);
  } catch {
    return null;
  }
  const candidates = [];
  if (path.isAbsolute(decoded)) {
    candidates.push(path.resolve(decoded));
  } else {
    candidates.push(path.resolve(path.dirname(normalizedOrigin.playlistCanonicalPath), decoded));
    candidates.push(path.resolve(normalizedOrigin.root, decoded));
  }
  const relativePaths = [];
  for (const candidate of candidates) {
    if (!pathIsContained(normalizedOrigin.root, candidate)) continue;
    const relative = path.relative(normalizedOrigin.root, candidate).split(path.sep).join('/');
    if (relative && !relativePaths.some(value => samePlatformPath(value, relative))) {
      relativePaths.push(relative);
    }
  }
  for (const relativePath of relativePaths) {
    const matches = catalogState.database.prepare(`
      SELECT track_uid AS trackUid FROM tracks
      WHERE folder_id = ? AND source_kind = 'file' AND relative_path = ? COLLATE NOCASE
      ORDER BY track_uid LIMIT 2
    `).all(normalizedOrigin.folderId, relativePath);
    if (matches.length === 1) return matches[0].trackUid;
  }
  return null;
}

function pathIsContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
}

function samePlatformPath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const normalize = value => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

function runDurableTransaction(callback) {
  catalogState.database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    catalogState.database.exec('COMMIT');
    pruneExpiredContexts();
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
    extractorVersion: 'electron-artwork-v2'
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
    if (!claim.canonicalSourceIdentity.startsWith(`${track.relativePath}#embedded:`) ||
        claim.embeddedLength == null ||
        claim.embeddedLength === 0 || claim.embeddedLength > MAX_ARTWORK_RAW_BYTES ||
        claim.embeddedLength > claim.size || claim.externalArtworkStat !== null) return false;
  } else {
    if (!claim.externalArtworkStat || claim.embeddedOffset !== null || claim.embeddedLength !== null ||
        track.sourceKind !== 'cue-track' ||
        !isCueCoverRelativePath(track.cueRelativePath, track.relativePath, claim.canonicalSourceIdentity)) {
      return false;
    }
  }
  return true;
}

function listScanFolders(payload) {
  assertAllowedFields(payload, ['folderIds', 'includeRemoved'], 'invalidScanFolderRequest');
  const folderIds = payload.folderIds === undefined
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
        metadata_cursor AS metadataCursor, durable_cursor AS durableCursor
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
        ensureFolderDeletionJob(folderId, lifecycleVersion + 1);
        return { tombstoned: true };
      }
    );
  } else if (folder.status !== 'removed' || Number(folder.lifecycleVersion) !== lifecycleVersion + 1) {
    throw createCatalogError('staleFolderLifecycle', 'Library folder lifecycle has changed');
  }
  return runFolderDeletionChunk(folderId, lifecycleVersion + 1);
}

function resolvePlaylistExportSource(payload) {
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
      f.id AS folderId,
      f.path AS rootPath,
      f.lifecycle_version AS lifecycleVersion,
      f.status AS folderStatus
    FROM tracks t
    JOIN folders f ON f.id = t.folder_id
    WHERE t.track_uid = ?
  `).get(trackUid);
  if (!row) throw createCatalogError('trackNotFound', 'Track does not exist');
  if (!row.rootPath || row.folderStatus === 'removed') {
    throw createCatalogError('sourceUnavailable', 'Track source is unavailable');
  }
  const root = path.resolve(row.rootPath);
  const relativePath = normalizeRelativePath(row.relativePath);
  const candidate = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, candidate);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw createCatalogError('sourceOutsideLibrary', 'Track source is outside the selected library');
  }
  return {
    kind: 'absolute-path',
    trackUid: row.trackUid,
    folderId: row.folderId,
    lifecycleVersion: Number(row.lifecycleVersion),
    path: candidate,
    physicalSourceKey: createPhysicalSourceKey(row.folderId, row.relativePath),
    sourceKind: row.sourceKind,
    entryKey: row.entryKey ?? null,
    cueRelativePath: row.cueRelativePath ?? null,
    startFrame: row.startFrame == null ? null : Number(row.startFrame),
    endFrame: row.endFrame == null ? null : Number(row.endFrame)
  };
}

function closeCatalog(payload) {
  assertExactFields(payload, [], 'invalidCloseRequest');
  if (!catalogState.closed) {
    catalogState.closed = true;
    for (const context of contexts.values()) closeContext(context);
    contexts.clear();
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
      pruneExpiredContexts();
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
    pruneExpiredContexts();
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

function sendResponse(requestId, ok, payload, error) {
  let message = {
    protocolVersion: PROTOCOL_VERSION,
    type: 'response',
    requestId,
    ok
  };
  if (ok) message.payload = payload;
  else message.error = serializeError(error);
  const byteLength = measureBytes(message, 'unserializableResponse');
  if (byteLength > MAX_RESPONSE_BYTES) {
    message = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'response',
      requestId,
      ok: false,
      error: serializeError(createCatalogError('responseTooLarge', 'Catalog response exceeds the byte limit', {
        byteLength,
        maximum: MAX_RESPONSE_BYTES
      }))
    };
  }
  postMessage(message);
}

function postMessage(message) {
  parentPort.postMessage(message);
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
    return Buffer.byteLength(json, 'utf8') + binaryBytes;
  } catch {
    throw createCatalogError(code, 'Catalog message is not serializable');
  }
}

function serializeError(error, fallbackCode = 'catalogError') {
  const details = isPlainObject(error && error.details) ? error.details : {};
  return {
    code: typeof (error && error.code) === 'string' ? error.code.slice(0, 128) : fallbackCode,
    message: typeof (error && error.message) === 'string'
      ? error.message.slice(0, 1024)
      : 'Catalog worker request failed',
    details: sanitizeDetails(details)
  };
}

function sanitizeDetails(details) {
  const sanitized = {};
  for (const [key, value] of Object.entries(details).slice(0, 32)) {
    if (typeof value === 'string') sanitized[key] = value.slice(0, 1024);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) sanitized[key] = value;
  }
  return sanitized;
}
