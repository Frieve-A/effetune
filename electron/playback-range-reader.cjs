const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

const MAX_RANGE_BYTES = 1024 * 1024;

function registerPlaybackRangeReader({ fileIpc, assertFile }) {
  const sessions = new Map();
  const owners = new WeakMap();
  const close = async token => {
    const session = sessions.get(token);
    if (!session) return;
    sessions.delete(token);
    await session.handle.close();
  };
  fileIpc.handle('open-playback-range', async (event, filePath) => {
    assertFile(filePath);
    let owner = owners.get(event.sender);
    if (!owner) {
      owner = { pending: 0, generation: 0 };
      owners.set(event.sender, owner);
      const release = () => {
        owner.generation++;
        for (const [key, value] of sessions) {
          if (value.sender === event.sender) void close(key).catch(console.error);
        }
      };
      event.sender.once('destroyed', release);
      event.sender.on('render-process-gone', release);
      event.sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) release();
      });
    }
    if (owner.pending + [...sessions.values()].filter(value => value.sender === event.sender).length >= 8) {
      throw new Error('Too many open playback sources');
    }
    const generation = owner.generation;
    owner.pending++;
    let handle;
    try {
      const canonical = await fs.realpath(filePath);
      assertFile(canonical);
      const before = await fs.stat(canonical);
      handle = await fs.open(canonical, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 1 ||
          stat.dev !== before.dev || stat.ino !== before.ino || generation !== owner.generation ||
          event.sender.isDestroyed?.()) throw new Error('Playback source changed');
      const token = randomUUID();
      sessions.set(token, { handle, stat, sender: event.sender, busy: false });
      handle = null;
      return { token, size: stat.size, identity: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}` };
    } finally {
      owner.pending--;
      await handle?.close();
    }
  });
  fileIpc.handle('read-playback-range', async (event, token, offset, length) => {
    const session = sessions.get(token);
    if (!session || session.sender !== event.sender || session.busy ||
        !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(length) || length < 0 || length > MAX_RANGE_BYTES ||
        offset > session.stat.size - length) throw new Error('Invalid playback read');
    session.busy = true;
    try {
      const stat = await session.handle.stat();
      if (stat.size !== session.stat.size || stat.mtimeMs !== session.stat.mtimeMs) {
        throw new Error('Playback source changed');
      }
      const bytes = new Uint8Array(length);
      let read = 0;
      while (read < length) {
        const result = await session.handle.read(bytes, read, length - read, offset + read);
        if (!result.bytesRead) throw new Error('Playback source ended unexpectedly');
        read += result.bytesRead;
      }
      return bytes;
    } finally { session.busy = false; }
  });
  fileIpc.handle('close-playback-range', async (event, token) => {
    if (sessions.get(token)?.sender === event.sender) await close(token);
  });
}

module.exports = { registerPlaybackRangeReader, MAX_RANGE_BYTES };
