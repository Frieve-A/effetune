'use strict';

const { MAX_QUEUE } = require('./network-music-host.cjs');

const MUSIC_OPS = new Set([
  'listMusicDevices', 'browseMusic', 'getPlayback', 'playMusic', 'queueMusic',
  'controlPlayback', 'editPlaybackQueue'
]);
const PUBLIC_ERRORS = new Set([
  'invalidRequest', 'invalidSelection', 'unavailable', 'unsupported', 'trackUnavailable',
  'unsupportedFormat', 'queueTooLarge', 'queueFull', 'queueChanged', 'sharingRequired',
  'folderNotShared', 'cueUnsupported', 'selectionChanged', 'catalogUnavailable', 'unauthorized'
]);
const fail = (code, message) => Object.assign(new Error(message), { code });
const own = (object, key) => Object.hasOwn(object, key);
const text = (value, maximum = 512) => typeof value === 'string' ? value.slice(0, maximum) : '';
const finite = value => Number.isFinite(value) && value >= 0 ? value : 0;
const integer = (value, maximum = 0xffffffff) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;

function fields(message, required, optional = []) {
  const allowed = new Set(['op', 'seq', ...required, ...optional]);
  if (Object.keys(message).some(key => !allowed.has(key)) || required.some(key => !own(message, key))) {
    throw fail('invalidRequest', 'Choose valid music options and try again.');
  }
}

function id(value) {
  if (typeof value !== 'string' || !value.length || value.length > 1024) {
    throw fail('invalidRequest', 'Choose a valid music device or track.');
  }
  return value;
}

function page(message) {
  const start = own(message, 'start') ? message.start : 0;
  const count = own(message, 'count') ? message.count : 100;
  if (!integer(start) || !integer(count, 500) || count < 1) {
    throw fail('invalidRequest', 'Choose a valid page of music.');
  }
  return { start, count };
}

function items(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_QUEUE) {
    throw fail('invalidSelection', 'Choose between 1 and 4096 tracks.');
  }
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
      Object.keys(item).length !== 2 || !own(item, 'serverId') || !own(item, 'trackId')) {
      throw fail('invalidRequest', 'Choose valid tracks from a music library.');
    }
    return { serverId: id(item.serverId), trackId: id(item.trackId) };
  });
}

function validate(message) {
  switch (message.op) {
    case 'listMusicDevices':
      fields(message, [], ['refresh']);
      if (own(message, 'refresh') && typeof message.refresh !== 'boolean') throw fail('invalidRequest', 'Choose valid music options and try again.');
      return { refresh: message.refresh === true };
    case 'browseMusic': {
      fields(message, [], ['serverId', 'objectId', 'query', 'sortCriteria', 'start', 'count']);
      const { start, count } = page(message);
      for (const key of ['query', 'sortCriteria']) {
        if (own(message, key) && (typeof message[key] !== 'string' || message[key].length > 512)) {
          throw fail('invalidRequest', 'Choose valid search or sorting text.');
        }
      }
      return { serverId: own(message, 'serverId') ? id(message.serverId) : 'local', sourceDefaulted: !own(message, 'serverId'),
        objectId: own(message, 'objectId') ? id(message.objectId) : '0',
        query: message.query ?? '', sortCriteria: message.sortCriteria ?? '', start, count };
    }
    case 'getPlayback':
      fields(message, [], ['playerId', 'start', 'count']);
      return { ...(own(message, 'playerId') ? { playerId: id(message.playerId) } : {}), ...page(message) };
    case 'playMusic': {
      fields(message, ['items'], ['playerId', 'startIndex']);
      const tracks = items(message.items);
      const startIndex = message.startIndex ?? 0;
      if (!integer(startIndex, tracks.length - 1)) throw fail('invalidRequest', 'Choose a valid starting track.');
      return { ...(own(message, 'playerId') ? { playerId: id(message.playerId) } : {}), items: tracks, startIndex };
    }
    case 'queueMusic': {
      fields(message, ['items'], ['playerId', 'position']);
      const position = message.position ?? 'end';
      if (position !== 'end' && position !== 'afterCurrent') throw fail('invalidRequest', 'Choose a valid queue position.');
      return { ...(own(message, 'playerId') ? { playerId: id(message.playerId) } : {}), items: items(message.items), position };
    }
    case 'controlPlayback': {
      fields(message, ['action'], ['playerId', 'seconds', 'id', 'value']);
      const { action } = message;
      const player = own(message, 'playerId') ? { playerId: id(message.playerId) } : {};
      const simple = ['play', 'pause', 'stop', 'next', 'previous'];
      const extra = Object.keys(message).filter(key => !['op', 'seq', 'playerId', 'action'].includes(key));
      if (simple.includes(action) && extra.length === 0) return { ...player, action };
      if (action === 'seek' && extra.length === 1 && own(message, 'seconds') && integer(message.seconds)) return { ...player, action, seconds: message.seconds };
      if (action === 'seekId' && extra.length === 1 && own(message, 'id') && integer(message.id)) return { ...player, action, id: message.id };
      if (['repeat', 'shuffle'].includes(action) && extra.length === 1 && own(message, 'value') && typeof message.value === 'boolean') return { ...player, action, value: message.value };
      if (action === 'volume' && extra.length === 1 && own(message, 'value') && integer(message.value, 1000)) return { ...player, action, value: message.value };
      throw fail('invalidRequest', 'Choose a valid playback control.');
    }
    case 'editPlaybackQueue':
      fields(message, ['action'], ['playerId', 'id']);
      if (message.action === 'clear' && !own(message, 'id')) return { ...(own(message, 'playerId') ? { playerId: id(message.playerId) } : {}), action: 'clear' };
      if (message.action === 'delete' && own(message, 'id') && integer(message.id)) return { ...(own(message, 'playerId') ? { playerId: id(message.playerId) } : {}), action: 'delete', id: message.id };
      throw fail('invalidRequest', 'Choose a valid queue edit.');
    default:
      throw fail('unsupported', 'This music operation is unavailable.');
  }
}

