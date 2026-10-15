---
layout: dsp
title: "Note Spectrogram — EffeTune DSP"
description: "Passes audio through while exposing pitch confidence and unrounded estimated cent offsets across the 88-key piano range."
lang: en
permalink: /dsp/effects/note-spectrogram/
---
# Note Spectrogram

Semantic type: `NoteSpectrogram` · Category: analyzer

Passes audio through while exposing pitch confidence and unrounded estimated cent offsets across the 88-key piano range.

Use the opt-in decoded telemetry callback or subscription API to observe this effect. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **decoded semantic observations are available**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `minimumMidi` | `minimum_midi` | integer / 1 | `28` | Not declared in catalog | 21 … 108 |
| `maximumMidi` | `maximum_midi` | integer / 1 | `91` | Not declared in catalog | 21 … 108 |
| `timbreEnabled` | `timbre_enabled` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Note Spectrogram

Shows estimated fundamental pitches (F0s) in a selectable range from A0 to C8 in a scrolling piano roll without changing the audio. Use it to follow chord tones, changing vocal and melodic lines, bass lines, and notes that overlap across octaves. Instrument colors and highlighting help you follow estimated voices and instrument groups within that display.

### Visualization Guide

- **Vertical** shows time from left to right, with the keyboard and current sound at the right edge. Higher notes appear toward the top.
- **Horizontal** places the keyboard at the bottom, with low notes on the left and high notes on the right. New sound appears just above the keyboard, and history scrolls upward.
- New sound is shown with an immediate pitch estimate. About 40, 80, and 160 ms later, that part of the history is updated using the sounds that follow, so recent marks just behind the newest sound may change. This adds no display delay and leaves **Sync Visuals to Audio** alignment unchanged.
- Lines at each C mark octave boundaries.
- Pitch rows corresponding to black piano keys use a nearly black gray background so they remain distinguishable when no note is detected.
- **Normal** uses the theme’s graph trace color; **Note Colors** uses a different color for each note, repeated across octaves. **Instrument (3)** and **Instrument (9)** mix group colors in proportion to their estimated probabilities; Instrument (3) first combines the probabilities into Vocal, Bass, and Other. The legend shows the selected groups and their colors. The guide lines between E and F remain visible in every mode.
- Instrument colors appear after the estimate is ready and update the corresponding history. In Instrument views, notes awaiting an estimate, or without one, appear in neutral gray. Changing between the 3-group and 9-group views uses the available estimates.
- Instrument estimation adds 20 ms before the result is shown; the pitch display continues to update immediately.
- Instrument estimation uses earlier notes in the music as clues, so estimates are less reliable just after it is enabled or playback is moved to another position. Once an instrument estimate is ready, it is not revised.
- Every completed instrument estimate supplies group probabilities, even when confidence is low. Weak pitch candidates and sounds already playing when instrument estimation is enabled may remain gray because they have no instrument estimate.
- **Highlight** makes the selected group easier to follow by shifting other notes toward neutral gray. A higher estimated probability of the selected group preserves more of the original color. Notes awaiting an estimate, or without one, also appear in neutral gray; they remain visible. The selected target is shown beside the legend and marked within it. Hover over a group in the legend to highlight it temporarily; moving away restores your Highlight selection.
- **1/12 Octave** shows one row per semitone. **High** places each pitch at its estimated cent value so that small pitch movements are easier to follow. Note Colors blends neighboring note colors according to pitch; instrument views use colors based on the instrument estimate.
- Color strength indicates confidence in each pitch estimate; candidates fade into the background as confidence approaches zero.
- With **Onsets** on, triangles in the selected **Color** mark estimated note starts: ▼ in Horizontal and ▶ in Vertical. The center of each triangle's base marks the start time and pitch. Separate marks help you see when the same pitch is played again, even when its sound continues between attacks.
- With **Volume** on, each detected pitch becomes a bar whose opaque core thickness shows its frequency-corrected relative volume, from 1/60 octave at the bottom of the scale to 1/12 octave at the top. A fade extends 1/120 octave beyond each side of that core, adding 1/60 octave to the total footprint. **Pitch Resolution** changes the bar’s center position, not its core thickness.
- At the keyboard edge, a soft-edged semicircle extends into the graph and shows the current volume. It responds immediately to increases and falls at 20 dB per second; there is no separate visible peak hold.
- The volume scale covers 24 dB. Its top follows the louder of a recent reference used to stabilize the history scale (over about one second) and -36 dB, so quieter material remains readable without making louder passages fill the display continuously. This reference is separate from the current-volume semicircle.
- Octave and E–F guide lines are drawn behind the volume bars so the pitch grid remains a visual reference.
- The keys blend from their normal color toward the display color as confidence in the latest frame increases, reaching that color at 1. With Normal or Note Colors, Highlight affects the graph but leaves the keyboard colors unchanged.
- Changing **Color** recolors the existing history.

