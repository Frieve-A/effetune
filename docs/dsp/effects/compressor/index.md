---
layout: dsp
title: "Compressor — EffeTune DSP"
description: "Reduces dynamic range above a configurable threshold."
lang: en
permalink: /dsp/effects/compressor/
---
# Compressor

Semantic type: `Compressor` · Category: dynamics

Reduces dynamic range above a configurable threshold.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `threshold` | `threshold` | number / 1 | `-24` | dB | -60 … 0 |
| `ratio` | `ratio` | number / 1 | `2` | Not declared in catalog | 0.5 … 20 |
| `attack` | `attack` | number / 1 | `10` | ms | 0.1 … 100 |
| `release` | `release` | number / 1 | `100` | ms | 10 … 1000 |
| `knee` | `knee` | number / 1 | `3` | dB | 0 … 12 |
| `gain` | `gain` | number / 1 | `0` | dB | -12 … 12 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Compressor

An effect that smooths out volume differences by gently reducing loud peaks. Use it when sudden loud passages feel jarring, or when you want a more even and comfortable listening level. After compression, raise Gain if you want the overall sound, including quieter details, to feel louder.

### Listening Enhancement Guide
- Classical Music:
  - Makes dramatic orchestral crescendos more comfortable to listen to
  - Balances the difference between soft and loud piano passages
  - Helps hear quiet details even in powerful sections
- Pop/Rock Music:
  - Creates a more comfortable listening experience during intense sections
  - Makes vocals clearer and easier to understand
  - Reduces listening fatigue during long sessions
- Jazz Music:
  - Balances the volume between different instruments
  - Makes solo sections blend more naturally with the ensemble
  - Maintains clarity during both quiet and loud passages

### Parameters

- **Threshold** - Sets the volume level where the effect begins working (-60dB to 0dB)
  - Higher settings: Only affects the loudest parts of the music
  - Lower settings: Creates more overall balance
  - Start at -24dB for gentle balancing
- **Ratio** - Controls how strongly the effect balances the volume (1:0.5 to 1:20)
  - 1:0.5: Upward expansion (boosts loud sounds)
  - 1:1: No effect (original sound)
  - 1:2: Gentle compression
  - 1:4: Moderate compression
  - 1:8+: Strong volume control
- **Attack Time** - How quickly the effect responds to loud sounds (0.1ms to 100ms)
  - Faster times: More immediate volume control
  - Slower times: More natural sound
  - Try 20ms as a starting point
- **Release Time** - How quickly the volume returns to normal (10ms to 1000ms)
  - Faster times: More dynamic sound
  - Slower times: Smoother, more natural transitions
  - Start with 200ms for general listening
- **Knee** - How smoothly the effect transitions (0dB to 12dB)
  - Lower values: More precise control
  - Higher values: Gentler, more natural sound
  - 6dB is a good starting point
- **Gain** - Adjusts the overall volume after processing (-12dB to +12dB)
  - Use this to match the volume with the original sound
  - Increase if the music feels too quiet
  - Decrease if it's too loud

### Visual Display

- Interactive graph showing how the effect is working
- Easy-to-read volume level indicators
- Visual feedback for all parameter adjustments
- Reference lines to help guide your settings

### Recommended Settings for Different Listening Scenarios
- Casual Background Listening:
  - Threshold: -24dB
  - Ratio: 1:2
  - Attack: 20ms
  - Release: 200ms
  - Knee: 6dB
  - Gain: +2dB
- Critical Listening Sessions:
  - Threshold: -18dB
  - Ratio: 1:1.5
  - Attack: 30ms
  - Release: 300ms
  - Knee: 3dB
  - Gain: +1dB
- Late Night Listening:
  - Threshold: -30dB
  - Ratio: 1:4
  - Attack: 10ms
  - Release: 150ms
  - Knee: 9dB
  - Gain: +3dB
- Loud Sound Enhancement:
  - Threshold: -12dB
  - Ratio: 1:0.5
  - Attack: 50ms
  - Release: 400ms
  - Knee: 6dB
  - Gain: 0dB

[Back to all effects](/dsp/effects/)
