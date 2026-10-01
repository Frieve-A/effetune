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
`RhythmAnalyzer`, `SpectrumAnalyzer`, `Spectrogram`, `StereoMeter`, and `TonalBalanceEQ` expose decoded semantic observations in Python, JavaScript offline and
streaming processing, and AudioWorklet. Telemetry is opt-in: the first callback or
subscriber enables it and the last unsubscribe disables it. Long renders drain after
every processing block. Public frames identify the semantic effect and contain owned
arrays; binary frame types, versions, tap IDs, payload bytes, and Worklet transport stay
private. Unknown or malformed frames are discarded.

Common metadata:

| JavaScript / Python | Meaning |
|---|---|
| `kind` / `kind` | `analogMeter`, `level`, `noteSpectrogram`, `oscilloscope`, `pitch`, `rhythmAnalyzer`, `spectrum`, `spectrumHq`, `spectrogram`, `spectrogramHq`, `stereo`, or `tonalBalance` |
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
| Rhythm Analyzer | `sampleRate` / `sample_rate` | Analysis rate in Hz: 48000 for 8, 11.025, 16, 22.05, 24, 32, 44.1, and 48 kHz input, 96000 for 88.2 and 96 kHz, and 192000 for 176.4, 192, 352.8, and 384 kHz; the input rate at any other rate |
| Rhythm Analyzer | `generation` / `generation` | Non-zero analysis generation; a change indicates that tracker state restarted |
| Rhythm Analyzer | `envelopeHopSamples`, `envelopeFrameCount` / `envelope_hop_samples`, `envelope_frame_count` | Onset-envelope step in samples at `sampleRate` (512 at 48000 Hz), and envelope frames analyzed since the generation started |
| Rhythm Analyzer | `timeSeconds`, `latencySeconds` / `time_seconds`, `latency_seconds` | Observation time and analysis latency in seconds on the processing timeline; the latency includes the resampler delay when the input rate differs from `sampleRate` |
| Rhythm Analyzer | `droppedEvents` / `dropped_events` | Onset events discarded before delivery |
| Rhythm Analyzer | `locked`, `lockEpoch` / `locked`, `lock_epoch` | True while the analyzer follows a beat grid (false while searching, including within about 0.5 s of silence at the full-analysis rates), and the epoch identifying that grid; the epoch changes whenever the grid is re-aligned or changes beat level |
| Rhythm Analyzer | `confidence` / `confidence` | Certainty of the shown beat in [0, 1]; at the full-analysis rates listed under `sampleRate`, the decoder's probability mass for the beat grid it follows (it commits to a grid at 0.95); at other rates, the fallback tracker's periodicity strength mapped from its hold threshold (0) to its lock threshold (1) |
| Rhythm Analyzer | `periodSeconds` / `period_seconds` | Adopted beat period in seconds; 0 while unlocked |
| Rhythm Analyzer | `nextBeatFrame`, `nextBeatFraction`, `nextBeatIndex` / `next_beat_frame`, `next_beat_fraction`, `next_beat_index` | Predicted next beat as an envelope frame, its fractional part in [0, 1), and its beat index |
| Rhythm Analyzer | `combBestBpm` / `comb_best_bpm` | Strongest tempo candidate in BPM, locked or searching |
| Rhythm Analyzer | `tempogram` / `tempogram` | JavaScript `Float32Array[192]` or Python `tuple[192]` normalized bins, 48 per octave from 30 to 480 BPM |
| Rhythm Analyzer | `events` / `events` | Onset events since the previous frame; each has `frame`, `fraction`, `lockEpoch` / `lock_epoch`, `beatIndex` / `beat_index`, `beatFraction` / `beat_fraction`, `periodSeconds` / `period_seconds`, `strength`, `band` (0 low, 1 mid, 2 high), and `unlocked`; `strength` is in (0, 1]: the band detector's hit probability (above that band's detection threshold) at the full-analysis rates, or the onset's spectral flux relative to the band's recent peak at other rates |
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
| Tonal Balance EQ | `sampleRate` / `sample_rate` | Hz |
| Tonal Balance EQ | `targetIndex` / `target_index` | Index of the active `target` choice |
| Tonal Balance EQ | `absoluteGate`, `relativeGate` / `absolute_gate`, `relative_gate` | True when the last 400 ms block reached -70 LKFS, and when it also passed the relative gate; only gated-in audio updates the statistics |
| Tonal Balance EQ | `loudnessValid`, `loudnessLkfs` / `loudness_valid`, `loudness_lkfs` | Integrated gated loudness since reset in LKFS; 0 until valid |
| Tonal Balance EQ | `targetValid` / `target_valid` | True when the active target has data for at least one band |
| Tonal Balance EQ | `makeupDb` / `makeup_db` | Applied make-up gain in dB |
| Tonal Balance EQ | `gatedHopCount` / `gated_hop_count` | Gated-in analysis steps integrated since reset |
| Tonal Balance EQ | `levelDb`, `persistence`, `presence` / `level_db`, `persistence`, `presence` | Per band: measured level in dB on the `averageSpl` scale; `persistence`, the share of analysis time the band was above the hearing threshold, in [0, 1]; and `presence`, `persistence` times the share judged to be music content rather than steady noise or noise floor, in [0, 1]; 41 ERB-rate bands at `(10 ** ((b + 1) / 21.4) - 1) * 1000 / 4.37` Hz, 26 Hz to 18.6 kHz, as JavaScript `Float32Array[41]` or Python `tuple[41]` |
| Tonal Balance EQ | `commandDb` / `command_db` | Per-band correction in dB before the cut-only shift |
| Tonal Balance EQ | `targetMuDb`, `targetSigmaDb` / `target_mu_db`, `target_sigma_db` | Active target relative level and its spread per band in dB; 0 where the target has no data |
| Tonal Balance EQ | `bandFlags` / `band_flags` | `uint8[41]`: bit 0 stationary, bit 1 noise floor, bit 2 has target, bit 3 has level, bit 4 inside `low`-`high` |
| Tonal Balance EQ | `responseDb` / `response_db` | Applied response including make-up gain in dB at 128 points `20 * 1000 ** (i / 127)` Hz |

`frame.dropped` reports loss since the previous decoded delivery. By contrast,
`dropped_telemetry_frames` on a Python stream and `droppedTelemetryFrames` on a
JavaScript stream or node are cumulative for that object's lifetime.

Telemetry stays local: the library only passes decoded frames to in-process Python
callbacks or callbacks in the browser page. It does not automatically collect, persist,
or send telemetry over the network, and it does not collect device or user identifiers.

Other catalog telemetry remains metadata-only. Dynamics gain-reduction observations
are not part of this API.
