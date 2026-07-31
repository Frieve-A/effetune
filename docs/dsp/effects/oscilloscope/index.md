---
layout: dsp
title: "Oscilloscope — EffeTune DSP"
description: "Passes audio through while the host-side EffeTune app can display its waveform."
lang: en
permalink: /dsp/effects/oscilloscope/
---
# Oscilloscope

Semantic type: `Oscilloscope` · Category: analyzer

Passes audio through while the host-side EffeTune app can display its waveform.

Use the opt-in decoded telemetry callback or subscription API to observe this analyzer. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Analyzer telemetry: **decoded semantic observations are available in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `displayTime` | `display_time` | number / 1 | `0.01` | s | 0.001 … 0.1 |
| `triggerMode` | `trigger_mode` | string / 1 | `"Auto"` | Not declared in catalog | `Auto`, `Normal` |
| `triggerLevel` | `trigger_level` | number / 1 | `0` | Not declared in catalog | -1 … 1 |
| `triggerEdge` | `trigger_edge` | string / 1 | `"Rising"` | Not declared in catalog | `Rising`, `Falling` |
| `holdoff` | `holdoff` | number / 1 | `0.0001` | s | 0.0001 … 0.01 |
| `displayLevel` | `display_level` | number / 1 | `0` | dB | -96 … 0 |
| `verticalOffset` | `vertical_offset` | number / 1 | `0` | Not declared in catalog | -1 … 1 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Oscilloscope

Shows the shape of the sound wave in real time, so you can see beats, sharp hits, and changes in loudness while listening. Trigger settings can steady the display when the waveform repeats.

### Visualization Guide
- Horizontal axis shows time (milliseconds)
- Vertical axis shows normalized amplitude; the visible range changes with Display Level and Vertical Offset
- Green line traces the actual waveform
- Grid lines help measure time and amplitude values
- Trigger settings determine where the waveform capture begins; no separate marker is shown

### Parameters
- **Display Time** - How much time to show (1 to 100 ms)
  - Lower values: See more detail in shorter events
  - Higher values: View longer patterns
- **Trigger Mode**
  - Auto: Continuous updates even without trigger
  - Normal: Freezes display until next trigger
- Trigger detection uses the averaged left/right waveform. Mono input is used directly.
- **Trigger Level** - Amplitude level that starts capture
  - Range: -1 to 1 (normalized amplitude)
- **Trigger Edge**
  - Rising: Trigger when signal goes up
  - Falling: Trigger when signal goes down
- **Holdoff** - Minimum time between triggers (0.1 to 10 ms)
- **Display Level** - Vertical scale in dB (-96 to 0 dB)
- **Vertical Offset** - Shifts waveform up/down (-1 to 1)

### Note on Waveform Display
The waveform connects captured points in time order. For longer display times, each interval retains its first and last samples plus the minimum and maximum samples at their original positions, preserving continuity and short peaks at display resolution. Use it as a visual guide rather than an exact measurement tool.

[Back to all effects](/dsp/effects/)
