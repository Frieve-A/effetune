import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../../plugins/audio-processor.js', import.meta.url);
const dspDirectory = new URL('../../plugins/dsp/', import.meta.url);
const artifacts = new Map();
let source;

export async function loadAudioWorkletArtifacts(variant) {
  if (variant !== 'baseline' && variant !== 'simd') throw new Error(`Unknown worklet DSP variant: ${variant}`);
  source ??= readFile(sourceUrl, 'utf8');
  if (!artifacts.has(variant)) {
    const filename = variant === 'simd' ? 'effetune-dsp.simd.wasm' : 'effetune-dsp.wasm';
    artifacts.set(variant, readFile(new URL(filename, dspDirectory)).then(bytes => WebAssembly.compile(bytes)));
  }
  const [workletSource, module] = await Promise.all([source, artifacts.get(variant)]);
  return { source: workletSource, module };
}
