---
layout: dsp
title: "Compatibility"
description: "Compatibility"
lang: en
permalink: /dsp/reference/compatibility/
---
# Compatibility

Python wheels cover CPython 3.10+ on manylinux x86-64, Windows AMD64, macOS Intel, and
macOS Apple Silicon; musllinux is not provided. Node.js `>=18` is required. Chromium
is acceptance-tested. Other evergreen browsers are designed for but unverified.
AudioWorklet support requires HTTPS or localhost; direct `file:` loading is unsupported.
The npm package is ESM-only; use `.mjs` or a consumer package with
`"type": "module"`. CommonJS `require()` is unsupported.

The core does not decode, encode, resample, call ffmpeg, host VST/AU, or expose public
integrated-LUFS/true-peak measurement.

## Analyzers and telemetry

`LevelMeter`, `Oscilloscope`, `SpectrumAnalyzer`, `Spectrogram`, and
`StereoMeter` expose decoded semantic observations in Python, JavaScript offline and
streaming processing, and AudioWorklet. Telemetry is opt-in: the first callback or
subscriber enables it and the last unsubscribe disables it. Long renders drain after
every processing block. Public frames identify the semantic effect and contain owned
arrays; binary frame types, versions, tap IDs, payload bytes, and Worklet transport stay
private. Unknown or malformed frames are discarded.

Common metadata:

| JavaScript / Python | Meaning |
|---|---|
| `kind` / `kind` | `level`, `oscilloscope`, `spectrum`, `spectrogram`, or `stereo` |
| `effectType` / `effect_type` | Semantic effect type |
| `effectId` / `effect_id` | Declared effect ID, or null / `None` |
| `effectIndex` / `effect_index` | Zero-based position in the declared DSP chain |
| `sequence` / `sequence` | Per-tap telemetry sequence number |
| `dropped` / `dropped` | Frames lost since the previous decoded delivery |

Analyzer fields:

| Kind | JavaScript / Python | Unit and shape / order |
|---|---|---|
| Level | `channels` / `channels` | Processing-channel order; each item has linear-amplitude `peak`, linear-amplitude `rms`, and boolean `clipped` (a sample exceeded full scale) |
| Oscilloscope | `sampleRate` / `sample_rate` | Hz |
| Oscilloscope | `captureSampleCount` / `capture_sample_count` | Samples in the full capture |
| Oscilloscope | `triggerOffset` / `trigger_offset` | Trigger position in samples from capture start |
| Oscilloscope | `triggered` / `triggered` | True for a real trigger; false for an automatic sweep |
| Oscilloscope | `encoding` / `encoding` | `samples` for raw points or `minMax` for ordered envelope points |
| Oscilloscope | `sampleIndices` / `sample_indices` | `[point]` capture indices, paired by position with `values` |
| Oscilloscope | `values` / `values` | `[point]` linear-amplitude values |
| Spectrum | `sampleRate` / `sample_rate` | Hz |
| Spectrum | `points` / `points` | FFT size exponent; FFT size is `2 ** points` |
| Spectrum | `binsTruncated` / `bins_truncated` | True when the highest bins were omitted to fit transport capacity |
| Spectrum | `currentDb` / `current_db` | dBFS `[bin]`, ascending frequency from DC |
| Spectrum | `peakDb` / `peak_db` | Peak-held dBFS `[bin]`, same order and length as current |
| Spectrogram | `sampleRate` / `sample_rate` | Hz |
| Spectrogram | `timeSeconds` / `time_seconds` | Observation time in seconds on the processing timeline |
| Spectrogram | `points` / `points` | FFT size exponent; FFT size is `2 ** points` |
| Spectrogram | `intensities` / `intensities` | `uint8[256]` display intensity, high-to-low log-frequency cells from index 0 through 255 |
| Stereo | `sampleRate` / `sample_rate` | Hz |
| Stereo | `discontinuity` / `discontinuity` | True when the sample delta is incomplete after truncation or a window change |
| Stereo | `samples` / `samples` | JavaScript `Float32Array[side0, mid0, ...]`; Python `tuple[(side, mid), ...]`; linear amplitude where side is R-L and mid is L+R |
| Stereo | `envelope` / `envelope` | Linear-amplitude `[360]` polar-angle bins in index order |
| Stereo | `correlation` / `correlation` | Unitless stereo correlation in [-1, 1] |
| Stereo | `balance` / `balance` | Right-versus-left energy balance in dB |
| Stereo | `peakLeft` / `peak_left` | Left linear-amplitude peak |
| Stereo | `peakRight` / `peak_right` | Right linear-amplitude peak |

`frame.dropped` reports loss since the previous decoded delivery. By contrast,
`dropped_telemetry_frames` on a Python stream and `droppedTelemetryFrames` on a
JavaScript stream or node are cumulative for that object's lifetime.

Telemetry stays local: the library only passes decoded frames to in-process Python
callbacks or callbacks in the browser page. It does not automatically collect, persist,
or send telemetry over the network, and it does not collect device or user identifiers.

Other catalog telemetry remains metadata-only in v0.1. Integrated LUFS, BS.1770/EBU
R128, true peak, and dynamics gain-reduction observations are not part of this API.
