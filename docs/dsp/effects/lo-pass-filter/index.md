---
layout: dsp
title: "Lo Pass Filter — EffeTune DSP"
description: "Attenuates frequencies above a configurable cutoff."
lang: en
permalink: /dsp/effects/lo-pass-filter/
---
# Lo Pass Filter

Semantic type: `LoPassFilter` · Category: eq

Attenuates frequencies above a configurable cutoff.

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

## Lo Pass Filter

A precision low-pass filter that removes unwanted high frequencies while preserving the warmth and body of lower frequencies. Based on Linkwitz-Riley filter design for optimal phase response and transparent sound quality.

### Listening Enhancement Guide
- Reduce Harshness and Sibilance:
  - Set frequency between 8-12kHz to tame harsh recordings
  - Use moderate slopes (-12dB/oct to -24dB/oct) for natural sound
  - Helps reduce listening fatigue with bright recordings
- Warm Up Digital Recordings:
  - Set frequency between 12-16kHz to reduce digital "edge"
  - Use gentle slopes (-12dB/oct) for subtle warming effect
  - Creates a more analog-like sound character
- Create Special Effects:
  - Set frequency between 1-3kHz with a steep slope for a muffled, narrow-band character
  - Use steep slopes (-48dB/oct or higher) for dramatic filtering
  - For a vintage radio effect, combine with Hi Pass Filter to remove low frequencies as well
- Control Noise and Hiss:
  - Set frequency just above the musical content (typically 14-18kHz)
  - Use steeper slopes (-36dB/oct or higher) for effective noise control
  - Reduces tape hiss or background noise while preserving most musical content

### Parameters
- **Frequency (Hz)** - Controls where high frequencies are filtered out (10Hz to 40000Hz; the effective upper limit also depends on the audio sample rate)
  - Lower values: More high frequencies are removed
  - Higher values: Only the very highest frequencies are removed
  - Adjust based on the specific high-frequency content you want to eliminate
- **Slope** - Controls how aggressively frequencies above the cutoff are reduced
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
