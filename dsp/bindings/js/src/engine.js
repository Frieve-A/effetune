import { instantiateDspBinding, ET_OK } from './internal/dsp-engine-binding.js';
import { getEffectImplementation } from './catalog.js';
import { prepareConvolutionAsset } from './assets.js';
import { EffeTuneError, EffeTuneRuntimeError } from './errors.js';
import { channelRange, packEffect } from './semantics.js';
import {
  decodeTelemetryPacket,
  TELEMETRY_RATE_HZ,
  TELEMETRY_RING_BYTES
} from './telemetry.js';

function requireOk(status, operation) {
  if (status !== ET_OK) {
    throw new EffeTuneRuntimeError(`DSP ${operation} failed.`);
  }
}

export async function createEngineSession(artifact, effects, resolvedAssets, {
  sampleRate,
  channels,
  maxFrames,
  seed
}) {
  let binding;
  const nodes = [];
  try {
    binding = await instantiateDspBinding(artifact.module ?? artifact.bytes ?? artifact, {
      warning: () => {}
    });
    binding.createEngine();
    requireOk(
      binding.prepare(sampleRate, channels, maxFrames, TELEMETRY_RING_BYTES),
      'preparation'
    );
    requireOk(binding.setTelemetryRate(0), 'telemetry configuration');
    let tapId = 1;
    for (const [effectIndex, effect] of effects.entries()) {
      if (!effect.enabled) continue;
      const packed = packEffect(effect);
      const instanceId = binding.createInstance(packed.internalType);
      if (!instanceId) throw new EffeTuneRuntimeError(`Unable to create ${effect.type}.`);
      requireOk(binding.instanceSetTap(instanceId, tapId), `${effect.type} telemetry mapping`);
      requireOk(binding.instanceSetSeed(instanceId, seed), `${effect.type} seed configuration`);
      requireOk(
        binding.instanceSetParams(instanceId, packed.values, packed.hash),
        `${effect.type} parameter configuration`
      );
      if (packed.bytes) {
        requireOk(
          binding.instanceSetParamBytes(instanceId, packed.bytes, packed.hash),
          `${effect.type} structured parameter configuration`
        );
      }
      const implementation = getEffectImplementation(effect.type);
      if (implementation.assets?.length) {
        const prepared = prepareConvolutionAsset(effect, resolvedAssets, {
          sampleRate,
          engineChannels: channels
        });
        const slot = implementation.assets?.find(asset => asset.publicName === 'impulseResponse')?.slot ?? 0;
        requireOk(
          binding.instanceSetAsset(
            instanceId,
            slot,
            prepared.payload,
            prepared.beginInfo,
            prepared.formatTag
          ),
          `${effect.type} asset preparation`
        );
        const arena = binding.getArenaViews();
        const warmupFrames = 128;
        const processingChannels = prepared.beginInfo.processingChannels;
        const silence = arena.scratch.allChannels.subarray(
          0,
          processingChannels * warmupFrames
        );
        const silencePtr = binding.pointerForArenaView(silence);
        let state = binding.instanceAssetState(instanceId, slot);
        const maximumWarmupBlocks = Math.ceil(2 * sampleRate / warmupFrames);
        for (let block = 0; (state & 0xff) === 2 && block < maximumWarmupBlocks; block++) {
          silence.fill(0);
          requireOk(
            binding.instanceProcess(
              instanceId,
              silencePtr,
              processingChannels,
              warmupFrames,
              block * warmupFrames / sampleRate
            ),
            `${effect.type} asset prewarming`
          );
          state = binding.instanceAssetState(instanceId, slot);
        }
        if ((state & 0xff) !== 3) {
          throw new EffeTuneRuntimeError(`${effect.type} asset did not become active.`);
        }
        requireOk(binding.resetInstance(instanceId), `${effect.type} post-prewarm reset`);
        requireOk(binding.instanceSetSeed(instanceId, seed), `${effect.type} post-prewarm seed reset`);
        requireOk(
          binding.instanceSetParams(instanceId, packed.values, packed.hash),
          `${effect.type} post-prewarm parameter reset`
        );
      }
      nodes.push({
        effectId: effect.id,
        effectType: effect.type,
        effectIndex,
        instanceId,
        tapId: tapId++,
        range: channelRange(effect.channel, channels),
        initialValues: new Float32Array(packed.values),
        initialBytes: packed.bytes ? new Uint8Array(packed.bytes) : null,
        hash: packed.hash
      });
    }
    return new EngineSession(binding, nodes, { channels, maxFrames, seed });
  } catch (error) {
    binding?.close();
    if (error instanceof EffeTuneError) throw error;
    throw new EffeTuneRuntimeError('Unable to create the DSP processing state.', { cause: error });
  }
}

export class EngineSession {
  constructor(binding, nodes, { channels, maxFrames, seed }) {
    this.binding = binding;
    this.nodes = nodes;
    this.channels = channels;
    this.maxFrames = maxFrames;
    this.seed = seed;
    this.closed = false;
    this.arena = binding.getArenaViews().combined;
    this.arenaByteOffset = this.arena.byteOffset;
    this.fullChannelViews = Array.from({ length: channels }, (_, channel) =>
      this.arena.subarray(channel * maxFrames, (channel + 1) * maxFrames)
    );
    this.nodesByTap = new Map(nodes.map(node => [node.tapId, node]));
    this.telemetryBuffer = new Uint8Array(TELEMETRY_RING_BYTES);
    this.telemetryCallbacks = new Set();
    this.telemetryEnabled = false;
    this.telemetryPendingDropped = 0;
    this.droppedTelemetryFrames = 0;
  }

