---
layout: dsp
title: "Chorus — EffeTune DSP"
description: "Creates Chorus, Stereo Chorus, Ensemble, Flanger, or Vibrato effects with interpolated moving delay voices."
lang: en
permalink: /dsp/effects/chorus/
---
# Chorus

Semantic type: `Chorus` · Category: modulation

Creates Chorus, Stereo Chorus, Ensemble, Flanger, or Vibrato effects with interpolated moving delay voices.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `mode` | `mode` | string / 1 | `"Chorus"` | Not declared in catalog | `Chorus`, `Stereo Chorus`, `Ensemble`, `Flanger`, `Vibrato` |
| `rate` | `rate` | number / 1 | `0.8` | Hz | 0.05 … 10 |
| `delay` | `delay` | number / 1 | `12` | ms | 0.5 … 30 |
| `depth` | `depth` | number / 1 | `3` | ms | 0 … 20 |
| `voices` | `voices` | integer / 1 | `3` | Not declared in catalog | 1 … 6 |
| `stereoSpread` | `stereo_spread` | number / 1 | `60` | % | 0 … 100 |
| `feedback` | `feedback` | number / 1 | `0` | % | -75 … 75 |
| `mix` | `mix` | number / 1 | `45` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Chorus

Chorus adds moving delayed copies of the music. Its modes cover **Stereo Chorus**, **Ensemble**, **Flanger**, and **Vibrato**; Delay and Depth can make the processed sound feel slightly behind the original.

### Sound Enhancement Guide

- Use **Classic Chorus** or **Stereo Chorus** for moderate width and animation on dense recordings.
- Use **Ensemble** with more **Voices** for a denser, smoother layer; excessive depth can make pitch motion obvious.
- **Flanger** uses the shortest delay and is the only mode that uses **Feedback**. Positive and negative values give different comb-filter polarity.
- **Vibrato** is fully wet by design: use a moderate **Rate** and **Depth** for controlled pitch movement.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Classic Chorus** (Chorus), **Stereo Chorus** (Stereo Chorus), **Ensemble** (Ensemble), **Flanger** (Flanger), **Jet Flanger** (Flanger), and **Vibrato** (Vibrato). Changing an individual parameter switches Style to **Custom**.
- **Mode** — selects Chorus, Stereo Chorus, Ensemble, Flanger, or Vibrato.
- **Rate** (0.05–10 Hz) — sets modulation speed.
- **Delay** (0.5–30 ms) — sets nominal wet-path delay.
- **Depth** (0–20 ms) — sets delay excursion and is automatically limited to the current **Delay** value.
- **Voices** (1–6) — sets the number of moving voices in Chorus and Ensemble; other modes ignore it.
- **Stereo Spread** (0–100%) — offsets motion within each stereo pair in Stereo Chorus, Ensemble, Flanger, and Vibrato. Chorus mode ignores it.
- **Feedback** (-75–75%) — returns wet output to the delay in Flanger mode only.
- **Mix** (0–100%) — linearly blends dry and wet sound; Vibrato ignores it and remains 100% wet. 0% is transparent in other modes.

Changing Mode or Voices may briefly emphasize the original sound to keep the transition smooth.

[Back to all effects](/dsp/effects/)
