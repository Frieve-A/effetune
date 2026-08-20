# @effetune/dsp

<!-- BEGIN DSP-LIBRARY-JAVASCRIPT-SUMMARY -->
EffeTune DSP provides the same MIT-licensed C++ audio kernels used by EffeTune
as a self-contained WebAssembly package for Node.js and evergreen browsers.
Version 0.5.0 exposes all 92 catalog types through the generic Chain and
`createEffect` APIs and 92 generated named convenience classes,
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

### Graph v1 quickstart

Graph v1 is opt-in routing for branching and merging:

```js
import { Graph, createGraph, createVolume } from '@effetune/dsp';

const input = [
  new Float32Array(128).fill(0.25),
  new Float32Array(128).fill(0.25)
];
const graphDocument = Graph.wetDry(
  createVolume({ id: 'wet', volume: -6 }),
  { dry: 0.5, wet: 0.5 }
);
const graph = await createGraph(graphDocument);
let stream;

try {
  const offline = await graph.process(input, { sampleRate: 48000 });
  stream = await graph.stream({
    sampleRate: 48000,
    channels: 2,
    blockSize: 128
  });
  const continuous = await stream.process(input);
  console.log(
    offline[0][0],
    continuous[0][0],
    stream.latencySamples,
    stream.compileSnapshot.effectiveSchedule
  );
} finally {
  stream?.close();
  graph.close();
}
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
- `@effetune/dsp/schemas/graph-v1.json` for the Graph v1 JSON Schema
- `@effetune/dsp/schemas/bundle-v1.json` for the Bundle v1 JSON Schema
- `@effetune/dsp/catalog` for ESM catalog exports
- `@effetune/dsp/catalog.json` for the machine-readable catalog JSON

Graph v1 is opt-in. Its current capacities and delay-storage accounting are
published in the [Graph v1 guide](https://effetune.frieve.com/dsp/reference/graph-v1/#capacity).

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
`latencyMode` / `filterDelaySamples` on `FiveBandFIRPEQ`, `GroupDelayEQ`,
`GroupDelayPEQ`, or `RoomEQ`. The same restriction applies to
`EffeTuneNode.setParam()`.

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

FIR Crossover, Five Band FIR PEQ, Group Delay EQ, Group Delay PEQ, IR Reverb,
and Room EQ require an `assets.impulseResponse` reference and an
`assetResolver`. The five FIR filter effects use prepared coefficient impulses
at the processing sample rate. Use the public
`encodeEta1({ channels, sampleRate, topology, paths })`
helper to encode raw planar float32 arrays for a resolver. Bundle manifests
verify exact byte length and SHA-256 before accepting an ETA1 payload. The
complete payload and convolution footprint must fit the 32 MiB kernel cap.

`EFFECT_CATALOG` and `getEffectCatalog()` expose the machine-readable semantic
catalog for all 92 root classes and their `create<Type>()` factories. The
catalog contains channel choices, parameters, required assets, telemetry, and
latency declarations, but no private implementation mapping.

### Modulation Style recipes

The application-only **Style** selector is not a DSP parameter or a second
preset API. The following JSON-compatible objects are the equivalent public
parameter dictionaries. Copy one into a named constructor, for example
`new Chorus(MODULATION_STYLES.Chorus.Flanger)`, or into a Chain effect's
`parameters` object.

```js
const MODULATION_STYLES = {
  AutoFilter: {
    "Auto Filter Sweep": { mode: "LFO", filterType: "Low-pass", minimumFrequency: 200, maximumFrequency: 4000, resonance: 1.5, mix: 80, rate: 0.5, waveform: "Sine", stereoPhase: 0, sensitivity: 24, attack: 20, release: 250, direction: "Up" },
    "Stereo Filter Sweep": { mode: "LFO", filterType: "Low-pass", minimumFrequency: 160, maximumFrequency: 6000, resonance: 2, mix: 85, rate: 0.35, waveform: "Sine", stereoPhase: 120, sensitivity: 24, attack: 20, release: 250, direction: "Up" },
    "Envelope Filter": { mode: "Envelope", filterType: "Low-pass", minimumFrequency: 100, maximumFrequency: 5000, resonance: 1.2, mix: 85, rate: 0.5, waveform: "Sine", stereoPhase: 0, sensitivity: 24, attack: 18, release: 300, direction: "Up" },
    "Auto Wah": { mode: "Envelope", filterType: "Band-pass", minimumFrequency: 180, maximumFrequency: 2400, resonance: 5, mix: 100, rate: 0.5, waveform: "Sine", stereoPhase: 0, sensitivity: 30, attack: 8, release: 180, direction: "Up" },
    "Reverse Auto Wah": { mode: "Envelope", filterType: "Band-pass", minimumFrequency: 180, maximumFrequency: 2800, resonance: 4, mix: 100, rate: 0.5, waveform: "Sine", stereoPhase: 0, sensitivity: 30, attack: 12, release: 350, direction: "Down" }
  },
  AutoPan: {
    "Gentle Auto Pan": { rate: 0.35, depth: 45, center: 0, width: 70, waveform: "Sine", phase: 0 },
    "Wide Auto Pan": { rate: 0.7, depth: 100, center: 0, width: 100, waveform: "Sine", phase: 0 },
    "Fast Auto Pan": { rate: 4, depth: 85, center: 0, width: 100, waveform: "Triangle", phase: 0 }
  },
  Chorus: {
    "Classic Chorus": { mode: "Chorus", rate: 0.8, delay: 12, depth: 3, voices: 3, stereoSpread: 60, feedback: 0, mix: 45 },
    "Stereo Chorus": { mode: "Stereo Chorus", rate: 0.65, delay: 15, depth: 4, voices: 2, stereoSpread: 80, feedback: 0, mix: 50 },
    Ensemble: { mode: "Ensemble", rate: 0.45, delay: 20, depth: 6, voices: 6, stereoSpread: 100, feedback: 0, mix: 60 },
    Flanger: { mode: "Flanger", rate: 0.35, delay: 2.5, depth: 2, voices: 1, stereoSpread: 35, feedback: 45, mix: 50 },
    "Jet Flanger": { mode: "Flanger", rate: 0.18, delay: 1.5, depth: 1.4, voices: 1, stereoSpread: 70, feedback: -75, mix: 55 },
    Vibrato: { mode: "Vibrato", rate: 4.5, delay: 8, depth: 5, voices: 1, stereoSpread: 50, feedback: 0, mix: 100 }
  },
  FrequencyShifter: {
    "Shift Up": { mode: "Shift", shift: 8, carrierFrequency: 440, minimumShift: 20, maximumShift: 800, rate: 0.15, direction: "Up", stereoPhase: 0, mix: 100 },
    "Shift Down": { mode: "Shift", shift: -8, carrierFrequency: 440, minimumShift: 20, maximumShift: 800, rate: 0.15, direction: "Down", stereoPhase: 0, mix: 100 },
    "Fine Detune": { mode: "Shift", shift: 2, carrierFrequency: 440, minimumShift: 20, maximumShift: 800, rate: 0.15, direction: "Up", stereoPhase: 90, mix: 55 },
    "Ring Modulator": { mode: "Ring Mod", shift: 8, carrierFrequency: 440, minimumShift: 20, maximumShift: 800, rate: 0.15, direction: "Up", stereoPhase: 0, mix: 100 },
    "Barber-pole Up": { mode: "Barber-pole", shift: 8, carrierFrequency: 440, minimumShift: 20, maximumShift: 900, rate: 0.12, direction: "Up", stereoPhase: 90, mix: 85 },
    "Barber-pole Down": { mode: "Barber-pole", shift: -8, carrierFrequency: 440, minimumShift: 20, maximumShift: 900, rate: 0.12, direction: "Down", stereoPhase: 90, mix: 85 }
  },
  Phaser: {
    "Classic Phaser": { mode: "Classic", rate: 0.5, centerFrequency: 1000, range: 3, stages: 6, feedback: 20, stereoPhase: 90, direction: "Up", mix: 50 },
    "Deep Phaser": { mode: "Classic", rate: 0.25, centerFrequency: 700, range: 4.5, stages: 12, feedback: 55, stereoPhase: 30, direction: "Up", mix: 55 },
    "Stereo Phaser": { mode: "Classic", rate: 0.65, centerFrequency: 1200, range: 3.5, stages: 8, feedback: 25, stereoPhase: 120, direction: "Up", mix: 50 },
    "Barber-pole Up": { mode: "Barber-pole", rate: 0.35, centerFrequency: 1000, range: 5, stages: 8, feedback: 30, stereoPhase: 60, direction: "Up", mix: 55 },
    "Barber-pole Down": { mode: "Barber-pole", rate: 0.35, centerFrequency: 1000, range: 5, stages: 8, feedback: 30, stereoPhase: 60, direction: "Down", mix: 55 }
  },
  RotarySpeaker: {
    "Rotary Slow": { speedState: "Slow", speed: 100, acceleration: 2.2, crossover: 800, rotorBalance: 0, stereoWidth: 75, dopplerDepth: 45, amplitudeDepth: 55, mix: 70 },
    "Rotary Fast": { speedState: "Fast", speed: 100, acceleration: 1.4, crossover: 800, rotorBalance: 0, stereoWidth: 85, dopplerDepth: 65, amplitudeDepth: 70, mix: 78 },
    "Gentle Rotary": { speedState: "Slow", speed: 75, acceleration: 3, crossover: 900, rotorBalance: 0, stereoWidth: 45, dopplerDepth: 25, amplitudeDepth: 30, mix: 55 },
    "Leslie Slow": { speedState: "Slow", speed: 100, acceleration: 2.8, crossover: 800, rotorBalance: -5, stereoWidth: 80, dopplerDepth: 50, amplitudeDepth: 60, mix: 75 },
    "Leslie Fast": { speedState: "Fast", speed: 100, acceleration: 1.8, crossover: 800, rotorBalance: -5, stereoWidth: 90, dopplerDepth: 70, amplitudeDepth: 75, mix: 82 }
  }
};
```

For stateful processing, `ChainStream.latencySamples` reports aggregate runtime
latency and matches Python `Stream.latency_samples` for the same chain and
sample rate. `chain.latencySamples({ sampleRate })` reports the same value
without opening a stream. `EffeTuneNode.latencySamples` exposes the cached
aggregate for real-time processing; initialization and awaited `setParam()` or
`reset()` calls update it before returning. These APIs report latency without
trimming or padding offline output, so the host decides how to place rendered
audio.

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
console.log(node.latencySamples);
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
