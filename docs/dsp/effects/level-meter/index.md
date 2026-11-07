---
layout: dsp
title: "Level Meter — EffeTune DSP"
description: "Passes audio through while exposing per-channel peak level, RMS level, and clipping."
lang: en
permalink: /dsp/effects/level-meter/
---
# Level Meter

Semantic type: `LevelMeter` · Category: analyzer

Passes audio through while exposing per-channel peak level, RMS level, and clipping.

Use the opt-in decoded telemetry callback or subscription API to observe this effect. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **decoded semantic observations are available**

This effect has no semantic parameters.



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## Level Meter

A visual display that shows your music's digital signal level in real time. It helps you check levels after applying effects and spot possible clipping before it becomes audible distortion.

### Visualization Guide
- The horizontal bar extends farther to the right as the signal level gets louder
- The white marker holds a new peak for one second, then falls smoothly
- OVERLOAD means the signal exceeded the safe digital range and may distort
- For clean playback, avoid frequent red levels or OVERLOAD warnings; set your actual listening volume on your device

[Back to all effects](/dsp/effects/)
