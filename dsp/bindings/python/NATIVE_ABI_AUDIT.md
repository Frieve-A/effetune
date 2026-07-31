# Python native boundary audit

This audit defines the native boundary used by the Python 0.1 package. It does
not promote the repository's wasm32 C ABI to a public native ABI.

## Public and private surfaces

- The supported public contract is the `effetune` Python API, Chain v1, and
  Bundle v1.
- `effetune._native` is a private nanobind extension statically linked to the
  C++ DSP core. Its methods, C++ types, layout, and symbols may change without
  compatibility guarantees.
- The extension and every statically linked target, including the DSP core,
  PFFFT, and nanobind, compile with hidden symbol visibility. Linux additionally
  excludes archive symbols and applies a version script; macOS applies an
  exported-symbol list. Their final allowlist contains only `PyInit__native`.
- Windows' final allowlist contains `PyInit__native` and nanobind's decorated
  `python_error`/`builtin_exception` implementation symbols, which nanobind
  explicitly marks for export. It rejects all DSP, PFFFT, and other symbols.
- Every Windows, Linux, Intel macOS, and Apple Silicon wheel runs
  `tools/audit_native_exports.py` inside the cibuildwheel test environment.
  The audit fails closed if the platform inspection tool is unavailable or the
  final module exports a symbol outside its allowlist.
- CPython 3.10 and 3.11 use version-specific extensions. CPython 3.12 and newer
  use a separately built `cp312-abi3` extension.

## 64-bit hosts and assets

Python array dimensions enter the adapter as native `size_t` values. Before
they are narrowed to the DSP core's `uint32_t` fields, the adapter checks
channel, frame, path-count, payload-size, and estimated-footprint bounds.
Payload and footprint arithmetic remains in `size_t`, and both must fit the
32 MiB per-asset capacity and `uint32_t` before the transfer begins.

Bundle v1 verifies the full ETA1 payload length and SHA-256 digest before
decoding. The adapter then reconstructs a bounded ETA1 staging payload from
validated planar `float32` samples and path records instead of passing a host
pointer through the wasm32 ABI. No pointer, NumPy buffer address, or
platform-sized integer is serialized into the public contract.

## Ownership and concurrency

One native chain owns one C++ engine through RAII. NumPy buffers are borrowed
only for the duration of a call, and processing copies them into and out of
engine-owned storage. Calls retain the Python GIL, serializing `process`,
parameter staging, `reset`, and `close` for one object. `close()` releases the
engine once and later native operations fail rather than using released
storage.

This boundary is intentionally narrow. A future public native ABI requires a
separate versioned design and export audit; it must not infer stability from
the private extension described here.
