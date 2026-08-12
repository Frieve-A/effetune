---
layout: dsp
title: "Python Start"
description: "Python Start"
lang: en
permalink: /dsp/getting-started/python/
---
# Python Start

Use this path to process a planar NumPy array.

```console
pip install effetune
```

Wheels target CPython 3.10+ on manylinux x86-64, Windows AMD64, macOS Intel, and
macOS Apple Silicon. musllinux is not provided. Input must be C-contiguous
`float32` with shape `(channels, frames)`; the core does not resample.

Generated effect constructors and `create_effect()` accept Python
`snake_case` keywords:

```python
shift = et.PitchShifter(pitch_shift=3)
same_shift = et.create_effect("PitchShifter", pitch_shift=3)
```

Chain JSON and scheduled event parameter objects use the semantic catalog name
`pitchShift`. The camelCase semantic name is not a Python constructor alias.

```python
import numpy as np
import effetune as et

frames = 512
phase = np.arange(frames, dtype=np.float32)
mono = (0.5 * np.sin(2 * np.pi * phase / 97)).astype(np.float32)
audio = np.ascontiguousarray(np.stack((mono, mono)))
chain = et.Chain([et.Volume(volume=-6)])
output = chain.process(audio, sample_rate=48_000)
print(output.shape, float(np.max(np.abs(output))))
```

Offline calls start with fresh state. Use `Chain.stream()` when filter history,
tails, or seeded random state must continue. See [Python API](/dsp/api/python/)
and [Determinism](/dsp/concepts/determinism/).

## Graph v1 quickstart

Graph v1 is opt-in routing for branching and merging. This complete example uses the
wet/dry recipe, processes once with fresh state, then opens a stateful static stream and
reads its prepared compile snapshot:

```python
import numpy as np
import effetune as et

audio = np.full((2, 128), 0.25, dtype=np.float32)
graph = et.Graph.wet_dry(
    et.Volume(id="wet", volume=-6),
    dry=0.5,
    wet=0.5,
)
stream = None

try:
    offline = graph.process(audio, sample_rate=48_000)
    stream = graph.stream(48_000, channels=2, block_size=128)
    continuous = stream.process(audio)
    print(
        float(offline[0, 0]),
        float(continuous[0, 0]),
        stream.latency_samples,
        stream.compile_snapshot["effectiveSchedule"],
    )
finally:
    if stream is not None:
        stream.close()
    graph.close()
```

See [Graph v1](/dsp/reference/graph-v1/) for the document contract, conversion from a
Chain, capacity, and stable error fields.

## Reading an audio file

SoundFile returns `(frames, channels)`. Convert it explicitly to the library's
planar, C-contiguous `float32` layout:

```python
import numpy as np
import soundfile as sf

decoded, sample_rate = sf.read("input.wav", dtype="float32", always_2d=True)
audio = np.ascontiguousarray(decoded.T, dtype=np.float32)
output = chain.process(audio, sample_rate=sample_rate)
sf.write("output.wav", output.T, sample_rate, subtype="FLOAT")
```
