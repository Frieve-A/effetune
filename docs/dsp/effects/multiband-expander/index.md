---
layout: dsp
title: "Multiband Expander — EffeTune DSP"
description: "Applies independent expansion to multiple frequency bands."
lang: en
permalink: /dsp/effects/multiband-expander/
---
# Multiband Expander

Semantic type: `MultibandExpander` · Category: dynamics

Applies independent expansion to multiple frequency bands.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `frequency1` | `frequency1` | number / 1 | `100` | Hz | 20 … 500 |
| `frequency2` | `frequency2` | number / 1 | `500` | Hz | 100 … 2000 |
| `frequency3` | `frequency3` | number / 1 | `2000` | Hz | 500 … 8000 |
| `frequency4` | `frequency4` | number / 1 | `8000` | Hz | 1000 … 20000 |
| `threshold` | `threshold` | number / 5 | `[-30,-16,-24,-36,-48]` | dB | -60 … 0 |
| `ratio` | `ratio` | number / 5 | `[1.2,1.2,1.2,1.1,1.1]` | Not declared in catalog | 0.05 … 20 |
| `attack` | `attack` | number / 5 | `[10,7.75,5.5,3.25,1]` | ms | 0.1 … 100 |
| `release` | `release` | number / 5 | `[100,87.5,75,62.5,50]` | ms | 10 … 1000 |
| `knee` | `knee` | number / 5 | `[6,4,4,3,2]` | dB | 0 … 12 |
| `gain` | `gain` | number / 5 | `[1,1,1,1,1]` | dB | -12 … 12 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Multiband Expander

A five-band listening processor that can restore some natural contrast to overly flat or heavily compressed recordings. It works separately in each frequency range, usually making below-threshold sounds quieter, while ratio settings below 1:1 can lift quieter sounds instead.

### Key Features
- 5-band processing with adjustable crossover frequencies
- Independent expansion controls for each band
- Optimized default settings for gentle dynamic contrast restoration
- Real-time visualization of expansion activity per band
- High-quality Linkwitz-Riley crossover filters

### Listening Enhancement Guide
- Pop/Rock Music:
  - Reduce the "wall of sound" effect from over-compressed recordings
  - Restore dynamic contrast between verses and choruses
  - Improve the flat impression of streaming audio sources
- Classical Music:
  - Restore the natural dynamic ebb and flow of recordings
  - Enhance contrast between quiet passages and loud crescendos
  - Bring back the vivid expression of orchestral performances
- Jazz Music:
  - Enhance the natural dynamics between instruments
  - Make quiet solos more intimate and loud sections more powerful
  - Restore the natural breathing of jazz performances

### Default Frequency Bands
The crossover frequencies are adjustable; these are the default band ranges.

- Band 1 (Low): Below 100 Hz
  - Controls the deep bass and sub frequencies
  - Gentle expansion with longer attack/release for natural bass dynamics
- Band 2 (Low-Mid): 100-500 Hz
  - Handles the upper bass and lower midrange
  - Moderate expansion to restore warmth and body
- Band 3 (Mid): 500-2000 Hz
  - Critical vocal and instrument presence range
  - Balanced expansion to preserve naturalness
- Band 4 (High-Mid): 2000-8000 Hz
  - Controls presence and air
  - Light expansion with faster response
- Band 5 (High): Above 8000 Hz
  - Manages brightness and sparkle
  - Quick response times with gentler expansion

### Parameters

#### Crossover Frequencies
- **Freq 1** (20Hz to 500Hz, default 100Hz)
  - Sets the Low/Low-Mid crossover point
- **Freq 2** (100Hz to 2000Hz, default 500Hz)
  - Sets the Low-Mid/Mid crossover point
- **Freq 3** (500Hz to 8000Hz, default 2000Hz)
  - Sets the Mid/High-Mid crossover point
- **Freq 4** (1000Hz to 20000Hz, default 8000Hz)
  - Sets the High-Mid/High crossover point
- Frequencies are kept in ascending order automatically, so moving one control can raise the next crossover if needed

#### Per-Band Controls
- **Threshold** (-60dB to 0dB)
  - Sets the level where expansion begins
  - Signals below this level are processed by the Ratio setting
- **Ratio** (1:0.05 to 1:20)
  - 1:1: No change
  - Above 1:1: Makes sounds below the threshold quieter
  - Below 1:1: Raises quieter sounds instead of reducing them
  - For natural dynamic restoration, start around 1.1:1 to 1.2:1
- **Attack** (0.1ms to 100ms)
  - How quickly expansion responds
  - Faster times for precise transient control
- **Release** (10ms to 1000ms)
  - How quickly gain returns to normal
  - Longer times for smoother, more natural sound
- **Knee** (0dB to 12dB)
  - Smoothness of expansion onset
  - Higher values for more natural transition
- **Gain** (-12dB to +12dB)
  - Output level adjustment per band
  - Fine-tune the frequency balance

### Dynamic Range Restoration
The Multiband Expander comes with optimized default settings for gently restoring contrast in over-compressed material:

- Low Band (< 100 Hz)
  - Gentle expansion (1.2:1) for controlled bass dynamics
  - Longer attack/release to maintain punch
  - Threshold set to accommodate typical bass energy

- Low-Mid Band (100-500 Hz)
  - Moderate expansion (1.2:1)
  - Balanced timing for natural response
  - Threshold is tuned for typical low-mid energy

- Mid Band (500-2000 Hz)
  - Balanced expansion (1.2:1)
  - Medium response times
  - Optimized for vocal and instrument dynamics

- High-Mid Band (2000-8000 Hz)
  - Light expansion (1.1:1)
  - Faster attack/release
  - Natural presence restoration

- High Band (> 8000 Hz)
  - Gentlest expansion (1.1:1)
  - Very quick response times
  - Subtle air and sparkle enhancement

This configuration creates natural-sounding dynamic restoration:
- Restored natural dynamics across all frequencies
- Enhanced contrast between quiet and loud passages
- Frequency-specific control for optimal results
- Natural, musical expansion without artifacts
- Improved clarity and separation
- Reduced flatness in over-compressed recordings

### Visual Feedback
- Interactive transfer function graphs for each band
- Real-time expansion activity meters showing how much each band is being reduced or lifted
- Frequency band activity visualization
- Clear crossover point indicators

### Tips for Use
- Start with the default settings for general dynamic restoration
- Adjust crossover frequencies to match your material
- Fine-tune each band's threshold based on the frequency content
- Use the gain controls to compensate for any perceived volume changes
- Monitor the expansion activity meters to ensure appropriate processing

[Back to all effects](/dsp/effects/)
