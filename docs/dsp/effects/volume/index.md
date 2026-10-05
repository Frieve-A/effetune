---
layout: dsp
title: "Volume — EffeTune DSP"
description: "Applies a precise gain in decibels."
lang: en
permalink: /dsp/effects/volume/
---
# Volume

Semantic type: `Volume` · Category: basics

Applies a precise gain in decibels.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `volume` | `volume` | number / 1 | `0` | dB | -60 … 24 |

### Gain changes and automation

The initial `volume` setting applies immediately when processing starts. Later
target changes, including scheduled events and JavaScript `setParam`, move from the current
linear gain to `10 ** (volume / 20)` over `ceil(sampleRate * 0.005)` samples
(5 ms, rounded up to whole samples). The interpolation is linear in gain, not dB.
The event sample uses the first interpolation step; the target is reached on the
last sample of that interval. A new target during a transition starts a fresh
5 ms transition from the gain already reached.

At 48 kHz, a target change at frame 128 finishes at frame 367. This smoothing
reduces abrupt gain changes but means an event does not produce an instantaneous
level switch or an arbitrary sample-by-sample gain curve. See the executable
Python and JavaScript [Volume automation examples](/dsp/concepts/streaming-and-events/#volume-automation).

## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Volume

A simple but essential control that lets you adjust how loud your music plays. Perfect for finding the right listening level for different situations.

### Listening Enhancement Guide
- Adjust for different listening scenarios:
  - Background music while working
  - Active listening sessions
  - Late night quiet listening
- Keep volume at comfortable levels to avoid:
  - Listening fatigue
  - Sound distortion
  - Potential hearing damage

### Parameters
- **Volume** - Controls the overall loudness (-60dB to +24dB)
  - Lower values: Quieter playback
  - Higher values: Louder playback
  - 0dB: Original volume level

Remember: These basic controls are the foundation of good sound. Start with these adjustments before using more complex effects!

[Back to all effects](/dsp/effects/)
