---
layout: dsp
title: "Python Start"
description: "Python Start"
lang: en
permalink: /dsp/getting-started/python/
---
# Python Start

Use this path to process a planar NumPy array.

<!-- DSP-RELEASE-NOTICE -->
> **Release state:** python is **published** for 0.1.0. The verified package matches these 0.1.0 docs.

```console
pip install effetune==0.1.0
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
