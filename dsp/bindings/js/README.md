# @effetune/dsp

<!-- BEGIN DSP-LIBRARY-JAVASCRIPT-SUMMARY -->
EffeTune DSP provides the same MIT-licensed C++ audio kernels used by EffeTune
as a self-contained WebAssembly package for Node.js and evergreen browsers.
Version 0.4.0 exposes all 83 catalog types through the generic Chain and
`createEffect` APIs and 83 generated named convenience classes,
decoded analyzer telemetry, versioned semantic presets, deterministic seeds, and an AudioWorklet wrapper.
<!-- END DSP-LIBRARY-JAVASCRIPT-SUMMARY -->

Documentation: [effetune.frieve.com/dsp/](https://effetune.frieve.com/dsp/)

Source and issues:
[Frieve-A/effetune](https://github.com/Frieve-A/effetune)

<!-- BEGIN DSP-LIBRARY-JAVASCRIPT-START -->
```console
npm install @effetune/dsp
```

```js
import { createChain } from '@effetune/dsp';

const frames = 512;
const mono = Float32Array.from(
  { length: frames },
  (_, frame) => 0.5 * Math.sin(2 * Math.PI * frame / 97)
);
const input = [mono.slice(), mono.slice()];
const chain = await createChain({
  version: 1,
  chain: [{
    id: 'volume',
    type: 'Volume',
    parameters: { volume: -6 }
  }]
});
const output = await chain.process(input, { sampleRate: 48000 });
console.log(output.length, output[0].length, output[0][0]);
chain.close();
```
<!-- END DSP-LIBRARY-JAVASCRIPT-START -->

The package is ESM-only. Save the example as `start.mjs` and run
`node start.mjs`, or set `"type": "module"` in the consumer's `package.json`.
CommonJS `require()` is not supported.

Public package entry points are:

- `@effetune/dsp` for the main ESM API
- `@effetune/dsp/worklet` for `EffeTuneNode`
- `@effetune/dsp/processor` for the side-effect AudioWorklet processor
- `@effetune/dsp/schemas/chain-v1.json` for the Chain v1 JSON Schema
- `@effetune/dsp/schemas/bundle-v1.json` for the Bundle v1 JSON Schema
- `@effetune/dsp/catalog` for ESM catalog exports
- `@effetune/dsp/catalog.json` for the machine-readable catalog JSON

Every offline `process()` call starts from fresh DSP state and returns newly
owned `Float32Array` channels. Input arrays are never mutated. Effects run in
array order; a disabled effect and an empty chain are identity operations.
All samples must be finite. Offline and streaming calls reject `NaN`,
`Infinity`, and `-Infinity` with `ValidationError` before native processing;
an invalid stream block does not change filter state.

Use a stream when DSP state must continue across blocks or when parameters
change at an exact frame:

```js
const stream = await chain.stream({
  sampleRate: 48000,
  channels: 2,
  blockSize: 128,
  seed: 42
});

const output = await stream.process([left, right], {
  events: [{
    frame: 256,
    effectId: 'voice',
    parameters: { threshold: -24, ratio: 4 }
  }]
});

stream.setParam('voice', 'threshold', -20);
stream.reset();
stream.close();
```

Event frames are relative to the start of that `process()` input. They must be
integers in input order from `0` through `frames - 1`; events sharing a frame
are applied in array order before that sample. Each parameter object is merged
with the effect's current semantic parameters and the complete packed block is
committed without recreating DSP state. `reset()` restores the parameters,
seed, and DSP state from stream creation.

`setParam()` and events cannot change parameters that require convolution
assets to be staged again. Open a new stream after changing
`IRReverb.channelMode`, `latency`, or `convolutionRate`;
`FIRCrossover.bandCount`, `latencyMode`, or `filterDelaySamples`; or
`latencyMode` / `filterDelaySamples` on `FiveBandFIRPEQ`, `GroupDelayEQ`, or
`RoomEQ`. The same restriction applies to `EffeTuneNode.setParam()`.

Canonical presets use semantic long parameter names:

```json
{
  "version": 1,
  "chain": [
    {
      "id": "voice",
      "type": "Compressor",
      "enabled": true,
      "channel": "stereo",
      "parameters": { "threshold": -18, "ratio": 4 }
    }
  ]
}
```

Application `pipeline` and `plugins` presets are not canonical presets.
Convert a preset whose effects form one ordered serial path explicitly with
`importLegacyPreset()` before calling `createChain()`. Branched and multi-bus
routing is rejected because flattening it would change the acoustic result.
Move or copy the desired effects into one serial path in the app and export it
again, or reproduce the branching in the host around separate Chains.
Unsupported fields produce a validation error.

FIR Crossover, Five Band FIR PEQ, Group Delay EQ, IR Reverb, and Room EQ
require an `assets.impulseResponse` reference and an `assetResolver`. The four
FIR filter effects use prepared coefficient impulses at the processing sample
rate. Use the public `encodeEta1({ channels, sampleRate, topology, paths })`
helper to encode raw planar float32 arrays for a resolver. Bundle manifests
verify exact byte length and SHA-256 before accepting an ETA1 payload. The
complete payload and convolution footprint must fit the 32 MiB kernel cap.

`EFFECT_CATALOG` and `getEffectCatalog()` expose the machine-readable semantic
catalog for all 83 root classes and their `create<Type>()` factories. The
catalog contains channel choices, parameters, required assets, telemetry, and
latency declarations, but no private implementation mapping.

For stateful processing, `ChainStream.latencySamples` reports aggregate runtime
latency and matches Python `Stream.latency_samples` for the same chain and
sample rate. `chain.latencySamples({ sampleRate })` reports the same value
without opening a stream, which aligns offline `process()` output.
`EffeTuneNode` does not expose a latency getter.

For real-time processing:

```js
import { EffeTuneNode } from '@effetune/dsp/worklet';

const node = await EffeTuneNode.create(context, preset, {
  channels: 2,
  seed: 42,
  assetResolver
});
source.connect(node).connect(context.destination);
await node.setParam('voice', 'threshold', -20);
await node.reset();
node.close();
```

`LevelMeter`, `Oscilloscope`, `SpectrumAnalyzer`, `Spectrogram`, and
`StereoMeter` provide opt-in decoded telemetry:

```js
const unsubscribe = node.subscribe(frame => {
  if (frame.kind === 'level') console.log(frame.channels);
});
console.log(node.droppedTelemetryFrames);
unsubscribe();
```

Offline `Chain.process()` accepts `onTelemetry`; a stream accepts the same
option and also provides `subscribe()`, `unsubscribe()`, and
`droppedTelemetryFrames`. The first subscriber enables observations and the
last unsubscribe disables them. Arrays in delivered frames belong to the
caller. Raw DSP telemetry and AudioWorklet messages are not public APIs.

`EffeTuneNode.create()` waits until the package-owned worklet processor has
instantiated the selected baseline or SIMD artifact and committed every
required asset. Serve the package files from the same origin or provide
explicit `processorUrl`, `wasmUrl`, and `simdWasmUrl` options.

The package does not decode or encode audio files. Provide planar float32 audio
from Web Audio, WebCodecs, an audio-file library, or your own I/O layer.
