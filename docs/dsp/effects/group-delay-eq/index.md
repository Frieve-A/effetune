---
layout: dsp
title: "Group Delay EQ — EffeTune DSP"
description: "Applies an externally prepared FIR response to adjust group delay."
lang: en
permalink: /dsp/effects/group-delay-eq/
---
# Group Delay EQ

Semantic type: `GroupDelayEQ` · Category: eq

Applies an externally prepared FIR response to adjust group delay.

See [Assets and bundles](/dsp/concepts/assets-and-bundles/#asset-required-effects) before using this effect.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **impulseResponse (impulseResponse)**
- Catalog-declared latency: **dynamic**; depends on latencyMode, filterDelaySamples, impulseResponse

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `latencyMode` | `latency_mode` | string / 1 | `"128"` | Not declared in catalog | `0`, `128`, `256`, `512`, `1024` |
| `filterDelaySamples` | `filter_delay_samples` | integer / 1 | `8192` | Not declared in catalog | 0 … 65536 |



### Asset requirements

`assets.impulseResponse`: One coefficient channel in `mono` topology. The same filter runs on every selected channel.

The coefficient sample rate must equal the processing sample rate; the library does not resample coefficients.

The library does not design this filter from the app controls described below. Supply finished coefficients, at most 131072 frames per channel.

`latencyMode` is the convolution block size in samples. The filtered output is delayed by exactly this amount, and `"0"` adds no delay.

`filterDelaySamples` declares the delay already contained in the coefficients, such as the center tap of a linear-phase FIR. The effect does not delay the filtered signal by this amount; it reports `latencyMode + filterDelaySamples` as its latency, and unselected channels are delayed by that total.

## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## Group Delay EQ

Group Delay EQ is the counterpart of an ordinary equalizer: instead of changing how loud each band is, it changes **when** each band arrives. Fifteen sliders set the delay of each frequency range, and the plugin builds one FIR filter designed to realize those delays with a flat magnitude response. A flat response is the design target, not a guarantee: finite Taps approximate that ideal target, and large or rapidly changing delay settings can create measurable magnitude ripple. Use it to compensate the timing errors of a speaker or crossover, or to hear for yourself how much phase distortion your system and your ears actually reveal. The plugin requires the WASM DSP engine; without it, the signal passes through unchanged.

Only the differences between bands matter for the sound. A filter that delays every band equally is just a plain delay, so the plugin keeps a fixed internal delay and lets you push each band earlier or later around it. While all sliders are at 0 ms the plugin is completely transparent and adds no latency at all.

### Sound Enhancement Guide

- **Speaker and subwoofer timing**: If bass arrives late compared with the rest of the music, delay the bands above the crossover by the same amount until the graph shows a flat line there. Typical corrections are 2 to 10 ms and are easiest to judge on kick drums and bass guitar.
- **Ported speakers and room modes**: A ported enclosure adds group delay around its tuning frequency. Lower the affected low band, or raise everything else, so the curve becomes flatter. Small residual differences below 50 Hz are normal.
- **Listening test for phase distortion**: Set one band to +10 ms, compare with the effect off, and then lower the value until you can no longer hear a difference. Interpret this as a phase-only comparison only when Ripple in the status line is sufficiently small and the green Realized curve closely overlaps the grey Target curve. Otherwise, magnitude changes or an inaccurately realized delay can also affect what you hear.
- **Work band by band**: Change one slider at a time and listen. Phase-only changes are subtle on most program material and show up mainly on transients such as drums, plucked strings, and piano attacks.
- **Watch the two curves**: If the green curve no longer follows the grey one, the current Taps setting cannot realize that shape. Increase Taps, or reduce the difference between neighbouring bands.

### Parameters

- **Taps** - FIR length: 4096, 8192, 16384, or 32768. Low frequencies need a long filter: at 96 kHz, 16384 taps track even large delay differences down to about 60 Hz, while shorter settings lose accuracy in the bass first. Taps also decide how much delay the filter can hold, and therefore how far the sliders reach. More taps mean more latency and more processing.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing.
- **Band Sliders (25 Hz to 16 kHz)** - Fifteen sliders set the group delay of each band. Positive values make that range arrive later, negative values earlier. The range covers the whole delay the filter can hold: at 96 kHz that is ±18.6 ms with 4096 taps and ±149.3 ms with 32768 taps. The highest band realizes those values in full, while lower bands need more taps to follow a large setting; the graph shows how far each one gets. The values are interpolated smoothly across frequency, so neighbouring bands always blend into each other.
- **Phase angle** - Below each millisecond value the slider shows the same delay as a phase rotation at the band centre frequency. Past a full turn the reading is split into whole cycles and the remaining angle, so `+2c180°` means two complete cycles plus a half turn.
- **Reset** - Double-click a slider to return that band to 0 ms. The Reset button on the graph clears every band at once.

Total latency is the Latency setting plus half the Taps count. It stays the same while you move the sliders, so only a change of Taps or Latency changes the delay of the whole chain.

[Back to all effects](/dsp/effects/)
