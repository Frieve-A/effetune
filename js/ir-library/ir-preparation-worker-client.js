export class IrPreparationWorkerClient {
  constructor({ WorkerClass = globalThis.Worker, workerUrl } = {}) {
    if (typeof WorkerClass !== 'function') {
      throw new Error('Impulse response preparation is unavailable in this browser.');
    }
    this.worker = new WorkerClass(
      workerUrl || new URL('./ir-preparation-worker.js', import.meta.url),
      { type: 'module' }
    );
    this.nextId = 1;
    this.pending = new Map();
    this.worker.addEventListener('message', event => this.handleMessage(event.data));
    this.worker.addEventListener('error', event => this.handleWorkerError(event));
  }

  prepare(request) {
    return this.sendWithClonedChannels('prepare', request);
  }

  emit(request) {
    return this.sendWithClonedChannels('emit', request);
  }

  sendWithClonedChannels(operation, request) {
    const channels = request.channels.map(channel => channel.slice());
    const transfer = channels.map(channel => channel.buffer);
    return this.request({ operation, request: { ...request, channels } }, transfer);
  }

  request(message, transfer) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...message }, transfer);
    });
  }

  handleMessage(message) {
    const pending = this.pending.get(message?.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      console.error('IR preparation worker failed:', message.diagnostic || message.error);
      pending.reject(new Error(message.error));
      return;
    }
    pending.resolve(message.result);
  }

  handleWorkerError(event) {
    console.error('IR preparation worker stopped unexpectedly:', event?.message || event);
    const error = new Error('The impulse response could not be prepared.');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  close() {
    this.worker.terminate();
    const error = new Error('Impulse response preparation was cancelled.');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export function createIrPreparationWorkerClient(options) {
  return new IrPreparationWorkerClient(options);
}
