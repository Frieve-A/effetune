---
layout: dsp
title: "Harmonic Distortion — EffeTune DSP"
description: "Adds configurable harmonic components derived from the input."
lang: en
permalink: /dsp/effects/harmonic-distortion/
---
# Harmonic Distortion

Semantic type: `HarmonicDistortion` · Category: saturation

Adds configurable harmonic components derived from the input.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `secondHarmonic` | `second_harmonic` | number / 1 | `2` | % | -30 … 30 |
| `thirdHarmonic` | `third_harmonic` | number / 1 | `3` | % | -30 … 30 |
| `fourthHarmonic` | `fourth_harmonic` | number / 1 | `0.5` | % | -30 … 30 |
| `fifthHarmonic` | `fifth_harmonic` | number / 1 | `0.3` | % | -30 … 30 |
| `sensitivity` | `sensitivity` | number / 1 | `0.5` | Not declared in catalog | 0.1 … 2 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Harmonic Distortion

The Harmonic Distortion plugin shapes the waveform with adjustable 2nd- to 5th-order nonlinear terms. It lets you tune even- and odd-order distortion character from subtle warmth to stronger coloration, which can help music that sounds too clean, thin, or flat feel more vivid.

### Listening Enhancement Guide
- **Subtle Effect:**
  - Adds a gentle layer of harmonic warmth
  - Enhances the natural tone without overwhelming the original signal
  - Ideal for adding analog-like subtle depth
- **Moderate Effect:**
  - Adds a more pronounced harmonic character
  - Can add body, brightness, or edge to the whole recording
  - Useful when the sound feels too flat or restrained
- **Aggressive Effect:**
  - Intensifies several nonlinear terms for a rich, complex distortion
  - Creates bold textures for experimental listening
  - Can sound edgy or unconventional when pushed hard
- **Positive vs. Negative Values:**
  - Positive and negative values flip the direction of each nonlinear term
  - Even-order terms mainly change asymmetry and tonal color
  - Odd-order terms mainly change the symmetric distortion character

### Parameters
- **2nd Harm (%):** Sets the second-order distortion term (-30 to 30%, default: 2%)
- **3rd Harm (%):** Sets the third-order distortion term (-30 to 30%, default: 3%)
- **4th Harm (%):** Sets the fourth-order distortion term (-30 to 30%, default: 0.5%)
- **5th Harm (%):** Sets the fifth-order distortion term (-30 to 30%, default: 0.3%)
- **Sensitivity (x):** Adjusts the overall input sensitivity (0.1-2.0, default: 0.5)
  - Lower sensitivity provides a more understated effect
  - Higher sensitivity increases the distortion intensity
  - Works as a global control affecting the intensity of the nonlinear shaping

### Visual Display
- Transfer curve showing how input levels are shaped into output levels
- Intuitive sliders and input fields that provide immediate feedback
- The graph updates as harmonic and sensitivity settings change

### Quick Start Guide
1. **Initialization:** Start with default settings (2nd: 2%, 3rd: 3%, 4th: 0.5%, 5th: 0.3%, Sensitivity: 0.5)
2. **Adjust Parameters:** Change one or two harmonic controls at a time while listening for harshness or loss of clarity
3. **Blend Your Sound:** Balance the effect using Sensitivity to achieve either a subtle warmth or a pronounced distortion

[Back to all effects](/dsp/effects/)
