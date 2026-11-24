import { UNKNOWN_ALBUM } from '../constants.js';
import { integratedFromHistograms, isValidLoudnessHistogram } from '../loudness/histogram.js';
import { normalizeMtimeMs } from '../scan/file-signature.js';

const ANALYZER_VERSION = 1;
const activeTracks = "tracks t JOIN folders f ON f.id = t.folder_id AND f.status <> 'removed'";
const measurementMatch = `m.track_uid = t.track_uid AND m.size = t.size
  AND m.mtime_ms = t.mtime_ms AND m.cue_signature IS t.cue_signature
  AND m.analyzer_version = ${ANALYZER_VERSION}`;
const measuredTracks = `${activeTracks} JOIN track_loudness m ON ${measurementMatch}
  AND m.status = 'measured' AND m.integrated IS NOT NULL`;
const trackFields = `t.track_uid AS trackUid, t.relative_path AS relativePath,
  t.source_kind AS sourceKind, t.size, t.mtime_ms AS mtimeMs, t.cue_signature AS cueSignature`;

// Each immutable measurement has its own increasing ID. Rewriting tags updates only its file signature.
function memberSignatures(albumFilter = '') {
  return `SELECT t.album_key, group_concat(m.measurement_id ORDER BY m.measurement_id) AS signature
    FROM ${measuredTracks} JOIN albums a ON a.album_key = t.album_key
    WHERE a.name <> ? ${albumFilter} GROUP BY t.album_key`;
}

function validAlbumRows(albumFilter = '') {
  return `SELECT a.* FROM album_loudness a JOIN (${memberSignatures(albumFilter)}) members
    ON members.album_key = a.album_key AND members.signature = a.member_signature`;
}

const loudnessFields = `m.integrated, m.true_peak AS truePeak, m.lra,
  album.integrated AS albumIntegrated, album.true_peak AS albumTruePeak`;

function percentile(values, coverage) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[Math.ceil(values.length * coverage / 100) - 1];
}

