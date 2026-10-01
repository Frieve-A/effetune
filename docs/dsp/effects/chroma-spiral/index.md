---
layout: dsp
title: "Chroma Spiral — EffeTune DSP"
description: "Passes audio through while exposing a high-resolution spectrum for note-and-octave display."
lang: en
permalink: /dsp/effects/chroma-spiral/
---
# Chroma Spiral

Semantic type: `ChromaSpiral` · Category: analyzer

Passes audio through while exposing a high-resolution spectrum for note-and-octave display.

Use the opt-in decoded telemetry callback or subscription API to observe this effect. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **decoded semantic observations are available**

This effect has no semantic parameters.



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Chroma Spiral

Shows where the frequency components of your music fall among the 12 notes and across octaves, without changing the sound. Use it to see which note positions are active when harmonics overlap, compare a vocal with a bass line, or inspect the pitch range of an instrument.

### Listening Guide

- Play a sustained note, then look for its position and the other positions lit by its harmonics. A single note can light several note names; these are frequency components, not necessarily separate played notes.
- Watch a chord or melody to see how its active note positions change. The display can suggest tonal patterns, but it does not identify a chord or key.
- For a tuning check, watch whether a bright dot or the outer edge of a filled peak falls between note guides. Use Pitch Meter when you need a cents readout for one fundamental pitch.
- Press the graph with a mouse, finger, or pen to hear a sine wave at the selected spiral position. Drag to change the tone; release or cancel the gesture to stop it. This preview works with every **Color** choice.

### Parameters

- **Color** - Selects how the spectrum is drawn. The same background spiral guide remains visible with every choice, even during silence.
  - **Normal** (default): shows each frequency cell as a dot in the theme's graph trace color. Its brightness follows the cell's level, while its area grows in proportion to that level, making quieter frequencies easier to see. At maximum strength, a dot's radius reaches halfway toward the next spiral turn.
  - **Normal 2**: fills from each frequency's spiral position out to its level in the graph trace color, without drawing a data contour.
  - **Note Colors**: shows the same dots as Normal, but uses a different color for each note, repeated across octaves.
- **Lowest Octave** (1 to 8; default 1) - Sets the innermost displayed octave. Raise it to focus on higher sounds.
- **Highest Octave** (1 to 9; default 7) - Sets the outermost displayed octave. Lower it to focus on bass and midrange sounds. The two octave limits stay in order when either is changed.
- **Frequency Tilt** (-6 to +6 dB/oct in 0.5 steps; default +3) - Adjusts the displayed level of frequencies above 100 Hz without changing the sound. Positive values make higher frequencies more prominent; negative values make them less prominent. At 0, no frequency correction is applied.
- **Level Range** (6 to 96 dB in 1 dB steps; default 24) - Sets the width of the moving display window. Narrow it to emphasize level differences; widen it to show weaker components alongside stronger ones.
- **Display Floor** (-120 to -24 dB in 1 dB steps; default -60) - Sets how low the moving display window may reach during quiet passages. Lower it to allow quieter components to appear within the selected **Level Range**. The window still follows recent peaks, so this setting does not guarantee that every quiet component will be visible.

### Visualization Guide

- Each turn covers one octave. C is at the top and note names run clockwise; inner turns are lower than outer turns. The C labels mark the octave numbers.
- In **Normal** and **Note Colors**, brighter, larger dots indicate stronger components at their positions, including between note names. In **Normal 2**, a filled region extends farther outward for stronger components; its outer edge shows the changing spectrum without a separate contour line.
- Dot brightness and area, and the filled area's extent, show relative strength. The display follows recent peaks, so they are not absolute level readings.
- Low notes are less sharply separated and respond more slowly. Nearby notes in the lowest octaves may blur together.

[Back to all effects](/dsp/effects/)
