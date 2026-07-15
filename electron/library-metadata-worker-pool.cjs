'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const DEFAULT_METADATA_WORKERS = 4;
const DEFAULT_METADATA_TIMEOUT_MS = 30_000;
const MAX_METADATA_QUEUE = 256;
const MAX_METADATA_RESULT_BYTES = 512 * 1024;

class MetadataWorkerPool {
  constructor({
    workerCount = DEFAULT_METADATA_WORKERS,
    timeoutMs = DEFAULT_METADATA_TIMEOUT_MS,
    workerFactory = () => new Worker(path.join(__dirname, 'library-metadata-worker.cjs'))
  } = {}) {
    if (!Number.isSafeInteger(workerCount) || workerCount < 2 || workerCount > 8) {
      throw createPoolError('invalidMetadataPool', 'Metadata worker count must be from 2 to 8');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw createPoolError('invalidMetadataPool', 'Metadata timeout is invalid');
    }
    this.workerCount = workerCount;
    this.timeoutMs = timeoutMs;
    this.workerFactory = workerFactory;
    this.workers = new Set();
    this.idle = [];
    this.queue = [];
    this.nextRequestId = 1;
    this.closed = false;
  }

  parse({ path: filePath, relativePath, skipCovers, signal } = {}) {
    if (this.closed) return Promise.reject(createPoolError('metadataPoolClosed', 'Metadata worker pool is closed'));
    if (skipCovers !== true) return Promise.reject(createPoolError('metadataArtworkForbidden', 'Metadata scan must skip artwork'));
    if (signal?.aborted) return Promise.reject(abortError(signal));
    if (this.queue.length >= MAX_METADATA_QUEUE) {
      return Promise.reject(createPoolError('metadataQueueLimit', 'Metadata worker queue limit reached'));
    }
    return new Promise((resolve, reject) => {
      const job = {
        requestId: this.nextRequestId++, filePath, relativePath, skipCovers, signal, resolve, reject,
        abort: null, timer: null, worker: null
      };
      job.abort = () => {
        if (job.worker) this.finish(job.worker, job, abortError(signal), true);
        else {
          this.queue = this.queue.filter(candidate => candidate !== job);
          reject(abortError(signal));
        }
      };
      signal?.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job);
      this.drain();
    });
  }

  drain() {
    while (this.queue.length) {
      const worker = this.acquireWorker();
      if (!worker) return;
      const job = this.queue.shift();
      if (job.signal?.aborted) {
        job.signal.removeEventListener('abort', job.abort);
        job.reject(abortError(job.signal));
        this.idle.push(worker);
        continue;
      }
      worker.job = job;
      job.worker = worker;
      job.timer = setTimeout(() => {
        this.finish(worker, job, createPoolError('parse-timeout', 'Metadata parse timed out'), true);
      }, this.timeoutMs);
      job.timer.unref?.();
      worker.postMessage({
        type: 'parse', requestId: job.requestId, filePath: job.filePath,
        relativePath: job.relativePath, skipCovers: job.skipCovers
      });
    }
  }

  acquireWorker() {
    if (this.idle.length) return this.idle.pop();
    if (this.workers.size >= this.workerCount) return null;
    const worker = this.workerFactory();
    worker.job = null;
    worker.on('message', message => this.handleMessage(worker, message));
    worker.on('error', error => this.handleFailure(worker, error));
    worker.on('exit', code => {
      if (this.workers.has(worker)) {
        this.handleFailure(worker, createPoolError('metadata-worker-crash', `Metadata worker exited with code ${code}`));
      }
    });
    this.workers.add(worker);
    return worker;
  }

  handleMessage(worker, message) {
    const job = worker.job;
    if (!job || message?.requestId !== job.requestId) return;
    if (message.type === 'error') {
      const error = createPoolError(message.error?.code || 'metadata-parser-rejected', message.error?.message || 'Metadata parse failed');
      this.finish(worker, job, error, false);
      return;
    }
    let bytes = Number.POSITIVE_INFINITY;
    try { bytes = Buffer.byteLength(JSON.stringify(message.result), 'utf8'); } catch {}
    if (message.type !== 'result' || bytes > MAX_METADATA_RESULT_BYTES) {
      this.finish(worker, job, createPoolError('metadata-too-large', 'Metadata result exceeds byte limit'), true);
      return;
    }
    this.finish(worker, job, null, false, message.result);
  }

  handleFailure(worker, error) {
    const job = worker.job;
    if (job) this.finish(worker, job, createPoolError('worker-crash', error?.message || 'Metadata worker crashed'), true);
    else this.discard(worker);
  }

  finish(worker, job, error, terminate, result) {
    if (worker.job !== job) return;
    worker.job = null;
    job.worker = null;
    if (job.timer) clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.abort);
    if (terminate) this.discard(worker);
    else this.idle.push(worker);
    if (error) job.reject(error);
    else job.resolve(result);
    this.drain();
  }

  discard(worker) {
    this.workers.delete(worker);
    this.idle = this.idle.filter(candidate => candidate !== worker);
    worker.terminate().catch(() => {});
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const error = createPoolError('metadataPoolClosed', 'Metadata worker pool is closed');
    for (const job of this.queue.splice(0)) {
      job.signal?.removeEventListener('abort', job.abort);
      job.reject(error);
    }
    const workers = [...this.workers];
    for (const worker of workers) {
      if (worker.job) this.finish(worker, worker.job, error, true);
      else this.discard(worker);
    }
    await Promise.allSettled(workers.map(worker => worker.terminate()));
  }
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Metadata parse aborted');
  error.name = 'AbortError';
  error.code = 'metadata-aborted';
  return error;
}

function createPoolError(code, message) {
  const error = new Error(message);
  error.name = 'MetadataWorkerPoolError';
  error.code = code;
  return error;
}

module.exports = {
  DEFAULT_METADATA_TIMEOUT_MS,
  DEFAULT_METADATA_WORKERS,
  MAX_METADATA_QUEUE,
  MetadataWorkerPool
};
