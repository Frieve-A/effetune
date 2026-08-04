/**
 * Media session anchor for mobile browsers.
 *
 * Android Chrome only grants a page an OS-level media session - the "now
 * playing" notification, headset transport keys, and the permission to keep
 * audio running once the page is hidden - while an HTMLMediaElement is
 * playing. The player renders through Web Audio
 * (AudioBufferSourceNode -> worklet -> AudioContext.destination) and the
 * mobile output path holds no media element at all, so
 * navigator.mediaSession metadata never reaches the OS and the browser
 * suspends the context in the background.
 *
 * This module plays a near-silent looping element beside - never inside - the
 * audio graph purely to anchor that session. The playback path is untouched:
 * the element is never connected to the AudioContext and carries no audible
 * signal of its own.
 */

const DEFAULT_SAMPLE_RATE = 8000;
// Chromium ignores media shorter than a few seconds when deciding whether a
// page owns a media session, so the loop body stays well above that bar.
const DEFAULT_DURATION_SECONDS = 10;
// 2^-24 is half of a 24-bit LSB (-144.5 dBFS): every integer sink quantizes it
// to digital silence, while the decoded stream itself stays non-zero.
const DEFAULT_AMPLITUDE = 2 ** -24;
const WAV_HEADER_BYTES = 58;
const FLOAT_FORMAT_TAG = 3;
const BYTES_PER_SAMPLE = 4;
// A single element error is usually transient (a decode hiccup, a teardown
// race, an out-of-memory blip), so the anchor rebuilds the element instead of
// disabling itself for the lifetime of the page. Repeated failures are treated
// as permanent to avoid spinning on an element the browser will never accept.
const MAX_ELEMENT_FAILURES = 3;

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index++) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/**
 * Build a mono 32-bit float WAV whose peak sits below a 24-bit LSB.
 * @returns {ArrayBuffer} WAV file bytes
 */
export function createSilentAnchorWav({
  sampleRate = DEFAULT_SAMPLE_RATE,
  durationSeconds = DEFAULT_DURATION_SECONDS,
  amplitude = DEFAULT_AMPLITUDE
} = {}) {
  const frames = Math.max(1, Math.round(sampleRate * durationSeconds));
  const dataBytes = frames * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');

  // Float WAV keeps the extended fmt chunk (cbSize) plus a fact chunk so
  // strict decoders accept the file.
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 18, true);
  view.setUint16(20, FLOAT_FORMAT_TAG, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  view.setUint16(36, 0, true);

  writeAscii(view, 38, 'fact');
  view.setUint32(42, 4, true);
  view.setUint32(46, frames, true);

  writeAscii(view, 50, 'data');
  view.setUint32(54, dataBytes, true);

  // Alternating sign keeps the loop free of DC while staying inaudible.
  for (let frame = 0; frame < frames; frame++) {
    const sample = frame % 2 === 0 ? amplitude : -amplitude;
    view.setFloat32(WAV_HEADER_BYTES + frame * BYTES_PER_SAMPLE, sample, true);
  }

  return buffer;
}

/**
 * The anchor only helps where the output path has no media element of its own
 * and the browser gates background audio on one. Electron and desktop keep
 * their current behavior untouched.
 */
export function isMediaSessionAnchorSupported({
  navigatorRef = null,
  audioCtor = null,
  blobCtor = null,
  urlRef = null,
  isElectron = false
} = {}) {
  if (isElectron) return false;
  if (typeof audioCtor !== 'function' || typeof blobCtor !== 'function') return false;
  if (typeof urlRef?.createObjectURL !== 'function') return false;
  if (!navigatorRef?.mediaSession) return false;
  return /android/i.test(String(navigatorRef.userAgent || ''));
}

export class MediaSessionAnchor {
  constructor({
    stateManager = null,
    audioCtor,
    blobCtor,
    urlRef,
    documentRef = null,
    sampleRate,
    durationSeconds,
    amplitude
  } = {}) {
    this.stateManager = stateManager;
    this.audioCtor = audioCtor;
    this.blobCtor = blobCtor;
    this.urlRef = urlRef;
    this.documentRef = documentRef;
    this.wavOptions = { sampleRate, durationSeconds, amplitude };
    this.element = null;
    this.objectUrl = null;
    this.disposed = false;
    this.failureCount = 0;
    this.desiredPlaying = false;
    this.gestureRetryArmed = false;
    this.syncPromise = null;
    this.syncVersion = 0;
    this.onPlayingChange = () => this.sync();
    this.onGesture = () => {
      this.gestureRetryArmed = false;
      this.sync();
    };
    this.onElementError = () => this.handleElementFailure();

    this.stateManager?.addListener?.('isPlaying', this.onPlayingChange);
    this.sync();
  }

  sync() {
    if (this.disposed) return this.syncPromise || Promise.resolve();
    this.desiredPlaying = this.stateManager?.getStateSnapshot?.()?.isPlaying === true;
    this.syncVersion++;
    return this.ensureSync();
  }

