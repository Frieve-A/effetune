'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');

async function openCatalog(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-entities-'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
  t.after(async () => {
    await host.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, host };
}

function assertCode(code) {
  return error => {
    assert.equal(error?.code, code);
    return true;
  };
}

async function seedFolder(host, directory) {
  await host.upsertEntities('folder', [{
    folderUid: 'folder',
    kind: 'electron',
    displayName: 'Music Root',
    path: directory,
    status: 'ok',
    lifecycleVersion: 1
  }]);
}

test('track detail scopes, playlist position, and generic anchors use real Electron relations', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const scan = await host.beginScanFolder({
    scanId: 'scan-scopes',
    folderId: 'folder',
    normalizedRoot: directory,
    expectedLifecycleVersion: 1,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  for (const [index, values] of [
    ['alpha', { title: 'Alpha', artist: 'Artist Alpha', album: 'Album Alpha', genre: 'Genre Alpha' }],
    ['beta', { title: 'Beta', artist: 'Artist Beta', album: 'Album Beta', genre: 'Genre Beta' }]
  ].entries()) {
    const [suffix, metadata] = values;
    const claim = await host.claimMetadataParse({
      folderId: 'folder',
      trackUid: `track-${suffix}`,
      lifecycleVersion: 1,
      generation: scan.generation,
      relativePath: `${metadata.album}/track-${suffix}.flac`,
      parserVersion: scan.parserVersion,
      signature: { fileIdentity: `file-${index}`, size: 100 + index, mtimeMs: 200 + index },
      explicitRescan: false
    });
    await host.completeMetadataParseSuccess({
      claim: claim.claim,
      metadata: { ...metadata, albumArtist: metadata.artist, durationSec: 120 },
      metadataStatus: 'ok',
      clearErrorAndRetryState: true,
      updateLastKnownGood: true,
      updateDerivedData: true
    });
  }

  const entityKeys = {};
  for (const [type, name] of [
    ['album', 'Album Alpha'],
    ['artist', 'Artist Alpha'],
    ['genre', 'Genre Alpha'],
    ['subfolder', 'Album Alpha']
  ]) {
    const page = await host.queryEntities({ type, query: '', sort: 'name', direction: 'asc', limit: 20 });
    const row = page.rows.find(item => (item.name ?? item.displayName) === name);
    assert.ok(row, `${type} relation row should exist`);
    entityKeys[type] = row[`${type}Key`];
    await host.releaseContext(page.contextToken);
  }

  for (const scope of [
    { folderKey: 'folder' },
    { albumKey: entityKeys.album },
    { artistKey: entityKeys.artist },
    { genreKey: entityKeys.genre },
    { subfolderKey: entityKeys.subfolder }
  ]) {
    const page = await host.queryTracks({ query: '', sort: 'title', direction: 'asc', scope, limit: 20 });
    assert.equal(page.rows[0].trackUid, 'track-alpha');
    if (!scope.folderKey) assert.equal(page.rows.length, 1);
    await host.releaseContext(page.contextToken);
  }

  const recent = await host.queryTracks({
    query: '', sort: 'added', direction: 'desc', scope: { recent: true }, limit: 20
  });
  assert.deepEqual(new Set(recent.rows.map(row => row.trackUid)), new Set(['track-alpha', 'track-beta']));
  await host.releaseContext(recent.contextToken);

  await host.createPlaylistWithItems({
    playlistId: 'playlist-scoped',
    name: 'Scoped Playlist',
    items: [{ trackUid: 'track-beta' }, { trackUid: 'track-alpha' }],
    createdAt: 30
  });
  const playlistPage = await host.queryTracks({
    query: '', sort: 'title', direction: 'asc', scope: { playlistId: 'playlist-scoped' }, limit: 20
  });
  assert.deepEqual(playlistPage.rows.map(row => row.trackUid), ['track-beta', 'track-alpha']);
  assert.ok(playlistPage.rows.every(row => Number.isSafeInteger(row.itemKey) && row.playlistVersion === 0));

  const trackAnchor = await host.resolveEntityAnchor({
    contextToken: playlistPage.contextToken,
    anchor: { entityId: 'track-alpha', ordinal: 0 },
    fallback: 'exact',
    limit: 20
  });
  assert.equal(trackAnchor.accepted, true);
  assert.equal(trackAnchor.ordinal, 1);
  assert.deepEqual(trackAnchor.page.rows.map(row => row.trackUid), ['track-beta', 'track-alpha']);

  const albums = await host.queryEntities({ type: 'album', query: '', sort: 'name', direction: 'asc', limit: 20 });
  const entityAnchor = await host.resolveEntityAnchor({
    contextToken: albums.contextToken,
    mode: 'entity',
    entityKind: 'album',
    entityId: entityKeys.album,
    queryFingerprint: undefined,
    limit: 20
  });
  assert.equal(entityAnchor.accepted, true);
  assert.equal(entityAnchor.entityId, entityKeys.album);
  assert.equal(entityAnchor.page.rows[entityAnchor.ordinal - entityAnchor.pageStartOrdinal].albumKey, entityKeys.album);

  await host.createPlaylist({ playlistId: 'playlist-invalidates', name: 'Invalidates', createdAt: 31 });
  const retainedPlaylistSnapshot = await host.readContextPage({
    contextToken: playlistPage.contextToken,
    cursor: null,
    limit: 20
  });
  assert.deepEqual(retainedPlaylistSnapshot.rows.map(row => row.trackUid), ['track-beta', 'track-alpha']);
});

test('all persistent entity kinds upsert and query through bounded path-safe pages', async t => {
  const { directory, host } = await openCatalog(t);
  const invalidations = [];
  host.on('invalidation', event => invalidations.push(event));
  await seedFolder(host, directory);
  await host.upsertEntities('album', [{
    albumKey: 'album',
    identityVersion: 1,
    name: 'Blue Album',
    artist: 'Blue Artist',
    trackCount: 12,
    totalDurationSec: 3600,
    representativeArtworkId: null
  }]);
  await host.upsertEntities('artist', [{
    artistKey: 'artist',
    identityVersion: 1,
    name: 'Blue Artist',
    trackCount: 12,
    totalDurationSec: 3600,
    representativeArtworkId: null
  }]);
  await host.upsertEntities('genre', [{
    genreKey: 'genre',
    identityVersion: 1,
    name: 'Ambient',
    trackCount: 12,
    totalDurationSec: 3600,
    representativeArtworkId: null
  }]);
  await host.upsertEntities('subfolder', [{
    subfolderKey: 'folder:albums',
    folderId: 'folder',
    relativePath: 'Albums',
    identityVersion: 1,
    displayName: 'Albums',
    trackCount: 12,
    totalDurationSec: 3600,
    representativeArtworkId: null
  }]);
  await host.upsertEntities('playlist', [{
    id: 'playlist',
    name: 'Favorites',
    state: 'active',
    version: 2,
    createdAt: 10,
    updatedAt: 20
  }]);

  const expectations = {
    album: ['albumKey', 'album'],
    artist: ['artistKey', 'artist'],
    genre: ['genreKey', 'genre'],
    folder: ['id', 'folder'],
    subfolder: ['subfolderKey', 'folder:albums'],
    playlist: ['id', 'playlist']
  };
  for (const [type, [field, value]] of Object.entries(expectations)) {
    const page = await host.queryEntities({ type, query: '', sort: 'name', direction: 'asc', limit: 10 });
    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0][field], value);
    assert.equal(Object.hasOwn(page.rows[0], 'path'), false);
    assert.equal(Object.hasOwn(page.rows[0], 'relativePath'), false);
    await host.releaseContext(page.contextToken);
  }

  const counts = await host.getCounts();
  assert.deepEqual(
    Object.fromEntries(['albums', 'artists', 'genres', 'folders', 'subfolders', 'playlists']
      .map(key => [key, counts[key]])),
    { albums: 1, artists: 1, genres: 1, folders: 1, subfolders: 1, playlists: 1 }
  );
  assert.deepEqual(
    invalidations.map(event => event.changedScopes[0]),
    ['folders', 'albums', 'artists', 'genres', 'subfolders', 'playlists']
  );
  assert.ok(invalidations.every(event => !Object.hasOwn(event, 'rows')));
});

