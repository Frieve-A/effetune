---
layout: dsp
title: "Bass Management — EffeTune DSP"
description: "Routes managed main-channel bass and dedicated LFE inputs to selected subwoofer outputs."
lang: en
permalink: /dsp/effects/bass-management/
---
# Bass Management

Semantic type: `BassManagement` · Category: basics

Routes managed main-channel bass and dedicated LFE inputs to selected subwoofer outputs.

Some configurations use an external asset. See [Assets and bundles](/dsp/concepts/assets-and-bundles/) for resolver and bundle contracts.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **impulseResponse (impulseResponse)**
- Catalog-declared latency: **dynamic**; depends on phase, taps

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `phase` | `phase` | string / 1 | `"IIR"` | Not declared in catalog | `IIR`, `Linear` |
| `taps` | `taps` | string / 1 | `"16384"` | Not declared in catalog | `8192`, `16384`, `32768` |
| `roles` | `roles` | integer / 16 | `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]` | Not declared in catalog | 0 … 3 |
| `frequencies` | `frequencies` | number / 16 | `[80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80]` | Hz | 20 … 300 |
| `slopes` | `slopes` | integer / 16 | `[24,24,24,24,24,24,24,24,24,24,24,24,24,24,24,24]` | dB/oct | `24`, `48`, `96` |
| `routes` | `routes` | integer / 16 | `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]` | Not declared in catalog | 0 … 65535 |
| `subs` | `subs` | integer / 1 | `0` | Not declared in catalog | 0 … 65535 |
| `lfeFrequency` | `lfe_frequency` | number / 1 | `120` | Hz | 20 … 300 |
| `lfeSlope` | `lfe_slope` | integer / 1 | `24` | dB/oct | `24`, `48`, `96` |
| `lfeLowpass` | `lfe_lowpass` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |
| `bassGain` | `bass_gain` | number / 1 | `0` | dB | -24 … 12 |
| `lfeGain` | `lfe_gain` | number / 1 | `0` | dB | -24 … 12 |
| `headroom` | `headroom` | number / 1 | `0` | dB | -24 … 0 |
| `routeInversions` | `route_inversions` | integer / 16 | `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]` | Not declared in catalog | 0 … 65535 |

### Bass Management route polarity

`routes` and `routeInversions` are 16-entry integer bit-mask arrays. Entry `n`
applies to input channel `n`, and bit `m` selects output channel `m`, with both
indices zero-based. A set bit in `routeInversions[n]` reverses only that input's
bass or LFE contribution on the corresponding enabled route; it does not affect
the matching main output.

When `subs` is nonzero, `routeInversions[n]` must be a subset of `routes[n]`,
and both route masks must target only output channels selected by `subs`. A
configuration that violates either condition raises `ValidationError`.

## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Bass Management

Bass Management sends the low-frequency part of selected main channels and any dedicated LFE input to the subwoofer outputs you choose. It is useful when a multi-channel output drives main speakers and one or more subwoofers. Each managed main keeps its higher frequencies on the same output channel, while the subwoofers receive the bass routed to them. The plugin requires the WASM DSP engine.

Until you select a **Sub Output**, Bass Management does not split bass or distribute it to subwoofers, so the input channels pass through without a crossover. A new instance starts with the actual bus channels set to **Managed** and no **Sub Outputs** selected.

Select **All** in the effect bus routing, then make the output bus wide enough for every main and subwoofer channel you will use. The channel table always shows the input role and its selected subwoofer outputs. A subwoofer output cannot also be a **Full Range** or **Managed** main channel. An **LFE** input may use the same channel number as a subwoofer output; its signal is collected before outputs are assembled, so it is sent only once.

### Sound Enhancement Guide

