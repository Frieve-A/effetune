export const IR_ASSET_FORMAT_TAG = 1;
export const IR_ASSET_HEADER_BYTES = 32;
export const IR_ASSET_MAGIC = 0x31415445;

export const IR_ASSET_TOPOLOGY = Object.freeze({
  unspecified: 0,
  mono: 1,
  independent: 2,
  trueStereo: 3,
  matrix: 4
});

const MAX_CHANNELS = 8;
const MAX_MATRIX_PATHS = 8;
const MATRIX_PATH_BYTES = 12;

function validateChannels(channels) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > MAX_CHANNELS) {
    throw new TypeError('IR channels must contain between 1 and 8 Float32Array values');
  }
  const frames = channels[0] instanceof Float32Array ? channels[0].length : 0;
  if (frames === 0) throw new TypeError('IR channels must not be empty');
  for (const channel of channels) {
    if (!(channel instanceof Float32Array) || channel.length !== frames) {
      throw new TypeError('IR channels must be equally sized Float32Array values');
    }
    for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new TypeError('IR samples must be finite');
    }
  }
  return frames;
}

function validateTopology(topology, paths, channelCount) {
  if (!Number.isInteger(topology) || topology < 0 || topology > IR_ASSET_TOPOLOGY.matrix) {
    throw new TypeError('IR topology must be a supported integer enum value');
  }
  if (topology !== IR_ASSET_TOPOLOGY.matrix) {
    if (paths !== undefined && paths.length !== 0) {
      throw new TypeError('IR paths are only valid for matrix topology');
    }
    return [];
  }
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_MATRIX_PATHS) {
    throw new TypeError('Matrix topology requires between 1 and 8 paths');
  }
  return paths.map(path => {
    const inputSlot = path?.inputSlot;
    const outputSlot = path?.outputSlot;
    const irChannel = path?.irChannel;
    if (![inputSlot, outputSlot, irChannel].every(Number.isSafeInteger) ||
        inputSlot < 0 || inputSlot > 0xffffffff || outputSlot < 0 || outputSlot > 0xffffffff ||
        irChannel < 0 || irChannel >= channelCount) {
      throw new TypeError('Matrix paths require non-negative slots and a valid IR channel');
    }
    return { inputSlot, outputSlot, irChannel };
  });
}

export function buildIrAssetPayload({
  channels,
  sampleRate,
  topology = IR_ASSET_TOPOLOGY.unspecified,
  paths
}) {
  const frames = validateChannels(channels);
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffffffff) {
    throw new TypeError('IR sample rate must be a positive 32-bit integer');
  }
  const matrixPaths = validateTopology(topology, paths, channels.length);
  const pathBytes = matrixPaths.length * MATRIX_PATH_BYTES;
  const sampleBytes = channels.length * frames * Float32Array.BYTES_PER_ELEMENT;
  const payload = new ArrayBuffer(IR_ASSET_HEADER_BYTES + pathBytes + sampleBytes);
  const view = new DataView(payload);

  view.setUint32(0, IR_ASSET_MAGIC, true);
  view.setUint32(4, channels.length, true);
  view.setUint32(8, frames, true);
  view.setUint32(12, sampleRate, true);
  view.setUint32(16, topology, true);
  view.setUint32(20, matrixPaths.length, true);

  let offset = IR_ASSET_HEADER_BYTES;
  for (const path of matrixPaths) {
    view.setUint32(offset, path.inputSlot, true);
    view.setUint32(offset + 4, path.outputSlot, true);
    view.setUint32(offset + 8, path.irChannel, true);
    offset += MATRIX_PATH_BYTES;
  }
  for (const channel of channels) {
    for (const sample of channel) {
      view.setFloat32(offset, sample, true);
      offset += Float32Array.BYTES_PER_ELEMENT;
    }
  }

  return payload;
}
