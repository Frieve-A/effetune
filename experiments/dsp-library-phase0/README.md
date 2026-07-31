# EffeTune DSP library Phase 0

Phase 0 is complete as a design spike. It proves one existing kernel
(`CompressorPlugin`) through private Python and browser wrappers and closes the
schema, high-level API design, and native ABI audit gates needed before Phase 1.
It does not ship a supported library or freeze a public v1 contract.

## Deliverables and status

| Deliverable | Status |
|---|---|
| `effetune_phase0.Compressor` nanobind/NumPy PoC | **Implemented in Phase 0** |
| Real Chromium `CompressorWorklet` with baseline and SIMD WASM | **Implemented in Phase 0** |
| [Semantic Chain JSON Schema v1 draft](chain-v1.schema.json) | **Designed in Phase 0** |
| [High-level Python and JavaScript API](api-design.md) | **Designed in Phase 0** |
| [Native ABI audit](native-abi-audit.md) | **Audited in Phase 0** |
| Compressor wrapper-to-golden verification | **Verified in Phase 0** |
| Runtime `Chain`, preset migration, asset resolver implementation, file I/O, all-kernel coverage, bundles, wheels/npm, CLI, and distribution | **Deferred to Phase 1+** |

The Python PoC statically links the existing C++ kernel into a nanobind module
and processes C-contiguous planar float32 NumPy arrays. The worklet PoC reuses
the existing generated parameter packer, `plugin-processor` binding, and
baseline/SIMD WASM artifacts in a real Chromium AudioWorklet.

The schema is a Compressor-only semantic draft, not the application's existing
preset format and not a released v1 compatibility guarantee. The API document
defines the intended `Effect`/`Compressor`/ordered `Chain` boundary, but only
the standalone Compressor paths are implemented here. The ABI audit concludes
that C ABI v1 remains a private WASM host ABI; Python uses a private static
adapter.

## Phase boundary

Phase 0 implements only enough runtime behavior to test the product direction.
Phase 1 or later must implement and verify the designed runtime `Chain`,
streaming, preset loading and legacy import, asset bundles and resolution,
decoded telemetry facade, file I/O integrations, broader kernel surface,
packaging, and distribution. No missing item in that list is represented as
implemented by the design artifacts.

## Focused verification

From the repository root, use an isolated environment and keep all build
outputs under the ignored `.tmp/dsp-library-phase0` directory:

```powershell
python -m venv .tmp\dsp-library-phase0\venv
.\.tmp\dsp-library-phase0\venv\Scripts\python.exe -m pip install --upgrade pip
.\.tmp\dsp-library-phase0\venv\Scripts\python.exe -m pip install `
  numpy nanobind scikit-build-core
.\.tmp\dsp-library-phase0\venv\Scripts\python.exe -m pip install `
  --no-build-isolation -e experiments\dsp-library-phase0
.\.tmp\dsp-library-phase0\venv\Scripts\python.exe `
  experiments\dsp-library-phase0\verify_python.py
node experiments\dsp-library-phase0\verify_browser.mjs
```

Both verifiers read the committed Compressor `case-003` metadata and use its
sample rate, channel/frame counts, parameters, and absolute tolerance. Python
also uses the metadata's 64-frame block size. Chromium renders AudioWorklet
graphs in fixed 128-frame quanta, so the browser verifier records that
difference explicitly. This maximum-compression case uses the deterministic
full-scale stimulus, has no parameter events, and remains within the committed
64-frame golden tolerance under the AudioWorklet quantum. Both verifiers also
require the golden to differ from the dry stimulus by more than that tolerance,
so a bypassed or missing Compressor cannot satisfy the comparison.
