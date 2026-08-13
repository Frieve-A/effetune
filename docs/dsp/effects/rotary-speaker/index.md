---
layout: dsp
title: "Rotary Speaker — EffeTune DSP"
description: "Creates Rotary Speaker motion, commonly known as a Leslie effect, by combining crossover-separated horn and drum amplitude and Doppler movement."
lang: en
permalink: /dsp/effects/rotary-speaker/
---
# Rotary Speaker

Semantic type: `RotarySpeaker` · Category: modulation

Creates Rotary Speaker motion, commonly known as a Leslie effect, by combining crossover-separated horn and drum amplitude and Doppler movement.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `speedState` | `speed_state` | string / 1 | `"Slow"` | Not declared in catalog | `Stop`, `Slow`, `Fast` |
| `speed` | `speed` | number / 1 | `100` | % | 25 … 200 |
| `acceleration` | `acceleration` | number / 1 | `2.2` | s | 0.1 … 10 |
| `crossover` | `crossover` | number / 1 | `800` | Hz | 200 … 2000 |
| `rotorBalance` | `rotor_balance` | number / 1 | `0` | % | -100 … 100 |
| `stereoWidth` | `stereo_width` | number / 1 | `75` | % | 0 … 100 |
| `dopplerDepth` | `doppler_depth` | number / 1 | `45` | % | 0 … 100 |
| `amplitudeDepth` | `amplitude_depth` | number / 1 | `55` | % | 0 … 100 |
| `mix` | `mix` | number / 1 | `70` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Rotary Speaker

Rotary Speaker splits the sound between a high-frequency horn and low-frequency drum, then gives them different rotation rates. Level movement and a short Doppler delay create the characteristic dual-rotor motion.

### Sound Enhancement Guide

- Select **Slow** for broad, relaxed movement and **Fast** for a more urgent rotary texture.
- Set **Acceleration** long enough to hear the rotors gather speed naturally when changing Speed State.
- Increase **Doppler Depth** for stronger pitch motion or **Amplitude Depth** for stronger level motion; moderate both for ordinary listening.
- Use **Rotor Balance** to favor the drum or horn, and reduce **Stereo Width** when headphones make the movement too broad.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Rotary Slow** (Slow), **Rotary Fast** (Fast), **Gentle Rotary** (Slow), **Leslie Slow** (Slow), and **Leslie Fast** (Fast). Changing an individual parameter switches Style to **Custom**.
- **Speed State** — **Stop**, **Slow**, or **Fast** target. During a change, the rotors accelerate or slow down smoothly without interrupting the sound.
- **Speed** (25–200%) — scales both internal rotor rates while preserving their difference.
- **Acceleration** (0.1–10 s) — sets how quickly the rotors approach a new speed.
- **Crossover** (200–2,000 Hz) — divides drum and horn bands.
- **Rotor Balance** (-100–100%) — favors the drum at negative values and horn at positive values.
- **Stereo Width** (0–100%) — sets paired-channel spatial separation.
- **Doppler Depth** (0–100%) — sets moving-delay pitch motion.
- **Amplitude Depth** (0–100%) — sets level modulation from virtual rotor orientation.
- **Mix** (0–100%) — blends dry and rotary sound; 0% is transparent dry.

[Back to all effects](/dsp/effects/)
