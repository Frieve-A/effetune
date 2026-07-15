import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARTWORK_LIMITS,
  ARTWORK_PLACEHOLDER,
  artworkCompletionMatchesClaim,
  calculateArtworkCachePolicy,
  createArtworkSourceClaim
} from '../../js/library/artwork/artwork-policy.js';
import { LazyArtworkService } from '../../js/library/artwork/lazy-artwork-service.js';
import { WebArtworkExtractor } from '../../js/library/artwork/web-artwork-extractor.js';

function sourceFor(trackUid, overrides = {}) {
  return {
    folderId: 'folder-1',
    lifecycleVersion: 3,
    trackUid,
    sourceKind: 'embedded',
    canonicalSourceIdentity: `album-${trackUid}`,
    fileIdentity: `file-${trackUid}`,
    size: 1000,
    mtimeMs: 2000,
    embeddedOffset: 100,
    embeddedLength: 1000,
    externalArtworkStat: null,
    extractorVersion: 'artwork-1',
    ...overrides
  };
}

test('Web artwork reads bounded PNG headers before decode and caps raw staging', async () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, 2);
  new DataView(png.buffer).setUint32(20, 3);
  let bitmapCalls = 0;
  const extractor = new WebArtworkExtractor({
    filesystem: { async getFile() { return new Blob([new Uint8Array([1])]); } },
    parse: async () => ({ common: { picture: [{ data: png, format: 'image/png' }] } }),
    createBitmap: async () => { bitmapCalls += 1; return { width: 2, height: 3 }; }
  });
  const claims = Array.from({ length: 9 }, (_, index) => sourceFor(`header-${index}`));
  assert.deepEqual(await extractor.readHeader({ claim: claims[0], maxRawBytes: ARTWORK_LIMITS.maxRawBytes }), {
    rawByteLength: 24,
    width: 2,
    height: 3
  });
  assert.equal(bitmapCalls, 0);
  for (const claim of claims.slice(1, 8)) {
    await extractor.readHeader({ claim, maxRawBytes: ARTWORK_LIMITS.maxRawBytes });
  }
  await assert.rejects(
    extractor.readHeader({ claim: claims[8], maxRawBytes: ARTWORK_LIMITS.maxRawBytes }),
    error => error?.code === 'artworkQueueLimit'
  );
  extractor.discard({ claim: claims[0] });
  assert.deepEqual(await extractor.readHeader({ claim: claims[8], maxRawBytes: ARTWORK_LIMITS.maxRawBytes }), {
    rawByteLength: 24,
    width: 2,
    height: 3
  });
});

function createRepository(options = {}) {
  const calls = [];
  let publishAttempt = 0;
  return {
    calls,
    async getCachedArtwork(input) {
      calls.push(['cache', input]);
      return options.cached ?? null;
    },
    async getArtworkSource({ trackUid }) {
      calls.push(['source', trackUid]);
      return options.source?.(trackUid) ?? sourceFor(trackUid);
    },
    async claimArtworkSource({ claim }) {
      calls.push(['claim', claim]);
      return options.claimRejected ? { claim: null } : { claim: options.claimMutation ? options.claimMutation(claim) : claim };
    },
    async preflightArtworkBatch(input) {
      calls.push(['preflight', input]);
      return options.preflight ?? { ok: true };
    },
    async publishArtwork(input) {
      calls.push(['publish', input]);
      publishAttempt += 1;
      if (options.quotaOnce && publishAttempt === 1) {
        throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      }
      return options.stalePublish
        ? { committed: false }
        : { committed: true, artwork: { kind: 'thumbnail', trackUid: input.claim.trackUid } };
    },
    async recordArtworkFailure(input) {
      calls.push(['failure', input]);
      return { committed: options.staleFailure !== true };
    },
    async scheduleArtworkStagingGc(input) {
      calls.push(['gc', input]);
    },
    async evictArtworkCache(input) {
      calls.push(['evict', input]);
    },
    async enterReadOnlyDiagnostic(input) {
      calls.push(['read-only', input]);
    }
  };
}

function createExtractor(options = {}) {
  const calls = [];
  let active = 0;
  let peakActive = 0;
  return {
    calls,
    get peakActive() {
      return peakActive;
    },
    async readHeader(input) {
      calls.push(['header', input]);
      return options.header ?? { rawByteLength: 1024, width: 1000, height: 1000 };
    },
    async createThumbnail(input) {
      calls.push(['thumbnail', input]);
      active += 1;
      peakActive = Math.max(peakActive, active);
      if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
      active -= 1;
      if (options.error) throw options.error;
      return {
        bytes: new Uint8Array(options.thumbnailBytes ?? 1024),
        width: 512,
        height: 512,
        mimeType: 'image/webp'
      };
    }
  };
}

test('artwork policy uses fixed desktop and quota-bounded Web cache caps', () => {
  assert.deepEqual(calculateArtworkCachePolicy({ runtime: 'desktop' }), {
    mode: 'persistent', maxBytes: 512 * 1024 * 1024
  });
  assert.deepEqual(calculateArtworkCachePolicy({ runtime: 'web', quotaBytes: 10 * 1024 * 1024 * 1024 }), {
    mode: 'persistent', maxBytes: 256 * 1024 * 1024
  });
  assert.deepEqual(calculateArtworkCachePolicy({ runtime: 'web', quotaBytes: 512 * 1024 * 1024 }), {
    mode: 'memory-only', maxBytes: 64 * 1024 * 1024
  });
});

