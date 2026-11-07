---
layout: dsp
title: "Bass Extender — EffeTune DSP"
description: "Generates low bass one octave below suitable low-frequency input content."
lang: en
permalink: /dsp/effects/bass-extender/
---
# Bass Extender

Semantic type: `BassExtender` · Category: saturation

Generates low bass one octave below suitable low-frequency input content.

## Contract

- Seeded: **no**
- Catalog sample rates: **44100, 48000, 88200, 96000, 176400, 192000 Hz**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `amount` | `amount` | number / 1 | `25` | % | 0 … 100 |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 0 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## Bass Extender

Bass Extender reinforces bass-light recordings by generating content about one octave below bass that is already present. It analyzes input from roughly 60–200 Hz and adds generated bass around 30–100 Hz while leaving the original signal in place. It does not recover the original missing fundamental, level, or phase.

### Listening Enhancement Guide

- Start with **Amount** at its 25% default and raise it gradually.
- Compare with bypass at a similar loudness. Use **Output** to compensate if the added bass makes the processed signal louder.
- Reduce **Amount** if bass notes, kick drums, or their overlap sound muddy or uneven.
- Use Spectrum Analyzer and Level Meter when you want to compare the added low-frequency range and output level.
- The effect will be small if your headphones or speakers cannot reproduce the generated 30–100 Hz range.

### Parameters

- **Amount** (0–100%, default 25%) - Controls the level of the generated low bass. 0% removes the generated contribution; higher values make it more prominent without changing the original signal directly.
- **Output** (-24 to 0 dB, default 0 dB) - Adjusts the final level after the generated bass is added. Lower it to match the bypassed level or to create more output headroom.

[Back to all effects](/dsp/effects/)
