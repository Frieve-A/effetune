export const MUSIC_LIBRARY_SCHEMA_VERSION = 3;
export const MUSIC_LIBRARY_COLLATION_VERSION = 'canonical-natural-sort-key-v2';
export const MUSIC_LIBRARY_V3_DESKTOP_DIRECTORY = 'music-library-v3';
export const MUSIC_LIBRARY_V3_DESKTOP_DATABASE_PATH = 'music-library-v3/catalog.sqlite';
export const MUSIC_LIBRARY_V3_ARTWORK_DIRECTORY = 'music-library-v3/artwork';
export const MUSIC_LIBRARY_V3_CACHE_DIRECTORY = 'music-library-v3/cache';
export const MUSIC_LIBRARY_V3_WEB_OPFS_DIRECTORY = 'effetune-music-library-sqlite-v3';
export const MUSIC_LIBRARY_V3_WEB_DATABASE = 'catalog-v3.sqlite3';

export const MUSIC_LIBRARY_SEARCH_FIELDS = Object.freeze([
  'title',
  'artist',
  'album_artist',
  'album',
  'genre',
  'file_name',
  'relative_path'
]);

export const MUSIC_LIBRARY_V3_PRAGMAS_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
`;

export const MUSIC_LIBRARY_V3_WEB_PRAGMAS_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA page_size = 65536;
PRAGMA journal_mode = PERSIST;
PRAGMA temp_store = MEMORY;
`;

