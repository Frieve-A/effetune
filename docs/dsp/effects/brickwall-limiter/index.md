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

A high-quality peak limiter that ensures your music never exceeds a specified level, preventing digital clipping while maintaining natural sound quality. Perfect for protecting your audio system and ensuring comfortable listening levels without compromising the music's dynamics.

### Listening Enhancement Guide
- Classical Music:
  - Safely enjoy full orchestral crescendos
  - Maintain the natural dynamics of piano pieces
  - Protect against unexpected peaks in live recordings
- Pop/Rock Music:
  - Keep consistent volume during intense passages
  - Enjoy dynamic music at any listening level
  - Prevent distortion in bass-heavy sections
- Electronic Music:
  - Control synthesizer peaks transparently
  - Maintain impact while preventing overload
  - Keep bass drops powerful but controlled

### Parameters

- **Input Gain** (-18dB to +18dB)
  - Adjusts the level going into the limiter
  - Increase to make peaks hit the limiter more often
  - Decrease if you hear too much limiting
  - Default is 0dB

- **Threshold** (-24dB to 0dB)
  - Sets the peak level where limiting begins before Margin is applied
  - The effective ceiling is Threshold + Margin
  - Lower values provide more safety margin
  - Higher values preserve more dynamics
  - Start at -3dB for gentle protection

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
  - Adds a fine safety offset to the Threshold
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
- Limiter gain-reduction information is reported internally for host or status metering
- The plugin panel does not show a separate peak-level graph

### Recommended Settings

#### Transparent Protection
- Input Gain: 0dB
- Threshold: -3dB
- Release: 100ms
- Lookahead: 3ms
- Margin: -1.000dB
- Oversampling: 4x
- Effective ceiling: about -4dB

#### Maximum Safety
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
