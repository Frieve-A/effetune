'use strict';

const fs = require('node:fs');

const MAX_FILE_BYTES = 256 * 1024 * 1024;

async function readFileBytes(filePath, expectedByteLength) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw createReadError('ERR_INVALID_FILE_PATH', 'A file path is required');
  }
  const expectedSize = validateExpectedByteLength(expectedByteLength);

  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw createReadError('ERR_FILE_NOT_REGULAR', 'The selected path is not a regular file');
    }
    const size = Number(stats.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) {
      throw createReadError(
        'ERR_LIBRARY_READ_LIMIT',
        `ERR_LIBRARY_READ_LIMIT: File exceeds maximum read size of ${MAX_FILE_BYTES} bytes`
      );
    }
    if (expectedSize !== undefined && size !== expectedSize) {
      throw createReadError(
        'ERR_FILE_SIZE_MISMATCH',
        'ERR_FILE_SIZE_MISMATCH: File size changed before it could be read'
      );
    }

    const bytes = new ArrayBuffer(size);
    const buffer = Buffer.from(bytes);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return offset === size ? bytes : bytes.slice(0, offset);
  } finally {
    await handle.close();
  }
}

function validateExpectedByteLength(value) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createReadError(
      'ERR_INVALID_EXPECTED_BYTE_LENGTH',
      'Expected file size must be a nonnegative safe integer'
    );
  }
  return value;
}

function createReadError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  MAX_FILE_BYTES,
  readFileBytes,
  validateExpectedByteLength
};
