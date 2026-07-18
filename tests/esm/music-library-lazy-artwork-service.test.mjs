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

test('Web artwork uses the decoder for arbitrary image formats and caps raw staging', async () => {
  const artwork = new Uint8Array([1, 2, 3]);
  let bitmapCalls = 0;
  const decodedTypes = [];
  const extractor = new WebArtworkExtractor({
    filesystem: { async getFile() { return new Blob([new Uint8Array([1])]); } },
    parse: async () => ({ common: { picture: [{ data: artwork, format: 'avif' }] } }),
    createBitmap: async blob => {
      bitmapCalls += 1;
      decodedTypes.push(blob.type);
      return { width: 2, height: 3, close() {} };
    }
  });
  const claims = Array.from({ length: 9 }, (_, index) => sourceFor(`header-${index}`));
  assert.deepEqual(await extractor.readHeader({ claim: claims[0], maxRawBytes: ARTWORK_LIMITS.maxRawBytes }), {
    rawByteLength: 3,
    width: 2,
    height: 3
  });
  assert.equal(bitmapCalls, 1);
  assert.deepEqual(decodedTypes, ['image/avif']);
  for (const claim of claims.slice(1, 8)) {
    await extractor.readHeader({ claim, maxRawBytes: ARTWORK_LIMITS.maxRawBytes });
  }
  await assert.rejects(
    extractor.readHeader({ claim: claims[8], maxRawBytes: ARTWORK_LIMITS.maxRawBytes }),
    error => error?.code === 'artworkQueueLimit'
  );
  extractor.discard({ claim: claims[0] });
  assert.deepEqual(await extractor.readHeader({ claim: claims[8], maxRawBytes: ARTWORK_LIMITS.maxRawBytes }), {
    rawByteLength: 3,
    width: 2,
    height: 3
  });
  assert.equal(bitmapCalls, 9);
});

test('Web artwork rejects oversized binary input before createImageBitmap', async () => {
  let bitmapCalls = 0;
  const extractor = new WebArtworkExtractor({
    filesystem: { async getFile() { return new Blob([new Uint8Array([1])]); } },
    parse: async () => ({
      common: { picture: [{ data: new DataView(new Uint8Array([1, 2, 3]).buffer), format: 'png' }] }
    }),
    createBitmap: async () => {
      bitmapCalls += 1;
      return { width: 1, height: 1, close() {} };
    }
  });

  await assert.rejects(
    extractor.readHeader({ claim: sourceFor('oversized'), maxRawBytes: 2 }),
    error => error?.code === 'artworkRawTooLarge'
  );
  assert.equal(bitmapCalls, 0);
});

test('Web CUE artwork resolves a sibling image when the source has no embedded image', async () => {
  const audio = new Blob([new Uint8Array([1])]);
  const cover = new Blob([new Uint8Array([2, 3, 4])], { type: 'image/png' });
  Object.defineProperties(cover, {
    size: { value: 3 },
    lastModified: { value: 1234 }
  });
  const calls = [];
  const extractor = new WebArtworkExtractor({
    filesystem: {
      async getFile(relativePath) {
        calls.push(['file', relativePath]);
        return relativePath === 'Album/COVER.PNG' ? cover : audio;
      },
      async listFileNames(relativeDirectory) {
        calls.push(['list', relativeDirectory]);
        return ['disc.cue', 'disc.flac', 'COVER.PNG'];
      }
    },
    parse: async () => ({ common: { picture: [] } }),
    createBitmap: async blob => {
      calls.push(['bitmap', blob.type]);
      return { width: 10, height: 20, close() {} };
    }
  });
  const source = sourceFor('cue-cover', {
    sourceKind: 'embedded-file',
    canonicalSourceIdentity: 'Album/disc.flac',
    embeddedOffset: null,
    embeddedLength: null,
    trackSourceKind: 'cue-track',
    cueRelativePath: 'Album/disc.cue'
  });

  const resolved = await extractor.resolveSource({
    source,
    maxRawBytes: ARTWORK_LIMITS.maxRawBytes
  });
  assert.equal(resolved.sourceKind, 'external-file');
  assert.equal(resolved.canonicalSourceIdentity, 'Album/COVER.PNG');
  assert.deepEqual(resolved.externalArtworkStat, {
    fileIdentity: 'fsa:Album/COVER.PNG', size: 3, mtimeMs: 1234
  });
  assert.deepEqual(await extractor.readHeader({
    claim: resolved,
    maxRawBytes: ARTWORK_LIMITS.maxRawBytes
  }), { rawByteLength: 3, width: 10, height: 20 });
  assert.deepEqual(calls, [
    ['file', 'Album/disc.flac'],
    ['list', 'Album'],
    ['file', 'Album/COVER.PNG'],
    ['bitmap', 'image/png']
  ]);
  extractor.discard({ claim: resolved });
});

