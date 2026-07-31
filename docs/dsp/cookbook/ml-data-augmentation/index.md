---
layout: dsp
title: "ML data augmentation"
description: "ML data augmentation"
lang: en
permalink: /dsp/cookbook/ml-data-augmentation/
---
# ML data augmentation

**Goal:** create repeatable seeded audio degradation without using the EffeTune app.
Use a candidate or verified Python wheel and the canonical experiment fixture.

```python
import numpy as np
import effetune as et

frames = 4096
phase = np.arange(frames, dtype=np.float32)
mono = (0.5 * np.sin(2 * np.pi * phase / 97)).astype(np.float32)
audio = np.ascontiguousarray(np.stack((mono, mono)))
chain = et.Chain([et.SimpleJitter(rms_jitter_nanoseconds=100)])

first = chain(audio, 48_000, seed=0)
repeat = chain(audio, 48_000, seed=0)
variant = chain(audio, 48_000, seed=1)
assert first.tobytes() == repeat.tobytes()
assert first.tobytes() != variant.tobytes()
for output in (first, repeat, variant):
    assert np.isfinite(output).all() and np.max(np.abs(output)) <= 1
```

The same seed must produce byte-identical float32 output in the same installed artifact
and environment. The different seed must change output. All output must remain finite
and within [-1, 1].
