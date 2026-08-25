import fs from 'node:fs';

const REMOVE_OPTIONS = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 20
});

export async function removeSqliteTestDirectory(directory) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(
      `Timed out while removing SQLite test directory: ${directory}`
    )), 3000);
  });
  try {
    await Promise.race([
      fs.promises.rm(directory, REMOVE_OPTIONS),
      timeout
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
