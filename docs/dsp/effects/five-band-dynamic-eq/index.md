---
layout: dsp
title: "5Band Dynamic EQ — EffeTune DSP"
description: "Applies level-dependent equalization in five configurable bands."
lang: en
permalink: /dsp/effects/five-band-dynamic-eq/
---
# 5Band Dynamic EQ

Semantic type: `FiveBandDynamicEQ` · Category: eq

Applies level-dependent equalization in five configurable bands.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `enabledBands` | `enabled_bands` | boolean / 5 | `[false,false,true,false,false]` | Not declared in catalog | Not declared in catalog |
| `filterType` | `filter_type` | string / 5 | `["pk","pk","pk","pk","pk"]` | Not declared in catalog | `pk`, `ls`, `hs` |
| `frequency` | `frequency` | number / 5 | `[100,300,1000,3000,10000]` | Hz | 20 … 20000 |
| `q` | `q` | number / 5 | `[1,1,1,1,1]` | Not declared in catalog | 0.1 … 10 |
| `maxGain` | `max_gain` | number / 5 | `[6,6,6,6,6]` | dB | 0 … 24 |
| `threshold` | `threshold` | number / 5 | `[-18,-21,-24,-27,-30]` | dB | -60 … 0 |
| `ratio` | `ratio` | number / 5 | `[2,2,2,2,2]` | Not declared in catalog | 0.1 … 100 |
| `knee` | `knee` | number / 5 | `[3,3,3,3,3]` | dB | 0 … 10 |
| `attack` | `attack` | number / 5 | `[10,10,10,10,10]` | ms | 0.1 … 100 |
| `release` | `release` | number / 5 | `[100,100,100,100,100]` | ms | 1 … 1000 |
| `sidechainFrequency` | `sidechain_frequency` | number / 5 | `[100,300,1000,3000,10000]` | Hz | 20 … 20000 |
| `sidechainQ` | `sidechain_q` | number / 5 | `[1,1,1,1,1]` | Not declared in catalog | 0.1 … 10 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## 5Band Dynamic EQ

A smart equalizer that automatically adjusts frequency bands based on the content of your music. It combines precise equalization with dynamic processing that responds to changes in your music in real-time, creating an enhanced listening experience without constant manual adjustments.

### Listening Enhancement Guide
- Tame Harsh Vocals:
  - Use peak filter at 3000Hz with higher ratio (4.0-10.0)
  - Set moderate threshold (-24dB) and fast attack (10ms)
  - Automatically reduces harshness only when vocals get too aggressive
- Enhance Clarity and Brilliance:
  - Use Band 5 with Filter Type: Highshelf, Frequency: around 10000Hz, SC Freq: around 1200Hz, Ratio: 0.5, Attack: 1ms
  - Mids trigger high frequencies for natural-sounding clarity
  - Adds sparkle to music without permanent brightness
- Control Excessive Bass:
  - Use lowshelf filter at 100Hz with moderate ratio (2.0-4.0)
  - Keep bass impact while preventing speaker distortion
  - Perfect for bass-heavy music on smaller speakers
- Adaptive Sound Tailoring:
  - Lets music dynamics control the sound balance
  - Automatically adjusts to different songs and recordings
  - Maintains consistent sound quality across your playlist

### Parameters
- **Five Band Controls** - Each with independent settings
  - Band 1: 100Hz (Bass Region)
  - Band 2: 300Hz (Lower Midrange)
  - Band 3: 1000Hz (Midrange)
  - Band 4: 3000Hz (Upper Midrange)
  - Band 5: 10000Hz (High Frequencies)
- **Band Settings**
  - Filter Type: Choose between Peak, Lowshelf, or Highshelf
  - Frequency: Fine-tune center/corner frequency (20Hz-20kHz)
  - Q: Control bandwidth/sharpness (0.1-10.0)
  - Max Gain: Set maximum gain adjustment (0-24dB)
  - Threshold: Set level when processing begins (-60dB to 0dB)
  - Ratio: Control processing intensity (0.1-100.0)
    - Below 1.0: Expander (enhances when signal exceeds threshold)
    - Above 1.0: Compressor (reduces when signal exceeds threshold)
  - Knee Width: Smooth transition around threshold (0-10dB)
  - Attack: How quickly processing begins (0.1-100ms)
  - Release: How quickly processing ends (1-1000ms)
  - Sidechain Frequency: Detection frequency (20Hz-20kHz)
  - Sidechain Q: Detection bandwidth (0.1-10.0)

### Visual Display
- Real-time frequency response graph
- Dynamic response curve showing the current boosts and cuts
- Interactive frequency and gain controls

[Back to all effects](/dsp/effects/)
