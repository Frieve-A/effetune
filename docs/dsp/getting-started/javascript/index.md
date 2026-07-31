---
layout: dsp
title: "JavaScript Start"
description: "JavaScript Start"
lang: en
permalink: /dsp/getting-started/javascript/
---
# JavaScript Start

Use this path for offline processing in Node.js or a browser module.

<!-- DSP-RELEASE-NOTICE -->
> **Release state:** npm is **unreleased**. The public install command is intentionally disabled until a version-matched smoke test passes.

> Use the CI candidate artifact for pre-release testing. Do not substitute an older registry version.

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