export const MUSIC_LIBRARY_V3_SCHEMA_SQL = `
DROP TABLE IF EXISTS playback_sequence_undo_owners;
DROP TABLE IF EXISTS transport_undo_records;
DROP TABLE IF EXISTS playback_sequence_transport_owners;
DROP TABLE IF EXISTS playback_sequence_operation_owners;
DROP TABLE IF EXISTS playback_sequence_items;
DROP TABLE IF EXISTS playback_sequences;
DROP TABLE IF EXISTS composed_segments;
DROP TABLE IF EXISTS transport_state;

CREATE TABLE IF NOT EXISTS meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  sort_name BLOB NOT NULL DEFAULT X'',
  path TEXT,
  status TEXT NOT NULL,
  scan_generation INTEGER NOT NULL DEFAULT 0 CHECK(scan_generation >= 0),
  lifecycle_version INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_version >= 0),
  added_at INTEGER NOT NULL,
  last_scan_at INTEGER
);

CREATE TABLE IF NOT EXISTS scan_runs(
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0 CHECK(error_count >= 0),
  stop_reason TEXT,
  found_count INTEGER NOT NULL DEFAULT 0 CHECK(found_count >= 0),
  unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK(unchanged_count >= 0),
  parsed_count INTEGER NOT NULL DEFAULT 0 CHECK(parsed_count >= 0),
  added_count INTEGER NOT NULL DEFAULT 0 CHECK(added_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK(updated_count >= 0),
  removed_count INTEGER NOT NULL DEFAULT 0 CHECK(removed_count >= 0)
);

CREATE TABLE IF NOT EXISTS scan_run_folders(
  scan_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE RESTRICT,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
  generation INTEGER NOT NULL CHECK(generation >= 0),
  expected_lifecycle_version INTEGER NOT NULL CHECK(expected_lifecycle_version >= 0),
  status TEXT NOT NULL,
  continuity_broken INTEGER NOT NULL DEFAULT 0 CHECK(continuity_broken IN (0, 1)),
  sweep_eligibility TEXT NOT NULL DEFAULT 'ELIGIBLE'
    CHECK(sweep_eligibility IN ('ELIGIBLE', 'INELIGIBLE')),
  durable_cursor TEXT,
  parser_version TEXT NOT NULL DEFAULT 'electron-parser-v1',
  sweep_block_reason TEXT,
  enumeration_error_count INTEGER NOT NULL DEFAULT 0 CHECK(enumeration_error_count >= 0),
  visited_files INTEGER NOT NULL DEFAULT 0 CHECK(visited_files >= 0),
  committed_batches INTEGER NOT NULL DEFAULT 0 CHECK(committed_batches >= 0),
  stop_reason TEXT,
  updated_at INTEGER,
  metadata_cursor INTEGER,
  PRIMARY KEY(scan_id, folder_id)
);

CREATE TABLE IF NOT EXISTS scan_seen(
  scan_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  canonical_path TEXT,
  file_identity TEXT,
  size INTEGER CHECK(size IS NULL OR size >= 0),
  mtime_ms INTEGER,
  observation_sequence INTEGER,
  PRIMARY KEY(scan_id, folder_id, relative_path),
  FOREIGN KEY(scan_id, folder_id) REFERENCES scan_run_folders(scan_id, folder_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS scan_logical_seen(
  scan_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  logical_storage_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  canonical_path TEXT,
  file_identity TEXT,
  size INTEGER CHECK(size IS NULL OR size >= 0),
  mtime_ms INTEGER,
  observation_sequence INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('file', 'cue-track')),
  entry_key TEXT,
  cue_relative_path TEXT,
  start_frame INTEGER,
  end_frame INTEGER,
  cue_signature TEXT,
  metadata_json TEXT,
  PRIMARY KEY(scan_id, folder_id, logical_storage_id),
  FOREIGN KEY(scan_id, folder_id) REFERENCES scan_run_folders(scan_id, folder_id) ON DELETE RESTRICT,
  CHECK (
    (source_kind = 'file' AND entry_key IS NULL AND cue_relative_path IS NULL
      AND start_frame IS NULL AND end_frame IS NULL AND cue_signature IS NULL)
    OR
    (source_kind = 'cue-track' AND entry_key IS NOT NULL AND cue_relative_path IS NOT NULL
      AND start_frame >= 0 AND (end_frame IS NULL OR end_frame > start_frame)
      AND cue_signature IS NOT NULL AND metadata_json IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS scan_errors(
  error_key INTEGER PRIMARY KEY,
  scan_id TEXT NOT NULL,
  folder_id TEXT,
  category TEXT NOT NULL,
  code TEXT,
  sample TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(scan_id) REFERENCES scan_runs(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS scan_cue_stage_files(
  scan_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  directory_path TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  entry_sequence INTEGER NOT NULL CHECK(entry_sequence >= 0),
  entry_kind TEXT NOT NULL CHECK(entry_kind IN ('cue', 'audio')),
  canonical_path TEXT,
  file_name_nfc TEXT NOT NULL,
  file_name_folded TEXT NOT NULL,
  file_identity TEXT,
  size INTEGER CHECK(size IS NULL OR size >= 0),
  mtime_ms INTEGER,
  metadata_status TEXT CHECK(metadata_status IS NULL OR metadata_status IN ('ok', 'terminal')),
  metadata_json TEXT,
  PRIMARY KEY(scan_id, folder_id, directory_path, relative_path),
  UNIQUE(scan_id, folder_id, directory_path, entry_sequence),
  FOREIGN KEY(scan_id, folder_id) REFERENCES scan_run_folders(scan_id, folder_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS scan_cue_stage_files_page
  ON scan_cue_stage_files(scan_id, folder_id, directory_path, entry_sequence);
CREATE INDEX IF NOT EXISTS scan_cue_stage_files_name
  ON scan_cue_stage_files(scan_id, folder_id, directory_path, file_name_nfc, file_name_folded);

CREATE TABLE IF NOT EXISTS scan_cue_stage_sheets(
  scan_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  directory_path TEXT NOT NULL,
  cue_relative_path TEXT NOT NULL,
  cue_order_key TEXT NOT NULL,
  cue_signature TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('parsed', 'valid', 'invalid')),
  accepted INTEGER NOT NULL DEFAULT 0 CHECK(accepted IN (0, 1)),
  disc_json TEXT NOT NULL,
  track_total INTEGER NOT NULL CHECK(track_total BETWEEN 1 AND 99),
  PRIMARY KEY(scan_id, folder_id, directory_path, cue_relative_path),
  FOREIGN KEY(scan_id, folder_id) REFERENCES scan_run_folders(scan_id, folder_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS scan_cue_stage_sheets_order
  ON scan_cue_stage_sheets(scan_id, folder_id, directory_path, status, accepted, cue_order_key, cue_relative_path);

CREATE TABLE IF NOT EXISTS scan_cue_stage_tracks(
  scan_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  directory_path TEXT NOT NULL,
  cue_relative_path TEXT NOT NULL,
  track_no INTEGER NOT NULL CHECK(track_no BETWEEN 1 AND 99),
  source_relative_path TEXT NOT NULL,
  track_json TEXT NOT NULL,
  duration_sec REAL CHECK(duration_sec IS NULL OR duration_sec > 0),
  PRIMARY KEY(scan_id, folder_id, directory_path, cue_relative_path, track_no),
  FOREIGN KEY(scan_id, folder_id, directory_path, cue_relative_path)
    REFERENCES scan_cue_stage_sheets(scan_id, folder_id, directory_path, cue_relative_path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS scan_cue_stage_tracks_source
  ON scan_cue_stage_tracks(scan_id, folder_id, directory_path, source_relative_path, cue_relative_path, track_no);

CREATE TABLE IF NOT EXISTS scan_cue_stage_owners(
  scan_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  directory_path TEXT NOT NULL,
  source_relative_path TEXT NOT NULL,
  cue_relative_path TEXT NOT NULL,
  PRIMARY KEY(scan_id, folder_id, directory_path, source_relative_path),
  FOREIGN KEY(scan_id, folder_id, directory_path, cue_relative_path)
    REFERENCES scan_cue_stage_sheets(scan_id, folder_id, directory_path, cue_relative_path) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS operation_jobs(
  operation_id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  canonical_request_version INTEGER NOT NULL CHECK(canonical_request_version > 0),
  operation_kind TEXT NOT NULL,
  target_identity TEXT,
  expected_target_version INTEGER,
  phase TEXT NOT NULL CHECK(phase IN (
    'RECEIVED', 'SNAPSHOTTING', 'READY', 'CANCEL_REQUESTED', 'COMMITTING',
    'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'
  )),
  heavy INTEGER NOT NULL DEFAULT 0 CHECK(heavy IN (0, 1)),
  committed INTEGER NOT NULL DEFAULT 0 CHECK(committed IN (0, 1)),
  terminal_kind TEXT CHECK(terminal_kind IS NULL OR terminal_kind IN ('success', 'failed', 'cancelled', 'interrupted')),
  terminal_code TEXT,
  terminal_result_json TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK(processed_count >= 0),
  total_count INTEGER CHECK(total_count IS NULL OR total_count >= 0),
  source_context_token TEXT,
  build_deadline_at INTEGER,
  reserved_terminal_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_terminal_bytes >= 0),
  context_released INTEGER NOT NULL DEFAULT 0 CHECK(context_released IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  CHECK((terminal_kind IS NULL) = (finished_at IS NULL)),
  CHECK((committed = 0) OR terminal_kind = 'success')
);

CREATE UNIQUE INDEX IF NOT EXISTS operation_jobs_one_active_heavy
  ON operation_jobs(heavy)
  WHERE heavy = 1 AND terminal_kind IS NULL;
CREATE INDEX IF NOT EXISTS operation_jobs_terminal_retention
  ON operation_jobs(finished_at, operation_id)
  WHERE terminal_kind IS NOT NULL;
CREATE INDEX IF NOT EXISTS operation_jobs_target_lease
  ON operation_jobs(target_identity, operation_id)
  WHERE terminal_kind IS NULL AND target_identity IS NOT NULL;

CREATE TABLE IF NOT EXISTS snapshot_objects(
  snapshot_id TEXT PRIMARY KEY,
  snapshot_kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('staging', 'sealed', 'gc-pending')),
  staging_operation_id TEXT REFERENCES operation_jobs(operation_id) ON DELETE RESTRICT,
  owner_ref_count INTEGER NOT NULL DEFAULT 0 CHECK(owner_ref_count >= 0),
  item_count INTEGER CHECK(item_count IS NULL OR item_count >= 0),
  membership_digest TEXT,
  order_digest TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  CHECK((state = 'staging') = (staging_operation_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS snapshot_object_owners(
  snapshot_id TEXT NOT NULL REFERENCES snapshot_objects(snapshot_id) ON DELETE RESTRICT,
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  ref_count INTEGER NOT NULL CHECK(ref_count > 0),
  PRIMARY KEY(snapshot_id, owner_kind, owner_id)
);

CREATE TABLE IF NOT EXISTS artwork_assets(
  id TEXT PRIMARY KEY,
  digest_algorithm TEXT NOT NULL,
  digest_version INTEGER NOT NULL CHECK(digest_version > 0),
  full_digest TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  content_type TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0 CHECK(ref_count >= 0),
  last_accessed_at INTEGER,
  UNIQUE(digest_algorithm, digest_version, full_digest)
);

CREATE TABLE IF NOT EXISTS artwork_blobs(
  artwork_id TEXT PRIMARY KEY REFERENCES artwork_assets(id) ON DELETE RESTRICT,
  storage_kind TEXT NOT NULL,
  storage_locator TEXT,
  bytes BLOB,
  CHECK((storage_locator IS NULL) <> (bytes IS NULL))
);

CREATE TABLE IF NOT EXISTS artwork_variants(
  artwork_id TEXT NOT NULL REFERENCES artwork_assets(id) ON DELETE RESTRICT,
  variant TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  content_type TEXT NOT NULL,
  width INTEGER CHECK(width IS NULL OR width > 0),
  height INTEGER CHECK(height IS NULL OR height > 0),
  storage_locator TEXT,
  bytes BLOB,
  last_accessed_at INTEGER NOT NULL,
  PRIMARY KEY(artwork_id, variant),
  CHECK((storage_locator IS NULL) <> (bytes IS NULL))
);

CREATE TABLE IF NOT EXISTS track_artwork_sources(
  track_uid TEXT PRIMARY KEY REFERENCES tracks(track_uid) ON DELETE RESTRICT,
  file_identity TEXT NOT NULL,
  lifecycle_version INTEGER,
  source_kind TEXT,
  canonical_source_identity TEXT,
  size INTEGER NOT NULL CHECK(size >= 0),
  mtime_ms INTEGER NOT NULL CHECK(mtime_ms >= 0),
  embedded_offset INTEGER,
  embedded_length INTEGER,
  external_artwork_stat_json TEXT,
  extractor_version TEXT,
  artwork_id TEXT NOT NULL REFERENCES artwork_assets(id) ON DELETE RESTRICT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks(
  track_key INTEGER PRIMARY KEY,
  track_uid TEXT NOT NULL UNIQUE,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
  relative_path TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'file' CHECK(source_kind IN ('file', 'cue-track')),
  entry_key TEXT,
  cue_relative_path TEXT,
  start_frame INTEGER,
  end_frame INTEGER,
  cue_signature TEXT,
  file_identity TEXT,
  file_name TEXT NOT NULL,
  size INTEGER CHECK(size IS NULL OR size >= 0),
  mtime_ms INTEGER,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album_artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  year INTEGER,
  compilation INTEGER NOT NULL DEFAULT 0 CHECK(compilation IN (0, 1)),
  disc_no INTEGER,
  disc_total INTEGER,
  track_no INTEGER,
  track_total INTEGER,
  sort_title BLOB NOT NULL DEFAULT X'',
  sort_album_artist BLOB NOT NULL DEFAULT X'',
  sort_album BLOB NOT NULL DEFAULT X'',
  sort_genre BLOB NOT NULL DEFAULT X'',
  duration_sec REAL,
  sample_rate INTEGER,
  bitrate INTEGER,
  bits_per_sample INTEGER,
  channels INTEGER,
  codec TEXT,
  metadata_status TEXT NOT NULL DEFAULT 'ok'
    CHECK(metadata_status IN ('ok', 'parsing', 'retryable-error', 'terminal-error')),
  metadata_error_code TEXT,
  metadata_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(metadata_attempt_count >= 0),
  metadata_last_attempt_generation INTEGER,
  metadata_parser_version TEXT NOT NULL,
  metadata_last_success_at INTEGER,
  artwork_id TEXT REFERENCES artwork_assets(id) ON DELETE RESTRICT,
  extension_json TEXT,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  search_text TEXT NOT NULL,
  normalized_basename TEXT NOT NULL DEFAULT '',
  normalized_title TEXT NOT NULL DEFAULT '',
  normalized_artist TEXT NOT NULL DEFAULT '',
  duration_bucket INTEGER,
  album_key TEXT,
  artist_key TEXT,
  genre_key TEXT,
  subfolder_key TEXT,
  CHECK (
    (source_kind = 'file' AND entry_key IS NULL AND cue_relative_path IS NULL
      AND start_frame IS NULL AND end_frame IS NULL AND cue_signature IS NULL)
    OR
    (source_kind = 'cue-track' AND entry_key IS NOT NULL AND cue_relative_path IS NOT NULL
      AND start_frame >= 0 AND (end_frame IS NULL OR end_frame > start_frame)
      AND cue_signature IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS albums(
  album_key TEXT PRIMARY KEY,
  identity_version INTEGER NOT NULL CHECK(identity_version > 0),
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  sort_name BLOB NOT NULL,
  sort_artist BLOB NOT NULL,
  track_count INTEGER NOT NULL CHECK(track_count >= 0),
  total_duration_sec REAL NOT NULL DEFAULT 0 CHECK(total_duration_sec >= 0),
  representative_artwork_id TEXT REFERENCES artwork_assets(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS artists(
  artist_key TEXT PRIMARY KEY,
  identity_version INTEGER NOT NULL CHECK(identity_version > 0),
  name TEXT NOT NULL,
  sort_name BLOB NOT NULL,
  track_count INTEGER NOT NULL CHECK(track_count >= 0),
  total_duration_sec REAL NOT NULL DEFAULT 0 CHECK(total_duration_sec >= 0),
  representative_artwork_id TEXT REFERENCES artwork_assets(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS genres(
  genre_key TEXT PRIMARY KEY,
  identity_version INTEGER NOT NULL CHECK(identity_version > 0),
  name TEXT NOT NULL,
  sort_name BLOB NOT NULL,
  track_count INTEGER NOT NULL CHECK(track_count >= 0),
  total_duration_sec REAL NOT NULL DEFAULT 0 CHECK(total_duration_sec >= 0),
  representative_artwork_id TEXT REFERENCES artwork_assets(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS track_albums(
  track_uid TEXT PRIMARY KEY REFERENCES tracks(track_uid) ON DELETE RESTRICT,
  album_key TEXT NOT NULL REFERENCES albums(album_key) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS track_artists(
  track_uid TEXT NOT NULL REFERENCES tracks(track_uid) ON DELETE RESTRICT,
  artist_key TEXT NOT NULL REFERENCES artists(artist_key) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  PRIMARY KEY(track_uid, artist_key, role)
);

CREATE TABLE IF NOT EXISTS track_genres(
  track_uid TEXT NOT NULL REFERENCES tracks(track_uid) ON DELETE RESTRICT,
  genre_key TEXT NOT NULL REFERENCES genres(genre_key) ON DELETE RESTRICT,
  PRIMARY KEY(track_uid, genre_key)
);

CREATE TABLE IF NOT EXISTS subfolders(
  subfolder_key TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
  relative_path TEXT NOT NULL,
  identity_version INTEGER NOT NULL CHECK(identity_version > 0),
  display_name TEXT NOT NULL,
  sort_name BLOB NOT NULL,
  track_count INTEGER NOT NULL CHECK(track_count >= 0),
  total_duration_sec REAL NOT NULL DEFAULT 0 CHECK(total_duration_sec >= 0),
  representative_artwork_id TEXT REFERENCES artwork_assets(id) ON DELETE RESTRICT,
  UNIQUE(folder_id, relative_path)
);

CREATE TABLE IF NOT EXISTS track_subfolders(
  track_uid TEXT PRIMARY KEY REFERENCES tracks(track_uid) ON DELETE RESTRICT,
  subfolder_key TEXT NOT NULL REFERENCES subfolders(subfolder_key) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS tracks_by_title ON tracks(sort_title, track_uid);
CREATE INDEX IF NOT EXISTS tracks_by_genre ON tracks(sort_genre, sort_album_artist, sort_album, track_uid);
CREATE INDEX IF NOT EXISTS tracks_by_added ON tracks(added_at DESC, track_uid DESC);
CREATE INDEX IF NOT EXISTS tracks_by_artist_order_v2
  ON tracks(sort_album_artist, sort_album, COALESCE(disc_no, 9007199254740991),
    COALESCE(track_no, 9007199254740991), sort_title, track_uid);
CREATE INDEX IF NOT EXISTS tracks_by_album_order_v2
  ON tracks(sort_album, COALESCE(disc_no, 9007199254740991),
    COALESCE(track_no, 9007199254740991), sort_title, track_uid);
CREATE INDEX IF NOT EXISTS tracks_by_duration_order_v2
  ON tracks(COALESCE(duration_sec, 1.7976931348623157e+308), sort_title, track_uid);
CREATE UNIQUE INDEX IF NOT EXISTS tracks_plain_storage_unique_v3
  ON tracks(folder_id, relative_path) WHERE source_kind = 'file';
CREATE UNIQUE INDEX IF NOT EXISTS tracks_cue_storage_unique_v3
  ON tracks(folder_id, entry_key) WHERE source_kind = 'cue-track';
CREATE INDEX IF NOT EXISTS tracks_terminal_by_parser ON tracks(metadata_parser_version, track_key)
  WHERE metadata_status = 'terminal-error';
CREATE INDEX IF NOT EXISTS tracks_resolve_by_basename ON tracks(normalized_basename, track_uid);
CREATE INDEX IF NOT EXISTS tracks_resolve_by_title_artist ON tracks(normalized_title, normalized_artist, track_uid);
CREATE INDEX IF NOT EXISTS track_albums_by_album ON track_albums(album_key, track_uid);
CREATE INDEX IF NOT EXISTS track_artists_by_artist ON track_artists(artist_key, track_uid);
CREATE INDEX IF NOT EXISTS track_genres_by_genre ON track_genres(genre_key, track_uid);
CREATE INDEX IF NOT EXISTS track_subfolders_by_subfolder ON track_subfolders(subfolder_key, track_uid);
CREATE INDEX IF NOT EXISTS subfolders_by_name ON subfolders(sort_name, subfolder_key);
CREATE INDEX IF NOT EXISTS subfolders_by_track_count ON subfolders(track_count, sort_name, subfolder_key);
CREATE INDEX IF NOT EXISTS subfolders_by_duration ON subfolders(total_duration_sec, sort_name, subfolder_key);

CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
  search_text,
  content='tracks',
  content_rowid='track_key',
  tokenize='trigram',
  detail=none,
  columnsize=0
);

CREATE VIRTUAL TABLE IF NOT EXISTS tracks_prefix_fts USING fts5(
  search_text,
  content='tracks',
  content_rowid='track_key',
  tokenize='unicode61 remove_diacritics 0',
  detail=none,
  columnsize=0
);

INSERT INTO tracks_fts(tracks_fts, rank) VALUES ('automerge', 8);
INSERT INTO tracks_fts(tracks_fts, rank) VALUES ('crisismerge', 64);
INSERT INTO tracks_prefix_fts(tracks_prefix_fts, rank) VALUES ('automerge', 8);
INSERT INTO tracks_prefix_fts(tracks_prefix_fts, rank) VALUES ('crisismerge', 64);

CREATE TABLE IF NOT EXISTS search_index_control(
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  deferred INTEGER NOT NULL DEFAULT 0 CHECK(deferred IN (0, 1))
);

INSERT OR IGNORE INTO search_index_control(singleton, deferred) VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS tracks_search_ai AFTER INSERT ON tracks
WHEN (SELECT deferred FROM search_index_control WHERE singleton = 1) = 0 BEGIN
  INSERT INTO tracks_fts(rowid, search_text) VALUES (new.track_key, new.search_text);
  INSERT INTO tracks_prefix_fts(rowid, search_text) VALUES (new.track_key, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS tracks_search_ad AFTER DELETE ON tracks
WHEN (SELECT deferred FROM search_index_control WHERE singleton = 1) = 0 BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, search_text)
    VALUES ('delete', old.track_key, old.search_text);
  INSERT INTO tracks_prefix_fts(tracks_prefix_fts, rowid, search_text)
    VALUES ('delete', old.track_key, old.search_text);
END;

CREATE TRIGGER IF NOT EXISTS tracks_search_au AFTER UPDATE OF search_text ON tracks
WHEN old.search_text IS NOT new.search_text
  AND (SELECT deferred FROM search_index_control WHERE singleton = 1) = 0 BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, search_text)
    VALUES ('delete', old.track_key, old.search_text);
  INSERT INTO tracks_fts(rowid, search_text) VALUES (new.track_key, new.search_text);
  INSERT INTO tracks_prefix_fts(tracks_prefix_fts, rowid, search_text)
    VALUES ('delete', old.track_key, old.search_text);
  INSERT INTO tracks_prefix_fts(rowid, search_text) VALUES (new.track_key, new.search_text);
END;

CREATE TABLE IF NOT EXISTS playlists(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_name BLOB NOT NULL DEFAULT X'',
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('building', 'active', 'deleted')),
  building_operation_id TEXT REFERENCES operation_jobs(operation_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((state = 'building') = (building_operation_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS playlist_items(
  item_key INTEGER PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  track_uid TEXT REFERENCES tracks(track_uid) ON DELETE RESTRICT,
  unresolved_json TEXT,
  unresolved_basename TEXT,
  unresolved_title TEXT,
  unresolved_artist TEXT,
  unresolved_duration_bucket INTEGER,
  pending_operation_id TEXT REFERENCES operation_jobs(operation_id) ON DELETE RESTRICT,
  import_fields_json TEXT,
  import_has_path INTEGER CHECK(import_has_path IS NULL OR import_has_path IN (0, 1)),
  UNIQUE(playlist_id, position),
  CHECK((track_uid IS NULL) <> (unresolved_json IS NULL))
);

CREATE INDEX IF NOT EXISTS playlist_items_unresolved_by_basename
  ON playlist_items(unresolved_basename) WHERE track_uid IS NULL;
CREATE INDEX IF NOT EXISTS playlist_items_unresolved_by_title_artist
  ON playlist_items(unresolved_title, unresolved_artist) WHERE track_uid IS NULL;
CREATE INDEX IF NOT EXISTS playlist_items_unresolved_by_duration
  ON playlist_items(unresolved_duration_bucket) WHERE track_uid IS NULL;
CREATE INDEX IF NOT EXISTS playlist_items_by_track
  ON playlist_items(track_uid, item_key) WHERE track_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS playlist_items_by_pending_op
  ON playlist_items(pending_operation_id, item_key) WHERE pending_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS playlists_by_building_op
  ON playlists(building_operation_id) WHERE building_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS automatic_playlist_sources(
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  playlist_id TEXT NOT NULL UNIQUE REFERENCES playlists(id) ON DELETE CASCADE,
  content_digest TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  PRIMARY KEY(folder_id, relative_path)
);

CREATE TABLE IF NOT EXISTS automatic_playlist_import_jobs(
  operation_id TEXT PRIMARY KEY REFERENCES operation_jobs(operation_id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
  relative_path TEXT NOT NULL,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE RESTRICT,
  content_digest TEXT NOT NULL,
  base_position INTEGER NOT NULL CHECK(base_position >= 0),
  expected_version INTEGER NOT NULL CHECK(expected_version >= 0),
  UNIQUE(folder_id, relative_path, operation_id)
);

CREATE INDEX IF NOT EXISTS automatic_playlist_import_jobs_by_playlist
  ON automatic_playlist_import_jobs(playlist_id, operation_id);

CREATE TABLE IF NOT EXISTS deletion_jobs(
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  cursor_key INTEGER,
  folder_id TEXT,
  lifecycle_version INTEGER,
  track_uid TEXT,
  scan_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deletion_repair_items(
  job_id TEXT NOT NULL REFERENCES deletion_jobs(job_id) ON DELETE RESTRICT,
  item_key INTEGER NOT NULL REFERENCES playlist_items(item_key) ON DELETE RESTRICT,
  original_track_uid TEXT NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY(job_id, item_key)
);

CREATE INDEX IF NOT EXISTS folders_by_sort_name ON folders(sort_name, id);
CREATE INDEX IF NOT EXISTS playlists_by_sort_name ON playlists(sort_name, id);
CREATE TABLE IF NOT EXISTS sequence_save_pages(
  operation_id TEXT NOT NULL REFERENCES operation_jobs(operation_id) ON DELETE RESTRICT,
  segment_index INTEGER NOT NULL CHECK(segment_index >= 0),
  transport_ordinal INTEGER NOT NULL CHECK(transport_ordinal >= 0),
  appended_count INTEGER NOT NULL CHECK(appended_count >= 0),
  PRIMARY KEY(operation_id, segment_index, transport_ordinal)
);

CREATE TABLE IF NOT EXISTS operation_progress(
  operation_id TEXT PRIMARY KEY REFERENCES operation_jobs(operation_id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  phase TEXT NOT NULL,
  processed INTEGER NOT NULL CHECK(processed >= 0),
  total INTEGER CHECK(total IS NULL OR total >= 0),
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot_items(
  snapshot_id TEXT NOT NULL REFERENCES snapshot_objects(snapshot_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  track_uid TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, ordinal)
);

CREATE INDEX IF NOT EXISTS snapshot_items_by_track
  ON snapshot_items(track_uid, snapshot_id, ordinal);

CREATE TABLE IF NOT EXISTS metadata_claims(
  folder_id TEXT NOT NULL,
  logical_storage_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  track_uid TEXT NOT NULL,
  lifecycle_version INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  parser_version TEXT NOT NULL,
  signature_json TEXT NOT NULL,
  cue_signature TEXT,
  status TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY(folder_id, logical_storage_id)
);

CREATE TABLE IF NOT EXISTS artwork_claims(
  claim_id TEXT PRIMARY KEY,
  track_uid TEXT NOT NULL,
  utility_session_id TEXT NOT NULL,
  source_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('extracting', 'gc-pending')),
  claimed_at INTEGER NOT NULL,
  admitted_at INTEGER,
  admitted_thumbnail_bytes INTEGER,
  UNIQUE(track_uid)
);

CREATE INDEX IF NOT EXISTS artwork_claims_by_status
  ON artwork_claims(status, claimed_at, claim_id);
CREATE INDEX IF NOT EXISTS deletion_jobs_by_state_kind
  ON deletion_jobs(state, kind, updated_at, job_id);
CREATE INDEX IF NOT EXISTS deletion_repair_items_by_track
  ON deletion_repair_items(original_track_uid, job_id, item_key);

`;

