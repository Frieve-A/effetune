---
layout: dsp
title: "Auto Pan — EffeTune DSP"
description: "Creates Auto Pan movement by applying periodic complementary gain changes within each stereo pair."
lang: en
permalink: /dsp/effects/auto-pan/
---
# Auto Pan

Semantic type: `AutoPan` · Category: modulation

Creates Auto Pan movement by applying periodic complementary gain changes within each stereo pair.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `rate` | `rate` | number / 1 | `0.35` | Hz | 0.05 … 20 |
| `depth` | `depth` | number / 1 | `45` | % | 0 … 100 |
| `center` | `center` | number / 1 | `0` | % | -100 … 100 |
| `width` | `width` | number / 1 | `70` | % | 0 … 100 |
| `waveform` | `waveform` | string / 1 | `"Sine"` | Not declared in catalog | `Sine`, `Triangle` |
| `phase` | `phase` | number / 1 | `0` | deg | 0 … 360 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Auto Pan

Auto Pan varies the gains of each adjacent stereo pair without mixing one pair into another. A final unpaired channel follows the mono rule, so it is not moved left or right. The effect has zero algorithmic latency.

### Sound Enhancement Guide

- Start with **Rate** around 0.2–0.5 Hz and moderate **Depth** for slow, unobtrusive movement.
- Reduce **Width** when headphone movement feels too wide; offset **Center** when the recording needs a stable bias to one side.
- **Triangle** gives a more uniform traverse; **Sine** slows near the ends for gentler motion.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Gentle Auto Pan**, **Wide Auto Pan**, and **Fast Auto Pan**. Changing an individual parameter switches Style to **Custom**.
- **Rate** (0.05–20 Hz) — sets movement speed.
- **Depth** (0–100%) — sets how far level moves around the center; 0% is neutral.
- **Center** (-100–100%) — shifts the midpoint left or right.
- **Width** (0–100%) — sets the usable stereo span.
- **Waveform** — chooses **Sine** or **Triangle** motion.
- **Phase** (0–360°) — sets the starting point of the repeating movement.

[Back to all effects](/dsp/effects/)
