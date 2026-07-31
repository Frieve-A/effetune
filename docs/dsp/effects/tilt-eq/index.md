---
layout: dsp
title: "Tilt EQ — EffeTune DSP"
description: "Tilts the tonal balance around a configurable pivot frequency."
lang: en
permalink: /dsp/effects/tilt-eq/
---
# Tilt EQ

Semantic type: `TiltEQ` · Category: eq

Tilts the tonal balance around a configurable pivot frequency.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `pivotFrequency` | `pivot_frequency` | number / 1 | `1002.2472422902518` | Hz | 20.085536923187668 … 19930.370438230297 |
| `slope` | `slope` | number / 1 | `0` | dB/oct | -12 … 12 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Tilt EQ

A simple yet effective equalizer that gently tilts the frequency balance of your music. It's designed for subtle adjustments, making your music sound warmer or brighter without complex controls. Ideal for quickly tailoring the overall tone to your preference.

### Listening Enhancement Guide
- Make Music Warmer:
  - Use negative slope values to reduce high frequencies and increase low frequencies.
  - Perfect for bright recordings or headphones that sound too sharp.
  - Creates a cozy and relaxed listening experience.
- Make Music Brighter:
  - Use positive slope values to increase high frequencies and reduce low frequencies.
  - Ideal for dull recordings or speakers that sound muffled.
  - Adds clarity and sparkle to your music.
- Subtle Tone Adjustments:
  - Use small slope values for gentle overall tone shaping.
  - Fine-tune the balance to match your listening environment or mood.

### Parameters
- **Pivot Frequency** - Controls the center frequency of the tilt (20Hz to ~20kHz)
  - Adjust to set the frequency point around which the tilt occurs.
- **Slope** - Controls the steepness of the tilt around the Pivot Frequency (-12 dB/oct to +12 dB/oct)
  - Positive values make the sound brighter; negative values make it warmer.
  - Smaller values make gentler changes.

### Visual Display
- Simple slider for easy slope adjustment
- Real-time frequency response curve to show the tilt effect
- Clear indication of current slope value

- Quick reset button

[Back to all effects](/dsp/effects/)
