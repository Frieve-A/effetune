import { createTransportOrdinalMapper, MAX_TRANSPORT_SEQUENCE_ITEMS } from './transport-shuffle.js';

const PAGE_BYTES = 512 * 1024;
const encoder = new TextEncoder();

function integer(value, maximum = MAX_TRANSPORT_SEQUENCE_ITEMS) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError('Invalid playback session ordinal');
  }
  return value;
}

function stateJson(state) {
  if (!['materialized', 'catalog'].includes(state?.kind) || integer(state.itemCount) === 0 ||
      (state.kind === 'materialized' && state.itemCount > 4096)) {
    throw new TypeError('Invalid playback session queue');
  }
  integer(state.currentOrdinal, state.itemCount - 1);
  const json = JSON.stringify(state);
  if (encoder.encode(json).length > 8192) throw new RangeError('Invalid playback session state');
  return json;
}

// Staging is connection-local. Only commit replaces the durable queue and its state.
export function accessPlaybackSession(catalog, transaction, request) {
  const db = catalog.database;
  const { action, profileKey, state } = request;
  if (typeof profileKey !== 'string' || profileKey.length > 64) throw new TypeError('Invalid session profile');
  switch (action) {
    case 'begin':
      return transaction(() => {
        db.prepare('DELETE FROM session_builds WHERE profile_key = ?').run(profileKey);
        db.prepare('INSERT INTO session_builds VALUES (?, ?)').run(profileKey, stateJson(state));
        return true;
      });
    case 'append':
      return transaction(() => {
        const insert = db.prepare('INSERT INTO session_build_items VALUES (?, ?, ?, ?, ?)');
        for (const { ordinal, originalOrdinal, trackUid, track } of request.rows) {
          const file = trackUid == null && typeof track?.path === 'string' ? JSON.stringify(track) : null;
          if (file && encoder.encode(file).length > PAGE_BYTES - 8192) throw new RangeError('Session entry is too large');
          if (!file && (typeof trackUid !== 'string' || !trackUid || trackUid.length > 512)) {
            throw new TypeError('Invalid session entry');
          }
          insert.run(profileKey, integer(ordinal), originalOrdinal == null ? null : integer(originalOrdinal),
            file ? null : trackUid, file);
        }
        return { excludedCount: 0 };
      });
    case 'copy':
      return transaction(() => copyCatalogSegment(db, profileKey, request));
    case 'commit':
      return transaction(() => {
        const build = db.prepare('SELECT state_json AS state FROM session_builds WHERE profile_key = ?').get(profileKey);
        if (!build) throw new Error('No session save in progress');
        const last = db.prepare('SELECT MAX(ordinal) AS last FROM session_build_items WHERE profile_key = ?').get(profileKey);
        if (last.last >= JSON.parse(build.state).itemCount) throw new RangeError('Session entry exceeds queue length');
        db.prepare('DELETE FROM playback_sessions WHERE profile_key = ?').run(profileKey);
        db.prepare('INSERT INTO playback_sessions VALUES (?, ?)').run(profileKey, build.state);
        db.prepare(`INSERT INTO playback_session_items
          SELECT * FROM session_build_items WHERE profile_key = ?`).run(profileKey);
        db.prepare('DELETE FROM session_builds WHERE profile_key = ?').run(profileKey);
        return true;
      });
    case 'update':
      db.prepare('UPDATE playback_sessions SET state_json = ? WHERE profile_key = ?').run(stateJson(state), profileKey);
      return true;
    case 'delete':
      return transaction(() => {
        db.prepare('DELETE FROM session_builds WHERE profile_key = ?').run(profileKey);
        db.prepare('DELETE FROM session_restore_items WHERE profile_key = ?').run(profileKey);
        db.prepare('DELETE FROM playback_sessions WHERE profile_key = ?').run(profileKey);
        return true;
      });
    case 'read':
      return transaction(() => prepareRestore(db, profileKey, catalog.catalogVersion));
    case 'page':
      return restorePage(db, profileKey, integer(request.startOrdinal));
    default:
      throw new TypeError('Unknown playback session action');
  }
}

function copyCatalogSegment(db, profileKey, request) {
  const { sequenceId, sourceOrdinals, destinationOrdinals } = request;
  if ((sourceOrdinals != null && !Array.isArray(sourceOrdinals)) ||
      (destinationOrdinals != null && (!Array.isArray(destinationOrdinals) ||
        !sourceOrdinals || destinationOrdinals.length !== sourceOrdinals.length))) {
    throw new TypeError('Invalid session ordinal mapping');
  }
  const destination = destinationOrdinals ? 0 : integer(request.ordinal);
  const sequence = db.prepare(`SELECT item_count AS count FROM playback_sequences
    WHERE id = ? AND state = 'active'`).get(sequenceId);
  if (!sequence) throw new Error('Session source sequence is unavailable');
  const count = sourceOrdinals ? sourceOrdinals.length : integer(request.itemCount);
  const start = sourceOrdinals ? 0 : integer(request.startOrdinal, sequence.count - count);
  if (!sourceOrdinals && request.shuffleSeed == null) {
    db.prepare(`INSERT INTO session_build_items(profile_key, ordinal, track_uid)
      SELECT ?, ? + ordinal - ?, track_uid FROM playback_sequence_items
      WHERE sequence_id = ? AND ordinal >= ? AND ordinal < ?`).run(
      profileKey, destination, start, sequenceId, start, start + count);
  } else {
    const mapOrdinal = createTransportOrdinalMapper(request, sequence.count);
    const insert = db.prepare(`INSERT INTO session_build_items(profile_key, ordinal, track_uid)
      SELECT ?, ?, track_uid FROM playback_sequence_items WHERE sequence_id = ? AND ordinal = ?`);
    for (let index = 0; index < count; index++) {
      const ordinal = sourceOrdinals ? integer(sourceOrdinals[index], sequence.count - 1) : mapOrdinal(start + index);
      const outputOrdinal = destinationOrdinals ? integer(destinationOrdinals[index]) : destination + index;
      insert.run(profileKey, outputOrdinal, sequenceId, ordinal);
    }
  }
  return true;
}

