import { loadDspArtifact } from './artifacts.js';
import { resolveChainAssets, splitBundle } from './assets.js';
import {
  EffeTuneRuntimeError,
  errorFromMessage,
  StateError,
  ValidationError
} from './errors.js';
import {
  normalizeChainDocument,
  channelRange,
  packEffect,
  setEffectParameter,
  validateStreamParameterUpdate,
  validateEffectSampleRate,
  validateSeed
} from './semantics.js';
import { decodeTelemetryPacket } from './telemetry.js';

const PROCESSOR_NAME = 'effetune-dsp-processor';
const AudioWorkletNodeBase = globalThis.AudioWorkletNode ?? class {};
const moduleLoads = new WeakMap();

function activeEffects(document) {
  return document.chain.filter(effect => effect.enabled);
}

function cloneDocument(document) {
  return {
    version: 1,
    chain: document.chain.map(effect => ({
      ...effect,
      parameters: Object.fromEntries(
        Object.entries(effect.parameters).map(([name, value]) => [
          name,
          Array.isArray(value) ? [...value] : value
        ])
      ),
      ...(effect.assets ? { assets: { ...effect.assets } } : {})
    }))
  };
}

function validateChannels(channels) {
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new ValidationError('channels must be an integer from 1 to 8.');
  }
  return channels;
}

function loadProcessorModule(context, processorUrl) {
  if (!context?.audioWorklet || typeof context.audioWorklet.addModule !== 'function') {
    throw new ValidationError('An AudioContext with AudioWorklet support is required.');
  }
  let byUrl = moduleLoads.get(context.audioWorklet);
  if (!byUrl) {
    byUrl = new Map();
    moduleLoads.set(context.audioWorklet, byUrl);
  }
  const key = String(processorUrl);
  if (!byUrl.has(key)) {
    let load;
    try {
      load = Promise.resolve(context.audioWorklet.addModule(processorUrl));
    } catch (error) {
      throw new EffeTuneRuntimeError(
        'Unable to load the AudioWorklet DSP processor module.',
        { cause: error }
      );
    }
    const cached = load.catch(error => {
      if (byUrl.get(key) === cached) byUrl.delete(key);
      throw new EffeTuneRuntimeError(
        'Unable to load the AudioWorklet DSP processor module.',
        { cause: error }
      );
    });
    byUrl.set(key, cached);
  }
  return byUrl.get(key);
}

function validateProcessorUrl(value) {
  const url = value instanceof URL ? value : new URL(String(value), import.meta.url);
  if (!['file:', 'https:', 'http:'].includes(url.protocol)) {
    throw new ValidationError(`Unsupported AudioWorklet processor URL scheme: ${url.protocol}`);
  }
  if (url.protocol === 'http:') {
    const moduleUrl = new URL(import.meta.url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!local && url.origin !== moduleUrl.origin) {
      throw new ValidationError('Cross-origin AudioWorklet processors must use HTTPS.');
    }
  }
  return url;
}

function cloneAssetsForWorklet(resolvedAssets) {
  const cloned = new Map();
  const transfer = [];
  for (const [effectId, assets] of resolvedAssets) {
    const values = {};
    for (const [name, asset] of Object.entries(assets)) {
      const bytes = new Uint8Array(asset.bytes);
      values[name] = { ...asset, bytes };
      transfer.push(bytes.buffer);
    }
    cloned.set(effectId, values);
  }
  return { cloned, transfer };
}

export class EffeTuneNode extends AudioWorkletNodeBase {
  static async create(context, input, options = {}) {
    const channels = validateChannels(options.channels ?? 2);
    const seed = validateSeed(options.seed ?? 0);
    const source = typeof input === 'string'
      ? (() => {
          try {
            return JSON.parse(input);
          } catch (error) {
            throw new ValidationError('Chain input is not valid JSON.', { cause: error });
          }
        })()
      : input;
    const { chain, manifest } = splitBundle(source);
    const document = normalizeChainDocument(chain);
    const resolvedAssets = await resolveChainAssets(document, {
      assetResolver: options.assetResolver,
      manifest
    });
    for (const effect of activeEffects(document)) {
      validateEffectSampleRate(effect, context.sampleRate);
      channelRange(effect.channel, channels);
    }

    const processorUrl = validateProcessorUrl(
      options.processorUrl ?? new URL('./worklet-processor.js', import.meta.url)
    );
    await loadProcessorModule(context, processorUrl);
    const artifact = activeEffects(document).length > 0
      ? await loadDspArtifact({
          variant: options.variant,
          wasmUrl: options.wasmUrl,
          simdWasmUrl: options.simdWasmUrl,
          metaUrl: options.metaUrl,
          fetch: options.fetch,
          webAssembly: options.webAssembly,
          cache: options.cache
        })
      : null;
    const node = new EffeTuneNode(context, channels, document, seed);
    const wasmBytes = artifact ? artifact.bytes.slice(0) : null;
    const assets = cloneAssetsForWorklet(resolvedAssets);
    const transfer = [...assets.transfer, ...(wasmBytes ? [wasmBytes] : [])];
    node.port.postMessage({
      type: 'initialize',
      document,
      resolvedAssets: assets.cloned,
      wasmBytes,
      channels,
      seed
    }, transfer);
    try {
      await node._waitUntilReady();
      return node;
    } catch (error) {
      node.close();
      throw error;
    }
  }

