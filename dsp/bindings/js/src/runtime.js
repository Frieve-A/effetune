import { loadDspArtifact } from './artifacts.js';
import { isBundleDocument, resolveChainAssets, splitBundle } from './assets.js';
import { createEngineSession } from './engine.js';
import { StateError, ValidationError } from './errors.js';
import {
  normalizeChainDocument,
  channelRange,
  packEffect,
  setEffectParameter,
  validateStreamParameterUpdate,
  validateEffectSampleRate,
  validateSampleRate,
  validateSeed
} from './semantics.js';

const PARAMETER_EVENT_KEYS = new Set(['frame', 'effectId', 'parameters']);

function validateAudio(audio) {
  if (!Array.isArray(audio) || audio.length < 1 || audio.length > 8) {
    throw new ValidationError('Audio must be an array containing between 1 and 8 Float32Array channels.');
  }
  const frames = audio[0] instanceof Float32Array ? audio[0].length : -1;
  for (const channel of audio) {
    if (!(channel instanceof Float32Array) || channel.length !== frames) {
      throw new ValidationError('Audio channels must be equally sized Float32Array values.');
    }
  }
  for (const channel of audio) {
    for (let frame = 0; frame < frames; frame++) {
      if (!Number.isFinite(channel[frame])) {
        throw new ValidationError('Audio samples must all be finite.');
      }
    }
  }
  return { channels: audio.length, frames };
}

function validateBlockSize(value = 128) {
  if (!Number.isInteger(value) || value < 1 || value > 16384) {
    throw new ValidationError('blockSize must be an integer from 1 to 16384.');
  }
  return value;
}

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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function effectIndex(document, effectId) {
  if (typeof effectId !== 'string' || effectId.length === 0) {
    throw new ValidationError('effectId must be a non-empty string.');
  }
  const index = document.chain.findIndex(effect => effect.id === effectId);
  if (index < 0) throw new ValidationError(`Unknown effect id: ${effectId}`);
  if (!document.chain[index].enabled) {
    throw new ValidationError(`Effect ${effectId} is disabled.`);
  }
  return index;
}

function updateEffectParameters(effect, parameters) {
  if (!isRecord(parameters)) {
    throw new ValidationError('Event parameters must be an object.');
  }
  let updated = effect;
  for (const [name, value] of Object.entries(parameters)) {
    validateStreamParameterUpdate(updated, name);
    updated = setEffectParameter(updated, name, value);
  }
  return updated;
}

function replaceEffect(document, index, effect) {
  const chain = [...document.chain];
  chain[index] = effect;
  return { version: 1, chain };
}

function validateParameterEvents(events, document, frameCount) {
  if (events === undefined) return [];
  if (!Array.isArray(events)) {
    throw new ValidationError('events must be an array.');
  }
  let workingDocument = cloneDocument(document);
  let previousFrame = -1;
  return events.map((event, eventIndex) => {
    if (!isRecord(event)) {
      throw new ValidationError(`Event ${eventIndex} must be an object.`);
    }
    for (const key of Object.keys(event)) {
      if (!PARAMETER_EVENT_KEYS.has(key)) {
        throw new ValidationError(`Event ${eventIndex} has an unsupported field: ${key}`);
      }
    }
    if (!Number.isInteger(event.frame) || event.frame < 0 || event.frame >= frameCount) {
      throw new ValidationError(
        `Event ${eventIndex} frame must be an integer from 0 to ${Math.max(0, frameCount - 1)}.`
      );
    }
    if (event.frame < previousFrame) {
      throw new ValidationError('events must be ordered by non-decreasing frame.');
    }
    previousFrame = event.frame;
    const index = effectIndex(workingDocument, event.effectId);
    const effect = updateEffectParameters(workingDocument.chain[index], event.parameters);
    workingDocument = replaceEffect(workingDocument, index, effect);
    return {
      frame: event.frame,
      effectId: event.effectId,
      effect,
      packed: packEffect(effect)
    };
  });
}

class ChainStream {
  constructor(document, session, {
    sampleRate,
    channels,
    blockSize,
    onTelemetry
  }) {
    this._initialDocument = cloneDocument(document);
    this._document = cloneDocument(document);
    this._session = session;
    this._sampleRate = sampleRate;
    this._channels = channels;
    this._blockSize = blockSize;
    this._processedFrames = 0;
    this._closed = false;
    this._emptyTelemetryCallbacks = new Set();
    if (onTelemetry !== undefined) this.subscribe(onTelemetry);
  }

