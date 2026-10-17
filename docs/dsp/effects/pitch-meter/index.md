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

### Listening Guide

- Play or sing a single sustained note and watch whether the trace stays centered on the note row or drifts sharp or flat.
- Vibrato, slides, and pitch bends appear as smooth curves across the note rows.
- Because Pitch Meter tracks a single dominant pitch, chords, dense mixes, or percussion can interrupt the trace or jump octaves; use [Note Spectrogram](/dsp/effects/note-spectrogram/) for polyphonic material.
- Stereo input is analyzed by averaging the first two channels (mono input is used directly), so a sound with opposite polarity in the two channels can cancel out and leave no trace.

### Parameters

- **Color** - Changes trace color without affecting detection: **Normal** (default theme trace color), **Heatmap** (relative volume over a 24 dB range), or **Note Colors** (pitch class colors).
- **Layout** - **Horizontal** (default, keyboard at bottom, history scrolls up) or **Vertical** (keyboard at right, history scrolls left).
- **Reference A4** (400 to 480 Hz; default 440 Hz) - Tuning reference used for note names and cent offsets.
- **Lowest Note** / **Highest Note** - Sets the analyzed and displayed pitch range (defaults: C2 to C7; full range: A0 to C8).

### Visualization Guide

- The trace position shows continuous pitch between semitones; higher confidence draws a brighter line, and silence or unpitched sound breaks the line.
- The readout displays the nearest note name (colored by pitch class) and the tuning offset in cents (`+` sharp, `-` flat; for example, `+3.5 cent`).

[Back to all effects](/dsp/effects/)
