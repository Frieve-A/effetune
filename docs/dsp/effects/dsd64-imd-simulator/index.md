---
layout: dsp
title: "DSD64 IMD Simulator — EffeTune DSP"
description: "Models ultrasonic-noise intermodulation artifacts associated with DSD64 playback."
lang: en
permalink: /dsp/effects/dsd64-imd-simulator/
---
# DSD64 IMD Simulator

Semantic type: `DSD64IMDSimulator` · Category: lo-fi

Models ultrasonic-noise intermodulation artifacts associated with DSD64 playback.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Simulation activation: **88200 Hz or higher**; lower rates are accepted and use dry passthrough
- Effective delay on the active processing path: **63 samples**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `amount` | `amount` | number / 1 | `24` | dB | -40 … 50 |
| `dryWet` | `dry_wet` | integer / 1 | `50` | % | 0 … 100 |
| `ultrasonicLevel` | `ultrasonic_level` | number / 1 | `-30` | dBFS RMS | -48 … -18 |
| `noiseColor` | `noise_color` | integer / 1 | `0` | % | -100 … 100 |
| `analogNonlinearity` | `analog_nonlinearity` | number / 1 | `1.4` | % | 0 … 10 |
| `evenBias` | `even_bias` | integer / 1 | `20` | % | 0 … 100 |
| `signalCoupling` | `signal_coupling` | integer / 1 | `150` | % | 0 … 200 |
| `scratchTone` | `scratch_tone` | number / 1 | `10.5` | kHz | 3 … 14 |
| `noiseTexture` | `noise_texture` | integer / 1 | `25` | % | 0 … 100 |
| `crossSideband` | `cross_sideband` | integer / 1 | `75` | % | 0 … 100 |
| `imdPathHpf` | `imd_path_hpf` | number / 1 | `0` | kHz | 0 … 8 |
| `outputTrim` | `output_trim` | number / 1 | `0` | dB | -24 … 12 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## DSD64 IMD Simulator

An effect that recreates a subtle, often-debated side effect of DSD64 playback: the ultrasonic noise that DSD carries above the audible range can, through the small imperfections of real DACs, amplifiers, and speakers, create intermodulation distortion (IMD) — extra grit and tones that fall back down into the range you can hear. This effect reproduces that audible result so you can hear and adjust it. It is a simulation and does not generate a real DSD stream.

**This effect requires a sample rate of 88.2 kHz or higher** (88.2 / 96 / 176.4 / 192 kHz). At 44.1 / 48 kHz it cannot work and is bypassed (the dry signal passes through unchanged) with a warning shown. Set the sample rate to 88.2 kHz or higher in the app's audio settings to use this effect.

### Sound Character Guide
- Very subtle "digital grit": a faint, constant sandy noise floor plus a fine harshness that follows the music.
- Demonstration tool: makes the usually-inaudible DSD64 ultrasonic IMD audible and adjustable.
- Creative texture: with higher Amount and Analog Nonlinearity it becomes an obvious lo-fi scratch/edge effect.

### Parameters

Main parameters
- **Amount** (-40.0 to +50.0 dB) - Overall level of the generated distortion.
- **Dry-Wet** (100:0 to 0:100) - Balance of dry signal to generated distortion, shown as a dry:wet ratio. 100:0 = dry only; 100:100 (center) = full dry plus full distortion; 0:100 = distortion only.
- **Ultrasonic Level** (-48.0 to -18.0 dBFS RMS) - Level of the simulated DSD ultrasonic noise. More noise produces more distortion.
- **Noise Color** (-100 to +100%) - Moves the ultrasonic noise lower or higher in frequency and tilts its balance.
- **Analog Nonlinearity** (0.00 to 10.00%) - How imperfect (non-linear) the simulated analog gear is. Higher values produce more distortion.
- **Even Bias** (0 to 100%) - Balances the make-up of the distortion. Lower values favor distortion that follows the music (Attached); higher values favor the constant, noise-like distortion (Additive) plus the Cross component.
- **Signal Coupling** (0 to 200%) - Strength of the music-dependent distortion (Attached and Cross). At 0, only the constant Additive noise remains.
- **IMD Path HPF** (0.0 to 8.0 kHz) - Limits distortion generation to frequencies above this point. 0.0 = Off (full-range, like an amplifier); around 2.5 kHz emulates a system where only the tweeter produces the distortion. The dry signal is never affected.
- **Scratch Tone** (3.0 to 14.0 kHz) - Center frequency of the audible "scratch" character.

Advanced / utility parameters
- **Noise Texture** (0 to 100%) - Adds resonant ripple to the ultrasonic noise for a slightly different texture.
- **Cross Sideband** (0 to 100%) - Amount of distortion created by the music mixing with the ultrasonic noise.
- **Output Trim** (-24.0 to +12.0 dB) - Final output level adjustment.

### Visualizations
- **Term Contribution meters** - Real-time levels of each part of the effect:
  - **Additive** - the constant noise-only distortion, present even with no input.
  - **Attached** - distortion that sticks to and follows the music.
  - **Cross** - distortion from the music mixing with the ultrasonic noise.
  - **Total IMD** - the combined distortion that is generated.
  - **Output** - the final output level (dry plus distortion, after Dry-Wet and Output Trim).
- **Analog Transfer Curve** - Shows the distortion curve created by Analog Nonlinearity and Even Bias, in the same in/out style as the Saturation plugins.
- **Difference-Frequency view** - A static graph showing which audible frequencies the ultrasonic noise produces, based on the current noise settings.

### Recommended Settings
- Subtle (default): Amount +24 dB, Ultrasonic Level -30 dBFS, Analog Nonlinearity 1.40%, Even Bias 20%, Signal Coupling 150%, Cross Sideband 75%, Scratch Tone 10.5 kHz.
- Tweeter-only IMD: IMD Path HPF 2.5 kHz, Signal Coupling 80–150%, Cross Sideband 50–100%, Scratch Tone 9–14 kHz.
- Obvious effect: raise Amount, Ultrasonic Level, and Analog Nonlinearity.

[Back to all effects](/dsp/effects/)
