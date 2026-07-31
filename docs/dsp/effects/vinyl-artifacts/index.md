---
layout: dsp
title: "Vinyl Artifacts — EffeTune DSP"
description: "Adds deterministic seeded clicks, crackle, and surface artifacts."
lang: en
permalink: /dsp/effects/vinyl-artifacts/
---
# Vinyl Artifacts

Semantic type: `VinylArtifacts` · Category: lo-fi

Adds deterministic seeded clicks, crackle, and surface artifacts.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `popsPerMinute` | `pops_per_minute` | integer / 1 | `20` | Not declared in catalog | 0 … 120 |
| `popLevel` | `pop_level` | number / 1 | `-24` | dB | -80 … 0 |
| `cracklesPerMinute` | `crackles_per_minute` | integer / 1 | `500` | Not declared in catalog | 0 … 2000 |
| `crackleLevel` | `crackle_level` | number / 1 | `-33` | dB | -80 … 0 |
| `hissLevel` | `hiss_level` | number / 1 | `-42` | dB | -80 … 0 |
| `rumbleLevel` | `rumble_level` | number / 1 | `-50` | dB | -80 … 0 |
| `crosstalk` | `crosstalk` | integer / 1 | `60` | % | 0 … 100 |
| `noiseProfile` | `noise_profile` | number / 1 | `0` | Not declared in catalog | 0 … 10 |
| `wear` | `wear` | integer / 1 | `100` | % | 0 … 200 |
| `react` | `react` | integer / 1 | `25` | % | 0 … 100 |
| `reactMode` | `react_mode` | string / 1 | `"Velocity"` | Not declared in catalog | `Velocity`, `Amplitude` |
| `mix` | `mix` | integer / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Vinyl Artifacts

An effect that adds vinyl-style playback artifacts such as pops, crackle, hiss, rumble, and reactive surface noise. It adds generated record noise to the music; it does not change the tone of the original music signal like a full turntable, cartridge, or phono preamp model.

### Sound Character Guide
- Vinyl Record Experience:
  - Recreates the authentic sound of playing vinyl records
  - Adds the characteristic surface noise and artifacts
  - Creates that warm, nostalgic analog feeling
- Vintage Playback System:
  - Adds generated playback artifacts around the music
  - Shapes the tone of the generated vinyl noise
  - Adds reactive noise that can respond to the music
- Atmospheric Texture:
  - Creates rich, organic background texture
  - Adds depth and character to digital recordings
  - Perfect for creating cozy, intimate listening experiences

### Parameters
- **Pops/min** - Controls the frequency of large click noises per minute (0 to 120)
  - 0-20: Occasional gentle pops
  - 20-60: Moderate vintage character
  - 60-120: Heavy wear and tear sound
- **Pop Level** - Controls the volume of pop noises (-80.0 to 0.0 dB)
  - -80 to -48 dB: Subtle clicks
  - -48 to -24 dB: Moderate pops
  - -24 to 0 dB: Loud pops (extreme settings)
- **Crackles/min** - Controls the density of crackling noise per minute (0 to 2000)
  - 0-200: Subtle surface texture
  - 200-1000: Classic vinyl character
  - 1000-2000: Heavy surface noise
- **Crackle Level** - Controls the volume of crackling noise (-80.0 to 0.0 dB)
  - -80 to -48 dB: Subtle crackling
  - -48 to -24 dB: Moderate crackling
  - -24 to 0 dB: Loud crackling (extreme settings)
- **Hiss** - Controls the level of constant surface noise (-80.0 to 0.0 dB)
  - -80 to -48 dB: Subtle background texture
  - -48 to -30 dB: Noticeable surface noise
  - -30 to 0 dB: Prominent hiss (extreme settings)
- **Rumble** - Controls low-frequency turntable rumble (-80.0 to 0.0 dB)
  - -80 to -60 dB: Subtle low-end warmth
  - -60 to -40 dB: Noticeable rumble
  - -40 to 0 dB: Heavy rumble (extreme settings)
- **Crosstalk** - Blends the generated artifact noise between left and right channels; the original music signal keeps its stereo separation (0 to 100%)
  - 0%: Generated noise keeps its original channel separation
  - 30-60%: Realistic vinyl-style noise bleed
  - 100%: Generated noise becomes nearly equal between left and right
- **Noise Profile** - Adjusts the frequency response of the generated noise (0.0 to 10.0)
  - 0: Darkest, warmest noise tone
  - 5: Partially shaped noise tone
  - 10: Flat noise tone / tone shaping bypassed
- **Wear** - Scales surface wear artifacts such as pops, crackles, and hiss (0 to 200%)
  - 0-50%: Cleaner surface noise
  - 50-100%: Normal surface wear
  - 100-200%: Heavily worn surface noise
  - Rumble, Crosstalk, and Noise Profile are controlled separately
- **React** - How much the noise responds to the input signal (0 to 100%)
  - 0%: Static noise levels
  - 25-50%: Moderate response to music
  - 75-100%: Highly reactive to input
- **React Mode** - Selects what aspect of the signal controls the reaction
  - Velocity: Responds to high-frequency content (needle speed)
  - Amplitude: Responds to overall signal level
- **Mix** - Controls how much noise is added to the dry signal (0 to 100%)
  - 0%: No noise added (dry signal only)
  - 50%: Moderate noise addition
  - 100%: Maximum noise addition
  - Note: The dry signal level remains unchanged; this parameter only controls the noise amount

### Recommended Settings for Different Styles

1. Subtle Vinyl Character
   - Pops/min: 20, Pop Level: -48dB, Crackles/min: 200, Crackle Level: -48dB
   - Hiss: -48dB, Rumble: -60dB, Crosstalk: 30%, Noise Profile: 5.0
   - Wear: 25%, React: 20%, React Mode: Velocity, Mix: 100%
   - Perfect for: Adding gentle vinyl surface texture

2. Classic Vinyl Experience
   - Pops/min: 40, Pop Level: -36dB, Crackles/min: 400, Crackle Level: -36dB
   - Hiss: -36dB, Rumble: -50dB, Crosstalk: 50%, Noise Profile: 4.0
   - Wear: 60%, React: 30%, React Mode: Velocity, Mix: 100%
   - Perfect for: Authentic vinyl listening experience

3. Well-Worn Record
   - Pops/min: 80, Pop Level: -24dB, Crackles/min: 800, Crackle Level: -24dB
   - Hiss: -30dB, Rumble: -40dB, Crosstalk: 70%, Noise Profile: 3.0
   - Wear: 120%, React: 50%, React Mode: Velocity, Mix: 100%
   - Perfect for: Heavily aged record character

4. Lo-Fi Ambient
   - Pops/min: 15, Pop Level: -54dB, Crackles/min: 150, Crackle Level: -54dB
   - Hiss: -42dB, Rumble: -66dB, Crosstalk: 25%, Noise Profile: 6.0
   - Wear: 40%, React: 15%, React Mode: Amplitude, Mix: 100%
   - Perfect for: Background ambient texture

5. Dynamic Vinyl
   - Pops/min: 60, Pop Level: -30dB, Crackles/min: 600, Crackle Level: -30dB
   - Hiss: -39dB, Rumble: -45dB, Crosstalk: 60%, Noise Profile: 5.0
   - Wear: 80%, React: 75%, React Mode: Velocity, Mix: 100%
   - Perfect for: Noise that responds dramatically to the music

[Back to all effects](/dsp/effects/)
