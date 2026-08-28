---
layout: dsp
title: "Wow Flutter — EffeTune DSP"
description: "Applies slow and fast pitch variation associated with imperfect mechanical playback."
lang: en
permalink: /dsp/effects/wow-flutter/
---
# Wow Flutter

Semantic type: `WowFlutter` · Category: modulation

Applies slow and fast pitch variation associated with imperfect mechanical playback.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `rate` | `rate` | number / 1 | `0.5` | Hz | 0.1 … 20 |
| `depth` | `depth` | number / 1 | `6` | ms | 0 … 40 |
| `randomness` | `randomness` | number / 1 | `10` | ms | 0 … 40 |
| `randomnessCutoff` | `randomness_cutoff` | number / 1 | `5` | Hz | 0.1 … 20 |
| `randomnessSlope` | `randomness_slope` | number / 1 | `-6` | dB | -12 … 0 |
| `channelPhase` | `channel_phase` | number / 1 | `0` | deg | -180 … 180 |
| `channelSync` | `channel_sync` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Wow Flutter

An effect that adds subtle pitch variations to your music, similar to the natural wavering sound you might remember from vinyl records or cassette tapes. This creates a warm, nostalgic feeling that many people find pleasing and relaxing.

### Listening Experience Guide
- Vinyl Record Experience:
  - Recreates the gentle wavering of turntables
  - Adds organic movement to the sound
  - Creates a cozy, nostalgic atmosphere
- Cassette Tape Memory:
  - Simulates the characteristic flutter of tape decks
  - Adds vintage tape deck character
  - Perfect for lo-fi and retro vibes
- Creative Atmosphere:
  - Creates dreamy, underwater-like effects
  - Adds movement and life to static sounds
  - Perfect for ambient and experimental listening

### System Presets

Click **Effect Presets** in the effect header to compare complete transport behaviors.

- **Warped Record** - Deep, cyclic record warp.
- **Worn Cassette Motor** - Faster flutter with irregular movement.
- **Seasick Tape** - Extreme slow motion with independent stereo movement.

### Parameters
- **Rate** - How fast the sound wavers (0.1 to 20 Hz)
  - Slower (0.1-2 Hz): Vinyl record-like movement
  - Medium (2-6 Hz): Cassette tape-like flutter
  - Faster (6-20 Hz): Creative effects
- **Depth** - How strongly the delay time is modulated, which makes the pitch waver (0 to 40 ms)
  - Subtle (0-6 ms): Gentle vintage character
  - Medium (6-15 ms): Clearly audible tape/vinyl feel
  - Strong (15-40 ms): Dramatic special effects
- **Ch Phase** - Phase difference between stereo channels (-180 to 180 degrees)
  - 0°: Both channels waver together
  - 90° or -90°: Creates a swirling, rotating effect
  - 180° or -180°: Channels waver in opposite directions
- **Randomness** - How irregular the wavering becomes (0 to 40 ms)
  - Low: More predictable, regular movement
  - Medium: Natural vintage variation
  - High: More unstable, worn equipment sound
- **Randomness Cutoff** - How quickly the random changes happen (0.1 to 20 Hz)
  - Lower: Slower, more gentle changes
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

1. Classic Vinyl Experience
   - Rate: 0.3-0.8 Hz (slow, gentle movement)
   - Depth: 2-6 ms
   - Randomness: 1-4 ms
   - Randomness Cutoff: 0.5-3 Hz
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Perfect for: Jazz, Classical, Vintage Rock

2. Retro Cassette Feel
   - Rate: 4-6 Hz (faster flutter)
   - Depth: 1-3 ms
   - Randomness: 1-5 ms
   - Randomness Cutoff: 3-8 Hz
   - Ch Phase: 0-30°
   - Ch Sync: 80-100%
   - Perfect for: Lo-Fi, Pop, Rock

3. Dreamy Atmosphere
   - Rate: 1-2 Hz
   - Depth: 25-30 ms
   - Randomness: 20-25 ms
   - Ch Phase: 90-180°
   - Ch Sync: 50-70%
   - Perfect for: Ambient, Electronic, Experimental

4. Subtle Enhancement
   - Rate: 1-2 Hz
   - Depth: 2-5 ms
   - Randomness: 1-3 ms
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Perfect for: Any music needing gentle vintage character

### Quick Start Guide

1. For a Natural Vintage Sound:
   - Start with slow Rate (0.5-1 Hz)
   - Add light Depth (2-6 ms)
   - Include a little Randomness (1-4 ms)
   - Use Randomness Cutoff around 0.5-3 Hz
   - Keep Ch Phase at 0° and Ch Sync at 100%
   - Adjust to taste

2. For More Character:
   - Increase Depth gradually
   - Add more Randomness
   - Experiment with different Ch Phase settings
   - Reduce Ch Sync for more stereo variation
   - Trust your ears

Remember: The goal is to add pleasant vintage character to your music. Start subtle and adjust until you find the sweet spot that enhances your listening experience!

[Back to all effects](/dsp/effects/)
