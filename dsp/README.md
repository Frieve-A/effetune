# EffeTune DSP Core

This directory contains the host-neutral C++20 DSP core. It builds as a native static
library for tests and as baseline and SIMD128 standalone WebAssembly modules for the web,
PWA, and Electron hosts. Browser and WebAudio APIs do not appear in this tree.

## Prerequisites

- CMake 3.24 or newer
- Ninja
- A C++20 compiler for native tests
- Emscripten SDK 6.0.2 for WebAssembly builds

On Windows, install and activate the version recorded in `EMSDK_VERSION`, then set
`EMSDK` to the activated SDK root. The build script verifies `emcc --version`; it does
not accept a different SDK version.

## Commands

```text
npm run gen:dsp
npm run test:dsp
node tools/dsp-parity/run.mjs --native
npm run build:dsp
node tools/dsp-parity/run.mjs --wasm
node tools/dsp-parity/run.mjs --wasm --simd
```

`npm run gen:dsp` validates every `dsp/plugins/**/params.json` and deterministically
updates the C++ headers plus the runtime JavaScript packers
(`js/audio/dsp-params.generated.js`). Add `-- --check` to
verify freshness without writing.

Run the verification commands in the order shown. `npm run test:dsp` configures a native
build and runs CTest; the following `--native` command runs every golden through that
native runner. Neither step requires emsdk. `npm run build:dsp` then builds baseline and
SIMD128 modules, copies them to `plugins/dsp/`, smoke-instantiates both artifacts, and
writes deterministic metadata. The final two commands check baseline WASM and then the
baseline-plus-SIMD modes. Build directories live below `dsp/build/`.

## ABI And Memory

The public C ABI is `include/effetune/abi.h`. ABI version 1 uses 32-bit handles and
offsets only; exported signatures contain no `i64`. Engines are independent and own all
DSP state. `et_engine_memory_required` validates and preflights the arena. Memory growth
is restricted to control-rate lifecycle calls: `et_engine_prepare` and kernel setup from
`et_instance_create`. Hosts must refresh arena views after either call and before the next
quantum. Processing never allocates or grows memory.

The arena contains the combined buffer (bus 0), buses 1-4, and four full-size scratch
slabs (`allChannels`, `mixing`, `stereo`, `mono`). It also contains a 4 KiB byte scratch,
the telemetry ring, and an equally sized telemetry staging slab. No engine processing or
pipeline descriptor call allocates.

Random kernels receive deterministic 64-bit seeds through
`et_instance_set_seed(seedLow, seedHigh)`, keeping `i64` out of exported signatures. The
parity hosts set each golden case seed explicitly; normal instance creation installs a
deterministic instance-derived default.

### Pitch Shifter Capacity Decision

Pitch Shifter allocates its maximum legal 500 ms window during `prepare`, using the
prepared sample rate, maximum channel count, and maximum frame count. Each channel owns
one input window, one windowed-frame scratch, and a three-window output ring, all as
Float32 storage. A separate Float32 final-output scratch is sized for
`maxChannels * maxFrames`. Shape changes clear the active logical regions and never
allocate during `process`; pitch and fine-tune changes retain the existing state.

At 192 kHz and eight channels, the three per-channel allocations contain 3,840,000
floats, or 15,360,000 bytes (15.36 MB, about 14.65 binary MiB), before the small final
block and index arrays. This is budgeted as roughly 15.4 MiB of kernel heap per maximal
instance. Kernel heap is additional to the engine arena and shares the WebAssembly
module's 64 MiB maximum memory, so several maximal Pitch Shifter instances cannot be
assumed to fit simultaneously. The capacity is intentionally not reduced: a smaller
fixed allocation would either reject the documented 500 ms/192 kHz/eight-channel shape
or require an incompatible processing-time allocation.

### Modal Resonator Capacity Decision

The JavaScript Modal Resonator creates a two-second Float32 ring for every resonator and
channel, although its public frequency range starts at log-frequency 3.0
(`exp(3) = 20.0855 Hz`). Its longest legal integer delay is therefore
`floor(sampleRate / exp(3))`. The native kernel allocates that delay plus one ring slot.
This is observably equivalent to the two-second ring: every read is relative to the write
position, and samples older than the longest legal delay can never be read, including
after a live frequency change. Disabled resonators freeze both position and storage.

At 192 kHz and eight channels, the ring length is 9,560 samples. Five resonators require
1,529,600 delay bytes (about 1.46 binary MiB), instead of 61,440,000 bytes for literal
two-second rings. This keeps one maximal instance comfortably inside the module's 64 MiB
limit. The ring is allocated only during `prepare`; processing does not allocate. A
defensive clamp maps an out-of-schema delay request to the largest allocated delay, so
malformed raw parameter blocks cannot index outside the ring.

### RS Reverb Capacity Decision

RS Reverb preallocates every legal room-size delay during `prepare`, but each of its
eight comb lines uses a separate capacity derived from its own base delay. For line
`i`, the capacity is `ceil(sampleRate * (baseDelay[i] + 0.5) * 0.005)`: the public
50 m room-size maximum multiplies the largest possible randomized base delay by five.
Channels share the same line-capacity table and use fixed offsets into one Float32
buffer. Room-size changes only select active lengths inside those capacities, so neither
room changes nor processing allocate.

