import { prepareStreamedSfzBank } from '../sfz/streamed-bank.js';

// The shared sampler receives resolved regions plus the original SF2-unit
// generator/modulator graph. This is not an SF2-to-SFZ text conversion.
export function sf2SamplerRegions(source) {
  const samples = new Map(source.samples.map(sample => [sample.sampleId, sample]));
  return source.compiled.regions.map(region => {
    const sample = samples.get(region.sampleId), end = region.sample.end - sample.start - 1;
    return {
      sample: sample.path, lokey: region.keyRange[0], hikey: region.keyRange[1],
      lovel: region.velocityRange[0], hivel: region.velocityRange[1], lorand: 0, hirand: 1,
      seq_length: 1, seq_position: 1, seqGroup: 0,
      pitch_keycenter: region.sample.originalPitch, pitch_keytrack: 100, transpose: 0,
      tune: region.sample.pitchCorrection, volume: 0, pan: 0, amp_veltrack: 0,
      offset: region.sample.start - sample.start, end,
      loop_mode: region.generators[54] & 1 ? (region.generators[54] & 2 ? 3 : 2) : 0,
      loop_start: region.sample.loopStart - sample.start, loop_end: region.sample.loopEnd - sample.start - 1,
      ampeg_attack: 0, ampeg_hold: 0, ampeg_decay: 0, ampeg_sustain: 100, ampeg_release: .001
    };
  });
}

export async function prepareSoundFontBank({ source, ...options }, providerOptions) {
  if (source.samples.some(sample => sample.compressed) && (typeof globalThis.AudioDecoder !== 'function' ||
      !(await AudioDecoder.isConfigSupported({ codec: 'vorbis', sampleRate: 44100, numberOfChannels: 1 })).supported)) {
    const error = new Error('This browser cannot play compressed SoundFonts. Use a browser with Vorbis decoding support or choose an SF2 SoundFont.');
    error.code = 'sample-codec-unavailable';
    throw error;
  }
  options.onDiagnostic?.({ sf2: source.compiled.diagnostics });
  const parsed = { regions: sf2SamplerRegions(source), modulation: source.compiled,
    sourceProfile: source.compiled.sourceProfile, presets: source.compiled.presets };
  return { ...await prepareStreamedSfzBank({ ...options, parsed, createSampleReader: source.createSampleReader }, providerOptions),
    sourceBytes: source.sourceBytes };
}
