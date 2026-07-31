---
layout: dsp
title: "Sub Synth — EffeTune DSP"
description: "Derives low-frequency harmonic content from the input signal."
lang: en
permalink: /dsp/effects/sub-synth/
---
# Sub Synth

Semantic type: `SubSynth` · Category: saturation

Derives low-frequency harmonic content from the input signal.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `subLevel` | `sub_level` | number / 1 | `100` | % | 0 … 200 |
| `dryLevel` | `dry_level` | number / 1 | `100` | % | 0 … 200 |
| `subLowPassFrequency` | `sub_low_pass_frequency` | number / 1 | `160` | Hz | 5 … 400 |
| `subLowPassSlope` | `sub_low_pass_slope` | integer / 1 | `-12` | dB/oct | -24 … 0 |
| `subHighPassFrequency` | `sub_high_pass_frequency` | number / 1 | `5` | Hz | 5 … 400 |
| `subHighPassSlope` | `sub_high_pass_slope` | integer / 1 | `-6` | dB/oct | -24 … 0 |
| `dryHighPassFrequency` | `dry_high_pass_frequency` | number / 1 | `40` | Hz | 5 … 400 |
| `dryHighPassSlope` | `dry_high_pass_slope` | integer / 1 | `0` | dB/oct | -24 … 0 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Sub Synth

A specialized effect that reinforces the low end by mixing in a filtered low-frequency signal derived from the original audio. Useful when bass-light music needs more warmth, fullness, or headphone-friendly impact.

### Listening Enhancement Guide
- Bass Enhancement:
  - Adds depth and power to thin recordings
  - Creates fuller, richer low end
  - Perfect for headphone listening
- Frequency Control:
  - Control which added low-frequency range is kept
  - Independent filtering for clean bass
  - Maintains clarity while adding power

### Parameters
- **Sub Level** - Controls the added low-frequency signal level (0-200%)
  - Light (0-50%): Subtle bass enhancement
  - Medium (50-100%): Balanced bass boost
  - High (100-200%): Dramatic bass effect
- **Dry Level** - Adjusts the original signal level (0-200%)
  - Use to balance with the added low-frequency signal
  - Maintain clarity of original sound
- **Sub LPF** - Low-pass filter for the added low-frequency signal (5-400Hz)
  - Frequency: Controls upper limit of the added low-frequency signal
  - Slope: Adjusts filter steepness (Off to -24dB/oct)
- **Sub HPF** - High-pass filter for the added low-frequency signal (5-400Hz)
  - Frequency: Removes unwanted rumble from the added low-frequency signal
  - Slope: Controls filter steepness (Off to -24dB/oct)
- **Dry HPF** - High-pass filter for dry signal (5-400Hz)
  - Frequency: Prevents bass buildup
  - Slope: Adjusts filter steepness (Off to -24dB/oct)

### Visual Display
- Live frequency response graph
- Clear visualization of filter curves
- Real-time visual feedback

### Music Enhancement Tips
- For General Bass Enhancement:
  1. Start with Sub Level at 50%
  2. Set Sub LPF around 100Hz (-12dB/oct)
  3. Keep Sub HPF at 20Hz (-6dB/oct)
  4. Adjust Dry Level to taste

- For Clean Bass Boost:
  1. Set Sub Level to 70-100%
  2. Use Sub LPF at 80Hz (-18dB/oct)
  3. Set Sub HPF to 30Hz (-12dB/oct)
  4. Set Dry HPF to 40Hz (-6dB/oct)

- For Maximum Impact:
  1. Increase Sub Level to 150%
  2. Set Sub LPF to 120Hz (-24dB/oct)
  3. Keep Sub HPF at 15Hz (-6dB/oct)
  4. Balance with Dry Level

### Quick Start Guide
1. Start with moderate Sub Level (50-70%)
2. Set Sub LPF around 100Hz
3. Enable Sub HPF around 20Hz (-6dB/oct)
4. Adjust Dry Level for balance
5. Fine-tune filters to taste
6. Trust your ears and adjust gradually!

[Back to all effects](/dsp/effects/)
