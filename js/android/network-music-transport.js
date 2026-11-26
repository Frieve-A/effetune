import { base64ToBytes, getAndroidBridge, isAndroidHost } from './bridge.js';
import { selectAndroidPlayerResource, startAndroidPwaHost } from './pwa-host.js';
import { createAndroidRemoteClient } from './remote-effects-client.js';
import { AndroidSubsonicTransport } from './subsonic.js';
import { withLibraryShare } from './library-share.js';
import { ensureAndroidNetworkAccess } from './network.js';
import { loadWebAppConfig, saveWebAppConfig } from '../electron/webSettingsStorage.js';
import { networkMusicError } from '../network-music/pwa-connection.js';
import { playPwaNetworkItems } from '../network-music/pwa-playback-provider.js';
import { PwaSubsonicSource } from '../network-music/subsonic-source.js';
import { AvTransportPlayers } from '../network-music/upnp/av-player.js';
import { MAX_QUEUE, supportsProtocol, withUpnpCore } from '../network-music/upnp/host-core.js';
import { descendants, didl, didlItem, isLanAddress, networkUrl, parseSoapFault, parseSoapResponse, parseXml, readDescription, service, soapEnvelope, value } from '../network-music/upnp/protocol.js';

const DEVICE_LIMIT = 256;
const OPERATIONS = new Set(['play', 'playNext', 'queue']);
const upnpCore = withLibraryShare(withUpnpCore());

class AndroidSubsonicSource extends PwaSubsonicSource {
  get descriptor() { return { ...super.descriptor, externalPlayback: true }; }

  async browse(request = {}) {
    if (request.objectId !== '0' || request.query) return super.browse(request);
    const { start = 0, count = 100 } = request;
    const views = this.descriptor.browseViews.map(({ id }) => ({ id, viewId: id, serverId: this.id,
      parentId: '0', title: id[0].toUpperCase() + id.slice(1), isContainer: true, playable: false }));
    const items = views.slice(start, start + count);
    return { items, start, total: views.length, numberReturned: items.length };
  }

  track(song) {
    const track = super.track(song);
    track.requiresGateway = false;
    track.coverArtId = song.coverArt ? String(song.coverArt) : '';
    if (song.transcodedContentType && song.transcodedSuffix) {
      track.transcodedContentType = song.transcodedContentType;
      track.transcodedResource = { protocolInfo: `http-get:*:${song.transcodedContentType}:*`, format: song.transcodedSuffix };
    }
    return track;
  }
}

class AndroidAvTransportPlayers extends AvTransportPlayers {
  async read(device) {
    const host = this.host;
    const generation = host.playerGenerations.get(device.id);
    const pending = host.queues.has(device.id);
    const state = await super.read(device);
    // Another controller can replace an AV queue between commands, including during a poll.
    if (state.queueOwner === 'device' && !pending && !host.queues.has(device.id) &&
        generation === host.playerGenerations.get(device.id)) host.pruneFiles(device.id, state);
    return state;
  }
}

