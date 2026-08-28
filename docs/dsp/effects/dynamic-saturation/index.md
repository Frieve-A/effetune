---
layout: dsp
title: "Dynamic Saturation — EffeTune DSP"
description: "Applies saturation whose drive responds to the input level."
lang: en
permalink: /dsp/effects/dynamic-saturation/
---
# Dynamic Saturation

Semantic type: `DynamicSaturation` · Category: saturation

Applies saturation whose drive responds to the input level.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `speakerDrive` | `speaker_drive` | number / 1 | `3` | Not declared in catalog | 0 … 10 |
| `speakerStiffness` | `speaker_stiffness` | number / 1 | `2` | Not declared in catalog | 0 … 10 |
| `speakerDamping` | `speaker_damping` | number / 1 | `1` | Not declared in catalog | 0.1 … 10 |
| `speakerMass` | `speaker_mass` | number / 1 | `1` | Not declared in catalog | 0.1 … 5 |
| `distortionDrive` | `distortion_drive` | number / 1 | `1.5` | Not declared in catalog | 0 … 10 |
| `distortionBias` | `distortion_bias` | number / 1 | `0.1` | Not declared in catalog | -1 … 1 |
| `distortionMix` | `distortion_mix` | number / 1 | `100` | % | 0 … 100 |
| `coneMotionMix` | `cone_motion_mix` | number / 1 | `20` | % | 0 … 100 |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -18 … 18 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Dynamic Saturation

A physics-based effect that simulates the nonlinear displacement of speaker cones under different conditions. By modeling the mechanical behavior of a speaker and then applying saturation to that displacement, it creates a unique form of distortion that responds dynamically to your music.

### Listening Enhancement Guide
- **Subtle Enhancement:**
  - Adds gentle warmth and slight rounded-peak behavior
  - Creates a natural "pushed speaker" sound without obvious distortion
  - Adds subtle movement and depth to the sound
- **Moderate Effect:**
  - Creates a more dynamic, responsive distortion
  - Adds unique movement and liveliness to sustained passages
  - Gives transients a moving, responsive character
- **Creative Effect:**
  - Produces complex distortion patterns that evolve with the input
  - Creates resonant, speaker-like behaviors
  - Creates bold, evolving character for experimental listening

### System Presets

Click **Effect Presets** in the effect header to compare complete cone-motion settings.

- **Subtle Cone Color** - A restrained, mostly clean speaker-cone character.
- **Pushed Speaker** - Stronger cone motion and saturation with output compensation.
- **Ragged Cone** - The most pronounced, deliberately rough cone character.

### Parameters
- **Speaker Drive** (0.0-10.0) - Controls how strongly the audio signal moves the cone
  - Low values: Subtle movement and gentle effect
  - High values: Dramatic movement and stronger character
- **Speaker Stiffness** (0.0-10.0) - Simulates the cone's suspension stiffness
  - Low values: Loose, free movement with longer decay
  - High values: Tight, controlled movement with quick response
- **Speaker Damping** (0.1-10.0) - Controls how quickly cone movement settles
  - Low values near 0.1: Prolonged vibration and resonance
  - High values: Quick damping for controlled sound
- **Speaker Mass** (0.1-5.0) - Simulates cone inertia
  - Low values: Fast, responsive movement
  - High values: Slower, more pronounced movement
- **Distortion Drive** (0.0-10.0) - Controls the intensity of displacement saturation
  - Low values: Subtle nonlinearity
  - High values: Strong saturation character
- **Distortion Bias** (-1.0-1.0) - Adjusts the symmetry of the saturation curve
  - Zero: Symmetrical saturation
  - Positive/Negative: Adds asymmetric character by changing which side of the displacement saturates more strongly
- **Distortion Mix** (0-100%) - Blends between linear and saturated displacement
  - Low values: More linear response
  - High values: More saturated character
- **Cone Motion Mix** (0-100%) - Controls how much cone motion affects the original sound
  - Low values: Subtle enhancement
  - High values: Dramatic effect
- **Output Gain** (-18.0-18.0dB) - Adjusts the final output level

### Visual Display
- Live transfer curve graph showing how displacement is being saturated
- Clear visual feedback of distortion characteristics
- Visual representation of how Distortion Drive and Bias affect the sound

### Music Enhancement Tips
- For Subtle Warmth:
  - Speaker Drive: 2.0-3.0
  - Speaker Stiffness: 1.5-2.5
  - Speaker Damping: 0.5-1.5
  - Distortion Drive: 1.0-2.0
  - Cone Motion Mix: 20-40%
  - Distortion Mix: 30-50%

- For Dynamic Character:
  - Speaker Drive: 3.0-5.0
  - Speaker Stiffness: 2.0-4.0
  - Speaker Mass: 0.5-1.5
  - Distortion Drive: 3.0-6.0
  - Distortion Bias: Try +/-0.2 for asymmetrical character
  - Cone Motion Mix: 40-70%

- For Strong Experimental Effect:
  - Speaker Drive: 6.0-10.0
  - Speaker Stiffness: Try extreme values (very low or high)
  - Speaker Mass: 2.0-5.0 for exaggerated movement
  - Distortion Drive: 5.0-10.0
  - Experiment with Bias values
  - Cone Motion Mix: 70-100%

### Quick Start Guide
1. Start with moderate Speaker Drive (3.0) and Stiffness (2.0)
2. Set Speaker Damping to control resonance (1.0 for balanced response)
3. Adjust Distortion Drive to taste (3.0 for moderate effect)
4. Set Distortion Bias to 0.0 first for symmetrical saturation
5. Set Distortion Mix to 50% and Cone Motion Mix to 50%
6. Adjust Speaker Mass to change the character of the effect
7. Fine-tune with Output Gain to balance levels

[Back to all effects](/dsp/effects/)
