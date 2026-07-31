---
layout: dsp
title: "Dattorro Plate Reverb — EffeTune DSP"
description: "Creates a plate-style reverberation using a Dattorro-inspired network."
lang: en
permalink: /dsp/effects/dattorro-plate-reverb/
---
# Dattorro Plate Reverb

Semantic type: `DattorroPlateReverb` · Category: reverb

Creates a plate-style reverberation using a Dattorro-inspired network.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `preDelay` | `pre_delay` | number / 1 | `10` | ms | 0 … 100 |
| `bandwidth` | `bandwidth` | number / 1 | `0.9995` | Not declared in catalog | 0 … 1 |
| `inputDiffusion1` | `input_diffusion1` | number / 1 | `0.75` | Not declared in catalog | 0 … 1 |
| `inputDiffusion2` | `input_diffusion2` | number / 1 | `0.625` | Not declared in catalog | 0 … 1 |
| `decay` | `decay` | number / 1 | `0.5` | Not declared in catalog | 0 … 1 |
| `decayDiffusion1` | `decay_diffusion1` | number / 1 | `0.7` | Not declared in catalog | 0 … 1 |
| `damping` | `damping` | number / 1 | `0.0005` | Not declared in catalog | 0 … 1 |
| `modulationDepth` | `modulation_depth` | number / 1 | `1` | samples | 0 … 16 |
| `modulationRate` | `modulation_rate` | number / 1 | `1` | Hz | 0 … 10 |
| `wetMix` | `wet_mix` | integer / 1 | `30` | % | 0 … 100 |
| `dryMix` | `dry_mix` | integer / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Dattorro Plate Reverb

A classic plate reverb implementation based on Jon Dattorro's renowned algorithm from the 1997 paper "Effect Design, Part 1: Reverberator and Other Filters." This algorithm is celebrated for its lush, smooth sound quality and has become a reference standard in digital reverb design. Perfect for adding rich, shimmering ambience to your music.

Routing note: Dattorro Plate Reverb is a stereo plate model. When routed with more than two channels, all routed input channels feed one shared mono-to-stereo plate, but the wet/dry mix is written only to the first routed stereo pair. Additional channels contribute to the plate input and otherwise pass through unchanged, including when Dry Mix is 0%; they do not receive a wet return and are not independent plate tanks.

### Listening Experience Guide
- Lush Plate Sound:
  - Classic plate reverb character
  - Smooth, dense reverb tail without metallic artifacts
  - Beautiful shimmer and warmth characteristic of plate reverbs
- Versatile Ambience:
  - From subtle room enhancement to expansive halls
  - Works beautifully with any music genre
  - Adds smooth polish and space to music
- Natural Movement:
  - Modulation adds organic life to the reverb
  - Prevents static, artificial-sounding tails
  - Creates a breathing, living space around your music

### Parameters
- **Pre Delay** - Initial silence before reverb begins (0.0 to 100.0 ms control; use values below 100.0 ms for effective pre-delay)
  - 0-10ms: Immediate reverb, intimate feeling
  - 10-30ms: Natural sense of space
  - 30-99.9ms: Creates impression of larger spaces
  - Avoid exactly 100.0ms when you want maximum pre-delay; the current implementation treats that endpoint like no effective pre-delay
- **Bandwidth** - Input signal filtering (0.0 to 1.0)
  - Lower values: Darker, warmer input tone
  - Higher values (near 1.0): Brighter, full-frequency input
  - Default 0.9995: Optimal as suggested by Dattorro
- **Input Diff 1** - First stage input diffusion (0.0 to 1.0)
  - Controls initial smearing of input signal
  - Default 0.75: Recommended value from Dattorro paper
  - Higher values: More diffuse, smoother early reflections
- **Input Diff 2** - Second stage input diffusion (0.0 to 1.0)
  - Further spreads the input signal
  - Default 0.625: Recommended value from Dattorro paper
  - Works with Input Diff 1 to create complex diffusion
- **Decay** - How long the reverb tail lasts (0.0 to 1.0)
  - Low (0.1-0.3): Short, controlled decay
  - Medium (0.4-0.6): Natural room-like decay
  - High (0.7-1.0): Long, expansive tails
- **Decay Diff 1** - Decay diffusion in the tank (0.0 to 1.0)
  - Controls density during decay phase
  - Default 0.70: Recommended value from Dattorro paper
  - Affects the smoothness of the reverb tail
- **Damping** - High frequency absorption over time (0.0 to 1.0)
  - 0.0: No damping, bright reverb throughout
  - 0.0005 (default): Very subtle, natural damping
  - Higher values: Darker, warmer decay
- **Mod Depth** - Amount of delay modulation (0.0 to 16.0 samples)
  - 0.0: No modulation, static reverb
  - 1.0-4.0: Subtle movement, adds life
  - 8.0-16.0: More noticeable chorus-like effect
- **Mod Rate** - Speed of modulation (0.0 to 10.0 Hz)
  - 0.5-1.5Hz: Slow, gentle movement
  - 2.0-4.0Hz: More active modulation
  - Higher values: Fast, shimmering effect
- **Wet Mix** - Amount of reverb added (0 to 100%)
  - 10-30%: Subtle enhancement
  - 30-50%: Noticeable presence
  - 50-100%: Dominant reverb effect
- **Dry Mix** - Amount of original signal (0 to 100%)
  - Usually kept at 100% for normal listening
  - Reduce for special effects or ambient washes

### Recommended Settings for Different Music Styles

1. Classical Piano
   - Decay: 0.6-0.7
   - Damping: 0.001
   - Mod Depth: 1.0
   - Wet Mix: 25-35%
   - Perfect for: Solo piano, chamber music

2. Vocals and Acoustic
   - Decay: 0.4-0.5
   - Damping: 0.002
   - Pre Delay: 15-25ms
   - Wet Mix: 20-30%
   - Perfect for: Vocals, acoustic guitar

3. Ambient and Atmospheric
   - Decay: 0.8-0.95
   - Mod Depth: 4.0-8.0
   - Mod Rate: 0.5-1.0Hz
   - Wet Mix: 50-70%
   - Perfect for: Ambient, electronic, soundscapes

4. General Enhancement
   - Decay: 0.5
   - Damping: 0.0005
   - Mod Depth: 1.0
   - Wet Mix: 20-30%
   - Perfect for: All-around use, subtle polish

### Quick Start Guide

1. Set the Basic Character
   - Start with Decay to control reverb length
   - Adjust Pre Delay for perceived distance
   - Set Wet Mix for desired reverb presence

2. Shape the Tone
   - Use Bandwidth to control input brightness
   - Adjust Damping for high frequency decay
   - Fine-tune diffusion parameters for density

3. Add Movement
   - Set Mod Depth for subtle variation (try 1.0)
   - Adjust Mod Rate for speed (try 1.0Hz)
   - These parameters add life to the reverb

4. Final Balance
   - Adjust Wet/Dry mix to taste
   - Trust your ears for the final settings
   - The default values are a great starting point

The Dattorro Plate Reverb brings a classic plate-style ambience to your listening experience. Its smooth, lush character makes it useful for adding beautiful, natural-sounding space to a recording.

[Back to all effects](/dsp/effects/)