function prepareRestore(db, profileKey, catalogVersion) {
  const saved = db.prepare('SELECT state_json AS json FROM playback_sessions WHERE profile_key = ?').get(profileKey);
  if (!saved) return null;
  const state = JSON.parse(saved.json);
  const { id } = db.prepare("SELECT 'session-' || lower(hex(randomblob(16))) AS id").get();
  db.prepare('DELETE FROM session_restore_items WHERE profile_key = ?').run(profileKey);
  db.prepare(`INSERT INTO session_restore_items
    SELECT i.profile_key, row_number() OVER ordered - 1, i.ordinal, i.original_ordinal,
      CASE WHEN ? = 'catalog' AND i.track_uid IS NOT NULL THEN count(i.track_uid) OVER ordered - 1 END,
      i.track_uid, ? || ':' || i.ordinal, i.file_json
    FROM playback_session_items i
    LEFT JOIN tracks t ON t.track_uid = i.track_uid
    LEFT JOIN folders f ON f.id = t.folder_id
    WHERE i.profile_key = ? AND (i.file_json IS NOT NULL OR f.status <> 'removed')
    WINDOW ordered AS (ORDER BY i.ordinal ROWS UNBOUNDED PRECEDING)`).run(state.kind, id, profileKey);
  const { restoredCount, libraryCount } = db.prepare(`SELECT count(*) AS restoredCount, count(track_uid) AS libraryCount
    FROM session_restore_items WHERE profile_key = ?`).get(profileKey);
  let catalogSequence = null;
  if (state.kind === 'catalog' && libraryCount > 0) {
    const now = Date.now();
    db.prepare(`INSERT INTO playback_sequences(id, source_context, catalog_version, state, item_count, created_at, sealed_at)
      VALUES (?, 'playback-session', ?, 'active', ?, ?, ?)`).run(id, catalogVersion, libraryCount, now, now);
    db.prepare(`INSERT INTO playback_sequence_items(sequence_id, ordinal, entry_instance_id, track_uid)
      SELECT ?, library_ordinal, entry_id, track_uid FROM session_restore_items
      WHERE profile_key = ? AND track_uid IS NOT NULL`).run(id, profileKey);
    catalogSequence = { sequenceId: id, itemCount: libraryCount };
  }
  const chosen = db.prepare(`SELECT ordinal, saved_ordinal AS savedOrdinal FROM session_restore_items
    WHERE profile_key = ? AND saved_ordinal >= ? ORDER BY ordinal LIMIT 1`).get(profileKey, state.currentOrdinal);
  const currentOrdinal = chosen?.ordinal ?? 0;
  return { state, restoredCount, currentOrdinal, currentPreserved: chosen?.savedOrdinal === state.currentOrdinal,
    currentTrack: restoredCount ? restoredRow(db, profileKey, currentOrdinal) : null, catalogSequence };
}

function restoredRow(db, profileKey, ordinal) {
  const row = db.prepare(`SELECT i.ordinal, i.original_ordinal AS originalOrdinal, i.track_uid AS trackUid,
      i.library_ordinal AS libraryOrdinal, i.entry_id AS entryInstanceId, i.file_json AS file,
      t.title, t.artist, t.file_name AS fileName
    FROM session_restore_items i LEFT JOIN tracks t ON t.track_uid = i.track_uid
    WHERE i.profile_key = ? AND i.ordinal = ?`).get(profileKey, ordinal);
  if (row?.file) return { ordinal, originalOrdinal: row.originalOrdinal, track: JSON.parse(row.file) };
  if (!row) return null;
  delete row.file;
  return row;
}

function restorePage(db, profileKey, startOrdinal) {
  const last = db.prepare('SELECT max(ordinal) AS ordinal FROM session_restore_items WHERE profile_key = ?').get(profileKey);
  const end = last.ordinal === null ? 0 : last.ordinal + 1;
  const rows = [];
  let bytes = 0;
  let ordinal = startOrdinal;
  while (ordinal < end && rows.length < 256) {
    let row = restoredRow(db, profileKey, ordinal);
    if (row.libraryOrdinal != null) {
      const file = db.prepare(`SELECT ordinal FROM session_restore_items
        WHERE profile_key = ? AND file_json IS NOT NULL AND ordinal > ? ORDER BY ordinal LIMIT 1`).get(profileKey, ordinal);
      row = { ordinal, libraryOrdinal: row.libraryOrdinal, itemCount: (file?.ordinal ?? end) - ordinal };
    }
    const size = encoder.encode(JSON.stringify(row)).length + 128;
    if (rows.length && bytes + size > PAGE_BYTES) break;
    bytes += size;
    rows.push(row);
    ordinal += row.itemCount ?? 1;
  }
  return { rows, nextOrdinal: ordinal < end ? ordinal : null };
}
