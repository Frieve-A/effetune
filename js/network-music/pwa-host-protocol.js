import { VIEWS, SORT_CAPS } from './upnp/content.js';
import { MAX_QUEUE } from './upnp/host-core.js';
import { networkUrl } from './upnp/protocol.js';

export const MAX_BODY = 16 * 1024 * 1024;
export const fail = code => Object.assign(new Error(code), { code });
const uint = (value, maximum = 0xffffffff) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw fail('invalidRequest');
  return value;
};

export function requestObject(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('invalidRequest');
  return result;
}

export function browseParameters(input) {
  const objectId = input.objectId ?? '0';
  if (typeof objectId !== 'string' || objectId.length > 256 || typeof (input.query ?? '') !== 'string') throw fail('invalidRequest');
  const start = uint(input.start ?? 0); const count = uint(input.count ?? 100, 500);
  return { objectId, start, count: Math.max(1, count) };
}

export function validateResolve(input) {
  if (typeof input.trackId !== 'string' || !['browser', 'player'].includes(input.audience)) throw fail('invalidRequest');
}

export function validateCatalogItem(item) {
  if (typeof item?.trackId !== 'string' || item.trackId.length > 256 || !item.trackId.startsWith('track:')) throw fail('invalidRequest');
}

export function validateTrackInput(track) {
  if (typeof track.metadata !== 'string' || track.metadata.length > 65536 || !Array.isArray(track.resources)) throw fail('invalidRequest');
}

export function relatedArtwork(track) {
  try {
    const media = networkUrl(track.uri);
    const art = networkUrl(track.artwork);
    if (!media.search && !art.search && art.origin === media.origin &&
        art.pathname === media.pathname.replace('/media/', '/artwork/')) return art.href;
  } catch { /* Artwork is optional. */ }
  return '';
}

export function parsePlayerGrant(ok, text) {
  if (!ok || text.length > 4096) throw fail('forbidden');
  return JSON.parse(text);
}

export async function validatePlayerTrack(track, hostId, playerId, getGrant) {
  validateTrackInput(track);
  const media = networkUrl(track.uri);
  if (media.search || !/^\/(?:media\/[A-Za-z0-9_-]{32}|pwa\/v1\/media\/[A-Za-z0-9_-]{32,8192})$/.test(media.pathname) ||
      !track.resources.length || track.resources.some(resource => resource.uri !== track.uri)) throw fail('invalidRequest');
  if (media.pathname.startsWith('/pwa/')) {
    const token = media.pathname.split('/').at(-1);
    let grant;
    try { grant = await getGrant(media.origin + '/pwa/v1/grant/' + token, token); }
    catch (error) { throw fail(error?.code === 'forbidden' ? 'forbidden' : 'unavailable'); }
    if (grant?.audience !== 'player' || grant.target?.hostId !== hostId || grant.target?.playerId !== playerId) throw fail('forbidden');
  }
  return { media, artwork: relatedArtwork(track) };
}

export function hostInfo({ hostId, name, playerId, permissions, state, playback, effects, sharing }) {
  return {
    hostId, name, playerId, libraryId: hostId,
    queueTracksMax: MAX_QUEUE,
    libraries: permissions?.libraries ? state.libraries.map(({ id, name, available, searchSupported, catalogSearch, sortCaps, browseViews }) => ({ id, name, available, searchSupported, catalogSearch, sortCaps, browseViews })) : [],
    players: permissions?.players ? state.players.map(player => ({ ...player, isEffeTune: false })) : [],
    capabilities: { playback, catalogPlayback: true, effects, sharing,
      browseViews: sharing ? VIEWS.map(view => ({ id: view.id, objectId: `view:${view.id}` })) : [],
      searchSupported: sharing, catalogSearch: sharing, sortCaps: sharing ? SORT_CAPS : [] }
  };
}

export function playbackResult(projected, state, playerId) {
  return { ...projected, playerId, protocolInfo: state.protocolInfo || '', queueOwner: state.queueOwner, tracksMax: MAX_QUEUE };
}

export function errorStatus(error) {
  return error?.code === 'forbidden' ? 403 : error?.code === 'unauthorized' ? 401 : 400;
}

export function unknownOutcome(error, playback) {
  return { error: { code: error.code || 'requestFailed' }, outcome: 'unknown', ...(playback ? { playback } : {}) };
}
