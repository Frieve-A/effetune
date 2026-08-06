import { createHash } from 'node:crypto';

export const FIR_COEFFICIENT_ENCODING = 'IEEE-754 binary64 little-endian';
export const FIR_DERIVATION =
  'Kaiser-windowed sinc, beta=16, normalized to unity DC gain';

function besselI0(value) {
  let sum = 1;
  let term = 1;
  const squaredQuarter = value * value * 0.25;
  for (let order = 1; order < 64; order++) {
    term *= squaredQuarter / (order * order);
    sum += term;
    if (term < sum * 1e-18) break;
  }
  return sum;
}

export function deriveFirCoefficients(config) {
  const beta = 16;
  const cutoff = config.firCutoffHz / config.internalRate;
  const center = (config.firLength - 1) * 0.5;
  const inverseI0 = 1 / besselI0(beta);
  const coefficients = new Float64Array(config.firLength);
  let sum = 0;
  for (let index = 0; index < config.firLength; index++) {
    const offset = index - center;
    const sinc = offset === 0
      ? 2 * cutoff
      : Math.sin(2 * Math.PI * cutoff * offset) / (Math.PI * offset);
    const ratio = offset / center;
    const window = besselI0(beta * Math.sqrt(1 - ratio * ratio)) * inverseI0;
    coefficients[index] = sinc * window;
    sum += coefficients[index];
  }
  for (let index = 0; index < coefficients.length; index++) {
    coefficients[index] /= sum;
  }
  return coefficients;
}

export function coefficientBytes(coefficients) {
  const bytes = Buffer.allocUnsafe(coefficients.length * 8);
  for (let index = 0; index < coefficients.length; index++) {
    bytes.writeDoubleLE(coefficients[index], index * 8);
  }
  return bytes;
}

export function coefficientHash(coefficients) {
  return createHash('sha256')
    .update(coefficientBytes(coefficients))
    .digest('hex');
}

export function coefficientBits(coefficients) {
  const bytes = coefficientBytes(coefficients);
  return Array.from(coefficients, (_, index) =>
    bytes.readBigUInt64LE(index * 8).toString(16).padStart(16, '0'));
}
