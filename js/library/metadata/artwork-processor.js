import { createArtworkId } from '../id-utils.js';

export class ArtworkProcessor {
  constructor(database) {
    this.database = database;
    this.urlCache = new Map();
    this.pendingUrls = new Map();
    this.maxUrls = 200;
  }

  async storeArtworkBytes(bytes, sourceKind = 'embedded', options = {}) {
    if (sourceKind && typeof sourceKind === 'object') {
      options = sourceKind;
      sourceKind = options.sourceKind || 'embedded';
    }
    if (!bytes || bytes.byteLength === 0) return null;
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const id = options.id || await createArtworkId(raw);
    const refCountDelta = normalizeRefCount(options.refCount);
    const existing = await this.database.getArtwork(id);
    if (existing) {
      existing.refCount = (existing.refCount || 0) + refCountDelta;
      await this.database.putArtwork(existing);
      return id;
    }
    const blob = await this.createThumbBlob(raw, options.mime);
    await this.database.putArtwork({ id, thumb: blob, sourceKind, refCount: refCountDelta });
    return id;
  }

  async createThumbBlob(raw, mime = 'image/jpeg') {
    const inputBlob = new Blob([raw], { type: normalizeMime(mime) });
    if (typeof createImageBitmap !== 'function') return inputBlob;

    let bitmap = null;
    try {
      bitmap = await createImageBitmap(inputBlob);
      const maxSize = 512;
      const scale = bitmap.width > maxSize || bitmap.height > maxSize
        ? maxSize / Math.max(bitmap.width, bitmap.height)
        : 1;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = createCanvas(width, height);
      if (!canvas) return inputBlob;
      const context = canvas.getContext('2d');
      if (!context) return inputBlob;
      context.drawImage(bitmap, 0, 0, width, height);

      if (typeof canvas.convertToBlob === 'function') {
        return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
      }

      if (typeof canvas.toBlob === 'function') {
        const output = await new Promise(resolve => {
          canvas.toBlob(resolve, 'image/jpeg', 0.82);
        });
        return output || inputBlob;
      }
    } catch (_) {
      return inputBlob;
    } finally {
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }

    return inputBlob;
  }

  async getThumbURL(artworkId) {
    if (!artworkId || typeof URL === 'undefined') return '';
    if (this.urlCache.has(artworkId)) {
      const url = this.urlCache.get(artworkId);
      this.urlCache.delete(artworkId);
      this.urlCache.set(artworkId, url);
      return url;
    }
    if (this.pendingUrls.has(artworkId)) {
      return this.pendingUrls.get(artworkId);
    }
    const pending = this.loadThumbURL(artworkId);
    this.pendingUrls.set(artworkId, pending);
    try {
      return await pending;
    } finally {
      this.pendingUrls.delete(artworkId);
    }
  }

  async loadThumbURL(artworkId) {
    const artwork = await this.database.getArtwork(artworkId);
    if (!artwork?.thumb) return '';
    const url = URL.createObjectURL(artwork.thumb);
    this.urlCache.set(artworkId, url);
    this.pruneCache();
    return url;
  }

  pruneCache() {
    while (this.urlCache.size > this.maxUrls) {
      const [id, url] = this.urlCache.entries().next().value;
      this.urlCache.delete(id);
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // Ignore stale object URLs.
      }
    }
  }

  dispose() {
    for (const url of this.urlCache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // Ignore stale object URLs.
      }
    }
    this.urlCache.clear();
  }
}

function normalizeRefCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return 1;
  return Math.floor(number);
}

function normalizeMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/') ? mime : 'image/jpeg';
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}
