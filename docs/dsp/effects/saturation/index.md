---
layout: dsp
title: "Saturation — EffeTune DSP"
description: "Applies smooth nonlinear distortion with controllable drive and mix."
lang: en
permalink: /dsp/effects/saturation/
---
# Saturation

Semantic type: `Saturation` · Category: saturation

Applies smooth nonlinear distortion with controllable drive and mix.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `drive` | `drive` | number / 1 | `1.5` | Not declared in catalog | 0 … 10 |
| `bias` | `bias` | number / 1 | `0.1` | Not declared in catalog | -0.3 … 0.3 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |
| `gain` | `gain` | number / 1 | `-2` | dB | -18 … 18 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Saturation

An effect that simulates the warm, pleasant sound of vintage tube equipment. It can add richness and character to your music, making it sound more "analog" and less "digital."

### Listening Enhancement Guide
- Adding Warmth:
  - Makes digital music sound more natural
  - Adds pleasant richness to the sound
  - Perfect for jazz and acoustic music
- Rich Character:
  - Creates a more "vintage" sound
  - Adds depth and dimension
  - Great for rock and electronic music
- Strong Effect:
  - Transforms the sound dramatically
  - Creates bold, characterful tones
  - Ideal for experimental listening

### Parameters
- **Drive** - Controls the amount of warmth and character (0.0 to 10.0)
  - Light (0.0-3.0): Subtle analog warmth
  - Medium (3.0-6.0): Rich, vintage character
  - Strong (6.0-10.0): Bold, dramatic effect
- **Bias** - Adjusts the saturation curve's asymmetry (-0.3 to 0.3)
  - 0.0: Symmetrical saturation
  - Positive: Makes the negative side of the waveform more prominent
  - Negative: Makes the positive side of the waveform more prominent
- **Mix** - Balances the effect with the original sound (0% to 100%)
  - 0-30%: Subtle enhancement
  - 30-70%: Balanced effect
  - 70-100%: Strong character
- **Gain** - Adjusts the overall volume (-18dB to +18dB)
  - Use negative values if the effect is too loud
  - Use positive values if the effect is too quiet

### Visual Display
- Clear graph showing how the sound is being shaped
- Real-time visual feedback
- Easy-to-read controls

### Music Enhancement Tips
- Classical & Jazz:
  - Light Drive (1.0-2.0) for natural warmth
  - Set Bias to 0.0 for clean saturation
  - Low Mix (20-40%) for subtlety
- Rock & Pop:
  - Medium Drive (3.0-5.0) for rich character
  - Keep Bias neutral for consistent response
  - Medium Mix (40-60%) for balance
- Electronic:
  - Higher Drive (4.0-7.0) for bold effect
  - Experiment with different Bias values
  - Higher Mix (60-80%) for character

### Quick Start Guide
1. Start with low Drive for gentle warmth
2. Set Bias to 0.0 first for symmetrical saturation
3. Adjust Mix to balance the effect
4. Adjust Gain if needed for proper volume
5. Experiment and trust your ears!

[Back to all effects](/dsp/effects/)
