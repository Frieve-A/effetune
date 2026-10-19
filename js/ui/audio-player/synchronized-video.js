// Larger drifts jump to the audible position; smaller ones are absorbed by the rate.
const SEEK_DRIFT = 0.25;
const PAUSED_DRIFT = 1 / 60;
const RATE_CORRECTION = 0.5;
const MAX_RATE_CORRECTION = 0.05;

// A muted display decoder shared by the player and Visualizer; the audio source stays independent.
export class SynchronizedVideo {
    constructor() {
        this.current = null;
        this.pending = null;
        this.tail = null;
        this.contextTime = 0;
        this.resetToken = undefined;
        this.enabled = false;
        this.active = false;
    }

    get element() {
        const entry = this.current;
        return entry?.failed || (entry?.ready && !entry.element?.videoWidth) ? null : entry?.element || null;
    }
    get source() { return this.current?.source || null; }
    get url() { return this.current?.url || null; }
    get ready() { return this.current?.ready === true && !!this.element; }
    get needsFrame() {
        return !!this.tail && (this.tailPosition() < this.tail.endPosition || !!this.pending);
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
    frame(target, playbackSpeed, isPlaying) {
        if (!this.enabled || !this.active) return null;
        if (this.tail) {
            const position = this.tailPosition();
            if (position >= this.tail.endPosition && this.pending?.ready && target >= 0 &&
                this.prepareHandoff(this.pending, target, isPlaying)) {
                this.release(this.current);
                this.current = this.pending;
                this.pending = null;
                this.tail = null;
            } else {
                target = position;
                playbackSpeed = this.tail.playbackSpeed;
                isPlaying = position < this.tail.endPosition;
            }
        }
        if (!this.source || !this.ready) return null;
        const video = this.element;
        // The signed audible clock is also used by lyrics; only video holds at zero.
        const beforeStart = target < 0;
        target = Math.max(0, Math.min(target, video.duration));
        const drift = video.currentTime - target;
        const entry = this.current;
        const recoveryLag = this.seekRecoveryLag(entry, drift);
        if (isPlaying && !beforeStart && target < video.duration) {
            // Calling play() on an ended decoder implicitly rewinds it, even for a tiny drift.
            if (!video.seeking && (video.ended || drift > SEEK_DRIFT || drift < -SEEK_DRIFT - recoveryLag)) {
                this.seek(entry, target);
            }
            const correction = -drift * RATE_CORRECTION;
            video.playbackRate = playbackSpeed * (1 + (correction > MAX_RATE_CORRECTION ? MAX_RATE_CORRECTION
                : correction < -MAX_RATE_CORRECTION ? -MAX_RATE_CORRECTION : correction));
            if (video.paused && !video.seeking && !video.ended) {
                video.play().catch(error => console.warn('[SynchronizedVideo] Video playback did not start:', error));
            }
        } else {
            entry.seekRecoveryLag = 0;
            entry.syncSeekPending = false;
            if (!video.paused) video.pause();
            if (!video.seeking && (drift > PAUSED_DRIFT || drift < -PAUSED_DRIFT)) video.currentTime = target;
        }
        return video;
    }

    seek(entry, target) {
        entry.element.currentTime = target;
        entry.seekRecoveryLag = 0;
        entry.syncSeekPending = entry.element.seeking;
    }

    seekRecoveryLag(entry, drift) {
        if (entry.syncSeekPending && !entry.element.seeking) {
            // The target advances while a seek decodes. Recover that lag by playing, not seeking again.
            entry.seekRecoveryLag = Math.max(0, -drift);
            entry.syncSeekPending = false;
        }
        const recoveryLag = entry.seekRecoveryLag || 0;
        entry.seekRecoveryLag = Math.min(recoveryLag, Math.max(0, -drift));
        return recoveryLag;
    }

    prepareHandoff(entry, target, isPlaying) {
        const video = entry.element;
        if (entry.failed || !video?.videoWidth) return true;
        target = Math.max(0, Math.min(target, video.duration));
        const drift = video.currentTime - target;
        const playing = isPlaying && target < video.duration;
        const tolerance = playing ? SEEK_DRIFT : PAUSED_DRIFT;
        if (entry.aligned && !video.seeking && video.readyState >= 2) {
            const recoveryLag = playing ? this.seekRecoveryLag(entry, drift) : 0;
            if (drift <= tolerance && drift >= -tolerance - recoveryLag) return true;
        }
        if (entry.aligned !== false) {
            if (video.currentTime === target && !video.seeking && video.readyState >= 2) return true;
            // Initial presentation needs its requested frame, not the normal playback drift tolerance.
            entry.aligned = false;
            this.seek(entry, target);
        }
        return false;
    }

    load(source) {
        this.release(this.pending);
        this.pending = null;
        this.tail = null;
        if (source === this.source) return;
        this.release(this.current);
        this.current = source ? this.createSource(source, source) : null;
    }

    setPresentation({ generation, source, resetToken, naturalEnd, contextTime }) {
        if (!this.enabled) return;
        this.contextTime = contextTime;
        if (this.resetToken !== resetToken) {
            if (this.current) {
                this.current.seekRecoveryLag = 0;
                this.current.syncSeekPending = false;
            }
            this.release(this.pending);
            this.pending = null;
            this.tail = null;
            this.resetToken = resetToken;
        }
        if (naturalEnd && this.current?.generation === naturalEnd.generation) this.tail = naturalEnd;
        if (this.current?.generation === generation && this.source === source) return;
        if (this.tail && this.current?.generation === this.tail.generation) {
            if (this.pending?.generation !== generation || this.pending?.source !== source) {
                this.release(this.pending);
                this.pending = this.createSource(source, generation);
            }
            return;
        }
        this.load(source);
        if (this.current) this.current.generation = generation;
    }

    tailPosition() {
        return Math.min(this.tail.endPosition, this.tail.targetAtEnd +
            Math.max(0, this.contextTime - this.tail.contextTimeAtEnd) * this.tail.playbackSpeed);
    }

    release(entry) {
        if (!entry) return;
        const video = entry.element;
        if (video) {
            video.removeEventListener('loadeddata', entry.onLoaded);
            video.removeEventListener('seeked', entry.onSeeked);
            video.removeEventListener('error', entry.onError);
            video.pause();
            video.removeAttribute('src');
            video.load();
        }
        if (entry.url) URL.revokeObjectURL(entry.url);
    }

    createSource(source, generation) {
        const entry = { source, generation, element: null, url: null, ready: !source };
        if (!source) return entry;
        const video = entry.element = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        // Audio-only files in video containers load without a picture and stay hidden.
        entry.onLoaded = () => { entry.ready = true; };
        // seeked follows availability of the image at the requested playback position.
        entry.onSeeked = () => {
            if (entry.aligned === false && !video.seeking && video.readyState >= 2) entry.aligned = true;
        };
        entry.onError = () => {
            entry.ready = true;
            entry.failed = true;
            console.warn('[SynchronizedVideo] The video could not be decoded:', video.error);
        };
        video.addEventListener('loadeddata', entry.onLoaded);
        video.addEventListener('seeked', entry.onSeeked);
        video.addEventListener('error', entry.onError);
        if (source instanceof Blob) video.src = entry.url = URL.createObjectURL(source);
        else video.src = source;
        return entry;
    }
}