export function createLoudnessCatalog(state, transaction, commitTrackChanges) {
  function listPendingLoudness({ afterTrackUid = '', limit = 64 } = {}) {
    if (typeof afterTrackUid !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 128) {
      throw new TypeError('Invalid loudness page');
    }
    const pending = `FROM ${activeTracks} LEFT JOIN track_loudness m ON ${measurementMatch}
      WHERE m.track_uid IS NULL`;
    const rows = state.database.prepare(`SELECT ${trackFields}, t.folder_id AS folderId,
      t.start_frame AS startFrame, t.end_frame AS endFrame ${pending}
      AND t.track_uid > ? ORDER BY t.track_uid LIMIT ?`).all(afterTrackUid, limit);
    // A page of unusually long paths must still fit both catalog transports.
    const tracks = [];
    const encoder = new TextEncoder();
    let bytes = 0;
    for (const row of rows) {
      bytes += encoder.encode(JSON.stringify(row)).byteLength;
      if (tracks.length && bytes > 512 * 1024) break;
      tracks.push(row);
    }
    const totalCount = afterTrackUid ? null : state.database.prepare(`SELECT COUNT(*) AS n ${pending}`).get().n;
    return { tracks, totalCount };
  }

  function saveTrackLoudness({ measurements }) {
    if (!Array.isArray(measurements) || measurements.length > 128) throw new TypeError('Invalid loudness batch');
    return transaction(() => {
      const statement = state.database.prepare(`INSERT OR REPLACE INTO track_loudness
        (track_uid, size, mtime_ms, cue_signature, analyzer_version, status, integrated, true_peak, lra, histogram)
        SELECT t.track_uid, t.size, t.mtime_ms, t.cue_signature, ?, ?, ?, ?, ?, ?
        FROM ${activeTracks} WHERE t.track_uid = ? AND t.size = ? AND t.mtime_ms = ? AND t.cue_signature IS ?`);
      let saved = 0;
      for (const row of measurements) {
        const measured = row.status === 'measured';
        if (!['measured', 'unsupported', 'failed'].includes(row.status) ||
            (measured && row.integrated != null && (!Number.isFinite(row.integrated) ||
              !Number.isFinite(row.truePeak) || !isValidLoudnessHistogram(row.histogram)))) {
          throw new TypeError('Invalid loudness measurement');
        }
        saved += statement.run(ANALYZER_VERSION, row.status, measured ? row.integrated ?? null : null,
          measured && Number.isFinite(row.truePeak) ? row.truePeak : null,
          measured && Number.isFinite(row.lra) ? row.lra : null, measured ? row.histogram ?? null : null,
          row.trackUid, row.size, normalizeMtimeMs(row.mtimeMs), row.cueSignature ?? null).changes;
      }
      return { saved };
    });
  }

  function finalizeLoudness() {
    return transaction(() => {
      const db = state.database;
      db.exec('DELETE FROM track_loudness WHERE track_uid NOT IN (SELECT track_uid FROM tracks)');
      const albums = db.prepare(`SELECT members.album_key AS albumKey, members.signature,
        a.member_signature AS previous FROM (${memberSignatures()}) members
        LEFT JOIN album_loudness a ON a.album_key = members.album_key`).all(UNKNOWN_ALBUM);
      const obsolete = new Set(db.prepare('SELECT album_key FROM album_loudness').all().map(row => row.album_key));
      const members = db.prepare(`SELECT m.histogram, m.true_peak AS truePeak FROM ${measuredTracks}
        WHERE t.album_key = ? ORDER BY m.measurement_id`);
      const save = db.prepare(`INSERT OR REPLACE INTO album_loudness
        (album_key, member_signature, integrated, true_peak) VALUES (?, ?, ?, ?)`);
      for (const album of albums) {
        obsolete.delete(album.albumKey);
        if (album.signature === album.previous) continue;
        const rows = members.all(album.albumKey);
        const integrated = integratedFromHistograms(rows.map(row => row.histogram));
        if (integrated === null) {
          obsolete.add(album.albumKey);
        } else {
          const peak = rows.reduce((highest, row) => Math.max(highest, row.truePeak), -Infinity);
          save.run(album.albumKey, album.signature, integrated, peak);
        }
      }
      const remove = db.prepare('DELETE FROM album_loudness WHERE album_key = ?');
      for (const key of obsolete) remove.run(key);
      return { finalized: true };
    });
  }

  function getTrackLoudness({ trackUid }) {
    const albumFilter = 'AND t.album_key = (SELECT album_key FROM tracks WHERE track_uid = ?)';
    return state.database.prepare(`SELECT ${loudnessFields} FROM ${measuredTracks}
      LEFT JOIN (${validAlbumRows(albumFilter)}) album ON album.album_key = t.album_key
      WHERE t.track_uid = ?`).get(UNKNOWN_ALBUM, trackUid, trackUid) ?? null;
  }

  function getLoudnessStats({ coverage = 95 } = {}) {
    if (!Number.isFinite(coverage) || coverage < 1 || coverage > 100) throw new RangeError('Invalid coverage');
    const db = state.database;
    const counts = { pending: 0, measured: 0, unsupported: 0, failed: 0 };
    for (const row of db.prepare(`SELECT m.status, COUNT(*) AS n FROM ${activeTracks}
      LEFT JOIN track_loudness m ON ${measurementMatch}
      WHERE m.status IS NOT 'measured' OR m.integrated IS NOT NULL GROUP BY m.status`).all()) {
      const key = row.status ?? 'pending';
      if (Object.hasOwn(counts, key)) counts[key] = row.n;
    }
    const rows = db.prepare(`SELECT t.album_key AS albumKey, m.true_peak - m.integrated AS plr
      FROM ${measuredTracks}`).all();
    const albums = new Map(db.prepare(validAlbumRows()).all(UNKNOWN_ALBUM)
      .map(album => [album.album_key, album.true_peak - album.integrated]));
    const albumPopulation = [...albums.values()];
    for (const row of rows) if (!albums.has(row.albumKey)) albumPopulation.push(row.plr);
    return { ...counts, trackPlr: percentile(rows.map(row => row.plr), coverage),
      albumPlr: percentile(albumPopulation, coverage) };
  }

  function listLoudnessTagCandidates() {
    return state.database.prepare(`SELECT ${trackFields}, ${loudnessFields} FROM ${measuredTracks}
      LEFT JOIN (${validAlbumRows()}) album ON album.album_key = t.album_key
      WHERE t.source_kind = 'file' AND (lower(t.relative_path) LIKE '%.flac'
        OR lower(t.relative_path) LIKE '%.mp3' OR lower(t.relative_path) LIKE '%.m4a')
      ORDER BY t.track_uid`).all(UNKNOWN_ALBUM);
  }

  function updateLoudnessTagSignatures({ rows }) {
    if (!Array.isArray(rows) || rows.length > 256) throw new TypeError('Invalid loudness signature batch');
    const { updated } = commitTrackChanges(() => {
      const updateTrack = state.database.prepare(`UPDATE tracks SET size = ?, mtime_ms = ?
        WHERE track_uid = ? AND size = ? AND mtime_ms = ? AND source_kind = 'file'`);
      const update = state.database.prepare(`UPDATE track_loudness SET size = ?, mtime_ms = ?
        WHERE track_uid = ? AND size = ? AND mtime_ms = ? AND cue_signature IS NULL AND analyzer_version = ?
        AND EXISTS (SELECT 1 FROM tracks t WHERE t.track_uid = track_loudness.track_uid
          AND t.size = ? AND t.mtime_ms = ? AND t.source_kind = 'file')`);
      let updated = 0;
      for (const row of rows) {
        const newTime = normalizeMtimeMs(row.newMtimeMs);
        const fields = [row.newSize, newTime, row.trackUid, row.size, normalizeMtimeMs(row.mtimeMs)];
        updateTrack.run(...fields);
        updated += update.run(...fields, ANALYZER_VERSION, row.newSize, newTime).changes;
      }
      return { updated };
    });
    return { updated };
  }

  return { listPendingLoudness, saveTrackLoudness, finalizeLoudness, getTrackLoudness,
    getLoudnessStats, listLoudnessTagCandidates, updateLoudnessTagSignatures };
}
