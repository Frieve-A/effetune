---
layout: dsp
title: "Hard Clipping — EffeTune DSP"
description: "Limits waveform amplitude abruptly at a configurable threshold."
lang: en
permalink: /dsp/effects/hard-clipping/
---
# Hard Clipping

Semantic type: `HardClipping` · Category: saturation

Limits waveform amplitude abruptly at a configurable threshold.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `threshold` | `threshold` | number / 1 | `-18` | dB | -60 … 0 |
| `mode` | `mode` | string / 1 | `"both"` | Not declared in catalog | `both`, `positive`, `negative` |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Hard Clipping

A digital clipping effect that limits peaks above a set threshold. Use it when you want extra edge, density, or creative distortion; keep the threshold high for light peak control and lower it gradually for stronger character.

### Listening Enhancement Guide
- Subtle Enhancement:
  - Adds a little edge and density when Threshold stays high
  - Can trim sharp peaks when used lightly
  - Compare with bypass because clipping can become harsh if pushed too far
- Moderate Effect:
  - Creates a more energetic sound
  - Adds excitement to rhythmic elements
  - Makes the music feel more "driven"
- Creative Effect:
  - Creates dramatic sound transformations
  - Adds aggressive character to the music
  - Perfect for experimental listening

### Parameters
- **Threshold** - Controls how much of the sound is affected (-60dB to 0dB)
  - Higher values (-6dB to 0dB): Light peak control or subtle edge
  - Middle values (-24dB to -6dB): Notable clipping character and density
  - Lower values (-60dB to -24dB): Heavy distortion and dramatic effect
- **Mode** - Chooses which parts of the sound to affect
  - Both Sides: Clips positive and negative peaks symmetrically; the most predictable mode
  - Positive Only: Clips only positive peaks, creating asymmetrical clipping and a different tonal character
  - Negative Only: Clips only negative peaks, creating asymmetrical clipping with a different feel from Positive Only

### Visual Display
- Real-time graph showing how the sound is being shaped
- Clear visual feedback as you adjust settings
- Reference lines to help guide your adjustments

### Listening Tips
- For subtle enhancement:
  1. Start with Threshold at 0dB
  2. Use "Both Sides" mode
  3. Lower it gradually toward -3dB to -6dB and stop when the effect is just audible
- For creative effects:
  1. Lower the Threshold gradually
  2. Try different Modes
  3. Combine with other effects for unique sounds

[Back to all effects](/dsp/effects/)
