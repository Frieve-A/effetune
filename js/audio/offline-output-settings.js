const WAV_SAMPLE_FORMATS = Object.freeze([
  Object.freeze({ id: 'pcm16', labelKey: 'dialog.config.offlineOutput.wav.pcm16' }),
  Object.freeze({ id: 'pcm24', labelKey: 'dialog.config.offlineOutput.wav.pcm24' }),
  Object.freeze({ id: 'float32', labelKey: 'dialog.config.offlineOutput.wav.float32' })
]);

const FLAC_SAMPLE_FORMATS = Object.freeze([
  Object.freeze({ id: 'pcm16', labelKey: 'dialog.config.offlineOutput.flac.pcm16' }),
  Object.freeze({ id: 'pcm24', labelKey: 'dialog.config.offlineOutput.flac.pcm24' })
]);

const LOSSLESS_SAMPLE_RATES = Object.freeze([44100, 48000, 88200, 96000, 176400, 192000]);

export const DEFAULT_OFFLINE_OUTPUT_SETTINGS = Object.freeze({
  format: 'wav',
  sampleRate: 96000,
  wavSampleFormat: 'pcm24',
  flacSampleFormat: 'pcm24'
});

export const OFFLINE_OUTPUT_FORMATS = Object.freeze({
  wav: Object.freeze({
    id: 'wav',
    labelKey: 'dialog.config.offlineOutput.format.wav',
    filterLabel: 'WAV Audio',
    extension: 'wav',
    mimeType: 'audio/wav',
    sampleRates: LOSSLESS_SAMPLE_RATES,
    defaultSampleRate: 96000,
    qualityType: 'wavSampleFormat',
    qualityOptions: WAV_SAMPLE_FORMATS,
    defaultQuality: 'pcm24',
    maxChannels: 16
  }),
  flac: Object.freeze({
    id: 'flac',
    labelKey: 'dialog.config.offlineOutput.format.flac',
    filterLabel: 'FLAC Audio',
    extension: 'flac',
    mimeType: 'audio/flac',
    sampleRates: LOSSLESS_SAMPLE_RATES,
    defaultSampleRate: 96000,
    qualityType: 'flacSampleFormat',
    qualityOptions: FLAC_SAMPLE_FORMATS,
    defaultQuality: 'pcm24',
    maxChannels: 8
  })
});

const isPlainObject = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export function getOfflineOutputFormat(id) {
  return typeof id === 'string' && Object.hasOwn(OFFLINE_OUTPUT_FORMATS, id)
    ? OFFLINE_OUTPUT_FORMATS[id]
    : OFFLINE_OUTPUT_FORMATS.wav;
}

export function normalizeOfflineOutputSettings(value) {
  const input = isPlainObject(value) ? value : {};
  const hasKnownFormat = typeof input.format === 'string' &&
    Object.hasOwn(OFFLINE_OUTPUT_FORMATS, input.format);
  if (!hasKnownFormat) return { ...DEFAULT_OFFLINE_OUTPUT_SETTINGS };
  const format = input.format;
  const definition = OFFLINE_OUTPUT_FORMATS[format];
  const sampleRate = definition.sampleRates.includes(input.sampleRate)
    ? input.sampleRate
    : definition.defaultSampleRate;

  return {
    format,
    sampleRate,
    wavSampleFormat: WAV_SAMPLE_FORMATS.some(option => option.id === input.wavSampleFormat)
      ? input.wavSampleFormat
      : DEFAULT_OFFLINE_OUTPUT_SETTINGS.wavSampleFormat,
    flacSampleFormat: FLAC_SAMPLE_FORMATS.some(option => option.id === input.flacSampleFormat)
      ? input.flacSampleFormat
      : DEFAULT_OFFLINE_OUTPUT_SETTINGS.flacSampleFormat
  };
}

export function snapshotOfflineOutputSettings(config) {
  return Object.freeze(normalizeOfflineOutputSettings(config?.offlineOutput));
}

export function validateOfflineOutputChannels(settings, channelCount) {
  const normalized = normalizeOfflineOutputSettings(settings);
  const format = getOfflineOutputFormat(normalized.format);
  if (!Number.isInteger(channelCount) || channelCount < 1) {
    throw new TypeError('channelCount must be a positive integer');
  }
  if (channelCount <= format.maxChannels) return format;

  const error = new Error(`${format.id} does not support ${channelCount} channels`);
  error.userMessageKey = 'error.offlineOutput.unsupportedChannels';
  error.userMessageValues = {
    format: format.id.toUpperCase(),
    maxChannels: format.maxChannels
  };
  throw error;
}
