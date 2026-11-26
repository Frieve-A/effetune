import { base64ToBytes, bytesToBase64 } from './bridge.js';
import { applyAndroidQueue, createAndroidMusicService } from './remote-music-service.js';
import { sha256Hex } from '../library/repository/sha256.js';
import { MAX_BODY, browseParameters, errorStatus, fail, hostInfo, playbackResult, requestObject,
  parsePlayerGrant, relatedArtwork, unknownOutcome, validateCatalogItem, validatePlayerTrack, validateResolve } from '../network-music/pwa-host-protocol.js';
import { networkMusicError, validatePwaMediaUrl } from '../network-music/pwa-connection.js';
import { parseSort } from '../network-music/upnp/content.js';
import { MAX_QUEUE, supportsProtocol } from '../network-music/upnp/host-core.js';
import { didl, didlItem, isLanAddress, networkUrl } from '../network-music/upnp/protocol.js';

const PART = 512 * 1024;
const utf8 = new TextEncoder();
const trackFields = ['id', 'parentId', 'refId', 'title', 'artist', 'album', 'genre', 'date', 'trackNo', 'addedAt',
  'isContainer', 'playable', 'duration', 'viewId', 'upnpClass', 'childCount', 'trackCount', 'totalDurationSec',
  'catalogSearch', 'albumObjectId', 'artistObjectId', 'treeObjectId', 'flatObjectId', 'bitrate', 'sampleRate', 'bitDepth'];
const select = (object, fields) => Object.fromEntries(fields.filter(key => object[key] !== undefined).map(key => [key, object[key]]));

async function mapTracks(rows, project) {
  const result = [];
  // Keep each bridge batch small, even when a player returns its entire queue.
  for (let start = 0; start < rows.length; start += 16) {
    result.push(...await Promise.all(rows.slice(start, start + 16).map((row, i) => project(row, start + i))));
  }
  return result;
}

async function readBody(event, call) {
  if (event.body !== null) return requestObject(event.body);
  const total = event.bodyBytes;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_BODY) throw fail('invalidRequest');
  const bytes = new Uint8Array(total);
  for (let offset = 0; offset < total;) {
    const { data, nextOffset, done } = await call('pwa.readBody', { offset });
    if (typeof data !== 'string' || data.length > 4 * Math.ceil(PART / 3)) throw fail('invalidRequest');
    const chunk = base64ToBytes(data);
    if (!chunk.length || chunk.length > PART || nextOffset !== offset + chunk.length ||
        nextOffset > total || done !== (nextOffset === total)) throw fail('invalidRequest');
    bytes.set(chunk, offset);
    offset = nextOffset;
  }
  return requestObject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

async function respond(call, status, body) {
  const bytes = utf8.encode(JSON.stringify(body));
  if (bytes.length <= PART) return call('pwa.respond', { status, body });
  if (bytes.length > MAX_BODY) return call('pwa.respond', { status: 400, body: { error: { code: 'invalidResponse' } } });
  for (let offset = 0; offset < bytes.length; offset += PART) {
    const part = bytes.subarray(offset, offset + PART);
    const ack = await call('pwa.respondPart', { offset, total: bytes.length, status,
      data: bytesToBase64(part), done: offset + part.length === bytes.length });
    if (!ack.accepted) break;
  }
}

function keys(track, catalogKey) {
  const refs = [track.uri, ...(track.resources || []).map(item => item.uri), catalogKey];
  return [...new Set(refs.filter(uri => typeof uri === 'string' && uri))].map(uri => sha256Hex(utf8.encode(uri)));
}

export function selectAndroidPlayerResource(track, protocolInfo) {
  const candidates = [...(track.resources || []), track.transcodedResource];
  const resource = candidates.find(entry => entry && (!protocolInfo || supportsProtocol(protocolInfo, entry.protocolInfo)));
  if (!resource) throw networkMusicError('unsupportedFormat');
  return resource;
}

class HostRequest {
  constructor(music, event, current, project) {
    Object.assign(this, { music, event, current, project });
    this.bound = { request: (command, payload = {}, revision) => {
      this.check();
      return music.bridge.request(command, { ...payload, _pwaRequestId: event.requestId }, revision);
    } };
  }

