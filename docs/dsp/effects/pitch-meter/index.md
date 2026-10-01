---
layout: dsp
title: "Pitch Meter — EffeTune DSP"
description: "Passes audio through while exposing one detected fundamental pitch, cents offset, confidence, and level."
lang: en
permalink: /dsp/effects/pitch-meter/
---
# Pitch Meter

Semantic type: `PitchMeter` · Category: analyzer

Passes audio through while exposing one detected fundamental pitch, cents offset, confidence, and level.

Use the opt-in decoded telemetry callback or subscription API to observe this effect. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **decoded semantic observations are available**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `referenceA4` | `reference_a4` | number / 1 | `440` | Not declared in catalog | 400 … 480 |
| `minimumMidi` | `minimum_midi` | integer / 1 | `36` | Not declared in catalog | 21 … 108 |
| `maximumMidi` | `maximum_midi` | integer / 1 | `96` | Not declared in catalog | 21 … 108 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Pitch Meter

Tracks one fundamental pitch (F0) at a time in a two-second scrolling piano roll without changing the audio. Use it to check the tuning and pitch movement of a solo voice or instrument.

### Visualization Guide

- **Horizontal** (default) places low notes on the left and high notes on the right. The newest estimate appears above the keyboard and history scrolls upward.
- **Vertical** places low notes at the bottom and high notes at the top. The newest estimate appears beside the keyboard at the right and history moves left.
- The line position shows pitch between semitones. A more confident estimate appears more strongly; the line breaks when the input is too quiet or no stable single pitch is found. **Heatmap** uses line color to show relative volume, while **Note Colors** follows pitch.
- The current label shows the nearest note and the difference in cents. A positive value is above the note and a negative value is below it. The label disappears when there is no reliable estimate.
- The note name uses the same note colors as Note Spectrogram. The large readout fits the available width and keeps the cents decimal point in a fixed position.

### Listening Guide

- Start with a single sustained note, then watch whether the line stays centered on a note or moves sharp or flat.
- Vibrato and pitch bends appear as smooth movement across the note rows.
- This analyzer follows one dominant pitch. Chords, dense mixes, percussion, noise, or unclear repeating sounds can interrupt the line or produce an incorrect octave.

### Parameters

- **Color** - Changes the line color without changing pitch detection. **Normal** (default) uses the theme’s graph trace color; **Heatmap** follows relative volume on the same 24 dB scale as Note Spectrogram; **Note Colors** follows pitch between the note colors.
- **Layout** - Selects **Horizontal** (default) or **Vertical**.
- **Reference A4** (400 to 480 Hz) - Sets the tuning reference used for note names and cents. Default: 440 Hz.
- **Lowest Note** - Sets the bottom of the displayed and analyzed range. Default: C2. The lowest available setting is A0.
- **Highest Note** - Sets the top of the displayed and analyzed range. Default: C7. The highest available setting is C8.
- Stereo input is analyzed by averaging the first two channels; mono input is used directly. Strong opposite-polarity content can cancel in the average and leave no pitch trace.

[Back to all effects](/dsp/effects/)
