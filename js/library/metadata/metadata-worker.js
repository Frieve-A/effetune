import { parseBlob } from '../../vendor/music-metadata-browser.mjs';
import { createTrackFromMetadata, shouldRetryDuration } from './metadata-mapper.js';

self.addEventListener('message', async event => {
  const message = event.data || {};
  if (message.type !== 'parse') return;
  try {
    let metadata = await parseBlob(message.file, { duration: false, skipCovers: false });
    if (shouldRetryDuration(message.candidate, metadata)) {
      metadata = await parseBlob(message.file, { duration: true, skipCovers: false });
    }
    const track = createTrackFromMetadata(message.candidate, metadata, Date.now(), {
      languageHints: message.languageHints
    });
    const transfers = track.artworkBytes instanceof ArrayBuffer ? [track.artworkBytes] : [];
    self.postMessage({ id: message.id, ok: true, track }, transfers);
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: error?.message || String(error)
    });
  }
});
