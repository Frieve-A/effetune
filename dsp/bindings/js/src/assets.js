import {
  buildIrAssetPayload,
  IR_ASSET_FORMAT_TAG,
  IR_ASSET_HEADER_BYTES,
  IR_ASSET_TOPOLOGY
} from './internal/ir-asset-payload.js';
import {
  estimateIrKernelCommitFootprint,
  IR_KERNEL_ASSET_CAPACITY_BYTES,
  resolveIrProcessingConfig
} from './internal/ir-plugin-contract.js';
import { AssetError, ValidationError } from './errors.js';
import { channelRange, channelToEngine, requireResolvedAsset } from './semantics.js';

const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const TOPOLOGY_NAMES = new Map([
  ['unspecified', IR_ASSET_TOPOLOGY.unspecified],
  ['mono', IR_ASSET_TOPOLOGY.mono],
  ['independent', IR_ASSET_TOPOLOGY.independent],
  ['trueStereo', IR_ASSET_TOPOLOGY.trueStereo],
  ['matrix', IR_ASSET_TOPOLOGY.matrix]
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function byteView(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

async function cancelResponseBody(body, reader = null) {
  try {
    if (reader) await reader.cancel();
    else if (typeof body?.cancel === 'function') await body.cancel();
  } catch {
    // Cancellation is best-effort after the public asset error is determined.
  }
}

function responseContentLength(response, reference) {
  let value;
  try {
    value = response.headers?.get?.('content-length');
  } catch (error) {
    throw new AssetError(`Asset ${reference} has unreadable response headers.`, { cause: error });
  }
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new AssetError(`Asset ${reference} has an invalid Content-Length header.`);
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new AssetError(`Asset ${reference} has an invalid Content-Length header.`);
  }
  return length;
}

async function readBoundedResponse(response, reference, expectedLength = null) {
  const limit = expectedLength ?? MAX_ASSET_BYTES;
  const contentLength = responseContentLength(response, reference);
  if (contentLength !== null && contentLength > limit) {
    await cancelResponseBody(response.body);
    throw new AssetError(`Asset ${reference} exceeds its permitted byte length.`);
  }
  if (contentLength !== null &&
      expectedLength !== null &&
      contentLength !== expectedLength) {
    await cancelResponseBody(response.body);
    throw new AssetError(`Asset ${reference} does not match its declared byte length.`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new AssetError(`Asset ${reference} requires a readable response body.`);
  }

  const fixedLength = expectedLength ?? contentLength;
  let bytes = new Uint8Array(fixedLength ?? 0);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = byteView(value);
      if (!chunk) {
        await cancelResponseBody(response.body, reader);
        throw new AssetError(`Asset ${reference} returned a non-binary response chunk.`);
      }
      if (chunk.byteLength > limit - length) {
        await cancelResponseBody(response.body, reader);
        throw new AssetError(`Asset ${reference} exceeds its permitted byte length.`);
      }
      const requiredLength = length + chunk.byteLength;
      if (fixedLength !== null && requiredLength > fixedLength) {
        await cancelResponseBody(response.body, reader);
        throw new AssetError(`Asset ${reference} does not match its Content-Length header.`);
      }
      if (fixedLength === null && requiredLength > bytes.byteLength) {
        let capacity = bytes.byteLength === 0 ? 4096 : bytes.byteLength;
        while (capacity < requiredLength) {
          const doubled = capacity * 2;
          capacity = doubled > limit ? limit : doubled;
        }
        const grown = new Uint8Array(capacity);
        grown.set(bytes.subarray(0, length));
        bytes = grown;
      }
      bytes.set(chunk, length);
      length += chunk.byteLength;
    }
  } catch (error) {
    if (error instanceof AssetError) throw error;
    throw new AssetError(`Asset ${reference} could not be read.`, { cause: error });
  }
  if (contentLength !== null && length !== contentLength) {
    throw new AssetError(`Asset ${reference} does not match its Content-Length header.`);
  }
  if (expectedLength !== null && length !== expectedLength) {
    throw new AssetError(`Asset ${reference} does not match its declared byte length.`);
  }
  return fixedLength === null && bytes.byteLength !== length
    ? bytes.slice(0, length)
    : bytes;
}

function inferEta1Format(bytes, reference) {
  if (bytes.byteLength < IR_ASSET_HEADER_BYTES || bytes.byteLength > MAX_ASSET_BYTES) {
    throw new AssetError(`Asset ${reference} does not contain a bounded ETA1 payload.`);
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = header.getUint32(4, true);
  const frames = header.getUint32(8, true);
  const sampleRate = header.getUint32(12, true);
  const topology = header.getUint32(16, true);
  const pathCount = header.getUint32(20, true);
  if (header.getUint32(0, true) !== 0x31415445 ||
      channels < 1 || channels > 16 ||
      frames < 1 || frames > 8388600 ||
      sampleRate < 1 ||
      topology > IR_ASSET_TOPOLOGY.matrix ||
      pathCount > 16 ||
      header.getUint32(24, true) !== 0 ||
      header.getUint32(28, true) !== 0) {
    throw new AssetError(`Asset ${reference} has an invalid ETA1 header.`);
  }
  if ((topology === IR_ASSET_TOPOLOGY.matrix) !== (pathCount > 0)) {
    throw new AssetError(`Asset ${reference} has an invalid ETA1 path count.`);
  }
  const expected = IR_ASSET_HEADER_BYTES + pathCount * 12 +
    channels * frames * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(expected) || expected !== bytes.byteLength) {
    throw new AssetError(`Asset ${reference} byte length does not match its ETA1 header.`);
  }
  const paths = [];
  for (let index = 0; index < pathCount; index++) {
    const offset = IR_ASSET_HEADER_BYTES + index * 12;
    paths.push({
      inputSlot: header.getUint32(offset, true),
      outputSlot: header.getUint32(offset + 4, true),
      irChannel: header.getUint32(offset + 8, true)
    });
  }
  return {
    formatTag: 1,
    magic: 'ETA1',
    headerBytes: IR_ASSET_HEADER_BYTES,
    pathRecordBytes: 12,
    reservedBytes: 8,
    sampleType: 'float32',
    byteOrder: 'little-endian',
    layout: 'planar',
    channels,
    frames,
    sampleRate,
    topology,
    pathCount,
    ...(paths.length > 0 ? { paths } : {})
  };
}

async function resolverResult(resolver, reference, descriptor, effectId) {
  const resolve = typeof resolver === 'function' ? resolver : resolver?.resolve?.bind(resolver);
  if (typeof resolve !== 'function') {
    throw new AssetError(`${effectId} requires an assetResolver.`);
  }
  let result;
  let ownsBytes = false;
  try {
    result = await resolve(reference, descriptor);
  } catch (error) {
    throw new AssetError(`${effectId} could not resolve asset ${reference}.`, { cause: error });
  }
  if (result?.arrayBuffer && typeof result.arrayBuffer === 'function') {
    if (result.ok === false) throw new AssetError(`${effectId} could not read asset ${reference}.`);
    result = {
      bytes: await readBoundedResponse(
        result,
        reference,
        descriptor?.byteLength ?? null
      )
    };
    ownsBytes = true;
  }
  if (result === null || result === undefined) {
    throw new AssetError(`${effectId} could not resolve asset ${reference}.`);
  }
  const wrapped = isRecord(result) && !ArrayBuffer.isView(result) && !(result instanceof ArrayBuffer)
    ? result
    : { bytes: result };
  const bytes = byteView(wrapped.bytes ?? wrapped.data);
  if (!bytes) throw new AssetError(`${effectId} asset ${reference} did not return binary data.`);
  if (descriptor && bytes.byteLength !== descriptor.byteLength) {
    throw new AssetError(`Asset ${descriptor.id} does not match its declared byte length.`);
  }
  if (!descriptor && bytes.byteLength > MAX_ASSET_BYTES) {
    if (wrapped.format !== undefined) {
      normalizeFormatMetadata(wrapped.format, bytes.byteLength, reference);
    }
    throw new AssetError(`Asset ${reference} does not contain a bounded ETA1 payload.`);
  }
  const copy = ownsBytes ? bytes : new Uint8Array(bytes);
  const inferredFormat = wrapped.format === undefined && descriptor === undefined;
  return {
    bytes: copy,
    format: wrapped.format ?? (descriptor ? undefined : inferEta1Format(copy, reference)),
    inferredFormat
  };
}

function validatePaths(paths, channels) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 16) {
    throw new AssetError('Matrix impulse responses require between 1 and 16 paths.');
  }
  const normalized = paths.map(path => {
    if (!isRecord(path) ||
        Object.keys(path).length !== 3 ||
        !Object.hasOwn(path, 'inputSlot') ||
        !Object.hasOwn(path, 'outputSlot') ||
        !Object.hasOwn(path, 'irChannel')) {
      throw new AssetError('Matrix impulse-response paths must contain exact path fields.');
    }
    const inputSlot = path?.inputSlot;
    const outputSlot = path?.outputSlot;
    const irChannel = path?.irChannel;
    if (![inputSlot, outputSlot, irChannel].every(Number.isSafeInteger) ||
        inputSlot < 0 || inputSlot > 15 ||
        outputSlot < 0 || outputSlot > 15 ||
        irChannel < 0 || irChannel >= channels) {
      throw new AssetError('Matrix impulse-response paths contain an invalid channel or slot.');
    }
    return { inputSlot, outputSlot, irChannel };
  });
  const inputSlots = [...new Set(normalized.map(path => path.inputSlot))]
    .sort((left, right) => left - right);
  if (inputSlots.some((value, index) => value !== index)) {
    throw new AssetError(
      'Matrix impulse-response inputSlot values must form a contiguous range starting at 0.'
    );
  }
  return normalized;
}

