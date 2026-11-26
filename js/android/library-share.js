import { ANDROID_MESSAGE_LIMIT, bytesToBase64 } from './bridge.js';
import { sha256Hex } from '../library/repository/sha256.js';
import { MAX_QUEUE, fail } from '../network-music/upnp/host-core.js';
import { SEARCH_CAPS, SORT_CAPS, parseSearch, parseSort } from '../network-music/upnp/content.js';
import { CONTENT, descendants, didl, didlItem, parseXml, value, xml } from '../network-music/upnp/protocol.js';

const TYPES = { '.mid': 'audio/midi', '.midi': 'audio/midi', '.kar': 'audio/midi', '.dsf': 'audio/x-dsf', '.dff': 'audio/x-dff',
  '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'audio/webm' };
const ACTIONS = new Set(['Browse', 'Search', 'X_EffeTune_Search', 'GetSearchCapabilities', 'GetSortCapabilities', 'GetSystemUpdateID']);
const OPERATIONS = new Set(['play', 'playNext', 'queue']);
// Leaves room for the bridge envelope around a SOAP response body.
const RESPONSE_LIMIT = ANDROID_MESSAGE_LIMIT - 4096;
const RESOURCE_PART_BYTES = 512 * 1024;
const encoder = new TextEncoder();
const mimeOf = name => TYPES[/\.[^./]*$/.exec(String(name ?? ''))?.[0].toLowerCase()];
const base64Url = bytes => bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = length => base64Url(crypto.getRandomValues(new Uint8Array(length)));
const isContentUri = uri => typeof uri === 'string' && uri.startsWith('content://');
const isSubsonicItem = item => typeof item?.serverId === 'string' && item.serverId.startsWith('subsonic:');
const toBytes = data => ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
const soapBody = (name, result) => `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${name}Response xmlns:u="${CONTENT}">${Object.entries(result).map(([key, val]) => `<${key}>${xml(val)}</${key}>`).join('')}</u:${name}Response></s:Body></s:Envelope>`;
const faultBody = code => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>Request could not be completed</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`;
const trackUnavailable = () => fail('trackUnavailable', 'The selected track is unavailable.');
const selectionChanged = () => fail('selectionChanged', 'The library selection changed. Select the tracks again.');

// Page side of Android library sharing. LibraryShareServer owns HTTP, SSDP and GENA and asks the page for
// ContentDirectory results and media sources; the shared UPnP core supplies the catalog-to-DIDL mapping.
export const withLibraryShare = Base => class extends Base {
  sharing = { enabled: false, folderIds: [] };
  shareTokens = new Map();
  trackTokens = new Map();
  fileSources = new Map();
  fileServer = { start: async () => {}, resource: (token, _address, target, track, playerId) =>
    this.publishFile(token, target, track, playerId) };

  loadShareStatus(refresh = false) {
    if (!refresh && this.shareStatusLoaded) return;
    this.shareStatusLoaded = false;
    this.shareStatus ??= this.bridge.request('share.status').then(status => this.applyShareStatus(status))
      .finally(() => { this.shareStatus = null; });
    return this.shareStatus;
  }

  applyShareStatus(status) {
    const { enabled, folderIds, id = null, baseUrl = null } = status;
    if (typeof enabled !== 'boolean' || !Array.isArray(folderIds)) throw new Error('Invalid library sharing state');
    this.shareStatusLoaded = true;
    if (enabled !== this.sharing.enabled || folderIds.length !== this.sharing.folderIds.length ||
        folderIds.some((id, index) => id !== this.sharing.folderIds[index])) {
      this.sharing = { enabled, folderIds: [...folderIds] };
    }
    this.shareId = id;
    this.shareBaseUrl = baseUrl;
    this.shareUpdateId = status.updateId;
    this.hasPublishedFiles = status.hasFiles === true;
    void this.watchCatalog().catch(error => this.onDiagnostic(error));
  }

  // Catalog changes raise SystemUpdateID only while sharing; no subscription is held otherwise.
  async watchCatalog() {
    const catalog = this.sharing.enabled && !this.closed ? await this.getCatalog() : null;
    const repository = this.sharing.enabled && !this.closed ? catalog?.repository ?? null : null;
    if (repository === this.watchedRepository) return;
    this.unwatchCatalog?.();
    this.watchedRepository = repository;
    this.unwatchCatalog = repository?.subscribeInvalidations(() => {
      void this.bridge.request('share.notify').then(({ updateId }) => { this.shareUpdateId = updateId; })
        .catch(error => this.onDiagnostic(error));
    }) ?? null;
  }

  disposeLibraryShare() {
    this.unwatchCatalog?.();
    this.unwatchCatalog = null;
    this.watchedRepository = null;
  }

  async getCatalog() {
    const manager = await this.windowRef?.uiManager?.ensureLibraryManager?.({ silent: true });
    return manager?.client ? { repository: manager.client } : null;
  }

  mediaUrl(uid, address = this.shareBaseUrl) {
    let token = this.trackTokens.get(uid);
    if (!token) {
      token = randomToken(24);
      this.trackTokens.set(uid, token);
      this.shareTokens.set(token, uid);
    }
    return { uri: `${address}/media/${token}`, artwork: `${address}/artwork/${token}`, token };
  }

  trackUidForToken(token) { return this.shareTokens.get(token); }
  mimeType(name) { return mimeOf(name); }
  containerToken() { return randomToken(18); }
  fileToken() { return randomToken(24); }

  referenceSuffix(parentId, entryKey) {
    const hex = sha256Hex(encoder.encode(`${parentId}\0${entryKey ?? ''}`));
    return base64Url(Uint8Array.from(hex.match(/../g), byte => parseInt(byte, 16))).slice(0, 18);
  }

  // The native server listens on the local address that routes to the player and returns its base URL.
  async getRouteAddress(host) { return (await this.bridge.request('share.route', { host })).baseUrl; }

  async sharedTrack(row, address, source = null, parentId, playerId) {
    const identity = source ?? (row ? await (await this.getCatalog())?.repository.getTrackStorageIdentity(row.trackUid) : null);
    const track = await super.sharedTrack(row, address, identity, parentId);
    // Only Storage Access Framework documents can be opened by the native server.
    if (identity.sourceKind === 'archive-entry') return track;
    if (isContentUri(identity.fileIdentity)) {
      // resolveTrack supplies a source. Browse leaves registration until the first media request.
      if (source && track.playable) await this.publishSharedSource(this.trackTokens.get(row.trackUid), source, playerId);
      return track;
    }
    return { ...track, uri: '', resources: [], playable: false };
  }

  async publishSharedSource(token, source, playerId, bridge = this.bridge) {
    await bridge.request('share.publish', { token, uri: source.fileIdentity, mime: mimeOf(source.relativePath),
      size: source.size ?? -1, updateId: source.updateId, ...(playerId && { playerId }) });
    if (playerId) this.hasPublishedFiles = true;
  }

  async sharedSource(uid, kind = 'media') {
    const updateId = this.shareUpdateId;
    if (!this.sharing.enabled) throw fail('sharingRequired', 'Enable library sharing in Settings > Config... > Network, select the music folder, and save before playing library tracks on another device.');
    const catalog = await this.getCatalog();
    if (!catalog) throw fail('catalogUnavailable', 'The local music library is unavailable. Open the library and try again.');
    const source = await catalog.repository.getTrackStorageIdentity(uid);
    if (!source) throw trackUnavailable();
    if (!this.sharing.folderIds.includes(source.folderId)) throw fail('folderNotShared', 'Select this track’s folder in Settings > Config... > Network and save before playing it on another device.');
    if (source.sourceKind === 'cue-track' || source.startFrame != null || source.endFrame != null) throw fail('cueUnsupported', 'CUE tracks cannot be shared in this version. Choose a separate audio file.');
    if (source.sourceKind === 'archive-entry' && kind !== 'artwork') {
      const { getArchiveEntryPath } = await import('../library/archive/score-entries.js');
      const archiveEntryPath = getArchiveEntryPath(source.relativePath, source.entryKey);
      if (!archiveEntryPath || mimeOf(archiveEntryPath) !== 'audio/midi') throw fail('unsupportedFormat', 'This score format cannot be shared with a network player.');
      const entry = await catalog.repository.resolveSequenceEntrySource({ trackUid: uid });
      if (!entry?.file) throw trackUnavailable();
      return { ...source, archiveEntryPath, bytes: new Uint8Array(await entry.file.arrayBuffer()) };
    }
    return { ...source, updateId };
  }

  async answerShare({ requestId, service, action, body, baseUrl, updateId } = {}) {
    const soap = service === 'ContentDirectory';
    let reply;
    try {
      reply = soap ? { body: await this.contentDirectory(body, baseUrl, updateId) }
        : action === 'artwork' ? await this.artworkResource(body) : await this.mediaResource(body);
    } catch (error) {
      this.onDiagnostic(error);
      reply = { failed: true, ...(soap ? { body: faultBody(/^\d{3}$/.test(error.message) ? error.message : '701') } : {}) };
    }
    try {
      if (reply.bytes) {
        const { bytes, mime } = reply;
        const { offset, end } = await this.bridge.request('share.respond', { requestId, size: bytes.length, mime });
        for (let start = offset; start < end; start += RESOURCE_PART_BYTES) {
          const data = bytesToBase64(bytes.subarray(start, Math.min(start + RESOURCE_PART_BYTES, end)));
          const part = await this.bridge.request('share.respondPart', { requestId, offset: start, data });
          if (!part.accepted) break;
        }
      } else await this.bridge.request('share.respond', { requestId, ...reply });
    } catch (error) {
      this.onDiagnostic(error);
      if (!reply.failed) await this.bridge.request('share.respond', { requestId, failed: true }).catch(failure => this.onDiagnostic(failure));
    }
  }

  async contentDirectory(body, address, updateId) {
    const action = descendants(parseXml(body), 'Body')[0]?.children[0];
    if (!action || !ACTIONS.has(action.name)) throw new Error('401');
    if (action.name === 'GetSearchCapabilities') return soapBody(action.name, { SearchCaps: SEARCH_CAPS.join(',') });
    if (action.name === 'GetSortCapabilities') return soapBody(action.name, { SortCaps: SORT_CAPS.join(',') });
    if (action.name === 'GetSystemUpdateID') return soapBody(action.name, { Id: updateId });
    const isCatalogSearch = action.name === 'X_EffeTune_Search';
    const isSearch = action.name === 'Search' || isCatalogSearch;
    if (!isSearch && !['BrowseMetadata', 'BrowseDirectChildren'].includes(value(action, 'BrowseFlag'))) throw new Error('402');
    const sort = parseSort(value(action, 'SortCriteria'));
    const search = isSearch && !isCatalogSearch ? parseSearch(value(action, 'SearchCriteria')) : null;
    const catalogQuery = isCatalogSearch ? value(action, 'Query') : null;
    const start = Number(value(action, 'StartingIndex')); const count = Number(value(action, 'RequestedCount'));
    if (!Number.isSafeInteger(start) || start < 0 || start > 0xffffffff || !Number.isSafeInteger(count) || count < 0 || count > 0xffffffff) throw new Error('402');
    const objectId = value(action, isSearch ? 'ContainerID' : 'ObjectID');
    const page = await this.browseShared({ objectId, metadata: !isSearch && value(action, 'BrowseFlag') === 'BrowseMetadata', start, count: Math.min(count || 500, 500), sort, search, catalogQuery, address });
    // Return fewer items when a page would exceed the bridge message limit; clients continue from NumberReturned.
    for (let items = page.items; ; items = items.slice(0, Math.ceil(items.length / 2))) {
      const text = soapBody(action.name, { Result: didl(items.map(item => didlItem(item, item.parentId ?? objectId))), NumberReturned: items.length, TotalMatches: page.total, UpdateID: updateId });
      if (items.length <= 1 || encoder.encode(JSON.stringify(text)).length <= RESPONSE_LIMIT) return text;
    }
  }

  async mediaResource(token) {
    const uid = this.shareTokens.get(token);
    if (!uid) throw trackUnavailable();
    const source = await this.sharedSource(uid);
    if (source.bytes) return { bytes: source.bytes, mime: 'audio/midi' };
    const mime = mimeOf(source.relativePath);
    if (!mime || !isContentUri(source.fileIdentity)) throw fail('unsupportedFormat', 'This track has no supported audio source. CUE tracks cannot be shared in this version.');
    return { uri: source.fileIdentity, mime, size: source.size ?? -1 };
  }

  async artworkResource(token) {
    const uid = this.shareTokens.get(token);
    if (!uid) throw trackUnavailable();
    await this.sharedSource(uid, 'artwork');
    const artwork = await (await this.getCatalog()).repository.requestArtwork({ trackUid: uid, reason: 'detail' });
    if (!artwork?.bytes) throw trackUnavailable();
    return { bytes: toBytes(artwork.bytes), mime: artwork.mimeType || 'image/jpeg' };
  }

  setSharing(request) {
    const result = this.configuring.catch(() => {}).then(async () => {
      if (typeof request?.enabled !== 'boolean' || !Array.isArray(request.folderIds) || request.folderIds.length > 1024) throw fail('invalidSharing', 'Select the music folders to share.');
      if (request.enabled) {
        const folders = await this.sharingFolders();
        if (request.folderIds.some(id => !folders.some(folder => folder.id === id))) throw fail('invalidSharing', 'A selected music folder is no longer available.');
        await this.networkAccess(true);
      }
      this.shareTokens.clear(); this.trackTokens.clear(); this.containers.clear(); this.containerKeys.clear(); this.trackReferences.clear();
      const folderIds = [...new Set(request.folderIds)];
      this.applyShareStatus(await this.bridge.request(request.enabled ? 'share.start' : 'share.stop', { folderIds }));
      this.emitState();
      return this.networkMusicGetState({ loadSharingFolders: true });
    });
    this.configuring = result;
    return result;
  }

  async sharingFolders() {
    const catalog = await this.getCatalog();
    if (!catalog) throw fail('catalogUnavailable', 'The music folders could not be loaded. Reopen Settings and try again.');
    const folders = [];
    let page = null;
    try {
      do {
        page = await catalog.repository.queryEntities({ type: 'folder', limit: 500, ...(page ? { contextToken: page.contextToken, cursor: page.nextCursor } : {}) });
        folders.push(...page.rows.map(folder => ({ id: folder.id, name: folder.displayName || 'Music folder' })));
      } while (page.nextCursor);
    } finally {
      if (page?.contextToken) await catalog.repository.releaseContext(page.contextToken).catch(error => this.onDiagnostic(error));
    }
    return folders;
  }

  async sharingState({ loadSharingFolders = false } = {}) {
    const state = { ...this.sharing, folderIds: [...this.sharing.folderIds], folders: [] };
    if (loadSharingFolders) {
      try { state.folders = await this.sharingFolders(); }
      catch (error) { this.onDiagnostic(error); state.foldersUnavailable = true; }
    }
    return state;
  }

  async openedFile(uri) {
    if (!isContentUri(uri)) throw fail('fileAccessRequired', 'Open the music file again to allow playback on the selected device.');
    let stat;
    try { stat = await this.bridge.request('documents.stat', { uri }); }
    catch { throw fail('trackUnavailable', 'This music file is no longer available. Open it again.'); }
    const mime = mimeOf(stat?.name);
    if (!mime) throw fail('unsupportedFormat', 'This file type cannot be played on another device. Choose a supported audio file.');
    return { path: uri, title: stat.name.replace(/\.[^.]*$/, ''), resources: [{ uri: '', protocolInfo: `http-get:*:${mime}:*`, size: stat.size ?? '' }] };
  }

  async publishFile(token, target, track, playerId) {
    const resource = track.resources[0];
    return this.publishPlayerResource(token, { uri: track.path, target, playerId,
      mime: resource.protocolInfo.split(':')[2], size: resource.size === '' ? -1 : resource.size });
  }

  async publishPlayerResource(token, payload) {
    const result = await this.bridge.request('share.publish', { token, ...payload });
    this.hasPublishedFiles = true;
    // A registration retained by the service can predate this page or this command.
    this.fileSources.set(result.token || token, { playerId: payload.playerId, serverId: payload.serverId });
    return result;
  }

  async publishOpenedFiles(resolved, action, playerId, address, playerAddress) {
    for (const track of resolved) {
      const uid = this.fileToken();
      const { uri } = await this.publishFile(uid, playerAddress, track, playerId);
      track.uri = uri; track.id = uid;
      track.resources[0].uri = uri;
      track.metadata = didl([didlItem(track)]);
    }
  }

  publishesQueueItems(items) {
    return Array.isArray(items) && items.some(item => item?.serverId === 'local' || isSubsonicItem(item));
  }

  async executeCommand(request) {
    if (this.publishesQueueItems(request.items)) {
      const player = this.discovery.devices.get(request.playerId);
      const items = request.items.map(item => isSubsonicItem(item)
        ? { ...item, trackId: { id: item.trackId, player } } : { ...item, playerId: request.playerId });
      const command = { ...request, items };
      try { return await super.executeCommand(command); }
      finally { if (command.mutationStarted) request.mutationStarted = true; }
    }
    const result = await super.executeCommand(request);
    if (request.action === 'clear' && request.playerId !== 'local') this.pruneFiles(request.playerId, { queue: [] });
    return result;
  }

  pruneFiles(playerId, state) {
    if (!this.hasPublishedFiles) return;
    const keep = new Set(state.queue.map(track => /\/media\/([\w-]{32})$/.exec(track.uri)?.[1]).filter(Boolean));
    for (const [id, file] of this.fileSources) if (file.playerId === playerId && !keep.has(id)) this.fileSources.delete(id);
    void this.bridge.request('share.revoke', { playerId, keep: [...keep] }).then(({ hasFiles }) => {
      this.hasPublishedFiles = hasFiles;
    }).catch(error => this.onDiagnostic(error));
  }

  playFiles({ playerId, filePaths, operationKind = 'play' } = {}) {
    if (!OPERATIONS.has(operationKind)) throw fail('unsupported', 'Choose a playback operation.');
    return this.playerCommand({ playerId, filePaths, action: operationKind === 'play' ? 'replace' : 'insert', position: operationKind === 'playNext' ? 'afterCurrent' : 'end', play: operationKind === 'play' });
  }

  async playSelection({ playerId, selectionDescriptor, operationKind, options = {} }) {
    if (!OPERATIONS.has(operationKind)) throw fail('unsupported', 'Choose a playback operation.');
    const { validateSelectionDescriptor } = await import('../library/repository/selection-descriptor.js');
    const descriptor = validateSelectionDescriptor(selectionDescriptor);
    const catalog = await this.getCatalog();
    if (!catalog) throw fail('catalogUnavailable', 'The local music library is unavailable. Open the library and try again.');
    const { contextToken } = descriptor;
    const { totalCount } = await catalog.repository.getContextCount({ contextToken });
    if (!Number.isSafeInteger(totalCount)) throw selectionChanged();
    const rows = []; let inRange = false; let rangeDone = false; let endpoints = 0;
    const selected = new Set(descriptor.trackUids || []); const excluded = new Set(descriptor.exclusions || []); const included = new Set(descriptor.inclusions || []);
    const remaining = new Set(selected);
    for (let ordinal = 0; ordinal < totalCount && !(descriptor.mode === 'explicit' && remaining.size === 0);) {
      const page = await catalog.repository.readContextPageAtOrdinal({ contextToken, ordinal, limit: 500 });
      const batch = page.rows.slice(ordinal - page.pageStartOrdinal);
      if (!batch.length) break;
      ordinal += batch.length;
      for (const row of batch) {
        const identity = row.playlistItemKey ?? row.trackUid;
        let accept = descriptor.mode === 'all';
        if (descriptor.mode === 'explicit') accept = remaining.delete(identity);
        if (descriptor.mode === 'range') {
          const endpoint = identity === descriptor.startUid || identity === descriptor.endUid;
          if (endpoint) { endpoints++; if (!inRange && !rangeDone) inRange = true; else rangeDone = true; }
          accept = (inRange && !rangeDone) || endpoint || included.has(identity);
          if (endpoint && descriptor.startUid === descriptor.endUid) rangeDone = true;
        }
        if (accept && !excluded.has(identity)) {
          rows.push({ identity, trackUid: row.trackUid });
          if (rows.length > MAX_QUEUE) throw fail('queueTooLarge', 'Choose at most 4096 tracks for this player.');
        }
      }
    }
    if (descriptor.mode === 'explicit') {
      const ordered = new Map(rows.map(row => [row.identity, row]));
      if (ordered.size !== selected.size) throw selectionChanged();
      rows.splice(0, rows.length, ...descriptor.trackUids.map(id => ordered.get(id)));
    }
    if (descriptor.mode === 'range' && endpoints < (descriptor.startUid === descriptor.endUid ? 1 : 2)) throw selectionChanged();
    return this.playCatalogRows(playerId, rows, operationKind, options);
  }
};
