import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MPEG1_BITRATES = Object.freeze([
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0
]);
const MPEG2_BITRATES = Object.freeze([
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0
]);

// The fixed production fixtures use table 15 and the two escape-table families.
// These are independent Annex B code lengths; sign and linbits follow the codeword.
const HUFFMAN15_CODE_LENGTHS = Object.freeze([
  3,4,5,7,7,8,9,9,9,10,10,11,11,11,12,13,4,3,5,6,7,7,8,8,8,9,9,10,10,10,11,11,
  5,5,5,6,7,7,8,8,8,9,9,10,10,11,11,11,6,6,6,7,7,8,8,9,9,9,10,10,10,11,11,11,
  7,6,7,7,8,8,9,9,9,9,10,10,10,11,11,11,8,7,7,8,8,8,9,9,9,9,10,10,11,11,11,12,
  9,7,8,8,8,9,9,9,9,10,10,10,11,11,12,12,9,8,8,9,9,9,9,10,10,10,10,10,11,11,11,12,
  9,8,8,9,9,9,9,10,10,10,10,11,11,12,12,12,9,8,9,9,9,9,10,10,10,11,11,11,11,12,12,12,
  10,9,9,9,10,10,10,10,10,11,11,11,11,12,13,12,10,9,9,9,10,10,10,10,11,11,11,11,12,12,12,13,
  11,10,9,10,10,10,11,11,11,11,11,11,12,12,13,13,11,10,10,10,10,11,11,11,11,12,12,12,12,12,13,13,
  12,11,11,11,11,11,11,11,12,12,12,12,13,13,12,13,12,11,11,11,11,11,11,12,12,12,12,12,13,13,13,13
]);

const HUFFMAN15_CODES = Object.freeze([
  7, 12, 18, 53, 47, 76, 124, 108, 89, 123, 108, 119, 107, 81, 122, 63,
  13, 5, 16, 27, 46, 36, 61, 51, 42, 70, 52, 83, 65, 41, 59, 36,
  19, 17, 15, 24, 41, 34, 59, 48, 40, 64, 50, 78, 62, 80, 56, 33,
  29, 28, 25, 43, 39, 63, 55, 93, 76, 59, 93, 72, 54, 75, 50, 29,
  52, 22, 42, 40, 67, 57, 95, 79, 72, 57, 89, 69, 49, 66, 46, 27,
  77, 37, 35, 66, 58, 52, 91, 74, 62, 48, 79, 63, 90, 62, 40, 38,
  125, 32, 60, 56, 50, 92, 78, 65, 55, 87, 71, 51, 73, 51, 70, 30,
  109, 53, 49, 94, 88, 75, 66, 122, 91, 73, 56, 42, 64, 44, 21, 25,
  90, 43, 41, 77, 73, 63, 56, 92, 77, 66, 47, 67, 48, 53, 36, 20,
  71, 34, 67, 60, 58, 49, 88, 76, 67, 106, 71, 54, 38, 39, 23, 15,
  109, 53, 51, 47, 90, 82, 58, 57, 48, 72, 57, 41, 23, 27, 62, 9,
  86, 42, 40, 37, 70, 64, 52, 43, 70, 55, 42, 25, 29, 18, 11, 11,
  118, 68, 30, 55, 50, 46, 74, 65, 49, 39, 24, 16, 22, 13, 14, 7,
  91, 44, 39, 38, 34, 63, 52, 45, 31, 52, 28, 19, 14, 8, 9, 3,
  123, 60, 58, 53, 47, 43, 32, 22, 37, 24, 17, 12, 15, 10, 2, 1,
  71, 37, 34, 30, 28, 20, 17, 26, 21, 16, 10, 6, 8, 6, 2, 0,
]);

const HUFFMAN16_CODES = Object.freeze([
  1, 5, 14, 44, 74, 63, 110, 93, 172, 149, 138, 242, 225, 195, 376, 17,
  3, 4, 12, 20, 35, 62, 53, 47, 83, 75, 68, 119, 201, 107, 207, 9,
  15, 13, 23, 38, 67, 58, 103, 90, 161, 72, 127, 117, 110, 209, 206, 16,
  45, 21, 39, 69, 64, 114, 99, 87, 158, 140, 252, 212, 199, 387, 365, 26,
  75, 36, 68, 65, 115, 101, 179, 164, 155, 264, 246, 226, 395, 382, 362, 9,
  66, 30, 59, 56, 102, 185, 173, 265, 142, 253, 232, 400, 388, 378, 445, 16,
  111, 54, 52, 100, 184, 178, 160, 133, 257, 244, 228, 217, 385, 366, 715, 10,
  98, 48, 91, 88, 165, 157, 148, 261, 248, 407, 397, 372, 380, 889, 884, 8,
  85, 84, 81, 159, 156, 143, 260, 249, 427, 401, 392, 383, 727, 713, 708, 7,
  154, 76, 73, 141, 131, 256, 245, 426, 406, 394, 384, 735, 359, 710, 352, 11,
  139, 129, 67, 125, 247, 233, 229, 219, 393, 743, 737, 720, 885, 882, 439, 4,
  243, 120, 118, 115, 227, 223, 396, 746, 742, 736, 721, 712, 706, 223, 436, 6,
  202, 224, 222, 218, 216, 389, 386, 381, 364, 888, 443, 707, 440, 437, 1728, 4,
  747, 211, 210, 208, 370, 379, 734, 723, 714, 1735, 883, 877, 876, 3459, 865, 2,
  377, 369, 102, 187, 726, 722, 358, 711, 709, 866, 1734, 871, 3458, 870, 434, 0,
  12, 10, 7, 11, 10, 17, 11, 9, 13, 12, 10, 7, 5, 3, 1, 3,
]);