function normalizeTopology(format, { allowNumeric = false } = {}) {
  const supplied = format.topology;
  const topology = typeof supplied === 'string'
    ? TOPOLOGY_NAMES.get(supplied)
    : allowNumeric
      ? supplied
      : undefined;
  if (!Number.isInteger(topology) || topology < 0 || topology > IR_ASSET_TOPOLOGY.matrix) {
    throw new AssetError('Impulse-response topology is unsupported.');
  }
  const paths = topology === IR_ASSET_TOPOLOGY.matrix
    ? validatePaths(format.paths, format.channels)
    : [];
  if (topology !== IR_ASSET_TOPOLOGY.matrix && format.paths !== undefined) {
    throw new AssetError('Impulse-response paths are only valid for matrix topology.');
  }
  return { topology, paths };
}

export function encodeEta1(options) {
  if (!isRecord(options)) {
    throw new AssetError('ETA1 encoding options must be an object.');
  }
  const { channels, sampleRate, topology = 'unspecified', paths } = options;
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 16) {
    throw new AssetError('ETA1 channels must contain between 1 and 16 Float32Array values.');
  }
  const frames = channels[0] instanceof Float32Array ? channels[0].length : 0;
  if (frames < 1) {
    throw new AssetError('ETA1 channels must be non-empty Float32Array values.');
  }
  for (const channel of channels) {
    if (!(channel instanceof Float32Array) || channel.length !== frames) {
      throw new AssetError('ETA1 channels must be equally sized Float32Array values.');
    }
  }
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffffff) {
    throw new AssetError('ETA1 sampleRate must be a positive 32-bit integer.');
  }
  const normalized = normalizeTopology({
    topology,
    paths,
    channels: channels.length
  });
  const byteLength = IR_ASSET_HEADER_BYTES + normalized.paths.length * 12 +
    channels.length * frames * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(byteLength) || byteLength > MAX_ASSET_BYTES) {
    throw new AssetError('ETA1 payload exceeds the 32 MiB limit.');
  }
  for (const channel of channels) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) {
        throw new AssetError('ETA1 samples must be finite.');
      }
    }
  }
  try {
    return buildIrAssetPayload({
      channels,
      sampleRate,
      topology: normalized.topology,
      paths: normalized.paths
    });
  } catch (error) {
    if (error instanceof AssetError) throw error;
    throw new AssetError('Unable to encode the ETA1 payload.', { cause: error });
  }
}

