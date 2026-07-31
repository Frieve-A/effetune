---
layout: dsp
title: "Stereo Blend — EffeTune DSP"
description: "Blends stereo channels to adjust width and channel separation."
lang: en
permalink: /dsp/effects/stereo-blend/
---
# Stereo Blend

Semantic type: `StereoBlend` · Category: spatial

Blends stereo channels to adjust width and channel separation.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `stereo` | `stereo` | number / 1 | `60` | % | -200 … 200 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Stereo Blend

An effect that helps achieve a more natural sound field by adjusting the stereo width of your music. It's particularly useful for headphone listening, where it can reduce the exaggerated stereo separation that often occurs with headphones, making the listening experience more natural and less fatiguing. It can also enhance the stereo image for speaker listening when needed.

### Listening Enhancement Guide
- Headphone Optimization:
  - Reduce stereo width (60-90%) for more natural, speaker-like presentation
  - Minimize listening fatigue from excessive stereo separation
  - Create a more realistic front-focused soundstage
- Speaker Enhancement:
  - Maintain original stereo image (100%) for accurate reproduction
  - Subtle enhancement (110-130%) for wider soundstage when needed
  - Careful adjustment to maintain natural sound field
- Sound Field Control:
  - Focus on natural, realistic presentation
  - Avoid excessive width that could sound artificial
  - Use negative width only for corrective or creative side-polarity inversion
  - Optimize for your specific listening environment

### Parameters
- **Stereo** - Controls the stereo width (-200% to 200%)
  - Negative values: Invert the polarity of the stereo side (L-R) component before reconstruction
  - -200%: Maximum width with inverted side polarity; use only for correction or special cases
  - -100%: Original stereo width with the left/right image swapped
  - 0%: Full mono (left and right channels summed)
  - 100%: Original stereo image
  - 200%: Maximum width enhancement; keeps the center component while strongly boosting the stereo side difference

### Recommended Settings for Different Listening Scenarios

1. Headphone Listening (Natural)
   - Stereo: 60-90%
   - Effect: Reduced stereo separation
   - Perfect for: Long listening sessions, reducing fatigue

2. Speaker Listening (Reference)
   - Stereo: 100%
   - Effect: Original stereo image
   - Perfect for: Accurate reproduction

3. Speaker Enhancement
   - Stereo: 110-130%
   - Effect: Subtle width enhancement
   - Perfect for: Rooms with close speaker placement

### Music Style Optimization Guide

- Classical Music
  - Headphones: 70-80%
  - Speakers: 100%
  - Benefit: Natural concert hall perspective

- Jazz & Acoustic
  - Headphones: 80-90%
  - Speakers: 100-110%
  - Benefit: Intimate, realistic ensemble sound

- Rock & Pop
  - Headphones: 85-95%
  - Speakers: 100-120%
  - Benefit: Balanced impact without artificial width

- Electronic Music
  - Headphones: 90-100%
  - Speakers: 100-130%
  - Benefit: Controlled spaciousness while maintaining focus

### Quick Start Guide

1. Choose Your Listening Setup
   - Identify whether you're using headphones or speakers
   - This determines your starting point for adjustment

2. Start with Conservative Settings
   - Headphones: Begin at 80%
   - Speakers: Begin at 100%
   - Listen for natural sound placement

3. Fine-tune for Your Music
   - Make small adjustments (5-10% at a time)
   - Focus on achieving natural sound field
   - Pay attention to listening comfort

Remember: The goal is to achieve a natural, comfortable listening experience that reduces fatigue and maintains the intended musical presentation. Avoid extreme settings that might sound impressive at first but become fatiguing over time.

[Back to all effects](/dsp/effects/)