  ensureSync() {
    if (!this.syncPromise) {
      this.syncPromise = this.runSync();
    }
    return this.syncPromise;
  }

  async runSync() {
    // Yield once so ensureSync() has stored this promise before the loop can
    // clear it: the pause path below is otherwise fully synchronous, and the
    // finally block would then null out a field that was never assigned.
    await Promise.resolve();
    let seenVersion = 0;
    try {
      while (seenVersion !== this.syncVersion) {
        seenVersion = this.syncVersion;
        if (this.desiredPlaying && !this.disposed) {
          await this.startAnchor();
        } else {
          this.pauseAnchor();
        }
      }
    } finally {
      this.syncPromise = null;
    }
  }

  async startAnchor() {
    const element = this.ensureElement();
    if (!element) return;
    try {
      const result = element.play?.();
      if (result?.then) await result;
      // The element is confirmed playable, so earlier failures were transient.
      this.failureCount = 0;
    } catch (error) {
      // Autoplay policy rejections and play()/pause() races both land here.
      // The next user gesture is the cheapest reliable retry point.
      this.armGestureRetry();
    }
  }

  pauseAnchor() {
    if (!this.element) return;
    try {
      this.element.pause?.();
    } catch (error) {
      // A pause race leaves the element in a benign state; nothing to undo.
    }
  }

  ensureElement() {
    if (this.element || this.disposed) return this.element;
    if (this.failureCount >= MAX_ELEMENT_FAILURES) return null;
    try {
      const blob = new this.blobCtor([createSilentAnchorWav(this.wavOptions)], { type: 'audio/wav' });
      // Owned from here on so releaseElement() revokes it even when the steps
      // below throw.
      this.objectUrl = this.urlRef.createObjectURL(blob);
      const element = new this.audioCtor();
      element.loop = true;
      element.preload = 'auto';
      element.volume = 1;
      element.muted = false;
      // The anchor is a local session token, so it must never be offered as a
      // remote target and occupy the Cast/AirPlay route the real audio needs.
      element.disableRemotePlayback = true;
      element.addEventListener?.('error', this.onElementError);
      element.src = this.objectUrl;
      this.element = element;
      return element;
    } catch (error) {
      this.handleElementFailure();
      return null;
    }
  }

  handleElementFailure() {
    this.failureCount++;
    if (this.failureCount === MAX_ELEMENT_FAILURES) {
      console.warn('[MediaSessionAnchor] Silent anchor element failed repeatedly; background playback, OS metadata, and headset keys stay unavailable for this session.');
    }
    this.releaseElement();
  }

  releaseElement() {
    const element = this.element;
    const objectUrl = this.objectUrl;
    this.element = null;
    this.objectUrl = null;
    if (element) {
      try {
        element.pause?.();
        element.removeEventListener?.('error', this.onElementError);
        element.removeAttribute?.('src');
        element.load?.();
      } catch (error) {
        // Teardown races are harmless; the element is dropped either way.
      }
    }
    if (objectUrl) {
      try {
        this.urlRef?.revokeObjectURL?.(objectUrl);
      } catch (error) {
        // Ignore revoke failures on platforms that already dropped the URL.
      }
    }
  }

  armGestureRetry() {
    if (this.gestureRetryArmed || this.disposed) return;
    if (typeof this.documentRef?.addEventListener !== 'function') return;
    this.gestureRetryArmed = true;
    this.documentRef.addEventListener('pointerdown', this.onGesture, { once: true, passive: true });
  }

  releaseGestureRetry() {
    if (!this.gestureRetryArmed) return;
    this.gestureRetryArmed = false;
    this.documentRef?.removeEventListener?.('pointerdown', this.onGesture);
  }

  dispose() {
    if (this.disposed) return this.syncPromise || Promise.resolve();
    this.disposed = true;
    this.desiredPlaying = false;
    this.syncVersion++;
    this.stateManager?.removeListener?.('isPlaying', this.onPlayingChange);
    this.releaseGestureRetry();
    this.releaseElement();
    this.stateManager = null;
    return this.syncPromise || Promise.resolve();
  }
}

/**
 * @returns {MediaSessionAnchor|null} null wherever the anchor is unnecessary
 */
export function createMediaSessionAnchor({
  stateManager = null,
  windowRef = null,
  navigatorRef = windowRef?.navigator ?? null,
  documentRef = windowRef?.document ?? null,
  audioCtor = windowRef?.Audio ?? null,
  blobCtor = windowRef?.Blob ?? null,
  urlRef = windowRef?.URL ?? null,
  isElectron = false,
  ...wavOptions
} = {}) {
  if (!stateManager) return null;
  if (!isMediaSessionAnchorSupported({ navigatorRef, audioCtor, blobCtor, urlRef, isElectron })) {
    return null;
  }
  return new MediaSessionAnchor({
    stateManager,
    audioCtor,
    blobCtor,
    urlRef,
    documentRef,
    ...wavOptions
  });
}
