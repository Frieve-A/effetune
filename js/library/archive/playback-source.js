import { findArchiveWrdEntry, getArchiveEntryPath } from './score-entries.js';
import { attachLyricsFiles } from '../../ui/audio-player/lyrics-file-links.js';

export async function readArchivePlaybackEntry(archive, track) {
  const path = getArchiveEntryPath(track.relativePath, track.entryKey);
  if (!path || !archive.entries.some(entry => entry.path === path)) {
    throw Object.assign(new Error('Archived score is unavailable'), { code: 'sourceUnavailable' });
  }
  const bytes = await archive.read(path);
  const sibling = findArchiveWrdEntry(archive, path);
  let wrd = null;
  if (sibling) {
    try {
      wrd = { name: sibling.path.split('/').at(-1), bytes: await archive.read(sibling.path) };
    } catch (error) {
      console.warn('Archived WRD could not be read', error);
    }
  }
  return { fileName: path.split('/').at(-1), bytes, wrd };
}

export function archivePlaybackFile({ fileName, bytes, wrd }) {
  const file = new File([bytes], fileName);
  const wrdFile = wrd ? new File([wrd.bytes], wrd.name) : null;
  if (wrdFile) attachLyricsFiles([file], [wrdFile]);
  return { file, wrdFile };
}
