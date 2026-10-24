'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createNetworkLibraryFixture } = require('../helpers/network-music-library-fixture.cjs');
const { soap, parseDidl } = require('../../electron/network-music-upnp.cjs');
const { VIEWS, SEARCH_CAPS, SORT_CAPS, parseSearch, parseSort } = require('../../electron/network-music-content.cjs');

async function fixture(t) {
  const value = await createNetworkLibraryFixture();
  t.after(value.close);
  return { ...value, browse: options => value.clientHost.browse({ serverId: value.serverId, ...options }) };
}
async function metadata(f, id) {
  const response = await soap(f.endpoint, 'Browse', { ObjectID: id, BrowseFlag: 'BrowseMetadata', Filter: '*', StartingIndex: 0, RequestedCount: 1, SortCriteria: '' });
  return parseDidl(response.Result)[0];
}
async function search(f, objectId, criteria, options = {}) {
  const response = await soap(f.endpoint, 'Search', { ContainerID: objectId, SearchCriteria: criteria, Filter: '*', StartingIndex: 0, RequestedCount: 100, SortCriteria: '', ...options });
  return { items: parseDidl(response.Result), total: Number(response.TotalMatches), updateId: Number(response.UpdateID) };
}

test('nine catalog views use standard classes and share-filtered aggregates over the real SOAP/parser path', async t => {
  const f = await fixture(t);
  const library = (await f.clientHost.getState()).libraries[0];
  assert.deepEqual(library.browseViews.map(view => view.id), VIEWS.map(view => view.id));
  assert.deepEqual(library.searchCaps, SEARCH_CAPS); assert.deepEqual(library.sortCaps, SORT_CAPS);
  assert.equal(library.searchSupported, true, 'Capability recognition does not depend on the manufacturer');
  assert.equal(library.catalogSearch, true);
  assert.equal((await metadata(f, '0')).childCount, 9);
  const expectedCounts = { tracks: 4, albums: 2, artists: 2, genres: 2, subfolders: 3, files: 4, folders: 2, recent: 4, playlists: 1 };
  for (const view of library.browseViews) {
    const page = await f.browse({ objectId: view.objectId });
    assert.equal(page.total, expectedCounts[view.id], view.id);
    assert.equal((await metadata(f, view.objectId)).childCount, page.total, view.id);
    assert.ok(!JSON.stringify(page).includes('Hidden'), view.id);
    assert.ok(!JSON.stringify(page).includes(f.directory), 'No absolute filesystem paths escape');
  }
  const albums = await f.browse({ objectId: 'view:albums' });
  const album = albums.items.find(item => item.title === 'Shared Album');
  assert.equal(album.upnpClass, 'object.container.album.musicAlbum');
  assert.equal(album.trackCount, 3); assert.equal(album.childCount, 3);
  assert.equal(album.totalDurationSec, 187); assert.equal(album.date, '2020');
  const artworkUid = f.serverHost.server.tokens.get(new URL(album.artwork).pathname.split('/').at(-1));
  assert.ok(['shared-a', 'shared-b', 'second-a'].includes(artworkUid));
  const albumTracks = await f.browse({ objectId: album.id });
  assert.deepEqual(albumTracks.items.map(item => item.trackNo), [1, 2, 3]);
  for (const item of albumTracks.items) {
    assert.equal((await metadata(f, item.id)).parentId, album.id);
    assert.equal((await metadata(f, item.albumObjectId)).title, 'Shared Album');
  }
  assert.deepEqual(f.diagnostics, []);
});

test('physical folders expose true nested children and a flat subtree without sibling tracks', async t => {
  const f = await fixture(t);
  const roots = await f.browse({ objectId: 'view:folders' });
  const root = roots.items.find(item => item.title === 'Music');
  assert.equal(root.childCount, 2); assert.equal(root.trackCount, 3);
  const children = await f.browse({ objectId: root.id });
  assert.deepEqual(children.items.map(item => item.title), ['Album', 'Álpha & "Echo"']);
  const album = children.items[0];
  const nested = await f.browse({ objectId: album.id });
  assert.deepEqual(nested.items.map(item => item.title), ['Nested', 'Track 10']);
  assert.equal((await metadata(f, nested.items[0].id)).parentId, album.id);
  const flat = await f.browse({ objectId: album.flatObjectId, sortCriteria: '+upnp:originalTrackNumber' });
  assert.deepEqual(flat.items.map(item => item.trackNo), [1, 2]);
  const flatMetadata = await metadata(f, album.flatObjectId);
  assert.equal(flatMetadata.childCount, 2); assert.equal(flatMetadata.treeObjectId, album.id);
  const found = await search(f, album.id, 'upnp:class derivedfrom "object.item.audioItem"');
  assert.equal(found.total, 2);
  const deeperTrack = found.items.find(item => item.title === 'Track 2');
  assert.equal(deeperTrack.parentId, nested.items[0].id);
});

