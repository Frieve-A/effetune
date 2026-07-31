# EffeTune DSP high-level API design

Status: Phase 0 design conclusion, 2026-07-28

This document fixes the high-level product boundary needed to proceed to
Phase 1. It is a design, not a released API or a promise of v1 compatibility.
The Phase 0 runtime remains the narrow Compressor PoC.

## Phase status

| Surface | Phase 0 status |
|---|---|
| Python `Compressor.process()` over the existing C++ kernel | **Implemented in Phase 0** |
| Real Chromium `CompressorWorklet` over baseline and SIMD WASM | **Implemented in Phase 0** |
| Semantic `Effect`, `Compressor`, and ordered `Chain` API | **Designed in Phase 0** |
| Python offline/call/stream/preset API and JavaScript offline/worklet API | **Designed in Phase 0** |
| Input layout, ownership, lifecycle, seed, errors, assets, preset boundaries, and telemetry boundary | **Designed in Phase 0** |
| Runtime `Chain`, streaming wrapper, preset importer, asset loading, full telemetry facade, and arbitrary kernels | **Deferred to Phase 1+** |
| File decode/encode, CLI, wheels/npm packages, bundles, automation, and full distribution support | **Deferred to Phase 1+** |

## Semantic model

`Effect` is the public semantic base type. An effect has a semantic type,
long-name parameters, an enabled flag, and optionally a caller-owned instance
ID. Internal registry names, generated parameter structs, packed fields,
layout hashes, and WASM handles are not properties of `Effect`.

`Compressor` is the only Phase 0 effect. Its six public parameters and defaults
are those in
[`chain-v1.schema.json`](chain-v1.schema.json). Phase 1 may add effect classes
without changing the shape of `Effect` or `Chain`.

`Chain` contains an ordered list of effects. Processing is strictly serial:
the output of entry `n` is the input of entry `n + 1`; disabled entries copy
through; an empty chain is the identity. Routing, buses, and parallel graphs
are not part of this chain contract.

The semantic document form is exactly:

```json
{
  "version": 1,
  "chain": [
    {
      "id": "voice",
      "type": "Compressor",
      "enabled": true,
      "parameters": {
        "threshold": -24,
        "ratio": 4
      }
    }
  ]
}
```

Schema `default` keywords are annotations. Loading wrappers materialize missing
semantic defaults before creating runtime state; validation alone never
modifies input. Duplicate explicit IDs are a validation error. For offline-only
documents an ID may be omitted; a wrapper may assign an instance ID, but
callers that need `setParam` use explicit IDs.

## Python surface

The designed public shape is:

```python
import effetune as et

compressor = et.Compressor(
    threshold=-24,
    ratio=4,
    attack=5,
    release=100,
    knee=3,
    gain=0,
)
chain = et.Chain([compressor])

output = chain.process(audio, sample_rate=48_000, seed=42)
same = chain(audio, 48_000, seed=42)

with chain.stream(
    sample_rate=48_000,
    channels=2,
    block_size=512,
    seed=42,
) as stream:
    for block in input_blocks:
        output_block = stream.process(block)
    stream.reset()

chain = et.Chain.from_preset(
    preset_document_or_path,
    asset_resolver=resolver,
)
```

`Effect.process()`, `Chain.process()`, and `Chain.__call__()` are offline
operations. Each call creates fresh DSP state, so prior calls cannot affect the
result. `__call__(audio, sample_rate, **options)` is an exact convenience alias
for `process(audio, sample_rate=sample_rate, **options)`.

`Chain.stream()` creates state once. Consecutive `process()` calls preserve
filter history, delay tails, and random-generator state. `reset()` restores the
same initial state and seed without replacing the stream. `close()` releases
native resources and is idempotent; processing or resetting after close raises
`StateError`. Context-manager exit always closes the stream. `block_size` is the
maximum accepted frame count, and a shorter final block is valid.

### Python audio and ownership contract

- Audio is a C-contiguous NumPy `float32` array shaped `(channels, frames)`.
- The sample rate is a positive finite value in Hz and is explicit on every
  offline call or stream creation.
- Offline and stream processing return a new C-contiguous array and do not
  mutate or retain the caller's input.
- A stream's channel count is fixed at creation. A block with another channel
  count, a non-planar layout, another dtype, or more than `block_size` frames is
  a `ValidationError`.
- File decoding and encoding are outside the DSP API. Applications provide
  decoded planar float32 audio and choose `soundfile`, ffmpeg, or another I/O
  layer themselves.

The current Phase 0 `Compressor` already implements the offline copy and input
layout behavior. `Chain`, `__call__`, `stream()`, `reset()`, `close()`, seed
handling, and preset loading are designs for Phase 1.

## JavaScript and AudioWorklet surface

The designed offline API mirrors Python:

```js
import { createChain } from '@effetune/dsp';

const chain = await createChain(chainDocument, { assetResolver });
const output = chain.process(planarFloat32, {
  sampleRate: 48000,
  seed: 42
});
chain.close();
```