  constructor(context, channels, document, seed) {
    super(context, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
      channelCount: channels,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete'
    });
    this._initialDocument = cloneDocument(document);
    this._document = cloneDocument(document);
    this._seed = seed;
    this._closed = false;
    this._runtimeError = null;
    this._nextCommandId = 1;
    this._pending = new Map();
    this._telemetryCallbacks = new Set();
    this._telemetryPendingDropped = 0;
    this._droppedTelemetryFrames = 0;
    let tapId = 1;
    this._telemetryNodesByTap = new Map();
    for (const [effectIndex, effect] of document.chain.entries()) {
      if (!effect.enabled) continue;
      this._telemetryNodesByTap.set(tapId++, {
        effectType: effect.type,
        effectId: effect.id,
        effectIndex
      });
    }
    this._mutationQueue = Promise.resolve();
    this._ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this.port.onmessage = event => this._handleMessage(event.data);
    this.port.start?.();
  }

  _handleMessage(message) {
    if (message?.type === 'telemetry') {
      const packet = message.packet;
      const dropped = Number.isInteger(message.dropped) && message.dropped >= 0
        ? message.dropped
        : 0;
      this._droppedTelemetryFrames += dropped;
      if (packet instanceof ArrayBuffer) {
        const decoded = decodeTelemetryPacket(
          new Uint8Array(packet),
          message.bytes,
          this._telemetryNodesByTap,
          this._telemetryPendingDropped + dropped
        );
        this._telemetryPendingDropped = decoded.pendingDropped;
        for (const frame of decoded.frames) {
          for (const callback of this._telemetryCallbacks) {
            try {
              callback(frame);
            } catch (error) {
              console.warn('EffeTune telemetry callback failed.', error);
            }
          }
        }
        this.port.postMessage({ type: 'telemetryReturn', packet }, [packet]);
      }
      return;
    }
    if (message?.type === 'ready') {
      this._resolveReady();
      return;
    }
    if (message?.type === 'initializationError') {
      this._rejectReady(errorFromMessage(
        message.errorType,
        message.message,
        'The AudioWorklet DSP processor could not be initialized.'
      ));
      return;
    }
    if (message?.type === 'processingError') {
      const error = errorFromMessage(
        message.errorType,
        message.message,
        'The AudioWorklet DSP processor stopped after a processing error.'
      );
      this._runtimeError = error;
      for (const pending of this._pending.values()) pending.reject(error);
      this._pending.clear();
      this.dispatchEvent?.(new Event('processorerror'));
      return;
    }
    if (message?.type !== 'commandResult') return;
    const pending = this._pending.get(message.commandId);
    if (!pending) return;
    this._pending.delete(message.commandId);
    if (message.ok) pending.resolve();
    else pending.reject(errorFromMessage(
      message.errorType,
      message.message,
      'The AudioWorklet command failed.'
    ));
  }

  async _waitUntilReady() {
    const timeout = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(errorFromMessage(
          'EffeTuneRuntimeError',
          undefined,
          'Timed out while initializing the AudioWorklet DSP processor.'
        ));
      }, 10000);
      this._ready.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer)
      );
    });
    return Promise.race([this._ready, timeout]);
  }

  _assertOpen() {
    if (this._closed) throw new StateError('The EffeTuneNode is closed.');
    if (this._runtimeError) throw this._runtimeError;
  }

  _command(command) {
    this._assertOpen();
    const commandId = this._nextCommandId++;
    const promise = new Promise((resolve, reject) => {
      this._pending.set(commandId, { resolve, reject });
    });
    this.port.postMessage({ ...command, commandId });
    return promise;
  }

  _mutate(operation) {
    const result = this._mutationQueue.then(operation);
    this._mutationQueue = result.catch(() => {});
    return result;
  }

  get droppedTelemetryFrames() {
    this._assertOpen();
    return this._droppedTelemetryFrames;
  }

  subscribe(callback) {
    this._assertOpen();
    if (typeof callback !== 'function') {
      throw new TypeError('Telemetry callback must be a function.');
    }
    const wasEmpty = this._telemetryCallbacks.size === 0;
    this._telemetryCallbacks.add(callback);
    if (wasEmpty) {
      this.port.postMessage({ type: 'setTelemetryEnabled', enabled: true });
    }
    return () => this.unsubscribe(callback);
  }

  unsubscribe(callback) {
    this._assertOpen();
    const removed = this._telemetryCallbacks.delete(callback);
    if (removed && this._telemetryCallbacks.size === 0) {
      this.port.postMessage({ type: 'setTelemetryEnabled', enabled: false });
    }
    return removed;
  }

  setParam(effectId, parameterName, value) {
    return this._mutate(async () => {
      this._assertOpen();
      const index = this._document.chain.findIndex(effect => effect.id === effectId);
      if (index < 0) throw new ValidationError(`Unknown effect id: ${effectId}`);
      const effects = [...this._document.chain];
      validateStreamParameterUpdate(effects[index], parameterName);
      effects[index] = setEffectParameter(effects[index], parameterName, value);
      if (effects[index].enabled) {
        const packed = packEffect(effects[index]);
        await this._command({
          type: 'setParam',
          effectId,
          values: packed.values,
          hash: packed.hash,
          bytes: packed.bytes
        });
      }
      this._document = { version: 1, chain: effects };
    });
  }

  reset() {
    return this._mutate(async () => {
      this._assertOpen();
      await this._command({ type: 'reset' });
      this._document = cloneDocument(this._initialDocument);
    });
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._telemetryCallbacks.clear();
    this.port.postMessage({ type: 'close' });
    for (const pending of this._pending.values()) {
      pending.reject(new StateError('The EffeTuneNode was closed before its command completed.'));
    }
    this._pending.clear();
    this.port.onmessage = null;
    try {
      this.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}
