# Native Parity Runner Contract

`run.mjs` invokes the native parity executable once per golden case:

```text
effetune-dsp-parity-runner --type <PluginType> --control <case.etpc> \
  --input <input.f32> --output <output.f32> \
  --seed-low <u32> --seed-high <u32> [--allocations]
```

`input.f32` and `output.f32` are raw little-endian float32 samples in channel-major
order. Both contain exactly `channelCount * frameCount` values. The runner must return
zero only after writing the complete output file.

## ETPC Version 1

The control file is little-endian and contains no JSON or schema data. All parameter
values are already packed according to `params.json`.

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `char[4]` | ASCII magic `ETPC` |
| 4 | `u32` | format version, currently `1` |
| 8 | `f32` | sample rate |
| 12 | `u32` | frame count per channel |
| 16 | `u32` | channel count |
| 20 | `u32` | maximum process block size |
| 24 | `u32` | FNV-1a parameter-layout hash |
| 28 | `u32` | packed parameter float count |
| 32 | `u32` | parameter event count |
| 36 | `f32[]` | initial packed parameter block |

Each parameter event follows the initial block as `u32 frame` plus a complete packed
`f32[paramFloatCount]` block. Event blocks are cumulative, sorted by frame, and apply
before processing the sample at that frame. An event may split a nominal process block.

The executable receives the exact kernel type separately through `--type`. It validates
the control hash/count against the registry descriptor, creates and prepares one engine,
stages the initial block, and processes input sequentially in blocks no larger than the
declared block size. `--allocations` enables the debug allocation guard for the measured
processing interval.

The seed options carry the golden case's unsigned 64-bit xorshift seed as two decimal
`u32` words. The runner calls `et_instance_set_seed` before staging parameters. Keeping
the seed outside ETPC preserves the version-1 control layout while matching the WASM and
JavaScript reference hosts.

## ETPC Version 2

Schemas with an optional structured parameter codec use version 2. Offsets 0-31 match
version 1; offset 32 is the initial structured byte count, offset 36 is the event count,
and the initial float block starts at offset 40 followed immediately by the structured
bytes. Each event is `u32 frame`, a complete float block, `u32 structuredByteCount`, and
that event's complete structured block. Counts may vary between events. The runner
validates every boundary and stages the numeric block before the structured block. Numeric-
only schemas continue to emit version 1 unchanged.

## ETPC Version 3

Cases that stage one large kernel asset use version 3. Offsets 0-39 match version 2,
followed by one fixed asset-begin record:

| Offset | Type | Field |
| ---: | --- | --- |
| 40 | `u32` | asset slot |
| 44 | `u32` | asset format tag |
| 48 | `u32` | asset channel count |
| 52 | `u32` | asset frame count |
| 56 | `u32` | topology |
| 60 | `u32` | head block / resolved latency mode |
| 64 | `u32` | convolution-rate divider |
| 68 | `u32` | path count |
| 72 | `u32` | input count |
| 76 | `u32` | asset payload byte count |
| 80 | `u32` | reserved, must be zero |

The initial float block starts at offset 84, followed by structured parameter bytes,
the exact asset payload, and version-2-style parameter events. The current IR Reverb
cases carry an `ETA1` planar float payload in this field.

Both native and Node-hosted WASM runners call asset begin, copy the complete payload,
and commit it before measured rendering. They process silent blocks until the asset
reports `ACTIVE`, reset the instance while retaining committed spectra, and only then
process the case input. Versions 1 and 2 do not execute any asset operations.
