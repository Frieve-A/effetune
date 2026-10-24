'use strict';

const { VIEWS, CLASSES, SEARCH_CAPS, SORT_CAPS } = require('./network-music-content.cjs');
const preparedDatabases = new WeakSet();
const ENTITY_TYPES = { albums: 'album', artists: 'artist', genres: 'genre', subfolders: 'subfolder', playlists: 'playlist' };
const PROPERTIES = {
  'dc:title': 'title', 'upnp:artist': 'artist', 'upnp:album': 'album', 'upnp:genre': 'genre',
  'upnp:class': 'upnpClass', 'upnp:originalTrackNumber': 'trackNo', 'dc:date': 'year',
  'res@duration': 'durationSec', 'et:addedAt': 'addedAt', 'et:displayPath': 'displayPath'
};
const FIELDS = [
  'kind', 'key', 'title', 'artist', 'album', 'genre', 'year', 'trackNo', 'durationSec',
  'addedAt', 'displayPath', 'folderId', 'relativePath', 'trackUid', 'trackCount', 'albumKey', 'artistKey', 'genreKey', 'subfolderKey', 'playlistId',
  'representativeTrackUid', 'position', 'entryKey', 'upnpClass', 'childCount', 'sortTitle', 'sortArtist',
  'sortAlbum', 'sortGenre', 'default0', 'default1', 'default2', 'default3', 'default4'
];
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const selection = fields => FIELDS.map(name => `${fields[name] ?? 'NULL'} AS ${name}`).join(', ');
const representativeTrack = 'COALESCE(min(CASE WHEN t.artwork_id IS NOT NULL THEN t.track_uid END), min(t.track_uid))';

