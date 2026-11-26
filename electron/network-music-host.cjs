'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const dgram = require('node:dgram');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { Discovery, service, soap, didl, didlItem, networkUrl } = require('./network-music-upnp.cjs');
const { MusicServer, TYPES } = require('./network-music-server.cjs');
const { withUpnpCore, supportsProtocol, MAX_QUEUE, RETRYABLE_CONNECTION_ERRORS, fail } = require('../js/network-music/upnp/host-core.js');
const { OpenHomeMediaGateway } = require('./openhome-media-gateway.cjs');
const { resolveFriendlyName } = require('./openhome-control-host.cjs');
const fileAccess = require('./file-access.cjs');
const { AvTransportPlayers } = require('./network-music-av-player.cjs');
const { SubsonicSource } = require('./subsonic-source.cjs');

const METHODS = Object.freeze({ GetState: 'getState', Discover: 'discover', Browse: 'browse', GetPlayerState: 'getPlayerState', PlayerCommand: 'playerCommand', ResolveTrack: 'resolveTrack', SetSharing: 'setSharing', Configure: 'configure', PlaySelection: 'playSelection', PlayFiles: 'playFiles' });

class NetworkMusicHost extends withUpnpCore(EventEmitter) {
  constructor({ getCatalog, loadConfig, saveConfig, getFriendlyName = () => resolveFriendlyName(loadConfig()), discovery = new Discovery(), gateway = new OpenHomeMediaGateway(), invoke = soap, localPlayer = null, getRouteAddress = routeAddress, onDiagnostic = () => {} }) {
    super({
      loadConfig, saveConfig, discovery, gateway, getRouteAddress, onDiagnostic, localPlayer,
      invoke: (endpoint, action, args, isCurrent) => endpoint?.invoke ? endpoint.invoke(action, args, isCurrent) : invoke(endpoint, action, args),
      decodeBase64: text => Buffer.from(text, 'base64'),
      startPollingInterval: (callback, ms) => setInterval(callback, ms).unref(),
      fileToken: () => crypto.randomBytes(24).toString('base64url'),
      registerMedia: uri => this.gateway.register(uri),
      mediaUrl: (uid, address) => ({ ...this.server.resource(uid, address), token: this.server.trackTokens.get(uid) })
    });
    this.supportsProtocol = supportsProtocol;
    this.avPlayers = new AvTransportPlayers(this);
    this.catalogChanged = () => { this.server.updateId = (this.server.updateId + 1) >>> 0; for (const entry of this.server.subscribers.values()) this.server.notify(entry); this.emitState(); };
    this.getCatalog = async (initialize = true) => {
      const catalog = await getCatalog(initialize);
      if (!catalog) return null;
      if (this.repository !== catalog.repository) {
        this.repository?.removeListener?.('invalidation', this.catalogChanged);
        this.repository = catalog.repository;
        this.repository.on?.('invalidation', this.catalogChanged);
      }
      return catalog;
    };
    this.configuring = Promise.resolve(); this.stateRefresh = null; this.stateRefreshQueued = false; this.fileSources = new Map();
    const config = loadConfig();
    this.gatewayPermissions = { libraries: config.networkMusicGateway?.libraries === true, players: config.networkMusicGateway?.players === true };
    this.manualDevices = Array.isArray(config.networkMusicManualDevices) ? config.networkMusicManualDevices : [];
    discovery.setManualLocations?.(this.manualDevices.map(entry => entry.url));
    this.sources = new Map();
    this.sourceGeneration = 0;
    this.sourceMedia = new Map();
    for (const entry of config.networkMusicSources || []) { try { const source = new SubsonicSource(entry); this.sources.set(source.config.id, source); } catch (error) { this.onDiagnostic(error); } }
    this.id = config.networkMusicDeviceId || `uuid:${crypto.randomUUID()}`;
    if (!config.networkMusicDeviceId) saveConfig({ ...config, networkMusicDeviceId: this.id });
    this.sharing = { enabled: config.networkMusicSharing?.enabled === true, folderIds: Array.isArray(config.networkMusicSharing?.folderIds) ? config.networkMusicSharing.folderIds : [] };
    this.server = new MusicServer({ id: this.id, getName: getFriendlyName, discovery, browse: request => this.browseShared(request), resolveSource: (uid, kind) => this.sharedSource(uid, kind), getArtwork: async uid => (await this.getCatalog()).runtime.requestArtwork({ trackUid: uid, reason: 'detail' }), onDiagnostic });
    this.fileServer = new MusicServer({ id: this.id, discovery, advertise: false, resolveSource: async uid => {
      const source = this.fileSources.get(uid);
      if (!source) throw fail('trackUnavailable', 'Open this file again to play it.');
      if (source.remote) return source;
      fileAccess.assertPath(source.path, 'read');
      return source;
    }, onDiagnostic });
    discovery.on('diagnostic', error => onDiagnostic(error, { operation: 'discovery' }));
    discovery.on('search', () => { void this.probeLibraries(); });
    discovery.on('change', () => { for (const id of this.avPlayers.owners.keys()) if (!this.discovery.devices.get(id)?.available) this.avPlayers.owners.delete(id); this.emitState(); void this.probeLibraries(); });
  }
  async start() {
    if (this.sharing.enabled) { await this.discovery.start(); await this.server.start(); }
  }
  async refreshFriendlyName() {
    await this.server.advertisement.announce('ssdp:byebye');
    await this.server.advertisement.announce('ssdp:alive');
    this.emitState();
  }
  async getState({ loadSharingFolders = false } = {}) {
    let folders = [];
    try {
      const catalog = await this.getCatalog(loadSharingFolders === true);
      if (loadSharingFolders === true && !catalog) throw fail('catalogUnavailable', 'The music folders could not be loaded. Reopen Settings and try again.');
      const result = catalog ? await catalog.repository.listScanFolders({ includeRemoved: false }) : { folders: [] };
      folders = (result.folders ?? []).map(folder => ({ id: folder.id, name: folder.displayName || 'Music folder' }));
    } catch (error) {
      if (loadSharingFolders === true) throw error;
      this.onDiagnostic(error);
    }
    return {
      queueTracksMax: MAX_QUEUE,
      libraries: [...[...this.sources.values()].map(source => source.library()), ...[...this.discovery.devices.values()].filter(device => device.id !== this.id && service(device, 'ContentDirectory')).map(device => ({ id: device.id, name: device.name, available: device.available, searchSupported: device.searchSupported === true, catalogSearch: device.catalogSearch === true, searchCaps: device.searchCaps || [], sortCaps: device.sortCaps || [], browseViews: device.browseViews || [] }))],
      players: [...this.discovery.devices.values()].filter(device => device.id !== this.localPlayer?.id && (service(device, 'Playlist') || service(device, 'AVTransport'))).map(device => ({ id: device.id, name: device.name, available: device.available, isEffeTune: device.manufacturer === 'EffeTune' })),
      gatewayPermissions: { ...this.gatewayPermissions }, sources: [...this.sources.values()].map(source => source.publicInfo()), manualDevices: this.manualDevices.map(entry => ({ ...entry, available: [...this.discovery.devices.values()].some(device => device.location === entry.url && device.available) })),
      sharing: { ...this.sharing, folderIds: [...this.sharing.folderIds], folders }
    };
  }
  // Coalesce bursts (catalog scans, discovery changes) into one in-flight refresh plus one follow-up,
  // so state reads never exceed the catalog's outstanding-request limit.
  emitState() {
    if (this.stateRefresh) { this.stateRefreshQueued = true; return; }
    this.stateRefresh = this.getState().then(state => this.emit('state', state)).catch(this.onDiagnostic).finally(() => {
      this.stateRefresh = null;
      if (this.stateRefreshQueued) { this.stateRefreshQueued = false; this.emitState(); }
    });
  }
  async discover() { await this.discovery.start(); await this.discovery.search({ refresh: true }); return this.getState(); }
  async configure(request = {}) {
    if (request.subsonic) {
      const entry = request.subsonic;
      if (entry.action === 'remove') {
        this.sources.get(entry.id)?.close(); this.sources.delete(entry.id);
        for (const [uid, resource] of this.fileSources) if (resource.serverId === entry.id) { this.fileSources.delete(uid); this.fileServer.revokeSource(uid); }
        for (const [key, uid] of this.sourceMedia) if (!this.fileSources.has(uid)) this.sourceMedia.delete(key);
      } else if (entry.action === 'add' || entry.action === 'test') {
        const source = entry.action === 'test' && entry.id ? this.sources.get(entry.id) : new SubsonicSource(entry);
        if (!source) throw fail('unavailable', 'This music server connection is unavailable.');
        try { await source.test(); }
        catch (error) { if (!entry.id) source.close(); throw error; }
        if (entry.action === 'add') this.sources.set(source.config.id, source);
        else { if (!entry.id) source.close(); return this.getState(); }
      } else throw fail('invalidRequest', 'Choose a music server connection.');
      this.saveConfig({ ...this.loadConfig(), networkMusicSources: [...this.sources.values()].map(source => source.config) });
      this.sourceGeneration++;
    }
    if (request.gatewayPermissions !== undefined) {
      const setting = request.gatewayPermissions;
      if (!setting || typeof setting.libraries !== 'boolean' || typeof setting.players !== 'boolean') throw fail('invalidRequest', 'Choose the network access to allow.');
      this.gatewayPermissions = { libraries: setting.libraries, players: setting.players };
      this.saveConfig({ ...this.loadConfig(), networkMusicGateway: this.gatewayPermissions });
    }
    if (request.manualDevice) {
      const entry = request.manualDevice;
      if (entry.action === 'add') {
        const url = networkUrl(entry.url).href;
        const devices = await this.discovery.register(url);
        if (!this.manualDevices.some(item => item.url === url)) this.manualDevices.push({ id: crypto.randomUUID(), url, name: devices[0].name });
      } else if (entry.action === 'remove') {
        const removed = this.manualDevices.find(item => item.id === entry.id);
        this.manualDevices = this.manualDevices.filter(item => item.id !== entry.id);
        if (removed) this.discovery.unregister?.(removed.url);
        if (removed) for (const device of this.discovery.devices.values()) if (device.location === removed.url) device.available = false;
      } else throw fail('invalidRequest', 'Choose a music device address.');
      this.saveConfig({ ...this.loadConfig(), networkMusicManualDevices: this.manualDevices });
    }
    const state = await this.getState(); this.emit('state', state); return state;
  }
  async localLibraryAvailable() {
    try { return Boolean(await this.getCatalog()); }
    catch (error) { this.onDiagnostic(error); return false; }
  }
  async browseLocal({ objectId = '0', start = 0, count = 100, query = '', sortCriteria = '' } = {}) {
    if (objectId !== '0') throw fail('unsupported', 'Choose the local music library root.');
    if (!['', '+dc:title', '-dc:title'].includes(sortCriteria)) throw fail('unsupported', 'The local music library supports title sorting.');
    const catalog = await this.getCatalog();
    if (!catalog) throw fail('catalogUnavailable', 'The local music library is unavailable. Open the library and try again.');
    const repository = catalog.repository;
    const context = await repository.createContext({ endpoint: 'tracks', query, sort: 'title', direction: sortCriteria === '-dc:title' ? 'desc' : 'asc' });
    const contextToken = context.contextToken ?? context;
    try {
      const countResult = await repository.getContextCount({ contextToken });
      const total = countResult.totalCount;
      if (!Number.isSafeInteger(total)) throw fail('catalogUnavailable', 'The local music library could not finish this search. Try again.');
      const rows = [];
      let ordinal = start;
      while (ordinal < total && rows.length < count) {
        const page = await repository.readContextPageAtOrdinal({ contextToken, ordinal, limit: 500 });
        const pageStart = page.pageStartOrdinal;
        const offset = ordinal - pageStart;
        const batch = page.rows.slice(offset, offset + count - rows.length);
        if (!batch.length) break;
        rows.push(...batch);
        ordinal += batch.length;
      }
      return { serverId: 'local', items: rows.map(row => ({ serverId: 'local', trackId: row.trackUid,
        id: row.trackUid, parentId: '0', title: row.title || 'Track', artist: row.artist || '',
        album: row.album || '', genre: row.genre || '', duration: Number(row.durationSec) || 0,
        isContainer: false, playable: Boolean(row.trackUid) })),
      start, total, numberReturned: rows.length, updateId: context.catalogVersion ?? null };
    } finally { await repository.releaseContext(contextToken); }
  }
  async browse({ serverId, objectId = '0', start = 0, count = 100, query = '', sortCriteria = '' } = {}) {
    if (this.sources.has(serverId)) {
      const source = this.sources.get(serverId);
      const page = await source.browse({ objectId, start, count, query });
      const items = [];
      for (const item of page.items) items.push(item.isContainer && !item.coverArtId ? item : await this.subsonicTrack(source, item, '127.0.0.1'));
      return { ...page, items };
    }
    if (serverId === 'local') return this.browseLocal({ objectId, start, count, query, sortCriteria });
    return super.browse({ serverId, objectId, start, count, query, sortCriteria });
  }
  async resolveTrack({ serverId, trackId, localPlayback = false, address, protocolInfo } = {}) {
    if (this.sources.has(serverId)) {
      const source = this.sources.get(serverId);
      let track = await source.resolve(trackId);
      if (protocolInfo && !track.resources.some(resource => supportsProtocol(protocolInfo, resource.protocolInfo))) {
        track = await source.resolve(trackId, { transcode: true });
        if (!track.resources.some(resource => supportsProtocol(protocolInfo, resource.protocolInfo))) throw fail('unsupportedFormat', 'The player does not support this track or the conversion offered by the server.');
      }
      if (this.sources.get(serverId) !== source || source.closed) throw fail('unavailable', 'This music server connection has been removed.');
      return this.subsonicTrack(source, track, localPlayback ? '127.0.0.1' : address, localPlayback);
    }
    return super.resolveTrack({ serverId, trackId, localPlayback, address, protocolInfo });
  }
  async publishOpenedFiles(resolved, action, playerId, address, playerAddress) {
    const replacedCount = action === 'replace' ? [...this.fileSources.values()].filter(source => source.playerId === playerId).length : 0;
    if (this.fileSources.size - replacedCount + resolved.length > MAX_QUEUE) throw fail('queueFull', 'Remove previously opened files from their player queues before opening more files.');
    await this.fileServer.start();
    for (const track of resolved) {
      const uid = crypto.randomBytes(24).toString('base64url');
      const resource = this.fileServer.resource(uid, address, playerAddress);
      this.fileSources.set(uid, { path: track.path, playerId, uri: resource.uri });
      track.uri = resource.uri; track.id = uid;
      track.resources[0].uri = resource.uri;
      track.metadata = didl([didlItem(track)]);
    }
  }
  async openedFile(filePath) {
    try { fileAccess.assertPath(filePath, 'read'); }
    catch { throw fail('fileAccessRequired', 'Open the music file again to allow playback on the selected device.'); }
    const canonical = await fs.realpath(filePath);
    const stat = await fs.stat(canonical);
    if (!stat.isFile()) throw fail('trackUnavailable', 'This music file is no longer available. Open it again.');
    const mime = TYPES[path.extname(canonical).toLowerCase()];
    if (!mime) throw fail('unsupportedFormat', 'This file type cannot be played on another device. Choose a supported audio file.');
    return { path: canonical, title: path.basename(canonical, path.extname(canonical)), resources: [{ uri: '', protocolInfo: `http-get:*:${mime}:*`, size: stat.size }] };
  }
  async gatewaySource(serverId, trackId, kind, options) { return this.sources.get(serverId)?.resource(trackId, kind, options); }
  async subsonicTrack(source, track, address = '127.0.0.1', localPlayback = false) {
    const serverId = source.config.id; const trackId = track.trackId || track.id;
    if (this.sources.get(serverId) !== source || source.closed) throw fail('unavailable', 'This music server connection has been removed.');
    await this.fileServer.start();
    if (this.sources.get(serverId) !== source || source.closed) throw fail('unavailable', 'This music server connection has been removed.');
    const key = JSON.stringify([serverId, trackId, address, track.quality, localPlayback]);
    let uid = this.sourceMedia.get(key);
    if (!uid) { uid = crypto.randomBytes(24).toString('base64url'); this.sourceMedia.set(key, uid); }
    const resource = localPlayback ? this.fileServer.rendererResource(uid) : this.fileServer.resource(uid, address);
    this.fileSources.set(uid, { remote: true, serverId, uri: resource.uri, resource: kind => kind === 'artwork' && track.coverArtId ? { uri: source.endpoint('getCoverArt', { id: track.coverArtId, size: 512 }) } : source.resource(trackId, kind, { transcode: track.quality === 'transcoded' }), isCurrent: () => this.sources.get(serverId) === source && !source.closed });
    const item = { ...track, uri: track.isContainer ? '' : resource.uri, artwork: track.coverArtId ? resource.artwork : '', resources: (track.resources || []).map(entry => ({ ...entry, uri: resource.uri })) };
    item.metadata = didl([didlItem(item)]); return item;
  }
  playFiles({ playerId, filePaths, operationKind = 'play' } = {}) {
    if (!['play', 'playNext', 'queue'].includes(operationKind)) throw fail('unsupported', 'Choose a playback operation.');
    return this.playerCommand({ playerId, filePaths, action: operationKind === 'play' ? 'replace' : 'insert', position: operationKind === 'playNext' ? 'afterCurrent' : 'end', play: operationKind === 'play' });
  }
  pruneFiles(playerId, state) {
    const uris = new Set(state.queue.map(track => track.uri));
    for (const [uid, source] of this.fileSources) {
      if (source.playerId !== playerId) continue;
      if (uris.has(source.uri)) continue;
      this.fileSources.delete(uid); this.fileServer.revokeSource(uid);
    }
  }
  setSharing(request) {
    const result = this.configuring.catch(() => {}).then(async () => {
      if (typeof request?.enabled !== 'boolean' || !Array.isArray(request.folderIds) || request.folderIds.length > 1024) throw fail('invalidSharing', 'Select the music folders to share.');
      const catalog = await this.getCatalog();
      const folders = (await catalog.repository.listScanFolders({ includeRemoved: false })).folders;
      if (request.folderIds.some(id => !folders.some(folder => folder.id === id))) throw fail('invalidSharing', 'A selected music folder is no longer available.');
      this.server.revoke(); this.containers.clear(); this.containerKeys.clear(); this.trackReferences.clear();
      this.sharing = { enabled: request.enabled, folderIds: [...new Set(request.folderIds)] };
      this.saveConfig({ ...this.loadConfig(), networkMusicSharing: this.sharing });
      if (request.enabled) { await this.discovery.start(); await this.server.start(); }
      else await this.server.close();
      const state = await this.getState(); this.emit('state', state); return state;
    });
    this.configuring = result; return result;
  }
  async sharedSource(uid, kind = 'media') {
    if (!this.sharing.enabled || !this.server.enabled) throw fail('sharingRequired', 'Enable library sharing in Settings > Config... > Network, select the music folder, and save before playing library tracks on another device.');
    const catalog = await this.getCatalog();
    const source = await catalog.runtime.resolvePlaybackSource(uid);
    if (!this.sharing.folderIds.includes(source.folderId)) throw fail('folderNotShared', 'Select this track’s folder in Settings > Config... > Network and save before playing it on another device.');
    if (source.sourceKind === 'cue-track' || source.startFrame != null || source.endFrame != null) throw fail('cueUnsupported', 'CUE tracks cannot be shared in this version. Choose a separate audio file.');
    if (source.sourceKind === 'archive-entry' && kind !== 'artwork') {
      const identity = await catalog.repository.getTrackStorageIdentity(uid);
      const { getArchiveEntryPath } = await import('../js/library/archive/score-entries.js');
      const archiveEntryPath = getArchiveEntryPath(identity?.relativePath, identity?.entryKey);
      if (!archiveEntryPath || TYPES[path.extname(archiveEntryPath).toLowerCase()] !== 'audio/midi') {
        throw fail('unsupportedFormat', 'This score format cannot be shared with a network player.');
      }
      const stat = await fs.stat(source.path);
      const { withFileArchive } = require('./library-archive.cjs');
      const bytes = await withFileArchive(source.path, stat.size, stat.mtimeMs, archive => archive.read(archiveEntryPath));
      return { ...source, archiveEntryPath, bytes };
    }
    return source;
  }
  trackUidForToken(token) { return this.server.tokens.get(token); }
  mimeType(name) { return TYPES[path.extname(name).toLowerCase()]; }
  containerToken() { return crypto.randomBytes(18).toString('base64url'); }
  referenceSuffix(parentId, entryKey) { return crypto.createHash('sha256').update(`${parentId}\0${entryKey ?? ''}`).digest('base64url').slice(0, 18); }
  async playSelection({ playerId, selectionDescriptor, operationKind, options = {} }) {
    if (!['play', 'playNext', 'queue'].includes(operationKind)) throw fail('unsupported', 'Choose a playback operation.');
    const { validateSelectionDescriptor } = await import(pathToFileURL(path.join(__dirname, '../js/library/repository/selection-descriptor.js')).href);
    const descriptor = validateSelectionDescriptor(selectionDescriptor);
    const repository = (await this.getCatalog()).repository;
    await repository.retainContext(descriptor.contextToken);
    const rows = []; let cursor = null; let inRange = false; let rangeDone = false; let endpoints = 0;
    const selected = new Set(descriptor.trackUids || []); const excluded = new Set(descriptor.exclusions || []); const included = new Set(descriptor.inclusions || []);
    const remaining = new Set(selected);
    try {
      do {
        const page = await repository.readContextPage({ contextToken: descriptor.contextToken, cursor, limit: 500 });
        for (const row of page.rows) {
          const identity = row.playlistItemKey ?? row.trackUid;
          let accept = descriptor.mode === 'all';
          if (descriptor.mode === 'explicit') accept = remaining.delete(identity);
          if (descriptor.mode === 'range') {
            const endpoint = identity === descriptor.startUid || identity === descriptor.endUid;
            if (endpoint) { endpoints++; if (!inRange && !rangeDone) inRange = true; else rangeDone = true; }
            accept = (inRange && !rangeDone) || endpoint || included.has(identity);
            if (endpoint && descriptor.startUid === descriptor.endUid) rangeDone = true;
          }
          if (accept && !excluded.has(identity)) { rows.push({ identity, trackUid: row.trackUid }); if (rows.length > MAX_QUEUE) throw fail('queueTooLarge', 'Choose at most 4096 tracks for this player.'); }
        }
        cursor = descriptor.mode === 'explicit' && remaining.size === 0 ? null : page.nextCursor;
      } while (cursor);
      if (descriptor.mode === 'explicit') {
        const ordered = new Map(rows.map(row => [row.identity, row]));
        if (ordered.size !== selected.size) throw fail('selectionChanged', 'The library selection changed. Select the tracks again.');
        rows.splice(0, rows.length, ...descriptor.trackUids.map(id => ordered.get(id)));
      }
      if (descriptor.mode === 'range' && endpoints < (descriptor.startUid === descriptor.endUid ? 1 : 2)) throw fail('selectionChanged', 'The library selection changed. Select the tracks again.');
    } finally { await repository.releaseRetainedContext(descriptor.contextToken); }
    return this.playCatalogRows(playerId, rows, operationKind, options);
  }
  async dispose() { this.avPlayers.dispose(); for (const source of this.sources.values()) source.close(); this.repository?.removeListener?.('invalidation', this.catalogChanged); await this.server.close(); await this.fileServer.close(); this.fileSources.clear(); this.playerGenerations.clear(); this.discovery.close(); await this.gateway.close(); }
}
function routeAddress(address) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4'); const timer = setTimeout(() => { socket.close(); reject(fail('unavailable', 'The player cannot be reached from this device.')); }, 3000);
    socket.once('error', error => { clearTimeout(timer); socket.close(); reject(error); });
    socket.connect(1900, address, () => { const local = socket.address().address; clearTimeout(timer); socket.close(); resolve(local); });
  });
}
function registerNetworkMusicIpc({ ipcMain, host, getMainWindow }) {
  const registrations = [];
  for (const [name, method] of Object.entries(METHODS)) {
    const channel = `network-music:${name}`; registrations.push(channel);
    ipcMain.handle(channel, async (event, request = {}) => {
      const window = getMainWindow();
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw fail('unauthorized', 'Open the main EffeTune window to use network music.');
      if (Buffer.byteLength(JSON.stringify(request)) > 512 * 1024) throw fail('invalidRequest', 'The selected request is too large.');
      try { return await host[method](request); }
      catch (error) { error.networkMusicOperation = name; host.onDiagnostic(error); return { networkMusicError: { code: error.code || 'networkMusicUnavailable', message: publicMessage(error) } }; }
    });
  }
  const listener = state => { const window = getMainWindow(); if (window && !window.isDestroyed()) window.webContents.send('network-music:state', state); };
  host.on('state', listener);
  return () => { for (const channel of registrations) ipcMain.removeHandler(channel); host.removeListener('state', listener); };
}
function publicMessage(error) {
  if (error.code === 'ETIMEDOUT') return 'The music device did not respond. Check that it is on and connected to the same network, then try again.';
  return ['invalidRequest', 'unavailable', 'unsupported', 'trackUnavailable', 'unsupportedFormat', 'queueTooLarge', 'queueChanged', 'invalidSelection', 'queueFull', 'invalidSharing', 'sharingRequired', 'folderNotShared', 'cueUnsupported', 'selectionChanged', 'fileAccessRequired', 'catalogUnavailable'].includes(error.code) ? error.message : 'The music device could not complete the request. Check its connection and try again.';
}
function logNetworkMusicDiagnostic(error, context) {
  if (['probeLibraries', 'discovery'].includes(context?.operation) && RETRYABLE_CONNECTION_ERRORS.has(error.code)) {
    console.warn('Network music discovery: connection unavailable', {
      address: context.deviceAddress || error.networkMusicAddress, reason: error.code,
      ...(context.deviceName ? { device: context.deviceName } : {}), ...(error.upnpAction ? { action: error.upnpAction } : {})
    });
    return;
  }
  console.error('Network music diagnostic:', error);
}
module.exports = { NetworkMusicHost, registerNetworkMusicIpc, supportsProtocol, routeAddress, MAX_QUEUE, logNetworkMusicDiagnostic };
