---
layout: dsp
title: "DC Offset — EffeTune DSP"
description: "Adds a controllable constant offset to the signal."
lang: en
permalink: /dsp/effects/dc-offset/
---
# DC Offset

Semantic type: `DCOffset` · Category: basics

Adds a controllable constant offset to the signal.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `offset` | `offset` | number / 1 | `0` | Not declared in catalog | -1 … 1 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## DC Offset

A utility for correcting a signal whose waveform is shifted away from the zero line. Most listeners should leave this at 0.0, but it can help with unusual files or processing chains that contain DC offset.

### When to Use
- When audio has a constant DC bias or causes clicks/headroom problems after other processing
- When a diagnostic tool or meter shows the waveform is shifted away from zero
- Leave it at 0.0 for normal listening

### Parameters
- **Offset** - Adds a constant value to every sample (-1.0 to +1.0)
  - 0.0: No offset
  - Positive values shift the signal upward
  - Negative values shift the signal downward
  - Use very small adjustments when correction is needed

[Back to all effects](/dsp/effects/)