test('entity canonical cursors traverse duplicate sort values forward and backward exactly once', async t => {
  const { host } = await openCatalog(t);
  const entities = Array.from({ length: 53 }, (_, index) => ({
    albumKey: `album_${String(index).padStart(3, '0')}`,
    identityVersion: 1,
    name: 'Duplicate Name',
    artist: 'Duplicate Artist',
    trackCount: 1,
    totalDurationSec: 60,
    representativeArtworkId: null
  }));
  await host.upsertEntities('album', entities);
  const expected = entities.map(entity => entity.albumKey).sort();
  const first = await host.queryEntities({
    type: 'album',
    query: '',
    sort: 'name',
    direction: 'asc',
    limit: 7
  });
  const forward = [...first.rows.map(row => row.albumKey)];
  let page = first;
  while (page.nextCursor) {
    page = await host.readContextPage({
      contextToken: first.contextToken,
      cursor: page.nextCursor,
      limit: 7
    });
    forward.push(...page.rows.map(row => row.albumKey));
  }
  assert.deepEqual(forward, expected);
  assert.equal(new Set(forward).size, expected.length);

  const backwardPages = [page.rows.map(row => row.albumKey)];
  while (page.previousCursor) {
    page = await host.readContextPage({
      contextToken: first.contextToken,
      cursor: page.previousCursor,
      limit: 7
    });
    backwardPages.push(page.rows.map(row => row.albumKey));
  }
  assert.deepEqual(backwardPages.reverse().flat(), expected);
});

