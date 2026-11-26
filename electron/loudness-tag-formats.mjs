import { METADATA_LIMIT, readTagLayout as readLayout, supported } from '../js/library/loudness/tag-formats.js';

// Only metadata is resident. Media and any trailing tags are copied in ranges.
export async function readBytes(file, start, length) {
  supported(Number.isSafeInteger(length) && length >= 0 && length <= METADATA_LIMIT);
  const buffer = Buffer.alloc(length);
  for (let i = 0; i < length;) {
    const { bytesRead } = await file.read(buffer, i, length - i, start + i);
    supported(bytesRead > 0);
    i += bytesRead;
  }
  return buffer;
}

export function readTagLayout(file, size, extension, tags) {
  return readLayout({ read: (start, length) => readBytes(file, start, length) }, size, extension, tags);
}
