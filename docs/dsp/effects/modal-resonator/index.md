---
layout: dsp
title: "Modal Resonator — EffeTune DSP"
description: "Excites configurable resonant modes from the input signal."
lang: en
permalink: /dsp/effects/modal-resonator/
---
# Modal Resonator

Semantic type: `ModalResonator` · Category: resonator

Excites configurable resonant modes from the input signal.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `resonatorEnabled` | `resonator_enabled` | boolean / 5 | `[true,true,true,true,true]` | Not declared in catalog | Not declared in catalog |
| `frequencyLog` | `frequency_log` | number / 5 | `[6.86,7.52,7.99,8.34,8.75]` | Not declared in catalog | 3 … 9.9 |
| `decay` | `decay` | number / 5 | `[15,12,10,8,6]` | ms | 1 … 500 |
| `lowPassLog` | `low_pass_log` | number / 5 | `[7.19,7.86,8.33,8.68,9.08]` | Not declared in catalog | 3 … 9.9 |
| `highPassLog` | `high_pass_log` | number / 5 | `[5.8,6.48,6.94,7.29,7.7]` | Not declared in catalog | 3 … 9.9 |
| `gain` | `gain` | number / 5 | `[0,-3,-6,-9,-12]` | dB | -18 … 18 |
| `mix` | `mix` | number / 1 | `25` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Modal Resonator

An effect that adds tuned resonances to your music, similar to the way physical objects or speaker parts ring at their natural frequencies. Use it when you want extra shimmer, body, metallic color, or speaker-like resonance during listening.

### Listening Experience Guide

- **Metallic Resonance:**
  - Creates bell-like or metallic tones that follow the dynamics of the source material.
  - Useful for adding shimmer or a metallic character to percussion, synths, or full mixes.
  - Use multiple resonators at carefully tuned frequencies with moderate decay times.
- **Tonal Enhancement:**
  - Subtly reinforces specific frequencies in the music.
  - Can accentuate harmonics or add fullness to specific frequency ranges.
  - Use with low mix values (10-20%) for subtle enhancement.
- **Full-Range Speaker Simulation:**
  - Simulates the modal behavior of physical loudspeakers.
  - Recreates the distinctive resonances that occur when drivers divide their vibrations at different frequencies.
  - Helps simulate the characteristic sound of specific speaker types.
- **Special Effects:**
  - Creates unusual timbral qualities and otherworldly textures.
  - Useful when you want an obvious resonance effect rather than natural enhancement.
  - Try extreme settings only when you want the resonances to become part of the sound.

### Parameters

- **Resonator Selection (1-5)** - Five independent resonators that can be enabled/disabled and configured separately.
  - Use multiple resonators for complex, layered resonance effects.
  - Each resonator can target different frequency regions.
  - Try harmonic relationships between resonators for more musical results.

For each resonator:

- **Enable** - Toggles the individual resonator on/off.
- **Freq (Hz)** - Sets the primary resonant frequency (20 to 20,000 Hz).
- **Decay (ms)** - Controls how long the resonance continues after the input sound (1 to 500 ms).
- **LPF Freq (Hz)** - Low-pass filter that shapes the tone of the resonance (20 to 20,000 Hz).
- **HPF Freq (Hz)** - High-pass filter that removes unwanted low frequencies from the resonance (20 to 20,000 Hz).
- **Gain (dB)** - Controls the individual output level of each resonator (-18 to +18 dB).

Global control:

- **Mix (%)** - Balances the combined output of all enabled resonators against the original sound (0 to 100%).

### Recommended Settings for Listening Enhancement

1. **Subtle Speaker Enhancement:**
   - Enable 2-3 resonators
   - Freq settings: 400 Hz, 900 Hz, 1600 Hz
   - Decay: 60-100ms
   - LPF Freq: 2000-4000 Hz
   - Mix: 10-20%

2. **Metallic Character:**
   - Enable 3-5 resonators
   - Freq settings: spread between 1000-6500 Hz
   - Decay: 100-200ms
   - LPF Freq: 4000-8000 Hz
   - Mix: 15-30%

3. **Bass Enhancement:**
   - Enable 1-2 resonators
   - Freq settings: 50-150 Hz
   - HPF Freq: 20-60 Hz, kept below the target resonance
   - Decay: 50-100ms
   - LPF Freq: 1000-2000 Hz
   - Mix: 10-25%

4. **Full-Range Speaker Simulation:**
   - Enable all 5 resonators
   - Freq settings: 100 Hz, 400 Hz, 800 Hz, 1600 Hz, 3000 Hz
   - HPF Freq settings: 20 Hz, 120 Hz, 250 Hz, 500 Hz, 1000 Hz
   - Decay: Progressively shorter from low to high (100ms to 30ms)
   - LPF Freq: Progressively higher from low to high (2000Hz to 4000Hz)
   - Mix: 20-40%

### Quick Start Guide

1. **Choose Resonance Points:**
   - Start by enabling one or two resonators.
   - Set their frequencies to target areas you want to enhance.
   - For more complex effects, add more resonators with complementary frequencies.

2. **Adjust the Character:**
   - Use the `Decay` parameter to control how long resonances sustain.
   - Shape the tone with the `LPF Freq` control.
   - Set `HPF Freq` below the resonance you want to keep, especially for bass settings.
   - Longer decay times create more obvious, bell-like tones.

3. **Blend with Original:**
   - Use `Mix` to balance the effect with your source material.
   - Start with lower mix values (10-20%) for subtle enhancement.
   - Increase for more dramatic effects.

4. **Fine-Tune:**
   - Make small adjustments to frequencies and decay times.
   - Enable/disable individual resonators to find the perfect combination.
   - Remember that subtle changes can have a significant impact on the overall sound.

[Back to all effects](/dsp/effects/)