  get latencySamples() {
    if (this.closed) throw new EffeTuneRuntimeError('DSP processing state is closed.');
    let latency = 0;
    for (const node of this.nodes) {
      latency += this.binding.instanceLatency(node.instanceId);
    }
    return latency;
  }

  process(input, output, offset, frameCount, sampleRate, timeFrame = offset) {
    if (this.closed) throw new EffeTuneRuntimeError('DSP processing state is closed.');
    for (let channel = 0; channel < this.channels; channel++) {
      const target = frameCount === this.maxFrames
        ? this.fullChannelViews[channel]
        : this.arena.subarray(channel * frameCount, (channel + 1) * frameCount);
      target.set(offset === 0 && input[channel].length === frameCount
        ? input[channel]
        : input[channel].subarray(offset, offset + frameCount));
    }
    for (const node of this.nodes) {
      const audioPtr = this.arenaByteOffset +
        node.range.start * frameCount * Float32Array.BYTES_PER_ELEMENT;
      requireOk(
        this.binding.instanceProcess(
          node.instanceId,
          audioPtr,
          node.range.count,
          frameCount,
          timeFrame / sampleRate
        ),
        `${node.effectType} processing`
      );
    }
    for (let channel = 0; channel < this.channels; channel++) {
      const source = frameCount === this.maxFrames
        ? this.fullChannelViews[channel]
        : this.arena.subarray(channel * frameCount, (channel + 1) * frameCount);
      output[channel].set(source, offset);
    }
    if (this.telemetryCallbacks.size > 0) this.drainTelemetry();
  }

  setTelemetryEnabled(enabled) {
    if (this.closed) throw new EffeTuneRuntimeError('DSP processing state is closed.');
    if (this.telemetryEnabled === enabled) return;
    requireOk(
      this.binding.setTelemetryRate(enabled ? TELEMETRY_RATE_HZ : 0),
      'telemetry configuration'
    );
    this.telemetryEnabled = enabled;
  }

  subscribe(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Telemetry callback must be a function.');
    }
    this.telemetryCallbacks.add(callback);
    if (this.telemetryCallbacks.size === 1) this.setTelemetryEnabled(true);
    return () => this.unsubscribe(callback);
  }

  unsubscribe(callback) {
    const removed = this.telemetryCallbacks.delete(callback);
    if (removed && this.telemetryCallbacks.size === 0) this.setTelemetryEnabled(false);
    return removed;
  }

  readTelemetryPacket(packet = this.telemetryBuffer) {
    if (!(packet instanceof Uint8Array) || packet.byteLength < TELEMETRY_RING_BYTES) {
      throw new TypeError(`Telemetry packet must hold at least ${TELEMETRY_RING_BYTES} bytes.`);
    }
    const bytes = this.binding.telemetryRead(packet);
    const dropped = this.binding.lastTelemetryDroppedFrames;
    this.droppedTelemetryFrames += dropped;
    return { bytes, dropped };
  }

  decodeTelemetry(packet, bytes, dropped = 0) {
    const decoded = decodeTelemetryPacket(
      packet,
      bytes,
      this.nodesByTap,
      this.telemetryPendingDropped + dropped
    );
    this.telemetryPendingDropped = decoded.pendingDropped;
    return decoded.frames;
  }

  drainTelemetry() {
    const { bytes, dropped } = this.readTelemetryPacket();
    if (bytes === 0) {
      this.telemetryPendingDropped += dropped;
      return [];
    }
    const frames = this.decodeTelemetry(this.telemetryBuffer, bytes, dropped);
    for (const frame of frames) {
      for (const callback of this.telemetryCallbacks) {
        try {
          callback(frame);
        } catch (error) {
          console.warn('EffeTune telemetry callback failed.', error);
        }
      }
    }
    return frames;
  }

  setPacked(effectId, values, hash, bytes = null) {
    const node = this.nodes.find(entry => entry.effectId === effectId);
    if (!node) throw new EffeTuneRuntimeError(`Effect ${effectId} is not active.`);
    requireOk(
      this.binding.instanceSetParams(node.instanceId, values, hash),
      `${node.effectType} parameter update`
    );
    if (bytes) {
      requireOk(
        this.binding.instanceSetParamBytes(node.instanceId, bytes, hash),
        `${node.effectType} structured parameter update`
      );
    }
  }

  reset() {
    for (const node of this.nodes) {
      requireOk(this.binding.resetInstance(node.instanceId), `${node.effectType} reset`);
      requireOk(this.binding.instanceSetSeed(node.instanceId, this.seed), `${node.effectType} seed reset`);
      requireOk(
        this.binding.instanceSetParams(node.instanceId, node.initialValues, node.hash),
        `${node.effectType} parameter reset`
      );
      if (node.initialBytes) {
        requireOk(
          this.binding.instanceSetParamBytes(node.instanceId, node.initialBytes, node.hash),
          `${node.effectType} structured parameter reset`
        );
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.telemetryCallbacks.clear();
    this.binding.close();
  }
}
