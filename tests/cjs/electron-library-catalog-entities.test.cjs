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
  await host.upsertFolders([{
    id: 'folder',
    kind: 'electron',
    displayName: 'Music Root',
    path: directory,
    status: 'ok',
    lifecycleVersion: 1
  }]);
}

async function seedDerivedTrack(host, {
  folderId = 'folder',
  scan,
  trackUid,
  relativePath,
  title = trackUid,
  artist = 'Shared Artist',
  albumArtist = artist,
  albumArtists,
  album = 'Shared Album',
  genre = 'Shared Genre',
  durationSec = 60
}) {
  const signatureValue = [...trackUid].reduce((value, character) => value + character.charCodeAt(0), 0);
  const claimed = await host.claimMetadataParse({
    folderId,
    trackUid,
    lifecycleVersion: scan.lifecycleVersion,
    generation: scan.generation,
    relativePath,
    parserVersion: scan.parserVersion,
    signature: {
      fileIdentity: `file-${trackUid}`,
      size: 100 + signatureValue,
      mtimeMs: 200 + signatureValue
    },
    explicitRescan: false
  });
  await host.completeMetadataParseSuccess({
    claim: claimed.claim,
    metadata: {
      title, artist, albumArtist, album, genre, durationSec,
      ...(albumArtists === undefined ? {} : { albumArtists })
    },
    metadataStatus: 'ok',
    clearErrorAndRetryState: true,
    updateLastKnownGood: true,
    updateDerivedData: true
  });
}

test('semicolon-delimited album artists create separate artist memberships', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const scan = await host.beginScanFolder({
    scanId: 'scan-multiple-album-artists',
    folderId: 'folder',
    normalizedRoot: directory,
    expectedLifecycleVersion: 1,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  await seedDerivedTrack(host, {
    scan,
    trackUid: 'track-collaboration',
    relativePath: 'Collaborative Album/song.flac',
    title: 'Collaboration',
    artist: 'Track Performer',
    albumArtist: 'Artist A; Artist B; Artist C',
    album: 'Collaborative Album'
  });

  const artistPage = await host.queryEntities({
    type: 'artist', query: '', sort: 'name', direction: 'asc', limit: 20
  });
  assert.deepEqual(artistPage.rows.map(row => ({ name: row.name, trackCount: row.trackCount })), [
    { name: 'Artist A', trackCount: 1 },
    { name: 'Artist B', trackCount: 1 },
    { name: 'Artist C', trackCount: 1 }
  ]);
  for (const artist of artistPage.rows) {
    const trackPage = await host.queryTracks({
      query: '', sort: 'title', direction: 'asc',
      scope: { artistKey: artist.artistKey }, limit: 20
    });
    assert.deepEqual(trackPage.rows.map(row => row.trackUid), ['track-collaboration']);
    await host.releaseContext(trackPage.contextToken);
  }
  const finalArtistChunk = await host.readContextPageAtOrdinal({
    contextToken: artistPage.contextToken,
    ordinal: 2,
    limit: 2
  });
  assert.equal(finalArtistChunk.pageStartOrdinal, 2);
  assert.deepEqual(finalArtistChunk.rows.map(row => row.name), ['Artist C']);
  await host.releaseContext(artistPage.contextToken);

  const track = await host.getTrack('track-collaboration');
  assert.equal(track.albumArtist, 'Artist A; Artist B; Artist C');
});

test('public folder pages hide tombstones while deletion lookup retains them', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);

  const removed = await host.removeScanFolder({
    folderId: 'folder', expectedLifecycleVersion: 1
  });
  assert.equal(removed.hasMore, false);

  const maintenanceFolders = await host.listScanFolders({
    folderIds: ['folder'], includeRemoved: true
  });
  assert.equal(maintenanceFolders.folders[0].status, 'removed');
  assert.equal(maintenanceFolders.folders[0].lifecycleVersion, 2);

  const page = await host.queryEntities({
    type: 'folder', query: '', sort: 'name', direction: 'asc', limit: 20
  });
  assert.deepEqual(page.rows, []);
  assert.equal((await host.getContextCount({ contextToken: page.contextToken })).totalCount, 0);
  await host.releaseContext(page.contextToken);
  assert.equal((await host.getCounts()).folders, 0);
});

