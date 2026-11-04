import { sfzError } from './parser.js';
import { sfzPreparationContext } from './preparation-context.js';

// Compiled bank control data ends before the resident PCM pool. Streamed banks
// contain metadata only, so their control prefix is the complete payload.
export function samplePlayerPreparationData(payload) {
  if (!(payload instanceof ArrayBuffer) || payload.byteLength < 56 || payload.byteLength > 0xffffffff || payload.byteLength % 4)
    throw sfzError('prepare', 'The instrument preparation data is invalid.');
  const header = new DataView(payload);
  const controlBytes = 32 + header.getUint32(48, true) * 4;
  if (header.getUint32(0, true) !== 0x31415445 || controlBytes < 56 || controlBytes > payload.byteLength)
    throw sfzError('prepare', 'The instrument preparation data is invalid.');
  return { control: payload.slice(0, controlBytes), payloadBytes: payload.byteLength };
}

export class SfzEffectCost {
  constructor(module, { workerFactory = () => new Worker(new URL('./effect-cost-worker.js', import.meta.url), { type: 'module' }) } = {}) {
    this.worker = workerFactory();
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.ok) request.resolve(data.bytes); else request.reject(sfzError('prepare', 'The instrument effects could not be prepared for these audio settings.'));
    };
    const failed = error => {
      console.error('SFZ sizing worker failed:', error);
      this.close(sfzError('prepare', 'The instrument effects could not be prepared. Try loading the instrument again.'));
    };
    this.worker.onerror = failed;
    this.worker.onmessageerror = failed;
    this.ready = this.call('module', { module }).catch(error => { this.close(error); throw error; });
  }

  call(type, data, transfer = []) {
    if (this.closed) return Promise.reject(this.error);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ type, id, ...data }, transfer); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  async estimate(payload, context, formatTag = 1) {
    await this.ready;
    const { control, payloadBytes } = samplePlayerPreparationData(payload);
    return this.call('estimate', { control, payloadBytes, context: sfzPreparationContext(context), formatTag }, [control]);
  }

  close(error = sfzError('cancelled', 'Instrument preparation was cancelled.')) {
    if (this.closed) return;
    this.closed = true;
    this.error = error;
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
