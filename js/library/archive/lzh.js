import { decodeName, fail, normalizePath, readBytes, u16, u32 } from './archive-binary.js';

function crc16(data) {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xa001 : 0);
  }
  return crc;
}

function readExtension(type, bytes, info) {
  if (type === 1) info.name = bytes;
  if (type === 2) info.directory = bytes;
}

export async function listLzh(source, signal) {
  const entries = [];
  let count = 0;
  for (let pos = 0; pos < source.size;) {
    const prefix = await readBytes(source, pos, Math.min(22, source.size - pos), signal);
    if (!prefix[0] && (prefix.length < 21 || prefix[20] !== 2)) break;
    if (prefix.length < 22) fail();
    if (++count > 65535) fail('too-large');
    const level = prefix[20], method = String.fromCharCode(...prefix.subarray(2, 7));
    if (level > 2) fail('unsupported');
    const length = level === 2 ? u16(prefix, 0) : prefix[0] + 2;
    const h = await readBytes(source, pos, length, signal);
    let packed = u32(prefix, 7), offset = pos + length, crc;
    const info = { name: new Uint8Array(), directory: null };
    if (level === 2) {
      if (length < 26) fail();
      crc = u16(h, 21);
      let headerCrc, crcOffset;
      for (let i = 24; ; ) {
        if (i + 2 > length) fail();
        const n = u16(h, i);
        if (!n) break;
        if (n < 3 || i + n + 2 > length) fail();
        const type = h[i + 2];
        if (type === 0) {
          if (n < 5 || crcOffset !== undefined) fail();
          crcOffset = i + 3;
          headerCrc = u16(h, crcOffset);
        }
        readExtension(type, h.subarray(i + 3, i + n), info);
        i += n;
      }
      if (crcOffset !== undefined) {
        const check = Uint8Array.from(h);
        check.fill(0, crcOffset, crcOffset + 2);
        if (crc16(check) !== headerCrc) fail();
      }
    } else {
      const nameEnd = 22 + prefix[21];
      if (length < nameEnd + (level ? 5 : 2)) fail();
      if ((h.subarray(2).reduce((sum, byte) => sum + byte, 0) & 255) !== h[1]) fail();
      crc = u16(h, nameEnd);
      info.name = h.subarray(22, nameEnd);
      if (level === 1) {
        let n = u16(h, length - 2);
        while (n) {
          if (n < 3 || n > packed) fail();
          const ext = await readBytes(source, offset, n, signal);
          readExtension(ext[0], ext.subarray(1, n - 2), info);
          offset += n;
          packed -= n;
          n = u16(ext, n - 2);
        }
      }
    }
    const pathBytes = info.directory ? [...info.directory, ...info.name] : info.name;
    // LHA writes 0xFF as the path separator in every header level; the byte
    // never occurs in Shift_JIS or UTF-8 names.
    const path = normalizePath(decodeName(Uint8Array.from(pathBytes, byte => byte === 255 ? 47 : byte)));
    const size = u32(h, 11);
    if (path && method !== '-lhd-') entries.push({ path, size, packed, offset, method, crc, supported: /^-lh[04567]-$/.test(method) });
    pos = offset + packed;
    if (pos > source.size) fail();
  }
  return { entries, count };
}

class BitReader {
  constructor(data) { this.data = data; this.pos = 0; }
  bits(n) {
    if (this.pos + n > this.data.length * 8) fail();
    let value = 0;
    while (n > 0) {
      const available = 8 - (this.pos & 7), take = Math.min(available, n);
      value = (value << take) | ((this.data[this.pos >>> 3] >>> (available - take)) & ((1 << take) - 1));
      this.pos += take;
      n -= take;
    }
    return value;
  }
}