export const MUSIC_LIBRARY_V3_SESSION_SCHEMA_SQL = `
CREATE TEMP TABLE IF NOT EXISTS playback_sequences(
  id TEXT PRIMARY KEY,
  source_context TEXT NOT NULL,
  catalog_version INTEGER NOT NULL CHECK(catalog_version >= 0),
  state TEXT NOT NULL CHECK(state IN ('building', 'active')),
  item_count INTEGER CHECK(item_count IS NULL OR item_count >= 0),
  seed INTEGER,
  current_ordinal INTEGER,
  created_at INTEGER NOT NULL,
  sealed_at INTEGER
);

CREATE TEMP TABLE IF NOT EXISTS playback_sequence_items(
  sequence_id TEXT NOT NULL REFERENCES playback_sequences(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  entry_instance_id TEXT NOT NULL UNIQUE,
  track_uid TEXT NOT NULL,
  PRIMARY KEY(sequence_id, ordinal)
);
`;

export const MUSIC_LIBRARY_V3_WEB_CONTEXT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS query_contexts(
  context_token TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  query_text TEXT NOT NULL,
  sort_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('asc', 'desc')),
  scope_json TEXT NOT NULL,
  query_fingerprint TEXT NOT NULL,
  snapshot_version INTEGER NOT NULL CHECK(snapshot_version >= 0),
  visible_scope_versions_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_access_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  owner_count INTEGER NOT NULL DEFAULT 0 CHECK(owner_count >= 0),
  release_requested INTEGER NOT NULL DEFAULT 0 CHECK(release_requested IN (0, 1)),
  shadow_count INTEGER NOT NULL DEFAULT 0 CHECK(shadow_count >= 0),
  snapshot_overflow INTEGER NOT NULL DEFAULT 0 CHECK(snapshot_overflow IN (0, 1)),
  total_count INTEGER CHECK(total_count IS NULL OR total_count >= 0)
);

