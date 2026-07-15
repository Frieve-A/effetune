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
  'evictArtworkCache',
  'enterReadOnlyDiagnostic'
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
    this.readOnly = false;
  }

  async request({ trackUid, reason, signal } = {}) {
    assertRepositoryContract(typeof trackUid === 'string' && trackUid.length > 0, 'invalidArtworkRequest', 'trackUid is required');
    assertRepositoryContract(LAZY_REASONS.has(reason), 'invalidArtworkRequest', 'Artwork extraction is only available for lazy UI requests');
    if (signal?.aborted) throw abortReason(signal);

    const cached = await this.repository.getCachedArtwork({ trackUid, cacheMode: this.cachePolicy.mode });
    if (cached) return cached;
    const source = await this.repository.getArtworkSource({ trackUid });
    if (!source) return ARTWORK_PLACEHOLDER;
    const sourceKey = artworkSingleFlightKey(createArtworkSourceClaim(source));
    const existing = this.inFlight.get(sourceKey);
    if (existing) return raceAbort(existing, signal);

    const promise = this.pool.run(() => this.#extract(source, signal), signal)
      .finally(() => this.inFlight.delete(sourceKey));
    this.inFlight.set(sourceKey, promise);
    return raceAbort(promise, signal);
  }

  async #extract(source, signal) {
    if (this.readOnly) return ARTWORK_PLACEHOLDER;
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
      const preflight = await this.repository.preflightArtworkBatch({
        claim,
        estimatedRawBytes: header.rawByteLength,
        estimatedThumbnailBytes: ARTWORK_LIMITS.maxThumbnailBytes,
        cachePolicy: this.cachePolicy
      });
      if (preflight?.ok !== true) {
        await this.repository.scheduleArtworkStagingGc({ claim, reason: 'storage-preflight' });
        return ARTWORK_PLACEHOLDER;
      }

      const thumbnail = normalizeThumbnail(await this.extractor.createThumbnail({
        claim,
        header,
        maxWidth: ARTWORK_LIMITS.maxThumbnailWidth,
        maxHeight: ARTWORK_LIMITS.maxThumbnailHeight,
        maxBytes: ARTWORK_LIMITS.maxThumbnailBytes,
        signal
      }));
      return await this.#publishWithOneEvictionRetry(claim, thumbnail);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        if (claim) await this.repository.scheduleArtworkStagingGc({ claim, reason: 'canceled' });
        throw error;
      }
      if (isCatalogStorageFailure(error)) return this.#enterReadOnly(error);
      if (!claim) throw error;
      try {
        await this.#recordFailure(claim, sanitizeArtworkError(error));
      } catch (failureError) {
        if (isCatalogStorageFailure(failureError)) return this.#enterReadOnly(failureError);
        if (isOptionalCacheQuotaError(failureError)) return ARTWORK_PLACEHOLDER;
        throw failureError;
      }
      return ARTWORK_PLACEHOLDER;
    } finally {
      if (claim) await this.extractor.discard?.({ claim });
    }
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

  async #enterReadOnly(error) {
    this.readOnly = true;
    await this.repository.enterReadOnlyDiagnostic({
      code: 'storage-write-failure',
      safeDetails: { errorCode: safeCode(error?.code ?? error?.name) }
    });
    return ARTWORK_PLACEHOLDER;
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

function safeCode(value) {
  const code = String(value ?? '').toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(code) ? code : 'storage-write-failure';
}

function abortReason(signal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Artwork request aborted', 'AbortError');
}

function raceAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
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
