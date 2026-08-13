---
layout: dsp
title: "FDN Reverb — EffeTune DSP"
description: "Creates reverberation with a feedback delay network."
lang: en
permalink: /dsp/effects/fdn-reverb/
---
# FDN Reverb

Semantic type: `FDNReverb` · Category: reverb

Creates reverberation with a feedback delay network.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `reverbTime` | `reverb_time` | number / 1 | `1.2` | s | 0.2 … 10 |
| `density` | `density` | integer / 1 | `8` | lines | 4 … 8 |
| `preDelay` | `pre_delay` | number / 1 | `10` | ms | 0 … 100 |
| `baseDelay` | `base_delay` | number / 1 | `20` | ms | 10 … 60 |
| `delaySpread` | `delay_spread` | number / 1 | `5` | ms | 0 … 25 |
| `highFrequencyDamp` | `high_frequency_damp` | number / 1 | `6` | dB/s | 0 … 12 |
| `lowCut` | `low_cut` | integer / 1 | `100` | Hz | 20 … 500 |
| `modulationDepth` | `modulation_depth` | number / 1 | `3` | ct | 0 … 10 |
| `modulationRate` | `modulation_rate` | number / 1 | `0.3` | Hz | 0.1 … 5 |
| `diffusion` | `diffusion` | integer / 1 | `100` | % | 0 … 100 |
| `wetMix` | `wet_mix` | integer / 1 | `30` | % | 0 … 100 |
| `dryMix` | `dry_mix` | integer / 1 | `100` | % | 0 … 100 |
| `stereoWidth` | `stereo_width` | integer / 1 | `100` | % | 0 … 200 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## FDN Reverb

FDN Reverb adds a dense, natural-sounding decay. Use it to give dry or close recordings a clearer sense of room size and distance.

Routing note: FDN Reverb is a stereo reverb model with one shared feedback tank. When routed with more than two channels, each routed channel advances that shared tank in sequence rather than using independent per-channel tanks. Channel 1 receives the left wet signal, and channels 2+ receive the right wet signal.

### Listening Experience Guide
- Natural Room Feel:
  - Creates the sensation of listening in real acoustic spaces
  - Adds depth and dimension to your music
  - Makes stereo recordings feel more spacious and alive
- Atmospheric Enhancement:
  - Transforms flat recordings into immersive experiences
  - Adds beautiful tail and sustain to musical notes
  - Creates a sense of being in the performance space
- Customizable Ambience:
  - Adjustable from intimate rooms to grand concert halls
  - Fine control over the character and color of the space
  - Gentle modulation adds natural movement and life

### Parameters
- **Reverb Time** - How long the reverb effect lasts (0.20 to 10.00 s)
  - Short (0.2-1.0s): Quick, controlled decay for clarity
  - Medium (1.0-3.0s): Natural room-like reverberation
  - Long (3.0-10.0s): Expansive, atmospheric tails
- **Density** - Number of echo paths for complexity (4 to 8 lines)
  - 4 lines: Simpler, more defined individual echoes
  - 6 lines: Good balance of complexity and clarity
  - 8 lines: Maximum smoothness and density
- **Pre Delay** - Initial silence before reverb begins (0.0 to 100.0 ms)
  - 0-20ms: Immediate reverb, intimate feeling
  - 20-50ms: Natural sense of room distance
  - 50-100ms: Creates impression of larger spaces
- **Base Delay** - Foundation timing for the reverb network (10.0 to 60.0 ms)
  - Lower values: Tighter, more focused reverb character
  - Higher values: More spacious, open sound quality
  - Affects the fundamental timing relationships
- **Delay Spread** - Adds progressive timing variation between delay lines on top of small per-line random offsets (0.0 to 25.0 ms)
  - 0.0ms: Uses the base delay plus small randomized line offsets, so the reflections still stay slightly irregular
  - Higher values: Adds more progressive spread between lines for a larger, less regular tail
  - Adds realistic variation found in real acoustic spaces
