'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const dgram = require('node:dgram');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { Discovery, service, soap, parseXml, descendants, value, parseDidl, didl, didlItem, networkUrl } = require('./network-music-upnp.cjs');
const { MusicServer, TYPES } = require('./network-music-server.cjs');
const { VIEWS, CLASSES } = require('./network-music-content.cjs');
const { OpenHomeMediaGateway } = require('./openhome-media-gateway.cjs');
const { resolveFriendlyName } = require('./openhome-control-host.cjs');
const fileAccess = require('./file-access.cjs');

const MAX_QUEUE = 4096;
const METHODS = Object.freeze({ GetState: 'getState', Discover: 'discover', Browse: 'browse', GetPlayerState: 'getPlayerState', PlayerCommand: 'playerCommand', ResolveTrack: 'resolveTrack', SetSharing: 'setSharing', PlaySelection: 'playSelection', PlayFiles: 'playFiles' });
const fail = (code, message) => Object.assign(new Error(message), { code });
const number = (input, max = 0xffffffff) => { const value = Number(input); if (!Number.isSafeInteger(value) || value < 0 || value > max) throw fail('invalidRequest', 'Choose a valid playback value.'); return value; };
const bool = value => value === '1' || value === 'true';
const duration = text => { const parts = String(text || '').split(':').map(Number); return parts.length === 3 && parts.every(Number.isFinite) ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0; };

