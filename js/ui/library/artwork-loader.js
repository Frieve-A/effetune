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
    this.inFlight = new Map();
    this.targets = new Map();
    this.loadGeneration = 0;
    this.destroyed = false;
    this.observer = typeof observerClass === 'function'
      ? new observerClass(entries => this.handleIntersections(entries), { rootMargin: '160px' })
      : null;
  }

  observe(element, artworkId) {
    if (!element || !artworkId || this.destroyed) return;
    const normalizedArtworkId = String(artworkId);
    const generation = this.loadGeneration;
    this.targets.set(element, { artworkId: normalizedArtworkId, generation });
    element.dataset.artworkId = normalizedArtworkId;
    element.classList?.add?.('library-artwork-pending');
    const cachedEntry = this.getCachedEntry(normalizedArtworkId);
    if (cachedEntry) {
      this.showArtwork(element, normalizedArtworkId, cachedEntry, generation);
      return;
    }
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
      const target = this.targets.get(element);
      if (!target) continue;
      this.active += 1;
      void this.load(element, target.artworkId, target.generation);
    }
  }

  async load(element, artworkId, generation) {
    try {
      const entry = await this.getOrLoadEntry(artworkId, generation);
      if (!entry) return;
      this.showArtwork(element, artworkId, entry, generation);
    } catch (_) {
      this.showError(element, artworkId, generation);
    } finally {
      this.active -= 1;
      this.pump();
    }
  }

  getOrLoadEntry(artworkId, generation) {
    const cached = this.getCachedEntry(artworkId);
    if (cached) return Promise.resolve(cached);
    const current = this.inFlight.get(artworkId);
    if (current?.generation === generation) return current.promise;

    const record = { generation, promise: null };
    record.promise = (async () => {
      const value = await this.loadArtwork(artworkId);
      if (!value) throw new Error('Artwork is unavailable');
      const entry = this.createCacheEntry(value);
      if (this.destroyed || generation !== this.loadGeneration) {
        this.releaseEntry(entry);
        return null;
      }
      const winner = this.getCachedEntry(artworkId);
      if (winner) {
        this.releaseEntry(entry);
        return winner;
      }
      this.cache.set(artworkId, entry);
      this.trimCache();
      return entry;
    })();
    const clearInFlight = () => {
      if (this.inFlight.get(artworkId) === record) this.inFlight.delete(artworkId);
    };
    void record.promise.then(clearInFlight, clearInFlight);
    this.inFlight.set(artworkId, record);
    return record.promise;
  }

  getCachedEntry(artworkId) {
    const entry = this.cache.get(artworkId);
    if (!entry) return null;
    this.cache.delete(artworkId);
    this.cache.set(artworkId, entry);
    return entry;
  }

  showArtwork(element, artworkId, entry, generation) {
    const target = this.targets.get(element);
    if (this.destroyed || target?.artworkId !== artworkId || target.generation !== generation) return;
    const image = element.ownerDocument?.createElement?.('img') || globalThis.document?.createElement?.('img');
    if (!image) return;
    image.alt = '';
    image.className = 'library-artwork-image';
    image.addEventListener?.('error', () => this.showError(element, artworkId, generation), { once: true });
    image.src = entry.url;
    element.replaceChildren?.(image);
    element.classList?.remove?.('library-artwork-pending', 'library-artwork-error');
  }

  createCacheEntry(value) {
    if (typeof value === 'string') return { url: value, owned: false };
    if (typeof Blob !== 'undefined' && value instanceof Blob && typeof this.urlApi?.createObjectURL === 'function') {
      return { url: this.urlApi.createObjectURL(value), owned: true };
    }
    throw new TypeError('Artwork loader accepts only URLs or Blob values');
  }

  showError(element, artworkId, generation) {
    const target = this.targets.get(element);
    if (this.destroyed || target?.artworkId !== artworkId || target.generation !== generation) return;
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

  resetTargets() {
    this.loadGeneration += 1;
    this.observer?.disconnect?.();
    this.queue.length = 0;
    this.targets.clear();
  }

  destroy() {
    this.destroyed = true;
    this.resetTargets();
    for (const entry of this.cache.values()) this.releaseEntry(entry);
    this.cache.clear();
    this.inFlight.clear();
  }
}
