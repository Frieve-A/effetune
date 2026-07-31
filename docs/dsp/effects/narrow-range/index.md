---
layout: dsp
title: "Narrow Range — EffeTune DSP"
description: "Restricts audio to a configurable frequency range."
lang: en
permalink: /dsp/effects/narrow-range/
---
# Narrow Range

Semantic type: `NarrowRange` · Category: eq

Restricts audio to a configurable frequency range.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `highPassFrequency` | `high_pass_frequency` | number / 1 | `60` | Hz | 20 … 4000 |
| `highPassSlope` | `high_pass_slope` | integer / 1 | `-24` | dB/oct | -48 … 0 |
| `lowPassFrequency` | `low_pass_frequency` | number / 1 | `5000` | Hz | 200 … 40000 |
| `lowPassSlope` | `low_pass_slope` | integer / 1 | `-12` | dB/oct | -48 … 0 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Narrow Range

A tool that lets you focus on specific parts of the music by filtering out unwanted frequencies. Useful for creating special sound effects or removing unwanted sounds.

### Listening Enhancement Guide
- Create unique sound effects:
  - "Telephone voice" effect
  - "Old radio" sound
  - "Underwater" effect
- Focus on a frequency range:
  - Make bass-heavy parts easier to hear
  - Focus on vocal range
  - Narrow the sound to the range where vocals or instruments are most noticeable
- Remove unwanted sounds:
  - Reduce low-frequency rumble
  - Cut excessive high-frequency hiss
  - Focus on the range you want to hear most clearly

### Parameters
- **HPF Frequency** - Controls where low sounds start being reduced (20Hz to 4000Hz)
  - Higher values: Removes more bass
  - Lower values: Keeps more bass
  - Start with low values and adjust to taste
- **HPF Slope** - How quickly low sounds are reduced (0 to -48 dB/octave)
  - 0dB: No reduction (off)
  - -6dB to -48dB: Increasingly stronger reduction in 6dB steps
- **LPF Frequency** - Controls where high sounds start being reduced (200Hz to 40000Hz)
  - Lower values: Removes more highs
  - Higher values: Keeps more highs
  - Start high and adjust down as needed
- **LPF Slope** - How quickly high sounds are reduced (0 to -48 dB/octave)
  - 0dB: No reduction (off)
  - -6dB to -48dB: Increasingly stronger reduction in 6dB steps

### Visual Display
- Clear graph showing frequency response
- Easy-to-adjust frequency controls
- Simple slope drop-down menus

[Back to all effects](/dsp/effects/)