function track(item) {
  return { id: integer(item.id) ? item.id : 0, title: text(item.title), artist: text(item.artist),
    album: text(item.album), duration: finite(item.duration) };
}

function projectPlayback(state, start = 0, count = 100) {
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const current = queue.find(item => item.id === state.currentId);
  const capabilities = state.capabilities || {};
  return {
    playerId: text(state.playerId, 1024), transportState: text(state.transportState, 64),
    currentId: integer(state.currentId) ? state.currentId : 0,
    currentTrack: current ? track(current) : null,
    position: finite(state.position), duration: finite(state.duration),
    repeat: state.repeat === true, shuffle: state.shuffle === true,
    volume: Number.isFinite(state.volume) ? state.volume : null,
    volumeMax: Number.isFinite(state.volumeMax) ? state.volumeMax : null,
    capabilities: Object.fromEntries(['play', 'pause', 'stop', 'next', 'previous', 'seek', 'seekId', 'delete', 'clear', 'repeat', 'shuffle', 'volume']
      .map(key => [key, capabilities[key] === true])),
    queue: queue.slice(start, start + count).map(track), start, total: queue.length,
    numberReturned: Math.min(count, Math.max(0, queue.length - start))
  };
}

function projectBrowse(page) {
  const rows = Array.isArray(page.items) ? page.items.slice(0, 500) : [];
  return {
    serverId: text(page.serverId, 1024),
    ...(Array.isArray(page.searchedSources) ? { searchedSources: page.searchedSources } : {}),
    items: rows.map(item => ({ serverId: text(item.serverId, 1024), trackId: text(item.trackId, 1024),
      id: text(item.id, 1024), parentId: text(item.parentId, 1024), title: text(item.title),
      artist: text(item.artist), album: text(item.album), genre: text(item.genre),
      isContainer: item.isContainer === true, playable: item.playable === true,
      duration: finite(item.duration), childCount: integer(item.childCount) ? item.childCount : null })),
    start: integer(page.start) ? page.start : 0,
    total: integer(page.total) ? page.total : null,
    numberReturned: rows.length,
    updateId: integer(page.updateId) ? page.updateId : null
  };
}

function projectDevices(state, localPlayer, localLibraryAvailable) {
  const libraries = [{ serverId: 'local', name: text(localPlayer?.name || 'This EffeTune'),
    available: localLibraryAvailable, searchSupported: true, catalogSearch: true,
    searchCaps: ['dc:title'], sortCaps: ['dc:title'], browseViews: [] },
  ...(state.libraries || []).slice(0, 255).map(device => ({
    serverId: text(device.id, 1024), name: text(device.name), available: device.available === true,
    searchSupported: device.searchSupported === true, catalogSearch: device.catalogSearch === true,
    searchCaps: (device.searchCaps || []).slice(0, 32).map(value => text(value, 128)),
    sortCaps: (device.sortCaps || []).slice(0, 32).map(value => text(value, 128)),
    browseViews: (device.browseViews || []).slice(0, 32).map(view => ({ id: text(view.id, 128), objectId: text(view.objectId, 1024) }))
  }))];
  const players = (state.players || []).slice(0, 256).map(device => ({
    playerId: text(device.id, 1024), name: text(device.name), available: device.available === true,
    isEffeTune: device.isEffeTune === true
  }));
  if (localPlayer) players.push({ playerId: localPlayer.controlId, name: text(localPlayer.name),
    available: localPlayer.available === true, isEffeTune: true });
  return { libraries, players, queueTracksMax: MAX_QUEUE };
}

