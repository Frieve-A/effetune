---
layout: dsp
title: "Attack Tonal Balance — EffeTune DSP"
description: "Balances short broadband attacks and sustained tonal structure."
lang: en
permalink: /dsp/effects/attack-tonal-balance/
---
# Attack Tonal Balance

Semantic type: `AttackTonalBalance` · Category: dynamics

Balances short broadband attacks and sustained tonal structure.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `attack` | `attack` | number / 1 | `0` | dB | -12 … 12 |
| `tonal` | `tonal` | number / 1 | `0` | dB | -12 … 12 |
| `attackEnabled` | `attack_enabled` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |
| `tonalEnabled` | `tonal_enabled` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## Attack Tonal Balance

Balances short, broadband attacks against sustained tonal structure in the same frequency range. Use it when you want percussion and note onsets to stand out more or less without applying the same change to sustained notes. Unlike Transient Shaper, it separates the two parts from their time-frequency patterns rather than fast and slow level envelopes; unlike Multiband Transient, it is not divided into fixed bass, midrange, and treble bands.

### Listening Enhancement Guide

- Leave Attack Enabled and Tonal Enabled checked, start with both gain controls at 0 dB, then adjust one at a time in 1 to 3 dB steps.
- Raise Attack for clearer drum hits, plucked strings, and note onsets. Lower it to soften sharp or tiring attacks.
- Raise Tonal to bring sustained notes, chords, and vocal tones forward. Lower it when sustained pitched content dominates the mix.
- Clear either Enabled checkbox to cut that separated component while you compare or shape the other one. Its gain setting is retained, but the corresponding slider and number field are unavailable until you enable it again.
- Positive settings can raise peaks or perceived loudness. Compare at a similar listening level and reduce the output level if necessary.

### Parameters

- **Attack Enabled** (default: on)
  - Includes the separated Attack component in the output. Clear it to cut that component.

- **Attack** (-12 dB to +12 dB, default: 0 dB, 0.5 dB steps)
  - Adjusts short structures that spread across nearby frequencies.
  - Positive values emphasize attacks; negative values soften them.

- **Tonal Enabled** (default: on)
  - Includes the separated Tonal component in the output. Clear it to cut that component.

- **Tonal** (-12 dB to +12 dB, default: 0 dB, 0.5 dB steps)
  - Adjusts structures that remain stable over time.
  - Positive values emphasize sustained tonal content; negative values reduce it.

### Delay and Separation Limits

The effect adds a fixed processing delay of 5,120 samples at 48 kHz (about 107 ms). It identifies spectral patterns, not instruments or sources, and it does not decide whether a sound has a musically correct pitch. Rapid pitch changes, sustained noise, dense percussion, and strongly modulated sounds may be divided less clearly. Content that is not clearly Attack or Tonal remains at its original level, so clearing both Enabled checkboxes does not make the output silent.

[Back to all effects](/dsp/effects/)
