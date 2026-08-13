---
layout: dsp
title: "Frequency Shifter — EffeTune DSP"
description: "Provides Frequency Shifter, Ring Modulator, or Barber-pole Frequency Shifter processing with analytic-signal translation or direct multiplication."
lang: en
permalink: /dsp/effects/frequency-shifter/
---
# Frequency Shifter

Semantic type: `FrequencyShifter` · Category: modulation

Provides Frequency Shifter, Ring Modulator, or Barber-pole Frequency Shifter processing with analytic-signal translation or direct multiplication.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `mode` | `mode` | string / 1 | `"Shift"` | Not declared in catalog | `Shift`, `Ring Mod`, `Barber-pole` |
| `shift` | `shift` | number / 1 | `8` | Hz | -5000 … 5000 |
| `carrierFrequency` | `carrier_frequency` | number / 1 | `440` | Hz | 0.1 … 10000 |
| `minimumShift` | `minimum_shift` | number / 1 | `20` | Hz | 0 … 5000 |
| `maximumShift` | `maximum_shift` | number / 1 | `800` | Hz | 0 … 5000 |
| `rate` | `rate` | number / 1 | `0.15` | Hz | 0.01 … 2 |
| `direction` | `direction` | string / 1 | `"Up"` | Not declared in catalog | `Up`, `Down` |
| `stereoPhase` | `stereo_phase` | number / 1 | `0` | degrees | 0 … 180 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Frequency Shifter

Frequency Shifter moves every frequency component by a fixed number of hertz rather than by a musical interval. **Ring Mod** creates metallic sidebands, while **Barber-pole** creates the impression of a shift that keeps rising or falling. The effect adds a short processing delay that varies with sample rate, including when Mix is 0%.

### Sound Enhancement Guide

- For subtle animation, choose **Shift** and begin near ±5–15 Hz. Unlike pitch shifting, harmonic intervals are intentionally changed.
- Choose **Ring Mod** for metallic or bell-like sidebands; lower **Carrier Frequency** values retain more of the source's rhythm.
- Use **Barber-pole** at a slow **Rate** for a continuous spectral-motion illusion. Keep **Mix** moderate when the effect masks pitch or speech clarity.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Shift Up** (Shift), **Shift Down** (Shift), **Fine Detune** (Shift), **Ring Modulator** (Ring Mod), **Barber-pole Up** (Barber-pole), and **Barber-pole Down** (Barber-pole). Changing an individual parameter switches Style to **Custom**.
- **Mode** — selects Shift, Ring Mod, or Barber-pole processing.
- **Shift** (-5,000–5,000 Hz) — fixed signed translation in Shift mode; positive moves components upward and negative moves them downward.
- **Carrier Frequency** (0.1–10,000 Hz) — multiplication frequency in Ring Mod mode.
- **Minimum Shift / Maximum Shift** (0–5,000 Hz) — barber sweep limits. EffeTune sorts reversed values; equal values make the barber shift stationary.
- **Rate** (0.01–2 Hz) and **Direction** (Up/Down) — control barber sweep speed and direction.
- **Stereo Phase** (0–180°) — offsets the carrier or sweep between the left and right channels of each stereo pair in all modes.
- **Mix** (0–100%) — blends matched-delay dry and shifted sound; 0% is dry in level but still carries the documented fixed latency.

If a large shift sounds rough or metallic in an unwanted way, reduce Shift or Mix.

[Back to all effects](/dsp/effects/)