  check() { if (!this.current()) throw fail('unauthorized'); }

  call = async (command, payload) => {
    this.check();
    const result = await this.music.bridge.request(command, { ...payload, requestId: this.event.requestId });
    this.check();
    return result;
  };

  async dispatch() {
    const { method, route, playerId } = this.event;
    const input = await readBody(this.event, this.call);
    const [state, share] = await Promise.all([this.music.networkMusicGetState(), this.bound.request('share.status')]);
    this.check();
    this.hostId = share.id;
    this.share = share;
    this.permissions = this.music.gatewayPermissions;
    const local = !input.playerId || input.playerId === playerId;
    if (route === 'info' && method === 'GET') {
      if (!playerId || !share.id) throw fail('unavailable');
      const players = state.players.filter(device => device.id !== playerId).map(({ id, name, available }) =>
        ({ id, name, available, capabilities: { effects: false } }));
      return hostInfo({ hostId: share.id, name: share.friendlyName, playerId, permissions: this.permissions,
        state: { libraries: state.libraries.filter(device => device.id !== share.id), players },
        playback: true, effects: this.music.windowRef?.remoteControlController?.active === true, sharing: share.enabled });
    }
    if (route === 'player' && (method === 'GET' || method === 'POST')) {
      if (!playerId) throw fail('unavailable');
      if (!local && !(this.permissions.players && state.players.some(device => device.available && device.id === input.playerId))) throw fail('forbidden');
      if (method === 'GET') return this.playerState(local, input.playerId);
      if (!local) return this.playerCommand(false, input);
      const previous = this.music.pwaLocalCommand || Promise.resolve();
      const next = previous.catch(() => {}).then(() => this.playerCommand(true, input));
      this.music.pwaLocalCommand = next;
      try { return await next; }
      finally { if (this.music.pwaLocalCommand === next) this.music.pwaLocalCommand = null; }
    }
    if (method !== 'POST' || !['resolve', 'browse'].includes(route)) {
      this.status = 404;
      throw fail('unsupported');
    }
    const serverId = input.serverId || share.id;
    const own = serverId === share.id;
    if (!own && !(this.permissions.libraries && state.libraries.some(device => device.available && device.id === serverId))) throw fail('forbidden');
    if (route === 'resolve') {
      validateResolve(input);
      const generation = this.music.pwaGeneration;
      let player;
      if (!own && input.audience === 'player') {
        const target = input.target;
        if (typeof target?.hostId !== 'string' || !target.hostId || typeof target.playerId !== 'string' || !target.playerId) throw fail('invalidRequest');
        player = { hostId: target.hostId, playerId: target.playerId };
        if (player.hostId === this.hostId && player.playerId !== playerId) {
          const device = this.music.discovery.devices.get(player.playerId);
          if (!this.permissions.players || !device?.address || !state.players.some(entry => entry.id === player.playerId && entry.available)) throw fail('forbidden');
          player.address = device.address;
        }
      }
      const item = own ? await this.sharedItem(input.trackId, input.audience) : await this.music.networkMusicResolveTrack({
        serverId, trackId: input.trackId, localPlayback: this.music.sources.has(serverId) });
      if (player && (this.permissions !== this.music.gatewayPermissions || generation !== this.music.pwaGeneration)) throw fail('forbidden');
      return this.publicItem(serverId, item, input.target?.protocolInfo, input.audience === 'player', player);
    }
    const pageArgs = browseParameters(input);
    const page = own ? await this.music.browseShared({ ...pageArgs, address: share.baseUrl,
      sort: parseSort(input.sortCriteria ?? ''), catalogQuery: input.query || null }) :
      await this.music.networkMusicBrowse({ ...pageArgs, serverId, query: input.query, sortCriteria: input.sortCriteria });
    const items = await mapTracks(page.items, item => this.publicItem(serverId, item));
    return { start: pageArgs.start, total: page.total, numberReturned: items.length, updateId: own ? share.updateId : page.updateId, items };
  }

