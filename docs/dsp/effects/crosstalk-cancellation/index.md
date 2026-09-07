---
layout: dsp
title: "Crosstalk Cancellation — EffeTune DSP"
description: "Applies prepared true-stereo cancellation filters to stereo playback."
lang: en
permalink: /dsp/effects/crosstalk-cancellation/
---
# Crosstalk Cancellation

Semantic type: `CrosstalkCancellation` · Category: spatial

Applies prepared true-stereo cancellation filters to stereo playback.

See [Assets and bundles](/dsp/concepts/assets-and-bundles/#asset-required-effects) before using this effect.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **impulseResponse (impulseResponse)**
- Catalog-declared latency: **dynamic**; depends on latencyMode, filterDelaySamples, impulseResponse

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `latencyMode` | `latency_mode` | string / 1 | `"128"` | Not declared in catalog | `0`, `128`, `256`, `512`, `1024` |
| `filterDelaySamples` | `filter_delay_samples` | integer / 1 | `2048` | Not declared in catalog | 0 … 65536 |
| `strength` | `strength` | number / 1 | `70` | % | 0 … 100 |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 24 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Crosstalk Cancellation

Crosstalk Cancellation uses measurements made at your ears to reduce the sound from each stereo speaker reaching the opposite ear. Use it with two stereo speakers when you listen from one measured position and want a more distinct, binaural-like stereo image. It is not for headphones or mono playback.

Unlike [Crossfeed Filter](/dsp/effects/crossfeed-filter/), which adds a little speaker-like crosstalk for headphone listening, Crosstalk Cancellation reduces measured crosstalk for speaker listening.

### Measure and Assign

1. Place the microphone at your left ear position and make one measurement with both the left and right speaker outputs selected. Assign that measurement's left channel to **LL: L Speaker → Left Ear** and right channel to **RL: R Speaker → Left Ear**.
2. Move the microphone to your right ear position and repeat the same two-output measurement. Assign its left channel to **LR: L Speaker → Right Ear** and right channel to **RR: R Speaker → Right Ear**.
3. Use single-point measurements made at the same speaker and listening setup. Assign a different measurement channel to every slot, then wait for the filters to become ready.

Start with the defaults: **Taps** 4096, **Regularization** 50%, **Max Gain** 12 dB, **Freq Low** 200 Hz, **Freq High** 6000 Hz, **Direct Window** 8 ms, **Strength** 70%, **Output Gain** 0 dB, and **Latency** 128 samples. Compare with bypass and make small changes while seated at the measured position.

### Parameters

- **Taps** (1024–16384): Sets the filter length. More taps can improve cancellation but require more processing and add a longer modeled delay. If the status warns that the filter tail may be truncated, increase Taps first.
- **Regularization** (0–100%): Limits aggressive correction where the measurements are difficult to cancel. Increase it if the result sounds unstable or colored when you move slightly; decrease it only if the measured position needs more cancellation.
- **Max Gain** (0–24 dB): Caps how much the correction filters can boost. A lower value is gentler and preserves headroom; a higher value can cancel more but may make the result less robust.
- **Freq Low** (20–2000 Hz) and **Freq High** (1000–20000 Hz): Set the main correction band. Lower frequencies below the selected band and higher frequencies above it pass through. Begin with 200 Hz–6000 Hz; narrow the band if the effect is too sensitive to head movement.
- **Direct Window** (2–50 ms): Sets how much of each measured direct sound is used. A shorter window reduces room reflections but can raise the effective low-frequency limit; a longer window includes more low-frequency information but may include more room sound.
- **Strength** (0–100%): Blends from the delayed uncorrected signal at 0% to full correction at 100%. Start at 70%; reduce it if the sound becomes unnatural away from the measured position.
- **Output Gain** (-24 to +24 dB): Adjusts the final level after correction. Keep it at 0 dB first, then reduce it if needed to leave headroom.
- **Latency** (0, 128, 256, 512, or 1024 samples): Selects the processing block latency. Higher values can make filter processing easier; lower values are preferable when monitoring latency matters.

### Status and Latency

The status begins with **Assign all four measurements to begin.** While the filters are being made it shows that design is in progress; when ready, it reports the maximum filter gain. A tail warning means increasing **Taps** or **Regularization** may help. A warning that **Direct Window** raised the effective low frequency means the selected window is too short to use the requested lowest frequencies.

If an assigned measurement cannot be found, reselect it. If the filters cannot be prepared, try fewer **Taps** or a higher **Latency**. Until four suitable measurements are assigned and the filters are ready, the plugin passes audio through unchanged and reports no added processing latency.

Once ready, the total added latency is the selected **Latency** plus the filter's modeled delay; the app applies its normal pipeline delay compensation. Check **Total Delay** if real-time monitoring or audio/video synchronization matters. Crosstalk Cancellation has no graph or other visualization.

[Back to all effects](/dsp/effects/)
