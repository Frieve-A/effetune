---
layout: dsp
title: "Simple Jitter — EffeTune DSP"
description: "Applies deterministic seeded sampling-time jitter."
lang: en
permalink: /dsp/effects/simple-jitter/
---
# Simple Jitter

Semantic type: `SimpleJitter` · Category: lo-fi

Applies deterministic seeded sampling-time jitter.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `rmsJitterNanoseconds` | `rms_jitter_nanoseconds` | number / 1 | `100` | ns | 0.001 … 10000000 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## Simple Jitter

Simple Jitter adds random variations to sample timing. The picosecond range is for comparing small, realistic clock fluctuations; during normal music playback, these settings are usually almost impossible to distinguish. For an obvious change in movement or texture, use microseconds or more. At those values, treat Simple Jitter as a creative effect, not as a model of normal CD players, DAT machines, or other digital equipment.

### Sound Character Guide

- **Small clock-fluctuation comparison:** Picosecond values keep the effect extremely slight. Do not expect 1–500 ps to give a recognizable vintage or early-digital character.
- **Audible creative texture:** Microsecond values add increasingly obvious roughness and timing instability. Raise RMS Jitter gradually, because high settings quickly become extreme.

### Parameters

- **RMS Jitter** (1 ps to 10 ms) - Sets the size of the random timing variations. Moving the slider to the right increases the effect on a logarithmic scale.

### Starting Points

1. **Small Clock Fluctuation**
   - RMS Jitter: 100 ps
   - Use this to compare a realistic, very small timing variation; it will normally sound nearly unchanged.

2. **Audible Texture**
   - RMS Jitter: 10 µs
   - Use this as a starting point for a clear creative effect, then adjust by ear.

3. **Strong Experimental Effect**
   - RMS Jitter: 100 µs
   - Use this for pronounced roughness and instability; lower it if the music breaks up too much.

[Back to all effects](/dsp/effects/)
