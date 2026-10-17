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

Use the opt-in decoded telemetry callback or subscription API to observe this effect. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **decoded semantic observations are available**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `displayTime` | `display_time` | number / 1 | `0.01` | s | 0.001 … 10 |
| `triggerMode` | `trigger_mode` | string / 1 | `"Auto"` | Not declared in catalog | `Auto`, `Normal`, `Off` |
| `triggerLevel` | `trigger_level` | number / 1 | `0` | Not declared in catalog | -1 … 1 |
| `triggerEdge` | `trigger_edge` | string / 1 | `"Rising"` | Not declared in catalog | `Rising`, `Falling` |
| `holdoff` | `holdoff` | number / 1 | `0.0001` | s | 0.0001 … 0.01 |
| `displayLevel` | `display_level` | number / 1 | `0` | dB | -96 … 0 |
| `verticalOffset` | `vertical_offset` | number / 1 | `0` | Not declared in catalog | -1 … 1 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Oscilloscope

Shows the shape of the sound wave in real time, so you can see beats, sharp hits, and changes in loudness while listening. Trigger settings steady the display when a waveform repeats.

### Usage Guide
- Set **Display Time** to 1–20 ms and **Trigger Mode** to **Auto** to inspect a repeating waveform cycle.
- Set **Display Time** to 1,000–10,000 ms and **Trigger Mode** to **Off** to follow beats and loudness envelopes scrolling smoothly from right to left.
- In **Auto** and **Normal** modes, the trace updates once the full **Display Time** interval has been collected.

### Parameters
- **Display Time** (1 to 10,000 ms) - Visible time span. Short values show individual waveform cycles; long values show overall envelope patterns.
- **Trigger Mode**:
  - **Auto**: Updates continuously even without a trigger event.
  - **Normal**: Updates only when a trigger occurs and holds the last capture until the next trigger.
  - **Off**: Scrolls continuously from right to left; trigger settings have no effect.
- **Trigger Level** (-1 to 1) - Normalized amplitude threshold that starts capture (detected from the mono or averaged L/R signal).
- **Trigger Edge** - **Rising** (triggers on upward crossing) or **Falling** (triggers on downward crossing).
- **Holdoff** (0.1 to 10 ms) - Minimum wait time between triggers.
- **Display Level** (-96 to 0 dB; default 0 dB) - Sets the level shown at the top and bottom edges of the display. 0 dB shows the full ±1 range; lower values zoom in on quieter signals.
- **Vertical Offset** (-1 to 1) - Shifts the waveform vertically; positive values move the waveform up.

### Visualization Guide
- **Horizontal axis**: Time in milliseconds or seconds.
- **Vertical axis**: Normalized amplitude, scaled by **Display Level** and shifted by **Vertical Offset**.
- **Line vs. Envelope Band**: Short display times draw a continuous waveform line; long display times draw a filled min/max band so brief peaks remain visible when many samples share a single pixel column.

[Back to all effects](/dsp/effects/)
