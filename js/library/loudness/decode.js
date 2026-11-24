import { DSD_RANGE_BYTE_CAP } from '../../ui/audio-player/dsd-source.js';
import { frameToMediaTime } from '../../ui/audio-player/playback-region.js';
import { supportsLoudnessInput } from './measurement.js';

export function createRangeAdapter(reader) {
  let previous = Promise.resolve();
  return {
    getSize: () => reader.size,
    prefetchProfile: 'fileSystem',
    dispose: () => reader.dispose(),
    read(start, end) {
      const operation = previous.then(async () => {
        if (end - start <= DSD_RANGE_BYTE_CAP) return reader.read(start, end - start);
        const result = new Uint8Array(end - start);
        for (let offset = start; offset < end; offset += DSD_RANGE_BYTE_CAP) {
          const length = Math.min(end - offset, DSD_RANGE_BYTE_CAP);
          result.set(await reader.read(offset, length), offset - start);
        }
        return result;
      });
      previous = operation.catch(() => {});
      return operation;
    }
  };
}

export async function measureDecodedTrack({ track, samples, region, createMeter }) {
  const channels = await track.getNumberOfChannels();
  const rate = await track.getSampleRate();
  if (!supportsLoudnessInput(rate, channels) || !await track.canDecode()) return { status: 'unsupported' };
  const start = region.startFrame == null ? undefined : frameToMediaTime(region.startFrame);
  const end = region.endFrame == null ? undefined : frameToMediaTime(region.endFrame);
  const first = start === undefined ? -Infinity : Math.round(start * rate);
  const last = end === undefined ? Infinity : Math.round(end * rate);
  const meter = await createMeter(rate, channels);
  let measured = 0;
  try {
    for await (const sample of samples(start, end)) {
      try {
        if (sample.numberOfChannels !== channels || sample.sampleRate !== rate) return { status: 'unsupported' };
        // A decoder yields whole packets at either CUE boundary. Only copy
        // samples in the half-open region, including the first partial packet.
        const position = Math.round(sample.timestamp * rate);
        const offset = Math.max(0, first - position);
        const count = Math.min(sample.numberOfFrames, last - position) - offset;
        if (count <= 0) continue;
        const planes = Array.from({ length: channels }, (_, ch) => {
          const plane = new Float32Array(count);
          sample.copyTo(plane, { planeIndex: ch, format: 'f32-planar', frameOffset: offset, frameCount: count });
          return plane;
        });
        meter.push(planes);
        measured += count;
      } finally { sample.close(); }
    }
    if (!measured || (Number.isFinite(last) && measured !== last - first)) {
      return { status: start === undefined ? 'failed' : 'unsupported' };
    }
    return { status: 'measured', ...meter.finish() };
  } finally { meter.close(); }
}
