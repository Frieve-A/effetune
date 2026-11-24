'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AUDIO_PREFERENCE_DEFAULTS = Object.freeze({
  audioDriver: 'standard',
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
  replayGainTarget: 'manual',
  replayGainPreampDb: 0,
  replayGainAutoCoverage: 95,
  replayGainPreventClipping: true,
  replayGainPeakCeilingDb: 0,
  outputChannels: 2,
  latencyHint: 'interactive'
});

// Player-only preferences are applied in place without rebuilding audio.
const PLAYER_PREFERENCE_KEYS = Object.freeze([
  'gaplessPlayback',
  'replayGainMode',
  'replayGainTarget',
  'replayGainPreampDb',
  'replayGainAutoCoverage',
  'replayGainPreventClipping',
  'replayGainPeakCeilingDb'
]);

const REPLAY_GAIN_MODES = Object.freeze(['off', 'track', 'album']);
const REPLAY_GAIN_PREAMP_LIMIT_DB = 15;

const AUDIO_PIPELINE_DEFAULTS = Object.freeze({
  audioDriver: AUDIO_PREFERENCE_DEFAULTS.audioDriver,
  outputDeviceId: AUDIO_PREFERENCE_DEFAULTS.outputDeviceId,
  sampleRate: AUDIO_PREFERENCE_DEFAULTS.sampleRate,
  useInputWithPlayer: AUDIO_PREFERENCE_DEFAULTS.useInputWithPlayer,
  useWasmDsp: AUDIO_PREFERENCE_DEFAULTS.useWasmDsp,
  outputChannels: AUDIO_PREFERENCE_DEFAULTS.outputChannels,
  latencyHint: AUDIO_PREFERENCE_DEFAULTS.latencyHint
});

function initializeAudioPreferences(configPath, preferencesPath, nativeDriver) {
  try {
    // Existing profiles can have a config file without any audio preferences.
    if (fs.statSync(configPath, { throwIfNoEntry: false })) return;
    fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
    fs.writeFileSync(preferencesPath, JSON.stringify({ audioDriver: nativeDriver }, null, 2), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') console.warn('Could not initialize audio preferences:', error);
  }
}

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
  preferences.replayGainTarget = preferences.replayGainTarget === 'auto' ? 'auto' : 'manual';
  const coverage = Math.round(Number(preferences.replayGainAutoCoverage));
  preferences.replayGainAutoCoverage = Number.isFinite(coverage)
    ? Math.max(1, Math.min(100, coverage)) : AUDIO_PREFERENCE_DEFAULTS.replayGainAutoCoverage;
  const ceiling = Math.round(Number(preferences.replayGainPeakCeilingDb) * 2) / 2;
  preferences.replayGainPeakCeilingDb = Number.isFinite(ceiling)
    ? Math.max(-15, Math.min(0, ceiling)) + 0 : AUDIO_PREFERENCE_DEFAULTS.replayGainPeakCeilingDb;
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
  initializeAudioPreferences,
  normalizeAudioPreferences,
  mergeAudioPreferences,
  audioPipelineConfigurationEqual,
  isPlayerPreferenceOnlyChange,
  isMidiDeviceOnlyChange,
  canPersistAudioPreferencesWithoutReload
};
