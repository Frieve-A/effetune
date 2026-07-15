import { assertRepositoryContract } from '../repository/contract-errors.js';
import {
  ARTWORK_LIMITS,
  ARTWORK_PLACEHOLDER,
  artworkCompletionMatchesClaim,
  assertArtworkHeader,
  calculateArtworkCachePolicy,
  createArtworkSourceClaim
} from './artwork-policy.js';

export const ARTWORK_REPOSITORY_METHODS = Object.freeze([
  'getCachedArtwork',
  'getArtworkSource',
  'claimArtworkSource',
  'preflightArtworkBatch',
  'publishArtwork',
  'recordArtworkFailure',
  'scheduleArtworkStagingGc',
  'evictArtworkCache'
]);

export const ARTWORK_EXTRACTOR_METHODS = Object.freeze([
  'readHeader',
  'createThumbnail'
]);

const LAZY_REASONS = new Set(['viewport', 'viewport-prefetch', 'detail', 'now-playing']);

export class LazyArtworkService {
  constructor({ repository, extractor, runtime = 'desktop', quotaBytes = 0, config = {} }) {
    assertMethods(repository, ARTWORK_REPOSITORY_METHODS, 'artwork repository');
    assertMethods(extractor, ARTWORK_EXTRACTOR_METHODS, 'artwork extractor');
    this.repository = repository;
    this.extractor = extractor;
    this.runtime = runtime;
    this.cachePolicy = calculateArtworkCachePolicy({ runtime, quotaBytes });
    const concurrency = config.concurrency ?? (runtime === 'mobile'
      ? ARTWORK_LIMITS.mobileConcurrency
      : ARTWORK_LIMITS.desktopConcurrency);
    assertRepositoryContract(Number.isSafeInteger(concurrency) && concurrency > 0, 'invalidArtworkConfig', 'Artwork concurrency must be positive');
    this.pool = new BoundedTaskPool(concurrency, config.maxQueuedRequests ?? ARTWORK_LIMITS.maxQueuedRequests);
    this.inFlight = new Map();
    this.memoryCache = new Map();
    this.memoryCacheBytes = 0;
  }

