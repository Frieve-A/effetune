import { networkMusicError, parsePwaPairingLink, validatePwaMediaUrl } from './pwa-connection.js';
import { playPwaNetworkItems } from './pwa-playback-provider.js';
import { PwaSubsonicSource } from './subsonic-source.js';
import { ensureAndroidNetworkAccess } from '../android/network.js';

const STORAGE_KEY = 'effetune.networkMusic.devices.v1';
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const playerId = record => `pwa:${record.hostId}:player`;
const libraryId = record => `pwa:${record.hostId}:library`;
const gatewayDeviceId = (record, kind, id) => `${kind === 'library' ? libraryId(record) : playerId(record)}:${encodeURIComponent(id)}`;

export class PwaNetworkMusicTransport {
  constructor({ fetchImpl = globalThis.fetch?.bind(globalThis), WebSocketImpl = globalThis.WebSocket,
    storage, windowRef = globalThis.window, requestTimeout = 15000 } = {}) {
    Object.assign(this, { fetchImpl, WebSocketImpl, windowRef, requestTimeout });
    this.isPwa = true;
    this.records = new Map();
    this.sources = new Map();
    this.connectingSources = new Set();
    this.listeners = new Set();
    this.effectListeners = new Set();
    this.pending = new Set();
    this.closed = false;
    try { this.storage = storage ?? windowRef?.localStorage; } catch { this.storage = null; }
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved)) for (const item of saved.slice(0, 16)) {
        if (!validId(item?.hostId) || typeof item.name !== 'string') continue;
        try {
          const connection = parsePwaPairingLink(`${item.origin}/?t=${encodeURIComponent(item.token)}`);
          this.records.set(item.hostId, { ...connection, hostId: item.hostId, name: item.name.slice(0, 128), available: false });
        } catch { /* Ignore damaged registrations, without issuing any requests. */ }
      }
    } catch { /* A restricted store still allows a session-only connection. */ }
    this.onVisible = () => { if (windowRef?.document?.visibilityState === 'visible') void this.networkMusicDiscover(); };
    windowRef?.document?.addEventListener('visibilitychange', this.onVisible);
    this.remoteClient = {
      getConnection: async id => {
        const { record, local } = this.deviceFor(id, 'player');
        return { registered: local && record.available && record.info?.capabilities.effects === true, requestAvailable: false };
      },
      requestConnection: async id => ({ ok: await this.manageConnection?.(id) === true, status: 'unavailable' }),
      cancelConnectionRequest: async () => true,
      manageConnection: id => this.manageConnection?.(id),
      connect: id => this.connectEffects(id),
      disconnect: async id => this.disconnectEffects(id),
      send: async (id, data) => {
        const active = this.effects;
        if (active?.connectionId !== id || active.socket.readyState !== 1 || typeof data !== 'string' ||
            encoder.encode(data).length > MAX_FRAME_BYTES || active.socket.bufferedAmount > MAX_FRAME_BYTES) return false;
        active.socket.send(data);
        return true;
      },
      onEvent: listener => { this.effectListeners.add(listener); return () => this.effectListeners.delete(listener); }
    };
  }

  get registrations() {
    return [...this.records.values()].map(record => ({ hostId: record.hostId, id: playerId(record), name: record.name,
      available: record.available, authorizationRequired: record.authorizationRequired === true }));
  }

  recordFor(id, kind) {
    return this.deviceFor(id, kind).record;
  }

  deviceFor(id, kind) {
    for (const record of this.records.values()) {
      if ((kind === 'library' ? libraryId(record) : playerId(record)) === id) return {
        record, nativeId: kind === 'library' ? record.info?.libraryId : record.info?.playerId, local: true
      };
      const device = (record.info?.[kind === 'library' ? 'libraries' : 'players'] ?? [])
        .find(item => gatewayDeviceId(record, kind, item.id) === id);
      if (device) return { record, nativeId: device.id, device, local: false };
    }
    throw networkMusicError(id === 'local' ? 'libraryRequired' : 'unavailable');
  }

  save() {
    try {
      if (!this.storage) return false;
      this.storage.setItem(STORAGE_KEY, JSON.stringify([...this.records.values()].map(({ hostId, origin, token, name }) => ({ hostId, origin, token, name }))));
      return true;
    } catch { return false; }
  }

  async register(link, expectedHostId = null) {
    const networkPermission = ensureAndroidNetworkAccess({ request: true, windowRef: this.windowRef });
    if (networkPermission) await networkPermission;
    const target = parsePwaPairingLink(link);
    const info = await this.request(target, 'info');
    this.validateInfo(info);
    if (expectedHostId !== null && info.hostId !== expectedHostId) throw networkMusicError('differentDevice');
    if (!this.records.has(info.hostId) && this.records.size >= 16) throw networkMusicError('deviceLimit');
    const record = { ...target, hostId: info.hostId, name: info.name, info, available: true, connectionVersion: globalThis.crypto.randomUUID() };
    this.records.set(info.hostId, record);
    this.disconnectEffectsFor(record.hostId);
    const persistent = this.save();
    this.emit();
    return { hostId: record.hostId, playerId: playerId(record), persistent };
  }

  remove(hostId) {
    this.disconnectEffectsFor(hostId);
    this.records.delete(hostId);
    const persistent = this.save();
    this.emit();
    return { persistent };
  }

  validateInfo(info) {
    if (!info || !validId(info.hostId) || !validId(info.playerId) || !validId(info.libraryId) ||
        typeof info.name !== 'string' || !info.name || info.name.length > 128 ||
        !info.capabilities || typeof info.capabilities !== 'object' ||
        typeof info.capabilities.playback !== 'boolean') throw networkMusicError('pwaUnsupported');
  }

  async request(record, path, body) {
    const networkPermission = ensureAndroidNetworkAccess({ windowRef: this.windowRef });
    if (networkPermission) await networkPermission;
    if (this.closed) throw networkMusicError('unavailable');
    const controller = new AbortController();
    this.pending.add(controller);
    const timer = setTimeout(() => controller.abort(), this.requestTimeout);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(`${record.origin}/pwa/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', mode: 'cors', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { Authorization: `Bearer ${record.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (response.status === 401) {
        if (this.records.get(record.hostId) === record) {
          record.authorizationRequired = true;
          record.available = false;
          this.disconnectEffectsFor(record.hostId);
          this.emit();
        }
        throw networkMusicError('registrationExpired');
      }
      if (response.status === 404 && path === 'info') throw networkMusicError('pwaUnsupported');
      const text = await response.text();
      if (text.length > MAX_FRAME_BYTES) throw networkMusicError('invalidResponse');
      let data;
      try { data = JSON.parse(text); } catch { throw networkMusicError('invalidResponse'); }
      if (!response.ok) {
        const error = networkMusicError(typeof data?.error?.code === 'string' ? data.error.code : 'unavailable');
        if (data?.outcome === 'unknown') error.outcome = 'unknown';
        if (response.status === 403 && path !== 'info' && this.records.get(record.hostId) === record) {
          await this.refresh(record);
          this.emit();
        }
        throw error;
      }
      return data;
    } catch (error) {
      if (error.networkMusic) throw error;
      throw networkMusicError('connectionFailed');
    } finally {
      clearTimeout(timer);
      this.pending.delete(controller);
    }
  }

  async refresh(record) {
    if (record.authorizationRequired) return;
    const generation = record.refreshGeneration = (record.refreshGeneration ?? 0) + 1;
    try {
      const info = await this.request(record, 'info');
      this.validateInfo(info);
      if (info.hostId !== record.hostId) throw networkMusicError('differentDevice');
      if (this.records.get(record.hostId) !== record || generation !== record.refreshGeneration) return;
      Object.assign(record, { info, name: info.name, available: true });
    } catch { if (this.records.get(record.hostId) === record && generation === record.refreshGeneration) record.available = false; }
  }

  networkMusicGetState() {
    const records = [...this.records.values()];
    return Promise.resolve({ queueTracksMax: 4096, sharing: { enabled: false, folderIds: [], folders: [] },
      sources: [...this.sources.values()].map(source => ({ ...source.descriptor, url: source.endpoint, user: source.user })),
      players: records.flatMap(record => [{ id: playerId(record), name: record.name, available: record.available && record.info?.capabilities.playback === true, isEffeTune: true,
        capabilities: { effects: record.info?.capabilities.effects === true },
        connectionVersion: record.connectionVersion, authorizationRequired: record.authorizationRequired === true },
      ...(record.info?.players ?? []).filter(device => validId(device.id) && device.id !== 'local').map(device => ({ ...device,
        id: gatewayDeviceId(record, 'player', device.id), name: `${device.name} · ${record.name}`, isEffeTune: false,
        available: record.available && device.available !== false, connectionVersion: record.connectionVersion }))]),
      libraries: [...this.sources.values()].map(source => source.descriptor).concat(records.flatMap(record => [...(record.info?.capabilities.sharing === true ? [{
        id: libraryId(record), name: record.name, available: record.available,
        browseViews: record.info.capabilities.browseViews ?? [], sortCaps: record.info.capabilities.sortCaps ?? [],
        searchSupported: record.info.capabilities.searchSupported === true, catalogSearch: record.info.capabilities.catalogSearch === true
      }] : []), ...(record.info?.libraries ?? []).filter(device => validId(device.id) && device.id !== 'local').map(device => ({ ...device,
        id: gatewayDeviceId(record, 'library', device.id), name: `${device.name} · ${record.name}`,
        available: record.available && device.available !== false }))])) });
  }

  async networkMusicConfigure({ subsonic }) {
    const networkPermission = ensureAndroidNetworkAccess({ request: true, windowRef: this.windowRef });
    if (networkPermission) await networkPermission;
    if (!subsonic) throw networkMusicError('unavailable');
    if (subsonic.action === 'remove') {
      this.sources.get(subsonic.id)?.dispose();
      this.sources.delete(subsonic.id);
    } else if (subsonic.action === 'test') {
      const source = this.sources.get(subsonic.id);
      if (!source) throw networkMusicError('unavailable');
      await source.test();
    } else if (subsonic.action === 'add') {
      const source = new PwaSubsonicSource({ ...subsonic, fetchImpl: this.fetchImpl });
      this.connectingSources.add(source);
      try { await source.test(); } catch (error) { source.dispose(); throw error; }
      finally { this.connectingSources.delete(source); }
      if (this.closed) { source.dispose(); throw networkMusicError('unavailable'); }
      this.sources.set(source.id, source);
    } else throw networkMusicError('unavailable');
    this.emit();
    return this.networkMusicGetState();
  }

  cancelSourceRegistration() {
    for (const source of this.connectingSources) source.dispose();
    this.connectingSources.clear();
  }

  async networkMusicDiscover() {
    await Promise.all([...this.records.values()].map(record => this.refresh(record)));
    this.save();
    this.emit();
    return this.networkMusicGetState();
  }

  onNetworkMusicState(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { if (!this.closed) void this.networkMusicGetState().then(state => { if (!this.closed) for (const listener of this.listeners) listener(state); }); }

  async networkMusicBrowse({ serverId, ...request }) {
    const networkPermission = ensureAndroidNetworkAccess({ request: true, windowRef: this.windowRef });
    if (networkPermission) await networkPermission;
    if (this.sources.has(serverId)) return this.sources.get(serverId).browse(request);
    const { record, nativeId, local, device } = this.deviceFor(serverId, 'library');
    this.requireAvailable(record, local ? 'sharing' : null);
    if (device?.available === false) throw networkMusicError('unavailable');
    const page = await this.request(record, 'browse', { ...request, serverId: nativeId });
    if (!Array.isArray(page?.items)) throw networkMusicError('invalidResponse');
    return { ...page, items: page.items.map(item => ({ ...item, serverId, trackId: item.id,
      artwork: item.artwork ? validatePwaMediaUrl(item.artwork, record.origin) : '' })) };
  }

  requireAvailable(record, capability) {
    if (record.authorizationRequired) throw networkMusicError('registrationExpired');
    if (!record.available) throw networkMusicError('unavailable');
    if (capability && record.info?.capabilities[capability] !== true) throw networkMusicError(capability === 'sharing' ? 'sharingRequired' : 'unavailable');
  }

  async networkMusicResolveTrack({ serverId, trackId, localPlayback = false, target, resources }) {
    if (localPlayback) {
      const protocols = this.browserProtocols(resources);
      if (protocols?.length === 0) throw networkMusicError('unsupportedFormat');
      if (protocols) target = { protocolInfo: protocols.join(',') };
    }
    if (this.sources.has(serverId)) {
      if (!localPlayback) throw networkMusicError('gatewayRequired');
      return this.sources.get(serverId).resolveTrack(trackId);
    }
    const { record, nativeId, local } = this.deviceFor(serverId, 'library');
    this.requireAvailable(record, local ? 'sharing' : null);
    const track = await this.request(record, 'resolve', { serverId: nativeId, trackId, audience: localPlayback ? 'browser' : 'player', ...(target ? { target } : {}) });
    if (this.records.get(record.hostId) !== record) throw networkMusicError('unavailable');
    this.deviceFor(serverId, 'library');
    if (localPlayback) {
      validatePwaMediaUrl(track.uri, record.origin);
      if (track.artwork) validatePwaMediaUrl(track.artwork, record.origin);
    }
    return { ...track, serverId, trackId };
  }

  async networkMusicGetPlayerState({ playerId: id }) {
    const { record, nativeId, local } = this.deviceFor(id, 'player');
    await this.refresh(record);
    this.emit();
    this.requireAvailable(record, local ? 'playback' : null);
    this.deviceFor(id, 'player');
    const state = await this.request(record, `player?playerId=${encodeURIComponent(nativeId)}`);
    record.playerStates ??= new Map();
    record.playerStates.set(nativeId, state);
    return state;
  }

  async networkMusicPlayerCommand({ playerId: id, items, isCurrent = () => true, onProgress, onCommit, ...args }) {
    const { record, nativeId, local } = this.deviceFor(id, 'player');
    this.requireAvailable(record, local ? 'playback' : null);
    if (items && (!Array.isArray(items) || items.length > 4096)) throw networkMusicError('queueFull');
    if (local && record.info?.capabilities.catalogPlayback && items?.length &&
        items.every(item => item.serverId === libraryId(record))) {
      if (!isCurrent()) return { accepted: false };
      onCommit?.();
      return this.request(record, 'player', { ...args, playerId: nativeId,
        items: items.map(item => ({ trackId: item.trackId })) });
    }
    const target = { origin: record.origin, hostId: record.hostId, playerId: nativeId,
      protocolInfo: record.playerStates?.get(nativeId)?.protocolInfo };
    const tracks = items ? [] : undefined;
    if (items) onProgress?.({ phase: 'MATERIALIZING', processed: 0, total: items.length });
    // Bound HTTP work for large queues while preserving track order and startIndex.
    for (let offset = 0; offset < (items?.length ?? 0); offset += 4) {
      if (!isCurrent()) return { accepted: false };
      if (this.records.get(record.hostId) !== record) throw networkMusicError('unavailable');
      this.requireAvailable(record, local ? 'playback' : null);
      tracks.push(...await Promise.all(items.slice(offset, offset + 4).map(item => this.networkMusicResolveTrack({ ...item, target }))));
      onProgress?.({ phase: 'MATERIALIZING', processed: tracks.length, total: items.length });
    }
    // Resolve against captured records. A removed or replaced registration cannot
    // apply a delayed queue operation to a newly registered connection.
    if (!isCurrent()) return { accepted: false };
    if (this.records.get(record.hostId) !== record) throw networkMusicError('unavailable');
    this.deviceFor(id, 'player');
    onCommit?.();
    return this.request(record, 'player', { ...args, playerId: nativeId, ...(tracks ? { tracks } : {}) });
  }

  networkMusicPlaySelection() { return Promise.reject(networkMusicError('libraryRequired')); }
  networkMusicPlayFiles() { return Promise.reject(networkMusicError('libraryRequired')); }
  playLocalItems(request) { return playPwaNetworkItems(this, request); }

  canPlayItem(item, destination) {
    if (this.sources.has(item.serverId)) {
      if (destination !== 'local' || item.playable === false) return false;
    } else {
      let source;
      try { source = this.deviceFor(item.serverId, 'library'); } catch { return false; }
      const { record, local, device } = source;
      if (!record.available || local && !record.info?.capabilities.sharing || device?.available === false) return false;
      if (destination !== 'local') return true;
    }
    return this.browserProtocols(item.resources)?.length !== 0;
  }

  browserProtocols(resources) {
    this.audioProbe ??= this.windowRef?.document?.createElement('audio');
    const types = resources?.map(resource => resource.protocolInfo?.split(':')[2]).filter(Boolean) ?? [];
    if (!types.length || !this.audioProbe) return null;
    return types.filter(type => this.audioProbe.canPlayType(type)).map(type => `http-get:*:${type}:*`);
  }

  async connectEffects(id) {
    const networkPermission = ensureAndroidNetworkAccess({ request: true, windowRef: this.windowRef });
    if (networkPermission) await networkPermission;
    const { record, local } = this.deviceFor(id, 'player');
    if (!local) throw networkMusicError('unavailable');
    this.requireAvailable(record, 'effects');
    this.disconnectEffects();
    const connectionId = globalThis.crypto.randomUUID();
    const url = `${record.origin.replace(/^http/, 'ws')}/pwa/v1/effects?t=${encodeURIComponent(record.token)}`;
    let socket;
    try { socket = new this.WebSocketImpl(url); } catch { throw networkMusicError('connectionFailed'); }
    const active = { connectionId, hostId: record.hostId, socket };
    this.effects = active;
    const emit = (type, extra = {}) => {
      if (this.effects !== active) return;
      for (const listener of this.effectListeners) listener({ connectionId, type, ...extra });
    };
    active.timer = setTimeout(() => { emit('close', { code: 1006 }); this.disconnectEffects(connectionId); }, this.requestTimeout);
    active.timer.unref?.();
    socket.addEventListener('open', () => { clearTimeout(active.timer); emit('open'); });
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string' || encoder.encode(event.data).length > MAX_FRAME_BYTES) {
        emit('close', { code: 1009 }); this.disconnectEffects(connectionId); return;
      }
      emit('message', { data: event.data });
    });
    socket.addEventListener('close', event => {
      clearTimeout(active.timer);
      if (event.code === 4401 && this.records.get(record.hostId) === record) {
        record.authorizationRequired = true; record.available = false; this.emit();
      }
      emit('close', { code: event.code });
    });
    socket.addEventListener('error', () => { emit('close', { code: 1006 }); });
    return { ok: true, connectionId };
  }

  disconnectEffectsFor(hostId) { if (this.effects?.hostId === hostId) this.disconnectEffects(); }
  disconnectEffects(id = this.effects?.connectionId) {
    if (!this.effects || this.effects.connectionId !== id) return true;
    const active = this.effects;
    this.effects = null;
    clearTimeout(active.timer);
    active.socket.close();
    return true;
  }

  dispose() {
    this.closed = true;
    for (const controller of this.pending) controller.abort();
    for (const source of this.sources.values()) source.dispose();
    this.sources.clear();
    this.cancelSourceRegistration();
    this.disconnectEffects();
    this.listeners.clear();
    this.effectListeners.clear();
    this.windowRef?.document?.removeEventListener('visibilitychange', this.onVisible);
  }
}
