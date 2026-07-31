---
layout: dsp
title: "Multiband Compressor — EffeTune DSP"
description: "Applies independent compression to multiple frequency bands."
lang: en
permalink: /dsp/effects/multiband-compressor/
---
# Multiband Compressor

Semantic type: `MultibandCompressor` · Category: dynamics

Applies independent compression to multiple frequency bands.

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
| `threshold` | `threshold` | number / 5 | `[-20,-22,-25,-28,-18]` | dB | -60 … 0 |
| `ratio` | `ratio` | number / 5 | `[4,3,2.5,2,5]` | Not declared in catalog | 0.5 … 20 |
| `attack` | `attack` | number / 5 | `[30,20,15,10,5]` | ms | 0.1 … 100 |
| `release` | `release` | number / 5 | `[150,120,80,60,40]` | ms | 10 … 1000 |
| `knee` | `knee` | number / 5 | `[6,4,4,3,2]` | dB | 0 … 12 |
| `gain` | `gain` | number / 5 | `[-1,0,1,1.5,-2]` | dB | -12 … 12 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Multiband Compressor

A five-band listening processor that balances loudness separately in different frequency ranges. Use it when bass jumps out, vocals feel too forward, or treble becomes sharp. The default settings create a steady, radio-like sound for casual listening.

### Key Features
- 5-band processing with adjustable crossover frequencies
- Independent compression controls for each band
- Optimized default settings for FM radio-style sound
- Real-time visualization of gain reduction per band
- High-quality Linkwitz-Riley crossover filters

### Default Frequency Bands
The crossover frequencies are adjustable; these are the default band ranges.

- Band 1 (Low): Below 100 Hz
  - Controls the deep bass and sub frequencies
  - Higher ratio and longer release for tight, controlled bass
- Band 2 (Low-Mid): 100-500 Hz
  - Handles the upper bass and lower midrange
  - Moderate compression to maintain warmth
- Band 3 (Mid): 500-2000 Hz
  - Critical vocal and instrument presence range
  - Gentle compression to preserve naturalness
- Band 4 (High-Mid): 2000-8000 Hz
  - Controls presence and air
  - Light compression with faster response
- Band 5 (High): Above 8000 Hz
  - Manages brightness and sparkle
  - Quick response times with higher ratio

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
  - Sets the level where compression begins
  - Lower settings create more consistent levels
- **Ratio** (0.5:1 to 20:1)
  - 1:1: No change
  - Above 1:1: Compresses loud parts in that band
  - Below 1:1: Boosts sounds above the threshold for a more emphasized band sound
  - For normal listening control, start around 2:1 to 5:1
- **Attack** (0.1ms to 100ms)
  - How quickly compression responds
  - Faster times for transient control
- **Release** (10ms to 1000ms)
  - How quickly gain returns to normal
  - Longer times for smoother sound
- **Knee** (0dB to 12dB)
  - Smoothness of compression onset
  - Higher values for more natural transition
- **Gain** (-12dB to +12dB)
  - Output level adjustment per band
  - Fine-tune the frequency balance

### FM Radio Style Processing
The Multiband Compressor comes with optimized default settings for a steady FM radio-style listening sound:

- Low Band (< 100 Hz)
  - Higher ratio (4:1) for tight bass control
  - Slower attack/release to maintain punch
  - Slight reduction to prevent muddiness

- Low-Mid Band (100-500 Hz)
  - Moderate compression (3:1)
  - Balanced timing for natural response
  - Neutral gain to keep the low-mid balance natural

- Mid Band (500-2000 Hz)
  - Gentle compression (2.5:1)
  - Quick response times
  - Slight boost for vocal presence

- High-Mid Band (2000-8000 Hz)
  - Light compression (2:1)
  - Fast attack/release
  - Enhanced presence boost

- High Band (> 8000 Hz)
  - Higher ratio (5:1) for consistent brilliance
  - Very quick response times
  - Controlled reduction for polish

This configuration creates the characteristic "radio-ready" sound:
- Consistent, impactful bass
- Clear, forward vocals
- Controlled dynamics across all frequencies
- Smoother, more polished overall presentation
- Enhanced presence and clarity
- Reduced listening fatigue

### Visual Feedback
- Interactive transfer function graphs for each band
- Real-time gain reduction meters
- Frequency band activity visualization
- Clear crossover point indicators

### Tips for Use
- Start with the default FM radio-style settings
- Adjust crossover frequencies to match your material
- Fine-tune each band's threshold for desired amount of control
- Use the gain controls to shape the final frequency balance
- Monitor the gain reduction meters to ensure appropriate processing

[Back to all effects](/dsp/effects/)
