# EffeTune DSP Library and Core

The DSP core is published as the **EffeTune DSP Library** for Python,
JavaScript, and browser AudioWorklets. Start with the
[DSP Library documentation](https://effetune.frieve.com/dsp/) for the complete
guides, effect catalog, API reference, live demo, and details about streaming,
assets, and deterministic processing.

The library can process audio independently of the EffeTune app. Python and
JavaScript use the same C++20 DSP core and the same semantic Chain JSON format,
so a chain can be shared between the two packages. The app can optionally be
used as a visual preset editor.

Choose the section that matches your goal:

- **Use the library:** [Python quick start](#python-quick-start),
  [JavaScript quick start](#javascript-quick-start), and
  [Chains and Effects](#chains-and-effects)
- **Develop the C++ core:** [DSP Core Development](#dsp-core-development),
  including the [verification workflow](#verification-workflow),
  [ABI and memory rules](#abi-and-real-time-memory), and
  [kernel capacity decisions](#kernel-capacity-decisions)

## Python Quick Start

Install the package from PyPI:

```console
pip install effetune
```

Pass a C-contiguous `float32` NumPy array with shape `(channels, frames)` to a
chain. The library does not resample audio.

```python
import numpy as np
import effetune as et

frames = 512
phase = np.arange(frames, dtype=np.float32)
mono = (0.5 * np.sin(2 * np.pi * phase / 97)).astype(np.float32)
audio = np.ascontiguousarray(np.stack((mono, mono)))

chain = et.Chain([et.Volume(volume=-6)])
output = chain.process(audio, sample_rate=48_000)
print(output.shape)
```

Generated effect constructors use Python `snake_case` parameter names. Use
`Chain.stream()` instead of `Chain.process()` when filter history, delay or
reverb tails, or seeded random state must continue across blocks. See the
[Python guide](https://effetune.frieve.com/dsp/getting-started/python/) for
audio-file processing and the full API.

## JavaScript Quick Start

Install the ESM-only package from npm:

```console
npm install @effetune/dsp
```

Pass one equal-length `Float32Array` per channel. The package does not decode,
encode, or resample audio.

```js
import { createChain } from '@effetune/dsp';

const frames = 512;
const mono = Float32Array.from(
  { length: frames },
  (_, frame) => 0.5 * Math.sin(2 * Math.PI * frame / 97)
);
const input = [mono.slice(), mono.slice()];

const chain = await createChain({
  version: 1,
  chain: [{
    id: 'volume',
    type: 'Volume',
    parameters: { volume: -6 }
  }]
});
const output = await chain.process(input, { sampleRate: 48000 });
console.log(output.length, output[0].length);
chain.close();
```

Node.js 18 or newer is required. In a browser, use a bundler or import map and
serve the package's JavaScript, WebAssembly, and metadata assets from the same
secure origin. For real-time browser audio, use the package-owned AudioWorklet.
See the [JavaScript guide](https://effetune.frieve.com/dsp/getting-started/javascript/)
and [AudioWorklet guide](https://effetune.frieve.com/dsp/getting-started/audioworklet/)
for complete setup.

## Chains and Effects

A Chain is an ordered serial effect pipeline. Each effect has a semantic type,
an ID, and parameters; the same Chain JSON is accepted by both language
bindings. The generated
[effect reference](https://effetune.frieve.com/dsp/effects/) lists every
available effect and its parameter names, defaults, ranges, channel behavior,
latency, and asset requirements. Offline processing starts with fresh DSP
state, while streaming preserves state across blocks.

For file and batch processing without writing an application, see the
[CLI guide](https://effetune.frieve.com/dsp/getting-started/cli/).

## DSP Core Development

This directory contains the host-neutral C++20 DSP core. It has no browser or
WebAudio API dependencies. The build produces:

- A native static library used by tests
- A baseline standalone WebAssembly module
- A SIMD128 standalone WebAssembly module

The WebAssembly modules are used by the web, PWA, and Electron hosts.

### Prerequisites

- CMake 3.24 or newer
- Ninja
- A C++20 compiler for native tests
- Emscripten SDK 6.0.2 for WebAssembly builds

On Windows, install and activate the version recorded in `EMSDK_VERSION`, then
set `EMSDK` to the activated SDK root. The build script checks `emcc --version`
and rejects other SDK versions.

### Verification Workflow

Run these commands in order:

```text
npm run gen:dsp
npm run test:dsp:warnings
npm run test:dsp
node tools/dsp-parity/run.mjs --native
npm run build:dsp
node tools/dsp-parity/run.mjs --wasm
node tools/dsp-parity/run.mjs --wasm --simd
```

The commands perform these checks:

1. `npm run gen:dsp` validates every `dsp/plugins/**/params.json` and
   deterministically updates the C++ headers and runtime JavaScript packers in
   `js/audio/dsp-params.generated.js`. Add `-- --check` to verify freshness
   without writing.
2. `npm run test:dsp:warnings` uses the pinned Emscripten Clang frontend to
   compile every registered native test source with warnings as errors,
   including `-Wunused-but-set-variable`. It does not link or run the tests.
3. `npm run test:dsp` configures a native build and runs CTest.
4. `node tools/dsp-parity/run.mjs --native` runs every golden through the native
   runner.
5. `npm run build:dsp` repeats the warning check, builds the baseline and
   SIMD128 modules, copies them to `plugins/dsp/`, smoke-instantiates both
   artifacts, and writes deterministic metadata.
6. The final two parity commands verify baseline WASM and baseline-plus-SIMD
   processing.

The native test and parity steps do not require emsdk; the warning check does.
Build directories are created below `dsp/build/`.

### ABI and Real-Time Memory

#### ABI Contract

The C ABI in `include/effetune/abi.h` is the host ABI for the bundled
WebAssembly modules. ABI version 1 is not a supported public native ABI or a
native binary-compatibility promise. See the
[Phase 0 native ABI audit](../experiments/dsp-library-phase0/native-abi-audit.md).

The main ABI rules are:

- Exported signatures use only 32-bit handles and offsets; they contain no
  `i64` values.
- Each engine is independent and owns all of its DSP state.
- `et_engine_memory_required` validates and preflights the engine arena.
- Memory may grow only during `et_engine_prepare` or kernel setup from
  `et_instance_create`.
- Hosts must refresh arena views after either lifecycle call and before the
  next audio quantum.
- Audio processing never allocates or grows memory.

#### Engine Arena

The arena contains:

- The combined buffer (bus 0) and buses 1-4
- Four full-size scratch slabs: `allChannels`, `mixing`, `stereo`, and `mono`
- A 4 KiB byte scratch slab
- The telemetry ring and an equally sized telemetry staging slab

Neither engine processing nor a pipeline descriptor call allocates memory.

#### Deterministic Seeds

Random kernels receive deterministic 64-bit seeds through
`et_instance_set_seed(seedLow, seedHigh)`. Splitting the seed keeps `i64` out of
exported signatures. Parity hosts set each golden case seed explicitly; normal
instance creation uses a deterministic, instance-derived default.

### Kernel Capacity Decisions

The following kernels preallocate their maximum supported working storage.
This keeps `process` allocation-free while preserving the documented parameter
range.

#### Pitch Shifter

**Allocation model**

During `prepare`, Pitch Shifter allocates the maximum legal 500 ms window for
the prepared sample rate, maximum channel count, and maximum frame count. Each
channel receives:

- One input window
- One windowed-frame scratch area
- One output ring with space for three windows

All three use Float32 storage. A separate Float32 final-output scratch area is
sized as `maxChannels * maxFrames`.

**Maximum supported shape**

At 192 kHz and eight channels, the per-channel allocations contain 3,840,000
floats, or 15,360,000 bytes (15.36 MB, about 14.65 MiB). Including the small
final block and index arrays, one maximal instance is budgeted at roughly
15.4 MiB of kernel heap.

Kernel heap is additional to the engine arena and shares the WebAssembly
module's 256 MiB limit. The combined allocation of all effect instances must
remain within that limit.

**Why this capacity is retained**

A smaller fixed allocation would either reject the documented combination of
a 500 ms window, 192 kHz audio, and eight channels, or require an incompatible
allocation during processing. Shape changes therefore clear only the active
logical regions. Pitch and fine-tune changes retain the existing state.

#### Modal Resonator

**Allocation model**

The JavaScript implementation creates a two-second Float32 ring for every
resonator and channel. The public frequency range starts at log-frequency 3.0,
where `exp(3) = 20.0855 Hz`, so the longest legal integer delay is:

```text
floor(sampleRate / exp(3))
```

The native kernel allocates that delay plus one ring slot. This is observably
equivalent to the two-second ring because every read is relative to the write
position, and samples older than the longest legal delay cannot be read—even
after a live frequency change. Disabled resonators freeze both their position
and storage.

**Maximum supported shape**

At 192 kHz and eight channels:

- Ring length: 9,560 samples
- Five-resonator storage: 1,529,600 bytes (about 1.46 MiB)
- Literal two-second-ring storage avoided: 61,440,000 bytes

This keeps one maximal instance comfortably within the module's 256 MiB limit.
The ring is allocated only during `prepare`; processing does not allocate.

A defensive clamp maps an out-of-schema delay to the largest allocated delay,
preventing malformed raw parameter blocks from indexing outside the ring.

#### RS Reverb

**Allocation model**

RS Reverb preallocates every legal room-size delay during `prepare`. Each of
its eight comb lines receives a separate capacity derived from that line's base
delay:

```text
capacity[i] = ceil(sampleRate * (baseDelay[i] + 0.5) * 0.005)
```

The public maximum room size is 50 m. At that setting, the largest possible
randomized base delay is multiplied by five. Channels share one line-capacity
table and use fixed offsets into a single Float32 buffer.

Room-size changes select active lengths within the existing capacities. They
do not reallocate memory, and neither does audio processing.

**Maximum supported shape**

At 192 kHz and eight channels:

| Storage | Float32 samples | Bytes |
| --- | ---: | ---: |
| Comb buffers | 2,104,320 | 8,417,280 |
| Complete instance | 2,196,480 | 8,785,920 |

The complete instance includes the comb buffers, the fixed 50 ms pre-delay,
and two 5 ms all-pass buffers per channel. Its total is about 8.38 MiB. Giving
every comb line a uniform stride based on the longest line would waste more
than 3 MiB at this shape.

**State behavior**

- Sample-rate preparation recalculates line lengths.
- Randomized delay values and the RNG position are retained, matching the
  JavaScript processor.
- An explicit reset returns the RNG to its selected seed.

### Structured Parameters

ABI version 1 supports bounded structured parameter blocks without changing
the numeric float layout.

- `et_kernel_param_bytes_capacity` returns zero for numeric-only kernels and
  the maximum accepted byte count for other kernels.
- Hosts call `et_instance_set_param_bytes` after `et_instance_set_params` to
  stage a structured block.
- Both calls use the same generated layout hash and become visible at the next
  process boundary.

Matrix routing uses the `matrix-routes-v1` codec: a four-byte
version/reserved/route-count header followed by ordered three-byte
input/output/phase records. The 1,024-route limit fits the 4 KiB scratch slab
and preserves duplicate route order.

### Telemetry

Telemetry is emitted at 60 Hz by default.
`et_engine_set_telemetry_rate` changes the engine-wide rate; a value of zero
disables emission. `et_telemetry_staging_ptr` and `et_telemetry_capacity`
expose the prepared staging slab read through `et_telemetry_read`.

All payloads are little-endian and four-byte aligned. Consumers must accept the
exact payload size for the selected format version. The default format version
is 1; `TAP_SCOPE_SNAPSHOT` (type 3), `TAP_STEREO_FIELD` (type 6), and
`TAP_AM_RADIO_SIMULATOR` (type 17) use version 2.

#### Frame Types

- **Types 1-6 — analyzer frames.** Type 2, `TAP_GAIN_REDUCTION`, contains one
  nonnegative float32 dB value and is shared by Compressor, Gate, Expander, and
  BrickwallLimiter.
- **Type 7 — `TAP_LOUDNESS_LEVELS`.** Two float32 LUFS values.
- **Type 8 — `TAP_TRANSIENT_GAIN`.** One signed float32 dB value.
- **Type 9 — `TAP_CHANNEL_COUNT`.** One little-endian `u32` in the range 1-8.
- **Type 10 — `TAP_MULTI_CHANNEL_LEVELS`.** A `u8` channel count, three zero
  bytes, then one eight-byte record per channel. Each record contains a
  nonnegative float32 raw window peak, a zero-or-one effective-mute byte, and
  three zero bytes. Payload size is `4 + 8 * channelCount` bytes.
- **Type 14 — `TAP_FIVE_BAND_DYNAMIC_EQ`.** Exactly 24 bytes: a five-band
  count, three zero reserved bytes, and five signed float32 gain values in band
  order.
- **Type 15 — `TAP_VINYL_SIMULATOR`.** Exactly 48 bytes: eight float32 values
  followed by four cumulative little-endian `u32` counters. The float values
  describe left/right contact force in N, left/right mean pressure in Pa,
  tip-velocity RMS in m/s, left/right tracking signal-to-error ratio in dB, and
  contact-centroid jitter in ns. The counters track mistracks, skips, static
  pops, and dust hits.
- **Type 16 — `TAP_FM_RADIO_SIMULATOR`.** Exactly 216 bytes: five float32
  values, one cumulative little-endian `u32` counter, and forty-eight float32
  spectrum magnitudes. The first values report RF input level in dBuV,
  estimated CNR in dB, pilot-lock quality from 0-1, stereo blend from 0-1, and
  multipath echo depth in dB. The counter tracks FM threshold clicks. The
  spectrum uses dBFS on a fixed logarithmic grid from 300 Hz to 60 kHz.
- **Type 17 — `TAP_AM_RADIO_SIMULATOR`.** Format version 2 is exactly 28 bytes.
  Five float32 values at offsets 0, 4, 8, 12, and 16 report carrier level before
  AGC in dB, AGC gain in dB, modulation depth in percent, fading level in dB,
  and stereo blend. Cumulative `u32` counters at offsets 20 and 24 track static
  and clipping events. Legacy version 1 is 24 bytes, omits stereo blend, and
  stores the counters at offsets 16 and 20; the parser accepts it for backward
  compatibility.
- **Type 18 — `TAP_SW_RADIO_SIMULATOR`.** Format version 1 is exactly 24 bytes.
  Four float32 values at offsets 0, 4, 8, and 12 report carrier level before AGC
  in dB, AGC gain in dB, modulation depth in percent, and fading level in dB.
  Cumulative `u32` counters at offsets 16 and 20 track static and clipping
  events. Shortwave reception is mono, so there is no stereo-blend field.

  The layout is the same in every reception mode, but several values are
  mode-dependent:

  - In AM, the pre-AGC IF level includes the carrier. In suppressed-carrier USB
    and LSB, it depends on the programme.
  - In USB and LSB, fading reports the virtual path gain at the suppressed
    carrier, not the attenuation or programme level of the sideband as a whole.
  - In USB and LSB, modulation depth represents transmitter sideband drive.
  - The clipping counter records only AM over-modulation and envelope-detector
    clipping, so it never advances in USB or LSB.

- **Type 19 — `TAP_TUBE_SIMULATOR`.** Format version 1 is exactly 72 bytes:
  eighteen little-endian float32 values, first for the left channel and then
  for the right. Each channel contains stage 1 cathode voltage, stage 2 cathode
  voltage, B+ voltage, stage 1 grid-to-cathode voltage, stage 1 plate-to-cathode
  voltage, stage 1 plate current, stage 2 grid-to-cathode voltage, stage 2
  plate-to-cathode voltage, and stage 2 plate current, in that order.
- **Type 20 — `TAP_PHASE_SELECT_MAP`.** Format version 1 is a 16-byte header
  followed by `pointCount` 12-byte records, for an exact payload size of
  `16 + 12 * pointCount` bytes. The header contains sample rate as float32,
  `pointCount` as `u16` (maximum 512), flags as `u16`, FFT size as `u32`, and
  frame maximum level in dB as float32. Each record contains float32 frequency
  in Hz, signed L/R phase difference in degrees (-180 to +180), and level in dB
  relative to the frame maximum.

### Latency and Pipeline Descriptors

`et_instance_latency` reflects staged parameters immediately.
BrickwallLimiter reports:

- At 1x oversampling:
  `max(1, ceil(lookaheadMs * sampleRate / 1000))` samples
- At 2x, 4x, or 8x oversampling: the same lookahead term plus
  `ceil(62 / oversampling)` samples

The routed EffeTune host reports and compensates aggregate pipeline latency.
Serial library bindings report latency without trimming or padding rendered
output, leaving offline placement to the host application.

The Phase-5 pipeline descriptor is validated transactionally. A malformed
descriptor returns `ET_ERR_DESC` and leaves the previous valid descriptor
active. Processing supports the existing channel-slice, section-gate, replace,
and cross-bus additive semantics.

### Shared DSP Primitives

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

### Adding a Kernel

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

### Vendored Code

`vendor/pffft/` contains the minimal float PFFFT v1.1.0 source used directly by the
Spectrum Analyzer and Spectrogram kernels. The baseline artifact uses PFFFT's scalar
path; the SIMD artifact compiles PFFFT with WebAssembly SIMD128 enabled. See
`vendor/pffft/LICENSE.txt` and `plugins/dsp/NOTICE.txt`.
