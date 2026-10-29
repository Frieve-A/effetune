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
| `kind` / `kind` | `analogMeter`, `level`, `noteSpectrogram`, `noteTimbre`, `noteChordKey`, `oscilloscope`, `pitch`, `rhythmAnalyzer`, `spectrum`, `spectrumHq`, `spectrogram`, `spectrogramHq`, `stereo`, or `tonalBalance` |
| `effectType` / `effect_type` | Semantic effect type |
| `effectId` / `effect_id` | Declared effect ID, or null / `None` |
| `effectIndex` / `effect_index` | Zero-based position in the declared DSP chain |
| `sequence` / `sequence` | Per-tap telemetry sequence number |
| `dropped` / `dropped` | Frames lost since the previous decoded delivery |

Analyzer fields:

| Kind | JavaScript / Python | Unit and shape / order |
|---|---|---|
| Analog Meter | `mode` / `mode` | Mode index: 0 VU, 1 PPM, 2 RMS, 3 Sample Peak, 4 True Peak, 5 Loudness, 6 Custom |
| Analog Meter | `channelCount` / `channel_count` | Number of channel records, 1 to 16 |
| Analog Meter | `channels` / `channels` | Processing-channel order; each item has `needleDb` / `needle_db` and `maxDb` / `max_db`. Outside Loudness mode these are the ballistic needle reading in dB and the highest needle reading since the previous frame; VU, RMS, and every Custom detector are scaled so a sine wave reads its peak level. In Loudness mode they are that channel's momentary and short-term LUFS (unweighted, ungated reference values) |
| Analog Meter | `integratedValid`, `lraValid` / `integrated_valid`, `lra_valid` | True once integrated loudness or loudness range has enough gated data; always false outside Loudness mode |
| Analog Meter | `program` / `program` | Loudness mode only, otherwise null / `None`: `momentary`, `shortTerm` / `short_term`, and `integrated` in LUFS (BS.1770 / EBU R128), `lra` in LU (EBU Tech 3342), `maxTruePeak` / `max_true_peak` in dBTP, and `integratedSeconds` / `integrated_seconds`; `integrated` and `lra` are 0 until their valid flag is true |
| Analog Meter | All dB and LUFS values | Floored at -240; true peak above 0 dBTP is reported as measured |
| Level | `channels` / `channels` | Processing-channel order; each item has linear-amplitude `peak`, linear-amplitude `rms`, and boolean `clipped` (a sample exceeded full scale) |
| Oscilloscope | `sampleRate` / `sample_rate` | Hz |
| Oscilloscope | `captureSampleCount` / `capture_sample_count` | Samples in the full capture |
| Oscilloscope | `triggerOffset` / `trigger_offset` | Trigger position in samples from capture start |
| Oscilloscope | `triggered` / `triggered` | True for a real trigger; false for an automatic sweep |
| Oscilloscope | `encoding` / `encoding` | `samples` for raw points, `minMax` for ordered reduced points, or `envelope` for minimum/maximum bands |
| Oscilloscope | `sampleIndices` / `sample_indices` | `[point]` capture indices, paired with `values`; empty for `envelope` |
| Oscilloscope | `values` / `values` | `[point]` linear-amplitude values; empty for `envelope` |
| Oscilloscope | `extrema` / `extrema` | `envelope` only: interleaved minimum/maximum amplitude pairs, oldest first |
| Oscilloscope | `bucketCount` / `bucket_count` | Number of envelope intervals, including the overlap preceding a rolling window |
| Oscilloscope | `bucketSamples` / `bucket_samples` | Samples per rolling interval; zero for triggered captures, whose boundaries are floor(i × captureSampleCount / bucketCount) |
| Oscilloscope | `endSample` / `end_sample` | Exclusive sample counter at the right edge of a rolling snapshot; zero for triggered captures |
| Oscilloscope | `rolling` / `rolling` | True for Trigger Mode Off envelopes. The first interval starts at (floor((endSample − 1) / bucketSamples) − bucketCount + 1) × bucketSamples; clip to the displayed window |
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
| Note Spectrogram | `revisionAge` / `revision_age` | 0 when there is no final revision, or 8 when final revised confidences refer to the frame eight observations earlier in the same generation; subtract this age from `frameIndex` modulo 2^32 to identify that frame |
| Note Spectrogram | `levels` / `levels` | Pitch confidence in [0, 1] as JavaScript `Float32Array[440]` or Python `tuple[440]`; index `i` maps to MIDI `firstMidi + (i - 2) / divisionsPerSemitone` |
| Note Spectrogram | `revisedLevels` / `revised_levels` | Revised pitch confidence in [0, 1], with the same shape and pitch indexing as `levels`; null / `None` when `revisionAge` is 0 |
| Note Spectrogram | `revisions` / `revisions` | Available updates in order of age 2, 4, and 8 observations (40, 80, and 160 ms); each item has `age` and `levels` with the same pitch indexing as current levels. Subtract each age from `frameIndex` modulo 2^32 to identify its frame; the list is empty before the first update is available |
| Note Spectrogram | `volumeDb` / `volume_db` | Volume in dB as JavaScript `Float32Array[440]` or Python `tuple[440]`, with the same pitch indexing as `levels`; values include a 3 dB/octave correction above 100 Hz, and -240 dB means no level was measured |
| Note Spectrogram | `pitchCents` / `pitch_cents` | Current-frame estimated cent offsets as JavaScript `Float32Array[88]` or Python `tuple[88]`, without rounding to the confidence grid; index `n` maps to MIDI `firstMidi + n + pitchCents[n] / 100`. Confidence revisions do not change these offsets |
| Note Chord Key | `sampleRate`, `timeSeconds`, `hopSeconds` / `sample_rate`, `time_seconds`, `hop_seconds` | Hz, current observation time, and nominal analysis step in seconds; emitted when `chordKeyEnabled` is true |
| Note Chord Key | `generation`, `frameIndex` / `generation`, `frame_index` | Non-zero analysis generation and unsigned current observation counter |
| Note Chord Key | `immediateRoot`, `immediateQuality`, `immediateBass` / `immediate_root`, `immediate_quality`, `immediate_bass` | Chord for the observation two steps earlier: root and bass pitch classes C..B (0..11); quality 0..10 in major, minor, diminished, augmented, major seventh, minor seventh, dominant seventh, diminished seventh, half-diminished seventh, sus2, sus4 order. All three are null / `None` for no chord |
| Note Chord Key | `confirmedRoot`, `confirmedQuality`, `confirmedBass` / `confirmed_root`, `confirmed_quality`, `confirmed_bass` | Confirmed chord for the observation eleven steps earlier, with the same encoding as the immediate chord |
| Note Chord Key | `confirmedProbability` / `confirmed_probability` | Model probability in [0, 1] assigned to the delayed selected chord/bass pair, including no chord; zero before a result is available. This is not a calibrated probability of real-world correctness |
| Note Chord Key | `localKey`, `overallKey` / `local_key`, `overall_key` | Keys: C..B major (0..11), C..B minor (12..23). Local key describes the observation fifteen steps earlier; 24 means no key, and null / `None` means it is not yet available. Overall key counts tonal observations since analysis began or the latest stream boundary; null / `None` until enough observations are available, then retained through observations with no key |
| Note Timbre | `sampleRate` / `sample_rate` | Hz; emitted by Note Spectrogram when `timbreEnabled` is true (default false) |
| Note Timbre | `timeSeconds`, `hopSeconds` / `time_seconds`, `hop_seconds` | Current analysis observation time and nominal analysis step, in seconds on the processing timeline |
| Note Timbre | `generation`, `frameIndex` / `generation`, `frame_index` | Non-zero analysis generation and unsigned current observation counter; a generation change starts a new analysis history |
| Note Timbre | `noteId` / `note_id` | Non-zero note identity within the generation; distinguishes repeated starts at the same pitch |
| Note Timbre | `midi` / `midi` | Integer piano-key MIDI note, 21 to 108 |
| Note Timbre | `event` / `event` | `start`, `result`, or `end`; a result updates the identified note after its observations are available |
| Note Timbre | `startFrameIndex` / `start_frame_index` | Analysis observation counter at the note's detected start |
| Note Timbre | `endFrameIndex` / `end_frame_index` | Analysis observation counter at the detected end, or null / `None` while the end is not known |
| Note Timbre | `probabilities` / `probabilities` | `result` only: probabilities in [0, 1] as JavaScript `Float32Array[9]` or Python `tuple[9]`, ordered Bass, Guitar, Piano, Strings, Wind, Synth, Organ, Other, Vocal; null / `None` for start and end |
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
| Rhythm Analyzer | `sampleRate` / `sample_rate` | Analysis rate in Hz: 48000 for 8, 11.025, 16, 22.05, 24, 32, 44.1, and 48 kHz input, 96000 for 88.2 and 96 kHz, and 192000 for 176.4, 192, 352.8, and 384 kHz; at any other input rate, reports the input rate with no onset or beat analysis |
| Rhythm Analyzer | `generation` / `generation` | Non-zero analysis generation; a change indicates that tracker state restarted |
| Rhythm Analyzer | `envelopeHopSamples`, `envelopeFrameCount` / `envelope_hop_samples`, `envelope_frame_count` | Onset-envelope step in samples at `sampleRate` (512 at 48000 Hz), and envelope frames analyzed since the generation started |
| Rhythm Analyzer | `timeSeconds`, `latencySeconds` / `time_seconds`, `latency_seconds` | Observation time and analysis latency in seconds on the processing timeline; the latency includes the resampler delay when the input rate differs from `sampleRate` |
| Rhythm Analyzer | `droppedEvents` / `dropped_events` | Onset or beat events discarded before delivery |
| Rhythm Analyzer | `locked`, `lockEpoch` / `locked`, `lock_epoch` | `locked` is the shown-beat gate: true when short-term evidence is positive, retained while long-term evidence exceeds 0.02, and false on digital silence. It is independent of the stored grid and preview. `lockEpoch` identifies the stored analysis grid |
| Rhythm Analyzer | `confidence` / `confidence` | Evidence-derived confidence in [0, 1], independent of whether the shown-beat gate is open; 0 on digital silence |
| Rhythm Analyzer | `periodSeconds` / `period_seconds` | Beat period of the stored committed grid; may remain positive while `locked` is false. 0 when no committed grid is available or on digital silence |
| Rhythm Analyzer | `nextBeatFrame`, `nextBeatFraction`, `nextBeatIndex` / `next_beat_frame`, `next_beat_fraction`, `next_beat_index` | Stored committed-grid anchor as an envelope frame, its fractional part in [0, 1), and its beat index; these fields do not predict the next shown beat |
| Rhythm Analyzer | `combBestBpm` / `comb_best_bpm` | Strongest tempo candidate in BPM, locked or searching |
| Rhythm Analyzer | `tempogram` / `tempogram` | JavaScript `Float32Array[192]` or Python `tuple[192]` normalized bins, 48 per octave from 30 to 480 BPM |
| Rhythm Analyzer | `events` / `events` | Delivered onset and beat events; each has `frame`, `fraction`, `lockEpoch` / `lock_epoch`, `beatIndex` / `beat_index`, `beatFraction` / `beat_fraction`, `periodSeconds` / `period_seconds`, `strength`, `band`, `flags`, and `unlocked`. Flags: 0 committed onset, 1 unlocated onset, 2 shown forward beat, 3 provisional onset, 4 hidden forward beat, 5 committed beat. `unlocked` is true only for flag 1; provisional onsets may arrive again with committed coordinates at the same timestamp. For onsets, `band` is 0 low, 1 mid, or 2 high and `strength` is the hit probability in (0, 1]; beat events use band 0, beat fraction 0, and confidence in [0, 1]. Flag 5 uses a signed frame; other event frames are unsigned |
| Rhythm Analyzer | `previewPeriodSeconds`, `previewBeats` / `preview_period_seconds`, `preview_beats` | Replaceable current best path, independent of the shown-beat gate and available before a committed grid. The period is in seconds (0 when unavailable); up to 12 beats each contain signed `frame`, `fraction` in [0, 1), and signed `beatIndex` / `beat_index`. Replace the previous preview on every frame; its beat coordinates remain revisable |
| Rhythm Analyzer | `displayMode`, `drumLatencySeconds` / `display_mode`, `drum_latency_seconds` | Display selection (`band` or `drums`) and actual drum analysis latency in seconds, including model/peak lookahead, resampling and per-instance scheduling; transport and drawing time are separate |
| Rhythm Analyzer | `drumEvents` / `drum_events` | Accepted drum hits with `frame`, `fraction`, `audioTimeSeconds` / `audio_time_seconds`, `lockEpoch` / `lock_epoch`, `beatIndex` / `beat_index`, `beatFraction` / `beat_fraction`, `periodSeconds` / `period_seconds`, raw `logit`, `lane`, `flags` and `unlocked`. Lanes 0–4 are Kick, Snare, Hi-hat, Cymbals and Tom. The Rhythm Analyzer display uses lanes 0–3; Visualizer Drums uses all five lanes. Audio time is (frame + fraction) × 256 / 24000 seconds and remains fixed when beat annotations change. Annotation flags are 0 committed, 1 unavailable, 3 provisional. A hit remains valid without a beat estimate; display strength is sigmoid(logit), independently of beat confidence |
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

