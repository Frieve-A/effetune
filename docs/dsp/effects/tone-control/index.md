---
layout: dsp
title: "Tone Control — EffeTune DSP"
description: "Adjusts bass, midrange, and treble with broad tone-control curves."
lang: en
permalink: /dsp/effects/tone-control/
---
# Tone Control

Semantic type: `ToneControl` · Category: eq

Adjusts bass, midrange, and treble with broad tone-control curves.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `bass` | `bass` | number / 1 | `0` | dB | -24 … 24 |
| `mid` | `mid` | number / 1 | `0` | dB | -24 … 24 |
| `treble` | `treble` | number / 1 | `0` | dB | -24 … 24 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## Tone Control

A simple three-band sound adjuster for quick and easy sound personalization. Perfect for basic sound shaping without getting too technical.

### Music Enhancement Guide
- Classical Music:
  - Light treble boost for more detail in strings
  - Gentle bass boost for fuller orchestra sound
  - Neutral mids for natural sound
- Rock/Pop Music:
  - Moderate bass boost for more impact
  - Slight mid reduction for clearer sound
  - Treble boost for crisp cymbals and details
- Jazz Music:
  - Warm bass for fuller sound
  - Clear mids for instrument detail
  - Gentle treble for cymbal sparkle
- Electronic Music:
  - Strong bass for deep impact
  - Reduced mids for cleaner sound
  - Enhanced treble for crisp details

### Parameters
- **Bass** - Controls the low sounds (-24dB to +24dB)
  - Increase for more powerful bass
  - Decrease for lighter, cleaner sound
  - Affects the "weight" of the music
- **Mid** - Controls the main body of sound (-24dB to +24dB)
  - Increase for more prominent vocals/instruments
  - Decrease for more spacious sound
  - Affects the "fullness" of the music
- **Treble** - Controls the high sounds (-24dB to +24dB)
  - Increase for more sparkle and detail
  - Decrease for smoother, softer sound
  - Affects the "brightness" of the music

[Back to all effects](/dsp/effects/)
