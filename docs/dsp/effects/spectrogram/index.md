---
layout: dsp
title: "Spectrogram — EffeTune DSP"
description: "Passes audio through while the host-side EffeTune app can display frequency content over time."
lang: en
permalink: /dsp/effects/spectrogram/
---
# Spectrogram

Semantic type: `Spectrogram` · Category: analyzer

Passes audio through while the host-side EffeTune app can display frequency content over time.

Use the opt-in decoded telemetry callback or subscription API to observe this analyzer. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Analyzer telemetry: **decoded semantic observations are available in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `dBRange` | `d_brange` | number / 1 | `-96` | dB | -144 … -48 |
| `points` | `points` | integer / 1 | `12` | Not declared in catalog | 8 … 14 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Spectrogram

Creates colorful patterns that show how your music changes over time. Colors show how strong each sound is, while vertical position shows its frequency.

### Visualization Guide
- Colors show how strong different frequencies are:
  - Dark colors: Quiet sounds
  - Bright colors: Loud sounds
  - Watch the patterns change with the music
- Vertical position shows frequency:
  - Bottom: Bass sounds
  - Middle: Main instruments
  - Top: High frequencies

### What You Can See
- Melodies: Flowing lines of color
- Beats: Vertical stripes
- Bass: Bright colors at the bottom
- Harmonies: Multiple parallel lines
- Different instruments create unique patterns

### Parameters
- **DB Range** - How vibrant the colors are (-144dB to -48dB)
  - Lower numbers: See more subtle details
  - Higher numbers: Focus on the main sounds
- **Points** - FFT size used for the display (256 to 16384)
  - Higher numbers: More frequency detail, but slower time updates
  - Lower numbers: Faster movement, but less frequency detail
- **Frequency Scale** - **Log** gives low frequencies more display space; **Linear** places equal frequency widths at equal intervals.
- The analyzer uses the average of the left and right channels. Mono input is analyzed directly.

[Back to all effects](/dsp/effects/)