Note Timbre is separate from the pitch-confidence frames and does not delay them or
change the pass-through audio latency of 0 samples. To place a note's start on the
processing timeline, subtract `((frameIndex - startFrameIndex) >>> 0) * hopSeconds`
from `timeSeconds` in JavaScript; use the difference modulo 2^32 in Python.
A result's `timeSeconds` identifies the analysis observation when its estimate
became available, rather than its note's start. The three-group probabilities are
Vocal = probabilities[8], Bass = probabilities[0], and Other = sum(probabilities[1:8]);
the three-group and nine-group color views mix their group RGB colors in proportion
to the respective probabilities. These are estimates,
not guaranteed instrument identities; drums are outside the classification groups.
Instrument estimation uses earlier notes in the music as clues, so estimates are
less reliable immediately after enabling it or seeking. Completed instrument
estimates are not revised.

`frame.dropped` reports loss since the previous decoded delivery. By contrast,
`dropped_telemetry_frames` on a Python stream and `droppedTelemetryFrames` on a
JavaScript stream or node are cumulative for that object's lifetime.

Telemetry stays local: the library only passes decoded frames to in-process Python
callbacks or callbacks in the browser page. It does not automatically collect, persist,
or send telemetry over the network, and it does not collect device or user identifiers.

Other catalog telemetry remains metadata-only. Dynamics gain-reduction observations
are not part of this API.
