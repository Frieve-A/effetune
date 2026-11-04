const AUDIO_MIME_TYPES = Object.freeze({
  dsf: 'audio/x-dsf',
  dff: 'audio/x-dff',
  mid: 'audio/midi',
  midi: 'audio/midi',
  kar: 'audio/midi',
  musicxml: 'application/vnd.recordare.musicxml+xml',
  xml: 'application/vnd.recordare.musicxml+xml',
  mxl: 'application/vnd.recordare.musicxml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp'
});

export function getAudioMimeType(fileName) {
  const extension = String(fileName || '').split('.').pop().toLowerCase();
  return AUDIO_MIME_TYPES[extension] || 'audio/mpeg';
}