CREATE INDEX IF NOT EXISTS query_contexts_by_expiry
  ON query_contexts(expires_at, context_token);

CREATE TABLE IF NOT EXISTS query_context_track_before_images(
  context_token TEXT NOT NULL REFERENCES query_contexts(context_token) ON DELETE CASCADE,
  track_uid TEXT NOT NULL,
  existed INTEGER NOT NULL CHECK(existed IN (0, 1)),
  track_key INTEGER,
  folder_id TEXT,
  relative_path TEXT,
  source_kind TEXT,
  entry_key TEXT,
  cue_relative_path TEXT,
  start_frame INTEGER,
  end_frame INTEGER,
  title TEXT,
  artist TEXT,
  album_artist TEXT,
  album TEXT,
  genre TEXT,
  year INTEGER,
  disc_no INTEGER,
  track_no INTEGER,
  duration_sec REAL,
  added_at INTEGER,
  metadata_status TEXT,
  artwork_id TEXT,
  sort_title BLOB,
  sort_album_artist BLOB,
  sort_album BLOB,
  sort_genre BLOB,
  search_text TEXT,
  normalized_title TEXT,
  album_key TEXT,
  artist_key TEXT,
  genre_key TEXT,
  subfolder_key TEXT,
  PRIMARY KEY(context_token, track_uid)
);

