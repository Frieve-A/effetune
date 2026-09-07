---
layout: dsp
title: "Hum Remover — EffeTune DSP"
description: "Reduces mains hum and its harmonics."
lang: en
permalink: /dsp/effects/hum-remover/
---
# Hum Remover

Semantic type: `HumRemover` · Category: restoration

Reduces mains hum and its harmonics.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `frequency` | `frequency` | string / 1 | `"Auto"` | Not declared in catalog | `Auto`, `50 Hz`, `60 Hz` |
| `harmonics` | `harmonics` | integer / 1 | `8` | Not declared in catalog | 1 … 64 |
| `trackingSpeed` | `tracking_speed` | number / 1 | `50` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Hum Remover

Hum Remover reduces a steady electrical mains hum and its harmonics, such as a 50 Hz or 60 Hz buzz from a turntable, cable, or power-related fault. It is for a constant tone, not general background noise.

### Listening Guide

1. Start with **Frequency** set to **Auto**, **Harmonics** at 8, and **Tracking Speed** at 50%.
2. If you know the mains frequency in the recording, choose **50 Hz** or **60 Hz**. Otherwise, leave **Auto** selected and check the displayed **FUNDAMENTAL**.
3. Raise **Harmonics** when audible buzz remains above the fundamental; lower it if the music loses too much body or detail.
4. Raise **Tracking Speed** when a hum slowly drifts in pitch; lower it for a stable hum if you want gentler tracking.
5. If sustained bass or another musical tone exactly matches a hum harmonic, lower **Harmonics** to leave that frequency less affected.

### Parameters

- **Frequency** (**Auto**, **50 Hz**, or **60 Hz**; default **Auto**) selects the hum fundamental. **Auto** follows a detected mains-like hum; choose a fixed value when the hum is known to be 50 Hz or 60 Hz.
- **Harmonics** (1–64, default 8) chooses how many multiples of the fundamental are removed. Higher values can clear more buzz, while lower values preserve more musical content near higher harmonics. The slider uses a logarithmic scale to give lower settings more adjustment space.
- **Tracking Speed** (0–100%, default 50%) controls how quickly automatic tracking follows a changing hum. Higher values follow drift more quickly; lower values change more slowly and suit a stable hum.

### Reading the Display

**FUNDAMENTAL** shows the frequency currently targeted by the effect. **REMOVED** shows the level of the hum component being removed in dBFS: a value closer to 0 dBFS means a stronger removed hum, while a very low value (such as -140 dBFS) means little or no hum is currently being removed.

[Back to all effects](/dsp/effects/)
