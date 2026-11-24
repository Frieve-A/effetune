export const DRIVER_RESPONSE_TIMEOUT_MS = 15000;

export function waitForEvent(target, type, accept, timeoutMs = DRIVER_RESPONSE_TIMEOUT_MS, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const finish = () => {
      clearTimeout(timer);
      target.removeEventListener(type,listener);
      signal?.removeEventListener('abort',cancel);
    };
    const cancel = () => { finish(); reject(signal.reason); };
    const listener = event => { if (accept(event)) { finish(); resolve(event); } };
    const timer = setTimeout(() => { finish(); reject(new Error('Audio driver response timed out')); }, timeoutMs);
    target.addEventListener(type,listener);
    signal?.addEventListener('abort',cancel,{once:true});
  });
}

export async function connectAudioEngine(driver, {target = window, bridge = target.electronAPI.audioEngine, signal} = {}) {
  const connection = new AbortController();
  const token = crypto.randomUUID();
  let ports;
  const received = waitForEvent(target,'message',event => event.source === target &&
    event.data?.type === 'effetune-audio-engine-ports' && event.data.token === token && event.ports.length === 3,
    DRIVER_RESPONSE_TIMEOUT_MS,signal ? AbortSignal.any([connection.signal,signal]) : connection.signal).then(event => {
    ports = event.ports;
    return event.data.variant;
  });
  try {
    const [, variant] = await Promise.all([Promise.resolve().then(async () => {
      const result = await bridge.start(driver,token);
      if (!result.ok) {
        const error = new Error('Audio driver unavailable');
        if (['v3','baseline','single'].includes(result.variant)) error.variant = result.variant;
        throw error;
      }
    }),received]);
    return {ports,variant};
  } catch (error) {
    connection.abort(error);
    ports?.forEach(port => port.close());
    throw error;
  }
}

export class NativeControlClient {
  constructor(port) {
    this.port = port;
    this.lifetime = new AbortController();
    this.handleMessage = ({data}) => {
      if (data.type === 'engineFailure') this.close();
    };
    this.port.addEventListener('message',this.handleMessage);
    this.port.start();
  }

  send(message) { this.port.postMessage(message); }

  async request(message, type, accept = () => true) {
    const request = new AbortController();
    const reply = waitForEvent(this.port,'message',({data}) =>
      data.type === 'commandRejected' && data.command === message.type || data.type === type && accept(data),
      DRIVER_RESPONSE_TIMEOUT_MS,AbortSignal.any([request.signal,this.lifetime.signal]));
    try {
      this.send(message);
    } catch (error) {
      request.abort(error);
    }
    const {data} = await reply;
    if (data.type === 'commandRejected') throw new Error(`Audio engine rejected ${data.command}: ${data.reason}`);
    return data;
  }

  close() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort(new Error('The audio driver stopped'));
    this.port.removeEventListener('message',this.handleMessage);
    this.port.close();
  }
}
