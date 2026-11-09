import { getReplayGain } from '../../library/metadata/metadata-mapper.js';
import { isLocalFilePath } from './audio-context-manager-metadata.js';

const replayGainCache = new WeakMap();
// Library playback creates a new track object per start, so Electron reads are also shared by path.
const replayGainPathCache = new Map();
const MAX_CACHED_REPLAY_GAIN_PATHS = 64;

/**
 * The object that identifies a song for ReplayGain: a converted playable copy shares its original's values.
 */
export function getReplayGainTrackKey(track) {
  const key = track?.presentationTrack ?? track;
  return key && typeof key === 'object' ? key : null;
}

/**
 * Linear playback gain for the stored ReplayGain values and player settings.
 * Returns 1 when ReplayGain is off or the file carries no usable gain.
 */
export function computeReplayGainFactor(replayGain, { mode, preampDb, preventClipping } = {}) {
  if (!replayGain || (mode !== 'track' && mode !== 'album')) return 1;
  const preferAlbum = mode === 'album';
  const primaryGain = preferAlbum ? replayGain.albumGainDb : replayGain.trackGainDb;
  const useAlbum = Number.isFinite(primaryGain) ? preferAlbum : !preferAlbum;
  const gainDb = useAlbum ? replayGain.albumGainDb : replayGain.trackGainDb;
  if (!Number.isFinite(gainDb)) return 1;

  const factor = 10 ** ((gainDb + (Number.isFinite(preampDb) ? preampDb : 0)) / 20);
  if (!preventClipping) return factor;
  const primaryPeak = useAlbum ? replayGain.albumPeak : replayGain.trackPeak;
  const peak = Number.isFinite(primaryPeak) ? primaryPeak : (useAlbum ? replayGain.trackPeak : replayGain.albumPeak);
  if (!(peak > 0)) return factor;
  const limit = 1 / peak;
  return factor > limit ? limit : factor;
}

/**
 * Read the embedded ReplayGain values of a local track, cached per track object.
 * Resolves to null for tracks without a readable local file or without tags.
 */
export function readReplayGain(track) {
  const sourceTrack = getReplayGainTrackKey(track);
  if (!sourceTrack) return Promise.resolve(null);
  let pending = replayGainCache.get(sourceTrack);
  if (!pending) {
    pending = readUncachedReplayGain(sourceTrack).catch(error => {
      console.debug('ReplayGain tags could not be read:', error);
      return null;
    });
    replayGainCache.set(sourceTrack, pending);
  }
  return pending;
}

function readUncachedReplayGain(track) {
  if (typeof Blob !== 'undefined' && track.file instanceof Blob) return readBlobReplayGain(track.file);
  const readByPath = typeof window !== 'undefined' ? window.electronAPI?.readReplayGain : null;
  if (typeof readByPath !== 'function' || !isLocalFilePath(track.path)) return Promise.resolve(null);
  // Least recently used order: a hit moves the path to the end, the oldest entry is evicted.
  let pending = replayGainPathCache.get(track.path);
  if (pending) replayGainPathCache.delete(track.path);
  else {
    pending = readByPath(track.path).then(replayGain => replayGain ?? null, error => {
      // Forget a failed read so a later track object for this path tries again.
      if (replayGainPathCache.get(track.path) === pending) replayGainPathCache.delete(track.path);
      throw error;
    });
  }
  replayGainPathCache.set(track.path, pending);
  if (replayGainPathCache.size > MAX_CACHED_REPLAY_GAIN_PATHS) {
    replayGainPathCache.delete(replayGainPathCache.keys().next().value);
  }
  return pending;
}

async function readBlobReplayGain(file) {
  const { parseBlob } = await import('../../vendor/music-metadata-browser.mjs');
  return getReplayGain(await parseBlob(file, { duration: false, skipCovers: true }));
}