function normalizeFormatMetadata(format, byteLength, reference, options = {}) {
  if (!isRecord(format)) {
    throw new AssetError(`Asset ${reference} requires float32 planar format metadata.`);
  }
  if (format.formatTag !== 1 || format.magic !== 'ETA1' ||
      format.headerBytes !== IR_ASSET_HEADER_BYTES || format.pathRecordBytes !== 12 ||
      format.reservedBytes !== 8 ||
      format.sampleType !== 'float32' || format.byteOrder !== 'little-endian' ||
      format.layout !== 'planar') {
    throw new AssetError(`Asset ${reference} must use the ETA1 planar little-endian float32 format.`);
  }
  const { channels, frames, sampleRate } = format;
  if (!Number.isInteger(channels) || channels < 1 || channels > 16 ||
      !Number.isInteger(frames) || frames < 1 || frames > 8388600 ||
      !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffffff) {
    throw new AssetError(`Asset ${reference} has invalid channel, frame, or sample-rate metadata.`);
  }
  const topology = normalizeTopology(format, options);
  const allowedFormatKeys = new Set([
    'formatTag', 'magic', 'headerBytes', 'pathRecordBytes',
    'reservedBytes',
    'sampleType', 'byteOrder', 'layout', 'channels', 'frames',
    'sampleRate', 'topology', 'pathCount', 'paths'
  ]);
  for (const key of Object.keys(format)) {
    if (!allowedFormatKeys.has(key)) {
      throw new AssetError(`Asset ${reference} has an unsupported format field: ${key}`);
    }
  }
  const pathCount = topology.topology === IR_ASSET_TOPOLOGY.matrix
    ? topology.paths.length
    : 0;
  if (format.pathCount !== pathCount) {
    throw new AssetError(`Asset ${reference} path count does not match its topology.`);
  }
  const expected = IR_ASSET_HEADER_BYTES + pathCount * 12 +
    channels * frames * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(expected) || expected !== byteLength) {
    throw new AssetError(`Asset ${reference} byte length does not match its ETA1 format.`);
  }
  if (byteLength > MAX_ASSET_BYTES) {
    throw new AssetError(`Asset ${reference} exceeds the 32 MiB limit.`);
  }
  return {
    ...format,
    channels,
    frames,
    sampleRate,
    ...topology,
    sampleOffset: IR_ASSET_HEADER_BYTES + pathCount * 12
  };
}

