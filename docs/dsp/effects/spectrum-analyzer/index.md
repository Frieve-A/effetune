---
layout: dsp
title: "Spectrum Analyzer — EffeTune DSP"
description: "Passes audio through while the host-side EffeTune app can display its frequency spectrum."
lang: en
permalink: /dsp/effects/spectrum-analyzer/
---
# Spectrum Analyzer

Semantic type: `SpectrumAnalyzer` · Category: analyzer

Passes audio through while the host-side EffeTune app can display its frequency spectrum.

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

## Spectrum Analyzer

Creates a real-time visual display of your music's frequencies, from deep bass to high treble. It's like seeing the individual ingredients that make up the complete sound of your music.

### Visualization Guide
- Left side shows bass frequencies (drums, bass guitar)
- Middle shows main frequencies (vocals, guitars, piano)
- Right side shows high frequencies (cymbals, sparkle, air)
- Higher peaks mean stronger presence of those frequencies
- The thicker line shows the current sound
- The thinner line follows recent peaks and falls smoothly as they fade
- In **Bar** display, each bar shows the strongest level in an equal-width portion of the display. **Log** and **Log (HQ)** use equal octave widths; **Linear** uses equal frequency widths.
- The thin marker above a bar shows its recent peak and falls smoothly.
- With **Log (HQ)**, nearby bass tones can appear as separate peaks. Their longer low-frequency measurement can take a little longer to settle or fade.
- Watch how different instruments create different patterns

### What You Can See
- Bass Drops: Big movements on the left
- Vocal Melodies: Activity in the middle
- Crisp Highs: Sparkles on the right
- Full Mix: How all frequencies work together

### Parameters
- **DB Range** - How sensitive the display is (-144dB to -48dB)
  - Lower numbers: See more subtle details
  - Higher numbers: Focus on the main sounds
- **Points** - How finely the display separates nearby frequencies (256 to 16384)
  - Higher numbers: More frequency detail, with slower updates
  - Lower numbers: Quicker updates, with less frequency detail
  - With **Log (HQ)**, Points sets the short analysis window; a four-times-longer window improves low-frequency separation.
- **Color** - **Normal** (default) keeps the theme’s graph colors. **Heatmap** colors higher levels more brightly, and **Note Colors** follows the note colors across the frequency axis. The choice applies to both Line and Bar displays. With **Bar** and **Note Colors**, each bar and its peak use one color based on the band’s center frequency.
- **Frequency Scale** - **Log** gives low frequencies more display space. **Log (HQ)** adds a longer measurement for clearer separation of nearby bass frequencies while retaining the short measurement for higher frequencies. It uses more processing and low-frequency changes can take longer to appear or fade; it does not change the audio. **Linear** places equal frequency widths at equal intervals.
- **Display** - Changes only how the spectrum looks; it does not change the analysis or audio.
  - **Line** (default): Shows the spectrum as continuous lines.
  - **Bar**: Shows the strongest level in each display band as a bar.
- **Keyboard** - Shows a static keyboard guide below the graph that relates musical notes to frequencies. It does not change the analysis or audio. The keys follow **Log**, **Log (HQ)**, or **Linear**; **Log (HQ)** uses the same logarithmic spacing as **Log**, while with **Linear**, low-frequency keys look narrower.
- The analyzer uses the average of the left and right channels. Mono input is analyzed directly.

### Fun Ways to Use These Tools

1. Exploring Your Music
   - Watch how different genres create different patterns
   - See the difference between acoustic and electronic music
   - Observe how instruments occupy different frequency ranges

2. Learning About Sound
   - See the bass in electronic music
   - Watch vocal melodies move across the display
   - Observe how drums create sharp patterns

3. Enhancing Your Experience
   - Use the Level Meter to check signal peaks after adding effects
   - Watch the Spectrum Analyzer dance with the music
   - Create a visual light show with the Spectrogram

[Back to all effects](/dsp/effects/)
