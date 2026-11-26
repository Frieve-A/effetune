import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { normalizeMtimeMs } from '../js/library/scan/file-signature.js';
import { checkReplayGainTags, TAG_EXTENSIONS, tagValues } from '../js/library/loudness/tag-formats.js';
import { readBytes, readTagLayout } from './loudness-tag-formats.mjs';

const CHUNK = 1024 * 1024;

async function append(file, bytes) {
  let i = 0;
  while (i < bytes.length) {
    const { bytesWritten } = await file.write(bytes, i, bytes.length - i);
    if (!bytesWritten) throw new Error('Tag write made no progress');
    i += bytesWritten;
  }
}

async function copy(source, target, start, end) {
  for (let offset = start; offset < end; offset += CHUNK) {
    await append(target, await readBytes(source, offset, Math.min(CHUNK, end - offset)));
  }
}

async function verifyMedia(file, temporary, source, output) {
  if (source.mediaLength !== output.mediaLength ||
      source.offsets?.length !== output.offsets?.length ||
      source.offsets?.some((offset, i) => offset !== output.offsets[i])) {
    throw new Error('Media layout changed');
  }
  for (let i = 0; i < source.mediaLength; i += CHUNK) {
    const length = Math.min(CHUNK, source.mediaLength - i);
    const [a, b] = await Promise.all([readBytes(file, source.mediaStart + i, length),
      readBytes(temporary, output.mediaStart + i, length)]);
    if (!a.equals(b)) throw new Error('Encoded audio changed');
  }
}

async function verifyTags(filename, tags) {
  const { native } = await parseFile(filename, { skipCovers: true, duration: false });
  checkReplayGainTags(native, tags);
}

function sameSignature(stats, size, mtimeMs) {
  return stats.isFile() && stats.size === size && normalizeMtimeMs(stats.mtimeMs) === mtimeMs;
}

function sameFile(current, opened) {
  return current?.isFile() && current.dev === opened.dev && current.ino === opened.ino;
}

function sameRevision(current, opened) {
  return sameFile(current, opened) && current.size === opened.size && current.mtimeMs === opened.mtimeMs;
}

export async function writeLoudnessTagsToFile(filename, track, { filesystem = fs, beforeVerify, beforeReplace } = {}) {
  const extension = path.extname(filename).toLowerCase();
  const tags = tagValues(track);
  if (track.sourceKind !== 'file' || !tags.REPLAYGAIN_TRACK_GAIN || !TAG_EXTENSIONS.includes(extension)) {
    return { status: 'unsupported' };
  }
  let file, temporary, temporaryPath, temporaryIdentity;
  try {
    file = await filesystem.open(filename, 'r+');
    const opened = await file.stat();
    if (!sameSignature(opened, track.size, track.mtimeMs)) return { status: 'changed' };
    if (!(opened.mode & 0o222)) return { status: 'unavailable' };
    const source = await readTagLayout(file, opened.size, extension, tags);
    const candidate = path.join(path.dirname(filename), `.effetune-${randomUUID()}.tmp`);
    temporary = await filesystem.open(candidate, 'wx+', 0o600);
    temporaryPath = candidate;
    temporaryIdentity = await temporary.stat();
    await copy(file, temporary, 0, source.start);
    await append(temporary, source.replacement);
    await copy(file, temporary, source.end, opened.size);
    await beforeVerify?.(temporaryPath);
    const written = await temporary.stat();
    const output = await readTagLayout(temporary, written.size, extension, tags);
    await verifyMedia(file, temporary, source, output);
    await verifyTags(temporaryPath, tags);
    await temporary.chmod(opened.mode & 0o777);
    await temporary.sync();
    // Windows requires both handles closed to replace the destination.
    await temporary.close();
    temporary = null;
    await file.close();
    file = null;
    await beforeReplace?.(temporaryPath);
    const [current, staged] = await Promise.all([filesystem.lstat(filename), filesystem.lstat(temporaryPath)]);
    if (!sameRevision(current, opened) || !sameRevision(staged, written)) return { status: 'changed' };
    await filesystem.rename(temporaryPath, filename);
    temporaryPath = null;
    return { status: 'written', size: written.size, mtimeMs: normalizeMtimeMs(written.mtimeMs) };
  } catch (error) {
    if (['EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'EROFS'].includes(error.code)) return { status: 'unavailable' };
    if (error.code === 'UNSUPPORTED_TAG' || error instanceof RangeError) return { status: 'unsupported' };
    console.warn('ReplayGain tag verification or write failed:', error);
    return { status: 'failed' };
  } finally {
    await Promise.all([file?.close(), temporary?.close()]);
    if (temporaryPath && temporaryIdentity) {
      const current = await filesystem.lstat(temporaryPath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (sameFile(current, temporaryIdentity)) await filesystem.rm(temporaryPath, { force: true });
    }
  }
}
