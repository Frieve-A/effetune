---
layout: dsp
title: "Hi Pass Filter — EffeTune DSP"
description: "Attenuates frequencies below a configurable cutoff."
lang: en
permalink: /dsp/effects/hi-pass-filter/
---
# Hi Pass Filter

Semantic type: `HiPassFilter` · Category: eq

Attenuates frequencies below a configurable cutoff.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `frequency` | `frequency` | number / 1 | `1000` | Hz | 10 … 40000 |
| `slope` | `slope` | integer / 1 | `-24` | dB/oct | `0`, `-12`, `-24`, `-36`, `-48`, `-60`, `-72`, `-84`, `-96` |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Hi Pass Filter

A precision high-pass filter that removes unwanted low frequencies while preserving the clarity of higher frequencies. Based on Linkwitz-Riley filter design for optimal phase response and transparent sound quality.

### Listening Enhancement Guide
- Remove Unwanted Rumble:
  - Set frequency between 20-40Hz to eliminate subsonic noise
  - Use steeper slopes (-24dB/oct or higher) for cleaner bass
  - Ideal for vinyl recordings or live performances with stage vibrations
- Clean Up Bass-Heavy Music:
  - Set frequency between 60-100Hz to tighten bass response
  - Use moderate slopes (-12dB/oct to -24dB/oct) for natural transition
  - Helps prevent speaker overload and improves clarity
- Create Special Effects:
  - Set frequency between 200-500Hz for a thinner, low-cut voice effect
  - Use steep slopes (-48dB/oct or higher) for dramatic filtering
  - For a telephone-like voice effect, combine with Lo Pass Filter around 3-4kHz

### Parameters
- **Frequency (Hz)** - Controls where low frequencies are filtered out (10Hz to 40000Hz; the effective upper limit also depends on the audio sample rate)
  - Lower values: Only the very lowest frequencies are removed
  - Higher values: More low frequencies are removed
  - Adjust based on the specific low-frequency content you want to eliminate
- **Slope** - Controls how aggressively frequencies below the cutoff are reduced
  - Off: No filtering applied
  - -12dB/oct: Gentle filtering (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: Standard filtering (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: Stronger filtering (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: Very strong filtering (LR8 - 8th order Linkwitz-Riley)
  - -60dB/oct to -96dB/oct: Extremely steep filtering for special applications

### Visual Display
- Real-time frequency response graph with logarithmic frequency scale
- Clear visualization of the filter slope and cutoff point
- Interactive controls for precise adjustment
- Frequency grid with markers at key reference points

[Back to all effects](/dsp/effects/)
