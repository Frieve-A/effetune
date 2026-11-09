import { SfzSampleStreamWorker } from './sample-stream-worker.js';
import { SfzSampleStream, SFZ_SAMPLE_PAGE_FRAMES } from './sample-stream.js';
import { startSfzWorkerSupply } from './sample-supply-port.js';
import { SFZ_MAX_SAMPLES } from './limits.js';

const failure = code => Object.assign(new Error('The instrument samples could not be prepared. Reload the instrument.'), { code });
const MAX_PUBLISH_IN_FLIGHT = 4;
const pageKey = (sample, pageIndex, resident = false) => `${sample}:${pageIndex}:${resident ? 1 : 0}`;

// Capture granted readers before returning the factory. A later instrument
// selection must never change the source used by an already captured export.
export async function createSfzSampleProviderFactory({ assetId, paths, createReader,
  persistentCache = null, onProgress = null, workerFactory, storageModes = null } = {}) {
  const capturedPaths = Object.freeze([...paths]);
  const readers = new Map();
  for (const path of capturedPaths) readers.set(path, await createReader(path));
  const create = (generation, publish, progress) => new SfzSamplePageProvider({ assetId, generation,
    createReader: path => readers.get(path), persistentCache, publish, onProgress: progress,
    workerFactory, storageModes });
  const preparation = create(1, () => {}, onProgress);
  let samples;
  try { samples = await preparation.prepare(capturedPaths); }
  finally { preparation.close(); }
  const factory = async ({ generation, publish, onProgress: progress, onProvider } = {}) => {
    const provider = create(generation, publish, progress);
    try {
      onProvider?.(provider);
      const current = await provider.prepare(capturedPaths,
        samples.every(sample => sample.sourceGeometry) ? samples : null);
      if (current.some((sample, index) => sample.revision !== samples[index].revision)) throw failure('sample-generation');
      return provider;
    } catch (error) { provider.close(); throw error; }
  };
  Object.defineProperty(factory, 'samples', { value: samples, enumerable: true });
  Object.defineProperty(factory, 'startSupply', { value: async (provider, context) => {
    const sources = capturedPaths.map(path => readers.get(path));
    if (sources.some(reader => !reader.rangeSource || reader.rangeSource.kind === 'protected' && !reader.openRangePort)) return false;
    const protectedReader = sources.find(reader => reader.rangeSource.kind === 'protected');
    if (protectedReader && sources.some(reader => reader.rangeSource.kind === 'protected' &&
        reader.rangeSource.bankId !== protectedReader.rangeSource.bankId)) throw failure('sample-generation');
    const rangePort = protectedReader ? await protectedReader.openRangePort() : null;
    try {
      await startSfzWorkerSupply(provider.worker, { ...context, rangePort,
        sources: sources.map(reader => ({ size: reader.size, pcm: reader.pcm, source: reader.rangeSource })),
        samples, paths: capturedPaths, assetId, generation: provider.generation });
      return true;
    } catch (error) { rangePort?.close(); throw error; }
  } });
  return Object.freeze(factory);
}

