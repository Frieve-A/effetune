export const ROLLING_PCM_PROTOCOL_VERSION = 4;

export const RollingPcmCommand = Object.freeze({
  OPEN: 'open',
  FILL: 'fill',
  SEEK: 'seek',
  RECYCLE: 'recycleSlab',
  DISPOSE: 'dispose'
});

export const RollingPcmEvent = Object.freeze({
  READY: 'ready',
  SLAB: 'slab',
  FRAGMENT: 'fragment',
  SEGMENT_END: 'segmentEnd',
  QUEUE_STATE: 'queueState',
  DISPOSED: 'disposed',
  ERROR: 'error'
});

const envelopeFields = new Set([
  'protocolVersion', 'type', 'transportId', 'generation', 'segmentId'
]);
const payloadFields = new Map([
  [RollingPcmCommand.OPEN, new Set([
    'sourceKind', 'source', 'slabFrames', 'freePoolPerSizeClass', 'outputSampleRate',
    'decoderProfile', 'resamplerProfile'
  ])],
  [RollingPcmCommand.FILL, new Set(['targetFrame'])],
  [RollingPcmCommand.SEEK, new Set(['frame'])],
  [RollingPcmCommand.RECYCLE, new Set(['slabId', 'planes', 'fragmentId', 'fragmentToken'])],
  [RollingPcmCommand.DISPOSE, new Set()],
  [RollingPcmEvent.READY,
    new Set([
      'sampleRate', 'channelCount', 'durationSec', 'totalFrames', 'containerMimeType',
      'codec', 'decoderConfigCodec', 'decoderConfigVerified', 'sourceSampleRate',
      'outputSampleRate', 'sourceTotalFrames', 'sourceByteLength', 'dataOffset',
      'dataByteLength', 'bitsPerSample', 'blockAlign', 'decoderProfile',
      'resamplerProfile', 'workerCompressedBytes'
    ])],
  [RollingPcmEvent.SLAB,
    new Set(['slabId', 'startFrame', 'frameCount', 'channelCount', 'planes'])],
  [RollingPcmEvent.FRAGMENT, new Set([
    'fragmentId', 'fragmentToken', 'fragmentBytes', 'fragmentSourceStartFrame',
    'fragmentSourceFrameCount', 'logicalSourceStartFrame', 'logicalSourceFrameCount',
    'outputStartFrame', 'outputFrameCount', 'cropStartFrame', 'decodedOutputFrameCount',
    'sourceSampleRate', 'outputSampleRate', 'channelCount', 'decoderProfile',
    'resamplerProfile'
  ])],
  [RollingPcmEvent.SEGMENT_END, new Set(['totalFrames'])],
  [RollingPcmEvent.QUEUE_STATE, new Set([
    'decodedFrame', 'sentFrame', 'ended', 'requestedFrame', 'sourceFrame', 'adoptedFrame'
  ])],
  [RollingPcmEvent.DISPOSED, new Set()],
  [RollingPcmEvent.ERROR, new Set([
    'code', 'sourceByteLength', 'decodedPcmBytes', 'sourceSampleRate',
    'outputSampleRate', 'channelCount', 'decoderConfigVerified', 'format'
  ])]
]);

export function createRollingPcmEnvelope(type, ids, payload = {}) {
  return {
    protocolVersion: ROLLING_PCM_PROTOCOL_VERSION,
    type,
    transportId: ids.transportId,
    generation: ids.generation,
    segmentId: ids.segmentId,
    ...payload
  };
}

