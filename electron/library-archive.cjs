'use strict';

const fs = require('node:fs/promises');
let support;
async function withFileArchive(path, size, mtimeMs, callback, signal) {
  support ??= Promise.all([import('../js/library/archive/archive-reader.js'), import('../js/library/archive/archive-cache.js')])
    .then(([reader, { createArchiveCache }]) => ({ ...reader, cache: createArchiveCache() }));
  const { cache, openArchive, createFileHandleSource } = await support;
  signal?.throwIfAborted();
  return cache.use(JSON.stringify([path, size, mtimeMs]), async () => {
    const handle = await fs.open(path, 'r');
    try {
      const archive = await openArchive(createFileHandleSource(handle, size), path);
      return { archive, close: () => handle.close() };
    } catch (error) { await handle.close(); throw error; }
  }, archive => { signal?.throwIfAborted(); return callback(archive); });
}
module.exports = { withFileArchive };
