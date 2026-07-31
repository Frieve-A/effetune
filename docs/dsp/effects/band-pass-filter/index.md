---
layout: dsp
title: "Band Pass Filter — EffeTune DSP"
description: "Retains a configurable frequency band while attenuating frequencies outside it."
lang: en
permalink: /dsp/effects/band-pass-filter/
---
# Band Pass Filter

Semantic type: `BandPassFilter` · Category: eq

Retains a configurable frequency band while attenuating frequencies outside it.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `highPassFrequency` | `high_pass_frequency` | number / 1 | `1000` | Hz | 10 … 40000 |
| `lowPassFrequency` | `low_pass_frequency` | number / 1 | `1000` | Hz | 10 … 40000 |
| `highPassSlope` | `high_pass_slope` | integer / 1 | `-24` | dB/oct | -48 … 0 |
| `lowPassSlope` | `low_pass_slope` | integer / 1 | `-24` | dB/oct | -48 … 0 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Band Pass Filter

A precision band-pass filter that combines high-pass and low-pass filters to allow only frequencies in a specific range to pass through. Based on Linkwitz-Riley filter design for optimal phase response and transparent sound quality.

### Listening Enhancement Guide
- Focus on Vocal Range:
  - Set HPF between 100-300Hz and LPF between 4-8kHz to emphasize vocal clarity
  - Use moderate slopes (-24dB/oct) for natural sound
  - Helps vocals stand out in complex mixes
- Create Special Effects:
  - Set narrow frequency ranges for telephone, radio, or megaphone effects
  - Use steeper slopes (-36dB/oct or higher) for more dramatic filtering
  - Experiment with different frequency ranges for creative sounds
- Clean Up Specific Frequency Ranges:
  - Target problematic frequencies with precise control
  - Use different slopes for high-pass and low-pass sections as needed
  - Perfect for removing both rumble and high-frequency noise simultaneously

### Parameters
- **HPF Frequency (Hz)** - Controls where low frequencies are filtered out (10Hz to 40000Hz; the effective upper limit also depends on the audio sample rate)
  - Lower values: Only the very lowest frequencies are removed
  - Higher values: More low frequencies are removed
  - Adjust based on the specific low-frequency content you want to eliminate
- **HPF Slope** - Controls how aggressively frequencies below the cutoff are reduced
  - Off: No filtering applied
  - -12dB/oct: Gentle filtering (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: Standard filtering (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: Stronger filtering (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: Very strong filtering (LR8 - 8th order Linkwitz-Riley)
- **LPF Frequency (Hz)** - Controls where high frequencies are filtered out (10Hz to 40000Hz; the effective upper limit also depends on the audio sample rate)
  - Lower values: More high frequencies are removed
  - Higher values: Only the very highest frequencies are removed
  - Adjust based on the specific high-frequency content you want to eliminate
- **LPF Slope** - Controls how aggressively frequencies above the cutoff are reduced
  - Off: No filtering applied
  - -12dB/oct: Gentle filtering (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: Standard filtering (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: Stronger filtering (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: Very strong filtering (LR8 - 8th order Linkwitz-Riley)

### Visual Display
- Real-time frequency response graph with logarithmic frequency scale
- Clear visualization of both filter slopes and cutoff points
- Interactive controls for precise adjustment
- Frequency grid with markers at key reference points

[Back to all effects](/dsp/effects/)
