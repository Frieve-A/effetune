import fs from 'node:fs';
import { createChain, SoundFontBank } from '@effetune/dsp';

const sampleRate = 48000;
const blockFrames = sampleRate; // one second per process() call
const tailSeconds = 3; // silence after the last event lets releases and reverb finish
const [songPath, bankPath, wavPath] = process.argv.slice(2);

// A minimal Standard MIDI File reader that returns [frame, [status, data1, data2]]
// for the supported channel messages. Any SMF parser that yields the same pairs works.
function readMidiEvents(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');
  const timed = [];
  for (let offset = 8 + view.getUint32(4); offset < bytes.length;) {
    const end = offset + 8 + view.getUint32(offset + 4);
    let position = offset + 8;
    let tick = 0;
    let status = 0;
    const readLength = () => {
      let value = 0;
      let byte;
      do {
        byte = bytes[position++];
        value = value * 128 + (byte & 127);
      } while (byte & 128);
      return value;
    };
    const track = String.fromCharCode(...bytes.subarray(offset, offset + 4)) === 'MTrk';
    while (track && position < end) {
      tick += readLength();
      if (bytes[position] & 0x80) status = bytes[position++];
      if (status === 0xff) {
        const type = bytes[position++];
        const length = readLength();
        if (type === 0x51) {
          const tempo = bytes[position] << 16 | bytes[position + 1] << 8 | bytes[position + 2];
          timed.push({ tick, tempo });
        }
        position += length;
      } else if (status === 0xf0 || status === 0xf7) {
        const length = readLength();
        position += length;
      } else {
        const size = (status & 0xe0) === 0xc0 ? 1 : 2;
        const kind = status & 0xf0;
        if (kind !== 0xa0 && kind !== 0xd0) {
          timed.push({ tick, midi: [status, bytes[position], size === 2 ? bytes[position + 1] : 0] });
        }
        position += size;
      }
    }
    offset = end;
  }
  timed.sort((a, b) => a.tick - b.tick);
  let tempo = 500000;
  let seconds = 0;
  let lastTick = 0;
  const events = [];
  for (const event of timed) {
    seconds += (event.tick - lastTick) * tempo / (division * 1e6);
    lastTick = event.tick;
    if (event.tempo) tempo = event.tempo;
    else events.push([Math.round(seconds * sampleRate), event.midi]);
  }
  return events;
}

function encodeWav16(channels) {
  const frames = channels[0].length;
  const bytes = Buffer.alloc(44 + frames * channels.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels.length, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels.length * 2, 28);
  bytes.writeUInt16LE(channels.length * 2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * channels.length * 2, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (const channel of channels) {
      const sample = channel[frame] > 1 ? 1 : channel[frame] < -1 ? -1 : channel[frame];
      bytes.writeInt16LE(Math.round(sample * 32767), offset);
      offset += 2;
    }
  }
  return bytes;
}

const events = readMidiEvents(fs.readFileSync(songPath));
const totalFrames = (events.at(-1)?.[0] ?? 0) + tailSeconds * sampleRate;
const bank = SoundFontBank.fromBytes(fs.readFileSync(bankPath));
const chain = await createChain({
  version: 1,
  chain: [{ id: 'player', type: 'SoundFontPlayer', parameters: { outputGain: -6 }, assets: { soundFont: 'bank' } }]
}, { assetResolver: () => bank });
const stream = await chain.stream({ sampleRate, channels: 2 });
const audio = [new Float32Array(totalFrames), new Float32Array(totalFrames)];
try {
  let index = 0;
  for (let start = 0; start < totalFrames; start += blockFrames) {
    const frames = Math.min(blockFrames, totalFrames - start);
    const blockEvents = [];
    while (index < events.length && events[index][0] < start + frames) {
      const [frame, midi] = events[index++];
      blockEvents.push({ frame: frame - start, effectId: 'player', midi });
    }
    const silence = [new Float32Array(frames), new Float32Array(frames)];
    const output = await stream.process(silence, { events: blockEvents });
    output.forEach((channel, channelIndex) => audio[channelIndex].set(channel, start));
  }
} finally {
  stream.close();
  chain.close();
}
fs.writeFileSync(wavPath, encodeWav16(audio));
