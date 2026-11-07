import { SfzSampleStream, SFZ_SAMPLE_MAX_READ_BYTES } from './sample-stream.js';
import { attachSfzWorkerSupply } from './sample-supply-port.js';
import { SFZ_MAX_SAMPLES } from './limits.js';

const failure = code => Object.assign(new Error('The instrument sample could not be prepared.'), { code });

// One preparation worker serves a bank. Range readers retain the existing file
// grants in the host; only exact, bounded byte slices cross the worker boundary.
export class SfzSampleStreamWorker {
  constructor({ workerFactory = () => new Worker(new URL('./sample-stream-worker.js', import.meta.url), { type: 'module' }) } = {}) {
    this.worker = workerFactory();
    this.readers = new Map(); this.pending = new Map(); this.nextId = 1; this.closed = false;
    this.worker.onmessage = ({ data }) => { void this.receive(data); };
    const failed = () => { if (this.closed) return; this.close('sample-worker'); this.onSupplyError?.(failure('sample-worker')); };
    this.worker.onerror = failed; this.worker.onmessageerror = failed;
  }
  async receive(data) {
    if (this.closed) return;
    if (data.type === 'read') {
      try {
        const reader = this.readers.get(data.sample);
        if (!reader || !Number.isSafeInteger(data.offset) || !Number.isSafeInteger(data.length) ||
            data.offset < 0 || data.length < 1 || data.length > SFZ_SAMPLE_MAX_READ_BYTES ||
            data.offset + data.length > reader.size) throw failure('sample-range');
        const value = await reader.readRange(data.offset, data.length);
        if (this.closed) return;
        // Transfer a private slice, never detach a File cache or IPC-owned view.
        const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(value).slice();
        if (bytes.length !== data.length) throw failure('sample-changed');
        this.worker.postMessage({ type: 'read-result', id: data.id, bytes }, [bytes.buffer]);
      } catch (error) {
        if (!this.closed) this.worker.postMessage({ type: 'read-result', id: data.id, error: error.code || 'sample-read' });
      }
    } else if (data.type === 'supply-error') {
      this.onSupplyError?.(failure(data.code));
    } else if (data.type === 'result') {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.error) pending.reject(failure(data.error)); else pending.resolve(data.result);
    }
  }
  call(type, arguments_, transfer = []) {
    if (this.closed) return Promise.reject(failure('sample-cancelled'));
    if (this.pending.size >= 4096) return Promise.reject(failure('sample-capacity'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type, id, ...arguments_ }, transfer);
    });
  }
  async open(sample, reader) {
    if (!Number.isInteger(sample) || sample < 0 || sample >= SFZ_MAX_SAMPLES || this.readers.has(sample) ||
        !reader || !Number.isSafeInteger(reader.size) || typeof reader.readRange !== 'function') throw failure('sample-range');
    this.readers.set(sample, reader);
    try {
      const metadata = await this.call('open', { sample, size: reader.size, pcm: reader.pcm });
      return Object.freeze({ ...metadata, revision: reader.revision });
    } catch (error) { this.readers.delete(sample); throw error; }
  }
  readPage(sample, pageIndex) { return this.call('page', { sample, pageIndex }); }
  readPages(sample, pageIndex, pageCount) { return this.call('pages', { sample, pageIndex, pageCount }); }
  close(code = 'sample-cancelled') {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(failure(code));
    this.pending.clear(); this.readers.clear();
  }
}