// Project the existing catalog and its memberships; no second catalog or client-side index.
function querySharedLibrary(database, request, helpers) {
  const { folderIds, kind = 'tracks', scope = null, start = 0, count = 100, search = null, sort = [], catalogQuery = null } = request;
  const catalogTokens = catalogQuery === null ? [] : helpers.normalizeContextQuery({ query: catalogQuery }).tokens;
  const searching = search !== null || catalogQuery !== null;
  if (!Array.isArray(folderIds) || folderIds.length > 512 || folderIds.some(id => typeof id !== 'string') ||
      !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 1 || count > 500 ||
      !Array.isArray(sort) || sort.length > 16 || sort.some(term => !SORT_CAPS.includes(term.property) || !['asc', 'desc'].includes(term.direction))) throw new Error('402');
  if (!preparedDatabases.has(database)) {
    database.function('upnp_fold', { deterministic: true }, value => helpers.searchNormalizer.normalizeSearchText(value ?? ''));
    database.function('upnp_sort', { deterministic: true }, value => helpers.createSortKey(value ?? ''));
    preparedDatabases.add(database);
  }
  const bindings = [...folderIds];
  const shared = folderIds.length ? `id IN (${folderIds.map(() => '?').join(',')})` : '0';
  const ctes = [`shared_folders AS (SELECT * FROM folders WHERE status <> 'removed' AND ${shared})`,
    'shared_tracks AS (SELECT t.* FROM tracks t JOIN shared_folders f ON f.id = t.folder_id)'];
  const parts = [];
  const addTracks = (trackScope = scope) => {
    const normalScope = trackScope?.directoryPath !== undefined ? { folderId: trackScope.folderId } : trackScope;
    const filter = helpers.createContextFilter({ scope: normalScope, tokens: catalogTokens });
    const clauses = [...filter.clauses];
    bindings.push(...filter.bindings);
    if (trackScope?.directoryPath !== undefined) {
      const directory = trackScope.directoryPath;
      if (directory) { clauses.push("t.relative_path >= ? || '/' AND t.relative_path < ? || '0'"); bindings.push(directory, directory); }
      if (!searching && !trackScope.recursive) {
        clauses.push("instr(substr(t.relative_path, ?), '/') = 0"); bindings.push(directory ? directory.length + 2 : 1);
      }
    }
    if (kind === 'recent') clauses.push(`t.track_uid IN (SELECT track_uid FROM shared_tracks ORDER BY added_at DESC, track_uid DESC LIMIT ${helpers.recentLimit})`);
    let source = 'shared_tracks t';
    let position = 'NULL'; let entryKey = 'NULL';
    const entityType = searching && !trackScope && ENTITY_TYPES[kind];
    if (entityType && entityType !== 'playlist') {
      const definition = helpers.entityDefinitions[entityType];
      source += ` JOIN track_${entityType}s search_member ON search_member.track_uid = t.track_uid JOIN ${definition.table} search_entity ON search_entity.${definition.stableIdColumn} = search_member.${definition.stableIdColumn}`;
    }
    if (trackScope?.playlistId || (kind === 'playlists' && searching)) {
      source += ' JOIN playlist_items i ON i.track_uid = t.track_uid JOIN playlists p ON p.id = i.playlist_id LEFT JOIN operation_jobs o ON o.operation_id = i.pending_operation_id';
      clauses.push("p.state = 'active'", "(i.pending_operation_id IS NULL OR (o.committed = 1 AND o.terminal_kind = 'success'))");
      if (trackScope?.playlistId) { clauses.push('i.playlist_id = ?'); bindings.push(trackScope.playlistId); }
      position = 'i.position'; entryKey = 'CAST(i.item_key AS TEXT)';
    }
    const defaultSort = kind === 'recent' ? 'added' : kind === 'files' ? 'path' : trackScope?.albumKey ? 'album' : 'title';
    const order = helpers.createOrder(defaultSort, kind === 'recent' ? 'desc' : 'asc');
    const defaults = Object.fromEntries(order.fields.map((field, index) => [`default${index}`, field.field === 'pathSort' ? "CAST(t.relative_path AS BLOB)" : helpers.trackFieldExpression(field)]));
    if (trackScope?.playlistId) Object.assign(defaults, { default0: position, default1: entryKey });
    parts.push(`SELECT ${selection({
      kind: "'track'", key: 't.track_uid', title: 't.title', artist: 't.artist', album: 't.album', genre: 't.genre', year: 't.year',
      trackNo: 't.track_no', durationSec: 't.duration_sec', addedAt: 't.added_at', displayPath: 't.relative_path',
      folderId: 't.folder_id', relativePath: 't.relative_path', trackUid: 't.track_uid', albumKey: 't.album_key', artistKey: entityType === 'artist' ? 'search_member.artist_key' : 't.artist_key', genreKey: 't.genre_key', subfolderKey: 't.subfolder_key', playlistId: entryKey === 'NULL' ? 'NULL' : 'i.playlist_id', position, entryKey,
      upnpClass: literal(CLASSES.track), sortTitle: 't.sort_title', sortArtist: 'upnp_sort(t.artist)',
      sortAlbum: 't.sort_album', sortGenre: 't.sort_genre', ...defaults
    })} FROM ${source} WHERE ${clauses.join(' AND ')}`);
  };
  const addEntity = type => {
    const definition = helpers.entityDefinitions[type];
    const key = definition.stableIdColumn;
    const membership = type === 'playlist' ? 'playlist_items' : `track_${type === 'subfolder' ? 'subfolders' : `${type}s`}`;
    const memberKey = type === 'playlist' ? 'playlist_id' : key;
    const visible = type === 'playlist' ? "AND (m.pending_operation_id IS NULL OR EXISTS(SELECT 1 FROM operation_jobs o WHERE o.operation_id = m.pending_operation_id AND o.committed = 1 AND o.terminal_kind = 'success'))" : '';
    const entityName = type === 'subfolder' ? 'e.display_name' : 'e.name';
    const filter = helpers.createEntityContextFilter({ entityType: type, tokens: catalogTokens, scope: null, includeSystemPlaylists: true }, definition);
    bindings.push(...filter.bindings);
    const fields = {
      kind: literal(type), key: `e.${key}`, title: entityName,
      trackCount: 'count(*)', durationSec: 'COALESCE(sum(t.duration_sec), 0)',
      childCount: 'count(*)',
      representativeTrackUid: representativeTrack, upnpClass: literal(CLASSES[type]),
      sortTitle: 'e.sort_name', default0: 'e.sort_name'
    };
    if (type === 'album') Object.assign(fields, { artist: 'e.artist', album: 'e.name', year: 'min(t.year)', sortArtist: 'e.sort_artist', default1: 'e.sort_artist' });
    if (type === 'artist') fields.artist = 'e.name';
    if (type === 'genre') fields.genre = 'e.name';
    if (type === 'subfolder') Object.assign(fields, { folderId: 'e.folder_id', relativePath: 'e.relative_path', displayPath: 'e.relative_path', default0: 'e.folder_id', default1: 'e.relative_path' });
    parts.push(`SELECT ${selection(fields)} FROM ${definition.table} e
      JOIN ${membership} m ON m.${memberKey} = e.${key}
      JOIN shared_tracks t ON t.track_uid = m.track_uid ${visible}
      ${filter.clauses.length ? `WHERE ${filter.clauses.join(' AND ')}` : ''} GROUP BY e.${key}`);
  };
  const addFolders = () => {
    const filter = helpers.createEntityContextFilter({ entityType: 'folder', tokens: catalogTokens, scope: null }, helpers.entityDefinitions.folder);
    bindings.push(...filter.bindings);
    parts.push(`SELECT ${selection({
      kind: "'folder'", key: 'e.id', title: 'e.display_name', folderId: 'e.id', relativePath: "''",
      trackCount: 'count(t.track_uid)', representativeTrackUid: representativeTrack, durationSec: 'COALESCE(sum(t.duration_sec), 0)',
      childCount: "(SELECT count(*) FROM directories d WHERE d.folder_id = e.id AND d.parent_path = '') + (SELECT count(*) FROM shared_tracks direct WHERE direct.folder_id = e.id AND instr(direct.relative_path, '/') = 0)",
      upnpClass: literal(CLASSES.folder), sortTitle: 'e.sort_name', default0: 'e.sort_name'
    })} FROM shared_folders e LEFT JOIN shared_tracks t ON t.folder_id = e.id WHERE ${filter.clauses.join(' AND ')} GROUP BY e.id`);
  };
  const addDirectories = (folderScope = null) => {
    const clauses = ["d.relative_path <> ''", 'EXISTS(SELECT 1 FROM shared_tracks t WHERE t.folder_id = d.folder_id)'];
    if (folderScope) {
      clauses.push('d.folder_id = ?'); bindings.push(folderScope.folderId);
      if (searching && folderScope.directoryPath) {
        clauses.push("d.relative_path >= ? || '/' AND d.relative_path < ? || '0'"); bindings.push(folderScope.directoryPath, folderScope.directoryPath);
      } else if (!searching) { clauses.push('d.parent_path = ?'); bindings.push(folderScope.directoryPath || ''); }
    }
    for (const token of catalogTokens) { clauses.push("instr(upnp_fold(d.relative_path), ?) > 0"); bindings.push(token); }
    parts.push(`SELECT ${selection({
      kind: "'directory'", key: "d.folder_id || char(0) || d.relative_path", title: 'd.name',
      folderId: 'd.folder_id', relativePath: 'd.relative_path', displayPath: 'd.relative_path',
      trackCount: 'd.recursive_track_count', upnpClass: literal(CLASSES.directory),
      childCount: 'd.direct_track_count + (SELECT count(*) FROM directories child WHERE child.folder_id = d.folder_id AND child.parent_path = d.relative_path)',
      sortTitle: 'CAST(d.name AS BLOB)', default0: 'CAST(d.name AS BLOB)'
    })} FROM directories d WHERE ${clauses.join(' AND ')}`);
  };
  if (kind === 'root' && searching) {
    for (const type of Object.values(ENTITY_TYPES)) addEntity(type);
    addFolders(); addDirectories(); addTracks(null);
    for (const view of VIEWS) if (catalogTokens.every(token => helpers.searchNormalizer.normalizeSearchText(view.title).includes(token))) parts.push(`SELECT ${selection({ kind: "'view'", key: literal(view.id), title: literal(view.title), upnpClass: literal(CLASSES.view), default0: literal(view.title) })}`);
  } else if (ENTITY_TYPES[kind] && !scope) {
    addEntity(ENTITY_TYPES[kind]); if (searching) addTracks(null);
  } else if (kind === 'folders' && !scope) {
    addFolders(); if (searching) { addDirectories(); addTracks(null); }
  } else if (kind === 'directory' && !scope?.recursive) {
    addDirectories(scope); addTracks(scope);
  } else addTracks();
  ctes.push(`objects AS (${parts.join(' UNION ALL ')})`);
  let predicate = search ? searchSql(search, bindings) : '1';
  if (request.key !== undefined) { predicate += ' AND key = ?'; bindings.push(request.key); }
  const from = `WITH ${ctes.join(', ')} SELECT * FROM objects WHERE ${predicate}`;
  let ordering;
  if (sort.length) {
    const canonical = { 'dc:title': 'sortTitle', 'upnp:artist': 'sortArtist', 'upnp:album': 'sortAlbum', 'upnp:genre': 'sortGenre' };
    ordering = sort.map(term => {
      const column = canonical[term.property] ? `COALESCE(${canonical[term.property]}, CAST(upnp_fold(${PROPERTIES[term.property]}) AS BLOB))` : PROPERTIES[term.property];
      return `${column} ${term.direction.toUpperCase()} NULLS LAST`;
    });
  } else {
    const direction = kind === 'recent' ? 'DESC' : 'ASC';
    ordering = [...(kind === 'directory' && !searching ? ["CASE WHEN kind = 'track' THEN 1 ELSE 0 END ASC"] : []), ...Array.from({ length: 5 }, (_, index) => `default${index} ${direction} NULLS LAST`)];
  }
  ordering.push(`key ${kind === 'recent' && !sort.length ? 'DESC' : 'ASC'}`, 'COALESCE(entryKey, \'\') ASC', 'COALESCE(artistKey, \'\') ASC');
  const total = Number(database.prepare(`SELECT count(*) AS total FROM (${from})`).get(...bindings).total);
  const rows = database.prepare(`${from} ORDER BY ${ordering.join(', ')} LIMIT ? OFFSET ?`).all(...bindings, count, start);
  return { rows: rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('default') && !key.startsWith('sort')))), total };
}

