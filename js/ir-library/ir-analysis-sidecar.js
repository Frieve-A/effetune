const ANALYSIS_MAGIC = 0x4e415249;
const ANALYSIS_VERSION = 1;
const HEADER_BYTES = 16;
const MAX_SERIES_SAMPLES = 262144;

function asFiniteSeries(value, name) {
  if (value === undefined || value === null) return new Float32Array(0);
  const series = value instanceof Float32Array ? value : Float32Array.from(value);
  if (series.length > MAX_SERIES_SAMPLES) throw new RangeError(`${name} is too large.`);
  for (const sample of series) {
    if (!Number.isFinite(sample)) throw new TypeError(`${name} contains invalid data.`);
  }
  return series;
}

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Analysis sidecar data must be binary.');
}

export function summarizeIrAnalysis(analysis = {}) {
  const onsetFrame = Number.isSafeInteger(analysis.onsetFrame) && analysis.onsetFrame >= 0 && analysis.onsetFrame <= 0xffffffff
    ? analysis.onsetFrame
    : null;
  const rt60 = Number.isFinite(analysis.rt60) && analysis.rt60 >= 0 && analysis.rt60 <= 1000000 ? analysis.rt60 : null;
  const peakDb = Number.isFinite(analysis.peakDb) && analysis.peakDb >= -1000 && analysis.peakDb <= 1000
    ? analysis.peakDb
    : null;
  return Object.freeze({ onsetFrame, rt60, peakDb });
}

export function encodeIrAnalysisSidecar(analysis = {}) {
  const envelope = asFiniteSeries(analysis.envelope, 'Analysis envelope');
  const edc = asFiniteSeries(analysis.edc, 'Analysis EDC');
  const buffer = new ArrayBuffer(HEADER_BYTES + (envelope.length + edc.length) * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer);
  view.setUint32(0, ANALYSIS_MAGIC, true);
  view.setUint16(4, ANALYSIS_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, envelope.length, true);
  view.setUint32(12, edc.length, true);
  const payload = new Float32Array(buffer, HEADER_BYTES);
  payload.set(envelope);
  payload.set(edc, envelope.length);
  return new Uint8Array(buffer);
}

export function decodeIrAnalysisSidecar(value) {
  const bytes = asBytes(value);
  if (bytes.byteLength < HEADER_BYTES) throw new Error('Invalid analysis sidecar.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== ANALYSIS_MAGIC || view.getUint16(4, true) !== ANALYSIS_VERSION ||
      view.getUint16(6, true) !== 0) throw new Error('Invalid analysis sidecar.');
  const envelopeLength = view.getUint32(8, true);
  const edcLength = view.getUint32(12, true);
  if (envelopeLength > MAX_SERIES_SAMPLES || edcLength > MAX_SERIES_SAMPLES ||
      bytes.byteLength !== HEADER_BYTES + (envelopeLength + edcLength) * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error('Invalid analysis sidecar.');
  }
  const payload = new Float32Array(envelopeLength + edcLength);
  new Uint8Array(payload.buffer).set(bytes.subarray(HEADER_BYTES));
  for (const sample of payload) {
    if (!Number.isFinite(sample)) throw new Error('Invalid analysis sidecar.');
  }
  return Object.freeze({
    envelope: payload.slice(0, envelopeLength),
    edc: payload.slice(envelopeLength)
  });
}
