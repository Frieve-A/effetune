---
layout: dsp
title: "Python API"
description: "Python API"
lang: en
permalink: /dsp/api/python/
---
# Python API

```console
pip install effetune
```

These signatures summarize the typed public surface. The installed `py.typed`
package and generated effect stubs remain authoritative for individual effect options;
the 90 effect signatures are not repeated here.

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
`GraphStream.set_param()` also takes the semantic catalog name (camelCase, for example
`dryLevel`), not the snake_case constructor keyword.

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

## Graph and GraphStream

```python
Graph(document: Any, *, asset_resolver: AssetResolver | None = None)
Graph.from_dict(document: Mapping[str, Any], *, asset_resolver: AssetResolver | None = None) -> Graph
Graph.load(json_text: str, *, asset_resolver: AssetResolver | None = None) -> Graph
Graph.from_chain(chain: Chain, *, asset_resolver: AssetResolver | None = None) -> Graph
Graph.wet_dry(effect: Effect | Mapping[str, Any], *, wet: float = 1.0,
              dry: float = 1.0, node_id: str | None = None,
              input_id: str = "input", output_id: str = "output",
              asset_resolver: AssetResolver | None = None) -> Graph
Graph.send_return(effect: Effect | Mapping[str, Any], *, send: float = 1.0,
                  return_gain: float = 1.0, node_id: str | None = None,
                  input_id: str = "input", output_id: str = "output",
                  asset_resolver: AssetResolver | None = None) -> Graph

graph.to_dict() -> dict[str, Any]
graph.serialize(*, indent: int | None = None) -> str
graph.nodes: tuple[dict[str, Any], ...]
graph.edges: tuple[dict[str, Any], ...]
graph.to_chain() -> Chain
graph.get_node(node_id: str) -> dict[str, Any] | None
graph.get_edge(edge_id: str) -> dict[str, Any] | None
graph.incoming(endpoint_id: str) -> tuple[dict[str, Any], ...]
graph.outgoing(endpoint_id: str) -> tuple[dict[str, Any], ...]
graph.structural_snapshot() -> dict[str, Any]
graph.visualization_snapshot() -> dict[str, Any]
graph.process(audio: np.ndarray, *, sample_rate: float, seed: int = 0,
              block_size: int = 128, asset_resolver: AssetResolver | None = None) -> np.ndarray
graph.latency_samples(sample_rate: float, *, channels: int = 2,
                      block_size: int = 128,
                      asset_resolver: AssetResolver | None = None) -> int
graph.stream(sample_rate: float, *, channels: int, block_size: int = 128,
             seed: int = 0,
             asset_resolver: AssetResolver | None = None) -> GraphStream
graph.close() -> None

graph_stream.graph: dict[str, Any]
graph_stream.closed: bool
graph_stream.latency_samples: int
graph_stream.compile_snapshot: dict[str, Any]
graph_stream.visualization_snapshot() -> dict[str, Any]
graph_stream.set_param(node_id: str, parameter_name: str, value: Any) -> GraphStream
graph_stream.process(audio: np.ndarray) -> np.ndarray
graph_stream.reset() -> GraphStream
graph_stream.close() -> None

wet_dry_graph_document(effect, *, wet=1.0, dry=1.0, node_id=None,
                       input_id="input", output_id="output") -> dict[str, Any]
send_return_graph_document(effect, *, send=1.0, return_gain=1.0, node_id=None,
                           input_id="input", output_id="output") -> dict[str, Any]
```

`wet_dry_graph_document()` and `send_return_graph_document()` are the module-level
equivalents that return the same canonical documents `Graph.wet_dry()` and
`Graph.send_return()` build from; their canonical IDs are listed in
[Graph v1](/dsp/reference/graph-v1/#recipes). `node_id` defaults to the effect's own ID
and falls back to `wet` or `return`; `input_id` and `output_id` default to
`input` and `output`.

`Graph.load()` reads Graph JSON text, not a file path or URL. `to_dict()`, query
results, and snapshots are caller-owned copies; treat snapshots as read-only diagnostics.
`to_chain()` accepts only an empty Graph or one serial path whose edges all use identity
controls; it returns a new `Chain`. A GraphStream is a context manager: entering returns
the open stream and exiting closes it. `closed` remains readable after close; processing,
resetting, parameter updates, and runtime-property inspection then raise `StateError`.
`process()` uses fresh state by opening and closing a stream internally. Graph stream
preparation performs native instance/asset preparation and graph compilation, so it can
fail after the document has already loaded. `GraphStream.process()` accepts only audio
and has no `events=` keyword; supplying one raises a plain Python `TypeError`, which is
outside the `EffeTuneError` hierarchy. The JavaScript surface instead raises
`ValidationError` for a second options argument. Call `set_param()` only between
process calls; an update outside the stream-safe allowlist raises `ValidationError` with
`GRAPH_RECONFIGURATION_REQUIRED`. An unknown node ID raises
`GRAPH_DOCUMENT_REFERENCE` and a value the catalog rejects raises
`GRAPH_DOCUMENT_PARAMETER`, both as `ValidationError`. `reset()` restores initial
parameters and state, and `close()` is idempotent.

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

`EFFECT_METADATA` is the machine-readable catalog, `EFFECT_CLASSES` maps all 90
semantic names to their classes, and
`create_effect(effect_type: str, **options: object) -> Effect` is the generic
constructor. `Stream.latency_samples` is the live aggregate, distinct from catalog
latency declarations.

## Errors

`ValidationError` covers audio, document, event, and option validation;
`EffectError` covers unknown effects; `AssetError` covers assets and bundles;
`EffeTuneRuntimeError` covers backend failures; and `StateError` covers invalid
lifecycle operations. All derive from `EffeTuneError`.
