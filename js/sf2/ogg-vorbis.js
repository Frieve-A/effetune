// SF3 stores independent mono Ogg Vorbis streams, not a shared compressed pool.
// Container framing: https://xiph.org/ogg/doc/framing.html
// Platform decoder contract: https://www.w3.org/TR/webcodecs-vorbis-codec-registration/
const MAX_PAGE = 65307;
const MAX_HEADER_BYTES = 256 * 1024;
const failure = code => Object.assign(new Error(code === 'sample-codec-unavailable'
  ? 'This browser cannot play compressed SoundFonts. Use a browser with Vorbis decoding support or choose an SF2 SoundFont.'
  : 'This compressed SoundFont could not be read. Choose another SoundFont.'), { code });
const signature = (bytes, at = 0) => bytes[at] === 79 && bytes[at + 1] === 103 && bytes[at + 2] === 103 && bytes[at + 3] === 83;
const vorbis = (bytes, type) => bytes[0] === type && String.fromCharCode(...bytes.subarray(1, 7)) === 'vorbis';
const join = parts => {
  const output = new Uint8Array(parts.reduce((size, bytes) => size + bytes.length, 0));
  let at = 0;
  for (const bytes of parts) { output.set(bytes, at); at += bytes.length; }
  return output;
};

function checksum(bytes) {
  let crc = 0;
  for (let at = 0; at < bytes.length; at++) {
    crc ^= (at >= 22 && at < 26 ? 0 : bytes[at]) << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  return crc >>> 0;
}

async function page(read, offset, size, serial = null) {
  if (offset < 0 || offset + 27 > size) throw failure('sample-format');
  const header = await read(offset, 27), view = new DataView(header.buffer, header.byteOffset, header.length);
  if (!signature(header) || header[4] !== 0 || header[5] & ~7 || !header[26] || serial !== null && view.getUint32(14, true) !== serial) throw failure('sample-format');
  const laces = await read(offset + 27, header[26]);
  const length = 27 + laces.length + laces.reduce((sum, value) => sum + value, 0);
  if (offset + length > size) throw failure('sample-format');
  const bytes = await read(offset, length);
  if (checksum(bytes) !== view.getUint32(22, true)) throw failure('sample-format');
  const granule = view.getBigUint64(6, true);
  if (granule !== 0xffffffffffffffffn && granule > BigInt(Number.MAX_SAFE_INTEGER)) throw failure('sample-format');
  return { offset, next: offset + length, flags: header[5], serial: view.getUint32(14, true),
    sequence: view.getUint32(18, true), granule: granule === 0xffffffffffffffffn ? -1 : Number(granule),
    laces, body: bytes.subarray(27 + laces.length) };
}

// At most one Ogg page is read by a probe. Sync-shaped bytes in packet payloads
// are accepted only after checking the complete page CRC and stream identity.
async function findPage(read, offset, size, serial) {
  const bytes = await read(offset, Math.min(MAX_PAGE * 2, size - offset));
  for (let at = 0; at + 27 <= bytes.length; at++) {
    if (!signature(bytes, at)) continue;
    try { return await page(read, offset + at, size, serial); }
    catch (error) { if (error.code !== 'sample-format') throw error; }
  }
  return null;
}

function packets(current, carry = [], skip = false) {
  const output = [];
  let at = 0, length = carry.reduce((sum, bytes) => sum + bytes.length, 0);
  for (const lace of current.laces) {
    const part = current.body.subarray(at, at + lace); at += lace;
    if (!skip) {
      carry.push(part); length += lace;
      if (length > MAX_HEADER_BYTES) throw failure('sample-format');
    }
    if (lace < 255) {
      if (!skip) output.push(join(carry));
      carry = []; length = 0; skip = false;
    }
  }
  return { output, carry, skip };
}

export async function readOggVorbisMetadata(read, size) {
  if (!Number.isSafeInteger(size) || size < 58) throw failure('sample-format');
  const headers = [];
  let offset = 0, serial = null, sequence = 0, carry = [], headerBytes = 0;
  while (headers.length < 3) {
    const current = await page(read, offset, size, serial);
    if (current.sequence !== sequence++ || (offset === 0 ? current.flags !== 2 : Boolean(current.flags & 1) !== Boolean(carry.length))) throw failure('sample-format');
    serial = current.serial;
    const result = packets(current, carry); carry = result.carry;
    for (const packet of result.output) {
      if (headers.length === 3 || !vorbis(packet, [1, 3, 5][headers.length])) throw failure('sample-format');
      headerBytes += packet.length;
      if (headerBytes > MAX_HEADER_BYTES) throw failure('sample-format');
      headers.push(packet);
    }
    offset = current.next;
    if (sequence > 1024 || current.flags & 4) throw failure('sample-format');
  }
  if (carry.length) throw failure('sample-format');
  const identification = headers[0], info = new DataView(identification.buffer, identification.byteOffset, identification.length);
  if (identification.length !== 30 || info.getUint32(7, true) !== 0 || identification[11] !== 1 || !(identification[29] & 1)) throw failure('sample-format');
  const sampleRate = info.getUint32(12, true), smallBlock = identification[28] & 15, largeBlock = identification[28] >> 4;
  if (sampleRate < 1 || sampleRate > 768000 || smallBlock < 6 || largeBlock < smallBlock || largeBlock > 13) throw failure('sample-format');
  // MuseScore writes an exclusive SHDR end; other writers use an inclusive
  // end. EOS framing resolves both, permitting only the one boundary byte.
  const tail = await read(Math.max(offset, size - MAX_PAGE - 1), size - Math.max(offset, size - MAX_PAGE - 1));
  let final;
  for (let at = 0; at + 27 <= tail.length; at++) {
    if (!signature(tail, at)) continue;
    try {
      const candidate = await page(read, Math.max(offset, size - MAX_PAGE - 1) + at, size, serial);
      if (candidate.flags & 4 && size - candidate.next <= 1 && candidate.granule > 0) { final = candidate; break; }
    } catch (error) { if (error.code !== 'sample-format') throw error; }
  }
  if (!final || final.offset < offset) throw failure('sample-format');
  // Xiph extradata: number of header packets minus one, followed by the
  // laced lengths of the first two headers and then all three packets.
  const lengths = [2];
  for (const header of headers.slice(0, 2)) {
    let remaining = header.length;
    while (remaining >= 255) { lengths.push(255); remaining -= 255; }
    lengths.push(remaining);
  }
  return { format: 'sf3-vorbis', channels: 1, frames: final.granule, sampleRate,
    dataOffset: offset, endOffset: final.next, serial, description: join([Uint8Array.from(lengths), ...headers]) };
}

// Decode only pages around the requested window. Each operation owns and closes
// its platform decoder; neither a library-sized PCM copy nor an idle decoder is
// retained. AudioWorklet/native render code receives the existing PCM pages.
export async function decodeOggVorbisFrames(read, size, firstFrame, count, expected) {
  const metadata = await readOggVorbisMetadata(read, size);
  if (metadata.frames !== expected.frames || metadata.sampleRate !== expected.sampleRate) throw failure('sample-changed');
  if (typeof globalThis.AudioDecoder !== 'function' || typeof globalThis.EncodedAudioChunk !== 'function') throw failure('sample-codec-unavailable');
  const config = { codec: 'vorbis', sampleRate: metadata.sampleRate, numberOfChannels: 1, description: metadata.description };
  if (!(await AudioDecoder.isConfigSupported(config)).supported) throw failure('sample-codec-unavailable');
  let anchor = await page(read, metadata.dataOffset, metadata.endOffset, metadata.serial);
  let lower = anchor.offset, upper = metadata.endOffset;
  for (let attempts = 0; attempts < 32 && upper - lower > MAX_PAGE * 2; attempts++) {
    const middle = Math.floor((lower + upper) / 2), candidate = await findPage(read, middle, metadata.endOffset, metadata.serial);
    if (!candidate || candidate.granule >= firstFrame || candidate.flags & 4) upper = middle;
    else { anchor = candidate; lower = candidate.next; }
  }
  // Narrow gaps left by bisection using framing, without decoding preceding PCM.
  while (anchor.next < metadata.endOffset) {
    const next = await page(read, anchor.next, metadata.endOffset, metadata.serial);
    if (next.granule >= firstFrame || next.flags & 4) break;
    anchor = next;
  }
  const output = new Float32Array(count);
  let decoded = [], decodedFrames = 0, decoderError, position = anchor.offset === metadata.dataOffset ? 0 : null;
  const decoder = new AudioDecoder({ error(error) { decoderError = error; }, output(audio) {
    try {
      if (audio.numberOfChannels !== 1 || audio.sampleRate !== metadata.sampleRate || decodedFrames + audio.numberOfFrames > 1048576) throw failure('sample-format');
      const pcm = new Float32Array(audio.numberOfFrames);
      audio.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
      decoded.push(pcm); decodedFrames += pcm.length;
    } catch (error) { decoderError = error; }
    finally { audio.close(); }
  } });
  let current = anchor, carry = [], skip = Boolean(anchor.flags & 1), copied = 0, timestamp = 0, primer = null;
  try {
    for (let pages = 0; pages < 65536; pages++) {
      if (decoder.state === 'configured') decoder.reset();
      decoder.configure(config);
      const result = packets(current, carry, skip); carry = result.carry; skip = result.skip;
      // Each page starts with fresh codec state. Re-submit the preceding
      // complete packet to prime its Vorbis overlap window.
      for (const packet of primer ? [primer, ...result.output] : result.output) {
        if (!packet.length || packet[0] & 1) throw failure('sample-format');
        decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: timestamp++, data: packet }));
      }
      await decoder.flush();
      if (decoderError) throw failure('sample-format');
      if (result.output.length) primer = result.output[result.output.length - 1];
      if (position === null && current.granule >= 0 && !(current.flags & 4)) position = current.granule - decodedFrames;
      if (position !== null) {
        for (const pcm of decoded) {
          const start = Math.max(firstFrame, position), end = Math.min(firstFrame + count, position + pcm.length, metadata.frames);
          if (end > start) { output.set(pcm.subarray(start - position, end - position), start - firstFrame); copied += end - start; }
          position += pcm.length;
        }
        decoded = []; decodedFrames = 0;
        if (copied === count) return output;
      }
      if (current.flags & 4 || current.next >= metadata.endOffset) break;
      const next = await page(read, current.next, metadata.endOffset, metadata.serial);
      if (next.sequence !== current.sequence + 1 || Boolean(next.flags & 1) !== Boolean(carry.length || skip)) throw failure('sample-format');
      current = next;
    }
    throw failure('sample-format');
  } finally { if (decoder.state !== 'closed') decoder.close(); }
}
