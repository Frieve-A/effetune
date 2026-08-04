/**
 * iOS/iPadOS audio session type control.
 *
 * WebKit applies BackgroundProcessPlaybackRestricted to MediaType::WebAudio
 * unconditionally (MediaSessionManagerIOS::resetRestrictions), so a page that
 * renders through Web Audio alone is stopped as soon as it is backgrounded and
 * never becomes the OS "now playing" session - headset transport keys included.
 * The single documented override is
 * AudioContext::shouldOverrideBackgroundPlaybackRestriction() ->
 * hasPlayBackAudioSession(), which is also what gates
 * AudioContext::isNowPlayingEligible(). Both require navigator.audioSession.type
 * to be "playback" or "play-and-record".
 *
 * "playback" is not an option here: this app opens the microphone on startup and
 * keeps it open while the built-in player plays. AudioSession::setCategoryOverride()
 * beats the capture-derived category in MediaSessionManagerCocoa::updateSessionState(),
 * and BaseAudioCaptureUnit::startUnit() refuses to start on iOS unless the
 * category is PlayAndRecord - so "playback" would break live input capture, the
 * app's core function.
 *
 * "play-and-record" applied only while input capture is live or being acquired
 * is state-identical to the category WebKit already selects during capture, and
 * it unlocks both gates. The type therefore follows microphone liveness alone -
 * never the player's transport state - which keeps the applied category in
 * agreement with what the platform would have chosen anyway, avoids re-touching
 * the category on every playback start, and guarantees the right category is
 * already in place before getUserMedia() runs.
 */

/** Type that satisfies hasPlayBackAudioSession() without disabling capture. */
export const AUDIO_SESSION_CAPTURE_TYPE = 'play-and-record';
/** Type that hands the category decision back to the platform. */
export const AUDIO_SESSION_IDLE_TYPE = 'auto';

// Only these input states mean the microphone is - or is about to be - held.
const CAPTURE_INPUT_STATES = Object.freeze(['live', 'acquiring']);

// A rejected setter is either a permissions-policy block or an unimplemented
// property; neither clears itself. Retrying a bounded number of times keeps a
// transient failure recoverable without spinning on a session that will never
// accept the assignment.
const MAX_TYPE_FAILURES = 3;

function desiredAudioSessionType(inputResourceState) {
  return CAPTURE_INPUT_STATES.includes(inputResourceState)
    ? AUDIO_SESSION_CAPTURE_TYPE
    : AUDIO_SESSION_IDLE_TYPE;
}

/**
 * The type only matters where WebKit gates background Web Audio on it. Electron,
 * Android, and desktop browsers keep their current behavior untouched.
 *
 * The iOS detection is deliberately module-local: its counterpart is
 * usesIOSFilePicker() in js/ui-manager.js, and duplicating the few lines is
 * preferable to making js/audio depend on js/ui. Keep the two in sync.
 */
export function isAudioSessionTypeControlSupported({
  navigatorRef = null,
  isElectron = false
} = {}) {
  if (isElectron) return false;
  const session = navigatorRef?.audioSession;
  if (!session || typeof session !== 'object') return false;
  const userAgent = String(navigatorRef.userAgent || '');
  const platform = String(navigatorRef.platform || '');
  return /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === 'MacIntel' && Number(navigatorRef.maxTouchPoints || 0) > 1);
}

export class AudioSessionTypeController {
  constructor({ session = null } = {}) {
    this.session = session;
    // The applied value is tracked here rather than read back from
    // session.type: when the microphone permissions-policy is disabled WebKit
    // makes the setter a silent no-op while the getter keeps reporting 'auto',
    // so the property is not a usable source of truth.
    this.lastApplied = null;
    this.failureCount = 0;
    this.disposed = false;
  }

  /**
   * Mirror the microphone's resource state into the audio session type.
   * @param {string|null|undefined} inputResourceState AudioIOManager.inputResourceState
   */
  sync(inputResourceState) {
    if (this.disposed) return;
    this.applyType(desiredAudioSessionType(inputResourceState));
  }

  applyType(next) {
    if (this.disposed || next === this.lastApplied) return;
    if (this.failureCount >= MAX_TYPE_FAILURES) return;
    try {
      this.session.type = next;
      this.lastApplied = next;
      // A completed assignment proves the setter works, so earlier failures
      // were transient.
      this.failureCount = 0;
    } catch (error) {
      this.failureCount++;
      if (this.failureCount === MAX_TYPE_FAILURES) {
        console.warn('[AudioSessionType] navigator.audioSession.type could not be set; background playback and OS now-playing stay unavailable for this session.');
      }
      // lastApplied stays untouched so the next transition retries instead of
      // believing a value that was never written.
    }
  }

  dispose() {
    if (this.disposed) return;
    this.applyType(AUDIO_SESSION_IDLE_TYPE);
    this.disposed = true;
  }
}

/**
 * @returns {AudioSessionTypeController|null} null wherever the type is irrelevant
 */
export function createAudioSessionTypeController({
  navigatorRef = null,
  isElectron = false
} = {}) {
  if (!isAudioSessionTypeControlSupported({ navigatorRef, isElectron })) return null;
  return new AudioSessionTypeController({ session: navigatorRef.audioSession });
}