const HUFFMAN24_CODES = Object.freeze([
  15, 13, 46, 80, 146, 262, 248, 434, 426, 669, 653, 649, 621, 517, 1032, 88,
  14, 12, 21, 38, 71, 130, 122, 216, 209, 198, 327, 345, 319, 297, 279, 42,
  47, 22, 41, 74, 68, 128, 120, 221, 207, 194, 182, 340, 315, 295, 541, 18,
  81, 39, 75, 70, 134, 125, 116, 220, 204, 190, 178, 325, 311, 293, 271, 16,
  147, 72, 69, 135, 127, 118, 112, 210, 200, 188, 352, 323, 306, 285, 540, 14,
  263, 66, 129, 126, 119, 114, 214, 202, 192, 180, 341, 317, 301, 281, 262, 12,
  249, 123, 121, 117, 113, 215, 206, 195, 185, 347, 330, 308, 291, 272, 520, 10,
  435, 115, 111, 109, 211, 203, 196, 187, 353, 332, 313, 298, 283, 531, 381, 17,
  427, 212, 208, 205, 201, 193, 186, 177, 169, 320, 303, 286, 268, 514, 377, 16,
  335, 199, 197, 191, 189, 181, 174, 333, 321, 305, 289, 275, 521, 379, 371, 11,
  668, 184, 183, 179, 175, 344, 331, 314, 304, 290, 277, 530, 383, 373, 366, 10,
  652, 346, 171, 168, 164, 318, 309, 299, 287, 276, 263, 513, 375, 368, 362, 6,
  648, 322, 316, 312, 307, 302, 292, 284, 269, 261, 512, 376, 370, 364, 359, 4,
  620, 300, 296, 294, 288, 282, 273, 266, 515, 380, 374, 369, 365, 361, 357, 2,
  1033, 280, 278, 274, 267, 264, 259, 382, 378, 372, 367, 363, 360, 358, 356, 0,
  43, 20, 19, 17, 15, 13, 11, 9, 7, 6, 4, 7, 5, 3, 1, 3,
]);
const HUFFMAN16_CODE_LENGTHS = Object.freeze([
  1,4,6,8,9,9,10,10,11,11,11,12,12,12,13,9,3,4,6,7,8,9,9,9,10,10,10,11,12,11,12,8,
  6,6,7,8,9,9,10,10,11,10,11,11,11,12,12,9,8,7,8,9,9,10,10,10,11,11,12,12,12,13,13,10,
  9,8,9,9,10,10,11,11,11,12,12,12,13,13,13,9,9,8,9,9,10,11,11,12,11,12,12,13,13,13,14,10,
  10,9,9,10,11,11,11,11,12,12,12,12,13,13,14,10,10,9,10,10,11,11,11,12,12,13,13,13,13,15,15,10,
  10,10,10,11,11,11,12,12,13,13,13,13,14,14,14,10,11,10,10,11,11,12,12,13,13,13,13,14,13,14,13,11,
  11,11,10,11,12,12,12,12,13,14,14,14,15,15,14,10,12,11,11,11,12,12,13,14,14,14,14,14,14,13,14,11,
  12,12,12,12,12,13,13,13,13,15,14,14,14,14,16,11,14,12,12,12,13,13,14,14,14,16,15,15,15,17,15,11,
  13,13,11,12,14,14,13,14,14,15,16,15,17,15,14,11,9,8,8,9,9,10,10,10,11,11,11,11,11,11,11,8
]);
const HUFFMAN24_CODE_LENGTHS = Object.freeze([
  4,4,6,7,8,9,9,10,10,11,11,11,11,11,12,9,4,4,5,6,7,8,8,9,9,9,10,10,10,10,10,8,
  6,5,6,7,7,8,8,9,9,9,9,10,10,10,11,7,7,6,7,7,8,8,8,9,9,9,9,10,10,10,10,7,
  8,7,7,8,8,8,8,9,9,9,10,10,10,10,11,7,9,7,8,8,8,8,9,9,9,9,10,10,10,10,10,7,
  9,8,8,8,8,9,9,9,9,10,10,10,10,10,11,7,10,8,8,8,9,9,9,9,10,10,10,10,10,11,11,8,
  10,9,9,9,9,9,9,9,9,10,10,10,10,11,11,8,10,9,9,9,9,9,9,10,10,10,10,10,11,11,11,8,
  11,9,9,9,9,10,10,10,10,10,10,11,11,11,11,8,11,10,9,9,9,10,10,10,10,10,10,11,11,11,11,8,
  11,10,10,10,10,10,10,10,10,10,11,11,11,11,11,8,11,10,10,10,10,10,10,10,11,11,11,11,11,11,11,8,
  12,10,10,10,10,10,10,11,11,11,11,11,11,11,11,8,8,7,7,7,7,7,7,7,7,7,7,8,8,8,8,4
]);
const HUFFMAN_LINBITS = Object.freeze({
  16: 1, 17: 2, 18: 3, 19: 4, 20: 6, 21: 8, 22: 10, 23: 13,
  24: 4, 25: 5, 26: 6, 27: 7, 28: 8, 29: 9, 30: 11, 31: 13
});
const HUFFMAN_SMALL_CODE_LENGTHS = Object.freeze({
  1: Object.freeze([1, 3, 2, 3]),
  2: Object.freeze([1, 3, 6, 3, 3, 5, 5, 5, 6]),
  3: Object.freeze([2, 2, 6, 3, 2, 5, 5, 5, 6])
});
const HUFFMAN_SMALL_CODES = Object.freeze({
  1: Object.freeze([1, 1, 1, 0]),
  2: Object.freeze([1, 2, 1, 3, 1, 1, 3, 2, 0]),
  3: Object.freeze([3, 2, 1, 1, 1, 1, 3, 2, 0])
});
const COUNT1_TOTAL_LENGTHS = Object.freeze([
  Object.freeze([1,5,5,7,5,8,7,9,5,7,7,9,7,9,9,10]),
  Object.freeze([4,5,5,6,5,6,6,7,5,6,6,7,6,7,7,8])
]);
const COUNT1_CODES = Object.freeze([
  Object.freeze([1, 5, 4, 5, 6, 5, 4, 4, 7, 3, 6, 0, 7, 2, 3, 1]),
  Object.freeze([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
]);
const LONG_BOUNDARIES = Object.freeze({
  mpeg1: Object.freeze([0,4,8,12,16,20,24,30,36,44,52,62,74,90,110,134,162,196,238,288,342,418,576]),
  mpeg2: Object.freeze([0,6,12,18,24,30,36,44,54,66,80,96,116,140,168,200,238,284,336,396,464,522,576])
});

export const MP3_CONFORMANCE_FIXTURES = Object.freeze([
  Object.freeze({ id: 'mpeg1-mono-reservoir-off', profile: 'mpeg1', bitrateKbps: 32,
    channels: 1, jointStereo: false, reservoir: false }),
  Object.freeze({ id: 'mpeg1-joint-reservoir-on', profile: 'mpeg1', bitrateKbps: 64,
    channels: 2, jointStereo: true, reservoir: true }),
  Object.freeze({ id: 'mpeg2-mono-reservoir-on', profile: 'mpeg2', bitrateKbps: 32,
    channels: 1, jointStereo: false, reservoir: true }),
  Object.freeze({ id: 'mpeg2-stereo-reservoir-off', profile: 'mpeg2', bitrateKbps: 64,
    channels: 2, jointStereo: false, reservoir: false })
]);

export const MP3_CONFORMANCE_PROVENANCE = Object.freeze({
  formatVersion: 4,
  fixtureOrigin: 'immutable-native-production-logical-frame-v4',
  syntaxReference: 'ISO/IEC 11172-3:1993 and ISO/IEC 13818-3:1998 Layer III',
  redistributedExternalBytes: false,
  independentDecoderEnvironment: 'EFFETUNE_MP3_DECODER'
});

export const MP3_SYNTHESIS_PCM_CONVENTION = Object.freeze({
  knownDecoderDelaySamples: 0,
  // The production IMDCT normalizes each synthesis by 1/9 (the TDAC unity factor
  // for its plain cos-sum kernels), while the ISO decoder IMDCT is an
  // unnormalized cos sum, so the independent decoder output is 9x the
  // production PCM.
  independentDecoderGain: 9
});

export function defaultMp3ProductionDiagnosticPath(repoRoot) {
  const executable = process.platform === 'win32'
    ? 'effetune_dsp_mp3_codec_simulator_tests.exe'
    : 'effetune_dsp_mp3_codec_simulator_tests';
  return path.join(repoRoot, 'out', 'dsp', 'native', executable);
}

function parseProductionDiagnosticBytes(bytes) {
  let offset = 0;
  const requireBytes = count => {
    if (offset + count > bytes.byteLength) {
      throw new Error('Truncated MP3 production diagnostic');
    }
  };
  const u32 = () => {
    requireBytes(4);
    const value = bytes.readUInt32LE(offset);
    offset += 4;
    return value;
  };
  const i32 = () => {
    requireBytes(4);
    const value = bytes.readInt32LE(offset);
    offset += 4;
    return value;
  };
  const f32 = () => {
    requireBytes(4);
    const value = bytes.readFloatLE(offset);
    offset += 4;
    if (!Number.isFinite(value)) throw new Error('Non-finite production diagnostic PCM');
    return value;
  };
  requireBytes(8);
  if (bytes.subarray(0, 7).toString('ascii') !== 'ETMP3D2') {
    throw new Error('Invalid MP3 production diagnostic signature');
  }
  offset = 8;
  const version = u32();
  const frameCount = u32();
  const profile = u32() === 1 ? 'mpeg1' : 'mpeg2';
  const channels = u32();
  const sampleRate = u32();
  if (version !== 2 || frameCount !== 4 || (channels !== 1 && channels !== 2)) {
    throw new Error('Unsupported MP3 production diagnostic layout');
  }
  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const frameSamples = u32();
    const bitrateKbps = u32();
    const granules = u32();
    const frameChannels = u32();
    const midSide = u32() !== 0;
    requireBytes(8);
    const scfsi = [...bytes.subarray(offset, offset + 8)];
    offset += 8;
    const budgetNames = ['frameBytes', 'paddingSlotBytes', 'headerBits', 'crcBits',
      'sideInfoBits', 'physicalMainDataAreaBits', 'logicalAduBits', 'mainDataBegin',
      'reservoirBeforeBits', 'reservoirAfterBits', 'ancillaryBits', 'valid'];
    const budget = Object.fromEntries(budgetNames.map(name => [name, u32()]));
    budget.valid = budget.valid !== 0;
    const logicalChannels = [];
    for (let index = 0; index < granules * frameChannels; index++) {
      const values = new Array(21);
      for (let field = 0; field < values.length; field++) values[field] = u32();
      requireBytes(39);
      const scalefactors = [...bytes.subarray(offset, offset + 39)];
      offset += 39;
      const quantized = new Int32Array(576);
      for (let line = 0; line < quantized.length; line++) quantized[line] = i32();
      logicalChannels.push({ blockType: values[0], mixedBlock: values[1] !== 0,
        globalGain: values[2], scalefacCompress: values[3], scalefactorCount: values[4],
        part2Length: values[5], part3Length: values[6], subblockGain: values.slice(7, 10),
        tableSelect: values.slice(10, 13), boundaryLines: values.slice(13, 15),
        count1TableSelect: values[15], bigValues: values[16], count1: values[17],
        bigValueBits: values[18], count1Bits: values[19], huffmanBits: values[20],
        scalefactors, quantized });
    }
    const decodedPcm = new Float32Array(frameSamples * frameChannels);
    for (let channel = 0; channel < frameChannels; channel++) {
      for (let sample = 0; sample < frameSamples; sample++) {
        decodedPcm[sample * frameChannels + channel] = f32();
      }
    }
    frames.push({ profile, channels: frameChannels, sampleRate, frameSamples, bitrateKbps,
      granules, midSide, scfsi, budget, logicalChannels, decodedPcm });
  }
  if (offset !== bytes.byteLength) throw new Error('Trailing MP3 production diagnostic data');
  return { version, profile, channels, sampleRate, frames };
}

function spawnDiagnostic(executable, fixtureId, outputPath, repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--production-diagnostic', fixtureId, outputPath], {
      cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`MP3 production diagnostic exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export async function readMp3ProductionDiagnostic(spec, runnerPath, repoRoot = process.cwd()) {
  const executable = path.resolve(repoRoot,
    runnerPath ?? defaultMp3ProductionDiagnosticPath(repoRoot));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-mp3-production-diagnostic-'));
  const outputPath = path.join(tempDir, 'logical.bin');
  try {
    await spawnDiagnostic(executable, spec.id, outputPath, repoRoot);
    const diagnostic = parseProductionDiagnosticBytes(await fs.readFile(outputPath));
    if (diagnostic.profile !== spec.profile || diagnostic.channels !== spec.channels ||
        diagnostic.frames.some(frame => frame.bitrateKbps !== spec.bitrateKbps)) {
      throw new Error(`MP3 production diagnostic ${spec.id} does not match its requested syntax family`);
    }
    return diagnostic;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
}

function profileInfo(profile) {
  if (profile === 'mpeg1') {
    return { versionBits: 3, sampleRate: 44100, coefficient: 144, granules: 2,
      backPointerBits: 9, maximumBackPointer: 511, bitrates: MPEG1_BITRATES };
  }
  if (profile === 'mpeg2') {
    return { versionBits: 2, sampleRate: 22050, coefficient: 72, granules: 1,
      backPointerBits: 8, maximumBackPointer: 255, bitrates: MPEG2_BITRATES };
  }
  throw new Error(`Unsupported MP3 fixture profile ${profile}`);
}

function sideInfoBytes(profile, channels) {
  if (profile === 'mpeg1') return channels === 1 ? 17 : 32;
  return channels === 1 ? 9 : 17;
}

function writeBits(bytes, bitOffset, value, width) {
  for (let bit = width - 1; bit >= 0; bit--) {
    if (((value >>> bit) & 1) !== 0) {
      const offset = bitOffset + width - 1 - bit;
      bytes[offset >>> 3] |= 1 << (7 - (offset & 7));
    }
  }
}

function readBits(bytes, state, width) {
  let value = 0;
  for (let index = 0; index < width; index++) {
    if (state.bit >= bytes.byteLength * 8) throw new Error('Truncated MP3 bitstream');
    value = value * 2 + ((bytes[state.bit >>> 3] >>> (7 - (state.bit & 7))) & 1);
    state.bit++;
  }
  return value;
}

const huffmanCodebookCache = new Map();

function codeLengthsForTable(table) {
  if (HUFFMAN_SMALL_CODE_LENGTHS[table]) return HUFFMAN_SMALL_CODE_LENGTHS[table];
  if (table === 15) return HUFFMAN15_CODE_LENGTHS;
  if (table >= 16 && table <= 23) return HUFFMAN16_CODE_LENGTHS;
  if (table >= 24 && table <= 31) return HUFFMAN24_CODE_LENGTHS;
  throw new Error(`Unsupported production Huffman table ${table}`);
}

function codewordsForTable(table) {
  if (HUFFMAN_SMALL_CODES[table]) return HUFFMAN_SMALL_CODES[table];
  if (table === 15) return HUFFMAN15_CODES;
  if (table >= 16 && table <= 23) return HUFFMAN16_CODES;
  if (table >= 24 && table <= 31) return HUFFMAN24_CODES;
  return null;
}

function huffmanDimension(table) {
  if (table === 1) return 2;
  if (table === 2 || table === 3) return 3;
  return 16;
}

function reverseCanonicalCodebook(lengths) {
  const ordered = lengths.map((length, symbol) => ({ length, symbol }))
    .sort((first, second) => first.length - second.length || first.symbol - second.symbol);
  const bySymbol = new Array(lengths.length);
  const byPrefix = new Map();
  let code = 0;
  let previousLength = 0;
  let maximumLength = 0;
  for (const entry of ordered) {
    code *= 2 ** (entry.length - previousLength);
    const encoded = (2 ** entry.length - 1) - code;
    const record = { code: encoded, length: entry.length, symbol: entry.symbol };
    bySymbol[entry.symbol] = record;
    byPrefix.set(`${entry.length}:${encoded}`, entry.symbol);
    maximumLength = entry.length > maximumLength ? entry.length : maximumLength;
    code++;
    previousLength = entry.length;
  }
  if (code !== 2 ** previousLength) {
    throw new Error('MP3 Huffman code lengths do not form a complete prefix code');
  }
  return { bySymbol, byPrefix, maximumLength };
}

function explicitCodebook(lengths, codes) {
  if (lengths.length !== codes.length) {
    throw new Error('MP3 Huffman code and length table sizes differ');
  }
  const bySymbol = new Array(lengths.length);
  const byPrefix = new Map();
  let maximumLength = 0;
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol];
    const code = codes[symbol];
    if (!Number.isInteger(code) || code < 0 || code >= 2 ** length) {
      throw new Error(`Invalid MP3 Huffman code for symbol ${symbol}`);
    }
    const key = `${length}:${code}`;
    if (byPrefix.has(key)) throw new Error(`Duplicate MP3 Huffman code ${key}`);
    const record = { code, length, symbol };
    bySymbol[symbol] = record;
    byPrefix.set(key, symbol);
    maximumLength = length > maximumLength ? length : maximumLength;
  }
  return { bySymbol, byPrefix, maximumLength };
}

function huffmanCodebook(table) {
  if (!huffmanCodebookCache.has(table)) {
    const lengths = codeLengthsForTable(table);
    const codes = codewordsForTable(table);
    huffmanCodebookCache.set(table,
      codes === null ? reverseCanonicalCodebook(lengths) : explicitCodebook(lengths, codes));
  }
  return huffmanCodebookCache.get(table);
}

function count1Codebook(table) {
  const cacheKey = `count1:${table}`;
  if (!huffmanCodebookCache.has(cacheKey)) {
    const lengths = COUNT1_TOTAL_LENGTHS[table].map((length, pattern) => {
      let signs = 0;
      for (let mask = pattern; mask !== 0; mask >>>= 1) signs += mask & 1;
      return length - signs;
    });
    huffmanCodebookCache.set(cacheKey, explicitCodebook(lengths, COUNT1_CODES[table]));
  }
  return huffmanCodebookCache.get(cacheKey);
}

function writeCodeword(bytes, bitOffset, record) {
  writeBits(bytes, bitOffset, record.code, record.length);
  return bitOffset + record.length;
}

function readCodeword(reader, codebook) {
  let code = 0;
  for (let length = 1; length <= codebook.maximumLength; length++) {
    code = code * 2 + readBits(reader.bytes, reader.state, 1);
    const symbol = codebook.byPrefix.get(`${length}:${code}`);
    if (symbol !== undefined) return symbol;
  }
  throw new Error('Invalid MP3 Huffman codeword');
}

function writeHuffmanPair(bytes, bitOffset, table, first, second) {
  if (table === 0) {
    if (first !== 0 || second !== 0) throw new Error('Huffman table 0 received a non-zero pair');
    return bitOffset;
  }
  const linbits = HUFFMAN_LINBITS[table] ?? 0;
  const firstMagnitude = Math.abs(first);
  const secondMagnitude = Math.abs(second);
  const dimension = huffmanDimension(table);
  if ((dimension < 16 && (firstMagnitude >= dimension || secondMagnitude >= dimension))) {
    throw new Error(`MP3 Huffman table ${table} cannot encode this pair`);
  }
  const firstBase = firstMagnitude < 15 ? firstMagnitude : 15;
  const secondBase = secondMagnitude < 15 ? secondMagnitude : 15;
  let bit = writeCodeword(bytes, bitOffset,
    huffmanCodebook(table).bySymbol[firstBase * dimension + secondBase]);
  for (const [magnitude, value] of [[firstMagnitude, first], [secondMagnitude, second]]) {
    if (magnitude >= 15 && linbits !== 0) {
      if (magnitude - 15 >= 2 ** linbits) {
        throw new Error(`MP3 Huffman table ${table} cannot encode magnitude ${magnitude}`);
      }
      writeBits(bytes, bit, magnitude - 15, linbits);
      bit += linbits;
    } else if (magnitude > 15) {
      throw new Error(`MP3 Huffman table ${table} cannot encode magnitude ${magnitude}`);
    }
    if (magnitude !== 0) {
      writeBits(bytes, bit, value < 0 ? 1 : 0, 1);
      bit++;
    }
  }
  return bit;
}

function decodeHuffmanPair(reader, table) {
  if (table === 0) return [0, 0];
  const symbol = readCodeword(reader, huffmanCodebook(table));
  const dimension = huffmanDimension(table);
  const linbits = HUFFMAN_LINBITS[table] ?? 0;
  const values = [Math.floor(symbol / dimension), symbol % dimension];
  for (let index = 0; index < values.length; index++) {
    if (values[index] === 15 && linbits !== 0) {
      values[index] += readBits(reader.bytes, reader.state, linbits);
    }
    if (values[index] !== 0 && readBits(reader.bytes, reader.state, 1) !== 0) {
      values[index] = -values[index];
    }
  }
  return values;
}

function writeCount1(bytes, bitOffset, table, values) {
  let pattern = 0;
  for (const value of values) {
    if (Math.abs(value) > 1) throw new Error('MP3 count1 region contains a magnitude above one');
    pattern = pattern * 2 + (value !== 0 ? 1 : 0);
  }
  let bit = writeCodeword(bytes, bitOffset, count1Codebook(table).bySymbol[pattern]);
  for (const value of values) {
    if (value !== 0) {
      writeBits(bytes, bit, value < 0 ? 1 : 0, 1);
      bit++;
    }
  }
  return bit;
}

function decodeCount1(reader, table) {
  const pattern = readCodeword(reader, count1Codebook(table));
  const values = [];
  for (let shift = 3; shift >= 0; shift--) {
    if (((pattern >>> shift) & 1) === 0) {
      values.push(0);
    } else {
      values.push(readBits(reader.bytes, reader.state, 1) === 0 ? 1 : -1);
    }
  }
  return values;
}

function buildHeader(spec, padding, midSide) {
  const profile = profileInfo(spec.profile);
  const bitrateIndex = profile.bitrates.indexOf(spec.bitrateKbps);
  if (bitrateIndex <= 0 || bitrateIndex >= 15) {
    throw new Error(`Unsupported ${spec.profile} fixture bitrate ${spec.bitrateKbps}`);
  }
  const mode = spec.channels === 1 ? 3 : spec.jointStereo ? 1 : 0;
  const modeExtension = spec.jointStereo && midSide ? 2 : 0;
  return (0xffe00000 | (profile.versionBits << 19) | (1 << 17) | (1 << 16) |
    (bitrateIndex << 12) | (padding << 9) | (mode << 6) | (modeExtension << 4)) >>> 0;
}

function scaleFactorLayout(profile, blockType, scalefacCompress) {
  if (profile === 'mpeg1') {
    if (scalefacCompress !== 15) throw new Error('Unsupported MPEG-1 production scalefac_compress');
    return blockType === 2
      ? { slen: [4, 3], counts: [18, 18] }
      : { slen: [4, 3], counts: [11, 10] };
  }
  if (scalefacCompress >= 400) {
    throw new Error('Unsupported MPEG-2 LSF production scalefac_compress subset');
  }
  const upper = scalefacCompress >>> 4;
  const slen = [Math.floor(upper / 5), upper % 5,
    (scalefacCompress & 15) >>> 2, scalefacCompress & 3];
  return blockType === 2
    ? { slen, counts: [9, 9, 9, 9] }
    : { slen, counts: [6, 5, 5, 5] };
}

function writeGranuleChannelSide(side, state, logical, profile) {
  const part23Length = logical.part2Length + logical.part3Length;
  writeBits(side, state.bit, part23Length, 12); state.bit += 12;
  writeBits(side, state.bit, logical.bigValues, 9); state.bit += 9;
  writeBits(side, state.bit, logical.globalGain, 8); state.bit += 8;
  writeBits(side, state.bit, logical.scalefacCompress, profile === 'mpeg1' ? 4 : 9);
  state.bit += profile === 'mpeg1' ? 4 : 9;
  const switched = logical.blockType !== 0;
  writeBits(side, state.bit, switched ? 1 : 0, 1); state.bit += 1;
  if (switched) {
    writeBits(side, state.bit, logical.blockType, 2); state.bit += 2;
    writeBits(side, state.bit, logical.mixedBlock ? 1 : 0, 1); state.bit += 1;
    writeBits(side, state.bit, logical.tableSelect[0], 5); state.bit += 5;
    writeBits(side, state.bit, logical.tableSelect[1], 5); state.bit += 5;
    for (const gain of logical.subblockGain) {
      writeBits(side, state.bit, gain, 3); state.bit += 3;
    }
  } else {
    for (const table of logical.tableSelect) {
      writeBits(side, state.bit, table, 5); state.bit += 5;
    }
    const region0Count = 7;
    const region1Count = 6;
    writeBits(side, state.bit, region0Count, 4); state.bit += 4;
    writeBits(side, state.bit, region1Count, 3); state.bit += 3;
  }
  if (profile === 'mpeg1') state.bit += 1;
  state.bit += 1;
  writeBits(side, state.bit, logical.count1TableSelect, 1); state.bit += 1;
  return part23Length;
}

function writeProductionPart2(bytes, bitOffset, logical, profile, scfsi = []) {
  const layout = scaleFactorLayout(profile, logical.blockType, logical.scalefacCompress);
  let factor = 0;
  let bit = bitOffset;
  for (let group = 0; group < layout.counts.length; group++) {
    for (let index = 0; index < layout.counts[group] && factor < logical.scalefactorCount;
      index++, factor++) {
      const scfsiGroup = factor < 6 ? 0 : factor < 11 ? 1 : factor < 16 ? 2 : 3;
      if (profile === 'mpeg1' && logical.blockType === 0 && scfsi[scfsiGroup] === 1) continue;
      const width = layout.slen[group];
      if (logical.scalefactors[factor] >= 2 ** width) {
        throw new Error('Production MP3 scalefactor exceeds its syntax width');
      }
      writeBits(bytes, bit, logical.scalefactors[factor], width);
      bit += width;
    }
  }
  if (bit - bitOffset !== logical.part2Length) {
    throw new Error('Production MP3 part2 length disagrees with its scalefactor fields');
  }
  return bit;
}

function productionRegionPoints(logical) {
  const bigValuesEnd = logical.bigValues * 2;
  return logical.blockType === 0
    ? [0, logical.boundaryLines[0], logical.boundaryLines[1], bigValuesEnd]
    : [0, logical.boundaryLines[0], bigValuesEnd];
}

function writeProductionPart3(bytes, bitOffset, logical) {
  const start = bitOffset;
  const points = productionRegionPoints(logical);
  let bigValueBits = 0;
  for (let region = 0; region + 1 < points.length; region++) {
    const before = bitOffset;
    for (let line = points[region]; line < points[region + 1]; line += 2) {
      bitOffset = writeHuffmanPair(bytes, bitOffset, logical.tableSelect[region],
        logical.quantized[line], logical.quantized[line + 1]);
    }
    bigValueBits += bitOffset - before;
  }
  const count1Start = bitOffset;
  const count1End = logical.bigValues * 2 + logical.count1 * 4;
  for (let line = logical.bigValues * 2; line < count1End; line += 4) {
    bitOffset = writeCount1(bytes, bitOffset, logical.count1TableSelect,
      [...logical.quantized.slice(line, line + 4)]);
  }
  if (bigValueBits !== logical.bigValueBits || bitOffset - count1Start !== logical.count1Bits ||
      bitOffset - start !== logical.part3Length || logical.huffmanBits !== logical.part3Length) {
    throw new Error('Production MP3 Huffman fields disagree with the packed syntax bits');
  }
  return bitOffset;
}

export function generateMp3ConformanceFixture(spec, productionDiagnostic) {
  if (!productionDiagnostic || productionDiagnostic.frames?.length !== 4) {
    throw new Error('MP3 conformance packing requires four frames from the production native diagnostic');
  }
  if (spec.channels !== 1 && spec.channels !== 2) {
    throw new Error(`Unsupported MP3 fixture channel count ${spec.channels}`);
  }
  const profile = profileInfo(spec.profile);
  let mainStreamOffset = 0;
  const frames = [];
  const chunks = [];
  const mainChunks = [];
  for (const productionFrame of productionDiagnostic.frames) {
    const padding = productionFrame.budget.paddingSlotBytes;
    const frameBytes = productionFrame.budget.frameBytes;
    const sideBytes = sideInfoBytes(spec.profile, spec.channels);
    const mainDataBytes = frameBytes - 4 - sideBytes;
    if (mainDataBytes <= 0) throw new Error(`MP3 fixture ${spec.id} has no main-data area`);
    const mainDataBegin = productionFrame.budget.mainDataBegin;
    const frame = new Uint8Array(frameBytes);
    const header = buildHeader(spec, padding, productionFrame.midSide);
    frame[0] = header >>> 24;
    frame[1] = header >>> 16;
    frame[2] = header >>> 8;
    frame[3] = header;
    const side = frame.subarray(4, 4 + sideBytes);
    const state = { bit: 0 };
    writeBits(side, state.bit, mainDataBegin, profile.backPointerBits);
    state.bit += profile.backPointerBits;
    state.bit += spec.profile === 'mpeg1' ? (spec.channels === 1 ? 5 : 3) : spec.channels;
    if (spec.profile === 'mpeg1') {
      for (let channel = 0; channel < spec.channels; channel++) {
        for (let group = 0; group < 4; group++) {
          writeBits(side, state.bit, productionFrame.scfsi[channel * 4 + group], 1);
          state.bit++;
        }
      }
    }
    const logicalChannels = productionFrame.logicalChannels;
    const part23Lengths = [];
    for (const logical of logicalChannels) {
      part23Lengths.push(writeGranuleChannelSide(side, state, logical, spec.profile));
    }
    if (state.bit !== sideBytes * 8) throw new Error('MP3 side-information width mismatch');
    const logicalAduBits = part23Lengths.reduce((total, value) => total + value, 0);
    const reservoirBeforeBits = productionFrame.budget.reservoirBeforeBits;
    const reservoirAfterBits = productionFrame.budget.reservoirAfterBits;
    frames.push({ frameBytes, paddingSlotBytes: padding, sideInfoBytes: sideBytes,
      physicalMainDataAreaBits: mainDataBytes * 8, logicalAduBits, mainDataBegin,
      reservoirBeforeBits, reservoirAfterBits,
      ancillaryBits: productionFrame.budget.ancillaryBits,
      mainStreamOffset, midSide: productionFrame.midSide, scfsi: productionFrame.scfsi,
      logicalChannels, productionDecodedPcm: productionFrame.decodedPcm });
    chunks.push(frame);
    mainChunks.push(new Uint8Array(mainDataBytes));
    mainStreamOffset += mainDataBytes;
  }

  const mainStream = new Uint8Array(mainStreamOffset);
  for (const frame of frames) {
    let bit = (frame.mainStreamOffset - frame.mainDataBegin) * 8;
    for (let index = 0; index < frame.logicalChannels.length; index++) {
      const logical = frame.logicalChannels[index];
      const granule = Math.floor(index / spec.channels);
      const channel = index % spec.channels;
      const scfsi = spec.profile === 'mpeg1' && granule === 1
        ? frame.scfsi.slice(channel * 4, channel * 4 + 4) : [];
      bit = writeProductionPart2(mainStream, bit, logical, spec.profile, scfsi);
      bit = writeProductionPart3(mainStream, bit, logical);
    }
    const expectedEnd = (frame.mainStreamOffset - frame.mainDataBegin) * 8 + frame.logicalAduBits;
    if (bit !== expectedEnd) throw new Error('Packed MP3 logical ADU length mismatch');
  }
  let streamRead = 0;
  for (let index = 0; index < chunks.length; index++) {
    const frame = chunks[index];
    const main = mainChunks[index];
    main.set(mainStream.subarray(streamRead, streamRead + main.byteLength));
    frame.set(main, 4 + frames[index].sideInfoBytes);
    streamRead += main.byteLength;
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { id: spec.id, spec: { ...spec }, bytes, frames };
}

function parseGranuleChannel(reader, profile) {
  const part23Length = readBits(reader.bytes, reader.state, 12);
  const bigValues = readBits(reader.bytes, reader.state, 9);
  const globalGain = readBits(reader.bytes, reader.state, 8);
  const scalefacCompress = readBits(reader.bytes, reader.state, profile === 'mpeg1' ? 4 : 9);
  const switched = readBits(reader.bytes, reader.state, 1);
  let blockType = 0;
  let mixedBlock = false;
  let tableSelect;
  let region0Count;
  let region1Count;
  let subblockGain = [0, 0, 0];
  if (switched !== 0) {
    blockType = readBits(reader.bytes, reader.state, 2);
    mixedBlock = readBits(reader.bytes, reader.state, 1) !== 0;
    tableSelect = [readBits(reader.bytes, reader.state, 5),
      readBits(reader.bytes, reader.state, 5), 0];
    subblockGain = [readBits(reader.bytes, reader.state, 3),
      readBits(reader.bytes, reader.state, 3), readBits(reader.bytes, reader.state, 3)];
    region0Count = blockType === 2 && !mixedBlock ? 8 : 7;
    region1Count = 20 - region0Count;
  } else {
    tableSelect = [readBits(reader.bytes, reader.state, 5),
      readBits(reader.bytes, reader.state, 5), readBits(reader.bytes, reader.state, 5)];
    region0Count = readBits(reader.bytes, reader.state, 4);
    region1Count = readBits(reader.bytes, reader.state, 3);
  }
  const preflag = profile === 'mpeg1' ? readBits(reader.bytes, reader.state, 1) : 0;
  const scalefacScale = readBits(reader.bytes, reader.state, 1);
  const count1TableSelect = readBits(reader.bytes, reader.state, 1);
  return { part23Length, bigValues, globalGain, scalefacCompress, switched, blockType,
    mixedBlock, subblockGain, tableSelect, region0Count, region1Count, preflag, scalefacScale,
    count1TableSelect };
}

export function parseMp3ConformanceFixture(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('MP3 fixture must be a Uint8Array');
  const frames = [];
  const mainChunks = [];
  let offset = 0;
  let precedingMainDataBytes = 0;
  let mainStreamOffset = 0;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 4) throw new Error('Truncated MP3 frame header');
    const header = (bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    if (((header & 0xffe00000) >>> 0) !== 0xffe00000) throw new Error('Invalid MP3 frame sync');
    const versionBits = (header >>> 19) & 3;
    const profileName = versionBits === 3 ? 'mpeg1' : versionBits === 2 ? 'mpeg2' : null;
    if (!profileName || ((header >>> 17) & 3) !== 1 || ((header >>> 16) & 1) !== 1) {
      throw new Error('Fixture is not an MPEG-1/2 Layer III frame without CRC');
    }
    const profile = profileInfo(profileName);
    const bitrateKbps = profile.bitrates[(header >>> 12) & 15];
    if (bitrateKbps === 0 || ((header >>> 10) & 3) !== 0) {
      throw new Error('Unsupported MP3 fixture bitrate or sample-rate index');
    }
    const paddingSlotBytes = (header >>> 9) & 1;
    const mode = (header >>> 6) & 3;
    const channels = mode === 3 ? 1 : 2;
    const frameBytes = Math.floor(
      profile.coefficient * bitrateKbps * 1000 / profile.sampleRate
    ) + paddingSlotBytes;
    if (offset + frameBytes > bytes.byteLength) throw new Error('Truncated MP3 frame payload');
    const sideBytes = sideInfoBytes(profileName, channels);
    const side = bytes.subarray(offset + 4, offset + 4 + sideBytes);
    const state = { bit: 0 };
    const mainDataBegin = readBits(side, state, profile.backPointerBits);
    readBits(side, state, profileName === 'mpeg1' ? (channels === 1 ? 5 : 3) : channels);
    const scfsi = [];
    if (profileName === 'mpeg1') {
      for (let index = 0; index < channels * 4; index++) {
        scfsi.push(readBits(side, state, 1));
      }
    }
    const granuleChannels = [];
    const reader = { bytes: side, state };
    for (let granule = 0; granule < profile.granules; granule++) {
      for (let channel = 0; channel < channels; channel++) {
        granuleChannels.push(parseGranuleChannel(reader, profileName));
      }
    }
    if (state.bit !== sideBytes * 8) throw new Error('MP3 side-information width mismatch');
    const mainDataBytes = frameBytes - 4 - sideBytes;
    if (mainDataBegin > precedingMainDataBytes || mainDataBegin > profile.maximumBackPointer) {
      throw new Error('MP3 reservoir back-pointer exceeds available prior main data');
    }
    const part23Lengths = granuleChannels.map(channel => channel.part23Length);
    frames.push({ profile: profileName, bitrateKbps, channels, jointStereo: mode === 1,
      midSide: mode === 1 && ((header >>> 4) & 2) !== 0, frameBytes, paddingSlotBytes,
      sideInfoBytes: sideBytes, physicalMainDataAreaBits: mainDataBytes * 8,
      mainDataBegin, scfsi, part23Lengths, granuleChannels, pcmSamples: profile.granules * 576,
      mainStreamOffset });
    mainChunks.push(bytes.slice(offset + 4 + sideBytes, offset + frameBytes));
    precedingMainDataBytes += mainDataBytes;
    mainStreamOffset += mainDataBytes;
    offset += frameBytes;
  }
  const mainData = new Uint8Array(mainStreamOffset);
  let mainOffset = 0;
  for (const chunk of mainChunks) {
    mainData.set(chunk, mainOffset);
    mainOffset += chunk.byteLength;
  }
  Object.defineProperty(frames, 'mainData', { value: mainData });
  return frames;
}

function decodedRegionPoints(frame, side) {
  const bigValuesEnd = side.bigValues * 2;
  if (side.switched !== 0) {
    const firstBoundary = side.blockType === 2 ? 36
      : LONG_BOUNDARIES[frame.profile][side.region0Count + 1];
    return [0, firstBoundary < bigValuesEnd ? firstBoundary : bigValuesEnd, bigValuesEnd];
  }
  const boundaries = LONG_BOUNDARIES[frame.profile];
  const firstBoundary = boundaries[side.region0Count + 1];
  const secondBoundary = boundaries[side.region0Count + side.region1Count + 2];
  return [0, firstBoundary < bigValuesEnd ? firstBoundary : bigValuesEnd,
    secondBoundary < bigValuesEnd ? secondBoundary : bigValuesEnd, bigValuesEnd];
}

export function decodeMp3LogicalFixture(bytes) {
  const frames = parseMp3ConformanceFixture(bytes);
  const channels = frames[0]?.channels ?? 0;
  const reservoirEnabled = frames.some(frame => frame.mainDataBegin !== 0);
  const logicalFrames = [];
  for (const frame of frames) {
    const state = { bit: (frame.mainStreamOffset - frame.mainDataBegin) * 8 };
    const reader = { bytes: frames.mainData, state };
    const logicalChannels = [];
    for (let index = 0; index < frame.granuleChannels.length; index++) {
      const side = frame.granuleChannels[index];
      const layout = scaleFactorLayout(frame.profile, side.blockType, side.scalefacCompress);
      const scalefactors = [];
      let part2Length = 0;
      const granule = Math.floor(index / frame.channels);
      const channel = index % frame.channels;
      let factorIndex = 0;
      for (let group = 0; group < layout.counts.length; group++) {
        for (let factor = 0; factor < layout.counts[group]; factor++) {
          const scfsiGroup = factorIndex < 6 ? 0 : factorIndex < 11 ? 1
            : factorIndex < 16 ? 2 : 3;
          const reused = frame.profile === 'mpeg1' && granule === 1 && side.blockType === 0 &&
            frame.scfsi[channel * 4 + scfsiGroup] === 1;
          if (reused) {
            scalefactors.push(logicalChannels[channel].scalefactors[factorIndex]);
          } else {
            scalefactors.push(readBits(reader.bytes, state, layout.slen[group]));
            part2Length += layout.slen[group];
          }
          factorIndex++;
        }
      }
      const part3Start = state.bit;
      const part23End = part3Start + side.part23Length - part2Length;
      const quantized = new Int32Array(576);
      const regionPoints = decodedRegionPoints(frame, side);
      let bigValueBits = 0;
      for (let region = 0; region + 1 < regionPoints.length; region++) {
        const regionStart = state.bit;
        for (let line = regionPoints[region]; line < regionPoints[region + 1]; line += 2) {
          const pair = decodeHuffmanPair(reader, side.tableSelect[region]);
          quantized[line] = pair[0];
          quantized[line + 1] = pair[1];
        }
        bigValueBits += state.bit - regionStart;
      }
      let count1 = 0;
      while (state.bit < part23End) {
        if (side.bigValues * 2 + (count1 + 1) * 4 > quantized.length) {
          throw new Error('MP3 count1 region exceeds the granule');
        }
        const values = decodeCount1(reader, side.count1TableSelect);
        quantized.set(values, side.bigValues * 2 + count1 * 4);
        count1++;
      }
      if (state.bit !== part23End || side.part23Length < part2Length) {
        throw new Error('Logical MP3 part2_3 length does not match packed fields');
      }
      const part3Length = state.bit - part3Start;
      logicalChannels.push({ ...side, boundaryLines: regionPoints.slice(1, 3),
        scalefactorCount: scalefactors.length, part2Length,
        part3Length, bigValueBits, count1Bits: part3Length - bigValueBits,
        huffmanBits: part3Length, count1, scalefactors, quantized });
    }
    const logicalAduBits = logicalChannels.reduce(
      (total, logical) => total + logical.part2Length + logical.part3Length, 0);
    const reservoirBeforeBits = frame.mainDataBegin * 8;
    const remaining = frame.physicalMainDataAreaBits + reservoirBeforeBits - logicalAduBits;
    if (remaining < 0) throw new Error('MP3 logical ADU exceeds physical data and reservoir');
    const maximumReservoirBits = profileInfo(frame.profile).maximumBackPointer * 8;
    const reservoirAfterBits = reservoirEnabled
      ? Math.min(remaining & ~7, maximumReservoirBits) : 0;
    logicalFrames.push({ ...frame, logicalAduBits, reservoirBeforeBits, reservoirAfterBits,
      ancillaryBits: remaining - reservoirAfterBits, logicalChannels });
  }
  return { channels, sampleRate: profileInfo(frames[0]?.profile).sampleRate,
    frames: logicalFrames };
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function assertArrayEqual(label, actual, expected) {
  assertEqual(`${label} length`, actual.length, expected.length);
  for (let index = 0; index < expected.length; index++) {
    assertEqual(`${label}[${index}]`, actual[index], expected[index]);
  }
}

export function assertMp3LogicalFieldsMatch(fixture, decoded) {
  assertEqual('MP3 parsed frame count', decoded.frames.length, fixture.frames.length);
  assertEqual('MP3 parsed channel count', decoded.channels, fixture.spec.channels);
  for (let frameIndex = 0; frameIndex < fixture.frames.length; frameIndex++) {
    const expectedFrame = fixture.frames[frameIndex];
    const actualFrame = decoded.frames[frameIndex];
    const prefix = `MP3 frame ${frameIndex}`;
    assertEqual(`${prefix} profile`, actualFrame.profile, fixture.spec.profile);
    assertEqual(`${prefix} bitrate`, actualFrame.bitrateKbps, fixture.spec.bitrateKbps);
    assertEqual(`${prefix} channels`, actualFrame.channels, fixture.spec.channels);
    assertEqual(`${prefix} padding`, actualFrame.paddingSlotBytes,
      expectedFrame.paddingSlotBytes);
    assertEqual(`${prefix} main_data_begin`, actualFrame.mainDataBegin,
      expectedFrame.mainDataBegin);
    assertEqual(`${prefix} physical main-data bits`, actualFrame.physicalMainDataAreaBits,
      expectedFrame.physicalMainDataAreaBits);
    assertEqual(`${prefix} logical ADU bits`, actualFrame.logicalAduBits,
      expectedFrame.logicalAduBits);
    assertEqual(`${prefix} reservoir before`, actualFrame.reservoirBeforeBits,
      expectedFrame.reservoirBeforeBits);
    assertEqual(`${prefix} reservoir after`, actualFrame.reservoirAfterBits,
      expectedFrame.reservoirAfterBits);
    assertEqual(`${prefix} ancillary bits`, actualFrame.ancillaryBits,
      expectedFrame.ancillaryBits);
    assertEqual(`${prefix} mid/side flag`, actualFrame.midSide, expectedFrame.midSide);
    if (fixture.spec.profile === 'mpeg1') {
      assertArrayEqual(`${prefix} scfsi`, actualFrame.scfsi,
        expectedFrame.scfsi.slice(0, fixture.spec.channels * 4));
    }
    assertEqual(`${prefix} granule/channel count`, actualFrame.logicalChannels.length,
      expectedFrame.logicalChannels.length);
    for (let index = 0; index < expectedFrame.logicalChannels.length; index++) {
      const expected = expectedFrame.logicalChannels[index];
      const actual = actualFrame.logicalChannels[index];
      const channelPrefix = `${prefix} logical channel ${index}`;
      for (const field of ['blockType', 'mixedBlock', 'globalGain', 'scalefacCompress',
        'scalefactorCount', 'part2Length', 'part3Length', 'bigValues', 'count1',
        'count1TableSelect', 'bigValueBits', 'count1Bits', 'huffmanBits']) {
        assertEqual(`${channelPrefix} ${field}`, actual[field], expected[field]);
      }
      assertEqual(`${channelPrefix} preflag`, actual.preflag, 0);
      assertEqual(`${channelPrefix} scalefac_scale`, actual.scalefacScale, 0);
      assertArrayEqual(`${channelPrefix} subblock_gain`, actual.subblockGain,
        expected.subblockGain);
      assertArrayEqual(`${channelPrefix} table_select`, actual.tableSelect,
        expected.tableSelect);
      assertArrayEqual(`${channelPrefix} region boundaries`, actual.boundaryLines,
        expected.boundaryLines);
      assertArrayEqual(`${channelPrefix} scalefactors`, actual.scalefactors,
        expected.scalefactors.slice(0, expected.scalefactorCount));
      const layout = scaleFactorLayout(actualFrame.profile, actual.blockType,
        actual.scalefacCompress);
      let factor = 0;
      for (let group = 0; group < layout.counts.length; group++) {
        for (let count = 0; count < layout.counts[group]; count++, factor++) {
          if (actual.scalefactors[factor] >= 2 ** layout.slen[group]) {
            throw new Error(`${channelPrefix} scalefactor ${factor} exceeds its field width`);
          }
        }
      }
      assertArrayEqual(`${channelPrefix} quantized spectrum`, [...actual.quantized],
        [...expected.quantized]);
    }
  }
  return true;
}

export function compareMp3DecoderToProductionPcm(fixture, decoded) {
  const channels = fixture.spec.channels;
  if (channels !== decoded.channels) {
    throw new Error(`Independent MP3 decoder channel mismatch: expected ${channels}, got ${decoded.channels}`);
  }
  const productionPcm = Float32Array.from(
    fixture.frames.flatMap(frame => [...frame.productionDecodedPcm])
  );
  const expectedPcmSamples = productionPcm.length / channels;
  const { knownDecoderDelaySamples, independentDecoderGain: synthesisGain } =
    MP3_SYNTHESIS_PCM_CONVENTION;
  if (decoded.pcmSamples !== expectedPcmSamples + knownDecoderDelaySamples) {
    throw new Error(
      `Independent MP3 decoder PCM length mismatch: expected ${expectedPcmSamples}, got ${decoded.pcmSamples}`
    );
  }
  let squaredError = 0;
  let maximumAbsoluteError = 0;
  for (let sample = 0; sample < expectedPcmSamples; sample++) {
    for (let channel = 0; channel < channels; channel++) {
      const expected = productionPcm[sample * channels + channel];
      const actual = decoded.pcm[(sample + knownDecoderDelaySamples) * channels + channel] /
        synthesisGain;
      const error = actual - expected;
      const magnitude = error < 0 ? -error : error;
      maximumAbsoluteError = magnitude > maximumAbsoluteError ? magnitude : maximumAbsoluteError;
      squaredError += error * error;
    }
  }
  const rmsError = Math.sqrt(squaredError / productionPcm.length);
  // The fixed delay-0/gain-9 comparison allows only the measured float-state residue of
  // consecutive short-block synthesis; it never searches for a better lag or scale. The
  // bounds are not a pure proportional rescale: they were recalibrated against the residue
  // measured after the unity-gain and resampler/window fixes (max 4.21e-6, rms 7.17e-7).
  // Doubling the production PCM level - the synthesis normalization moved from 1/18 to the
  // unity 1/9 - accounts for a factor of two; the remaining 1.25x is rounded-up headroom
  // above the measured residue, not a claim about how the error scales.
  if (maximumAbsoluteError > 5e-6 || rmsError > 1e-6) {
    throw new Error(
      `Independent MP3 decoder PCM differs from production synthesis: max ${maximumAbsoluteError}, rms ${rmsError}`
    );
  }
  return { expectedPcmSamples, decodedPcmSamples: decoded.pcmSamples,
    knownDecoderDelaySamples, synthesisGain, maximumAbsoluteError, rmsError };
}

export const compareMp3DecoderToLogicalPcm = compareMp3DecoderToProductionPcm;

export function verifyMp3FixtureWithDecoder(bytes, executable) {
  if (!executable) throw new Error('An independent MP3 decoder executable is required');
  const parsed = parseMp3ConformanceFixture(bytes);
  const channels = parsed[0]?.channels ?? 0;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      '-hide_banner', '-loglevel', 'error', '-f', 'mp3', '-i', 'pipe:0',
      '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    let stderr = '';
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Independent MP3 decoder exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      const pcmBytes = Buffer.concat(output);
      if (pcmBytes.byteLength === 0 || (pcmBytes.byteLength & 3) !== 0) {
        reject(new Error('Independent MP3 decoder returned no complete float32 PCM samples'));
        return;
      }
      const pcm = new Float32Array(pcmBytes.byteLength / 4);
      let maximumAbsoluteSample = 0;
      for (let offset = 0; offset < pcmBytes.byteLength; offset += 4) {
        const sample = pcmBytes.readFloatLE(offset);
        if (!Number.isFinite(sample)) {
          reject(new Error('Independent MP3 decoder returned non-finite PCM'));
          return;
        }
        pcm[offset / 4] = sample;
        const magnitude = sample < 0 ? -sample : sample;
        if (magnitude > maximumAbsoluteSample) maximumAbsoluteSample = magnitude;
      }
      resolve({ channels, pcm, pcmSamples: pcm.length / channels, maximumAbsoluteSample,
        diagnostics: stderr.trim() });
    });
    child.stdin.end(bytes);
  });
}
