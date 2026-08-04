# G.726 conformance oracle provenance

The production implementation is clean-room code derived from the published Recommendation. No ITU test-software source or fixture is redistributed in this repository.

## Specifications

- ITU-T G.726 (12/1990): <https://www.itu.int/rec/T-REC-G.726-199012-I/en>
- ITU-T G.726 Annex A (11/1994): <https://www.itu.int/rec/T-REC-G.726-199411-I!AnnA/en>
- ITU-T G.726 Corrigendum 1 (05/2005): <https://www.itu.int/rec/T-REC-G.726-200505-I!Cor1/en>
- ITU-T G.191 Software Tools Library, STL2024 (05/2024): <https://www.itu.int/rec/T-REC-G.191/en>

Downloaded G.726 Recommendation PDF SHA-256:
`0B2900DA45A774526A5A4FF9AAD5F277B5727AB1D9831A038E3D66FEF07E86F1`

Downloaded STL2024 archive SHA-256:
`E9ED6CED20ACBA2C20E25C36C26A77A67E07B559598EE658138C1D846E7C8006`

## Reproduction

1. Download and extract the official STL2024 attachment outside tracked source.
2. Configure `tools/dsp-parity/g726-state-oracle` with
   `-DET_STL_G726_DIR=<STL extraction>/src/src/g726`, then build its
   `effetune-g726-state-oracle` target outside the repository.
3. Run that adapter as
   `effetune-g726-state-oracle <STL extraction>/src/src/g726/test_data <state-digest-file>`.
   It checks the official encoder codewords and decoder/SCA outputs while producing the
   `g726-state-digest-v1` checkpoint file.
4. Set `EFFETUNE_G726_VECTOR_DIR` to the same `test_data` directory,
   `EFFETUNE_G726_STATE_DIGEST_FILE` to the generated file, and
   `EFFETUNE_G726_REQUIRE_STATE_EXACT=1`, then run the
   `effetune_dsp_g726_adpcm_simulator_tests` native test.

The conformance run performed on August 2, 2026 checked all 16 STL series: A-law and
mu-law, normal and overload inputs, at 16, 24, 32, and 40 kbit/s. Every encoder codeword
and decoder/SCA output matched. The production implementation also matched independent
external encoder and decoder state digests after sample 256 and after the final sample of
every series (64 exact state checks). The digest includes `yl`, `yu`, `dms`, `dml`, `ap`,
both predictor coefficients, all six zero-predictor coefficients, the two sign histories,
all six quantized-difference histories, both reconstructed-signal histories, and `td` in a
fixed little-endian FNV-1a encoding.

The same native test exercises Annex A 14-bit boundaries including the Corrigendum 1 LIMO
case, all supported host rates, measured latency, channel behavior, finite output, bitrate
changes, reset reproducibility, and allocation-guarded processing.

The performance authority was completed on 2026-08-02 under the owner's explicit allowance
to substitute aggregate current-thread CPU time after proving that no quantum has a special
heavy path. The 128-frame schedule has at most 11 codec ticks at 96 kHz and 3 at 352.8/384
kHz. A conservative model, which charges every codec tick and generated wet sample at an
upper-bound cost while omitting fixed host work from the average denominator, gives
max-work/average-work ratios of 1.4360, 1.4007, and 1.4604 respectively. Electron 43.2.0
`process.threadCpuUsage()` then measured 18 unmodified 30-second-equivalent baseline/SIMD
trials. Raw average occupancy was 1.4067% to 3.7500%; after adding one 16 ms clock quantum it
was 1.46% to 3.8033%. Multiplying by the applicable work ratio modeled the worst quantum at
2.0966% to 5.5543%, below the 50% p99, 80% max, and 100% deadline limits with zero modeled
misses. No Volume/empty control was subtracted. The machine-readable authority is
`performance-cpu-formal.json`; earlier wall/CDP reports remain diagnostic only. This satisfies
the performance requirement. Production promotion was approved after a fresh STL2024
download reproduced the archive hash, all 16 official code/output series, and all 64 strict
state checkpoints against the same source revision.

Performance freshness uses the G.726-specific
`g726-production-performance-input-sha256-v2` contract. It hashes an ordered, explicit list of
the G.726 kernel, parameter schema and generated header, shared halfband and rational
resampler code, the ABI/engine/arena/registry dispatch path, production binding and WASM
exports, measurement runner/tool, and EMSDK version. It also records normalized source-side
CMake declarations and the exact production configure arguments used by the builder. After
configuration, the builder reads the resolved Ninja compile edges for the G.726 kernel, shared
core, and WASM binding stub, the resolved `effetune-dsp` link edge, and CMake's Emscripten C++
compiler identity. These baseline/SIMD authority manifests participate in the component digest
and remain human-readable in artifact metadata and the formal report. Text line endings
normalize to LF, then SHA-256 receives the contract and each component as `id\0content\0`.
The registry component contains only the normalized G.726 production entry, and unrelated
plugin targets and sources are excluded, so their changes do not invalidate this authority.
Artifact, measurement-start, measurement-end, and completion-current digests must all match.
The complete repository `sourceDigest` and baseline/SIMD WASM hashes remain diagnostic
provenance; unrelated plugin changes to those values alone do not invalidate G.726 performance
evidence.

The browser resume smoke now loads the committed production DSP artifact and the generated
production parameter packer. It verifies that codec and resampler state restart together after
suspension without relying on a Phase 0 scratch artifact.

STL2024 carries the ITU-T Software Tools' General Public License. Its source, vectors,
generated digest file, and linked oracle executable are therefore external verification
inputs and are not copied into this MIT-licensed repository. The repository contains only
the adapter source and the clean-room production test contract.