function normalizeFormat(format, bytes, reference, options = {}) {
  const normalized = normalizeFormatMetadata(format, bytes.byteLength, reference, options);
  const {
    channels,
    frames,
    sampleRate,
    topology,
    paths,
    sampleOffset
  } = normalized;
  const pathCount = paths.length;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0, true) !== 0x31415445 ||
      header.getUint32(4, true) !== channels ||
      header.getUint32(8, true) !== frames ||
      header.getUint32(12, true) !== sampleRate ||
      header.getUint32(16, true) !== topology ||
      header.getUint32(20, true) !== pathCount ||
      header.getUint32(24, true) !== 0 ||
      header.getUint32(28, true) !== 0) {
    throw new AssetError(`Asset ${reference} ETA1 header does not match its manifest.`);
  }
  for (let index = 0; index < pathCount; index++) {
    const offset = IR_ASSET_HEADER_BYTES + index * 12;
    const path = paths[index];
    if (header.getUint32(offset, true) !== path.inputSlot ||
        header.getUint32(offset + 4, true) !== path.outputSlot ||
        header.getUint32(offset + 8, true) !== path.irChannel) {
      throw new AssetError(`Asset ${reference} ETA1 path records do not match its manifest.`);
    }
  }
  for (let offset = sampleOffset; offset < bytes.byteLength; offset += 4) {
    if (!Number.isFinite(header.getFloat32(offset, true))) {
      throw new AssetError(`Asset ${reference} contains a non-finite sample.`);
    }
  }
  return {
    ...normalized
  };
}

async function sha256(bytes) {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  try {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(bytes).digest('hex');
  } catch (error) {
    throw new AssetError('SHA-256 is unavailable for bundle verification.', { cause: error });
  }
}

function validateBundleAsset(entry) {
  if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length < 1 ||
      entry.id.length > 128 || entry.kind !== 'impulseResponse' ||
      typeof entry.reference !== 'string' || entry.reference.length < 1 ||
      entry.reference.length > 2048 ||
      typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256) ||
      !Number.isInteger(entry.byteLength) || entry.byteLength < 36 ||
      entry.byteLength > MAX_ASSET_BYTES) {
    throw new AssetError('Bundle contains an invalid asset manifest entry.');
  }
  const allowed = new Set(['id', 'kind', 'reference', 'sha256', 'byteLength', 'format']);
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) throw new AssetError(`Bundle asset ${entry.id} has an unsupported field: ${key}`);
  }
  normalizeFormatMetadata(entry.format, entry.byteLength, entry.id);
}

