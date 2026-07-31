---
layout: dsp
title: "Bit Crusher — EffeTune DSP"
description: "Reduces amplitude resolution and sample-rate fidelity for digital quantization effects."
lang: en
permalink: /dsp/effects/bit-crusher/
---
# Bit Crusher

Semantic type: `BitCrusher` · Category: lo-fi

Reduces amplitude resolution and sample-rate fidelity for digital quantization effects.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `bitDepth` | `bit_depth` | integer / 1 | `8` | Not declared in catalog | 4 … 24 |
| `tpdfDither` | `tpdf_dither` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |
| `zohFrequency` | `zoh_frequency` | number / 1 | `44100` | Hz | 4000 … 96000 |
| `bitError` | `bit_error` | number / 1 | `0` | % | 0 … 10 |
| `seed` | `seed` | integer / 1 | `11` | Not declared in catalog | 0 … 1000 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Bit Crusher

An effect that recreates the sound of vintage digital devices like old gaming consoles and early samplers. Perfect for adding retro character or creating a lo-fi atmosphere.

### Sound Character Guide
- Retro Gaming Style:
  - Creates classic 8-bit console sounds
  - Perfect for video game music nostalgia
  - Adds pixelated texture to the sound
- Lo-Fi Hip Hop Style:
  - Creates that relaxing, study-beats sound
  - Warm, gentle digital degradation
  - Perfect for background listening
- Creative Effects:
  - Create unique glitch-style sounds
  - Transform modern music into retro versions
  - Add digital character to any music

### Parameters
- **Bit Depth** - Controls how "digital" the sound becomes (4 to 24 bits)
  - 4-6 bits: Extreme retro gaming sound
  - 8 bits: Classic vintage digital
  - 12-16 bits: Subtle lo-fi character
  - Higher values: Very gentle effect
- **TPDF Dither** - Makes the effect sound smoother
  - On: Gentler, more musical sound
  - Off: Raw, more aggressive effect
- **ZOH Frequency** - Affects the overall clarity (4000Hz to 96000Hz)
  - Lower values: More retro, less clear
  - Higher values: Clearer, more subtle effect
- **Bit Error** - Adds vintage hardware character (0.00% to 10.00%)
  - 0%: No DAC bit-weight mismatch; Random Seed has no audible effect
  - 0.1-1%: Subtle digital DAC coloration
  - 1-3%: Classic hardware imperfections
  - 3-10%: Creative lo-fi character
- **Random Seed** - Controls the unique character of imperfections (0 to 1000)
  - Changes the fixed imperfection pattern used by Bit Error
  - Audible only when Bit Error is above 0%
  - Same value always recreates the same imperfection pattern

[Back to all effects](/dsp/effects/)
