---
layout: dsp
title: "Power Amp Sag — EffeTune DSP"
description: "Models level-dependent power-supply sag and recovery."
lang: en
permalink: /dsp/effects/power-amp-sag/
---
# Power Amp Sag

Semantic type: `PowerAmpSag` · Category: dynamics

Models level-dependent power-supply sag and recovery.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `sagSensitivity` | `sag_sensitivity` | number / 1 | `3` | dB | -18 … 18 |
| `powerStability` | `power_stability` | integer / 1 | `50` | % | 0 … 100 |
| `recoverySpeed` | `recovery_speed` | integer / 1 | `40` | % | 0 … 100 |
| `monoblock` | `monoblock` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Power Amp Sag

Simulates the voltage sag behavior of power amplifiers under high load conditions. This effect creates amplifier-like dynamic compression by gently dipping the level on demanding musical passages, then recovering as the passage relaxes.

### Listening Enhancement Guide
- Vintage Audio Systems:
  - Recreates classic amplifier character with natural compression
  - Adds gentle amplifier-like compression to loud passages
  - Useful when you want a softer, less rigid response on peaks
- Rock/Pop Music:
  - Enhances punch and presence during powerful passages
  - Adds natural compression without harshness
  - Creates a slight level dip and recovery on powerful sections
- Classical Music:
  - Gently softens orchestral crescendos without hard limiting
  - Softens strong string and brass peaks
  - Enhances realism of amplified performances
- Jazz Music:
  - Recreates classic amplifier compression behavior
  - Adds subtle compression movement to solo-focused recordings
  - Maintains natural dynamic flow

### System Presets

Click **Effect Presets** in the effect header to start with a complete power-supply behavior.

- **Vintage Tube Sag** - Deep sag and slow recovery.
- **Modern Monoblocks** - A stable independent-supply response.
- **Pushed Combo** - A strong shared-supply dip and recovery.

### Parameters

- **Sensitivity** (-18.0dB to +18.0dB)
  - Controls how sensitive the sag effect is to input levels
  - Higher values: More sag at lower volumes
  - Lower values: Only affects loud signals
  - Start with 0dB for natural response

- **Stability** (0% to 100%)
  - Simulates power supply capacitance size
  - Lower values: Smaller capacitors (more dramatic sag)
  - Higher values: Larger capacitors (more stable voltage)
  - Physically represents the energy storage capacity of the power supply
  - 50% provides balanced character

- **Recovery Speed** (0% to 100%)
  - Controls the power supply's recharge capability
  - Lower values: Slower recharge rate (sustained compression)
  - Higher values: Faster recharge rate (quicker recovery)
  - Physically represents the charging circuit's current delivery capability
  - 40% provides natural behavior

- **Monoblock** (Checkbox)
  - Enables independent processing per channel
  - Unchecked: Shared power supply (stereo amplifier)
  - Checked: Independent supplies (monoblock configuration)
  - Use for better channel separation and imaging

### Visual Display

- Dual real-time graphs showing input envelope and gain reduction
- Input envelope (green): Signal energy driving the effect
- Gain reduction (white): Amount of voltage sag applied
- Time-based display with 1-second reference markers
- Current values displayed in real-time

### Recommended Settings

#### Vintage Character
- Sensitivity: +3.0dB
- Stability: 30% (smaller capacitors)
- Recovery Speed: 25% (slower recharge)
- Monoblock: Unchecked

#### Modern Hi-Fi Enhancement
- Sensitivity: 0.0dB
- Stability: 70% (larger capacitors)
- Recovery Speed: 60% (faster recharge)
- Monoblock: Checked

#### Dynamic Rock/Pop
- Sensitivity: +6.0dB
- Stability: 40% (moderate capacitors)
- Recovery Speed: 50% (moderate recharge)
- Monoblock: Unchecked

[Back to all effects](/dsp/effects/)
