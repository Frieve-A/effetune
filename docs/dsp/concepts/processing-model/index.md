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

Catalog latency badges are qualitative declarations. Python
`Stream.latency_samples` and JavaScript `ChainStream.latencySamples` expose the same
runtime aggregate. `Chain.latency_samples()` in Python and `chain.latencySamples()`
in JavaScript report the same aggregate without opening a stream, so offline
`process()` output can be phase-aligned.
`EffeTuneNode.latencySamples` exposes the cached real-time aggregate. Creation and
awaited `setParam()` or `reset()` calls update it before returning.

## Source-generating effects

The docs overlay explicitly marks types that can intentionally produce non-zero output
from zero input at an active setting and sample rate. The candidate-package gate runs
all 83 catalog types exactly once, using the same canonical assets as the public asset
examples where required. It requires the overlay, public catalog, and frozen
`source-generation-v0.1.json` member sets to match exactly, and treats a peak above
`1e-7` as generated output. Those effect pages carry a warning; the absence of that
mark is a fixture result for the selected settings, not proof that every possible future
setting is non-generating.

Render such an effect by processing a zero input whose frame count defines the rendered
length:

```python
rendered = chain.process(np.zeros((2, frames), np.float32), sample_rate=sr)
```
