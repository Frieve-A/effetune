---
layout: dsp
title: "Stereo Balance — EffeTune DSP"
description: "Adjusts the relative level of the left and right channels."
lang: en
permalink: /dsp/effects/stereo-balance/
---
# Stereo Balance

Semantic type: `StereoBalance` · Category: basics

Adjusts the relative level of the left and right channels.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `balance` | `balance` | number / 1 | `0` | Not declared in catalog | -1 … 1 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Stereo Balance

Lets you adjust how the music is distributed between your left and right speakers or headphones. Perfect for fixing uneven stereo or creating your preferred sound placement.

### Listening Enhancement Guide
- Perfect Balance:
  - Center position for natural stereo
  - Equal volume in both ears
  - Best for most music
- Adjusted Balance:
  - Compensate for room acoustics
  - Adjust for hearing differences
  - Create preferred sound stage

### Parameters
- **Balance** - Controls left-right distribution (-100% to +100%)
  - Center (0%): Equal in both sides
  - Left (-100%): More sound in left
  - Right (+100%): More sound in right

### Visual Display
- Easy-to-use slider
- Clear number display
- Visual indicator of stereo position

### Recommended Uses

1. General Listening
   - Keep balance centered (0%)
   - Adjust if stereo feels uneven
   - Use subtle adjustments

2. Headphone Listening
   - Fine-tune for comfort
   - Compensate for hearing differences
   - Create preferred stereo image

3. Speaker Listening
   - Adjust for room setup
   - Balance for listening position
   - Compensate for room acoustics

[Back to all effects](/dsp/effects/)
