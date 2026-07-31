---
layout: dsp
title: "Exciter — EffeTune DSP"
description: "Generates controlled high-frequency harmonics to emphasize detail."
lang: en
permalink: /dsp/effects/exciter/
---
# Exciter

Semantic type: `Exciter` · Category: saturation

Generates controlled high-frequency harmonics to emphasize detail.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `highPassFrequency` | `high_pass_frequency` | number / 1 | `3000` | Hz | 500 … 10000 |
| `highPassSlope` | `high_pass_slope` | integer / 1 | `6` | dB/oct | `0`, `6`, `12` |
| `drive` | `drive` | number / 1 | `3` | Not declared in catalog | 0 … 10 |
| `bias` | `bias` | number / 1 | `0.1` | Not declared in catalog | -0.3 … 0.3 |
| `mix` | `mix` | number / 1 | `25` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Exciter

An effect that adds harmonic content to enhance clarity and presence. By filtering the high-frequency content and applying saturation, it creates additional harmonics that brighten and enhance your music.

### Listening Enhancement Guide
- **Subtle Enhancement:**
  - Adds clarity and air to voices and high-frequency details
  - Enhances presence in the whole playback signal
  - Creates a more open, detailed sound
- **Moderate Effect:**
  - Brings out hidden details in the mix
  - Adds sparkle and brilliance
  - Makes music sound more "hi-fi"
- **Creative Effect:**
  - Creates bright, cutting tones
  - Adds aggressive presence
  - Useful when you want a brighter, more forward sound, but best used sparingly

### Parameters
- **HPF Freq** (500-10000Hz) - Sets the cutoff frequency for high-pass filtering
  - Low values (500-2000Hz): Affects more of the signal
  - Mid values (2000-5000Hz): Targets presence frequencies
  - High values (5000-10000Hz): Focuses on air and brilliance
- **HPF Slope** - Controls the filter steepness
  - Off: No filtering, processes full spectrum
  - 6dB/oct: Gentle filtering
  - 12dB/oct: Steeper filtering
- **Drive** (0.0-10.0) - Controls saturation intensity
  - Light (0.0-3.0): Subtle harmonic enhancement
  - Medium (3.0-6.0): Notable brightness
  - High (6.0-10.0): Strong excitation
- **Bias** (-0.3 to 0.3) - Adjusts saturation asymmetry
  - Zero: Symmetrical saturation
  - Positive/Negative: Adds asymmetric character by changing which side of the generated enhancement saturates more strongly
- **Mix** (0-100%) - Controls how much of the generated harmonic enhancement is added to the original sound
  - Low (0-30%): Subtle added brightness
  - Medium (30-60%): Clearer presence and detail
  - High (60-100%): Strong added harmonics; use carefully to avoid harshness

### Visual Display
- High-pass filter frequency response graph
- Saturation transfer curve visualization
- Clear visual feedback for both filter and saturation

### Music Enhancement Tips
- For Clearer Voices in Songs, Podcasts, or Videos:
  - HPF Freq: 3000-5000Hz
  - HPF Slope: 6dB/oct
  - Drive: 2.0-4.0
  - Bias: 0.05 to 0.1
  - Mix: 20-40%

- For Clearer Mid/High Detail in Busy Recordings:
  - HPF Freq: 2000-4000Hz
  - HPF Slope: 12dB/oct
  - Drive: 3.0-5.0
  - Bias: 0.0
  - Mix: 30-50%

- For Subtle Full-Track Brightness:
  - HPF Freq: 5000-8000Hz
  - HPF Slope: 6dB/oct
  - Drive: 1.0-3.0
  - Bias: 0.0 to 0.1
  - Mix: 10-25%

### Quick Start Guide
1. Set HPF Freq to target the desired frequency range
2. Choose HPF Slope (start with 6dB/oct)
3. Begin with moderate Drive (3.0)
4. Set Bias near 0.1 for a slightly asymmetric character
5. Set Mix to 25% and adjust to taste
6. Fine-tune all parameters while listening

[Back to all effects](/dsp/effects/)
