---
layout: dsp
title: "Room EQ — EffeTune DSP"
description: "Applies an externally prepared room-correction impulse response."
lang: en
permalink: /dsp/effects/room-eq/
---
# Room EQ

Semantic type: `RoomEQ` · Category: eq

Applies an externally prepared room-correction impulse response.

See [Assets and bundles](/dsp/concepts/assets-and-bundles/#asset-required-effects) before using this effect.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **impulseResponse (impulseResponse)**
- Catalog-declared latency: **dynamic**; depends on latencyMode, filterDelaySamples, impulseResponse

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `latencyMode` | `latency_mode` | string / 1 | `"128"` | Not declared in catalog | `0`, `128`, `256`, `512`, `1024` |
| `filterDelaySamples` | `filter_delay_samples` | integer / 1 | `16384` | Not declared in catalog | 0 … 65536 |
| `channelDelay` | `channel_delay` | integer / 1 | `0` | Not declared in catalog | 0 … 3840 |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -12 … 12 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Room EQ

Room EQ builds FIR correction filters from frequency-response measurements saved by EffeTune. By default, it designs one shared filter and applies it to every channel routed through the plugin; you can also assign a separate saved measurement to individual channels while keeping the remaining correction settings shared across the instance. The filter averages all points in the selected measurement, smooths the curve, and reduces peaks and dips within the selected frequency range. Use it when loudspeaker and room interactions cause repeatable peaks or a broad tonal imbalance at your listening position. In addition to minimum-phase or linear-phase magnitude correction, **Correction** mode can correct measured excess phase in the direct sound (**Phase Correction**) and room reverberation (**Reverb Correction**). Room EQ requires the WASM DSP engine; without it, the signal passes through unchanged.

### Sound Enhancement Guide

- **Multi-Point Measurement**: Measure the loudspeaker or channel group from several nearby microphone positions around your listening seat, then select that saved measurement so the correction does not overfit a single microphone location.
- **Starting Settings**: Begin with **Phase: Minimum**, **Smoothing: 0.17 oct**, **Correction Low: 80 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB**, and **Level Correction: 100%**. Toggle the effect on and off to verify that the tonal balance becomes more even without sounding thin or harsh.
- **Avoid Over-Boosting Dips**: If the filter tries to fill narrow acoustic cancellations, increase **Smoothing** or lower **Max Boost** (0 dB disables automatic boosts while keeping peak cuts).
- **Scale Correction Strength**: Lower **Level Correction** if 100% feels too strong (50% scales a +6 dB boost to +3 dB and a −8 dB cut to −4 dB).
- **Trusted Range Only**: Keep **Correction Low** and **Correction High** within the range your loudspeaker and measurement microphone reproduce reliably; correcting outside it makes the result less accurate.
- **Target Shaping**: Once room peaks are controlled, use **Additional EQ** (folded directly into the FIR filter) for gentle tonal preferences such as a broad +2 dB low shelf around 100 Hz.
- **Excess-Phase & Reverb Correction**: Choose **Phase: Minimum** for lowest latency, or **Phase: Correction** to align excess phase as well. Start with **Reference Point: Consensus (all points)**, the default **Direct Window**, and **Phase Correction: 100%**. Enable **Low-frequency Phase Extension** only if you want excess-phase correction below **Phase Low**, and turn it off if bass timing becomes less consistent between listening positions. Raise **Reverb Correction** gradually with **Reverb Max Freq: 250 Hz** to counteract low-frequency reverberation across the listening area; raising **Reverb Max Freq** makes the result an optimization for the measured position only.
- **Manual Delay**: Room EQ does not calculate speaker-distance alignment. **Delay** applies to all channels in the instance; use separate Room EQ instances if different channel groups need different manual delays.

> **Sharing Measurements Across Devices**: Presets and URLs store the measurement name and ID, not the acoustic data. To move a measurement to another device, export it from the Measurement tool with **Include impulse responses in measurement JSON exports** enabled (the default; it can make the file tens of megabytes larger), then import the JSON file on the target device. If the selected measurement is missing, Room EQ shows a warning and passes the signal without correction.

### Parameters

- **Measurement** - Selects the shared saved measurement (showing name, point count, and `IR` when impulse data is present). Click **Refresh measurements** after adding or editing measurements.
- **Measurement ChN** - Optional per-channel measurement override for each routed bus channel. Leave at **(Shared)** to use the shared **Measurement**.
- **Delay** (0 to 20 ms) - Manual delay applied to all routed channels; it is not included in the reported processing latency.
- **Phase** - Selects FIR phase behavior:
  - **Minimum**: Minimum-phase magnitude correction with the lowest latency.
  - **Linear**: Linear-phase magnitude correction (adds `Taps / 2` samples of delay).
  - **Correction**: Minimum-phase magnitude correction plus excess-phase correction for the direct sound (**Phase Correction** within **Direct Window**) and optional room decay (**Reverb Correction** within **Reverb Window**). Adds `Taps / 2` samples of delay and requires impulse-response (`IR`) data. **Phase Smoothing**, **Phase Low**, **Low-frequency Phase Extension**, **Phase Correction**, the four Reverb settings, and **Reference Point** work only in this mode; in Minimum and Linear they are disabled and keep their values.
- **Taps** (8192, 16384, 32768, 65536, or 131072) - FIR filter length. Higher values improve low-frequency resolution at the cost of memory, design time, and delay in Linear/Correction modes.
- **Latency** (0, 128, 256, 512, or 1024 samples) - Convolution head latency. Lower values reduce delay but increase processing load.
- **Smoothing** (0.02 to 1.00 oct) - Gaussian frequency smoothing for magnitude correction. Higher values give broader, more conservative correction; lower values follow finer response variations.
- **Phase Smoothing** (0.02 to 1.00 oct, or **Auto**) - Gaussian smoothing for direct-sound excess-phase correction in Correction mode (follows **Smoothing** when **Auto** is checked).
- **Correction Low / Correction High** - Lower and upper frequency boundaries for automatic correction.
- **Direct Window** (1 to 50 ms) - Post-onset time window analyzed for direct-sound phase correction. A longer window lowers the automatic **Phase Low** but includes more room reflections.
- **Phase Low** (20 to 20000 Hz, or **Auto**) - Lower frequency limit for fixed-window direct-sound phase correction (defaults to the higher of **Correction Low** and three cycles inside **Direct Window**, e.g. 500 Hz at 6 ms). With **Low-frequency Phase Extension** on, it instead marks where the fixed window gives way to longer low-frequency windows.
- **Low-frequency Phase Extension** (default off) - Extends excess-phase correction below **Phase Low** down toward **Correction Low** using progressively longer frequency-dependent windows.
- **Max Boost** (0 to 18 dB) - Caps automatic correction boosts before smoothing without limiting cuts or intentional boosts from **Additional EQ**.
- **Level Correction** (0% to 100%) - Scales automatic magnitude correction linearly in dB. At 0%, only the automatic correction stops; **Phase Correction**, **Additional EQ**, **Delay**, and **Gain** stay active.
- **Phase Correction** (0% to 100%) - Scales direct-sound excess-phase correction in Correction mode, independently of **Reverb Correction**.
- **Reverb Correction** (0% to 100%; default 0%) - Scales excess-phase correction of later room reverberation analyzed within **Reverb Window** up to **Reverb Max Freq**. It does not change the magnitude correction.
- **Reverb Window** (20 to 1000 ms) - Post-onset time window analyzed by **Reverb Correction**. If it is not longer than **Direct Window** (or the measurement is too short), reverb correction is skipped with a warning while the rest of the filter stays active.
- **Reverb Max Freq** (20 to 20000 Hz; default 250 Hz) - Upper frequency limit for **Reverb Correction**, capped by **Correction High** (keeping it around 250 Hz focuses on low-frequency room decay that behaves consistently across nearby seats).
- **Reverb Smoothing** (0.02 to 1.00 oct) - Gaussian smoothing applied to the reverb excess-phase delay.
- **Reference Point** - Selects **Consensus (all points)** (reliability-weighted average across measurement points) or a single measurement point for excess-phase analysis. If the selected point is removed, it returns to Consensus.
- **Additional EQ (folded into FIR)** - Five parametric target-shaping bands (Peak, Low shelf, High shelf; 20 Hz–20 kHz, ±20 dB, Q 0.1–10, up to 2 for shelves) built directly into the FIR filter. Their phase is zero in Linear mode and minimum-phase in Minimum and Correction modes.
- **Gain** (-12 to +12 dB) - Output level trim.

[Back to all effects](/dsp/effects/)
