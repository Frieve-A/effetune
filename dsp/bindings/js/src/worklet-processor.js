import { createEngineSession } from './engine.js';
import { errorMessage } from './errors.js';
import { countTelemetryFrames, TELEMETRY_RING_BYTES } from './telemetry.js';

class EffeTuneDspProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.session = null;
    this.ready = false;
    this.closed = false;
    this.latencySamples = null;
    this.channels = 0;
    this.pendingCommands = [];
    this.sourceChannels = [];
    this.targetChannels = [];
    this.telemetryEnabled = false;
    this.telemetryPackets = Array.from(
      { length: 4 },
      () => new ArrayBuffer(TELEMETRY_RING_BYTES)
    );
    this.telemetryDiscardPacket = new Uint8Array(TELEMETRY_RING_BYTES);
    this.telemetryDropped = 0;
    this.port.onmessage = event => this.handleMessage(event.data);
  }

  handleMessage(message) {
    if (message?.type === 'initialize') {
      this.initialize(message);
      return;
    }
    if (message?.type === 'close') {
      this.closed = true;
      this.session?.close();
      this.session = null;
      return;
    }
    if (message?.type === 'telemetryReturn') {
      if (message.packet instanceof ArrayBuffer &&
          message.packet.byteLength === TELEMETRY_RING_BYTES) {
        this.telemetryPackets.push(message.packet);
      }
      return;
    }
    if (message?.type === 'setParam' || message?.type === 'reset' ||
        message?.type === 'setTelemetryEnabled') {
      this.pendingCommands.push(message);
    }
  }

  async initialize(message) {
    try {
      this.channels = message.channels;
      this.sourceChannels = new Array(this.channels);
      this.targetChannels = new Array(this.channels);
      const active = message.document.chain.some(effect => effect.enabled);
      if (active) {
        this.session = await createEngineSession(
          { bytes: message.wasmBytes },
          message.document.chain,
          message.resolvedAssets,
          {
            sampleRate,
            channels: message.channels,
            maxFrames: 128,
            seed: message.seed
          }
        );
      }
      this.ready = true;
      this.latencySamples = this.session?.latencySamples ?? 0;
      this.port.postMessage({ type: 'ready', latencySamples: this.latencySamples });
    } catch (error) {
      this.port.postMessage({
        type: 'initializationError',
        ...errorMessage(
          error,
          'The AudioWorklet DSP processor could not be initialized.'
        )
      });
    }
  }

  applyCommands() {
    for (const command of this.pendingCommands.splice(0)) {
      try {
        if (command.type === 'setParam') {
          this.session?.setPacked(
            command.effectId,
            command.values,
            command.hash,
            command.bytes
          );
        } else if (command.type === 'reset') {
          this.session?.reset();
        } else if (command.type === 'setTelemetryEnabled') {
          this.telemetryEnabled = command.enabled === true;
          this.session?.setTelemetryEnabled(this.telemetryEnabled);
          continue;
        }
        const latencySamples = this.session?.latencySamples ?? 0;
        if (latencySamples !== this.latencySamples) {
          this.latencySamples = latencySamples;
          this.port.postMessage({ type: 'latency', latencySamples });
        }
        this.port.postMessage({ type: 'commandResult', commandId: command.commandId, ok: true });
      } catch (error) {
        this.port.postMessage({
          type: 'commandResult',
          commandId: command.commandId,
          ok: false,
          ...errorMessage(error, 'The AudioWorklet command failed.')
        });
      }
    }
  }

  drainTelemetry() {
    if (!this.session || !this.telemetryEnabled) return;
    const buffer = this.telemetryPackets.pop();
    const packet = buffer ? new Uint8Array(buffer) : this.telemetryDiscardPacket;
    const { bytes, dropped } = this.session.readTelemetryPacket(packet);
    if (!buffer) {
      this.telemetryDropped += dropped + countTelemetryFrames(packet, bytes);
      return;
    }
    if (bytes === 0) {
      this.telemetryDropped += dropped;
      this.telemetryPackets.push(buffer);
      return;
    }
    this.port.postMessage({
      type: 'telemetry',
      packet: buffer,
      bytes,
      dropped: this.telemetryDropped + dropped
    }, [buffer]);
    this.telemetryDropped = 0;
  }

  passthrough(input, output) {
    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel];
      if (source) output[channel].set(source);
      else output[channel].fill(0);
    }
  }

  process(inputs, outputs) {
    if (this.closed) return false;
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (!this.ready) {
      this.passthrough(input, output);
      return true;
    }
    this.applyCommands();
    if (!this.session) {
      this.passthrough(input, output);
      return true;
    }
    for (let channel = 0; channel < this.channels; channel++) {
      this.sourceChannels[channel] = input[channel] ?? output[channel];
      this.targetChannels[channel] = output[channel];
    }
    try {
      this.session.process(this.sourceChannels, this.targetChannels, 0, 128, sampleRate);
      this.drainTelemetry();
    } catch (error) {
      this.session.close();
      this.session = null;
      for (const channel of output) channel.fill(0);
      this.port.postMessage({
        type: 'processingError',
        ...errorMessage(error, 'Audio processing failed.')
      });
      return false;
    }
    return true;
  }
}

registerProcessor('effetune-dsp-processor', EffeTuneDspProcessor);
