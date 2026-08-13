---
layout: dsp
title: "Brickwall Limiter — EffeTune DSP"
description: "Restricts peaks to a configured ceiling with look-ahead limiting."
lang: en
permalink: /dsp/effects/brickwall-limiter/
---
# Brickwall Limiter

Semantic type: `BrickwallLimiter` · Category: dynamics

Restricts peaks to a configured ceiling with look-ahead limiting.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **dynamic**; depends on lookahead, oversampling, sampleRate
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `threshold` | `threshold` | number / 1 | `0` | dB | -24 … 0 |
| `release` | `release` | number / 1 | `100` | ms | 10 … 500 |
| `lookahead` | `lookahead` | number / 1 | `3` | ms | 0 … 10 |
| `oversampling` | `oversampling` | integer / 1 | `1` | Not declared in catalog | `1`, `2`, `4`, `8` |
| `inputGain` | `input_gain` | number / 1 | `0` | dB | -18 … 18 |
| `margin` | `margin` | number / 1 | `-1` | dB | -3 … 0 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Brickwall Limiter

A peak limiter that keeps the chain's digital signal below a specified ceiling while preserving as much of the music's dynamics as possible. Place it near the end of the effect chain when earlier effects create high peaks. It limits signal peaks, but does not guarantee safe listening levels or protect playback equipment; set the listening volume on your playback device.

### Listening Enhancement Guide

- Put the limiter near the end of the chain, before **Level Meter**, to catch peaks created by EQ, saturation, or other effects.
- Start with Input Gain at 0 dB, Threshold at -3 dB, Margin at -1 dB, and Release at 100 ms.
- If limiting is frequent or the music loses impact, lower Input Gain or raise Threshold toward 0 dB.
- If you hear pumping, lengthen Release. If transients sound smeared or distorted, try a shorter Release or reduce the amount of limiting.
- Use **Level Meter** after the limiter to confirm the resulting digital peak level. Adjust your amplifier or playback device separately for listening volume.

### Parameters

- **Input Gain** (-18dB to +18dB)
  - Adjusts the level going into the limiter
  - Increase to make peaks hit the limiter more often
  - Decrease if you hear too much limiting
  - Default is 0dB

- **Threshold** (-24dB to 0dB)
  - Sets the peak level where limiting begins before Margin is applied
  - The effective ceiling is Threshold + Margin
  - Lower values leave more peak headroom
  - Higher values preserve more dynamics
  - Start at -3dB for light peak limiting

- **Release Time** (10ms to 500ms)
  - How quickly limiting is released
  - Faster times maintain more dynamics
  - Slower times for smoother sound
  - Try 100ms as a starting point

- **Lookahead** (0ms to 10ms)
  - Allows the limiter to anticipate peaks
  - Higher values for more transparent limiting
  - Lower values for less latency
  - 3ms is a good balance

- **Margin** (-1.000dB to 0.000dB)
  - Adds a fine downward offset to the Threshold
  - The actual ceiling is Threshold + Margin
  - For example, Threshold -3dB with Margin -1.000dB limits around -4dB
  - Default -1.000dB works well for most material
  - Adjust for precise peak control

- **Oversampling** (1x, 2x, 4x, 8x)
  - Higher values for cleaner limiting
  - Lower values for less CPU usage
  - 4x is a good balance of quality and performance

### Controls and Metering
- Direct controls for Input Gain, Threshold, Margin, Release, Lookahead, and Oversampling
- The plugin panel does not show a separate peak-level graph

### Recommended Settings

#### Transparent Peak Control
- Input Gain: 0dB
- Threshold: -3dB
- Release: 100ms
- Lookahead: 3ms
- Margin: -1.000dB
- Oversampling: 4x
- Effective ceiling: about -4dB

#### Extra Peak Headroom
- Input Gain: -6dB
- Threshold: -6dB
- Release: 50ms
- Lookahead: 5ms
- Margin: -1.000dB
- Oversampling: 8x
- Effective ceiling: about -7dB

#### Natural Dynamics
- Input Gain: 0dB
- Threshold: -1.5dB
- Release: 200ms
- Lookahead: 2ms
- Margin: -0.500dB
- Oversampling: 4x
- Effective ceiling: about -2dB

[Back to all effects](/dsp/effects/)
