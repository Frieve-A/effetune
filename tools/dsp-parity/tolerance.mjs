function finiteOrInfinity(value) {
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function comparePerSample(expected, actual, tolerance = {}) {
  if (!(expected instanceof Float32Array) || !(actual instanceof Float32Array)) {
    throw new TypeError('Per-sample comparison requires Float32Array inputs');
  }
  if (expected.length !== actual.length) {
    return {
      pass: false,
      policy: 'per-sample',
      reason: `length mismatch: expected ${expected.length}, actual ${actual.length}`,
      expectedLength: expected.length,
      actualLength: actual.length,
      firstOffendingIndex: Math.min(expected.length, actual.length)
    };
  }
  const absLimit = tolerance.abs ?? 0;
  const hasRelativeLimit = tolerance.rel !== undefined;
  const relLimit = tolerance.rel ?? Number.POSITIVE_INFINITY;
  if (absLimit < 0 || relLimit < 0) throw new Error('Tolerance limits must be non-negative');

  let maxAbsError = 0;
  let maxRelError = 0;
  let firstOffendingIndex = -1;
  let squaredError = 0;
  let failureCount = 0;
  for (let index = 0; index < expected.length; index++) {
    const expectedValue = expected[index];
    const actualValue = actual[index];
    const absError = finiteOrInfinity(Math.abs(actualValue - expectedValue));
    const relDenominator = Math.max(Math.abs(expectedValue), absLimit, Number.EPSILON);
    const relError = finiteOrInfinity(absError / relDenominator);
    if (absError > maxAbsError) maxAbsError = absError;
    if (relError > maxRelError) maxRelError = relError;
    squaredError += absError * absError;
    const failed = absError > absLimit || (hasRelativeLimit && relError > relLimit);
    if (failed) {
      failureCount++;
      if (firstOffendingIndex === -1) firstOffendingIndex = index;
    }
  }
  return {
    pass: failureCount === 0,
    policy: 'per-sample',
    absLimit,
    relLimit: hasRelativeLimit ? relLimit : null,
    maxAbsError,
    maxRelError,
    rmsError: Math.sqrt(squaredError / Math.max(1, expected.length)),
    firstOffendingIndex,
    failureCount,
    sampleCount: expected.length
  };
}

function largestPowerOfTwo(value) {
  if (value < 2) return 0;
  return 2 ** Math.floor(Math.log2(value));
}

function fft(real, imag) {
  const length = real.length;
  for (let index = 1, reversed = 0; index < length; index++) {
    let bit = length >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imag[index], imag[reversed]] = [imag[reversed], imag[index]];
    }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = -2 * Math.PI / size;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < length; start += size) {
      let twiddleReal = 1;
      let twiddleImag = 0;
      const half = size >> 1;
      for (let offset = 0; offset < half; offset++) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * twiddleReal - imag[odd] * twiddleImag;
        const oddImag = real[odd] * twiddleImag + imag[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextReal = twiddleReal * stepReal - twiddleImag * stepImag;
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}

function spectrumDb(values, offset, fftSize, floorDb) {
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  const scale = 2 / Math.max(1, fftSize - 1);
  for (let index = 0; index < fftSize; index++) {
    const window = 0.5 * (1 - Math.cos(2 * Math.PI * index / Math.max(1, fftSize - 1)));
    real[index] = values[offset + index] * window;
  }
  fft(real, imag);
  const bins = new Float64Array(fftSize / 2 + 1);
  for (let bin = 0; bin < bins.length; bin++) {
    const magnitude = Math.hypot(real[bin], imag[bin]) * scale;
    bins[bin] = Math.max(floorDb, 20 * Math.log10(Math.max(magnitude, 1e-24)));
  }
  return bins;
}

export function compareSpectral(expected, actual, tolerance = {}, shape = {}) {
  if (!(expected instanceof Float32Array) || !(actual instanceof Float32Array)) {
    throw new TypeError('Spectral comparison requires Float32Array inputs');
  }
  if (expected.length !== actual.length) {
    return {
      pass: false,
      policy: 'spectral',
      reason: `length mismatch: expected ${expected.length}, actual ${actual.length}`
    };
  }
  const channels = shape.channels ?? 1;
  if (!Number.isInteger(channels) || channels <= 0 || expected.length % channels !== 0) {
    throw new Error(`Invalid spectral channel count ${channels} for ${expected.length} samples`);
  }
  const frames = shape.frames ?? expected.length / channels;
  const requestedSize = tolerance.fftSize ?? 16384;
  const fftSize = largestPowerOfTwo(Math.min(frames, requestedSize));
  if (fftSize < 2) throw new Error('Spectral comparison needs at least two frames');
  const dbLimit = tolerance.db ?? tolerance.spectralDb ?? 1;
  const floorDb = tolerance.floorDb ?? -160;
  let maxDbError = 0;
  let squaredError = 0;
  let comparedBins = 0;
  let firstOffendingBin = -1;
  let firstOffendingChannel = -1;
  let failureCount = 0;
  for (let channel = 0; channel < channels; channel++) {
    const offset = channel * frames;
    const expectedDb = spectrumDb(expected, offset, fftSize, floorDb);
    const actualDb = spectrumDb(actual, offset, fftSize, floorDb);
    for (let bin = 0; bin < expectedDb.length; bin++) {
      const error = finiteOrInfinity(Math.abs(actualDb[bin] - expectedDb[bin]));
      if (error > maxDbError) maxDbError = error;
      squaredError += error * error;
      comparedBins++;
      if (error > dbLimit) {
        failureCount++;
        if (firstOffendingBin === -1) {
          firstOffendingBin = bin;
          firstOffendingChannel = channel;
        }
      }
    }
  }
  return {
    pass: failureCount === 0,
    policy: 'spectral',
    dbLimit,
    floorDb,
    fftSize,
    maxDbError,
    rmsDbError: Math.sqrt(squaredError / Math.max(1, comparedBins)),
    firstOffendingBin,
    firstOffendingChannel,
    failureCount,
    comparedBins
  };
}

export function compareAudio(expected, actual, tolerance = {}, shape = {}) {
  const policy = tolerance.policy ?? tolerance.parity ?? 'per-sample';
  if (policy === 'spectral') return compareSpectral(expected, actual, tolerance, shape);
  if (policy !== 'per-sample') throw new Error(`Unknown parity tolerance policy "${policy}"`);
  return comparePerSample(expected, actual, tolerance);
}

export function formatComparison(result) {
  if (result.policy === 'spectral') {
    return `max dB ${result.maxDbError?.toExponential(4) ?? 'n/a'}, ` +
      `RMS dB ${result.rmsDbError?.toExponential(4) ?? 'n/a'}, ` +
      `first bin ${result.firstOffendingBin ?? 'n/a'}`;
  }
  return `max abs ${result.maxAbsError?.toExponential(4) ?? 'n/a'}, ` +
    `max rel ${result.maxRelError?.toExponential(4) ?? 'n/a'}, ` +
    `RMS ${result.rmsError?.toExponential(4) ?? 'n/a'}, ` +
    `first sample ${result.firstOffendingIndex ?? 'n/a'}`;
}

