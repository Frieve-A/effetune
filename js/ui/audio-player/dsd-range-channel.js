import { DSD_RANGE_BYTE_CAP } from './dsd-source.js';

export function createDsdRangeChannel(reader) {
  const channel = new MessageChannel();
  let closed = false;
  let busy = false;
  channel.port1.onmessage = async ({ data }) => {
    if (closed || busy || !Number.isSafeInteger(data?.id)) return;
    busy = true;
    try {
      if (!Number.isSafeInteger(data.offset) || data.offset < 0 ||
          !Number.isSafeInteger(data.length) || data.length < 0 ||
          data.length > DSD_RANGE_BYTE_CAP || data.offset > reader.size - data.length) {
        throw Object.assign(new Error('Invalid DSD range'), { code: 'DSD_RANGE' });
      }
      const bytes = await reader.read(data.offset, data.length);
      if (!closed) channel.port1.postMessage({ id: data.id, bytes }, [bytes.buffer]);
    } catch (error) {
      if (!closed) channel.port1.postMessage({ id: data.id, error: error.code ?? 'DSD_RANGE' });
    } finally { busy = false; }
  };
  return { port: channel.port2, async dispose() {
    if (closed) return;
    closed = true;
    channel.port1.postMessage({ dispose: true });
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
    await reader.dispose();
  } };
}

export function openDsdWorkerReader(port, size) {
  let sequence = 0;
  let disposed = false;
  const pending = new Map();
  const dispose = () => {
    disposed = true;
    for (const request of pending.values()) request.reject(Object.assign(new Error('Disposed'), { code: 'DSD_DISPOSED' }));
    pending.clear();
    port.onmessage = null;
    port.close();
  };
  port.onmessage = ({ data }) => {
    if (data?.dispose) { dispose(); return; }
    const request = pending.get(data?.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(Object.assign(new Error(data.error), { code: data.error }));
    else request.resolve(data.bytes);
  };
  return { size,
    read(offset, length) {
      return new Promise((resolve, reject) => {
        if (disposed) { reject(Object.assign(new Error('Disposed'), { code: 'DSD_DISPOSED' })); return; }
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        port.postMessage({ id, offset, length });
      });
    },
    dispose
  };
}
