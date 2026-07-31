# EffeTune for Python

Documentation: [effetune.frieve.com/dsp/](https://effetune.frieve.com/dsp/)

Source and issues: [Frieve-A/effetune](https://github.com/Frieve-A/effetune)

`effetune.__version__` comes from installed wheel metadata. An unpacked source
tree without distribution metadata reports `0+source`.

<!-- BEGIN DSP-LIBRARY-PYTHON-SUMMARY -->
EffeTune is a deterministic audio-effects library backed by the same
host-neutral C++20 DSP core used by the EffeTune application. Version 0.1.0
provides 76 semantic effect classes, ordered serial chains, stateful block
processing, semantic presets, bounded impulse-response bundles, and a small
audio-file CLI.
<!-- END DSP-LIBRARY-PYTHON-SUMMARY -->

## Install and process

<!-- BEGIN DSP-LIBRARY-PYTHON-START -->
```console
pip install effetune
```

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
<!-- END DSP-LIBRARY-PYTHON-START -->

Generated effect constructors and `create_effect()` accept Python `snake_case`
keywords:

```python
shift = et.PitchShifter(pitch_shift=3)
same_shift = et.create_effect("PitchShifter", pitch_shift=3)
```

Chain JSON and scheduled event parameter objects use semantic catalog names,
such as `pitchShift`. CamelCase semantic names are not constructor aliases.

Audio arrays are C-contiguous planar `float32` with shape
`(channels, frames)`. Offline calls return a new array and start from fresh
DSP state. No resampling is performed.

SoundFile returns `(frames, channels)`. Convert decoded files explicitly:

```python
import numpy as np
import soundfile as sf

decoded, sample_rate = sf.read("input.wav", dtype="float32", always_2d=True)
audio = np.ascontiguousarray(decoded.T, dtype=np.float32)
output = chain.process(audio, sample_rate=sample_rate)
sf.write("output.wav", output.T, sample_rate, subtype="FLOAT")
```

For persistent filter history and tails:

```python
with chain.stream(48_000, channels=2, block_size=512, seed=42) as stream:
    first = stream.process(block_a)
    second = stream.process(block_b)
    stream.reset()
```

`block_size` must be from 1 through 16384 and controls the largest native
processing window; `process()` may receive a longer array and partitions it
internally. Parameter events use
frame offsets relative to that `process()` input. They must be ordered,
identify an enabled effect with an explicit `id`, and provide one or more
semantic parameter updates:

```python
output = stream.process(audio, events=[
    {"frame": 0, "effectId": "voice", "parameters": {"threshold": -24}},
    {"frame": 0, "effectId": "voice", "parameters": {"ratio": 6}},
])
```

Each event is merged with the effect's current parameters. Frame zero applies
before the first sample. Multiple events at one frame keep their supplied
order, so later updates see earlier updates. The final frame is not an event
position. `reset()` restores the initial parameters, state, and seed.
Events cannot change parameters that require convolution assets to be staged
again. Open a new stream after changing `IRReverb.channelMode`, `latency`, or
`convolutionRate`; `FIRCrossover.bandCount`, `latencyMode`, or
`filterDelaySamples`; or `latencyMode` / `filterDelaySamples` on
`FiveBandFIRPEQ`, `GroupDelayEQ`, or `RoomEQ`.
`close()` is idempotent. Processing or resetting a closed stream raises
`StateError`.

## Presets and bundles

`Chain.from_preset()` accepts only canonical Chain v1:

```json
{
  "version": 1,
  "chain": [
    {
      "id": "voice",
      "type": "Compressor",
      "enabled": true,
      "channel": "all",
      "parameters": {"threshold": -18, "ratio": 4}
    }
  ]
}
```

Application `pipeline` and `plugins` presets are deliberately separate.
Use `Chain.from_legacy_preset()` or `import_legacy_preset()` to convert an app
preset whose effects form one ordered serial path. Branched and multi-bus
routing is rejected because flattening it would change the acoustic result.
Move or copy the desired effects into one serial path in the app and export it
again, or reproduce the branching in the host around separate Chains.
Unsupported channels, effects, partial short-key arrays, and unknown fields
are reported rather than silently dropped.

`LevelMeter`, `Oscilloscope`, `SpectrumAnalyzer`, `Spectrogram`, and
`StereoMeter` provide opt-in decoded telemetry. Pass `on_telemetry` to
`Chain.process()` or `Chain.stream()`, or manage a streaming subscription:

```python
with chain.stream(48_000, channels=2) as stream:
    unsubscribe = stream.subscribe(lambda frame: print(frame.kind))
    output = stream.process(audio)
    print(stream.dropped_telemetry_frames)
    unsubscribe()
```

The first subscriber enables observations and the last unsubscribe disables
them. Delivered tuples are caller-owned semantic values. Raw DSP telemetry is
not a public API.

`FIRCrossover`, `FiveBandFIRPEQ`, `GroupDelayEQ`, `IRReverb`, and `RoomEQ`
require an `impulseResponse` reference and an asset resolver. The four FIR
filter effects use prepared coefficient impulses at the processing sample rate.
Resolvers return `AssetData` containing finite, C-contiguous planar float32
samples, an integer sample rate, and an explicit or unambiguous topology. The
runtime rejects missing, malformed, hash-mismatched, ambiguous, and
oversized assets. It does not decode or resample an IR.

`Bundle.load(path)` reads either a JSON manifest or a directory containing
`bundle.json`. `Bundle.pack(destination, chain, assets)` writes a deterministic
Bundle v1 directory from Chain v1 and caller-supplied `AssetData`. Its asset
entries use the canonical ETA1 payload:
a 32-byte header, optional 12-byte matrix path records, then planar
little-endian float32 samples. Referenced payloads are restricted to the
bundle directory and verified against manifest metadata, exact length,
SHA-256, header, path records, finite samples, and the native 32 MiB
footprint limit before use:

```python
bundle = et.Bundle.load("room-bundle")
chain = et.Chain.from_preset(
    bundle.chain_document,
    asset_resolver=bundle.resolver,
)
```

The CLI exposes the same writer for decoded IR audio:

```console
effetune bundle pack room-chain.json room-bundle --asset room-ir=room-ir.wav
effetune render input.wav convolved.wav --preset room-bundle --subtype FLOAT
```

`--preset room-bundle/bundle.json` is equivalent. For WAV output, omitting
`--subtype` keeps SoundFile's PCM_16 default; `--subtype FLOAT` preserves
32-bit floating-point samples. `render` prints a one-line warning to standard
error when the default output subtype reduces the input's precision, which
passing `--subtype` explicitly silences, and when the rendered peak exceeds
full scale and is clipped by an integer PCM output. Both warnings leave the
exit code at 0.

`EFFECT_METADATA` is the public machine-readable semantic catalog for all 76
root effect classes. It contains channel choices, parameters, required assets,
telemetry, and latency declarations without private native implementation
details. `Stream.latency_samples` reports aggregate runtime latency and matches
JavaScript `ChainStream.latencySamples` for the same chain and sample rate.
`Chain.latency_samples(sample_rate, ...)` reports the same aggregate without
opening a stream, which aligns offline `process()` output.

## CLI

```console
effetune render input.wav output.wav --preset mastering.json
effetune render input.wav output.wav --preset room-bundle --subtype FLOAT
effetune render input.wav output.flac --chain "[{\"type\":\"Volume\",\"parameters\":{\"volume\":-3}}]"
effetune chain validate mastering.json
effetune preset inspect mastering.json
effetune bundle pack room-chain.json room-bundle --asset room-ir=room-ir.wav
```

Audio decoding and encoding are delegated to SoundFile. The CLI does not
invoke ffmpeg, resample, measure loudness, or change the input sample rate.
`--preset` accepts a Chain file, a Bundle directory, or its `bundle.json`.

## Supported Python wheels

The package supports CPython 3.10 and newer. Nanobind's stable ABI starts at
CPython 3.12, so 3.10 and 3.11 wheels are version-specific. Release jobs build
the 3.12 wheel with CMake 3.26 or newer:

```console
python -m build -Ccmake.define.ET_PYTHON_STABLE_ABI=ON -Cwheel.py-api=cp312
```

That `cp312-abi3` wheel covers supported newer CPython versions. This is a
private static-link extension; the repository's wasm32 C ABI is not exposed as
a native public ABI. Linux x86-64, Windows AMD64, macOS Intel, and macOS Apple
Silicon wheels are built and clean-install tested independently.

Official Python releases are wheels only. An sdist built from this subproject
would omit DSP sources located above the Python package directory, so source
builds are supported only from a complete EffeTune repository checkout.