export function validateRollingPcmEnvelope(message, {
  expectedTransportId = null,
  expectedGeneration = null,
  expectedSegmentId = null
} = {}) {
  if (!message || typeof message !== 'object') return false;
  if (message.protocolVersion !== ROLLING_PCM_PROTOCOL_VERSION) return false;
  if (typeof message.type !== 'string' || message.type.length === 0) return false;
  if (typeof message.transportId !== 'string' || message.transportId.length === 0) return false;
  if (!Number.isSafeInteger(message.generation) || message.generation < 0) return false;
  if (typeof message.segmentId !== 'string' || message.segmentId.length === 0) return false;
  const allowedPayload = payloadFields.get(message.type);
  if (!allowedPayload || Object.keys(message).some(key =>
    !envelopeFields.has(key) && !allowedPayload.has(key))) return false;
  if (expectedTransportId !== null && message.transportId !== expectedTransportId) return false;
  if (expectedGeneration !== null && message.generation !== expectedGeneration) return false;
  if (expectedSegmentId !== null && message.segmentId !== expectedSegmentId) return false;
  return true;
}

export function validateRollingPcmSlab(message, limits) {
  if (!validateRollingPcmEnvelope(message, limits)) return false;
  if (message.type !== RollingPcmEvent.SLAB) return false;
  if (!Number.isSafeInteger(message.slabId) || message.slabId < 1 ||
      !Number.isSafeInteger(message.startFrame) || message.startFrame < 0 ||
      !Number.isSafeInteger(message.frameCount) || message.frameCount < 1 ||
      !Number.isSafeInteger(message.channelCount) || message.channelCount < 1 ||
      message.channelCount > 2 || !Array.isArray(message.planes) ||
      message.planes.length !== message.channelCount) return false;
  const maxFrames = limits?.maxFrames;
  if (Number.isSafeInteger(maxFrames) && message.frameCount > maxFrames) return false;
  return message.planes.every(plane => plane instanceof ArrayBuffer &&
    plane.byteLength === message.frameCount * Float32Array.BYTES_PER_ELEMENT);
}

export function validateRollingPcmFragment(message, limits) {
  if (!validateRollingPcmEnvelope(message, limits) ||
      message.type !== RollingPcmEvent.FRAGMENT ||
      !Number.isSafeInteger(message.fragmentId) || message.fragmentId < 1 ||
      typeof message.fragmentToken !== 'string' || message.fragmentToken.length < 1 ||
      !(message.fragmentBytes instanceof ArrayBuffer) ||
      !Number.isSafeInteger(message.fragmentSourceStartFrame) ||
      message.fragmentSourceStartFrame < 0 ||
      !Number.isSafeInteger(message.fragmentSourceFrameCount) ||
      message.fragmentSourceFrameCount < 1 ||
      !Number.isSafeInteger(message.logicalSourceStartFrame) ||
      message.logicalSourceStartFrame < message.fragmentSourceStartFrame ||
      !Number.isSafeInteger(message.logicalSourceFrameCount) ||
      message.logicalSourceFrameCount < 1 ||
      !Number.isSafeInteger(message.outputStartFrame) || message.outputStartFrame < 0 ||
      !Number.isSafeInteger(message.outputFrameCount) || message.outputFrameCount < 1 ||
      !Number.isSafeInteger(message.cropStartFrame) || message.cropStartFrame < 0 ||
      !Number.isSafeInteger(message.decodedOutputFrameCount) ||
      message.decodedOutputFrameCount < message.cropStartFrame + message.outputFrameCount ||
      !Number.isSafeInteger(message.sourceSampleRate) || message.sourceSampleRate < 1 ||
      !Number.isSafeInteger(message.outputSampleRate) || message.outputSampleRate < 1 ||
      !Number.isSafeInteger(message.channelCount) || message.channelCount < 1 ||
      message.channelCount > 2 || typeof message.decoderProfile !== 'string' ||
      typeof message.resamplerProfile !== 'string') return false;
  if (Number.isSafeInteger(limits?.maxFragmentBytes) &&
      message.fragmentBytes.byteLength > limits.maxFragmentBytes) return false;
  if (Number.isSafeInteger(limits?.maxOutputFrames) &&
      message.outputFrameCount > limits.maxOutputFrames) return false;
  return true;
}

