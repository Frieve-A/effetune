'use strict';

const AUDIO_PREFERENCE_DEFAULTS = Object.freeze({
  inputDeviceId: '__effetune_no_audio_input__',
  midiInputDeviceKey: '',
  midiOutputDeviceKey: '',
  outputDeviceId: 'default',
  inputDeviceLabel: '',
  outputDeviceLabel: '',
  sampleRate: 96000,
  useInputWithPlayer: false,
  useWasmDsp: true,
  gaplessPlayback: true,
  replayGainMode: 'off',
  replayGainPreampDb: 0,
  replayGainPreventClipping: true,
  outputChannels: 2,
  latencyHint: 'interactive'
});

// Player-only preferences are applied in place without rebuilding audio.
const PLAYER_PREFERENCE_KEYS = Object.freeze([
  'gaplessPlayback',
  'replayGainMode',
  'replayGainPreampDb',
  'replayGainPreventClipping'
]);

const REPLAY_GAIN_MODES = Object.freeze(['off', 'track', 'album']);
const REPLAY_GAIN_PREAMP_LIMIT_DB = 15;

const AUDIO_PIPELINE_DEFAULTS = Object.freeze({
  outputDeviceId: AUDIO_PREFERENCE_DEFAULTS.outputDeviceId,
  sampleRate: AUDIO_PREFERENCE_DEFAULTS.sampleRate,
  useInputWithPlayer: AUDIO_PREFERENCE_DEFAULTS.useInputWithPlayer,
  useWasmDsp: AUDIO_PREFERENCE_DEFAULTS.useWasmDsp,
  outputChannels: AUDIO_PREFERENCE_DEFAULTS.outputChannels,
  latencyHint: AUDIO_PREFERENCE_DEFAULTS.latencyHint
});

function normalizeAudioPreferences(preferences) {
  const normalized = { ...(preferences || {}) };
  delete normalized.lowLatencyOutput;
  for (const [key, fallback] of Object.entries(AUDIO_PREFERENCE_DEFAULTS)) {
    normalized[key] = normalized[key] ?? fallback;
  }
  normalizeReplayGainPreferences(normalized);
  return normalized;
}

// Mirrors normalizeReplayGainPreferences in js/electron/webSettingsStorage.js.
function normalizeReplayGainPreferences(preferences) {
  if (!REPLAY_GAIN_MODES.includes(preferences.replayGainMode)) {
    preferences.replayGainMode = AUDIO_PREFERENCE_DEFAULTS.replayGainMode;
  }
  // Round to 0.5 dB steps; adding 0 turns -0 into 0 for Object.is comparisons.
  const preampDb = Math.round(Number(preferences.replayGainPreampDb) * 2) / 2 + 0;
  preferences.replayGainPreampDb = Number.isFinite(preampDb)
    ? (preampDb > REPLAY_GAIN_PREAMP_LIMIT_DB ? REPLAY_GAIN_PREAMP_LIMIT_DB
      : preampDb < -REPLAY_GAIN_PREAMP_LIMIT_DB ? -REPLAY_GAIN_PREAMP_LIMIT_DB : preampDb)
    : AUDIO_PREFERENCE_DEFAULTS.replayGainPreampDb;
  if (typeof preferences.replayGainPreventClipping !== 'boolean') {
    preferences.replayGainPreventClipping = AUDIO_PREFERENCE_DEFAULTS.replayGainPreventClipping;
  }
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
// Mirrors isPlayerPreferenceOnlyChange in js/electron/audio-preference-store.js.
const DEVICE_LABEL_ID_KEYS = Object.freeze({
  inputDeviceLabel: 'inputDeviceId',
  outputDeviceLabel: 'outputDeviceId'
});

const MIDI_DEVICE_KEYS = Object.freeze(['midiInputDeviceKey', 'midiOutputDeviceKey']);

function isPlayerPreferenceOnlyChange(previousPreferences, nextPreferences) {
  return isPreferenceOnlyChange(previousPreferences, nextPreferences, PLAYER_PREFERENCE_KEYS);
}

function isMidiDeviceOnlyChange(previousPreferences, nextPreferences) {
  return isPreferenceOnlyChange(previousPreferences, nextPreferences, MIDI_DEVICE_KEYS);
}

function isPreferenceOnlyChange(previousPreferences, nextPreferences, fields) {
  const previous = normalizeAudioPreferences(previousPreferences);
  const next = mergeAudioPreferences(previousPreferences, nextPreferences);
  if (fields.every(field => previous[field] === next[field])) return false;
  const keys = new Set([
    ...Object.keys(previous),
    ...Object.keys(next)
  ]);
  return [...keys].every(key => fields.includes(key) ||
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
  if (applyInPlace === 'midi-devices') {
    return MIDI_DEVICE_KEYS.every(key => typeof next[key] === 'string') &&
      isMidiDeviceOnlyChange(previous, next);
  }
  if (applyInPlace === 'player-preferences') {
    return isPlayerPreferenceOnlyChange(previous, next);
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
  PLAYER_PREFERENCE_KEYS,
  normalizeAudioPreferences,
  mergeAudioPreferences,
  audioPipelineConfigurationEqual,
  isPlayerPreferenceOnlyChange,
  isMidiDeviceOnlyChange,
  canPersistAudioPreferencesWithoutReload
};