  async sharedItem(trackId, audience) {
    this.check();
    const page = await this.music.browseShared({ objectId: trackId, metadata: true, address: this.share.baseUrl });
    const item = page.items[0];
    if (!item || item.isContainer || !item.playable) throw fail('unsupportedFormat');
    const token = trackId.split(':')[1];
    const source = await this.music.sharedSource(this.music.trackUidForToken(token));
    if (audience === 'player' && source.sourceKind !== 'archive-entry') {
      await this.music.publishSharedSource(token, source, undefined, this.bound);
    }
    return item;
  }

  async publicItem(serverId, raw, protocolInfo, forPlayer = false, player) {
    this.check();
    const own = serverId === this.hostId;
    const item = own ? this.music.publicTrack(raw, serverId) : raw;
    const trackId = item.trackId || item.id;
    const result = { ...select(item, trackFields), serverId, trackId, artwork: '', uri: '', resources: [] };
    if (typeof item.displayPath === 'string' && !/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(item.displayPath)) result.displayPath = item.displayPath;
    const uid = own && this.music.trackUidForToken(trackId.split(':')[1]);
    result.mediaKeys = keys(item, uid && this.hostId + ':catalog:' + uid);
    let variants = item.resources?.length ? item.resources : item.playable ? [{ protocolInfo: 'http-get:*:*:*' }] : [];
    if (!own && this.music.sources.has(serverId) && item.transcodedResource) variants = [...variants, item.transcodedResource];
    const resources = player ? [selectAndroidPlayerResource(item, protocolInfo)] :
      protocolInfo ? variants.filter(resource => supportsProtocol(protocolInfo, resource.protocolInfo)).slice(0, 1) : variants;
    if (item.playable && !resources.length) throw fail('unsupportedFormat');
    for (const resource of resources.length ? resources : item.artwork ? [null] : []) {
      let target = {};
      let grantTrackId = own && !item.isContainer ? trackId.split(':', 2).join(':') : trackId;
      if (own && item.isContainer) grantTrackId = 'track:' + new URL(item.artwork).pathname.split('/').at(-1);
      if (!own && this.music.sources.has(serverId)) {
        target.coverArtId = item.artwork ? new URL(item.artwork).searchParams.get('id') || '' : '';
        if (resource?.format) target.format = resource.format;
      } else if (!own) {
        target = { uri: resource?.uri || item.uri || '', artwork: item.artwork || '', address: this.music.discovery.devices.get(serverId)?.address };
      }
      let uri;
      if (forPlayer && own) {
        const base = networkUrl(this.share.baseUrl);
        const token = grantTrackId.split(':')[1];
        if (!isLanAddress(base.hostname) || base.hostname.startsWith('127.') || !/^[\w-]{32}$/.test(token)) throw fail('unavailable');
        uri = new URL('/media/' + token, base).href;
        if (resource?.uri !== uri) throw fail('unsupportedFormat');
        const artwork = new URL('/artwork/' + token, base).href;
        if (item.artwork === artwork) result.artwork = artwork;
      } else {
        const grant = await this.call('pwa.issueGrant', { serverId, trackId: grantTrackId, audience: player ? 'player' : 'browser',
          target, ...(player && { player: { ...player, protocolInfo: resource.protocolInfo } }) });
        if (player) {
          const media = networkUrl(grant.uri);
          if (media.protocol !== 'http:' || !isLanAddress(media.hostname) || media.hostname.startsWith('127.') ||
              media.search || !/^\/pwa\/v1\/media\/[\w-]{32,8192}$/.test(media.pathname)) throw fail('unavailable');
          uri = media.href;
          result.artwork = relatedArtwork(grant);
        } else {
          if (grant.artwork) result.artwork = validatePwaMediaUrl(grant.artwork, this.event.baseOrigin);
          if (resource) uri = validatePwaMediaUrl(grant.uri, this.event.baseOrigin);
        }
      }
      if (resource) {
        result.resources.push({ ...select(resource, ['protocolInfo', 'duration', 'size']), uri });
        if (!result.uri) {
          result.uri = uri;
          if (resource.format) Object.assign(result, { quality: 'transcoded', seekable: false });
          else if (item.quality) result.quality = item.quality;
        }
      }
    }
    result.metadata = didl([didlItem(result, result.parentId)]);
    return result;
  }