  get preset() {
    this._assertOpen();
    return cloneDocument(this._document);
  }

  get effects() {
    return this.preset.chain;
  }

  get droppedTelemetryFrames() {
    this._assertOpen();
    return this._session?.droppedTelemetryFrames ?? 0;
  }

  get latencySamples() {
    this._assertOpen();
    return this._session?.latencySamples ?? 0;
  }

  _assertOpen() {
    if (this._closed) throw new StateError('The stream is closed.');
  }

  setParam(effectId, parameterName, value) {
    this._assertOpen();
    const index = effectIndex(this._document, effectId);
    validateStreamParameterUpdate(this._document.chain[index], parameterName);
    const effect = setEffectParameter(this._document.chain[index], parameterName, value);
    const packed = packEffect(effect);
    this._session?.setPacked(effectId, packed.values, packed.hash, packed.bytes);
    this._document = replaceEffect(this._document, index, effect);
    return this;
  }

  subscribe(callback) {
    this._assertOpen();
    if (typeof callback !== 'function') {
      throw new TypeError('Telemetry callback must be a function.');
    }
    if (this._session) return this._session.subscribe(callback);
    this._emptyTelemetryCallbacks.add(callback);
    return () => this.unsubscribe(callback);
  }

  unsubscribe(callback) {
    this._assertOpen();
    return this._session
      ? this._session.unsubscribe(callback)
      : this._emptyTelemetryCallbacks.delete(callback);
  }

  async process(audio, { events } = {}) {
    this._assertOpen();
    const layout = validateAudio(audio);
    if (layout.channels !== this._channels) {
      throw new ValidationError(
        `Audio has ${layout.channels} channel(s); this stream requires ${this._channels}.`
      );
    }
    const parameterEvents = validateParameterEvents(events, this._document, layout.frames);
    const output = audio.map(channel => new Float32Array(channel));
    if (layout.frames === 0) return output;

    let offset = 0;
    let eventIndex = 0;
    while (offset < layout.frames) {
      while (parameterEvents[eventIndex]?.frame === offset) {
        const event = parameterEvents[eventIndex];
        this._session?.setPacked(
          event.effectId,
          event.packed.values,
          event.packed.hash,
          event.packed.bytes
        );
        const index = effectIndex(this._document, event.effectId);
        this._document = replaceEffect(this._document, index, event.effect);
        eventIndex += 1;
      }
      const nextEventFrame = parameterEvents[eventIndex]?.frame ?? layout.frames;
      const frameCount = Math.min(
        this._blockSize,
        nextEventFrame - offset,
        layout.frames - offset
      );
      this._session?.process(
        audio,
        output,
        offset,
        frameCount,
        this._sampleRate,
        this._processedFrames + offset
      );
      offset += frameCount;
    }
    this._processedFrames += layout.frames;
    return output;
  }

  reset() {
    this._assertOpen();
    this._session?.reset();
    this._document = cloneDocument(this._initialDocument);
    this._processedFrames = 0;
    return this;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._emptyTelemetryCallbacks.clear();
    this._session?.close();
    this._session = null;
  }
}

export class Chain {
  constructor(document, resolvedAssets, artifact, artifactOptions) {
    this._document = document;
    this._resolvedAssets = resolvedAssets;
    this._artifact = artifact;
    this._artifactOptions = artifactOptions;
    this._closed = false;
  }

  get preset() {
    this._assertOpen();
    return cloneDocument(this._document);
  }

  get effects() {
    return this.preset.chain;
  }

  _assertOpen() {
    if (this._closed) throw new StateError('The chain is closed.');
  }

  setParam(effectId, parameterName, value) {
    this._assertOpen();
    if (typeof effectId !== 'string' || effectId.length === 0) {
      throw new ValidationError('effectId must be a non-empty string.');
    }
    const index = this._document.chain.findIndex(effect => effect.id === effectId);
    if (index < 0) throw new ValidationError(`Unknown effect id: ${effectId}`);
    const effects = [...this._document.chain];
    effects[index] = setEffectParameter(effects[index], parameterName, value);
    this._document = { version: 1, chain: effects };
    return this;
  }

  reset() {
    this._assertOpen();
    // Offline calls always create fresh state, so there is no retained state to reset.
    return this;
  }

  async _artifactForCurrentDocument() {
    if (activeEffects(this._document).length === 0) return null;
    if (!this._artifact) this._artifact = await loadDspArtifact(this._artifactOptions);
    return this._artifact;
  }

