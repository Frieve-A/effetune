---
layout: dsp
title: "Level Meter — EffeTune DSP"
description: "Passes audio through while the host-side EffeTune app can display peak and RMS levels."
lang: en
permalink: /dsp/effects/level-meter/
---
# Level Meter

Semantic type: `LevelMeter` · Category: analyzer

Passes audio through while the host-side EffeTune app can display peak and RMS levels.

Use the opt-in decoded telemetry callback or subscription API to observe this analyzer. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Analyzer telemetry: **decoded semantic observations are available in v0.1**

This effect has no semantic parameters.



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Level Meter

A visual display that shows your music's digital signal level in real time. It helps you check levels after applying effects and spot possible clipping before it becomes audible distortion.

### Visualization Guide
- The horizontal bar extends farther to the right as the signal level gets louder
- White marker shows the highest recent level for a short time
- OVERLOAD means the signal exceeded the safe digital range and may distort
- For clean playback, avoid frequent red levels or OVERLOAD warnings; set your actual listening volume on your device

[Back to all effects](/dsp/effects/)