export function isBundleDocument(input) {
  return isRecord(input) && Array.isArray(input.assets) && isRecord(input.chain);
}

export function splitBundle(input) {
  if (!isBundleDocument(input)) return { chain: input, manifest: null };
  const keys = new Set(['version', 'chain', 'assets']);
  for (const key of Object.keys(input)) {
    if (!keys.has(key)) throw new ValidationError(`Unsupported bundle field: ${key}`);
  }
  if (input.version !== 1) throw new ValidationError('Only bundle version 1 is supported.');
  const manifest = new Map();
  if (input.assets.length > 64) throw new AssetError('A bundle can contain at most 64 assets.');
  for (const entry of input.assets) {
    validateBundleAsset(entry);
    if (manifest.has(entry.id)) throw new AssetError(`Duplicate bundle asset id: ${entry.id}`);
    const paths = entry.format.paths?.map(path => Object.freeze({ ...path }));
    const format = Object.freeze({
      ...entry.format,
      ...(paths === undefined ? {} : { paths: Object.freeze(paths) })
    });
    manifest.set(entry.id, Object.freeze({ ...entry, format }));
  }
  return { chain: input.chain, manifest };
}

export async function resolveChainAssets(chainDocument, {
  assetResolver,
  manifest = null
} = {}) {
  const resolved = new Map();
  if (manifest) {
    for (const effect of chainDocument.chain) {
      for (const reference of Object.values(effect.assets ?? {})) {
        if (!manifest.has(reference)) {
          throw new AssetError(`${effect.id} references missing bundle asset ${reference}.`);
        }
      }
    }
  }
  for (const effect of chainDocument.chain) {
    if (!effect.enabled || !effect.assets) continue;
    const effectAssets = {};
    for (const [name, reference] of Object.entries(effect.assets)) {
      const descriptor = manifest?.get(reference);
      const result = await resolverResult(
        assetResolver,
        descriptor?.reference ?? reference,
        descriptor,
        effect.id
      );
      if (descriptor) {
        if (result.bytes.byteLength !== descriptor.byteLength) {
          throw new AssetError(`Asset ${reference} does not match its declared byte length.`);
        }
        const digest = await sha256(result.bytes);
        if (digest !== descriptor.sha256) {
          throw new AssetError(`Asset ${reference} failed SHA-256 verification.`);
        }
      }
      const format = normalizeFormat(
        descriptor?.format ?? result.format,
        result.bytes,
        reference,
        { allowNumeric: result.inferredFormat === true }
      );
      effectAssets[name] = Object.freeze({ bytes: result.bytes, format, reference });
    }
    resolved.set(effect.id, Object.freeze(effectAssets));
  }
  return resolved;
}

function float32Channels(asset, count) {
  const channels = [];
  for (let channel = 0; channel < count; channel++) {
    const offset = asset.format.sampleOffset + channel * asset.format.frames * 4;
    const values = new Float32Array(asset.format.frames);
    const view = new DataView(
      asset.bytes.buffer,
      asset.bytes.byteOffset + offset,
      asset.format.frames * 4
    );
    for (let frame = 0; frame < values.length; frame++) {
      const value = view.getFloat32(frame * 4, true);
      if (!Number.isFinite(value)) throw new AssetError(`Asset ${asset.reference} contains a non-finite sample.`);
      values[frame] = value;
    }
    channels.push(values);
  }
  return channels;
}

