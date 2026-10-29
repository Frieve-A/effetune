import { networkMusicError } from './pwa-connection.js';

export function createPwaPlaybackTrack(api, item) {
  if (item.playable === false || item.sourceKind === 'cue-track' || item.startFrame != null || item.endFrame != null) {
    throw networkMusicError('cueUnsupported');
  }
  const { serverId, trackId } = item;
  const meta = { title: item.title || 'Untitled', artist: item.artist || '', album: item.album || '',
    duration: item.duration || item.durationSec || 0, artworkUrl: item.artwork || '',
    networkLibrary: { serverId, trackId } };
  const sourceKey = `pwa-network:${serverId}:${trackId}`;
  return {
    name: meta.title, meta, sourceKind: 'pwa-network', sourceKey,
    physicalSourceKey: sourceKey, canonicalSourceKey: sourceKey,
    // Keep a stable shared-track reference. Grants are reissued when the player
    // resolves a source; no whole-file fetch or persistent media URL is needed.
    provider: async () => {
      const track = await api.networkMusicResolveTrack({ serverId, trackId, localPlayback: true,
        ...(item.resources ? { resources: item.resources } : {}) });
      if (track.playable === false) throw networkMusicError('unsupportedFormat');
      Object.assign(meta, { title: track.title || meta.title, artist: track.artist || '', album: track.album || '', artworkUrl: track.artwork || '' });
      return { mediaSource: track.uri, ...(track.headers ? { headers: track.headers } : {}),
        kind: 'pwa-network', sourceKey, physicalSourceKey: sourceKey, canonicalSourceKey: sourceKey };
    }
  };
}

export async function playPwaNetworkItems(api, { items, uiManager, operationKind, startIndex, isCurrent, onCommit }) {
  const tracks = items.map(item => createPwaPlaybackTrack(api, item));
  const player = uiManager.audioPlayer ?? await uiManager.createAudioPlayer([], false);
  if (!isCurrent()) return;
  onCommit?.();
  return player.activateOpenHomePlaybackAdapter().playProviderTracks(tracks, operationKind, isCurrent, startIndex);
}
