const failure = code => Object.assign(new Error('The instrument sample channel was closed.'), { code });

// The preload transfers the capability once; no sample bytes return through it.
export async function openSfzProtectedRangePort(bridge, id) {
  const token = crypto.randomUUID();
  let receive, port, rejectPort;
  const delivered = new Promise((resolve, reject) => {
    rejectPort = reject;
    receive = event => {
      if (event.source !== window || event.data?.type !== 'effetune-sfz-range-port' || event.data.token !== token) return;
      port = event.ports[0]; resolve(port);
    };
    window.addEventListener('message', receive);
  });
  try {
    const response = await bridge.openRangePort({ id, token });
    if (!response?.ok) { rejectPort(failure('sample-read')); await delivered; }
    return await delivered;
  } finally { window.removeEventListener('message', receive); }
}

export async function startSfzWorkerSupply(worker, { port, rangePort, ...options }) {
  const ports = rangePort ? [port, rangePort] : [port];
  return worker.call('supply', { ...options, port, rangePort }, ports);
}

// Runs in the existing decode Worker. The provider retains its bounded pending
// identities and ACK4; only its control channel changes ownership.
export async function attachSfzWorkerSupply({ port, generation, pluginId, operationRevision, replayEpoch,
  provider, onClose = () => {} }) {
  let closed = false, polling = false, requested = false, nextId = 1;
  const pending = new Map();
  const identity = { pluginId, generation, operationRevision, replayEpoch };
  const close = code => {
    if (closed) return;
    closed = true;
    provider.close();
    for (const request of pending.values()) request.reject(failure(code));
    pending.clear(); port.close(); onClose(code);
  };
  const request = (type, payload = {}, transfer = []) => new Promise((resolve, reject) => {
    if (closed) { reject(failure('sample-cancelled')); return; }
    const requestId = nextId++;
    pending.set(requestId, { resolve, reject });
    port.postMessage({ ...identity, ...payload, type, requestId }, transfer);
  });
  const poll = async () => {
    requested = true;
    if (polling || closed) return;
    polling = true;
    try {
      while (requested) {
        if (closed) break;
        requested = false;
        const result = await request('sfzPollPages');
        if (!result?.ok) throw failure('sample-generation');
        await provider.requestPages(result.requests);
      }
    } catch (error) {
      if (!closed) port.postMessage({ ...identity, type: 'sfzStreamFailed', code: error.code || 'sample-read' });
      close(error.code || 'sample-read');
    } finally { polling = false; }
  };
  provider.publish = async page => {
    const result = await request('sfzPublishPage', { page }, [page.pcm.buffer]);
    return result?.ok === true;
  };
  port.onmessage = ({ data }) => {
    if (data?.type === 'sfzStreamStop') { close('sample-cancelled'); return; }
    if (data?.type === 'sfzStreamPollNeeded') { void poll(); return; }
    const request = pending.get(data?.requestId);
    if (!request) return;
    pending.delete(data.requestId); request.resolve(data);
  };
  port.onmessageerror = () => close('sample-read');
  port.start?.();
  void poll();
  return close;
}