- **HF Damp** - How high frequencies fade over time (0.0 to 12.0 dB/s)
  - 0.0: No damping, bright sound throughout decay
  - 3.0-6.0: Natural air absorption simulation
  - 12.0: Heavy damping for warm, mellow character
- **Low Cut** - Removes low frequencies from reverb (20 to 500 Hz)
  - 20-50Hz: Full bass response in reverb
  - 100-200Hz: Controlled bass to avoid muddiness
  - 300-500Hz: Tight, clear low end
- **Mod Depth** - Amount of pitch modulation for chorus effect (0.0 to 10.0 cents)
  - 0.0: No modulation, pure static reverb
  - 2.0-5.0: Subtle movement that adds life and realism
  - 10.0: Noticeable chorus-like effect
- **Mod Rate** - Speed of the modulation (0.10 to 5.00 Hz)
  - 0.1-0.5Hz: Very slow, gentle movement
  - 1.0-2.0Hz: Natural-sounding variation
  - 3.0-5.0Hz: Fast, more obvious modulation
- **Diffusion** - Controls how much of the mixed feedback is returned to the delay network (0 to 100%)
  - 0%: Disables feedback diffusion; the sound becomes much sparser and the reverb tail is greatly reduced
  - 50%: Balanced diffusion for natural sound
  - 100%: Maximum feedback diffusion for the smoothest density
- **Wet Mix** - Amount of reverb added to the sound (0 to 100%)
  - 10-30%: Subtle spatial enhancement
  - 30-60%: Noticeable reverb presence
  - 60-100%: Dominant reverb effect
- **Dry Mix** - Amount of original signal preserved (0 to 100%)
  - Usually kept at 100% for normal listening
  - Can be reduced for special atmospheric effects
- **Stereo Width** - Blends the wet reverb from mono toward separate left/right wet taps (0 to 200%)
  - 0%: Wet reverb appears in the center (mono)
  - 100%: Default moderate wet stereo width
  - 200%: Full left/right wet tap separation, not extra side amplification

### Recommended Settings for Different Listening Experiences

1. Classical Music Enhancement
   - Reverb Time: 2.5-3.5s
   - Density: 8 lines
   - Pre Delay: 30-50ms
   - HF Damp: 4.0-6.0
   - Useful for: Orchestral recordings, chamber music

2. Jazz Club Atmosphere
   - Reverb Time: 1.2-1.8s
   - Density: 6 lines
   - Pre Delay: 15-25ms
   - HF Damp: 2.0-4.0
   - Useful for: Acoustic jazz, intimate performances

3. Pop/Rock Enhancement
   - Reverb Time: 1.0-2.0s
   - Density: 6-7 lines
   - Pre Delay: 10-30ms
   - Wet Mix: 20-40%
   - Useful for: Recordings that need a little more space

4. Ambient Soundscapes
   - Reverb Time: 4.0-8.0s
   - Density: 8 lines
   - Mod Depth: 3.0-6.0
   - Wet Mix: 60-80%
   - Useful for: Atmospheric music and long decays

### Quick Start Guide

1. Set the Space Character
   - Start with Reverb Time to match your desired space size
   - Set Density to 6-8 for smooth, natural sound
   - Adjust Pre Delay to control distance perception

2. Shape the Tone
   - Use HF Damp to simulate natural air absorption
   - Set Low Cut to prevent bass buildup
   - Adjust Diffusion for smoothness (try 70-100%)

3. Add Natural Movement
   - Set Mod Depth to 2-4 cents for subtle life
   - Use Mod Rate around 0.3-1.0 Hz for gentle variation
   - Adjust Stereo Width for spatial impression

4. Balance the Effect
   - Start with 30% Wet Mix
   - Keep Dry Mix at 100% for normal listening
   - Fine-tune based on your music and preferences

Start with a low Mix value, then increase it until the added space is audible without masking detail in the recording.

[Back to all effects](/dsp/effects/)
