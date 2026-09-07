---
layout: dsp
title: "Bandwidth Extender — EffeTune DSP"
description: "Synthesizes upper-frequency content for bandwidth-limited recordings."
lang: en
permalink: /dsp/effects/bandwidth-extender/
---
# Bandwidth Extender

Semantic type: `BandwidthExtender` · Category: saturation

Synthesizes upper-frequency content for bandwidth-limited recordings.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `harmonicAmount` | `harmonic_amount` | number / 1 | `100` | % | 0 … 200 |
| `noiseAmount` | `noise_amount` | number / 1 | `100` | % | 0 … 200 |
| `cutoffMode` | `cutoff_mode` | string / 1 | `"Auto"` | Not declared in catalog | `Auto`, `Manual` |
| `cutoffFrequency` | `cutoff_frequency` | number / 1 | `16000` | Hz | 6000 … 24000 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Bandwidth Extender

Bandwidth Extender is intended for audio with a clear high-frequency cutoff, such as some low-bitrate MP3 files. It analyzes the stereo pair together and adds only newly generated content above the detected or specified boundary. It does not recover the original missing waveform, and it normally stays inactive when Auto cannot find a stable cutoff.

The generated band has two independently adjustable parts: input-related harmonic continuation and deterministic shaped noise. Harmonic continuation keeps tonal material connected to the remaining spectrum, while shaped noise gives percussion and other noise-like sounds a less artificial texture. The original sound remains present while these new components are added.

### Listening Enhancement Guide

- Start with **Auto** and both amounts at their 100% defaults for codec-limited music.
- If Auto does not engage despite a known cutoff, select **Manual** and set the boundary to the source's measured cutoff.
- Reduce **Noise Amount** for sustained tonal material, or reduce **Harmonic Amount** for percussion and breath-like material. Keep both active when the source contains a mixture.
- Compare with bypass at matched level. Raising either amount increases only that generated component and cannot reconstruct details that are absent from the source.
- Do not use this as a general brightener for already full-band audio; Exciter is designed for that different purpose.

### Parameters

- **Harmonic Amount** (0-200%, default 100%) - Controls harmonic continuation independently. 0% removes this component, 100% is its reference level, and 200% doubles it without changing shaped noise or the dry signal.
- **Noise Amount** (0-200%, default 100%) - Controls deterministic shaped noise independently. 0% removes this component, 100% is its reference level, and 200% doubles it without changing harmonic continuation or the dry signal.
- **Cutoff** - Selects how the missing-band boundary is chosen.
  - **Auto** looks for a steep, persistent spectral drop shared by the stereo pair and reduces the effect when confidence is low.
  - **Manual** uses the Manual Cutoff value. The generated band is automatically kept within the frequency range available for playback.
- **Manual Cutoff** (6000-24000 Hz) - Sets the start of generation in Manual mode. Match the measured source boundary instead of lowering it simply to make the effect more obvious.

Bandwidth Extender adds about 26.7–29.0 ms of delay, including one extra processing hop: 1,280 samples at 48 kHz, 2,560 samples at 96 kHz, or 5,120 samples at 192 kHz. If it cannot run with the current sample rate, channel setting, or device, the plugin reports that it is bypassed and the audio remains unchanged. Use a supported setting or disable the plugin.

[Back to all effects](/dsp/effects/)
