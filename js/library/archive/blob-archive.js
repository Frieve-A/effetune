import { createBlobSource, openArchive } from './archive-reader.js';

// The opened archive is shared by every concurrent user of the key, so the open
// must not depend on one caller's abort signal; callers check their own signals.
export function withBlobArchive(cache, path, file, callback) {
  const key = JSON.stringify([path, file.size, file.lastModified]);
  return cache.use(key,
    async () => ({ archive: await openArchive(createBlobSource(file), file.name), close() {} }),
    callback);
}
