---
layout: dsp
title: "Crossfeed Filter — EffeTune DSP"
description: "Feeds a filtered portion of each stereo channel into the opposite channel."
lang: en
permalink: /dsp/effects/crossfeed-filter/
---
# Crossfeed Filter

Semantic type: `CrossfeedFilter` · Category: spatial

Feeds a filtered portion of each stereo channel into the opposite channel.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `level` | `level` | number / 1 | `-6` | dB | -60 … 0 |
| `delay` | `delay` | number / 1 | `0.3` | ms | 0 … 1 |
| `lowPassFrequency` | `low_pass_frequency` | number / 1 | `700` | Hz | 100 … 20000 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Crossfeed Filter

A headphone crossfeed filter that simulates the natural acoustic crosstalk that occurs when listening through speakers. This effect helps reduce the exaggerated stereo separation often experienced with headphones, creating a more natural and comfortable listening experience that mimics the way sound reaches our ears in a real acoustic environment.

### Key Features
- Simulates natural acoustic crosstalk for headphone listening
- Adjustable crossfeed level and timing
- Low-pass filtering to mimic frequency-dependent crosstalk
- Stereo-only processing (automatically bypassed for mono or other non-stereo signals)

### System Presets

Click **Effect Presets** in the effect header to choose a complete crossfeed amount for headphone listening.

- **Subtle Blend** - A very light crossfeed that preserves most of the original width.
- **Vintage Receiver** - A moderate crossfeed resembling a traditional headphone adapter.
- **Living Room Speakers** - A strong speaker-like blend for recordings with very wide stereo separation.

### Parameters
- **Level** (-60 dB to 0 dB): Controls the amount of crossfeed signal
  - Lower values (-20 dB to -6 dB): Subtle, natural crossfeed
  - Higher values (-6 dB to 0 dB): More pronounced effect
- **Delay** (0 ms to 1 ms): Simulates the time difference of acoustic crosstalk
  - Lower values (0.1-0.3 ms): Tighter, more focused image
  - Higher values (0.3-1.0 ms): More spacious, speaker-like presentation
- **LPF Freq** (100 Hz to 20000 Hz): Controls the frequency response of crossfeed
  - Lower values (500-1000 Hz): More natural, frequency-dependent crosstalk
  - Higher values (1000-20000 Hz): Broader frequency response

### Starting Points

Use the **Subtle Blend**, **Vintage Receiver**, or **Living Room Speakers** system preset as a complete starting point. Then adjust Level first: lower values preserve more stereo width, while higher values make the speaker-like blend more obvious.

### Application Guide

1. Headphone Optimization
   - Start with conservative settings (-15 dB level, 0.3 ms delay)
   - Adjust level for comfort and naturalness
   - Fine-tune delay for spatial perception
   - Use LPF to control frequency response

2. Music Style Considerations
   - Classical/Jazz: Lower levels (-15 to -10 dB) for natural presentation
   - Rock/Pop: Moderate levels (-12 to -8 dB) can soften hard-panned guitars or vocals while keeping the music lively
   - Electronic or very wide mixes: Use lower to moderate levels (-18 to -10 dB) to keep width, or higher levels only when you want to tame excessive left-right separation

3. Listening Environment
   - Quiet environments: Lower levels for subtle effect
   - Noisy environments: Higher levels for better focus
   - Long listening sessions: Conservative settings to reduce fatigue

### Quick Start Guide

1. Initial Setup
   - Set Level to -12 dB
   - Set Delay to 0.3 ms
   - Set LPF Freq to 700 Hz

2. Fine-tuning
   - Adjust Level for desired crossfeed amount
   - Modify Delay for spatial perception
   - Tune LPF Freq for frequency response

3. Optimization
   - Listen for natural, comfortable presentation
   - Avoid excessive settings that sound artificial
   - Test with various music styles

Remember: The Crossfeed Filter is designed to make headphone listening more natural and comfortable. Start with conservative settings and adjust gradually to find the optimal balance for your listening preferences and music material.

[Back to all effects](/dsp/effects/)