// One provider serves one immutable bank/cache generation. Publication is an
// acknowledged control operation; its promise resolves only after native staging.
export class SfzSamplePageProvider {
  constructor({ assetId, generation, createReader, publish, persistentCache = null,
    worker = null, workerFactory, onProgress = null, storageModes = null } = {}) {
    if (!/^[a-f0-9]{24}$/.test(assetId) || !Number.isSafeInteger(generation) || generation < 1 ||
        typeof createReader !== 'function' || typeof publish !== 'function') {
      worker?.close(); throw failure('sample-range');
    }
    this.assetId = assetId; this.generation = generation; this.createReader = createReader;
    this.publish = publish; this._worker = worker; this.workerFactory = workerFactory;
    this.persistentCache = persistentCache; this.onProgress = onProgress;
    this.storageModes = storageModes;
    this.samples = []; this.pending = new Map(); this.queue = []; this.pumping = false; this.closed = false;
    this.prepared = new Set(); this.paths = null; this.preparing = false; this.openSamples = new Map();
  }
  get worker() { return this._worker ??= new SfzSampleStreamWorker({ workerFactory: this.workerFactory }); }
  async prepare(paths, knownPcm = null) {
    if (this.closed) throw failure('sample-cancelled');
    if (this.preparing || !Array.isArray(paths) || !paths.length || paths.length > SFZ_MAX_SAMPLES ||
        paths.some(path => typeof path !== 'string') || new Set(paths).size !== paths.length) throw failure('sample-range');
    if (this.paths && (this.paths.length !== paths.length || paths.some((path, index) => path !== this.paths[index]))) throw failure('sample-generation');
    this.paths ??= [...paths]; this.preparing = true;
    try {
      if (knownPcm) {
        if (knownPcm.length !== paths.length) throw failure('sample-generation');
        for (let sample = 0; sample < paths.length; sample++) {
          const reader = await this.createReader(paths[sample]), metadata = knownPcm[sample];
          if (this.closed) throw failure('sample-cancelled');
          if (!metadata.sourceGeometry || !['sf2-pcm', 'sf3-vorbis'].includes(reader.pcm?.format) ||
              reader.revision !== metadata.sourceRevision || reader.size !== metadata.sourceSize) throw failure('sample-generation');
        }
        this.samples = knownPcm;
        this.onProgress?.({ phase: 'metadata', completedCount: paths.length, totalCount: paths.length });
        return knownPcm;
      }
      for (let sample = this.samples.length; sample < paths.length; sample++) {
        const reader = await this.createReader(paths[sample]);
        if (this.closed) throw failure('sample-cancelled');
        const rawPcm = reader.pcm?.format === 'sf2-pcm';
        const sourceGeometry = rawPcm || reader.pcm?.format === 'sf3-vorbis';
        // The SF2 parser already supplies validated raw geometry. This validates
        // it without opening every sample on a Worker or reading its PCM.
        const metadata = sourceGeometry ? (await SfzSampleStream.open(reader.readRange, reader.size, reader.pcm)).metadata
          : await this.worker.open(sample, reader);
        if (!sourceGeometry) this.openSamples.set(sample, Promise.resolve());
        if (this.closed) throw failure('sample-cancelled');
        // Include bank identity and path: File size/mtime alone is not a content key.
        const identityFields = [this.assetId, paths[sample], reader.revision,
          metadata.frames, metadata.channels, metadata.sampleRate, metadata.contentDigest || ''];
        if (this.storageModes) identityFields.push('pcm-storage-v1', this.storageModes[sample]);
        const identity = new TextEncoder().encode(JSON.stringify(identityFields));
        const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', identity));
        if (this.closed) throw failure('sample-cancelled');
        const revision = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
        this.samples.push(Object.freeze({ sample, frames: metadata.frames, channels: metadata.channels,
          sampleRate: metadata.sampleRate, revision,
          ...(this.storageModes && { storageMode: this.storageModes[sample] }),
          ...(rawPcm && { rawPcm: true }),
          ...(sourceGeometry && { sourceGeometry: true, sourceRevision: reader.revision, sourceSize: reader.size }) }));
        this.onProgress?.({ phase: 'metadata', completedCount: this.samples.length, totalCount: paths.length });
      }
      return Object.freeze([...this.samples]);
    } finally { this.preparing = false; }
  }
  openSample(sample) {
    if (!this.samples[sample]?.sourceGeometry) return Promise.resolve();
    let opened = this.openSamples.get(sample);
    if (!opened) {
      opened = (async () => {
        const reader = await this.createReader(this.paths[sample]);
        if (this.closed) throw failure('sample-cancelled');
        const metadata = await this.worker.open(sample, reader), expected = this.samples[sample];
        if (reader.revision !== expected.sourceRevision || metadata.frames !== expected.frames ||
            metadata.channels !== expected.channels || metadata.sampleRate !== expected.sampleRate) throw failure('sample-generation');
      })();
      this.openSamples.set(sample, opened);
    }
    return opened;
  }
  validate(request) {
    const metadata = this.samples[request?.sample];
    if (this.closed) throw failure('sample-cancelled');
    if (request?.generation !== this.generation) throw failure('sample-generation');
    if (!Number.isInteger(request.sample) || request.sample < 0 || !metadata || !Number.isSafeInteger(request.pageIndex) || request.pageIndex < 0 ||
        request.pageIndex * SFZ_SAMPLE_PAGE_FRAMES >= metadata.frames) throw failure('sample-range');
    return metadata;
  }
  requestPages(requests) {
    if (!Array.isArray(requests) || requests.length > 4096) return Promise.reject(failure('sample-capacity'));
    try {
      // Validate the entire batch before enqueueing any of it.
      for (const request of requests) this.validate(request);
      const unique = new Set(requests.map(request => pageKey(request.sample, request.pageIndex, request.resident)));
      const newCount = [...unique].filter(key => !this.pending.has(key)).length;
      if (this.pending.size + newCount > 4096) throw failure('sample-capacity');
      // Native requests arrive in miss order, interleaving voices. Reading them
      // grouped by sample and page turns a backlog into contiguous batch reads,
      // which slow storage serves with far fewer seeks.
      const ordered = [...requests].sort((a, b) => a.sample - b.sample || a.pageIndex - b.pageIndex);
      const pending = ordered.map(request => this.enqueue(request));
      if (!this.pumping) void this.pump();
      return Promise.all(pending);
    } catch (error) { return Promise.reject(error); }
  }
  enqueue(request) {
    const key = pageKey(request.sample, request.pageIndex, request.resident), existing = this.pending.get(key);
    if (existing) return existing.promise;
    const job = { sample: request.sample, pageIndex: request.pageIndex, resident: Boolean(request.resident) };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    this.pending.set(key, job); this.queue.push(job);
    return job.promise;
  }
  async load(job) {
    const metadata = this.samples[job.sample];
    const preparation = { kind: 'sfz-sample-page-v1', revision: metadata.revision, page: job.pageIndex };
    const frames = Math.min(SFZ_SAMPLE_PAGE_FRAMES, metadata.frames - job.pageIndex * SFZ_SAMPLE_PAGE_FRAMES);
    // Persist preparation/onset pages only. Continuous disk streaming must not
    // rewrite the cache index at audio-page frequency.
    const persistent = job.resident && this.persistentCache && metadata.sampleRate >= 1000;
    const cached = persistent
      ? await this.persistentCache.get(this.assetId, metadata.sampleRate, preparation) : null;
    let result;
    if (cached && cached.channelData.length === metadata.channels && cached.channelData.every(channel => channel.length === frames)) {
      const pcm = new Float32Array(frames * metadata.channels);
      for (let channel = 0; channel < metadata.channels; channel++)
        for (let frame = 0; frame < frames; frame++) pcm[frame * metadata.channels + channel] = cached.channelData[channel][frame];
      result = { pageIndex: job.pageIndex, firstFrame: job.pageIndex * SFZ_SAMPLE_PAGE_FRAMES, frames, channels: metadata.channels, pcm };
    } else {
      if (metadata.sourceGeometry) await this.openSample(job.sample);
      result = await this.worker.readPage(job.sample, job.pageIndex);
      if (persistent && !this.closed) {
        const channelData = Array.from({ length: metadata.channels }, (_, channel) => {
          const pcm = new Float32Array(frames);
          for (let frame = 0; frame < frames; frame++) pcm[frame] = result.pcm[frame * metadata.channels + channel];
          return pcm;
        });
        await this.persistentCache.set(this.assetId, metadata.sampleRate, preparation, { sampleRate: metadata.sampleRate, channelData });
      }
    }
    return result;
  }
  async pump() {
    this.pumping = true;
    const publications = new Set(), decoding = new Set();
    const finish = (item, error) => {
      if (error) item.reject(error);
      else {
        if (item.resident) this.prepared.add(pageKey(item.sample, item.pageIndex, true));
        item.resolve();
      }
      const key = pageKey(item.sample, item.pageIndex, item.resident);
      if (this.pending.get(key) === item) this.pending.delete(key);
    };
    const decode = async batch => {
      const job = batch[0];
      try {
        let decoded;
        if (batch.length === 1) decoded = await this.load(job);
        else {
          if (this.samples[job.sample].sourceGeometry) await this.openSample(job.sample);
          decoded = await this.worker.readPages(job.sample, job.pageIndex, batch.length);
        }
        for (const item of batch) {
          while (publications.size >= MAX_PUBLISH_IN_FLIGHT && !this.closed) await Promise.race(publications);
          if (this.closed) throw failure('sample-cancelled');
          const first = (item.pageIndex - job.pageIndex) * SFZ_SAMPLE_PAGE_FRAMES;
          const frames = Math.min(SFZ_SAMPLE_PAGE_FRAMES, decoded.frames - first);
          const page = batch.length === 1 ? decoded : { pageIndex: item.pageIndex, firstFrame: item.pageIndex * SFZ_SAMPLE_PAGE_FRAMES,
            frames, channels: decoded.channels, pcm: decoded.pcm.slice(first * decoded.channels, (first + frames) * decoded.channels) };
          const publication = Promise.resolve().then(() => {
            if (this.closed) throw failure('sample-cancelled');
            return this.publish({ ...page, sample: item.sample, generation: this.generation, resident: item.resident });
          }).then(accepted => {
            if (accepted === false) throw failure('sample-capacity');
            if (this.closed) throw failure('sample-cancelled');
            finish(item);
          }).catch(error => finish(item, error)).finally(() => publications.delete(publication));
          publications.add(publication);
        }
      } catch (error) { for (const item of batch) finish(item, error); }
    };
    try {
      while ((this.queue.length || decoding.size || publications.size) && !this.closed) {
        const job = this.queue[0];
        // The local Worker adapter identifies stateless PCM. Stateful decoders
        // retain their existing serial path; both use the same ACK4 ceiling.
        const capacity = job && this.samples[job.sample].rawPcm && this.worker.statelessPcmReads ? MAX_PUBLISH_IN_FLIGHT : 1;
        if (!job || decoding.size >= capacity) {
          await Promise.race([...decoding, ...publications]); continue;
        }
        this.queue.shift();
        const batch = [job];
        if (!job.resident && typeof this.worker.readPages === 'function') {
          while (batch.length < 16 && this.queue.length) {
            const next = this.queue[0];
            if (next.resident || next.sample !== job.sample || next.pageIndex !== job.pageIndex + batch.length) break;
            batch.push(this.queue.shift());
          }
        }
        const task = decode(batch).finally(() => decoding.delete(task));
        decoding.add(task);
      }
    } finally { this.pumping = false; }
  }
  async preload(requests) {
    if (!Array.isArray(requests) || requests.length > 32768) throw failure('sample-capacity');
    const unique = new Map();
    for (const request of requests) {
      const normalized = { ...request, generation: this.generation, resident: true };
      this.validate(normalized); unique.set(pageKey(normalized.sample, normalized.pageIndex, true), normalized);
    }
    let preparationError;
    try {
      let completed = 0;
      for (const [key, request] of unique) {
        if (!this.prepared.has(key)) await this.requestPages([request]);
        if (this.closed) throw failure('sample-cancelled');
        this.onProgress?.({ phase: 'prebuffer', completedCount: ++completed, totalCount: unique.size });
      }
    } catch (error) { preparationError = error; }
    try { await this.persistentCache?.flush?.(); }
    catch (error) {
      if (!preparationError) preparationError = error;
      else console.warn('Sample cache checkpoint failed:', error);
    }
    if (preparationError) throw preparationError;
    if (this.closed) throw failure('sample-cancelled');
  }
  close() {
    if (this.closed) return;
    this.closed = true; this._worker?.close();
    for (const job of this.pending.values()) job.reject(failure('sample-cancelled'));
    this.pending.clear(); this.queue.length = 0; this.prepared.clear(); this.openSamples.clear();
  }
}
