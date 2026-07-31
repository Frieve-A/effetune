---
layout: dsp
title: "Python API"
description: "Python API"
lang: en
permalink: /dsp/api/python/
---
# Python API

<!-- DSP-RELEASE-NOTICE -->
> **Release state:** python is **unreleased**. The public install command is intentionally disabled until a version-matched smoke test passes.


These signatures summarize the typed public surface. The installed `py.typed`
package and generated effect stubs remain authoritative for individual effect options;
the 76 effect signatures are not repeated here.

## Effect names and constructor keywords

Generated effect constructors and `create_effect()` accept Python `snake_case`
keywords. Chain JSON, scheduled event parameter objects, and the machine-readable
catalog keep their semantic names:

```python
shift = PitchShifter(pitch_shift=3)
same_shift = create_effect("PitchShifter", pitch_shift=3)

chain_document = {
    "version": 1,
    "chain": [{
        "type": "PitchShifter",
        "parameters": {"pitchShift": 3},
    }],
}
```

`pitchShift` is not an alias for the `pitch_shift` constructor keyword. Every
effect page lists both names directly from the generated catalog.

## Chain

```python
Chain(effects: Iterable[Effect] = (), *, asset_resolver: AssetResolver | None = None)
Chain.from_preset(source: Any, *, asset_resolver: AssetResolver | None = None) -> Chain
Chain.from_legacy_preset(source: Any, *, asset_resolver: AssetResolver | None = None) -> tuple[Chain, LegacyImportReport]
Chain.from_bundle(source: str) -> Chain

chain.to_dict() -> dict[str, Any]
chain.process(
    audio: np.ndarray,
    *,
    sample_rate: float,
    seed: int = 0,
    block_size: int = 128,
    asset_resolver: AssetResolver | None = None,
    on_telemetry: Callable[[TelemetryFrame], None] | None = None,
) -> np.ndarray
chain(audio: np.ndarray, sample_rate: float, **options) -> np.ndarray
chain.stream(
    sample_rate: float,
    *,
    channels: int,
    block_size: int = 128,
    seed: int = 0,
    asset_resolver: AssetResolver | None = None,
    on_telemetry: Callable[[TelemetryFrame], None] | None = None,
) -> Stream
chain.latency_samples(
    sample_rate: float,
    *,
    channels: int = 2,
    block_size: int = 128,
    asset_resolver: AssetResolver | None = None,
) -> int
```

`process()` returns a new planar, C-contiguous `float32` array and starts fresh
state. `stream()` returns a stateful context. `from_bundle()` accepts a Bundle
directory or its `bundle.json`.

`latency_samples()` reports the same aggregate an opened stream would report for that
sample rate and channel layout, without processing audio. Offline `process()` output is
not latency-compensated, so use this value to align it against the input.

## Stream

```python
stream.process(
    audio: np.ndarray,
    *,
    events: Iterable[Mapping[str, object]] = (),
) -> np.ndarray
stream.subscribe(callback: Callable[[TelemetryFrame], None]) -> Callable[[], bool]
stream.unsubscribe(callback: Callable[[TelemetryFrame], None]) -> bool
stream.reset() -> None
stream.close() -> None

stream.closed: bool
stream.latency_samples: int
stream.dropped_telemetry_frames: int
```

Event parameter objects are partial updates. Events use zero-based frames relative to
the current input, must be in non-decreasing frame order, and merge in supplied order
when several share a frame. A Stream is a context manager; processing, resetting, or
inspecting runtime properties after close raises `StateError`.
Asset-configuration parameters listed under
[Streaming and events](/dsp/concepts/streaming-and-events/) require a newly opened
stream.

## Assets and bundles

```python
AssetData(
    samples: np.ndarray,
    sample_rate: int,
    kind: str = "impulseResponse",
    topology: str = "automatic",
    paths: tuple[ConvolutionPath, ...] = (),
    input_count: int | None = None,
)
ConvolutionPath(input_slot: int, output_slot: int, ir_channel: int)

Bundle.load(source: str | Path) -> Bundle
Bundle.pack(
    destination: str | Path,
    chain: Mapping[str, Any],
    assets: Mapping[str, AssetData | Mapping[str, Any]],
) -> Bundle
bundle.manifest: Mapping[str, Any]
bundle.chain_document: Mapping[str, Any]
bundle.resolver(reference: str) -> AssetData | None
```

`AssetData.samples` must be finite, planar, C-contiguous `float32`. Bundle methods
raise `ValidationError` for documents/paths and `AssetError` for missing, malformed,
oversized, or unverifiable IR assets.

## Telemetry and catalog

`Chain.process(..., on_telemetry=callback)`, `Chain.stream(...,
on_telemetry=callback)`, and Stream subscriptions deliver decoded
`TelemetryFrame` subclasses. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry)
for exact frame fields.

`EFFECT_METADATA` is the machine-readable catalog, `EFFECT_CLASSES` maps all 76
semantic names to their classes, and
`create_effect(effect_type: str, **options: object) -> Effect` is the generic
constructor. `Stream.latency_samples` is the live aggregate, distinct from catalog
latency declarations.

## Errors

`ValidationError` covers audio, document, event, and option validation;
`EffectError` covers unknown effects; `AssetError` covers assets and bundles;
`EffeTuneRuntimeError` covers backend failures; and `StateError` covers invalid
lifecycle operations. All derive from `EffeTuneError`.
