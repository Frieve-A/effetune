import { AudioEncoder } from '/js/audio/audio-encoder.js';

const encoder = new AudioEncoder();

function createSignal(numberOfChannels, sampleRate, seconds) {
  const length = Math.round(sampleRate * seconds);
  const buffer = new AudioBuffer({ numberOfChannels, length, sampleRate });
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    const frequency = 220 + channel * 37;
    for (let index = 0; index < length; index++) {
      data[index] = 0.25 * Math.sin(2 * Math.PI * frequency * index / sampleRate);
    }
  }
  return buffer;
}

function readStreamInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let packed = 0n;
  for (let index = 18; index < 26; index++) {
    packed = (packed << 8n) | BigInt(view.getUint8(index));
  }
  return {
    magic: String.fromCharCode(...bytes.subarray(0, 4)),
    sampleRate: Number((packed >> 44n) & 0xfffffn),
    numberOfChannels: Number((packed >> 41n) & 0x7n) + 1,
    bitsPerSample: Number((packed >> 36n) & 0x1fn) + 1,
    totalSamples: Number(packed & 0xfffffffffn)
  };
}

function readWavHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    riff: String.fromCharCode(...bytes.subarray(0, 4)),
    wave: String.fromCharCode(...bytes.subarray(8, 12)),
    formatCode: view.getUint16(20, true),
    numberOfChannels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true)
  };
}

async function encodeAndDecode({
  numberOfChannels,
  sampleRate,
  sourceSampleRate = sampleRate,
  seconds = 0.5,
  format = 'flac',
  wavSampleFormat,
  flacSampleFormat
}) {
  const source = createSignal(numberOfChannels, sourceSampleRate, seconds);
  const outputSettings = { format, sampleRate };
  if (wavSampleFormat) outputSettings.wavSampleFormat = wavSampleFormat;
  if (flacSampleFormat) outputSettings.flacSampleFormat = flacSampleFormat;
  const output = await encoder.encode(source, outputSettings);
  const encoded = new Uint8Array(await output.blob.arrayBuffer());
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(encoded.buffer.slice(0));
    return {
      output: {
        format: output.format,
        extension: output.extension,
        mimeType: output.mimeType,
        sampleRate: output.sampleRate,
        numberOfChannels: output.numberOfChannels,
        size: output.blob.size
      },
      streamInfo: readStreamInfo(encoded),
      wavHeader: format === 'wav' ? readWavHeader(encoded) : null,
      decoded: {
        sampleRate: decoded.sampleRate,
        numberOfChannels: decoded.numberOfChannels,
        length: decoded.length,
        duration: decoded.duration
      }
    };
  } finally {
    await context.close();
  }
}

async function rejectUnsupportedChannels() {
  try {
    await encoder.encode(createSignal(9, 48000, 0.01), {
      format: 'flac',
      sampleRate: 48000,
      flacSampleFormat: 'pcm16'
    });
    return null;
  } catch (error) {
    return {
      key: error.userMessageKey || null,
      values: error.userMessageValues || null
    };
  }
}

async function cancelAndReuse() {
  const controller = new AbortController();
  const source = createSignal(8, 96000, 12);
  const pending = encoder.encode(source, {
    format: 'flac',
    sampleRate: 96000,
    flacSampleFormat: 'pcm16'
  }, {
    signal: controller.signal,
    onProgress: ({ phase }) => {
      if (phase === 'encoding') setTimeout(() => controller.abort(), 0);
    }
  });
  let canceledKey = null;
  try {
    await pending;
  } catch (error) {
    canceledKey = error.userMessageKey || null;
  }
  const reused = await encodeAndDecode({ numberOfChannels: 2, sampleRate: 48000 });
  return { canceledKey, reused };
}

window.__offlineAudioOutputSmoke = { encodeAndDecode, rejectUnsupportedChannels, cancelAndReuse };
