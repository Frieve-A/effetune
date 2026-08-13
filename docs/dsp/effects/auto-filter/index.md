---
layout: dsp
title: "Auto Filter — EffeTune DSP"
description: "Provides Auto Filter sweeps, Envelope Filter response, and Auto Wah movement with a resonant state-variable filter."
lang: en
permalink: /dsp/effects/auto-filter/
---
# Auto Filter

Semantic type: `AutoFilter` · Category: modulation

Provides Auto Filter sweeps, Envelope Filter response, and Auto Wah movement with a resonant state-variable filter.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `mode` | `mode` | string / 1 | `"LFO"` | Not declared in catalog | `LFO`, `Envelope` |
| `filterType` | `filter_type` | string / 1 | `"Low-pass"` | Not declared in catalog | `Low-pass`, `Band-pass`, `High-pass` |
| `minimumFrequency` | `minimum_frequency` | number / 1 | `200` | Hz | 20 … 20000 |
| `maximumFrequency` | `maximum_frequency` | number / 1 | `4000` | Hz | 20 … 20000 |
| `resonance` | `resonance` | number / 1 | `1.5` | Q | 0.5 … 20 |
| `mix` | `mix` | number / 1 | `80` | % | 0 … 100 |
| `rate` | `rate` | number / 1 | `0.5` | Hz | 0.05 … 20 |
| `waveform` | `waveform` | string / 1 | `"Sine"` | Not declared in catalog | `Sine`, `Triangle` |
| `stereoPhase` | `stereo_phase` | number / 1 | `0` | deg | 0 … 180 |
| `sensitivity` | `sensitivity` | number / 1 | `24` | dB | 0 … 60 |
| `attack` | `attack` | number / 1 | `20` | ms | 1 … 500 |
| `release` | `release` | number / 1 | `250` | ms | 10 … 2000 |
| `direction` | `direction` | string / 1 | `"Up"` | Not declared in catalog | `Up`, `Down` |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Auto Filter

Auto Filter moves a resonant filter automatically. **LFO** mode repeats a sweep, while **Envelope** mode follows the music's level for Envelope Filter and Auto Wah sounds.

### Sound Enhancement Guide

- For gentle tonal motion, choose **LFO**, **Low-pass**, a wide frequency range, low **Resonance**, and **Mix** around 30–50%.
- For an Auto Wah response, choose **Envelope**, **Band-pass**, raise **Resonance**, and adjust **Sensitivity** until accents open the filter without holding it fully open.
- Use a slower **Attack** to soften the reaction to percussion; use a longer **Release** for a smoother return between notes.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Auto Filter Sweep** (LFO), **Stereo Filter Sweep** (LFO), **Envelope Filter** (Envelope), **Auto Wah** (Envelope), and **Reverse Auto Wah** (Envelope). Changing an individual parameter switches Style to **Custom**.
- **Mode** — **LFO** sweeps periodically; **Envelope** follows signal level.
- **Filter Type** — **Low-pass** retains frequencies below the moving cutoff, **Band-pass** emphasizes the region around it, and **High-pass** retains frequencies above it.
- **Minimum Frequency / Maximum Frequency** (20–20,000 Hz) — set the sweep limits. If supplied in reverse order, EffeTune sorts them; equal values hold the filter stationary. The available upper limit can be lower at lower playback sample rates.
- **Resonance** (Q 0.5–20) — higher values emphasize the moving cutoff more strongly.
- **Mix** (0–100%) — blends dry and filtered sound; 0% is transparent dry.
- **Rate** (0.05–20 Hz), **Waveform** (Sine/Triangle), and **Stereo Phase** (0–180°) — control LFO speed, trajectory, and the offset within each stereo pair. They are used only in LFO mode.
- **Sensitivity** (0–60 dB), **Attack** (1–500 ms), **Release** (10–2,000 ms), and **Direction** (Up/Down) — control how strongly and how quickly the envelope moves, and whether louder sound raises or lowers the cutoff. They are used only in Envelope mode.

[Back to all effects](/dsp/effects/)
