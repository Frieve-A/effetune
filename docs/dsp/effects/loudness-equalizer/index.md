---
layout: dsp
title: "Loudness Equalizer — EffeTune DSP"
description: "Applies level-dependent frequency compensation based on equal-loudness behavior."
lang: en
permalink: /dsp/effects/loudness-equalizer/
---
# Loudness Equalizer

Semantic type: `LoudnessEqualizer` · Category: eq

Applies level-dependent frequency compensation based on equal-loudness behavior.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `averageSpl` | `average_spl` | number / 1 | `65` | dB | 60 … 96 |
| `relativeVolume` | `relative_volume` | number / 1 | `0` | dB | -30 … 12 |
| `lowGain` | `low_gain` | number / 1 | `10` | dB | 0 … 15 |
| `lowFrequency` | `low_frequency` | integer / 1 | `180` | Hz | 100 … 300 |
| `lowQ` | `low_q` | number / 1 | `0.6` | Not declared in catalog | 0.5 … 1 |
| `highQ` | `high_q` | number / 1 | `0.6` | Not declared in catalog | 0.5 … 1 |
| `highGain` | `high_gain` | number / 1 | `0` | dB | 0 … 15 |
| `highFrequency` | `high_frequency` | integer / 1 | `4000` | Hz | 3000 … 6000 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Loudness Equalizer

A specialized equalizer that links volume adjustment with frequency balance correction. Set Average SPL to the estimated average listening level at 0dB Relative Volume, then use Relative Volume for everyday volume changes. The plugin automatically strengthens the correction as you turn the volume down and reduces it as you turn the volume up.

### Listening Enhancement Guide
- Low Volume Listening:
  - Enhances bass and treble frequencies
  - Maintains musical balance at quiet levels
  - Compensates for human hearing characteristics
- Average SPL Setting:
  - Set it to the estimated average listening level at 0dB Relative Volume
  - This is a manual reference value; the plugin does not measure SPL
- Relative Volume Adjustment:
  - Negative values lower the output level and increase the correction
  - Positive values raise the output level and reduce the correction
  - EQ correction is based on `Average SPL + Relative Volume` and is limited to the 60dB-to-85dB correction range
- Frequency Balance:
  - Low shelf for bass enhancement (100-300Hz)
  - High shelf for treble enhancement (3-6kHz)
  - Smooth transition between frequency ranges

### System Presets

Click **Effect Presets** in the effect header to start from a complete loudness-compensation curve.

- **Late Night Listening** - Stronger compensation for a lower listening level.
- **Quiet Background** - A moderate everyday compensation curve.
- **Near Reference Level** - Minimal compensation around a higher reference level.

### Parameters
- **Average SPL** - Estimated average listening level at 0dB Relative Volume (60dB to 96dB)
  - Set this manually to match the average SPL at your listening position
  - Values above 85dB allow a higher reference level; EQ correction remains off until `Average SPL + Relative Volume` falls below 85dB
- **Relative Volume** - Volume adjustment relative to Average SPL (-30dB to +12dB)
  - 0dB: Output level corresponding to Average SPL
  - Negative values: Lower volume with more loudness correction
  - Positive values: Higher volume with less loudness correction
  - Positive values can cause clipping when the input or EQ boost is already high
- **Low Frequency Controls**
  - Frequency: Bass enhancement center (100Hz to 300Hz)
  - Gain: Maximum bass boost (0dB to 15dB)
  - Q: Shape of bass enhancement (0.5 to 1.0)
- **High Frequency Controls**
  - Frequency: Treble enhancement center (3kHz to 6kHz)
  - Gain: Maximum treble boost (0dB to 15dB)
  - Q: Shape of treble enhancement (0.5 to 1.0)

### Visual Display
- Real-time EQ response graph
- Interactive parameter controls
- Volume-dependent correction curve; the uniform Relative Volume gain is not included in the graph
- Precise numerical readouts

[Back to all effects](/dsp/effects/)
