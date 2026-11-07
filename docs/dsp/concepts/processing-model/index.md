---
layout: dsp
title: "Processing model"
description: "Processing model"
lang: en
permalink: /dsp/concepts/processing-model/
---
# Processing model

Audio uses planar channels and an explicit sample rate. Chain effects run serially in
array order. The caller owns decode, encode, resampling, and buffers. Offline processing
starts fresh; streams retain filter, delay, tail, and random history.

The JavaScript and AudioWorklet WebAssembly build adds a tiny alternating ±1e-19 signal
(about -380 dBFS) at the input of each enabled effect so that filters do not fall into
slow denormal arithmetic, and treats input samples smaller than about 4e-15 as zero
there. Silent input through an active effect therefore returns values near 1e-19 rather
than exact zeros. An empty Chain, or one whose effects are all disabled, returns its input
bit-exact. The native Python build flushes denormals instead and adds no such signal.

Chain is serial only. Branching, merging, and automatic delay compensation are available
through the opt-in [Graph v1](/dsp/reference/graph-v1/) model, which does not change
Chain v1.

Catalog latency badges are qualitative declarations. Python
`Stream.latency_samples` and JavaScript `ChainStream.latencySamples` expose the same
runtime aggregate. `chain.latency_samples(sample_rate)` in Python and
`await chain.latencySamples({ sampleRate })` in JavaScript report the same aggregate
without opening a stream, so offline
`process()` output can be phase-aligned.
`graph.latency_samples(sample_rate)` in Python and
`await graph.latencySamples({ sampleRate })` in JavaScript report
the prepared common-max Graph aggregate without opening a stream, and
`GraphStream.latency_samples` / `GraphStream.latencySamples` expose it on an open
stream.
`EffeTuneNode.latencySamples` exposes the cached real-time aggregate. Creation and
awaited `setParam()` or `reset()` calls update it before returning.

## Source-generating effects

The docs overlay explicitly marks types that can intentionally produce non-zero output
from zero input at an active setting and sample rate. The candidate-package gate runs
all 112 catalog types, using the same canonical assets as the public asset
examples where required. It requires the overlay, public catalog, and frozen
`source-generation-v0.1.json` member sets to match exactly, and treats a peak above
`1e-7` as generated output. Those effect pages carry a warning; the absence of that
mark is a fixture result for the selected settings, not proof that every possible future
setting is non-generating.

Adaptive Prediction needs audible input to learn before it can generate sound on its
own. Its fixture keeps one stream open while training, switching to Hold, and
processing zero input, then checks the final second for sustained output. A freshly
created or reset model remains silent in Hold without prior training.

Render a generator that needs no prior training by processing a zero input whose
frame count defines the rendered length:

```python
rendered = chain.process(np.zeros((2, frames), np.float32), sample_rate=sr)
```
