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

Graph v1 is supported on the JavaScript and Python bindings only; see
[Graph v1 supported surfaces](/dsp/reference/graph-v1/#supported-surfaces).

The core does not decode, encode, resample, call ffmpeg, or host VST/AU. Loudness and
true-peak readings are available through `AnalogMeter` telemetry.

## Analyzers and telemetry

`AnalogMeter`, `ChromaSpiral`, `LevelMeter`, `NoteSpectrogram`, `Oscilloscope`, `PitchMeter`,
`SpectrumAnalyzer`, `Spectrogram`, and `StereoMeter` expose decoded semantic observations in Python, JavaScript offline and
streaming processing, and AudioWorklet. Telemetry is opt-in: the first callback or
subscriber enables it and the last unsubscribe disables it. Long renders drain after
every processing block. Public frames identify the semantic effect and contain owned
arrays; binary frame types, versions, tap IDs, payload bytes, and Worklet transport stay
private. Unknown or malformed frames are discarded.

Common metadata:

| JavaScript / Python | Meaning |
|---|---|
| `kind` / `kind` | `analogMeter`, `level`, `noteSpectrogram`, `oscilloscope`, `pitch`, `spectrum`, `spectrumHq`, `spectrogram`, `spectrogramHq`, or `stereo` |
| `effectType` / `effect_type` | Semantic effect type |
| `effectId` / `effect_id` | Declared effect ID, or null / `None` |
| `effectIndex` / `effect_index` | Zero-based position in the declared DSP chain |
| `sequence` / `sequence` | Per-tap telemetry sequence number |
| `dropped` / `dropped` | Frames lost since the previous decoded delivery |

Analyzer fields:

| Kind | JavaScript / Python | Unit and shape / order |
|---|---|---|
| Analog Meter | `mode` / `mode` | Mode index: 0 VU, 1 PPM, 2 RMS, 3 Sample Peak, 4 True Peak, 5 Loudness |
| Analog Meter | `channelCount` / `channel_count` | Number of channel records, 1 to 16 |
| Analog Meter | `channels` / `channels` | Processing-channel order; each item has `needleDb` / `needle_db` and `maxDb` / `max_db`. Outside Loudness mode these are the ballistic needle reading in dB and the highest detector reading since the previous frame; VU and RMS readings are scaled so a sine wave reads its peak level. In Loudness mode they are that channel's momentary and short-term LUFS (unweighted, ungated reference values) |
| Analog Meter | `integratedValid`, `lraValid` / `integrated_valid`, `lra_valid` | True once integrated loudness or loudness range has enough gated data; always false outside Loudness mode |
| Analog Meter | `program` / `program` | Loudness mode only, otherwise null / `None`: `momentary`, `shortTerm` / `short_term`, and `integrated` in LUFS (BS.1770 / EBU R128), `lra` in LU (EBU Tech 3342), `maxTruePeak` / `max_true_peak` in dBTP, and `integratedSeconds` / `integrated_seconds`; `integrated` and `lra` are 0 until their valid flag is true |
| Analog Meter | All dB and LUFS values | Floored at -240; true peak above 0 dBTP is reported as measured |
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
| Spectrum HQ / Spectrogram HQ | `sampleRate` / `sample_rate` | Hz |
| Spectrum HQ / Spectrogram HQ | `points` / `points` | FFT size exponent; the short FFT size is `2 ** points` |
| Spectrum HQ / Spectrogram HQ | `hop` / `hop` | Nominal analysis step in input samples |
| Spectrum HQ / Spectrogram HQ | `generation`, `frameIndex` / `generation`, `frame_index` | Non-zero analysis generation and unsigned observation counter within it |
| Spectrum HQ / Spectrogram HQ | `captureEnd` / `capture_end` | End sample index of the aligned analysis capture; JavaScript uses `bigint` |
| Spectrum HQ / Spectrogram HQ | `cellCount`, `minFrequency`, `maxFrequency` / `cell_count`, `min_frequency`, `max_frequency` | Log-frequency grid count and bounds in Hz |
| Spectrum HQ / Spectrogram HQ | `firstValidIndex`, `validCellCount` / `first_valid_index`, `valid_cell_count` | Contiguous valid part of the grid; cells outside it have no input-band data |
| Spectrum HQ | `currentDb` / `current_db` | dBFS `[cell]`, in ascending log-frequency grid order |
| Spectrum HQ | `peakDb` / `peak_db` | Peak-held dBFS `[cell]`, same order and length as current |
| Note Spectrogram | `sampleRate` / `sample_rate` | Hz |
| Note Spectrogram | `timeSeconds` / `time_seconds` | Observation time in seconds on the processing timeline |
| Note Spectrogram | `firstMidi` / `first_midi` | `21`, the first piano-key MIDI note before fine-pitch offsets are applied |
| Note Spectrogram | `hopSeconds` / `hop_seconds` | Nominal time step between analysis observations, in seconds |
| Note Spectrogram | `frameIndex` / `frame_index` | Unsigned observation counter within the current analysis generation |
| Note Spectrogram | `divisionsPerSemitone` / `divisions_per_semitone` | `5`; each semitone has bins at -40, -20, 0, +20, and +40 cents around its center |
| Note Spectrogram | `generation` / `generation` | Non-zero analysis generation; a change indicates that analyzer state restarted |
| Note Spectrogram | `levels` / `levels` | Pitch confidence in [0, 1] as JavaScript `Float32Array[440]` or Python `tuple[440]`; index `i` maps to MIDI `firstMidi + (i - 2) / divisionsPerSemitone` |
| Note Spectrogram | `volumeDb` / `volume_db` | Volume in dB as JavaScript `Float32Array[440]` or Python `tuple[440]`, with the same pitch indexing as `levels`; values include a 3 dB/octave correction above 100 Hz, and -240 dB means no level was measured |
| Pitch | `sampleRate` / `sample_rate` | Hz |
| Pitch | `timeSeconds` / `time_seconds` | Observation time in seconds on the processing timeline |
| Pitch | `hopSeconds` / `hop_seconds` | Nominal time step between analysis observations, in seconds |
| Pitch | `frameIndex` / `frame_index` | Unsigned observation counter within the current analysis generation |
| Pitch | `generation` / `generation` | Non-zero analysis generation; a change indicates that analyzer state restarted |
| Pitch | `f0Hz` / `f0_hz` | Detected fundamental frequency in Hz; 0 when unvoiced |
| Pitch | `midi` / `midi` | Fractional MIDI note relative to the configured A4 reference; 0 when unvoiced |
| Pitch | `cents` / `cents` | Difference from the nearest semitone in cents, from -50 to +50; 0 when unvoiced |
| Pitch | `confidence` / `confidence` | Detection confidence in [0, 1]; 0 when unvoiced |
| Pitch | `levelDb` / `level_db` | Analyzed input level in dB |
| Pitch | `voiced` / `voiced` | True when the pitch fields contain a detected fundamental pitch |
| Spectrogram | `sampleRate` / `sample_rate` | Hz |
| Spectrogram | `timeSeconds` / `time_seconds` | Observation time in seconds on the processing timeline |
| Spectrogram | `points` / `points` | FFT size exponent; FFT size is `2 ** points` |
| Spectrogram | `intensities` / `intensities` | `uint8[256]` display intensity, high-to-low log-frequency cells from index 0 through 255 |
| Spectrogram HQ | `intensities` / `intensities` | `uint8[256]` display intensity, high-to-low log-frequency grid cells from index 0 through 255 |
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

Other catalog telemetry remains metadata-only. Dynamics gain-reduction observations
are not part of this API.
