# DSP Benchmark Baselines

Update this file at each migration phase boundary using `bench.mjs`. Record the exact
commit, Node version, CPU, operating system, build flags, and command with every result.
Realtime factor is seconds of audio processed per second of CPU time; higher is better.

## Environment

| Field | Value |
| --- | --- |
| Commit | `0ee9ab21` plus the working-tree migration |
| Date | 2026-07-10 |
| Node | v24.13.0 |
| CPU | 13th Gen Intel Core i9-13900KF |
| OS | Windows NT 10.0.26200.0 |
| Baseline WASM build | Emscripten 6.0.2, `-O3 -flto` |
| SIMD WASM build | Emscripten 6.0.2, `-O3 -flto -msimd128` |

## Reference Presets

| Phase | Preset | Sample rate | Channels | JS | Native | WASM | WASM SIMD | Command |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | `presets/processor/bbe.effetune_preset` | 48000 | 2 | 11.86x | n/a | n/a | n/a | `node tools/dsp-parity/bench.mjs --preset presets/processor/bbe.effetune_preset --modes js --sample-rates 48000 --channels 2` |
| 0 | `presets/spatial/live.effetune_preset` | 48000 | 2 | 2.33x | n/a | n/a | n/a | `node tools/dsp-parity/bench.mjs --preset presets/spatial/live.effetune_preset --modes js --sample-rates 48000 --channels 2` |
| 0 | `presets/visualize/all_analyzers.effetune_preset` | 48000 | 2 | 10.74x | n/a | n/a | n/a | `node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes js --sample-rates 48000 --channels 2` |
| 3a | `presets/processor/bbe.effetune_preset` | 48000 | 2 | 11.86x | n/a | 11.39x | 12.05x | `node tools/dsp-parity/bench.mjs --preset presets/processor/bbe.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 3a | `presets/spatial/live.effetune_preset` | 48000 | 2 | 2.33x | n/a | 2.34x | 2.35x | `node tools/dsp-parity/bench.mjs --preset presets/spatial/live.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 3a | `presets/visualize/all_analyzers.effetune_preset` | 48000 | 2 | 10.74x | n/a | 11.52x | 12.20x | `node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 3b | `presets/processor/bbe.effetune_preset` | 48000 | 2 | 11.86x | n/a | 15.06x | 14.89x | `node tools/dsp-parity/bench.mjs --preset presets/processor/bbe.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 3b | `presets/spatial/live.effetune_preset` | 48000 | 2 | 2.33x | n/a | 3.82x | 3.68x | `node tools/dsp-parity/bench.mjs --preset presets/spatial/live.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 3b | `presets/visualize/all_analyzers.effetune_preset` | 48000 | 2 | 10.74x | n/a | 22.59x | 19.71x | `node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 4 | `presets/processor/bbe.effetune_preset` | 48000 | 2 | 11.86x | n/a | 15.30x | 14.57x | `node tools/dsp-parity/bench.mjs --preset presets/processor/bbe.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 4 | `presets/spatial/live.effetune_preset` | 48000 | 2 | 2.33x | n/a | 3.62x | 3.71x | `node tools/dsp-parity/bench.mjs --preset presets/spatial/live.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 4 | `presets/visualize/all_analyzers.effetune_preset` | 48000 | 2 | 10.74x | n/a | 143.75x | 156.63x | `node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 3d | `presets/processor/bbe.effetune_preset` | 48000 | 2 | 11.86x | n/a | 14.80x | 14.66x | `node tools/dsp-parity/bench.mjs --preset presets/processor/bbe.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 3d | `presets/spatial/live.effetune_preset` | 48000 | 2 | 2.33x | n/a | 9.35x | 9.85x | `node tools/dsp-parity/bench.mjs --preset presets/spatial/live.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 3d | `presets/visualize/all_analyzers.effetune_preset` | 48000 | 2 | 10.74x | n/a | 142.39x | 153.30x | `node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2` |
| 3 final | `presets/processor/bbe.effetune_preset` | 48000 | 2 | 11.86x | n/a | 171.96x | 160.01x | `node tools/dsp-parity/bench.mjs --preset presets/processor/bbe.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2 --duration 1 --warmup 2 --repetitions 5` |
| 3 final | `presets/spatial/live.effetune_preset` | 48000 | 2 | 2.33x | n/a | 51.70x | 52.55x | `node tools/dsp-parity/bench.mjs --preset presets/spatial/live.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2 --duration 1 --warmup 2 --repetitions 5` |
| 3 final | `presets/visualize/all_analyzers.effetune_preset` | 48000 | 2 | 10.74x | n/a | 75.90x | 83.22x | `node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes wasm,simd --sample-rates 48000 --channels 2 --duration 1 --warmup 2 --repetitions 5` |
| 4 budget | `presets/visualize/all_analyzers.effetune_preset` | 96000 | 2 | n/a | n/a | 52.21x | 54.05x | `node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes wasm,simd --sample-rates 96000 --channels 2 --duration 1 --warmup 2 --repetitions 5` |
| 5 single-call | `presets/processor/bbe.effetune_preset` | 48000 | 2 | 11.86x | n/a | 208.93x | 193.13x | `node tools/dsp-parity/bench.mjs --preset presets/processor/bbe.effetune_preset --modes wasm --sample-rates 48000 --channels 2 --duration 1 --warmup 2 --repetitions 5 --single-call`<br>`node tools/dsp-parity/bench.mjs --preset presets/processor/bbe.effetune_preset --modes simd --sample-rates 48000 --channels 2 --duration 1 --warmup 2 --repetitions 5 --single-call` |
| 5 single-call | `presets/spatial/live.effetune_preset` | 48000 | 2 | 2.33x | n/a | 84.70x | 80.31x | `node tools/dsp-parity/bench.mjs --preset presets/spatial/live.effetune_preset --modes wasm --sample-rates 48000 --channels 2 --duration 1 --warmup 2 --repetitions 5 --single-call`<br>`node tools/dsp-parity/bench.mjs --preset presets/spatial/live.effetune_preset --modes simd --sample-rates 48000 --channels 2 --duration 1 --warmup 2 --repetitions 5 --single-call` |
| 5 single-call | `presets/visualize/all_analyzers.effetune_preset` | 48000 | 2 | 10.74x | n/a | 116.48x | 124.56x | `node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes wasm --sample-rates 48000 --channels 2 --duration 1 --warmup 2 --repetitions 5 --single-call`<br>`node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes simd --sample-rates 48000 --channels 2 --duration 1 --warmup 2 --repetitions 5 --single-call` |
| 5 single-call | `presets/visualize/all_analyzers.effetune_preset` | 96000 | 2 | n/a | n/a | 71.41x | 81.95x | `node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes wasm --sample-rates 96000 --channels 2 --duration 1 --warmup 2 --repetitions 5 --single-call`<br>`node tools/dsp-parity/bench.mjs --preset presets/visualize/all_analyzers.effetune_preset --modes simd --sample-rates 96000 --channels 2 --duration 1 --warmup 2 --repetitions 5 --single-call` |

Phase 3a WASM rows are hybrid pipeline measurements: metadata-listed kernels use the
selected WASM artifact and remaining plugins stay in their JS reference path. Their JS
column repeats the Phase 0 baseline for direct comparison.

Phase 3b rows use the same hybrid rule and retain the Phase 0 JS baseline. All three
reference presets improved over their Phase 3a WASM and SIMD results.

Phase 4 rows are the 48-kernel checkpoint after all five analyzers, the Basics topology
plugins, both delay plugins, six single-band dynamics plugins, five light Lo-Fi/generator
plugins, and six saturation plugins were enabled. The processor and spatial presets
remain above the Phase 0 JS baseline. Moving all analyzer work into WASM increased the
all-analyzers preset from 10.74x JS to 143.75x baseline WASM and 156.63x SIMD.

The Phase 3d rows are the 57-kernel checkpoint after multiband dynamics, Power Amp
Sag, advanced seeded Lo-Fi, Doppler Distortion, and Wow Flutter were enabled. All three
presets remain above the Phase 0 JS baseline; `spatial/live` improved from about 3.6x at
the 48-kernel checkpoint to 9.35x baseline WASM and 9.85x SIMD.

The final Phase 3 rows use the 67-kernel artifacts and the fixed one-second measurement
condition shown in the table. Against the retained Phase 0 JS baselines, `bbe` measured
14.50 times faster in baseline WASM and 13.49 times faster in SIMD, `spatial/live`
measured 22.19 and 22.55 times faster, and `all_analyzers` measured 7.07 and 7.75 times
faster. At 96 kHz/stereo, `all_analyzers` processed 52.21x realtime in baseline WASM and
54.05x in SIMD, so both variants satisfy the Phase 4 quantum budget requirement of more
than 1x realtime.

The Phase 5 rows retain those Phase 3 final per-instance measurements and add an explicit
single-call preset path. Each active preset plugin must exist in the selected artifact;
the harness prepares the engine with the production 256 KiB telemetry ring, stages every
instance, configures the current pipeline descriptor, and calls `et_pipeline_process`
once per 128-frame quantum. Baseline and SIMD were measured in
separate sequential processes with the one-second, two-warmup, five-repetition condition
shown in the table.

The heavy `spatial/live` preset improved rather than staying flat: baseline/SIMD rose from
9.35x/9.85x at Phase 3d and 51.70x/52.55x in the Phase 3 final per-instance rows to
84.70x/80.31x with the production-style pipeline call. `bbe` also improved over the final
row. At 48 kHz, `all_analyzers` improved over the final row but remains below the older
Phase 3d numbers, whose default ten-second measurement condition is not directly
comparable. At 96 kHz, the single-call result improved from the Phase 4 budget row's
52.21x/54.05x to 71.41x/81.95x.

The Phase 4 telemetry contract runs all five analyzers together for one second at
96 kHz/stereo with the production 256 KiB ring and the visible-tab 60 Hz global tick.
The original Phase 4 measurements used a 64 x 64 Stereo Meter histogram. Stereo Meter
telemetry v2 instead transfers each new X/Y sample as two Float32 values and lets the
renderer retain and draw the selected window. This restores sample-level resolution,
keeps coordinates independent of the current display scale, and raises its intentional
96 kHz transfer budget from 0.2 MB/s to 0.9 MB/s. The v2 byte count below is derived from
768,000 coordinate bytes plus 60 fixed 1,480-byte frames per second. At 96 kHz, the
one-second renderer ring stores 96,000 X/Y pairs in two Float32 arrays (768,000 bytes).
The updated all-analyzer soak produced the listed v2 count in both artifacts with zero
core drops; the other rows retain their Phase 4 measurements.

| Analyzer | Target | Baseline WASM | WASM SIMD |
| --- | ---: | ---: | ---: |
| Level Meter | negligible | 2,400 B/s | 2,400 B/s |
| Oscilloscope | ≤ 300,000 B/s | 116,040 B/s | 116,040 B/s |
| Spectrum Analyzer | ≤ 600,000 B/s | 492,600 B/s | 492,600 B/s |
| Spectrogram | ≤ 50,000 B/s | 13,064 B/s | 13,064 B/s |
| Stereo Meter | ≤ 900,000 B/s | 856,800 B/s | 856,800 B/s |

## Per-Plugin Notes

Add per-plugin tables when a port is enabled. Use 10 seconds of deterministic `noise`
in 128-frame blocks, 5 warmups, and the median of 20 measured repetitions unless a row
explicitly documents a different setup.

### Phase 1: VolumePlugin

Command: `node tools/dsp-parity/bench.mjs --type VolumePlugin`

| Sample rate | Channels | JS | Native | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 290.61x | 181.04x | 5017.06x | 4960.69x |
| 48000 | 8 | 56.36x | 74.07x | 1576.98x | 1296.07x |
| 96000 | 2 | 123.70x | 112.62x | 2139.33x | 2048.49x |
| 96000 | 8 | 23.28x | 41.97x | 721.63x | 803.53x |
| 192000 | 2 | 56.80x | 74.95x | 1341.31x | 1522.64x |
| 192000 | 8 | 13.10x | 22.65x | 383.62x | 359.32x |

Native measurements include one external runner process plus temporary input, control,
and output file I/O per repetition. JS, WASM, and WASM SIMD run in-process, so compare
the native figures as end-to-end harness throughput rather than isolated kernel time.

### Phase 2: LevelMeterPlugin

Command: `node tools/dsp-parity/bench.mjs --type LevelMeterPlugin`

| Sample rate | Channels | JS | Native | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 183.21x | 164.64x | 1219.10x | 1245.52x |
| 48000 | 8 | 37.52x | 63.64x | 407.39x | 423.56x |
| 96000 | 2 | 61.27x | 104.98x | 826.27x | 851.54x |
| 96000 | 8 | 19.94x | 36.34x | 234.21x | 226.06x |
| 192000 | 2 | 29.32x | 64.60x | 443.13x | 460.78x |
| 192000 | 8 | 8.76x | 19.99x | 119.94x | 123.07x |

The 10-minute-equivalent telemetry soak used four Level Meter instances at 192 kHz,
two channels, 128-frame quanta, a 256 KiB ring, and 60 Hz telemetry. Both committed
variants processed 900,000 quanta and delivered 144,000 frames with zero core drops:

| Variant | Simulated audio | Wall time | Frames | Drops |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 600.000 s | 0.936 s | 144000 | 0 |
| SIMD | 600.000 s | 0.931 s | 144000 | 0 |

Command: `node tools/dsp-parity/telemetry-soak.mjs --seconds 600 --variant <baseline|simd>`

### Phase 3a: Tier-1 Plugins

Commands used `node tools/dsp-parity/bench.mjs --type <Type> --modes js,wasm,simd`.
Native allocation parity passed all 94 cases; native throughput was omitted because the
runner's per-repetition process and file I/O overhead dominates these stateless kernels.

#### DCOffsetPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 301.32x | 4724.00x | 5600.83x |
| 48000 | 8 | 68.61x | 1480.94x | 1938.91x |
| 96000 | 2 | 127.28x | 2469.87x | 2477.58x |
| 96000 | 8 | 31.72x | 1017.88x | 1024.83x |
| 192000 | 2 | 64.28x | 1490.92x | 1577.06x |
| 192000 | 8 | 13.58x | 422.08x | 450.18x |

#### MutePlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 302.87x | 6633.28x | 6406.15x |
| 48000 | 8 | 59.98x | 1428.22x | 1587.38x |
| 96000 | 2 | 113.13x | 2308.40x | 2455.98x |
| 96000 | 8 | 29.74x | 676.41x | 811.64x |
| 192000 | 2 | 61.84x | 1227.57x | 1198.88x |
| 192000 | 8 | 16.12x | 371.05x | 388.34x |

#### PolarityInversionPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 163.30x | 5619.24x | 6393.45x |
| 48000 | 8 | 26.52x | 1407.09x | 1736.02x |
| 96000 | 2 | 60.51x | 2130.90x | 2500.34x |
| 96000 | 8 | 12.79x | 714.62x | 759.41x |
| 192000 | 2 | 30.86x | 1373.17x | 1308.80x |
| 192000 | 8 | 8.38x | 320.05x | 323.18x |

#### StereoBalancePlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 211.22x | 5610.26x | 5160.36x |
| 48000 | 8 | 53.06x | 1302.66x | 1301.12x |
| 96000 | 2 | 84.23x | 2225.63x | 2686.91x |
| 96000 | 8 | 20.72x | 757.03x | 746.18x |
| 192000 | 2 | 42.31x | 1178.53x | 1321.99x |
| 192000 | 8 | 14.01x | 330.11x | 341.94x |

#### HardClippingPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 94.35x | 836.95x | 755.14x |
| 48000 | 8 | 15.90x | 210.90x | 212.03x |
| 96000 | 2 | 38.38x | 395.44x | 409.10x |
| 96000 | 8 | 7.27x | 107.93x | 117.82x |
| 192000 | 2 | 18.13x | 206.53x | 220.56x |
| 192000 | 8 | 3.62x | 54.00x | 59.55x |

#### SaturationPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 21.32x | 453.76x | 448.73x |
| 48000 | 8 | 4.85x | 121.46x | 124.13x |
| 96000 | 2 | 12.11x | 281.11x | 290.13x |
| 96000 | 8 | 2.87x | 68.87x | 75.18x |
| 192000 | 2 | 5.91x | 145.41x | 153.32x |
| 192000 | 8 | 1.49x | 35.42x | 38.08x |

#### MSMatrixPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 152.23x | 4671.81x | 5175.18x |
| 48000 | 8 | 1196.47x | 2612.81x | 2713.23x |
| 96000 | 2 | 61.11x | 2011.30x | 2000.76x |
| 96000 | 8 | 410.74x | 1167.34x | 903.33x |
| 192000 | 2 | 30.81x | 1325.42x | 1287.77x |
| 192000 | 8 | 213.32x | 587.49x | 437.55x |

#### StereoBlendPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 294.21x | 4926.23x | 5342.17x |
| 48000 | 8 | 258.18x | 2204.00x | 2309.36x |
| 96000 | 2 | 118.92x | 1939.98x | 1838.71x |
| 96000 | 8 | 92.57x | 885.79x | 1075.75x |
| 192000 | 2 | 58.43x | 1351.93x | 1432.15x |
| 192000 | 8 | 49.75x | 449.49x | 409.80x |

### Phase 3b: Filters And EQ

Native allocation parity passed all 112 cases. All 13 kernels were faster than their JS
references at every measured sample-rate/channel point. BandPass, HiPass, LoPass, TiltEQ,
and ToneControl used the standard 10-second/5-warmup/20-repetition command. The remaining
eight used the same six-point matrix with `--duration 1 --warmup 2 --repetitions 5` as a
documented migration sweep.

#### BandPassFilterPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 562.63x | 1208.73x | 1191.98x |
| 48000 | 8 | 228.21x | 325.52x | 290.43x |
| 96000 | 2 | 239.10x | 559.58x | 537.88x |
| 96000 | 8 | 92.44x | 150.51x | 149.61x |
| 192000 | 2 | 112.13x | 298.00x | 285.60x |
| 192000 | 8 | 50.05x | 78.70x | 75.53x |

#### HiPassFilterPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 904.02x | 1768.39x | 1901.99x |
| 48000 | 8 | 384.05x | 575.38x | 580.39x |
| 96000 | 2 | 358.44x | 929.04x | 984.61x |
| 96000 | 8 | 178.04x | 274.68x | 277.63x |
| 192000 | 2 | 179.22x | 484.88x | 483.62x |
| 192000 | 8 | 81.28x | 130.40x | 137.84x |

#### LoPassFilterPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 953.23x | 1942.69x | 2003.12x |
| 48000 | 8 | 387.84x | 575.44x | 576.94x |
| 96000 | 2 | 376.42x | 1020.51x | 955.74x |
| 96000 | 8 | 146.63x | 266.75x | 262.21x |
| 192000 | 2 | 199.76x | 479.53x | 470.47x |
| 192000 | 8 | 88.67x | 140.06x | 138.03x |

#### TiltEQPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 1754.88x | 6487.40x | 6450.99x |
| 48000 | 8 | 929.40x | 2552.58x | 2649.46x |
| 96000 | 2 | 928.80x | 4045.31x | 4022.61x |
| 96000 | 8 | 440.11x | 1160.25x | 1125.66x |
| 192000 | 2 | 368.71x | 1767.38x | 1535.41x |
| 192000 | 8 | 171.68x | 583.06x | 590.11x |

#### ToneControlPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 160.54x | 4442.67x | 4445.04x |
| 48000 | 8 | 28.95x | 1061.66x | 1208.09x |
| 96000 | 2 | 70.18x | 1491.22x | 1718.12x |
| 96000 | 8 | 12.08x | 605.38x | 706.20x |
| 192000 | 2 | 36.23x | 1337.22x | 1229.58x |
| 192000 | 8 | 5.75x | 291.22x | 263.55x |

#### FiveBandPEQPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 258.37x | 1154.47x | 1216.84x |
| 48000 | 8 | 210.25x | 846.31x | 881.06x |
| 96000 | 2 | 136.26x | 1131.86x | 1141.42x |
| 96000 | 8 | 117.36x | 700.62x | 705.07x |
| 192000 | 2 | 71.22x | 972.10x | 992.46x |
| 192000 | 8 | 59.94x | 426.86x | 446.47x |

#### FifteenBandPEQPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 105.81x | 1118.07x | 1200.91x |
| 48000 | 8 | 96.87x | 811.42x | 889.44x |
| 96000 | 2 | 54.66x | 1101.08x | 1094.81x |
| 96000 | 8 | 50.71x | 674.08x | 705.97x |
| 192000 | 2 | 32.02x | 921.57x | 959.05x |
| 192000 | 8 | 29.92x | 464.06x | 479.66x |

#### FifteenBandGEQPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 575.01x | 1215.21x | 1178.00x |
| 48000 | 8 | 396.54x | 838.93x | 917.26x |
| 96000 | 2 | 303.93x | 1127.65x | 1129.56x |
| 96000 | 8 | 202.07x | 691.56x | 686.77x |
| 192000 | 2 | 159.79x | 947.96x | 944.38x |
| 192000 | 8 | 111.82x | 443.24x | 498.16x |

#### EarphoneCableSimPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 83.86x | 893.34x | 852.15x |
| 48000 | 8 | 28.66x | 446.71x | 455.33x |
| 96000 | 2 | 44.13x | 702.84x | 682.83x |
| 96000 | 8 | 14.59x | 290.46x | 290.36x |
| 192000 | 2 | 23.12x | 485.60x | 492.54x |
| 192000 | 8 | 7.39x | 164.14x | 164.55x |

#### CrossfeedFilterPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 34.17x | 926.35x | 978.95x |
| 48000 | 8 | 858.44x | 939.50x | 878.73x |
| 96000 | 2 | 17.53x | 745.16x | 740.74x |
| 96000 | 8 | 461.42x | 688.14x | 689.66x |
| 192000 | 2 | 8.83x | 530.48x | 529.30x |
| 192000 | 8 | 276.14x | 429.77x | 482.98x |

#### CombFilterPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 131.34x | 1051.75x | 1112.97x |
| 48000 | 8 | 36.84x | 713.37x | 663.22x |
| 96000 | 2 | 68.02x | 956.57x | 956.85x |
| 96000 | 8 | 19.10x | 483.72x | 493.75x |
| 192000 | 2 | 35.22x | 733.78x | 696.18x |
| 192000 | 8 | 9.58x | 278.57x | 286.05x |

#### LoudnessEqualizerPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 127.33x | 971.44x | 993.54x |
| 48000 | 8 | 32.07x | 544.34x | 548.19x |
| 96000 | 2 | 54.70x | 777.18x | 793.84x |
| 96000 | 8 | 17.89x | 338.03x | 348.70x |
| 192000 | 2 | 31.85x | 563.51x | 565.83x |
| 192000 | 8 | 9.55x | 194.45x | 199.83x |

#### NarrowRangePlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 96.22x | 703.73x | 688.42x |
| 48000 | 8 | 32.03x | 286.52x | 290.98x |
| 96000 | 2 | 56.13x | 497.27x | 485.77x |
| 96000 | 8 | 16.76x | 161.80x | 162.45x |
| 192000 | 2 | 30.25x | 297.27x | 291.65x |
| 192000 | 8 | 8.68x | 86.66x | 85.58x |

### Phase 3c: Delay, Modulation, And Dynamics

Commands used `node tools/dsp-parity/bench.mjs --type <Type> --modes js,wasm,simd
--duration 1 --warmup 2 --repetitions 5`. Native allocation parity passed all 49 cases
covered by these six kernels.

#### DelayPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 76.38x | 560.13x | 569.48x |
| 48000 | 8 | 26.65x | 203.27x | 207.23x |
| 96000 | 2 | 43.70x | 357.70x | 359.45x |
| 96000 | 8 | 13.71x | 109.03x | 112.19x |
| 192000 | 2 | 22.95x | 203.99x | 207.22x |
| 192000 | 8 | 6.99x | 39.45x | 52.77x |

#### TimeAlignmentPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 124.88x | 948.50x | 1073.54x |
| 48000 | 8 | 33.36x | 561.58x | 584.93x |
| 96000 | 2 | 61.01x | 866.70x | 834.17x |
| 96000 | 8 | 17.32x | 366.07x | 362.74x |
| 192000 | 2 | 32.07x | 596.84x | 613.08x |
| 192000 | 8 | 8.78x | 220.41x | 224.10x |

#### TremoloPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 12.40x | 357.85x | 367.31x |
| 48000 | 8 | 3.52x | 120.38x | 120.32x |
| 96000 | 2 | 5.28x | 145.56x | 156.64x |
| 96000 | 8 | 1.09x | 55.83x | 57.92x |
| 192000 | 2 | 1.88x | 86.46x | 102.38x |
| 192000 | 8 | 0.55x | 28.75x | 28.91x |

#### CompressorPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 51.91x | 533.62x | 545.29x |
| 48000 | 8 | 16.52x | 194.81x | 190.37x |
| 96000 | 2 | 29.44x | 322.24x | 336.53x |
| 96000 | 8 | 8.70x | 105.59x | 104.83x |
| 192000 | 2 | 15.42x | 196.25x | 196.50x |
| 192000 | 8 | 2.83x | 35.43x | 51.49x |

#### GatePlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 42.26x | 663.48x | 673.85x |
| 48000 | 8 | 11.43x | 303.33x | 294.00x |
| 96000 | 2 | 21.42x | 494.41x | 485.37x |
| 96000 | 8 | 5.95x | 167.56x | 164.78x |
| 192000 | 2 | 8.95x | 230.06x | 269.50x |
| 192000 | 8 | 2.36x | 57.37x | 74.65x |

#### ExpanderPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 98.67x | 708.82x | 733.41x |
| 48000 | 8 | 36.81x | 315.19x | 314.29x |
| 96000 | 2 | 59.49x | 519.32x | 524.36x |
| 96000 | 8 | 20.43x | 187.50x | 185.46x |
| 192000 | 2 | 32.85x | 321.49x | 326.04x |
| 192000 | 8 | 10.78x | 99.51x | 99.14x |

#### AutoLevelerPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 99.28x | 620.00x | 622.43x |
| 48000 | 8 | 33.63x | 457.98x | 469.95x |
| 96000 | 2 | 51.89x | 394.20x | 395.93x |
| 96000 | 8 | 17.40x | 265.00x | 270.28x |
| 192000 | 2 | 27.45x | 229.92x | 231.51x |
| 192000 | 8 | 8.84x | 147.56x | 155.40x |

#### BrickwallLimiterPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 85.62x | 499.80x | 520.97x |
| 48000 | 8 | 31.17x | 187.78x | 185.59x |
| 96000 | 2 | 48.85x | 322.79x | 319.03x |
| 96000 | 8 | 16.22x | 102.17x | 101.73x |
| 192000 | 2 | 26.58x | 185.55x | 186.22x |
| 192000 | 8 | 8.58x | 53.75x | 48.19x |

#### TransientShaperPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 64.38x | 534.82x | 536.54x |
| 48000 | 8 | 18.05x | 187.88x | 181.66x |
| 96000 | 2 | 33.32x | 349.66x | 348.57x |
| 96000 | 8 | 9.14x | 103.37x | 100.24x |
| 192000 | 2 | 17.21x | 221.26x | 215.55x |
| 192000 | 8 | 3.70x | 46.12x | 51.88x |

### Phase 3c: Topology, Lo-Fi, Generators, And Saturation

Commands used `node tools/dsp-parity/bench.mjs --type <Type> --modes js,wasm,simd
--duration 1 --warmup 2 --repetitions 5`. Every measured WASM point exceeded its JS
reference except ChannelDivider at 48 kHz/stereo, where the fixed call boundary costs
more than the plugin's trivial two-channel copy. Its other five points improved.

#### ChannelDividerPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 1387.73x | 953.93x | 1154.87x |
| 48000 | 8 | 265.15x | 467.60x | 450.29x |
| 96000 | 2 | 826.38x | 1046.35x | 997.41x |
| 96000 | 8 | 153.70x | 296.30x | 290.09x |
| 192000 | 2 | 470.85x | 916.51x | 900.58x |
| 192000 | 8 | 81.95x | 163.38x | 165.70x |

#### MatrixPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 138.02x | 1026.06x | 1073.65x |
| 48000 | 8 | 55.67x | 840.90x | 766.99x |
| 96000 | 2 | 64.50x | 921.66x | 1016.05x |
| 96000 | 8 | 29.77x | 633.31x | 676.32x |
| 192000 | 2 | 34.67x | 664.36x | 826.86x |
| 192000 | 8 | 15.34x | 423.98x | 457.18x |

#### MultiChannelPanelPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 39.70x | 681.06x | 738.61x |
| 48000 | 8 | 9.66x | 357.45x | 354.01x |
| 96000 | 2 | 18.47x | 515.65x | 547.56x |
| 96000 | 8 | 4.88x | 133.92x | 196.81x |
| 192000 | 2 | 7.76x | 233.62x | 232.00x |
| 192000 | 8 | 1.42x | 96.83x | 87.87x |

#### BitCrusherPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 11.65x | 257.56x | 261.78x |
| 48000 | 8 | 2.94x | 72.38x | 69.56x |
| 96000 | 2 | 6.40x | 196.35x | 214.66x |
| 96000 | 8 | 1.16x | 64.53x | 61.12x |
| 192000 | 2 | 2.75x | 178.69x | 169.07x |
| 192000 | 8 | 0.68x | 50.91x | 52.01x |

#### HumGeneratorPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 22.64x | 483.26x | 463.28x |
| 48000 | 8 | 9.05x | 270.97x | 268.77x |
| 96000 | 2 | 11.56x | 303.18x | 295.88x |
| 96000 | 8 | 3.74x | 138.34x | 119.42x |
| 192000 | 2 | 3.71x | 134.08x | 119.40x |
| 192000 | 8 | 1.32x | 50.56x | 50.06x |

#### NoiseBlenderPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 30.44x | 695.60x | 709.42x |
| 48000 | 8 | 7.89x | 343.15x | 331.22x |
| 96000 | 2 | 15.67x | 517.81x | 526.54x |
| 96000 | 8 | 3.03x | 126.69x | 151.00x |
| 192000 | 2 | 6.25x | 216.23x | 253.47x |
| 192000 | 8 | 1.26x | 91.57x | 79.49x |

#### SimpleJitterPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 37.67x | 723.07x | 747.89x |
| 48000 | 8 | 17.86x | 478.17x | 485.39x |
| 96000 | 2 | 19.37x | 539.87x | 529.66x |
| 96000 | 8 | 9.05x | 298.96x | 300.32x |
| 192000 | 2 | 9.78x | 339.08x | 334.57x |
| 192000 | 8 | 2.66x | 118.92x | 123.06x |

#### OscillatorPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 78.68x | 500.90x | 532.28x |
| 48000 | 8 | 75.41x | 420.45x | 422.49x |
| 96000 | 2 | 39.84x | 431.15x | 438.75x |
| 96000 | 8 | 38.18x | 340.77x | 333.67x |
| 192000 | 2 | 20.08x | 325.53x | 339.57x |
| 192000 | 8 | 19.17x | 249.41x | 246.70x |

#### DynamicSaturationPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 14.06x | 364.83x | 351.93x |
| 48000 | 8 | 3.61x | 123.43x | 122.45x |
| 96000 | 2 | 4.76x | 169.47x | 171.33x |
| 96000 | 8 | 1.09x | 43.85x | 47.94x |
| 192000 | 2 | 2.15x | 106.89x | 84.28x |
| 192000 | 8 | 0.53x | 28.37x | 28.74x |

#### ExciterPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 25.20x | 397.44x | 424.11x |
| 48000 | 8 | 6.27x | 140.89x | 139.78x |
| 96000 | 2 | 12.43x | 250.13x | 250.39x |
| 96000 | 8 | 1.92x | 58.19x | 60.88x |
| 192000 | 2 | 4.86x | 85.93x | 134.11x |
| 192000 | 8 | 0.95x | 35.43x | 30.02x |

#### HarmonicDistortionPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 146.15x | 912.33x | 947.33x |
| 48000 | 8 | 40.14x | 608.12x | 590.28x |
| 96000 | 2 | 77.04x | 868.96x | 876.04x |
| 96000 | 8 | 20.21x | 392.93x | 466.61x |
| 192000 | 2 | 39.24x | 585.79x | 677.69x |
| 192000 | 8 | 10.34x | 227.45x | 285.78x |

#### SubSynthPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 68.24x | 639.35x | 628.10x |
| 48000 | 8 | 24.17x | 276.79x | 271.82x |
| 96000 | 2 | 39.08x | 441.05x | 432.99x |
| 96000 | 8 | 13.15x | 157.79x | 155.89x |
| 192000 | 2 | 21.71x | 261.63x | 274.27x |
| 192000 | 8 | 6.89x | 72.35x | 70.26x |

### Phase 3d: Multiband, Advanced Lo-Fi, And Modulation

Commands used `node tools/dsp-parity/bench.mjs --type <Type> --modes js,wasm,simd
--duration 1 --warmup 2 --repetitions 5`. WASM exceeded JS at every measured point
except the intentionally unsupported 48 kHz/stereo DSD64 pass-through case, where the
fixed dispatch cost reduced throughput from 1097.94x JS to 890.08x baseline WASM and
1028.07x SIMD. The supported DSD64 rates and every other plugin/point improved.

#### MultibandCompressorPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 6.79x | 154.27x | 152.47x |
| 48000 | 8 | 1.08x | 40.64x | 35.20x |
| 96000 | 2 | 2.63x | 69.08x | 83.77x |
| 96000 | 8 | 0.69x | 24.01x | 23.59x |
| 192000 | 2 | 1.23x | 39.47x | 45.79x |
| 192000 | 8 | 0.35x | 11.05x | 12.79x |

#### MultibandExpanderPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 13.45x | 194.26x | 198.35x |
| 48000 | 8 | 3.86x | 58.31x | 58.93x |
| 96000 | 2 | 3.62x | 65.50x | 85.51x |
| 96000 | 8 | 0.88x | 23.53x | 23.87x |
| 192000 | 2 | 1.78x | 54.75x | 43.03x |
| 192000 | 8 | 0.47x | 13.22x | 14.07x |

#### MultibandTransientPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 77.23x | 267.59x | 265.07x |
| 48000 | 8 | 34.64x | 72.09x | 71.61x |
| 96000 | 2 | 49.94x | 162.80x | 162.31x |
| 96000 | 8 | 20.74x | 38.92x | 39.55x |
| 192000 | 2 | 30.08x | 90.55x | 90.63x |
| 192000 | 8 | 11.61x | 19.09x | 19.58x |

#### PowerAmpSagPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 57.96x | 680.60x | 735.73x |
| 48000 | 8 | 25.92x | 523.26x | 512.43x |
| 96000 | 2 | 29.77x | 548.28x | 537.58x |
| 96000 | 8 | 13.28x | 350.48x | 344.74x |
| 192000 | 2 | 15.41x | 351.51x | 363.77x |
| 192000 | 8 | 5.79x | 154.55x | 135.09x |

#### DigitalErrorEmulatorPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 14.29x | 685.92x | 770.95x |
| 48000 | 8 | 9.81x | 536.34x | 541.80x |
| 96000 | 2 | 7.24x | 584.86x | 657.64x |
| 96000 | 8 | 2.84x | 276.18x | 232.44x |
| 192000 | 2 | 2.22x | 356.43x | 330.03x |
| 192000 | 8 | 1.38x | 162.56x | 214.61x |

#### DSD64IMDSimulatorPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 1097.94x | 890.08x | 1028.07x |
| 48000 | 8 | 682.36x | 783.51x | 772.08x |
| 96000 | 2 | 8.58x | 54.15x | 54.55x |
| 96000 | 8 | 2.04x | 13.90x | 12.74x |
| 192000 | 2 | 3.66x | 23.86x | 21.00x |
| 192000 | 8 | 1.02x | 7.34x | 7.02x |

#### VinylArtifactsPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 3.35x | 239.42x | 143.49x |
| 48000 | 8 | 0.57x | 65.78x | 100.45x |
| 96000 | 2 | 1.07x | 171.19x | 182.65x |
| 96000 | 8 | 0.30x | 52.33x | 53.51x |
| 192000 | 2 | 0.57x | 75.55x | 78.18x |
| 192000 | 8 | 0.15x | 21.66x | 24.36x |

#### DopplerDistortionPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 17.47x | 385.34x | 393.51x |
| 48000 | 8 | 4.54x | 140.85x | 137.89x |
| 96000 | 2 | 8.69x | 172.25x | 170.09x |
| 96000 | 8 | 1.40x | 63.52x | 70.57x |
| 192000 | 2 | 2.95x | 122.48x | 101.88x |
| 192000 | 8 | 0.67x | 32.89x | 33.07x |

The undamped minimum-mass parity stress case uses an explicit `abs=1e-3` tolerance:
the float parameter ABI's mass quantization is amplified by the intentionally unstable
mechanical configuration. The other eight cases retain `abs=1e-5`.

#### WowFlutterPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 10.15x | 397.31x | 393.04x |
| 48000 | 8 | 2.90x | 116.87x | 89.58x |
| 96000 | 2 | 3.11x | 141.91x | 143.62x |
| 96000 | 8 | 0.85x | 67.56x | 67.17x |
| 192000 | 2 | 2.24x | 79.29x | 104.05x |
| 192000 | 8 | 0.41x | 36.15x | 33.85x |

#### VinylSimulatorPlugin

Measured on an Intel Core i9-13900KF (32 logical processors), Windows 11 Pro
10.0.26200, and Node v24.13.0 x64. The finalized artifacts are tied to source digest
`sha256:061dce4dbe85672c529762f51774874fc43de5e404897234f938cd8803d64e79`:

| Artifact | SHA256 |
| --- | --- |
| C++ kernel | `5E2ADBC8C8E1E140F454E18F3649730B287C75C010E879F20292F973269749C0` |
| JavaScript reference | `6EE6ADA5DBF9F030F9F572492724C2F3B83CCDA9BEFC34FF7488F0C6DF5B7622` |
| Baseline WASM | `46B240CBDD92B467430680079C31F5A01A5424245590685B891445796A5649D4` |
| SIMD WASM | `E64CCE846955FC91036114926A9EBB3F6F5F3080D984096143393E13507ECB2B` |

Command: `node tools/dsp-parity/bench.mjs --type VinylSimulatorPlugin --modes native,wasm,simd --sample-rates 96000 --channels 2 --duration 2 --warmup 2 --repetitions 5`

The Standard preset used the harness defaults with deterministic noise, 192,000 frames
in 128-frame blocks, and the median of five measured repetitions after two warmups.

| Native | WASM | WASM SIMD |
| ---: | ---: | ---: |
| 1.84x (1.0841 s) | 5.34x (0.3746 s) | 5.79x (0.3454 s) |

The rollout plan's 30% CPU ceiling requires at least 3.33x realtime. Both WASM variants
pass this gate.

The Ultra/192 source comparison used
`D:\program\proto\sound_toolbox\vinyl_explained` at 192 kHz/stereo in 128-frame
blocks with the Ultra preset and seed 20260705. Dust, Static, and Scratch were zero;
silence ran for 0.2 seconds and each 100 Hz, 1 kHz, 15 kHz, and 20 kHz tone ran for
0.1 seconds, discarding the first 50 ms. Analysis used `analysis.js` with
`welchPsd(8192)`, `bandRms(20-20000)`, and `goertzelRms`; THD used harmonics 2-9 and
effective bits used `(SNR - 1.76) / 6.02`. Baseline and SIMD results were identical.

| Metric | Source | Final | Difference | Tolerance | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| 100 Hz | -0.0398428111 dB | -0.0424707762 dB | -0.0026279651 dB | 0.25 dB | PASS |
| 1 kHz | -0.0233796416 dB | -0.0231003482 dB | +0.0002792934 dB | 0.10 dB | PASS |
| 15 kHz | -2.6794116400 dB | -2.6798652368 dB | -0.0004535967 dB | 0.50 dB | PASS |
| 20 kHz | -8.7962130707 dB | -8.7964786733 dB | -0.0002656026 dB | 0.50 dB | PASS |
| THD | 0.5317894813% | 0.5440053926% | +0.0122159113 pp | 0.10 pp | PASS |
| SNR | 59.6485132167 dB | 60.1076526647 dB | +0.4591394480 dB | 1.0 dB | PASS |
| Effective bits | 9.6160320958 | 9.6923011071 | +0.0762690113 | 0.17 | PASS |

### Phase 3 Final: Remaining EQ, Modulation, Resonators, Reverbs, Saturation, And Spatial

Five Band Dynamic EQ and Pitch Shifter used the default 10-second, 5-warmup,
20-repetition matrix:

`node tools/dsp-parity/bench.mjs --type <FiveBandDynamicEQ|PitchShifterPlugin> --modes js,wasm,simd`

The resonator and reverb measurements used fixed short conditions appropriate for their
JavaScript reference cost:

`node tools/dsp-parity/bench.mjs --type <HornResonatorPlugin|HornResonatorPlusPlugin> --modes js,wasm,simd --duration 0.05 --warmup 1 --repetitions 3`

`node tools/dsp-parity/bench.mjs --type <ModalResonatorPlugin|DattorroPlateReverbPlugin|FDNReverbPlugin|RSReverbPlugin> --modes js,wasm,simd --duration 0.25 --warmup 1 --repetitions 3`

Multiband Saturation and Multiband Balance used the one-second migration sweep:

`node tools/dsp-parity/bench.mjs --type <MultibandSaturationPlugin|MultibandBalancePlugin> --modes js,wasm,simd --duration 1 --warmup 2 --repetitions 5`

Every baseline WASM and SIMD point exceeded its corresponding JavaScript reference.
There were no slower WASM/SIMD points in these ten matrices.

#### FiveBandDynamicEQ

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 22.47x | 320.57x | 320.13x |
| 48000 | 8 | 8.12x | 199.06x | 198.50x |
| 96000 | 2 | 14.35x | 173.48x | 172.01x |
| 96000 | 8 | 10.23x | 136.07x | 136.56x |
| 192000 | 2 | 9.22x | 86.66x | 85.15x |
| 192000 | 8 | 5.19x | 83.76x | 82.33x |

#### PitchShifterPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 2511.05x | 4259.31x | 4604.26x |
| 48000 | 8 | 1129.48x | 1916.41x | 1895.64x |
| 96000 | 2 | 1360.94x | 2987.26x | 2914.94x |
| 96000 | 8 | 463.80x | 858.55x | 854.57x |
| 192000 | 2 | 557.55x | 1527.00x | 1350.24x |
| 192000 | 8 | 200.27x | 450.64x | 423.97x |

#### HornResonatorPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 9.34x | 29.73x | 30.18x |
| 48000 | 8 | 4.12x | 11.25x | 16.10x |
| 96000 | 2 | 4.79x | 12.95x | 16.84x |
| 96000 | 8 | 2.35x | 4.11x | 5.45x |
| 192000 | 2 | 2.03x | 4.13x | 5.58x |
| 192000 | 8 | 0.77x | 1.08x | 1.55x |

#### HornResonatorPlusPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 9.11x | 28.39x | 25.47x |
| 48000 | 8 | 4.24x | 12.57x | 15.40x |
| 96000 | 2 | 4.84x | 11.45x | 16.31x |
| 96000 | 8 | 2.12x | 4.04x | 5.44x |
| 192000 | 2 | 2.34x | 3.95x | 5.58x |
| 192000 | 8 | 0.82x | 1.06x | 1.47x |

#### ModalResonatorPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 24.98x | 171.47x | 178.51x |
| 48000 | 8 | 7.66x | 105.65x | 112.38x |
| 96000 | 2 | 13.46x | 138.18x | 130.86x |
| 96000 | 8 | 4.25x | 73.75x | 70.47x |
| 192000 | 2 | 7.74x | 108.10x | 108.67x |
| 192000 | 8 | 2.36x | 40.16x | 40.10x |

#### DattorroPlateReverbPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 17.76x | 121.95x | 127.74x |
| 48000 | 8 | 13.75x | 130.38x | 117.83x |
| 96000 | 2 | 10.77x | 92.98x | 115.97x |
| 96000 | 8 | 9.15x | 103.40x | 106.71x |
| 192000 | 2 | 5.65x | 78.07x | 76.50x |
| 192000 | 8 | 4.24x | 56.49x | 59.80x |

#### FDNReverbPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 5.30x | 62.08x | 62.80x |
| 48000 | 8 | 1.45x | 20.51x | 20.71x |
| 96000 | 2 | 2.86x | 36.53x | 35.24x |
| 96000 | 8 | 0.74x | 10.27x | 8.57x |
| 192000 | 2 | 0.95x | 17.65x | 14.78x |
| 192000 | 8 | 0.24x | 4.57x | 4.28x |

#### RSReverbPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 39.95x | 143.61x | 146.05x |
| 48000 | 8 | 16.51x | 70.10x | 72.71x |
| 96000 | 2 | 22.94x | 109.80x | 108.60x |
| 96000 | 8 | 9.60x | 40.48x | 39.33x |
| 192000 | 2 | 15.54x | 70.31x | 71.54x |
| 192000 | 8 | 5.29x | 21.07x | 21.50x |

#### MultibandSaturationPlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 17.07x | 182.48x | 185.17x |
| 48000 | 8 | 4.17x | 56.79x | 59.91x |
| 96000 | 2 | 7.34x | 94.44x | 86.59x |
| 96000 | 8 | 1.42x | 21.00x | 21.50x |
| 192000 | 2 | 2.79x | 46.89x | 56.83x |
| 192000 | 8 | 0.71x | 12.26x | 13.94x |

#### MultibandBalancePlugin

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 62.51x | 325.38x | 345.18x |
| 48000 | 8 | 19.97x | 112.66x | 114.64x |
| 96000 | 2 | 36.08x | 200.70x | 198.07x |
| 96000 | 8 | 10.72x | 60.16x | 61.61x |
| 192000 | 2 | 19.47x | 113.16x | 116.61x |
| 192000 | 8 | 3.57x | 27.58x | 29.02x |

### Phase 4: Analyzers

#### OscilloscopePlugin

Command: `node tools/dsp-parity/bench.mjs --type OscilloscopePlugin --modes js,wasm,simd`

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 257.45x | 4312.11x | 4893.09x |
| 48000 | 8 | 226.84x | 2147.65x | 2180.79x |
| 96000 | 2 | 108.84x | 1681.49x | 2414.88x |
| 96000 | 8 | 93.62x | 891.59x | 900.22x |
| 192000 | 2 | 54.68x | 1085.03x | 1204.74x |
| 192000 | 8 | 51.60x | 440.06x | 455.58x |

Telemetry sends raw snapshots up to 2,048 samples or a fixed 512-bucket M4 reduction.
Each M4 bucket retains its first, minimum, maximum, and last values plus the sample
positions of both extrema. At 30 Hz the M4 payload is 9,248 bytes per frame including
the transport header, or about 0.277 MB/s, within the 0.3 MB/s target.

#### SpectrumAnalyzerPlugin

Command: `node tools/dsp-parity/bench.mjs --type SpectrumAnalyzerPlugin --modes
js,wasm,simd --duration 1 --warmup 2 --repetitions 5`

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 227.87x | 423.55x | 532.71x |
| 48000 | 8 | 194.89x | 387.13x | 449.78x |
| 96000 | 2 | 121.03x | 293.01x | 379.19x |
| 96000 | 8 | 104.84x | 263.29x | 311.28x |
| 192000 | 2 | 64.37x | 194.84x | 248.89x |
| 192000 | 8 | 55.68x | 157.30x | 193.76x |

The largest schema-valid spectrum payload contains 8,190 bins and occupies 65,532
payload bytes. Both committed variants pass the artifact-level frame contract test.

#### SpectrogramPlugin

Command: `node tools/dsp-parity/bench.mjs --type SpectrogramPlugin --modes
js,wasm,simd --duration 1 --warmup 2 --repetitions 5`

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 55.73x | 452.35x | 525.85x |
| 48000 | 8 | 50.98x | 422.17x | 444.05x |
| 96000 | 2 | 27.99x | 340.63x | 368.62x |
| 96000 | 8 | 26.87x | 278.64x | 309.64x |
| 192000 | 2 | 14.27x | 209.76x | 249.59x |
| 192000 | 8 | 13.77x | 172.85x | 195.76x |

#### StereoMeterPlugin

Command: `node tools/dsp-parity/bench.mjs --type StereoMeterPlugin --modes
js,wasm,simd --duration 1 --warmup 2 --repetitions 5`

| Sample rate | Channels | JS | WASM | WASM SIMD |
| ---: | ---: | ---: | ---: | ---: |
| 48000 | 2 | 32.12x | 220.25x | 222.73x |
| 48000 | 8 | 31.27x | 208.09x | 196.24x |
| 96000 | 2 | 16.35x | 137.54x | 140.70x |
| 96000 | 8 | 16.06x | 127.67x | 126.34x |
| 192000 | 2 | 8.32x | 77.25x | 77.65x |
| 192000 | 8 | 5.02x | 56.88x | 66.78x |

### Room EQ Maximum-Asset Admission Gate

Measured on 2026-07-21 with Node v24.13.0 on a 13th Gen Intel Core i9-13900KF,
Windows NT 10.0.26200.0. Both committed cases use 96 kHz, eight channels, a
131,072-tap asymmetric independent-channel asset, and 128-frame processing blocks.
The elapsed time includes artifact startup, asset admission and preparation, and the
short parity render. Each golden case enforces a persistent 2,500 ms ceiling.

Command:

```text
node tools/dsp-parity/run.mjs --type RoomEqPlugin --native --wasm --simd
```

| Case | Native debug | WASM | WASM SIMD | Ceiling |
| --- | ---: | ---: | ---: | ---: |
| Latency 0, noise | 144.1 ms | 30.6 ms | 27.3 ms | 2,500 ms |
| Latency 128, impulse | 144.1 ms | 27.0 ms | 19.1 ms | 2,500 ms |

All six parity comparisons passed the direct-double reference with maximum absolute
error below `6e-8`. The two latency cases are part of the normal committed golden-set
discovery, so baseline WASM, SIMD WASM, and native CI runs keep both the maximum asset
admission and preparation-time ceiling persistent.