`planarFloat32` is an array of equal-length `Float32Array` channels. Processing
returns newly owned channel arrays and does not retain the inputs. Each
`process()` call has fresh DSP state. `close()` is idempotent and makes later
processing a `StateError`.

The designed real-time API owns one stateful chain inside one AudioWorklet:

```js
import { EffeTuneNode } from '@effetune/dsp/worklet';

const node = await EffeTuneNode.create(audioContext, chainDocument, {
  assetResolver,
  seed: 42
});
source.connect(node).connect(audioContext.destination);
await node.setParam('voice', 'threshold', -20);
await node.reset();
node.close();
```

`setParam(effectId, parameterName, value)` accepts semantic long names,
validates the value, and resolves after the worklet acknowledges application
at its next safe processing boundary. It does not expose packed parameters or
sample-offset automation. The worklet retains DSP state until `reset()` or
`close()`. `reset()` restores the initial state and seed while keeping the
node usable. `close()` disconnects communication and releases wrapper-owned
resources; it is idempotent, and later mutation raises `StateError`.

The current Phase 0 `CompressorWorklet` proves WASM AudioWorklet execution only.
It does not implement `EffeTuneNode`, a runtime chain, parameter mutation,
reset, or the lifecycle contract above.

## Determinism and seed

The public seed is an integer in the inclusive range `0` to `2^32 - 1`.
Wrappers reject booleans, fractions, negative values, and larger integers.
The default seed is zero. With the same library/artifact version, semantic
chain, sample rate, channel layout, block schedule, seed, and input samples,
processing is deterministic. Wrappers may expand the public `uint32` seed into
private kernel seed material; that representation is not public ABI.

Fresh offline calls restart from the public seed. Streams and worklets advance
state as they process and return to the initial seed on `reset()`. Cross-block
equivalence is guaranteed only for block schedules covered by the relevant
kernel contract and parity tests.

## Presets, schema, legacy data, and assets

`Chain.from_preset()` accepts only the semantic chain document validated
against the matching schema version. A path argument means that the Python
wrapper reads UTF-8 JSON before validation; file I/O does not enter the DSP
core. The Phase 0
[`chain-v1.schema.json`](chain-v1.schema.json) covers Compressor only.

The current EffeTune application preset forms (`pipeline` with long fields and
`plugins` with short fields) are separate formats. `from_preset()` must not
guess, coerce, or claim direct compatibility with them. A separately named
Phase 1 legacy importer converts a recognized application preset into a
canonical semantic chain document and reports unsupported routing, effects,
or fields. The semantic schema version selects migration logic; packed layout
hashes only check wrapper/artifact compatibility.

Effects that need external data receive semantic asset references from a
future schema extension. The caller supplies an asset resolver:

```python
def resolver(reference: et.AssetReference) -> et.AssetData | None:
    ...
```

The wrapper resolves and validates all required assets before preparing DSP
state. Missing, unreadable, wrong-kind, or malformed data raises `AssetError`
and identifies the semantic effect ID and asset reference. A wrapper never
silently bypasses an effect because an asset is missing. The concrete bundle
manifest and asset-reference JSON shape are Phase 1 work; they are
intentionally absent from the Compressor-only Phase 0 schema.

## Error contract

Both language surfaces expose the same typed categories:

| Category | Meaning |
|---|---|
| `ValidationError` | Invalid document, audio layout, sample rate, seed, parameter, duplicate ID, or option |
| `EffectError` | Unknown, unavailable, or unsupported semantic effect type |
| `AssetError` | Required asset cannot be resolved or validated |
| `EffeTuneRuntimeError` | DSP preparation or processing failure, incompatible artifact, or internal runtime status |
| `StateError` | Operation is invalid for the wrapper lifecycle, such as processing after close |

Python exceptions derive from `EffeTuneError`; JavaScript error classes derive
from `EffeTuneError`. Raw numeric C ABI status values, stack traces, and
worklet message payloads remain diagnostics and are not the public error
contract.

## Telemetry boundary

Telemetry is opt-in and wrapper-owned. Python offline/stream operations accept
an optional callback receiving decoded, named `TelemetryFrame` values.
`EffeTuneNode` provides the equivalent subscription and unsubscribe function.
Callbacks never run on the real-time DSP thread, and slow consumers may receive
a dropped-frame count. Audio processing does not fail merely because telemetry
is not consumed.

Raw binary telemetry frames, ring-buffer offsets, tap IDs, sequence layout,
arena pointers, and AudioWorklet messages are private. The concrete set of
public decoded telemetry record types is deferred until Phase 1; Phase 0 does
not implement this facade.

## Explicitly deferred

Phase 0 does not implement a runtime chain, preset migration, external assets,
file/audio I/O, package bundles, all-kernel class generation, live automation,
CLI commands, native shared-library distribution, wheels, npm publication, or
installation guarantees. Those items require Phase 1 or later implementation
and verification; this document only closes the Phase 0 API design gate.
