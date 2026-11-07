import { instantiateDspBinding, ET_OK } from './internal/dsp-engine-binding.js';
import { getEffectImplementation } from './catalog.js';
import { prepareConvolutionAsset } from './assets.js';
import { AssetError, EffeTuneError, EffeTuneRuntimeError } from './errors.js';
import { channelRange, packEffect, validateBassManagement } from './semantics.js';
import {
  decodeTelemetryPacket,
  TELEMETRY_RATE_HZ,
  TELEMETRY_RING_BYTES
} from './telemetry.js';

// Prepared MIDI event capacity of every MIDI-driven native instance.
export const MIDI_EVENT_CAPACITY = 4096;
const MIDI_RESET = 1;
const MIDI_CLOCK_RUNNING = 1;
const SOUND_FONT_FORMAT_TAG = 1;
const SOUND_FONT_PLAYER_KIND = 1;
// Native sampler memory limit (payload plus preparation), matching the SoundFont size limit.
const SOUND_FONT_MAX_BYTES = 1024 * 1024 * 1024;
const NO_MIDI_EVENTS = Object.freeze([]);

function requireOk(status, operation) {
  if (status !== ET_OK) {
    throw new EffeTuneRuntimeError(`DSP ${operation} failed.`);
  }
}

function assetSlot(implementation, name) {
  return implementation.assets?.find(asset => asset.publicName === name)?.slot ?? 0;
}

const PREWARM_FRAMES = 128;
// Native SoundFont verification advances 8 work units per rendered frame and each
// unit covers at least 64 payload bytes, so a payload needs at most one frame per
// 512 bytes on top of the two seconds that convolution warm-up may take. The limit
// only stops an asset that can no longer progress.
const PREWARM_PAYLOAD_BYTES_PER_FRAME = 512;

// Renders silence until the uploaded asset leaves preparation and reports whether
// it became active. Shared by the chain and graph engines.
export function prewarmAsset(binding, effectType, instanceId, slot, { processingChannels, sampleRate, payloadBytes }) {
  const silence = binding.getArenaViews().scratch.allChannels.subarray(0, processingChannels * PREWARM_FRAMES);
  const silencePtr = binding.pointerForArenaView(silence);
  const maximumBlocks = Math.ceil(
    (2 * sampleRate + payloadBytes / PREWARM_PAYLOAD_BYTES_PER_FRAME) / PREWARM_FRAMES);
  let state = binding.instanceAssetState(instanceId, slot);
  for (let block = 0; (state & 0xff) === 2 && block < maximumBlocks; block++) {
    silence.fill(0);
    requireOk(
      binding.instanceProcess(instanceId, silencePtr, processingChannels, PREWARM_FRAMES,
        block * PREWARM_FRAMES / sampleRate),
      `${effectType} asset prewarming`
    );
    state = binding.instanceAssetState(instanceId, slot);
  }
  return (state & 0xff) === 3;
}

// Prewarms the uploaded asset, then restores the instance to its freshly
// configured state so prewarming leaves no trace.
function activateAsset(binding, effect, instanceId, slot, packed, { seed, ...prewarm }) {
  if (!prewarmAsset(binding, effect.type, instanceId, slot, prewarm)) {
    throw new EffeTuneRuntimeError(`${effect.type} asset did not become active.`);
  }
  requireOk(binding.resetInstance(instanceId), `${effect.type} post-prewarm reset`);
  requireOk(binding.instanceSetSeed(instanceId, seed), `${effect.type} post-prewarm seed reset`);
  requireOk(
    binding.instanceSetParams(instanceId, packed.values, packed.hash),
    `${effect.type} post-prewarm parameter reset`
  );
}

