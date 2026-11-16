---
layout: dsp
title: "Headphone EQ — EffeTune DSP"
description: "Applies an externally prepared FIR response that corrects a headphone toward a target curve."
lang: en
permalink: /dsp/effects/headphone-eq/
---
# Headphone EQ

Semantic type: `HeadphoneEQ` · Category: eq

Applies an externally prepared FIR response that corrects a headphone toward a target curve.

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



### Asset requirements

`assets.impulseResponse`: One coefficient channel in `mono` topology. The same filter runs on every selected channel.

The coefficient sample rate must equal the processing sample rate; the library does not resample coefficients.

The library does not design this filter from the app controls described below. Supply finished coefficients, at most 131072 frames per channel.

`latencyMode` is the convolution block size in samples. The filtered output is delayed by exactly this amount, and `"0"` adds no delay.

`filterDelaySamples` declares the delay already contained in the coefficients, such as the center tap of a linear-phase FIR. The effect does not delay the filtered signal by this amount; it reports `latencyMode + filterDelaySamples` as its latency, and unselected channels are delayed by that total.

## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## Headphone EQ

Headphone EQ corrects the frequency response of your headphones toward a target curve. Search for your headphone model, and the plugin downloads its measurement and a matching target curve from the AutoEQ project, then designs an FIR correction filter that reduces the difference between them. You can also load your own measurement and target files. The same correction is applied to every channel. Unlike importing ready-made settings into 15Band PEQ, Headphone EQ designs the correction itself, so you can change its strength, its frequency range, the boost limit, and the target at any time. The plugin requires the WASM DSP engine; without it, the signal passes through unchanged.

### Sound Enhancement Guide

- **Start by searching for your headphones**: Type the model name in the search box and pick it from the list. The measurement and its target are loaded together, so the correction starts right away. When a model is listed with several measurement sources, any of them is a reasonable choice; each comes with the target for the same source and measuring rig. To correct toward a different target, click **Load Target** and choose a target curve file.
- **Starting settings**: The defaults (**Minimum Phase**, **Correction Amount: 100%**, **Upper Limit: 10000 Hz**, **Max Boost: 6 dB**, **Smoothing: 0.17 oct**, **Auto Headroom** on) are a good baseline. Toggle the effect on and off to compare.
- **Treble range**: Measurements above about 10 kHz change with how the headphones sit and with the measuring setup, so the default **Upper Limit** leaves that region uncorrected. Raise it only when you trust the measurement there, and lower it (for example, to 6000 Hz) if correcting the upper range makes the treble worse.
- **Avoid large boosts**: If the correction tries to fill narrow dips with large boosts, lower **Max Boost** or raise **Smoothing**. At 0 dB, peaks are still reduced but nothing is boosted.
- **Gentler correction**: Lower **Correction Amount** (for example, to 50%) to move only part of the way toward the target.
- **Simulate another headphone**: Correct your own headphones with one Headphone EQ, then add a second Headphone EQ with the other model's measurement and **Correction Amount** at -100%. The second one adds that model's deviation from its target, so your headphones take on its character. Use the same target in both for the closest match.
- **More bass to taste**: In **Target Adjust**, set a band's type to **LowShelv** around 100 Hz and raise its gain by 2 to 4 dB. Like Room EQ's Additional EQ, Target Adjust applies across the whole range and is not limited by **Correction Amount**, **Upper Limit**, or **Max Boost**.
- **One preset per headphone**: The loaded curves are saved in presets and URLs, so save a preset for each pair of headphones.

### Parameters

- **Search box** (`Search headphones (AutoEQ) or paste a URL`) - Type a headphone model and pick it from the list to load its measurement and target. You can also paste a link to a measurement file and press Enter; links to an AutoEQ result page or folder on GitHub work as well. The headphone list and the measurements come from the [AutoEQ project](https://github.com/jaakkopasanen/AutoEq) by Jaakko Pasanen and are downloaded from GitHub only when you use this box. The loaded measurement is named after the model and its measurement source (for example, oratory1990), and the status line shows this name. If a download fails, the status line shows an error and the previously loaded curves stay in use.
- **Drag and drop** - Drop a `.csv` or `.txt` file onto the plugin to load it as the measurement, just like **Load Measurement**.
- **Load Measurement** - Loads a measurement from your own `.csv` or `.txt` file. From an AutoEQ CSV, the `raw` column is used, and a `target` column, if present, also replaces the target.
- **Load Target** - Loads the target curve. From an AutoEQ CSV, the `target` column is used if present; otherwise the `raw` column.
- **Accepted files** - An AutoEQ-style CSV whose first row names the columns, including `frequency`, or a plain text file with frequency and level (dB) columns separated by commas, tabs, semicolons, or spaces. Lines that are not numbers are skipped, and only the first two columns are used. If a file cannot be read, the status line shows an error and the previously loaded curves stay in use. The levels of the measurement and target do not need to match; their overall levels are aligned before comparison.
- The correction starts once both a measurement and a target are loaded. Until then the signal passes unchanged, and the correction settings and Target Adjust are disabled.
- **Phase**
  - **Minimum Phase** - Adds no FIR delay beyond the selected Latency.
  - **Linear Phase** - Gives every frequency the same delay, adding `Taps / 2` samples in addition to the selected Latency.
- **Taps** - FIR length: 8192, 16384, 32768, 65536, or 131072. More taps reproduce bass and fine detail more accurately, but increase memory use, design time, and Linear Phase delay.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing.
- **Correction Amount** (-100% to 100%; default 100%) - Scales the automatic correction in dB. 50% halves every boost and cut; 0% leaves only Target Adjust. Negative values invert the correction and add the headphone's deviation from the target instead; at -100% the full deviation is reproduced. **Max Boost** then limits the boosts that reproduce its peaks.
- **Upper Limit** (1000 to 20000 Hz; default 10000 Hz) - Highest frequency to correct. Above it the automatic correction is 0 dB, with a smooth transition at the boundary. The lower end is always 20 Hz.
- **Max Boost** (0 to 18 dB; default 6 dB) - Caps the boosts of the automatic correction. Cuts and Target Adjust are not limited.
- **Smoothing** (0.02 to 1 oct; default 0.17 oct) - Smooths the correction curve. Higher values give broader, more conservative correction; lower values also follow narrow peaks and dips, which often vary with fit.
- **Auto Headroom** (default on) - Lowers the whole output by the largest boost in the filter, including Target Adjust, so the filter's highest gain is 0 dB and boosted regions do not raise the level above the input. The applied amount appears in the status line. When off, the output level is kept, but loud passages can clip after a boost; lower the level in a later stage or add a limiter.
- **Target Adjust** - Five parametric bands (types **Peaking**, **LowShelv**, **HighShel**; 20 Hz–20 kHz, ±20 dB, Q 0.1–10, up to 2 for shelves; default Q 1) that reshape the target. Positive gain asks for more of that region, negative gain for less. For **Peaking**, a higher Q affects a narrower band and a lower Q a wider one; for the shelves, Q changes the shape near the transition.

[Back to all effects](/dsp/effects/)
