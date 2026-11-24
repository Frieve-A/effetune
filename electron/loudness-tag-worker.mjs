import { parentPort } from 'node:worker_threads';
import { once } from 'node:events';
import { writeLoudnessTagsToFile } from './loudness-tag-writer.mjs';

parentPort.on('message', async ({ path, track, port }) => {
  try {
    parentPort.postMessage(await writeLoudnessTagsToFile(path, track, {
      async beforeReplace() {
        const reply = once(port, 'message');
        port.postMessage('authorize');
        const [allowed] = await reply;
        if (!allowed) throw Object.assign(new Error('Source access changed'), { code: 'EACCES' });
      }
    }));
  } finally { port.close(); }
});
