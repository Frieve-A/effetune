---
layout: dsp
title: "Multiband Balance — EffeTune DSP"
description: "Adjusts left-right balance independently across frequency bands."
lang: en
permalink: /dsp/effects/multiband-balance/
---
# Multiband Balance

Semantic type: `MultibandBalance` · Category: spatial

Adjusts left-right balance independently across frequency bands.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `frequency1` | `frequency1` | number / 1 | `100` | Hz | 20 … 500 |
| `frequency2` | `frequency2` | number / 1 | `500` | Hz | 100 … 2000 |
| `frequency3` | `frequency3` | number / 1 | `2000` | Hz | 500 … 8000 |
| `frequency4` | `frequency4` | number / 1 | `8000` | Hz | 1000 … 20000 |
| `balance` | `balance` | number / 5 | `[0,0,0,0,0]` | % | -100 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Multiband Balance

A frequency-dependent balance processor that divides the audio into five bands and lets you shift each band slightly left or right. Use it when bass, vocals, cymbals, or other frequency ranges feel pulled to one side and you want to rebalance only that part of the sound without moving the whole track.

### Key Features
- 5-band frequency-dependent stereo balance control
- High-quality Linkwitz-Riley crossover filters
- Linear balance control for precise stereo adjustment
- Independent processing of left and right channels
- Automatic fade handling when crossover filters are reset

### Parameters

#### Crossover Frequencies
- **Freq 1** (20-500 Hz): Separates low and low-mid bands
- **Freq 2** (100-2000 Hz): Separates low-mid and mid bands
- **Freq 3** (500-8000 Hz): Separates mid and high-mid bands
- **Freq 4** (1000-20000 Hz): Separates high-mid and high bands

#### Band Controls
Each band has independent balance control:
- **Band 1 Bal.** (-100% to +100%): Controls stereo balance of low frequencies
- **Band 2 Bal.** (-100% to +100%): Controls stereo balance of low-mid frequencies
- **Band 3 Bal.** (-100% to +100%): Controls stereo balance of mid frequencies
- **Band 4 Bal.** (-100% to +100%): Controls stereo balance of high-mid frequencies
- **Band 5 Bal.** (-100% to +100%): Controls stereo balance of high frequencies

### Recommended Settings

1. Correct a Treble Pull to the Right
   - Low Band (20-100 Hz): 0% (centered)
   - Low-Mid (100-500 Hz): 0%
   - Mid (500-2000 Hz): 0%
   - High-Mid (2000-8000 Hz): -10% to -25%
   - High (8000+ Hz): -10% to -30%
   - Effect: Moves bright content slightly left while keeping bass and vocals stable

2. Correct a Low-Mid Pull to the Left
   - Low Band: 0%
   - Low-Mid: +10% to +25%
   - Mid: +5% to +15%
   - High-Mid: 0%
   - High: 0%
   - Effect: Moves warm body and lower vocals slightly right without changing the whole stereo image

3. Keep Bass Centered While Adjusting Air
   - Low Band: 0%
   - Low-Mid: 0%
   - Mid: 0%
   - High-Mid: +5% to +15%
   - High: +10% to +20%
   - Effect: Gently moves upper ambience to the right while the low end stays centered

### Application Guide

1. Listening Balance Correction
   - Keep low frequencies (below 100 Hz) centered for stable bass
   - Shift only the frequency range that feels off-center
   - Use small signed values first (about 5-20%)
   - Check mono playback for tonal or level changes

2. Problem Solving
   - Rebalance frequency ranges that feel too far left or right
   - Tighten unfocused bass by centering low frequencies
   - Reduce harsh stereo artifacts in high frequencies
   - Improve recordings where different parts of the sound lean to different sides

3. Creative Listening Effects
   - Create unusual frequency-dependent placement
   - Make high frequencies lean one way while low frequencies stay centered
   - Build a wider-feeling ambience by making small balance shifts in upper bands

4. Stereo Field Adjustment
   - Fine-tune stereo balance per frequency band
   - Correct uneven stereo distribution
   - Avoid treating this as a stereo width control; use Stereo Blend when you want to widen or narrow the whole image
   - Maintain mono compatibility

### Quick Start Guide

1. Initial Setup
   - Start with all bands centered (0%)
   - Set crossover frequencies to standard points:
     * Freq 1: 100 Hz
     * Freq 2: 500 Hz
     * Freq 3: 2000 Hz
     * Freq 4: 8000 Hz

2. Basic Enhancement
   - Keep Band 1 (low) centered
   - Make small adjustments to higher bands
   - Listen for changes in spatial image
   - Check mono compatibility

3. Fine-tuning
   - Adjust crossover points to match your material
   - Make gradual changes to band positions
   - Listen for unwanted artifacts
   - Compare with bypass for perspective

Remember: The Multiband Balance is a powerful tool that requires careful adjustment. Start with subtle settings and increase complexity as needed. Always check your adjustments in both stereo and mono to ensure compatibility.

[Back to all effects](/dsp/effects/)
