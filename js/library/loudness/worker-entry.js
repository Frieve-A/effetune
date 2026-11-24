import { ALL_FORMATS, AudioSampleSink, BlobSource, CustomSource, Input } from 'mediabunny';
import { openDsdWorkerReader } from '../../ui/audio-player/dsd-range-channel.js';
import { createRangeAdapter, measureDecodedTrack } from './decode.js';
import { createLoudnessMeter } from './measurement.js';

let module;
self.onmessage = async ({ data }) => {
  let input;
  let sourceUnavailable = false;
  let meterError = false;
  try {
    module ??= data.module instanceof WebAssembly.Module ? data.module : await WebAssembly.compile(data.module);
    let source;
    if (data.file) {
      source = new BlobSource(data.file);
    } else {
      const adapter = createRangeAdapter(openDsdWorkerReader(data.port, data.size));
      source = new CustomSource({ ...adapter, async read(start, end) {
        try { return await adapter.read(start, end); }
        catch (error) { sourceUnavailable = true; throw error; }
      } });
    }
    input = new Input({ source, formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track || (await track.getCodec()) === 'alac') {
      self.postMessage({ status: 'unsupported' });
      return;
    }
    const sink = new AudioSampleSink(track);
    const result = await measureDecodedTrack({
      track, samples: (start, end) => sink.samples(start, end), region: data,
      async createMeter(rate, channels) {
        try { return await createLoudnessMeter(module, rate, channels); }
        catch (error) { meterError = true; throw error; }
      }
    });
    self.postMessage(result);
  } catch (error) {
    console.warn('Loudness analysis worker:', error);
    if (!module || meterError) self.postMessage({ error: 'meterUnavailable' });
    else if (sourceUnavailable || ['NotReadableError', 'NotFoundError', 'NotAllowedError'].includes(error.name)) {
      self.postMessage({ status: 'unavailable' });
    } else self.postMessage({ status: data.startFrame == null ? 'failed' : 'unsupported' });
  } finally { input?.dispose(); }
};