export class FixedPlanarSlabAssembler {
  constructor({ channelCount, slabFrames, acquirePlane = null }) {
    if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 2) {
      throw new RangeError('channelCount must be 1 or 2');
    }
    if (!Number.isSafeInteger(slabFrames) || slabFrames < 1) {
      throw new RangeError('slabFrames must be a positive integer');
    }
    this.channelCount = channelCount;
    this.slabFrames = slabFrames;
    this.acquirePlane = typeof acquirePlane === 'function' ? acquirePlane : null;
    this.startFrame = 0;
    this.frameCount = 0;
    this.planes = this.allocatePlanes();
  }

  reset(startFrame = 0) {
    if (!Number.isSafeInteger(startFrame) || startFrame < 0) {
      throw new RangeError('startFrame must be a non-negative integer');
    }
    this.startFrame = startFrame;
    this.frameCount = 0;
    this.planes = this.allocatePlanes();
  }

  append(sourcePlanes, sourceFrameOffset, frameCount, emit) {
    if (!Array.isArray(sourcePlanes) || sourcePlanes.length !== this.channelCount ||
        !Number.isSafeInteger(sourceFrameOffset) || sourceFrameOffset < 0 ||
        !Number.isSafeInteger(frameCount) || frameCount < 0 || typeof emit !== 'function') {
      throw new TypeError('Invalid slab append arguments');
    }
    let copied = 0;
    while (copied < frameCount) {
      const writable = this.slabFrames - this.frameCount;
      const count = Math.min(writable, frameCount - copied);
      for (let channel = 0; channel < this.channelCount; channel++) {
        const source = sourcePlanes[channel];
        if (!(source instanceof Float32Array) || sourceFrameOffset + copied + count > source.length) {
          throw new RangeError('Source plane is too short');
        }
        this.planes[channel].set(
          source.subarray(sourceFrameOffset + copied, sourceFrameOffset + copied + count),
          this.frameCount
        );
      }
      this.frameCount += count;
      copied += count;
      if (this.frameCount === this.slabFrames) emit(this.take(false));
    }
  }

  async appendWithBackpressure(sourcePlanes, sourceFrameOffset, frameCount, emit) {
    if (!Array.isArray(sourcePlanes) || sourcePlanes.length !== this.channelCount ||
        !Number.isSafeInteger(sourceFrameOffset) || sourceFrameOffset < 0 ||
        !Number.isSafeInteger(frameCount) || frameCount < 0 || typeof emit !== 'function') {
      throw new TypeError('Invalid slab append arguments');
    }
    let copied = 0;
    while (copied < frameCount) {
      const writable = this.slabFrames - this.frameCount;
      const count = Math.min(writable, frameCount - copied);
      for (let channel = 0; channel < this.channelCount; channel++) {
        const source = sourcePlanes[channel];
        if (!(source instanceof Float32Array) || sourceFrameOffset + copied + count > source.length) {
          throw new RangeError('Source plane is too short');
        }
        this.planes[channel].set(
          source.subarray(sourceFrameOffset + copied, sourceFrameOffset + copied + count),
          this.frameCount
        );
      }
      this.frameCount += count;
      copied += count;
      if (this.frameCount === this.slabFrames && await emit(this.take(false)) === false) {
        return false;
      }
    }
    return true;
  }

  flush(emit) {
    if (this.frameCount > 0) emit(this.take(true));
  }

  async flushWithBackpressure(emit) {
    return this.frameCount > 0 ? await emit(this.take(true)) !== false : true;
  }

  take(partial) {
    const frameCount = this.frameCount;
    const startFrame = this.startFrame;
    const planes = this.planes.map(plane => partial
      ? plane.slice(0, frameCount).buffer
      : plane.buffer);
    this.startFrame += frameCount;
    this.frameCount = 0;
    this.planes = this.allocatePlanes();
    return { startFrame, frameCount, planes };
  }

  allocatePlanes() {
    return Array.from({ length: this.channelCount }, () => {
      const candidate = this.acquirePlane?.(this.slabFrames);
      return candidate instanceof ArrayBuffer &&
        candidate.byteLength === this.slabFrames * Float32Array.BYTES_PER_ELEMENT
        ? new Float32Array(candidate)
        : new Float32Array(this.slabFrames);
    });
  }
}
