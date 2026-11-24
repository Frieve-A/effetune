import { instantiateDsp } from '../../audio/dsp-wasm-loader.js';
import { AnalogMeterPlugin_PARAMS_HASH, packAnalogMeterPluginParams } from '../../audio/dsp-params.generated.js';
import { parseTelemetryPacket } from '../../audio/telemetry-hub.js';
import { addLoudnessBlock, encodeHistogram } from './histogram.js';

function check(status) {
  if (status !== 0) throw new Error(`Loudness meter returned ${status}`);
}

export function supportsLoudnessInput(rate, channels) {
  // The BS.1770 K-weighting shelf (1681.974 Hz) must be below Nyquist.
  // At 3364 Hz and above our 10 ms quantum also fits the engine's 32-frame minimum.
  return Number.isSafeInteger(rate) && rate >= 3364 && [1, 2, 6].includes(channels);
}

export async function createLoudnessMeter(module, rate, channels, onMomentary) {
  if (!supportsLoudnessInput(rate, channels)) throw new RangeError('Unsupported loudness meter input');
  const width = channels === 1 ? 2 : channels;
  const block = Math.round(rate * 0.1);
  const quantum = Math.floor(block / 10);
  const binding = await instantiateDsp(module);
  let instance;
  try {
    binding.createEngine();
    check(binding.prepare(rate, width, quantum, 1024));
    instance = binding.createInstance('AnalogMeterPlugin');
    check(binding.instanceSetParams(instance, packAnalogMeterPluginParams({ md: 'Loudness' }), AnalogMeterPlugin_PARAMS_HASH));
    check(binding.instanceSetTap(instance, 1));
    check(binding.setTelemetryRate(240));
  } catch (error) {
    binding.close();
    throw error;
  }
  const arena = binding.getArenaViews();
  const packet = new ArrayBuffer(1024);
  const bins = new Map();
  let filled = 0;
  let frames = 0;
  let processed = 0;
  let lastBlock = 0;
  let integrated = null;
  let lra = null;
  let truePeak = -240;

  function process() {
    check(binding.instanceProcess(instance, arena.offsets.combined, width, quantum, processed / rate));
    processed += quantum;
    const length = binding.telemetryRead(packet);
    parseTelemetryPacket(packet, length, ({ payload }) => {
      const flags = payload.getUint16(2, true);
      const program = 4 + width * 8;
      const complete = Math.round(payload.getFloat32(program + 20, true) * 10);
      truePeak = payload.getFloat32(program + 16, true);
      if (complete <= lastBlock || complete > Math.floor(frames / block)) return;
      lastBlock = complete;
      if (complete >= 4) {
        const momentary = payload.getFloat32(program, true);
        addLoudnessBlock(bins, momentary);
        onMomentary?.(momentary);
      }
      integrated = flags & 1 ? payload.getFloat32(program + 8, true) : null;
      lra = flags & 2 ? payload.getFloat32(program + 12, true) : null;
    });
    filled = 0;
  }

  return {
    push(planes) {
      for (let offset = 0; offset < planes[0].length;) {
        const count = Math.min(quantum - filled, planes[0].length - offset);
        for (let ch = 0; ch < width; ch++) {
          const plane = planes[channels === 1 ? 0 : ch];
          arena.combined.set(plane.subarray(offset, offset + count), ch * quantum + filled);
        }
        filled += count;
        frames += count;
        offset += count;
        if (filled === quantum) process();
      }
    },
    finish() {
      for (let ch = 0; ch < width; ch++) {
        arena.combined.fill(0, ch * quantum + filled, (ch + 1) * quantum);
      }
      process();
      // Flush the true-peak interpolation delay and collect the last record.
      arena.combined.fill(0, 0, width * quantum);
      process();
      return { integrated, truePeak, lra, histogram: encodeHistogram(bins) };
    },
    close() { binding.close(); }
  };
}