function searchSql(node, bindings, depth = 0) {
  if (!node || depth > 32) throw new Error('708');
  if (node.all === true) return '1';
  for (const operator of ['and', 'or']) if (Array.isArray(node[operator]) && node[operator].length === 2) return `(${node[operator].map(child => searchSql(child, bindings, depth + 1)).join(` ${operator.toUpperCase()} `)})`;
  if (!SEARCH_CAPS.includes(node.property)) throw new Error('708');
  const column = PROPERTIES[node.property];
  if (node.operator === 'exists' && typeof node.value === 'boolean') return `(NULLIF(${column}, '') IS ${node.value ? 'NOT ' : ''}NULL)`;
  if (typeof node.value !== 'string') throw new Error('708');
  if (node.operator === 'derivedfrom' && node.property === 'upnp:class') {
    bindings.push(node.value, `${node.value}.`);
    return `(upnp_fold(${column}) = upnp_fold(?) OR instr(upnp_fold(${column}), upnp_fold(?)) = 1)`;
  }
  bindings.push(node.value);
  if (['contains', 'doesNotContain'].includes(node.operator)) return `(NULLIF(${column}, '') IS NOT NULL AND instr(upnp_fold(${column}), upnp_fold(?)) ${node.operator === 'contains' ? '>' : '='} 0)`;
  if (!['=', '!=', '<', '<=', '>', '>='].includes(node.operator)) throw new Error('708');
  return `(NULLIF(${column}, '') IS NOT NULL AND upnp_fold(${column}) ${node.operator} upnp_fold(?))`;
}

module.exports = { querySharedLibrary };