test('Web artwork invokes createImageBitmap with the Worker global receiver', async () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, 2);
  new DataView(png.buffer).setUint32(20, 3);
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  let bitmapReceiver = null;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }

    getContext() {
      return { drawImage() {} };
    }

    async convertToBlob() {
      return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    }
  };
  try {
    const extractor = new WebArtworkExtractor({
      filesystem: { async getFile() { return new Blob([new Uint8Array([1])]); } },
      parse: async () => ({ common: { picture: [{ data: png, format: 'image/png' }] } }),
      createBitmap: async function () {
        bitmapReceiver = this;
        return { width: 2, height: 3, close() {} };
      }
    });
    const claim = sourceFor('receiver');
    const header = await extractor.readHeader({ claim, maxRawBytes: ARTWORK_LIMITS.maxRawBytes });
    const thumbnail = await extractor.createThumbnail({
      claim,
      header,
      maxWidth: 512,
      maxHeight: 512,
      maxBytes: ARTWORK_LIMITS.maxThumbnailBytes
    });

    assert.equal(bitmapReceiver, globalThis);
    assert.equal(thumbnail.mimeType, 'image/jpeg');
    assert.deepEqual(Array.from(thumbnail.bytes), [1, 2, 3]);
  } finally {
    if (originalOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalOffscreenCanvas;
  }
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

function createAbortAwareExtractor() {
  let markStarted;
  let completeThumbnail;
  const started = new Promise(resolve => { markStarted = resolve; });
  return {
    started,
    async readHeader() {
      return { rawByteLength: 1024, width: 1000, height: 1000 };
    },
    createThumbnail({ signal }) {
      markStarted();
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        completeThumbnail = () => {
          signal.removeEventListener('abort', abort);
          resolve({ bytes: new Uint8Array(1024), width: 512, height: 512, mimeType: 'image/webp' });
        };
      });
    },
    complete() {
      completeThumbnail?.();
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

test('one canceled artwork consumer does not abort a shared extraction still in use', async () => {
  const repository = createRepository({
    source: trackUid => sourceFor(trackUid, {
      canonicalSourceIdentity: 'shared-cancel-album',
      fileIdentity: 'shared-cancel-file'
    })
  });
  const extractor = createAbortAwareExtractor();
  const service = new LazyArtworkService({ repository, extractor });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = service.request({ trackUid: 'cancel-first', reason: 'viewport', signal: firstController.signal });
  const second = service.request({ trackUid: 'keep-second', reason: 'now-playing', signal: secondController.signal });
  await extractor.started;
  await new Promise(resolve => setImmediate(resolve));
  firstController.abort(new DOMException('first consumer left', 'AbortError'));
  extractor.complete();

  await assert.rejects(first, error => error?.name === 'AbortError');
  assert.equal((await second).kind, 'thumbnail');
  assert.equal(repository.calls.filter(([name]) => name === 'claim').length, 1);
  assert.equal(repository.calls.some(([name, input]) => name === 'gc' && input.reason === 'canceled'), false);
});

test('shared artwork extraction aborts and cleans staging after its last consumer leaves', async () => {
  const repository = createRepository({
    source: trackUid => sourceFor(trackUid, {
      canonicalSourceIdentity: 'shared-all-canceled',
      fileIdentity: 'shared-all-canceled-file'
    })
  });
  const extractor = createAbortAwareExtractor();
  const service = new LazyArtworkService({ repository, extractor });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const pending = [
    service.request({ trackUid: 'all-canceled-first', reason: 'viewport', signal: firstController.signal }),
    service.request({ trackUid: 'all-canceled-second', reason: 'detail', signal: secondController.signal })
  ];
  await extractor.started;
  await new Promise(resolve => setImmediate(resolve));
  firstController.abort(new DOMException('first consumer left', 'AbortError'));
  secondController.abort(new DOMException('second consumer left', 'AbortError'));
  const settled = await Promise.allSettled(pending);
  assert.ok(settled.every(result => result.status === 'rejected' && result.reason?.name === 'AbortError'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(repository.calls.filter(([name, input]) => name === 'gc' && input.reason === 'canceled').length, 1);
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

test('persistent preflight evicts once only for artwork-cache-full and retries admission', async () => {
  const repository = createRepository();
  let attempts = 0;
  repository.preflightArtworkBatch = async input => {
    repository.calls.push(['preflight', input]);
    attempts += 1;
    return attempts === 1 ? { ok: false, code: 'artwork-cache-full' } : { ok: true };
  };
  const service = new LazyArtworkService({
    repository,
    extractor: createExtractor(),
    runtime: 'web',
    quotaBytes: 8 * 1024 * 1024 * 1024
  });

  const artwork = await service.request({ trackUid: 'preflight-full', reason: 'viewport' });

  assert.equal(artwork.kind, 'thumbnail');
  assert.equal(repository.calls.filter(([name]) => name === 'preflight').length, 2);
  assert.equal(repository.calls.filter(([name]) => name === 'evict').length, 1);
});

test('low-quota Web artwork uses a bounded memory cache without persistent admission', async () => {
  const repository = createRepository();
  const extractor = createExtractor();
  const service = new LazyArtworkService({
    repository,
    extractor,
    runtime: 'web',
    quotaBytes: 512 * 1024 * 1024
  });

  const first = await service.request({ trackUid: 'memory', reason: 'now-playing' });
  const second = await service.request({ trackUid: 'memory', reason: 'viewport' });

  assert.equal(first.kind, 'thumbnail');
  assert.equal(second, first);
  assert.equal(repository.calls.some(([name]) => name === 'preflight'), false);
  assert.equal(repository.calls.some(([name]) => name === 'publish'), false);
  assert.equal(repository.calls.find(([name]) => name === 'gc')?.[1].reason, 'memory-only-complete');
  assert.equal(extractor.calls.filter(([name]) => name === 'thumbnail').length, 1);
});

test('low-quota Web CUE artwork keeps a current external image in memory', async () => {
  const repository = createRepository({
    source: trackUid => sourceFor(trackUid, {
      sourceKind: 'embedded-file',
      canonicalSourceIdentity: 'Album/disc.flac',
      embeddedOffset: null,
      embeddedLength: null,
      trackSourceKind: 'cue-track',
      cueRelativePath: 'Album/disc.cue'
    })
  });
  const extractor = createExtractor();
  extractor.resolveSource = async ({ source }) => ({
    ...source,
    sourceKind: 'external-file',
    canonicalSourceIdentity: 'Album/cover.jpg',
    externalArtworkStat: {
      fileIdentity: 'fsa:Album/cover.jpg', size: 10, mtimeMs: 20
    }
  });
  extractor.isSourceCurrent = async () => true;
  const service = new LazyArtworkService({
    repository,
    extractor,
    runtime: 'web',
    quotaBytes: 512 * 1024 * 1024
  });

  const artwork = await service.request({ trackUid: 'memory-cue-cover', reason: 'viewport' });

  assert.equal(artwork.kind, 'thumbnail');
  assert.equal(repository.calls.find(([name]) => name === 'claim')[1].sourceKind, 'external-file');
  assert.equal(repository.calls.find(([name]) => name === 'gc')[1].reason, 'memory-only-complete');
});

test('catalog storage failure returns the artwork placeholder without changing catalog mode', async () => {
  const repository = createRepository();
  repository.publishArtwork = async () => {
    throw Object.assign(new Error('private path'), { code: 'SQLITE_FULL' });
  };
  const service = new LazyArtworkService({ repository, extractor: createExtractor() });

  const artwork = await service.request({ trackUid: 'full', reason: 'viewport' });

  assert.equal(artwork, ARTWORK_PLACEHOLDER);
  assert.equal(repository.calls.some(([name]) => name === 'read-only'), false);
});