test('read-only playlists retain visible order and duplicate identities while hiding private and unresolved entries', async t => {
  const f = await fixture(t);
  const playlists = await f.browse({ objectId: 'view:playlists' });
  assert.deepEqual(playlists.items.map(item => item.title), ['Shared Mix']);
  const playlist = playlists.items[0];
  assert.equal(playlist.childCount, 3); assert.equal(playlist.upnpClass, 'object.container.playlistContainer');
  const page = await f.browse({ objectId: playlist.id });
  assert.deepEqual(page.items.map(item => item.title), ['Track 10', 'Track 2', 'Track 10']);
  assert.equal(new Set(page.items.map(item => item.id)).size, 3);
  assert.equal(page.items[0].refId, page.items[2].refId);
  for (const item of page.items) assert.equal((await f.clientHost.resolveTrack({ serverId: f.serverId, trackId: item.id })).uri, item.uri);
  const found = await search(f, 'view:playlists', 'upnp:class derivedfrom "object.item.audioItem"');
  assert.equal(found.total, 3); assert.ok(found.items.every(item => item.parentId === playlist.id));
  assert.equal((await search(f, playlist.id, 'dc:title contains "Private"')).total, 0);
});

test('search implements recursive container scope, standard predicates, field sorting and deterministic paging', async t => {
  const f = await fixture(t);
  assert.equal((await search(f, '0', 'dc:title contains "Hidden" or dc:title contains "Private"')).total, 0);
  const albumMatch = await search(f, '0', 'upnp:class = "object.container.album.musicAlbum" and dc:title = "Shared Album"');
  assert.equal(albumMatch.total, 1);
  const tracks = await search(f, albumMatch.items[0].id, '(upnp:genre = "Jazz" and upnp:artist contains "shared") and upnp:class derivedfrom "object.item"');
  assert.equal(tracks.total, 3);
  const accent = await search(f, 'view:tracks', 'dc:title contains "ÁLPHA" and upnp:album exists true');
  assert.equal(accent.total, 1);
  const subfolders = await search(f, 'view:subfolders', 'upnp:class derivedfrom "object.item"');
  assert.equal(subfolders.total, 3, 'A root-level file is not a descendant of any Subfolders entry');
  const first = await f.browse({ objectId: 'view:tracks', sortCriteria: '-res@duration,+dc:title', count: 2 });
  const second = await f.browse({ objectId: 'view:tracks', sortCriteria: '-res@duration,+dc:title', start: 2, count: 2 });
  assert.deepEqual([...first.items, ...second.items].map(item => item.duration), [64, 63, 62, 61]);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 4);
  assert.deepEqual((await f.browse({ objectId: 'view:tracks', start: 4 })).items, []);
  await assert.rejects(search(f, '0', 'unsupported:property = "x"'), error => error.upnpCode === '708');
  await assert.rejects(search(f, '0', '*', { SortCriteria: '+unsupported:property' }), error => error.upnpCode === '709');
});

test('sharing changes revoke aliases and metadata and preserve category IDs; catalog mutations advance update IDs', async t => {
  const f = await fixture(t);
  const before = await f.browse({ objectId: 'view:tracks' });
  const secondRootTrack = before.items.find(item => item.title === 'Track 1');
  const priorAlbumId = secondRootTrack.albumObjectId;
  const beforeUpdate = f.serverHost.server.updateId;
  await f.repository.createPlaylistWithItems({ playlistId: 'new', name: 'New shared list', createdAt: 2, items: [{ trackUid: 'shared-a' }] });
  assert.ok(f.serverHost.server.updateId > beforeUpdate);
  await f.serverHost.setSharing({ enabled: true, folderIds: ['shared', 'shared'] });
  const after = await f.browse({ objectId: 'view:tracks' });
  assert.equal(after.total, 3, 'Repeated or overlapping folder selection does not duplicate stored tracks');
  assert.ok(after.updateId > before.updateId);
  await assert.rejects(metadata(f, secondRootTrack.id), error => error.upnpCode === '701');
  await assert.rejects(metadata(f, priorAlbumId), error => error.upnpCode === '701');
  assert.equal((await search(f, '0', 'dc:title = "Track 1"')).total, 0);
  assert.equal((await f.browse({ objectId: 'view:folders' })).total, 1);
});

test('Recently Added selects the latest 500 shared tracks before paging and sorting', async t => {
  const f = await fixture(t);
  const now = Date.now() + 1000;
  for (let start = 0; start < 501; start += 200) await f.repository.upsertTracks(Array.from({ length: Math.min(200, 501 - start) }, (_, index) => ({ trackUid: `recent-${start + index}`, folderId: 'shared', relativePath: `Recent/${start + index}.flac`, fileName: `${start + index}.flac`, title: `Recent ${start + index}`, addedAt: now + start + index })));
  await f.repository.upsertTracks([{ trackUid: 'private-latest', folderId: 'private', relativePath: 'latest.flac', fileName: 'latest.flac', title: 'Private latest', addedAt: now + 10000 }]);
  const page = await f.browse({ objectId: 'view:recent', count: 3 });
  assert.equal(page.total, 500); assert.deepEqual(page.items.map(item => item.title), ['Recent 500', 'Recent 499', 'Recent 498']);
  const end = await f.browse({ objectId: 'view:recent', start: 499, count: 3 });
  assert.deepEqual(end.items.map(item => item.title), ['Recent 1']);
  assert.equal((await search(f, 'view:recent', 'dc:title = "Recent 0"')).total, 0);
});

