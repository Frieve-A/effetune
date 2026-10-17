import { hasPlaybackRegionDescriptor } from '../ui/audio-player/playback-region.js';

// Containers whose picture the media element can decode; other files are audio only.
const VIDEO_EXTENSIONS = new Set(['3gp', 'm4v', 'mkv', 'mov', 'mp4', 'webm']);
// Larger drifts jump to the audible position; smaller ones are absorbed by the rate.
const SEEK_DRIFT = 0.25;
const PAUSED_DRIFT = 1 / 60;
const RATE_CORRECTION = 0.5;
const MAX_RATE_CORRECTION = 0.05;

function extensionOf(name) {
    return typeof name === 'string' ? name.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)?.[1]?.toLowerCase() : undefined;
}

function isVideoTrack(track, source) {
    return [track.path, track.file?.name, track.name, typeof source === 'string' ? source : source.name]
        .some(name => VIDEO_EXTENSIONS.has(extensionOf(name)));
}

// Plays the current track's picture on a hidden muted element that follows the audible position.
export class VisualizerVideo {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.element = null;
        this.source = null;
        this.url = null;
        this.ready = false;
        this.enabled = false;
        this.active = false;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) this.load(null);
    }

    setActive(active) {
        this.active = active;
        if (!active) this.element?.pause();
    }

    // Returns the element when it has a frame to draw for the current track, or null.
    frame() {
        if (!this.enabled || !this.active) return null;
        const player = this.uiManager.audioPlayer;
        // OpenHome can retain the player and its last track after the UI closes.
        const snapshot = player?.ui?.container ? player.stateManager?.getStateSnapshot() : null;
        const track = snapshot?.currentTrack;
        const source = track && !hasPlaybackRegionDescriptor(track) ? track.mediaSource ?? track.file ?? track.path ?? null : null;
        const playable = (source instanceof Blob || (typeof source === 'string' && source)) && isVideoTrack(track, source);
        this.load(playable ? source : null);
        const video = this.element;
        if (!this.source || !this.ready) return null;
        const position = snapshot.isPlaying ? player.contextManager.getCurrentPlaybackTime() : snapshot.currentTrackPosition;
        const target = this.uiManager.audioManager.getAudiblePlaybackPosition(position, snapshot.playbackSpeed);
        const drift = video.currentTime - target;
        if (snapshot.isPlaying && target < video.duration) {
            if (!video.seeking && (drift > SEEK_DRIFT || drift < -SEEK_DRIFT)) video.currentTime = target;
            const correction = -drift * RATE_CORRECTION;
            video.playbackRate = snapshot.playbackSpeed * (1 + (correction > MAX_RATE_CORRECTION ? MAX_RATE_CORRECTION
                : correction < -MAX_RATE_CORRECTION ? -MAX_RATE_CORRECTION : correction));
            if (video.paused) video.play().catch(error => console.warn('[VisualizerVideo] Video playback did not start:', error));
        } else {
            if (!video.paused) video.pause();
            if (!video.seeking && (drift > PAUSED_DRIFT || drift < -PAUSED_DRIFT)) video.currentTime = target;
        }
        return video;
    }

    load(source) {
        if (source === this.source) return;
        this.source = source;
        this.ready = false;
        if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
        if (!source) {
            if (this.element?.hasAttribute('src')) { this.element.pause(); this.element.removeAttribute('src'); this.element.load(); }
            return;
        }
        const video = this.element ||= this.createElement();
        if (source instanceof Blob) video.src = this.url = URL.createObjectURL(source);
        else video.src = this.uiManager.audioPlayer.contextManager.getMediaElementSourceUrl(source);
    }

    createElement() {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        // Audio-only files in video containers load without a picture and stay hidden.
        video.addEventListener('loadeddata', () => { this.ready = video.videoWidth > 0; });
        video.addEventListener('error', () => console.warn('[VisualizerVideo] The video could not be decoded:', video.error));
        return video;
    }
}
