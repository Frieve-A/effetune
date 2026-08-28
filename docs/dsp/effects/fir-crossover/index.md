---
layout: dsp
title: "FIR Crossover — EffeTune DSP"
description: "Applies an externally prepared FIR crossover impulse response."
lang: en
permalink: /dsp/effects/fir-crossover/
---
# FIR Crossover

Semantic type: `FIRCrossover` · Category: basics

Applies an externally prepared FIR crossover impulse response.

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
| `bandCount` | `band_count` | integer / 1 | `2` | Not declared in catalog | 2 … 4 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## FIR Crossover

FIR Crossover splits stereo input into two, three, or four frequency bands and routes each band to its own stereo output pair. It is intended for multi-amplifier or multi-speaker playback systems that need sharper separation than Channel Divider provides. The FIR design supports very steep crossover targets without recursive-filter stability limits, and Linear Phase keeps the same fixed processing delay across the spectrum. The plugin requires the WASM DSP engine.

To use it, run the desktop app with an even output-channel count from 4 to 16 and select **All** in the effect bus routing. Channels 1-2 are the stereo input; successive stereo output pairs receive the low-to-high bands. Band Count remains limited to four bands, so the effect uses at most channels 1-8.

### Sound Enhancement Guide

- Start with two bands, **Minimum Phase**, 32768 Taps, 128 samples of Latency, and a 24 dB/oct slope. Confirm that the low band reaches output channels 1-2 and the high band reaches channels 3-4 before connecting additional amplifiers or speakers.
- Add bands only when the output interface and speaker system have matching stereo output pairs. Three bands require six output channels, and four bands require eight.
- Use 48 to 96 dB/oct when drivers need less frequency overlap. Reserve the steeper settings for a concrete crossover requirement; they need more taps to follow the target accurately and can produce a longer impulse response.
- Use **Linear Phase** when constant phase delay through the crossover is important and its `Taps / 2` delay is acceptable. Use **Minimum Phase** when lower delay matters more.
- Set crossover frequencies from driver measurements and safe operating ranges, not only by ear. Protect tweeters and other limited-band drivers during setup.

### Parameters

- **Phase**
  - **Minimum Phase** - Uses a causal minimum-phase crossover construction and adds no FIR half-length delay. The selected convolution Latency still applies.
  - **Linear Phase** - Builds linear-phase band filters and adds `Taps / 2` samples of FIR delay in addition to the selected convolution Latency.
- **Taps** - FIR length: 8192, 16384, 32768, 65536, or 131072. More taps improve low-frequency resolution and the accuracy of steep transitions, but increase memory use, design time, and Linear Phase delay.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing.
- **Band Count** - Selects 2, 3, or 4 stereo bands. The available maximum follows the configured output channel count.
- **Crossover Frequencies** - F1, F2, and F3 set the active crossover points from 10 Hz to 40 kHz. The plugin keeps them in ascending order; the usable upper range also depends on the audio sample rate.
- **Slope** - Sets each crossover target to 24, 48, 72, 96, 144, 192, 288, or 384 dB/oct. Higher values make a narrower transition and usually benefit from more Taps.

### Visual Display

- The graph follows Channel Divider's display: it shows the intended response of every active output band from 10 Hz to 40 kHz on a -60 to +12 dB scale.
- Each green curve corresponds to one stereo output pair, ordered from the lowest band to the highest band.
- The status line reports total processing latency, FIR frequency resolution, and whether the filter asset is bypassed, staged, preparing, active, or in error.
- A channel warning appears unless the plugin is running with an even output-channel count from 4 to 16.

[Back to all effects](/dsp/effects/)