- For stereo with two subwoofers, use a four-channel bus. Set channels 1 and 2 to **Managed**, then select channels 3 and 4 as **Sub Outputs**. Their roles change to **LFE** automatically; use the Matrix to keep or turn off each main-to-subwoofer route.
- For surround material, set only the actual main channels to **Managed** and set the source LFE channel to **LFE**. Choose the subwoofer outputs explicitly. Do not leave an LFE source as a main channel if it should play only through subwoofers.
- Start each managed main at 80 Hz and 24 dB/oct. Raise its crossover frequency when that speaker has limited bass extension; use a steeper slope when you need less overlap. Confirm the speaker's usable range before increasing playback level.
- When one input is sent to several subwoofers, Bass Management divides that electrical signal equally among them. This does not prevent peaks when several inputs or subwoofers combine. Begin with **Headroom** below 0 dB when needed, watch the following level meter, and place Brickwall Limiter later in the chain if peak control is required.
- Use **LFE Gain** only when your source chain has not already applied its intended LFE level adjustment. It does not add an automatic cinema-style level correction.
- Follow Bass Management with any per-subwoofer high-pass filter, EQ, or polarity adjustment. Use MultiChannel Panel afterwards for individual trim, mute/solo, and up to 30 ms of placement delay; add a limiter last if needed.

### Parameters

- **Phase**
  - **IIR** - Provides the lower-latency crossover mode. It changes phase around the crossover frequency.
  - **Linear** - Keeps the crossover split time-aligned, but adds visible processing latency and can produce pre-ringing. Use it only when that delay is acceptable.
- **Taps** - Selects the Linear filter length: 8192, 16384, or 32768. More Taps improve low-frequency and steep-slope accuracy, while increasing preparation time and latency. The initial setting is 16384; this control affects Linear mode.
- **Headroom** - Applies the same attenuation to every output. Lower it when combined bass and LFE signals leave too little level margin.
- **Bass Gain** - Adjusts the level of bass separated from **Managed** main channels before it is mixed into the selected subwoofer outputs.
- **LFE Gain** - Adjusts the level of **LFE** inputs before they are mixed into the selected subwoofer outputs.
- **Channel Role** - Sets each input channel to **Full Range**, **Managed**, **LFE**, or **Unused**.
  - **Full Range** keeps the source on its matching main output without sending bass to a subwoofer.
  - **Managed** keeps the high-frequency part on its matching main output and sends its low-frequency part to the selected subwoofers.
  - **LFE** sends the source only to the selected subwoofers. It does not pass through its matching output as a main channel.
  - **Unused** reserves an input channel, normally for a subwoofer output.
- **Crossover Frequency** - Sets each **Managed** channel's crossover point from 20 to 300 Hz. Higher values send more of that main channel's bass to subwoofers.
- **Slope** - Sets the crossover steepness for each **Managed** channel: 24, 48, or 96 dB/oct. Higher values narrow the overlap between main and subwoofer output.
- **Sub Outputs** - Selects the subwoofer output channels used by a **Managed** or **LFE** input. Selecting a channel changes its **Channel Role** to **LFE**. A newly selected output starts with every current bus input routed **ON** at normal polarity; use the Matrix to turn off an individual route. When no **Sub Outputs** are selected, bass splitting and subwoofer routing stop, and the input channels pass through without a crossover.
- **ON** and **Ø** - In each channel-table cell, **ON** sends that **Managed** or **LFE** input to the selected subwoofer output. **Ø** reverses polarity only for that input-to-subwoofer path, which can help align it with your measured or audible result. **Ø** is available only while **ON** is selected; clearing **ON** also clears **Ø**. It does not change the input's main output.
- **LFE Low-pass** - When enabled, limits LFE content above the selected **LFE Frequency**. Leave it off to keep the source LFE bandwidth unchanged.
- **LFE Frequency** and **LFE Slope** - Set the optional LFE low-pass point from 20 to 300 Hz and its 24, 48, or 96 dB/oct slope. They do not filter the bass already separated from managed main channels.

### Filter Preparation
Changing Linear settings can briefly reduce or pause sound while the new filters are prepared. If filter preparation cannot complete, reduce **Taps** and try again. When a previous active configuration remains usable, it continues playing; otherwise the normal main channels pass through with matching delay, reserved subwoofer outputs are silent, and an LFE source is not played until preparation succeeds.

### Bypass and Calibration

Host plugin bypass restores the original channel assignment and audio, so Bass Management routing, subwoofer protection, and delay matching do not continue while it is bypassed. For comparisons or temporary muting that keep the configured wiring, use the later MultiChannel Panel instead.

Linear mode describes the crossover itself. Per-subwoofer IIR high-pass/EQ processing or an intentional relative delay later in the chain changes the phase behavior of the complete system. Save the complete calibrated chain as one preset.

[Back to all effects](/dsp/effects/)
