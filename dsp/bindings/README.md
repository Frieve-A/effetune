# EffeTune DSP language binding contracts

This directory contains the source contract shared by the Python and JavaScript
bindings. The public v1 catalog contains the 92 effects listed in
`common/effects-v1.overlay.json`.

## Sources of truth

- Each selected kernel's `dsp/plugins/**/params.json` supplies parameter
  bounds, defaults, units, packed field order, private short keys, asset
  capacity, and the layout hash computed by `scripts/gen-dsp-params.mjs`.
- `common/effects-v1.overlay.json` supplies only facts that cannot be expressed
  by those files: public/internal type selection and order, semantic renames or
  transforms, discrete values, FM Radio Simulator sample rates, deterministic
  seed support, semantic telemetry and latency tags, the convolution asset name
  for internal slot 0, and the reviewed v1 contract digests.
- `scripts/gen-dsp-library-bindings.mjs` validates and combines both sources.
  Files under `generated/`, `schema/`, and the generated language source paths
  must not be edited directly.

`generated/effects-v1.json` is public semantic metadata. Packed names, offsets,
layout hashes, internal registry types, and WASM asset tags live separately in
`generated/effects-v1.private.json`; generated language runtimes expose the
same package-internal mapping as `_EFFECT_IMPLEMENTATION`. Public package entry
points must not re-export that symbol or the private JSON file.

## Frozen v1 document boundary

`schema/chain-v1.schema.json` defines one ordered serial chain:

```json
{
  "version": 1,
  "chain": [
    {
      "id": "voice",
      "type": "Compressor",
      "enabled": true,
      "channel": "all",
      "parameters": {
        "threshold": -24,
        "ratio": 4
      }
    }
  ]
}
```

Only semantic long parameter names are accepted. Missing parameter values and
the annotated `enabled` and `channel` defaults are materialized by a binding
runtime. The canonical channels are `all`, `stereo`, `left`, `right`, individual
channels `1` through `8`, and pairs `34`, `56`, and `78`. The package-internal
mapping preserves the existing engine representation where `stereo` is null,
`all` is `A`, and left/right are `L`/`R`. Unknown values are rejected. Duplicate
explicit effect IDs are rejected by the runtime. Existing application
`pipeline`/`plugins` documents, short parameter keys, and packed layouts are not
accepted as v1 chain documents.

`FIRCrossover`, `FiveBandFIRPEQ`, `GroupDelayEQ`, `GroupDelayPEQ`, `IRReverb`,
and `RoomEQ` additionally require `assets.impulseResponse`, an opaque resolver
key. The five FIR filter effects expect prepared coefficient impulses at the
processing sample rate; `IRReverb` accepts its documented convolution modes and
rates.
Other v1 effects do not accept `assets`.

`schema/bundle-v1.schema.json` pairs a canonical chain with a bounded asset
manifest. An impulse response entry identifies an externally resolved ETA1
payload by reference and SHA-256 digest. Each payload has a 32-byte
little-endian header (`ETA1`, channels, frames, sample rate, topology, path
count, and eight reserved bytes), optional 12-byte matrix path records, and
planar float32 samples. Topology is one of `unspecified`, `mono`, `independent`,
`trueStereo`, or `matrix`. Matrix topology requires 1 to 8
`inputSlot`/`outputSlot`/`irChannel` paths; other topologies prohibit paths and
require a zero path count. A ZIP container is neither required nor defined.
Duplicate asset IDs, missing references, hash verification, cross-field path
validation, and exact byte-size consistency are runtime responsibilities.

The three non-identity public transforms are:

- `TiltEQ.pivotFrequency` in Hz ↔ natural-log packed value.
- `DigitalErrorEmulator.bitErrorRate` ↔ base-10 logarithmic packed value.
- `SimpleJitter.rmsJitterNanoseconds` ↔
  `20 * log10(value / 0.001)` packed value.

PEQ arrays have exactly 5 or 15 entries and use public filter names. Filter
slopes, limiter oversampling, Exciter high-pass slope, and IR latency are
discrete. FM Radio Simulator accepts only the eight sample rates recorded in
the generated catalog.

## Independent Graph v1 boundary

`schema/graph-v1.schema.json` defines the separate opt-in Graph document. It
does not extend or reinterpret Chain v1:

```json
{
  "version": 1,
  "input": { "id": "input" },
  "output": { "id": "output" },
  "nodes": [
    {
      "id": "level",
      "type": "Volume",
      "enabled": true,
      "channel": "all",
      "parameters": { "volume": -6 }
    }
  ],
  "edges": [
    { "id": "input-level", "source": "input", "destination": "level" },
    { "id": "level-output", "source": "level", "destination": "output" }
  ]
}
```

Graph nodes use the existing flat Effect shape and require a stable ID. The
single host input and output are `{id}` endpoints; edge sources and destinations
refer to endpoint or node IDs directly. Runtime validation owns global ID and
reference integrity, endpoint direction, cycle detection, structural
connectivity, stream channel compatibility, and capacity checks.

The generator also writes `generated/graph-v1.contract.json`. That artifact is
the shared machine-readable authority for edge defaults and operation order,
UTF-8 bytewise scheduling, canonicalization, structural/effective states,
latency compensation, recipe expansion, query/snapshot fields, and compile
error categories. `common/graph-v1-contract.fixture.json` fixes representative
valid documents and document error code/path mappings for both bindings. As
with other generated binding files, edit the generator rather than either
Graph output directly.

The same contract publishes the implementation capacities consumed by schema,
core, bindings, and documentation. Language-specific generated constants and
the C++ generated header come from that metadata; delay storage is included in
the published workspace limit.

Graph preparation is all-or-nothing and produces an immutable stream plan.
Bindings may perform early document checks and path mapping, but the DSP core
is authoritative for the effective schedule, buffer plan, prepared-instance
latency, compensation, and execution. Neither binding implements a second graph
executor.

## Generated class contracts

Python `_generated_effects.py` imports `Effect` from `effetune._base`. The base
constructor contract is:

```python
Effect(
    effect_type,
    *,
    parameters=None,
    id=None,
    enabled=True,
    channel="all",
    assets=None,
)
```

The 92 generated classes expose keyword-only, discoverable parameter
signatures. Scalar defaults are literal values and array defaults are immutable
tuples. The six convolution-backed effects require an `assets` keyword;
effects without assets do not expose it. The generated
`_generated_effects.pyi` supplies fixed tuples, `Literal` enums,
`EffectChannel`, and the required typed asset shapes. Classes only gather
semantic values; the common base owns copying, default materialization,
validation, normalization, and processing.

JavaScript `generated-effects.js` imports `Effect` from `./effect.js`, whose
constructor contract is `Effect(type, options = {})`. Each generated class is a
thin `constructor(options = {})` wrapper. The declaration file gives every
effect its own options interface, fixed tuple and enum types, class, and factory.
The six convolution-backed effect option types require their `assets` member.

## Generation and drift check

Run:

```powershell
node scripts/gen-dsp-library-bindings.mjs
node scripts/gen-dsp-library-bindings.mjs --check
node --test tests/esm/dsp-library-codegen*.test.mjs
```

The default command and `--check` first verify fixed SHA-256 digests for the
normalized public catalog and private layout mapping. An upstream
`params.json` change therefore fails before output can be silently refreshed.
For an intentional v1 contract revision, inspect the source change first, run
`node scripts/gen-dsp-library-bindings.mjs --update-contract-digests`, and review
both digest and generated diffs. `--check` writes nothing and fails if any
generated byte differs. Output order and line endings are deterministic.
