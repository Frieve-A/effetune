---
layout: dsp
title: "JavaScript Start"
description: "JavaScript Start"
lang: en
permalink: /dsp/getting-started/javascript/
---
# JavaScript Start

Use this path for offline processing in Node.js or a browser module.

```console
npm install @effetune/dsp
```

The package is ESM-only. Save the example as `start.mjs` and run
`node start.mjs`, or set `"type": "module"` in the consumer's
`package.json`. CommonJS `require()` is not supported.

Node.js `>=18` is required. Chromium is acceptance-tested; other evergreen
browsers are designed for but not verified in v0.1. The package accepts equal-length
`Float32Array[]` channels and does not decode, encode, or resample audio.
In Node.js, `@effetune/dsp` resolves after installation. In a browser, use a bundler
or an import map that maps the bare `@effetune/dsp` specifier to the package's
`dist/index.js`; serve that module and its relative WASM/metadata assets from the
same secure origin.

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

The generic `createEffect(type)`, Chain JSON, catalog, and generated named
class/factory exports all support every registered type.

Every input sample must be finite. Offline and streaming calls reject `NaN`,
`Infinity`, and `-Infinity` with `ValidationError` before native processing;
a rejected stream block does not change filter state.

## Graph v1 quickstart

Graph v1 is opt-in routing for branching and merging. This complete example uses the
wet/dry recipe, processes once with fresh state, then opens a stateful static stream and
reads its prepared compile snapshot:

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

See [Graph v1](/dsp/reference/graph-v1/) for the document contract, conversion from a
Chain, capacity, and stable error fields.
