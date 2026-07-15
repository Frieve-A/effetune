export const PAGED_ARTWORK_MAX_CONCURRENCY = 4;
export const PAGED_ARTWORK_MAX_CACHE_ENTRIES = 96;

export class PagedArtworkLoader {
  constructor({
    loadArtwork,
    observerClass = globalThis.IntersectionObserver,
    urlApi = globalThis.URL,
    maxConcurrency = PAGED_ARTWORK_MAX_CONCURRENCY,
    maxCacheEntries = PAGED_ARTWORK_MAX_CACHE_ENTRIES
  } = {}) {
    if (typeof loadArtwork !== 'function') throw new TypeError('loadArtwork must be a function');
    this.loadArtwork = loadArtwork;
    this.urlApi = urlApi;
    this.maxConcurrency = maxConcurrency;
    this.maxCacheEntries = maxCacheEntries;
    this.queue = [];
    this.active = 0;
    this.cache = new Map();
    this.targets = new Map();
    this.destroyed = false;
    this.observer = typeof observerClass === 'function'
      ? new observerClass(entries => this.handleIntersections(entries), { rootMargin: '160px' })
      : null;
  }

  observe(element, artworkId) {
    if (!element || !artworkId || this.destroyed) return;
    this.targets.set(element, String(artworkId));
    element.dataset.artworkId = String(artworkId);
    element.classList?.add?.('library-artwork-pending');
    if (this.observer) this.observer.observe(element);
    else this.enqueue(element);
  }

  unobserve(element) {
    this.targets.delete(element);
    this.observer?.unobserve?.(element);
    const queued = this.queue.indexOf(element);
    if (queued >= 0) this.queue.splice(queued, 1);
  }

  handleIntersections(entries = []) {
    for (const entry of entries) {
      if (entry?.isIntersecting) this.enqueue(entry.target);
    }
  }

  enqueue(element) {
    if (!this.targets.has(element) || this.queue.includes(element)) return;
    this.observer?.unobserve?.(element);
    this.queue.push(element);
    this.pump();
  }

  pump() {
    while (!this.destroyed && this.active < this.maxConcurrency && this.queue.length > 0) {
      const element = this.queue.shift();
      const artworkId = this.targets.get(element);
      if (!artworkId) continue;
      this.active += 1;
      void this.load(element, artworkId).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  async load(element, artworkId) {
    try {
      let entry = this.cache.get(artworkId);
      if (!entry) {
        const value = await this.loadArtwork(artworkId);
        if (!value) throw new Error('Artwork is unavailable');
        entry = this.createCacheEntry(value);
        this.cache.set(artworkId, entry);
        this.trimCache();
      } else {
        this.cache.delete(artworkId);
        this.cache.set(artworkId, entry);
      }
      if (this.destroyed || this.targets.get(element) !== artworkId) return;
      const image = element.ownerDocument?.createElement?.('img') || globalThis.document?.createElement?.('img');
      if (!image) return;
      image.alt = '';
      image.className = 'library-artwork-image';
      image.addEventListener?.('error', () => this.showError(element, artworkId), { once: true });
      image.src = entry.url;
      element.replaceChildren?.(image);
      element.classList?.remove?.('library-artwork-pending', 'library-artwork-error');
    } catch (_) {
      this.showError(element, artworkId);
    }
  }

  createCacheEntry(value) {
    if (typeof value === 'string') return { url: value, owned: false };
    if (typeof Blob !== 'undefined' && value instanceof Blob && typeof this.urlApi?.createObjectURL === 'function') {
      return { url: this.urlApi.createObjectURL(value), owned: true };
    }
    throw new TypeError('Artwork loader accepts only URLs or Blob values');
  }

  showError(element, artworkId) {
    if (this.destroyed || this.targets.get(element) !== artworkId) return;
    element.replaceChildren?.();
    element.classList?.remove?.('library-artwork-pending');
    element.classList?.add?.('library-artwork-error');
  }

  trimCache() {
    while (this.cache.size > this.maxCacheEntries) {
      const [key, entry] = this.cache.entries().next().value;
      this.cache.delete(key);
      this.releaseEntry(entry);
    }
  }

  releaseEntry(entry) {
    if (!entry?.owned || typeof this.urlApi?.revokeObjectURL !== 'function') return;
    this.urlApi.revokeObjectURL(entry.url);
  }

  destroy() {
    this.destroyed = true;
    this.observer?.disconnect?.();
    this.queue.length = 0;
    this.targets.clear();
    for (const entry of this.cache.values()) this.releaseEntry(entry);
    this.cache.clear();
  }
}
