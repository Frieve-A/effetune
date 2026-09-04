'use strict';

const AUDIO_PREFERENCE_DEFAULTS = Object.freeze({
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  inputDeviceLabel: '',
  outputDeviceLabel: '',
  sampleRate: 96000,
  useInputWithPlayer: false,
  lowLatencyOutput: false,
  useWasmDsp: true,
  gaplessPlayback: true,
  outputChannels: 2,
  latencyHint: 'interactive'
});

const AUDIO_PIPELINE_DEFAULTS = Object.freeze({
  outputDeviceId: AUDIO_PREFERENCE_DEFAULTS.outputDeviceId,
  sampleRate: AUDIO_PREFERENCE_DEFAULTS.sampleRate,
  useInputWithPlayer: AUDIO_PREFERENCE_DEFAULTS.useInputWithPlayer,
  lowLatencyOutput: AUDIO_PREFERENCE_DEFAULTS.lowLatencyOutput,
  useWasmDsp: AUDIO_PREFERENCE_DEFAULTS.useWasmDsp,
  outputChannels: AUDIO_PREFERENCE_DEFAULTS.outputChannels,
  latencyHint: AUDIO_PREFERENCE_DEFAULTS.latencyHint
});

function normalizeAudioPreferences(preferences) {
  const normalized = { ...(preferences || {}) };
  for (const [key, fallback] of Object.entries(AUDIO_PREFERENCE_DEFAULTS)) {
    normalized[key] = normalized[key] ?? fallback;
  }
  return normalized;
}

function mergeAudioPreferences(previousPreferences, nextPreferences) {
  return normalizeAudioPreferences({
    ...(previousPreferences || {}),
    ...(nextPreferences || {})
  });
}

function audioPipelineConfigurationEqual(left, right) {
  if (!left || !right) return false;
  return Object.entries(AUDIO_PIPELINE_DEFAULTS).every(([key, fallback]) =>
    Object.is(left[key] ?? fallback, right[key] ?? fallback));
}

// Device labels are display-only and vary with locale, permission state, and
// reconnection; they are ignored while the matching device ID is unchanged.
// Mirrors isGaplessPlaybackOnlyChange in js/electron/audio-preference-store.js.
const DEVICE_LABEL_ID_KEYS = Object.freeze({
  inputDeviceLabel: 'inputDeviceId',
  outputDeviceLabel: 'outputDeviceId'
});

function isGaplessPlaybackOnlyChange(previousPreferences, nextPreferences) {
  const previous = normalizeAudioPreferences(previousPreferences);
  const next = mergeAudioPreferences(previousPreferences, nextPreferences);
  if (previous.gaplessPlayback === next.gaplessPlayback) return false;
  const keys = new Set([
    ...Object.keys(previous),
    ...Object.keys(next)
  ]);
  return [...keys].every(key => key === 'gaplessPlayback' ||
    Object.is(previous[key], next[key]) ||
    (key in DEVICE_LABEL_ID_KEYS &&
      Object.is(previous[DEVICE_LABEL_ID_KEYS[key]], next[DEVICE_LABEL_ID_KEYS[key]])));
}

function canPersistAudioPreferencesWithoutReload(
  previousPreferences,
  nextPreferences,
  options,
  noAudioInputDeviceId
) {
  const previous = normalizeAudioPreferences(previousPreferences);
  const next = mergeAudioPreferences(previousPreferences, nextPreferences);
  const applyInPlace = options?.applyInPlace;
  if (applyInPlace === 'gapless-playback') {
    return isGaplessPlaybackOnlyChange(previous, next);
  }
  if (applyInPlace === 'output-device-fallback') {
    const previousOutputDeviceId = previous.outputDeviceId;
    if (!previousOutputDeviceId || previousOutputDeviceId === 'default' ||
        next.outputDeviceId !== 'default' || next.outputDeviceLabel !== '') {
      return false;
    }
    const ignoredKeys = new Set(['outputDeviceId', 'outputDeviceLabel']);
    const keys = new Set([
      ...Object.keys(previous),
      ...Object.keys(next)
    ]);
    return [...keys].every(key => ignoredKeys.has(key) ||
      Object.is(previous[key], next[key]));
  }
  if (!audioPipelineConfigurationEqual(previous, next)) return false;
  if (applyInPlace === 'silent-input') {
    return next.inputDeviceId === noAudioInputDeviceId &&
      previous.inputDeviceId !== noAudioInputDeviceId;
  }
  if (applyInPlace === 'silent-input-rollback') {
    return previous.inputDeviceId === noAudioInputDeviceId &&
      next.inputDeviceId !== noAudioInputDeviceId;
  }
  return false;
}

module.exports = {
  AUDIO_PREFERENCE_DEFAULTS,
  AUDIO_PIPELINE_DEFAULTS,
  normalizeAudioPreferences,
  mergeAudioPreferences,
  audioPipelineConfigurationEqual,
  isGaplessPlaybackOnlyChange,
  canPersistAudioPreferencesWithoutReload
};
