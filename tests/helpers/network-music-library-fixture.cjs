'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');
const { NetworkMusicHost } = require('../../electron/network-music-host.cjs');
const { CONTENT } = require('../../electron/network-music-upnp.cjs');

class FixtureDiscovery extends EventEmitter {
  constructor() { super(); this.devices = new Map(); }
  async start() {}
  search() {}
  close() {}
}

async function createNetworkLibraryFixture({ libraryId = 'uuid:fixture-library' } = {}) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-shared-library-')));
  let repository; let serverHost; let clientHost; let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await clientHost?.dispose(); await serverHost?.dispose(); await repository?.close();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    repository = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
    const roots = { shared: path.join(directory, 'Music'), second: path.join(directory, 'More Music'), private: path.join(directory, 'Private') };
    for (const root of Object.values(roots)) await fs.mkdir(root);
    await repository.upsertFolders(Object.entries(roots).map(([id, root]) => ({ id, kind: 'electron', path: root, displayName: id === 'shared' ? 'Music' : id === 'second' ? 'More Music' : 'Private', status: 'ok', lifecycleVersion: 1 })));
    const rows = [
      { trackUid: 'shared-a', folderId: 'shared', relativePath: 'Album/Nested/02.flac', title: 'Track 2', album: 'Shared Album', artist: 'Shared Artist', genre: 'Jazz', year: 2020, trackNo: 2, durationSec: 62 },
      { trackUid: 'shared-b', folderId: 'shared', relativePath: 'Album/01.flac', title: 'Track 10', album: 'Shared Album', artist: 'Shared Artist', genre: 'Jazz', year: 2020, trackNo: 1, durationSec: 61 },
      { trackUid: 'shared-c', folderId: 'shared', relativePath: 'Root.flac', title: 'Álpha & "Echo"', album: 'Other Album', artist: 'Other Artist', genre: 'Classical', year: 2022, trackNo: 1, durationSec: 63 },
      { trackUid: 'second-a', folderId: 'second', relativePath: 'Elsewhere/01.flac', title: 'Track 1', album: 'Shared Album', artist: 'Shared Artist', genre: 'Jazz', year: 2021, trackNo: 3, durationSec: 64 },
      { trackUid: 'private-a', folderId: 'private', relativePath: 'Secret/01.flac', title: 'Private Song', album: 'Shared Album', artist: 'Shared Artist', genre: 'Jazz', year: 2099, trackNo: 9, durationSec: 999 },
      { trackUid: 'private-b', folderId: 'private', relativePath: 'Secret/02.flac', title: 'Hidden Song', album: 'Hidden Album', artist: 'Hidden Artist', genre: 'Hidden Genre', year: 2099, trackNo: 1, durationSec: 999 }
    ];
    for (const [folderId, normalizedRoot] of Object.entries(roots)) {
      const scan = await repository.beginScanFolder({ scanId: `scan-${folderId}`, folderId, normalizedRoot, expectedLifecycleVersion: 1, resume: false, rootEnumerationRequired: true, continuityBroken: false, sweepEligibility: 'INELIGIBLE' });
      for (const row of rows.filter(item => item.folderId === folderId)) {
        const file = path.join(normalizedRoot, row.relativePath);
        await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'fLaCfixture');
        const claim = await repository.claimMetadataParse({ folderId, trackUid: row.trackUid, lifecycleVersion: scan.lifecycleVersion, generation: scan.generation, relativePath: row.relativePath, parserVersion: scan.parserVersion, signature: { fileIdentity: row.trackUid, size: 11, mtimeMs: 100 }, explicitRescan: false });
        const { title, artist, album, genre, year, trackNo, durationSec } = row;
        await repository.completeMetadataParseSuccess({ claim: claim.claim, metadata: { title, artist, albumArtist: artist, album, genre, year, trackNo, durationSec }, metadataStatus: 'ok', clearErrorAndRetryState: true, updateLastKnownGood: true, updateDerivedData: true });
      }
    }
    await repository.createPlaylistWithItems({ playlistId: 'mixed', name: 'Shared Mix', createdAt: 1, items: [{ trackUid: 'shared-b' }, { trackUid: 'private-a' }, { trackUid: 'shared-a' }, { trackUid: 'shared-b' }, { unresolved: { title: 'Private missing song', basename: 'secret.flac' } }] });
    await repository.createPlaylistWithItems({ playlistId: 'private', name: 'Hidden Playlist', createdAt: 1, items: [{ trackUid: 'private-b' }] });
    const runtime = {
      resolvePlaybackSource: async uid => {
        const identity = await repository.getTrackStorageIdentity(uid);
        if (!identity) throw new Error('Missing fixture track');
        return { ...identity, path: path.join(roots[identity.folderId], identity.relativePath) };
      },
      requestArtwork: async () => null
    };
    const host = (id, sharing, getCatalog) => new NetworkMusicHost({ getCatalog, discovery: new FixtureDiscovery(), loadConfig: () => ({ networkMusicDeviceId: id, networkMusicSharing: sharing }), saveConfig() {}, onDiagnostic: error => { if (!['708', '709', '701'].includes(error.message)) diagnostics.push(error); } });
    const diagnostics = [];
    serverHost = host(libraryId, { enabled: true, folderIds: ['shared', 'second'] }, async () => ({ repository, runtime }));
    await serverHost.start();
    clientHost = host('uuid:fixture-client', { enabled: false, folderIds: [] }, async () => null);
    const endpoint = { type: CONTENT, control: `http://127.0.0.1:${serverHost.server.port}/control/ContentDirectory` };
    const serverId = serverHost.id;
    clientHost.discovery.devices.set(serverId, { id: serverId, name: 'Shared Fixture', available: true, address: '127.0.0.1', manufacturer: 'Unrelated manufacturer', services: new Map([['urn:schemas-upnp-org:service:ContentDirectory', endpoint]]) });
    await clientHost.probeLibraries();
    return { directory, repository, catalogHost: repository, serverHost, clientHost, serverId, endpoint, rows, diagnostics, close };
  } catch (error) { await close(); throw error; }
}

module.exports = { createNetworkLibraryFixture };
