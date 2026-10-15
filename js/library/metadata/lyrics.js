import { decodeTextFileBytes, TEXT_FILE_MAX_BYTES } from './text-encoding.js';

const TIME_TAG = /^(\d{1,6}):(\d{2})(?:\.(\d{1,3}))?$/;
const LYRICS_TAGS = new Set(['uslt', 'lyrics', 'unsyncedlyrics', '©lyr', 'wm/lyrics']);
// These shared text/word budgets keep even escaped JSON below the 512 KiB worker limit.
const MAX_LINES = 2048;
const MAX_CHARACTERS = 32768;
const MAX_LINE_CHARACTERS = 4096;
const MAX_WORDS = 2048;

function tagTime(value) {
  const match = TIME_TAG.exec(value);
  if (!match || Number(match[2]) >= 60) return null;
  return Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || '0'}`);
}

function enhancedWords(text, lineTime) {
  const tags = [...text.matchAll(/<(\d{1,6}:\d{2}(?:\.\d{1,3})?)>/g)]
    .map(match => ({ index: match.index, length: match[0].length, time: tagTime(match[1]) }))
    .filter(tag => tag.time !== null);
  if (!tags.length) return null;
  const words = [];
  if (tags[0].index > 0) words.push({ time: lineTime, text: text.slice(0, tags[0].index) });
  for (let index = 0; index < tags.length; index++) {
    const tag = tags[index];
    const word = text.slice(tag.index + tag.length, tags[index + 1]?.index ?? text.length);
    if (word || index === tags.length - 1) words.push({ time: tag.time, text: word });
  }
  return words;
}

export function parseLrc(text) {
  if (typeof text !== 'string') return null;
  let offset = 0;
  let timed = false;
  const lines = [];
  const plain = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    const times = [];
    let remaining = raw;
    let metadata = false;
    while (remaining.startsWith('[')) {
      const end = remaining.indexOf(']');
      if (end < 0) break;
      const tag = remaining.slice(1, end);
      const time = tagTime(tag);
      if (time !== null) {
        times.push(time);
        timed = true;
      } else if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(tag)) {
        const match = /^offset:([+-]?\d+)$/i.exec(tag);
        if (match && Number.isFinite(Number(match[1]))) offset = Number(match[1]) / 1000;
        metadata = true;
      } else break;
      remaining = remaining.slice(end + 1);
    }
    if (times.length) {
      const words = enhancedWords(remaining, times[0]);
      const lineText = words ? words.map(word => word.text).join('') : remaining;
      // Keep every line for later CUE selection without multiplying optional word timing.
      const keepWords = words?.length && words.length * times.length <= MAX_WORDS;
      for (const time of times) {
        const line = { time, text: lineText };
        if (keepWords) line.words = words.map(word => ({
          time: word.time + time - times[0], text: word.text
        }));
        lines.push(line);
      }
    } else if (!metadata && remaining.trim()) plain.push({ text: remaining });
  }
  if (!timed) return plain.length ? { synced: false, lines: plain } : null;
  for (const line of lines) {
    line.time -= offset;
    for (const word of line.words || []) word.time -= offset;
  }
  lines.sort((a, b) => a.time - b.time);
  return lines.length ? { synced: true, lines } : null;
}

export function lyricsFromLrcBytes(bytes) {
  try {
    if (bytes.byteLength > TEXT_FILE_MAX_BYTES) return null;
    return parseLrc(decodeTextFileBytes(bytes));
  } catch {
    return null;
  }
}

function lyricsFromSylt(value) {
  if (!Array.isArray(value?.syncText)) return null;
  const fragments = value.syncText.filter(fragment => typeof fragment?.text === 'string' &&
    Number.isFinite(fragment.timestamp));
  const lines = [];
  const append = pieces => {
    if (!pieces.length) return;
    const line = { time: pieces[0].time, text: pieces.map(piece => piece.text).join('') };
    if (pieces.length > 1) line.words = pieces;
    lines.push(line);
  };
  if (!fragments.some(fragment => /[\r\n]/.test(fragment.text))) {
    for (const fragment of fragments) {
      if (fragment.text) append([{ time: fragment.timestamp / 1000, text: fragment.text }]);
    }
  } else {
    let pieces = [];
    for (const fragment of fragments) {
      const parts = fragment.text.split(/\r\n|\n|\r/);
      for (let index = 0; index < parts.length; index++) {
        if (index > 0) {
          append(pieces);
          pieces = [];
        }
        if (parts[index]) pieces.push({ time: fragment.timestamp / 1000, text: parts[index] });
      }
    }
    append(pieces);
  }
  const synced = value.timeStampFormat === 2;
  if (synced) lines.sort((a, b) => a.time - b.time);
  return lines.length ? { synced, lines: synced ? lines : lines.map(line => ({ text: line.text })) } : null;
}

export function lyricsFromMetadata(parsed) {
  let unsynced = null;
  for (const tags of Object.values(parsed?.native || {})) {
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      const id = String(tag?.id || '').toLowerCase();
      let lyrics = null;
      if (id === 'sylt') lyrics = lyricsFromSylt(tag.value);
      else if (LYRICS_TAGS.has(id)) lyrics = parseLrc(typeof tag.value === 'string' ? tag.value : tag.value?.text);
      if (lyrics?.synced) return lyrics;
      if (lyrics && !unsynced) unsynced = lyrics;
    }
  }
  return unsynced;
}

export function lyricsCandidateNames({ fileName, cue = null }) {
  const name = String(fileName || '').split(/[\\/]/).at(-1);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const names = [];
  if (cue?.title) {
    if (cue.performer) names.push(`${cue.performer} - ${cue.title}`);
    names.push(cue.title);
  }
  if (base) names.push(base);
  return names;
}

export function findLyricsFileName(fileNames, names) {
  const key = name => name.normalize('NFC').toLowerCase();
  const listed = new Map();
  for (const fileName of fileNames) {
    if (typeof fileName === 'string' && !listed.has(key(fileName))) listed.set(key(fileName), fileName);
  }
  for (let index = 0; index < names.length; index++) {
    const candidate = `${names[index]}.lrc`.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_');
    const fileName = listed.get(key(candidate));
    if (fileName !== undefined) return { fileName, index };
  }
  return null;
}

function chooseLyrics(sidecar, embedded) {
  if (sidecar?.synced) return sidecar;
  if (embedded?.synced) return embedded;
  return sidecar || embedded || null;
}

export function selectLyrics({ sidecar = null, perTrack = false, embedded = null, region = null }) {
  if (perTrack && sidecar) return boundLyrics(sidecar);
  const lyrics = chooseLyrics(sidecar, embedded);
  if (!lyrics) return null;
  if (!region || (region.start === 0 && region.end === null)) return boundLyrics(lyrics);
  if (!lyrics.synced) return null;
  return boundLyrics({ synced: true, lines: lyrics.lines
    .filter(line => line.time >= region.start && (region.end === null || line.time < region.end))
    .map(line => ({ ...line, time: line.time - region.start,
      ...(line.words ? { words: line.words.map(word => ({ ...word, time: word.time - region.start })) } : {}) })) });
}

export function lyricsLineAt(lines, time) {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

export function boundLyrics(model) {
  if (!Array.isArray(model?.lines)) return null;
  const synced = model.synced === true;
  const lines = [];
  let characters = MAX_CHARACTERS;
  let wordsLeft = MAX_WORDS;
  for (const source of model.lines) {
    if (lines.length >= MAX_LINES || characters <= 0) break;
    if (typeof source?.text !== 'string' || (synced && !Number.isFinite(source.time))) continue;
    const text = source.text.slice(0, Math.min(MAX_LINE_CHARACTERS, characters));
    characters -= text.length;
    const line = synced ? { time: source.time, text } : { text };
    if (synced && Array.isArray(source.words)) {
      const words = [];
      for (const word of source.words) {
        if (wordsLeft <= 0 || characters <= 0) break;
        if (!Number.isFinite(word?.time) || typeof word.text !== 'string') continue;
        const wordText = word.text.slice(0, Math.min(MAX_LINE_CHARACTERS, characters));
        characters -= wordText.length;
        wordsLeft--;
        words.push({ time: word.time, text: wordText });
      }
      if (words.length) line.words = words;
    }
    lines.push(line);
  }
  return lines.length ? { synced, lines } : null;
}
