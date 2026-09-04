const AUDIO_MIME_TYPES = Object.freeze({
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm'
});

export function getAudioMimeType(fileName) {
  const extension = String(fileName || '').split('.').pop().toLowerCase();
  return AUDIO_MIME_TYPES[extension] || 'audio/mpeg';
}