test('scan-folder lookup bounds each requested folder ID', async t => {
  const { host } = await openCatalog(t);
  await assert.rejects(
    host.listScanFolders({ folderIds: ['x'.repeat(513)] }),
    assertCode('invalidRequestField')
  );
});

test('removed folders stay excluded after batched deletion and active tracks provide artwork representatives', async t => {
  const { directory, host } = await openCatalog(t);
  const activeDirectory = path.join(directory, 'Active');
  fs.mkdirSync(activeDirectory);
  await seedFolder(host, directory);
  await host.upsertFolders([{
    id: 'active-folder',
    kind: 'electron',
    displayName: 'Active Root',
    path: activeDirectory,
    status: 'ok',
    lifecycleVersion: 1
  }]);

  const removedScan = await host.beginScanFolder({
    scanId: 'scan-removed',
    folderId: 'folder',
    normalizedRoot: directory,
    expectedLifecycleVersion: 1,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  const activeScan = await host.beginScanFolder({
    scanId: 'scan-active',
    folderId: 'active-folder',
    normalizedRoot: activeDirectory,
    expectedLifecycleVersion: 1,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  const tracks = [
    { folderId: 'folder', scan: removedScan, trackUid: 'aa-removed', relativePath: 'Shared/one.flac' },
    { folderId: 'folder', scan: removedScan, trackUid: 'ab-removed', relativePath: 'Shared/two.flac' },
    { folderId: 'folder', scan: removedScan, trackUid: 'ac-removed', relativePath: 'Shared/three.flac' },
    { folderId: 'folder', scan: removedScan, trackUid: 'ad-removed-only', relativePath: 'Removed/only.flac', album: 'Removed Only' },
    { folderId: 'active-folder', scan: activeScan, trackUid: 'zx-other-one', relativePath: 'Other/one.flac', album: 'Other Album', artist: 'Other Artist', genre: 'Other Genre' },
    { folderId: 'active-folder', scan: activeScan, trackUid: 'zy-other-two', relativePath: 'Other/two.flac', album: 'Other Album', artist: 'Other Artist', genre: 'Other Genre' },
    { folderId: 'active-folder', scan: activeScan, trackUid: 'zz-active', relativePath: 'Shared/active.flac' }
  ];
  for (const [index, track] of tracks.entries()) {
    const claim = await host.claimMetadataParse({
      folderId: track.folderId,
      trackUid: track.trackUid,
      lifecycleVersion: track.scan.lifecycleVersion,
      generation: track.scan.generation,
      relativePath: track.relativePath,
      parserVersion: track.scan.parserVersion,
      signature: { fileIdentity: `file-${index}`, size: 100 + index, mtimeMs: 200 + index },
      explicitRescan: false
    });
    await host.completeMetadataParseSuccess({
      claim: claim.claim,
      metadata: {
        title: track.trackUid,
        artist: track.artist ?? 'Shared Artist',
        albumArtist: track.artist ?? 'Shared Artist',
        album: track.album ?? 'Shared Album',
        genre: track.genre ?? 'Shared Genre',
        durationSec: 60
      },
      metadataStatus: 'ok',
      clearErrorAndRetryState: true,
      updateLastKnownGood: true,
      updateDerivedData: true
    });
  }

  const removal = await host.removeScanFolder({
    folderId: 'folder', expectedLifecycleVersion: 1
  });
  assert.equal(removal.hasMore, false);

  const trackPage = await host.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 20 });
  assert.deepEqual(trackPage.rows.map(track => track.trackUid), ['zx-other-one', 'zy-other-two', 'zz-active']);
  assert.equal((await host.getContextCount({ contextToken: trackPage.contextToken })).totalCount, 3);
  await host.releaseContext(trackPage.contextToken);

  const folderPage = await host.queryEntities({
    type: 'folder', query: '', sort: 'name', direction: 'asc', limit: 20
  });
  assert.deepEqual(folderPage.rows.map(folder => ({
    id: folder.id,
    path: folder.path,
    trackCount: folder.trackCount
  })), [{ id: 'active-folder', path: activeDirectory, trackCount: 3 }]);
  await host.releaseContext(folderPage.contextToken);

  for (const [type, expectedName] of [
    ['album', 'Shared Album'],
    ['artist', 'Shared Artist'],
    ['genre', 'Shared Genre'],
    ['subfolder', 'Shared']
  ]) {
    const page = await host.queryEntities({
      type, query: '', sort: 'name', direction: 'asc', limit: 20
    });
    const entity = page.rows.find(row => row.name === expectedName);
    assert.ok(entity);
    assert.equal(entity.trackCount, 1);
    assert.equal(entity.totalDurationSec, 60);
    assert.equal(entity.representativeTrackUid, 'zz-active');
    assert.equal((await host.getContextCount({ contextToken: page.contextToken })).totalCount, 2);
    await host.releaseContext(page.contextToken);
  }

  const firstAlbumPage = await host.queryEntities({
    type: 'album', query: '', sort: 'trackCount', direction: 'desc', limit: 1
  });
  assert.equal(firstAlbumPage.rows[0].name, 'Other Album');
  assert.equal(firstAlbumPage.rows[0].trackCount, 2);
  assert.ok(firstAlbumPage.nextCursor);
  const secondAlbumPage = await host.readContextPage({
    contextToken: firstAlbumPage.contextToken,
    cursor: firstAlbumPage.nextCursor,
    limit: 1
  });
  assert.equal(secondAlbumPage.rows[0].name, 'Shared Album');
  assert.equal(secondAlbumPage.rows[0].trackCount, 1);
  await host.releaseContext(firstAlbumPage.contextToken);
});

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
    items: [
      { trackUid: 'track-beta' },
      { trackUid: 'track-alpha' },
      { trackUid: 'track-alpha' },
      { unresolved: { basename: 'missing.flac', title: 'Missing song' } }
    ],
    createdAt: 30
  });
  const playlistEntities = await host.queryEntities({
    type: 'playlist', query: '', sort: 'name', direction: 'asc', limit: 20
  });
  assert.equal(playlistEntities.rows.find(row => row.id === 'playlist-scoped')?.itemCount, 4);
  await host.releaseContext(playlistEntities.contextToken);
  const playlistPage = await host.queryTracks({
    query: '', sort: 'title', direction: 'asc', scope: { playlistId: 'playlist-scoped' }, limit: 20
  });
  assert.deepEqual(playlistPage.rows.map(row => row.trackUid), ['track-beta', 'track-alpha', 'track-alpha', null]);
  assert.equal(playlistPage.totalCount, 4);
  assert.equal(playlistPage.resolvedCount, 3);
  assert.equal(playlistPage.unresolvedCount, 1);
  assert.ok(playlistPage.rows.every(row => Number.isSafeInteger(row.itemKey) && row.playlistVersion === 0));
  assert.notEqual(playlistPage.rows[1].playlistItemKey, playlistPage.rows[2].playlistItemKey);
  const finalPlaylistChunk = await host.readContextPageAtOrdinal({
    contextToken: playlistPage.contextToken,
    ordinal: 3,
    limit: 3
  });
  assert.equal(finalPlaylistChunk.pageStartOrdinal, 3);
  assert.deepEqual(finalPlaylistChunk.rows.map(row => row.trackUid), [null]);
  for (const field of ['folderId', 'albumKey', 'artistKey', 'genreKey', 'subfolderKey']) {
    assert.equal(Object.hasOwn(playlistPage.rows[1], field), true);
  }

  const trackAnchor = await host.resolveEntityAnchor({
    contextToken: playlistPage.contextToken,
    anchor: { entityId: playlistPage.rows[2].playlistItemKey, ordinal: 0 },
    fallback: 'exact',
    limit: 20
  });
  assert.equal(trackAnchor.accepted, true);
  assert.equal(trackAnchor.ordinal, 2);
  assert.deepEqual(trackAnchor.page.rows.map(row => row.trackUid), ['track-beta', 'track-alpha', 'track-alpha', null]);

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
  assert.deepEqual(retainedPlaylistSnapshot.rows.map(row => row.trackUid), ['track-beta', 'track-alpha', 'track-alpha', null]);
  assert.deepEqual(
    await host.getContextCount({ contextToken: playlistPage.contextToken }),
    {
      contextToken: playlistPage.contextToken,
      totalCount: 4,
      catalogVersion: playlistPage.catalogVersion,
      resolvedCount: 3,
      unresolvedCount: 1
    }
  );
});