  async nativeState() {
    let state;
    const queue = [];
    do {
      const page = await this.bound.request('playback.getPublic', { start: queue.length, count: state ? 500 : 100 }, state?.revision);
      if (!Number.isSafeInteger(page.revision) || !Number.isSafeInteger(page.total) || page.total < 0 ||
          page.start !== queue.length || state && (page.total !== state.total || page.revision !== state.revision)) throw fail('unavailable');
      state ??= page;
      queue.push(...page.queue);
      if (!page.queue.length && queue.length < page.total || queue.length > page.total) throw fail('unavailable');
    } while (queue.length < Math.min(state.total, MAX_QUEUE));
    return { ...state, queue: queue.slice(0, MAX_QUEUE), protocolInfo: 'http-get:*:*:*' };
  }

  async playerState(local, id, state) {
    state ??= local ? await this.nativeState() : await this.music.getPlayerState({ playerId: id });
    const project = await this.project();
    const projected = project(state, 0, MAX_QUEUE);
    projected.queue = await mapTracks(projected.queue, async (row, index) => {
      this.check();
      const track = state.queue[index];
      const uid = local && track.libraryTrackId;
      row.mediaKeys = keys(track, uid && this.hostId + ':catalog:' + uid);
      row.artwork = '';
      const art = relatedArtwork(track);
      if (art && new URL(art).pathname.startsWith('/pwa/v1/artwork/')) {
        try {
          const url = new URL(validatePwaMediaUrl(art));
          const grant = await this.call('pwa.issueGrant', { audience: 'browser', origin: url.origin,
            playerArtworkToken: url.pathname.split('/').at(-1), playerId: local ? this.event.playerId : id });
          if (grant.foreign) row.artwork = url.href;
          else if (grant.artwork) row.artwork = validatePwaMediaUrl(grant.artwork, this.event.baseOrigin);
        } catch { this.check(); } // A revoked cover must not hide the queue.
      }
      let token = uid && this.share.enabled && this.music.trackTokens.get(uid);
      if (!token && art && this.share.enabled && this.share.baseUrl) {
        const url = new URL(art);
        const nativeToken = url.pathname.match(/^\/artwork\/([\w-]{32})$/)?.[1];
        if (nativeToken && url.origin === new URL(this.share.baseUrl).origin && this.music.trackUidForToken(nativeToken)) token = nativeToken;
      }
      if (!row.artwork && token) {
        const grant = await this.call('pwa.issueGrant', { serverId: this.hostId, trackId: 'track:' + token, audience: 'browser', target: {} });
        if (grant.artwork) row.artwork = validatePwaMediaUrl(grant.artwork, this.event.baseOrigin);
      }
      return row;
    });
    return playbackResult(projected, state, local ? this.event.playerId : id);
  }

  async playerTrack(track, id) {
    const { media, artwork } = await validatePlayerTrack(track, this.hostId, id, async url => {
      const response = await this.bound.request('upnp.http', { method: 'GET', url });
      return parsePlayerGrant(response.status === 200, response.text);
    });
    const safe = { ...select(track, trackFields), uri: media.href, artwork,
      resources: track.resources.map(resource => ({ ...select(resource, ['protocolInfo', 'size', 'duration']), uri: media.href })) };
    safe.metadata = didl([didlItem(safe)]);
    return safe;
  }

