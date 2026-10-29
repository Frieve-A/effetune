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
| `chordKeyEnabled` | `chord_key_enabled` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Note Spectrogram

Shows estimated fundamental pitches (F0s) from A0 to C8 in a scrolling piano roll without changing the audio. Use it to follow chord tones, vocal and melodic lines, bass lines, and overlapping notes across octaves, with optional instrument color-coding and highlighting. It also estimates chord names and keys to help you follow harmonic changes.

### Listening Guide

- **Chords & Melodies**: Chords appear as simultaneous bright rows; melodies and bass lines trace paths across note rows.
- **Follow Vocals or Bass**: Choose **Instrument (3)**, or keep **Note Colors** and select **Vocal** or **Bass** in **Highlight**. Use **Instrument (9)** for finer instrument grouping.
- **Estimate Accuracy**: Pitch and instrument estimates are a visual listening aid rather than exact transcription. Overlapping sounds, percussion, or noise can produce ambiguous estimates, and drums are not classified. Instrument estimates use earlier notes as clues, so they are less reliable just after enabling them or moving the playback position; once ready, an estimate is not revised.

### Instrument Groups

**Instrument (3)** groups pitches into **Vocal**, **Bass**, and **Other** (all groups below except Vocal and Bass).

**Instrument (9)** separates pitches into nine groups:
- **Vocal**: Recorded human singing, including solo voices and choirs.
- **Bass**: Acoustic, electric, and synth bass.
- **Guitar**: Acoustic, clean electric, and distorted guitars.
- **Piano**: Acoustic and electric pianos, harpsichord, and clavinet.
- **Strings**: Solo and ensemble strings, pizzicato, harp, and synth strings.
- **Wind**: Brass and woodwinds, including saxophones and flutes.
- **Synth**: Synth leads and pads.
- **Organ**: Organs, accordion, and harmonica.
- **Other**: Pitched percussion (celesta, vibraphone), synthesized choir/voice patches, synth effects, orchestral hits, ethnic instruments, and sound effects.

### Parameters

- **Color** - Selects display colors without changing pitch detection (switching recolors existing history):
  - **Normal** (default): Theme graph trace color.
  - **Note Colors**: Distinct color per pitch class, repeated across octaves.
  - **Instrument (3)**: Colors for Vocal, Bass, and Other.
  - **Instrument (9)**: Colors for the nine instrument groups above.
- **Highlight** - Emphasizes a specific group (**Vocal**, **Bass**, **Other (3)**, **Guitar**, **Piano**, **Strings**, **Wind**, **Synth**, **Organ**, or **Other (9)**) by shifting notes toward neutral gray the less likely they are to belong to that group, while preserving volume thickness. **None** (default) disables highlighting.
  - Onset and instrument analysis use additional CPU. To minimize CPU usage, turn off **Onsets** and **Chords & Key**, choose **Normal** or **Note Colors**, and set **Highlight** to **None**.
- **Pitch Resolution** - Selects vertical pitch detail without clearing history:
  - **1/12 Octave** (default): One row per semitone.
  - **High**: Places pitches at their estimated cent positions to show vibrato and pitch bends.
- **Layout** - **Horizontal** (default, keyboard at bottom, history scrolls up) or **Vertical** (keyboard at right, history scrolls left).
- **Volume** - Encodes relative volume in bar thickness and keyboard-edge semicircle meters (on by default). When off, bar thickness is fixed.
- **Onsets** - Marks estimated note attacks with triangles (▼ in Horizontal, ▶ in Vertical; off by default). The center of each triangle's base marks the attack time and pitch, so repeated attacks of a sustained pitch get separate marks. Turning it off does not stop instrument analysis while an Instrument **Color** or **Highlight** needs it.
- **Chords & Key** (off by default) - Shows the chord lane and key readings when enabled. Leave it off to reduce CPU usage.
- **Time Span** (1 to 10 s; default 2 s) - Duration of visible history on the piano roll.
- **Lowest Note** / **Highest Note** - Sets the analyzed and displayed pitch range (defaults: E1 to G6).

### Visualization Guide

- **Pitch Updates**: New sound appears immediately and is refined about 40, 80, and 160 ms later using subsequent audio context, without adding display latency or affecting **Sync Visuals to Audio**.
- **Grid & Keyboard**: Lines at each C mark octave boundaries, E–F guides remain visible in all modes, and black-key rows use a darker background. Piano keys light up with current pitch confidence.
- **Color Strength**: Color strength always shows pitch confidence. When the input is too quiet for analysis, the piano roll stays dark.
- **Instrument Colors & Highlight**: Instrument colors blend the group colors by their estimated probabilities. Colors appear at the corresponding positions in the history once the instrument estimate is ready; notes awaiting classification appear in neutral gray. The legend lists the shown groups, followed by **Highlight:** and the selected group while highlighting is active. Hover over any group in the legend to highlight it temporarily.
- **Volume Bars**: With **Volume** on, bar thickness spans a 24 dB relative range, and a soft semicircle at the keyboard edge rises immediately with the current volume and falls at 20 dB/s.
- **Chord Lane**: The narrow lane on the right in **Horizontal**, or at the top in **Vertical**, follows the same timeline as the notes. Chord names appear about 0.22 s after the sound, once the estimate is confirmed. Labels such as **C**, **Cm7**, and **C/E** show the chord; a slash names the bass note of an inversion. Intervals with no chord remain blank; short intervals may be too narrow to show a name. Chord names use large text; with **Note Colors**, names and duration bars use the chord root's color, including for inversions.
- **Key**: Shows the estimated key of the current passage in large text at the lower left, with a transparent background. The reading disappears when no key is identified. With **Note Colors**, it uses the displayed key's tonic color.

### Limitations

- Chord detection covers 11 types and their inversions: major, minor, diminished, augmented, major seventh, minor seventh, dominant seventh, diminished seventh, half-diminished seventh, sus2, and sus4. Note and chord names use # or ♭ spellings based on the key estimated from accumulated observations; sharps are used until that estimate is available.
- Validation on real pop and rock performances is limited; treat these estimates as listening aids.

[Back to all effects](/dsp/effects/)
