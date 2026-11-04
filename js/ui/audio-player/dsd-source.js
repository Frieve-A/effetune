import { getFileExtension } from '../../library/constants.js';

export const DSD_RESIDENT_BYTE_CAP = 28 * 1024 * 1024;
export const DSD_RANGE_BYTE_CAP = 1024 * 1024;

export function getDsdPlaybackErrorKey(error) {
  if (typeof error?.code !== 'string' || !error.code.startsWith('DSD_')) return null;
  if (error.code === 'DSD_NATIVE_UNSUPPORTED') return 'dsd.error.nativeUnsupported';
  if (error.code === 'DSD_UNSUPPORTED') return 'dsd.error.unsupported';
  return error.code === 'DSD_RANGE' ? 'dsd.error.range' : 'dsd.error.corrupt';
}

export function isDsdSource(track) {
  return [track?.name, track?.path, track?.fileName, track?.sourceFileName, track?.file?.name,
    track?.uri, track?.url, track?.mediaSource, track?.meta?.fileName]
    .some(value => typeof value === 'string' && ['dsf', 'dff'].includes(getFileExtension(value))) ||
    [track?.type, track?.mimeType, track?.file?.type, track?.meta?.mimeType,
      track?.meta?.protocolInfo?.split(':')[2]]
      .some(value => /^(?:audio\/(?:x-)?(?:dsf|dff|dsd|dsdiff))$/i.test(value ?? ''));
}

export function isProbeableDsdUrl(track) {
  const value = track?.mediaSource ?? track?.path ?? track?.uri ?? track?.url;
  if (typeof value !== 'string' || !/^https?:/i.test(value)) return false;
  try { return !/\.[a-z0-9]{1,8}$/i.test(new URL(value).pathname); }
  catch { return false; }
}

export async function openDsdRangeSource(track, { signal } = {}) {
  let disposed = false;
  let close = async () => {};
  let read;
  let size;
  let identity = null;
  const blob = track.file ?? (track.mediaSource instanceof Blob ? track.mediaSource : null);
  const materialized = track.bytes ?? track.data;
  if (blob && typeof blob.slice === 'function') {
    size = blob.size;
    read = async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  } else if (materialized instanceof ArrayBuffer || ArrayBuffer.isView(materialized)) {
    const bytes = materialized instanceof ArrayBuffer ? new Uint8Array(materialized)
      : new Uint8Array(materialized.buffer, materialized.byteOffset, materialized.byteLength);
    size = bytes.byteLength;
    read = async (offset, length) => bytes.slice(offset, offset + length);
  } else {
    const location = track.mediaSource ?? track.path ?? track.uri ?? track.url;
    if (typeof location !== 'string') throw rangeError();
    if (/^https?:/i.test(location)) {
      const controller = new AbortController();
      close = async () => controller.abort();
      let validator = null;
      read = async (offset, length) => {
        if (length === 0) return new Uint8Array(0);
        const response = await fetch(location, { headers: {
          Range: `bytes=${offset}-${offset + length - 1}`
        }, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
        const total = match ? Number(match[3]) : NaN;
        if (response.status !== 206 || !match || Number(match[1]) !== offset ||
            Number(match[2]) !== offset + length - 1 || !Number.isSafeInteger(total) ||
            total < offset + length || (size !== undefined && total !== size)) {
          const error = rangeError();
          error.recognizedDsd = isDsdSource({ mimeType: response.headers.get('content-type')?.split(';')[0] });
          await response.body?.cancel();
          throw error;
        }
        size = total;
        const nextValidator = response.headers.get('etag') ?? response.headers.get('last-modified');
        if (validator && nextValidator !== validator) { await response.body?.cancel(); throw rangeError(); }
        validator = nextValidator;
        identity = validator;
        const stream = response.body?.getReader();
        if (!stream) throw rangeError();
        const bytes = new Uint8Array(length);
        let received = 0;
        try {
          while (true) {
            const part = await stream.read();
            if (part.done) break;
            if (part.value.byteLength > length - received) throw rangeError();
            bytes.set(part.value, received);
            received += part.value.byteLength;
          }
        } finally { await stream.cancel(); }
        if (received !== length) throw rangeError();
        return bytes;
      };
      try { await read(0, 1); } catch (error) { await close(); throw error; }
    } else {
      const api = globalThis.window?.electronAPI;
      if (!api?.openPlaybackRange) throw rangeError();
      const session = await api.openPlaybackRange(location);
      size = session.size;
      identity = session.identity;
      read = async (offset, length) => new Uint8Array(await api.readPlaybackRange(session.token, offset, length));
      close = () => api.closePlaybackRange(session.token);
    }
  }
  if (!Number.isSafeInteger(size) || size < 1) { await close(); throw rangeError(); }
  if (signal?.aborted) { await close(); throw signal.reason; }
  return {
    size,
    identity,
    async read(offset, length) {
      if (signal?.aborted) throw signal.reason;
      if (disposed) throw Object.assign(new Error('DSD source disposed'), { code: 'DSD_DISPOSED' });
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) ||
          length < 0 || length > DSD_RANGE_BYTE_CAP || offset > size - length) throw rangeError();
      const bytes = await read(offset, length);
      if (disposed) throw Object.assign(new Error('DSD source disposed'), { code: 'DSD_DISPOSED' });
      if (bytes.length !== length) throw rangeError();
      return bytes;
    },
    async dispose() { if (!disposed) { disposed = true; await close(); } }
  };
}

function rangeError() { return Object.assign(new Error('DSD range read unavailable'), { code: 'DSD_RANGE' }); }
