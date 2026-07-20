export const MUSIC_LIBRARY_ORDER_VERSION = 'v3-nfkc-natural-numeric-utf8-null-last-1';
export const MISSING_TRACK_NUMBER_SORT = Number.MAX_SAFE_INTEGER;

const textEncoder = new TextEncoder();

const text = field => Object.freeze({ field, type: 'bytes', nulls: 'last' });
const number = field => Object.freeze({ field, type: 'number', nulls: 'last' });

export const TRACK_ORDER_SPECS = Object.freeze({
  title: Object.freeze([text('sortTitle')]),
  artist: Object.freeze([
    text('sortAlbumArtist'), text('sortAlbum'), number('discSort'),
    number('trackSort'), text('sortTitle')
  ]),
  album: Object.freeze([
    text('sortAlbum'), number('discSort'), number('trackSort'), text('sortTitle')
  ]),
  genre: Object.freeze([
    text('sortGenre'), text('sortAlbumArtist'), text('sortAlbum'), text('sortTitle')
  ]),
  added: Object.freeze([number('addedAt')]),
  duration: Object.freeze([number('durationSort'), text('sortTitle')])
});

export const ENTITY_NAME_ORDER_SPECS = Object.freeze({
  album: Object.freeze([text('sortName'), text('sortArtist')]),
  artist: Object.freeze([text('sortName')]),
  genre: Object.freeze([text('sortName')]),
  folder: Object.freeze([text('sortName')]),
  subfolder: Object.freeze([text('sortName')]),
  playlist: Object.freeze([text('sortName')])
});

export function encodeCanonicalSortKey(value) {
  const normalized = normalizeCanonicalText(value);
  const bytes = [];
  let index = 0;
  while (index < normalized.length) {
    const digit = normalized.charCodeAt(index);
    if (digit >= 0x30 && digit <= 0x39) {
      let end = index + 1;
      while (end < normalized.length) {
        const next = normalized.charCodeAt(end);
        if (next < 0x30 || next > 0x39) break;
        end += 1;
      }
      appendNumericSortToken(bytes, normalized.slice(index, end));
      index = end;
      continue;
    }
    let end = index + 1;
    while (end < normalized.length) {
      const next = normalized.charCodeAt(end);
      if (next >= 0x30 && next <= 0x39) break;
      end += 1;
    }
    appendEscapedText(bytes, normalized.slice(index, end));
    index = end;
  }
  bytes.push(0);
  bytes.push(...textEncoder.encode(normalized));
  return bytesToHex(bytes);
}

export function encodeCanonicalSearchKey(value) {
  return bytesToHex(textEncoder.encode(normalizeCanonicalText(value)));
}

export function ensureCatalogSortKeyVersion(database, {
  expectedVersion,
  catalogVersion,
  scopeVersions,
  createKey
}) {
  const storedVersion = database.prepare('SELECT value FROM meta WHERE key = ?')
    .get('collation_version')?.value;
  if (storedVersion === expectedVersion) return { catalogVersion, scopeVersions };

  let nextCatalogVersion = catalogVersion;
  const nextScopeVersions = { ...scopeVersions };
  database.exec('BEGIN IMMEDIATE');
  try {
    const hasPersistentContexts = database.prepare(`
      SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'query_contexts'
    `).get();
    if (hasPersistentContexts) database.prepare('DELETE FROM query_contexts').run();
    const changedScopes = rebuildCatalogSortKeys(database, createKey);
    const updateMeta = database.prepare(`
      INSERT INTO meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    updateMeta.run('collation_version', expectedVersion);
    if (changedScopes.length > 0) {
      nextCatalogVersion += 1;
      updateMeta.run('catalog_version', String(nextCatalogVersion));
      for (const scope of changedScopes) {
        nextScopeVersions[scope] = (nextScopeVersions[scope] || 0) + 1;
        updateMeta.run(`scope_version:${scope}`, String(nextScopeVersions[scope]));
      }
    }
    database.exec('COMMIT');
    return { catalogVersion: nextCatalogVersion, scopeVersions: nextScopeVersions };
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // The original migration error is the actionable failure.
    }
    throw error;
  }
}

function rebuildCatalogSortKeys(database, createKey) {
  const changedScopes = [];
  const rekey = ({ scope, select, update, values }) => {
    const rows = database.prepare(select).all();
    if (rows.length === 0) return;
    const statement = database.prepare(update);
    for (const row of rows) statement.run(...values(row));
    changedScopes.push(scope);
  };

  rekey({
    scope: 'folders',
    select: 'SELECT id, display_name AS displayName FROM folders',
    update: 'UPDATE folders SET sort_name = ? WHERE id = ?',
    values: row => [createKey(row.displayName), row.id]
  });
  rekey({
    scope: 'tracks',
    select: `SELECT track_uid AS trackUid, title, artist, album_artist AS albumArtist,
      album, genre FROM tracks`,
    update: `UPDATE tracks SET sort_title = ?, sort_album_artist = ?,
      sort_album = ?, sort_genre = ? WHERE track_uid = ?`,
    values: row => [
      createKey(row.title),
      createKey(row.albumArtist || row.artist),
      createKey(row.album),
      createKey(row.genre),
      row.trackUid
    ]
  });
  rekey({
    scope: 'albums',
    select: 'SELECT album_key AS albumKey, name, artist FROM albums',
    update: 'UPDATE albums SET sort_name = ?, sort_artist = ? WHERE album_key = ?',
    values: row => [createKey(row.name), createKey(row.artist), row.albumKey]
  });
  rekey({
    scope: 'artists',
    select: 'SELECT artist_key AS artistKey, name FROM artists',
    update: 'UPDATE artists SET sort_name = ? WHERE artist_key = ?',
    values: row => [createKey(row.name), row.artistKey]
  });
  rekey({
    scope: 'genres',
    select: 'SELECT genre_key AS genreKey, name FROM genres',
    update: 'UPDATE genres SET sort_name = ? WHERE genre_key = ?',
    values: row => [createKey(row.name), row.genreKey]
  });
  rekey({
    scope: 'subfolders',
    select: 'SELECT subfolder_key AS subfolderKey, display_name AS displayName FROM subfolders',
    update: 'UPDATE subfolders SET sort_name = ? WHERE subfolder_key = ?',
    values: row => [createKey(row.displayName), row.subfolderKey]
  });
  rekey({
    scope: 'playlists',
    select: 'SELECT id, name FROM playlists',
    update: 'UPDATE playlists SET sort_name = ? WHERE id = ?',
    values: row => [createKey(row.name), row.id]
  });
  return changedScopes;
}

function normalizeCanonicalText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/\\/g, '/');
}

function appendNumericSortToken(output, digits) {
  const significant = digits.replace(/^0+(?=\d)/, '');
  appendEscapedByte(output, 0x30);
  for (let index = 0; index < significant.length; index += 1) output.push(0x31);
  output.push(0x30);
  for (const digit of significant) output.push(digit.charCodeAt(0));
}

function appendEscapedText(output, value) {
  for (const byte of textEncoder.encode(value)) appendEscapedByte(output, byte);
}

function appendEscapedByte(output, byte) {
  output.push(0x40 + (byte >> 4), 0x40 + (byte & 0x0f));
}

function bytesToHex(bytes) {
  return [...bytes]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
