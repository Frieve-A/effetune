---
layout: dsp
title: "Phaser — EffeTune DSP"
description: "Creates moving peaks and notches as a classic Phaser or Barber-pole Phaser with all-pass sweeps."
lang: en
permalink: /dsp/effects/phaser/
---
# Phaser

Semantic type: `Phaser` · Category: modulation

Creates moving peaks and notches as a classic Phaser or Barber-pole Phaser with all-pass sweeps.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `mode` | `mode` | string / 1 | `"Classic"` | Not declared in catalog | `Classic`, `Barber-pole` |
| `rate` | `rate` | number / 1 | `0.5` | Hz | 0.05 … 10 |
| `centerFrequency` | `center_frequency` | number / 1 | `1000` | Hz | 80 … 8000 |
| `range` | `range` | number / 1 | `3` | octaves | 0 … 6 |
| `stages` | `stages` | integer / 1 | `6` | Not declared in catalog | `2`, `4`, `6`, `8`, `10`, `12` |
| `feedback` | `feedback` | number / 1 | `20` | % | -90 … 90 |
| `stereoPhase` | `stereo_phase` | number / 1 | `90` | degrees | 0 … 180 |
| `direction` | `direction` | string / 1 | `"Up"` | Not declared in catalog | `Up`, `Down` |
| `mix` | `mix` | number / 1 | `50` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Phaser

Phaser mixes the original sound with cascaded all-pass filters to create moving peaks and notches. **Classic** sweeps back and forth. **Barber-pole** overlaps three bounded, constant-power sweep voices to suggest continuous upward or downward movement. It reports zero algorithmic latency.

### Sound Enhancement Guide

- Start with **Classic Phaser**, 4–6 **Stages**, moderate **Range**, and **Mix** near 50% for clear notches without excessive resonance.
- Raise **Stages** and **Feedback** for a deeper pattern; reduce them if transients become too colored.
- Use **Stereo Phase** for width while remembering that each adjacent stereo pair repeats the same relation.
- Choose **Barber-pole Up/Down** for continuous motion rather than an ordinary returning sweep.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Classic Phaser** (Classic), **Deep Phaser** (Classic), **Stereo Phaser** (Classic), **Barber-pole Up** (Barber-pole), and **Barber-pole Down** (Barber-pole). Changing an individual parameter switches Style to **Custom**.
- **Mode** — selects Classic or Barber-pole topology.
- **Rate** (0.05–10 Hz) — sets sweep speed.
- **Center Frequency** (80–8,000 Hz) — sets the geometric center of the sweep.
- **Range** (0–6 octaves) — sets sweep span in logarithmic frequency.
- **Stages** (2–12, even) — sets the number of all-pass sections; more stages create more notches.
- **Feedback** (-90–90%) — returns phased output to the input; magnitude sharpens the pattern and sign changes emphasis.
- **Stereo Phase** (0–180°) — offsets motion within each stereo pair.
- **Direction** (Up/Down) — controls Barber-pole direction and is ignored in Classic mode.
- **Mix** (0–100%) — linearly blends dry and phased sound; the middle region normally produces the deepest cancellation.

Mode, stage, and barber-direction changes cross a short dry midpoint while incompatible recursive state is reset.

[Back to all effects](/dsp/effects/)
