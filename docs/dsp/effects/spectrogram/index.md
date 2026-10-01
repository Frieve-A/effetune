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

Use the opt-in decoded telemetry callback or subscription API to observe this effect. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **decoded semantic observations are available**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `dBRange` | `d_brange` | number / 1 | `-96` | dB | -144 … -48 |
| `points` | `points` | integer / 1 | `12` | Not declared in catalog | 8 … 14 |
| `highQualityLog` | `high_quality_log` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Spectrogram

Shows how your music changes over time. Color intensity shows how strong each frequency is, while vertical position shows its frequency.

The graph scrolls from right to left at a steady speed, with marks every second.

### Visualization Guide
- Colors show how strong different frequencies are:
  - Dark colors: Quiet sounds
  - Bright colors: Loud sounds
  - Watch the patterns change with the music
- Vertical position shows frequency:
  - Bottom: Bass sounds
  - Middle: Main instruments
  - Top: High frequencies
- With **Log (HQ)**, nearby low-frequency tones appear as more clearly separated bands. The longer low-frequency measurement can take a little longer to settle or fade.

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
  - With **Log (HQ)**, Points sets the short analysis window; a four-times-longer window improves low-frequency separation.
- **Color** - **Normal** uses the theme’s graph color, with stronger frequencies shown more brightly. **Heatmap** (default) uses the original dark-to-bright multicolor scale. Switching color recolors the existing history.
- **Frequency Scale** - **Log** gives low frequencies more display space. **Log (HQ)** adds a longer measurement for clearer separation of nearby bass frequencies while retaining the short measurement for higher frequencies. It uses more processing and low-frequency changes can take longer to appear or fade; it does not change the audio. **Linear** places equal frequency widths at equal intervals.
- **Keyboard** - Shows a static keyboard guide at the right of the graph that relates musical notes to frequencies. It does not change the analysis or audio. The keys follow **Log**, **Log (HQ)**, or **Linear**; **Log (HQ)** uses the same logarithmic spacing as **Log**, while with **Linear**, low-frequency keys look narrower.
- The analyzer uses the average of the left and right channels. Mono input is analyzed directly.

[Back to all effects](/dsp/effects/)
