---
layout: dsp
title: "Noise Blender — EffeTune DSP"
description: "Adds a configurable blend of generated noise colors."
lang: en
permalink: /dsp/effects/noise-blender/
---
# Noise Blender

Semantic type: `NoiseBlender` · Category: lo-fi

Adds a configurable blend of generated noise colors.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `noiseType` | `noise_type` | string / 1 | `"pink"` | Not declared in catalog | `white`, `pink`, `brown` |
| `level` | `level` | number / 1 | `-36` | dB | -96 … 0 |
| `perChannel` | `per_channel` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## Noise Blender

An effect that adds atmospheric background texture to your music, similar to the sound of vinyl records or vintage equipment. Perfect for creating cozy, nostalgic atmospheres.

### Sound Character Guide
- Vintage Equipment Sound:
  - Recreates the warmth of old audio gear
  - Adds subtle "life" to digital recordings
  - Creates an authentic vintage feel
- Vinyl Record Experience:
  - Adds that classic record player atmosphere
  - Creates a cozy, familiar feeling
  - Perfect for late-night listening
- Ambient Texture:
  - Adds atmospheric background
  - Creates depth and space
  - Makes digital music feel more organic

### Parameters
- **Noise Type** - Chooses the character of the background texture
  - White: Brighter, more present texture
  - Pink: Warmer, more natural sound
  - Brown: Deeper, softer texture with more low-frequency weight
- **Level** - Controls how noticeable the effect is (-96dB to 0dB)
  - Very Subtle (-96dB to -72dB): Just a hint
  - Gentle (-72dB to -48dB): Noticeable texture
  - Strong (-48dB to -24dB): Dominant vintage character
- **Per Channel** - Creates a more spacious effect
  - On: Wider, more immersive sound
  - Off: More focused, centered texture

[Back to all effects](/dsp/effects/)