export function prepareIrAsset(effect, resolvedAssets, {
  sampleRate,
  engineChannels
}) {
  const asset = requireResolvedAsset(effect, resolvedAssets);
  const config = resolveIrProcessingConfig({
    sampleRate,
    channelCount: asset.format.channels,
    engineChannels,
    channel: channelToEngine(effect.channel),
    channelMode: {
      automatic: 'auto',
      mono: 'mono',
      independent: 'indep',
      trueStereo: 'true',
      matrix: 'multi'
    }[effect.parameters.channelMode],
    latency: String(effect.parameters.latency),
    convolutionRate: effect.parameters.convolutionRate
  });
  if (!config.valid) throw new AssetError(`${effect.id}: ${config.message}`);
  if (asset.format.sampleRate !== config.sampleRate) {
    throw new AssetError(
      `${effect.id} requires an impulse response at ${config.sampleRate} Hz for this processing configuration.`
    );
  }

  const explicitTopology = asset.format.topology;
  const topology = explicitTopology === IR_ASSET_TOPOLOGY.unspecified
    ? config.topology
    : explicitTopology;
  if (explicitTopology !== IR_ASSET_TOPOLOGY.unspecified &&
      explicitTopology !== config.topology) {
    throw new AssetError(`${effect.id} impulse-response topology does not match its channel mode.`);
  }
  const paths = topology === IR_ASSET_TOPOLOGY.matrix
    ? (asset.format.paths.length > 0 ? asset.format.paths : config.paths)
    : [];
  const inputCount = topology === IR_ASSET_TOPOLOGY.matrix
    ? new Set(paths.map(path => path.inputSlot)).size
    : 0;
  if (inputCount > config.processingChannels) {
    throw new AssetError(
      `${effect.id} matrix impulse response uses more input slots than its processing channels.`
    );
  }
  if (paths.some(path => path.outputSlot >= config.processingChannels)) {
    throw new AssetError(
      `${effect.id} matrix impulse response routes output beyond its processing channels.`
    );
  }
  const assetChannels = topology === IR_ASSET_TOPOLOGY.mono ? 1 : config.assetChannels;
  if (asset.format.channels < assetChannels) {
    throw new AssetError(`${effect.id} does not have enough impulse-response channels.`);
  }
  const channels = float32Channels(asset, assetChannels);
  let payload;
  try {
    payload = buildIrAssetPayload({
      channels,
      sampleRate: asset.format.sampleRate,
      topology,
      paths
    });
  } catch (error) {
    throw new AssetError(`${effect.id} has an invalid impulse-response payload.`, { cause: error });
  }
  const pathCount = topology === IR_ASSET_TOPOLOGY.matrix ? paths.length : 0;
  const footprintBytes = estimateIrKernelCommitFootprint({
    frames: asset.format.frames,
    assetChannels,
    topology,
    processingChannels: config.processingChannels,
    headBlock: config.headBlock,
    pathCount,
    inputCount
  });
  if (payload.byteLength > MAX_ASSET_BYTES ||
      payload.byteLength < IR_ASSET_HEADER_BYTES ||
      footprintBytes > IR_KERNEL_ASSET_CAPACITY_BYTES) {
    throw new AssetError(`${effect.id} exceeds the 32 MiB impulse-response kernel limit.`);
  }
  return {
    payload,
    formatTag: IR_ASSET_FORMAT_TAG,
    beginInfo: {
      channels: assetChannels,
      frames: asset.format.frames,
      topology,
      headBlock: config.headBlock,
      rateDivider: config.rateDivider,
      pathCount,
      inputCount,
      processingChannels: config.processingChannels,
      footprintBytes
    }
  };
}

