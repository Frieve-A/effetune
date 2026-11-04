import { createSf2Fixture } from './sf2-fixture.mjs';

// Framing-only fixture. Its dummy setup/audio packets deliberately require no
// third-party encoder; real Vorbis decoding is covered by browser acceptance.
export function createOggPage(packets, { sequence = 0, flags = 0, granule = 0, serial = 7 } = {}) {
  const laces = packets.flatMap(packet => [...Array(Math.floor(packet.length / 255)).fill(255), packet.length % 255]);
  const bytes = Buffer.alloc(27 + laces.length + packets.reduce((sum, packet) => sum + packet.length, 0));
  bytes.write('OggS'); bytes[5] = flags; bytes.writeBigUInt64LE(BigInt(granule), 6);
  bytes.writeUInt32LE(serial, 14); bytes.writeUInt32LE(sequence, 18); bytes[26] = laces.length;
  bytes.set(laces, 27); let offset = 27 + laces.length;
  for (const packet of packets) { bytes.set(packet, offset); offset += packet.length; }
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? crc << 1 ^ 0x04c11db7 : crc << 1;
  }
  bytes.writeUInt32LE(crc >>> 0, 22);
  return bytes;
}

export function createVorbisFramingFixture({ frames = 16384, sampleRate = 44100, channels = 1 } = {}) {
  const identification = Buffer.alloc(30); identification[0] = 1; identification.write('vorbis', 1);
  identification[11] = channels; identification.writeUInt32LE(sampleRate, 12); identification[28] = 0xb8; identification[29] = 1;
  return Buffer.concat([createOggPage([identification], { flags: 2 }),
    createOggPage([Buffer.from('\x03vorbis'), Buffer.from('\x05vorbis')], { sequence: 1 }),
    createOggPage([Buffer.from([0, 1, 2])], { sequence: 2, flags: 4, granule: frames })]);
}

export function createSf3Fixture({ inclusive = false, minor = 0, ...options } = {}) {
  const ogg = createVorbisFramingFixture(options), original = createSf2Fixture({ sm24: false,
    sampleFrames: options.frames ?? 16384, sampleRate: options.sampleRate ?? 44100, loopStart: 8, loopEnd: 8192 });
  const start = original.indexOf(Buffer.from('smpl')) + 8, oldSize = original.readUInt32LE(start - 4);
  const pool = Buffer.concat([ogg, Buffer.alloc(ogg.length % 2)]);
  const bytes = Buffer.concat([original.subarray(0, start), pool, original.subarray(start + oldSize)]);
  bytes.writeUInt32LE(bytes.length - 8, 4); bytes.writeUInt32LE(ogg.length, start - 4);
  bytes.writeUInt32LE(pool.length + 12, start - 16);
  const version = bytes.indexOf(Buffer.from('ifil')) + 8; bytes.writeUInt16LE(3, version); bytes.writeUInt16LE(minor, version + 2);
  const header = bytes.indexOf(Buffer.from('shdr')) + 8;
  bytes.writeUInt32LE(0, header + 20); bytes.writeUInt32LE(ogg.length - (inclusive ? 1 : 0), header + 24); bytes.writeUInt16LE(17, header + 44);
  return bytes;
}
