---
layout: dsp
title: "15Band PEQ — EffeTune DSP"
description: "Provides fifteen configurable parametric equalizer bands."
lang: en
permalink: /dsp/effects/fifteen-band-peq/
---
# 15Band PEQ

Semantic type: `FifteenBandPEQ` · Category: eq

Provides fifteen configurable parametric equalizer bands.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `frequencies` | `frequencies` | number / 15 | `[25,40,63,100,160,250,400,630,1000,1600,2500,4000,6300,10000,16000]` | Hz | 20 … 20000 |
| `gains` | `gains` | number / 15 | `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]` | dB | -20 … 20 |
| `qValues` | `q_values` | number / 15 | `[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]` | Not declared in catalog | 0.1 … 10 |
| `filterTypes` | `filter_types` | string / 15 | `["peaking","peaking","peaking","peaking","peaking","peaking","peaking","peaking","peaking","peaking","peaking","peaking","peaking","peaking","peaking"]` | Not declared in catalog | `peaking`, `lowPass`, `highPass`, `lowShelf`, `highShelf`, `bandPass`, `notch`, `allPass` |
| `enabledBands` | `enabled_bands` | boolean / 15 | `[true,true,true,true,true,true,true,true,true,true,true,true,true,true,true]` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## 15Band PEQ

A 15-band parametric equalizer for fine-tuning bass, vocals, presence, and treble while listening. Use it when you want more detailed control than a graphic EQ, from small tone changes to narrowing down a specific annoying frequency.

### Sound Enhancement Guide
- Vocal and Instrument Clarity:
  - Set one band to around 3.2kHz with moderate Q (1.0-2.0) for natural presence
  - Apply narrow Q (4.0-8.0) cuts only when a specific resonance is bothering you
  - Add gentle air with a 10kHz high shelf (+2 to +4dB)
- Bass Quality Control:
  - Shape bass fullness with a 100Hz peaking filter
  - Use a narrow cut if one bass note or room boom stands out too much
  - Create smooth bass extension with a low shelf
- Fine Listening Adjustments:
  - Use small, broad boosts or cuts for natural results
  - Use narrow settings for targeted problems rather than overall tone
  - Compare with bypass often so the music still sounds balanced

### Parameters
- **Configurable Bands**
  - 15 fully configurable frequency bands
  - Initial frequency settings:
    - 25Hz, 40Hz, 63Hz, 100Hz, 160Hz (Deep Bass)
    - 250Hz, 400Hz, 630Hz (Lower Sound)
    - 1kHz, 1.6kHz, 2.5kHz (Middle Sound)
    - 4kHz, 6.3kHz, 10kHz, 16kHz (High Sound)
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
- **Preset Management**
  - Import: Load Equalizer APO-style TXT filter lines
  - Up to 15 `ON` PK/LS/LSC/HS/HSC filters are imported; `Preamp` lines and unsupported filter types are ignored
    - Example format:
      ```
      Filter 1: ON PK Fc 50 Hz Gain -3.0 dB Q 2.00
      Filter 2: ON HS Fc 12000 Hz Gain 4.0 dB Q 0.70
      ...
      ```

### Visual Display
- High-resolution frequency response visualization
- Interactive control points with precise parameter display
- Real-time curve updates as you adjust settings
- Frequency and gain grid
- Accurate numerical readouts for all parameters

[Back to all effects](/dsp/effects/)
