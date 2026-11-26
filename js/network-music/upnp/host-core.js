import { service, parseXml, descendants, value, parseDidl, didl, didlItem, networkUrl } from './protocol.js';
import { VIEWS, CLASSES } from './content.js';
import { ReversibleShufflePermutation, shuffleEpochSeed } from '../../library/repository/transport-shuffle.js';

const MAX_QUEUE = 4096;
const RETRYABLE_CONNECTION_ERRORS = new Set(['ETIMEDOUT', 'ECONNREFUSED']);
const fail = (code, message) => Object.assign(new Error(message), { code });
const number = (input, max = 0xffffffff) => { const value = Number(input); if (!Number.isSafeInteger(value) || value < 0 || value > max) throw fail('invalidRequest', 'Choose a valid playback value.'); return value; };
const bool = value => value === '1' || value === 'true';
const duration = text => { const parts = String(text || '').split(':').map(Number); return parts.length === 3 && parts.every(Number.isFinite) ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0; };

function supportsProtocol(supported, protocol) {
  const parts = String(protocol).split(':');
  return String(supported || '').split(',').some(item => { const candidate = item.trim().split(':'); return candidate.length >= 3 && parts.length >= 3 && [0, 1, 2].every(index => candidate[index] === '*' || candidate[index].toLowerCase() === parts[index].toLowerCase()); });
}

