---
layout: dsp
title: "Simple Jitter — EffeTune DSP"
description: "Applies deterministic seeded sampling-time jitter."
lang: en
permalink: /dsp/effects/simple-jitter/
---
# Simple Jitter

Semantic type: `SimpleJitter` · Category: lo-fi

Applies deterministic seeded sampling-time jitter.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `rmsJitterNanoseconds` | `rms_jitter_nanoseconds` | number / 1 | `100` | ns | 0.001 … 10000000 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Simple Jitter

An effect that adds subtle timing variations to create that imperfect, vintage digital sound. It can make music sound like it's playing through old CD players or vintage digital equipment.

### Sound Character Guide
- Subtle Vintage Feel:
  - Adds gentle instability like old equipment
  - Creates a more organic, less perfect sound
  - Perfect for adding character subtly
- Classic CD Player Sound:
  - Recreates the sound of early digital players
  - Adds nostalgic digital character
  - Great for 90s music appreciation
- Creative Effects:
  - Create unique wobble effects
  - Transform modern sounds into vintage ones
  - Add experimental character

### Parameters
- **RMS Jitter** - Controls the amount of timing variation (1ps to 10ms)
  - Subtle (1-10ps): Gentle vintage character
  - Medium (10-100ps): Classic CD player feel
  - Strong (100ps-1ms): Creative wobble effects

### Recommended Settings for Different Styles

1. Barely Perceptible
   - RMS Jitter: 1-5ps
   - Perfect for: Making playback feel slightly less perfectly digital

2. Classic CD Player Character
   - RMS Jitter: 50-100ps
   - Perfect for: Recreating the sound of early digital playback equipment

3. Vintage DAT Machine
   - RMS Jitter: 200-500ps
   - Perfect for: 90s digital recording equipment character

4. Worn Digital Equipment
   - RMS Jitter: 1-2ns (1000-2000ps)
   - Perfect for: Creating the sound of aging or poorly maintained digital gear

5. Creative Wobble Effect
   - RMS Jitter: 10-100µs (0.01-0.1ms)
   - Perfect for: Experimental effects and noticeable pitch modulation

[Back to all effects](/dsp/effects/)
