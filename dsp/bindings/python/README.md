# EffeTune for Python

Documentation: [effetune.frieve.com/dsp/](https://effetune.frieve.com/dsp/)

Graph v1 is opt-in. Its current capacities and delay-storage accounting are
published in the [Graph v1 guide](https://effetune.frieve.com/dsp/reference/graph-v1/#capacity).

Source and issues: [Frieve-A/effetune](https://github.com/Frieve-A/effetune)

`effetune.__version__` comes from installed wheel metadata. An unpacked source
tree without distribution metadata reports `0+source`.

<!-- BEGIN DSP-LIBRARY-PYTHON-SUMMARY -->
EffeTune is a deterministic audio-effects library backed by the same
host-neutral C++20 DSP core used by the EffeTune application. Version 0.8.0
provides 92 semantic effect classes, ordered serial chains, stateful block
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

### Graph v1 quickstart

Graph v1 is opt-in routing for branching and merging:

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
`FiveBandFIRPEQ`, `GroupDelayEQ`, `GroupDelayPEQ`, or `RoomEQ`.
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

`FIRCrossover`, `FiveBandFIRPEQ`, `GroupDelayEQ`, `GroupDelayPEQ`, `IRReverb`,
and `RoomEQ` require an `impulseResponse` reference and an asset resolver. The
five FIR filter effects use prepared coefficient impulses at the processing
sample rate.
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

`EFFECT_METADATA` is the public machine-readable semantic catalog for all 92
root effect classes. It contains channel choices, parameters, required assets,
telemetry, and latency declarations without private native implementation
details. `Stream.latency_samples` reports aggregate runtime latency and matches
JavaScript `ChainStream.latencySamples` for the same chain and sample rate.
`Chain.latency_samples(sample_rate, ...)` reports the same aggregate without
opening a stream, which aligns offline `process()` output.

### Modulation system-preset recipes

The application exposes these settings as system presets. The following
dictionaries use their equivalent Python constructor parameter names. Copy one
into a named constructor, for example
`Chorus(**MODULATION_STYLES["Chorus"]["Flanger"])`, or use it as the effect's
recipe when building Chain JSON (where `to_dict()` emits semantic camel-case
parameter names).

```python
MODULATION_STYLES = {
    "AutoFilter": {
        "Auto Filter Sweep": {"mode": "LFO", "filter_type": "Low-pass", "minimum_frequency": 200, "maximum_frequency": 4000, "resonance": 1.5, "mix": 80, "rate": 0.5, "waveform": "Sine", "stereo_phase": 0, "sensitivity": 24, "attack": 20, "release": 250, "direction": "Up"},
        "Stereo Filter Sweep": {"mode": "LFO", "filter_type": "Low-pass", "minimum_frequency": 160, "maximum_frequency": 6000, "resonance": 2, "mix": 85, "rate": 0.35, "waveform": "Sine", "stereo_phase": 120, "sensitivity": 24, "attack": 20, "release": 250, "direction": "Up"},
        "Envelope Filter": {"mode": "Envelope", "filter_type": "Low-pass", "minimum_frequency": 100, "maximum_frequency": 5000, "resonance": 1.2, "mix": 85, "rate": 0.5, "waveform": "Sine", "stereo_phase": 0, "sensitivity": 24, "attack": 18, "release": 300, "direction": "Up"},
        "Auto Wah": {"mode": "Envelope", "filter_type": "Band-pass", "minimum_frequency": 180, "maximum_frequency": 2400, "resonance": 5, "mix": 100, "rate": 0.5, "waveform": "Sine", "stereo_phase": 0, "sensitivity": 30, "attack": 8, "release": 180, "direction": "Up"},
        "Reverse Auto Wah": {"mode": "Envelope", "filter_type": "Band-pass", "minimum_frequency": 180, "maximum_frequency": 2800, "resonance": 4, "mix": 100, "rate": 0.5, "waveform": "Sine", "stereo_phase": 0, "sensitivity": 30, "attack": 12, "release": 350, "direction": "Down"},
    },
    "AutoPan": {
        "Gentle Auto Pan": {"rate": 0.35, "depth": 45, "center": 0, "width": 70, "waveform": "Sine", "phase": 0},
        "Wide Auto Pan": {"rate": 0.7, "depth": 100, "center": 0, "width": 100, "waveform": "Sine", "phase": 0},
        "Fast Auto Pan": {"rate": 4, "depth": 85, "center": 0, "width": 100, "waveform": "Triangle", "phase": 0},
    },
    "Chorus": {
        "Classic Chorus": {"mode": "Chorus", "rate": 0.8, "delay": 12, "depth": 3, "voices": 3, "stereo_spread": 60, "feedback": 0, "mix": 45},
        "Stereo Chorus": {"mode": "Stereo Chorus", "rate": 0.65, "delay": 15, "depth": 4, "voices": 2, "stereo_spread": 80, "feedback": 0, "mix": 50},
        "Ensemble": {"mode": "Ensemble", "rate": 0.45, "delay": 20, "depth": 6, "voices": 6, "stereo_spread": 100, "feedback": 0, "mix": 60},
        "Flanger": {"mode": "Flanger", "rate": 0.35, "delay": 2.5, "depth": 2, "voices": 1, "stereo_spread": 35, "feedback": 45, "mix": 50},
        "Jet Flanger": {"mode": "Flanger", "rate": 0.18, "delay": 1.5, "depth": 1.4, "voices": 1, "stereo_spread": 70, "feedback": -75, "mix": 55},
        "Vibrato": {"mode": "Vibrato", "rate": 4.5, "delay": 8, "depth": 5, "voices": 1, "stereo_spread": 50, "feedback": 0, "mix": 100},
    },
    "FrequencyShifter": {
        "Shift Up": {"mode": "Shift", "shift": 8, "carrier_frequency": 440, "minimum_shift": 20, "maximum_shift": 800, "rate": 0.15, "direction": "Up", "stereo_phase": 0, "mix": 100},
        "Shift Down": {"mode": "Shift", "shift": -8, "carrier_frequency": 440, "minimum_shift": 20, "maximum_shift": 800, "rate": 0.15, "direction": "Down", "stereo_phase": 0, "mix": 100},
        "Fine Detune": {"mode": "Shift", "shift": 2, "carrier_frequency": 440, "minimum_shift": 20, "maximum_shift": 800, "rate": 0.15, "direction": "Up", "stereo_phase": 90, "mix": 55},
        "Ring Modulator": {"mode": "Ring Mod", "shift": 8, "carrier_frequency": 440, "minimum_shift": 20, "maximum_shift": 800, "rate": 0.15, "direction": "Up", "stereo_phase": 0, "mix": 100},
        "Barber-pole Up": {"mode": "Barber-pole", "shift": 8, "carrier_frequency": 440, "minimum_shift": 20, "maximum_shift": 900, "rate": 0.12, "direction": "Up", "stereo_phase": 90, "mix": 85},
        "Barber-pole Down": {"mode": "Barber-pole", "shift": -8, "carrier_frequency": 440, "minimum_shift": 20, "maximum_shift": 900, "rate": 0.12, "direction": "Down", "stereo_phase": 90, "mix": 85},
    },
    "Phaser": {
        "Classic Phaser": {"mode": "Classic", "rate": 0.5, "center_frequency": 1000, "range": 3, "stages": 6, "feedback": 20, "stereo_phase": 90, "direction": "Up", "mix": 50},
        "Deep Phaser": {"mode": "Classic", "rate": 0.25, "center_frequency": 700, "range": 4.5, "stages": 12, "feedback": 55, "stereo_phase": 30, "direction": "Up", "mix": 55},
        "Stereo Phaser": {"mode": "Classic", "rate": 0.65, "center_frequency": 1200, "range": 3.5, "stages": 8, "feedback": 25, "stereo_phase": 120, "direction": "Up", "mix": 50},
        "Barber-pole Up": {"mode": "Barber-pole", "rate": 0.35, "center_frequency": 1000, "range": 5, "stages": 8, "feedback": 30, "stereo_phase": 60, "direction": "Up", "mix": 55},
        "Barber-pole Down": {"mode": "Barber-pole", "rate": 0.35, "center_frequency": 1000, "range": 5, "stages": 8, "feedback": 30, "stereo_phase": 60, "direction": "Down", "mix": 55},
    },
    "RotarySpeaker": {
        "Rotary Slow": {"speed_state": "Slow", "speed": 100, "acceleration": 2.2, "crossover": 800, "rotor_balance": 0, "stereo_width": 75, "doppler_depth": 45, "amplitude_depth": 55, "mix": 70},
        "Rotary Fast": {"speed_state": "Fast", "speed": 100, "acceleration": 1.4, "crossover": 800, "rotor_balance": 0, "stereo_width": 85, "doppler_depth": 65, "amplitude_depth": 70, "mix": 78},
        "Gentle Rotary": {"speed_state": "Slow", "speed": 75, "acceleration": 3, "crossover": 900, "rotor_balance": 0, "stereo_width": 45, "doppler_depth": 25, "amplitude_depth": 30, "mix": 55},
        "Vintage Rotor Slow": {"speed_state": "Slow", "speed": 100, "acceleration": 2.8, "crossover": 800, "rotor_balance": -5, "stereo_width": 80, "doppler_depth": 50, "amplitude_depth": 60, "mix": 75},
        "Vintage Rotor Fast": {"speed_state": "Fast", "speed": 100, "acceleration": 1.8, "crossover": 800, "rotor_balance": -5, "stereo_width": 90, "doppler_depth": 70, "amplitude_depth": 75, "mix": 82},
    },
}
```

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