test('entity contexts enforce type, batch, limit, and preserve their bounded read snapshot', async t => {
  const { host } = await openCatalog(t);
  await assert.rejects(
    host.upsertEntities('unknown', [{ name: 'Unknown' }]),
    assertCode('unsupportedEntityType')
  );
  await assert.rejects(
    host.queryEntities({ type: 'unknown', query: '', limit: 10 }),
    assertCode('unsupportedEntityType')
  );
  await assert.rejects(
    host.upsertEntities('artist', Array.from({ length: 1001 }, (_, index) => ({
      artistKey: `artist_${index}`,
      name: `Artist ${index}`
    }))),
    assertCode('batchTooLarge')
  );
  await assert.rejects(
    host.queryEntities({ type: 'artist', query: '', limit: 501 }),
    assertCode('invalidLimit')
  );

  await host.upsertEntities('artist', [{ artistKey: 'artist_a', name: 'Same' }]);
  await assert.rejects(
    host.queryEntities({ type: 'artist', query: '', catalogVersion: 0, limit: 1 }),
    assertCode('STALE_CURSOR')
  );
  const page = await host.queryEntities({ type: 'artist', query: '', limit: 1 });
  await assert.rejects(
    host.queryEntities({
      type: 'album',
      contextToken: page.contextToken,
      cursor: page.nextCursor,
      limit: 1
    }),
    assertCode('cursorEndpointMismatch')
  );
  await host.upsertEntities('artist', [{ artistKey: 'artist_b', name: 'Same' }]);
  const sameSnapshot = await host.readContextPage({ contextToken: page.contextToken, cursor: null, limit: 10 });
  assert.deepEqual(sameSnapshot.rows.map(row => row.artistKey), ['artist_a']);
  assert.deepEqual(sameSnapshot.totalCount, { pending: true });
  assert.equal((await host.getContextCount({ contextToken: page.contextToken })).totalCount, 1);

  const context = await host.createContext({
    endpoint: 'entities:genre',
    query: '',
    sort: 'name',
    direction: 'asc',
    scope: null
  });
  const empty = await host.readContextPage({ contextToken: context.contextToken, cursor: null, limit: 10 });
  assert.deepEqual(empty.rows, []);
  const managerStylePage = await host.queryEntities({
    type: 'genre',
    query: '',
    sort: 'name',
    direction: 'asc',
    contextToken: context.contextToken,
    cursor: null,
    limit: 10
  });
  assert.deepEqual(managerStylePage.rows, []);
});