test('source claims include the full lifecycle fence rather than digest alone', () => {
  const claim = createArtworkSourceClaim(sourceFor('track-1'));
  assert.equal(artworkCompletionMatchesClaim(claim, { ...claim }), true);
  assert.equal(artworkCompletionMatchesClaim(claim, { ...claim, lifecycleVersion: 4 }), false);
  assert.equal(artworkCompletionMatchesClaim(claim, { ...claim, mtimeMs: 2001 }), false);
  assert.equal(artworkCompletionMatchesClaim(claim, { ...claim, extractorVersion: 'artwork-2' }), false);
});

test('lazy requests single-flight by source and never expose extraction as a scan operation', async () => {
  const repository = createRepository({
    source: trackUid => sourceFor(trackUid, {
      canonicalSourceIdentity: 'shared-album',
      fileIdentity: 'shared-file'
    })
  });
  const extractor = createExtractor({ delayMs: 10 });
  const service = new LazyArtworkService({ repository, extractor });

  const [first, second] = await Promise.all([
    service.request({ trackUid: 'track-1', reason: 'viewport' }),
    service.request({ trackUid: 'track-2', reason: 'now-playing' })
  ]);

  assert.equal(first.kind, 'thumbnail');
  assert.equal(second, first);
  assert.equal(repository.calls.filter(([name]) => name === 'claim').length, 1);
  assert.equal(extractor.calls.filter(([name]) => name === 'thumbnail').length, 1);
  await assert.rejects(
    () => service.request({ trackUid: 'track-3', reason: 'scan' }),
    error => error.code === 'invalidArtworkRequest'
  );
});

test('desktop and mobile decode concurrency remain bounded', async () => {
  for (const [runtime, expected] of [['desktop', 4], ['mobile', 2]]) {
    const repository = createRepository();
    const extractor = createExtractor({ delayMs: 5 });
    const service = new LazyArtworkService({ repository, extractor, runtime });
    await Promise.all(Array.from({ length: 12 }, (_, index) => service.request({
      trackUid: `${runtime}-${index}`,
      reason: 'viewport-prefetch'
    })));
    assert.ok(extractor.peakActive <= expected);
    assert.equal(extractor.peakActive, expected);
  }
});

test('raw and thumbnail limits fall back to placeholders without storing raw bytes', async () => {
  const repository = createRepository();
  const extractor = createExtractor({
    header: { rawByteLength: ARTWORK_LIMITS.maxRawBytes + 1, width: 100, height: 100 }
  });
  const service = new LazyArtworkService({ repository, extractor });

  const artwork = await service.request({ trackUid: 'too-large', reason: 'detail' });

  assert.equal(artwork, ARTWORK_PLACEHOLDER);
  assert.equal(extractor.calls.some(([name]) => name === 'thumbnail'), false);
  const failure = repository.calls.find(([name]) => name === 'failure')?.[1];
  assert.equal(failure.errorCode, 'artworkRawTooLarge');
  assert.equal('bytes' in failure, false);
});

test('late source CAS results are discarded to bounded staging GC', async () => {
  const repository = createRepository({ stalePublish: true });
  const service = new LazyArtworkService({ repository, extractor: createExtractor() });

  const artwork = await service.request({ trackUid: 'stale', reason: 'viewport' });

  assert.equal(artwork, ARTWORK_PLACEHOLDER);
  assert.equal(repository.calls.find(([name]) => name === 'gc')?.[1].reason, 'stale-source');
});

test('optional cache quota evicts once and retries without entering catalog read-only mode', async () => {
  const repository = createRepository({ quotaOnce: true });
  const service = new LazyArtworkService({ repository, extractor: createExtractor(), runtime: 'web', quotaBytes: 8 * 1024 * 1024 * 1024 });

  const artwork = await service.request({ trackUid: 'quota', reason: 'now-playing' });

  assert.equal(artwork.kind, 'thumbnail');
  assert.equal(repository.calls.filter(([name]) => name === 'publish').length, 2);
  assert.equal(repository.calls.filter(([name]) => name === 'evict').length, 1);
  assert.equal(repository.calls.some(([name]) => name === 'read-only'), false);
});

test('catalog storage failure enters diagnostic mode with a safe placeholder fallback', async () => {
  const repository = createRepository();
  repository.publishArtwork = async () => {
    throw Object.assign(new Error('private path'), { code: 'SQLITE_FULL' });
  };
  const service = new LazyArtworkService({ repository, extractor: createExtractor() });

  const artwork = await service.request({ trackUid: 'full', reason: 'viewport' });

  assert.equal(artwork, ARTWORK_PLACEHOLDER);
  assert.deepEqual(repository.calls.find(([name]) => name === 'read-only')?.[1], {
    code: 'storage-write-failure', safeDetails: { errorCode: 'sqlite_full' }
  });
});
