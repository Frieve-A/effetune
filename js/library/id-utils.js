export function generateEntityId(prefix = 'id') {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${now}${random}`;
}

export async function sha1Hex(input) {
  const text = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-1', text);
    return [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return fallbackHashHex(text);
}

export async function createTrackId(folderId, relativePath) {
  const hash = await sha1Hex(`${folderId}\u0000${relativePath}`);
  return `t_${hash.slice(0, 20)}`;
}

export async function createArtworkId(bytes) {
  const hash = await sha1Hex(bytes);
  return `a_${hash.slice(0, 20)}`;
}

function fallbackHashHex(bytes) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < data.length; i++) {
    h1 ^= data[i];
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ data[i], 0x85ebca6b);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0');
  const b = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${a}${b}${a}${b}${a}`.slice(0, 40);
}
