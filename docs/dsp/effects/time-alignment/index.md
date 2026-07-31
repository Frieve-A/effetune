---
layout: dsp
title: "Time Alignment — EffeTune DSP"
description: "Delays selected channels to align arrival times."
lang: en
permalink: /dsp/effects/time-alignment/
---
# Time Alignment

Semantic type: `TimeAlignment` · Category: delay

Delays selected channels to align arrival times.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `delay` | `delay` | number / 1 | `0` | ms | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Time Alignment

Adjusts playback timing by a small amount, useful when you want to compensate for speaker distance differences or tune how the sound arrives at your listening position.

### When to Use
- Compensating for small distance differences between speakers and your listening position
- Fine-tuning the timing of channels routed through this plugin
- Checking whether a small delay makes the stereo image feel more stable or natural

### Parameters
- **Delay** - Controls the delay time applied to the channels routed through this plugin (0 to 100 ms)
  - 0 ms: No delay
  - Small values: Useful for compensating tiny arrival-time differences between speakers
  - Higher values: Creates a more noticeable timing shift

### Recommended Uses

1. Speaker Distance Compensation
   - Add a small delay when one speaker or channel arrives earlier at the listening position
   - Adjust in small steps while listening to centered vocals or other focused sounds

2. Listening Position Fine-Tuning
   - Try very small values first
   - Stop when the center image feels stable and the sound remains natural

Remember: The goal is to enhance your listening enjoyment. Experiment with the controls to find sounds that add interest and depth to your favorite music without overpowering it.

[Back to all effects](/dsp/effects/)