export class AndroidNetworkMusicTransport extends upnpCore {
  constructor({ bridge = getAndroidBridge(), windowRef = globalThis.window,
    loadConfig = loadWebAppConfig, saveConfig = saveWebAppConfig,
    ensureNetworkAccess = ensureAndroidNetworkAccess } = {}) {
    super({ decodeBase64: base64ToBytes, supportsProtocol, startPollingInterval: (callback, ms) => setInterval(callback, ms) });
    Object.assign(this, { bridge, windowRef, loadConfig, saveConfig, ensureNetworkAccess });
    this.discovery = { devices: new Map() };
    this.descriptions = new Map();
    this.avPlayers = new AndroidAvTransportPlayers(this);
    this.remoteControls = new Map();
    this.pwaPlayerRequests = new Map();
    this.remoteClient = createAndroidRemoteClient({ bridge, getOrigin: id => this.remoteOrigin(id) });
    this.sources = new Map();
    this.pwa = isAndroidHost(windowRef) ? new AndroidSubsonicTransport({ windowRef, fetchImpl: globalThis.fetch.bind(globalThis) }) : null;
    this.listeners = new Set();
    this.manualDevices = [];
    this.gatewayPermissions = { libraries: false, players: false };
    this.configuring = Promise.resolve();
    this.registrations = new Map();
    if (this.pwa) {
      this.detachHost = startAndroidPwaHost(this);
      void this.loadSettings().catch(error => this.onDiagnostic(error));
    }
    this.detachDevices = bridge.on('upnp-device', packet => {
      void this.receiveDevice(packet).catch(error => this.onDiagnostic(error));
    });
    this.detachPlayback = bridge.on('snapshot', snapshot => this.observeQueue(snapshot));
    this.detachShare = bridge.on('share-request', request => void this.answerShare(request));
    this.onVisibilityChange = () => {
      if (windowRef.document.hidden) this.stopPageSearch();
      else void this.networkMusicDiscover(false).catch(error => this.onDiagnostic(error));
    };
    windowRef?.document?.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  loadSettings() {
    this.settings ??= this.loadConfig().then(async config => {
      this.manualDevices = Array.isArray(config.networkMusicManualDevices) ? config.networkMusicManualDevices : [];
      this.gatewayPermissions = { libraries: config.networkMusicGateway?.libraries === true,
        players: config.networkMusicGateway?.players === true };
      if (this.detachHost && !this.closed) await this.bridge.request('pwa.setPermissions', this.gatewayPermissions);
    }).catch(error => {
      this.settings = null;
      throw error;
    });
    return this.settings;
  }

  networkAccess(request = false) {
    return this.ensureNetworkAccess({ request, windowRef: this.windowRef });
  }

  remoteOrigin(playerId) {
    const device = this.discovery.devices.get(playerId);
    const endpoint = this.remoteControls.get(playerId);
    if (!device?.available || !service(device, 'Playlist') || !endpoint ||
        endpoint.address !== device.address || endpoint.expires <= Date.now()) return undefined;
    return endpoint.origin;
  }

  async loadSources() {
    if (!this.pwa) return;
    this.sourceList ??= this.pwa.command('list').then(({ sources }) => {
      if (this.closed) return;
      for (const entry of sources) this.sources.set(entry.id, new AndroidSubsonicSource({ ...entry, android: this.pwa }));
    }).catch(error => {
      this.sourceList = null;
      throw error;
    });
    await this.sourceList;
  }

  revokeGatewaySources() {
    if (this.detachHost && this.gatewayPermissions.libraries) {
      void this.bridge.request('pwa.setPermissions', { ...this.gatewayPermissions, sourcesChanged: true }).catch(error => this.onDiagnostic(error));
    }
  }

  async readDevice(location, description, isCurrent) {
    const { address, id } = description;
    const result = await this.bridge.request('upnp.http', { url: location, ...(address ? { address } : {}) });
    if (result.status !== 200 || !isLanAddress(result.connectionAddress) || address && result.connectionAddress !== address) {
      throw networkMusicError('unreachable');
    }
    const document = parseXml(result.text);
    const rootId = id || value(descendants(document, 'device')[0], 'UDN');
    const entries = [...readDescription(document, { location, id: rootId, address: result.connectionAddress, expires: description.expires })];
    if (this.closed || !isCurrent()) return [];
    for (const { remoteControl } of entries) {
      if (remoteControl && (this.remoteControls.has(remoteControl.playerId) || this.remoteControls.size < DEVICE_LIMIT)) {
        this.remoteControls.set(remoteControl.playerId, remoteControl);
      }
    }
    const devices = entries.flatMap(({ device }) => device ? [device] : []);
    for (const device of devices) {
      const previous = this.discovery.devices.get(device.id);
      if (address && previous?.available && !previous.announcementId) continue;
      if (previous?.available && (previous.address !== device.address || previous.location !== device.location)) this.revokeGatewaySources();
      if (!previous && this.discovery.devices.size >= DEVICE_LIMIT) {
        const expired = [...this.discovery.devices.values()].find(entry => !entry.available);
        if (!expired) break;
        this.discovery.devices.delete(expired.id);
      }
      for (const endpoint of device.services.values()) {
        endpoint.deviceId = device.id;
        if (address) endpoint.address = address;
      }
      const current = previous?.available && previous.location === location && previous.address === device.address
        ? Object.assign(previous, device) : device;
      current.announcementId = address ? id : null;
      this.discovery.devices.set(device.id, current);
    }
    this.emitState();
    void this.probeLibraries();
    return devices;
  }

  async receiveDevice({ usn, location, address, nts, nt, maxAge }) {
    const id = usn?.split('::', 1)[0];
    if (this.closed || !id || !isLanAddress(address)) return;
    if (nts === 'ssdp:byebye') {
      const root = nt === 'upnp:rootdevice';
      for (const [key, entry] of this.descriptions) {
        if (entry.address === address && entry.id === id) this.descriptions.delete(key);
      }
      let changed = false;
      for (const [playerId, endpoint] of this.remoteControls) {
        if (endpoint.id === id && endpoint.address === address) {
          this.remoteControls.delete(playerId);
          changed = true;
        }
      }
      for (const device of this.discovery.devices.values()) {
        if (device.address !== address || !device.announcementId ||
            !(device.id === id || root && device.announcementId === id)) continue;
        if (device.available && service(device, 'ContentDirectory')) this.revokeGatewaySources();
        device.available = false;
        this.avPlayers.owners.delete(device.id);
        changed = true;
      }
      if (changed) this.emitState();
      return;
    }
    if (!location || (nts && nts !== 'ssdp:alive' && nts !== 'ssdp:update')) return;
    location = networkUrl(location).href;
    const expires = Date.now() + 1000 * Math.min(1800, maxAge > 0 ? maxAge : 180);
    const key = `${address}\n${location}`;
    const known = this.descriptions.get(key);
    if (known) {
      known.expires = expires;
      for (const endpoint of this.remoteControls.values()) {
        if (endpoint.id === id && endpoint.location === location && endpoint.address === address) endpoint.expires = expires;
      }
      let changed = false;
      for (const device of this.discovery.devices.values()) {
        if (device.location !== location || device.address !== address || !device.announcementId) continue;
        device.expires = expires;
        if (!device.available && (device.id === id || device.announcementId === id)) {
          device.available = true;
          changed = true;
        }
      }
      if (changed) this.emitState();
      void this.probeLibraries();
      return;
    }
    if (this.descriptions.size >= DEVICE_LIMIT) return;
    const entry = { id, address, expires, location };
    this.descriptions.set(key, entry);
    try {
      await this.readDevice(location, entry, () => this.descriptions.get(key) === entry);
    } catch (error) {
      if (this.descriptions.get(key) === entry) this.descriptions.delete(key);
      throw error;
    }
  }

  expireDevices() {
    const now = Date.now();
    for (const [key, entry] of this.descriptions) if (entry.expires <= now) this.descriptions.delete(key);
    let changed = false;
    for (const [playerId, endpoint] of this.remoteControls) {
      if (endpoint.expires <= now) { this.remoteControls.delete(playerId); changed = true; }
    }
    for (const device of this.discovery.devices.values()) {
      if (!device.available || !device.announcementId || device.expires > now) continue;
      if (service(device, 'ContentDirectory')) this.revokeGatewaySources();
      device.available = false;
      this.avPlayers.owners.delete(device.id);
      changed = true;
    }
    if (changed) this.emitState();
  }

  async invoke(endpoint, action, args, isCurrent) {
    const body = soapEnvelope(endpoint, action, args);
    if (this.closed || isCurrent?.() === false) throw networkMusicError('unauthorized');
    const pwaRequest = this.pwaPlayerRequests.get(endpoint.deviceId);
    const mutating = isCurrent || (/:(?:AVTransport|RenderingControl):/.test(endpoint.type) && !action.startsWith('Get'));
    const { status, text } = await this.bridge.request('upnp.http', {
      ...(pwaRequest && mutating ? { _pwaRequestId: pwaRequest } : {}),
      method: 'POST', url: endpoint.control, ...(endpoint.address ? { address: endpoint.address } : {}),
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${endpoint.type}#${action}"` }, body
    });
    if (status < 200 || status >= 300) {
      const error = networkMusicError('unavailable');
      try { Object.assign(error, parseSoapFault(text)); } catch { /* Some devices return an HTTP error without SOAP. */ }
      throw error;
    }
    return parseSoapResponse(text, action);
  }

  async executeCommand(request) {
    if (!request.pwaRequestId) return super.executeCommand(request);
    // The shared controller serializes commands for each player.
    this.pwaPlayerRequests.set(request.playerId, request.pwaRequestId);
    try { return await super.executeCommand(request); }
    finally { this.pwaPlayerRequests.delete(request.playerId); }
  }

  async networkMusicGetState(options = {}) {
    await this.loadSettings();
    await this.loadShareStatus(options.loadSharingFolders === true);
    await this.loadSources().catch(error => this.onDiagnostic(error));
    const sources = [...this.sources.values()].map(source => ({ ...source.descriptor, url: source.endpoint, user: source.user }));
    const libraries = [...this.sources.values()].map(source => source.descriptor);
    const devices = [...this.discovery.devices.values()];
    return { queueTracksMax: MAX_QUEUE, gatewayPermissions: { ...this.gatewayPermissions }, sources, sharing: await this.sharingState(options),
      libraries: libraries.concat(devices.filter(device => device.id !== this.shareId && service(device, 'ContentDirectory')).map(device => ({
        id: device.id, name: device.name, available: device.available, searchSupported: device.searchSupported === true,
        catalogSearch: device.catalogSearch === true, searchCaps: device.searchCaps ?? [], sortCaps: device.sortCaps ?? [],
        browseViews: device.browseViews ?? []
      }))),
      players: devices.filter(device => service(device, 'Playlist') || service(device, 'AVTransport')).map(device => ({
        id: device.id, name: device.name, available: device.available, isEffeTune: device.manufacturer === 'EffeTune',
        capabilities: { effects: Boolean(this.remoteOrigin(device.id)) }
      })),
      manualDevices: this.manualDevices.map(entry => ({ ...entry, available: devices.some(device => device.location === entry.url && device.available) }))
    };
  }

  onNetworkMusicState(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitState() {
    if (this.closed || !this.listeners.size) return;
    if (this.statePending) { this.stateQueued = true; return; }
    this.statePending = true;
    void this.networkMusicGetState().then(state => {
      if (!this.closed) for (const listener of this.listeners) listener(state);
    }).catch(error => this.onDiagnostic(error)).finally(() => {
      this.statePending = false;
      if (this.stateQueued) { this.stateQueued = false; this.emitState(); }
    });
  }

  stopPageSearch() {
    if (!this.searching) return;
    this.searching = false;
    void this.bridge.request('upnp.search', { enabled: false }).catch(error => this.onDiagnostic(error));
  }

  async networkMusicDiscover(requestPermission = true) {
    await this.loadSettings();
    try {
      await this.networkAccess(requestPermission);
      if (this.closed || this.windowRef?.document?.hidden) return this.networkMusicGetState();
      this.descriptions.clear();
      this.searching = true;
      const search = this.bridge.request('upnp.search', {}).then(() => {
        if (!this.closed) this.expiryTimer ??= setInterval(() => this.expireDevices(), 30000);
      }).catch(error => this.onDiagnostic(error));
      await Promise.all([search, ...this.manualDevices.map(entry => this.refreshManualDevice(entry))]);
    } catch (error) {
      if (requestPermission || error.code !== 'permission-required') this.onDiagnostic(error);
    }
    return this.networkMusicGetState();
  }

  async refreshManualDevice(entry) {
    try {
      const devices = await this.readDevice(entry.url, {}, () => this.manualDevices.includes(entry));
      if (!devices.length) throw networkMusicError('unreachable');
    } catch (error) {
      if (this.manualDevices.includes(entry)) this.invalidateManualDevice(entry.url);
      this.onDiagnostic(error);
    }
  }

  invalidateManualDevice(url) {
    for (const [id, endpoint] of this.remoteControls) {
      if (endpoint.location === url && endpoint.expires === undefined) this.remoteControls.delete(id);
    }
    for (const [key, entry] of this.descriptions) if (entry.location === url) this.descriptions.delete(key);
    for (const device of this.discovery.devices.values()) {
      if (device.location !== url || device.announcementId) continue;
      if (device.available && service(device, 'ContentDirectory')) this.revokeGatewaySources();
      device.available = false;
      this.avPlayers.owners.delete(device.id);
    }
    this.emitState();
  }

  networkMusicConfigure(request = {}) {
    const result = this.configuring.catch(() => {}).then(async () => {
      await this.loadSettings();
      if (request.subsonic) {
        await this.loadSources();
        const result = await this.pwa.configure(request.subsonic);
        if (request.subsonic.action === 'add') this.sources.set(result.id, new AndroidSubsonicSource({ ...result, android: this.pwa }));
        if (request.subsonic.action === 'remove') {
          this.sources.get(request.subsonic.id)?.dispose();
          this.sources.delete(request.subsonic.id);
          for (const [token, file] of this.fileSources) if (file.serverId === request.subsonic.id) this.fileSources.delete(token);
        }
      }
      if (request.gatewayPermissions !== undefined) {
        const { gatewayPermissions: setting } = request;
        if (typeof setting?.libraries !== 'boolean' || typeof setting.players !== 'boolean') throw networkMusicError('invalidRequest');
        const next = { libraries: setting.libraries, players: setting.players };
        if (!await this.saveConfig({ networkMusicGateway: next })) throw networkMusicError('unavailable');
        this.gatewayPermissions = next;
        if (this.detachHost) {
          try { await this.bridge.request('pwa.setPermissions', next); }
          catch (error) { this.settings = null; throw error; }
        }
      }
      if (request.manualDevice) await this.configureManualDevice(request.manualDevice);
      this.emitState();
      return this.networkMusicGetState();
    });
    this.configuring = result;
    return result;
  }

  networkMusicSetSharing(request) { return this.setSharing(request); }

  async configureManualDevice({ action, id, url }) {
    if (action === 'add') {
      try { url = networkUrl(url).href; } catch { throw networkMusicError('unreachable'); }
      await this.networkAccess(true);
      const devices = await this.readDevice(url, {}, () => true);
      if (!devices.length) throw networkMusicError('unreachable');
      if (this.manualDevices.some(entry => entry.url === url)) return;
      const next = [...this.manualDevices, { id: crypto.randomUUID(), url, name: devices[0].name }];
      try {
        if (!await this.saveConfig({ networkMusicManualDevices: next })) throw networkMusicError('unavailable');
      } catch (error) {
        this.invalidateManualDevice(url);
        throw error;
      }
      this.manualDevices = next;
    } else if (action === 'remove') {
      const removed = this.manualDevices.find(entry => entry.id === id);
      if (!removed) return;
      const next = this.manualDevices.filter(entry => entry !== removed);
      if (!await this.saveConfig({ networkMusicManualDevices: next })) throw networkMusicError('unavailable');
      this.manualDevices = next;
      this.invalidateManualDevice(removed.url);
    } else throw networkMusicError('invalidRequest');
  }

  async networkMusicBrowse(request = {}) {
    if (request.serverId?.startsWith('subsonic:')) await this.loadSources();
    if (this.sources.has(request.serverId)) return this.sources.get(request.serverId).browse(request);
    await this.networkAccess();
    return this.browse(request);
  }

  async networkMusicGetPlayerState(request = {}) {
    await this.networkAccess();
    return this.getPlayerState(request);
  }

  async networkMusicPlayerCommand(request = {}) {
    await this.networkAccess(true);
    return this.playerCommand(request);
  }

  async networkMusicResolveTrack(request = {}) {
    await this.networkAccess();
    return this.resolveTrack(request);
  }

  async resolveTrack(request) {
    const { serverId, localPlayback } = request;
    if (serverId?.startsWith('subsonic:')) {
      await this.loadSources();
      const source = this.sources.get(serverId);
      if (!source) throw networkMusicError('unavailable');
      if (localPlayback) return source.resolveTrack(request.trackId);
      const { protocolInfo } = request;
      const trackId = request.trackId?.id ?? request.trackId;
      const player = request.trackId?.player ?? this.discovery.devices.get(request.playerId);
      if (!player?.available) throw networkMusicError('unavailable');
      const playerId = player.id;
      const track = await source.resolveTrack(trackId);
      if (this.discovery.devices.get(playerId) !== player || !player.available) throw networkMusicError('unavailable');
      const resource = selectAndroidPlayerResource(track, protocolInfo);
      const format = resource.format || 'raw';
      const target = player.address;
      const { uri, artwork = '' } = await this.publishPlayerResource(this.fileToken(),
        { playerId, target, serverId, trackId, coverArtId: track.coverArtId, format });
      if (source.closed || this.sources.get(serverId) !== source) throw networkMusicError('unavailable');
      const item = { ...track, uri, artwork, resources: [{ ...resource, uri }],
        quality: resource.format ? 'transcoded' : 'original', seekable: !resource.format };
      item.metadata = didl([didlItem(item)]);
      return item;
    }
    const track = await super.resolveTrack({ ...request, localPlayback: false });
    if (!localPlayback) return track;
    const entry = await this.registerMedia(track.uri);
    return { ...track, uri: entry.playbackUrl };
  }

  registerMedia(uri) {
    const cached = this.localMedia.get(uri);
    if (cached) {
      // The URL may be about to re-enter the native queue in a new transaction.
      cached.inQueue = false;
      return cached;
    }
    let registration = this.registrations.get(uri);
    if (!registration) {
      registration = this.bridge.request('gateway.register', { url: uri }).then(entry => {
        this.localMedia.set(uri, entry);
        return entry;
      }).finally(() => this.registrations.delete(uri));
      this.registrations.set(uri, registration);
    }
    return registration;
  }

  observeQueue(snapshot) {
    if (!this.localMedia.size) return;
    const { queueRevision, queueLength, retainedQueueLength = 0, sourceInQueue, source } = snapshot.playback ?? {};
    if (!Number.isInteger(queueLength)) return;
    const standaloneUri = sourceInQueue ? undefined : source?.uri;
    const previous = this.lastQueueSnapshot;
    if (previous?.queueRevision === queueRevision && previous?.queueLength === queueLength &&
        previous?.standaloneUri === standaloneUri) return;
    this.lastQueueSnapshot = { queueRevision, queueLength, retainedQueueLength, standaloneUri };
    this.pruneObservedQueue();
  }

  pruneObservedQueue() {
    if (this.closed || this.readingQueue) return;
    const snapshot = this.lastQueueSnapshot;
    this.readingQueue = true;
    void this.pruneLocalQueue(snapshot).catch(error => this.onDiagnostic(error)).finally(() => {
      this.readingQueue = false;
      if (snapshot !== this.lastQueueSnapshot) this.pruneObservedQueue();
    });
  }

  async pruneLocalQueue(snapshot) {
    const { queueRevision, queueLength, retainedQueueLength, standaloneUri } = snapshot;
    const uris = new Set();
    const remaining = new Set([...this.localMedia.values()].map(entry => entry.playbackUrl));
    const retain = uri => { if (remaining.delete(uri)) uris.add(uri); };
    retain(standaloneUri);
    const candidates = new Map([...this.localMedia].filter(([, entry]) => entry.inQueue));
    for (const [total, retained] of [[queueLength, false], [retainedQueueLength, true]]) {
      for (let offset = 0; offset < total && snapshot === this.lastQueueSnapshot && !this.closed; ) {
        if (!remaining.size) break;
        const limit = Math.min(64, total - offset);
        const page = await this.bridge.request('playback.queue.read', { offset, limit, ...(retained && { retained }) });
        if (page.revision !== queueRevision || page.total !== total || page.items.length !== limit) return;
        for (const item of page.items) retain(item.uri);
        offset += page.items.length;
      }
    }
    if (snapshot !== this.lastQueueSnapshot || this.closed) return;
    for (const entry of this.localMedia.values()) if (uris.has(entry.playbackUrl)) entry.inQueue = true;
    this.pruneFiles('local', { uris, candidates });
  }

  pruneFiles(playerId, state) {
    if (playerId !== 'local') return super.pruneFiles(playerId, state);
    for (const [uri, entry] of state.candidates) {
      if (!entry.inQueue || state.uris.has(entry.playbackUrl)) continue;
      this.localMedia.delete(uri);
      void this.bridge.request('gateway.release', { token: entry.token }).catch(error => this.onDiagnostic(error));
    }
  }

  playLocalItems(request) { return playPwaNetworkItems(this, request); }

  canPlayItem(item) { return item.playable !== false; }

  async networkMusicPlaySelection(request = {}) {
    if (!OPERATIONS.has(request.operationKind)) throw networkMusicError('unsupported');
    await this.networkAccess(true);
    return this.playSelection(request);
  }

  async networkMusicPlayFiles(request = {}) {
    if (!OPERATIONS.has(request.operationKind ?? 'play')) throw networkMusicError('unsupported');
    await this.networkAccess(true);
    return this.playFiles(request);
  }

  onDiagnostic(error) { console.debug('Android network music request failed:', error); }

  dispose() {
    this.closed = true;
    clearInterval(this.expiryTimer);
    this.avPlayers.dispose();
    this.detachDevices();
    this.detachPlayback();
    this.detachShare();
    this.disposeLibraryShare();
    this.detachHost?.();
    this.remoteClient.dispose();
    for (const source of this.sources.values()) source.dispose();
    this.sources.clear();
    this.listeners.clear();
    this.windowRef?.document?.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stopPageSearch();
  }
}