function publicError(error) {
  if (!PUBLIC_ERRORS.has(error?.code)) return { code: 'networkMusicUnavailable', message: 'The music device could not complete the request. Check its connection and try again.' };
  return { code: error.code, message: text(error.message, 512) };
}

async function dispatchMusic(music, localPlayer, message, isCurrent) {
  let request;
  const requireCurrent = () => {
    if (!isCurrent()) throw fail('unauthorized', 'Reconnect to EffeTune and try again.');
  };
  try {
    request = validate(message);
    if (!music) throw fail('unsupported', 'Network music is unavailable in this version of EffeTune.');
    requireCurrent();
    if (message.op === 'listMusicDevices') {
      const state = request.refresh ? await music.discover() : await music.getState();
      const localLibraryAvailable = typeof music.localLibraryAvailable === 'function' && await music.localLibraryAvailable();
      requireCurrent();
      return { ok: true, result: projectDevices(state, localPlayer, localLibraryAvailable) };
    }
    if (message.op === 'browseMusic') {
      const { sourceDefaulted, ...browseRequest } = request;
      let page = { ...await music.browse(browseRequest), serverId: browseRequest.serverId };
      if (sourceDefaulted && request.query.trim() && page.total === 0) {
        const searchedSources = [{ serverId: 'local', outcome: 'noMatches' }];
        const state = await music.getState();
        const libraries = [...(state.libraries || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        for (const library of libraries) {
          if (!library.available || !library.searchSupported) {
            searchedSources.push({ serverId: text(library.id, 1024), outcome: library.available ? 'unsupported' : 'unavailable' });
            continue;
          }
          try {
            const candidate = { ...await music.browse({ ...browseRequest, serverId: library.id }), serverId: library.id };
            if (candidate.total > 0 || candidate.items?.length) {
              page = candidate;
              searchedSources.push({ serverId: text(library.id, 1024), outcome: 'matched' });
              break;
            }
            searchedSources.push({ serverId: text(library.id, 1024), outcome: 'noMatches' });
          } catch (error) {
            const code = publicError(error).code;
            searchedSources.push({ serverId: text(library.id, 1024), outcome: ['unavailable', 'unsupported'].includes(code) ? code : 'error',
              ...(code === 'unavailable' || code === 'unsupported' ? {} : { code }) });
          }
        }
        page = { ...page, searchedSources };
      }
      requireCurrent();
      return { ok: true, result: projectBrowse(page) };
    }
    if (!request.playerId) {
      if (!localPlayer?.controlId || !localPlayer.available) throw fail('unavailable', 'The local player is unavailable. Open EffeTune and try again.');
      request.playerId = localPlayer.controlId;
    }
    if (message.op === 'getPlayback') {
      const state = await music.getPlayerState(request);
      requireCurrent();
      return { ok: true, result: projectPlayback(state, request.start, request.count) };
    }
    const command = message.op === 'playMusic'
      ? { ...request, action: 'replace', play: true }
      : message.op === 'queueMusic' ? { ...request, action: 'insert', play: false }
        : request;
    command.isCurrent = isCurrent;
    try {
      const state = await music.playerCommand(command);
      requireCurrent();
      return { ok: true, result: projectPlayback(state, 0, 100) };
    } catch (error) {
      if (!command.mutationStarted) throw error;
      try {
        const playback = projectPlayback(await music.getPlayerState({ playerId: request.playerId }), 0, 100);
        return { ok: false, error: publicError(error), outcome: 'unknown', playback };
      } catch (stateError) {
        music.onDiagnostic?.(stateError);
        return { ok: false, error: publicError(error), outcome: 'unknown' };
      }
    }
  } catch (error) {
    music?.onDiagnostic?.(error);
    return { ok: false, error: publicError(error) };
  }
}

module.exports = { MUSIC_OPS, dispatchMusic, projectPlayback, projectBrowse, projectDevices };
