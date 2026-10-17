'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const PCM_FORMATS = new Map([[16, 'LEI16'], [20, 'LEI24'], [24, 'LEI24'], [32, 'LEI32']]);
const SAMPLE_TABLE_PATH = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd'];

// Read only box headers and the sample description, never media payloads.
async function probeAlac(handle, byteLength) {
  let remainingBoxes = 4096;
  async function read(position, length) {
    const bytes = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset);
      if (!bytesRead) throw new Error('Truncated MP4 header');
      offset += bytesRead;
    }
    return bytes;
  }

  async function boxAt(start, end) {
    if (--remainingBoxes < 0) throw new Error('MP4 box probe limit exceeded');
    if (end - start < 8) return null;
    const header = await read(start, 8);
    let size = header.readUInt32BE(0);
    let headerSize = 8;
    if (size === 1) {
      if (end - start < 16) return null;
      size = Number((await read(start + 8, 8)).readBigUInt64BE());
      headerSize = 16;
    } else if (size === 0) {
      size = end - start;
    }
    if (!Number.isSafeInteger(size) || size < headerSize || size > end - start) return null;
    return { type: header.toString('ascii', 4, 8), start: start + headerSize, end: start + size };
  }

  async function configDepth(start, end, allowWave = true) {
    while (start < end) {
      const box = await boxAt(start, end);
      if (!box) break;
      if (box.type === 'alac' && box.end - box.start >= 28) {
        // FullBox flags (4), then ALACSpecificConfig: frameLength (4),
        // compatibleVersion (1), bitDepth (1).
        return (await read(box.start, 10))[9];
      }
      if (box.type === 'wave' && allowWave) {
        const depth = await configDepth(box.start, box.end, false);
        if (depth !== null) return depth;
      }
      start = box.end;
    }
    return null;
  }

  async function sampleDescription(start, end) {
    if (end - start < 8) return null;
    const count = (await read(start, 8)).readUInt32BE(4);
    start += 8;
    for (let index = 0; index < count && start < end; index++) {
      const entry = await boxAt(start, end);
      if (!entry) break;
      if (entry.type === 'alac') {
        if (entry.end - entry.start < 28) return { bitDepth: null };
        const version = (await read(entry.start + 8, 2)).readUInt16BE();
        const entrySize = version === 0 ? 28 : version === 1 ? 44 : version === 2 ? 64 : null;
        return { bitDepth: entrySize === null ? null : await configDepth(entry.start + entrySize, entry.end) };
      }
      start = entry.end;
    }
    return null;
  }

  async function walk(start, end, depth) {
    while (start < end) {
      const box = await boxAt(start, end);
      if (!box) break;
      if (box.type === SAMPLE_TABLE_PATH[depth]) {
        const result = depth === SAMPLE_TABLE_PATH.length - 1
          ? await sampleDescription(box.start, box.end)
          : await walk(box.start, box.end, depth + 1);
        if (depth === 0 || result) return result;
      }
      start = box.end;
    }
    return null;
  }
  return walk(0, byteLength, 0);
}

class AlacPlaybackSource {
  constructor({ platform = process.platform, executeFile = execFile, tempRoot = os.tmpdir() } = {}) {
    this.platform = platform;
    this.executeFile = executeFile;
    this.tempRoot = tempRoot;
    this.directoryPromise = null;
    this.cache = new Map();
    this.inFlight = new Map();
    this.children = new Set();
    this.nextFileId = 0;
    this.disposed = false;
    this.disposePromise = null;
  }

  async prepare(filePath) {
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      return { success: false, code: 'invalidPlaybackSource' };
    }
    if (this.disposed) return { success: false, code: 'playbackSourceUnavailable' };
    let canonicalPath;
    let stats;
    let alac;
    try {
      canonicalPath = await fs.realpath(path.resolve(filePath));
      const handle = await fs.open(canonicalPath, 'r');
      try {
        stats = await handle.stat();
        if (!stats.isFile()) throw new Error('Not a playback file');
        const extension = path.extname(canonicalPath).toLowerCase();
        if (extension === '.m4a' || extension === '.mp4') alac = await probeAlac(handle, stats.size);
      } finally {
        await handle.close();
      }
    } catch (error) {
      console.error('Failed to probe local playback source:', error);
      return { success: false, code: 'playbackSourceUnavailable' };
    }
    if (this.disposed) return { success: false, code: 'playbackSourceUnavailable' };
    if (!alac) return { success: true, path: canonicalPath, byteLength: stats.size, converted: false };
    if (this.platform !== 'darwin') return { success: false, code: 'alacRequiresMacDesktop' };
    const format = PCM_FORMATS.get(alac.bitDepth);
    if (!format) return { success: false, code: 'alacConversionFailed' };
    const key = JSON.stringify([canonicalPath, stats.size, stats.mtimeMs]);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const pending = this.convert(canonicalPath, format, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  async convert(source, format, key) {
    let temporaryPath;
    let finalPath;
    try {
      this.directoryPromise ??= fs.mkdtemp(path.join(this.tempRoot, 'effetune-alac-'))
        .then(directory => fs.realpath(directory));
      const directory = await this.directoryPromise;
      if (this.disposed) throw new Error('Playback converter disposed');
      finalPath = path.join(directory, `${++this.nextFileId}.wav`);
      temporaryPath = `${finalPath}.tmp`;
      await new Promise((resolve, reject) => {
        let child;
        let completed = false;
        child = this.executeFile('/usr/bin/afconvert', ['-f', 'WAVE', '-d', format, source, temporaryPath], error => {
          completed = true;
          this.children.delete(child);
          if (error) reject(error);
          else resolve();
        });
        if (!completed) this.children.add(child);
      });
      if (this.disposed) throw new Error('Playback converter disposed');
      await fs.rename(temporaryPath, finalPath);
      const stats = await fs.stat(finalPath);
      const result = { success: true, path: finalPath, byteLength: stats.size, converted: true };
      this.cache.set(key, result);
      while (this.cache.size > 4) {
        const [oldestKey, oldest] = this.cache.entries().next().value;
        this.cache.delete(oldestKey);
        await fs.unlink(oldest.path);
      }
      return result;
    } catch (error) {
      console.error('Failed to convert ALAC playback source:', error);
      this.cache.delete(key);
      await Promise.allSettled([temporaryPath, finalPath].filter(Boolean).map(file => fs.rm(file, { force: true })));
      return { success: false, code: 'alacConversionFailed' };
    }
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    for (const child of this.children) child.kill('SIGKILL');
    this.disposePromise = (async () => {
      await Promise.allSettled(this.inFlight.values());
      if (this.directoryPromise) {
        const directory = await this.directoryPromise;
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
      this.cache.clear();
    })();
    return this.disposePromise;
  }
}

module.exports = { AlacPlaybackSource, probeAlac };