function prepareFirFilterAsset(effect, resolvedAssets, {
  sampleRate,
  engineChannels
}) {
  const asset = requireResolvedAsset(effect, resolvedAssets);
  if (asset.format.sampleRate !== sampleRate) {
    throw new AssetError(
      `${effect.id} requires filter coefficients at the processing sample rate of ${sampleRate} Hz.`
    );
  }
  if (asset.format.frames > 131072) {
    throw new AssetError(`${effect.id} filter coefficients exceed 131072 frames.`);
  }

  const processingChannels = channelRange(effect.channel, engineChannels).count;
  const headBlock = Number(effect.parameters.latencyMode);
  const supportedHeadBlocks = new Set([0, 128, 256, 512, 1024]);
  if (!supportedHeadBlocks.has(headBlock)) {
    throw new AssetError(`${effect.id} has an unsupported latencyMode.`);
  }

  let assetChannels;
  let topology;
  let paths;
  let inputCount;
  if (effect.type === 'FIRCrossover') {
    const bandCount = effect.parameters.bandCount;
    if ((processingChannels < 4 || processingChannels > 16 || processingChannels % 2 !== 0) ||
        bandCount * 2 > processingChannels ||
        asset.format.channels !== bandCount) {
      throw new AssetError(
        `${effect.id} requires an even number of processing channels from 4 to 16 and one filter channel per band.`
      );
    }
    topology = IR_ASSET_TOPOLOGY.matrix;
    assetChannels = bandCount;
    paths = Array.from({ length: bandCount }, (_, band) => [
      { inputSlot: 0, outputSlot: band * 2, irChannel: band },
      { inputSlot: 1, outputSlot: band * 2 + 1, irChannel: band }
    ]).flat();
    inputCount = 2;
    if (asset.format.topology !== IR_ASSET_TOPOLOGY.unspecified &&
        asset.format.topology !== topology) {
      throw new AssetError(`${effect.id} requires matrix filter topology.`);
    }
    if (asset.format.topology === topology &&
        (asset.format.paths.length !== paths.length ||
         asset.format.paths.some((path, index) =>
           path.inputSlot !== paths[index].inputSlot ||
           path.outputSlot !== paths[index].outputSlot ||
           path.irChannel !== paths[index].irChannel))) {
      throw new AssetError(`${effect.id} filter paths do not match its band layout.`);
    }
  } else if (effect.type === 'RoomEQ') {
    const explicitTopology = asset.format.topology;
    if (explicitTopology === IR_ASSET_TOPOLOGY.mono ||
        (explicitTopology === IR_ASSET_TOPOLOGY.unspecified && asset.format.channels === 1)) {
      topology = IR_ASSET_TOPOLOGY.mono;
    } else if (explicitTopology === IR_ASSET_TOPOLOGY.independent ||
               (explicitTopology === IR_ASSET_TOPOLOGY.unspecified &&
                asset.format.channels === processingChannels)) {
      topology = IR_ASSET_TOPOLOGY.independent;
    } else {
      throw new AssetError(
        `${effect.id} requires either one shared filter channel or one filter channel per processing channel.`
      );
    }
    assetChannels = asset.format.channels;
    paths = [];
    inputCount = 0;
    if ((topology === IR_ASSET_TOPOLOGY.mono && assetChannels !== 1) ||
        (topology === IR_ASSET_TOPOLOGY.independent && assetChannels !== processingChannels)) {
      throw new AssetError(
        `${effect.id} requires either one shared filter channel or one filter channel per processing channel.`
      );
    }
  } else {
    topology = IR_ASSET_TOPOLOGY.mono;
    assetChannels = 1;
    paths = [];
    inputCount = 0;
    if (asset.format.channels !== 1 ||
        (asset.format.topology !== IR_ASSET_TOPOLOGY.unspecified &&
         asset.format.topology !== topology)) {
      throw new AssetError(`${effect.id} requires a mono filter-coefficient asset.`);
    }
  }

  let payload;
  try {
    payload = buildIrAssetPayload({
      channels: float32Channels(asset, assetChannels),
      sampleRate,
      topology,
      paths
    });
  } catch (error) {
    throw new AssetError(`${effect.id} has an invalid filter-coefficient payload.`, { cause: error });
  }
  const pathCount = paths.length;
  const footprintBytes = estimateIrKernelCommitFootprint({
    frames: asset.format.frames,
    assetChannels,
    topology,
    processingChannels,
    headBlock,
    pathCount,
    inputCount
  });
  if (payload.byteLength > MAX_ASSET_BYTES ||
      payload.byteLength < IR_ASSET_HEADER_BYTES ||
      footprintBytes > IR_KERNEL_ASSET_CAPACITY_BYTES) {
    throw new AssetError(`${effect.id} exceeds the 32 MiB filter-kernel limit.`);
  }
  return {
    payload,
    formatTag: IR_ASSET_FORMAT_TAG,
    beginInfo: {
      channels: assetChannels,
      frames: asset.format.frames,
      topology,
      headBlock,
      rateDivider: 1,
      pathCount,
      inputCount,
      processingChannels,
      footprintBytes
    }
  };
}

export function prepareConvolutionAsset(effect, resolvedAssets, options) {
  return effect.type === 'IRReverb'
    ? prepareIrAsset(effect, resolvedAssets, options)
    : prepareFirFilterAsset(effect, resolvedAssets, options);
}
