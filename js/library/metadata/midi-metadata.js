import { parseSmf, SMF_MAX_BYTES } from '../../midi/smf-parser.js';
import { isScoreFile, isMusicXmlFile, parseScoreAsync, SCORE_MAX_BYTES } from '../../midi/score-file.js';
import { createFallbackTrack } from './metadata-mapper.js';

export { SMF_MAX_BYTES, SCORE_MAX_BYTES, isScoreFile };

export async function createScoreTrackMetadata(candidate, bytes, now = Date.now(), languageHints = null, signal = null) {
  try {
    const timeline = await parseScoreAsync(bytes, { fileName: candidate.fileName, languageHints, signal });
    return { ...createFallbackTrack(candidate, now), title: timeline.title,
      durationSec: timeline.duration, codec: isMusicXmlFile(candidate.fileName) ? 'MusicXML' : 'MIDI' };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw scoreMetadataError(error);
  }
}

export async function createArchiveEntryTrackMetadata(candidate, archive, entryPath, now, languageHints, signal) {
  let bytes;
  try {
    bytes = await archive.read(entryPath, { signal });
  } catch (error) {
    if (error?.code?.startsWith?.('archive-')) throw scoreMetadataError(error);
    throw error;
  }
  const fileName = entryPath.split('/').at(-1);
  return createScoreTrackMetadata({ ...candidate, fileName, ext: fileName.split('.').at(-1).toLowerCase() },
    bytes, now, languageHints, signal);
}

export function scoreMetadataError(error) {
  const mapped = new Error('The score file could not be read.', { cause: error });
  mapped.code = error.code?.endsWith('-too-large') ? 'metadata-too-large'
    : error.code?.endsWith('-unsupported') ? 'unsupported-container' : 'corrupt-container';
  return mapped;
}

export function createMidiTrackMetadata(candidate, bytes, now = Date.now(), languageHints = null) {
  try {
    const timeline = parseSmf(bytes, { fileName: candidate.fileName, languageHints });
    return { ...createFallbackTrack(candidate, now), title: timeline.title,
      durationSec: timeline.duration, codec: 'MIDI' };
  } catch (error) {
    const mapped = new Error('The MIDI file could not be read.', { cause: error });
    mapped.code = error.code === 'midi-too-large' ? 'metadata-too-large'
      : error.code === 'midi-unsupported' ? 'unsupported-container' : 'corrupt-container';
    throw mapped;
  }
}
