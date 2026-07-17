import {
  getPlaybackPhysicalSourceKey,
  hasPlaybackRegionDescriptor
} from './playback-region.js';

export const MAX_BUFFER_SOURCE_BYTES = 256 * 1024 * 1024;

export function normalizePlaybackSourceDescriptor(source) {
  const input = source && typeof source === 'object' ? source : {};
  const bytes = getMaterializedBytes(input);
  const file = getBlobSource(input);
  const explicitByteLength = normalizeByteLength(input.byteLength ?? input.fileSize ?? input.size);
  const byteLength = bytes
    ? bytes.byteLength
    : (file ? normalizeByteLength(file.size) : explicitByteLength);
  const mediaSource = getMediaSource(input, file);
  const readBytes = typeof input.readBytes === 'function'
    ? input.readBytes
    : (file && typeof file.arrayBuffer === 'function'
        ? () => file.arrayBuffer()
        : null);
  const descriptor = {
    physicalSourceKey: getPlaybackPhysicalSourceKey(input),
    byteLength,
    mediaSource,
    readBytes,
    bytes
  };

  for (const key of ['startFrame', 'endFrame']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) descriptor[key] = input[key];
  }
  return Object.freeze(descriptor);
}

export function choosePlaybackMode(descriptor) {
  const source = descriptor && typeof descriptor === 'object' ? descriptor : {};
  const hasMediaSource = source.mediaSource !== null && source.mediaSource !== undefined;
  const byteLength = normalizeByteLength(source.byteLength);

  if (hasPlaybackRegionDescriptor(source)) {
    return decision(
      hasMediaSource ? 'media' : 'unavailable',
      false,
      hasMediaSource ? 'region-must-stream' : 'region-media-unavailable'
    );
  }
  if (byteLength === null) {
    return decision(
      hasMediaSource ? 'media' : 'unavailable',
      false,
      hasMediaSource ? 'unknown-size-must-stream' : 'unknown-size-media-unavailable'
    );
  }
  if (byteLength > MAX_BUFFER_SOURCE_BYTES) {
    return decision(
      hasMediaSource ? 'media' : 'unavailable',
      false,
      hasMediaSource ? 'oversize-must-stream' : 'oversize-media-unavailable'
    );
  }
  if (source.bytes || typeof source.readBytes === 'function') {
    return decision('buffer', hasMediaSource, 'bounded-buffer-source');
  }
  if (hasMediaSource) return decision('media', false, 'media-source-only');
  return decision('unavailable', false, 'source-unavailable');
}

function decision(mode, allowMediaFallback, reason) {
  return Object.freeze({ mode, allowMediaFallback, reason });
}

function getMaterializedBytes(input) {
  const value = input.bytes ?? input.data;
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? value : null;
}

function getBlobSource(input) {
  const value = input.file;
  if (!value || typeof value !== 'object') return null;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
  if (typeof File !== 'undefined' && value instanceof File) return value;
  return Number.isFinite(value.size) && typeof value.arrayBuffer === 'function' ? value : null;
}

function getMediaSource(input, file) {
  if (input.mediaSource !== null && input.mediaSource !== undefined) return input.mediaSource;
  if (file) return file;
  return typeof input.path === 'string' && input.path.length > 0 ? input.path : null;
}

function normalizeByteLength(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