  async request({ trackUid, reason, signal } = {}) {
    assertRepositoryContract(typeof trackUid === 'string' && trackUid.length > 0, 'invalidArtworkRequest', 'trackUid is required');
    assertRepositoryContract(LAZY_REASONS.has(reason), 'invalidArtworkRequest', 'Artwork extraction is only available for lazy UI requests');
    if (signal?.aborted) throw abortReason(signal);

    const cached = await this.repository.getCachedArtwork({ trackUid, cacheMode: this.cachePolicy.mode });
    if (cached) return cached;
    if (signal?.aborted) throw abortReason(signal);
    const source = await this.repository.getArtworkSource({ trackUid });
    if (!source) return ARTWORK_PLACEHOLDER;
    if (signal?.aborted) throw abortReason(signal);
    const sourceKey = artworkSingleFlightKey(createArtworkSourceClaim(source));
    const memoryCached = this.#getMemoryCachedArtwork(sourceKey);
    if (memoryCached) return memoryCached;
    const existing = this.inFlight.get(sourceKey);
    if (existing) return this.#joinInFlight(existing, signal);

    const controller = new AbortController();
    const entry = { controller, consumers: 0, settled: false, sourceKey, promise: null };
    entry.promise = this.pool.run(() => this.#extract(source, controller.signal), controller.signal)
      .finally(() => {
        entry.settled = true;
        if (this.inFlight.get(sourceKey) === entry) this.inFlight.delete(sourceKey);
      });
    this.inFlight.set(sourceKey, entry);
    return this.#joinInFlight(entry, signal);
  }

  #joinInFlight(entry, signal) {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    entry.consumers += 1;
    return new Promise((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        entry.consumers -= 1;
        if (entry.consumers === 0 && !entry.settled) {
          if (this.inFlight.get(entry.sourceKey) === entry) this.inFlight.delete(entry.sourceKey);
          entry.controller.abort(createSharedAbortError());
        }
      };
      const finish = (callback, value) => {
        if (released) return;
        signal?.removeEventListener('abort', abort);
        release();
        callback(value);
      };
      const abort = () => finish(reject, abortReason(signal));
      signal?.addEventListener('abort', abort, { once: true });
      entry.promise.then(
        value => finish(resolve, value),
        error => finish(reject, error)
      );
    });
  }

  async #extract(source, signal) {
    const expectedClaim = createArtworkSourceClaim(source);
    let claim;

    try {
      const claimed = await this.repository.claimArtworkSource({ claim: expectedClaim });
      if (!claimed?.claim || !artworkCompletionMatchesClaim(expectedClaim, claimed.claim)) {
        return ARTWORK_PLACEHOLDER;
      }
      claim = createArtworkSourceClaim(claimed.claim);
      if (signal?.aborted) throw abortReason(signal);
      const header = assertArtworkHeader(await this.extractor.readHeader({
        claim,
        maxRawBytes: ARTWORK_LIMITS.maxRawBytes,
        signal
      }));
      if (this.cachePolicy.mode === 'persistent') {
        const preflight = await this.#preflightWithOneCacheEviction(claim, header);
        if (preflight?.ok !== true) {
          await this.repository.scheduleArtworkStagingGc({ claim, reason: 'storage-preflight' });
          return ARTWORK_PLACEHOLDER;
        }
      }

      const thumbnail = normalizeThumbnail(await this.extractor.createThumbnail({
        claim,
        header,
        maxWidth: ARTWORK_LIMITS.maxThumbnailWidth,
        maxHeight: ARTWORK_LIMITS.maxThumbnailHeight,
        maxBytes: ARTWORK_LIMITS.maxThumbnailBytes,
        signal
      }));
      if (this.cachePolicy.mode === 'memory-only') {
        const currentSource = await this.repository.getArtworkSource({ trackUid: claim.trackUid });
        if (!artworkCompletionMatchesClaim(claim, currentSource)) {
          await this.repository.scheduleArtworkStagingGc({ claim, reason: 'stale-source' });
          return ARTWORK_PLACEHOLDER;
        }
        await this.repository.scheduleArtworkStagingGc({ claim, reason: 'memory-only-complete' });
        return this.#cacheMemoryArtwork(
          artworkSingleFlightKey(claim),
          Object.freeze({ kind: 'thumbnail', ...thumbnail })
        );
      }
      return await this.#publishWithOneEvictionRetry(claim, thumbnail);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        if (claim) await this.repository.scheduleArtworkStagingGc({ claim, reason: 'canceled' });
        throw error;
      }
      if (isCatalogStorageFailure(error)) return ARTWORK_PLACEHOLDER;
      if (!claim) throw error;
      try {
        await this.#recordFailure(claim, sanitizeArtworkError(error));
      } catch (failureError) {
        if (isCatalogStorageFailure(failureError)) return ARTWORK_PLACEHOLDER;
        if (isOptionalCacheQuotaError(failureError)) return ARTWORK_PLACEHOLDER;
        throw failureError;
      }
      return ARTWORK_PLACEHOLDER;
    } finally {
      if (claim) await this.extractor.discard?.({ claim });
    }
  }

  #getMemoryCachedArtwork(sourceKey) {
    if (this.cachePolicy.mode !== 'memory-only') return null;
    const artwork = this.memoryCache.get(sourceKey);
    if (!artwork) return null;
    this.memoryCache.delete(sourceKey);
    this.memoryCache.set(sourceKey, artwork);
    return artwork;
  }

  #cacheMemoryArtwork(sourceKey, artwork) {
    const byteLength = artwork.bytes.byteLength;
    if (byteLength > this.cachePolicy.maxBytes) return artwork;
    const previous = this.memoryCache.get(sourceKey);
    if (previous) this.memoryCacheBytes -= previous.bytes.byteLength;
    this.memoryCache.delete(sourceKey);
    this.memoryCache.set(sourceKey, artwork);
    this.memoryCacheBytes += byteLength;
    while (this.memoryCacheBytes > this.cachePolicy.maxBytes) {
      const [oldestKey, oldestArtwork] = this.memoryCache.entries().next().value;
      this.memoryCache.delete(oldestKey);
      this.memoryCacheBytes -= oldestArtwork.bytes.byteLength;
    }
    return artwork;
  }

  async #publishWithOneEvictionRetry(claim, thumbnail) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const published = await this.repository.publishArtwork({
          claim,
          thumbnail,
          cachePolicy: this.cachePolicy,
          expectedSourceClaim: claim
        });
        if (!published?.committed) {
          await this.repository.scheduleArtworkStagingGc({ claim, reason: 'stale-source' });
          return ARTWORK_PLACEHOLDER;
        }
        return published.artwork ?? Object.freeze({ kind: 'thumbnail', ...thumbnail });
      } catch (error) {
        if (!isOptionalCacheQuotaError(error)) throw error;
        if (attempt === 0) {
          await this.repository.evictArtworkCache({
            mode: this.cachePolicy.mode,
            maxBytes: this.cachePolicy.maxBytes,
            requiredBytes: thumbnail.bytes.byteLength,
            policy: 'lru-access-time-byte-length'
          });
          continue;
        }
        await this.repository.scheduleArtworkStagingGc({ claim, reason: 'cache-full' });
        return ARTWORK_PLACEHOLDER;
      }
    }
    return ARTWORK_PLACEHOLDER;
  }

  async #preflightWithOneCacheEviction(claim, header) {
    const request = {
      claim,
      estimatedRawBytes: header.rawByteLength,
      estimatedThumbnailBytes: ARTWORK_LIMITS.maxThumbnailBytes,
      cachePolicy: this.cachePolicy
    };
    let preflight = await this.repository.preflightArtworkBatch(request);
    if (preflight?.code !== 'artwork-cache-full') return preflight;
    await this.repository.evictArtworkCache({
      mode: this.cachePolicy.mode,
      maxBytes: this.cachePolicy.maxBytes,
      requiredBytes: ARTWORK_LIMITS.maxThumbnailBytes,
      policy: 'lru-access-time-byte-length'
    });
    preflight = await this.repository.preflightArtworkBatch(request);
    return preflight;
  }

  async #recordFailure(claim, errorCode) {
    const recorded = await this.repository.recordArtworkFailure({
      claim,
      errorCode,
      placeholder: true,
      preserveExistingArtwork: true
    });
    if (recorded?.committed === false) {
      await this.repository.scheduleArtworkStagingGc({ claim, reason: 'stale-failure' });
    }
  }

}