// Sizes every SoundFont bank for this chain. The native size query runs on a
// binding that has no engine yet, so it happens before createEngine().
function prepareSoundFonts(binding, effects, resolvedAssets, { sampleRate, channels, maxFrames }) {
  const prepared = new Map();
  for (const effect of effects) {
    if (!effect.enabled) continue;
    const entry = Object.entries(resolvedAssets?.get(effect.id) ?? {}).find(([, asset]) => asset?.bank);
    if (!entry) continue;
    const [name, { bank }] = entry;
    // Copy so the caller's bank stays usable after the upload.
    const payload = new Uint8Array(bank.payload.slice(0));
    const context = {
      sampleRate,
      processingChannels: channelRange(effect.channel, channels).count,
      maxFrames,
      minimumPhysicalBpm: 0,
      playerKind: SOUND_FONT_PLAYER_KIND
    };
    // The control block is the header plus the sampler table (see js/sfz/effect-cost.js).
    const controlBytes = 32 + new DataView(payload.buffer).getUint32(48, true) * 4;
    let footprintBytes;
    try {
      footprintBytes = payload.byteLength + binding.estimateSfzEffectPreparation(
        payload.subarray(0, controlBytes), context, SOUND_FONT_FORMAT_TAG, payload.byteLength);
    } catch (error) {
      throw new AssetError(
        `${effect.id} cannot prepare its SoundFont bank for these audio settings. Prepare the bank again with this version of EffeTune DSP.`,
        { cause: error }
      );
    }
    if (footprintBytes > SOUND_FONT_MAX_BYTES) {
      throw new AssetError(
        `${effect.id} needs more than 1 GiB of memory for its SoundFont bank. Choose a smaller SoundFont or fewer channels.`,
        { code: 'too-large' }
      );
    }
    prepared.set(effect.id, { name, payload, pages: bank.pages, context, footprintBytes });
  }
  return prepared;
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
    const soundFonts = prepareSoundFonts(binding, effects, resolvedAssets, {
      sampleRate,
      channels,
      maxFrames
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
      validateBassManagement(effect, channels);
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
      const soundFont = soundFonts.get(effect.id);
      if (soundFont) {
        const slot = assetSlot(implementation, soundFont.name);
        const { payload, context } = soundFont;
        requireOk(
          binding.instanceSetAsset(instanceId, slot, payload, {
            channels: 1,
            frames: (payload.byteLength - 32) / 4,
            topology: 0,
            headBlock: 128,
            rateDivider: 1,
            processingChannels: context.processingChannels,
            footprintBytes: soundFont.footprintBytes,
            preparationContext: context
          }, SOUND_FONT_FORMAT_TAG),
          `${effect.type} SoundFont preparation`
        );
        if (soundFont.pages.length > 0) {
          requireOk(binding.configureSfzSampleStream(instanceId, 1), `${effect.type} sample cache configuration`);
          for (const page of soundFont.pages) {
            requireOk(
              binding.publishSfzSamplePage(instanceId, { ...page, generation: 1, resident: true }),
              `${effect.type} sample loading`
            );
          }
        }
        activateAsset(binding, effect, instanceId, slot, packed, {
          processingChannels: context.processingChannels,
          sampleRate,
          payloadBytes: payload.byteLength,
          seed
        });
        requireOk(binding.instanceSetMidiEvents(instanceId, [], 1, MIDI_RESET), `${effect.type} MIDI reset`);
      } else if (implementation.assets?.length && effect.assets?.impulseResponse) {
        const prepared = prepareConvolutionAsset(effect, resolvedAssets, {
          sampleRate,
          engineChannels: channels
        });
        const slot = assetSlot(implementation, 'impulseResponse');
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
        activateAsset(binding, effect, instanceId, slot, packed, {
          processingChannels: prepared.beginInfo.processingChannels,
          sampleRate,
          payloadBytes: prepared.payload.byteLength,
          seed
        });
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
        hash: packed.hash,
        midi: soundFont !== undefined
      });
    }
    const descriptor = new Uint8Array(8 + nodes.length * 12);
    const view = new DataView(descriptor.buffer);
    view.setUint32(0, 1, true);
    view.setUint32(4, nodes.length, true);
    for (const [index, node] of nodes.entries()) {
      const offset = 8 + index * 12;
      view.setUint32(offset, node.instanceId, true);
      view.setUint8(offset + 4, 1);
      view.setInt8(offset + 7, node.range.count === channels ? -2
        : node.range.count === 2 ? 16 + node.range.start / 2 : node.range.start);
      view.setUint8(offset + 8, 1);
    }
    requireOk(binding.pipelineConfigure(descriptor), 'pipeline configuration');
    requireOk(binding.pipelineReserveLatency(), 'latency reservation');
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
    this.refreshArenaViews();
    this.nodesByTap = new Map(nodes.map(node => [node.tapId, node]));
    this.telemetryBuffer = new Uint8Array(TELEMETRY_RING_BYTES);
    this.telemetryCallbacks = new Set();
    this.telemetryEnabled = false;
    this.telemetryPendingDropped = 0;
    this.droppedTelemetryFrames = 0;
    this.midiNodes = new Map(nodes.filter(node => node.midi).map(node => [node.effectId, node]));
    this.midiClock = 0;
    this.nextNoteId = 1;
  }

  get latencySamples() {
    if (this.closed) throw new EffeTuneRuntimeError('DSP processing state is closed.');
    return this.binding.pipelineLatency();
  }

  refreshArenaViews() {
    const arena = this.binding.getArenaViews().combined;
    if (this.arena?.buffer === arena.buffer) return;
    this.arena = arena;
    this.fullChannelViews = Array.from({ length: this.channels }, (_, channel) =>
      arena.subarray(channel * this.maxFrames, (channel + 1) * this.maxFrames)
    );
    this.channelViewsByFrameCount = new Map([[this.maxFrames, this.fullChannelViews]]);
  }

  refreshLatency() {
    requireOk(this.binding.pipelineRefreshLatencyRealtime(), 'latency configuration');
    this.refreshArenaViews();
  }

  // midiEvents: [{ effectId, offset, midi: [status, data1, data2] }] with offsets
  // relative to this call; callers validate messages and the per-call capacity.
  process(input, output, offset, frameCount, sampleRate, timeFrame = offset, midiEvents = NO_MIDI_EVENTS) {
    if (this.closed) throw new EffeTuneRuntimeError('DSP processing state is closed.');
    if (this.midiNodes.size > 0) this.sendMidi(midiEvents);
    let channelViews = this.channelViewsByFrameCount.get(frameCount);
    if (!channelViews) {
      channelViews = Array.from({ length: this.channels }, (_, channel) =>
        this.arena.subarray(channel * frameCount, (channel + 1) * frameCount)
      );
      this.channelViewsByFrameCount.set(frameCount, channelViews);
    }
    for (let channel = 0; channel < this.channels; channel++) {
      const target = channelViews[channel];
      target.set(offset === 0 && input[channel].length === frameCount
        ? input[channel]
        : input[channel].subarray(offset, offset + frameCount));
    }
    requireOk(
      this.binding.pipelineProcess(this.channels, frameCount, timeFrame / sampleRate),
      'pipeline processing'
    );
    this.midiClock += frameCount;
    for (let channel = 0; channel < this.channels; channel++) {
      const source = channelViews[channel];
      output[channel].set(source, offset);
    }
    if (this.telemetryCallbacks.size > 0) this.drainTelemetry();
  }

  // Every MIDI-driven instance receives the render clock and its own block of
  // events (possibly empty) before each pipeline call.
  sendMidi(midiEvents) {
    for (const node of this.midiNodes.values()) {
      let events = NO_MIDI_EVENTS;
      for (const event of midiEvents) {
        if (event.effectId !== node.effectId) continue;
        if (events === NO_MIDI_EVENTS) events = [];
        const [status, data1, data2] = event.midi;
        const noteOn = (status & 0xf0) === 0x90 && data2 > 0;
        events.push({
          offsetFrames: event.offset,
          status,
          data1,
          data2,
          noteId: noteOn ? this.takeNoteId() : 0,
          flags: 0
        });
      }
      requireOk(
        this.binding.instanceSetMidiClock(node.instanceId, this.midiClock, 1, MIDI_CLOCK_RUNNING),
        `${node.effectType} MIDI clock`
      );
      requireOk(this.binding.instanceSetMidiEvents(node.instanceId, events, 1, 0), `${node.effectType} MIDI events`);
    }
  }

  takeNoteId() {
    const noteId = this.nextNoteId;
    this.nextNoteId = noteId === 0xffffffff ? 1 : noteId + 1;
    return noteId;
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
    this.refreshLatency();
  }

  reset() {
    requireOk(this.binding.reset(), 'reset');
    for (const node of this.nodes) {
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
      if (node.midi) {
        requireOk(this.binding.instanceSetMidiEvents(node.instanceId, [], 1, MIDI_RESET), `${node.effectType} MIDI reset`);
      }
    }
    this.midiClock = 0;
    this.nextNoteId = 1;
    this.refreshLatency();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.telemetryCallbacks.clear();
    this.binding.close();
  }
}
