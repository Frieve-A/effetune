---
layout: dsp
title: "RS Reverb — EffeTune DSP"
description: "Creates algorithmic reverberation with configurable room and decay behavior."
lang: en
permalink: /dsp/effects/rs-reverb/
---
# RS Reverb

Semantic type: `RSReverb` · Category: reverb

Creates algorithmic reverberation with configurable room and decay behavior.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `preDelay` | `pre_delay` | number / 1 | `10` | ms | 0 … 50 |
| `roomSize` | `room_size` | number / 1 | `10` | m | 2 … 50 |
| `reverbTime` | `reverb_time` | number / 1 | `2.4` | s | 0.1 … 10 |
| `density` | `density` | integer / 1 | `8` | lines | 4 … 8 |
| `diffusion` | `diffusion` | number / 1 | `0.7` | ratio | 0.2 … 0.8 |
| `damping` | `damping` | integer / 1 | `80` | % | 0 … 100 |
| `highDamp` | `high_damp` | integer / 1 | `2000` | Hz | 1000 … 20000 |
| `lowDamp` | `low_damp` | integer / 1 | `200` | Hz | 20 … 500 |
| `mix` | `mix` | integer / 1 | `16` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## RS Reverb

RS Reverb adds adjustable reflections and decay, making a dry recording sound as though it is playing in a room or hall.

### Listening Experience Guide
- Intimate Space:
  - Start with Room Size 8-12m, Reverb Time 1.0-1.5s, and Mix 20-30%
  - Lower Mix if vocals or instrument attacks lose clarity
- Hall-like Space:
  - Start with Room Size 30-40m, Reverb Time 2.0-2.5s, and Mix 30-40%
  - Shorten Reverb Time if successive notes become blurred
- Long, Atmospheric Decay:
  - Start with Room Size 25-40m, Reverb Time 3-6s, and Mix 40-60%
  - Raise Damping or lower High Damp if the tail is too bright

### Parameters
- **Pre-Delay** (0 to 50 ms) - Changing this control does not currently change the sound. Use Room Size, Reverb Time, and Mix to adjust the sense of space.
- **Room Size** - Sets how large the space feels (2.0 to 50.0 m)
  - Small (2-5m): Cozy room feeling
  - Medium (5-15m): Live room atmosphere
  - Large (15-50m): Concert hall grandeur
- **Reverb Time** - How long the echoes last (0.1 to 10.0 s)
  - Short (0.1-1.0s): Clear, focused sound
  - Medium (1.0-3.0s): Natural room sound
  - Long (3.0-10.0s): Spacious, atmospheric
- **Density** - How rich the space feels (4 to 8)
  - Lower values: More defined echoes
  - Higher values: Smoother atmosphere
  - Start with 6 for natural sound
- **Diffusion** - How the sound spreads out (0.2 to 0.8)
  - Lower values: More distinct echoes
  - Higher values: Smoother blend
  - Try 0.5 for balanced sound
- **Damping** - How the echoes fade away (0 to 100%)
  - Lower values: Brighter, more open sound
  - Higher values: Warmer, more intimate
  - Start around 40% for natural feel
- **High Damp** - Controls brightness of the space (1000 to 20000 Hz)
  - Lower values: Darker, warmer space
  - Higher values: Brighter, more open
  - Start around 8000Hz for natural sound
- **Low Damp** - Controls fullness of the space (20 to 500 Hz)
  - Lower values: Fuller, richer sound
  - Higher values: Clearer, more controlled
  - Start around 100Hz for balanced bass
- **Mix** - Balances the effect with original sound (0 to 100%)
  - 10-30%: Subtle enhancement
  - 30-50%: Notable space
  - 50-100%: Dramatic effect

### Recommended Settings for Different Music Styles

1. Classical Music in Concert Hall
   - Room Size: 30-40m
   - Reverb Time: 2.0-2.5s
   - Mix: 30-40%
   - Useful for: Orchestral works, piano concertos

2. Intimate Jazz Club
   - Room Size: 8-12m
   - Reverb Time: 1.0-1.5s
   - Mix: 20-30%
   - Useful for: Jazz, acoustic performances

3. Modern Pop/Rock
   - Room Size: 15-20m
   - Reverb Time: 1.2-1.8s
   - Mix: 15-25%
   - Useful for: Contemporary music

4. Ambient/Electronic
   - Room Size: 25-40m
   - Reverb Time: 3.0-6.0s
   - Mix: 40-60%
   - Useful for: Atmospheric electronic music

### Quick Start Guide

1. Choose Your Space
   - Start with Room Size to set basic space
   - Adjust Reverb Time for desired atmosphere
   - Fine-tune Mix for proper balance

2. Shape the Sound
   - Use Damping to control warmth
   - Adjust High/Low Damp for tone
   - Set Density and Diffusion for texture

3. Fine-Tune the Effect
   - Adjust Mix for final balance
   - Trust your ears and adjust to taste

Start with a low Mix value, then increase it until the added space is clear without obscuring the original recording.

[Back to all effects](/dsp/effects/)
