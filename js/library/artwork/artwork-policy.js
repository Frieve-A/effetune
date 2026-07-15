import { assertRepositoryContract } from '../repository/contract-errors.js';

const MEBIBYTE = 1024 * 1024;

export const ARTWORK_LIMITS = Object.freeze({
  maxRawBytes: 20 * MEBIBYTE,
  maxThumbnailWidth: 512,
  maxThumbnailHeight: 512,
  maxThumbnailBytes: 512 * 1024,
  maxSourceDimension: 16384,
  maxSourcePixels: 64 * 1024 * 1024,
  maxDecodedBytes: 256 * MEBIBYTE,
  desktopConcurrency: 4,
  mobileConcurrency: 2,
  desktopCacheBytes: 512 * MEBIBYTE,
  webCacheMaxBytes: 256 * MEBIBYTE,
  webCacheQuotaFraction: 0.05,
  webPersistentMinimumBytes: 64 * MEBIBYTE,
  memoryCacheBytes: 64 * MEBIBYTE,
  maxQueuedRequests: 256
});

export const ARTWORK_PLACEHOLDER = Object.freeze({ kind: 'placeholder' });

export function calculateArtworkCachePolicy({ runtime = 'desktop', quotaBytes = 0 } = {}) {
  if (runtime === 'desktop') {
    return Object.freeze({ mode: 'persistent', maxBytes: ARTWORK_LIMITS.desktopCacheBytes });
  }
  const quotaCap = Number.isSafeInteger(quotaBytes) && quotaBytes > 0
    ? Math.floor(quotaBytes * ARTWORK_LIMITS.webCacheQuotaFraction)
    : 0;
  const persistentBytes = Math.min(ARTWORK_LIMITS.webCacheMaxBytes, quotaCap);
  return persistentBytes >= ARTWORK_LIMITS.webPersistentMinimumBytes
    ? Object.freeze({ mode: 'persistent', maxBytes: persistentBytes })
    : Object.freeze({ mode: 'memory-only', maxBytes: ARTWORK_LIMITS.memoryCacheBytes });
}

export function createArtworkSourceClaim(source) {
  assertRepositoryContract(source && typeof source === 'object', 'invalidArtworkSource', 'Artwork source is required');
  for (const field of ['folderId', 'trackUid', 'sourceKind', 'canonicalSourceIdentity', 'fileIdentity', 'extractorVersion']) {
    assertRepositoryContract(typeof source[field] === 'string' && source[field].length > 0, 'invalidArtworkSource', `${field} is required`);
  }
  for (const field of ['lifecycleVersion', 'size', 'mtimeMs']) {
    assertRepositoryContract(Number.isSafeInteger(source[field]) && source[field] >= 0, 'invalidArtworkSource', `${field} must be a non-negative integer`);
  }
  return Object.freeze({
    folderId: source.folderId,
    lifecycleVersion: source.lifecycleVersion,
    trackUid: source.trackUid,
    sourceKind: source.sourceKind,
    canonicalSourceIdentity: source.canonicalSourceIdentity,
    fileIdentity: source.fileIdentity,
    size: source.size,
    mtimeMs: source.mtimeMs,
    embeddedOffset: integerOrNull(source.embeddedOffset),
    embeddedLength: integerOrNull(source.embeddedLength),
    externalArtworkStat: freezeStat(source.externalArtworkStat),
    extractorVersion: source.extractorVersion,
    ...(typeof source.utilitySessionId === 'string' && source.utilitySessionId.length > 0
      ? { utilitySessionId: source.utilitySessionId }
      : {}),
    ...(typeof source.claimId === 'string' && source.claimId.length > 0
      ? { claimId: source.claimId }
      : {})
  });
}

export function artworkCompletionMatchesClaim(claim, completion) {
  if (!claim || !completion) return false;
  return claim.folderId === completion.folderId &&
    claim.lifecycleVersion === completion.lifecycleVersion &&
    claim.trackUid === completion.trackUid &&
    claim.sourceKind === completion.sourceKind &&
    claim.canonicalSourceIdentity === completion.canonicalSourceIdentity &&
    claim.fileIdentity === completion.fileIdentity &&
    claim.size === completion.size &&
    claim.mtimeMs === completion.mtimeMs &&
    claim.embeddedOffset === completion.embeddedOffset &&
    claim.embeddedLength === completion.embeddedLength &&
    sameStat(claim.externalArtworkStat, completion.externalArtworkStat) &&
    claim.extractorVersion === completion.extractorVersion;
}

export function assertArtworkHeader(header) {
  assertRepositoryContract(header && typeof header === 'object', 'invalidArtworkHeader', 'Artwork header is required');
  const rawByteLength = safeDimension(header.rawByteLength, 'rawByteLength');
  const width = safeDimension(header.width, 'width');
  const height = safeDimension(header.height, 'height');
  if (rawByteLength > ARTWORK_LIMITS.maxRawBytes) throw artworkLimitError('artworkRawTooLarge');
  if (width > ARTWORK_LIMITS.maxSourceDimension || height > ARTWORK_LIMITS.maxSourceDimension) {
    throw artworkLimitError('artworkDimensionsTooLarge');
  }
  if (width * height > ARTWORK_LIMITS.maxSourcePixels || width * height * 4 > ARTWORK_LIMITS.maxDecodedBytes) {
    throw artworkLimitError('artworkDecodeTooLarge');
  }
  return Object.freeze({ rawByteLength, width, height });
}

function artworkLimitError(code) {
  const error = new Error(code);
  error.name = 'ArtworkLimitError';
  error.code = code;
  return error;
}

function safeDimension(value, field) {
  assertRepositoryContract(Number.isSafeInteger(value) && value >= 0, 'invalidArtworkHeader', `${field} must be a non-negative integer`);
  return value;
}

function integerOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function freezeStat(value) {
  if (!value) return null;
  return Object.freeze({
    fileIdentity: String(value.fileIdentity ?? ''),
    size: integerOrNull(value.size),
    mtimeMs: integerOrNull(value.mtimeMs)
  });
}

function sameStat(left, right) {
  if (!left || !right) return left === right;
  return left.fileIdentity === right.fileIdentity && left.size === right.size && left.mtimeMs === right.mtimeMs;
}