CREATE INDEX IF NOT EXISTS query_context_track_before_images_by_context
  ON query_context_track_before_images(context_token, track_uid);

CREATE TRIGGER IF NOT EXISTS query_context_before_image_count_insert
AFTER INSERT ON query_context_track_before_images
BEGIN
  UPDATE query_contexts SET shadow_count = shadow_count + 1
  WHERE context_token = NEW.context_token;
END;

CREATE TRIGGER IF NOT EXISTS query_context_before_image_count_delete
AFTER DELETE ON query_context_track_before_images
BEGIN
  UPDATE query_contexts SET shadow_count = CASE WHEN shadow_count > 0 THEN shadow_count - 1 ELSE 0 END
  WHERE context_token = OLD.context_token;
END;

CREATE TRIGGER IF NOT EXISTS tracks_preserve_context_before_update
BEFORE UPDATE ON tracks
BEGIN
  UPDATE query_contexts SET snapshot_overflow = 1
  WHERE entity_type = 'track' AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
    AND shadow_count >= 10000
    AND NOT EXISTS (
      SELECT 1 FROM query_context_track_before_images b
      WHERE b.context_token = query_contexts.context_token AND b.track_uid = OLD.track_uid
    );
  INSERT OR IGNORE INTO query_context_track_before_images(
    context_token, track_uid, existed, track_key, folder_id, relative_path, source_kind,
    entry_key, cue_relative_path, start_frame, end_frame, title, artist,
    album_artist, album, genre, year, disc_no, track_no, duration_sec, added_at,
    metadata_status, artwork_id, sort_title, sort_album_artist, sort_album,
    sort_genre, search_text, normalized_title, album_key, artist_key, genre_key, subfolder_key
  )
  SELECT context_token, OLD.track_uid, 1, OLD.track_key, OLD.folder_id, OLD.relative_path,
    OLD.source_kind, OLD.entry_key, OLD.cue_relative_path, OLD.start_frame, OLD.end_frame, OLD.title,
    OLD.artist, OLD.album_artist, OLD.album, OLD.genre, OLD.year, OLD.disc_no,
    OLD.track_no, OLD.duration_sec, OLD.added_at, OLD.metadata_status, OLD.artwork_id,
    OLD.sort_title, OLD.sort_album_artist, OLD.sort_album, OLD.sort_genre,
    OLD.search_text, OLD.normalized_title, OLD.album_key, OLD.artist_key, OLD.genre_key, OLD.subfolder_key
  FROM query_contexts
  WHERE entity_type = 'track' AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
    AND snapshot_overflow = 0 AND shadow_count < 10000;
