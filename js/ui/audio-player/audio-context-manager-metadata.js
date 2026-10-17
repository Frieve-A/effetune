import { readRiffInfoTagsFromBlob } from '../../library/metadata/riff-info.js';
import { decodeLegacyMetadataBytes, repairLegacyMetadataMojibake } from '../../library/metadata/text-encoding.js';

export const audioContextManagerMetadataMethods = {
  getMetadataRepairHints(referenceTexts = []) {
    const cleanReferences = referenceTexts
      .filter(value => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean);
    const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
    const uiManager = typeof window !== 'undefined' ? window.uiManager : null;
    return {
      languagePreference: uiManager?.languagePreference || '',
      language: uiManager?.userLanguage || '',
      browserLanguage: navigatorRef?.language || '',
      browserLanguages: Array.isArray(navigatorRef?.languages) ? navigatorRef.languages.slice(0, 8) : [],
      referenceTexts: cleanReferences
    };
  },

  normalizeMetadataTagText(value, referenceTexts = []) {
    if (value === null || value === undefined) return '';
    return repairLegacyMetadataMojibake(String(value), this.getMetadataRepairHints(referenceTexts)).trim();
  },

  createRiffInfoMetadataPromise(file) {
    if (!this.shouldReadRiffInfoMetadata(file)) return null;
    return this.readRiffInfoMetadata(file).catch(() => null);
  },

  shouldReadRiffInfoMetadata(file) {
    return Boolean(
      file &&
      typeof file.name === 'string' &&
      file.name.toLowerCase().endsWith('.wav') &&
      typeof file.slice === 'function'
    );
  },

  async readRiffInfoMetadata(file) {
    const tags = await readRiffInfoTagsFromBlob(file);
    if (!tags.length) return null;
    const title = this.decodeRiffInfoText(tags, ['INAM', 'TITL'], [file.name]);
    const referenceTexts = [title, file.name];
    const artist = this.decodeRiffInfoText(tags, ['IART'], referenceTexts);
    const album = this.decodeRiffInfoText(tags, ['IPRD', 'IRPD'], referenceTexts);
    return title || artist || album ? { title, artist, album } : null;
  },

  decodeRiffInfoText(tags, ids, referenceTexts = []) {
    const idSet = new Set(ids);
    const tag = tags.find(item => idSet.has(String(item?.id || '').trim().toUpperCase()));
    if (!tag) return '';
    if (typeof tag.value === 'string') return this.normalizeMetadataTagText(tag.value, referenceTexts);
    return decodeLegacyMetadataBytes(tag.data ?? tag.bytes ?? tag.value, this.getMetadataRepairHints(referenceTexts));
  },
  // ===== METADATA HANDLING =====

  /**
   * Load metadata for a track
   */
  loadMetadata(track, loadRequest = null, targetIndex = null) {
    track = track?.presentationTrack ?? track;
    const metadataRequest = this.beginMetadataRequest(track, loadRequest, targetIndex);
    const currentIndex = metadataRequest.targetIndex >= 0
      ? metadataRequest.targetIndex
      : this.audioPlayer.stateManager.getCurrentTrackIndex();
    this.updateState({
      isTrackPresentationPending: true
    }, 'Track presentation metadata loading');

    if (track?.meta?.title) {
      if (!this.isActiveMetadataRequest(metadataRequest)) return;
      const displayText = this.getDisplayTrackName(track);
      const libraryManager = window.libraryManager;
      const artworkId = libraryManager?.runtime
        ? track.libraryTrackId
        : track.meta.artworkId;
      const metadataArtworkUrl = typeof track.meta.artworkUrl === 'string' && track.meta.artworkUrl
        ? track.meta.artworkUrl
        : this.createArtworkURL(track.meta.picture);
      const shouldLoadArtwork = !metadataArtworkUrl && !!artworkId && !!libraryManager?.getArtworkThumbURL;
      this.updateState({
        currentTrackName: displayText,
        artworkUrl: metadataArtworkUrl,
        isTrackPresentationPending: shouldLoadArtwork
      }, 'Catalog metadata loaded');
      this.updateTrackNameDisplayText(displayText);
      if (shouldLoadArtwork) {
        libraryManager.getArtworkThumbURL(
          artworkId,
          libraryManager.runtime ? { reason: 'now-playing' } : undefined
        ).then(async artworkUrl => {
          if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;
          const ownedUrl = await this.adoptLibraryArtworkURL(artworkUrl);
          const isOwnedArtworkUrl = !!ownedUrl && ownedUrl !== artworkUrl;
          if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) {
            // The request went stale while duplicating the artwork. Revoke only
            // our freshly-created owned URL so a late sibling never revokes the
            // current track's live artwork (and the duplicate does not leak).
            if (isOwnedArtworkUrl && typeof URL !== 'undefined' &&
              typeof URL.revokeObjectURL === 'function') {
              try {
                URL.revokeObjectURL(ownedUrl);
              } catch (_) {
                // Ignore revoke failures for stale URLs.
              }
            }
            return;
          }
          if (isOwnedArtworkUrl) {
            // Install as the current owned URL, revoking the previous owned URL.
            this.clearArtworkURL();
            this.currentArtworkURL = ownedUrl;
          }
          this.updateState({
            artworkUrl: ownedUrl || '',
            isTrackPresentationPending: false
          }, 'Catalog artwork loaded');
        }).catch(() => {
          if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;
          this.updateState({
            artworkUrl: '',
            isTrackPresentationPending: false
          }, 'Catalog artwork unavailable');
        });
      }
      this.updateMediaSessionWithTags(
        track.meta.title,
        track.meta.artist || '',
        track.meta.album || '',
        metadataArtworkUrl
      );
      return;
    }

    if (isFileObject(track.file)) {
      this.readID3Tags(track.file, currentIndex, metadataRequest);
    } else if (this.shouldUseElectronFileRead(track.path) && window.electronAPI.readTrackTags) {
      this.readTrackTagsFromPath(track, currentIndex, metadataRequest);
    } else {
      this.tryReadFromAudioElementSrc(track, currentIndex, metadataRequest);
    }
  },

  /**
   * Show embedded tags ({ title, artist, album, picture }) as the current track presentation
   */
  applyTagMetadata(tags, riffInfo, fallbackName, label) {
    const title = riffInfo?.title || this.normalizeMetadataTagText(tags.title || '', [fallbackName]);
    const tagReferenceTexts = [title, fallbackName];
    const artist = riffInfo?.artist || this.normalizeMetadataTagText(tags.artist || '', tagReferenceTexts);
    const album = riffInfo?.album || this.normalizeMetadataTagText(tags.album || '', tagReferenceTexts);
    const artworkUrl = this.createArtworkURL(tags.picture);
    const displayText = title ? (artist ? `${artist} - ${title}` : title) : fallbackName;

    this.updateState({
      currentTrackName: displayText,
      artworkUrl,
      isTrackPresentationPending: false
    }, label);
    this.updateTrackNameDisplayText(displayText);

    this.updateMediaSessionWithTags(title || fallbackName, artist, album, artworkUrl);
  },

  /**
   * Read ID3 tags from a file
   */
  readID3Tags(file, currentIndex, metadataRequest = null) {
    const riffInfoPromise = this.createRiffInfoMetadataPromise(file);
    const applyMetadata = (tags = {}, riffInfo = null) => {
      if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return false;
      this.applyTagMetadata(tags, riffInfo, file.name, 'ID3 metadata loaded');
      return true;
    };
    const applyRiffInfoFallback = riffInfo => {
      if (riffInfo && applyMetadata({}, riffInfo)) return;
      this.fallbackToMediaSession(currentIndex, metadataRequest);
    };

    if (window.jsmediatags) {
      window.jsmediatags.read(file, {
        onSuccess: (tag) => {
          const tags = tag.tags || {};
          if (riffInfoPromise) {
            riffInfoPromise.then(riffInfo => applyMetadata(tags, riffInfo));
          } else {
            applyMetadata(tags, null);
          }
        },
        onError: (error) => {
          if (error && error.type !== 'tagFormat') {
            console.warn('Error reading ID3 tags:', error);
          }
          if (riffInfoPromise) {
            riffInfoPromise.then(applyRiffInfoFallback);
          } else {
            this.fallbackToMediaSession(currentIndex, metadataRequest);
          }
        }
      });
    } else if (riffInfoPromise) {
      riffInfoPromise.then(applyRiffInfoFallback);
    } else {
      this.fallbackToMediaSession(currentIndex, metadataRequest);
    }
  },

  /**
   * Read tags of a local desktop file by path in the main process
   */
  async readTrackTagsFromPath(track, currentIndex, metadataRequest = null) {
    let tags = null;
    try {
      tags = await window.electronAPI.readTrackTags(track.path);
    } catch (error) {
      console.warn('Error reading track tags by path:', error);
    }
    if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;
    if (tags) {
      this.applyTagMetadata(tags, null, track.name, 'Path metadata loaded');
    } else {
      this.fallbackToMediaSession(currentIndex, metadataRequest);
    }
  },

  /**
   * Try to read metadata from audio element src
   */
  tryReadFromAudioElementSrc(track, currentIndex, metadataRequest = null) {
    setTimeout(() => {
      if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;

      try {
        if (window.jsmediatags && this.audioPlayer.audioElement.src) {
          window.jsmediatags.read(this.audioPlayer.audioElement.src, {
            onSuccess: (tag) => {
              if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;
              this.applyTagMetadata(tag.tags || {}, null, track.name, 'Source metadata loaded');
            },
            onError: (error) => {
              if (error && error.type !== 'tagFormat') {
                console.warn('Error reading ID3 tags from src:', error);
              }
              this.fallbackToMediaSession(currentIndex, metadataRequest);
            }
          });
        } else {
          this.fallbackToMediaSession(currentIndex, metadataRequest);
        }
      } catch (error) {
        console.warn('Error reading metadata from audio element src:', error);
        this.fallbackToMediaSession(currentIndex, metadataRequest);
      }
    }, 500);
  },

  /**
   * Update MediaSession API with metadata
   */
  updateMediaSessionWithTags(title, artist, album, artworkUrl = '') {
    if (this.audioPlayer?.mediaSessionManager?.updateMetadataFromTags) {
      this.audioPlayer.mediaSessionManager.updateMetadataFromTags(title, artist, album, artworkUrl);
      return;
    }

    const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
    if (navigatorRef && 'mediaSession' in navigatorRef && typeof MediaMetadata !== 'undefined') {
      const metadata = {
        title: title || 'Unknown Title',
        artist: artist || 'Unknown Artist',
        album: album || 'Unknown Album'
      };
      if (artworkUrl) {
        metadata.artwork = [{ src: artworkUrl }];
      }
      navigatorRef.mediaSession.metadata = new MediaMetadata({
        ...metadata
      });

      const state = this.getCurrentState();
      navigatorRef.mediaSession.playbackState = state?.isPlaying ? 'playing' : 'paused';
      this.setupMediaSessionHandlers();
    }
  },

  updateTrackNameDisplayText(displayText) {
    const playerUi = this.audioPlayer.ui;
    if (typeof playerUi?.setTrackNameDisplayText === 'function') {
      playerUi.setTrackNameDisplayText(displayText);
    } else if (playerUi?.trackNameDisplay) {
      playerUi.trackNameDisplay.textContent = displayText;
    }
  },

  createArtworkURL(picture) {
    if (!picture?.data?.length || !picture.format || typeof Blob === 'undefined' || typeof URL === 'undefined') {
      this.clearArtworkURL();
      return '';
    }

    try {
      this.clearArtworkURL();
      const bytes = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data);
      const blob = new Blob([bytes], { type: picture.format });
      this.currentArtworkURL = URL.createObjectURL(blob);
      return this.currentArtworkURL;
    } catch (error) {
      console.warn('Failed to create artwork URL:', error);
      this.clearArtworkURL();
      return '';
    }
  },

  /**
   * Duplicate a library artwork object URL into a player-owned object URL so
   * the library cache can revoke its copy without breaking the player state
   * or MediaSession artwork.
   */
  async adoptLibraryArtworkURL(artworkUrl) {
    if (!artworkUrl) return '';
    if (typeof fetch !== 'function' || typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function') {
      return artworkUrl;
    }
    try {
      const response = await fetch(artworkUrl);
      const blob = await response.blob();
      // Only create and return the owned URL. The caller installs it as
      // this.currentArtworkURL after re-checking staleness, or revokes it if
      // the request went stale, so a late sibling never revokes the current
      // track's live artwork URL.
      return URL.createObjectURL(blob);
    } catch (_) {
      // Fall back to the shared cache URL if duplication fails.
      return artworkUrl;
    }
  },

  clearArtworkURL() {
    if (this.currentArtworkURL && typeof URL !== 'undefined') {
      try {
        URL.revokeObjectURL(this.currentArtworkURL);
      } catch (error) {
        // Ignore stale object URLs.
      }
    }
    this.currentArtworkURL = null;
  },

  /**
   * Set up MediaSession API action handlers for media controls
   */
  setupMediaSessionHandlers() {
    if (this.audioPlayer?.mediaSessionManager?.setupActionHandlers) {
      this.audioPlayer.mediaSessionManager.setupActionHandlers();
      return;
    }

    const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
    if (!navigatorRef || !('mediaSession' in navigatorRef)) return;

    navigatorRef.mediaSession.setActionHandler('play', () => {
      this.audioPlayer?.resumeAudioContextInGesture?.();
      const result = this.play();
      navigatorRef.mediaSession.playbackState = 'playing';
      return result;
    });

    navigatorRef.mediaSession.setActionHandler('pause', () => {
      const result = this.pause();
      navigatorRef.mediaSession.playbackState = 'paused';
      return result;
    });

    navigatorRef.mediaSession.setActionHandler('nexttrack', () => {
      return this.audioPlayer.playNext();
    });

    navigatorRef.mediaSession.setActionHandler('previoustrack', () => {
      return this.audioPlayer.playPrevious();
    });

    navigatorRef.mediaSession.setActionHandler('stop', () => {
      const result = this.stop();
      navigatorRef.mediaSession.playbackState = 'paused';
      return result;
    });

    navigatorRef.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        this.audioPlayer?.resumeAudioContextInGesture?.();
        return this.seek(details.seekTime);
      }
      return undefined;
    });
  },

  /**
   * Fallback to MediaSession API with basic track info
   */
  fallbackToMediaSession(currentIndex, metadataRequest = null) {
    if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;

    const track = metadataRequest?.track ?? this.audioPlayer.playbackManager?.getTrack(currentIndex);
    if (track?.meta?.title) return;

    if (this.audioPlayer.audioElement?.duration > 0) {
      if (this.audioPlayer.audioElement.title) {
        this.clearArtworkURL();
        this.updateState({
          currentTrackName: this.audioPlayer.audioElement.title,
          artworkUrl: '',
          isTrackPresentationPending: false
        }, 'Audio element metadata fallback');
        this.updateTrackNameDisplayText(this.audioPlayer.audioElement.title);
        this.updateMediaSessionWithTags(this.audioPlayer.audioElement.title, '', '', '');
        return;
      }
    }

    if (track && track.name) {
      const displayText = this.getDisplayTrackName(track);
      this.clearArtworkURL();
      this.updateState({
        currentTrackName: displayText,
        artworkUrl: '',
        isTrackPresentationPending: false
      }, 'Track name metadata fallback');
      this.updateTrackNameDisplayText(displayText);
      this.updateMediaSessionWithTags(displayText, '', '', '');
      return;
    }

    this.updateState({
      isTrackPresentationPending: false
    }, 'Track presentation metadata fallback completed');
  },

  /**
   * Update track name from audio metadata
   */
  updateTrackNameFromMetadata() {
    if (!this.audioPlayer.audioElement) return;

    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    this.fallbackToMediaSession(currentIndex);
  },
};

export function isFileObject(value) {
  return typeof File !== 'undefined' && value instanceof File;
}
