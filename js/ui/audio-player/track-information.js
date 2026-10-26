const INFORMATION_FIELDS = [
  ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['albumArtist', 'Album artist'],
  ['composer', 'Composer'], ['genre', 'Genre'], ['comment', 'Comment'],
  ['date', 'Date'], ['originalTrackNumber', 'Track number'],
  ['contentDescription', 'Content description'], ['category', 'Category'], ['description', 'Description'],
  ['format', 'Format'], ['keywords', 'Keywords'], ['longContentDescription', 'Description']
];

export function getTrackInformation(track, metadata = track?.meta) {
  if (!track) return null;
  const format = {};
  for (const key of ['sampleRate', 'bitsPerSample', 'channels', 'bitrate']) {
    const value = Number.isFinite(track[key]) && track[key] > 0 ? track[key] : track.meta?.[key];
    if (Number.isFinite(value) && value > 0) format[key] = value;
  }
  const codec = track.codec?.trim?.() || track.meta?.codec?.trim?.();
  if (codec) format.codec = codec;
  return { metadata: { ...track.meta, ...metadata }, format };
}

// Shared presentation for the Player and Visualizer; sorting tags are not display information.
export function formatTrackInformation(information, translate = (_key, fallback) => fallback, sourceName = '') {
  if (!information) return '';
  const lines = sourceName ? [sourceName] : [];
  for (const [key, fallback] of INFORMATION_FIELDS) {
    const value = information.metadata?.[key];
    const text = typeof value === 'string' ? value.trim() : Number.isFinite(value) ? String(value) : '';
    if (text) lines.push(`${translate(`airPlay.information.${key}`, fallback)}: ${text}`);
  }
  if (information.sender?.name) lines.push(`${translate('airPlay.information.sender', 'Sender')}: ${information.sender.name}`);
  if (Number.isFinite(information.sender?.volumePercent)) {
    lines.push(`${translate('airPlay.information.senderVolume', 'Sender volume')}: ${Math.round(information.sender.volumePercent)}%`);
  }
  const format = information.format || {};
  const airPlay = sourceName === 'AirPlay';
  if (airPlay && format.codec) lines.push(`${translate('airPlay.information.codec', 'Received audio')}: ${format.codec}`);
  const audioFormat = [
    !airPlay ? format.codec : '',
    format.sampleRate ? `${format.sampleRate / 1000} kHz` : '',
    format.bitsPerSample ? `${format.bitsPerSample}-bit` : '',
    format.channels ? `${format.channels} ch` : '',
    !airPlay && format.bitrate ? `${Math.round(format.bitrate / 1000)} kbps` : ''
  ].filter(Boolean).join(' / ');
  if (audioFormat) lines.push(`${airPlay ? translate('airPlay.information.receiverFormat', 'Receiver PCM')
    : translate('airPlay.information.sourceFormat', 'Source audio')}: ${audioFormat}`);
  return lines.join('\n');
}
