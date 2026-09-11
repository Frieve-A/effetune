---
layout: dsp
title: "Note Spectrogram — EffeTune DSP"
description: "Passes audio through while exposing detected pitch confidence across the 88-key piano range at five positions per semitone."
lang: en
permalink: /dsp/effects/note-spectrogram/
---
# Note Spectrogram

Semantic type: `NoteSpectrogram` · Category: analyzer

Passes audio through while exposing detected pitch confidence across the 88-key piano range at five positions per semitone.

Use the opt-in decoded telemetry callback or subscription API to observe this analyzer. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Analyzer telemetry: **decoded semantic observations are available in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `minimumMidi` | `minimum_midi` | integer / 1 | `28` | Not declared in catalog | 21 … 108 |
| `maximumMidi` | `maximum_midi` | integer / 1 | `91` | Not declared in catalog | 21 … 108 |
| `regularCandidates` | `regular_candidates` | integer / 1 | `8` | Not declared in catalog | 1 … 16 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Note Spectrogram

Shows estimated fundamental pitches (F0s) in a selectable range from A0 to C8 in a scrolling piano roll without changing the audio. Use it to follow chord tones, changing vocal and melodic lines, bass lines, and notes that overlap across octaves.

### Visualization Guide

- **Vertical** shows time from left to right, with the keyboard and current sound at the right edge. Higher notes appear toward the top.
- **Horizontal** places the keyboard at the bottom, with low notes on the left and high notes on the right. New sound appears just above the keyboard, and history scrolls upward.
- Lines at each C mark octave boundaries.
- Pitch rows corresponding to black piano keys use a nearly black gray background so they remain distinguishable when no note is detected.
- **Normal** uses the theme’s graph trace color; **Note Colors** uses a different color for each note, repeated across octaves. Both show darker guide lines between E and F.
- **1/12 Octave** shows one row per semitone. **High (1/60 Octave)** divides each semitone into five rows so that small pitch movement is easier to follow; colors are blended between neighboring notes.
- Color follows the model’s confidence from 0 (background color) to 1 (full color), including weak candidates without a display threshold. This score indicates how strongly the model supports a pitch; it is not a calibrated probability.
- With **Volume** on, each detected pitch becomes a bar whose opaque core thickness shows its frequency-corrected relative volume, from 1/60 octave at the bottom of the scale to 1/12 octave at the top. A fade extends 1/120 octave beyond each side of that core, adding 1/60 octave to the total footprint. **Pitch Resolution** changes the bar’s center position, not its core thickness.
- At the keyboard edge, a soft-edged semicircle extends into the graph and shows the current volume. It responds immediately to increases and falls at 20 dB per second; there is no separate visible peak hold.
- The volume scale covers 24 dB. Its top follows the louder of a recent reference used to stabilize the history scale (over about one second) and -36 dB, so quieter material remains readable without making louder passages fill the display continuously. This reference is separate from the current-volume semicircle.
- Octave and E–F guide lines are drawn behind the volume bars so the pitch grid remains a visual reference.
- The keys blend from their normal color toward the display color as confidence in the latest frame increases, reaching that color at 1.
- Changing **Color** recolors the existing history.

### Listening Guide

- Chords appear as several bright rows at the same time
- Melodies and bass lines form paths that move between note rows
- The display estimates pitch; it does not create MIDI or notation, identify instruments, or separate every simultaneous sound completely. Complex overlaps can leave parts of a melody or harmony blank, while percussion, noise, and unclear repeating patterns can produce an occasional incorrect pitch.

### Parameters

- **Color** - Selects the display colors without changing the pitch estimates.
  - **Normal** (default): the theme’s graph trace color.
  - **Note Colors**: a separate color for each note, repeated across octaves.
- **Pitch Resolution** - Selects the vertical pitch detail without clearing the existing history.
  - **1/12 Octave** (default): one row per semitone, using the strongest estimate within that note.
  - **High (1/60 Octave)**: five rows per semitone for finer pitch movement.
- **Layout** - Selects **Horizontal** (default) or **Vertical**. Switching layout preserves the existing history.
- **Volume** - Shows relative volume in bar thickness and semicircle meters. It is on by default; turning it off keeps the original confidence-only rows.
- **Time Span** (1 to 10 s) - Sets how much time the piano roll shows
  - Shorter values make timing changes easier to see
  - Longer values show a longer musical passage at once
  - Default: 2 s
- **Regular Note Limit** (1 to 16 notes) - Sets how many simultaneous notes outside the dedicated low-note range can reach the final detection stage. The default is 8. Increase it for unusually dense chords; lower values reduce analysis work and competition between candidates.
- **Lowest Note** - Sets the bottom of both the displayed and analyzed pitch range. Default: E1.
- **Highest Note** - Sets the top of both the displayed and analyzed pitch range. Default: G6.
- When input is too low for analysis, the piano roll remains dark rather than showing extremely small input as pitches. This suppression does not determine whether a sound would be audible or perceptually masked.

[Back to all effects](/dsp/effects/)
