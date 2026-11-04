import { parentPort } from 'node:worker_threads';

globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
await import('../../js/vendor/rolling-pcm-decoder-worker.mjs');
parentPort.on('message', data => globalThis.onmessage({ data }));
