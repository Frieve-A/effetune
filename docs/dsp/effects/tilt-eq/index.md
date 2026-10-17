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

Tilts the overall frequency balance around a pivot frequency with a matched pair of shelving filters: one side of the spectrum is raised and the other lowered. Use it for broad warmer or brighter adjustments with a single control, for example when a recording or a pair of headphones sounds consistently too bright or too dull.

### Sound Enhancement Guide
- **Warmer**: Use a small negative **Slope** (for example, -1 dB/oct) to lower the treble and raise the bass, such as for bright recordings or headphones.
- **Brighter**: Use a small positive **Slope** (for example, +1 dB/oct) to raise the treble and lower the bass, such as for dull recordings or speakers.
- **Where the change starts**: Lower **Pivot Freq (Hz)** to extend the treble-side change into the midrange; raise it to confine that change to the top octaves.

### Parameters
- **Pivot Freq (Hz)** (20 Hz to ~20 kHz; default about 1 kHz) - The frequency around which the balance tilts.
- **Slope** (-12 to +12 dB/oct; default 0) - The amount and direction of the tilt. Positive values make the sound brighter, negative values warmer, and 0 leaves it unchanged.

[Back to all effects](/dsp/effects/)
