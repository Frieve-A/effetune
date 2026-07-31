# EffeTune DSP native ABI audit

Status: Phase 0 audit conclusion, 2026-07-28

The existing C ABI v1 is a **WASM host ABI**, not a public native ABI. Phase 0
does not change it or promise native binary compatibility. Python uses a
private adapter statically linked to the required C++ kernel, while the
candidate public boundary is the semantic high-level API described in
[`api-design.md`](api-design.md).

## 64-bit asset handoff

### Evidence

- `dsp/include/effetune/abi.h` declares `et_instance_asset_begin()` with a
  `uint32_t` return value. `dsp/core/abi.cpp` obtains a staging `uint8_t *`,
  casts it through `uintptr_t`, and narrows it to `uint32_t`. That represents a
  wasm32 linear-memory offset but can truncate a normal 64-bit native pointer.
- Asset byte size, footprint, channel count, frame count, and related capacity
  queries use `uint32_t`. `et_engine_memory_required()` also returns
  `uint32_t`. These are coherent wasm32 limits, not a reviewed native
  large-buffer or large-asset contract.
- `et_engine` and `et_instance` are `uint32_t` table handles. Engine instances
  are resolved through private process-global slots in `dsp/core/abi.cpp`;
  their representation and lifetime are current host implementation details.
- Other ABI functions return raw arena and telemetry pointers. Their native
  pointer width is not narrowed, but their ownership and lifetime depend on
  the current engine and arena implementation and are unsuitable for an
  accidental stable ABI.

### Phase 0 decision

C ABI v1 remains unchanged and WASM-internal. It must not be documented,
linked, or versioned as a public native ABI. The Phase 0 nanobind module uses a
private C++ adapter and a private static kernel target; it does not pass assets
through C ABI v1 or export that ABI from the Python package.

### Deferred action

If a native C ABI becomes a concrete requirement, introduce a separately
versioned ABI rather than extending v1 in place. Use opaque native handles,
status-returning calls, and either an out pointer with an explicit ownership
contract or caller-to-library copy functions. Express externally supplied byte
and frame lengths with checked 64-bit types, convert to `size_t` only after
bounds checks, and never encode a native pointer in a 32-bit integer.

## Export specification

### Evidence

- `ET_EXPORT` in `dsp/include/effetune/abi.h` expands to
  `__attribute__((used, visibility("default")))` for GCC and Clang. It expands
  to nothing for other compilers, so there is no MSVC
  `__declspec(dllexport)`/`__declspec(dllimport)` contract.
- `dsp/CMakeLists.txt` builds `effetune_dsp_core` as `STATIC`. It defines no
  native shared-library target, default-hidden symbol policy, import/export
  build definition, installable ABI library, or native symbol audit.
- The Emscripten executable passes
  `-sEXPORTED_FUNCTIONS=@dsp/exports.txt`. That file is an explicit WASM
  allowlist for C ABI v1 functions plus `_free`; it is not a native library
  export map.
- The Phase 0 Python CMake file builds only the nanobind module and privately
  links a static Compressor kernel. The module initializer is the only dynamic
  entry point intended for Python loading.

### Phase 0 decision

The current attributes and `dsp/exports.txt` are sufficient evidence for the
existing Emscripten host boundary only. They do not establish portable native
exports. Phase 0 adds no export macro or shared target because doing so would
suggest a public native ABI that this audit explicitly rejects.

### Deferred action

A future public native shared library must define build and consume modes:
`__declspec(dllexport)`/`__declspec(dllimport)` on MSVC and explicit default
visibility for public GCC/Clang symbols while the target uses hidden visibility
by default. Each platform must use an allowlist or export map and a symbol-table
test proving that only the documented, separately versioned native ABI is
visible.

## Public and private scope

### Evidence

- C ABI v1 exposes kernel enumeration, parameter hashes and packed buffers,
  engine/instance handles, asset staging, arena/scratch pointers, binary
  telemetry, and binary pipeline descriptors.
- C++ registry entries return `KernelDescriptor` objects that contain
  construction and destruction functions and object layout information.
- `params.json` is code-generated into packed C++ structs and JavaScript
  packers. Compressor currently has six packed floats and a generated layout
  hash. These values protect a wrapper/artifact pairing; they are not semantic
  API versioning.
- `plugins/audio-processor.js` translates application objects into C ABI calls
  and exchanges private AudioWorklet messages. The Phase 0 worklet wrapper
  deliberately reuses that host implementation.
- The Phase 0 nanobind adapter reaches `PluginKernel` and the generated
  Compressor parameter struct directly through private static linkage.

### Phase 0 decision

The candidate public surface consists of semantic `Effect`, `Compressor`, and
ordered `Chain` objects; long parameter names; planar float32 audio; explicit
sample rate; deterministic `uint32` seed behavior; the semantic chain schema;
typed wrapper errors; an asset-resolver boundary; and decoded wrapper-owned
telemetry.

The following remain private implementation details:

- C ABI v1 and all engine, instance, pointer, and WASM handles;
- generated parameter structs, packed field order, short keys, layout hashes,
  and parameter packers;
- `PluginKernel`, kernel descriptors, registry contents, and construction
  functions;
- arenas, scratch storage, pipeline descriptors, asset staging, and asset
  footprint internals;
- binary telemetry layouts, rings, taps, and drop counters;
- nanobind adapter types and AudioWorklet message formats.

No private detail above is covered by semantic schema version `1`.

### Deferred action

Phase 1 may implement the semantic wrappers while retaining all current binary
details behind them. A public native ABI is considered only after a concrete
native consumer requires it and after its separate versioning, ownership,
64-bit size, error, lifecycle, visibility, and symbol-allowlist contracts are
implemented and tested. A schema or wrapper release must not implicitly promote
the current C ABI to public status.

## Audit conclusion

The Phase 0 native ABI gate is complete as a design decision: use private static
linkage for Python, keep C ABI v1 as the WASM host ABI, and expose only semantic
high-level concepts to future library users. No C++ or build-system change is
required for this conclusion.