  async prewarm({
    sampleRate,
    channels = 2,
    blockSize = 128,
    seed = 0
  } = {}) {
    this._assertOpen();
    const rate = validateSampleRate(sampleRate);
    if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
      throw new ValidationError('channels must be an integer from 1 to 8.');
    }
    const frames = validateBlockSize(blockSize);
    const normalizedSeed = validateSeed(seed);
    for (const effect of activeEffects(this._document)) {
      validateEffectSampleRate(effect, rate);
      channelRange(effect.channel, channels);
    }
    const artifact = await this._artifactForCurrentDocument();
    if (!artifact) return this;
    const session = await createEngineSession(
      artifact,
      this._document.chain,
      this._resolvedAssets,
      { sampleRate: rate, channels, maxFrames: Math.max(128, frames), seed: normalizedSeed }
    );
    session.close();
    return this;
  }

  async latencySamples({
    sampleRate,
    channels = 2,
    blockSize = 128
  } = {}) {
    this._assertOpen();
    const stream = await this.stream({ sampleRate, channels, blockSize });
    try {
      return stream.latencySamples;
    } finally {
      stream.close();
    }
  }

  async stream({
    sampleRate,
    channels = 2,
    blockSize = 128,
    seed = 0,
    onTelemetry
  } = {}) {
    this._assertOpen();
    const rate = validateSampleRate(sampleRate);
    if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
      throw new ValidationError('channels must be an integer from 1 to 8.');
    }
    const framesPerBlock = validateBlockSize(blockSize);
    const normalizedSeed = validateSeed(seed);
    if (onTelemetry !== undefined && typeof onTelemetry !== 'function') {
      throw new TypeError('onTelemetry must be a function.');
    }
    for (const effect of activeEffects(this._document)) {
      validateEffectSampleRate(effect, rate);
      channelRange(effect.channel, channels);
    }
    const artifact = await this._artifactForCurrentDocument();
    const document = cloneDocument(this._document);
    const session = artifact
      ? await createEngineSession(
          artifact,
          document.chain,
          this._resolvedAssets,
          {
            sampleRate: rate,
            channels,
            maxFrames: Math.max(128, framesPerBlock),
            seed: normalizedSeed
          }
        )
      : null;
    return new ChainStream(document, session, {
      sampleRate: rate,
      channels,
      blockSize: framesPerBlock,
      onTelemetry
    });
  }

  async process(audio, {
    sampleRate,
    seed = 0,
    blockSize = 128,
    onTelemetry
  } = {}) {
    this._assertOpen();
    const layout = validateAudio(audio);
    const rate = validateSampleRate(sampleRate);
    const normalizedSeed = validateSeed(seed);
    const framesPerBlock = validateBlockSize(blockSize);
    if (onTelemetry !== undefined && typeof onTelemetry !== 'function') {
      throw new TypeError('onTelemetry must be a function.');
    }
    const output = audio.map(channel => new Float32Array(channel));
    const effects = activeEffects(this._document);
    if (layout.frames === 0 || effects.length === 0) return output;
    for (const effect of effects) {
      validateEffectSampleRate(effect, rate);
      channelRange(effect.channel, layout.channels);
    }
    const artifact = await this._artifactForCurrentDocument();
    const session = await createEngineSession(
      artifact,
      this._document.chain,
      this._resolvedAssets,
      {
        sampleRate: rate,
        channels: layout.channels,
        maxFrames: Math.max(128, Math.min(framesPerBlock, layout.frames)),
        seed: normalizedSeed
      }
    );
    try {
      if (onTelemetry) session.subscribe(onTelemetry);
      for (let offset = 0; offset < layout.frames; offset += framesPerBlock) {
        const frameCount = Math.min(framesPerBlock, layout.frames - offset);
        session.process(audio, output, offset, frameCount, rate);
      }
    } finally {
      session.close();
    }
    return output;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._artifact = null;
    this._resolvedAssets.clear();
  }
}

export async function createChain(input, options = {}) {
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
  const artifactOptions = {
    variant: options.variant,
    wasmUrl: options.wasmUrl,
    simdWasmUrl: options.simdWasmUrl,
    metaUrl: options.metaUrl,
    fetch: options.fetch,
    webAssembly: options.webAssembly,
    cache: options.cache
  };
  const artifact = activeEffects(document).length > 0
    ? await loadDspArtifact(artifactOptions)
    : null;
  return new Chain(document, resolvedAssets, artifact, artifactOptions);
}

export { isBundleDocument };