// Canonical codes of a given length form a contiguous interval in symbol order.
function huffman(lengths) {
  const counts = Array(17).fill(0), first = [], symbols = [];
  for (const length of lengths) {
    if (length > 16) fail();
    if (length) counts[length]++;
  }
  let code = 0;
  for (let len = 1; len <= 16; len++) {
    code = (code + counts[len - 1]) * 2;
    if (code + counts[len] > 2 ** len) fail();
    first[len] = code;
    symbols[len] = [];
  }
  if (code + counts[16] !== 65536) fail();
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[lengths[i]].push(i);
  return bits => {
    let value = 0;
    for (let len = 1; len <= 16; len++) {
      value = value * 2 + bits.bits(1);
      const index = value - first[len];
      if (index >= 0 && index < counts[len]) return symbols[len][index];
    }
    fail();
  };
}

function singleTree(bits, width, max) {
  const symbol = bits.bits(width);
  if (symbol >= max) fail();
  return () => symbol;
}

function readLengths(bits, max, width, skipZeros) {
  const count = bits.bits(width);
  if (!count) return singleTree(bits, width, max);
  if (count > max) fail();
  const lengths = [];
  while (lengths.length < count) {
    let len = bits.bits(3);
    if (len === 7) while (bits.bits(1)) if (++len > 16) fail();
    lengths.push(len);
    if (skipZeros && lengths.length === 3) lengths.push(...Array(bits.bits(2)).fill(0));
  }
  if (lengths.length > max) fail();
  return huffman(lengths);
}

function readCharacters(bits) {
  const temporary = readLengths(bits, 19, 5, true);
  const count = bits.bits(9);
  if (!count) return singleTree(bits, 9, 510);
  if (count > 510) fail();
  const lengths = [];
  while (lengths.length < count) {
    const symbol = temporary(bits);
    if (symbol < 3) {
      const n = symbol === 0 ? 1 : symbol === 1 ? bits.bits(4) + 3 : bits.bits(9) + 20;
      if (lengths.length + n > count) fail();
      lengths.push(...Array(n).fill(0));
    } else lengths.push(symbol - 2);
  }
  return huffman(lengths);
}

async function inflateLh(source, entry, signal) {
  const { size, method } = entry;
  const dictionaryBits = { '-lh4-': 12, '-lh5-': 13, '-lh6-': 15, '-lh7-': 16 }[method];
  const positionCount = dictionaryBits <= 13 ? 14 : dictionaryBits + 1;
  const output = new Uint8Array(size);
  // A block has at most 65535 tokens (two 16-bit codes and 15 distance bits
  // each), plus three small trees. Refill between blocks to bound input memory.
  const blockWindow = 512 * 1024;
  let windowStart = 0, bits = new BitReader(new Uint8Array());
  let pos = 0, remaining = 0, character, position;
  while (pos < size) {
    if (!remaining) {
      const consumed = Math.floor(bits.pos / 8);
      if (bits.data.length - consumed < blockWindow && windowStart + bits.data.length < entry.packed) {
        windowStart += consumed;
        const bitOffset = bits.pos % 8;
        const bytes = await readBytes(source, entry.offset + windowStart, Math.min(entry.packed - windowStart, 2 * blockWindow), signal);
        bits = new BitReader(bytes);
        bits.pos = bitOffset;
      }
      remaining = bits.bits(16);
      if (!remaining) fail();
      character = readCharacters(bits);
      position = readLengths(bits, positionCount, dictionaryBits <= 13 ? 4 : 5, false);
    }
    remaining--;
    const symbol = character(bits);
    if (symbol < 256) output[pos++] = symbol;
    else {
      const length = symbol - 253, slot = position(bits);
      const distance = 1 + (slot > 1 ? (1 << (slot - 1)) + bits.bits(slot - 1) : slot);
      if (pos + length > size || distance > 2 ** dictionaryBits) fail();
      for (let i = 0; i < length; i++, pos++) output[pos] = pos < distance ? 32 : output[pos - distance];
    }
  }
  return output;
}

export async function readLzh(source, entry, signal) {
  if (entry.method === '-lh0-' && entry.size !== entry.packed) fail();
  const result = entry.method === '-lh0-' ? await readBytes(source, entry.offset, entry.packed, signal)
    : await inflateLh(source, entry, signal);
  if (crc16(result) !== entry.crc) fail();
  return result;
}
