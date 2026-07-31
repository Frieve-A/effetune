---
layout: dsp
title: "Channel Divider — EffeTune DSP"
description: "Routes an input channel into selected output channels according to its semantic parameters."
lang: en
permalink: /dsp/effects/channel-divider/
---
# Channel Divider

Semantic type: `ChannelDivider` · Category: basics

Routes an input channel into selected output channels according to its semantic parameters.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `bandCount` | `band_count` | integer / 1 | `2` | Not declared in catalog | 2 … 4 |
| `frequency1` | `frequency1` | number / 1 | `2000` | Hz | 10 … 40000 |
| `slope1` | `slope1` | integer / 1 | `-24` | dB/oct | -96 … -12 |
| `frequency2` | `frequency2` | number / 1 | `4000` | Hz | 10 … 40000 |
| `slope2` | `slope2` | integer / 1 | `-24` | dB/oct | -96 … -12 |
| `frequency3` | `frequency3` | number / 1 | `8000` | Hz | 10 … 40000 |
| `slope3` | `slope3` | integer / 1 | `-24` | dB/oct | -96 … -12 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Channel Divider

A specialized tool that splits your stereo signal into separate frequency bands and routes each band to a different stereo output pair. It is useful for multi-amplifier, multi-speaker, or custom crossover playback setups.

To use this effect, you need to use the desktop app, set the number of output channels in the audio settings to 4, 6, or 8 depending on the number of bands, and set the channel in the effect bus routing to "All."

### When to Use
- When using multi-channel audio outputs (4, 6, or 8 channels)
- To create custom frequency-based channel routing
- For multi-amplifier or multi-speaker setups

### Parameters
- **Band Count** - Number of frequency bands to create (2-4 bands)
  - 2 bands: Low/High split, requiring 4 output channels
  - 3 bands: Low/Mid/High split, requiring 6 output channels
  - 4 bands: Low/Mid-Low/Mid-High/High split, requiring 8 output channels
  - Higher band counts are unavailable when the selected output channel count is too low

- **Crossover Frequencies** - Define where audio splits between bands
  - F1: First crossover point
  - F2: Second crossover point (for 3+ bands)
  - F3: Third crossover point (for 4 bands)
  - Each crossover can be set from 10 Hz to 40000 Hz
  - The plugin keeps F1, F2, and F3 in ascending order with at least 1 Hz separation

- **Slopes** - Control how sharply bands are separated
  - Options: -12dB to -96dB per octave
  - Steeper slopes provide cleaner separation
  - Lower slopes offer more natural transitions

### Technical Notes
- Processes first two input channels only
- Output channels must be a multiple of 2 (4, 6, or 8)
- Each band keeps the original stereo pair: 2-band mode outputs Low to channels 1-2 and High to channels 3-4; 3-band mode uses channels 1-2, 3-4, and 5-6; 4-band mode uses channels 1-2, 3-4, 5-6, and 7-8
- Uses high-quality Linkwitz-Riley crossover filters
- Visual frequency response graph for easy configuration

[Back to all effects](/dsp/effects/)
