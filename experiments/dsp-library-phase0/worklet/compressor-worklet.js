import { DSP_PARAM_PACKERS } from '/js/audio/dsp-params.generated.js';

const TYPE = 'CompressorPlugin';
const PLUGIN_ID = 9001;

class PortObserver {
  constructor(port) {
    this.port = port;
    this.messages = [];
    this.waiters = new Set();
    port.onmessage = event => {
      this.messages.push(event.data);
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(event.data)) continue;
        this.waiters.delete(waiter);
        clearTimeout(waiter.timeout);
        waiter.resolve(event.data);
      }
    };
    port.start?.();
  }

  waitFor(predicate, label, timeoutMs = 10000) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for ${label}`));
        }, timeoutMs)
      };
      this.waiters.add(waiter);
    });
  }

  close() {
    for (const waiter of this.waiters) clearTimeout(waiter.timeout);
    this.waiters.clear();
    this.port.onmessage = null;
  }
}

function internalParams(params) {
  return {
    th: params.threshold ?? -24,
    rt: params.ratio ?? 2,
    at: params.attack ?? 10,
    rl: params.release ?? 100,
    kn: params.knee ?? 3,
    gn: params.gain ?? 0
  };
}

export class CompressorWorklet {
  static async create(context, {
    channels,
    params = {},
    wasmUrl = '/plugins/dsp/effetune-dsp.wasm',
    processorUrl = '/plugins/audio-processor.js'
  }) {
    if (!Number.isInteger(channels) || channels <= 0) {
      throw new TypeError('channels must be a positive integer');
    }
    await context.audioWorklet.addModule(processorUrl);
    const node = new AudioWorkletNode(context, 'plugin-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
      processorOptions: { initialOutputChannelCount: channels }
    });
    const observer = new PortObserver(node.port);

    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Unable to load DSP module: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    node.port.postMessage({
      type: 'updateAudioConfig',
      sampleRate: context.sampleRate,
      outputChannels: channels
    });
    node.port.postMessage({
      type: 'dspModule',
      bytes
    }, [bytes]);

    const ready = await observer.waitFor(message => message?.type === 'dspReady', 'dspReady');
    const packer = DSP_PARAM_PACKERS.get(TYPE);
    const kernel = ready.kernels.find(entry => entry.name === TYPE);
    if (!packer || !kernel || (kernel.hash >>> 0) !== (packer.hash >>> 0)) {
      throw new Error('Compressor packer and WASM kernel are incompatible');
    }

    const packedParams = internalParams(params);
    node.port.postMessage({ type: 'dspEnableTypes', types: [TYPE] });
    node.port.postMessage({
      type: 'updatePlugins',
      masterBypass: false,
      plugins: [{
        id: PLUGIN_ID,
        type: TYPE,
        enabled: true,
        inputBus: 0,
        outputBus: 0,
        channel: 'A',
        parameters: {
          enabled: true,
          inputBus: 0,
          outputBus: 0,
          channel: 'A',
          ...packedParams
        },
        wasmParams: packer.pack(packedParams),
        wasmParamsHash: packer.hash
      }]
    });
    node.port.postMessage({
      type: 'configurePowerPolicy',
      commandId: 1,
      enabled: true,
      workletGraphGeneration: 1,
      topologyRevision: 1,
      silenceThresholdDb: -80,
      silenceDurationSeconds: 60,
      wakeGainMarginDb: 0,
      monitoringFastWakeEligible: false,
      temporalSkipEligible: false,
      enabledPluginCount: 1,
      monitoringPreparationCapabilities: []
    });
    await observer.waitFor(
      message => message?.type === 'powerStateAck' && message.commandId === 1,
      'power policy acknowledgement'
    );
    return new CompressorWorklet(node, observer, ready, kernel);
  }

  constructor(node, observer, ready, kernel) {
    this.node = node;
    this.observer = observer;
    this.ready = ready;
    this.kernel = kernel;
  }

  requestWasmEvidence() {
    const observationRequestId = 1;
    this.node.port.postMessage({
      type: 'requestPowerObservation',
      observationRequestId,
      workletGraphGeneration: 1,
      topologyRevision: 1
    });
    return this.observer.waitFor(
      message => message?.type === 'powerObservation' &&
        message.observationRequestId === observationRequestId,
      'AudioWorklet WASM processing evidence'
    );
  }

  close() {
    this.node.disconnect();
    this.observer.close();
  }
}
