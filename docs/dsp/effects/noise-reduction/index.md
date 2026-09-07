---
layout: dsp
title: "Noise Reduction — EffeTune DSP"
description: "Reduces steady background noise."
lang: en
permalink: /dsp/effects/noise-reduction/
---
# Noise Reduction

Semantic type: `NoiseReduction` · Category: restoration

Reduces steady background noise.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `reduction` | `reduction` | number / 1 | `12` | dB | 0 … 24 |
| `sensitivity` | `sensitivity` | number / 1 | `0` | dB | -12 … 12 |
| `smoothing` | `smoothing` | number / 1 | `50` | % | 0 … 100 |
| `trebleCare` | `treble_care` | number / 1 | `50` | % | 0 … 100 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Noise Reduction

Noise Reduction lowers steady background noise such as tape hiss, equipment noise, and room noise. Use it when a recording has a constant layer of noise behind the music. It is most effective on noise that remains present between notes; it is not intended to remove individual clicks, changing background sounds, or other music in the recording.

### Listening Guide

1. Start with the default settings: **Reduction** 12 dB, **Sensitivity** 0 dB, **Smoothing** 50%, **Treble Care** 50%, and **Mix** 100%.
2. Raise **Reduction** slowly until the quiet parts become cleaner. If voices, cymbals, or room ambience begin to sound less natural, lower it again.
3. For obvious continuous hiss, raise **Sensitivity** a little. For a more natural result on already-clean music, lower it.
4. If the noise reduction seems to flutter or change color, raise **Smoothing**. If the music becomes too softened, lower **Smoothing** or **Reduction**.
5. Compare with the effect bypassed, and use **Mix** to keep some of the original sound when that sounds more natural.

### Parameters

- **Reduction** (0–24 dB, default 12 dB) sets the greatest amount of background-noise reduction.
  - Lower values make a gentle, less noticeable change.
  - Higher values make steady noise quieter, but can also make faint musical detail less clear.
  - Start around 6–12 dB for lightly noisy recordings and increase only when needed.

- **Sensitivity** (-12–+12 dB, default 0 dB) controls how readily the effect treats sound as background noise.
  - Raise it when steady noise remains too audible after setting **Reduction**.
  - Lower it when soft instruments, reverb tails, or ambience are reduced too much.
  - Small adjustments are usually enough.

- **Smoothing** (0–100%, default 50%) makes the amount of reduction change more evenly across nearby frequencies.
  - Higher values help keep the result smoother and reduce a fluttering or watery character.
  - Lower values let the effect react more selectively to the noise.
  - If higher smoothing dulls the music, reduce it a little and use less **Reduction** instead.

- **Treble Care** (0–100%, default 50%) protects high-frequency musical detail from strong reduction.
  - Raise it to retain more sparkle in cymbals, strings, and air around voices.
  - Lower it only when high-frequency hiss remains distracting.
  - A middle setting is a good balance for most music.

- **Mix** (0–100%, default 100%) balances the reduced-noise sound with the original sound.
  - At 100%, you hear only the processed result.
  - Lower it when a small amount of the original ambience makes the recording sound more natural.
  - At 0%, the sound is unchanged, which is useful for comparison.

### Recommended Settings

1. **Gentle cleanup for a lightly noisy recording**
   - Reduction: 6–10 dB
   - Sensitivity: -2 to 0 dB
   - Smoothing: 40–60%
   - Treble Care: 50–70%

2. **Clear tape or equipment hiss**
   - Reduction: 12–18 dB
   - Sensitivity: 0 to +4 dB
   - Smoothing: 60–80%
   - Treble Care: 50–70%

3. **Preserve delicate high frequencies**
   - Reduction: 6–12 dB
   - Sensitivity: -4 to 0 dB
   - Smoothing: 50–70%
   - Treble Care: 70–100%
   - Mix: 70–100%

[Back to all effects](/dsp/effects/)