class BoundedTaskPool {
  constructor(concurrency, maxQueued) {
    this.concurrency = concurrency;
    this.maxQueued = maxQueued;
    this.active = 0;
    this.queue = [];
    this.highWater = 0;
  }

  run(operation, signal) {
    if (this.queue.length >= this.maxQueued) {
      const error = new Error('Artwork request queue limit exceeded');
      error.code = 'artworkQueueLimit';
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, signal, resolve, reject });
      this.highWater = Math.max(this.highWater, this.queue.length);
      this.#drain();
    });
  }

  #drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift();
      if (task.signal?.aborted) {
        task.reject(abortReason(task.signal));
        continue;
      }
      this.active += 1;
      Promise.resolve().then(task.operation).then(task.resolve, task.reject).finally(() => {
        this.active -= 1;
        this.#drain();
      });
    }
  }
}

function normalizeThumbnail(value) {
  assertRepositoryContract(value && typeof value === 'object', 'invalidArtworkThumbnail', 'Thumbnail result is required');
  const bytes = value.bytes instanceof Uint8Array ? value.bytes : new Uint8Array(value.bytes ?? 0);
  assertRepositoryContract(bytes.byteLength <= ARTWORK_LIMITS.maxThumbnailBytes, 'artworkThumbnailTooLarge', 'Thumbnail exceeds byte limit');
  assertRepositoryContract(Number.isSafeInteger(value.width) && value.width > 0 && value.width <= ARTWORK_LIMITS.maxThumbnailWidth, 'artworkThumbnailTooLarge', 'Thumbnail width exceeds limit');
  assertRepositoryContract(Number.isSafeInteger(value.height) && value.height > 0 && value.height <= ARTWORK_LIMITS.maxThumbnailHeight, 'artworkThumbnailTooLarge', 'Thumbnail height exceeds limit');
  assertRepositoryContract(value.mimeType === 'image/jpeg' || value.mimeType === 'image/webp', 'invalidArtworkThumbnail', 'Thumbnail must be JPEG or WebP');
  return Object.freeze({ bytes, width: value.width, height: value.height, mimeType: value.mimeType });
}

function sanitizeArtworkError(error) {
  const known = new Set([
    'artworkRawTooLarge', 'artworkDimensionsTooLarge', 'artworkDecodeTooLarge',
    'artworkThumbnailTooLarge', 'artwork-timeout', 'artwork-decode-failed'
  ]);
  const code = String(error?.code ?? 'artwork-decode-failed');
  return known.has(code) ? code : 'artwork-decode-failed';
}

function isOptionalCacheQuotaError(error) {
  return ['QuotaExceededError', 'artwork-cache-full'].includes(String(error?.code ?? error?.name));
}

function isCatalogStorageFailure(error) {
  return ['SQLITE_FULL', 'ENOSPC', 'SHORT_WRITE', 'FLUSH_FAILED'].includes(String(error?.code ?? '').toUpperCase());
}

function abortReason(signal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Artwork request aborted', 'AbortError');
}

function createSharedAbortError() {
  return new DOMException('Artwork extraction has no active requests', 'AbortError');
}

function artworkSingleFlightKey(claim) {
  const stat = claim.externalArtworkStat;
  return [
    claim.folderId,
    claim.lifecycleVersion,
    claim.sourceKind,
    claim.canonicalSourceIdentity,
    claim.fileIdentity,
    claim.size,
    claim.mtimeMs,
    claim.embeddedOffset ?? '',
    claim.embeddedLength ?? '',
    stat?.fileIdentity ?? '',
    stat?.size ?? '',
    stat?.mtimeMs ?? '',
    claim.extractorVersion
  ].join('\u0000');
}

function assertMethods(target, methods, label) {
  assertRepositoryContract(target && typeof target === 'object', 'invalidArtworkAdapter', `${label} is required`);
  for (const method of methods) {
    assertRepositoryContract(typeof target[method] === 'function', 'invalidArtworkAdapter', `${label} must provide ${method}()`);
  }
}