class NetworkMusicHost extends EventEmitter {
  constructor({ getCatalog, loadConfig, saveConfig, getFriendlyName = () => resolveFriendlyName(loadConfig()), discovery = new Discovery(), gateway = new OpenHomeMediaGateway(), invoke = soap, localPlayer = null, getRouteAddress = routeAddress, onDiagnostic = () => {} }) {
    super(); Object.assign(this, { loadConfig, saveConfig, discovery, gateway, invoke, getRouteAddress, onDiagnostic });
    this.localPlayer = localPlayer;
    this.invoke = (endpoint, action, args, isCurrent) => endpoint?.invoke ? endpoint.invoke(action, args, isCurrent) : invoke(endpoint, action, args);
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
    this.queues = new Map(); this.playerGenerations = new Map(); this.localMedia = new Map(); this.containers = new Map(); this.containerKeys = new Map(); this.trackReferences = new Map(); this.configuring = Promise.resolve(); this.probing = new Set(); this.fileSources = new Map();
    const config = loadConfig();
    this.id = config.networkMusicDeviceId || `uuid:${crypto.randomUUID()}`;
    if (!config.networkMusicDeviceId) saveConfig({ ...config, networkMusicDeviceId: this.id });
    this.sharing = { enabled: config.networkMusicSharing?.enabled === true, folderIds: Array.isArray(config.networkMusicSharing?.folderIds) ? config.networkMusicSharing.folderIds : [] };
    this.server = new MusicServer({ id: this.id, getName: getFriendlyName, discovery, browse: request => this.browseShared(request), resolveSource: uid => this.sharedSource(uid), getArtwork: async uid => (await this.getCatalog()).runtime.requestArtwork({ trackUid: uid, reason: 'detail' }), onDiagnostic });
    this.fileServer = new MusicServer({ id: this.id, discovery, advertise: false, resolveSource: async uid => {
      const source = this.fileSources.get(uid);
      if (!source) throw fail('trackUnavailable', 'Open this file again to play it.');
      fileAccess.assertPath(source.path, 'read');
      return source;
    }, onDiagnostic });
    discovery.on('diagnostic', onDiagnostic);
    discovery.on('change', () => { this.emitState(); void this.probeLibraries(); });
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
      libraries: [...this.discovery.devices.values()].filter(device => device.id !== this.id && service(device, 'ContentDirectory')).map(device => ({ id: device.id, name: device.name, available: device.available, searchSupported: device.searchSupported === true, catalogSearch: device.catalogSearch === true, searchCaps: device.searchCaps || [], sortCaps: device.sortCaps || [], browseViews: device.browseViews || [] })),
      players: [...this.discovery.devices.values()].filter(device => device.id !== this.localPlayer?.id && service(device, 'Playlist')).map(device => ({ id: device.id, name: device.name, available: device.available, isEffeTune: device.manufacturer === 'EffeTune' })),
      sharing: { ...this.sharing, folderIds: [...this.sharing.folderIds], folders }
    };
  }
  emitState() { void this.getState().then(state => this.emit('state', state)).catch(this.onDiagnostic); }
  async discover() { await this.discovery.start(); this.discovery.search(); return this.getState(); }
  async probeLibraries() {
    for (const device of this.discovery.devices.values()) {
      if (!device.available || device.libraryProbed || this.probing.has(device.id) || !service(device, 'ContentDirectory')) continue;
      this.probing.add(device.id);
      try {
        const endpoint = service(device, 'ContentDirectory');
        const results = await Promise.allSettled([
          this.invoke(endpoint, 'GetSearchCapabilities'), this.invoke(endpoint, 'GetSortCapabilities'),
          this.invoke(endpoint, 'Browse', { ObjectID: '0', BrowseFlag: 'BrowseDirectChildren', Filter: '*', StartingIndex: 0, RequestedCount: 100, SortCriteria: '' })
        ]);
        for (const result of results) if (result.status === 'rejected') this.onDiagnostic(result.reason);
        device.searchCaps = results[0].status === 'fulfilled' ? (results[0].value.SearchCaps || '').split(',').map(item => item.trim()).filter(Boolean) : [];
        device.sortCaps = results[1].status === 'fulfilled' ? (results[1].value.SortCaps || '').split(',').map(item => item.trim()).filter(Boolean) : [];
        device.searchSupported = device.searchCaps.includes('*') || ['dc:title', 'upnp:artist', 'upnp:album', 'upnp:genre'].some(property => device.searchCaps.includes(property));
        const roots = results[2].status === 'fulfilled' ? parseDidl(results[2].value.Result) : [];
        device.browseViews = VIEWS.every(view => roots.filter(item => item.isContainer && item.viewId === view.id).length === 1)
          ? VIEWS.map(view => ({ id: view.id, objectId: roots.find(item => item.viewId === view.id).id })) : [];
        device.catalogSearch = device.browseViews.length === VIEWS.length && device.browseViews.every(view => roots.find(item => item.id === view.objectId).catalogSearch);
        device.searchSupported ||= device.catalogSearch;
      } catch (error) { this.onDiagnostic(error); }
      finally { device.libraryProbed = true; this.probing.delete(device.id); }
      this.emitState();
    }
  }
  device(id, kind) { const device = this.localPlayer?.controlId === id ? this.localPlayer : this.discovery.devices.get(id); if (!device?.available || !service(device, kind)) throw fail('unavailable', 'The music device is unavailable. Check that it is on and connected to the same network.'); return device; }
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
    if (serverId === 'local') return this.browseLocal({ objectId, start, count, query, sortCriteria });
    const device = this.device(serverId, 'ContentDirectory');
    if (typeof sortCriteria !== 'string' || sortCriteria.length > 512 || (sortCriteria && sortCriteria.split(',').some(term => !/^[+-]/.test(term) || !(device.sortCaps?.includes('*') || device.sortCaps?.includes(term.slice(1)))))) throw fail('unsupported', 'This music library does not support the selected sorting.');
    const args = { BrowseFlag: 'BrowseDirectChildren', Filter: '*', StartingIndex: number(start), RequestedCount: Math.max(1, number(count, 500)), SortCriteria: sortCriteria };
    let action = 'Browse';
    if (query) {
      if (!device.searchSupported) throw fail('unsupported', 'This music library does not support searching.');
      const tokens = String(query).slice(0, 512).trim().split(/\s+/).filter(Boolean);
      if (tokens.length) {
        delete args.BrowseFlag; args.ContainerID = String(objectId);
        if (device.catalogSearch) {
          action = 'X_EffeTune_Search'; args.Query = String(query).slice(0, 512);
        } else {
          action = 'Search';
          const caps = device.searchCaps ?? ['dc:title'];
          const fields = ['dc:title', 'upnp:artist', 'upnp:album', 'upnp:genre'].filter(property => caps.includes('*') || caps.includes(property));
          if (!fields.length) throw fail('unsupported', 'This music library does not support searching.');
          args.SearchCriteria = tokens.map(token => {
            const quoted = token.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const conditions = fields.map(property => `${property} contains "${quoted}"`);
            return conditions.length > 1 ? `(${conditions.join(' or ')})` : conditions[0];
          }).join(' and ');
        }
      } else args.ObjectID = String(objectId);
    } else args.ObjectID = String(objectId);
    const response = await this.invoke(service(device, 'ContentDirectory'), action, args);
    const items = parseDidl(response.Result).map(item => this.publicTrack(item, serverId));
    const total = number(response.TotalMatches);
    // ContentDirectory reports zero when the matching total is unknown.
    return { items, total: total === 0 && items.length > 0 ? null : total, start: args.StartingIndex, numberReturned: items.length, updateId: response.UpdateID === undefined ? null : number(response.UpdateID) };
  }
  publicTrack(item, serverId) {
    const resources = (item.resources ?? []).filter(resource => { try { networkUrl(resource.uri); return resource.protocolInfo.startsWith('http-get:'); } catch { return false; } });
    return { ...item, resources, serverId, trackId: item.id, uri: resources[0]?.uri || '', duration: duration(resources[0]?.duration), metadata: didl([didlItem({ ...item, resources }, item.parentId)]), playable: !item.isContainer && resources.length > 0 };
  }
  async resolveTrack({ serverId, trackId, localPlayback = false, address } = {}) {
    let track;
    if (serverId === 'local') {
      const source = await this.sharedSource(trackId);
      const catalog = await this.getCatalog();
      track = await this.sharedTrack(await catalog.repository.getTrack(trackId), address, source);
      track.serverId = 'local'; track.trackId = trackId; track.metadata = didl([didlItem(track)]);
    } else {
      const device = this.device(serverId, 'ContentDirectory');
      const result = await this.invoke(service(device, 'ContentDirectory'), 'Browse', { ObjectID: String(trackId), BrowseFlag: 'BrowseMetadata', Filter: '*', StartingIndex: 0, RequestedCount: 1, SortCriteria: '' });
      const item = parseDidl(result.Result).find(item => item.id === String(trackId));
      if (!item || item.isContainer) throw fail('trackUnavailable', 'This track is no longer available in the selected library.');
      track = this.publicTrack(item, serverId);
    }
    if (!track.uri) throw fail('unsupportedFormat', 'This track has no supported audio source. CUE tracks cannot be shared in this version.');
    if (localPlayback) {
      let registration = this.localMedia.get(track.uri);
      if (!registration) { registration = await this.gateway.register(track.uri); this.localMedia.set(track.uri, registration); }
      track = { ...track, uri: registration.playbackUrl };
    }
    return track;
  }
  async getPlayerState({ playerId } = {}) {
    const generation = this.playerGenerations.get(playerId);
    const commandPending = this.queues.has(playerId);
    const device = this.device(playerId, 'Playlist'); const playlist = service(device, 'Playlist');
    const [array, transport, id, repeat, shuffle, protocol] = await Promise.all(['IdArray', 'TransportState', 'Id', 'Repeat', 'Shuffle', 'ProtocolInfo'].map(action => this.invoke(playlist, action)));
    const bytes = Buffer.from(array.Array || '', 'base64');
    if (bytes.length % 4 || bytes.length > MAX_QUEUE * 4) throw fail('queueTooLarge', 'This player queue is too large to display.');
    const ids = []; for (let offset = 0; offset < bytes.length; offset += 4) ids.push(bytes.readUInt32BE(offset));
    const queue = [];
    for (let offset = 0; offset < ids.length; offset += 32) {
      const response = await this.invoke(playlist, 'ReadList', { IdList: ids.slice(offset, offset + 32).join(' ') });
      const entries = response.tracks ?? descendants(parseXml(response.TrackList), 'Entry').map(entry => ({ id: value(entry, 'Id'), uri: value(entry, 'Uri'), metadata: value(entry, 'Metadata') }));
      for (const entry of entries) {
        const metadata = entry.metadata;
        let item = {}; try { item = parseDidl(metadata)[0] ?? {}; } catch { /* Some players return empty metadata. */ }
        queue.push({ id: number(entry.id), title: item.title || 'Track', artist: item.artist || '', album: item.album || '', uri: entry.uri, metadata, duration: duration(item.resources?.[0]?.duration), artwork: item.artwork || '' });
      }
    }
    // Recheck the sequence token after paged reads; never combine two queue revisions.
    const unchanged = await this.invoke(playlist, 'IdArrayChanged', { Token: number(array.Token) });
    if (bool(unchanged.Value)) throw fail('queueChanged', 'The player queue changed. Refresh it to see the latest tracks.');
    let position = 0; let total = queue.find(item => item.id === Number(id.Value))?.duration || 0;
    if (service(device, 'Time')) { const time = await this.invoke(service(device, 'Time'), 'Time'); position = Number(time.Seconds) || 0; total = Number(time.Duration) || total; }
    let volume = null; let volumeMax = null;
    if (service(device, 'Volume')) { const [current, limit] = await Promise.all([this.invoke(service(device, 'Volume'), 'Volume'), this.invoke(service(device, 'Volume'), 'VolumeLimit')]); volume = Number(current.Value); volumeMax = Number(limit.Value); }
    const state = { playerId, transportState: transport.Value, position, duration: total, currentId: Number(id.Value), queue, repeat: bool(repeat.Value), shuffle: bool(shuffle.Value), protocolInfo: String(protocol.Value || ''), volume, volumeMax, capabilities: { play: true, pause: true, stop: true, next: true, previous: true, seek: true, seekId: true, delete: true, clear: true, repeat: true, shuffle: true, volume: Boolean(service(device, 'Volume')) } };
    // A read begun before or during a command cannot revoke that command's new resources.
    if (!commandPending && !this.queues.has(playerId) && this.playerGenerations.get(playerId) === generation) this.pruneFiles(playerId, state);
    return state;
  }
  playerCommand(request) {
    this.playerGenerations.set(request.playerId, (this.playerGenerations.get(request.playerId) ?? 0) + 1);
    const previous = this.queues.get(request.playerId) || Promise.resolve();
    const result = previous.catch(() => {}).then(async () => {
      try { return await this.executeCommand(request); }
      catch (error) {
        if (request.filePaths !== undefined) {
          try { this.pruneFiles(request.playerId, await this.getPlayerState({ playerId: request.playerId })); }
          catch (stateError) { this.onDiagnostic(stateError); }
        }
        throw error;
      }
    });
    this.queues.set(request.playerId, result);
    void result.finally(() => { if (this.queues.get(request.playerId) === result) this.queues.delete(request.playerId); }).catch(() => {});
    return result;
  }
  async executeCommand(request) {
    const { playerId, action, seconds, value: setting, id, tracks, filePaths, afterId, position = 'end', play = false, startIndex = 0, isCurrent = () => true } = request;
    let { items } = request;
    const device = this.device(playerId, 'Playlist'); const playlist = service(device, 'Playlist');
    const invoke = (endpoint, name, args) => {
      if (!isCurrent()) throw fail('unauthorized', 'Reconnect to the playback device.');
      request.mutationStarted = true;
      return this.invoke(endpoint, name, args, isCurrent);
    };
    const simple = { play: 'Play', pause: 'Pause', stop: 'Stop', next: 'Next', previous: 'Previous', clear: 'DeleteAll' };
    if (Object.hasOwn(simple, action)) await invoke(playlist, simple[action]);
    else if (action === 'seek') await invoke(playlist, 'SeekSecondAbsolute', { Value: number(seconds) });
    else if (action === 'seekId') { await invoke(playlist, 'SeekId', { Value: number(id) }); await invoke(playlist, 'Play'); }
    else if (action === 'delete') await invoke(playlist, 'DeleteId', { Value: number(id) });
    else if (action === 'repeat' || action === 'shuffle') { if (typeof setting !== 'boolean') throw fail('invalidRequest', 'Choose a valid playback setting.'); await invoke(playlist, action === 'repeat' ? 'SetRepeat' : 'SetShuffle', { Value: setting ? 1 : 0 }); }
    else if (action === 'volume') {
      const volume = service(device, 'Volume');
      if (!volume) throw fail('unsupported', 'This player does not support remote volume adjustment.');
      await invoke(volume, 'SetVolume', { Value: number(setting, 1000) });
    }
    else if (action === 'replace' || action === 'insert') {
      if (tracks !== undefined) {
        if (device !== this.localPlayer) throw fail('invalidRequest', 'Choose a valid playback device.');
        items = tracks;
      }
      if (filePaths !== undefined) items = filePaths;
      if (!Array.isArray(items) || !items.length || items.length > MAX_QUEUE) throw fail('invalidSelection', 'Choose between 1 and 4096 tracks.');
      if (!['end', 'afterCurrent'].includes(position)) throw fail('invalidRequest', 'Choose a valid queue position.');
      const initialIndex = number(startIndex, items.length - 1);
      const [max, state] = await Promise.all([this.invoke(playlist, 'TracksMax'), this.getPlayerState({ playerId })]);
      this.pruneFiles(playerId, state);
      const maximum = Math.min(MAX_QUEUE, number(max.Value));
      if (items.length + (action === 'replace' ? 0 : state.queue.length) > maximum) throw fail('queueFull', 'This selection exceeds the player queue limit. Choose fewer tracks.');
      if (device === this.localPlayer && tracks === undefined && filePaths === undefined &&
          items.some(item => item.serverId === 'local')) {
        const catalog = await this.getCatalog();
        if (!catalog) throw fail('catalogUnavailable', 'The local music library is unavailable. Open the library and try again.');
        for (const item of items) {
          if (item.serverId === 'local') {
            const row = await catalog.repository.getTrack(item.trackId);
            if (!row) throw fail('trackUnavailable', 'This track is no longer available in the local music library.');
            await catalog.runtime.resolvePlaybackSource(item.trackId);
          } else {
            const track = await this.resolveTrack(item);
            const resource = (track.resources ?? []).find(resource => supportsProtocol(state.protocolInfo, resource.protocolInfo));
            if (!resource) throw fail('unsupportedFormat', 'The player does not support the audio format of one or more selected tracks.');
          }
        }
        if (!isCurrent()) throw fail('unauthorized', 'Reconnect to the playback device.');
        request.mutationStarted = true;
        try {
          await this.localPlayer.playCatalogItems({ items, operationKind: action === 'replace' ? 'play' :
            position === 'afterCurrent' ? 'playNext' : 'queue', startIndex: initialIndex }, isCurrent);
        } catch (error) {
          if (error.phase === 'preflight') request.mutationStarted = false;
          throw error;
        }
        const next = await this.getPlayerState({ playerId });
        this.pruneFiles(playerId, next);
        return next;
      }
      const address = tracks === undefined ? await this.getRouteAddress(device.address) : null;
      const resolved = [];
      for (const item of items) {
        const track = tracks !== undefined ? item : filePaths === undefined
          ? await this.resolveTrack({ serverId: item.serverId, trackId: item.trackId, address })
          : await this.openedFile(item);
        const resource = (track.resources ?? []).find(resource => supportsProtocol(state.protocolInfo, resource.protocolInfo));
        if (!resource) throw fail('unsupportedFormat', 'The player does not support the audio format of one or more selected tracks.');
        resolved.push({ ...track, uri: resource.uri });
      }
      if (filePaths !== undefined) {
        const replacedCount = action === 'replace' ? [...this.fileSources.values()].filter(source => source.playerId === playerId).length : 0;
        if (this.fileSources.size - replacedCount + resolved.length > MAX_QUEUE) throw fail('queueFull', 'Remove previously opened files from their player queues before opening more files.');
        await this.fileServer.start();
        for (const track of resolved) {
          const uid = crypto.randomBytes(24).toString('base64url');
          const resource = this.fileServer.resource(uid, address, device.address);
          this.fileSources.set(uid, { path: track.path, playerId, uri: resource.uri });
          track.uri = resource.uri; track.id = uid;
          track.resources[0].uri = resource.uri;
          track.metadata = didl([didlItem(track)]);
        }
      }
      let anchor = afterId === undefined ? (position === 'afterCurrent' ? state.currentId : state.queue.at(-1)?.id) || 0 : number(afterId);
      if (action === 'replace') { await invoke(playlist, 'DeleteAll'); anchor = 0; }
      let initialId;
      for (let index = 0; index < resolved.length; index++) {
        const track = resolved[index];
        const result = await invoke(playlist, 'Insert', { AfterId: anchor, Uri: track.uri, Metadata: track.metadata });
        anchor = number(result.NewId); if (index === initialIndex) initialId = anchor;
      }
      if (play) { await invoke(playlist, 'SeekId', { Value: initialId }); await invoke(playlist, 'Play'); }
    } else throw fail('unsupported', 'This playback operation is not supported.');
    const state = await this.getPlayerState({ playerId });
    this.pruneFiles(playerId, state);
    return state;
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
  async sharedSource(uid) {
    if (!this.sharing.enabled || !this.server.enabled) throw fail('sharingRequired', 'Enable library sharing in Settings > Config... > Network, select the music folder, and save before playing library tracks on another device.');
    const catalog = await this.getCatalog();
    const source = await catalog.runtime.resolvePlaybackSource(uid);
    if (!this.sharing.folderIds.includes(source.folderId)) throw fail('folderNotShared', 'Select this track’s folder in Settings > Config... > Network and save before playing it on another device.');
    if (source.sourceKind === 'cue-track' || source.startFrame != null || source.endFrame != null) throw fail('cueUnsupported', 'CUE tracks cannot be shared in this version. Choose a separate audio file.');
    return source;
  }
  async sharedTrack(row, address, source = null, parentId = this.viewContainer('tracks').id) {
    if (!row) throw fail('trackUnavailable', 'The selected track is unavailable.');
    const catalog = await this.getCatalog();
    const identity = source ?? await catalog.repository.getTrackStorageIdentity(row.trackUid);
    if (!identity || !this.sharing.folderIds.includes(identity.folderId)) throw fail('trackUnavailable', 'The selected track is unavailable.');
    const resource = this.server.resource(row.trackUid, address);
    const token = this.server.trackTokens.get(row.trackUid);
    const mime = TYPES[path.extname(identity.path || identity.relativePath || '').toLowerCase()];
    const playable = Boolean(mime) && identity.sourceKind !== 'cue-track' && identity.startFrame == null && identity.endFrame == null;
    const seconds = Number(row.durationSec) || 0;
    const durationText = `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    const canonicalId = `track:${token}`;
    const reference = parentId !== this.viewContainer('tracks').id || row.entryKey != null;
    const id = reference ? `${canonicalId}:${crypto.createHash('sha256').update(`${parentId}\0${row.entryKey ?? ''}`).digest('base64url').slice(0, 18)}` : canonicalId;
    if (reference) this.trackReferences.set(id, { parentId, entryKey: row.entryKey });
    const links = {};
    for (const type of ['album', 'artist']) if (row[`${type}Key`]) {
      const key = row[`${type}Key`];
      const target = this.container({ kind: 'tracks', scope: { [`${type}Key`]: key }, entityType: type }, row[type], this.viewContainer(`${type}s`).id);
      this.containers.get(target.id).entityKey = key;
      links[`${type}ObjectId`] = target.id;
    }
    return { id, parentId, refId: reference ? canonicalId : '', ...links, title: row.title || 'Track', artist: row.artist || '', album: row.album || '', genre: row.genre || '', trackNo: row.trackNo, date: row.year ? String(row.year) : '', addedAt: row.addedAt, displayPath: row.displayPath ?? identity.relativePath ?? '', upnpClass: CLASSES.track, artwork: resource.artwork, uri: playable ? resource.uri : '', resources: playable ? [{ uri: resource.uri, protocolInfo: `http-get:*:${mime}:*`, size: identity.byteLength ?? identity.size ?? '', duration: durationText }] : [], isContainer: false, playable };
  }
  container(data, title, parentId = '0', metadata = {}) {
    const key = JSON.stringify(data); let id = this.containerKeys.get(key);
    if (!id) { id = `container:${crypto.randomBytes(18).toString('base64url')}`; this.containerKeys.set(key, id); this.containers.set(id, { ...data, title, parentId }); }
    return { id, title, parentId, isContainer: true, ...metadata };
  }
  viewContainer(viewId) {
    const view = VIEWS.find(item => item.id === viewId);
    if (!view) throw new Error('701');
    const id = `view:${view.id}`;
    return { id, title: view.title, parentId: '0', isContainer: true, viewId, upnpClass: CLASSES.view, catalogSearch: true };
  }
  sharedContainer(row, address) {
    if (row.kind === 'view') return this.viewContainer(row.key);
    const view = { album: 'albums', artist: 'artists', genre: 'genres', subfolder: 'subfolders', playlist: 'playlists', folder: 'folders', directory: 'folders' }[row.kind];
    let descriptor;
    let parentId = this.viewContainer(view).id;
    if (row.kind === 'folder' || row.kind === 'directory') {
      descriptor = { kind: 'directory', scope: { folderId: row.folderId, directoryPath: row.relativePath || '' } };
      if (row.relativePath) {
        const parentPath = row.relativePath.includes('/') ? row.relativePath.slice(0, row.relativePath.lastIndexOf('/')) : '';
        parentId = this.container({ kind: 'directory', scope: { folderId: row.folderId, directoryPath: parentPath } }, '', this.viewContainer('folders').id).id;
      }
    } else descriptor = { kind: 'tracks', scope: { [{ album: 'albumKey', artist: 'artistKey', genre: 'genreKey', subfolder: 'subfolderKey', playlist: 'playlistId' }[row.kind]]: row.key }, entityType: row.kind };
    const item = this.container(descriptor, row.title, parentId, { upnpClass: CLASSES[row.kind], childCount: row.childCount, trackCount: row.trackCount, totalDurationSec: row.durationSec, artist: row.artist || '', album: row.album || '', genre: row.genre || '', date: row.year ? String(row.year) : '', displayPath: row.displayPath || '' });
    // Refresh display metadata without retaining a separate catalog snapshot.
    Object.assign(this.containers.get(item.id), { title: item.title, parentId, entityKey: row.key });
    if (row.representativeTrackUid) item.artwork = this.server.resource(row.representativeTrackUid, address).artwork;
    if (descriptor.kind === 'directory') {
      item.treeObjectId = item.id;
      item.flatObjectId = this.container({ kind: 'directory', scope: { ...descriptor.scope, recursive: true } }, row.title, parentId).id;
    }
    return item;
  }
  async browseShared({ objectId, metadata = false, start = 0, count = 100, address, sort = [], search = null, catalogQuery = null }) {
    if (!this.sharing.enabled) throw new Error('701');
    const sharing = this.sharing;
    const catalog = await this.getCatalog(); const repository = catalog.repository;
    if (objectId.startsWith('track:') && metadata) {
      const uid = this.server.tokens.get(objectId.split(':')[1]);
      const reference = this.trackReferences.get(objectId);
      if (!uid || (objectId.split(':').length > 2 && !reference)) throw new Error('701');
      const row = await repository.getTrack(uid);
      if (!row) throw new Error('701');
      const item = await this.sharedTrack({ ...row, entryKey: reference?.entryKey }, address, null, reference?.parentId);
      if (sharing !== this.sharing) throw new Error('701');
      return { items: [item], total: 1 };
    }
    const view = VIEWS.find(item => objectId === `view:${item.id}`);
    const descriptor = objectId === '0' ? { kind: 'root', title: 'Music Library', parentId: '-1' } : view ? { kind: view.id, title: view.title, parentId: '0' } : this.containers.get(objectId);
    if (!descriptor) throw new Error('701');
    const searching = search !== null || catalogQuery !== null;
    const query = options => repository.querySharedLibrary({ folderIds: sharing.folderIds, kind: descriptor.kind, scope: descriptor.scope, start, count, sort, search, catalogQuery, ...options });
    if (descriptor.kind === 'root' && !searching) {
      const items = VIEWS.map(view => this.viewContainer(view.id));
      if (metadata) return { items: [{ id: '0', title: descriptor.title, parentId: '-1', isContainer: true, upnpClass: CLASSES.view, childCount: items.length }], total: 1 };
      if (sort.length) {
        // The nine fixed navigation entries are the only in-memory sort, independent of library size.
        for (const term of [...sort].reverse()) if (term.property === 'dc:title') items.sort((a, b) => (term.direction === 'asc' ? 1 : -1) * a.title.localeCompare(b.title));
      }
      return { items: items.slice(start, start + count), total: items.length };
    }
    if (metadata) {
      let item;
      if (descriptor.entityType) {
        const kind = { album: 'albums', artist: 'artists', genre: 'genres', subfolder: 'subfolders', playlist: 'playlists' }[descriptor.entityType];
        const page = await query({ kind, scope: null, key: descriptor.entityKey, start: 0, count: 1, search: null, sort: [] });
        if (!page.rows.length) throw new Error('701');
        item = this.sharedContainer(page.rows[0], address);
      } else if (descriptor.kind === 'directory') {
        const { folderId, directoryPath, recursive } = descriptor.scope;
        const page = await query({ kind: 'folders', scope: null, key: directoryPath ? `${folderId}\0${directoryPath}` : folderId, search: directoryPath ? { all: true } : null, start: 0, count: 1, sort: [] });
        if (!page.rows.length) throw new Error('701');
        item = this.sharedContainer(page.rows[0], address);
        if (recursive) item = { ...item, id: objectId, childCount: item.trackCount };
      } else {
        const page = await query({ start: 0, count: 1, search: null, sort: [] });
        item = { ...this.viewContainer(descriptor.kind), childCount: page.total };
      }
      if (sharing !== this.sharing) throw new Error('701');
      return { items: [item], total: 1 };
    }
    const page = await query();
    const items = [];
    for (const row of page.rows) {
      if (row.kind !== 'track') { items.push(this.sharedContainer(row, address)); continue; }
      let parentId = objectId;
      if (searching && !descriptor.entityType) {
        const type = { albums: 'album', artists: 'artist', genres: 'genre', subfolders: 'subfolder', playlists: 'playlist' }[descriptor.kind];
        if (type) {
          const field = type === 'playlist' ? 'playlistId' : `${type}Key`;
          const target = this.container({ kind: 'tracks', scope: { [field]: row[field] }, entityType: type }, '', this.viewContainer(descriptor.kind).id);
          this.containers.get(target.id).entityKey = row[field]; parentId = target.id;
        } else if (descriptor.kind === 'folders' || descriptor.kind === 'directory') {
          const directoryPath = row.relativePath.includes('/') ? row.relativePath.slice(0, row.relativePath.lastIndexOf('/')) : '';
          parentId = this.container({ kind: 'directory', scope: { folderId: row.folderId, directoryPath } }, '', this.viewContainer('folders').id).id;
        } else if (descriptor.kind === 'root') parentId = this.viewContainer('tracks').id;
      }
      items.push(await this.sharedTrack(row, address, null, parentId));
    }
    if (sharing !== this.sharing) throw new Error('701');
    return { items, total: page.total };
  }
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
    const items = rows.map(row => ({ serverId: 'local', trackId: row.trackUid }));
    await this.playerCommand({ playerId, action: operationKind === 'play' ? 'replace' : 'insert', items, position: operationKind === 'playNext' ? 'afterCurrent' : 'end', play: operationKind === 'play', startIndex: operationKind === 'play' ? options.currentOrdinal ?? 0 : 0 });
    return { kind: 'terminal', result: { state: 'succeeded', operationKind } };
  }
  async dispose() { this.repository?.removeListener?.('invalidation', this.catalogChanged); await this.server.close(); await this.fileServer.close(); this.fileSources.clear(); this.playerGenerations.clear(); this.discovery.close(); await this.gateway.close(); }
}
function supportsProtocol(supported, protocol) {
  const parts = String(protocol).split(':');
  return String(supported || '').split(',').some(item => { const candidate = item.trim().split(':'); return candidate.length >= 3 && parts.length >= 3 && [0, 1, 2].every(index => candidate[index] === '*' || candidate[index].toLowerCase() === parts[index].toLowerCase()); });
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
  return ['invalidRequest', 'unavailable', 'unsupported', 'trackUnavailable', 'unsupportedFormat', 'queueTooLarge', 'queueChanged', 'invalidSelection', 'queueFull', 'invalidSharing', 'sharingRequired', 'folderNotShared', 'cueUnsupported', 'selectionChanged', 'fileAccessRequired', 'catalogUnavailable'].includes(error.code) ? error.message : 'The music device could not complete the request. Check its connection and try again.';
}
module.exports = { NetworkMusicHost, registerNetworkMusicIpc, supportsProtocol, routeAddress, MAX_QUEUE };
