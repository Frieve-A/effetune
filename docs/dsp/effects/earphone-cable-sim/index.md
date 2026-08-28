---
layout: dsp
title: "Earphone Cable Sim — EffeTune DSP"
description: "Models the frequency response caused by earphone cable impedance."
lang: en
permalink: /dsp/effects/earphone-cable-sim/
---
# Earphone Cable Sim

Semantic type: `EarphoneCableSim` · Category: eq

Models the frequency response caused by earphone cable impedance.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `outputImpedance` | `output_impedance` | number / 1 | `0.5` | ohm | 0 … 20 |
| `cableResistance` | `cable_resistance` | number / 1 | `0.3` | ohm | 0 … 2 |
| `cableInductance` | `cable_inductance` | number / 1 | `0.5` | uH | 0 … 5 |
| `voiceCoilInductance` | `voice_coil_inductance` | number / 1 | `0.2` | mH | 0.01 … 2 |
| `baseImpedance` | `base_impedance` | number / 1 | `16` | ohm | 4 … 64 |
| `resonanceFrequency` | `resonance_frequency` | number / 5 | `[120,2000,5000,9000,60]` | Hz | 20 … 20000 |
| `resonanceQ` | `resonance_q` | number / 5 | `[2,1.5,2,3,1.5]` | Not declared in catalog | 0.5 … 10 |
| `resonanceImpedance` | `resonance_impedance` | number / 5 | `[48,36,64,80,64]` | ohm | 16 … 116 |
| `resonanceEnabled` | `resonance_enabled` | boolean / 5 | `[true,false,false,false,false]` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Earphone Cable Sim

Reproduces the small frequency-response shifts that appear when an earphone is driven by an amplifier through real cable resistance/inductance and non-zero output impedance. Because an earphone's impedance varies with frequency (driver resonances plus voice-coil inductance), source and cable impedance create earphone-specific level changes. This is useful as a reality check: with cables of normal construction and quality, ordinary amplifier output impedance, and earphones that are not unusually low in impedance or otherwise abnormal, the audible change from ordinary earphone-cable differences is generally small enough to be negligible. The effect is strongest with low-impedance earphones that have large impedance peaks, and is usually subtle with modern low-output-impedance amplifiers.

### Listening Enhancement Guide
- Evaluate Source-Impedance Interaction:
  - Raise Output Z to emulate tube amps or high-impedance headphone outputs
  - Compare with bypass to hear how bass and impedance-peak regions change
- Explore Multi-Driver Earphone Behavior:
  - Enable additional Resonances to model balanced-armature or hybrid earphones with multiple impedance peaks
  - Larger impedance peaks combined with higher source impedance create stronger coloration
- Simulate Cable Resistance and Inductance:
  - Increase Cable R to emulate longer or thinner cables with higher DC resistance
  - Increase Cable L to emulate higher-inductance cables; its effect is mainly in the upper treble
  - Cable R adds to the total series resistance, so it can strengthen the interaction across the band
- Check Normal Cable Audibility:
  - Use realistic Cable R and Cable L values, then compare with bypass to estimate how small ordinary cable differences are
  - If only extreme Output Z, Cable R, or very low Base Z settings make the change obvious, the same comparison suggests normal cables are unlikely to be audibly significant with that earphone and amplifier

### System Presets

Click **Effect Presets** in the effect header to compare complete source-and-cable cases.

- **High Impedance Source** - A high-output-impedance source driving a low-impedance earphone.
- **Long Thin Cable** - Increased cable resistance and inductance.
- **Vintage Portable Out** - A higher-impedance portable output and 32 Ω earphone.

### Parameters
- **Output Z (Ω)** - Amplifier output impedance (0 to 20). Values below 1Ω are typical of modern amplifiers; higher values make impedance-related coloration stronger.
- **Cable R (Ω)** - Cable DC resistance (0 to 2). Higher values represent longer or thinner cables and add to the total series resistance.
- **Cable L (µH)** - Cable inductance (0 to 5). Mainly affects upper-treble response, especially with low-impedance earphones.
- **Voice Coil L (mH)** - Earphone voice-coil inductance (0.01 to 2). Raises load impedance toward high frequencies and changes the high-frequency interaction.
- **Base Z (Ω)** - Nominal earphone impedance at low frequencies (4 to 64). Lower values make source and cable impedance more influential.
- **Resonances (up to 5)** - Each models one impedance peak of the driver. The first is enabled by default; the rest are pre-set to typical driver resonances and can be toggled on.
  - **Enable** - Turn each resonance on or off
  - **Freq (Hz)** - Resonance frequency (20 to 20000)
  - **Q** - Sharpness of the impedance peak (0.5 to 10)
  - **Peak Z (Ω)** - Impedance at the resonance peak (16 to 116)

### Technical Details
- **Physical Model**: Computes `H(f) = Zload / (Zsource + Zload)`, where `Zsource` is the output impedance plus cable resistance/inductance and `Zload` is the earphone impedance (base impedance, voice-coil inductance, and resonance peaks).
- **Realization**: The transfer function is factored and converted to a matched-Z cascade of biquad filters, giving zero latency and minimum-phase behavior comparable to the other EQ plugins.
- **Normalization**: The response is normalized to a 0 dB power average (20Hz to 20kHz) so toggling the effect does not change overall loudness.

### Visual Display
- Real-time graph of the realized filter response on a logarithmic frequency scale
- Grid labels cover 20Hz to 20kHz; the plotted curve extends across the full 10Hz to 40kHz graph range
- Green response curve over a dark grid, with an auto-scaled dB axis around the normalized 0dB reference
- Larger curve deviations indicate where the model changes playback level most

[Back to all effects](/dsp/effects/)