### Listening Guide

- Chords appear as several bright rows at the same time
- Melodies and bass lines form paths that move between note rows
- To follow vocals or bass, start with **Instrument (3)**, or keep **Note Colors** and choose **Vocal** or **Bass** in **Highlight**. Use **Instrument (9)** for a more detailed grouping.
- Pitch and instrument estimates can be wrong, especially when sounds overlap. Instrument colors are a listening aid, not a reliable identification of every instrument. Drums are not classified. The display does not create MIDI or notation or fully separate simultaneous sounds; percussion, noise, and unclear repeating patterns can also produce incorrect pitches.

### Instrument Groups

**Instrument (3)** uses **Vocal**, **Bass**, and **Other**. Other combines all groups except Vocal and Bass; it is broader than Other in the 9-group view.

**Instrument (9)** uses the following groups:

- **Vocal**: recorded human singing, including solo voices and choirs.
- **Bass**: acoustic, electric, and synth bass.
- **Guitar**: acoustic, clean electric, and distorted guitars.
- **Piano**: acoustic and electric pianos, harpsichord, and clavinet.
- **Strings**: solo and ensemble strings, pizzicato, harp, and synth strings.
- **Wind**: brass and woodwinds, including saxophones and flutes.
- **Synth**: synth leads and pads.
- **Organ**: organs, accordion, and harmonica.
- **Other**: pitched percussion such as celesta and vibraphone, synthesized choir and voice patches, orchestral hits, synth effects, ethnic instruments, and sound effects.

### Parameters

- **Color** - Selects the display colors without changing the pitch estimates.
  - **Normal** (default): the theme’s graph trace color.
  - **Note Colors**: a separate color for each note, repeated across octaves.
  - **Instrument (3)**: colors for Vocal, Bass, and Other.
  - **Instrument (9)**: colors for the nine instrument groups listed above.
- **Highlight** - Emphasizes an estimated group with any Color setting while preserving volume thickness. **None** (default) leaves the display without highlighting. Choose **Vocal**, **Bass**, **Other (3)**, **Guitar**, **Piano**, **Strings**, **Wind**, **Synth**, **Organ**, or **Other (9)**. Other (3) covers everything except Vocal and Bass; Other (9) covers only the narrower Other group above. Highlighting changes the display, not the sound.
- Onset and instrument analysis increases CPU use. To avoid that extra processing, turn off **Onsets**, choose Normal or Note Colors, and set Highlight to None.
- **Pitch Resolution** - Selects the vertical pitch detail without clearing the existing history.
  - **1/12 Octave** (default): one row per semitone, using the strongest estimate within that note.
  - **High**: displays pitches at their estimated cent values, preserving fine pitch movement.
- **Layout** - Selects **Horizontal** (default) or **Vertical**. Switching layout preserves the existing history.
- **Volume** - Shows relative volume in bar thickness and semicircle meters. It is on by default; turning it off keeps the thickness fixed and shows pitch confidence through color strength.
- **Onsets** - Shows estimated note starts in either layout, with Volume on or off. It is off by default. Turning it off hides the marks; instrument analysis continues if an Instrument color mode or Highlight requires it.
- **Time Span** (1 to 10 s) - Sets how much time the piano roll shows
  - Shorter values make timing changes easier to see
  - Longer values show a longer musical passage at once
  - Default: 2 s
- **Lowest Note** - Sets the bottom of both the displayed and analyzed pitch range. Default: E1.
- **Highest Note** - Sets the top of both the displayed and analyzed pitch range. Default: G6.
- When input is too low for analysis, the piano roll remains dark rather than showing extremely small input as pitches. This suppression does not determine whether a sound would be audible or perceptually masked.

[Back to all effects](/dsp/effects/)
