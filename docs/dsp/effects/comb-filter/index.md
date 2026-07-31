---
layout: dsp
title: "Comb Filter — EffeTune DSP"
description: "Creates regularly spaced spectral notches and peaks with a short delay."
lang: en
permalink: /dsp/effects/comb-filter/
---
# Comb Filter

Semantic type: `CombFilter` · Category: eq

Creates regularly spaced spectral notches and peaks with a short delay.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `fundamentalFrequency` | `fundamental_frequency` | number / 1 | `440` | Hz | 20 … 20000 |
| `feedbackGain` | `feedback_gain` | number / 1 | `0.4` | Not declared in catalog | -1 … 1 |
| `dryWetMix` | `dry_wet_mix` | number / 1 | `50` | % | 0 … 100 |
| `combType` | `comb_type` | string / 1 | `"ff"` | Not declared in catalog | `fb`, `ff` |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Comb Filter

A comb filter that adds a phasey, hollow, metallic, or resonant character by mixing the sound with a very short delayed copy. Use it when you want a track to feel more colored, spacious, or experimental.

### Listening Enhancement Guide
- Add Subtle Coloration:
  - Start with Feedforward mode, Feedback Gain around 0.2-0.4, and Dry-Wet Mix around 20-40%
  - Adjust the Fundamental Frequency until the hollow or phasey tone fits the music
  - Keep feedback low for a gentler effect that blends with the original sound
- Create Resonance and Echo Effects:
  - Use Feedback mode or higher Feedback Gain for stronger ringing or echo-like effects
  - Experiment with different fundamental frequencies for unique tonal character
  - Use lower Dry-Wet Mix values if the effect becomes too obvious
- Bright Metallic Color:
  - Try higher Fundamental Frequency values for brighter, wider-spaced comb peaks and dips
  - Use positive or negative Feedback Gain to change the pattern of peaks and dips
  - Combine with other effects for more experimental listening effects

### Parameters
- **Fundamental Frequency (Hz)** - Controls the delay time and harmonic spacing (20Hz to 20000Hz)
  - Lower values: Longer delays, closer-spaced comb peaks and dips
  - Higher values: Shorter delays, wider-spaced comb peaks and dips
- **Feedback Gain** - Controls the intensity of the comb filter effect (-1.0 to 1.0)
  - Negative values: Creates inverse harmonic patterns
  - Positive values: Creates reinforcing harmonic patterns
  - Zero: No effect (dry signal only)
  - Higher absolute values: More pronounced effect
- **Comb Type** - Controls the filter structure
  - Feedforward: Creates harmonic enhancement without feedback
  - Feedback: Creates resonance and echo-like effects
- **Dry-Wet Mix** - Controls the balance between processed and original signal (0% to 100%)
  - 0%: Original signal only
  - 50%: Equal mix of original and processed
  - 100%: Processed signal only

### Technical Details
- **Delay Calculation**: Delay time = 1 / Fundamental Frequency
- **Harmonic Response**: Creates regularly spaced peaks and dips based on the fundamental frequency
- **Spatial Coloration**: Can resemble short reflections, hollow coloration, or metallic resonance
- **Real-time Visualization**: Shows frequency response with fundamental frequency marker

### Visual Display
- Real-time frequency response graph with logarithmic frequency scale
- Clear visualization of comb filter peaks and dips
- Fundamental frequency marker showing delay time
- Interactive controls for precise adjustment
- Delay distance calculation in millimeters

[Back to all effects](/dsp/effects/)
