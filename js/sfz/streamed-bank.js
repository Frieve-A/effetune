import { AudioEncoder } from '../audio/audio-encoder.js';
import { openIrLibraryBackend } from '../ir-library/ir-library-factory.js';
import { PersistentIrPcmCache } from '../ir-library/ir-pcm-cache.js';
import { packStreamedSfzAsset, sfzSampleCacheFootprint } from './asset.js';
import { createSfzGeneratorSample, isSfzGenerator } from './generators.js';
import { sfzError } from './parser.js';
import { createSfzFileSampleReader } from './sample-reader.js';
import { createSfzSampleProviderFactory } from './sample-page-provider.js';
import { compileSfzScriptAsync } from './script-worker.js';
import { prepareSfzOscillatorSources } from './oscillator-source.js';
import { SfzSampleStreamWorker } from './sample-stream-worker.js';
import { prepareSfzLoopMetadata } from './sample-metadata.js';
import { effectSamplePaths } from './effects-asset.js';
import { materializeSfzAsset, sameSfzPreparationGeometry } from './preparation-context.js';
import { sfzStorageVariants, sfzResidentRanges, sfzStorageSlots } from './storage-plan.js';

// This callback is supplied by the host only after its target native runtime
// advertises the complete stream capability. It never uploads to an older bank ABI.
export async function prepareStreamedSfzBank({ id, parsed, maxBytes, createSampleReader,
  cacheBackend, onDiagnostic, onProgress, preparationContext = null, estimateEffectBytes }, { workerFactory, persistentCache } = {}) {
  parsed = await prepareSfzLoopMetadata(parsed, createSampleReader, maxBytes);
  const script = parsed.script ? await compileSfzScriptAsync(parsed.script.source) : null;
  let cycleWorker, cycleSample = 0, oscillators;
  try {
    oscillators = await prepareSfzOscillatorSources(parsed, async (path, budget) => {
      if (isSfzGenerator(path)) return createSfzGeneratorSample(path);
      cycleWorker ??= new SfzSampleStreamWorker({ workerFactory });
      const sample = cycleSample++, info = await cycleWorker.open(sample, await createSampleReader(path));
      if (info.frames * info.channels * 4 > budget) throw sfzError('too-large', 'The wavetable needs more sample memory.');
      const channels = Array.from({ length: info.channels }, () => new Float32Array(info.frames));
      for (let page = 0; page * 4096 < info.frames; page++) {
        const decoded = await cycleWorker.readPage(sample, page);
        for (let channel = 0; channel < info.channels; channel++) for (let frame = 0; frame < decoded.frames; frame++) {
          channels[channel][page * 4096 + frame] = decoded.pcm[frame * info.channels + channel];
        }
      }
      return { sampleRate: info.sampleRate, channels };
    }, maxBytes);
  } finally { cycleWorker?.close(); }
  parsed = oscillators.parsed;
  if (persistentCache === undefined) {
    try {
      const backend = cacheBackend || await openIrLibraryBackend({ namespace: 'sfz-library', onDiagnostic });
      persistentCache = await new PersistentIrPcmCache(backend, { onDiagnostic, indexWriteInterval: 128 }).open();
    } catch (error) { onDiagnostic?.({ sampleCache: error }); persistentCache = null; }
  }
  const storage = parsed.modulation?.format === 'sf2' ? null :
    sfzStorageVariants(parsed, new Set(oscillators.samples.keys()));
  if (storage) parsed = storage.parsed;
  const paths = storage?.paths ?? [...new Set([...parsed.regions.map(region => region.sample), ...effectSamplePaths(parsed.effects)])].sort();
  const readers = new Map();
  const factory = await createSfzSampleProviderFactory({ assetId: id, paths, persistentCache, onProgress, workerFactory,
    storageModes: storage ? paths.map(path => storage.modes.get(path)) : null,
    createReader: async key => {
      const path = storage?.sources.get(key) ?? key;
      if (readers.has(path)) return readers.get(path);
      const opened = (async () => {
      if (!oscillators.samples.has(path) && !isSfzGenerator(path)) return createSampleReader(path);
      const pcm = oscillators.samples.get(path) ?? createSfzGeneratorSample(path);
      const blob = new AudioEncoder().encodeWav({ numberOfChannels: pcm.channels.length,
        length: pcm.channels[0].length, sampleRate: pcm.sampleRate, getChannelData: channel => pcm.channels[channel] }, 'float32');
      const reader = await createSfzFileSampleReader(new File([blob], 'generator.wav', { lastModified: 0 }));
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
      return { ...reader, revision: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') };
      })();
      readers.set(path, opened);
      return opened;
    } });
  const samples = new Map(paths.map((path, index) => [path, factory.samples[index]]));
  const build = async (context, budget = maxBytes, estimate = estimateEffectBytes, previous = null) => {
    const warnings = [];
    const options = { maxBytes: budget, script, modulation: parsed.modulation, effects: parsed.effects,
      sourceProfile: parsed.sourceProfile ?? null, presets: parsed.presets ?? null, onDiagnostic,
      onWarning: warning => warnings.push(warning) };
    const ranges = storage ? sfzResidentRanges(parsed.regions, samples, storage.mandatory)
      : new Map(paths.map(path => [path, []]));
    if (!storage) for (const path of new Set([...oscillators.samples.keys(), ...effectSamplePaths(parsed.effects)]))
      ranges.get(path)?.push([0, samples.get(path).frames]);
    const maximumPlan = storage ? sfzStorageSlots(32768, samples, ranges) : null;
    if (storage && !maximumPlan) throw sfzError('too-large', 'The instrument needs more sample memory. Increase the SFZ memory limit.');
    const required = [];
    for (const [sample, path] of paths.entries()) for (const [first, end] of ranges.get(path))
      for (let pageIndex = Math.floor(first / 4096); pageIndex <= Math.floor((end - 1) / 4096); pageIndex++)
        required.push(Object.freeze({ sample, pageIndex }));
    const minimum = storage ? maximumPlan.minimumSlots : required.length + 1;
    if (minimum > 32768) throw sfzError('too-large', 'The instrument needs more sample memory. Increase the SFZ memory limit.');
    const cacheChannels = factory.samples.some(sample => sample.channels === 2) ? 2 : 1;
    const plan = slots => storage ? sfzStorageSlots(slots, samples, ranges) : null;
    const cacheBytes = slots => sfzSampleCacheFootprint(samples.size, slots, cacheChannels, plan(slots));
    const provisional = packStreamedSfzAsset(parsed.regions, samples,
      { ...options, cacheSlots: minimum, storagePlan: plan(minimum) });
    let descriptor = provisional;
    if (context) {
      // Query one metadata-only minimum geometry. Only the generated shared cache
      // geometry varies during slot selection; native owns every other byte.
      const materialized = await materializeSfzAsset(provisional, context, budget, estimate);
      const otherBytes = materialized.nativePreparationBytes - cacheBytes(minimum);
      if (!Number.isSafeInteger(otherBytes) || otherBytes < 0) throw sfzError('prepare', 'Instrument preparation is unavailable. Reload the app and try again.');
      if (previous && sameSfzPreparationGeometry(previous.preparationContext, materialized.preparationContext) &&
          otherBytes <= previous.nativeNonCacheBytes && previous.footprintBytes <= budget)
        return { descriptor: previous, warnings };
      let low = minimum;
      let high = Math.max(minimum, Math.min(32768, factory.samples.reduce((count, sample) =>
        Math.min(32768, count + Math.ceil(sample.frames / 4096)), 0) + 2));
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (provisional.payload.byteLength + otherBytes + cacheBytes(middle) <= budget) low = middle;
        else high = middle - 1;
      }
      warnings.length = 0;
      if (storage) descriptor = packStreamedSfzAsset(parsed.regions, samples,
        { ...options, cacheSlots: low, storagePlan: plan(low), preparationContext: materialized.preparationContext });
      else {
        // SF2 cache capacity changes only this header lane; the packed regions
        // and modulation are independent of the selected slot count.
        new Uint32Array(provisional.payload, 32)[14] = low;
        descriptor.preparationContext = materialized.preparationContext;
      }
      descriptor.processingChannels = materialized.processingChannels;
      descriptor.nativeNonCacheBytes = otherBytes;
      descriptor.nativePreparationBytes = otherBytes + cacheBytes(low);
      descriptor.footprintBytes = descriptor.payload.byteLength + descriptor.nativePreparationBytes;
      descriptor.sampleCacheSlots = low;
    } else descriptor.sampleCacheSlots = minimum;
    descriptor.sampleCacheBytes = cacheBytes(descriptor.sampleCacheSlots);
    descriptor.sampleProviderFactory = async context => {
      const provider = await factory(context);
      try {
        await provider.preload(required);
        provider.startSupply = context => factory.startSupply(provider, context);
        return provider;
      } catch (error) { provider.close(); throw error; }
    };
    descriptor.materializeForContext = async (context, nextBudget, nextEstimate) => {
      const next = (await build(context, nextBudget, nextEstimate, descriptor)).descriptor;
      next.unsupportedOpcodes = descriptor.unsupportedOpcodes;
      next.incomplete = descriptor.incomplete;
      return next;
    };
    return { descriptor, warnings };
  };
  const { descriptor, warnings } = await build(preparationContext);
  descriptor.unsupportedOpcodes = [...(parsed.unsupportedOpcodes || [])];
  descriptor.incomplete = Boolean(parsed.diagnostics?.missingSamples?.length || parsed.diagnostics?.invalidRegions?.length ||
    warnings.some(warning => warning.code === 'invalid-regions'));
  const counts = new Map((parsed.warnings || []).map(warning => [warning.code, warning.count]));
  for (const warning of warnings) counts.set(warning.code, (counts.get(warning.code) || 0) + warning.count);
  return { descriptor, sampleCount: paths.length, regionCount: new Uint32Array(descriptor.payload, 32)[2],
    ...(counts.size && { warnings: [...counts].map(([code, count]) => ({ code, count })) }) };
}
