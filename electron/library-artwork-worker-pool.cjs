'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const DEFAULT_ARTWORK_WORKERS = 4;
const DEFAULT_ARTWORK_TIMEOUT_MS = 15_000;
const MAX_ARTWORK_QUEUE = 256;

class ArtworkWorkerPool {
  constructor({
    workerCount = DEFAULT_ARTWORK_WORKERS,
    timeoutMs = DEFAULT_ARTWORK_TIMEOUT_MS,
    workerFactory = () => new Worker(path.join(__dirname, 'library-artwork-worker.cjs'))
  } = {}) {
    if (!Number.isSafeInteger(workerCount) || workerCount < 1 || workerCount > 4) {
      throw createPoolError('invalidArtworkPool', 'Artwork worker count must be from 1 to 4');
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

  extract({ filePath, signal } = {}) {
    if (this.closed) return Promise.reject(createPoolError('artworkPoolClosed', 'Artwork pool is closed'));
    if (signal?.aborted) return Promise.reject(abortError(signal));
    if (this.queue.length >= MAX_ARTWORK_QUEUE) {
      return Promise.reject(createPoolError('artworkQueueLimit', 'Artwork queue limit reached'));
    }
    return new Promise((resolve, reject) => {
      const job = { requestId: this.nextRequestId++, filePath, signal, resolve, reject, worker: null, timer: null };
      job.abort = () => this.abortJob(job);
      signal?.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job);
      this.drain();
    });
  }

  abortJob(job) {
    if (job.worker) this.finish(job.worker, job, abortError(job.signal), true);
    else {
      this.queue = this.queue.filter(candidate => candidate !== job);
      job.signal?.removeEventListener('abort', job.abort);
      job.reject(abortError(job.signal));
    }
  }

  drain() {
    while (this.queue.length) {
      const worker = this.acquireWorker();
      if (!worker) return;
      const job = this.queue.shift();
      worker.job = job;
      job.worker = worker;
      job.timer = setTimeout(() => {
        this.finish(worker, job, createPoolError('artwork-timeout', 'Artwork extraction timed out'), true);
      }, this.timeoutMs);
      job.timer.unref?.();
      worker.postMessage({ type: 'extract', requestId: job.requestId, filePath: job.filePath });
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
      if (this.workers.has(worker)) this.handleFailure(worker, createPoolError('artwork-worker-crash', `Artwork worker exited with code ${code}`));
    });
    this.workers.add(worker);
    return worker;
  }

  handleMessage(worker, message) {
    const job = worker.job;
    if (!job || message?.requestId !== job.requestId) return;
    if (message.type === 'error') {
      this.finish(worker, job, createPoolError(message.error?.code || 'artwork-decode-failed', message.error?.message || 'Artwork extraction failed'), false);
    } else if (message.type === 'result') {
      this.finish(worker, job, null, false, message.result);
    }
  }

  handleFailure(worker, error) {
    if (worker.job) this.finish(worker, worker.job, createPoolError('artwork-worker-crash', error?.message || 'Artwork worker crashed'), true);
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
    const error = createPoolError('artworkPoolClosed', 'Artwork pool is closed');
    for (const job of this.queue.splice(0)) job.reject(error);
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
  const error = new Error('Artwork extraction aborted');
  error.name = 'AbortError';
  error.code = 'artwork-aborted';
  return error;
}

function createPoolError(code, message) {
  const error = new Error(message);
  error.name = 'ArtworkWorkerPoolError';
  error.code = code;
  return error;
}

module.exports = {
  ArtworkWorkerPool,
  DEFAULT_ARTWORK_TIMEOUT_MS,
  DEFAULT_ARTWORK_WORKERS,
  MAX_ARTWORK_QUEUE
};