END;

CREATE TRIGGER IF NOT EXISTS tracks_preserve_context_before_delete
BEFORE DELETE ON tracks
BEGIN
  UPDATE query_contexts SET snapshot_overflow = 1
  WHERE entity_type = 'track' AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
    AND shadow_count >= 10000
    AND NOT EXISTS (
      SELECT 1 FROM query_context_track_before_images b
      WHERE b.context_token = query_contexts.context_token AND b.track_uid = OLD.track_uid
    );
  INSERT OR IGNORE INTO query_context_track_before_images(
    context_token, track_uid, existed, track_key, folder_id, relative_path, source_kind,
    entry_key, cue_relative_path, start_frame, end_frame, title, artist,
    album_artist, album, genre, year, disc_no, track_no, duration_sec, added_at,
    metadata_status, artwork_id, sort_title, sort_album_artist, sort_album,
    sort_genre, search_text, normalized_title, album_key, artist_key, genre_key, subfolder_key
  )
  SELECT context_token, OLD.track_uid, 1, OLD.track_key, OLD.folder_id, OLD.relative_path,
    OLD.source_kind, OLD.entry_key, OLD.cue_relative_path, OLD.start_frame, OLD.end_frame, OLD.title,
    OLD.artist, OLD.album_artist, OLD.album, OLD.genre, OLD.year, OLD.disc_no,
    OLD.track_no, OLD.duration_sec, OLD.added_at, OLD.metadata_status, OLD.artwork_id,
    OLD.sort_title, OLD.sort_album_artist, OLD.sort_album, OLD.sort_genre,
    OLD.search_text, OLD.normalized_title, OLD.album_key, OLD.artist_key, OLD.genre_key, OLD.subfolder_key
  FROM query_contexts
  WHERE entity_type = 'track' AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
    AND snapshot_overflow = 0 AND shadow_count < 10000;