// The host supplies discovery, transport and media access. Electron retains its EventEmitter base.
const withUpnpCore = (Base = Object) => class extends Base {
  queues = new Map();
  playerGenerations = new Map();
  localMedia = new Map();
  probing = new Set();
  containers = new Map();
  containerKeys = new Map();
  trackReferences = new Map();

  constructor(adapters) {
    super();
    Object.assign(this, adapters);
  }

  async probeLibraries() {
    for (const device of this.discovery.devices.values()) {
      if (!device.available || device.libraryProbed || device.libraryProbeRetryAt > Date.now() || this.probing.has(device.id) || !service(device, 'ContentDirectory')) continue;
      this.probing.add(device.id);
      let retry = false;
      try {
        const endpoint = service(device, 'ContentDirectory');
        const results = await Promise.allSettled([
          this.invoke(endpoint, 'GetSearchCapabilities'), this.invoke(endpoint, 'GetSortCapabilities'),
          this.invoke(endpoint, 'Browse', { ObjectID: '0', BrowseFlag: 'BrowseDirectChildren', Filter: '*', StartingIndex: 0, RequestedCount: 100, SortCriteria: '' })
        ]);
        retry = results.some(result => result.status === 'rejected' && RETRYABLE_CONNECTION_ERRORS.has(result.reason.code));
        for (const result of results) if (result.status === 'rejected') this.onDiagnostic(result.reason, { operation: 'probeLibraries', deviceName: device.name, deviceAddress: endpoint.control });
        device.searchCaps = results[0].status === 'fulfilled' ? (results[0].value.SearchCaps || '').split(',').map(item => item.trim()).filter(Boolean) : device.searchCaps || [];
        device.sortCaps = results[1].status === 'fulfilled' ? (results[1].value.SortCaps || '').split(',').map(item => item.trim()).filter(Boolean) : device.sortCaps || [];
        device.searchSupported = device.searchCaps.includes('*') || ['dc:title', 'upnp:artist', 'upnp:album', 'upnp:genre'].some(property => device.searchCaps.includes(property));
        if (results[2].status === 'fulfilled') {
          const roots = parseDidl(results[2].value.Result);
          device.browseViews = VIEWS.every(view => roots.filter(item => item.isContainer && item.viewId === view.id).length === 1)
            ? VIEWS.map(view => ({ id: view.id, objectId: roots.find(item => item.viewId === view.id).id })) : [];
          device.catalogSearch = device.browseViews.length === VIEWS.length && device.browseViews.every(view => roots.find(item => item.id === view.objectId).catalogSearch);
        }
        device.searchSupported ||= device.catalogSearch === true;
      } catch (error) { this.onDiagnostic(error); }
      finally { device.libraryProbed = !retry; device.libraryProbeRetryAt = retry ? Date.now() + 30000 : 0; this.probing.delete(device.id); }
      this.emitState();
    }
  }
  device(id, kind) { const device = this.localPlayer?.controlId === id ? this.localPlayer : this.discovery.devices.get(id); if (!device?.available || !service(device, kind)) throw fail('unavailable', 'The music device is unavailable. Check that it is on and connected to the same network.'); return device; }
  async browse({ serverId, objectId = '0', start = 0, count = 100, query = '', sortCriteria = '' } = {}) {
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
  async resolveTrack({ serverId, trackId, localPlayback = false, address, protocolInfo, playerId } = {}) {
    let track;
    if (serverId === 'local') {
      const source = await this.sharedSource(trackId);
      const catalog = await this.getCatalog();
      track = await this.sharedTrack(await catalog.repository.getTrack(trackId), address, source, undefined, playerId);
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
      if (!registration) { registration = await this.registerMedia(track.uri); this.localMedia.set(track.uri, registration); }
      track = { ...track, uri: registration.playbackUrl };
    }
    return track;
  }
  async getPlayerState({ playerId } = {}, options) {
    const candidate = this.localPlayer?.controlId === playerId ? this.localPlayer : this.discovery?.devices.get(playerId);
    if (candidate && !candidate.available) this.avPlayers.owners.delete(playerId);
    if (candidate?.available && !service(candidate, 'Playlist') && service(candidate, 'AVTransport')) return this.avPlayers.state(candidate, options);
    const generation = this.playerGenerations.get(playerId);
    const commandPending = this.queues.has(playerId);
    const device = this.device(playerId, 'Playlist'); const playlist = service(device, 'Playlist');
    const [array, transport, id, repeat, shuffle, protocol] = await Promise.all(['IdArray', 'TransportState', 'Id', 'Repeat', 'Shuffle', 'ProtocolInfo'].map(action => this.invoke(playlist, action)));
    const bytes = this.decodeBase64(array.Array || '');
    if (bytes.length % 4 || bytes.length > MAX_QUEUE * 4) throw fail('queueTooLarge', 'This player queue is too large to display.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ids = []; for (let offset = 0; offset < bytes.length; offset += 4) ids.push(view.getUint32(offset));
    const queue = [];
    for (let offset = 0; offset < ids.length; offset += 32) {
      const response = await this.invoke(playlist, 'ReadList', { IdList: ids.slice(offset, offset + 32).join(' ') });
      const entries = response.tracks ?? descendants(parseXml(response.TrackList), 'Entry').map(entry => ({ id: value(entry, 'Id'), uri: value(entry, 'Uri'), metadata: value(entry, 'Metadata') }));
      for (const entry of entries) {
        const metadata = entry.metadata;
        let item = {}; try { item = parseDidl(metadata)[0] ?? {}; } catch { /* Some players return empty metadata. */ }
        queue.push({ id: number(entry.id), title: item.title || 'Track', artist: item.artist || '', album: item.album || '', uri: entry.uri, metadata, duration: duration(item.resources?.[0]?.duration), artwork: item.artwork || '',
          ...(device === this.localPlayer && entry.libraryTrackId ? { libraryTrackId: entry.libraryTrackId } : {}) });
      }
    }
    // Recheck the sequence token after paged reads; never combine two queue revisions.
    const unchanged = await this.invoke(playlist, 'IdArrayChanged', { Token: number(array.Token) });
    if (bool(unchanged.Value)) throw fail('queueChanged', 'The player queue changed. Refresh it to see the latest tracks.');
    let position = 0; let total = queue.find(item => item.id === Number(id.Value))?.duration || 0;
    if (service(device, 'Time')) { const time = await this.invoke(service(device, 'Time'), 'Time'); position = Number(time.Seconds) || 0; total = Number(time.Duration) || total; }
    let volume = null; let volumeMax = null; let mute = null;
    if (service(device, 'Volume')) {
      const endpoint = service(device, 'Volume');
      const [current, limit, muted] = await Promise.all([this.invoke(endpoint, 'Volume'), this.invoke(endpoint, 'VolumeLimit'), this.invoke(endpoint, 'Mute').catch(() => null)]);
      volume = Number(current.Value); volumeMax = Number(limit.Value); mute = muted ? bool(muted.Value) : null;
    }
    const state = { playerId, transportState: transport.Value, position, duration: total, currentId: Number(id.Value), queue, repeat: bool(repeat.Value), shuffle: bool(shuffle.Value), protocolInfo: String(protocol.Value || ''), volume, volumeMax, mute, capabilities: { play: true, pause: true, stop: true, next: true, previous: true, seek: true, seekId: true, delete: true, clear: true, repeat: true, shuffle: true, volume: Boolean(service(device, 'Volume')), mute: mute !== null } };
    // A read begun before or during a command cannot revoke that command's new resources.
    if (!commandPending && !this.queues.has(playerId) && this.playerGenerations.get(playerId) === generation) this.pruneFiles(playerId, state);
    return state;
  }
  async playCatalogRows(playerId, rows, operationKind, options) {
    const play = operationKind === 'play';
    let startIndex = play ? options.currentOrdinal ?? 0 : 0;
    let permutation;
    let offset = 0;
    if (play && rows.length && Number.isSafeInteger(options.seed)) {
      permutation = new ReversibleShufflePermutation(rows.length, shuffleEpochSeed(options.seed));
      if (options.currentOrdinal != null) offset = permutation.invert(number(startIndex, rows.length - 1));
      startIndex = 0;
    }
    const items = rows.map((row, ordinal) => {
      const entry = permutation ? rows[permutation.permute((ordinal + offset) % rows.length)] : row;
      return { serverId: 'local', trackId: entry.trackUid };
    });
    await this.playerCommand({ playerId, action: play ? 'replace' : 'insert', items,
      position: operationKind === 'playNext' ? 'afterCurrent' : 'end', play, startIndex });
    return { kind: 'terminal', result: { state: 'succeeded', operationKind } };
  }
  playerCommand(request) {
    this.playerGenerations.set(request.playerId, (this.playerGenerations.get(request.playerId) ?? 0) + 1);
    const previous = this.queues.get(request.playerId) || Promise.resolve();
    const result = previous.catch(() => {}).then(async () => {
      try { return await this.executeCommand(request); }
      catch (error) {
        if (request.filePaths !== undefined || this.publishesQueueItems?.(request.items)) {
          try { this.pruneFiles(request.playerId, await this.getPlayerState({ playerId: request.playerId }, { fresh: true })); }
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
    const candidate = this.discovery?.devices.get(playerId);
    if (candidate?.available && !service(candidate, 'Playlist') && service(candidate, 'AVTransport')) return this.avPlayers.command(candidate, request);
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
    else if (action === 'volume' || action === 'mute') {
      const volume = service(device, 'Volume');
      if (!volume) throw fail('unsupported', 'This player does not support remote volume adjustment.');
      if (action === 'mute' && typeof setting !== 'boolean') throw fail('invalidRequest', 'Choose a valid mute setting.');
      await invoke(volume, action === 'mute' ? 'SetMute' : 'SetVolume', { Value: action === 'mute' ? setting ? 1 : 0 : number(setting, number((await this.invoke(volume, 'VolumeLimit')).Value, 1000)) });
    }
    else if (action === 'replace' || action === 'insert') {
      if (tracks !== undefined) {
        if (device !== this.localPlayer && request.gatewayResolved !== true) throw fail('invalidRequest', 'Choose a valid playback device.');
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
      const address = tracks === undefined ? await this.getRouteAddress?.(device.address) : null;
      const resolved = [];
      for (const item of items) {
        const track = tracks !== undefined ? item : filePaths === undefined
          ? await this.resolveTrack({ serverId: item.serverId, trackId: item.trackId, address, protocolInfo: state.protocolInfo, playerId })
          : await this.openedFile(item);
        const resource = (track.resources ?? []).find(resource => supportsProtocol(state.protocolInfo, resource.protocolInfo));
        if (!resource) throw fail('unsupportedFormat', 'The player does not support the audio format of one or more selected tracks.');
        resolved.push({ ...track, uri: resource.uri });
      }
      if (filePaths !== undefined) await this.publishOpenedFiles(resolved, action, playerId, address, device.address);
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
  async sharedTrack(row, address, source = null, parentId = this.viewContainer('tracks').id) {
    if (!row) throw fail('trackUnavailable', 'The selected track is unavailable.');
    const catalog = await this.getCatalog();
    const identity = source ?? await catalog.repository.getTrackStorageIdentity(row.trackUid);
    if (!identity || !this.sharing.folderIds.includes(identity.folderId)) throw fail('trackUnavailable', 'The selected track is unavailable.');
    const resource = this.mediaUrl(row.trackUid, address);
    const token = resource.token;
    const archived = identity.sourceKind === 'archive-entry';
    let resourceName = identity.path || identity.relativePath || '';
    if (archived) {
      const { getArchiveEntryPath } = await import('../../library/archive/score-entries.js');
      resourceName = identity.archiveEntryPath || getArchiveEntryPath(identity.relativePath, identity.entryKey) || '';
    }
    const mime = this.mimeType(resourceName);
    const size = archived ? identity.bytes?.byteLength ?? '' : identity.byteLength ?? identity.size ?? '';
    const playable = Boolean(mime) && identity.sourceKind !== 'cue-track' && identity.startFrame == null && identity.endFrame == null;
    const seconds = Number(row.durationSec) || 0;
    const durationText = `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    const canonicalId = `track:${token}`;
    const reference = parentId !== this.viewContainer('tracks').id || row.entryKey != null;
    const id = reference ? `${canonicalId}:${this.referenceSuffix(parentId, row.entryKey)}` : canonicalId;
    if (reference) this.trackReferences.set(id, { parentId, entryKey: row.entryKey });
    const links = {};
    for (const type of ['album', 'artist']) if (row[`${type}Key`]) {
      const key = row[`${type}Key`];
      const target = this.container({ kind: 'tracks', scope: { [`${type}Key`]: key }, entityType: type }, row[type], this.viewContainer(`${type}s`).id);
      this.containers.get(target.id).entityKey = key;
      links[`${type}ObjectId`] = target.id;
    }
    return { id, parentId, refId: reference ? canonicalId : '', ...links, title: row.title || 'Track', artist: row.artist || '', album: row.album || '', genre: row.genre || '', trackNo: row.trackNo, date: row.year ? String(row.year) : '', addedAt: row.addedAt, displayPath: row.displayPath ?? identity.relativePath ?? '', upnpClass: CLASSES.track, artwork: resource.artwork, uri: playable ? resource.uri : '', resources: playable ? [{ uri: resource.uri, protocolInfo: `http-get:*:${mime}:*`, size, duration: durationText }] : [], isContainer: false, playable };
  }
  container(data, title, parentId = '0', metadata = {}) {
    const key = JSON.stringify(data); let id = this.containerKeys.get(key);
    if (!id) { id = `container:${this.containerToken()}`; this.containerKeys.set(key, id); this.containers.set(id, { ...data, title, parentId }); }
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
    if (row.representativeTrackUid) item.artwork = this.mediaUrl(row.representativeTrackUid, address).artwork;
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
      const uid = this.trackUidForToken(objectId.split(':')[1]);
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
};

export { withUpnpCore, supportsProtocol, MAX_QUEUE, RETRYABLE_CONNECTION_ERRORS, fail };
