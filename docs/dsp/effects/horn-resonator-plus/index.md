---
layout: dsp
title: "Horn Resonator Plus — EffeTune DSP"
description: "Applies an extended multi-mode horn-like resonant response."
lang: en
permalink: /dsp/effects/horn-resonator-plus/
---
# Horn Resonator Plus

Semantic type: `HornResonatorPlus` · Category: resonator

Applies an extended multi-mode horn-like resonant response.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `crossover` | `crossover` | number / 1 | `600` | Hz | 20 … 5000 |
| `length` | `length` | number / 1 | `70` | cm | 20 … 120 |
| `throatDiameter` | `throat_diameter` | number / 1 | `3` | cm | 0.5 … 50 |
| `mouthDiameter` | `mouth_diameter` | number / 1 | `60` | cm | 5 … 200 |
| `curve` | `curve` | number / 1 | `40` | % | -100 … 100 |
| `damping` | `damping` | number / 1 | `0.03` | dB/m | 0 … 10 |
| `throatReflection` | `throat_reflection` | number / 1 | `0.99` | Not declared in catalog | 0 … 0.99 |
| `waveguideGain` | `waveguide_gain` | number / 1 | `26` | dB | -36 … 36 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Horn Resonator Plus

Horn Resonator Plus adds a smoother, more natural horn-speaker character to music. Use it when you want vocals, brass, acoustic instruments, or full mixes to feel warmer and more lively, while keeping the resonance less sharp than the standard Horn Resonator.

It is based on the same horn model as [Horn Resonator](/dsp/effects/horn-resonator/), with a more detailed mouth and throat reflection model so resonances decay more smoothly.

### Listening Guide

- Smoother horn color: adds horn-loaded speaker character with less sharp ringing.
- Warmer presence: can make vocals, brass, and acoustic music feel more lively.
- Natural high-frequency behavior: the upper range is closer to an acoustic horn or horn-loaded speaker than the standard version.

### System Presets

Click **Effect Presets** in the effect header to start with the same three complete horn characters, rendered by the smoother Plus model.

- **Gramophone** - A strongly flared horn with an old acoustic-record-player color.
- **Vintage Theater** - A large, low-reaching theater-horn response.
- **Megaphone** - A short conical horn with a direct, emphatic midrange.

### Technical Enhancements

- **2nd-order mouth reflection filter**: Smoother modeling of frequency-dependent reflection at the mouth opening.
- **Frequency-dependent throat reflection**: Throat reflection changes with frequency for more natural horn behavior.

### Parameters and Usage

Horn Resonator Plus uses the same parameters as [Horn Resonator](/dsp/effects/horn-resonator/). Please refer to the Horn Resonator section for parameter descriptions, settings, and recommended values.

### Usage Guidelines

- **Horn Resonator**: Choose when you want lighter processing with basic horn character.
- **Horn Resonator Plus**: Choose when you want smoother, more natural horn coloration and can accept slightly higher CPU use.

### Quick Start Guide

Use the same controls as the [Horn Resonator](/dsp/effects/horn-resonator/). Choose Horn Resonator Plus when you want a smoother horn-speaker character.

[Back to all effects](/dsp/effects/)
