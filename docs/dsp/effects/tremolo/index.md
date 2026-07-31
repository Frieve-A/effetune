---
layout: dsp
title: "Tremolo — EffeTune DSP"
description: "Modulates amplitude periodically at a configurable rate and depth."
lang: en
permalink: /dsp/effects/tremolo/
---
# Tremolo

Semantic type: `Tremolo` · Category: modulation

Modulates amplitude periodically at a configurable rate and depth.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `rate` | `rate` | number / 1 | `10` | Hz | 0.1 … 50 |
| `depth` | `depth` | number / 1 | `2` | dB | 0 … 12 |
| `randomness` | `randomness` | number / 1 | `6` | dB | 0 … 96 |
| `randomnessCutoff` | `randomness_cutoff` | number / 1 | `200` | Hz | 1 … 1000 |
| `randomnessSlope` | `randomness_slope` | number / 1 | `-6` | dB | -12 … 0 |
| `channelPhase` | `channel_phase` | number / 1 | `0` | degrees | -180 … 180 |
| `channelSync` | `channel_sync` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Tremolo

An effect that adds rhythmic volume variations to your music, similar to the pulsing sound found in vintage amplifiers and classic recordings. This creates a dynamic, expressive quality that adds movement and interest to your listening experience.

### Listening Experience Guide
- Classic Amplifier Experience:
  - Recreates the iconic pulsing sound of vintage tube amplifiers
  - Adds rhythmic movement to static recordings
  - Creates a hypnotic, engaging listening experience
- Vintage Recording Character:
  - Simulates the natural tremolo effects used in classic recordings
  - Adds vintage character and warmth
  - Perfect for jazz, blues, and rock listening
- Creative Atmosphere:
  - Creates dramatic swells and fades
  - Adds emotional intensity to music
  - Perfect for ambient and atmospheric listening

### Parameters
- **Rate** - How fast the volume changes (0.1 to 50 Hz)
  - Slower (0.1-2 Hz): Gentle, subtle pulsing
  - Medium (2-6 Hz): Classic tremolo effect
  - Faster (6-20 Hz): Dramatic, choppy effects
  - Very fast (20-50 Hz): Extremely rapid volume modulation that can add a rough or buzzy texture; use sparingly for comfortable listening
- **Depth** - How much the volume changes (0 to 12 dB)
  - Subtle (0-3 dB): Gentle volume variations
  - Medium (3-6 dB): Noticeable pulsing effect
  - Strong (6-12 dB): Dramatic volume swells
- **Ch Phase** - Phase difference between stereo channels (-180 to 180 degrees)
  - 0°: Both channels pulse together (mono tremolo)
  - 90° or -90°: Creates a swirling, rotating effect
  - 180° or -180°: Channels pulse in opposite directions (maximum stereo width)
- **Randomness** - How irregular the volume changes become (0 to 96 dB)
  - Low: More predictable, regular pulsing
  - Medium: Natural vintage variation
  - High: More unstable, organic sound
- **Randomness Cutoff** - How quickly the random changes happen (1 to 1000 Hz)
  - Lower: Slower, more gentle random variations
  - Higher: Quicker, more erratic changes
- **Randomness Slope** - Controls how aggressive the randomness filtering is (-12 to 0 dB)
  - -12 dB: Smoother, more gradual random variations (gentler effect)
  - -6 dB: Balanced response
  - 0 dB: Sharper, more pronounced random variations (stronger effect)
- **Ch Sync** - How synchronized the randomness is between channels (0 to 100%)
  - 0%: Each channel has independent randomness
  - 50%: Partial synchronization between channels
  - 100%: Both channels share the same randomness pattern

### Recommended Settings for Different Styles

1. Classic Guitar Amp Tremolo
   - Rate: 4-6 Hz (medium speed)
   - Depth: 6-8 dB
   - Ch Phase: 0° (mono)
   - Randomness: 0-5 dB
   - Perfect for: Blues, Rock, Surf Music

2. Stereo Psychedelic Effect
   - Rate: 2-4 Hz
   - Depth: 4-6 dB
   - Ch Phase: 180° (opposite channels)
   - Randomness: 10-20 dB
   - Perfect for: Psychedelic Rock, Electronic, Experimental

3. Subtle Enhancement
   - Rate: 1-2 Hz
   - Depth: 2-3 dB
   - Ch Phase: 0-45°
   - Randomness: 5-10 dB
   - Perfect for: Any music needing gentle movement

4. Dramatic Pulsing
   - Rate: 8-12 Hz
   - Depth: 8-12 dB
   - Ch Phase: 90°
   - Randomness: 20-30 dB
   - Perfect for: Electronic, Dance, Ambient

### Quick Start Guide

1. For a Classic Tremolo Sound:
   - Start with medium Rate (4-5 Hz)
   - Add moderate Depth (6 dB)
   - Set Ch Phase to 0° for mono or 90° for stereo movement
   - Keep Randomness low (0-5 dB)
   - Adjust to taste

2. For More Character:
   - Increase Randomness gradually
   - Experiment with different Ch Phase settings
   - Try different Rate and Depth combinations
   - Trust your ears

[Back to all effects](/dsp/effects/)