test('derived Electron entity rows expose an indexed representative track before artwork extraction', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const scan = await host.beginScanFolder({
    scanId: 'scan-representative',
    folderId: 'folder',
    normalizedRoot: directory,
    expectedLifecycleVersion: 1,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  const claimed = await host.claimMetadataParse({
    folderId: 'folder',
    trackUid: 'track-representative',
    lifecycleVersion: 1,
    generation: scan.generation,
    relativePath: 'Album/song.flac',
    parserVersion: scan.parserVersion,
    signature: { fileIdentity: 'file-1', size: 123, mtimeMs: 456 },
    explicitRescan: false
  });
  await host.completeMetadataParseSuccess({
    claim: claimed.claim,
    metadata: {
      title: 'Song',
      artist: 'Artist',
      albumArtist: 'Artist',
      album: 'Album',
      genre: 'Genre',
      durationSec: 60
    },
    metadataStatus: 'ok',
    clearErrorAndRetryState: true,
    updateLastKnownGood: true,
    updateDerivedData: true
  });

  for (const type of ['album', 'artist', 'genre', 'subfolder']) {
    const page = await host.queryEntities({ type, query: '', sort: 'name', direction: 'asc', limit: 10 });
    assert.equal(page.rows[0].representativeArtworkId, null);
    assert.equal(page.rows[0].representativeTrackUid, 'track-representative');
  }

  await host.beginArtworkUtilitySession({ utilitySessionId: 'test-artwork-session' });
  const artworkSourceClaim = {
      folderId: 'folder',
      lifecycleVersion: 1,
      trackUid: 'track-representative',
      sourceKind: 'embedded-file',
      canonicalSourceIdentity: 'Album/song.flac',
      fileIdentity: 'file-1',
      size: 123,
      mtimeMs: 456,
      embeddedOffset: null,
      embeddedLength: null,
      externalArtworkStat: null,
      extractorVersion: 'electron-artwork-v2',
      utilitySessionId: 'test-artwork-session'
  };
  let claimedArtwork = await host.claimArtworkSource({ claim: artworkSourceClaim });
  assert.ok(claimedArtwork.claim?.claimId);
  claimedArtwork = await host.bindArtworkSourceDetails({
    claim: claimedArtwork.claim,
    fileStat: { size: 123, mtimeMs: 456 },
    embeddedOffset: null,
    embeddedLength: 4,
    mimeType: 'image/jpeg'
  });
  assert.ok(claimedArtwork.claim?.canonicalSourceIdentity.includes('#embedded:unknown:4:image/jpeg'));
  const admission = await host.preflightArtworkBatch({
    claim: claimedArtwork.claim,
    estimatedRawBytes: 4,
    estimatedThumbnailBytes: 4,
    cachePolicy: { mode: 'persistent', maxBytes: 512 * 1024 * 1024 }
  });
  assert.equal(admission.ok, true);
  const staleExtractor = await host.publishArtwork({
    claim: claimedArtwork.claim,
    expectedSourceClaim: { ...claimedArtwork.claim, extractorVersion: 'forged-extractor-version' },
    cachePolicy: { mode: 'persistent', maxBytes: 512 * 1024 * 1024 },
    thumbnail: {
      bytes: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1, mimeType: 'image/jpeg'
    }
  });
  assert.equal(staleExtractor.committed, false);
  await host.beginArtworkUtilitySession({ utilitySessionId: 'replacement-artwork-session' });
  const staleUtility = await host.publishArtwork({
    claim: claimedArtwork.claim,
    expectedSourceClaim: claimedArtwork.claim,
    cachePolicy: { mode: 'persistent', maxBytes: 512 * 1024 * 1024 },
    thumbnail: {
      bytes: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1, mimeType: 'image/jpeg'
    }
  });
  assert.equal(staleUtility.committed, false);
  claimedArtwork = await host.claimArtworkSource({
    claim: { ...artworkSourceClaim, utilitySessionId: 'replacement-artwork-session' }
  });
  assert.ok(claimedArtwork.claim?.claimId);
  claimedArtwork = await host.bindArtworkSourceDetails({
    claim: claimedArtwork.claim,
    fileStat: { size: 123, mtimeMs: 456 },
    embeddedOffset: null,
    embeddedLength: 4,
    mimeType: 'image/jpeg'
  });
  assert.ok(claimedArtwork.claim?.canonicalSourceIdentity.includes('#embedded:unknown:4:image/jpeg'));
  assert.equal((await host.preflightArtworkBatch({
    claim: claimedArtwork.claim,
    estimatedRawBytes: 4,
    estimatedThumbnailBytes: 4,
    cachePolicy: { mode: 'persistent', maxBytes: 512 * 1024 * 1024 }
  })).ok, true);
  const published = await host.publishArtwork({
    claim: claimedArtwork.claim,
    expectedSourceClaim: claimedArtwork.claim,
    cachePolicy: { mode: 'persistent', maxBytes: 512 * 1024 * 1024 },
    thumbnail: {
      bytes: new Uint8Array([1, 2, 3, 4]),
      width: 1,
      height: 1,
      mimeType: 'image/jpeg'
    }
  });
  assert.equal(published.committed, true);
  assert.deepEqual((await host.getCachedArtwork('track-representative')).bytes, new Uint8Array([1, 2, 3, 4]));
  for (const type of ['album', 'artist', 'genre', 'subfolder']) {
    const page = await host.queryEntities({ type, query: '', sort: 'name', direction: 'asc', limit: 10 });
    assert.equal(page.rows[0].representativeArtworkId, published.artwork.artworkId);
  }

  const changed = await host.claimMetadataParse({
    folderId: 'folder',
    trackUid: 'track-representative',
    lifecycleVersion: 1,
    generation: scan.generation,
    relativePath: 'Album/song.flac',
    parserVersion: scan.parserVersion,
    signature: { fileIdentity: 'file-2', size: 124, mtimeMs: 457 },
    explicitRescan: false
  });
  assert.ok(changed.claim);
  assert.equal(await host.getCachedArtwork('track-representative'), null);
  assert.equal((await host.getTrack('track-representative')).artworkId, null);
  for (const type of ['album', 'artist', 'genre', 'subfolder']) {
    const page = await host.queryEntities({ type, query: '', sort: 'name', direction: 'asc', limit: 10 });
    assert.equal(page.rows[0].representativeArtworkId, null);
  }
});