At 192 kHz and eight channels, the comb buffers contain 2,104,320 floats. Including the
fixed 50 ms pre-delay and two 5 ms all-pass buffers per channel, RS Reverb owns 2,196,480
Float32 samples, or 8,785,920 bytes (about 8.38 binary MiB). A uniform stride based on
the longest comb line would waste more than 3 MiB at this shape. Sample-rate preparation
recomputes line lengths while retaining randomized delay values and RNG position, matching
the JavaScript processor; explicit reset is the operation that returns the RNG to its
selected seed.

ABI version 1 also supports bounded structured parameter blocks without changing the
numeric float layout. `et_kernel_param_bytes_capacity` reports zero for numeric-only
kernels and the maximum accepted byte count otherwise. Hosts stage a structured block
with `et_instance_set_param_bytes` after `et_instance_set_params`; both calls use the same
generated layout hash and become visible at the next process boundary. Matrix routing uses
codec `matrix-routes-v1`: a four-byte version/reserved/route-count header followed by
ordered three-byte input/output/phase records. The 1024-route bound fits the 4 KiB scratch
slab and preserves duplicate route order.

Telemetry defaults to 60 Hz. `et_engine_set_telemetry_rate` changes the engine-wide rate;
0 disables emission. `et_telemetry_staging_ptr` and `et_telemetry_capacity` expose the
prepared staging slab used with `et_telemetry_read`.

Telemetry frame types currently include analyzer frames 1-6, dynamics frames 7
(`TAP_LOUDNESS_LEVELS`: two float32 LUFS values) and 8 (`TAP_TRANSIENT_GAIN`: one signed
float32 dB value), and Basics topology frames 9-10. Type 9 (`TAP_CHANNEL_COUNT`) is one
little-endian `u32` in the range 1-8. Type 10 (`TAP_MULTI_CHANNEL_LEVELS`) starts with a
`u8` channel count and three zero bytes, then contains one eight-byte record per channel:
a nonnegative float32 raw window peak, a zero-or-one effective-mute byte, and three zero
bytes. Its exact payload size is `4 + 8 * channelCount`. Frame type 2
(`TAP_GAIN_REDUCTION`) is one nonnegative float32 dB value and is shared by Compressor,
Gate, Expander, and BrickwallLimiter. Consumers require format version 1 and the exact
payload size; all payloads are little-endian and four-byte aligned. Type 14
(`TAP_FIVE_BAND_DYNAMIC_EQ`) is exactly 24 bytes: a five-band count, three zero reserved
bytes, and five signed float32 gain values in band order.

`et_instance_latency` reflects staged parameters immediately. BrickwallLimiter reports
`max(1, ceil(lookaheadMs * sampleRate / 1000))` samples at 1x oversampling and
that same lookahead term plus `ceil(62 / oversampling)` samples at 2x/4x/8x.
The host reports aggregate pipeline latency but does not compensate it.

The Phase-5 pipeline descriptor is validated transactionally. A malformed descriptor
returns `ET_ERR_DESC` and leaves the previous valid descriptor active. Processing covers
the existing channel slice, section gate, replace, and cross-bus additive semantics.

## Shared DSP Primitives

Reusable real-time helpers live under `include/effetune/dsp/`:

- `biquad.h` provides binary64 DF-I and TDF-II coefficients/state plus explicit legacy
  Float32 persistence-point quantization.
- `delay_line.h` provides a prepare-time allocated, multichannel circular delay with
  integer and linearly interpolated reads.
- `smoothing.h` provides one-pole, attack/release envelope, and linear smoothing state.
- `math.h` provides dB/linear conversion, branch-based clamping, and denormal flushing.
- `xorshift_rng.h` provides the reference-compatible xorshift64 13/7/17 sequence and
  53-bit float conversion used by parity-sensitive noise and modulation kernels.

Prefer these helpers when their state and coefficient semantics match the JavaScript
reference. Parity takes precedence when a legacy processor intentionally uses a different
formula or persistence point.

## Adding A Kernel

1. Add `dsp/plugins/<category>/<plugin>/params.json` and `kernel.cpp`.
2. Add one alphabetical `EFFETUNE_PLUGIN` entry to `registry.inc`.
3. Run `npm run gen:dsp` and the parity generator before implementing the kernel.
4. Derive from `PluginKernel`, use `EFFETUNE_PARAMS`, and register with
   `EFFETUNE_REGISTER_KERNEL` using the exact JavaScript constructor name.
5. Allocate persistent state only in `prepare`; `process` must not allocate, lock, throw,
   perform I/O, or depend on a fixed frame count.

The shared native parity runner needs no per-plugin CMake entry. A dedicated complex
`native_test.cpp` is not auto-discovered, so it must also be registered explicitly with
`add_executable` and `add_test` in `dsp/CMakeLists.txt`.

Production kernels are registered in `dsp/registry.inc`; the committed WASM metadata
records that registry and each generated parameter-layout hash. Native unit tests also add
a test-only gain kernel to exercise lifecycle, parameter, routing, and telemetry contracts.

## Vendored Code

`vendor/pffft/` contains the minimal float PFFFT v1.1.0 source used directly by the
Spectrum Analyzer and Spectrogram kernels. The baseline artifact uses PFFFT's scalar
path; the SIMD artifact compiles PFFFT with WebAssembly SIMD128 enabled. See
`vendor/pffft/LICENSE.txt` and `plugins/dsp/NOTICE.txt`.
