# Bluetooth SBC Simulator performance evidence

## Decision

Bluetooth SBC Simulator passes the Phase 0 real-time performance hard gate. The only current
acceptance authority is the post-WASM-initialization-fix, fixed-work current-thread CPU
campaign in `performance-thread-cpu-formal.json`. Both Release baseline and SIMD artifacts
processed the verified wet codec path and passed every trial and aggregate check with
substantial margin. The production promotion is therefore unblocked.

The accepted contract was approved after the per-quantum Windows measurements showed that
scheduler stalls and platform accounting granularity could dominate a 0.333–1.333 ms quantum.
The thresholds were not changed. Instead, the same real codec work was measured in fixed
1.365–1.486 second batches so current-thread CPU accounting had enough resolution to support
the existing percentage limits.

## Accepted environment and artifacts

- OS: Microsoft Windows 11 Pro 10.0.26200, build 26200
- CPU: 13th Gen Intel Core i9-13900KF
- Power mode: Windows Balanced (`381b4222-f694-41f0-9685-ff5bb260df2e`)
- Emscripten: 6.0.2
- ABI / build type: 1 / Release
- Channels / worklet-shaped block size / instances: 2 / 128 / 1
- Scratch source digest: `sha256:8ebc5e9b17eb785b9e9953853ce8c5ed9025fc0972408422ed17b4c627073c18`
- Baseline WASM: `sha256:5c73b7893a309d755557bc85fc50f9a7fe7b884b1cf3331c37a8b23ad290ef93`
- SIMD WASM: `sha256:3ad1a52bda5c89534e99e827ad63ba2299f5e62e24772dc06955e078e57b8963`
- Production-equivalence manifest: `sha256:2f8315bcc12937180f62fdb80b3494601665e37c11b0607de07a65bbb78c1f54`
- Fixed-batch evidence: `performance-thread-cpu-formal.json`
- Evidence SHA-256: `FD982838D72DF9D5D72A4B9B872A065C7EE2F737A415B80F9541782141AABE58`

The isolated snapshot source digest matched the artifact metadata before and after the
campaign. Its stability manifest was identical at every case boundary and at completion:
`sha256:4f7d41fd7e0f2f2cedc1b570eb15209eca9e40f4729e259815aa69d640809dde`.
The baseline and SIMD work signatures were also identical:
`sha256:a7b266c566427e553a025850ea9c4f170c287106ef67c3a74607a7472493f63e`.

## Accepted measurement contract

- Backends: Release baseline WASM and SIMD128 WASM.
- Rates: 96, 352.8, and 384 kHz.
- Settings: bitpool 53, blocks 4, Stereo and Joint Stereo.
- Repetitions: three fresh WASM instances per backend/rate/setting.
- Warmup: two complete, unmeasured batches on the measured instance, followed by reset.
- Measurement: `process.threadCpuUsage()` for current-thread CPU; high-resolution wall time
  is diagnostic only.
- Batches: 22 per trial. A 96 kHz batch is 1,024 quanta / 131,072 frames / 1.365333 seconds.
  A 352.8 kHz batch is 4,096 quanta / 524,288 frames / 1.486077 seconds. A 384 kHz batch is
  4,096 quanta / 524,288 frames / 1.365333 seconds.
- Hard thresholds: 96 kHz average `< 15%`; all rates p99 `< 50%`, max `< 80%`, and batch
  budget overruns `= 0`, applied to every trial and the three-trial aggregate.
- Goal: average `<= 10%` at every rate.
- Percentile: exact nearest-rank p99. With 22 observations per trial and 66 per aggregate,
  p99 equals the maximum.
- Timer policy: the observed raw-duration GCD was 1 ms. The evidence audit conservatively
  evaluates Windows accounting with a 16 ms tick instead. A passing value within one
  normalized tick of a threshold is inconclusive and fails closed. The normalized tick is
  1.171875% at 96/384 kHz and 1.076660% at 352.8 kHz.

## Accepted aggregate results

| Backend | Rate | Setting | Average | p99 / max | Overruns | Batches |
|---|---:|---|---:|---:|---:|---:|
| baseline | 96 kHz | bp53, Stereo, blocks4 | 1.0054% | 1.1719% | 0 | 66 |
| baseline | 96 kHz | bp53, Joint, blocks4 | 1.0576% | 1.1719% | 0 | 66 |
| SIMD | 96 kHz | bp53, Stereo, blocks4 | 1.2662% | 2.2705% | 0 | 66 |
| SIMD | 96 kHz | bp53, Joint, blocks4 | 1.3361% | 2.3438% | 0 | 66 |
| baseline | 352.8 kHz | bp53, Stereo, blocks4 | 5.8309% | 8.4114% | 0 | 66 |
| baseline | 352.8 kHz | bp53, Joint, blocks4 | 5.4159% | 7.4020% | 0 | 66 |
| SIMD | 352.8 kHz | bp53, Stereo, blocks4 | 4.8756% | 7.3347% | 0 | 66 |
| SIMD | 352.8 kHz | bp53, Joint, blocks4 | 4.4453% | 5.3160% | 0 | 66 |
| baseline | 384 kHz | bp53, Stereo, blocks4 | 5.0115% | 6.8848% | 0 | 66 |
| baseline | 384 kHz | bp53, Joint, blocks4 | 6.8326% | 9.1553% | 0 | 66 |
| SIMD | 384 kHz | bp53, Stereo, blocks4 | 6.7283% | 9.1553% | 0 | 66 |
| SIMD | 384 kHz | bp53, Joint, blocks4 | 5.8616% | 7.9834% | 0 | 66 |

Every individual trial passed. The worst trial average was 8.2730%, the worst trial and
aggregate p99/max was 9.1553%, and all 792 measured batches completed without a budget
overrun. The 96 kHz strict average margin was more than 13 percentage points; the p99 and max
margins were more than 40 and 70 percentage points respectively, so the conservative 16 ms
timer policy does not make any result borderline.

## Historical invalid and diagnostic campaigns

The earlier pilot files under `performance-pilot/`, the older `performance-formal*.json`
wall-clock files, the Chromium AudioWorklet/CDP files, and
`performance-thread-cpu-formal-pre-wasm-init-fix.json` were all produced from artifacts in
which the SBC analysis and synthesis cosine tables were left zero in standalone WASM. A
file-scope dynamic initializer had not run, so the wet path emitted silence. These records are
retained only as historical diagnostics and are not evidence for the cost of the correct codec
workload. In particular, the former current-thread evidence SHA-256
`0F2AC725926959B7E68307FDCB565C257E5800575CC71D4EF77CA03B84F6D6DF` is invalid for
acceptance.

The cosine matrices are now initialized explicitly during kernel preparation without heap
allocation. Before the accepted campaign, the new scratch baseline and SIMD artifacts each
matched all nine fixed production goldens exactly, including wet-output cases. The accepted
fixed-batch campaign then used those verified artifacts with the same parameter layout, Release
build tuple, rates, worst settings, and conservative Windows 16 ms accounting tick described
above. No older wall-clock, AudioWorklet, pilot, or pre-fix current-thread result has current
gate authority.