// Exporting the endpoint also lets the Node harness exercise the actual protocol
// over worker_threads without introducing Node imports into browser code.
export function attachSfzSampleStreamWorker(endpoint) {
  const streams = new Map(), reads = new Map();
  let nextRead = 1, queue = Promise.resolve(), metadataBytes = 0, directSources = null, rangePort = null;
  const rangeReads = new Map();
  const directRead = async (sample, offset, length) => {
    const reader = directSources[sample], source = reader?.source;
    if (!source || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 ||
        length < 1 || length > SFZ_SAMPLE_MAX_READ_BYTES || offset + length > reader.size) throw failure('sample-range');
    if (source.kind === 'file') {
      if (source.handle) {
        const current = await source.handle.getFile();
        if (`${current.size}:${current.lastModified}` !== source.revision) throw failure('source-changed');
      }
      const bytes = new Uint8Array(await source.file.slice(source.offset + offset, source.offset + offset + length).arrayBuffer());
      if (bytes.length !== length) throw failure('source-changed');
      return bytes;
    }
    if (source.kind !== 'protected' || !rangePort || rangeReads.size >= 4) throw failure('sample-capacity');
    const requestId = nextRead++;
    return new Promise((resolve, reject) => {
      rangeReads.set(requestId, { resolve, reject, length, revision: source.revision });
      rangePort.postMessage({ requestId, relativePath: source.relativePath, revision: source.revision,
        offset: source.offset + offset, length });
    });
  };
  const read = (sample, offset, length) => directSources ? directRead(sample, offset, length)
    : new Promise((resolve, reject) => {
      const id = nextRead++;
      reads.set(id, { resolve, reject }); endpoint.postMessage({ type: 'read', sample, id, offset, length });
    });
  endpoint.onmessage = ({ data }) => {
    if (data.type === 'read-result') {
      const pending = reads.get(data.id);
      if (!pending) return;
      reads.delete(data.id);
      if (data.error) pending.reject(failure(data.error)); else pending.resolve(data.bytes);
      return;
    }
    queue = queue.then(async () => {
      try {
        let result;
        if (data.type === 'open') {
          if (!Number.isInteger(data.sample) || data.sample < 0 || data.sample >= SFZ_MAX_SAMPLES || streams.has(data.sample)) throw failure('sample-range');
          const stream = await SfzSampleStream.open((offset, length) => read(data.sample, offset, length), data.size, data.pcm);
          const bytes = 512 + (stream.metadata.seekPoints?.length || 0) * 24;
          if (metadataBytes + bytes > 16 * 1024 * 1024) throw failure('sample-capacity');
          metadataBytes += bytes; streams.set(data.sample, stream); result = stream.metadata;
        } else if (data.type === 'supply') {
          if (directSources || !data.port || data.sources.length !== data.samples.length || reads.size) throw failure('sample-generation');
          directSources = data.sources; rangePort = data.rangePort;
          if (rangePort) {
            rangePort.onmessage = ({ data: result }) => {
              const pending = rangeReads.get(result?.requestId);
              if (!pending) return;
              rangeReads.delete(result.requestId);
              const bytes = result.data?.bytes;
              if (!result.ok) pending.reject(failure(result.code || 'sample-read'));
              else if (result.data.revision !== pending.revision || bytes?.length !== pending.length) pending.reject(failure('source-changed'));
              else pending.resolve(bytes);
            };
            rangePort.start?.();
          }
          const serial = new Map();
          const local = {
            statelessPcmReads: true,
            async open(sample) {
              if (streams.has(sample)) return streams.get(sample).metadata;
              const source = directSources[sample];
              const stream = await SfzSampleStream.open((offset, length) => read(sample, offset, length), source.size, source.pcm);
              streams.set(sample, stream); return stream.metadata;
            },
            readPage(sample, page) { return this.readPages(sample, page, 1); },
            readPages(sample, page, count) {
              const stream = streams.get(sample);
              if (!stream) return Promise.reject(failure('sample-range'));
              // Compressed sources decode serially; known PCM reads can overlap.
              if (stream.metadata.format === 'pcm' || stream.metadata.format === 'sf2-pcm') return stream.readPages(page, count);
              const task = (serial.get(sample) || Promise.resolve()).then(() => stream.readPages(page, count));
              serial.set(sample, task.catch(() => {})); return task;
            },
            close() {
              rangePort?.postMessage({ type: 'close' }); rangePort?.close();
              for (const pending of rangeReads.values()) pending.reject(failure('sample-cancelled'));
              rangeReads.clear();
            }
          };
          const { SfzSamplePageProvider } = await import('./sample-page-provider.js');
          const provider = new SfzSamplePageProvider({ assetId: data.assetId, generation: data.generation, worker: local,
            createReader: samplePath => {
              const source = directSources[data.paths.indexOf(samplePath)];
              return { ...source, revision: data.samples[data.paths.indexOf(samplePath)].sourceRevision };
            }, publish: () => false });
          provider.samples = data.samples; provider.paths = data.paths;
          for (const sample of streams.keys()) provider.openSamples.set(sample, Promise.resolve());
          await attachSfzWorkerSupply({ ...data, provider, onClose: code => {
            if (code !== 'sample-cancelled') endpoint.postMessage({ type: 'supply-error', code });
          } });
          result = true;
        } else if (data.type === 'page' || data.type === 'pages') {
          const stream = streams.get(data.sample);
          if (!stream) throw failure('sample-range');
          result = data.type === 'page' ? await stream.readPage(data.pageIndex) : await stream.readPages(data.pageIndex, data.pageCount);
        } else throw failure('sample-range');
        endpoint.postMessage({ type: 'result', id: data.id, result }, result.pcm ? [result.pcm.buffer] : []);
      } catch (error) { endpoint.postMessage({ type: 'result', id: data.id, error: error.code || 'sample-format' }); }
    });
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) attachSfzSampleStreamWorker(globalThis);
