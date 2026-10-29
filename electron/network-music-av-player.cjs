'use strict';

const crypto = require('node:crypto');
const { service, parseDidl, didl, didlItem } = require('./network-music-upnp.cjs');
const fail = (code, message) => Object.assign(new Error(message), { code });
const seconds = value => {
  const parts = String(value || '').split(':').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
};
const time = value => `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

// AVTransport has a current URI, not an OpenHome playlist. This host owns only
// the queue it explicitly sent, and gives it up when another controller takes over.
class AvTransportPlayers {
  constructor(host) { this.host = host; this.owners = new Map(); this.reads = new Map(); this.nextId = 1; }
  invoke(device, kind, action, args = {}) { return this.host.invoke(service(device, kind), action, args); }
  state(device) {
    if (this.reads.has(device.id)) return this.reads.get(device.id);
    const reading = this.read(device).finally(() => { if (this.reads.get(device.id) === reading) this.reads.delete(device.id); });
    this.reads.set(device.id, reading); return reading;
  }
  async read(device) {
    const owner = this.owners.get(device.id);
    const revision = owner?.revision;
    const [transport, position, media, actions, connection] = await Promise.all([
      this.invoke(device, 'AVTransport', 'GetTransportInfo', { InstanceID: 0 }),
      this.invoke(device, 'AVTransport', 'GetPositionInfo', { InstanceID: 0 }),
      this.invoke(device, 'AVTransport', 'GetMediaInfo', { InstanceID: 0 }),
      this.invoke(device, 'AVTransport', 'GetCurrentTransportActions', { InstanceID: 0 }).catch(() => null),
      service(device, 'ConnectionManager') ? this.invoke(device, 'ConnectionManager', 'GetProtocolInfo').catch(() => null) : null
    ]);
    const uri = position.TrackURI || media.CurrentURI || '';
    const total = seconds(position.TrackDuration || media.MediaDuration);
    const elapsed = seconds(position.RelTime);
    if (owner && this.owners.get(device.id) === owner && owner.revision !== revision) return this.read(device);
    const states = { PLAYING: 'Playing', PAUSED_PLAYBACK: 'Paused', STOPPED: 'Stopped', NO_MEDIA_PRESENT: 'Stopped', TRANSITIONING: 'Buffering' };
    let active = owner && this.owners.get(device.id) === owner ? owner : null;
    if (active && (!device.available || !active.isAuthorized() || active.uri && uri !== active.uri || transport.CurrentTransportStatus && transport.CurrentTransportStatus !== 'OK')) {
      this.owners.delete(device.id); active = null;
    }
    if (active && !active.mutating) {
      // A STOPPED state alone is not evidence of natural completion.
      const finished = !this.host.queues.has(device.id) && active.playing && active.armed && transport.CurrentTransportState === 'STOPPED' && total > 0 && elapsed >= total;
      if (transport.CurrentTransportState === 'PLAYING') active.playing = true;
      if (finished) {
        active.armed = false;
        if (active.index + 1 < active.queue.length) {
          void this.host.playerCommand({ playerId: device.id, action: 'advance', expectedOwner: active,
            isCurrent: () => this.owners.get(device.id) === active && device.available,
            isAuthorized: active.isAuthorized }).catch(error => { this.owners.delete(device.id); this.host.onDiagnostic(error); });
        }
      }
    }
    let metadata = {};
    try { metadata = parseDidl(position.TrackMetaData || media.CurrentURIMetaData || '')[0] || {}; } catch { /* Devices may omit current metadata. */ }
    const queue = active ? active.queue : uri ? [{ id: 0, uri, title: metadata.title || 'Track', artist: metadata.artist || '', album: metadata.album || '', duration: total, artwork: metadata.artwork || '' }] : [];
    const allowed = actions ? new Set(String(actions.Actions || '').split(',').map(action => action.trim())) : null;
    const supported = action => allowed ? allowed.has(action) : ['Play', 'Stop'].includes(action);
    let volume = null; let mute = null;
    if (service(device, 'RenderingControl')) {
      const [current, muted] = await Promise.all([
        this.invoke(device, 'RenderingControl', 'GetVolume', { InstanceID: 0, Channel: 'Master' }).catch(() => null),
        this.invoke(device, 'RenderingControl', 'GetMute', { InstanceID: 0, Channel: 'Master' }).catch(() => null)
      ]);
      if (current && Number.isFinite(Number(current.CurrentVolume))) volume = Number(current.CurrentVolume);
      if (muted) mute = ['1', 'true'].includes(String(muted.CurrentMute));
    }
    return { playerId: device.id, transportState: states[transport.CurrentTransportState] || 'Stopped', position: elapsed,
      duration: total, currentId: active?.queue[active.index]?.id ?? 0, queue, repeat: false, shuffle: false,
      protocolInfo: connection?.Sink || '', volume, volumeMax: volume === null ? null : 100, mute,
      queueOwner: active ? 'host' : 'device', capabilities: { play: Boolean(active && !active.uri) || supported('Play'), pause: supported('Pause'), stop: supported('Stop'), seek: supported('Seek'),
        next: Boolean(active && active.index + 1 < active.queue.length), previous: Boolean(active && active.index > 0), seekId: Boolean(active),
        delete: Boolean(active), clear: Boolean(active), repeat: false, shuffle: false, volume: volume !== null, mute: mute !== null } };
  }
  async start(device, owner, current) {
    const authorized = () => current() && owner.isAuthorized();
    if (!authorized()) throw fail('unauthorized', 'Reconnect to the playback device.');
    const track = owner.queue[owner.index]; owner.revision = (owner.revision || 0) + 1; owner.uri = track.uri; owner.armed = false; owner.playing = false; owner.mutating = true;
    try {
      await this.invoke(device, 'AVTransport', 'SetAVTransportURI', { InstanceID: 0, CurrentURI: track.uri, CurrentURIMetaData: track.metadata || '' });
      if (!authorized()) throw fail('unauthorized', 'Reconnect to the playback device.');
      await this.invoke(device, 'AVTransport', 'Play', { InstanceID: 0, Speed: '1' });
      owner.armed = authorized();
    } finally { owner.mutating = false; }
    this.ensurePolling();
  }
  ensurePolling() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const [id, owner] of this.owners) {
        const device = this.host.discovery.devices.get(id);
        if (!device?.available || !owner.isAuthorized()) { this.owners.delete(id); continue; }
        if (!this.host.queues.has(id)) void this.state(device).catch(error => { this.owners.delete(id); this.host.onDiagnostic(error); });
      }
      if (!this.owners.size) { clearInterval(this.timer); this.timer = null; }
    }, 1000);
    this.timer.unref();
  }
  async command(device, request) {
    const { action, value, id, isCurrent = () => true, isAuthorized = () => true } = request;
    const check = () => { if (!isCurrent() || !isAuthorized() || !device.available) throw fail('unauthorized', 'Reconnect to the playback device.'); request.mutationStarted = true; };
    const state = await this.state(device);
    let owner = this.owners.get(device.id);
    if (action === 'replace' || action === 'insert') {
      const items = request.filePaths ?? request.tracks ?? request.items;
      if (!Array.isArray(items) || !items.length || items.length > 4096) throw fail('invalidSelection', 'Choose between 1 and 4096 tracks.');
      if (action === 'insert' && !owner && state.queue.length) throw fail('unsupported', 'Start a new queue in EffeTune before adding tracks.');
      if (!['end', 'afterCurrent'].includes(request.position || 'end')) throw fail('invalidRequest', 'Choose a valid queue position.');
      const startIndex = request.startIndex ?? 0;
      if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex >= items.length) throw fail('invalidRequest', 'Choose a valid starting track.');
      if ((action === 'insert' ? owner?.queue.length || 0 : 0) + items.length > 4096) throw fail('queueFull', 'Choose fewer tracks for this player.');
      const address = await this.host.getRouteAddress(device.address);
      const resolved = [];
      for (const item of items) {
        const track = request.tracks ? item : request.filePaths ? await this.host.openedFile(item) : await this.host.resolveTrack({ ...item, address, protocolInfo: state.protocolInfo });
        const resource = track.resources?.find(resource => !state.protocolInfo || this.host.supportsProtocol(state.protocolInfo, resource.protocolInfo));
        if (!resource) throw fail('unsupportedFormat', 'The player does not support this audio format.');
        resolved.push({ ...track, uri: resource.uri, id: this.nextId++ });
      }
      if (request.filePaths) {
        await this.host.fileServer.start();
        for (const track of resolved) {
          const uid = crypto.randomBytes(24).toString('base64url');
          track.uri = this.host.fileServer.resource(uid, address, device.address).uri;
          this.host.fileSources.set(uid, { path: track.path, playerId: device.id, uri: track.uri });
          track.resources[0].uri = track.uri; track.metadata = didl([didlItem(track)]); delete track.path;
        }
      }
      check();
      if (action === 'replace' || !owner) {
        owner = { queue: resolved, index: startIndex, uri: '', armed: false, isAuthorized };
        this.owners.set(device.id, owner);
      } else owner.queue.splice(request.position === 'afterCurrent' ? owner.index + 1 : owner.queue.length, 0, ...resolved);
      if (request.play) await this.start(device, owner, isCurrent);
      else if (action === 'replace' || !owner.uri) { owner.uri = ''; owner.mutating = true; }
    } else if (['next', 'previous', 'seekId', 'advance'].includes(action)) {
      if (!owner) throw fail('unsupported', 'This player has no EffeTune queue.');
      if (action === 'advance' && request.expectedOwner !== owner) throw fail('unsupported', 'The playback queue changed.');
      const index = action === 'seekId' ? owner.queue.findIndex(track => track.id === id) : owner.index + (action === 'previous' ? -1 : 1);
      if (index < 0 || index >= owner.queue.length) throw fail('unsupported', 'There is no track at this queue position.');
      check(); owner.index = index; await this.start(device, owner, isCurrent);
    } else if (action === 'delete') {
      if (!owner) throw fail('unsupported', 'This player has no EffeTune queue.');
      const index = owner.queue.findIndex(track => track.id === id);
      if (index < 0) throw fail('invalidRequest', 'Choose a track in this queue.');
      check(); owner.queue.splice(index, 1);
      if (index < owner.index) owner.index--;
      else if (index === owner.index) {
        owner.armed = false;
        if (owner.queue.length) { owner.index = Math.min(owner.index, owner.queue.length - 1); await this.start(device, owner, isCurrent); }
        else { await this.invoke(device, 'AVTransport', 'Stop', { InstanceID: 0 }); this.owners.delete(device.id); }
      }
    } else if (action === 'clear' || action === 'stop') {
      check(); if (owner) owner.armed = false;
      await this.invoke(device, 'AVTransport', 'Stop', { InstanceID: 0 });
      if (action === 'clear') this.owners.delete(device.id);
    } else if (action === 'play' || action === 'pause') {
      if (!state.capabilities[action]) throw fail('unsupported', 'This playback operation is unavailable.');
      check();
      if (action === 'play' && owner && !owner.uri) await this.start(device, owner, isCurrent);
      else { await this.invoke(device, 'AVTransport', action === 'play' ? 'Play' : 'Pause', { InstanceID: 0, ...(action === 'play' ? { Speed: '1' } : {}) }); if (owner) owner.armed = action === 'play'; }
    } else if (action === 'seek') {
      if (!state.capabilities.seek || !Number.isSafeInteger(request.seconds) || request.seconds < 0) throw fail('unsupported', 'This player cannot seek to that position.');
      check(); await this.invoke(device, 'AVTransport', 'Seek', { InstanceID: 0, Unit: 'REL_TIME', Target: time(request.seconds) });
    } else if (action === 'volume' || action === 'mute') {
      if (!state.capabilities[action] || action === 'volume' && (!Number.isInteger(value) || value < 0 || value > 100) || action === 'mute' && typeof value !== 'boolean') throw fail('unsupported', 'This player cannot change that audio setting.');
      check(); await this.invoke(device, 'RenderingControl', action === 'volume' ? 'SetVolume' : 'SetMute', { InstanceID: 0, Channel: 'Master', [action === 'volume' ? 'DesiredVolume' : 'DesiredMute']: action === 'mute' ? Number(value) : value });
    } else throw fail('unsupported', 'This playback operation is unavailable.');
    this.reads.delete(device.id);
    const result = await this.state(device); this.host.pruneFiles(device.id, result); return result;
  }
  dispose() { clearInterval(this.timer); this.owners.clear(); }
}

module.exports = { AvTransportPlayers };
