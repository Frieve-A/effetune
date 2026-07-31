---
layout: dsp
title: "5Band PEQ — EffeTune DSP"
description: "Provides five configurable parametric equalizer bands."
lang: en
permalink: /dsp/effects/five-band-peq/
---
# 5Band PEQ

Semantic type: `FiveBandPEQ` · Category: eq

Provides five configurable parametric equalizer bands.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `frequencies` | `frequencies` | number / 5 | `[100,316,1000,3160,10000]` | Hz | 20 … 20000 |
| `gains` | `gains` | number / 5 | `[0,0,0,0,0]` | dB | -20 … 20 |
| `qValues` | `q_values` | number / 5 | `[1,1,1,1,1]` | Not declared in catalog | 0.1 … 10 |
| `filterTypes` | `filter_types` | string / 5 | `["peaking","peaking","peaking","peaking","peaking"]` | Not declared in catalog | `peaking`, `lowPass`, `highPass`, `lowShelf`, `highShelf`, `bandPass`, `notch`, `allPass` |
| `enabledBands` | `enabled_bands` | boolean / 5 | `[true,true,true,true,true]` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## 5Band PEQ

A flexible 5-band equalizer for shaping music playback. Use it when bass feels boomy, vocals sound harsh, or the highs need a little more sparkle without opening the more detailed 15-band version.

### Sound Enhancement Guide
- Vocal and Instrument Clarity:
  - Use the 3.16kHz band with moderate Q (1.0-2.0) for natural presence
  - Apply narrow Q (4.0-8.0) cuts only when a specific resonance is bothering you
  - Add gentle air with the 10kHz high shelf (+2 to +4dB)
- Bass Quality Control:
  - Shape bass fullness with the 100Hz peaking filter
  - Use a narrow cut if one bass note or room boom stands out too much
  - Create smooth bass extension with low shelf
- Everyday Sound Tuning:
  - Use broad, small adjustments for natural tone changes
  - Reduce harshness, boominess, or dullness by ear
  - Compare with bypass often so the music still sounds balanced

### Parameters
- **Five Adjustable Bands**
  - Band 1: 100Hz (Sub & Bass Control)
  - Band 2: 316Hz (Lower Midrange Definition)
  - Band 3: 1.0kHz (Midrange Presence)
  - Band 4: 3.2kHz (Upper Midrange Detail)
  - Band 5: 10kHz (High Frequency Extension)
- **Controls Per Band**
  - Center Frequency: Adjustable from 20Hz to 20kHz
  - Gain Range: ±20dB for Peaking and Low/High Shelf filters
  - Q Factor: 0.1-10.0 for most filter types; Low/High Shelf is limited to 0.1-2.0
  - Higher Q affects a narrower range; lower Q sounds smoother and broader
  - For Low/High Pass, Band Pass, Notch, and AllPass, Frequency and Q shape the filter; Gain is not used
  - Multiple Filter Types:
    - Peaking: Symmetrical frequency adjustment
    - Low/High Pass: 12dB/octave slope
    - Low/High Shelf: Gentle spectral shaping
    - Band Pass: Focused frequency isolation
    - Notch: Precise frequency removal
    - AllPass: Phase-focused frequency alignment

### Visual Display
- High-resolution frequency response visualization
- Interactive control points with precise parameter display
- Real-time curve updates as you adjust settings
- Frequency and gain grid
- Accurate numerical readouts for all parameters

[Back to all effects](/dsp/effects/)