test('subfolder pages default to full relative path order instead of leaf title order', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const scan = await host.beginScanFolder({
    scanId: 'scan-subfolder-order',
    folderId: 'folder',
    normalizedRoot: directory,
    expectedLifecycleVersion: 1,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  await seedDerivedTrack(host, {
    scan,
    trackUid: 'track-zeta-alpha',
    relativePath: 'Zeta/Alpha/one.flac'
  });
  await seedDerivedTrack(host, {
    scan,
    trackUid: 'track-alpha-zulu',
    relativePath: 'Alpha/Zulu/two.flac'
  });

  const page = await host.queryEntities({
    type: 'subfolder',
    query: '',
    direction: 'asc',
    limit: 10
  });

  assert.deepEqual(page.rows.map(row => row.caption), [
    'Music Root / Alpha/Zulu',
    'Music Root / Zeta/Alpha'
  ]);
  assert.ok(page.rows.every(row => !Object.hasOwn(row, 'folderSortKey')));
  assert.ok(page.rows.every(row => !Object.hasOwn(row, 'subfolderSortPath')));
  await host.releaseContext(page.contextToken);
});

test('entity canonical cursors traverse duplicate sort values forward and backward exactly once', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const scan = await host.beginScanFolder({
    scanId: 'scan-duplicate-entities',
    folderId: 'folder',
    normalizedRoot: directory,
    expectedLifecycleVersion: 1,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  for (let index = 0; index < 53; index += 1) {
    await seedDerivedTrack(host, {
      scan,
      trackUid: `track-${String(index).padStart(3, '0')}`,
      relativePath: `Album ${index}/song.flac`,
      artist: `Artist ${index}`,
      album: 'Duplicate Name'
    });
  }
  const expectedPage = await host.queryEntities({
    type: 'album',
    query: '',
    sort: 'name',
    direction: 'asc',
    limit: 100
  });
  const expected = expectedPage.rows.map(entity => entity.albumKey);
  await host.releaseContext(expectedPage.contextToken);
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

test('entity contexts enforce type and limit and preserve their bounded read snapshot', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);
  await assert.rejects(
    host.queryEntities({ type: 'unknown', query: '', limit: 10 }),
    assertCode('unsupportedEntityType')
  );
  await assert.rejects(
    host.queryEntities({ type: 'artist', query: '', limit: 501 }),
    assertCode('invalidLimit')
  );

  const scan = await host.beginScanFolder({
    scanId: 'scan-entity-snapshot',
    folderId: 'folder',
    normalizedRoot: directory,
    expectedLifecycleVersion: 1,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  await seedDerivedTrack(host, {
    scan,
    trackUid: 'track-artist-a',
    relativePath: 'A/song.flac',
    artist: 'Artist A',
    album: 'Album A'
  });
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
  await seedDerivedTrack(host, {
    scan,
    trackUid: 'track-artist-b',
    relativePath: 'B/song.flac',
    artist: 'Artist B',
    album: 'Album B'
  });
  const sameSnapshot = await host.readContextPage({ contextToken: page.contextToken, cursor: null, limit: 10 });
  assert.deepEqual(sameSnapshot.rows.map(row => row.name), ['Artist A']);
  assert.deepEqual(sameSnapshot.totalCount, { pending: true });
  assert.equal((await host.getContextCount({ contextToken: page.contextToken })).totalCount, 1);

  const context = await host.createContext({
    endpoint: 'entities:playlist',
    query: '',
    sort: 'name',
    direction: 'asc',
    scope: null
  });
  const empty = await host.readContextPage({ contextToken: context.contextToken, cursor: null, limit: 10 });
  assert.deepEqual(empty.rows, []);
  const managerStylePage = await host.queryEntities({
    type: 'playlist',
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
  assert.deepEqual(published.changedScopes, ['artwork']);
  assert.equal(Object.hasOwn(published.counts, 'artwork'), false);
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
  assert.equal(Object.hasOwn(changed.counts, 'artwork'), false);
  assert.equal(await host.getCachedArtwork('track-representative'), null);
  assert.equal((await host.getTrack('track-representative')).artworkId, null);
  for (const type of ['album', 'artist', 'genre', 'subfolder']) {
    const page = await host.queryEntities({ type, query: '', sort: 'name', direction: 'asc', limit: 10 });
    assert.equal(page.rows[0].representativeArtworkId, null);
  }
});