test('ContentDirectory criteria parsers reject unsupported syntax without interpreting input as SQL', () => {
  assert.deepEqual(parseSort('+dc:title,-res@duration'), [{ property: 'dc:title', direction: 'asc' }, { property: 'res@duration', direction: 'desc' }]);
  assert.deepEqual(parseSearch('dc:title contains "A \\"B\\""'), { property: 'dc:title', operator: 'contains', value: 'A "B"' });
  for (const criteria of ['', 'dc:title contains "x"; DROP TABLE tracks', 'dc:title derivedfrom "x"', 'upnp:class matches "x"']) assert.throws(() => parseSearch(criteria), /708/);
});

test('shared catalog text search reuses local multi-field, filename, path, accent, kana and short-prefix matching', async t => {
  const f = await fixture(t);
  await f.repository.upsertTracks([{ trackUid: 'kana', folderId: 'shared', relativePath: '日本/音楽/file-name.flac', fileName: 'file-name.flac', title: 'トラック ガラス', artist: 'Soloist', albumArtist: 'Guest Orchestra', album: 'Kana Album', genre: 'Fusion' }]);
  const shared = [...f.rows.filter(row => row.folderId !== 'private').map(row => row.trackUid), 'kana'];
  const actions = [];
  const invoke = f.clientHost.invoke;
  f.clientHost.invoke = (endpoint, action, args) => { actions.push(action); return invoke(endpoint, action, args); };
  for (const query of ['shared 10', '02.flac', 'Album/Nested', 'alpha', 'とらっく', 'がらす', 'Guest Orchestra', 'file-name', '日本/音楽', 'tr', 'ac']) {
    const local = await f.repository.queryTracks({ query, scope: { trackUids: shared }, limit: 100 });
    try {
      const network = await f.browse({ objectId: 'view:tracks', query });
      const ids = network.items.map(item => f.serverHost.server.tokens.get(item.id.split(':')[1]));
      assert.deepEqual(ids, local.rows.map(row => row.trackUid), query);
      assert.equal(network.total, local.rows.length, query);
    } finally { await f.repository.releaseContext(local.contextToken); }
  }
  assert.ok(actions.every(action => action === 'X_EffeTune_Search'));
  assert.equal((await search(f, 'view:tracks', 'dc:title contains "alpha"')).total, 1, 'Standard Search uses the same accent folding');
  assert.equal((await search(f, 'view:tracks', 'dc:title contains "がらす"')).total, 1, 'Standard Search uses the same Kana folding');
  assert.equal((await f.browse({ objectId: 'view:tracks', query: 'Private' })).total, 0);
  const paged = await f.browse({ objectId: 'view:tracks', query: 'shared', sortCriteria: '-res@duration', start: 1, count: 1 });
  assert.equal(paged.total, 3); assert.deepEqual(paged.items.map(item => item.duration), [62]);
});

test('shared entity artwork prefers an artwork-bearing shared member and never a private representative', async t => {
  const f = await fixture(t);
  const setArtwork = (uid, artworkId) => {
    const database = new DatabaseSync(path.join(f.directory, 'catalog.sqlite'));
    try {
      if (artworkId) database.prepare(`INSERT INTO artwork_assets(id, digest_algorithm, digest_version, full_digest, byte_length, content_type, source_kind, ref_count)
        VALUES (?, 'sha256', 1, ?, 0, 'image/png', 'embedded-file', 1)`).run(artworkId, artworkId);
      database.prepare('UPDATE tracks SET artwork_id = ? WHERE track_uid = ?').run(artworkId, uid);
    }
    finally { database.close(); }
  };
  setArtwork('shared-b', 'shared-cover');
  const local = await f.repository.queryEntities({ type: 'album', query: '', limit: 100 });
  try { assert.equal(local.rows.find(row => row.name === 'Shared Album').representativeTrackUid, 'shared-b'); }
  finally { await f.repository.releaseContext(local.contextToken); }
  const representative = item => f.serverHost.server.tokens.get(new URL(item.artwork).pathname.split('/').at(-1));
  for (const [view, title] of [['albums', 'Shared Album'], ['artists', 'Shared Artist'], ['genres', 'Jazz'], ['folders', 'Music']]) {
    const item = (await f.browse({ objectId: `view:${view}` })).items.find(row => row.title === title);
    assert.equal(representative(item), 'shared-b', view);
  }
  setArtwork('shared-b', null); setArtwork('private-a', 'private-cover');
  const album = (await f.browse({ objectId: 'view:albums' })).items.find(row => row.title === 'Shared Album');
  assert.equal(representative(album), 'second-a', 'Fallback stays within shared members even when private art exists');
});
