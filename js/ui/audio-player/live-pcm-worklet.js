import { LivePcmCore } from './live-pcm-core.js';

class LivePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new LivePcmCore(sampleRate);
    this.generation = null;
    this.announced = false;
    this.disposed = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') { this.generation = data.generation; this.core.reset(); this.announced = false; }
      if (data.generation !== this.generation) return;
      if (data.type === 'reset') { this.core.reset(data.startFrame); this.announced = false; }
      if (data.type === 'pcm') {
        const accepted = this.core.push(data);
        this.port.postMessage({ type: 'credit', generation: this.generation, accepted });
        if (!this.announced && this.core.buffered) {
          this.announced = true;
          this.port.postMessage({ type: 'buffered', generation: this.generation });
        }
      }
      if (data.type === 'end') this.disposed = true;
    };
  }
  process(_inputs, outputs) {
    if (this.disposed) return false;
    if (outputs[0]?.length >= 2) this.core.render(outputs[0]);
    return true;
  }
}
registerProcessor('effetune-live-pcm', LivePcmProcessor);
