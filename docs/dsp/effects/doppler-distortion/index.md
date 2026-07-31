---
layout: dsp
title: "Doppler Distortion — EffeTune DSP"
description: "Modulates delay to model pitch movement caused by changing distance."
lang: en
permalink: /dsp/effects/doppler-distortion/
---
# Doppler Distortion

Semantic type: `DopplerDistortion` · Category: modulation

Modulates delay to model pitch movement caused by changing distance.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `coilForce` | `coil_force` | number / 1 | `8` | N / V | 0 … 100 |
| `speakerMass` | `speaker_mass` | number / 1 | `0.03` | kg | 0.001 … 0.5 |
| `springConstant` | `spring_constant` | number / 1 | `6000` | N/m | 1 … 100000 |
| `dampingFactor` | `damping_factor` | number / 1 | `1.5` | N*s/m | 0 … 50 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Doppler Distortion

Experience a unique audio effect that brings a touch of natural movement to your music. Doppler Distortion simulates the gentle distortions created by the physical movement of a speaker cone. This effect introduces slight changes in the sound's depth and tone, much like the familiar pitch shifts you hear when a sound source moves relative to you. It adds a dynamic, immersive quality to your listening experience by making the audio feel more alive and engaging.

### Parameters

- **Coil Force (N / V)**
  Controls how strongly the input signal drives the simulated speaker coil movement. Higher values result in a more pronounced Doppler distortion.

- **Speaker Mass (kg)**<br>
  Simulates the weight of the speaker cone, affecting how naturally the movement is reproduced.<br>
  - **Higher values:** Increase the inertia, resulting in a slower response and smoother, subtler distortions.<br>
  - **Lower values:** Reduce the inertia, causing a quicker, more pronounced modulation effect.

- **Spring Constant (N/m)**<br>
  Determines the stiffness of the speaker's suspension. A higher spring constant produces a crisper, more defined response.

- **Damping Factor (N·s/m)**<br>
  Adjusts how quickly the simulated movement settles, balancing lively motion with smooth transitions.<br>
  - **Higher values:** Lead to faster stabilization, reducing oscillations and producing a tighter, more controlled effect.<br>
  - **Lower values:** Allow the movement to persist longer, resulting in a looser, more extended dynamic fluctuation.

### Recommended Settings

For a balanced and natural enhancement, start with:
- **Coil Force:** 8.0 N / V
- **Speaker Mass:** 0.03 kg<br>
- **Spring Constant:** 6000 N/m<br>
- **Damping Factor:** 1.5 N·s/m<br>

These settings provide a subtle Doppler Distortion that enriches the listening experience without overpowering the original sound.

[Back to all effects](/dsp/effects/)
