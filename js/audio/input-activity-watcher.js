/**
 * InputActivityWatcher - detects audio activity on a MediaStreamTrack
 * WITHOUT opening any output device.
 *
 * It is used while the main AudioContext is suspended for sleep-mode power
 * saving (so the output device, and the downstream DAC/Amp, can power down).
 * A suspended AudioContext freezes the worklet, which is what normally
 * detects the input signal returning, so we need a wake-on-input detector
 * that does not depend on the context running. `MediaStreamTrackProcessor`
 * reads raw AudioData frames straight off a track with no AudioContext and
 * therefore opens no sink.
 *
 * Only the AC component matters - a constant DC offset is inaudible - so we
 * track min/max per frame and treat a block as "signal" when
 * (max - min) > acThreshold, mirroring the silence test in
 * plugins/audio-processor.js.
 */
export class InputActivityWatcher {
    /** @returns {boolean} whether the required API is available */
    static isSupported() {
        return typeof window.MediaStreamTrackProcessor !== 'undefined';
    }

    /**
     * @param {number} acThreshold - peak-to-peak amplitude above which a
     *   block counts as signal (linear, not dB).
     */
    constructor(acThreshold) {
        this._acThreshold = acThreshold;
        this._reader = null;
        this._track = null;
        this._stopped = true;
        this._warnedCopyFailure = false;
    }

    /**
     * Begin watching `sourceTrack`. `onSignal` fires once, the first time
     * audio activity is seen; the watcher then stops itself.
     * @returns {boolean} false if it could not start (caller should fall back)
     */
    start(sourceTrack, onSignal) {
        if (!InputActivityWatcher.isSupported() || !sourceTrack) return false;
        try {
            // Clone so MediaStreamTrackProcessor doesn't lock/consume the
            // track that the (suspended) MediaStreamAudioSourceNode still
            // references; the clone shares the same underlying source.
            this._track = sourceTrack.clone();
            const processor = new window.MediaStreamTrackProcessor({ track: this._track });
            this._reader = processor.readable.getReader();
        } catch (e) {
            console.warn('[InputActivityWatcher] failed to start:', e);
            this.stop();
            return false;
        }
        this._stopped = false;
        this._readLoop(onSignal);
        return true;
    }

    async _readLoop(onSignal) {
        const reader = this._reader;
        while (!this._stopped && reader) {
            let result;
            try {
                result = await reader.read();
            } catch {
                break;
            }
            if (this._stopped) break;
            const frame = result.value;
            if (result.done) break;
            if (!frame) continue;
            let active = false;
            try {
                active = this._frameHasSignal(frame);
            } finally {
                frame.close(); // AudioData must be closed to avoid leaks
            }
            if (active) {
                this.stop();
                try {
                    onSignal();
                } catch (e) {
                    console.warn('[InputActivityWatcher] onSignal threw:', e);
                }
                return;
            }
        }
    }

    /** @param {AudioData} frame */
    _frameHasSignal(frame) {
        const samples = frame.numberOfFrames;
        if (!samples) return false;
        const buf = new Float32Array(samples);
        try {
            // Read the first channel as planar float32.
            frame.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
        } catch (e) {
            if (!this._warnedCopyFailure) {
                this._warnedCopyFailure = true;
                console.warn('[InputActivityWatcher] AudioData.copyTo(f32-planar) failed:', e);
            }
            return false;
        }
        const threshold = this._acThreshold;
        let min = buf[0];
        let max = buf[0];
        for (let i = 1; i < samples; i++) {
            const s = buf[i];
            if (s < min) min = s;
            else if (s > max) max = s;
            if (max - min > threshold) return true; // early-out
        }
        return max - min > threshold;
    }

    stop() {
        this._stopped = true;
        if (this._reader) {
            try {
                this._reader.cancel();
            } catch { /* already closed */ }
            try {
                this._reader.releaseLock();
            } catch { /* not held */ }
            this._reader = null;
        }
        if (this._track) {
            try {
                this._track.stop();
            } catch { /* already stopped */ }
            this._track = null;
        }
    }
}
