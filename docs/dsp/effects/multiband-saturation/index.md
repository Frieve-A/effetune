---
layout: dsp
title: "Multiband Saturation — EffeTune DSP"
description: "Applies independent saturation to multiple frequency bands."
lang: en
permalink: /dsp/effects/multiband-saturation/
---
# Multiband Saturation

Semantic type: `MultibandSaturation` · Category: saturation

Applies independent saturation to multiple frequency bands.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `frequency1` | `frequency1` | number / 1 | `200` | Hz | 20 … 2000 |
| `frequency2` | `frequency2` | number / 1 | `4000` | Hz | 200 … 20000 |
| `drive` | `drive` | number / 3 | `[1.5,1.5,1.5]` | Not declared in catalog | 0 … 10 |
| `bias` | `bias` | number / 3 | `[0.1,0.1,0.1]` | Not declared in catalog | -0.3 … 0.3 |
| `mix` | `mix` | number / 3 | `[100,100,100]` | % | 0 … 100 |
| `gain` | `gain` | number / 3 | `[0,0,0]` | dB | -18 … 18 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Multiband Saturation

A versatile effect that lets you add warmth and character to specific frequency ranges of the whole playback signal. By splitting the sound into low, mid, and high bands, you can shape each range independently for precise sound enhancement.

### Listening Enhancement Guide
- Low-Frequency Warmth:
  - Add warmth and punch to low frequencies
  - Adds fullness and gentle punch to the low-frequency range of the whole playback signal
  - Create fuller, richer low end
- Midrange Clarity:
  - Adds body and definition to the midrange where many voices and instruments are present
  - Helps busy recordings feel clearer
  - Create clearer, more defined sound
- High-End Sweetening:
  - Add sparkle to the high-frequency range
  - Enhance the air and brilliance
  - Create crisp, detailed highs

Because this processes frequency bands, it affects all sounds in the selected range, not isolated instruments or vocals.

### Parameters
- **Crossover Frequencies**
  - Freq 1 (20Hz-2kHz): Sets where low band ends and mid band begins
  - Freq 2 (200Hz-20kHz, always kept at or above Freq 1): Sets where mid band ends and high band begins
  - If Freq 2 is set below Freq 1, it is automatically raised to preserve the low-mid-high band order
- **Band Controls** (for each Low, Mid, and High band):
  - **Drive** (0.0-10.0): Controls saturation intensity
    - Light (0.0-3.0): Subtle enhancement
    - Medium (3.0-6.0): Notable warmth
    - High (6.0-10.0): Strong character
  - **Bias** (-0.3 to 0.3): Adjusts the saturation curve's symmetry
    - Zero: Symmetrical saturation
    - Positive/Negative: Adds asymmetric character by changing which side of the waveform saturates more strongly
  - **Mix** (0-100%): Blends effect with original
    - Low (0-30%): Subtle enhancement
    - Medium (30-70%): Balanced effect
    - High (70-100%): Strong character
  - **Gain** (-18dB to +18dB): Adjusts band volume
    - Use to balance the bands with each other
    - Compensate for any volume changes

### Visual Display
- Interactive band selection tabs
- Real-time transfer curve graph for each band
- Clear visual feedback as you adjust settings

### Music Enhancement Tips
- For Full Mix Enhancement:
  1. Start with gentle Drive (2.0-3.0) on all bands
  2. Set Bias to 0.0 for natural saturation
  3. Set Mix around 40-50% for natural blend
  4. Fine-tune Gain for each band

- For Low-Frequency Warmth:
  1. Focus on Low band
  2. Use moderate Drive (3.0-5.0)
  3. Keep Bias neutral for consistent response
  4. Keep Mix around 50-70%

- For Midrange Presence:
  1. Focus on Mid band
  2. Use light Drive (1.0-3.0)
  3. Set Bias to 0.0 for natural sound
  4. Adjust Mix to taste (30-50%)

- For Adding Brightness:
  1. Focus on High band
  2. Use gentle Drive (1.0-2.0)
  3. Keep Bias neutral for clean saturation
  4. Keep Mix subtle (20-40%)

### Quick Start Guide
1. Set crossover frequencies to split your sound
2. Start with low Drive values on all bands
3. Set Bias to 0.0 first for symmetrical saturation
4. Use Mix to blend the effect naturally
5. Fine-tune with Gain controls
6. Trust your ears and adjust to taste!

[Back to all effects](/dsp/effects/)