END;

CREATE TRIGGER IF NOT EXISTS tracks_preserve_context_after_insert
AFTER INSERT ON tracks
BEGIN
  UPDATE query_contexts SET snapshot_overflow = 1
  WHERE entity_type = 'track' AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
    AND shadow_count >= 10000
    AND NOT EXISTS (
      SELECT 1 FROM query_context_track_before_images b
      WHERE b.context_token = query_contexts.context_token AND b.track_uid = NEW.track_uid
    );
  INSERT OR IGNORE INTO query_context_track_before_images(context_token, track_uid, existed)
  SELECT context_token, NEW.track_uid, 0 FROM query_contexts
  WHERE entity_type = 'track' AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
    AND snapshot_overflow = 0 AND shadow_count < 10000;
END;
`;

export function getMusicLibraryV3InitializationSql({ includePragmas = true, journalMode = 'wal' } = {}) {
  const pragmas = journalMode === 'persist'
    ? MUSIC_LIBRARY_V3_WEB_PRAGMAS_SQL
    : MUSIC_LIBRARY_V3_PRAGMAS_SQL;
  const schema = journalMode === 'persist'
    ? `${MUSIC_LIBRARY_V3_SCHEMA_SQL}\n${MUSIC_LIBRARY_V3_SESSION_SCHEMA_SQL}\n${MUSIC_LIBRARY_V3_WEB_CONTEXT_SCHEMA_SQL}`
    : `${MUSIC_LIBRARY_V3_SCHEMA_SQL}\n${MUSIC_LIBRARY_V3_SESSION_SCHEMA_SQL}`;
  return includePragmas
    ? `${pragmas}\n${schema}`
    : schema;
}