  async playerCommand(local, input) {
    this.check();
    const id = input.playerId || this.event.playerId;
    const { music, permissions } = this;
    const sharing = music.sharing;
    const usesCatalog = input.items !== undefined;
    const generation = music.pwaGeneration;
    const isAuthorized = () => !music.closed && permissions === music.gatewayPermissions && generation === music.pwaGeneration &&
      (!usesCatalog || sharing === music.sharing && sharing.enabled);
    const request = { ...select(input, ['action', 'seconds', 'value', 'id', 'position', 'afterId', 'play', 'startIndex']),
      playerId: id, gatewayResolved: true, pwaRequestId: this.event.requestId, isAuthorized, isCurrent: () => this.current() && isAuthorized() };
    if (input.items !== undefined) {
      if (!local || input.tracks !== undefined || !Array.isArray(input.items) || !input.items.length || input.items.length > MAX_QUEUE) throw fail('invalidSelection');
      request.items = [];
      for (const item of input.items) {
        validateCatalogItem(item);
        this.check();
        const uid = music.trackUidForToken(item.trackId.split(':')[1]);
        if (!uid) throw fail('trackUnavailable');
        await music.sharedSource(uid);
        request.items.push({ serverId: 'local', trackId: uid });
      }
    }
    if (input.tracks !== undefined) {
      if (!Array.isArray(input.tracks) || input.tracks.length > MAX_QUEUE) throw fail('invalidSelection');
      request.tracks = [];
      for (const track of input.tracks) request.tracks.push(await this.playerTrack(track, id));
    }
    try {
      this.check();
      let state;
      if (!local) state = await music.playerCommand(request);
      else if (['replace', 'insert'].includes(request.action)) await this.queueCommand(request);
      else {
        if (!['play', 'pause', 'stop', 'next', 'previous', 'clear', 'seek', 'seekId', 'delete', 'volume', 'mute', 'repeat', 'shuffle'].includes(request.action)) throw fail('unsupported');
        if (['repeat', 'shuffle', 'mute'].includes(request.action) && typeof request.value !== 'boolean') throw fail('invalidRequest');
        if (['seek', 'seekId', 'delete', 'volume'].includes(request.action)) {
          const number = request.action === 'volume' ? request.value : request.action === 'seek' ? request.seconds : request.id;
          if (!Number.isSafeInteger(number) || number < 0 || number > (request.action === 'volume' ? 100 : 0xffffffff)) throw fail('invalidRequest');
        }
        request.mutationStarted = true;
        await this.call('pwa.playerControl', select(request, ['action', 'seconds', 'value', 'id']));
      }
      return await this.playerState(local, id, state);
    } catch (error) {
      this.check();
      if (!request.mutationStarted || !isAuthorized()) throw error;
      let playback;
      try { playback = await this.playerState(local, id); } catch (readError) { music.onDiagnostic(readError); }
      this.status = 409;
      return unknownOutcome(error, playback);
    }
  }

  async queueCommand(request) {
    const entries = request.items || request.tracks;
    if (!entries?.length) throw fail('invalidSelection');
    const start = request.startIndex ?? 0;
    if (!Number.isSafeInteger(start) || start < 0 || start >= entries.length ||
        !['afterCurrent', 'end'].includes(request.position ?? 'end')) throw fail('invalidRequest');
    if (request.action === 'insert') {
      const state = await this.nativeState();
      if (entries.length + state.total > MAX_QUEUE) throw fail('queueFull');
      const after = request.afterId ?? (request.position === 'afterCurrent' ? state.currentId : state.queue.at(-1)?.id) ?? 0;
      request.insertionOrdinal = after === 0 ? 0 : state.queue.findIndex(track => track.id === after) + 1;
      if (after !== 0 && !request.insertionOrdinal) throw fail('invalidRequest');
    }
    const resolve = request.items ? createAndroidMusicService(this.bound, this.music.windowRef).resolveEntry :
      track => ({ ...select(track, ['uri', 'title', 'artist', 'album', 'duration']), metadata: { artworkUrl: track.artwork } });
    await applyAndroidQueue(this.bound, request, entries, resolve, request.isAuthorized);
  }
}

export function startAndroidPwaHost(music, project = async () => (await import('./remote-music-protocol.js')).projectPlayback) {
  const pending = new Map();
  const detachRequest = music.bridge.on('pwa-request', async event => {
    if (pending.has(event.requestId)) return;
    const request = new HostRequest(music, event, () => pending.get(event.requestId) === request, project);
    pending.set(event.requestId, request);
    try {
      let body;
      try { body = await request.dispatch(); }
      catch (error) {
        request.check();
        request.status ??= errorStatus(error);
        body = { error: { code: error.code || 'requestFailed' } };
      }
      await respond(request.call, request.status ?? 200, body);
    } catch (error) {
      if (request.current()) music.onDiagnostic(error);
    } finally { if (request.current()) pending.delete(event.requestId); }
  });
  const detachCancel = music.bridge.on('pwa-cancelled', ({ requestId }) => pending.delete(requestId));
  music.pwaGeneration = 0;
  const detachRevoke = music.bridge.on('pwa-revoked', () => { music.pwaGeneration++; });
  return () => { detachRequest(); detachCancel(); detachRevoke(); pending.clear(); };
}
