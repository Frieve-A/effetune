'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { parentPort, threadId, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');

const PROTOCOL_VERSION = 1;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_QUERY_LIMIT = 500;
const DEFAULT_QUERY_LIMIT = 200;
const MAX_WRITE_BATCH_ROWS = 1000;
const MAX_TRACKS_PER_UPSERT_STATEMENT = 500;
const MAX_QUERY_CHARACTERS = 512;
const MAX_QUERY_TOKENS = 16;
const MAX_QUERY_TOKEN_CHARACTERS = 128;
const FOLDER_DELETION_TRACKS_PER_CHUNK = 100;
const DELETION_MAINTENANCE_DELAY_MS = 50;
const MAX_TRACK_TEXT_CHARACTERS = 4096;
const MAX_ARTWORK_RAW_BYTES = 20 * 1024 * 1024;
const MAX_ARTWORK_THUMBNAIL_BYTES = 512 * 1024;
const ARTWORK_STORAGE_SAFETY_MIN_BYTES = 256 * 1024 * 1024;
const ARTWORK_STORAGE_SAFETY_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const PLAYLIST_RESOLUTION_CANDIDATE_LIMIT = 256;
const PLAYLIST_RECONCILIATION_BATCH_SIZE = 100;
const ENTITY_AGGREGATE_PHASES = Object.freeze([
  { scope: 'albums', entityTable: 'albums', membershipTable: 'track_albums', keyColumn: 'album_key' },
  { scope: 'artists', entityTable: 'artists', membershipTable: 'track_artists', keyColumn: 'artist_key' },
  { scope: 'genres', entityTable: 'genres', membershipTable: 'track_genres', keyColumn: 'genre_key' },
  { scope: 'subfolders', entityTable: 'subfolders', membershipTable: 'track_subfolders', keyColumn: 'subfolder_key' }
]);
const RECENT_TRACK_LIMIT = 500;
const DEFAULT_CONTEXT_TTL_MS = 5 * 60 * 1000;
const MIN_CONTEXT_TTL_MS = 1000;
const MAX_CONTEXT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CONTEXT_WAL_CAP_BYTES = 64 * 1024 * 1024;
const MIN_CONTEXT_WAL_CAP_BYTES = 1024 * 1024;
const MAX_CONTEXT_WAL_CAP_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_CONTEXTS = 32;
const MAX_CONTEXTS = 256;
const SEARCH_FIELDS = Object.freeze([
  'title',
  'artist',
  'album_artist',
  'album',
  'genre',
  'file_name',
  'relative_path'
]);
const TRACK_SCOPE_FIELDS = Object.freeze([
  'folderId',
  'folderKey',
  'albumKey',
  'artistKey',
  'genreKey',
  'subfolderKey',
  'playlistId',
  'trackUids',
  'recent'
]);
const TERMINAL_OPERATION_PHASES = Object.freeze([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED'
]);
const DURABLE_OPERATION_KINDS = new Set([
  'addToPlaylist', 'importPlaylist', 'previewPlaylistImport'
]);
const ACTIVE_TRACK_FOLDER_CLAUSE = `EXISTS(
  SELECT 1 FROM folders active_folder
  WHERE active_folder.id = t.folder_id AND active_folder.status <> 'removed'
)`;
const ACTIVE_PLAYLIST_TRACK_CLAUSE = `(i.track_uid IS NOT NULL AND ${ACTIVE_TRACK_FOLDER_CLAUSE})`;
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
    fixedClauses: Object.freeze(["e.state = 'active'"]),
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
    ELSE e.${fallbackColumn}
  END)`;
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

let database;
let databasePath;
let modules;
let catalogVersion = 0;
let scopeVersions = Object.create(null);
let activeArtworkUtilitySession = null;
let contextCounter = 0;
let closed = false;
const contexts = new Map();
const pendingEntityAggregationScans = new Set();
const pendingScanSweepRecoveries = new Map();
const pendingScanInvalidations = new Map();
let activeMutationBatch = null;
const contextTtlMs = normalizeBoundedInteger(
  workerData && workerData.contextTtlMs,
  DEFAULT_CONTEXT_TTL_MS,
  MIN_CONTEXT_TTL_MS,
  MAX_CONTEXT_TTL_MS,
  'invalidContextTtl'
);
const maxContexts = normalizeBoundedInteger(
  workerData && workerData.maxContexts,
  DEFAULT_MAX_CONTEXTS,
  1,
  MAX_CONTEXTS,
  'invalidMaxContexts'
);
const contextWalCapBytes = normalizeBoundedInteger(
  workerData && workerData.contextWalCapBytes,
  DEFAULT_CONTEXT_WAL_CAP_BYTES,
  MIN_CONTEXT_WAL_CAP_BYTES,
  MAX_CONTEXT_WAL_CAP_BYTES,
  'invalidContextWalCap'
);

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
  if (!workerData || workerData.protocolVersion !== PROTOCOL_VERSION) {
    throw createCatalogError('protocolMismatch', 'Catalog worker protocol mismatch');
  }
  const dbPath = workerData.dbPath;
  if (
    typeof dbPath !== 'string' ||
    !path.isAbsolute(dbPath) ||
    path.resolve(dbPath) !== dbPath ||
    path.normalize(dbPath) !== dbPath
  ) {
    throw createCatalogError('invalidDatabasePath', 'A canonical absolute catalog database path is required');
  }
  databasePath = dbPath;

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
  modules = { schema, canonicalOrder, orderContract, cursorCodec, queryContract, searchNormalizer, transportShuffle };
  assertSchemaSearchFields(schema.MUSIC_LIBRARY_SEARCH_FIELDS);

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  database = new DatabaseSync(dbPath);
  database.exec(schema.getMusicLibraryV3InitializationSql());
  database.prepare('DELETE FROM artwork_claims').run();
  verifyPragmas();
  initializeMetadata(schema.MUSIC_LIBRARY_SCHEMA_VERSION);
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

function recoverInterruptedScans() {
  const now = Date.now();
  runDurableTransaction(() => {
    const interrupted = database.prepare(`
      SELECT scan_id AS scanId, folder_id AS folderId, generation,
        expected_lifecycle_version AS lifecycleVersion, status,
        sweep_eligibility AS sweepEligibility, continuity_broken AS continuityBroken
      FROM scan_run_folders
      WHERE status IN ('enumerating', 'committing', 'reconciling', 'sweeping')
    `).all();
    for (const identity of interrupted) {
      clearCueScanStageRows(identity);
      if (isRecoverableScanSweep(identity)) {
        pendingScanSweepRecoveries.set(entityAggregationScanKey(identity), {
          scanId: identity.scanId,
          folderId: identity.folderId,
          generation: Number(identity.generation),
          expectedLifecycleVersion: Number(identity.lifecycleVersion)
        });
      } else {
        activateEntityAggregationJob(identity);
      }
    }
    const changed = database.prepare(`
      UPDATE scan_run_folders
      SET status = 'interrupted', stop_reason = 'service-interrupted',
        continuity_broken = 1, sweep_eligibility = 'INELIGIBLE',
        sweep_block_reason = 'service-interrupted', updated_at = ?
      WHERE status IN ('enumerating', 'committing', 'reconciling')
        OR (status = 'sweeping' AND (sweep_eligibility <> 'ELIGIBLE' OR continuity_broken <> 0))
    `).run(now);
    database.prepare(`
      UPDATE scan_runs SET status = 'interrupted', finished_at = ?, stop_reason = 'service-interrupted'
      WHERE status = 'running' AND NOT EXISTS(
        SELECT 1 FROM scan_run_folders f
        WHERE f.scan_id = scan_runs.id AND f.status = 'sweeping'
          AND f.sweep_eligibility = 'ELIGIBLE' AND f.continuity_broken = 0
      )
    `).run(now);
    database.prepare(`
      UPDATE deletion_jobs SET state = 'blocked-interrupted', updated_at = ?
      WHERE kind = 'scan-sweep' AND state = 'active'
        AND NOT EXISTS(
          SELECT 1 FROM scan_run_folders f
          WHERE f.scan_id = deletion_jobs.scan_id AND f.folder_id = deletion_jobs.folder_id
            AND f.status = 'sweeping' AND f.sweep_eligibility = 'ELIGIBLE'
            AND f.continuity_broken = 0
        )
    `).run(now);
    database.prepare(`
      DELETE FROM deletion_jobs
      WHERE kind = 'playlist-resolve' AND folder_id IS NULL
    `).run();
    return { changed: Number(changed.changes) };
  });
}

function isRecoverableScanSweep(state) {
  return state.status === 'sweeping' && state.sweepEligibility === 'ELIGIBLE' &&
    Number(state.continuityBroken) === 0;
}


function importModule(filePath) {
  return import(pathToFileURL(filePath).href);
}

function verifyPragmas() {
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  if (Number(database.prepare('PRAGMA foreign_keys').get().foreign_keys) !== 1) {
    throw createCatalogError('sqliteCapabilityMissing', 'SQLite foreign key enforcement is unavailable');
  }
  const journalMode = String(database.prepare('PRAGMA journal_mode').get().journal_mode || '').toLowerCase();
  if (journalMode !== 'wal') {
    throw createCatalogError('sqliteCapabilityMissing', 'SQLite WAL mode is unavailable');
  }
  const compileOptions = database.prepare('PRAGMA compile_options').all();
  if (!compileOptions.some(row => String(row.compile_options || '').includes('ENABLE_FTS5'))) {
    throw createCatalogError('sqliteCapabilityMissing', 'SQLite FTS5 support is unavailable');
  }
  database.prepare("SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'cap' LIMIT 1").all();
  database.prepare("SELECT rowid FROM tracks_prefix_fts WHERE tracks_prefix_fts MATCH 'ca*' LIMIT 1").all();
}

function initializeMetadata(expectedSchemaVersion) {
  const getMeta = database.prepare('SELECT value FROM meta WHERE key = ?');
  const insertMeta = database.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)');
  insertMeta.run('schema_version', String(expectedSchemaVersion));
  const actualSchemaVersion = Number(getMeta.get('schema_version').value);
  if (actualSchemaVersion !== expectedSchemaVersion) {
    throw createCatalogError('schemaVersionMismatch', 'Catalog schema version does not match this application');
  }
  insertMeta.run('catalog_version', '0');
  catalogVersion = Number(getMeta.get('catalog_version').value);
  if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 0) {
    throw createCatalogError('catalogCorrupt', 'Catalog version metadata is invalid');
  }
  for (const scope of ['artwork', 'tracks', 'folders', 'subfolders', 'albums', 'artists', 'genres', 'playlists']) {
    const key = `scope_version:${scope}`;
    insertMeta.run(key, '0');
    const value = Number(getMeta.get(key).value);
    scopeVersions[scope] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
}

function recoverInterruptedOperations() {
  const now = Date.now();
  const result = JSON.stringify({
    state: 'interrupted',
    code: 'service-interrupted',
    finishedAt: now
  });
  const releasedContexts = runDurableTransaction(() => {
    const interrupted = database.prepare(`
      SELECT operation_id AS operationId, source_context_token AS sourceContextToken,
        context_released AS contextReleased
      FROM operation_jobs
      WHERE terminal_kind IS NULL
        AND phase NOT IN (${TERMINAL_OPERATION_PHASES.map(() => '?').join(', ')})
    `).all(...TERMINAL_OPERATION_PHASES);
    database.prepare(`
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
    database.prepare(`
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

function removeLegacyPlaybackOperations() {
  runDurableTransaction(() => {
    const operationIds = database.prepare(`
      SELECT operation_id AS operationId FROM operation_jobs
      WHERE operation_kind IN ('play', 'playNext', 'queue')
    `).all().map(row => row.operationId);
    const deleteProgress = database.prepare('DELETE FROM operation_progress WHERE operation_id = ?');
    const deleteSavePages = database.prepare('DELETE FROM sequence_save_pages WHERE operation_id = ?');
    const deleteOperation = database.prepare('DELETE FROM operation_jobs WHERE operation_id = ?');
    for (const operationId of operationIds) {
      releaseOperationSnapshots(operationId);
      deleteProgress.run(operationId);
      deleteSavePages.run(operationId);
      deleteOperation.run(operationId);
    }
  });
}

function handleMessage(message) {
  let requestId = null;
  try {
    validateRequestEnvelope(message);
    requestId = message.requestId;
    if (closed && message.command !== 'close') {
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
    schemaVersion: modules.schema.MUSIC_LIBRARY_SCHEMA_VERSION,
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
    contextTtlMs,
    maxContexts,
    contextWalCapBytes
  };
}

function getCounts(payload = {}) {
  assertAllowedFields(payload, ['catalogVersion'], 'invalidCountsRequest');
  if (payload.catalogVersion !== undefined) validateCatalogVersion(payload.catalogVersion);
  return readCounts();
}

function readCounts() {
  const row = database.prepare(`
    SELECT
      (SELECT count(*) FROM tracks t WHERE ${ACTIVE_TRACK_FOLDER_CLAUSE}) AS tracks,
      (SELECT count(*) FROM folders WHERE status <> 'removed') AS folders,
      (SELECT count(*) FROM subfolders e WHERE
        ${createActiveEntityMembershipClause('track_subfolders', 'subfolder_key')}
        AND EXISTS(SELECT 1 FROM folders active_folder
          WHERE active_folder.id = e.folder_id AND active_folder.status <> 'removed')) AS subfolders,
      (SELECT count(*) FROM albums e WHERE
        ${createActiveEntityMembershipClause('track_albums', 'album_key')}) AS albums,
      (SELECT count(*) FROM artists e WHERE
        ${createActiveEntityMembershipClause('track_artists', 'artist_key')}) AS artists,
      (SELECT count(*) FROM genres e WHERE
        ${createActiveEntityMembershipClause('track_genres', 'genre_key')}) AS genres,
      (SELECT count(*) FROM playlists WHERE state = 'active') AS playlists
  `).get();
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

function upsertFolders(payload) {
  assertExactFields(payload, ['folders'], 'invalidFolderBatch');
  const folders = validateBatch(payload.folders, 'folders');
  if (folders.length === 0) return createNoChangeResult();
  const statement = database.prepare(`
    INSERT INTO folders(
      id, kind, display_name, sort_name, path, status, scan_generation,
      lifecycle_version, added_at, last_scan_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      display_name = excluded.display_name,
      sort_name = excluded.sort_name,
      path = excluded.path,
      status = excluded.status,
      scan_generation = excluded.scan_generation,
      lifecycle_version = excluded.lifecycle_version,
      last_scan_at = excluded.last_scan_at
  `);
  const rows = folders.map(normalizeFolder);
  return commitMutation(['folders'], 'upsert-folders', () => {
    for (const folder of rows) {
      statement.run(
        folder.id,
        folder.kind,
        folder.displayName,
        folder.sortName,
        folder.path,
        folder.status,
        folder.scanGeneration,
        folder.lifecycleVersion,
        folder.addedAt,
        folder.lastScanAt
      );
    }
    return { writtenCount: rows.length };
  });
}

function normalizeFolder(folder, index) {
  if (!isPlainObject(folder)) throw createCatalogError('invalidFolder', `Folder ${index} must be an object`);
  assertAllowedFields(folder, [
    'id', 'kind', 'displayName', 'path', 'status', 'scanGeneration',
    'lifecycleVersion', 'addedAt', 'lastScanAt'
  ], 'invalidFolder');
  const id = requireString(folder.id, `folders[${index}].id`, 512);
  const displayName = requireString(folder.displayName, `folders[${index}].displayName`, MAX_TRACK_TEXT_CHARACTERS);
  let folderPath = null;
  if (folder.path !== null && folder.path !== undefined) {
    folderPath = requireString(folder.path, `folders[${index}].path`, 32768);
    if (!path.isAbsolute(folderPath) || path.resolve(folderPath) !== folderPath || path.normalize(folderPath) !== folderPath) {
      throw createCatalogError('invalidFolderPath', 'Folder path must be canonical and absolute');
    }
  }
  return {
    id,
    kind: optionalString(folder.kind, 'electron', 64),
    displayName,
    sortName: createSortKey(displayName),
    path: folderPath,
    status: optionalString(folder.status, 'ok', 64),
    scanGeneration: optionalNonNegativeInteger(folder.scanGeneration, 0, 'scanGeneration'),
    lifecycleVersion: optionalNonNegativeInteger(folder.lifecycleVersion, 0, 'lifecycleVersion'),
    addedAt: optionalNonNegativeInteger(folder.addedAt, Date.now(), 'addedAt'),
    lastScanAt: optionalNullableInteger(folder.lastScanAt, 'lastScanAt')
  };
}

function upsertTracks(payload) {
  assertExactFields(payload, ['tracks'], 'invalidTrackBatch');
  const tracks = validateBatch(payload.tracks, 'tracks');
  if (tracks.length === 0) return createNoChangeResult();
  const normalized = tracks.map(normalizeTrack);
  const trackBindingCount = createTrackBindings(normalized[0]).length;

  const prepareUpsert = rowCount => database.prepare(`
    INSERT INTO tracks(
      track_uid, folder_id, relative_path, file_identity, file_name, size, mtime_ms,
      title, artist, album_artist, album, genre, year, compilation,
      disc_no, disc_total, track_no, track_total,
      sort_title, sort_album_artist, sort_album, sort_genre,
      duration_sec, sample_rate, bitrate, bits_per_sample, channels, codec,
      metadata_status, metadata_error_code, metadata_attempt_count,
      metadata_last_attempt_generation, metadata_parser_version,
      metadata_last_success_at, artwork_id, extension_json,
      added_at, updated_at, search_text, normalized_basename,
      normalized_title, normalized_artist, duration_bucket
    ) VALUES ${Array.from({ length: rowCount }, () => (
      `(${Array.from({ length: trackBindingCount }, () => '?').join(', ')})`
    )).join(', ')}
    ON CONFLICT(track_uid) DO UPDATE SET
      folder_id = excluded.folder_id,
      relative_path = excluded.relative_path,
      file_identity = excluded.file_identity,
      file_name = excluded.file_name,
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      title = excluded.title,
      artist = excluded.artist,
      album_artist = excluded.album_artist,
      album = excluded.album,
      genre = excluded.genre,
      year = excluded.year,
      compilation = excluded.compilation,
      disc_no = excluded.disc_no,
      disc_total = excluded.disc_total,
      track_no = excluded.track_no,
      track_total = excluded.track_total,
      sort_title = excluded.sort_title,
      sort_album_artist = excluded.sort_album_artist,
      sort_album = excluded.sort_album,
      sort_genre = excluded.sort_genre,
      duration_sec = excluded.duration_sec,
      sample_rate = excluded.sample_rate,
      bitrate = excluded.bitrate,
      bits_per_sample = excluded.bits_per_sample,
      channels = excluded.channels,
      codec = excluded.codec,
      metadata_status = excluded.metadata_status,
      metadata_error_code = excluded.metadata_error_code,
      metadata_attempt_count = excluded.metadata_attempt_count,
      metadata_last_attempt_generation = excluded.metadata_last_attempt_generation,
      metadata_parser_version = excluded.metadata_parser_version,
      metadata_last_success_at = excluded.metadata_last_success_at,
      artwork_id = excluded.artwork_id,
      extension_json = excluded.extension_json,
      updated_at = excluded.updated_at,
      search_text = excluded.search_text,
      normalized_basename = excluded.normalized_basename,
      normalized_title = excluded.normalized_title,
      normalized_artist = excluded.normalized_artist,
      duration_bucket = excluded.duration_bucket
  `);
  const trackUids = [...new Set(normalized.map(track => track.trackUid))];
  const uidPlaceholders = trackUids.map(() => '?').join(', ');
  const deleteFts = database.prepare(`
    INSERT INTO tracks_fts(tracks_fts, rowid, search_text)
    SELECT 'delete', track_key, search_text FROM tracks
    WHERE track_uid IN (${uidPlaceholders})
  `);
  const deletePrefixFts = database.prepare(`
    INSERT INTO tracks_prefix_fts(tracks_prefix_fts, rowid, search_text)
    SELECT 'delete', track_key, search_text FROM tracks
    WHERE track_uid IN (${uidPlaceholders})
  `);
  const insertFts = database.prepare(`
    INSERT INTO tracks_fts(rowid, search_text)
    SELECT track_key, search_text FROM tracks
    WHERE track_uid IN (${uidPlaceholders})
  `);
  const insertPrefixFts = database.prepare(`
    INSERT INTO tracks_prefix_fts(rowid, search_text)
    SELECT track_key, search_text FROM tracks
    WHERE track_uid IN (${uidPlaceholders})
  `);
  const setIndexDeferred = database.prepare(`
    UPDATE search_index_control SET deferred = ? WHERE singleton = 1
  `);
  return commitMutation(['tracks'], 'upsert-tracks', () => {
    deleteFts.run(...trackUids);
    deletePrefixFts.run(...trackUids);
    setIndexDeferred.run(1);
    try {
      for (let offset = 0; offset < normalized.length; offset += MAX_TRACKS_PER_UPSERT_STATEMENT) {
        const chunk = normalized.slice(offset, offset + MAX_TRACKS_PER_UPSERT_STATEMENT);
        prepareUpsert(chunk.length).run(...chunk.flatMap(createTrackBindings));
      }
      insertFts.run(...trackUids);
      insertPrefixFts.run(...trackUids);
    } finally {
      setIndexDeferred.run(0);
    }
    return { writtenCount: normalized.length };
  });
}

function normalizeTrack(track, index) {
  if (!isPlainObject(track)) throw createCatalogError('invalidTrack', `Track ${index} must be an object`);
  assertAllowedFields(track, [
    'trackUid', 'folderId', 'relativePath', 'fileIdentity', 'fileName', 'size', 'mtimeMs',
    'title', 'artist', 'albumArtist', 'album', 'genre', 'year', 'compilation',
    'discNo', 'discTotal', 'trackNo', 'trackTotal', 'durationSec', 'sampleRate',
    'bitrate', 'bitsPerSample', 'channels', 'codec', 'metadataStatus',
    'metadataErrorCode', 'metadataAttemptCount', 'metadataLastAttemptGeneration',
    'metadataParserVersion', 'metadataLastSuccessAt', 'artworkId', 'extensionJson',
    'addedAt', 'updatedAt'
  ], 'invalidTrack');
  const trackUid = requireString(track.trackUid, `tracks[${index}].trackUid`, 512);
  const folderId = requireString(track.folderId, `tracks[${index}].folderId`, 512);
  const relativePath = normalizeRelativePath(requireString(
    track.relativePath,
    `tracks[${index}].relativePath`,
    32768
  ));
  const fileName = optionalString(track.fileName, path.posix.basename(relativePath), MAX_TRACK_TEXT_CHARACTERS);
  const title = requireString(track.title, `tracks[${index}].title`, MAX_TRACK_TEXT_CHARACTERS);
  const artist = optionalString(track.artist, '', MAX_TRACK_TEXT_CHARACTERS);
  const albumArtist = optionalString(track.albumArtist, '', MAX_TRACK_TEXT_CHARACTERS);
  const album = optionalString(track.album, '', MAX_TRACK_TEXT_CHARACTERS);
  const genre = optionalString(track.genre, '', MAX_TRACK_TEXT_CHARACTERS);
  const normalize = modules.searchNormalizer.normalizeSearchText;
  const searchFields = {
    title: normalize(title),
    artist: normalize(artist),
    album_artist: normalize(albumArtist),
    album: normalize(album),
    genre: normalize(genre),
    file_name: normalize(fileName),
    relative_path: normalize(relativePath)
  };
  for (const [field, value] of Object.entries(searchFields)) {
    if (Array.from(value).length > MAX_TRACK_TEXT_CHARACTERS) {
      throw createCatalogError('trackTextTooLarge', `Normalized ${field} exceeds the character limit`);
    }
  }
  const now = Date.now();
  const durationSec = optionalNullableFiniteNumber(track.durationSec, 'durationSec');
  return {
    trackUid,
    folderId,
    relativePath,
    fileIdentity: optionalNullableString(track.fileIdentity, 2048),
    fileName,
    size: optionalNullableNonNegativeInteger(track.size, 'size'),
    mtimeMs: optionalNullableFiniteNumber(track.mtimeMs, 'mtimeMs'),
    title,
    artist,
    albumArtist,
    album,
    genre,
    year: optionalNullableInteger(track.year, 'year'),
    compilation: track.compilation === true || track.compilation === 1 ? 1 : 0,
    discNo: optionalNullableInteger(track.discNo, 'discNo'),
    discTotal: optionalNullableInteger(track.discTotal, 'discTotal'),
    trackNo: optionalNullableInteger(track.trackNo, 'trackNo'),
    trackTotal: optionalNullableInteger(track.trackTotal, 'trackTotal'),
    sortTitle: createSortKey(title),
    sortAlbumArtist: createSortKey(albumArtist || artist),
    sortAlbum: createSortKey(album),
    sortGenre: createSortKey(genre),
    durationSec,
    sampleRate: optionalNullableNonNegativeInteger(track.sampleRate, 'sampleRate'),
    bitrate: optionalNullableNonNegativeInteger(track.bitrate, 'bitrate'),
    bitsPerSample: optionalNullableNonNegativeInteger(track.bitsPerSample, 'bitsPerSample'),
    channels: optionalNullableNonNegativeInteger(track.channels, 'channels'),
    codec: optionalNullableString(track.codec, 128),
    metadataStatus: optionalString(track.metadataStatus, 'ok', 64),
    metadataErrorCode: optionalNullableString(track.metadataErrorCode, 256),
    metadataAttemptCount: optionalNonNegativeInteger(track.metadataAttemptCount, 0, 'metadataAttemptCount'),
    metadataLastAttemptGeneration: optionalNullableNonNegativeInteger(
      track.metadataLastAttemptGeneration,
      'metadataLastAttemptGeneration'
    ),
    metadataParserVersion: optionalString(track.metadataParserVersion, 'catalog-host-v1', 256),
    metadataLastSuccessAt: optionalNullableInteger(track.metadataLastSuccessAt, 'metadataLastSuccessAt'),
    artworkId: optionalNullableString(track.artworkId, 512),
    extensionJson: normalizeExtensionJson(track.extensionJson),
    addedAt: optionalNonNegativeInteger(track.addedAt, now, 'addedAt'),
    updatedAt: optionalNonNegativeInteger(track.updatedAt, now, 'updatedAt'),
    searchText: modules.searchNormalizer.createCompactSearchText(
      SEARCH_FIELDS.map(field => searchFields[field])
    ),
    normalizedBasename: searchFields.file_name,
    normalizedTitle: searchFields.title,
    normalizedArtist: searchFields.artist,
    durationBucket: durationSec === null ? null : Math.round(durationSec),
    searchFields
  };
}

function createTrackBindings(track) {
  return [
    track.trackUid, track.folderId, track.relativePath, track.fileIdentity, track.fileName,
    track.size, track.mtimeMs, track.title, track.artist, track.albumArtist, track.album,
    track.genre, track.year, track.compilation, track.discNo, track.discTotal, track.trackNo,
    track.trackTotal, track.sortTitle, track.sortAlbumArtist, track.sortAlbum,
    track.sortGenre, track.durationSec, track.sampleRate, track.bitrate, track.bitsPerSample,
    track.channels, track.codec, track.metadataStatus, track.metadataErrorCode,
    track.metadataAttemptCount, track.metadataLastAttemptGeneration, track.metadataParserVersion,
    track.metadataLastSuccessAt, track.artworkId, track.extensionJson, track.addedAt,
    track.updatedAt, track.searchText, track.normalizedBasename, track.normalizedTitle,
    track.normalizedArtist, track.durationBucket
  ];
}

function createContext(payload) {
  const query = normalizeContextQuery(payload);
  pruneExpiredContexts();
  if (contexts.size >= maxContexts) {
    throw createCatalogError('tooManyContexts', 'Catalog context lease limit reached', { maximum: maxContexts });
  }
  const queryFingerprint = modules.cursorCodec.createQueryFingerprint({
    endpoint: query.endpoint,
    query: {
      endpoint: query.endpoint,
      query: query.queryText,
      sort: query.sort,
      direction: query.direction,
      scope: query.scope
    }
  });
  const token = `ctx_${threadId}_${Date.now().toString(36)}_${(++contextCounter).toString(36)}`;
  const now = Date.now();
  const snapshotDatabase = new DatabaseSync(databasePath, { readOnly: true });
  snapshotDatabase.exec('PRAGMA foreign_keys = ON; PRAGMA query_only = ON; BEGIN;');
  snapshotDatabase.prepare('SELECT value FROM meta WHERE key = ?').get('catalog_version');
  const context = {
    token,
    ...query,
    queryFingerprint,
    snapshotVersion: catalogVersion,
    visibleScopeVersions: Object.fromEntries(
      query.relevantScopeNames.map(scope => [scope, scopeVersions[scope]])
    ),
    createdAt: now,
    lastAccessAt: now,
    expiresAt: now + contextTtlMs,
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

function getContextCount(payload) {
  assertExactFields(payload, ['contextToken'], 'invalidContext');
  const context = getContext(payload.contextToken);
  const playlistCounts = context.scope?.playlistId ? ensurePlaylistContextCounts(context) : null;
  if (!playlistCounts) ensureContextCount(context);
  return {
    contextToken: context.token,
    totalCount: Number.isSafeInteger(context.totalCount) ? context.totalCount : { pending: true },
    catalogVersion: context.snapshotVersion,
    ...(playlistCounts ? {
      resolvedCount: playlistCounts.resolvedCount,
      unresolvedCount: playlistCounts.unresolvedCount
    } : {})
  };
}

function normalizeContextQuery(payload) {
  assertAllowedFields(payload, [
    'endpoint', 'entityType', 'type', 'query', 'sort', 'direction', 'scope'
  ], 'invalidContext');
  const endpointType = normalizeContextEndpoint(payload.endpoint, payload.entityType);
  const requestedType = payload.type === undefined
    ? endpointType
    : normalizeEntityType(payload.type, { allowTrack: true });
  const entityType = requestedType ?? 'track';
  if (endpointType && requestedType && endpointType !== requestedType) {
    throw createCatalogError('invalidContext', 'Catalog context endpoint and entity type do not match');
  }
  const rawQuery = payload.query === undefined ? '' : requireStringAllowEmpty(payload.query, 'query', MAX_QUERY_CHARACTERS);
  const tokens = modules.searchNormalizer.tokenizeSearchQuery(rawQuery);
  if (tokens.length > MAX_QUERY_TOKENS || tokens.some(token => Array.from(token).length > MAX_QUERY_TOKEN_CHARACTERS)) {
    throw createCatalogError('invalidQuery', 'Catalog search query exceeds the token limit');
  }
  const definition = entityType === 'track' ? null : ENTITY_DEFINITIONS[entityType];
  const sort = payload.sort === undefined
    ? (entityType === 'track' ? 'title' : definition.defaultSort)
    : requireString(payload.sort, 'sort', 32);
  const sortDefinitions = entityType === 'track' ? modules.orderContract.TRACK_ORDER_SPECS : definition.sorts;
  if (!Object.hasOwn(sortDefinitions, sort)) {
    throw createCatalogError('invalidSort', 'Catalog track sort is not supported');
  }
  const direction = payload.direction === undefined
    ? ((sort === 'added' || sort === 'updated' || sort === 'created') ? 'desc' : 'asc')
    : payload.direction;
  if (direction !== 'asc' && direction !== 'desc') {
    throw createCatalogError('invalidDirection', 'Catalog query direction must be asc or desc');
  }
  const scope = normalizeScope(payload.scope);
  if (scope && entityType !== 'track' && !(entityType === 'subfolder' && scope.folderId)) {
    throw createCatalogError('invalidScope', 'Catalog entity type does not support folder scope');
  }
  return {
    tokens,
    queryText: rawQuery,
    sort,
    direction,
    scope,
    entityType,
    endpoint: entityType === 'track' ? 'tracks' : `entities:${entityType}`,
    scopeName: entityType === 'track' ? 'tracks' : definition.scope,
    relevantScopeNames: entityType === 'track' && scope?.playlistId
      ? ['tracks', 'playlists']
      : [entityType === 'track' ? 'tracks' : definition.scope]
  };
}

function normalizeContextEndpoint(endpoint, entityType) {
  if (endpoint === undefined) {
    return entityType === undefined ? null : normalizeEntityType(entityType, { allowTrack: true });
  }
  if (endpoint === 'tracks') {
    if (entityType !== undefined && entityType !== 'track') {
      throw createCatalogError('invalidContext', 'Catalog context endpoint and entity type do not match');
    }
    return 'track';
  }
  if (endpoint === 'entities' && entityType !== undefined) return normalizeEntityType(entityType);
  if (typeof endpoint === 'string' && endpoint.startsWith('entities:')) {
    const type = normalizeEntityType(endpoint.slice('entities:'.length));
    if (entityType !== undefined && entityType !== type) {
      throw createCatalogError('invalidContext', 'Catalog context endpoint and entity type do not match');
    }
    return type;
  }
  throw createCatalogError('invalidContext', 'Catalog context endpoint is invalid');
}

function normalizeScope(scope) {
  if (scope === undefined || scope === null) return null;
  if (!isPlainObject(scope)) throw createCatalogError('invalidScope', 'Catalog query scope must be an object');
  const fields = TRACK_SCOPE_FIELDS.filter(field => Object.hasOwn(scope, field));
  if (fields.length !== 1 || Object.keys(scope).length !== 1) {
    throw createCatalogError('invalidScope', 'Catalog query scope must contain exactly one discriminator');
  }
  const field = fields[0];
  if (field === 'recent') {
    if (scope.recent !== true) throw createCatalogError('invalidScope', 'Recent scope must be true');
    return { recent: true };
  }
  if (field === 'trackUids') {
    return { trackUids: validateBoundedStringList(scope.trackUids, 'scope.trackUids', 4096, 512) };
  }
  const value = requireString(scope[field], `scope.${field}`, 512);
  return field === 'folderKey' ? { folderId: value } : { [field]: value };
}

function normalizeEntityType(value, { allowTrack = false } = {}) {
  if (allowTrack && value === 'track') return value;
  if (typeof value !== 'string' || !Object.hasOwn(ENTITY_DEFINITIONS, value)) {
    throw createCatalogError('unsupportedEntityType', 'Catalog entity type is not supported');
  }
  return value;
}

function queryTracks(payload) {
  assertAllowedFields(payload, [
    'query', 'sort', 'direction', 'scope', 'cursor', 'limit', 'catalogVersion', 'contextToken'
  ], 'invalidQuery');
  if (payload.contextToken !== undefined && payload.contextToken !== null) {
    const context = getContext(payload.contextToken);
    if (context.entityType !== 'track') {
      throw createCatalogError('cursorEndpointMismatch', 'Catalog context endpoint does not match');
    }
    assertContextQueryMatches(context, payload);
    validateContextCatalogVersion(context, payload.catalogVersion);
    return readContextPage({
      contextToken: payload.contextToken,
      cursor: payload.cursor ?? null,
      limit: payload.limit
    });
  }
  if (payload.cursor !== undefined && payload.cursor !== null) {
    throw createCatalogError('contextRequired', 'Cursor continuation requires a context token');
  }
  if (payload.catalogVersion !== undefined) validateCatalogVersion(payload.catalogVersion);
  const contextInfo = createContext({
    type: 'track',
    query: payload.query,
    sort: payload.sort,
    direction: payload.direction,
    scope: payload.scope
  });
  try {
    return readContextPage({
      contextToken: contextInfo.contextToken,
      cursor: null,
      limit: payload.limit
    });
  } catch (error) {
    contexts.delete(contextInfo.contextToken);
    throw error;
  }
}

function queryEntities(payload) {
  assertAllowedFields(payload, [
    'type', 'query', 'sort', 'direction', 'scope', 'cursor', 'limit',
    'catalogVersion', 'contextToken'
  ], 'invalidEntityQuery');
  const type = normalizeEntityType(payload.type);
  if (payload.contextToken !== undefined && payload.contextToken !== null) {
    const context = getContext(payload.contextToken);
    if (context.entityType !== type) {
      throw createCatalogError('cursorEndpointMismatch', 'Catalog context entity type does not match');
    }
    assertContextQueryMatches(context, payload);
    validateContextCatalogVersion(context, payload.catalogVersion);
    return readContextPage({
      contextToken: payload.contextToken,
      cursor: payload.cursor ?? null,
      limit: payload.limit
    });
  }
  if (payload.cursor !== undefined && payload.cursor !== null) {
    throw createCatalogError('contextRequired', 'Cursor continuation requires a context token');
  }
  if (payload.catalogVersion !== undefined) validateCatalogVersion(payload.catalogVersion);
  const contextInfo = createContext({
    type,
    query: payload.query,
    sort: payload.sort,
    direction: payload.direction,
    scope: payload.scope
  });
  try {
    return readContextPage({
      contextToken: contextInfo.contextToken,
      cursor: null,
      limit: payload.limit
    });
  } catch (error) {
    contexts.delete(contextInfo.contextToken);
    throw error;
  }
}

function assertContextQueryMatches(context, payload) {
  const query = payload.query === undefined ? context.queryText : String(payload.query);
  const sort = payload.sort === undefined ? context.sort : payload.sort;
  const direction = payload.direction === undefined ? context.direction : payload.direction;
  const scope = payload.scope === undefined ? context.scope : normalizeScope(payload.scope);
  if (
    query !== context.queryText ||
    sort !== context.sort ||
    direction !== context.direction ||
    JSON.stringify(scope) !== JSON.stringify(context.scope)
  ) {
    throw createCatalogError('contextQueryMismatch', 'Catalog query does not match its context');
  }
}

function validateContextCatalogVersion(context, requestedVersion) {
  if (requestedVersion === undefined) return;
  if (!Number.isSafeInteger(requestedVersion) || requestedVersion < 0) {
    throw createCatalogError('invalidCatalogVersion', 'Catalog version is invalid');
  }
  if (requestedVersion !== context.snapshotVersion) {
    throw createCatalogError('STALE_CURSOR', 'Catalog version is stale');
  }
}

function readContextPage(payload) {
  assertAllowedFields(payload, ['contextToken', 'cursor', 'limit'], 'invalidPageRequest');
  const context = getContext(payload.contextToken);
  const limit = normalizeQueryLimit(payload.limit);
  if (context.entityType !== 'track') {
    return withContextDatabase(context, () => readEntityContextPage(context, payload, limit));
  }
  if (context.scope?.playlistId) {
    return withContextDatabase(context, () => readPlaylistContextPage(context, payload, limit));
  }
  const order = createOrder(context.sort, context.direction);
  let continuation = 'after';
  let cursorTuple = null;
  if (payload.cursor !== undefined && payload.cursor !== null) {
    const envelope = modules.cursorCodec.decodeCursor(payload.cursor, {
      endpoint: 'tracks',
      queryFingerprint: context.queryFingerprint,
      snapshotVersion: context.snapshotVersion,
      sortSpecId: order.descriptor.id,
      descriptor: order.descriptor
    });
    continuation = envelope.continuation;
    cursorTuple = envelope.tuple;
  }
  return withContextDatabase(context, () => executeContextPage(context, order, { continuation, cursorTuple, limit }));
}

function readContextPageAtOrdinal(payload) {
  assertAllowedFields(payload, ['contextToken', 'ordinal', 'limit'], 'invalidOrdinalRequest');
  const context = getContext(payload.contextToken);
  const limit = normalizeQueryLimit(payload.limit);
  const totalCount = ensureContextCount(context);
  if (!Number.isSafeInteger(payload.ordinal) || payload.ordinal < 0 || payload.ordinal >= totalCount) {
    throw createCatalogError('invalidOrdinal', 'Catalog ordinal is outside the context');
  }
  if (context.entityType !== 'track') {
    return withContextDatabase(context, () => readEntityContextPageAtOrdinal(context, payload.ordinal, limit));
  }
  if (context.scope?.playlistId) {
    const startOrdinal = Math.max(0, Math.min(payload.ordinal, Math.max(0, totalCount - limit)));
    const pagePlan = createOrdinalPagePlan(totalCount, startOrdinal, limit);
    return withContextDatabase(context, () => executePlaylistContextPage(context, {
      continuation: pagePlan.continuation,
      cursorTuple: null,
      limit,
      offset: pagePlan.offset,
      pageStartOrdinal: startOrdinal
    }));
  }
  const order = createOrder(context.sort, context.direction);
  const startOrdinal = Math.max(0, Math.min(payload.ordinal, Math.max(0, totalCount - limit)));
  const pagePlan = createOrdinalPagePlan(totalCount, startOrdinal, limit);
  return withContextDatabase(context, () => executeContextPage(context, order, {
    continuation: pagePlan.continuation,
    cursorTuple: null,
    limit,
    offset: pagePlan.offset,
    pageStartOrdinal: startOrdinal
  }));
}

function createOrdinalPagePlan(totalCount, startOrdinal, limit) {
  const trailingCount = Math.max(0, totalCount - startOrdinal - limit);
  return trailingCount < startOrdinal
    ? { continuation: 'before', offset: trailingCount }
    : { continuation: 'after', offset: startOrdinal };
}

function resolveEntityAnchor(payload) {
  assertAllowedFields(payload, [
    'contextToken', 'entityId', 'entityKind', 'prefix', 'mode', 'anchor', 'fallback',
    'limit', 'queryFingerprint'
  ], 'invalidAnchor');
  const context = getContext(payload.contextToken);
  if (payload.anchor !== undefined && payload.anchor !== null && !isPlainObject(payload.anchor)) {
    throw createCatalogError('invalidAnchor', 'Anchor must be an object');
  }
  const mode = optionalString(payload.mode, 'exact', 32);
  const fallback = payload.fallback == null ? null : requireString(payload.fallback, 'fallback', 32);
  const requestedMode = fallback ?? (mode === 'entity' ? 'exact' : mode);
  if (!['exact', 'prefix', 'successor', 'predecessor'].includes(requestedMode)) {
    throw createCatalogError('invalidAnchor', 'Anchor mode is invalid');
  }
  const entityIdValue = payload.entityId ?? payload.anchor?.entityId;
  const entityId = entityIdValue == null ? null : requireString(entityIdValue, 'entityId', 512);
  const prefix = payload.prefix == null ? null : modules.searchNormalizer.normalizeSearchText(
    requireStringAllowEmpty(payload.prefix, 'prefix', MAX_QUERY_CHARACTERS)
  );
  const limit = normalizeQueryLimit(payload.limit);
  ensureContextCount(context);
  const resolved = withContextDatabase(context, () => context.entityType === 'track'
    ? resolveTrackContextOrdinal(context, { entityId, prefix, mode: requestedMode })
    : resolveNamedEntityContextOrdinal(context, { entityId, prefix, mode: requestedMode }));
  let ordinal = resolved?.ordinal ?? null;
  if (ordinal === null && Number.isSafeInteger(payload.anchor?.ordinal) && context.totalCount > 0) {
    if (requestedMode === 'successor') ordinal = Math.min(context.totalCount - 1, payload.anchor.ordinal);
    if (requestedMode === 'predecessor') ordinal = Math.max(0, Math.min(context.totalCount - 1, payload.anchor.ordinal - 1));
  }
  if (ordinal === null) {
    return { accepted: false, found: false, reason: 'missing' };
  }
  if (requestedMode === 'successor' && resolved) ordinal = Math.min(context.totalCount - 1, ordinal + 1);
  if (requestedMode === 'predecessor' && resolved) ordinal = Math.max(0, ordinal - 1);
  const pageStartOrdinal = Math.max(0, Math.min(ordinal, Math.max(0, context.totalCount - limit)));
  const page = readContextPageAtOrdinal({ contextToken: context.token, ordinal, limit });
  return {
    accepted: true,
    found: true,
    contextToken: context.token,
    entityKind: context.entityType,
    entityId: resolved?.entityId ?? entityId,
    ordinal,
    pageStartOrdinal,
    page
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
  const row = database.prepare(`
    SELECT ${createTrackPageSelection(order)}
    FROM tracks t
    WHERE ${where.join(' AND ')}
    ORDER BY ${createOrderBySql(order, false)}
    LIMIT 1
  `).get(...bindings);
  if (!row) return null;
  const normalized = normalizePageRow(row);
  const keyset = createKeysetSql(order, order.descriptor.buildTuple(normalized), 'before');
  const count = database.prepare(`
    SELECT count(*) AS count FROM tracks t
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
  `).get(...base.bindings, ...keyset.bindings);
  return { ordinal: Number(count.count), entityId: normalized.trackUid };
}

function resolvePlaylistContextOrdinal(context, entityId) {
  if (entityId === null) return null;
  const order = createPlaylistOrder();
  const base = createPlaylistContextFilter(context);
  const row = database.prepare(`
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
  const count = database.prepare(`
    SELECT count(*) AS count
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN tracks t ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
  `).get(...base.bindings, ...keyset.bindings);
  return { ordinal: Number(count.count), entityId: normalized.playlistItemKey };
}

function resolveNamedEntityContextOrdinal(context, { entityId, prefix, mode }) {
  const definition = ENTITY_DEFINITIONS[context.entityType];
  const order = createEntityOrder(context, definition);
  const base = createEntityContextFilter(context, definition);
  const where = [...base.clauses];
  const bindings = [...base.bindings];
  if (mode === 'prefix') {
    if (prefix === null) return null;
    const prefixKey = modules.orderContract.encodeCanonicalSortKey(prefix);
    where.push('substr(hex(e.sort_name), 1, length(?)) = ?');
    bindings.push(prefixKey, prefixKey);
  } else {
    if (entityId === null) return null;
    where.push(`e.${definition.stableIdColumn} = ?`);
    bindings.push(entityId);
  }
  const row = database.prepare(`
    SELECT ${createEntityPageSelection(definition, order)}
    FROM ${definition.table} e
    WHERE ${where.join(' AND ')}
    ORDER BY ${createEntityOrderBySql(definition, order, false)}
    LIMIT 1
  `).get(...bindings);
  if (!row) return null;
  const normalized = { ...row, entityKind: context.entityType };
  const keyset = createEntityKeysetSql(definition, order, order.descriptor.buildTuple(normalized), 'before');
  const count = database.prepare(`
    SELECT count(*) AS count FROM ${definition.table} e
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
  `).get(...base.bindings, ...keyset.bindings);
  return { ordinal: Number(count.count), entityId: normalized[definition.stableIdField] };
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
  const rows = database.prepare(`
    SELECT ${createTrackPageSelection(order)}
    FROM tracks t
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
  modules.queryContract.validatePageResponse(response, { limit });
  return response;
}

function readPlaylistContextPage(context, payload, limit) {
  const order = createPlaylistOrder();
  let continuation = 'after';
  let cursorTuple = null;
  if (payload.cursor !== undefined && payload.cursor !== null) {
    const envelope = modules.cursorCodec.decodeCursor(payload.cursor, {
      endpoint: 'tracks',
      queryFingerprint: context.queryFingerprint,
      snapshotVersion: context.snapshotVersion,
      sortSpecId: order.descriptor.id,
      descriptor: order.descriptor
    });
    continuation = envelope.continuation;
    cursorTuple = envelope.tuple;
  }
  return executePlaylistContextPage(context, { continuation, cursorTuple, limit });
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
  const rows = database.prepare(`
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
  modules.queryContract.validatePageResponse(response, { limit });
  return response;
}

function createPlaylistOrder() {
  const descriptor = modules.canonicalOrder.createCanonicalOrderDescriptor({
    id: `tracks.playlist-position.asc.${modules.orderContract.MUSIC_LIBRARY_ORDER_VERSION}`,
    endpoint: 'tracks',
    fields: [{ field: 'playlistPosition', type: 'number', nulls: 'last', direction: 'asc' }],
    stableIdField: 'playlistItemKey',
    entityKind: 'track',
    stableIdDirection: 'asc'
  });
  return { fields: [{ field: 'playlistPosition', type: 'number', nulls: 'last', direction: 'asc' }], descriptor };
}

function createPlaylistContextFilter(context) {
  const trackFilter = createContextFilter(context);
  return {
    clauses: [
      'i.playlist_id = ?',
      "(i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))",
      ...trackFilter.clauses
    ],
    bindings: [context.scope.playlistId, ...trackFilter.bindings]
  };
}

function createPlaylistKeysetSql(order, tuple, continuation) {
  order.descriptor.validateTuple(tuple);
  const position = tuple[0].value;
  const itemKey = tuple.at(-2).value;
  const operator = continuation === 'after' ? '>' : '<';
  return {
    sql: `(i.position ${operator} ? OR (i.position = ? AND CAST(i.item_key AS TEXT) ${operator} ?))`,
    bindings: [position, position, itemKey]
  };
}

function playlistContextHasRows(context, tuple, continuation) {
  const base = createPlaylistContextFilter(context);
  const keyset = createPlaylistKeysetSql(createPlaylistOrder(), tuple, continuation);
  return Boolean(database.prepare(`
    SELECT 1 AS found
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN tracks t ON t.track_uid = i.track_uid
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
    LIMIT 1
  `).get(...base.bindings, ...keyset.bindings));
}

function createPlaylistTrackPageSelection() {
  return [
    `CASE WHEN ${ACTIVE_PLAYLIST_TRACK_CLAUSE} THEN i.track_uid ELSE NULL END AS trackUid`,
    `CASE WHEN ${ACTIVE_PLAYLIST_TRACK_CLAUSE} THEN t.folder_id ELSE NULL END AS folderId`,
    `CASE WHEN ${ACTIVE_PLAYLIST_TRACK_CLAUSE} THEN t.album_key ELSE NULL END AS albumKey`,
    `CASE WHEN ${ACTIVE_PLAYLIST_TRACK_CLAUSE} THEN t.artist_key ELSE NULL END AS artistKey`,
    `CASE WHEN ${ACTIVE_PLAYLIST_TRACK_CLAUSE} THEN t.genre_key ELSE NULL END AS genreKey`,
    `CASE WHEN ${ACTIVE_PLAYLIST_TRACK_CLAUSE} THEN t.subfolder_key ELSE NULL END AS subfolderKey`,
    `COALESCE(t.title, NULLIF(json_extract(i.unresolved_json, '$.title'), ''),
      NULLIF(json_extract(i.unresolved_json, '$.basename'), ''), NULLIF(i.unresolved_title, ''),
      NULLIF(json_extract(i.unresolved_json, '$.relativePathHint'), ''),
      NULLIF(json_extract(i.unresolved_json, '$.relativePath'), ''), NULLIF(i.unresolved_basename, ''), '') AS title`,
    "COALESCE(t.artist, NULLIF(i.unresolved_artist, ''), NULLIF(json_extract(i.unresolved_json, '$.artist'), ''), '') AS artist",
    "COALESCE(t.album_artist, NULLIF(i.unresolved_artist, ''), '') AS albumArtist",
    "COALESCE(t.album, json_extract(i.unresolved_json, '$.album'), '') AS album",
    "COALESCE(t.genre, '') AS genre",
    't.year',
    't.disc_no AS discNo',
    't.track_no AS trackNo',
    "COALESCE(t.duration_sec, json_extract(i.unresolved_json, '$.durationSec')) AS durationSec",
    't.added_at AS addedAt',
    `CASE WHEN ${ACTIVE_PLAYLIST_TRACK_CLAUSE} THEN COALESCE(t.metadata_status, 'unresolved') ELSE 'unresolved' END AS metadataStatus`,
    `CASE WHEN ${ACTIVE_PLAYLIST_TRACK_CLAUSE} THEN t.artwork_id ELSE NULL END AS artworkId`,
    'i.item_key AS itemKey',
    'CAST(i.item_key AS TEXT) AS playlistItemKey',
    'i.position AS playlistPosition',
    'p.version AS playlistVersion'
  ].join(', ');
}

function readEntityContextPage(context, payload, limit) {
  const definition = ENTITY_DEFINITIONS[context.entityType];
  const order = createEntityOrder(context, definition);
  let continuation = 'after';
  let cursorTuple = null;
  if (payload.cursor !== undefined && payload.cursor !== null) {
    const envelope = modules.cursorCodec.decodeCursor(payload.cursor, {
      endpoint: context.endpoint,
      queryFingerprint: context.queryFingerprint,
      snapshotVersion: context.snapshotVersion,
      sortSpecId: order.descriptor.id,
      descriptor: order.descriptor
    });
    continuation = envelope.continuation;
    cursorTuple = envelope.tuple;
  }
  return executeEntityContextPage(context, definition, order, {
    continuation,
    cursorTuple,
    limit
  });
}

function readEntityContextPageAtOrdinal(context, ordinal, limit) {
  const definition = ENTITY_DEFINITIONS[context.entityType];
  const order = createEntityOrder(context, definition);
  const startOrdinal = Math.max(0, Math.min(ordinal, Math.max(0, context.totalCount - limit)));
  const pagePlan = createOrdinalPagePlan(context.totalCount, startOrdinal, limit);
  return executeEntityContextPage(context, definition, order, {
    continuation: pagePlan.continuation,
    cursorTuple: null,
    limit,
    offset: pagePlan.offset,
    pageStartOrdinal: startOrdinal
  });
}

function executeEntityContextPage(
  context,
  definition,
  order,
  { continuation, cursorTuple, limit, offset = null, pageStartOrdinal = null }
) {
  const base = createEntityContextFilter(context, definition);
  const keyset = cursorTuple
    ? createEntityKeysetSql(definition, order, cursorTuple, continuation)
    : { sql: '', bindings: [] };
  const where = [...base.clauses];
  if (keyset.sql) where.push(keyset.sql);
  const reverse = continuation === 'before';
  const offsetSql = offset === null ? '' : ' OFFSET ?';
  const bindings = [...base.bindings, ...keyset.bindings, limit + 1];
  if (offset !== null) bindings.push(offset);
  const rows = database.prepare(`
    SELECT ${createEntityPageSelection(definition, order)}
    FROM ${definition.table} e
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${createEntityOrderBySql(definition, order, reverse)}
    LIMIT ?${offsetSql}
  `).all(...bindings).map(row => ({ ...row, entityKind: context.entityType }));
  const hasExtra = rows.length > limit;
  if (hasExtra) rows.pop();
  if (reverse) rows.reverse();

  let hasBefore = false;
  let hasAfter = false;
  if (rows.length > 0) {
    hasBefore = offset !== null
      ? pageStartOrdinal > 0
      : entityContextHasRows(
        context,
        definition,
        order,
        order.descriptor.buildTuple(rows[0]),
        'before'
      );
    hasAfter = offset !== null
      ? pageStartOrdinal + rows.length < context.totalCount
      : entityContextHasRows(
        context,
        definition,
        order,
        order.descriptor.buildTuple(rows.at(-1)),
        'after'
      );
  }
  if (continuation === 'after' && hasExtra) hasAfter = true;
  if (continuation === 'before' && hasExtra) hasBefore = true;

  const response = {
    rows: rows.map(stripEntityOrderFields),
    nextCursor: hasAfter
      ? encodeEntityBoundaryCursor(context, order, rows.at(-1), 'after')
      : null,
    previousCursor: hasBefore
      ? encodeEntityBoundaryCursor(context, order, rows[0], 'before')
      : null,
    totalCount: Number.isSafeInteger(context.totalCount) ? context.totalCount : { pending: true },
    catalogVersion: context.snapshotVersion,
    contextToken: context.token
  };
  modules.queryContract.validatePageResponse(response, { limit });
  return response;
}

function createEntityOrder(context, definition) {
  const fieldSpecs = context.sort === 'name'
    ? modules.orderContract.ENTITY_NAME_ORDER_SPECS[context.entityType]
    : definition.sorts[context.sort];
  const fields = fieldSpecs.map(field => ({
    ...field,
    column: field.column ?? entityOrderColumn(field.field),
    direction: context.direction
  }));
  const descriptor = modules.canonicalOrder.createCanonicalOrderDescriptor({
    id: `entities.${context.entityType}.${context.sort}.${context.direction}.${modules.orderContract.MUSIC_LIBRARY_ORDER_VERSION}`,
    endpoint: context.endpoint,
    fields: fields.map(({ field, type, nulls, direction }) => ({
      field,
      type,
      nulls,
      direction
    })),
    stableIdField: definition.stableIdField,
    entityKind: context.entityType,
    stableIdDirection: context.direction
  });
  return { fields, descriptor, stableIdDirection: context.direction };
}

function entityOrderColumn(field) {
  if (field === 'sortName') return 'sort_name';
  if (field === 'sortArtist') return 'sort_artist';
  throw createCatalogError('invalidSort', 'Catalog entity sort field is not supported');
}

function createEntityContextFilter(context, definition) {
  const clauses = [...(definition.fixedClauses || [])];
  const bindings = [];
  if (context.scope) {
    clauses.push('e.folder_id = ?');
    bindings.push(context.scope.folderId);
  }
  if (context.tokens.length > 0) {
    const searchExpression = definition.searchColumns
      .map(column => column.startsWith('sort_')
        ? `CAST(e.${column} AS TEXT)`
        : `lower(e.${column})`)
      .join(" || '\n' || ");
    for (const token of context.tokens) {
      clauses.push(`instr(${searchExpression}, ?) > 0`);
      bindings.push(token);
    }
  }
  return { clauses, bindings };
}

function countEntityContextRows(context) {
  const definition = ENTITY_DEFINITIONS[context.entityType];
  const filter = createEntityContextFilter(context, definition);
  const row = database.prepare(`
    SELECT count(*) AS count FROM ${definition.table} e
    ${filter.clauses.length ? `WHERE ${filter.clauses.join(' AND ')}` : ''}
  `).get(...filter.bindings);
  return Number(row.count);
}

function createEntityPageSelection(definition, order) {
  const publicAliases = new Set(definition.publicSelection.map(selection => {
    const match = selection.match(/\sAS\s(\w+)$/i);
    return match ? match[1] : selection.split('.').at(-1);
  }));
  const orderFields = order.fields
    .filter(field => !publicAliases.has(field.field))
    .map(field => {
      const expression = entityFieldExpression(field);
      return `${field.type === 'bytes' ? `hex(${expression})` : expression} AS ${field.field}`;
    });
  return [...definition.publicSelection, ...orderFields].join(', ');
}

function createEntityOrderBySql(definition, order, reverse) {
  const terms = [];
  for (const field of order.fields) {
    terms.push(`${createEntityNullRankExpression(field)} ${reverse ? 'DESC' : 'ASC'}`);
    terms.push(`${entityFieldExpression(field)} ${reverseDirectionIf(field.direction, reverse).toUpperCase()}`);
  }
  terms.push(
    `e.${definition.stableIdColumn} ${reverseDirectionIf(order.stableIdDirection, reverse).toUpperCase()}`
  );
  return terms.join(', ');
}

function createEntityKeysetSql(definition, order, tuple, continuation) {
  order.descriptor.validateTuple(tuple);
  const components = [];
  order.fields.forEach((field, index) => {
    const cursor = tuple[index];
    components.push({
      expression: createEntityNullRankExpression(field),
      value: cursor.nullRank,
      direction: 'asc'
    });
    if (cursor.value !== null) {
      components.push({
        expression: entityFieldExpression(field),
        value: field.type === 'bytes' ? Buffer.from(cursor.value, 'hex') : cursor.value,
        direction: field.direction
      });
    }
  });
  components.push({
    expression: `e.${definition.stableIdColumn}`,
    value: tuple.at(-2).value,
    direction: order.stableIdDirection
  });
  return createLexicographicPredicate(components, continuation);
}

function createLexicographicPredicate(components, continuation) {
  const branches = [];
  const bindings = [];
  components.forEach((component, index) => {
    const comparisons = [];
    for (let previous = 0; previous < index; previous += 1) {
      comparisons.push(`${components[previous].expression} = ?`);
      bindings.push(components[previous].value);
    }
    const greater = continuation === 'after';
    const operator = greater === (component.direction === 'asc') ? '>' : '<';
    comparisons.push(`${component.expression} ${operator} ?`);
    bindings.push(component.value);
    branches.push(`(${comparisons.join(' AND ')})`);
  });
  return { sql: `(${branches.join(' OR ')})`, bindings };
}

function createEntityNullRankExpression(field) {
  const expression = entityFieldExpression(field);
  return field.nulls === 'last'
    ? `(${expression} IS NULL)`
    : `(${expression} IS NOT NULL)`;
}

function entityFieldExpression(field) {
  if (field.expression) return field.expression;
  return field.type === 'text' && field.field.startsWith('sort')
    ? `CAST(e.${field.column} AS TEXT)`
    : `e.${field.column}`;
}

function entityContextHasRows(context, definition, order, tuple, continuation) {
  const base = createEntityContextFilter(context, definition);
  const keyset = createEntityKeysetSql(definition, order, tuple, continuation);
  return Boolean(database.prepare(`
    SELECT 1 AS found FROM ${definition.table} e
    WHERE ${[...base.clauses, keyset.sql].join(' AND ')}
    LIMIT 1
  `).get(...base.bindings, ...keyset.bindings));
}

function stripEntityOrderFields(row) {
  const clean = { ...row };
  delete clean.entityKind;
  delete clean.sortName;
  delete clean.sortArtist;
  delete clean.folderSortKey;
  delete clean.subfolderSortPath;
  return clean;
}

function encodeEntityBoundaryCursor(context, order, row, continuation) {
  return modules.cursorCodec.encodeCursor({
    queryFingerprint: context.queryFingerprint,
    snapshotVersion: context.snapshotVersion,
    sortSpecId: order.descriptor.id,
    continuation,
    tuple: order.descriptor.buildTuple(row)
  }, order.descriptor);
}

function contextHasRows(context, order, tuple, continuation) {
  const base = createContextFilter(context);
  const keyset = createKeysetSql(order, tuple, continuation);
  const where = [...base.clauses, keyset.sql];
  return Boolean(database.prepare(`
    SELECT 1 AS found FROM tracks t
    WHERE ${where.join(' AND ')}
    LIMIT 1
  `).get(...base.bindings, ...keyset.bindings));
}

function countContextRows(context) {
  if (context.entityType !== 'track') return countEntityContextRows(context);
  if (context.scope?.playlistId) return countPlaylistContextRows(context);
  const base = createContextFilter(context);
  const row = database.prepare(`
    SELECT count(*) AS count FROM tracks t
    ${base.clauses.length ? `WHERE ${base.clauses.join(' AND ')}` : ''}
  `).get(...base.bindings);
  return Number(row.count);
}

function countPlaylistContextRows(context) {
  const filter = createPlaylistContextFilter(context);
  const row = database.prepare(`
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
  if (context.scope) {
    if (context.scope.folderId) {
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
      clauses.push('t.artist_key = ?');
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
  return { clauses, bindings };
}

function ensureRecentTrackUids(context) {
  if (!Array.isArray(context.recentTrackUids)) {
    context.recentTrackUids = database.prepare(`
      SELECT t.track_uid AS trackUid
      FROM tracks t
      JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
      ORDER BY t.added_at DESC, t.track_uid DESC
      LIMIT ?
    `).all(RECENT_TRACK_LIMIT).map(row => row.trackUid);
  }
  return context.recentTrackUids;
}

function createTrigramFtsQuery(tokens) {
  const trigrams = new Set();
  for (const token of tokens) {
    const characters = Array.from(token);
    for (let index = 0; index <= characters.length - 3; index += 1) {
      trigrams.add(characters.slice(index, index + 3).join(''));
    }
  }
  return [...trigrams].map(quoteFtsLiteral).join(' AND ');
}

function quoteFtsLiteral(token) {
  return `"${token.replaceAll('"', '""')}"`;
}

function createOrder(sort, direction) {
  const fields = modules.orderContract.TRACK_ORDER_SPECS[sort].map(field => ({
    ...field,
    column: trackOrderColumn(field.field),
    direction
  }));
  const descriptor = modules.canonicalOrder.createCanonicalOrderDescriptor({
    id: `tracks.${sort}.${direction}.${modules.orderContract.MUSIC_LIBRARY_ORDER_VERSION}`,
    endpoint: 'tracks',
    fields: fields.map(({ field, type, nulls }) => ({ field, type, nulls, direction })),
    stableIdField: 'trackUid',
    entityKind: 'track',
    stableIdDirection: direction
  });
  return { fields, descriptor, stableIdDirection: direction };
}

function trackOrderColumn(field) {
  const columns = {
    sortTitle: 'sort_title',
    sortAlbumArtist: 'sort_album_artist',
    sortAlbum: 'sort_album',
    sortGenre: 'sort_genre',
    addedAt: 'added_at'
  };
  if (Object.hasOwn(columns, field)) return columns[field];
  if (field === 'discSort') return `COALESCE(t.disc_no, ${modules.orderContract.MISSING_TRACK_NUMBER_SORT})`;
  if (field === 'trackSort') return `COALESCE(t.track_no, ${modules.orderContract.MISSING_TRACK_NUMBER_SORT})`;
  if (field === 'durationSort') return 'COALESCE(t.duration_sec, 1.7976931348623157e+308)';
  throw createCatalogError('invalidSort', 'Catalog track sort field is not supported');
}

function trackFieldExpression(field) {
  return field.column.startsWith('COALESCE(') ? field.column : `t.${field.column}`;
}

function createOrderBySql(order, reverse) {
  const terms = [];
  for (const field of order.fields) {
    terms.push(`${trackFieldExpression(field)} ${reverseDirectionIf(field.direction, reverse).toUpperCase()}`);
  }
  terms.push(`t.track_uid ${reverseDirectionIf(order.stableIdDirection, reverse).toUpperCase()}`);
  return terms.join(', ');
}

function createKeysetSql(order, tuple, continuation) {
  order.descriptor.validateTuple(tuple);
  const components = [];
  order.fields.forEach((field, index) => {
    const cursor = tuple[index];
    if (cursor.value !== null) {
      components.push({
        expression: trackFieldExpression(field),
        value: field.type === 'bytes' ? Buffer.from(cursor.value, 'hex') : cursor.value,
        direction: field.direction
      });
    }
  });
  components.push({
    expression: 't.track_uid',
    value: tuple.at(-2).value,
    direction: order.stableIdDirection
  });
  const branches = [];
  const bindings = [];
  components.forEach((component, index) => {
    const comparisons = [];
    for (let previous = 0; previous < index; previous += 1) {
      comparisons.push(`${components[previous].expression} = ?`);
      bindings.push(components[previous].value);
    }
    const greater = continuation === 'after';
    const operator = greater === (component.direction === 'asc') ? '>' : '<';
    comparisons.push(`${component.expression} ${operator} ?`);
    bindings.push(component.value);
    branches.push(`(${comparisons.join(' AND ')})`);
  });
  return { sql: `(${branches.join(' OR ')})`, bindings };
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
  return {
    ...row,
    startFrame: row.startFrame == null ? null : Number(row.startFrame),
    endFrame: row.endFrame == null ? null : Number(row.endFrame),
    entityKind: 'track'
  };
}

function stripOrderFields(row) {
  const clean = { ...row };
  delete clean.entityKind;
  for (const field of [
    'sortTitle', 'sortAlbumArtist', 'sortAlbum', 'sortGenre', 'discSort', 'trackSort', 'durationSort'
  ]) delete clean[field];
  return clean;
}

function encodeBoundaryCursor(context, order, row, continuation) {
  return modules.cursorCodec.encodeCursor({
    queryFingerprint: context.queryFingerprint,
    snapshotVersion: context.snapshotVersion,
    sortSpecId: order.descriptor.id,
    continuation,
    tuple: order.descriptor.buildTuple(row)
  }, order.descriptor);
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
  if (context.expiresAt <= now || readWalBytes() - context.walStartBytes > contextWalCapBytes) {
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
    if ((context.expiresAt <= now || readWalBytes() - context.walStartBytes > contextWalCapBytes) &&
        (context.ownerCount ?? 0) === 0) {
      closeContext(context);
      contexts.delete(token);
    }
  }
}

function ensureContextCount(context) {
  if (!Number.isSafeInteger(context.totalCount)) {
    context.totalCount = withContextDatabase(context, () => countContextRows(context));
  }
  return context.totalCount;
}

function ensurePlaylistContextCounts(context) {
  if (![context.totalCount, context.resolvedCount, context.unresolvedCount].every(Number.isSafeInteger)) {
    withContextDatabase(context, () => countPlaylistContextRows(context));
  }
  return {
    totalCount: context.totalCount,
    resolvedCount: context.resolvedCount,
    unresolvedCount: context.unresolvedCount
  };
}

function withContextDatabase(context, callback) {
  const authorityDatabase = database;
  database = context.database;
  try {
    return callback();
  } finally {
    database = authorityDatabase;
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
    return fs.statSync(`${databasePath}-wal`).size;
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

  const known = database.prepare(`
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
    const stats = fs.statfsSync(path.dirname(workerData.dbPath));
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
    const existing = database.prepare(`
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
    const active = heavy === 0 ? null : database.prepare(`
      SELECT operation_id FROM operation_jobs
      WHERE heavy = 1 AND terminal_kind IS NULL
      LIMIT 1
    `).get();
    if (active) return { kind: 'busy', activeOperationId: active.operation_id };

    const operationId = randomUUID();
    database.prepare(`
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
    const sourceSequence = database.prepare(`
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

function getOperationStatus(payload) {
  assertExactFields(payload, ['operationId'], 'invalidOperationRequest');
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const row = database.prepare(`
    SELECT
      operation_id AS operationId,
      client_request_id AS clientRequestId,
      operation_kind AS operationKind,
      target_identity AS targetIdentity,
      expected_target_version AS expectedTargetVersion,
      phase,
      committed,
      processed_count AS processed,
      total_count AS total,
      created_at AS createdAt,
      updated_at AS updatedAt,
      finished_at AS finishedAt,
      terminal_kind AS terminalKind,
      terminal_code AS terminalCode,
      terminal_result_json AS terminalResultJson
    FROM operation_jobs WHERE operation_id = ?
  `).get(operationId);
  if (!row) return null;
  const progress = database.prepare(`
    SELECT sequence, phase, processed, total, state, updated_at AS updatedAt
    FROM operation_progress WHERE operation_id = ?
  `).get(operationId) || null;
  const result = row.terminalKind === null ? null : parseStoredJson(row.terminalResultJson);
  delete row.terminalResultJson;
  return {
    ...row,
    committed: Boolean(row.committed),
    progress,
    result
  };
}

function requestOperationCancel(payload) {
  assertExactFields(payload, ['operationId', 'requestedAt'], 'invalidOperationRequest');
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const requestedAt = requireNonNegativeInteger(payload.requestedAt, 'requestedAt');
  return runDurableTransaction(() => {
    const row = database.prepare(`
      SELECT phase, terminal_kind, build_deadline_at AS buildDeadlineAt FROM operation_jobs WHERE operation_id = ?
    `).get(operationId);
    if (!row || row.terminal_kind !== null || ['COMMITTING', ...TERMINAL_OPERATION_PHASES].includes(row.phase)) {
      return { kind: 'tooLate' };
    }
    if (row.phase === 'CANCEL_REQUESTED') return { kind: 'cancelRequested', operationId };
    if (!['RECEIVED', 'SNAPSHOTTING', 'READY'].includes(row.phase)) return { kind: 'tooLate' };
    database.prepare(`
      UPDATE operation_jobs SET phase = 'CANCEL_REQUESTED', updated_at = ?
      WHERE operation_id = ? AND terminal_kind IS NULL
    `).run(requestedAt, operationId);
    return { kind: 'cancelRequested', operationId };
  });
}

function transitionOperation(payload) {
  assertExactFields(payload, ['operationId', 'phase', 'updatedAt'], 'invalidOperationRequest');
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const phase = requireString(payload.phase, 'phase', 32);
  const updatedAt = requireNonNegativeInteger(payload.updatedAt, 'updatedAt');
  const previousByPhase = {
    SNAPSHOTTING: 'RECEIVED',
    READY: 'SNAPSHOTTING',
    COMMITTING: 'READY'
  };
  const previous = previousByPhase[phase];
  if (!previous) throw createCatalogError('invalidOperationTransition', 'Operation phase transition is invalid');
  return runDurableTransaction(() => {
    const row = database.prepare(`
      SELECT phase, terminal_kind FROM operation_jobs WHERE operation_id = ?
    `).get(operationId);
    if (!row) throw createCatalogError('operationNotFound', 'Operation does not exist');
    assertOperationBuildDeadline(row, updatedAt);
    if (row.phase === phase && row.terminal_kind === null) return { kind: 'transitioned', operationId, phase };
    if (row.terminal_kind !== null || row.phase !== previous) {
      throw createCatalogError('invalidOperationTransition', 'Operation phase transition is invalid');
    }
    database.prepare(`
      UPDATE operation_jobs SET phase = ?, updated_at = ? WHERE operation_id = ?
    `).run(phase, updatedAt, operationId);
    return { kind: 'transitioned', operationId, phase };
  });
}

function recordOperationProgress(payload) {
  assertExactFields(payload, ['operationId', 'progress'], 'invalidOperationProgress');
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const progress = payload.progress;
  assertExactFields(progress, [
    'operationId', 'sequence', 'phase', 'processed', 'total', 'state', 'updatedAt'
  ], 'invalidOperationProgress');
  if (progress.operationId !== operationId) {
    throw createCatalogError('invalidOperationProgress', 'Progress operation ID does not match');
  }
  const sequence = requireNonNegativeInteger(progress.sequence, 'sequence');
  const phase = requireString(progress.phase, 'phase', 64);
  const processed = requireNonNegativeInteger(progress.processed, 'processed');
  const total = optionalNullableNonNegativeInteger(progress.total, 'total');
  const state = requireString(progress.state, 'state', 64);
  const updatedAt = requireNonNegativeInteger(progress.updatedAt, 'updatedAt');
  if (total !== null && processed > total) {
    throw createCatalogError('invalidOperationProgress', 'Progress exceeds its total');
  }
  return runDurableTransaction(() => {
    const operation = database.prepare(`
      SELECT terminal_kind, build_deadline_at AS buildDeadlineAt FROM operation_jobs WHERE operation_id = ?
    `).get(operationId);
    if (!operation) throw createCatalogError('operationNotFound', 'Operation does not exist');
    if (operation.terminal_kind !== null) return { kind: 'terminal' };
    assertOperationBuildDeadline(operation, updatedAt);
    const current = database.prepare(`
      SELECT sequence FROM operation_progress WHERE operation_id = ?
    `).get(operationId);
    if (current && Number(current.sequence) >= sequence) {
      return { kind: 'ignored', sequence: Number(current.sequence) };
    }
    database.prepare(`
      INSERT INTO operation_progress(operation_id, sequence, phase, processed, total, state, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(operation_id) DO UPDATE SET
        sequence = excluded.sequence,
        phase = excluded.phase,
        processed = excluded.processed,
        total = excluded.total,
        state = excluded.state,
        updated_at = excluded.updated_at
    `).run(operationId, sequence, phase, processed, total, state, updatedAt);
    database.prepare(`
      UPDATE operation_jobs
      SET processed_count = ?, total_count = ?, updated_at = ?
      WHERE operation_id = ?
    `).run(processed, total, updatedAt, operationId);
    return { kind: 'recorded', sequence };
  });
}

function completeOperation(payload) {
  assertExactFields(payload, ['operationId', 'result'], 'invalidOperationResult');
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const result = validateOperationResult(payload.result);
  return runDurableTransaction(() => completeOperationInTransaction(operationId, result));
}

function completeOperationInTransaction(operationId, result, { committed = false } = {}) {
  const row = database.prepare(`
    SELECT terminal_kind, terminal_result_json, source_context_token AS sourceContextToken,
      context_released AS contextReleased
    FROM operation_jobs WHERE operation_id = ?
  `).get(operationId);
  if (!row) throw createCatalogError('operationNotFound', 'Operation does not exist');
  if (row.terminal_kind !== null) {
    releaseOperationSnapshots(operationId);
    releaseOperationContext(operationId, row);
    return { kind: 'terminal', result: parseStoredJson(row.terminal_result_json) };
  }
  const terminal = {
    succeeded: { phase: 'SUCCEEDED', kind: 'success', code: null },
    failed: { phase: 'FAILED', kind: 'failed', code: result.code },
    cancelled: { phase: 'CANCELLED', kind: 'cancelled', code: result.code },
    interrupted: { phase: 'INTERRUPTED', kind: 'interrupted', code: result.code }
  }[result.state];
  database.prepare(`
    UPDATE operation_jobs
    SET phase = ?, committed = ?, terminal_kind = ?, terminal_code = ?,
        terminal_result_json = ?, updated_at = ?, finished_at = ?
    WHERE operation_id = ? AND terminal_kind IS NULL
  `).run(
    terminal.phase,
    committed ? 1 : 0,
    terminal.kind,
    terminal.code,
    JSON.stringify(result),
    result.finishedAt,
    result.finishedAt,
    operationId
  );
  if (result.state !== 'succeeded') {
    database.prepare(`
      UPDATE playlists
      SET state = CASE WHEN state = 'building' THEN 'deleted' ELSE state END,
        building_operation_id = NULL
      WHERE building_operation_id = ?
    `).run(operationId);
  }
  releaseOperationSnapshots(operationId);
  releaseOperationContext(operationId, row);
  return { kind: 'terminal', result };
}

function releaseOperationSnapshots(operationId) {
  const owned = database.prepare(`
    SELECT snapshot_id AS snapshotId, ref_count AS refCount
    FROM snapshot_object_owners
    WHERE owner_kind = 'operation' AND owner_id = ?
  `).all(operationId);
  const decrement = database.prepare(`
    UPDATE snapshot_objects
    SET owner_ref_count = owner_ref_count - ?
    WHERE snapshot_id = ? AND owner_ref_count >= ?
  `);
  const removeOwner = database.prepare(`
    DELETE FROM snapshot_object_owners
    WHERE snapshot_id = ? AND owner_kind = 'operation' AND owner_id = ?
  `);
  const markCollectable = database.prepare(`
    UPDATE snapshot_objects SET state = 'gc-pending'
    WHERE snapshot_id = ? AND owner_ref_count = 0
  `);
  for (const owner of owned) {
    const changed = decrement.run(owner.refCount, owner.snapshotId, owner.refCount);
    if (Number(changed.changes) !== 1) {
      throw createCatalogError('snapshotRefCountUnderflow', 'Snapshot owner reference count is invalid');
    }
    removeOwner.run(owner.snapshotId, operationId);
    markCollectable.run(owner.snapshotId);
  }
  database.prepare(`
    UPDATE snapshot_objects
    SET state = 'gc-pending', staging_operation_id = NULL
    WHERE staging_operation_id = ?
  `).run(operationId);
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
  database.prepare('UPDATE operation_jobs SET context_released = 1 WHERE operation_id = ?').run(operationId);
}

function assertOperationBuildDeadline(operation, now) {
  if (operation.buildDeadlineAt != null && now > Number(operation.buildDeadlineAt)) {
    throw createCatalogError('operationDeadlineExceeded', 'Operation build deadline expired');
  }
}

function validateOperationResult(value) {
  if (!isPlainObject(value)) throw createCatalogError('invalidOperationResult', 'Operation result must be an object');
  const state = requireString(value.state, 'state', 32);
  if (state === 'succeeded') {
    assertExactFields(value, ['state', 'result', 'finishedAt'], 'invalidOperationResult');
    measureBytes(value.result, 'invalidOperationResult');
  } else if (['failed', 'cancelled', 'interrupted'].includes(state)) {
    assertExactFields(value, ['state', 'code', 'finishedAt'], 'invalidOperationResult');
    requireString(value.code, 'code', 128);
  } else {
    throw createCatalogError('invalidOperationResult', 'Operation result state is invalid');
  }
  requireNonNegativeInteger(value.finishedAt, 'finishedAt');
  return value;
}

function gcTerminalOperations(payload) {
  assertExactFields(payload, ['finishedBefore', 'limit'], 'invalidOperationGcRequest');
  const finishedBefore = requireNonNegativeInteger(payload.finishedBefore, 'finishedBefore');
  const limit = normalizeWriteLimit(payload.limit);
  return runDurableTransaction(() => {
    const candidates = database.prepare(`
      SELECT o.operation_id AS operationId
      FROM operation_jobs o
      WHERE o.terminal_kind IS NOT NULL
        AND o.finished_at < ?
        AND NOT EXISTS (SELECT 1 FROM playlist_items i WHERE i.pending_operation_id = o.operation_id)
        AND NOT EXISTS (SELECT 1 FROM sequence_save_pages p WHERE p.operation_id = o.operation_id)
        AND NOT EXISTS (SELECT 1 FROM playlists p WHERE p.building_operation_id = o.operation_id)
        AND NOT EXISTS (SELECT 1 FROM snapshot_objects s WHERE s.staging_operation_id = o.operation_id)
        AND NOT EXISTS (
          SELECT 1 FROM snapshot_object_owners so
          WHERE so.owner_kind = 'operation' AND so.owner_id = o.operation_id
        )
      ORDER BY o.finished_at, o.operation_id
      LIMIT ?
    `).all(finishedBefore, limit);
    const deleteProgress = database.prepare('DELETE FROM operation_progress WHERE operation_id = ?');
    const deleteOperation = database.prepare('DELETE FROM operation_jobs WHERE operation_id = ?');
    let deletedCount = 0;
    for (const candidate of candidates) {
      deleteProgress.run(candidate.operationId);
      deletedCount += Number(deleteOperation.run(candidate.operationId).changes);
    }
    return { deletedCount, hasMore: candidates.length === limit };
  });
}

function createOperationSnapshot(payload) {
  assertAllowedFields(payload, [
    'snapshotId', 'operationId', 'snapshotKind', 'createdAt', 'expiresAt'
  ], 'invalidSnapshotRequest');
  const snapshotId = requireString(payload.snapshotId, 'snapshotId', 512);
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const snapshotKind = requireString(payload.snapshotKind, 'snapshotKind', 128);
  const createdAt = requireNonNegativeInteger(payload.createdAt, 'createdAt');
  const expiresAt = optionalNullableNonNegativeInteger(payload.expiresAt, 'expiresAt');
  return runDurableTransaction(() => {
    assertActiveOperation(operationId);
    database.prepare(`
      INSERT INTO snapshot_objects(
        snapshot_id, snapshot_kind, state, staging_operation_id, owner_ref_count,
        item_count, created_at, expires_at
      ) VALUES (?, ?, 'staging', ?, 0, NULL, ?, ?)
    `).run(snapshotId, snapshotKind, operationId, createdAt, expiresAt);
    return { snapshotId, state: 'staging' };
  });
}

function appendOperationSnapshotItems(payload) {
  assertExactFields(payload, ['snapshotId', 'trackUids'], 'invalidSnapshotRequest');
  const snapshotId = requireString(payload.snapshotId, 'snapshotId', 512);
  const trackUids = validateBatch(payload.trackUids, 'trackUids')
    .map(trackUid => requireString(trackUid, 'trackUid', 512));
  return runDurableTransaction(() => {
    const snapshot = database.prepare(`
      SELECT state, staging_operation_id AS operationId
      FROM snapshot_objects WHERE snapshot_id = ?
    `).get(snapshotId);
    if (!snapshot) throw createCatalogError('snapshotNotFound', 'Snapshot does not exist');
    if (snapshot.state !== 'staging') throw createCatalogError('snapshotSealed', 'Snapshot is already sealed');
    assertActiveOperation(snapshot.operationId);
    const tail = database.prepare(`
      SELECT COALESCE(MAX(ordinal), -1) AS ordinal FROM snapshot_items WHERE snapshot_id = ?
    `).get(snapshotId);
    const insert = database.prepare(`
      INSERT INTO snapshot_items(snapshot_id, ordinal, track_uid) VALUES (?, ?, ?)
    `);
    let ordinal = Number(tail.ordinal) + 1;
    for (const trackUid of trackUids) insert.run(snapshotId, ordinal++, trackUid);
    return { snapshotId, appendedCount: trackUids.length, nextOrdinal: ordinal };
  });
}

function sealOperationSnapshot(payload) {
  assertAllowedFields(payload, [
    'snapshotId', 'itemCount', 'membershipDigest', 'orderDigest', 'ownerKind', 'ownerId'
  ], 'invalidSnapshotRequest');
  const snapshotId = requireString(payload.snapshotId, 'snapshotId', 512);
  const itemCount = requireNonNegativeInteger(payload.itemCount, 'itemCount');
  const membershipDigest = requireString(payload.membershipDigest, 'membershipDigest', 512);
  const orderDigest = requireString(payload.orderDigest, 'orderDigest', 512);
  const ownerKind = payload.ownerKind === undefined ? null : requireString(payload.ownerKind, 'ownerKind', 128);
  const ownerId = payload.ownerId === undefined ? null : requireString(payload.ownerId, 'ownerId', 512);
  if ((ownerKind === null) !== (ownerId === null)) {
    throw createCatalogError('invalidSnapshotRequest', 'Snapshot owner kind and ID must be provided together');
  }
  return runDurableTransaction(() => {
    const snapshot = database.prepare(`
      SELECT state, staging_operation_id AS operationId
      FROM snapshot_objects WHERE snapshot_id = ?
    `).get(snapshotId);
    if (!snapshot) throw createCatalogError('snapshotNotFound', 'Snapshot does not exist');
    if (snapshot.state !== 'staging') throw createCatalogError('snapshotSealed', 'Snapshot is already sealed');
    const count = Number(database.prepare(`
      SELECT count(*) AS count FROM snapshot_items WHERE snapshot_id = ?
    `).get(snapshotId).count);
    if (count !== itemCount) throw createCatalogError('snapshotCountMismatch', 'Snapshot item count does not match');
    if (ownerKind !== null) {
      database.prepare(`
        INSERT INTO snapshot_object_owners(snapshot_id, owner_kind, owner_id, ref_count)
        VALUES (?, ?, ?, 1)
      `).run(snapshotId, ownerKind, ownerId);
    }
    database.prepare(`
      UPDATE snapshot_objects
      SET state = 'sealed', staging_operation_id = NULL, owner_ref_count = ?,
          item_count = ?, membership_digest = ?, order_digest = ?
      WHERE snapshot_id = ?
    `).run(ownerKind === null ? 0 : 1, itemCount, membershipDigest, orderDigest, snapshotId);
    const operation = database.prepare(`
      SELECT source_context_token AS sourceContextToken, context_released AS contextReleased
      FROM operation_jobs WHERE operation_id = ?
    `).get(snapshot.operationId);
    if (operation) releaseOperationContext(snapshot.operationId, operation);
    return { snapshotId, state: 'sealed', itemCount };
  });
}

function queryOperationSnapshot(payload) {
  assertAllowedFields(payload, ['snapshotId', 'ordinal', 'limit'], 'invalidSnapshotRequest');
  const snapshotId = requireString(payload.snapshotId, 'snapshotId', 512);
  const ordinal = optionalNonNegativeInteger(payload.ordinal, 0, 'ordinal');
  const limit = normalizeQueryLimit(payload.limit);
  const snapshot = database.prepare(`
    SELECT snapshot_id AS snapshotId, snapshot_kind AS snapshotKind, state,
           item_count AS itemCount, membership_digest AS membershipDigest,
           order_digest AS orderDigest, expires_at AS expiresAt
    FROM snapshot_objects WHERE snapshot_id = ?
  `).get(snapshotId);
  if (!snapshot) throw createCatalogError('snapshotNotFound', 'Snapshot does not exist');
  const items = database.prepare(`
    SELECT ordinal, track_uid AS trackUid
    FROM snapshot_items
    WHERE snapshot_id = ? AND ordinal >= ?
    ORDER BY ordinal
    LIMIT ?
  `).all(snapshotId, ordinal, limit);
  return {
    snapshot,
    items,
    nextOrdinal: items.length === limit ? Number(items.at(-1).ordinal) + 1 : null
  };
}

function gcOperationSnapshots(payload) {
  assertExactFields(payload, ['limit'], 'invalidSnapshotRequest');
  const limit = normalizeWriteLimit(payload.limit);
  return runDurableTransaction(() => {
    const items = database.prepare(`
      SELECT i.snapshot_id AS snapshotId, i.ordinal
      FROM snapshot_items i
      JOIN snapshot_objects s ON s.snapshot_id = i.snapshot_id
      WHERE s.state = 'gc-pending' AND s.owner_ref_count = 0
      ORDER BY s.created_at, i.snapshot_id, i.ordinal
      LIMIT ?
    `).all(limit);
    const deleteItem = database.prepare(`
      DELETE FROM snapshot_items WHERE snapshot_id = ? AND ordinal = ?
    `);
    for (const item of items) deleteItem.run(item.snapshotId, item.ordinal);
    const remaining = limit - items.length;
    let deletedSnapshotCount = 0;
    if (remaining > 0) {
      const snapshots = database.prepare(`
        SELECT s.snapshot_id AS snapshotId
        FROM snapshot_objects s
        WHERE s.state = 'gc-pending' AND s.owner_ref_count = 0
          AND NOT EXISTS (
            SELECT 1 FROM snapshot_items i WHERE i.snapshot_id = s.snapshot_id
          )
        ORDER BY s.created_at, s.snapshot_id
        LIMIT ?
      `).all(remaining);
      const remove = database.prepare(`
        DELETE FROM snapshot_objects
        WHERE snapshot_id = ? AND state = 'gc-pending' AND owner_ref_count = 0
      `);
      for (const snapshot of snapshots) {
        deletedSnapshotCount += Number(remove.run(snapshot.snapshotId).changes);
      }
    }
    return {
      deletedItemCount: items.length,
      deletedSnapshotCount,
      hasMore: items.length === limit
    };
  });
}

function createPlaybackSequence(payload) {
  assertExactFields(payload, [
    'sequenceId', 'sourceContext', 'catalogVersion', 'seed', 'createdAt'
  ], 'invalidPlaybackSequenceRequest');
  const sequenceId = requireString(payload.sequenceId, 'sequenceId', 512);
  const sourceContext = requireString(payload.sourceContext, 'sourceContext', 2048);
  const sequenceCatalogVersion = requireNonNegativeInteger(payload.catalogVersion, 'catalogVersion');
  const seed = optionalNullableInteger(payload.seed, 'seed');
  const createdAt = requireNonNegativeInteger(payload.createdAt, 'createdAt');
  return runDurableTransaction(() => {
    database.prepare(`
      INSERT INTO playback_sequences(
        id, source_context, catalog_version, state, item_count, seed,
        current_ordinal, created_at, sealed_at
      ) VALUES (?, ?, ?, 'building', NULL, ?, NULL, ?, NULL)
    `).run(sequenceId, sourceContext, sequenceCatalogVersion, seed, createdAt);
    return { sequenceId, state: 'building' };
  });
}

function appendPlaybackSequenceItems(payload) {
  assertExactFields(payload, ['sequenceId', 'items'], 'invalidPlaybackSequenceRequest');
  const sequenceId = requireString(payload.sequenceId, 'sequenceId', 512);
  const items = validateBatch(payload.items, 'items').map(item => {
    assertExactFields(item, ['ordinal', 'entryInstanceId', 'trackUid'], 'invalidPlaybackSequenceRequest');
    return {
      ordinal: requireNonNegativeInteger(item.ordinal, 'ordinal'),
      entryInstanceId: requireString(item.entryInstanceId, 'entryInstanceId', 512),
      trackUid: requireString(item.trackUid, 'trackUid', 512)
    };
  });
  return runDurableTransaction(() => {
    const sequence = database.prepare(`
      SELECT state, sealed_at AS sealedAt FROM playback_sequences WHERE id = ?
    `).get(sequenceId);
    if (!sequence) throw createCatalogError('sequenceNotFound', 'Playback sequence does not exist');
    if (sequence.state !== 'building' || sequence.sealedAt !== null) {
      throw createCatalogError('sequenceSealed', 'Playback sequence is already sealed');
    }
    const tail = database.prepare(`
      SELECT COALESCE(MAX(ordinal), -1) AS ordinal
      FROM playback_sequence_items WHERE sequence_id = ?
    `).get(sequenceId);
    let nextOrdinal = Number(tail.ordinal) + 1;
    const insert = database.prepare(`
      INSERT INTO playback_sequence_items(sequence_id, ordinal, entry_instance_id, track_uid)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of items) {
      if (item.ordinal !== nextOrdinal) {
        throw createCatalogError('invalidPlaybackSequenceRequest', 'Playback sequence item ordinals must be contiguous');
      }
      insert.run(sequenceId, item.ordinal, item.entryInstanceId, item.trackUid);
      nextOrdinal += 1;
    }
    return { sequenceId, appendedCount: items.length, nextOrdinal };
  });
}

function sealPlaybackSequence(payload) {
  assertExactFields(payload, ['sequenceId', 'itemCount', 'currentOrdinal', 'sealedAt'], 'invalidPlaybackSequenceRequest');
  const sequenceId = requireString(payload.sequenceId, 'sequenceId', 512);
  const itemCount = requireNonNegativeInteger(payload.itemCount, 'itemCount');
  const currentOrdinal = optionalNullableNonNegativeInteger(payload.currentOrdinal, 'currentOrdinal');
  const sealedAt = requireNonNegativeInteger(payload.sealedAt, 'sealedAt');
  if ((itemCount === 0 && currentOrdinal !== null) || (currentOrdinal !== null && currentOrdinal >= itemCount)) {
    throw createCatalogError('invalidPlaybackSequenceRequest', 'Playback current ordinal is invalid');
  }
  return runDurableTransaction(() => {
    const sequence = database.prepare(`
      SELECT state, sealed_at AS sealedAt FROM playback_sequences WHERE id = ?
    `).get(sequenceId);
    if (!sequence) throw createCatalogError('sequenceNotFound', 'Playback sequence does not exist');
    if (sequence.state !== 'building' || sequence.sealedAt !== null) {
      throw createCatalogError('sequenceSealed', 'Playback sequence is already sealed');
    }
    const aggregate = database.prepare(`
      SELECT count(*) AS count, MIN(ordinal) AS minOrdinal, MAX(ordinal) AS maxOrdinal
      FROM playback_sequence_items WHERE sequence_id = ?
    `).get(sequenceId);
    const count = Number(aggregate.count);
    const contiguous = itemCount === 0
      ? aggregate.minOrdinal === null && aggregate.maxOrdinal === null
      : Number(aggregate.minOrdinal) === 0 && Number(aggregate.maxOrdinal) === itemCount - 1;
    if (count !== itemCount || !contiguous) {
      throw createCatalogError('sequenceCountMismatch', 'Playback sequence item count does not match');
    }
    database.prepare(`
      UPDATE playback_sequences
      SET state = 'active', item_count = ?, current_ordinal = ?, sealed_at = ?
      WHERE id = ?
    `).run(itemCount, currentOrdinal, sealedAt, sequenceId);
    return { sequenceId, state: 'active', itemCount, currentOrdinal };
  });
}

function normalizeTransportSegment(segment) {
  const normalized = {
    sequenceId: requireString(segment.sequenceId, 'sequenceId', 512),
    startOrdinal: requireNonNegativeInteger(segment.startOrdinal, 'startOrdinal'),
    endOrdinal: requireNonNegativeInteger(segment.endOrdinal, 'endOrdinal')
  };
  if (normalized.endOrdinal < normalized.startOrdinal) {
    throw createCatalogError('invalidTransportDescriptor', 'Transport segment range is invalid');
  }
  if (segment.shuffleSeed != null || segment.shuffleEpoch != null || segment.shuffleTransportOffset != null) {
    normalized.shuffleSeed = optionalNullableInteger(segment.shuffleSeed, 'shuffleSeed');
    normalized.shuffleEpoch = optionalNullableInteger(segment.shuffleEpoch, 'shuffleEpoch');
    normalized.shuffleTransportOffset = requireNonNegativeInteger(segment.shuffleTransportOffset, 'shuffleTransportOffset');
  }
  return normalized;
}

function boundedTransportDescriptor(segments, currentOrdinal) {
  const compacted = [];
  for (const input of segments) {
    const segment = normalizeTransportSegment(input);
    const previous = compacted.at(-1);
    if (previous && previous.sequenceId === segment.sequenceId && previous.endOrdinal === segment.startOrdinal &&
        previous.shuffleSeed === segment.shuffleSeed && previous.shuffleEpoch === segment.shuffleEpoch &&
        previous.shuffleTransportOffset === segment.shuffleTransportOffset) {
      previous.endOrdinal = segment.endOrdinal;
    } else {
      compacted.push({ ...segment });
    }
  }
  if (compacted.length > 256) throw createCatalogError('transportDescriptorLimit', 'Transport segment limit exceeded');
  return { segments: compacted, currentOrdinal };
}

function normalizeDurableTransportDescriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createCatalogError('invalidTransportDescriptor', 'Transport descriptor is required');
  }
  const normalized = boundedTransportDescriptor(value.segments ?? [], value.currentOrdinal ?? 0);
  if (value.shuffleSeed != null || value.shuffleEpoch != null || value.shuffleTransportOffset != null) {
    normalized.shuffleSeed = optionalNullableInteger(value.shuffleSeed, 'shuffleSeed');
    normalized.shuffleEpoch = optionalNullableInteger(value.shuffleEpoch, 'shuffleEpoch');
    normalized.shuffleTransportOffset = requireNonNegativeInteger(value.shuffleTransportOffset, 'shuffleTransportOffset');
  }
  const itemCount = transportDescriptorItemCount(normalized);
  if (normalized.currentOrdinal >= itemCount ||
      (normalized.shuffleTransportOffset != null && normalized.shuffleTransportOffset >= itemCount)) {
    throw createCatalogError('invalidTransportDescriptor', 'Transport state ordinal is outside its descriptor');
  }
  return normalized;
}

function transportDescriptorItemCount(descriptor) {
  const itemCount = descriptor.segments.reduce(
    (total, segment) => total + segment.endOrdinal - segment.startOrdinal,
    0
  );
  if (!Number.isSafeInteger(itemCount) || itemCount < 1) {
    throw createCatalogError('invalidTransportDescriptor', 'Transport descriptor item count is invalid');
  }
  return itemCount;
}

function locateTransportSegment(segments, ordinal) {
  let offset = 0;
  for (const segment of segments) {
    const length = segment.endOrdinal - segment.startOrdinal;
    if (ordinal < offset + length) return { segment, localOrdinal: ordinal - offset };
    offset += length;
  }
  throw createCatalogError('invalidTransportDescriptor', 'Transport descriptor does not cover its ordinal');
}

function queryPlaybackSequence(payload) {
  assertAllowedFields(payload, ['sequenceId', 'ordinal', 'limit'], 'invalidPlaybackSequenceRequest');
  const sequenceId = requireString(payload.sequenceId, 'sequenceId', 512);
  const ordinal = optionalNonNegativeInteger(payload.ordinal, 0, 'ordinal');
  const limit = normalizeQueryLimit(payload.limit);
  const sequence = database.prepare(`
    SELECT id AS sequenceId, source_context AS sourceContext,
           catalog_version AS catalogVersion, state, item_count AS itemCount,
           seed, current_ordinal AS currentOrdinal,
           created_at AS createdAt, sealed_at AS sealedAt
    FROM playback_sequences WHERE id = ? AND state = 'active'
  `).get(sequenceId);
  if (!sequence) throw createCatalogError('sequenceNotFound', 'Active playback sequence does not exist');
  const items = database.prepare(`
    SELECT i.ordinal, i.entry_instance_id AS entryInstanceId, i.track_uid AS trackUid,
      t.file_name AS fileName, t.title, t.artist, t.album_artist AS albumArtist, t.album
    FROM playback_sequence_items i
    LEFT JOIN tracks t ON t.track_uid = i.track_uid
    WHERE i.sequence_id = ? AND i.ordinal >= ?
    ORDER BY i.ordinal
    LIMIT ?
  `).all(sequenceId, ordinal, limit);
  return {
    sequence,
    items,
    nextOrdinal: items.length === limit ? Number(items.at(-1).ordinal) + 1 : null
  };
}

function queryTransportDescriptorPage(payload) {
  assertAllowedFields(payload, ['descriptor', 'transportOrdinal', 'limit'], 'invalidTransportRequest');
  const descriptor = normalizeDurableTransportDescriptor(payload.descriptor);
  const start = optionalNonNegativeInteger(payload.transportOrdinal, 0, 'transportOrdinal');
  const limit = normalizeQueryLimit(payload.limit);
  const itemCount = transportDescriptorItemCount(descriptor);
  if (start >= itemCount) throw createCatalogError('invalidTransportDescriptor', 'Transport ordinal is outside its descriptor');
  const end = Math.min(itemCount, start + limit);
  const sequenceQuery = database.prepare(`
    SELECT id, state, item_count AS itemCount
    FROM playback_sequences WHERE id = ? AND state = 'active'
  `);
  const itemQuery = database.prepare(`
    SELECT ordinal, entry_instance_id AS entryInstanceId, track_uid AS trackUid
    FROM playback_sequence_items WHERE sequence_id = ? AND ordinal = ?
  `);
  const sequenceCache = new Map();
  const mapperCache = new Map();
  const mapCompositeOrdinal = modules.transportShuffle.createTransportOrdinalMapper(descriptor, itemCount);
  const items = [];
  for (let ordinal = start; ordinal < end; ordinal += 1) {
    const compositeOrdinal = mapCompositeOrdinal(ordinal);
    const located = locateTransportSegment(descriptor.segments, compositeOrdinal);
    let sequence = sequenceCache.get(located.segment.sequenceId);
    if (!sequence) {
      sequence = sequenceQuery.get(located.segment.sequenceId);
      if (!sequence) {
        throw createCatalogError('sequenceNotFound', 'Active playback sequence does not exist');
      }
      sequenceCache.set(located.segment.sequenceId, sequence);
    }
    const mapperKey = `${located.segment.sequenceId}\u0000${located.segment.shuffleSeed ?? ""}\u0000${located.segment.shuffleEpoch ?? ""}\u0000${located.segment.shuffleTransportOffset ?? ""}`;
    let mapSourceOrdinal = mapperCache.get(mapperKey);
    if (!mapSourceOrdinal) {
      mapSourceOrdinal = modules.transportShuffle.createTransportOrdinalMapper(
        located.segment,
        Number(sequence.itemCount)
      );
      mapperCache.set(mapperKey, mapSourceOrdinal);
    }
    const sourceTransportOrdinal = located.segment.startOrdinal + located.localOrdinal;
    const canonicalOrdinal = mapSourceOrdinal(sourceTransportOrdinal);
    const item = itemQuery.get(located.segment.sequenceId, canonicalOrdinal);
    if (!item) throw createCatalogError('sequenceEntryNotFound', 'Playback sequence entry does not exist');
    items.push({ ...item, transportOrdinal: ordinal, canonicalOrdinal });
  }
  return { items, nextTransportOrdinal: end < itemCount ? end : null };
}

function createPlaylist(payload) {
  assertAllowedFields(payload, [
    'playlistId', 'name', 'operationId', 'createdAt'
  ], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const name = requireString(payload.name, 'name', 4096);
  const operationId = payload.operationId === undefined || payload.operationId === null
    ? null
    : requireString(payload.operationId, 'operationId', 512);
  const createdAt = requireNonNegativeInteger(payload.createdAt, 'createdAt');
  if (operationId !== null) assertPlaylistOperation(operationId, playlistId);
  const create = () => {
    database.prepare(`
      INSERT INTO playlists(
        id, name, sort_name, state, building_operation_id, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      playlistId,
      name,
      createSortKey(name),
      operationId === null ? 'active' : 'building',
      operationId,
      createdAt,
      createdAt
    );
    return {
      kind: 'created',
      playlistId,
      state: operationId === null ? 'active' : 'building',
      version: 0
    };
  };
  return operationId === null
    ? commitMutation(['playlists'], 'create-playlist', create)
    : runDurableTransaction(create);
}

function createPlaylistWithItems(payload) {
  assertAllowedFields(payload, [
    'playlistId', 'name', 'items', 'createdAt', 'operationId'
  ], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const name = requireString(payload.name, 'name', 4096);
  const createdAt = requireNonNegativeInteger(payload.createdAt, 'createdAt');
  if (payload.operationId !== undefined && payload.operationId !== null) {
    throw createCatalogError('invalidPlaylistRequest', 'Local playlist creation cannot use an operation ID');
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 4_096) {
    throw createCatalogError('batchLimitExceeded', 'items must contain 1..4096 entries');
  }
  const items = payload.items.map(normalizePlaylistItem);
  if (database.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId)) {
    throw createCatalogError('playlistAlreadyExists', 'Playlist already exists');
  }
  const operationId = `playlist-create:${playlistId}:${createdAt}`;
  runDurableTransaction(() => beginLocalPlaylistBuild({
    operationId,
    operationKind: 'createPlaylistWithItems',
    targetIdentity: `playlist:${playlistId}`,
    expectedTargetVersion: 0,
    requestDigest: `local:create:${playlistId}:${items.length}`,
    playlistId,
    name,
    createdAt
  }));
  try {
    for (let offset = 0; offset < items.length; offset += 1_000) {
      const batch = items.slice(offset, offset + 1_000);
      runDurableTransaction(() => {
        const playlist = database.prepare(`
          SELECT state, building_operation_id AS buildingOperationId
          FROM playlists WHERE id = ?
        `).get(playlistId);
        if (!playlist || playlist.state !== 'building' || playlist.buildingOperationId !== operationId) {
          throw createCatalogError('playlistLeaseMismatch', 'Playlist creation lease changed');
        }
        const operation = database.prepare(`
          SELECT terminal_kind AS terminalKind FROM operation_jobs WHERE operation_id = ?
        `).get(operationId);
        if (!operation || operation.terminalKind !== null) {
          throw createCatalogError('playlistLeaseMismatch', 'Playlist creation operation is not active');
        }
        const tail = database.prepare(`
          SELECT COALESCE(MAX(position), 0) AS position FROM playlist_items WHERE playlist_id = ?
        `).get(playlistId);
        const insert = database.prepare(`
          INSERT INTO playlist_items(
            playlist_id, position, track_uid, unresolved_json, unresolved_basename,
            unresolved_title, unresolved_artist, unresolved_duration_bucket, pending_operation_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `);
        let position = Number(tail.position);
        for (const item of batch) {
          position += 1024;
          insert.run(
            playlistId,
            position,
            item.trackUid,
            item.unresolvedJson,
            item.unresolvedBasename,
            item.unresolvedTitle,
            item.unresolvedArtist,
            item.unresolvedDurationBucket
          );
        }
      });
    }
    return commitMutation(['playlists'], 'create-playlist-with-items', () => {
      const published = database.prepare(`
        UPDATE playlists
        SET state = 'active', building_operation_id = NULL, updated_at = ?
        WHERE id = ? AND state = 'building' AND building_operation_id = ?
      `).run(createdAt, playlistId, operationId);
      if (Number(published.changes) !== 1) {
        throw createCatalogError('playlistLeaseMismatch', 'Playlist creation lease changed before publish');
      }
      const result = { playlistId, state: 'active', version: 0 };
      completeLocalPlaylistBuildOperation(operationId, result, createdAt);
      return { kind: 'created', ...result };
    });
  } catch (error) {
    failPlaylistCopy(operationId, playlistId, createdAt, error);
    throw error;
  }
}

function renamePlaylist(payload) {
  assertExactFields(payload, [
    'playlistId', 'name', 'expectedVersion', 'updatedAt'
  ], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const name = requireString(payload.name, 'name', 4096);
  const expectedVersion = requireNonNegativeInteger(payload.expectedVersion, 'expectedVersion');
  const updatedAt = requireNonNegativeInteger(payload.updatedAt, 'updatedAt');
  const playlist = getActivePlaylistForLocalMutation(playlistId);
  const lease = findPlaylistLease(playlistId);
  if (lease) return { kind: 'busy', activeOperationId: lease };
  if (Number(playlist.version) !== expectedVersion) {
    return { kind: 'conflict', currentVersion: Number(playlist.version) };
  }
  return commitMutation(['playlists'], 'rename-playlist', () => {
    const updated = database.prepare(`
      UPDATE playlists
      SET name = ?, sort_name = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND state = 'active' AND version = ?
    `).run(name, createSortKey(name), updatedAt, playlistId, expectedVersion);
    if (Number(updated.changes) !== 1) {
      throw createCatalogError('playlistVersionConflict', 'Playlist version changed during rename');
    }
    return { kind: 'renamed', playlistId, version: expectedVersion + 1 };
  });
}

function removePlaylistItem(payload) {
  assertExactFields(payload, [
    'playlistId', 'itemKey', 'expectedVersion', 'updatedAt'
  ], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const itemKey = requirePositiveInteger(payload.itemKey, 'itemKey');
  const expectedVersion = requireNonNegativeInteger(payload.expectedVersion, 'expectedVersion');
  const updatedAt = requireNonNegativeInteger(payload.updatedAt, 'updatedAt');
  const playlist = getActivePlaylistForLocalMutation(playlistId);
  const lease = findPlaylistLease(playlistId);
  if (lease) return { kind: 'busy', activeOperationId: lease };
  if (Number(playlist.version) !== expectedVersion) {
    return { kind: 'conflict', currentVersion: Number(playlist.version) };
  }
  const item = database.prepare(`
    SELECT i.playlist_id AS playlistId
    FROM playlist_items i
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE i.item_key = ?
      AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
  `).get(itemKey);
  if (!item || item.playlistId !== playlistId) {
    throw createCatalogError('playlistItemNotFound', 'Playlist item does not exist');
  }
  return commitMutation(['playlists'], 'remove-playlist-item', () => {
    const removed = database.prepare(`
      DELETE FROM playlist_items WHERE item_key = ? AND playlist_id = ?
    `).run(itemKey, playlistId);
    if (Number(removed.changes) !== 1) {
      throw createCatalogError('playlistItemNotFound', 'Playlist item does not exist');
    }
    updatePlaylistVersionForLocalMutation(playlistId, expectedVersion, updatedAt);
    return { kind: 'removed', playlistId, itemKey, version: expectedVersion + 1 };
  });
}

function reorderPlaylistItem(payload) {
  assertExactFields(payload, [
    'playlistId', 'itemKey', 'target', 'expectedVersion', 'updatedAt'
  ], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const itemKey = requirePositiveInteger(payload.itemKey, 'itemKey');
  if (!isPlainObject(payload.target)) {
    throw createCatalogError('invalidPlaylistRequest', 'Playlist reorder target must be an object');
  }
  const targetFields = Object.keys(payload.target).sort();
  const directionTarget = targetFields.length === 1 && targetFields[0] === 'direction';
  const beforeTarget = targetFields.length === 1 && targetFields[0] === 'beforeItemKey';
  const afterTarget = targetFields.length === 1 && targetFields[0] === 'afterItemKey';
  if (!directionTarget && !beforeTarget && !afterTarget) {
    throw createCatalogError('invalidPlaylistRequest', 'Playlist reorder target is invalid');
  }
  if (directionTarget && payload.target.direction !== 'up' && payload.target.direction !== 'down') {
    throw createCatalogError('invalidPlaylistRequest', 'Playlist reorder direction is invalid');
  }
  const expectedVersion = requireNonNegativeInteger(payload.expectedVersion, 'expectedVersion');
  const updatedAt = requireNonNegativeInteger(payload.updatedAt, 'updatedAt');
  const playlist = getActivePlaylistForLocalMutation(playlistId);
  const lease = findPlaylistLease(playlistId);
  if (lease) return { kind: 'busy', activeOperationId: lease };
  if (Number(playlist.version) !== expectedVersion) {
    return { kind: 'conflict', currentVersion: Number(playlist.version) };
  }
  const item = database.prepare(`
    SELECT i.item_key AS itemKey, i.position
    FROM playlist_items i
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE i.item_key = ? AND i.playlist_id = ?
      AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
  `).get(itemKey, playlistId);
  if (!item) throw createCatalogError('playlistItemNotFound', 'Playlist item does not exist');
  const visibleItem = itemKeyToFind => database.prepare(`
    SELECT i.item_key AS itemKey, i.position
    FROM playlist_items i
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE i.item_key = ? AND i.playlist_id = ?
      AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
  `).get(itemKeyToFind, playlistId);
  let placement;
  if (directionTarget) {
    const adjacent = payload.target.direction === 'up'
      ? database.prepare(`
          SELECT i.item_key AS itemKey
          FROM playlist_items i
          LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
          WHERE i.playlist_id = ? AND i.position < ?
            AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
          ORDER BY i.position DESC LIMIT 1
        `).get(playlistId, item.position)
      : database.prepare(`
          SELECT i.item_key AS itemKey
          FROM playlist_items i
          LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
          WHERE i.playlist_id = ? AND i.position > ?
            AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
          ORDER BY i.position LIMIT 1
        `).get(playlistId, item.position);
    if (!adjacent) {
      return { kind: 'unchanged', playlistId, itemKey, version: expectedVersion };
    }
    placement = payload.target.direction === 'up'
      ? { kind: 'before', target: visibleItem(adjacent.itemKey) }
      : { kind: 'after', target: visibleItem(adjacent.itemKey) };
  } else {
    const targetItemKey = requirePositiveInteger(
      beforeTarget ? payload.target.beforeItemKey : payload.target.afterItemKey,
      beforeTarget ? 'beforeItemKey' : 'afterItemKey'
    );
    if (targetItemKey === itemKey) {
      return { kind: 'unchanged', playlistId, itemKey, version: expectedVersion };
    }
    const target = visibleItem(targetItemKey);
    if (!target) throw createCatalogError('playlistItemNotFound', 'Playlist reorder target does not exist');
    placement = { kind: beforeTarget ? 'before' : 'after', target };
  }
  const immediate = placement.kind === 'before'
    ? database.prepare(`
        SELECT i.item_key AS itemKey, i.position
        FROM playlist_items i
        LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
        WHERE i.playlist_id = ? AND i.position < ?
          AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
        ORDER BY i.position DESC LIMIT 1
      `).get(playlistId, placement.target.position)
    : database.prepare(`
        SELECT i.item_key AS itemKey, i.position
        FROM playlist_items i
        LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
        WHERE i.playlist_id = ? AND i.position > ?
          AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
        ORDER BY i.position LIMIT 1
      `).get(playlistId, placement.target.position);
  if (Number(immediate?.itemKey) === itemKey) {
    return { kind: 'unchanged', playlistId, itemKey, version: expectedVersion };
  }
  const boundary = placement.kind === 'before'
    ? database.prepare(`
        SELECT i.position
        FROM playlist_items i
        LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
        WHERE i.playlist_id = ? AND i.item_key != ? AND i.position < ?
          AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
        ORDER BY i.position DESC LIMIT 1
      `).get(playlistId, itemKey, placement.target.position)
    : database.prepare(`
        SELECT i.position
        FROM playlist_items i
        LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
        WHERE i.playlist_id = ? AND i.item_key != ? AND i.position > ?
          AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
        ORDER BY i.position LIMIT 1
      `).get(playlistId, itemKey, placement.target.position);
  const lower = placement.kind === 'before'
    ? Number(boundary?.position ?? 0)
    : Number(placement.target.position);
  const upper = placement.kind === 'before'
    ? Number(placement.target.position)
    : Number(boundary?.position ?? lower + 1024);
  return commitMutation(['playlists'], 'reorder-playlist-item', () => {
    const desiredPosition = lower + Math.floor((upper - lower) / 2);
    if (upper - lower > 1 && Number.isSafeInteger(desiredPosition)) {
      const updatePosition = database.prepare(`
        UPDATE playlist_items SET position = ? WHERE item_key = ? AND playlist_id = ?
      `);
      updatePosition.run(-itemKey, itemKey, playlistId);
      updatePosition.run(desiredPosition, itemKey, playlistId);
    } else {
      database.exec('DROP TABLE IF EXISTS temp.playlist_reorder_map');
      database.exec(`
        CREATE TEMP TABLE playlist_reorder_map(
          item_key INTEGER PRIMARY KEY,
          new_position INTEGER NOT NULL UNIQUE
        )
      `);
      try {
        const placementOffset = placement.kind === 'before' ? -0.5 : 0.5;
        database.prepare(`
          INSERT INTO temp.playlist_reorder_map(item_key, new_position)
          SELECT item_key,
            ROW_NUMBER() OVER (
              ORDER BY CASE WHEN item_key = ? THEN ? ELSE position END, item_key
            ) * 1024
          FROM playlist_items
          WHERE playlist_id = ?
        `).run(itemKey, Number(placement.target.position) + placementOffset, playlistId);
        database.prepare(`
          UPDATE playlist_items SET position = -item_key WHERE playlist_id = ?
        `).run(playlistId);
        database.prepare(`
          UPDATE playlist_items
          SET position = (
            SELECT new_position FROM temp.playlist_reorder_map m
            WHERE m.item_key = playlist_items.item_key
          )
          WHERE playlist_id = ?
        `).run(playlistId);
      } finally {
        database.exec('DROP TABLE IF EXISTS temp.playlist_reorder_map');
      }
    }
    updatePlaylistVersionForLocalMutation(playlistId, expectedVersion, updatedAt);
    return { kind: 'reordered', playlistId, itemKey, version: expectedVersion + 1 };
  });
}

function duplicatePlaylist(payload) {
  assertExactFields(payload, [
    'playlistId', 'targetPlaylistId', 'name', 'expectedVersion', 'createdAt'
  ], 'invalidPlaylistRequest');
  const sourcePlaylistId = requireString(payload.playlistId, 'playlistId', 512);
  const targetPlaylistId = requireString(payload.targetPlaylistId, 'targetPlaylistId', 512);
  const name = requireString(payload.name, 'name', 4096);
  const expectedVersion = requireNonNegativeInteger(payload.expectedVersion, 'expectedVersion');
  const createdAt = requireNonNegativeInteger(payload.createdAt, 'createdAt');
  if (sourcePlaylistId === targetPlaylistId) {
    throw createCatalogError('invalidPlaylistRequest', 'Source and target playlists must differ');
  }
  const source = getActivePlaylistForLocalMutation(sourcePlaylistId);
  const lease = findPlaylistLease(sourcePlaylistId);
  if (lease) return { kind: 'busy', activeOperationId: lease };
  if (Number(source.version) !== expectedVersion) {
    return { kind: 'conflict', currentVersion: Number(source.version) };
  }
  const target = database.prepare('SELECT id FROM playlists WHERE id = ?').get(targetPlaylistId);
  if (target) throw createCatalogError('playlistAlreadyExists', 'Target playlist already exists');

  const operationId = `playlist-copy:${targetPlaylistId}:${createdAt}`;
  runDurableTransaction(() => beginLocalPlaylistBuild({
    operationId,
    operationKind: 'duplicatePlaylist',
    targetIdentity: `playlist:${sourcePlaylistId}`,
    expectedTargetVersion: expectedVersion,
    requestDigest: `local:${sourcePlaylistId}:${targetPlaylistId}:${expectedVersion}`,
    playlistId: targetPlaylistId,
    name,
    createdAt
  }));

  try {
    let afterPosition = -1;
    for (;;) {
      const page = readVisiblePlaylistCopyPage(sourcePlaylistId, afterPosition);
      if (page.length === 0) break;
      runDurableTransaction(() => appendPlaylistCopyPage({
        sourcePlaylistId,
        targetPlaylistId,
        operationId,
        expectedVersion,
        page
      }));
      afterPosition = Number(page.at(-1).position);
    }
    return commitMutation(['playlists'], 'duplicate-playlist', () => {
      assertPlaylistCopyState({
        sourcePlaylistId,
        targetPlaylistId,
        operationId,
        expectedVersion
      });
      const published = database.prepare(`
        UPDATE playlists
        SET state = 'active', building_operation_id = NULL, updated_at = ?
        WHERE id = ? AND state = 'building' AND building_operation_id = ?
      `).run(createdAt, targetPlaylistId, operationId);
      if (Number(published.changes) !== 1) {
        throw createCatalogError('playlistLeaseMismatch', 'Target playlist duplicate lease changed');
      }
      const result = { playlistId: targetPlaylistId, id: targetPlaylistId, version: 0 };
      completeLocalPlaylistBuildOperation(operationId, result, createdAt);
      return { kind: 'duplicated', ...result };
    });
  } catch (error) {
    failPlaylistCopy(operationId, targetPlaylistId, createdAt, error);
    throw error;
  }
}

function beginLocalPlaylistBuild({
  operationId,
  operationKind,
  targetIdentity,
  expectedTargetVersion,
  requestDigest,
  playlistId,
  name,
  createdAt
}) {
  database.prepare(`
    INSERT INTO operation_jobs(
      operation_id, client_request_id, request_digest, canonical_request_version,
      operation_kind, target_identity, expected_target_version, phase, heavy,
      committed, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, 'SNAPSHOTTING', 0, 0, ?, ?)
  `).run(
    operationId,
    operationId,
    requestDigest,
    operationKind,
    targetIdentity,
    expectedTargetVersion,
    createdAt,
    createdAt
  );
  database.prepare(`
    INSERT INTO playlists(
      id, name, sort_name, state, building_operation_id, version, created_at, updated_at
    ) VALUES (?, ?, ?, 'building', ?, 0, ?, ?)
  `).run(playlistId, name, createSortKey(name), operationId, createdAt, createdAt);
}

function completeLocalPlaylistBuildOperation(operationId, result, finishedAt) {
  const completed = database.prepare(`
    UPDATE operation_jobs
    SET phase = 'SUCCEEDED', committed = 1, terminal_kind = 'success',
      terminal_result_json = ?, updated_at = ?, finished_at = ?
    WHERE operation_id = ? AND terminal_kind IS NULL
  `).run(JSON.stringify({ state: 'succeeded', ...result }), finishedAt, finishedAt, operationId);
  if (Number(completed.changes) !== 1) {
    throw createCatalogError('playlistLeaseMismatch', 'Playlist build operation is not active');
  }
}

function getActivePlaylistForLocalMutation(playlistId) {
  const playlist = database.prepare(`
    SELECT version FROM playlists WHERE id = ? AND state = 'active'
  `).get(playlistId);
  if (!playlist) throw createCatalogError('playlistNotFound', 'Active playlist does not exist');
  return playlist;
}

function updatePlaylistVersionForLocalMutation(playlistId, expectedVersion, updatedAt) {
  const updated = database.prepare(`
    UPDATE playlists SET version = version + 1, updated_at = ?
    WHERE id = ? AND state = 'active' AND version = ?
  `).run(updatedAt, playlistId, expectedVersion);
  if (Number(updated.changes) !== 1) {
    throw createCatalogError('playlistVersionConflict', 'Playlist version changed during mutation');
  }
}

function readVisiblePlaylistCopyPage(playlistId, afterPosition) {
  return database.prepare(`
    SELECT i.position, i.track_uid AS trackUid, i.unresolved_json AS unresolvedJson,
      i.unresolved_basename AS unresolvedBasename, i.unresolved_title AS unresolvedTitle,
      i.unresolved_artist AS unresolvedArtist,
      i.unresolved_duration_bucket AS unresolvedDurationBucket
    FROM playlist_items i
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE i.playlist_id = ? AND i.position > ?
      AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
    ORDER BY i.position
    LIMIT ?
  `).all(playlistId, afterPosition, MAX_WRITE_BATCH_ROWS);
}

function appendPlaylistCopyPage({
  sourcePlaylistId,
  targetPlaylistId,
  operationId,
  expectedVersion,
  page
}) {
  assertPlaylistCopyState({
    sourcePlaylistId,
    targetPlaylistId,
    operationId,
    expectedVersion
  });
  const insert = database.prepare(`
    INSERT INTO playlist_items(
      playlist_id, position, track_uid, unresolved_json, unresolved_basename,
      unresolved_title, unresolved_artist, unresolved_duration_bucket, pending_operation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  for (const item of page) {
    insert.run(
      targetPlaylistId,
      item.position,
      item.trackUid,
      item.unresolvedJson,
      item.unresolvedBasename,
      item.unresolvedTitle,
      item.unresolvedArtist,
      item.unresolvedDurationBucket
    );
  }
}

function assertPlaylistCopyState({
  sourcePlaylistId,
  targetPlaylistId,
  operationId,
  expectedVersion
}) {
  const source = database.prepare(`
    SELECT state, version FROM playlists WHERE id = ?
  `).get(sourcePlaylistId);
  if (!source || source.state !== 'active' || Number(source.version) !== expectedVersion) {
    throw createCatalogError('playlistVersionConflict', 'Source playlist changed during duplicate');
  }
  const competingLease = findPlaylistLease(sourcePlaylistId, operationId);
  if (competingLease) throw createCatalogError('playlistBusy', 'Source playlist is busy');
  const target = database.prepare(`
    SELECT state, building_operation_id AS buildingOperationId
    FROM playlists WHERE id = ?
  `).get(targetPlaylistId);
  if (!target || target.state !== 'building' || target.buildingOperationId !== operationId) {
    throw createCatalogError('playlistLeaseMismatch', 'Target playlist duplicate lease changed');
  }
  const operation = database.prepare(`
    SELECT terminal_kind AS terminalKind FROM operation_jobs WHERE operation_id = ?
  `).get(operationId);
  if (!operation || operation.terminalKind !== null) {
    throw createCatalogError('playlistLeaseMismatch', 'Playlist duplicate operation is not active');
  }
}

function failPlaylistCopy(operationId, targetPlaylistId, finishedAt, error) {
  try {
    runDurableTransaction(() => {
      database.prepare(`
        UPDATE playlists SET state = 'deleted', building_operation_id = NULL, updated_at = ?
        WHERE id = ? AND state = 'building' AND building_operation_id = ?
      `).run(finishedAt, targetPlaylistId, operationId);
      database.prepare(`
        UPDATE operation_jobs
        SET phase = 'FAILED', terminal_kind = 'failed', terminal_code = ?,
          terminal_result_json = ?, updated_at = ?, finished_at = ?
        WHERE operation_id = ? AND terminal_kind IS NULL
      `).run(
        typeof error?.code === 'string' ? error.code : 'playlist-copy-failed',
        JSON.stringify({
          state: 'failed',
          code: typeof error?.code === 'string' ? error.code : 'playlist-copy-failed',
          finishedAt
        }),
        finishedAt,
        finishedAt,
        operationId
      );
    });
  } catch {
    // The original duplicate failure is the actionable error.
  }
}

function prepareSequencePlaylistSave(payload) {
  assertExactFields(payload, [
    'playlistId', 'operationId', 'name', 'expectedVersion', 'itemCount', 'createdAt'
  ], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const name = requireString(payload.name, 'name', 4096);
  const expectedVersion = requireNonNegativeInteger(payload.expectedVersion, 'expectedVersion');
  const itemCount = requireNonNegativeInteger(payload.itemCount, 'itemCount');
  const createdAt = requireNonNegativeInteger(payload.createdAt, 'createdAt');
  const estimatedRequiredBytes = itemCount * 160 + 64 * 1024;
  try {
    const stats = fs.statfsSync(path.dirname(workerData.dbPath));
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
  return runDurableTransaction(() => {
    const operation = database.prepare(`
      SELECT phase, operation_kind AS operationKind, target_identity AS targetIdentity,
        terminal_kind AS terminalKind
      FROM operation_jobs WHERE operation_id = ?
    `).get(operationId);
    if (!operation || operation.terminalKind !== null || operation.phase !== 'SNAPSHOTTING' ||
        operation.operationKind !== 'addToPlaylist' || operation.targetIdentity !== `playlist:${playlistId}`) {
      throw createCatalogError('playlistLeaseMismatch', 'Operation does not own this playlist');
    }
    const playlist = database.prepare(`
      SELECT state, version, building_operation_id AS buildingOperationId
      FROM playlists WHERE id = ?
    `).get(playlistId);
    if (playlist) {
      if (playlist.state === 'deleted') throw createCatalogError('playlistNotFound', 'Playlist does not exist');
      if (Number(playlist.version) !== expectedVersion) {
        return { kind: 'conflict', currentVersion: Number(playlist.version) };
      }
      const lease = playlist.buildingOperationId || findPlaylistLease(playlistId, operationId);
      if (lease) return { kind: 'busy', activeOperationId: lease };
    } else if (expectedVersion !== 0) {
      return { kind: 'conflict', currentVersion: null };
    }
    if (playlist) {
      database.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(createdAt, playlistId);
    } else {
      database.prepare(`
        INSERT INTO playlists(
          id, name, sort_name, state, building_operation_id, version, created_at, updated_at
        ) VALUES (?, ?, ?, 'building', ?, 0, ?, ?)
      `).run(playlistId, name, createSortKey(name), operationId, createdAt, createdAt);
    }
    return { kind: 'prepared', operationId, playlistId };
  });
}

function appendSequencePlaylistPage(payload) {
  assertExactFields(payload, [
    'playlistId', 'operationId', 'segmentIndex', 'transportOrdinal', 'items'
  ], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const segmentIndex = requireNonNegativeInteger(payload.segmentIndex, 'segmentIndex');
  const transportOrdinal = requireNonNegativeInteger(payload.transportOrdinal, 'transportOrdinal');
  const items = validateBatch(payload.items, 'items').map(normalizePlaylistItem);
  if (items.some(item => item.trackUid === null)) {
    throw createCatalogError('invalidPlaylistRequest', 'A sequence page must contain track identities');
  }
  return runDurableTransaction(() => {
    const page = database.prepare(`
      SELECT appended_count AS appendedCount FROM sequence_save_pages
      WHERE operation_id = ? AND segment_index = ? AND transport_ordinal = ?
    `).get(operationId, segmentIndex, transportOrdinal);
    if (page) return { kind: 'alreadyAppended', appendedCount: Number(page.appendedCount) };
    assertPlaylistOperation(operationId, playlistId);
    const playlist = database.prepare(`
      SELECT state, building_operation_id AS buildingOperationId
      FROM playlists WHERE id = ?
    `).get(playlistId);
    if (!playlist || playlist.state === 'deleted') throw createCatalogError('playlistNotFound', 'Playlist does not exist');
    if (playlist.state === 'building' && playlist.buildingOperationId !== operationId) {
      throw createCatalogError('playlistLeaseMismatch', 'Playlist build operation does not match');
    }
    const tail = database.prepare(`
      SELECT COALESCE(MAX(position), 0) AS position FROM playlist_items WHERE playlist_id = ?
    `).get(playlistId);
    const insert = database.prepare(`
      INSERT INTO playlist_items(playlist_id, position, track_uid, pending_operation_id)
      VALUES (?, ?, ?, ?)
    `);
    let position = Number(tail.position);
    for (const item of items) {
      position += 1024;
      insert.run(playlistId, position, item.trackUid, operationId);
    }
    database.prepare(`
      INSERT INTO sequence_save_pages(operation_id, segment_index, transport_ordinal, appended_count)
      VALUES (?, ?, ?, ?)
    `).run(operationId, segmentIndex, transportOrdinal, items.length);
    return { kind: 'appended', appendedCount: items.length };
  });
}

function appendPlaylistItems(payload) {
  assertExactFields(payload, ['playlistId', 'operationId', 'items'], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const items = validateBatch(payload.items, 'items').map(normalizePlaylistItem);
  return runDurableTransaction(() => {
    const playlist = database.prepare(`
      SELECT state FROM playlists WHERE id = ?
    `).get(playlistId);
    if (!playlist || playlist.state === 'deleted') {
      throw createCatalogError('playlistNotFound', 'Playlist does not exist');
    }
    assertPlaylistOperation(operationId, playlistId);
    const lease = findPlaylistLease(playlistId, operationId);
    if (lease) return { kind: 'busy', activeOperationId: lease };
    const tail = database.prepare(`
      SELECT COALESCE(MAX(position), 0) AS position FROM playlist_items WHERE playlist_id = ?
    `).get(playlistId);
    const insert = database.prepare(`
      INSERT INTO playlist_items(
        playlist_id, position, track_uid, unresolved_json, unresolved_basename,
        unresolved_title, unresolved_artist, unresolved_duration_bucket, pending_operation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let position = Number(tail.position);
    for (const item of items) {
      position += 1024;
      insert.run(
        playlistId,
        position,
        item.trackUid,
        item.unresolvedJson,
        item.unresolvedBasename,
        item.unresolvedTitle,
        item.unresolvedArtist,
        item.unresolvedDurationBucket,
        operationId
      );
    }
    return { kind: 'appended', playlistId, appendedCount: items.length, lastPosition: position };
  });
}

function getAutomaticPlaylistImportState(payload) {
  assertExactFields(payload, ['folderId', 'relativePath', 'playlistId'], 'invalidPlaylistRequest');
  const folderId = requireString(payload.folderId, 'folderId', 512);
  const relativePath = normalizeRelativePath(
    requireString(payload.relativePath, 'relativePath', 32768)
  ).normalize('NFC');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const source = database.prepare(`
    SELECT s.playlist_id AS playlistId, s.content_digest AS contentDigest,
      p.state, p.version
    FROM automatic_playlist_sources s
    JOIN playlists p ON p.id = s.playlist_id
    WHERE s.folder_id = ? AND s.relative_path = ?
  `).get(folderId, relativePath);
  if (source && source.playlistId !== playlistId) {
    throw createCatalogError('automaticPlaylistIdentityMismatch', 'Automatic playlist source identity changed');
  }
  const playlist = source ?? database.prepare(`
    SELECT id AS playlistId, NULL AS contentDigest, state, version
    FROM playlists WHERE id = ?
  `).get(playlistId);
  return playlist
    ? {
        state: playlist.state,
        version: Number(playlist.version),
        contentDigest: playlist.contentDigest ?? null
      }
    : { state: 'missing', version: null, contentDigest: null };
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
    const folder = database.prepare('SELECT status FROM folders WHERE id = ?').get(folderId);
    if (!folder || folder.status === 'removed') {
      throw createCatalogError('stalePlaylistOrigin', 'Automatic playlist folder is no longer current');
    }
    const operation = database.prepare(`
      SELECT operation_kind AS operationKind, target_identity AS targetIdentity,
        expected_target_version AS expectedVersion, terminal_kind AS terminalKind
      FROM operation_jobs WHERE operation_id = ?
    `).get(operationId);
    if (!operation || operation.terminalKind !== null || operation.operationKind !== 'importPlaylist' ||
        operation.targetIdentity !== `playlist:${playlistId}` ||
        Number(operation.expectedVersion) !== expectedVersion) {
      throw createCatalogError('playlistLeaseMismatch', 'Automatic playlist operation does not match');
    }
    const source = database.prepare(`
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
    let playlist = database.prepare(`
      SELECT state, version, building_operation_id AS buildingOperationId
      FROM playlists WHERE id = ?
    `).get(playlistId);
    if (expectedVersion === 0 && (!playlist || playlist.state === 'deleted')) {
      if (playlist) {
        database.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId);
        database.prepare(`
          DELETE FROM automatic_playlist_import_jobs WHERE playlist_id = ?
        `).run(playlistId);
        database.prepare('DELETE FROM playlists WHERE id = ? AND state = \'deleted\'').run(playlistId);
      }
      database.prepare(`
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
    const basePosition = Number(database.prepare(`
      SELECT COALESCE(MAX(position), 0) AS position FROM playlist_items WHERE playlist_id = ?
    `).get(playlistId).position);
    database.prepare(`
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

function appendPlaylistImportRecords(payload) {
  assertExactFields(payload, ['origin', 'playlistId', 'operationId', 'records'], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const records = validateBatch(payload.records, 'records');
  if (records.length === 0) {
    throw createCatalogError('invalidPlaylistRequest', 'Playlist import records must not be empty');
  }
  return runDurableTransaction(() => {
    const origin = normalizePlaylistImportOrigin(payload.origin);
    const playlist = database.prepare(`
      SELECT state, building_operation_id AS buildingOperationId
      FROM playlists WHERE id = ?
    `).get(playlistId);
    const automaticJob = database.prepare(`
      SELECT base_position AS basePosition FROM automatic_playlist_import_jobs
      WHERE operation_id = ? AND playlist_id = ?
    `).get(operationId, playlistId);
    const buildingLease = playlist?.state === 'building' && playlist.buildingOperationId === operationId;
    const replacementLease = playlist?.state === 'active' && automaticJob;
    if (!buildingLease && !replacementLease) {
      throw createCatalogError('playlistLeaseMismatch', 'Playlist import lease does not match');
    }
    const operation = assertPlaylistOperation(operationId, playlistId);
    const operationKind = database.prepare(`
      SELECT operation_kind AS operationKind FROM operation_jobs WHERE operation_id = ?
    `).get(operationId)?.operationKind;
    if (!operation || !['importPlaylist', 'previewPlaylistImport'].includes(operationKind)) {
      throw createCatalogError('operationNotActive', 'Playlist import operation is not active');
    }
    const basePosition = Number(automaticJob?.basePosition ?? 0);
    let position = Number(database.prepare(`
      SELECT COALESCE(MAX(position), ?) AS position FROM playlist_items
      WHERE playlist_id = ? AND pending_operation_id = ?
    `).get(basePosition, playlistId, operationId).position);
    let stagedCount = 0;
    const findAtPosition = database.prepare(`
      SELECT item_key AS itemKey, import_fields_json AS importFieldsJson,
        pending_operation_id AS pendingOperationId, position
      FROM playlist_items WHERE playlist_id = ? AND position = ?
    `);
    const insert = database.prepare(`
      INSERT INTO playlist_items(
        playlist_id, position, track_uid, unresolved_json, unresolved_basename,
        unresolved_title, unresolved_artist, unresolved_duration_bucket,
        pending_operation_id, import_fields_json, import_has_path
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const update = database.prepare(`
      UPDATE playlist_items SET unresolved_json = ?, unresolved_basename = ?,
        unresolved_title = ?, unresolved_artist = ?, unresolved_duration_bucket = ?,
        import_fields_json = ?, import_has_path = ?
      WHERE item_key = ? AND pending_operation_id = ?
    `);
    for (const record of records) {
      if (!isPlainObject(record)) throw createCatalogError('invalidPlaylistRequest', 'Playlist import record is invalid');
      let fields;
      let recordPosition;
      let existing = null;
      if (record.type === 'entry') {
        assertExactFields(record, ['entry', 'type'], 'invalidPlaylistRequest');
        fields = normalizePlaylistImportFields(record.entry);
        position += 1024;
        recordPosition = position;
      } else if (record.type === 'fields') {
        assertExactFields(record, ['fields', 'index', 'type'], 'invalidPlaylistRequest');
        const index = requirePositiveInteger(record.index, 'record.index');
        if (index > Math.floor(Number.MAX_SAFE_INTEGER / 1024)) {
          throw createCatalogError('invalidPlaylistRequest', 'Playlist import record index is too large');
        }
        recordPosition = basePosition + index * 1024;
        existing = findAtPosition.get(playlistId, recordPosition) || null;
        if (existing && existing.pendingOperationId !== operationId) {
          throw createCatalogError('playlistLeaseMismatch', 'Playlist import row belongs to another operation');
        }
        fields = {
          ...(existing?.importFieldsJson ? parseStoredJson(existing.importFieldsJson) : {}),
          ...normalizePlaylistImportFields(record.fields)
        };
        position = Math.max(position, recordPosition);
      } else {
        throw createCatalogError('invalidPlaylistRequest', 'Playlist import record type is invalid');
      }
      const normalized = normalizePlaylistItem({ unresolved: playlistImportUnresolved(fields, origin) });
      const importFieldsJson = JSON.stringify(fields);
      const hasPath = fields.path ? 1 : 0;
      if (existing) {
        update.run(
          normalized.unresolvedJson, normalized.unresolvedBasename, normalized.unresolvedTitle,
          normalized.unresolvedArtist, normalized.unresolvedDurationBucket,
          importFieldsJson, hasPath, existing.itemKey, operationId
        );
      } else {
        insert.run(
          playlistId, recordPosition, normalized.unresolvedJson, normalized.unresolvedBasename,
          normalized.unresolvedTitle, normalized.unresolvedArtist,
          normalized.unresolvedDurationBucket, operationId, importFieldsJson, hasPath
        );
        stagedCount += 1;
      }
    }
    return { kind: 'staged', playlistId, stagedCount, lastPosition: position };
  });
}

function finalizePlaylistImportPage(payload) {
  assertExactFields(payload, ['playlistId', 'operationId', 'afterPosition', 'limit'], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const afterPosition = requireNonNegativeInteger(payload.afterPosition, 'afterPosition');
  const limit = normalizeWriteLimit(payload.limit);
  return runDurableTransaction(() => {
    const playlist = database.prepare(`
      SELECT state, building_operation_id AS buildingOperationId FROM playlists WHERE id = ?
    `).get(playlistId);
    const automaticJob = database.prepare(`
      SELECT operation_id AS operationId FROM automatic_playlist_import_jobs
      WHERE operation_id = ? AND playlist_id = ?
    `).get(operationId, playlistId);
    const buildingLease = playlist?.state === 'building' && playlist.buildingOperationId === operationId;
    const replacementLease = playlist?.state === 'active' && automaticJob;
    if (!buildingLease && !replacementLease) {
      throw createCatalogError('playlistLeaseMismatch', 'Playlist import lease does not match');
    }
    assertPlaylistOperation(operationId, playlistId);
    const rows = database.prepare(`
      SELECT item_key AS itemKey, position, import_has_path AS importHasPath,
        unresolved_json AS unresolvedJson
      FROM playlist_items
      WHERE playlist_id = ? AND pending_operation_id = ? AND position > ?
      ORDER BY position LIMIT ?
    `).all(playlistId, operationId, afterPosition, limit);
    const remove = database.prepare('DELETE FROM playlist_items WHERE item_key = ? AND pending_operation_id = ?');
    const finish = database.prepare(`
      UPDATE playlist_items SET import_fields_json = NULL, import_has_path = NULL
      WHERE item_key = ? AND pending_operation_id = ?
    `);
    const resolve = database.prepare(`
      UPDATE playlist_items
      SET track_uid = ?, unresolved_json = NULL, unresolved_basename = NULL,
        unresolved_title = NULL, unresolved_artist = NULL,
        unresolved_duration_bucket = NULL, import_fields_json = NULL,
        import_has_path = NULL
      WHERE item_key = ? AND pending_operation_id = ?
    `);
    let keptCount = 0;
    let resolvedCount = 0;
    const unresolvedItems = [];
    for (const row of rows) {
      const unresolved = parseStoredJson(row.unresolvedJson);
      const trackUid = resolveImportedPlaylistTrack(unresolved);
      if (trackUid) {
        resolve.run(trackUid, row.itemKey, operationId);
        keptCount += 1;
        resolvedCount += 1;
      } else if (row.importHasPath !== 1) remove.run(row.itemKey, operationId);
      else {
        finish.run(row.itemKey, operationId);
        keptCount += 1;
        if (unresolvedItems.length < 5) {
          unresolvedItems.push({ label: playlistImportPreviewLabel(unresolved) });
        }
      }
    }
    return {
      processedCount: rows.length,
      keptCount,
      resolvedCount,
      unresolvedItems,
      nextPosition: rows.length === limit ? Number(rows.at(-1).position) : null
    };
  });
}

function playlistImportPreviewLabel(unresolved) {
  const basename = String(unresolved?.basename ?? '').trim();
  const title = String(unresolved?.title ?? '').trim();
  return (basename || title).slice(0, 512);
}

function resolveImportedPlaylistTrack(unresolved) {
  if (!unresolved) return null;
  if (unresolved.sourceKind === 'cue-track' || unresolved.cueProvenance != null) {
    return resolveCuePlaylistTrack(unresolved);
  }
  const trustedOriginMatch = resolveImportedTrackFromOrigin(unresolved);
  if (trustedOriginMatch) return trustedOriginMatch;
  const normalize = modules.searchNormalizer.normalizeSearchText;
  const requestedPath = unresolved.relativePathHint || unresolved.relativePath || unresolved.sourceLine || '';
  const basename = normalize(unresolved.basename || String(requestedPath).split(/[\\/]/).at(-1) || '');
  let pathCandidates = [];
  if (basename) {
    pathCandidates = database.prepare(`
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
  const metadataCandidates = database.prepare(`
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

function resolveCuePlaylistTrack(unresolved) {
  const provenanceFolderId = unresolved.cueProvenance?.folderId;
  const provenanceEntryKey = unresolved.cueProvenance?.entryKey;
  const folderId = typeof provenanceFolderId === 'string' && provenanceFolderId.length > 0
    ? provenanceFolderId
    : null;
  const entryKey = typeof provenanceEntryKey === 'string' && provenanceEntryKey.length > 0
    ? provenanceEntryKey
    : null;
  if (folderId && entryKey) {
    const exact = database.prepare(`
      SELECT t.track_uid AS trackUid
      FROM tracks t
      JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
      WHERE t.folder_id = ? AND t.source_kind = 'cue-track' AND t.entry_key = ?
      ORDER BY t.track_uid LIMIT 2
    `).all(folderId, entryKey);
    if (exact.length === 1) return exact[0].trackUid;
  }

  const normalize = modules.searchNormalizer.normalizeSearchText;
  const normalizedTitle = normalize(unresolved.title ?? '');
  const normalizedArtist = normalize(unresolved.artist ?? '');
  if (!normalizedTitle || !normalizedArtist) return null;
  const durationBucket = Number.isFinite(unresolved.durationSec) ? Math.round(unresolved.durationSec) : null;
  const candidates = database.prepare(`
    SELECT t.track_uid AS trackUid, t.duration_bucket AS durationBucket
    FROM tracks t
    JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
    WHERE t.source_kind = 'cue-track' AND t.normalized_title = ? AND t.normalized_artist = ?
    ORDER BY t.track_uid LIMIT ?
  `).all(normalizedTitle, normalizedArtist, PLAYLIST_RESOLUTION_CANDIDATE_LIMIT + 1);
  if (candidates.length > PLAYLIST_RESOLUTION_CANDIDATE_LIMIT) return null;
  const matching = candidates.filter(track =>
    durationBucket === null || Number(track.durationBucket) === durationBucket
  );
  return matching.length === 1 ? matching[0].trackUid : null;
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

function playlistPathSuffixScore(candidatePath, requestedPath) {
  const normalizePath = value => modules.searchNormalizer.normalizeSearchText(
    String(value ?? '').replace(/\\/g, '/').replace(/^file:\/+/iu, '')
  ).split('/').filter(Boolean);
  const candidate = normalizePath(candidatePath);
  const requested = normalizePath(requestedPath);
  let score = 0;
  while (score < candidate.length && score < requested.length &&
      candidate[candidate.length - score - 1] === requested[requested.length - score - 1]) {
    score += 1;
  }
  return score;
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
  const folder = database.prepare(`
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
    const matches = database.prepare(`
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

function normalizePlaylistImportFields(value) {
  if (!isPlainObject(value)) throw createCatalogError('invalidPlaylistRequest', 'Playlist import fields are invalid');
  assertAllowedFields(value, ['album', 'artist', 'durationSec', 'path', 'title'], 'invalidPlaylistRequest');
  const fields = {};
  if (value.path != null) fields.path = String(value.path).slice(0, 16_384);
  if (value.title != null) fields.title = String(value.title).slice(0, 4096);
  if (value.artist != null) fields.artist = String(value.artist).slice(0, 4096);
  if (value.album != null) fields.album = String(value.album).slice(0, 4096);
  if (Number.isFinite(value.durationSec)) fields.durationSec = value.durationSec;
  return fields;
}

function playlistImportUnresolved(fields, origin = null) {
  const sourceLine = String(fields.path ?? '').slice(0, 16_384);
  return {
    sourceLine,
    relativePathHint: sourceLine,
    basename: sourceLine.split(/[\\/]/).at(-1) ?? '',
    title: fields.title ?? '',
    artist: fields.artist ?? '',
    album: fields.album ?? '',
    durationSec: Number.isFinite(fields.durationSec) ? fields.durationSec : null,
    origin
  };
}

function publishPlaylist(payload) {
  assertAllowedFields(payload, [
    'playlistId', 'operationId', 'expectedVersion', 'finishedAt', 'result'
  ], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const operationId = requireString(payload.operationId, 'operationId', 512);
  const expectedVersion = requireNonNegativeInteger(payload.expectedVersion, 'expectedVersion');
  const finishedAt = requireNonNegativeInteger(payload.finishedAt, 'finishedAt');
  const requestedResult = payload.result === undefined
    ? {}
    : validateBoundedResultObject(payload.result, 'invalidPlaylistRequest');
  const playlist = database.prepare(`
    SELECT state, version, building_operation_id AS buildingOperationId
    FROM playlists WHERE id = ?
  `).get(playlistId);
  const automaticJob = database.prepare(`
    SELECT folder_id AS folderId, relative_path AS relativePath,
      content_digest AS contentDigest, expected_version AS expectedVersion
    FROM automatic_playlist_import_jobs
    WHERE operation_id = ? AND playlist_id = ?
  `).get(operationId, playlistId);
  if (!playlist || playlist.state === 'deleted') {
    throw createCatalogError('playlistNotFound', 'Playlist does not exist');
  }
  if (Number(playlist.version) !== expectedVersion) {
    return { kind: 'conflict', currentVersion: Number(playlist.version) };
  }
  if (automaticJob && Number(automaticJob.expectedVersion) !== expectedVersion) {
    throw createCatalogError('playlistLeaseMismatch', 'Automatic playlist version does not match');
  }
  assertPlaylistOperation(operationId, playlistId, { committing: true });
  if (playlist.state === 'building' && playlist.buildingOperationId !== operationId) {
    throw createCatalogError('playlistLeaseMismatch', 'Playlist build operation does not match');
  }
  return commitMutation(['playlists'], 'publish-playlist', () => {
    if (automaticJob && expectedVersion > 0) {
      database.prepare(`
        WITH ranked AS (
          SELECT item_key AS itemKey,
            ROW_NUMBER() OVER (ORDER BY position, item_key) * 1024 AS newPosition
          FROM playlist_items
          WHERE playlist_id = ? AND pending_operation_id = ?
        )
        UPDATE playlist_items
        SET position = -(
          SELECT newPosition FROM ranked WHERE ranked.itemKey = playlist_items.item_key
        )
        WHERE playlist_id = ? AND pending_operation_id = ?
      `).run(playlistId, operationId, playlistId, operationId);
      database.prepare(`
        DELETE FROM playlist_items
        WHERE playlist_id = ?
          AND (pending_operation_id IS NULL OR pending_operation_id != ?)
      `).run(playlistId, operationId);
      database.prepare(`
        UPDATE playlist_items
        SET position = -position, pending_operation_id = NULL
        WHERE playlist_id = ? AND pending_operation_id = ?
      `).run(playlistId, operationId);
    } else if (automaticJob) {
      database.prepare(`
        UPDATE playlist_items SET pending_operation_id = NULL
        WHERE playlist_id = ? AND pending_operation_id = ?
      `).run(playlistId, operationId);
    }
    const updated = database.prepare(`
      UPDATE playlists
      SET state = 'active', building_operation_id = NULL, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ? AND state != 'deleted'
    `).run(finishedAt, playlistId, expectedVersion);
    if (Number(updated.changes) !== 1) {
      throw createCatalogError('playlistVersionConflict', 'Playlist version changed during publish');
    }
    if (automaticJob) {
      database.prepare(`
        INSERT INTO automatic_playlist_sources(
          folder_id, relative_path, playlist_id, content_digest, imported_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(folder_id, relative_path) DO UPDATE SET
          playlist_id = excluded.playlist_id,
          content_digest = excluded.content_digest,
          imported_at = excluded.imported_at
      `).run(
        automaticJob.folderId, automaticJob.relativePath, playlistId,
        automaticJob.contentDigest, finishedAt
      );
      database.prepare(`
        DELETE FROM automatic_playlist_import_jobs WHERE operation_id = ?
      `).run(operationId);
    }
    const result = { ...requestedResult, playlistId, version: expectedVersion + 1 };
    completeOperationInTransaction(operationId, {
      state: 'succeeded',
      result,
      finishedAt
    }, { committed: true });
    return { kind: 'published', ...result };
  });
}

function queryPlaylistItems(payload) {
  assertAllowedFields(payload, ['playlistId', 'afterPosition', 'limit'], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const afterPosition = optionalNonNegativeInteger(payload.afterPosition, 0, 'afterPosition');
  const limit = normalizeQueryLimit(payload.limit);
  const playlist = database.prepare(`
    SELECT id AS playlistId, name, version, created_at AS createdAt, updated_at AS updatedAt
    FROM playlists WHERE id = ? AND state = 'active'
  `).get(playlistId);
  if (!playlist) throw createCatalogError('playlistNotFound', 'Active playlist does not exist');
  const rows = database.prepare(`
    SELECT i.item_key AS itemKey, i.position, i.track_uid AS trackUid,
      i.unresolved_json AS unresolvedJson, f.status AS folderStatus,
      t.folder_id AS folderId, t.relative_path AS relativePath, t.file_name AS fileName,
      t.source_kind AS sourceKind, t.entry_key AS entryKey, t.cue_relative_path AS cueRelativePath,
      t.start_frame AS startFrame, t.end_frame AS endFrame,
      t.title, t.artist, t.duration_sec AS durationSec
    FROM playlist_items i
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    LEFT JOIN tracks t ON t.track_uid = i.track_uid
    LEFT JOIN folders f ON f.id = t.folder_id
    WHERE i.playlist_id = ?
      AND i.position > ?
      AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
    ORDER BY i.position
    LIMIT ?
  `).all(playlistId, afterPosition, limit);
  const items = rows.map(row => {
    const sourceRemoved = row.trackUid !== null && row.folderStatus === 'removed';
    return {
      itemKey: Number(row.itemKey),
      position: Number(row.position),
      trackUid: sourceRemoved ? null : row.trackUid,
      unresolved: sourceRemoved
        ? createSourceRemovedPlaylistItem(row)
        : row.unresolvedJson === null ? null : parseStoredJson(row.unresolvedJson)
    };
  });
  return {
    playlist,
    items,
    nextPosition: items.length === limit ? items.at(-1).position : null
  };
}

function tombstonePlaylist(payload) {
  assertExactFields(payload, ['playlistId', 'expectedVersion', 'updatedAt'], 'invalidPlaylistRequest');
  const playlistId = requireString(payload.playlistId, 'playlistId', 512);
  const expectedVersion = requireNonNegativeInteger(payload.expectedVersion, 'expectedVersion');
  const updatedAt = requireNonNegativeInteger(payload.updatedAt, 'updatedAt');
  const playlist = database.prepare('SELECT state, version FROM playlists WHERE id = ?').get(playlistId);
  if (!playlist || playlist.state === 'deleted') {
    throw createCatalogError('playlistNotFound', 'Playlist does not exist');
  }
  const lease = findPlaylistLease(playlistId);
  if (lease) return { kind: 'busy', activeOperationId: lease };
  if (Number(playlist.version) !== expectedVersion) {
    return { kind: 'conflict', currentVersion: Number(playlist.version) };
  }
  return commitMutation(['playlists'], 'tombstone-playlist', () => {
    database.prepare('DELETE FROM automatic_playlist_sources WHERE playlist_id = ?').run(playlistId);
    database.prepare(`
      UPDATE playlists
      SET state = 'deleted', building_operation_id = NULL,
          version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?
    `).run(updatedAt, playlistId, expectedVersion);
    return { kind: 'tombstoned', playlistId, version: expectedVersion + 1 };
  });
}

function cleanupPlaylistItems(payload) {
  assertExactFields(payload, ['limit'], 'invalidPlaylistGcRequest');
  const limit = normalizeWriteLimit(payload.limit);
  return runDurableTransaction(() => {
    const items = database.prepare(`
      SELECT i.item_key AS itemKey
      FROM playlist_items i
      JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
      WHERE o.committed = 1 AND o.terminal_kind = 'success'
      ORDER BY o.finished_at, i.item_key
      LIMIT ?
    `).all(limit);
    const clear = database.prepare(`
      UPDATE playlist_items SET pending_operation_id = NULL WHERE item_key = ?
    `);
    for (const item of items) clear.run(item.itemKey);
    const remaining = limit - items.length;
    const pages = remaining === 0 ? [] : database.prepare(`
      SELECT p.rowid
      FROM sequence_save_pages p
      JOIN operation_jobs o ON o.operation_id = p.operation_id
      WHERE o.committed = 1 AND o.terminal_kind = 'success'
      ORDER BY o.finished_at, p.operation_id, p.segment_index, p.transport_ordinal
      LIMIT ?
    `).all(remaining);
    const deletePage = database.prepare('DELETE FROM sequence_save_pages WHERE rowid = ?');
    for (const page of pages) deletePage.run(page.rowid);
    return {
      cleanedCount: items.length,
      cleanedPageCount: pages.length,
      hasMore: items.length + pages.length === limit
    };
  });
}

function gcPlaylistItems(payload) {
  assertExactFields(payload, ['limit'], 'invalidPlaylistGcRequest');
  const limit = normalizeWriteLimit(payload.limit);
  return runDurableTransaction(() => {
    const failedItems = database.prepare(`
      SELECT i.item_key AS itemKey
      FROM playlist_items i
      JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
      WHERE o.terminal_kind IS NOT NULL
        AND (o.terminal_kind != 'success' OR o.committed = 0)
      ORDER BY o.finished_at, i.item_key
      LIMIT ?
    `).all(limit);
    const deleteItem = database.prepare('DELETE FROM playlist_items WHERE item_key = ?');
    for (const item of failedItems) deleteItem.run(item.itemKey);

    let remaining = limit - failedItems.length;
    const failedPages = remaining === 0 ? [] : database.prepare(`
      SELECT p.rowid
      FROM sequence_save_pages p
      JOIN operation_jobs o ON o.operation_id = p.operation_id
      WHERE o.terminal_kind IS NOT NULL
        AND (o.terminal_kind != 'success' OR o.committed = 0)
      ORDER BY o.finished_at, p.operation_id, p.segment_index, p.transport_ordinal
      LIMIT ?
    `).all(remaining);
    const deletePage = database.prepare('DELETE FROM sequence_save_pages WHERE rowid = ?');
    for (const page of failedPages) deletePage.run(page.rowid);
    remaining -= failedPages.length;
    const deletedItems = remaining === 0 ? [] : database.prepare(`
      SELECT i.item_key AS itemKey
      FROM playlist_items i
      JOIN playlists p ON p.id = i.playlist_id
      WHERE p.state = 'deleted'
      ORDER BY p.updated_at, i.item_key
      LIMIT ?
    `).all(remaining);
    for (const item of deletedItems) deleteItem.run(item.itemKey);

    const parentBudget = remaining - deletedItems.length;
    let deletedPlaylistCount = 0;
    if (parentBudget > 0) {
      const playlists = database.prepare(`
        SELECT p.id
        FROM playlists p
        WHERE p.state = 'deleted'
          AND NOT EXISTS (SELECT 1 FROM playlist_items i WHERE i.playlist_id = p.id)
        ORDER BY p.updated_at, p.id
        LIMIT ?
      `).all(parentBudget);
      const deletePlaylist = database.prepare('DELETE FROM playlists WHERE id = ?');
      for (const playlist of playlists) {
        deletedPlaylistCount += Number(deletePlaylist.run(playlist.id).changes);
      }
    }
    const deletedItemCount = failedItems.length + deletedItems.length;
    return {
      deletedItemCount,
      deletedPageCount: failedPages.length,
      deletedPlaylistCount,
      hasMore: deletedItemCount + failedPages.length === limit
    };
  });
}

function normalizePlaylistItem(item) {
  assertAllowedFields(item, ['trackUid', 'unresolved'], 'invalidPlaylistRequest');
  const hasTrack = item.trackUid !== undefined && item.trackUid !== null;
  const hasUnresolved = item.unresolved !== undefined && item.unresolved !== null;
  if (hasTrack === hasUnresolved) {
    throw createCatalogError('invalidPlaylistRequest', 'Playlist item must have one source');
  }
  if (hasTrack) {
    return {
      trackUid: requireString(item.trackUid, 'trackUid', 512),
      unresolvedJson: null,
      unresolvedBasename: null,
      unresolvedTitle: null,
      unresolvedArtist: null,
      unresolvedDurationBucket: null
    };
  }
  if (!isPlainObject(item.unresolved)) {
    throw createCatalogError('invalidPlaylistRequest', 'Unresolved playlist item must be an object');
  }
  const unresolvedJson = JSON.stringify(item.unresolved);
  if (Buffer.byteLength(unresolvedJson, 'utf8') > 64 * 1024) {
    throw createCatalogError('invalidPlaylistRequest', 'Unresolved playlist item is too large');
  }
  const normalized = value => modules.searchNormalizer.normalizeSearchText(
    typeof value === 'string' ? value : ''
  );
  const duration = item.unresolved.durationSec;
  return {
    trackUid: null,
    unresolvedJson,
    unresolvedBasename: normalized(item.unresolved.basename),
    unresolvedTitle: normalized(item.unresolved.title),
    unresolvedArtist: normalized(item.unresolved.artist),
    unresolvedDurationBucket: typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
      ? Math.round(duration)
      : null
  };
}

function validateBoundedResultObject(value, code) {
  if (!isPlainObject(value)) throw createCatalogError(code, 'Operation result must be an object');
  if (measureBytes(value, code) > 64 * 1024) {
    throw createCatalogError(code, 'Operation result exceeds the byte limit');
  }
  return value;
}

function assertPlaylistOperation(operationId, playlistId, { committing = false } = {}) {
  const operation = database.prepare(`
    SELECT target_identity AS targetIdentity, phase, terminal_kind AS terminalKind
    FROM operation_jobs WHERE operation_id = ?
  `).get(operationId);
  if (!operation) throw createCatalogError('operationNotFound', 'Operation does not exist');
  if (operation.terminalKind !== null) throw createCatalogError('operationTerminal', 'Operation is already terminal');
  if (operation.targetIdentity !== `playlist:${playlistId}`) {
    throw createCatalogError('playlistLeaseMismatch', 'Operation does not own this playlist');
  }
  if (committing && operation.phase === 'CANCEL_REQUESTED') {
    throw createCatalogError('operationCancelled', 'Cancelled operation cannot publish');
  }
  return operation;
}

function assertOperationCanCommit(operationId) {
  const operation = assertActiveOperation(operationId);
  if (operation.phase === 'CANCEL_REQUESTED') {
    throw createCatalogError('operationCancelled', 'Cancelled operation cannot publish');
  }
  return operation;
}

function findPlaylistLease(playlistId, exceptOperationId = null) {
  const row = database.prepare(`
    SELECT operation_id AS operationId
    FROM operation_jobs
    WHERE target_identity = ? AND terminal_kind IS NULL
      AND (? IS NULL OR operation_id != ?)
    ORDER BY operation_id
    LIMIT 1
  `).get(`playlist:${playlistId}`, exceptOperationId, exceptOperationId);
  return row ? row.operationId : null;
}

function createOperationTargetIdentity(target) {
  if (target === null) return null;
  if (!isPlainObject(target)) {
    throw createCatalogError('invalidOperationRequest', 'Operation target must be an object or null');
  }
  measureBytes(target, 'invalidOperationRequest');
  if (typeof target.playlistId === 'string' && target.playlistId.length > 0) {
    return `playlist:${requireString(target.playlistId, 'playlistId', 512)}`;
  }
  return JSON.stringify(target);
}

function assertActiveOperation(operationId) {
  const operation = database.prepare(`
    SELECT terminal_kind AS terminalKind, phase FROM operation_jobs WHERE operation_id = ?
  `).get(operationId);
  if (!operation) throw createCatalogError('operationNotFound', 'Operation does not exist');
  if (operation.terminalKind !== null) throw createCatalogError('operationTerminal', 'Operation is already terminal');
  return operation;
}

function parseStoredJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw createCatalogError('catalogCorrupt', 'Stored operation result is invalid');
  }
}

function runDurableTransaction(callback) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    database.exec('COMMIT');
    pruneExpiredContexts();
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // The original write error is the actionable failure.
    }
    throw error;
  }
}

function getTrack(payload) {
  assertExactFields(payload, ['trackUid'], 'invalidTrackRequest');
  const trackUid = requireString(payload.trackUid, 'trackUid', 512);
  const row = database.prepare(`
    SELECT
      t.track_uid AS trackUid,
      t.folder_id AS folderId,
      t.relative_path AS relativePath,
      t.source_kind AS sourceKind,
      t.entry_key AS entryKey,
      t.cue_relative_path AS cueRelativePath,
      t.start_frame AS startFrame,
      t.end_frame AS endFrame,
      t.file_name AS fileName,
      t.title,
      t.artist,
      t.album_artist AS albumArtist,
      t.album,
      t.genre,
      t.album_key AS albumKey,
      t.artist_key AS artistKey,
      t.genre_key AS genreKey,
      t.subfolder_key AS subfolderKey,
      t.year,
      t.compilation,
      t.disc_no AS discNo,
      t.disc_total AS discTotal,
      t.track_no AS trackNo,
      t.track_total AS trackTotal,
      t.duration_sec AS durationSec,
      t.sample_rate AS sampleRate,
      t.bitrate,
      t.bits_per_sample AS bitsPerSample,
      t.channels,
      t.codec,
      t.metadata_status AS metadataStatus,
      t.metadata_error_code AS metadataErrorCode,
      t.artwork_id AS artworkId,
      t.added_at AS addedAt,
      t.updated_at AS updatedAt
    FROM tracks t
    JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
    WHERE t.track_uid = ?
  `).get(trackUid);
  return row ? withPhysicalSourceKey(row) : null;
}

function getTrackStorageIdentity(payload) {
  assertExactFields(payload, ['trackUid'], 'invalidTrackRequest');
  const trackUid = requireString(payload.trackUid, 'trackUid', 512);
  const row = database.prepare(`
    SELECT t.track_uid AS trackUid, t.folder_id AS folderId, t.relative_path AS relativePath,
      t.source_kind AS sourceKind, t.entry_key AS entryKey,
      t.cue_relative_path AS cueRelativePath, t.start_frame AS startFrame, t.end_frame AS endFrame,
      t.duration_sec AS durationSec,
      t.file_identity AS fileIdentity, t.size, t.mtime_ms AS mtimeMs,
      f.lifecycle_version AS lifecycleVersion
    FROM tracks t
    JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
    WHERE t.track_uid = ?
  `).get(trackUid);
  return row ? withPhysicalSourceKey(row) : null;
}

function getCachedArtwork(payload) {
  assertExactFields(payload, ['trackUid'], 'invalidArtworkRequest');
  const trackUid = requireString(payload.trackUid, 'trackUid', 512);
  const row = database.prepare(`
    SELECT s.artwork_id AS artworkId, v.bytes, v.width, v.height,
      v.content_type AS mimeType
    FROM tracks t
    JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
    JOIN track_artwork_sources s ON s.track_uid = t.track_uid
      AND s.file_identity IS t.file_identity
      AND s.size IS t.size
      AND s.mtime_ms IS t.mtime_ms
      AND s.lifecycle_version IS f.lifecycle_version
      AND s.artwork_id IS t.artwork_id
    JOIN artwork_variants v ON v.artwork_id = s.artwork_id AND v.variant = 'thumbnail'
    WHERE t.track_uid = ?
  `).get(trackUid);
  if (!row?.bytes) return null;
  const accessedAt = Date.now();
  database.prepare(`
    UPDATE artwork_variants SET last_accessed_at = ?
    WHERE artwork_id = ? AND variant = 'thumbnail'
  `).run(accessedAt, row.artworkId);
  database.prepare('UPDATE artwork_assets SET last_accessed_at = ? WHERE id = ?')
    .run(accessedAt, row.artworkId);
  return {
    kind: 'thumbnail',
    artworkId: row.artworkId,
    bytes: new Uint8Array(row.bytes),
    width: Number(row.width),
    height: Number(row.height),
    mimeType: row.mimeType
  };
}

function beginArtworkUtilitySession(payload) {
  assertExactFields(payload, ['utilitySessionId'], 'invalidArtworkRequest');
  activeArtworkUtilitySession = requireString(payload.utilitySessionId, 'utilitySessionId', 512);
  database.prepare('DELETE FROM artwork_claims').run();
  return { accepted: true };
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

function claimArtworkSource(payload) {
  assertExactFields(payload, ['claim'], 'invalidArtworkRequest');
  const claim = normalizeArtworkSourceClaim(payload.claim, { requireClaimId: false });
  if (!activeArtworkUtilitySession || claim.utilitySessionId !== activeArtworkUtilitySession ||
      !artworkPreclaimMatchesCurrentTrack(claim)) return { claim: null };
  const claimed = { ...claim, claimId: `art_claim_${randomUUID()}` };
  database.prepare(`
    INSERT INTO artwork_claims(
      claim_id, track_uid, utility_session_id, source_json, status, claimed_at
    ) VALUES (?, ?, ?, ?, 'extracting', ?)
    ON CONFLICT(track_uid) DO UPDATE SET
      claim_id = excluded.claim_id, utility_session_id = excluded.utility_session_id,
      source_json = excluded.source_json, status = 'extracting', claimed_at = excluded.claimed_at,
      admitted_at = NULL, admitted_thumbnail_bytes = NULL
  `).run(
    claimed.claimId, claimed.trackUid, claimed.utilitySessionId,
    canonicalArtworkClaimJson(claimed), Date.now()
  );
  return { claim: claimed };
}

function bindArtworkSourceDetails(payload) {
  assertExactFields(payload, ['claim', 'fileStat', 'embeddedOffset', 'embeddedLength', 'mimeType'], 'invalidArtworkRequest');
  const preliminary = normalizeArtworkSourceClaim(payload.claim, { requireClaimId: true });
  const fileStat = normalizeArtworkFileStat(payload.fileStat);
  const embeddedOffset = optionalNullableNonNegativeInteger(payload.embeddedOffset, 'embeddedOffset');
  const embeddedLength = requireNonNegativeInteger(payload.embeddedLength, 'embeddedLength');
  const mimeType = requireString(payload.mimeType, 'mimeType', 128);
  if (embeddedLength === 0 || embeddedLength > MAX_ARTWORK_RAW_BYTES ||
      embeddedLength > preliminary.size || (embeddedOffset != null && embeddedOffset + embeddedLength > preliminary.size)) {
    return { claim: null };
  }
  if (fileStat.size !== preliminary.size || fileStat.mtimeMs !== preliminary.mtimeMs) return { claim: null };
  const row = database.prepare(`
    SELECT source_json AS sourceJson, utility_session_id AS utilitySessionId, status
    FROM artwork_claims WHERE claim_id = ? AND track_uid = ?
  `).get(preliminary.claimId, preliminary.trackUid);
  if (row?.status !== 'extracting' || row.utilitySessionId !== activeArtworkUtilitySession ||
      row.sourceJson !== canonicalArtworkClaimJson(preliminary) || !artworkPreclaimMatchesCurrentTrack(preliminary)) {
    return { claim: null };
  }
  const track = getArtworkTrack(preliminary.trackUid);
  const bound = {
    ...preliminary,
    canonicalSourceIdentity: `${track.relativePath}#embedded:${embeddedOffset ?? 'unknown'}:${embeddedLength}:${mimeType}`,
    embeddedOffset,
    embeddedLength
  };
  if (!artworkClaimMatchesCurrentTrack(bound)) return { claim: null };
  const changed = database.prepare(`
    UPDATE artwork_claims SET source_json = ?
    WHERE claim_id = ? AND track_uid = ? AND source_json = ? AND status = 'extracting'
  `).run(
    canonicalArtworkClaimJson(bound), bound.claimId, bound.trackUid,
    canonicalArtworkClaimJson(preliminary)
  );
  return Number(changed.changes) === 1 ? { claim: bound } : { claim: null };
}

function preflightArtworkBatch(payload) {
  assertExactFields(
    payload,
    ['claim', 'estimatedRawBytes', 'estimatedThumbnailBytes', 'cachePolicy'],
    'invalidArtworkRequest'
  );
  const claim = normalizeArtworkSourceClaim(payload.claim, { requireClaimId: true });
  if (!artworkClaimIsCurrent(claim)) return { ok: false, code: 'staleArtworkClaim' };
  const rawBytes = requireNonNegativeInteger(payload.estimatedRawBytes, 'estimatedRawBytes');
  const thumbnailBytes = requireNonNegativeInteger(payload.estimatedThumbnailBytes, 'estimatedThumbnailBytes');
  if (rawBytes > MAX_ARTWORK_RAW_BYTES || thumbnailBytes > MAX_ARTWORK_THUMBNAIL_BYTES) {
    return { ok: false, code: 'artworkRawTooLarge' };
  }
  const cachePolicy = normalizeArtworkCachePolicy(payload.cachePolicy);
  const cacheBytes = Number(database.prepare(`
    SELECT COALESCE(SUM(byte_length), 0) AS bytes FROM artwork_variants WHERE variant = 'thumbnail'
  `).get().bytes);
  if (cacheBytes + thumbnailBytes > cachePolicy.maxBytes) {
    return { ok: false, code: 'artwork-cache-full', cacheBytes, maximumBytes: cachePolicy.maxBytes };
  }
  const storage = artworkStorageAdmission(rawBytes + thumbnailBytes * 2);
  if (storage.ok) {
    database.prepare(`
      UPDATE artwork_claims SET admitted_at = ?, admitted_thumbnail_bytes = ?
      WHERE claim_id = ? AND track_uid = ? AND status = 'extracting'
    `).run(Date.now(), thumbnailBytes, claim.claimId, claim.trackUid);
  }
  return { ...storage, cacheBytes, maximumBytes: cachePolicy.maxBytes };
}

function publishArtwork(payload) {
  assertExactFields(payload, ['claim', 'expectedSourceClaim', 'cachePolicy', 'thumbnail'], 'invalidArtworkRequest');
  const expectedSource = normalizeArtworkSourceClaim(payload.expectedSourceClaim, { requireClaimId: true });
  const claim = normalizeArtworkSourceClaim(payload.claim, { requireClaimId: true });
  normalizeArtworkCachePolicy(payload.cachePolicy);
  if (!artworkSourceSignaturesEqual(claim, expectedSource) || !artworkClaimIsCurrent(claim, { requireAdmission: true })) {
    return { committed: false };
  }
  const trackUid = claim.trackUid;
  const thumbnail = normalizeArtworkThumbnail(payload.thumbnail);
  const admitted = database.prepare(`
    SELECT admitted_thumbnail_bytes AS admittedThumbnailBytes
    FROM artwork_claims WHERE claim_id = ?
  `).get(claim.claimId);
  if (!admitted || thumbnail.bytes.byteLength > Number(admitted.admittedThumbnailBytes)) {
    return { committed: false };
  }

  const digest = createHash('sha256').update(thumbnail.bytes).digest('hex');
  const deterministicArtworkId = `art_${digest}`;
  // Lazy artwork is returned directly to its requester and does not change page membership or order.
  return commitMutation(
    ['artwork'],
    'artwork-publish',
    () => {
      if (!artworkClaimIsCurrent(claim, { requireAdmission: true })) return { committed: false };
      const current = getArtworkTrack(trackUid);
      if (!current) return { committed: false };
      const now = Date.now();
      const existingAsset = database.prepare(`
        SELECT id FROM artwork_assets
        WHERE digest_algorithm = 'sha256' AND digest_version = 1 AND full_digest = ?
      `).get(digest);
      const artworkId = existingAsset?.id ?? deterministicArtworkId;
      if (!existingAsset) {
        database.prepare(`
          INSERT INTO artwork_assets(
            id, digest_algorithm, digest_version, full_digest, byte_length,
            content_type, source_kind, ref_count, last_accessed_at
          ) VALUES (?, 'sha256', 1, ?, ?, ?, 'embedded-file-thumbnail', 0, ?)
        `).run(artworkId, digest, thumbnail.bytes.byteLength, thumbnail.mimeType, now);
      } else {
        database.prepare('UPDATE artwork_assets SET last_accessed_at = ? WHERE id = ?').run(now, artworkId);
      }
      database.prepare(`
        INSERT INTO artwork_variants(
          artwork_id, variant, byte_length, content_type, width, height,
          storage_locator, bytes, last_accessed_at
        ) VALUES (?, 'thumbnail', ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(artwork_id, variant) DO UPDATE SET
          last_accessed_at = excluded.last_accessed_at
      `).run(
        artworkId, thumbnail.bytes.byteLength, thumbnail.mimeType,
        thumbnail.width, thumbnail.height, thumbnail.bytes, now
      );
      if (current.artworkId !== artworkId) {
        if (current.artworkId) {
          database.prepare(`
            UPDATE artwork_assets SET ref_count = CASE WHEN ref_count > 0 THEN ref_count - 1 ELSE 0 END
            WHERE id = ?
          `).run(current.artworkId);
        }
        database.prepare('UPDATE artwork_assets SET ref_count = ref_count + 1 WHERE id = ?').run(artworkId);
      }
      database.prepare('UPDATE tracks SET artwork_id = ?, updated_at = ? WHERE track_uid = ?')
        .run(artworkId, now, trackUid);
      database.prepare(`
        INSERT INTO track_artwork_sources(
          track_uid, file_identity, size, mtime_ms, artwork_id, updated_at,
          lifecycle_version, source_kind, canonical_source_identity,
          embedded_offset, embedded_length, external_artwork_stat_json, extractor_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(track_uid) DO UPDATE SET
          file_identity = excluded.file_identity, size = excluded.size,
          mtime_ms = excluded.mtime_ms, artwork_id = excluded.artwork_id,
          updated_at = excluded.updated_at, lifecycle_version = excluded.lifecycle_version,
          source_kind = excluded.source_kind,
          canonical_source_identity = excluded.canonical_source_identity,
          embedded_offset = excluded.embedded_offset, embedded_length = excluded.embedded_length,
          external_artwork_stat_json = excluded.external_artwork_stat_json,
          extractor_version = excluded.extractor_version
      `).run(
        trackUid, expectedSource.fileIdentity, expectedSource.size,
        expectedSource.mtimeMs, artworkId, now, expectedSource.lifecycleVersion,
        expectedSource.sourceKind, expectedSource.canonicalSourceIdentity,
        expectedSource.embeddedOffset, expectedSource.embeddedLength,
        expectedSource.externalArtworkStat == null ? null : JSON.stringify(expectedSource.externalArtworkStat),
        expectedSource.extractorVersion
      );
      database.prepare('DELETE FROM artwork_claims WHERE claim_id = ?').run(claim.claimId);
      recomputeArtworkAggregateRowsForTrack(trackUid);
      return {
        committed: true,
        artwork: {
          kind: 'thumbnail', artworkId, bytes: new Uint8Array(thumbnail.bytes),
          width: thumbnail.width, height: thumbnail.height, mimeType: thumbnail.mimeType
        }
      };
    }
  );
}

function recordArtworkFailure(payload) {
  assertExactFields(
    payload,
    ['claim', 'errorCode', 'placeholder', 'preserveExistingArtwork'],
    'invalidArtworkRequest'
  );
  const claim = normalizeArtworkSourceClaim(payload.claim, { requireClaimId: true });
  requireString(payload.errorCode, 'errorCode', 128);
  if (payload.placeholder !== true || payload.preserveExistingArtwork !== true) {
    throw createCatalogError('invalidArtworkRequest', 'Artwork failure contract is invalid');
  }
  if (!artworkClaimIsCurrent(claim)) return { committed: false };
  database.prepare('DELETE FROM artwork_claims WHERE claim_id = ?').run(claim.claimId);
  return { committed: true };
}

function scheduleArtworkStagingGc(payload) {
  assertExactFields(payload, ['claim', 'reason'], 'invalidArtworkRequest');
  const claim = normalizeArtworkSourceClaim(payload.claim, { requireClaimId: true });
  requireString(payload.reason, 'reason', 128);
  const result = database.prepare('DELETE FROM artwork_claims WHERE claim_id = ? AND track_uid = ?')
    .run(claim.claimId, claim.trackUid);
  return { scheduled: Number(result.changes) > 0 };
}

function evictArtworkCache(payload) {
  assertExactFields(payload, ['mode', 'maxBytes', 'requiredBytes', 'policy'], 'invalidArtworkRequest');
  if (payload.mode !== 'persistent' || payload.policy !== 'lru-access-time-byte-length') {
    throw createCatalogError('invalidArtworkRequest', 'Artwork eviction policy is invalid');
  }
  const maxBytes = requireNonNegativeInteger(payload.maxBytes, 'maxBytes');
  const requiredBytes = requireNonNegativeInteger(payload.requiredBytes, 'requiredBytes');
  let cacheBytes = Number(database.prepare(`SELECT COALESCE(SUM(byte_length), 0) AS bytes FROM artwork_variants`).get().bytes);
  let evictedBytes = 0;
  const candidates = database.prepare(`
    SELECT artwork_id AS artworkId, variant, byte_length AS bytes
    FROM artwork_variants
    ORDER BY last_accessed_at, artwork_id, variant LIMIT 1024
  `).all();
  for (const candidate of candidates) {
    if (cacheBytes + requiredBytes <= maxBytes) break;
    database.prepare('DELETE FROM artwork_variants WHERE artwork_id = ? AND variant = ?')
      .run(candidate.artworkId, candidate.variant);
    cacheBytes -= Number(candidate.bytes);
    evictedBytes += Number(candidate.bytes);
  }
  return { evictedBytes, cacheBytes };
}

function normalizeArtworkSourceClaim(value, { requireClaimId }) {
  if (!isPlainObject(value)) throw createCatalogError('invalidArtworkRequest', 'Artwork source signature is required');
  const fields = [
    'folderId', 'lifecycleVersion', 'trackUid', 'sourceKind', 'canonicalSourceIdentity',
    'fileIdentity', 'size', 'mtimeMs', 'embeddedOffset', 'embeddedLength',
    'externalArtworkStat', 'extractorVersion', 'utilitySessionId'
  ];
  if (requireClaimId) fields.push('claimId');
  assertExactFields(value, fields, 'invalidArtworkRequest');
  const sourceKind = requireString(value.sourceKind, 'sourceKind', 128);
  if (!['embedded-file', 'external-file'].includes(sourceKind)) {
    throw createCatalogError('invalidArtworkRequest', 'Artwork source kind is invalid');
  }
  return {
    folderId: requireString(value.folderId, 'folderId', 512),
    lifecycleVersion: requireNonNegativeInteger(value.lifecycleVersion, 'lifecycleVersion'),
    trackUid: requireString(value.trackUid, 'trackUid', 512),
    sourceKind,
    canonicalSourceIdentity: requireString(value.canonicalSourceIdentity, 'canonicalSourceIdentity', 4096),
    fileIdentity: requireString(value.fileIdentity, 'fileIdentity', 2048),
    size: requireNonNegativeInteger(value.size, 'size'),
    mtimeMs: requireNonNegativeInteger(value.mtimeMs, 'mtimeMs'),
    embeddedOffset: optionalNullableNonNegativeInteger(value.embeddedOffset, 'embeddedOffset'),
    embeddedLength: optionalNullableNonNegativeInteger(value.embeddedLength, 'embeddedLength'),
    externalArtworkStat: normalizeExternalArtworkStat(value.externalArtworkStat),
    extractorVersion: requireString(value.extractorVersion, 'extractorVersion', 256),
    utilitySessionId: requireString(value.utilitySessionId, 'utilitySessionId', 512),
    ...(requireClaimId ? { claimId: requireString(value.claimId, 'claimId', 512) } : {})
  };
}

function normalizeArtworkThumbnail(value) {
  if (!isPlainObject(value)) throw createCatalogError('invalidArtworkRequest', 'Artwork thumbnail is required');
  assertExactFields(value, ['bytes', 'width', 'height', 'mimeType'], 'invalidArtworkRequest');
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength === 0 || value.bytes.byteLength > 512 * 1024) {
    throw createCatalogError('invalidArtworkRequest', 'Artwork thumbnail bytes exceed the allowed bounds');
  }
  const width = requireNonNegativeInteger(value.width, 'thumbnail.width');
  const height = requireNonNegativeInteger(value.height, 'thumbnail.height');
  if (width === 0 || height === 0 || width > 512 || height > 512) {
    throw createCatalogError('invalidArtworkRequest', 'Artwork thumbnail dimensions exceed the allowed bounds');
  }
  const mimeType = requireString(value.mimeType, 'thumbnail.mimeType', 128);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw createCatalogError('invalidArtworkRequest', 'Artwork thumbnail media type is unsupported');
  }
  return { bytes: Buffer.from(value.bytes), width, height, mimeType };
}

function artworkSourceSignaturesEqual(left, right) {
  return canonicalArtworkClaimJson(left) === canonicalArtworkClaimJson(right) &&
    String(left.claimId ?? '') === String(right.claimId ?? '');
}

function getArtworkTrack(trackUid) {
  return database.prepare(`
    SELECT t.track_uid AS trackUid, t.folder_id AS folderId,
      t.relative_path AS relativePath, t.file_identity AS fileIdentity,
      t.size, t.mtime_ms AS mtimeMs, t.artwork_id AS artworkId,
      f.lifecycle_version AS lifecycleVersion
    FROM tracks t
    JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
    WHERE t.track_uid = ?
  `).get(trackUid) || null;
}

function artworkClaimMatchesCurrentTrack(claim) {
  if (claim.utilitySessionId !== activeArtworkUtilitySession) return false;
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
  } else if (!claim.externalArtworkStat || claim.embeddedOffset !== null || claim.embeddedLength !== null) {
    return false;
  }
  return true;
}

function artworkPreclaimMatchesCurrentTrack(claim) {
  if (claim.utilitySessionId !== activeArtworkUtilitySession || claim.sourceKind !== 'embedded-file' ||
      claim.embeddedOffset !== null || claim.embeddedLength !== null || claim.externalArtworkStat !== null) return false;
  const track = getArtworkTrack(claim.trackUid);
  return Boolean(track) && track.folderId === claim.folderId &&
    Number(track.lifecycleVersion) === claim.lifecycleVersion &&
    String(track.fileIdentity ?? '') === claim.fileIdentity && Number(track.size) === claim.size &&
    Number(track.mtimeMs) === claim.mtimeMs && claim.canonicalSourceIdentity === track.relativePath;
}

function normalizeArtworkFileStat(value) {
  if (!isPlainObject(value)) throw createCatalogError('invalidArtworkRequest', 'Artwork file stat is required');
  assertExactFields(value, ['size', 'mtimeMs'], 'invalidArtworkRequest');
  return {
    size: requireNonNegativeInteger(value.size, 'fileStat.size'),
    mtimeMs: requireNonNegativeInteger(value.mtimeMs, 'fileStat.mtimeMs')
  };
}

function artworkClaimIsCurrent(claim, { requireAdmission = false } = {}) {
  if (!artworkClaimMatchesCurrentTrack(claim)) return false;
  const row = database.prepare(`
    SELECT utility_session_id AS utilitySessionId, source_json AS sourceJson, status,
      admitted_at AS admittedAt
    FROM artwork_claims WHERE claim_id = ? AND track_uid = ?
  `).get(claim.claimId, claim.trackUid);
  return row?.status === 'extracting' && (!requireAdmission || row.admittedAt != null) &&
    row.utilitySessionId === activeArtworkUtilitySession &&
    row.sourceJson === canonicalArtworkClaimJson(claim);
}

function canonicalArtworkClaimJson(claim) {
  return JSON.stringify({
    folderId: claim.folderId,
    lifecycleVersion: Number(claim.lifecycleVersion),
    trackUid: claim.trackUid,
    sourceKind: claim.sourceKind,
    canonicalSourceIdentity: claim.canonicalSourceIdentity,
    fileIdentity: claim.fileIdentity,
    size: Number(claim.size),
    mtimeMs: Number(claim.mtimeMs),
    embeddedOffset: claim.embeddedOffset ?? null,
    embeddedLength: claim.embeddedLength ?? null,
    externalArtworkStat: claim.externalArtworkStat ?? null,
    extractorVersion: claim.extractorVersion,
    utilitySessionId: claim.utilitySessionId
  });
}

function normalizeExternalArtworkStat(value) {
  if (value === null) return null;
  if (!isPlainObject(value)) {
    throw createCatalogError('invalidArtworkRequest', 'External artwork stat is invalid');
  }
  assertExactFields(value, ['fileIdentity', 'size', 'mtimeMs'], 'invalidArtworkRequest');
  return {
    fileIdentity: requireString(value.fileIdentity, 'externalArtworkStat.fileIdentity', 2048),
    size: requireNonNegativeInteger(value.size, 'externalArtworkStat.size'),
    mtimeMs: requireNonNegativeInteger(value.mtimeMs, 'externalArtworkStat.mtimeMs')
  };
}

function normalizeArtworkCachePolicy(value) {
  if (!isPlainObject(value)) throw createCatalogError('invalidArtworkRequest', 'Artwork cache policy is required');
  assertExactFields(value, ['mode', 'maxBytes'], 'invalidArtworkRequest');
  if (value.mode !== 'persistent') {
    throw createCatalogError('invalidArtworkRequest', 'Electron artwork cache must be persistent');
  }
  const maxBytes = requireNonNegativeInteger(value.maxBytes, 'cachePolicy.maxBytes');
  if (maxBytes === 0 || maxBytes > 512 * 1024 * 1024) {
    throw createCatalogError('invalidArtworkRequest', 'Artwork cache byte cap is invalid');
  }
  return { mode: 'persistent', maxBytes };
}

function artworkStorageAdmission(estimatedWriteBytes) {
  try {
    const stats = fs.statfsSync(path.dirname(workerData.dbPath));
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    const capacityBytes = Number(stats.blocks) * Number(stats.bsize);
    const proportionalFloor = Number.isFinite(capacityBytes) ? Math.floor(capacityBytes * 0.1) : 0;
    const safetyFloorBytes = Math.max(
      ARTWORK_STORAGE_SAFETY_MIN_BYTES,
      Math.min(ARTWORK_STORAGE_SAFETY_MAX_BYTES, proportionalFloor)
    );
    const requiredAvailableBytes = safetyFloorBytes + estimatedWriteBytes;
    return {
      ok: Number.isFinite(availableBytes) && availableBytes >= requiredAvailableBytes,
      code: Number.isFinite(availableBytes) && availableBytes >= requiredAvailableBytes
        ? null : 'insufficientStorage',
      availableBytes: Number.isFinite(availableBytes) ? availableBytes : 0,
      requiredAvailableBytes,
      safetyFloorBytes
    };
  } catch {
    return {
      ok: false,
      code: 'insufficientStorage',
      availableBytes: 0,
      requiredAvailableBytes: ARTWORK_STORAGE_SAFETY_MIN_BYTES + estimatedWriteBytes,
      safetyFloorBytes: ARTWORK_STORAGE_SAFETY_MIN_BYTES
    };
  }
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
  const folders = database.prepare(`
    SELECT id, kind, display_name AS displayName, path, status,
      scan_generation AS scanGeneration, lifecycle_version AS lifecycleVersion,
      added_at AS addedAt, last_scan_at AS lastScanAt
    FROM folders WHERE ${clauses.join(' AND ')} ORDER BY id
  `).all(...bindings).map(row => ({ ...row, lifecycleVersion: Number(row.lifecycleVersion) }));
  return { folders };
}

function getScanFolderTrackCount(payload) {
  assertAllowedFields(payload, ['folderId'], 'invalidScanFolderRequest');
  const folderId = requireString(payload.folderId, 'folderId', 512);
  const row = database.prepare(`
    SELECT count(t.track_uid) AS trackCount
    FROM folders f LEFT JOIN tracks t ON t.folder_id = f.id
    WHERE f.id = ?
    GROUP BY f.id
  `).get(folderId);
  if (!row) throw createCatalogError('folderUnavailable', 'Library folder is unavailable');
  return { folderId, trackCount: Number(row.trackCount) };
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
    const existing = database.prepare(`
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
      database.prepare('UPDATE folders SET scan_generation = ? WHERE id = ?').run(generation, folderId);
      database.prepare('DELETE FROM scan_seen WHERE scan_id = ? AND folder_id = ?').run(scanId, folderId);
      database.prepare('DELETE FROM scan_logical_seen WHERE scan_id = ? AND folder_id = ?').run(scanId, folderId);
    }
    const now = Date.now();
    database.prepare(`
      INSERT INTO scan_runs(id, status, started_at) VALUES (?, 'running', ?)
      ON CONFLICT(id) DO UPDATE SET status = 'running', finished_at = NULL, stop_reason = NULL
    `).run(scanId, now);
    database.prepare(`
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
      existing?.parserVersion ?? 'catalog-metadata-v3', resume ? 'resumed-generation' : null,
      Number(existing?.enumerationErrorCount ?? 0), Number(existing?.visitedFiles ?? 0),
      Number(existing?.committedBatches ?? 0), now
    );
    clearCueScanStageRows({ scanId, folderId });
    return {
      scanId,
      folderId,
      generation,
      lifecycleVersion,
      parserVersion: existing?.parserVersion ?? 'catalog-metadata-v3',
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

function completePendingScanSweepRecovery(folderId) {
  const pending = [...pendingScanSweepRecoveries.values()]
    .find(identity => identity.folderId === folderId);
  if (!pending) return;
  try {
    let sweep;
    do {
      sweep = runScanSweep(pending);
    } while (sweep.hasMore === true);
    completeScanFolder({ ...pending, status: 'completed' });
  } catch (error) {
    scheduleDeletionMaintenance();
    throw error;
  }
}

function preflightScanBatch(payload) {
  assertAllowedFields(payload, [
    'scanId', 'folderId', 'generation', 'expectedLifecycleVersion',
    'estimatedTrackCount', 'estimatedBatchBytes', 'initial'
  ], 'invalidScanRequest');
  const estimatedBytes = Math.max(
    Number(payload.estimatedBatchBytes ?? 0),
    Number(payload.estimatedTrackCount ?? 0) * 1024
  );
  try {
    const stats = fs.statfsSync(path.dirname(workerData.dbPath));
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    const requiredAvailableBytes = Math.max(8 * 1024 * 1024, estimatedBytes * 2);
    return {
      ok: Number.isFinite(availableBytes) && availableBytes >= requiredAvailableBytes,
      availableBytes,
      requiredAvailableBytes,
      shortfallBytes: Math.max(0, requiredAvailableBytes - availableBytes)
    };
  } catch {
    return { ok: false, availableBytes: 0, requiredAvailableBytes: estimatedBytes, shortfallBytes: estimatedBytes };
  }
}

function commitScanSeenBatch(payload) {
  assertAllowedFields(payload, [
    'scanId', 'folderId', 'generation', 'expectedLifecycleVersion', 'observations',
    'maxTracks', 'maxBytes', 'lastCommittedBatch', 'cursor'
  ], 'invalidScanRequest');
  const observations = validateBatch(payload.observations, 'observations');
  const logicalRows = observations.reduce((count, observation) =>
    count + Math.max(1, Array.isArray(observation.logicalCandidates) ? observation.logicalCandidates.length : 1), 0);
  if (observations.length < 1 || logicalRows > 500 || measureBytes(observations, 'batchTooLarge') > 4 * 1024 * 1024) {
    throw createCatalogError('batchLimitExceeded', 'Scan batch exceeds 500 rows or 4 MiB');
  }
  const identity = requireScanIdentity(payload);
  return runDurableTransaction(() => {
    requireActiveScanFolder(identity.folderId, identity.lifecycleVersion);
    const state = requireScanState(identity);
    const batchNumber = requirePositiveInteger(payload.lastCommittedBatch, 'lastCommittedBatch');
    if (batchNumber !== Number(state.committedBatches) + 1) {
      throw createCatalogError('staleScanCursor', 'Scan batch coordinate is not monotonic');
    }
    if (!isPlainObject(payload.cursor)) {
      throw createCatalogError('invalidScanRequest', 'Scan batch cursor is invalid');
    }
    assertExactFields(payload.cursor, ['lastRelativePath', 'visitedFiles', 'committedBatches'], 'invalidScanRequest');
    const visitedFiles = requireNonNegativeInteger(payload.cursor.visitedFiles, 'cursor.visitedFiles');
    if (
      visitedFiles !== Number(state.visitedFiles) + observations.length ||
      requirePositiveInteger(payload.cursor.committedBatches, 'cursor.committedBatches') !== batchNumber
    ) {
      throw createCatalogError('staleScanCursor', 'Scan visited-file coordinate is not monotonic');
    }
    const upsert = database.prepare(`
      INSERT INTO scan_seen(
        scan_id, folder_id, relative_path, canonical_path, file_identity, size, mtime_ms,
        observation_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_id, folder_id, relative_path) DO UPDATE SET
        canonical_path = excluded.canonical_path,
        file_identity = excluded.file_identity,
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        observation_sequence = excluded.observation_sequence
    `);
    const upsertLogical = database.prepare(`
      INSERT INTO scan_logical_seen(
        scan_id, folder_id, logical_storage_id, relative_path, canonical_path,
        file_identity, size, mtime_ms, observation_sequence, source_kind, entry_key,
        cue_relative_path, start_frame, end_frame, cue_signature, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_id, folder_id, logical_storage_id) DO UPDATE SET
        relative_path = excluded.relative_path, canonical_path = excluded.canonical_path,
        file_identity = excluded.file_identity, size = excluded.size, mtime_ms = excluded.mtime_ms,
        observation_sequence = excluded.observation_sequence, source_kind = excluded.source_kind,
        entry_key = excluded.entry_key, cue_relative_path = excluded.cue_relative_path,
        start_frame = excluded.start_frame, end_frame = excluded.end_frame,
        cue_signature = excluded.cue_signature, metadata_json = excluded.metadata_json
    `);
    if (logicalRows > requirePositiveInteger(payload.maxTracks, 'maxTracks')) {
      throw createCatalogError('batchLimitExceeded', 'Scan batch exceeds its configured row limit');
    }
    const batchBase = Number(state.visitedFiles);
    let lastRelativePath = null;
    let logicalSequence = Number(database.prepare(`
      SELECT COALESCE(MAX(observation_sequence), -1) AS value
      FROM scan_logical_seen WHERE scan_id = ? AND folder_id = ?
    `).get(identity.scanId, identity.folderId).value) + 1;
    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index];
      const relativePath = normalizeRelativePath(requireString(observation.relativePath, 'relativePath', 32768));
      lastRelativePath = relativePath;
      upsert.run(
        identity.scanId, identity.folderId, relativePath,
        optionalNullableString(observation.path, 32768),
        optionalString(observation.fileIdentity, '', 2048),
        requireNonNegativeInteger(observation.size, 'size'),
        requireNonNegativeInteger(Math.round(observation.mtimeMs), 'mtimeMs'),
        batchBase + index
      );
      const logicalCandidates = Array.isArray(observation.logicalCandidates)
        ? observation.logicalCandidates
        : [createPlainScanLogicalCandidate(observation, relativePath)];
      for (const candidate of logicalCandidates) {
        const logical = normalizeScanLogicalCandidate(candidate, observation, relativePath);
        upsertLogical.run(
          identity.scanId, identity.folderId, logical.logicalStorageId, logical.relativePath,
          logical.path, logical.fileIdentity, logical.size, logical.mtimeMs, logicalSequence++,
          logical.sourceKind, logical.entryKey, logical.cueRelativePath, logical.startFrame,
          logical.endFrame, logical.cueSignature, logical.metadataJson
        );
      }
    }
    if (payload.cursor.lastRelativePath !== lastRelativePath) {
      throw createCatalogError('staleScanCursor', 'Scan cursor does not match the committed batch');
    }
    database.prepare(`
      UPDATE scan_run_folders SET status = 'committing', durable_cursor = ?,
        visited_files = ?, committed_batches = ?, updated_at = ?
      WHERE scan_id = ? AND folder_id = ? AND generation = ?
    `).run(
      JSON.stringify(payload.cursor), visitedFiles,
      batchNumber, Date.now(),
      identity.scanId, identity.folderId, identity.generation
    );
    return { committed: observations.length };
  });
}

function cueDirectoryStage(payload) {
  const identity = requireScanIdentity(payload);
  const action = requireString(payload.action, 'action', 64);
  const directoryPath = normalizeCueStageDirectory(payload.directoryPath);
  requireScanState(identity);
  const context = { identity, directoryPath, payload };
  switch (action) {
    case 'reset':
    case 'clear': return resetCueDirectoryStage(context);
    case 'append-entries': return appendCueDirectoryStageEntries(context);
    case 'list-files': return listCueDirectoryStageFiles(context);
    case 'get-file': return getCueDirectoryStageFile(context);
    case 'update-observations': return updateCueDirectoryStageObservations(context);
    case 'resolve-references': return resolveCueDirectoryStageReferences(context);
    case 'stage-sheet': return stageCueDirectorySheet(context);
    case 'list-sources': return listCueDirectoryStageSources(context);
    case 'update-source': return updateCueDirectoryStageSource(context);
    case 'list-sheets': return listCueDirectoryStageSheets(context);
    case 'get-source-metadata': return getCueDirectoryStageSourceMetadata(context);
    case 'validate-sheet': return validateCueDirectoryStageSheet(context);
    case 'accept-sheet': return acceptCueDirectoryStageSheet(context);
    case 'list-logical': return listCueDirectoryStageLogical(context);
    default: throw createCatalogError('invalidScanRequest', 'Unknown CUE staging action');
  }
}

function resetCueDirectoryStage({ identity, directoryPath }) {
  return runDurableTransaction(() => {
    clearCueDirectoryStageRows(identity, directoryPath);
    return { cleared: true };
  });
}

function clearCueDirectoryStageRows(identity, directoryPath) {
  for (const table of [
    'scan_cue_stage_owners', 'scan_cue_stage_tracks',
    'scan_cue_stage_sheets', 'scan_cue_stage_files'
  ]) {
    database.prepare(`DELETE FROM ${table} WHERE scan_id = ? AND folder_id = ? AND directory_path = ?`)
      .run(identity.scanId, identity.folderId, directoryPath);
  }
}

function clearCueScanStageRows(identity) {
  for (const table of [
    'scan_cue_stage_owners', 'scan_cue_stage_tracks',
    'scan_cue_stage_sheets', 'scan_cue_stage_files'
  ]) {
    database.prepare(`DELETE FROM ${table} WHERE scan_id = ? AND folder_id = ?`)
      .run(identity.scanId, identity.folderId);
  }
}

function normalizeCueStageDirectory(value) {
  const path = String(value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (path.split('/').includes('..') || path.includes('\0')) {
    throw createCatalogError('invalidScanPath', 'CUE staging directory is invalid');
  }
  return path;
}

function cueStageParentPath(value) {
  const index = value.lastIndexOf('/');
  return index < 0 ? '' : value.slice(0, index);
}

function cueStageFileName(value) {
  const index = value.lastIndexOf('/');
  return index < 0 ? value : value.slice(index + 1);
}

function appendCueDirectoryStageEntries({ identity, directoryPath, payload }) {
  const entries = validateBatch(payload.entries, 'entries');
  if (entries.length < 1 || entries.length > 500 || measureBytes(entries, 'batchTooLarge') > 4 * 1024 * 1024) {
    throw createCatalogError('batchLimitExceeded', 'CUE staging batch exceeds 500 rows or 4 MiB');
  }
  return runDurableTransaction(() => {
    const insert = database.prepare(`
      INSERT INTO scan_cue_stage_files(
        scan_id, folder_id, directory_path, relative_path, entry_sequence, entry_kind,
        canonical_path, file_name_nfc, file_name_folded
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_id, folder_id, directory_path, relative_path) DO UPDATE SET
        entry_sequence = excluded.entry_sequence, entry_kind = excluded.entry_kind,
        canonical_path = excluded.canonical_path, file_name_nfc = excluded.file_name_nfc,
        file_name_folded = excluded.file_name_folded,
        file_identity = NULL, size = NULL, mtime_ms = NULL,
        metadata_status = NULL, metadata_json = NULL
    `);
    for (const entry of entries) {
      const relativePath = normalizeRelativePath(requireString(entry.relativePath, 'relativePath', 32768));
      if (cueStageParentPath(relativePath) !== directoryPath) {
        throw createCatalogError('invalidScanPath', 'CUE staging entry is outside its directory');
      }
      const kind = entry.kind === 'cue' ? 'cue' : entry.kind === 'audio' ? 'audio' : null;
      if (!kind) throw createCatalogError('invalidScanRequest', 'CUE staging entry kind is invalid');
      const fileName = cueStageFileName(relativePath).normalize('NFC');
      insert.run(
        identity.scanId, identity.folderId, directoryPath, relativePath,
        requireNonNegativeInteger(entry.sequence, 'sequence'), kind,
        optionalNullableString(entry.path, 32768), fileName, fileName.toLowerCase()
      );
    }
    return { staged: entries.length };
  });
}

function listCueDirectoryStageFiles({ identity, directoryPath, payload }) {
  const cursor = payload.cursor == null ? -1 : requireNonNegativeInteger(payload.cursor, 'cursor');
  const limit = requirePositiveInteger(payload.limit, 'limit');
  if (limit > 500) throw createCatalogError('batchLimitExceeded', 'CUE staging page exceeds 500 rows');
  const kind = payload.kind == null ? null : requireString(payload.kind, 'kind', 16);
  if (kind !== null && kind !== 'cue' && kind !== 'audio') {
    throw createCatalogError('invalidScanRequest', 'CUE staging file filter is invalid');
  }
  const rows = database.prepare(`
    SELECT relative_path AS relativePath, canonical_path AS path, entry_sequence AS sequence,
      entry_kind AS kind, file_identity AS fileIdentity, size, mtime_ms AS mtimeMs,
      metadata_status AS metadataStatus
    FROM scan_cue_stage_files
    WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND entry_sequence > ?
      AND (? IS NULL OR entry_kind = ?)
    ORDER BY entry_sequence
    LIMIT ?
  `).all(identity.scanId, identity.folderId, directoryPath, cursor, kind, kind, limit + 1);
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? Number(items.at(-1).sequence) : null
  };
}

function getCueDirectoryStageFile({ identity, directoryPath, payload }) {
  const relativePath = normalizeRelativePath(requireString(payload.relativePath, 'relativePath', 32768));
  const file = database.prepare(`
    SELECT relative_path AS relativePath, canonical_path AS path, entry_sequence AS sequence,
      entry_kind AS kind, file_identity AS fileIdentity, size, mtime_ms AS mtimeMs,
      metadata_status AS metadataStatus
    FROM scan_cue_stage_files
    WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND relative_path = ?
  `).get(identity.scanId, identity.folderId, directoryPath, relativePath);
  if (!file) throw createCatalogError('staleScanGeneration', 'CUE staging entry disappeared');
  return { file };
}

function updateCueDirectoryStageObservations({ identity, directoryPath, payload }) {
  const observations = validateBatch(payload.observations, 'observations');
  if (observations.length < 1 || observations.length > 500 || measureBytes(observations, 'batchTooLarge') > 4 * 1024 * 1024) {
    throw createCatalogError('batchLimitExceeded', 'CUE observation staging batch exceeds 500 rows or 4 MiB');
  }
  return runDurableTransaction(() => {
    const update = database.prepare(`
      UPDATE scan_cue_stage_files SET canonical_path = ?, file_identity = ?, size = ?, mtime_ms = ?
      WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND relative_path = ?
    `);
    for (const observation of observations) {
      const relativePath = normalizeRelativePath(requireString(observation.relativePath, 'relativePath', 32768));
      const result = update.run(
        optionalNullableString(observation.path, 32768),
        optionalString(observation.fileIdentity, '', 2048),
        requireNonNegativeInteger(observation.size, 'size'),
        requireNonNegativeInteger(Math.round(observation.mtimeMs), 'mtimeMs'),
        identity.scanId, identity.folderId, directoryPath, relativePath
      );
      if (Number(result.changes) !== 1) throw createCatalogError('staleScanGeneration', 'CUE staging entry disappeared');
    }
    return { updated: observations.length };
  });
}

function resolveCueDirectoryStageReferences({ identity, directoryPath, payload }) {
  const references = validateBatch(payload.references, 'references');
  if (references.length > 99) throw createCatalogError('batchLimitExceeded', 'CUE reference page exceeds 99 rows');
  const selectExact = database.prepare(`
    SELECT relative_path AS relativePath FROM scan_cue_stage_files
    WHERE scan_id = ? AND folder_id = ? AND directory_path = ?
      AND entry_kind = 'audio' AND file_name_nfc = ?
    ORDER BY entry_sequence
  `);
  const selectFolded = database.prepare(`
    SELECT relative_path AS relativePath FROM scan_cue_stage_files
    WHERE scan_id = ? AND folder_id = ? AND directory_path = ?
      AND entry_kind = 'audio' AND file_name_folded = ?
    ORDER BY entry_sequence
  `);
  const paths = new Set();
  for (const reference of references) {
    const name = requireString(reference, 'reference', 32768).normalize('NFC');
    const exact = selectExact.all(identity.scanId, identity.folderId, directoryPath, name);
    const matches = exact.length
      ? exact
      : selectFolded.all(identity.scanId, identity.folderId, directoryPath, name.toLowerCase());
    for (const row of matches) paths.add(row.relativePath);
  }
  return { availableRelativePaths: [...paths] };
}

function stageCueDirectorySheet({ identity, directoryPath, payload }) {
  const cue = payload.cue;
  if (!isPlainObject(cue) || cue.ok !== true || !Array.isArray(cue.tracks) || cue.tracks.length > 99) {
    throw createCatalogError('invalidScanRequest', 'Resolved CUE staging payload is invalid');
  }
  const cueRelativePath = normalizeRelativePath(requireString(cue.cueRelativePath, 'cueRelativePath', 32768));
  if (measureBytes(cue, 'batchTooLarge') > 4 * 1024 * 1024) {
    throw createCatalogError('batchLimitExceeded', 'Resolved CUE staging payload exceeds 4 MiB');
  }
  return runDurableTransaction(() => {
    database.prepare(`
      INSERT INTO scan_cue_stage_sheets(
        scan_id, folder_id, directory_path, cue_relative_path, cue_order_key,
        cue_signature, status, accepted, disc_json, track_total
      ) VALUES (?, ?, ?, ?, ?, ?, 'parsed', 0, ?, ?)
      ON CONFLICT(scan_id, folder_id, directory_path, cue_relative_path) DO UPDATE SET
        cue_order_key = excluded.cue_order_key, cue_signature = excluded.cue_signature,
        status = 'parsed', accepted = 0, disc_json = excluded.disc_json,
        track_total = excluded.track_total
    `).run(
      identity.scanId, identity.folderId, directoryPath, cueRelativePath,
      requireString(payload.cueOrderKey, 'cueOrderKey', 131072),
      requireString(payload.cueSignature, 'cueSignature', 256),
      JSON.stringify(cue.disc ?? {}), cue.tracks.length
    );
    database.prepare(`
      DELETE FROM scan_cue_stage_tracks
      WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND cue_relative_path = ?
    `).run(identity.scanId, identity.folderId, directoryPath, cueRelativePath);
    const insertTrack = database.prepare(`
      INSERT INTO scan_cue_stage_tracks(
        scan_id, folder_id, directory_path, cue_relative_path, track_no,
        source_relative_path, track_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const track of cue.tracks) {
      insertTrack.run(
        identity.scanId, identity.folderId, directoryPath, cueRelativePath,
        requirePositiveInteger(track.trackNo, 'trackNo'),
        normalizeRelativePath(requireString(track.relativePath, 'sourceRelativePath', 32768)),
        JSON.stringify(track)
      );
    }
    return { staged: true };
  });
}

function listCueDirectoryStageSources({ identity, directoryPath, payload }) {
  const cursor = payload.cursor == null ? -1 : requireNonNegativeInteger(payload.cursor, 'cursor');
  const limit = requirePositiveInteger(payload.limit, 'limit');
  if (limit > 500) throw createCatalogError('batchLimitExceeded', 'CUE source staging page exceeds 500 rows');
  const rows = database.prepare(`
    SELECT f.relative_path AS relativePath, f.canonical_path AS path,
      f.file_identity AS fileIdentity, f.size, f.mtime_ms AS mtimeMs,
      f.entry_sequence AS sequence
    FROM scan_cue_stage_files f
    WHERE f.scan_id = ? AND f.folder_id = ? AND f.directory_path = ?
      AND f.entry_kind = 'audio' AND f.entry_sequence > ?
      AND EXISTS(
        SELECT 1 FROM scan_cue_stage_tracks t
        JOIN scan_cue_stage_sheets s
          ON s.scan_id = t.scan_id AND s.folder_id = t.folder_id
          AND s.directory_path = t.directory_path AND s.cue_relative_path = t.cue_relative_path
        WHERE t.scan_id = f.scan_id AND t.folder_id = f.folder_id
          AND t.directory_path = f.directory_path AND t.source_relative_path = f.relative_path
          AND s.status = 'parsed'
      )
    ORDER BY f.entry_sequence
    LIMIT ?
  `).all(identity.scanId, identity.folderId, directoryPath, cursor, limit + 1);
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? Number(items.at(-1).sequence) : null
  };
}

function updateCueDirectoryStageSource({ identity, directoryPath, payload }) {
  const relativePath = normalizeRelativePath(requireString(payload.relativePath, 'relativePath', 32768));
  const status = payload.metadataStatus === 'ok' ? 'ok' : payload.metadataStatus === 'terminal' ? 'terminal' : null;
  if (!status) throw createCatalogError('invalidScanRequest', 'CUE source metadata status is invalid');
  return runDurableTransaction(() => {
    const result = database.prepare(`
      UPDATE scan_cue_stage_files SET metadata_status = ?, metadata_json = ?
      WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND relative_path = ?
    `).run(
      status, status === 'ok' ? JSON.stringify(payload.metadata ?? {}) : null,
      identity.scanId, identity.folderId, directoryPath, relativePath
    );
    if (Number(result.changes) !== 1) throw createCatalogError('staleScanGeneration', 'CUE source staging entry disappeared');
    return { updated: true };
  });
}

function listCueDirectoryStageSheets({ identity, directoryPath, payload }) {
  const status = requireString(payload.status, 'status', 16);
  if (status !== 'parsed' && status !== 'valid') {
    throw createCatalogError('invalidScanRequest', 'CUE sheet staging status is invalid');
  }
  const cursorKey = payload.cursor?.cueOrderKey ?? '';
  const cursorPath = payload.cursor?.cueRelativePath ?? '';
  const limit = requirePositiveInteger(payload.limit, 'limit');
  if (limit > 10) throw createCatalogError('batchLimitExceeded', 'CUE sheet staging page exceeds 10 rows');
  const rows = database.prepare(`
    SELECT cue_relative_path AS cueRelativePath, cue_order_key AS cueOrderKey,
      cue_signature AS cueSignature
    FROM scan_cue_stage_sheets
    WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND status = ?
      AND (cue_order_key > ? OR (cue_order_key = ? AND cue_relative_path > ?))
    ORDER BY cue_order_key, cue_relative_path
    LIMIT ?
  `).all(
    identity.scanId, identity.folderId, directoryPath, status,
    String(cursorKey), String(cursorKey), String(cursorPath), limit
  );
  const items = rows.slice(0, limit).map(row => ({
    cueRelativePath: row.cueRelativePath,
    cueOrderKey: row.cueOrderKey,
    cueSignature: row.cueSignature
  }));
  return {
    items,
    nextCursor: items.length === limit
      ? { cueOrderKey: items.at(-1).cueOrderKey, cueRelativePath: items.at(-1).cueRelativePath }
      : null
  };
}

function getCueDirectoryStageSourceMetadata({ identity, directoryPath, payload }) {
  const paths = validateBatch(payload.relativePaths, 'relativePaths');
  if (paths.length > 99) throw createCatalogError('batchLimitExceeded', 'CUE source metadata request exceeds 99 rows');
  const select = database.prepare(`
    SELECT relative_path AS relativePath, metadata_status AS metadataStatus, metadata_json AS metadataJson
    FROM scan_cue_stage_files
    WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND relative_path = ?
  `);
  return {
    items: paths.map(path => {
      const relativePath = normalizeRelativePath(requireString(path, 'relativePath', 32768));
      const row = select.get(identity.scanId, identity.folderId, directoryPath, relativePath);
      if (!row) throw createCatalogError('staleScanGeneration', 'CUE source staging entry disappeared');
      return {
        relativePath,
        metadataStatus: row.metadataStatus,
        metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null
      };
    })
  };
}

function validateCueDirectoryStageSheet({ identity, directoryPath, payload }) {
  const cueRelativePath = normalizeRelativePath(requireString(payload.cueRelativePath, 'cueRelativePath', 32768));
  const status = payload.valid === true ? 'valid' : 'invalid';
  return runDurableTransaction(() => {
    const result = database.prepare(`
      UPDATE scan_cue_stage_sheets SET status = ?, accepted = 0
      WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND cue_relative_path = ?
    `).run(
      status, identity.scanId, identity.folderId, directoryPath, cueRelativePath
    );
    if (Number(result.changes) !== 1) throw createCatalogError('staleScanGeneration', 'CUE sheet staging entry disappeared');
    if (payload.valid === true) {
      const durations = validateBatch(payload.durations, 'durations');
      if (durations.length > 99) throw createCatalogError('batchLimitExceeded', 'CUE duration staging exceeds 99 rows');
      const update = database.prepare(`
        UPDATE scan_cue_stage_tracks SET duration_sec = ?
        WHERE scan_id = ? AND folder_id = ? AND directory_path = ?
          AND cue_relative_path = ? AND track_no = ?
      `);
      for (const item of durations) {
        const durationSec = Number(item.durationSec);
        if (!Number.isFinite(durationSec) || durationSec <= 0) {
          throw createCatalogError('invalidScanRequest', 'CUE logical duration is invalid');
        }
        if (Number(update.run(
          durationSec, identity.scanId, identity.folderId, directoryPath,
          cueRelativePath, requirePositiveInteger(item.trackNo, 'trackNo')
        ).changes) !== 1) throw createCatalogError('staleScanGeneration', 'CUE staged track disappeared');
      }
      const missing = database.prepare(`
        SELECT count(*) AS count FROM scan_cue_stage_tracks
        WHERE scan_id = ? AND folder_id = ? AND directory_path = ?
          AND cue_relative_path = ? AND duration_sec IS NULL
      `).get(identity.scanId, identity.folderId, directoryPath, cueRelativePath);
      if (Number(missing.count) !== 0) throw createCatalogError('invalidScanRequest', 'CUE logical durations are incomplete');
    }
    return { updated: true };
  });
}

function acceptCueDirectoryStageSheet({ identity, directoryPath, payload }) {
  const cueRelativePath = normalizeRelativePath(requireString(payload.cueRelativePath, 'cueRelativePath', 32768));
  return runDurableTransaction(() => {
    const sources = database.prepare(`
      SELECT DISTINCT source_relative_path AS relativePath
      FROM scan_cue_stage_tracks
      WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND cue_relative_path = ?
    `).all(identity.scanId, identity.folderId, directoryPath, cueRelativePath);
    const collision = database.prepare(`
      SELECT 1 FROM scan_cue_stage_owners
      WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND source_relative_path = ?
    `);
    if (sources.some(source => collision.get(
      identity.scanId, identity.folderId, directoryPath, source.relativePath
    ))) {
      database.prepare(`
        UPDATE scan_cue_stage_sheets SET status = 'invalid', accepted = 0
        WHERE scan_id = ? AND folder_id = ? AND directory_path = ? AND cue_relative_path = ?
      `).run(identity.scanId, identity.folderId, directoryPath, cueRelativePath);
      return { accepted: false };
    }
    const insert = database.prepare(`
      INSERT INTO scan_cue_stage_owners(
        scan_id, folder_id, directory_path, source_relative_path, cue_relative_path
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (const source of sources) {
      insert.run(identity.scanId, identity.folderId, directoryPath, source.relativePath, cueRelativePath);
    }
    const result = database.prepare(`
      UPDATE scan_cue_stage_sheets SET accepted = 1
      WHERE scan_id = ? AND folder_id = ? AND directory_path = ?
        AND cue_relative_path = ? AND status = 'valid'
    `).run(identity.scanId, identity.folderId, directoryPath, cueRelativePath);
    return { accepted: Number(result.changes) === 1 };
  });
}

function listCueDirectoryStageLogical({ identity, directoryPath, payload }) {
  const relativePath = normalizeRelativePath(requireString(payload.relativePath, 'relativePath', 32768));
  const cursor = payload.cursor == null ? 0 : requireNonNegativeInteger(payload.cursor, 'cursor');
  const limit = requirePositiveInteger(payload.limit, 'limit');
  if (limit > 8) throw createCatalogError('batchLimitExceeded', 'CUE logical staging page is too large');
  const sheet = database.prepare(`
    SELECT s.cue_relative_path AS cueRelativePath, s.cue_signature AS cueSignature,
      s.disc_json AS discJson, s.track_total AS trackTotal, f.metadata_json AS metadataJson
    FROM scan_cue_stage_owners o
    JOIN scan_cue_stage_sheets s
      ON s.scan_id = o.scan_id AND s.folder_id = o.folder_id
      AND s.directory_path = o.directory_path AND s.cue_relative_path = o.cue_relative_path
    JOIN scan_cue_stage_files f
      ON f.scan_id = o.scan_id AND f.folder_id = o.folder_id
      AND f.directory_path = o.directory_path AND f.relative_path = o.source_relative_path
    WHERE o.scan_id = ? AND o.folder_id = ? AND o.directory_path = ?
      AND o.source_relative_path = ? AND s.accepted = 1
  `).get(identity.scanId, identity.folderId, directoryPath, relativePath);
  if (!sheet) return { sheet: null, items: [], nextCursor: null };
  const tracks = database.prepare(`
    SELECT track_no AS trackNo, track_json AS trackJson, duration_sec AS durationSec
    FROM scan_cue_stage_tracks
    WHERE scan_id = ? AND folder_id = ? AND directory_path = ?
      AND cue_relative_path = ? AND source_relative_path = ? AND track_no > ?
    ORDER BY track_no
    LIMIT ?
  `).all(
    identity.scanId, identity.folderId, directoryPath,
    sheet.cueRelativePath, relativePath, cursor, limit
  );
  return {
    sheet: {
      cueRelativePath: sheet.cueRelativePath,
      cueSignature: sheet.cueSignature,
      disc: JSON.parse(sheet.discJson),
      trackTotal: Number(sheet.trackTotal),
      metadata: sheet.metadataJson ? JSON.parse(sheet.metadataJson) : {}
    },
    items: tracks.map(row => ({ ...JSON.parse(row.trackJson), durationSec: Number(row.durationSec) })),
    nextCursor: tracks.length === limit ? Number(tracks.at(-1).trackNo) : null
  };
}

function listMetadataCandidates(payload) {
  assertAllowedFields(payload, [
    'scanId', 'folderId', 'generation', 'expectedLifecycleVersion', 'cursor', 'limit', 'parserVersion'
  ], 'invalidScanRequest');
  const identity = requireScanIdentity(payload);
  const limit = normalizeQueryLimit(payload.limit);
  const cursor = payload.cursor == null ? -1 : requireNonNegativeInteger(payload.cursor, 'cursor');
  const rows = database.prepare(`
    SELECT s.logical_storage_id AS logicalStorageId, s.relative_path AS relativePath, s.canonical_path AS path,
      s.file_identity AS observedFileIdentity, s.size AS observedSize, s.mtime_ms AS observedMtimeMs,
      s.observation_sequence AS observationSequence,
      s.source_kind AS sourceKind, s.entry_key AS entryKey, s.cue_relative_path AS cueRelativePath,
      s.start_frame AS startFrame, s.end_frame AS endFrame, s.cue_signature AS cueSignature,
      s.metadata_json AS metadataJson,
      t.track_uid AS trackUid, t.relative_path AS storedRelativePath,
      t.file_identity AS storedFileIdentity,
      t.size AS storedSize, t.mtime_ms AS storedMtimeMs,
      t.cue_signature AS storedCueSignature,
      t.metadata_status AS metadataStatus,
      t.metadata_attempt_count AS metadataAttemptCount,
      t.metadata_last_attempt_generation AS metadataLastAttemptGeneration,
      t.metadata_parser_version AS metadataParserVersion
    FROM scan_logical_seen s
    LEFT JOIN tracks t ON t.folder_id = s.folder_id AND (
      (s.source_kind = 'file' AND t.source_kind = 'file' AND t.relative_path = s.relative_path)
      OR (s.source_kind = 'cue-track' AND t.source_kind = 'cue-track' AND t.entry_key = s.entry_key)
    )
    WHERE s.scan_id = ? AND s.folder_id = ? AND s.observation_sequence > ?
    ORDER BY s.observation_sequence LIMIT ?
  `).all(identity.scanId, identity.folderId, cursor, limit + 1);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return {
    items: rows.map(row => ({
      folderId: identity.folderId,
      lifecycleVersion: identity.lifecycleVersion,
      generation: identity.generation,
      trackUid: row.trackUid ?? null,
      logicalStorageId: row.logicalStorageId,
      relativePath: row.relativePath,
      path: row.path,
      parserVersion: payload.parserVersion ?? 'catalog-metadata-v3',
      storedParserVersion: row.sourceKind === 'cue-track' && row.storedCueSignature !== row.cueSignature
        ? null
        : row.metadataParserVersion ?? null,
      storedSignature: row.trackUid && row.storedRelativePath === row.relativePath ? {
        fileIdentity: row.storedFileIdentity ?? '',
        size: Number(row.storedSize ?? 0),
        mtimeMs: Number(row.storedMtimeMs ?? 0)
      } : null,
      observedSignature: {
        fileIdentity: row.observedFileIdentity ?? '',
        size: Number(row.observedSize),
        mtimeMs: Number(row.observedMtimeMs)
      },
      sourceKind: row.sourceKind,
      entryKey: row.entryKey ?? null,
      cueRelativePath: row.cueRelativePath ?? null,
      startFrame: row.startFrame == null ? null : Number(row.startFrame),
      endFrame: row.endFrame == null ? null : Number(row.endFrame),
      cueSignature: row.cueSignature ?? null,
      storedCueSignature: row.storedCueSignature ?? null,
      metadata: row.metadataJson == null ? null : JSON.parse(row.metadataJson),
      metadataStatus: row.metadataStatus ?? 'retryable-error',
      attemptsForSignature: Number(row.metadataAttemptCount ?? 0),
      attemptedGeneration: row.metadataLastAttemptGeneration == null ? null : Number(row.metadataLastAttemptGeneration)
    })),
    nextCursor: hasMore ? Number(rows.at(-1).observationSequence) : null,
    resumeCursor: rows.length ? Number(rows.at(-1).observationSequence) : cursor
  };
}

function advanceScanMetadataCursor(payload) {
  assertExactFields(payload, [
    'scanId', 'folderId', 'generation', 'expectedLifecycleVersion', 'cursor'
  ], 'invalidScanRequest');
  const identity = requireScanIdentity(payload);
  const cursor = requireNonNegativeInteger(payload.cursor, 'cursor');
  return runDurableTransaction(() => {
    requireScanState(identity);
    const result = database.prepare(`
      UPDATE scan_run_folders SET metadata_cursor = ?, updated_at = ?
      WHERE scan_id = ? AND folder_id = ? AND generation = ?
        AND (metadata_cursor IS NULL OR metadata_cursor < ?)
    `).run(cursor, Date.now(), identity.scanId, identity.folderId, identity.generation, cursor);
    return { advanced: Number(result.changes) === 1, cursor };
  });
}

function markScanEnumerationIneligible(payload) {
  const identity = requireScanIdentity(payload);
  return runDurableTransaction(() => {
    requireScanState(identity);
    database.prepare(`
      UPDATE scan_run_folders SET sweep_eligibility = 'INELIGIBLE', sweep_block_reason = ?,
        enumeration_error_count = enumeration_error_count + ?, updated_at = ?
      WHERE scan_id = ? AND folder_id = ? AND generation = ?
    `).run(
      optionalString(payload.sweepBlockReason, 'enumeration-error', 128),
      requireNonNegativeInteger(payload.incrementErrorCount ?? 1, 'incrementErrorCount'), Date.now(),
      identity.scanId, identity.folderId, identity.generation
    );
    if (payload.sample) insertScanError(identity, payload.sample);
    return { marked: true };
  });
}

function recordScanErrors(payload) {
  const identity = requireScanIdentity(payload);
  const samples = Array.isArray(payload.samples) ? payload.samples.slice(0, 100) : [];
  return runDurableTransaction(() => {
    requireScanState(identity);
    database.prepare(`
      UPDATE scan_run_folders SET enumeration_error_count = enumeration_error_count + ?, updated_at = ?
      WHERE scan_id = ? AND folder_id = ? AND generation = ?
    `).run(
      requireNonNegativeInteger(payload.occurrenceCount ?? 0, 'occurrenceCount'),
      Date.now(), identity.scanId, identity.folderId, identity.generation
    );
    for (const sample of samples) insertScanError(identity, sample);
    return { recorded: Number(payload.occurrenceCount ?? 0), samples: samples.length };
  });
}

function finalizeScanEnumeration(payload) {
  const identity = requireScanIdentity(payload);
  return runDurableTransaction(() => {
    const state = requireScanState(identity);
    const eligible = payload.rootToEnd === true && payload.continuityBroken === false &&
      Number(payload.enumerationErrorCount ?? 0) === 0 && Number(state.enumerationErrorCount) === 0;
    database.prepare(`
      UPDATE scan_run_folders SET status = 'reconciling', sweep_eligibility = ?,
        sweep_block_reason = ?, updated_at = ? WHERE scan_id = ? AND folder_id = ? AND generation = ?
    `).run(
      eligible ? 'ELIGIBLE' : 'INELIGIBLE', eligible ? null : state.sweepBlockReason ?? 'incomplete-enumeration',
      Date.now(), identity.scanId, identity.folderId, identity.generation
    );
    return {
      sweepEligibility: eligible ? 'ELIGIBLE' : 'INELIGIBLE',
      continuityBroken: !eligible,
      enumerationErrorCount: Number(state.enumerationErrorCount),
      sweepBlockReason: eligible ? null : state.sweepBlockReason ?? 'incomplete-enumeration'
    };
  });
}

function enqueueScanSweep(payload) {
  const identity = requireScanIdentity(payload);
  const state = requireScanState(identity);
  if (state.sweepEligibility !== 'ELIGIBLE' || Number(state.continuityBroken) !== 0) {
    throw createCatalogError('scanSweepIneligible', 'Scan generation is not eligible for sweep');
  }
  database.prepare(`UPDATE scan_run_folders SET status = 'sweeping', updated_at = ? WHERE scan_id = ? AND folder_id = ? AND generation = ?`)
    .run(Date.now(), identity.scanId, identity.folderId, identity.generation);
  const row = database.prepare(`
    SELECT count(*) AS count FROM tracks t WHERE t.folder_id = ? AND NOT EXISTS(
      SELECT 1 FROM scan_logical_seen s WHERE s.scan_id = ? AND s.folder_id = ?
        AND s.logical_storage_id = CASE WHEN t.source_kind = 'cue-track' THEN t.entry_key ELSE 'file:' || t.relative_path END
    )
  `).get(identity.folderId, identity.scanId, identity.folderId);
  return { enqueued: Number(row.count) };
}

function runScanSweep(payload) {
  const identity = requireScanIdentity(payload);
  const state = requireScanState(identity);
  if (state.status !== 'sweeping' || state.sweepEligibility !== 'ELIGIBLE' || state.continuityBroken) {
    throw createCatalogError('scanSweepIneligible', 'Scan sweep is no longer eligible');
  }
  const rows = database.prepare(`
      SELECT t.track_uid AS trackUid, t.track_key AS trackKey, t.search_text AS searchText,
        t.folder_id AS folderId, t.relative_path AS relativePath, t.file_name AS fileName,
        t.title, t.artist, t.duration_sec AS durationSec,
        t.source_kind AS sourceKind, t.entry_key AS entryKey, t.cue_relative_path AS cueRelativePath,
        t.start_frame AS startFrame, t.end_frame AS endFrame
      FROM tracks t WHERE t.folder_id = ? AND NOT EXISTS(
        SELECT 1 FROM scan_logical_seen s WHERE s.scan_id = ? AND s.folder_id = ?
          AND s.logical_storage_id = CASE WHEN t.source_kind = 'cue-track' THEN t.entry_key ELSE 'file:' || t.relative_path END
      ) ORDER BY t.track_key LIMIT ?
  `).all(identity.folderId, identity.scanId, identity.folderId, FOLDER_DELETION_TRACKS_PER_CHUNK);
  if (rows.length === 0) return { deleted: 0, hasMore: false };
  return deleteScanSweepRows(identity, rows);
}

function deleteScanSweepRows(identity, rows) {
  return commitMutation(
    ['tracks', 'playlists', 'albums', 'artists', 'genres', 'subfolders'],
    'scan-sweep',
    () => {
      const insertDeletionJob = database.prepare(`
        INSERT OR IGNORE INTO deletion_jobs(
          job_id, kind, state, cursor_key, folder_id, lifecycle_version, track_uid, scan_id,
          created_at, updated_at
        ) VALUES (?, 'scan-sweep', 'active', NULL, ?, ?, ?, ?, ?, ?)
      `);
      let deleted = 0;
      for (const row of rows) {
        const deletionJobId = `scan-sweep:${identity.scanId}:${identity.folderId}:${row.trackUid}`;
        const now = Date.now();
        insertDeletionJob.run(
          deletionJobId, identity.folderId, identity.lifecycleVersion, row.trackUid,
          identity.scanId, now, now
        );
        const repair = repairPlaylistItemsForTrack(row, 100, deletionJobId);
        if (repair.hasMore) return { deleted, hasMore: true };
        removeTrackEntityMemberships(row.trackUid);
        removeTrackArtworkReferences(row.trackUid);
        database.prepare('DELETE FROM tracks WHERE track_uid = ?').run(row.trackUid);
        completeTrackDeletionRepair(deletionJobId, row.trackUid, 'completed');
        deleted += 1;
      }
      return { deleted, hasMore: true };
    },
    { deferInvalidationKey: entityAggregationScanKey(identity) }
  );
}

function repairPlaylistItemsForTrack(track, limit, deletionJobId) {
  const items = database.prepare(`
    SELECT item_key AS itemKey, playlist_id AS playlistId FROM playlist_items
    WHERE track_uid = ? ORDER BY item_key LIMIT ?
  `).all(track.trackUid, limit + 1);
  const page = items.slice(0, limit);
  const unresolved = JSON.stringify(createSourceRemovedPlaylistItem(track));
  const repair = database.prepare(`
    UPDATE playlist_items SET track_uid = NULL, unresolved_json = ?, unresolved_basename = ?,
      unresolved_title = ?, unresolved_artist = ?, unresolved_duration_bucket = ?
    WHERE item_key = ? AND track_uid = ?
  `);
  const bind = database.prepare(`
    INSERT INTO deletion_repair_items(job_id, item_key, original_track_uid, state)
    VALUES (?, ?, ?, 'bound')
    ON CONFLICT(job_id, item_key) DO NOTHING
  `);
  const markDowngraded = database.prepare(`
    UPDATE deletion_repair_items SET state = 'downgraded'
    WHERE job_id = ? AND item_key = ? AND original_track_uid = ?
  `);
  const affectedPlaylists = new Set();
  for (const item of page) {
    bind.run(deletionJobId, item.itemKey, track.trackUid);
    const changed = repair.run(
      unresolved,
      modules.searchNormalizer.normalizeSearchText(track.fileName),
      modules.searchNormalizer.normalizeSearchText(track.title),
      modules.searchNormalizer.normalizeSearchText(track.artist),
      track.durationSec == null ? null : Math.round(track.durationSec), item.itemKey, track.trackUid
    );
    if (Number(changed.changes) !== 1) continue;
    markDowngraded.run(deletionJobId, item.itemKey, track.trackUid);
    affectedPlaylists.add(item.playlistId);
  }
  bumpActivePlaylistVersions(affectedPlaylists);
  return { repaired: page.length, hasMore: items.length > limit };
}

function createSourceRemovedPlaylistItem(track) {
  const unresolved = {
    version: 1,
    reason: 'source-removed',
    relativePath: track.relativePath,
    relativePathHint: track.relativePath,
    fileName: track.fileName,
    title: track.title,
    artist: track.artist,
    durationSec: track.durationSec,
    sourceKind: track.sourceKind ?? 'file',
    entryKey: track.entryKey ?? null,
    cueRelativePath: track.cueRelativePath ?? null,
    startFrame: track.startFrame == null ? null : Number(track.startFrame),
    endFrame: track.endFrame == null ? null : Number(track.endFrame)
  };
  if (unresolved.sourceKind === 'cue-track') {
    unresolved.cueProvenance = {
      folderId: track.folderId,
      entryKey: unresolved.entryKey,
      cueRelativePath: unresolved.cueRelativePath,
      relativePath: unresolved.relativePath,
      startFrame: unresolved.startFrame,
      endFrame: unresolved.endFrame
    };
  }
  return unresolved;
}

function completeTrackDeletionRepair(jobId, trackUid, state) {
  database.prepare(`
    DELETE FROM deletion_repair_items WHERE job_id = ? AND original_track_uid = ?
  `).run(jobId, trackUid);
  database.prepare(`
    UPDATE deletion_jobs SET state = ?, updated_at = ? WHERE job_id = ?
  `).run(state, Date.now(), jobId);
}

function completeScanFolder(payload) {
  return setScanTerminal(payload, 'completed');
}

function completeScanFolderNoSweep(payload) {
  return setScanTerminal(payload, 'completed-no-sweep');
}

function pauseScanFolder(payload) {
  const identity = requireScanIdentity(payload);
  if (requireScanState(identity).status === 'sweeping') {
    return { status: 'sweeping', destructiveCommitRetained: true };
  }
  return setScanTerminal(payload, 'paused');
}

function setScanTerminal(payload, status) {
  const identity = requireScanIdentity(payload);
  let playlistResolutionQueued = false;
  let entityAggregationQueued = false;
  const result = runDurableTransaction(() => {
    requireScanState(identity);
    const now = Date.now();
    database.prepare(`
      UPDATE scan_run_folders SET status = ?, stop_reason = ?, sweep_block_reason = ?,
        sweep_eligibility = ?, continuity_broken = ?, updated_at = ?
      WHERE scan_id = ? AND folder_id = ? AND generation = ?
    `).run(
      status, payload.stopReason ?? null, payload.sweepBlockReason ?? null,
      status === 'completed' ? 'ELIGIBLE' : 'INELIGIBLE', status === 'completed' ? 0 : 1,
      now, identity.scanId, identity.folderId, identity.generation
    );
    database.prepare(`UPDATE folders SET last_scan_at = ? WHERE id = ?`).run(now, identity.folderId);
    if (status === 'paused') {
      database.prepare(`
        UPDATE tracks SET metadata_last_attempt_generation = NULL
        WHERE folder_id = ? AND metadata_status = 'retryable-error'
          AND metadata_last_attempt_generation = ?
      `).run(identity.folderId, identity.generation);
    }
    database.prepare(`UPDATE scan_runs SET status = ?, finished_at = ?, stop_reason = ? WHERE id = ?`)
      .run(status, now, payload.stopReason ?? null, identity.scanId);
    if (status !== 'completed') {
      database.prepare(`
        UPDATE deletion_jobs SET state = 'blocked-interrupted', updated_at = ?
        WHERE kind = 'scan-sweep' AND state = 'active' AND scan_id = ? AND folder_id = ?
      `).run(now, identity.scanId, identity.folderId);
    }
    clearCueScanStageRows(identity);
    if (status === 'completed' || status === 'completed-no-sweep') {
      playlistResolutionQueued = ensurePlaylistResolutionJob(identity);
    }
    entityAggregationQueued = activateEntityAggregationJob(identity);
    return { status };
  });
  const scanKey = entityAggregationScanKey(identity);
  pendingScanSweepRecoveries.delete(scanKey);
  pendingEntityAggregationScans.delete(scanKey);
  flushPendingScanInvalidation(scanKey);
  if (status !== 'completed' || playlistResolutionQueued || entityAggregationQueued) {
    scheduleDeletionMaintenance();
  }
  return result;
}

function claimMetadataParseBatch(payload) {
  assertExactFields(payload, ['requests'], 'invalidMetadataClaimBatch');
  const requests = validateBatch(payload.requests, 'requests');
  if (requests.length === 0) return { results: [], ...createNoChangeResult() };
  const scanKey = requireMetadataBatchScanKey(requests);
  return runMetadataMutationBatch(scanKey, 'metadata-claim-batch', () => ({
    results: requests.map(request => claimMetadataParse(request))
  }));
}

function claimMetadataParse(payload) {
  assertAllowedFields(payload, [
    'folderId', 'trackUid', 'logicalStorageId', 'lifecycleVersion', 'generation', 'relativePath',
    'parserVersion', 'signature', 'cueSignature', 'sourceKind', 'entryKey', 'cueRelativePath',
    'startFrame', 'endFrame', 'explicitRescan'
  ], 'invalidMetadataClaim');
  const folderId = requireString(payload.folderId, 'folderId', 512);
  const lifecycleVersion = requireNonNegativeInteger(payload.lifecycleVersion, 'lifecycleVersion');
  const generation = requireNonNegativeInteger(payload.generation, 'generation');
  const relativePath = normalizeRelativePath(requireString(payload.relativePath, 'relativePath', 32768));
  const logicalStorageId = payload.logicalStorageId == null
    ? `file:${relativePath}`
    : requireString(payload.logicalStorageId, 'logicalStorageId', 32768);
  const source = normalizeMetadataSourceDescriptor(payload, logicalStorageId, relativePath);
  const parserVersion = requireString(payload.parserVersion, 'parserVersion', 256);
  const signature = normalizeScanSignature(payload.signature);
  requireActiveScanFolder(folderId, lifecycleVersion);
  const existing = database.prepare(`
    SELECT track_uid AS trackUid, file_identity AS fileIdentity, size, mtime_ms AS mtimeMs,
      relative_path AS relativePath,
      metadata_status AS metadataStatus, metadata_parser_version AS metadataParserVersion,
      metadata_attempt_count AS metadataAttemptCount,
      metadata_last_attempt_generation AS metadataLastAttemptGeneration,
      artwork_id AS artworkId, cue_signature AS cueSignature
    FROM tracks WHERE folder_id = ? AND (
      (? = 'file' AND source_kind = 'file' AND relative_path = ?)
      OR (? = 'cue-track' AND source_kind = 'cue-track' AND entry_key = ?)
    )
  `).get(folderId, source.sourceKind, relativePath, source.sourceKind, source.entryKey);
  const sameInput = existing && signaturesEqual(signature, {
    fileIdentity: existing.fileIdentity ?? '',
    size: Number(existing.size ?? 0),
    mtimeMs: Number(existing.mtimeMs ?? 0)
  }) && existing.relativePath === relativePath && existing.metadataParserVersion === parserVersion &&
    (source.sourceKind === 'file' || existing.cueSignature === source.cueSignature);
  if (sameInput && (
    existing.metadataStatus === 'ok' || existing.metadataStatus === 'terminal-error' ||
    existing.metadataStatus === 'parsing' || Number(existing.metadataLastAttemptGeneration) === generation ||
    Number(existing.metadataAttemptCount) >= 6 && payload.explicitRescan !== true
  )) return { claim: null };

  const trackUid = existing?.trackUid ?? (
    payload.trackUid == null ? randomUUID() : requireString(payload.trackUid, 'trackUid', 512)
  );
  const claim = {
    folderId, trackUid, logicalStorageId, lifecycleVersion, generation, relativePath,
    parserVersion, signature, ...source
  };
  const attempts = sameInput ? Number(existing.metadataAttemptCount ?? 0) + 1 : 1;
  const artworkSourceChanged = Boolean(existing?.artworkId) && !signaturesEqual(signature, {
    fileIdentity: existing.fileIdentity ?? '',
    size: Number(existing.size ?? 0),
    mtimeMs: Number(existing.mtimeMs ?? 0)
  });
  const changedScopes = artworkSourceChanged
    ? ['artwork', 'tracks', 'albums', 'artists', 'genres', 'subfolders']
    : ['tracks'];
  const fileName = path.posix.basename(relativePath);
  return commitMutation(changedScopes, 'metadata-claim', () => {
    const now = Date.now();
    if (existing) {
      database.prepare(`
        UPDATE tracks SET relative_path = ?, file_name = ?, file_identity = ?, size = ?, mtime_ms = ?,
          source_kind = ?, entry_key = ?,
          cue_relative_path = ?, start_frame = ?, end_frame = ?, cue_signature = ?, metadata_status = 'parsing',
          metadata_error_code = NULL, metadata_attempt_count = ?,
          metadata_last_attempt_generation = ?, metadata_parser_version = ?, updated_at = ?
        WHERE track_uid = ?
      `).run(
        relativePath, fileName, signature.fileIdentity, signature.size, signature.mtimeMs,
        source.sourceKind, source.entryKey,
        source.cueRelativePath, source.startFrame, source.endFrame, source.cueSignature, attempts,
        generation, parserVersion, now, trackUid
      );
      if (artworkSourceChanged) {
        database.prepare('UPDATE tracks SET artwork_id = NULL WHERE track_uid = ?').run(trackUid);
        database.prepare('DELETE FROM track_artwork_sources WHERE track_uid = ?').run(trackUid);
        database.prepare(`
          UPDATE artwork_assets SET ref_count = CASE WHEN ref_count > 0 THEN ref_count - 1 ELSE 0 END
          WHERE id = ?
        `).run(existing.artworkId);
        recomputeArtworkAggregateRowsForTrack(trackUid);
      }
    } else {
      const title = path.posix.basename(relativePath, path.posix.extname(relativePath));
      const normalize = modules.searchNormalizer.normalizeSearchText;
      const searchText = modules.searchNormalizer.createCompactSearchText([
        normalize(title), normalize(fileName), normalize(relativePath)
      ]);
      database.prepare(`
        INSERT INTO tracks(
          track_uid, folder_id, relative_path, source_kind, entry_key, cue_relative_path,
          start_frame, end_frame, cue_signature, file_identity, file_name, size, mtime_ms,
          title, metadata_status, metadata_attempt_count, metadata_last_attempt_generation,
          metadata_parser_version, added_at, updated_at, search_text,
          normalized_basename, normalized_title, normalized_artist
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parsing', ?, ?, ?, ?, ?, ?, ?, ?, '')
      `).run(
        trackUid, folderId, relativePath, source.sourceKind, source.entryKey, source.cueRelativePath,
        source.startFrame, source.endFrame, source.cueSignature, signature.fileIdentity, fileName,
        signature.size, signature.mtimeMs, title, attempts, generation, parserVersion,
        now, now, searchText, normalize(fileName), normalize(title)
      );
    }
    database.prepare(`
      INSERT INTO metadata_claims(
        folder_id, logical_storage_id, relative_path, track_uid, lifecycle_version, generation,
        parser_version, signature_json, cue_signature, status, claimed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'parsing', ?)
      ON CONFLICT(folder_id, logical_storage_id) DO UPDATE SET
        relative_path = excluded.relative_path,
        track_uid = excluded.track_uid, lifecycle_version = excluded.lifecycle_version,
        generation = excluded.generation, parser_version = excluded.parser_version,
        signature_json = excluded.signature_json, cue_signature = excluded.cue_signature, status = excluded.status,
        claimed_at = excluded.claimed_at
    `).run(
      folderId, logicalStorageId, relativePath, trackUid, lifecycleVersion, generation,
      parserVersion, JSON.stringify(signature), source.cueSignature, now
    );
    return { claim };
  }, { deferInvalidationKey: entityAggregationScanKey(claim) });
}

function aggregateIdentity(kind, ...parts) {
  const normalize = modules.searchNormalizer.normalizeSearchText;
  return `${kind}:${parts.map(part => encodeURIComponent(normalize(part))).join(':')}`;
}

function derivedTrackEntities(track, metadata) {
  const artist = metadata.compilation
    ? 'Various Artists'
    : metadata.albumArtist || metadata.artist || 'Unknown Artist';
  const album = metadata.album || 'Unknown Album';
  const genre = metadata.genre || 'Unknown Genre';
  const directory = path.posix.dirname(track.relativePath);
  const subfolderPath = directory === '.' ? null : directory;
  return {
    album: { key: aggregateIdentity('album', artist, album), name: album, artist },
    artist: { key: aggregateIdentity('artist', artist), name: artist },
    genre: { key: aggregateIdentity('genre', genre), name: genre },
    subfolder: subfolderPath
      ? {
          key: aggregateIdentity('subfolder', track.folderId, subfolderPath),
          folderId: track.folderId,
          relativePath: subfolderPath,
          name: path.posix.basename(subfolderPath)
        }
      : null
  };
}

function replaceTrackEntityMemberships(track, metadata, { recomputeAggregates = true } = {}) {
  const prior = {
    album: database.prepare('SELECT album_key AS key FROM track_albums WHERE track_uid = ?').get(track.trackUid)?.key ?? null,
    artists: database.prepare('SELECT artist_key AS key FROM track_artists WHERE track_uid = ?').all(track.trackUid).map(row => row.key),
    genres: database.prepare('SELECT genre_key AS key FROM track_genres WHERE track_uid = ?').all(track.trackUid).map(row => row.key),
    subfolder: database.prepare('SELECT subfolder_key AS key FROM track_subfolders WHERE track_uid = ?').get(track.trackUid)?.key ?? null
  };
  const next = derivedTrackEntities(track, metadata);
  database.prepare('DELETE FROM track_albums WHERE track_uid = ?').run(track.trackUid);
  database.prepare('DELETE FROM track_artists WHERE track_uid = ?').run(track.trackUid);
  database.prepare('DELETE FROM track_genres WHERE track_uid = ?').run(track.trackUid);
  database.prepare('DELETE FROM track_subfolders WHERE track_uid = ?').run(track.trackUid);

  database.prepare(`
    INSERT INTO albums(album_key, identity_version, name, artist, sort_name, sort_artist, track_count, total_duration_sec)
    VALUES (?, 1, ?, ?, ?, ?, 0, 0)
    ON CONFLICT(album_key) DO UPDATE SET name = excluded.name, artist = excluded.artist,
      sort_name = excluded.sort_name, sort_artist = excluded.sort_artist
  `).run(next.album.key, next.album.name, next.album.artist, createSortKey(next.album.name), createSortKey(next.album.artist));
  database.prepare(`
    INSERT INTO artists(artist_key, identity_version, name, sort_name, track_count, total_duration_sec)
    VALUES (?, 1, ?, ?, 0, 0)
    ON CONFLICT(artist_key) DO UPDATE SET name = excluded.name, sort_name = excluded.sort_name
  `).run(next.artist.key, next.artist.name, createSortKey(next.artist.name));
  database.prepare(`
    INSERT INTO genres(genre_key, identity_version, name, sort_name, track_count, total_duration_sec)
    VALUES (?, 1, ?, ?, 0, 0)
    ON CONFLICT(genre_key) DO UPDATE SET name = excluded.name, sort_name = excluded.sort_name
  `).run(next.genre.key, next.genre.name, createSortKey(next.genre.name));
  if (next.subfolder) {
    database.prepare(`
      INSERT INTO subfolders(
        subfolder_key, folder_id, relative_path, identity_version, display_name,
        sort_name, track_count, total_duration_sec
      ) VALUES (?, ?, ?, 1, ?, ?, 0, 0)
      ON CONFLICT(subfolder_key) DO UPDATE SET display_name = excluded.display_name,
        sort_name = excluded.sort_name
    `).run(
      next.subfolder.key, next.subfolder.folderId, next.subfolder.relativePath,
      next.subfolder.name, createSortKey(next.subfolder.name)
    );
  }
  database.prepare('INSERT INTO track_albums(track_uid, album_key) VALUES (?, ?)').run(track.trackUid, next.album.key);
  database.prepare('INSERT INTO track_artists(track_uid, artist_key, role) VALUES (?, ?, ?)').run(track.trackUid, next.artist.key, 'album-artist');
  database.prepare('INSERT INTO track_genres(track_uid, genre_key) VALUES (?, ?)').run(track.trackUid, next.genre.key);
  if (next.subfolder) {
    database.prepare('INSERT INTO track_subfolders(track_uid, subfolder_key) VALUES (?, ?)').run(track.trackUid, next.subfolder.key);
  }
  database.prepare(`
    UPDATE tracks SET album_key = ?, artist_key = ?, genre_key = ?, subfolder_key = ?
    WHERE track_uid = ?
  `).run(next.album.key, next.artist.key, next.genre.key, next.subfolder?.key ?? null, track.trackUid);

  if (!recomputeAggregates) return;
  recomputeAggregateRows('albums', 'track_albums', 'album_key', new Set([prior.album, next.album.key]));
  recomputeAggregateRows('artists', 'track_artists', 'artist_key', new Set([...prior.artists, next.artist.key]));
  recomputeAggregateRows('genres', 'track_genres', 'genre_key', new Set([...prior.genres, next.genre.key]));
  recomputeAggregateRows('subfolders', 'track_subfolders', 'subfolder_key', new Set([prior.subfolder, next.subfolder?.key]));
}

function recomputeAggregateRows(entityTable, membershipTable, keyColumn, keys) {
  const read = database.prepare(`
    SELECT COUNT(*) AS trackCount, COALESCE(SUM(t.duration_sec), 0) AS totalDurationSec,
      MAX(t.artwork_id) AS representativeArtworkId
    FROM ${membershipTable} m JOIN tracks t ON t.track_uid = m.track_uid
    WHERE m.${keyColumn} = ?
  `);
  const update = database.prepare(`
    UPDATE ${entityTable} SET track_count = ?, total_duration_sec = ?, representative_artwork_id = ?
    WHERE ${keyColumn} = ?
  `);
  const remove = database.prepare(`DELETE FROM ${entityTable} WHERE ${keyColumn} = ?`);
  for (const key of keys) {
    if (!key) continue;
    const aggregate = read.get(key);
    if (!aggregate || Number(aggregate.trackCount) === 0) remove.run(key);
    else update.run(Number(aggregate.trackCount), Number(aggregate.totalDurationSec), aggregate.representativeArtworkId, key);
  }
}

function recomputeArtworkAggregateRowsForTrack(trackUid) {
  const album = database.prepare('SELECT album_key AS key FROM track_albums WHERE track_uid = ?').get(trackUid)?.key;
  const artists = database.prepare('SELECT artist_key AS key FROM track_artists WHERE track_uid = ?').all(trackUid);
  const genres = database.prepare('SELECT genre_key AS key FROM track_genres WHERE track_uid = ?').all(trackUid);
  const subfolder = database.prepare('SELECT subfolder_key AS key FROM track_subfolders WHERE track_uid = ?').get(trackUid)?.key;
  recomputeAggregateRows('albums', 'track_albums', 'album_key', new Set([album]));
  recomputeAggregateRows('artists', 'track_artists', 'artist_key', new Set(artists.map(row => row.key)));
  recomputeAggregateRows('genres', 'track_genres', 'genre_key', new Set(genres.map(row => row.key)));
  recomputeAggregateRows('subfolders', 'track_subfolders', 'subfolder_key', new Set([subfolder]));
}

function removeTrackEntityMemberships(trackUid) {
  const prior = {
    album: database.prepare('SELECT album_key AS key FROM track_albums WHERE track_uid = ?').get(trackUid)?.key ?? null,
    artists: database.prepare('SELECT artist_key AS key FROM track_artists WHERE track_uid = ?').all(trackUid).map(row => row.key),
    genres: database.prepare('SELECT genre_key AS key FROM track_genres WHERE track_uid = ?').all(trackUid).map(row => row.key),
    subfolder: database.prepare('SELECT subfolder_key AS key FROM track_subfolders WHERE track_uid = ?').get(trackUid)?.key ?? null
  };
  database.prepare('DELETE FROM track_albums WHERE track_uid = ?').run(trackUid);
  database.prepare('DELETE FROM track_artists WHERE track_uid = ?').run(trackUid);
  database.prepare('DELETE FROM track_genres WHERE track_uid = ?').run(trackUid);
  database.prepare('DELETE FROM track_subfolders WHERE track_uid = ?').run(trackUid);
  recomputeAggregateRows('albums', 'track_albums', 'album_key', new Set([prior.album]));
  recomputeAggregateRows('artists', 'track_artists', 'artist_key', new Set(prior.artists));
  recomputeAggregateRows('genres', 'track_genres', 'genre_key', new Set(prior.genres));
  recomputeAggregateRows('subfolders', 'track_subfolders', 'subfolder_key', new Set([prior.subfolder]));
}

function removeTrackArtworkReferences(trackUid) {
  const artworkId = database.prepare('SELECT artwork_id AS artworkId FROM tracks WHERE track_uid = ?')
    .get(trackUid)?.artworkId ?? null;
  database.prepare('DELETE FROM artwork_claims WHERE track_uid = ?').run(trackUid);
  database.prepare('DELETE FROM track_artwork_sources WHERE track_uid = ?').run(trackUid);
  if (artworkId != null) {
    database.prepare(`
      UPDATE artwork_assets SET ref_count = CASE WHEN ref_count > 0 THEN ref_count - 1 ELSE 0 END
      WHERE id = ?
    `).run(artworkId);
  }
}

function completeMetadataParseSuccess(payload) {
  assertAllowedFields(payload, [
    'claim', 'metadata', 'metadataStatus', 'clearErrorAndRetryState',
    'updateLastKnownGood', 'updateDerivedData', 'deferAggregateRecompute'
  ], 'invalidMetadataCompletion');
  if (payload.updateLastKnownGood !== true || payload.updateDerivedData !== true) {
    throw createCatalogError('invalidMetadataCompletion', 'Metadata success must update last-known-good data');
  }
  const claim = validateMetadataClaim(payload.claim);
  const current = currentMetadataClaim(claim);
  if (!current) return { committed: false };
  const metadata = normalizeParsedMetadata(payload.metadata);
  let pendingAggregateScanKey = null;
  const result = commitMutation(['tracks', 'albums', 'artists', 'genres', 'subfolders'], 'metadata-success', () => {
    const track = database.prepare(`
      SELECT track_key AS trackKey, search_text AS searchText, file_name AS fileName,
        relative_path AS relativePath, track_uid AS trackUid, folder_id AS folderId FROM tracks
      WHERE track_uid = ? AND metadata_status = 'parsing'
    `).get(claim.trackUid);
    if (!track || !currentMetadataClaim(claim)) return { committed: false };
    const normalize = modules.searchNormalizer.normalizeSearchText;
    const searchFields = {
      title: normalize(metadata.title), artist: normalize(metadata.artist),
      album_artist: normalize(metadata.albumArtist), album: normalize(metadata.album),
      genre: normalize(metadata.genre), file_name: normalize(track.fileName),
      relative_path: normalize(track.relativePath)
    };
    const searchText = modules.searchNormalizer.createCompactSearchText(
      SEARCH_FIELDS.map(field => searchFields[field])
    );
    database.prepare(`
      UPDATE tracks SET title = ?, artist = ?, album_artist = ?, album = ?, genre = ?,
        year = ?, compilation = ?, disc_no = ?, disc_total = ?, track_no = ?, track_total = ?,
        sort_title = ?, sort_album_artist = ?, sort_album = ?, sort_genre = ?,
        duration_sec = ?, sample_rate = ?, bitrate = ?, bits_per_sample = ?, channels = ?, codec = ?,
        metadata_status = 'ok', metadata_error_code = NULL, metadata_attempt_count = 0,
        metadata_last_attempt_generation = NULL, metadata_last_success_at = ?, updated_at = ?,
        search_text = ?, normalized_basename = ?, normalized_title = ?, normalized_artist = ?,
        duration_bucket = ? WHERE track_uid = ?
    `).run(
      metadata.title, metadata.artist, metadata.albumArtist, metadata.album, metadata.genre,
      metadata.year, metadata.compilation ? 1 : 0, metadata.discNo, metadata.discTotal,
      metadata.trackNo, metadata.trackTotal, createSortKey(metadata.title),
      createSortKey(metadata.albumArtist || metadata.artist), createSortKey(metadata.album),
      createSortKey(metadata.genre), metadata.durationSec, metadata.sampleRate, metadata.bitrate,
      metadata.bitsPerSample, metadata.channels, metadata.codec, Date.now(), Date.now(),
      searchText, searchFields.file_name, searchFields.title, searchFields.artist,
      metadata.durationSec == null ? null : Math.round(metadata.durationSec), claim.trackUid
    );
    replaceTrackEntityMemberships(track, metadata, {
      recomputeAggregates: payload.deferAggregateRecompute !== true
    });
    if (payload.deferAggregateRecompute === true) {
      pendingAggregateScanKey = ensurePendingEntityAggregationJob(claim);
    }
    database.prepare('DELETE FROM metadata_claims WHERE folder_id = ? AND logical_storage_id = ?')
      .run(claim.folderId, claim.logicalStorageId);
    return { committed: true };
  }, { deferInvalidationKey: entityAggregationScanKey(claim) });
  if (result.committed && pendingAggregateScanKey) {
    if (activeMutationBatch) activeMutationBatch.pendingAggregationScans.add(pendingAggregateScanKey);
    else pendingEntityAggregationScans.add(pendingAggregateScanKey);
  }
  return result;
}

function completeMetadataParseFailure(payload) {
  assertAllowedFields(payload, [
    'claim', 'metadataStatus', 'errorCode', 'retryable', 'preserveLastKnownGood',
    'updateDerivedData', 'createMinimalRecordIfNoLastKnownGood'
  ], 'invalidMetadataCompletion');
  if (payload.preserveLastKnownGood !== true || payload.updateDerivedData !== false) {
    throw createCatalogError('invalidMetadataCompletion', 'Metadata failure must preserve last-known-good data');
  }
  const claim = validateMetadataClaim(payload.claim);
  if (!currentMetadataClaim(claim)) return { committed: false };
  const status = payload.metadataStatus === 'terminal-error' ? 'terminal-error' : 'retryable-error';
  return commitMutation(['tracks'], 'metadata-failure', () => {
    if (!currentMetadataClaim(claim)) return { committed: false };
    database.prepare(`
      UPDATE tracks SET metadata_status = ?, metadata_error_code = ?, updated_at = ?
      WHERE track_uid = ? AND metadata_status = 'parsing'
    `).run(status, optionalString(payload.errorCode, 'unknown-internal', 128), Date.now(), claim.trackUid);
    database.prepare('DELETE FROM metadata_claims WHERE folder_id = ? AND logical_storage_id = ?')
      .run(claim.folderId, claim.logicalStorageId);
    return { committed: true };
  }, { deferInvalidationKey: entityAggregationScanKey(claim) });
}

function completeMetadataParseBatch(payload) {
  assertExactFields(payload, ['completions'], 'invalidMetadataCompletionBatch');
  const completions = validateBatch(payload.completions, 'completions');
  if (completions.length === 0) return { results: [], ...createNoChangeResult() };
  for (const completion of completions) {
    assertExactFields(completion, ['outcome', 'request'], 'invalidMetadataCompletionBatch');
    if (completion.outcome !== 'success' && completion.outcome !== 'failure') {
      throw createCatalogError('invalidMetadataCompletionBatch', 'Metadata batch outcome is invalid');
    }
  }
  const scanKey = requireMetadataBatchScanKey(completions.map(completion => completion.request?.claim));
  return runMetadataMutationBatch(scanKey, 'metadata-completion-batch', () => ({
    results: completions.map(completion => completion.outcome === 'success'
      ? completeMetadataParseSuccess(completion.request)
      : completeMetadataParseFailure(completion.request))
  }));
}

function requireMetadataBatchScanKey(identities) {
  let scanKey = null;
  for (const [index, identity] of identities.entries()) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
      throw createCatalogError('invalidMetadataBatch', `Metadata batch identity ${index} is invalid`);
    }
    const currentKey = entityAggregationScanKey({
      folderId: requireString(identity.folderId, `identities[${index}].folderId`, 512),
      lifecycleVersion: requireNonNegativeInteger(identity.lifecycleVersion, `identities[${index}].lifecycleVersion`),
      generation: requireNonNegativeInteger(identity.generation, `identities[${index}].generation`)
    });
    if (scanKey != null && currentKey !== scanKey) {
      throw createCatalogError('invalidMetadataBatch', 'Metadata batch must belong to one folder scan');
    }
    scanKey = currentKey;
  }
  return scanKey;
}

function runMetadataMutationBatch(scanKey, reason, callback) {
  const changedScopes = new Set();
  const pendingAggregationScans = new Set();
  const result = commitMutation(changedScopes, reason, () => {
    if (activeMutationBatch) throw createCatalogError('invalidMetadataBatch', 'Metadata mutation batches cannot be nested');
    activeMutationBatch = { changedScopes, pendingAggregationScans };
    try {
      return callback();
    } finally {
      activeMutationBatch = null;
    }
  }, { deferInvalidationKey: scanKey });
  for (const pendingScanKey of pendingAggregationScans) {
    pendingEntityAggregationScans.add(pendingScanKey);
  }
  return result;
}

function requeueLatestMetadata(payload) {
  assertAllowedFields(payload, ['folderId', 'logicalStorageId', 'relativePath', 'staleClaim', 'maxItems'], 'invalidMetadataRequeue');
  if (payload.maxItems !== 1) throw createCatalogError('invalidLimit', 'Metadata requeue is limited to one item');
  const folderId = requireString(payload.folderId, 'folderId', 512);
  normalizeRelativePath(requireString(payload.relativePath, 'relativePath', 32768));
  const logicalStorageId = payload.logicalStorageId == null
    ? `file:${normalizeRelativePath(payload.relativePath)}`
    : requireString(payload.logicalStorageId, 'logicalStorageId', 32768);
  const staleClaim = validateMetadataClaim(payload.staleClaim);
  if (staleClaim.folderId !== folderId || staleClaim.logicalStorageId !== logicalStorageId) {
    throw createCatalogError('invalidMetadataRequeue', 'Stale metadata claim identity does not match the requeue request');
  }
  const currentClaim = database.prepare(`
    SELECT track_uid AS trackUid, lifecycle_version AS lifecycleVersion, generation
    FROM metadata_claims WHERE folder_id = ? AND logical_storage_id = ?
  `).get(folderId, logicalStorageId);
  if (currentClaim && (
    currentClaim.trackUid !== staleClaim.trackUid ||
    Number(currentClaim.lifecycleVersion) !== staleClaim.lifecycleVersion ||
    Number(currentClaim.generation) !== staleClaim.generation
  )) return { requeued: 0 };
  if (currentClaim) return { requeued: 0 };
  const track = database.prepare(`
    SELECT track_uid AS trackUid, file_identity AS fileIdentity, size, mtime_ms AS mtimeMs,
      cue_signature AS cueSignature, metadata_parser_version AS parserVersion,
      metadata_last_attempt_generation AS attemptedGeneration, metadata_status AS metadataStatus
    FROM tracks WHERE folder_id = ? AND
      CASE WHEN source_kind = 'cue-track' THEN entry_key ELSE 'file:' || relative_path END = ?
  `).get(folderId, logicalStorageId);
  if (!track || track.trackUid !== staleClaim.trackUid || track.metadataStatus !== 'parsing' ||
      track.parserVersion !== staleClaim.parserVersion ||
      Number(track.attemptedGeneration) !== staleClaim.generation ||
      track.cueSignature !== staleClaim.cueSignature || !signaturesEqual(staleClaim.signature, {
        fileIdentity: track.fileIdentity ?? '',
        size: Number(track.size ?? 0),
        mtimeMs: Number(track.mtimeMs ?? 0)
      })) return { requeued: 0 };
  const changed = database.prepare(`
    UPDATE tracks SET metadata_status = 'retryable-error', metadata_error_code = 'stale-completion'
    WHERE track_uid = ? AND metadata_status = 'parsing'
  `).run(track.trackUid);
  return { requeued: Number(changed.changes) };
}

function recoverInterruptedMetadataClaims(payload) {
  assertAllowedFields(payload, ['metadataStatus', 'errorCode', 'preserveLastKnownGood', 'updateDerivedData'], 'invalidMetadataRecovery');
  if (payload.metadataStatus !== 'retryable-error' || payload.preserveLastKnownGood !== true || payload.updateDerivedData !== false) {
    throw createCatalogError('invalidMetadataRecovery', 'Interrupted metadata recovery contract is invalid');
  }
  return commitMutation(['tracks'], 'metadata-recovery', () => {
    const result = database.prepare(`
      UPDATE tracks SET metadata_status = 'retryable-error', metadata_error_code = ?, updated_at = ?
      WHERE metadata_status = 'parsing'
    `).run(optionalString(payload.errorCode, 'service-interrupted', 128), Date.now());
    database.prepare('DELETE FROM metadata_claims').run();
    return { changed: Number(result.changes) };
  });
}

function removeScanFolder(payload) {
  assertAllowedFields(payload, ['folderId', 'expectedLifecycleVersion'], 'invalidFolderRemoval');
  const folderId = requireString(payload.folderId, 'folderId', 512);
  const lifecycleVersion = requireNonNegativeInteger(payload.expectedLifecycleVersion, 'expectedLifecycleVersion');
  const folder = database.prepare('SELECT status, lifecycle_version AS lifecycleVersion FROM folders WHERE id = ?').get(folderId);
  if (!folder) throw createCatalogError('folderUnavailable', 'Library folder is unavailable');
  if (folder.status !== 'removed') {
    if (Number(folder.lifecycleVersion) !== lifecycleVersion) {
      throw createCatalogError('staleFolderLifecycle', 'Library folder lifecycle has changed');
    }
    commitMutation(
      ['folders', 'tracks', 'albums', 'artists', 'genres', 'subfolders', 'playlists'],
      'remove-folder-tombstone',
      () => {
        const changed = database.prepare(`
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

function runFolderDeletionChunk(folderId, lifecycleVersion) {
  const deletionJobId = folderDeletionJobId(folderId, lifecycleVersion);
  const job = database.prepare(`
    SELECT state FROM deletion_jobs WHERE job_id = ? AND kind = 'folder-delete'
  `).get(deletionJobId);
  if (!job) {
    runDurableTransaction(() => ensureFolderDeletionJob(folderId, lifecycleVersion));
    return runFolderDeletionChunk(folderId, lifecycleVersion);
  }
  if (job.state === 'completed') {
    return { folderId, lifecycleVersion, deleted: 0, hasMore: false };
  }
  return runDurableTransaction(
    () => runFolderDeletionChunkInTransaction(folderId, lifecycleVersion, deletionJobId)
  );
}

function runFolderDeletionChunkInTransaction(folderId, lifecycleVersion, deletionJobId) {
  const folder = database.prepare(`
    SELECT status, lifecycle_version AS lifecycleVersion FROM folders WHERE id = ?
  `).get(folderId);
  if (folder?.status !== 'removed' || Number(folder.lifecycleVersion) !== lifecycleVersion) {
    throw createCatalogError('staleFolderLifecycle', 'Library folder lifecycle has changed');
  }
  const nextTrack = database.prepare(`
      SELECT track_uid AS trackUid, track_key AS trackKey, search_text AS searchText,
        folder_id AS folderId, relative_path AS relativePath, file_name AS fileName,
        title, artist, duration_sec AS durationSec,
        source_kind AS sourceKind, entry_key AS entryKey, cue_relative_path AS cueRelativePath,
        start_frame AS startFrame, end_frame AS endFrame
      FROM tracks WHERE folder_id = ? ORDER BY track_key LIMIT 1
    `);
  const deleteRepairItems = database.prepare(`
    DELETE FROM deletion_repair_items WHERE job_id = ? AND original_track_uid = ?
  `);
  const updateJob = database.prepare(`
    UPDATE deletion_jobs SET track_uid = ?, updated_at = ? WHERE job_id = ?
  `);
  let deleted = 0;
  while (deleted < FOLDER_DELETION_TRACKS_PER_CHUNK) {
    const row = nextTrack.get(folderId);
    if (!row) {
      database.prepare(`UPDATE deletion_jobs SET state = 'completed', updated_at = ? WHERE job_id = ?`)
        .run(Date.now(), deletionJobId);
      return { folderId, lifecycleVersion, deleted, hasMore: false };
    }
    const repair = repairPlaylistItemsForTrack(row, 100, deletionJobId);
    if (repair.hasMore) return { folderId, lifecycleVersion, deleted, hasMore: true };
    removeTrackEntityMemberships(row.trackUid);
    removeTrackArtworkReferences(row.trackUid);
    database.prepare('DELETE FROM tracks WHERE track_uid = ?').run(row.trackUid);
    deleteRepairItems.run(deletionJobId, row.trackUid);
    updateJob.run(row.trackUid, Date.now(), deletionJobId);
    deleted += 1;
  }
  return { folderId, lifecycleVersion, deleted, hasMore: true };
}

function ensureFolderDeletionJob(folderId, lifecycleVersion) {
  const now = Date.now();
  database.prepare(`
    INSERT OR IGNORE INTO deletion_jobs(
      job_id, kind, state, cursor_key, folder_id, lifecycle_version, track_uid, scan_id,
      created_at, updated_at
    ) VALUES (?, 'folder-delete', 'active', NULL, ?, ?, NULL, NULL, ?, ?)
  `).run(folderDeletionJobId(folderId, lifecycleVersion), folderId, lifecycleVersion, now, now);
}

function folderDeletionJobId(folderId, lifecycleVersion) {
  return `folder-delete:${lifecycleVersion}:${folderId}`;
}

function ensurePendingEntityAggregationJob(claim) {
  const scanKey = entityAggregationScanKey(claim);
  if (pendingEntityAggregationScans.has(scanKey)) return null;
  const identity = database.prepare(`
    SELECT scan_id AS scanId, folder_id AS folderId, generation,
      expected_lifecycle_version AS lifecycleVersion
    FROM scan_run_folders
    WHERE folder_id = ? AND generation = ? AND expected_lifecycle_version = ?
    ORDER BY updated_at DESC, scan_id DESC LIMIT 1
  `).get(claim.folderId, claim.generation, claim.lifecycleVersion);
  if (!identity) throw createCatalogError('scanNotFound', 'Scan folder state does not exist');
  const jobId = entityAggregationJobId(identity.scanId, identity.folderId);
  const now = Date.now();
  database.prepare(`
    INSERT INTO deletion_jobs(
      job_id, kind, state, cursor_key, folder_id, lifecycle_version, track_uid, scan_id,
      created_at, updated_at
    ) VALUES (?, 'entity-aggregate', 'pending-scan', 0, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(job_id) DO NOTHING
  `).run(
    jobId,
    identity.folderId, identity.lifecycleVersion, identity.scanId, now, now
  );
  return scanKey;
}

function entityAggregationScanKey(identity) {
  return `${identity.folderId}\n${identity.lifecycleVersion}\n${identity.generation}`;
}

function activateEntityAggregationJob(identity) {
  const result = database.prepare(`
    UPDATE deletion_jobs SET state = 'active', cursor_key = 0, updated_at = ?
    WHERE job_id = ? AND kind = 'entity-aggregate' AND state = 'pending-scan'
  `).run(Date.now(), entityAggregationJobId(identity.scanId, identity.folderId));
  return Number(result.changes) === 1;
}

function entityAggregationJobId(scanId, folderId) {
  return `entity-aggregate:${scanId}:${folderId}`;
}

function recomputeAllAggregateRows(entityTable, membershipTable, keyColumn) {
  database.prepare(`
    UPDATE ${entityTable}
    SET (track_count, total_duration_sec, representative_artwork_id) = (
      SELECT COUNT(*), COALESCE(SUM(t.duration_sec), 0), MAX(t.artwork_id)
      FROM ${membershipTable} m JOIN tracks t ON t.track_uid = m.track_uid
      WHERE m.${keyColumn} = ${entityTable}.${keyColumn}
    )
  `).run();
  database.prepare(`
    DELETE FROM ${entityTable}
    WHERE NOT EXISTS(
      SELECT 1 FROM ${membershipTable} m WHERE m.${keyColumn} = ${entityTable}.${keyColumn}
    )
  `).run();
}

function runEntityAggregationPhase(jobId, cursorKey) {
  const phaseIndex = Math.max(0, Number(cursorKey));
  const phase = ENTITY_AGGREGATE_PHASES[phaseIndex];
  if (!phase) {
    return runDurableTransaction(() => {
      database.prepare(`
        UPDATE deletion_jobs SET state = 'completed', updated_at = ?
        WHERE job_id = ? AND kind = 'entity-aggregate'
      `).run(Date.now(), jobId);
      return { aggregated: 0, hasMore: false };
    });
  }
  return commitMutation([phase.scope], 'recompute-entity-aggregates', () => {
    recomputeAllAggregateRows(phase.entityTable, phase.membershipTable, phase.keyColumn);
    const nextPhase = phaseIndex + 1;
    const hasMore = nextPhase < ENTITY_AGGREGATE_PHASES.length;
    database.prepare(`
      UPDATE deletion_jobs SET state = ?, cursor_key = ?, updated_at = ?
      WHERE job_id = ? AND kind = 'entity-aggregate'
    `).run(hasMore ? 'active' : 'completed', nextPhase, Date.now(), jobId);
    return { aggregated: 1, hasMore };
  });
}

function ensurePlaylistResolutionJob(identity) {
  if (listPlaylistResolutionCandidates(identity.folderId, identity.lifecycleVersion, 0, 1).length === 0) {
    return false;
  }
  const now = Date.now();
  database.prepare(`
    INSERT INTO deletion_jobs(
      job_id, kind, state, cursor_key, folder_id, lifecycle_version, track_uid, scan_id,
      created_at, updated_at
    ) VALUES (?, 'playlist-resolve', 'active', NULL, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      state = 'active', cursor_key = NULL, scan_id = excluded.scan_id,
      updated_at = excluded.updated_at
  `).run(
    playlistResolutionJobId(identity.folderId, identity.lifecycleVersion),
    identity.folderId, identity.lifecycleVersion, identity.scanId, now, now
  );
  return true;
}

function playlistResolutionJobId(folderId, lifecycleVersion) {
  return `playlist-resolve:${lifecycleVersion}:${folderId}`;
}

function listPlaylistResolutionCandidates(folderId, lifecycleVersion, cursorKey, limit) {
  return database.prepare(`
    SELECT i.item_key AS itemKey, i.playlist_id AS playlistId,
      i.unresolved_json AS unresolvedJson
    FROM playlist_items i
    JOIN playlists p ON p.id = i.playlist_id AND p.state = 'active'
    LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id
    WHERE i.track_uid IS NULL AND i.item_key > ?
      AND (i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))
      AND EXISTS(
        SELECT 1 FROM tracks t
        JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'
          AND f.lifecycle_version = ?
        WHERE t.folder_id = ?
          AND t.source_kind = CASE
            WHEN json_extract(i.unresolved_json, '$.sourceKind') = 'cue-track'
              OR json_type(i.unresolved_json, '$.cueProvenance') IS NOT NULL
            THEN 'cue-track' ELSE 'file'
          END
          AND (
            (t.source_kind = 'cue-track'
              AND t.folder_id = json_extract(i.unresolved_json, '$.cueProvenance.folderId')
              AND t.entry_key = json_extract(i.unresolved_json, '$.cueProvenance.entryKey'))
            OR (i.unresolved_basename <> '' AND t.normalized_basename = i.unresolved_basename)
            OR (
              i.unresolved_title <> '' AND i.unresolved_artist <> ''
              AND t.normalized_title = i.unresolved_title
              AND t.normalized_artist = i.unresolved_artist
            )
          )
      )
    ORDER BY i.item_key
    LIMIT ?
  `).all(cursorKey, lifecycleVersion, folderId, limit);
}

function runPlaylistResolutionChunk(jobId, folderId, lifecycleVersion, cursorKey) {
  const rows = listPlaylistResolutionCandidates(
    folderId,
    lifecycleVersion,
    cursorKey,
    PLAYLIST_RECONCILIATION_BATCH_SIZE + 1
  );
  const page = rows.slice(0, PLAYLIST_RECONCILIATION_BATCH_SIZE);
  const matches = page.map(row => ({
    row,
    trackUid: resolveImportedPlaylistTrack(parseStoredJson(row.unresolvedJson))
  })).filter(match => match.trackUid !== null);
  const hasMore = rows.length > PLAYLIST_RECONCILIATION_BATCH_SIZE;
  const nextCursor = page.length > 0 ? Number(page.at(-1).itemKey) : cursorKey;
  const apply = () => {
    const resolve = database.prepare(`
      UPDATE playlist_items
      SET track_uid = ?, unresolved_json = NULL, unresolved_basename = NULL,
        unresolved_title = NULL, unresolved_artist = NULL, unresolved_duration_bucket = NULL,
        import_fields_json = NULL, import_has_path = NULL
      WHERE item_key = ? AND track_uid IS NULL
    `);
    const affectedPlaylists = new Set();
    let resolved = 0;
    for (const match of matches) {
      const update = resolve.run(match.trackUid, match.row.itemKey);
      if (Number(update.changes) === 1) {
        affectedPlaylists.add(match.row.playlistId);
        resolved += 1;
      }
    }
    const now = Date.now();
    const updatePlaylist = database.prepare(`
      UPDATE playlists SET version = version + 1, updated_at = ?
      WHERE id = ? AND state = 'active'
    `);
    for (const playlistId of affectedPlaylists) updatePlaylist.run(now, playlistId);
    database.prepare(`
      UPDATE deletion_jobs SET state = ?, cursor_key = ?, updated_at = ?
      WHERE job_id = ? AND kind = 'playlist-resolve'
    `).run(hasMore ? 'active' : 'completed', nextCursor, now, jobId);
    return { resolved, hasMore };
  };
  return matches.length > 0
    ? commitMutation(['playlists'], 'resolve-playlist-items', apply)
    : runDurableTransaction(apply);
}

let deletionMaintenanceScheduled = false;

function scheduleDeletionMaintenance() {
  if (closed || deletionMaintenanceScheduled) return;
  deletionMaintenanceScheduled = true;
  setTimeout(() => {
    deletionMaintenanceScheduled = false;
    if (closed) return;
    try {
      const result = runDeletionMaintenanceTurn();
      if (result.hasMore) scheduleDeletionMaintenance();
    } catch {
      if (pendingScanSweepRecoveries.size > 0) scheduleDeletionMaintenance();
    }
  }, DELETION_MAINTENANCE_DELAY_MS);
}

function runDeletionMaintenanceTurn() {
  const scanSweep = pendingScanSweepRecoveries.values().next().value;
  if (scanSweep) {
    const result = runScanSweep(scanSweep);
    if (result.hasMore !== true) completeScanFolder({ ...scanSweep, status: 'completed' });
    return { hasMore: result.hasMore === true || hasDeletionMaintenanceWork() };
  }
  const repair = repairBlockedDeletionItems(100);
  if (repair.repaired > 0) return { hasMore: true };
  const active = database.prepare(`
    SELECT job_id AS jobId, kind, folder_id AS folderId,
      lifecycle_version AS lifecycleVersion, COALESCE(cursor_key, 0) AS cursorKey
    FROM deletion_jobs
    WHERE kind IN ('folder-delete', 'playlist-resolve', 'entity-aggregate') AND state = 'active'
    ORDER BY updated_at, job_id LIMIT 1
  `).get();
  if (active) {
    const result = active.kind === 'playlist-resolve'
      ? runPlaylistResolutionChunk(
          active.jobId,
          active.folderId,
          Number(active.lifecycleVersion),
          Number(active.cursorKey)
        )
      : active.kind === 'entity-aggregate'
        ? runEntityAggregationPhase(active.jobId, active.cursorKey)
        : runFolderDeletionChunk(active.folderId, Number(active.lifecycleVersion));
    return {
      hasMore: result.hasMore || Number(result.deleted ?? result.resolved ?? result.aggregated ?? 0) > 0 ||
        hasDeletionMaintenanceWork()
    };
  }
  const orphan = database.prepare(`
    SELECT f.id AS folderId, f.lifecycle_version AS lifecycleVersion
    FROM folders f
    WHERE f.status = 'removed' AND EXISTS(SELECT 1 FROM tracks t WHERE t.folder_id = f.id)
      AND NOT EXISTS(
        SELECT 1 FROM deletion_jobs d
        WHERE d.kind = 'folder-delete' AND d.folder_id = f.id
          AND d.lifecycle_version = f.lifecycle_version AND d.state = 'active'
      )
    ORDER BY f.id LIMIT 1
  `).get();
  if (!orphan) return { hasMore: false };
  runDurableTransaction(() => ensureFolderDeletionJob(orphan.folderId, Number(orphan.lifecycleVersion)));
  return { hasMore: true };
}

function hasDeletionMaintenanceWork() {
  if (pendingScanSweepRecoveries.size > 0) return true;
  return Boolean(database.prepare(`
    SELECT 1 AS pending
    WHERE EXISTS(
      SELECT 1 FROM deletion_repair_items r
      JOIN deletion_jobs j ON j.job_id = r.job_id
      WHERE j.state = 'blocked-interrupted'
    ) OR EXISTS(
      SELECT 1 FROM deletion_jobs
      WHERE kind IN ('folder-delete', 'playlist-resolve', 'entity-aggregate') AND state = 'active'
    ) OR EXISTS(
      SELECT 1 FROM folders f
      JOIN tracks t ON t.folder_id = f.id
      WHERE f.status = 'removed'
    )
  `).get());
}

function repairBlockedDeletionItems(limit) {
  const rows = database.prepare(`
    SELECT r.job_id AS jobId, r.item_key AS itemKey, r.original_track_uid AS trackUid,
      i.playlist_id AS playlistId
    FROM deletion_repair_items r
    JOIN deletion_jobs j ON j.job_id = r.job_id
    JOIN playlist_items i ON i.item_key = r.item_key
    WHERE j.state = 'blocked-interrupted'
    ORDER BY r.job_id, r.item_key LIMIT ?
  `).all(limit);
  if (rows.length === 0) return { repaired: 0 };
  return commitMutation(['playlists'], 'repair-interrupted-deletion', () => {
    const trackExists = database.prepare('SELECT 1 AS present FROM tracks WHERE track_uid = ?');
    const rebind = database.prepare(`
      UPDATE playlist_items
      SET track_uid = ?, unresolved_json = NULL, unresolved_basename = NULL,
        unresolved_title = NULL, unresolved_artist = NULL, unresolved_duration_bucket = NULL
      WHERE item_key = ? AND track_uid IS NULL
    `);
    const remove = database.prepare('DELETE FROM deletion_repair_items WHERE job_id = ? AND item_key = ?');
    const affectedPlaylists = new Set();
    for (const row of rows) {
      if (trackExists.get(row.trackUid)) {
        const changed = rebind.run(row.trackUid, row.itemKey);
        if (Number(changed.changes) === 1) affectedPlaylists.add(row.playlistId);
      }
      remove.run(row.jobId, row.itemKey);
    }
    bumpActivePlaylistVersions(affectedPlaylists);
    return { repaired: rows.length };
  });
}

function bumpActivePlaylistVersions(playlistIds) {
  if (playlistIds.size === 0) return;
  const update = database.prepare(`
    UPDATE playlists SET version = version + 1, updated_at = ?
    WHERE id = ? AND state = 'active'
  `);
  const now = Date.now();
  for (const playlistId of playlistIds) update.run(now, playlistId);
}

function validateBoundedStringList(value, field, maximumItems, maximumLength) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw createCatalogError('invalidRequestField', `${field} must be a bounded string array`);
  }
  return value.map(item => requireString(item, field, maximumLength));
}

function requireActiveScanFolder(folderId, lifecycleVersion) {
  const folder = database.prepare(`
    SELECT id, path, status, scan_generation AS scanGeneration,
      lifecycle_version AS lifecycleVersion
    FROM folders WHERE id = ?
  `).get(folderId);
  if (!folder || folder.status !== 'ok' || !folder.path) {
    throw createCatalogError('folderUnavailable', 'Library folder is unavailable');
  }
  if (Number(folder.lifecycleVersion) !== lifecycleVersion) {
    throw createCatalogError('staleFolderLifecycle', 'Library folder lifecycle has changed');
  }
  return folder;
}

function requireScanIdentity(payload) {
  return {
    scanId: requireString(payload.scanId, 'scanId', 128),
    folderId: requireString(payload.folderId, 'folderId', 512),
    generation: requireNonNegativeInteger(payload.generation, 'generation'),
    lifecycleVersion: requireNonNegativeInteger(
      payload.expectedLifecycleVersion ?? payload.lifecycleVersion,
      'expectedLifecycleVersion'
    )
  };
}

function requireScanState(identity) {
  const folder = requireActiveScanFolder(identity.folderId, identity.lifecycleVersion);
  if (Number(folder.scanGeneration) !== identity.generation) {
    throw createCatalogError('staleScanGeneration', 'A newer folder scan generation already exists');
  }
  const state = database.prepare(`
    SELECT generation, expected_lifecycle_version AS lifecycleVersion, status,
      continuity_broken AS continuityBroken, sweep_eligibility AS sweepEligibility,
      sweep_block_reason AS sweepBlockReason,
      enumeration_error_count AS enumerationErrorCount,
      visited_files AS visitedFiles, committed_batches AS committedBatches,
      parser_version AS parserVersion
    FROM scan_run_folders WHERE scan_id = ? AND folder_id = ?
  `).get(identity.scanId, identity.folderId);
  if (!state) throw createCatalogError('scanNotFound', 'Scan folder state does not exist');
  if (
    Number(state.generation) !== identity.generation ||
    Number(state.lifecycleVersion) !== identity.lifecycleVersion
  ) {
    throw createCatalogError('staleScanGeneration', 'Scan generation or folder lifecycle has changed');
  }
  return state;
}

function insertScanError(identity, sample) {
  const normalized = isPlainObject(sample) ? sample : { sample: String(sample ?? '') };
  database.prepare(`
    INSERT INTO scan_errors(scan_id, folder_id, category, code, sample, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    identity.scanId,
    identity.folderId ?? null,
    optionalString(normalized.category, 'enumeration', 128),
    optionalNullableString(normalized.code, 128),
    optionalNullableString(normalized.path ?? normalized.sample ?? normalized.message, 2048),
    Date.now()
  );
}

function normalizeScanSignature(value) {
  if (!isPlainObject(value)) {
    throw createCatalogError('invalidMetadataClaim', 'Metadata signature must be an object');
  }
  return {
    fileIdentity: optionalString(value.fileIdentity, '', 2048),
    size: requireNonNegativeInteger(value.size, 'signature.size'),
    mtimeMs: requireNonNegativeInteger(Math.round(value.mtimeMs), 'signature.mtimeMs')
  };
}

function signaturesEqual(left, right) {
  return Boolean(left && right) &&
    left.fileIdentity === right.fileIdentity &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs;
}

function createPlainScanLogicalCandidate(observation, relativePath) {
  return {
    logicalStorageId: `file:${relativePath}`,
    relativePath,
    sourceKind: 'file',
    path: observation.path ?? null
  };
}

function normalizeScanLogicalCandidate(value, observation, observedRelativePath) {
  if (!isPlainObject(value)) throw createCatalogError('invalidScanRequest', 'Logical scan candidate is invalid');
  const relativePath = normalizeRelativePath(requireString(value.relativePath, 'relativePath', 32768));
  if (relativePath !== observedRelativePath) {
    throw createCatalogError('invalidScanRequest', 'Logical scan candidate source does not match its observation');
  }
  const sourceKind = value.sourceKind === 'cue-track' ? 'cue-track' : 'file';
  const logicalStorageId = requireString(value.logicalStorageId, 'logicalStorageId', 32768);
  const entryKey = sourceKind === 'cue-track' ? requireString(value.entryKey, 'entryKey', 32768) : null;
  const cueRelativePath = sourceKind === 'cue-track'
    ? normalizeRelativePath(requireString(value.cueRelativePath, 'cueRelativePath', 32768))
    : null;
  const startFrame = sourceKind === 'cue-track' ? requireNonNegativeInteger(value.startFrame, 'startFrame') : null;
  const endFrame = sourceKind === 'cue-track'
    ? optionalNullableNonNegativeInteger(value.endFrame, 'endFrame')
    : null;
  const cueSignature = sourceKind === 'cue-track'
    ? requireString(value.cueSignature, 'cueSignature', 512)
    : null;
  if (sourceKind === 'file' && logicalStorageId !== `file:${relativePath}` ||
      sourceKind === 'cue-track' && (logicalStorageId !== entryKey || !entryKey.startsWith(`cue:${cueRelativePath}#`)) ||
      endFrame !== null && endFrame <= startFrame) {
    throw createCatalogError('invalidScanRequest', 'Logical scan identity or frame range is invalid');
  }
  let metadataJson = null;
  if (sourceKind === 'cue-track') {
    metadataJson = JSON.stringify(normalizeParsedMetadata(value.metadata));
    if (new TextEncoder().encode(metadataJson).byteLength > 64 * 1024) {
      throw createCatalogError('batchLimitExceeded', 'Logical CUE metadata is too large');
    }
  }
  return {
    logicalStorageId,
    relativePath,
    path: optionalNullableString(value.path ?? observation.path, 32768),
    fileIdentity: optionalString(observation.fileIdentity, '', 2048),
    size: requireNonNegativeInteger(observation.size, 'size'),
    mtimeMs: requireNonNegativeInteger(Math.round(observation.mtimeMs), 'mtimeMs'),
    sourceKind,
    entryKey,
    cueRelativePath,
    startFrame,
    endFrame,
    cueSignature,
    metadataJson
  };
}

function normalizeMetadataSourceDescriptor(value, logicalStorageId, relativePath) {
  const sourceKind = value.sourceKind === 'cue-track' ? 'cue-track' : 'file';
  const entryKey = sourceKind === 'cue-track' ? requireString(value.entryKey, 'entryKey', 32768) : null;
  const cueRelativePath = sourceKind === 'cue-track'
    ? normalizeRelativePath(requireString(value.cueRelativePath, 'cueRelativePath', 32768))
    : null;
  const startFrame = sourceKind === 'cue-track' ? requireNonNegativeInteger(value.startFrame, 'startFrame') : null;
  const endFrame = sourceKind === 'cue-track'
    ? optionalNullableNonNegativeInteger(value.endFrame, 'endFrame')
    : null;
  const cueSignature = sourceKind === 'cue-track'
    ? requireString(value.cueSignature, 'cueSignature', 512)
    : null;
  if (sourceKind === 'file' && logicalStorageId !== `file:${relativePath}` ||
      sourceKind === 'cue-track' && (logicalStorageId !== entryKey || !entryKey.startsWith(`cue:${cueRelativePath}#`)) ||
      endFrame !== null && endFrame <= startFrame) {
    throw createCatalogError('invalidMetadataClaim', 'Metadata logical identity or frame range is invalid');
  }
  return { sourceKind, entryKey, cueRelativePath, startFrame, endFrame, cueSignature };
}

function validateMetadataClaim(value) {
  if (!isPlainObject(value)) {
    throw createCatalogError('invalidMetadataClaim', 'Metadata claim must be an object');
  }
  assertAllowedFields(value, [
    'folderId', 'trackUid', 'logicalStorageId', 'lifecycleVersion', 'generation', 'relativePath',
    'parserVersion', 'signature', 'cueSignature', 'sourceKind', 'entryKey', 'cueRelativePath',
    'startFrame', 'endFrame'
  ], 'invalidMetadataClaim');
  const relativePath = normalizeRelativePath(requireString(value.relativePath, 'relativePath', 32768));
  const logicalStorageId = value.logicalStorageId == null
    ? `file:${relativePath}`
    : requireString(value.logicalStorageId, 'logicalStorageId', 32768);
  return {
    folderId: requireString(value.folderId, 'folderId', 512),
    trackUid: requireString(value.trackUid, 'trackUid', 512),
    lifecycleVersion: requireNonNegativeInteger(value.lifecycleVersion, 'lifecycleVersion'),
    generation: requireNonNegativeInteger(value.generation, 'generation'),
    logicalStorageId,
    relativePath,
    parserVersion: requireString(value.parserVersion, 'parserVersion', 128),
    signature: normalizeScanSignature(value.signature),
    ...normalizeMetadataSourceDescriptor(value, logicalStorageId, relativePath)
  };
}

function currentMetadataClaim(claim) {
  const folder = database.prepare(`
    SELECT status, lifecycle_version AS lifecycleVersion, scan_generation AS scanGeneration
    FROM folders WHERE id = ?
  `).get(claim.folderId);
  if (
    !folder || folder.status !== 'ok' ||
    Number(folder.lifecycleVersion) !== claim.lifecycleVersion ||
    Number(folder.scanGeneration) !== claim.generation
  ) return null;
  const row = database.prepare(`
    SELECT track_uid AS trackUid, lifecycle_version AS lifecycleVersion,
      generation, parser_version AS parserVersion, signature_json AS signatureJson,
      cue_signature AS cueSignature, status
    FROM metadata_claims WHERE folder_id = ? AND logical_storage_id = ?
  `).get(claim.folderId, claim.logicalStorageId);
  if (!row || row.status !== 'parsing') return null;
  let signature;
  try {
    signature = normalizeScanSignature(JSON.parse(row.signatureJson));
  } catch {
    return null;
  }
  return row.trackUid === claim.trackUid &&
    Number(row.lifecycleVersion) === claim.lifecycleVersion &&
    Number(row.generation) === claim.generation &&
    row.parserVersion === claim.parserVersion &&
    row.cueSignature === claim.cueSignature &&
    signaturesEqual(signature, claim.signature) ? row : null;
}

function normalizeParsedMetadata(value) {
  if (!isPlainObject(value)) {
    throw createCatalogError('invalidMetadataResult', 'Metadata result must be an object');
  }
  return {
    title: optionalString(value.title, '', 4096),
    artist: optionalString(value.artist, '', 4096),
    albumArtist: optionalString(value.albumArtist, '', 4096),
    album: optionalString(value.album, '', 4096),
    genre: Array.isArray(value.genre)
      ? value.genre.slice(0, 32).map(item => requireStringAllowEmpty(item, 'genre', 512)).join('; ')
      : optionalString(value.genre, '', 4096),
    year: optionalNullableInteger(value.year, 'year'),
    compilation: value.compilation === true,
    discNo: optionalNullableNonNegativeInteger(value.discNo, 'discNo'),
    discTotal: optionalNullableNonNegativeInteger(value.discTotal, 'discTotal'),
    trackNo: optionalNullableNonNegativeInteger(value.trackNo, 'trackNo'),
    trackTotal: optionalNullableNonNegativeInteger(value.trackTotal, 'trackTotal'),
    durationSec: optionalNullableFiniteNumber(value.durationSec, 'durationSec'),
    sampleRate: optionalNullableNonNegativeInteger(value.sampleRate, 'sampleRate'),
    bitrate: optionalNullableNonNegativeInteger(value.bitrate, 'bitrate'),
    bitsPerSample: optionalNullableNonNegativeInteger(value.bitsPerSample, 'bitsPerSample'),
    channels: optionalNullableNonNegativeInteger(value.channels, 'channels'),
    codec: optionalNullableString(value.codec, 512)
  };
}

function resolvePlaylistExportSource(payload) {
  assertExactFields(payload, ['trackUid'], 'invalidTrackRequest');
  const trackUid = requireString(payload.trackUid, 'trackUid', 512);
  const row = database.prepare(`
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
  if (!closed) {
    closed = true;
    for (const context of contexts.values()) closeContext(context);
    contexts.clear();
    pendingEntityAggregationScans.clear();
    pendingScanSweepRecoveries.clear();
    pendingScanInvalidations.clear();
    closeDatabase();
  }
  return { closed: true };
}

function closeDatabase() {
  if (!database) return;
  try {
    database.close();
  } finally {
    database = null;
  }
}

function commitMutation(changedScopes, reason, callback, { deferInvalidationKey = null } = {}) {
  if (activeMutationBatch) {
    for (const scope of changedScopes) activeMutationBatch.changedScopes.add(scope);
    return callback();
  }
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    const mutationScopes = [...changedScopes];
    if (mutationScopes.length === 0) {
      database.exec('COMMIT');
      pruneExpiredContexts();
      return { ...result, ...createNoChangeResult() };
    }
    const nextVersion = catalogVersion + 1;
    const nextScopeVersions = { ...scopeVersions };
    const updateMeta = database.prepare(`
      INSERT INTO meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    updateMeta.run('catalog_version', String(nextVersion));
    for (const scope of mutationScopes) {
      nextScopeVersions[scope] = (nextScopeVersions[scope] || 0) + 1;
      updateMeta.run(`scope_version:${scope}`, String(nextScopeVersions[scope]));
    }
    database.exec('COMMIT');
    pruneExpiredContexts();
    catalogVersion = nextVersion;
    scopeVersions = nextScopeVersions;
    const invalidationState = {
      catalogVersion,
      changedScopes: mutationScopes,
      scopeVersions: Object.fromEntries(mutationScopes.map(scope => [scope, scopeVersions[scope]]))
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
      database.exec('ROLLBACK');
    } catch {
      // The original write error is the actionable failure.
    }
    throw error;
  }
}

function flushPendingScanInvalidation(scanKey) {
  const pendingScopes = pendingScanInvalidations.get(scanKey);
  if (!pendingScopes) return;
  pendingScanInvalidations.delete(scanKey);
  const changedScopes = [...pendingScopes];
  const invalidation = {
    catalogVersion,
    changedScopes,
    scopeVersions: Object.fromEntries(changedScopes.map(scope => [scope, scopeVersions[scope]])),
    counts: pickCounts(readCounts(), changedScopes)
  };
  postMessage({
    protocolVersion: PROTOCOL_VERSION,
    type: 'invalidation',
    payload: invalidation
  });
}

function pickCounts(counts, scopes) {
  const selected = {};
  for (const scope of scopes) {
    if (Object.hasOwn(counts, scope)) selected[scope] = counts[scope];
  }
  return selected;
}

function createNoChangeResult() {
  return {
    writtenCount: 0,
    catalogVersion,
    changedScopes: [],
    scopeVersions: {},
    counts: {}
  };
}

function validateCatalogVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createCatalogError('invalidCatalogVersion', 'Catalog version is invalid');
  }
  if (value !== catalogVersion) throw createCatalogError('STALE_CURSOR', 'Catalog version is stale');
}

function normalizeQueryLimit(limit) {
  const normalized = limit === undefined ? DEFAULT_QUERY_LIMIT : limit;
  if (!Number.isSafeInteger(normalized) || normalized <= 0 || normalized > MAX_QUERY_LIMIT) {
    throw createCatalogError('invalidLimit', `Query limit must be an integer from 1 to ${MAX_QUERY_LIMIT}`);
  }
  return normalized;
}

function validateBatch(value, field) {
  if (!Array.isArray(value)) throw createCatalogError('invalidBatch', `${field} must be an array`);
  if (value.length > MAX_WRITE_BATCH_ROWS) {
    throw createCatalogError('batchTooLarge', 'Catalog write batch exceeds the row limit', {
      count: value.length,
      maximum: MAX_WRITE_BATCH_ROWS
    });
  }
  return value;
}

function normalizeRelativePath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw createCatalogError('invalidRelativePath', 'Track relative path is invalid');
  }
  return segments.join('/');
}

function createPhysicalSourceKey(folderId, relativePath) {
  return `${folderId}\0${relativePath}`;
}

function withPhysicalSourceKey(row) {
  return {
    ...row,
    physicalSourceKey: createPhysicalSourceKey(row.folderId, row.relativePath),
    startFrame: row.startFrame == null ? null : Number(row.startFrame),
    endFrame: row.endFrame == null ? null : Number(row.endFrame)
  };
}

function createSortKey(value) {
  return Buffer.from(modules.orderContract.encodeCanonicalSortKey(value), 'hex');
}

function normalizeExtensionJson(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > 64 * 1024) {
      throw createCatalogError('trackTextTooLarge', 'Track extension JSON exceeds the byte limit');
    }
    JSON.parse(value);
    return value;
  }
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > 64 * 1024) {
    throw createCatalogError('trackTextTooLarge', 'Track extension JSON exceeds the byte limit');
  }
  return json;
}

function optionalString(value, fallback, maximum) {
  return value === undefined || value === null ? fallback : requireStringAllowEmpty(value, 'text', maximum);
}

function optionalNullableString(value, maximum) {
  if (value === undefined || value === null) return null;
  return requireStringAllowEmpty(value, 'text', maximum);
}

function requireString(value, field, maximum) {
  const string = requireStringAllowEmpty(value, field, maximum);
  if (string.length === 0) throw createCatalogError('invalidRequestField', `${field} must not be empty`);
  return string;
}

function requireStringAllowEmpty(value, field, maximum) {
  if (typeof value !== 'string' || value.length > maximum) {
    throw createCatalogError('invalidRequestField', `${field} must be a bounded string`);
  }
  return value;
}

function optionalNonNegativeInteger(value, fallback, field) {
  if (value === undefined || value === null) return fallback;
  return requireNonNegativeInteger(value, field);
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createCatalogError('invalidRequestField', `${field} must be a non-negative integer`);
  }
  return value;
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createCatalogError('invalidRequestField', `${field} must be a positive integer`);
  }
  return value;
}

function normalizeWriteLimit(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_WRITE_BATCH_ROWS) {
    throw createCatalogError(
      'invalidLimit',
      `Write limit must be an integer from 1 to ${MAX_WRITE_BATCH_ROWS}`
    );
  }
  return value;
}

function optionalNullableNonNegativeInteger(value, field) {
  if (value === undefined || value === null) return null;
  return optionalNonNegativeInteger(value, null, field);
}

function optionalNullableInteger(value, field) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) {
    throw createCatalogError('invalidRequestField', `${field} must be an integer`);
  }
  return value;
}

function optionalNullableFiniteNumber(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw createCatalogError('invalidRequestField', `${field} must be a finite number`);
  }
  return value;
}

function optionalNonNegativeFiniteNumber(value, fallback, field) {
  const normalized = value === undefined || value === null ? fallback : value;
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || normalized < 0) {
    throw createCatalogError('invalidRequestField', `${field} must be a non-negative finite number`);
  }
  return normalized;
}

function reverseDirectionIf(direction, reverse) {
  if (!reverse) return direction;
  return direction === 'asc' ? 'desc' : 'asc';
}

function normalizeBoundedInteger(value, fallback, minimum, maximum, code) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw createCatalogError(code, 'Catalog worker option is outside its supported range');
  }
  return value;
}

function assertSchemaSearchFields(fields) {
  if (!Array.isArray(fields) || fields.length !== SEARCH_FIELDS.length || fields.some((field, index) => field !== SEARCH_FIELDS[index])) {
    throw createCatalogError('schemaContractMismatch', 'Catalog search fields do not match the shared schema');
  }
}

function assertExactFields(object, fields, code) {
  if (!isPlainObject(object)) throw createCatalogError(code, 'Catalog payload must be an object');
  const actual = Object.keys(object).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw createCatalogError(code, 'Catalog payload fields do not match the command contract');
  }
}

function assertAllowedFields(object, fields, code) {
  if (!isPlainObject(object)) throw createCatalogError(code, 'Catalog payload must be an object');
  const allowed = new Set(fields);
  if (Object.keys(object).some(field => !allowed.has(field))) {
    throw createCatalogError(code, 'Catalog payload contains unsupported fields');
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function createCatalogError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'LibraryCatalogError';
  error.code = code;
  error.details = details;
  return error;
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
