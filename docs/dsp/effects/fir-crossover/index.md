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



### Asset requirements

`assets.impulseResponse`: One coefficient channel per band (`bandCount` channels) in `matrix` topology. Select an even number of channels from 4 to 16, at least `2 × bandCount`. Put the stereo input in lanes 0 and 1. Band `b` leaves on lanes `2b` and `2b + 1`, and any remaining lanes are silent. In Python, give the matching paths (input 0 to lane `2b`, input 1 to lane `2b + 1`, both through IR channel `b`) and `input_count=2`.

The coefficient sample rate must equal the processing sample rate; the library does not resample coefficients.

The library does not design this filter from the app controls described below. Supply finished coefficients, at most 131072 frames per channel.

`latencyMode` is the convolution block size in samples. The filtered output is delayed by exactly this amount, and `"0"` adds no delay.

`filterDelaySamples` declares the delay already contained in the coefficients, such as the center tap of a linear-phase FIR. The effect does not delay the filtered signal by this amount; it reports `latencyMode + filterDelaySamples` as its latency, and unselected channels are delayed by that total.

## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## FIR Crossover

FIR Crossover splits stereo input into two, three, or four frequency bands and routes each band to its own stereo output pair. It is intended for multi-amplifier or multi-speaker playback systems that need sharper separation than Channel Divider provides. The FIR design supports very steep crossover targets without recursive-filter stability limits, and Linear Phase keeps the same fixed processing delay across the spectrum. The plugin requires the WASM DSP engine.

To use it, run the desktop app with an even output-channel count from 4 to 16 and select **All** in the effect bus routing. Channels 1-2 are the stereo input; successive stereo output pairs receive the low-to-high bands. Band Count remains limited to four bands, so the effect uses at most channels 1-8. When the effect receives two channels, it passes the input through unchanged.

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

[Back to all effects](/dsp/effects/)
