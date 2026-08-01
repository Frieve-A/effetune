---
layout: dsp
title: "CLI Start"
description: "CLI Start"
lang: en
permalink: /dsp/getting-started/cli/
---
# CLI Start

Use this path to validate a Chain and render files with the Python package.

<!-- DSP-RELEASE-NOTICE -->
> **Release state:** python is **published** for 0.1.0. The verified package matches these 0.1.0 docs.

```console
pip install effetune==0.1.0
```

Save the following as `start.py` and run `python start.py`. It creates both
`input.wav` and `volume.json` without ffmpeg:

```python
import json
import math
from pathlib import Path
import struct
import wave

rate = 48_000
frames = 4096
with wave.open("input.wav", "wb") as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(rate)
    for frame in range(frames):
        sample = round(0.5 * math.sin(2 * math.pi * frame / 97) * 32767)
        output.writeframesraw(struct.pack("<hh", sample, sample))

Path("volume.json").write_text(
    json.dumps({
        "version": 1,
        "chain": [{
            "id": "volume",
            "type": "Volume",
            "parameters": {"volume": -6},
        }],
    }, indent=2) + "\n",
    encoding="utf-8",
)
```

```console
effetune chain validate volume.json
effetune render input.wav output.wav --preset volume.json
effetune preset inspect volume.json
```

The CLI delegates codecs to SoundFile and does not resample, call ffmpeg, or measure
loudness. It preserves the input sample rate and channel count.

## Batch rendering

The CLI has no special batch operation. Run this source from an empty directory. It
creates `batch-demo/inputs`, `batch-demo/outputs`, the Volume preset, two valid
WAV files, and one invalid WAV. It prints the one expected file failure, verifies that
both valid files were written, and exits successfully:

```python
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import wave

workspace = Path("batch-demo")
inputs = workspace / "inputs"
outputs = workspace / "outputs"
inputs.mkdir(parents=True)
outputs.mkdir()
preset = workspace / "volume.json"
preset.write_text(json.dumps({
    "version": 1,
    "chain": [{
        "id": "volume",
        "type": "Volume",
        "parameters": {"volume": -6},
    }],
}), "utf-8")


def write_wave(target, period):
    with wave.open(str(target), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(48_000)
        for frame in range(4096):
            sample = round(0.5 * math.sin(2 * math.pi * frame / period) * 32767)
            output.writeframesraw(struct.pack("<hh", sample, sample))


write_wave(inputs / "first.wav", 97)
write_wave(inputs / "second.wav", 193)
(inputs / "invalid.wav").write_bytes(b"not a wave file")

failures = []
for source in sorted(inputs.glob("*.wav")):
    target = outputs / source.name
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "effetune",
            "render",
            str(source),
            str(target),
            "--preset",
            str(preset),
        ],
        check=False,
    )
    if result.returncode:
        failures.append((source, result.returncode))

rendered = sorted(path.name for path in outputs.glob("*.wav"))
assert rendered == ["first.wav", "second.wav"]
assert len(failures) == 1 and failures[0][0].name == "invalid.wav"
for source, code in failures:
    print(f"{source}: render failed with exit code {code}")
```

## API

| Command | Purpose and options |
|---|---|
| `effetune render INPUT OUTPUT (--preset PRESET | --chain CHAIN) [--subtype SUBTYPE]` | Render one file. `PRESET` accepts Chain JSON, a Bundle directory, or its `bundle.json`. `CHAIN` accepts a JSON string or JSON file. `SUBTYPE` is passed to SoundFile; for WAV, omission keeps its PCM_16 default and `FLOAT` writes 32-bit float. |
| `effetune chain validate DOCUMENT` | Validate canonical Chain v1 and runtime-only rules. |
| `effetune preset inspect DOCUMENT` | Print the materialized canonical Chain v1 document. |
| `effetune bundle pack DOCUMENT DESTINATION [--asset REF=FILE ...]` | Write a Bundle directory. Supply each referenced IR exactly once. |

Successful commands return 0. Argument errors and plain-language library failures return
non-zero; file-rendering scripts can handle one failure and continue with other files.
`effetune render` also prints a warning to standard error, while still exiting 0, when
the default output subtype reduces the input's precision (for example a 24-bit or float
input written as the WAV `PCM_16` default) and when the rendered peak exceeds full
scale and is therefore clipped by an integer PCM output. Passing `--subtype`
explicitly silences the precision warning; the clipping warning is independent of
`--subtype`, but it only fires when an integer PCM output actually clips the peak, so a
float output such as `--subtype FLOAT` never triggers it:

```console
effetune: warning: PCM_24 input written as PCM_16 output; precision is reduced. Pass --subtype to keep more precision.
effetune: warning: rendered peak 3.184857 (+10.06 dBFS) exceeds full scale; samples were clipped by the PCM_16 output.
```
