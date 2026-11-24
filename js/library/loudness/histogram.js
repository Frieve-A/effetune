const ABSOLUTE_GATE = -70;
const BINS_PER_LU = 100;
const BIN_COUNT = 10000;
const MAX_BLOCKS = 0xffffffff;

function binOf(lufs) {
  return Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((lufs - ABSOLUTE_GATE) * BINS_PER_LU)));
}

export function addLoudnessBlock(bins, lufs) {
  if (lufs < ABSOLUTE_GATE) return;
  const index = binOf(lufs);
  const bin = bins.get(index) ?? { count: 0, power: 0 };
  bin.count++;
  bin.power += 10 ** (lufs / 10);
  bins.set(index, bin);
}

// Store the unquantized power sum for the relative gate. Elias gamma codes
// compact the small deltas between occupied 0.01 LU bins and their counts.
export function encodeHistogram(bins) {
  if (!bins.size) return new Uint8Array();
  const bytes = Array(10).fill(0);
  let bit = 80;
  function write(value) {
    const digits = Math.floor(Math.log2(value));
    bit += digits;
    for (let i = digits; i >= 0; i--, bit++) {
      if ((value >>> i) & 1) bytes[bit >>> 3] |= 128 >>> (bit & 7);
    }
  }
  let previous = -1;
  let power = 0;
  for (const [index, bin] of [...bins].sort((a, b) => a[0] - b[0])) {
    write(index - previous);
    write(bin.count);
    power += bin.power;
    previous = index;
  }
  bytes.length = Math.ceil(bit / 8);
  const result = Uint8Array.from(bytes);
  const view = new DataView(result.buffer);
  view.setFloat64(0, power, true);
  view.setUint16(8, bins.size, true);
  return result;
}

function readHistogram(bytes, visit) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 11 || bytes.length > 50000) throw new RangeError('Invalid loudness histogram');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const power = view.getFloat64(0, true);
  const size = view.getUint16(8, true);
  if (!Number.isFinite(power) || power <= 0 || !size || size > BIN_COUNT) throw new RangeError('Invalid loudness histogram');
  let bit = 80;
  function readBit() {
    if (bit >= bytes.length * 8) throw new RangeError('Truncated loudness histogram');
    const result = bytes[bit >>> 3] & (128 >>> (bit & 7));
    bit++;
    return result ? 1 : 0;
  }
  function read() {
    let digits = 0;
    while (!readBit()) {
      if (++digits > 31) throw new RangeError('Invalid loudness block count');
    }
    let value = 1;
    for (let i = 0; i < digits; i++) value = value * 2 + readBit();
    return value;
  }
  let index = -1;
  let count = 0;
  for (let i = 0; i < size; i++) {
    index += read();
    const n = read();
    count += n;
    if (index >= BIN_COUNT || count > MAX_BLOCKS) throw new RangeError('Invalid loudness bin');
    visit?.(index, n);
  }
  if (Math.ceil(bit / 8) !== bytes.length || (bytes.at(-1) & ((1 << ((8 - bit % 8) % 8)) - 1))) {
    throw new RangeError('Invalid trailing histogram data');
  }
  return { power, count };
}

export function isValidLoudnessHistogram(bytes) {
  try { readHistogram(bytes); return true; }
  catch { return false; }
}

export function integratedFromHistograms(histograms) {
  const bins = new Map();
  let power = 0;
  let count = 0;
  for (const bytes of histograms) {
    if (!bytes.length) continue;
    const sum = readHistogram(bytes, (i, n) => bins.set(i, (bins.get(i) ?? 0) + n));
    power += sum.power;
    count += sum.count;
  }
  if (!count) return null;
  // The kernel includes the bin containing the relative gate. Subtract only
  // rejected bins using their midpoints; exact energy is retained for the
  // whole program, including samples in the saturating top bin.
  const gate = binOf(10 * Math.log10(power / count) - 10);
  for (const [index, n] of bins) {
    if (index >= gate) continue;
    power -= n * 10 ** ((ABSOLUTE_GATE + (index + 0.5) / BINS_PER_LU) / 10);
    count -= n;
  }
  return count ? 10 * Math.log10(power / count) : null;
}
