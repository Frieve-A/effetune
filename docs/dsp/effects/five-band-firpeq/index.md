---
layout: dsp
title: "5Band FIR PEQ — EffeTune DSP"
description: "Applies an externally prepared FIR response for five-band equalization."
lang: en
permalink: /dsp/effects/five-band-firpeq/
---
# 5Band FIR PEQ

Semantic type: `FiveBandFIRPEQ` · Category: eq

Applies an externally prepared FIR response for five-band equalization.

See [Assets and bundles](/dsp/concepts/assets-and-bundles/#asset-required-effects) before using this effect.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **impulseResponse (impulseResponse)**
- Catalog-declared latency: **dynamic**; depends on latencyMode, filterDelaySamples, impulseResponse

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `latencyMode` | `latency_mode` | string / 1 | `"128"` | Not declared in catalog | `0`, `128`, `256`, `512`, `1024` |
| `filterDelaySamples` | `filter_delay_samples` | integer / 1 | `0` | Not declared in catalog | 0 … 65536 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## 5Band FIR PEQ

5Band FIR PEQ provides the familiar five-band layout of 5Band PEQ but builds the combined response as one FIR filter. Use it for precise playback correction, very narrow cuts, or steep shelf transitions when you want to avoid recursive-filter stability limits. Minimum Phase keeps processing delay low, while Linear Phase gives every frequency the same fixed delay. The plugin requires the WASM DSP engine; without it, the signal passes through unchanged.

### Sound Enhancement Guide

- Start with **Minimum Phase**, 32768 Taps, and 128 samples of Latency. Use broad Q values around 0.7 to 2 for ordinary bass, midrange, and treble shaping.
- For a measured narrow peak, select Peaking, set the center frequency to the peak, and increase Q gradually. Values above 10 are intended for precise corrections; check the status because an extremely narrow response may need more Taps.
- Use Low Shelf for bass balance and High Shelf for treble balance. Small changes of 1 to 3 dB are usually enough for everyday listening.
- Use LowPass or HighPass to remove unwanted frequency extremes. Start with a 12 or 24 dB/oct Slope, and increase it only when you need a sharper cutoff.
- Choose **Linear Phase** when constant phase delay across the spectrum is important and the added latency is acceptable. It can place energy before a transient, especially with sharp settings, so compare Minimum Phase for music with strong attacks.
- FIR construction avoids feedback-pole instability, but a large boost or very high Q still produces a long, selective impulse response. Prefer cuts for isolated resonances and leave enough playback headroom.

### Parameters

- **Phase**
  - **Minimum Phase** - Builds a causal minimum-phase response and adds no FIR half-length delay. The selected convolution Latency still applies.
  - **Linear Phase** - Builds a symmetric linear-phase response and adds `Taps / 2` samples of FIR delay in addition to the selected convolution Latency.
- **Taps** - FIR length: 8192, 16384, 32768, 65536, or 131072. More taps improve the accuracy of low-frequency and very high-Q settings, but increase memory use, design time, and Linear Phase delay.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing.
- **Five Adjustable Bands** - The default centers are 100 Hz, 316 Hz, 1 kHz, 3.16 kHz, and 10 kHz. Each band can be enabled independently.
- **Type** - Peaking, LowPass, HighPass, Low Shelf, High Shelf, BandPass, or Notch. All enabled bands are combined before the FIR is designed.
- **Freq** - Sets the band frequency from 20 Hz to 20 kHz.
- **Gain** - Sets the boost or cut from -20 to +20 dB for Peaking, Low Shelf, and High Shelf. LowPass, HighPass, BandPass, and Notch do not use Gain.
- **Q** - Sets the response width from 0.1 to 100. Higher values make a narrower change; lower values make a broader transition. The slider uses a logarithmic scale.
- **Slope** - Sets the LowPass or HighPass cutoff rate from 0.1 to 384 dB/oct. The slider uses a logarithmic scale, and the control is available only for those two filter types.

### Visual Display

- The grey curve shows the combined target response requested by the current band settings.
- The green curve shows the magnitude response realized by the designed FIR. A visible gap means the selected Taps cannot reproduce the target exactly.
- Numbered markers correspond to the five bands. Drag horizontally to change frequency and vertically to change gain; disabled bands appear dimmed.
- The status line reports whether the FIR is being designed, prepared, or used, and shows total processing latency in samples and milliseconds.
- If the selected Taps cannot reproduce an extreme response accurately, the status recommends increasing Taps or reducing Q or Slope.

[Back to all effects](/dsp/effects/)
