---
layout: dsp
title: "Polarity Inversion — EffeTune DSP"
description: "Inverts the polarity of the selected channels."
lang: en
permalink: /dsp/effects/polarity-inversion/
---
# Polarity Inversion

Semantic type: `PolarityInversion` · Category: basics

Inverts the polarity of the selected channels.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

This effect has no semantic parameters.



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Polarity Inversion

A utility that flips the polarity of the audio signal. Inverting all channels usually does not change what you hear by itself, but it can help when one speaker, cable, or channel appears to be wired with opposite polarity.

To fix a suspected left/right or multi-channel polarity mismatch, limit the processed channels in the effect's common routing settings and invert only the affected channel.

### When to Use
- When the center image sounds weak, hollow, or spread out because one channel may have opposite polarity
- When checking or correcting speaker, cable, or channel polarity in a playback setup
- When combining it with routing or stereo effects that need one channel's polarity reversed

[Back to all effects](/dsp/effects/)
