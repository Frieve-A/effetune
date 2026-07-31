---
layout: dsp
title: "Gate — EffeTune DSP"
description: "Attenuates signals below a configurable threshold."
lang: en
permalink: /dsp/effects/gate/
---
# Gate

Semantic type: `Gate` · Category: dynamics

Attenuates signals below a configurable threshold.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `threshold` | `threshold` | number / 1 | `-40` | dB | -96 … 0 |
| `ratio` | `ratio` | number / 1 | `10` | Not declared in catalog | 1 … 100 |
| `attack` | `attack` | number / 1 | `1` | ms | 0.01 … 50 |
| `release` | `release` | number / 1 | `200` | ms | 10 … 2000 |
| `knee` | `knee` | number / 1 | `1` | dB | 0 … 6 |
| `gain` | `gain` | number / 1 | `0` | dB | -12 … 12 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Gate

A full-band noise gate that turns down the whole signal when the level falls below a specified threshold. It is useful for lowering low-level noise during gaps, fades, or between spoken phrases. It does not separate and remove fan noise, hum, or room noise while music or speech is playing over it.

### Key Features
- Precise threshold control for accurate noise detection
- Adjustable ratio for natural or aggressive noise reduction
- Variable attack and release times for optimal timing control
- Soft knee option for smooth transitions
- Real-time gain reduction metering
- Interactive transfer function display

### Parameters

- **Threshold** (-96dB to 0dB)
  - Sets the level where noise reduction begins
  - Signals below this level will be attenuated
  - Higher values: More aggressive noise reduction
  - Lower values: More subtle effect
  - Start at -40dB and adjust based on your noise floor

- **Ratio** (1:1 to 100:1)
  - Controls how strongly signals below threshold are attenuated
  - 1:1: No effect
  - 10:1: Strong noise reduction
  - 100:1: Near-complete silence below threshold
  - Start at 10:1 for typical noise reduction

- **Attack Time** (0.01ms to 50ms)
  - How quickly the gate responds when signal rises above threshold
  - Faster times: More precise but may sound abrupt
  - Slower times: More natural transitions
  - Try 1ms as a starting point

- **Release Time** (10ms to 2000ms)
  - How quickly the gate closes when signal falls below threshold
  - Faster times: Tighter noise control
  - Slower times: More natural decay
  - Start with 200ms for natural sound

- **Knee** (0dB to 6dB)
  - Controls how gradually the gate transitions around threshold
  - 0dB: Hard knee for precise gating
  - 6dB: Soft knee for smoother transitions
  - Use 1dB for general purpose noise reduction

- **Gain** (-12dB to +12dB)
  - Adjusts the output level after gating
  - Use to compensate for any perceived volume loss
  - Typically left at 0dB unless needed

### Visual Feedback
- Interactive transfer function graph showing:
  - Input/output relationship
  - Threshold point
  - Knee curve
  - Ratio slope
- Real-time gain reduction meter displaying:
  - Current amount of noise reduction
  - Visual feedback of gate activity

### Recommended Settings

#### Light Noise Reduction
- Threshold: -50dB
- Ratio: 2:1
- Attack: 5ms
- Release: 300ms
- Knee: 3dB
- Gain: 0dB

#### Moderate Background Noise
- Threshold: -40dB
- Ratio: 10:1
- Attack: 1ms
- Release: 200ms
- Knee: 1dB
- Gain: 0dB

#### Very Aggressive Gating
- Use only when you want near-silence in gaps, such as spoken recordings or very noisy pauses
- Threshold: -30dB
- Ratio: 50:1
- Attack: 0.1ms
- Release: 100ms
- Knee: 0dB
- Gain: 0dB

### Application Tips
- Set threshold just above the noise floor for optimal results
- Use longer release times for more natural sound
- Add some knee when processing complex material
- Monitor the gain reduction meter to ensure proper gating
- For music, avoid very high thresholds or ratios unless you intentionally want to cut off quiet tails
- Combine with other dynamics processors for comprehensive control

[Back to all effects](/dsp/effects/)
