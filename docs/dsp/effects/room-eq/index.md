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

Room EQ creates one FIR correction filter from a frequency-response measurement saved by EffeTune and applies that same filter to every channel routed through the plugin. Use the plugin's standard bus selector to choose which channels it receives. The filter averages all points in the selected measurement, smooths the result, and reduces deviations inside the selected correction range. Use it when loudspeaker and room interactions cause repeatable peaks or broad tonal imbalance at the listening area. It can also apply linear-phase magnitude correction or mixed-phase correction that combines minimum-phase magnitude correction with correction of the measured direct sound's excess phase. By default, excess-phase correction retains the component shared by the measurement points and reduces correction where their phases disagree. Room EQ requires the WASM DSP engine; without it, the signal passes through unchanged.

### Sound Enhancement Guide

- Measure the loudspeaker or channel group that you will route through one Room EQ instance from several nearby microphone positions, then select that saved measurement. Multiple points make the correction less dependent on one exact microphone position.
- Start with **Phase: Minimum**, **Smoothing: 0.17 oct**, **Correction Low: 20 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB**, and **Level Correction: 100%**. Compare with the plugin's main on/off control to confirm that the result is more even without becoming unnaturally thin or bright.
- If the filter tries to fill narrow dips that change with microphone position, increase Smoothing or lower Max Boost. A value of 0 dB for Max Boost prevents automatic boosts while still allowing cuts to reduce peaks.
- If full level correction sounds too strong, lower Level Correction. Because it scales each automatic correction value in dB, 50% changes a +6 dB correction to +3 dB and a -8 dB correction to -4 dB.
- Limit Correction Low and Correction High to the range your loudspeaker and measurement microphone reproduce reliably. Correcting outside a trustworthy measurement range can make the result less accurate.
- After the room correction is stable, use Additional EQ for a gentle listening target, such as a broad +2 dB Low shelf around 100 Hz or a small High shelf adjustment around 10 kHz. These bands reshape the target and are built into the FIR filter.
- Use **Minimum** when low latency matters. Use **Correction** when you want to correct excess phase as well as frequency response. Start with Reference Point set to **Consensus (all points)**, the default Direct Window, and **Phase Correction: 100%**. Select an individual point only when you want to optimize the excess-phase correction for that microphone position. Lower Phase Correction independently if the phase result sounds too strong.
- Room EQ does not calculate speaker-distance alignment. **Delay** adds the same manual delay to every channel routed through this instance; use separate Room EQ instances when different channel groups need different delay values.

Measurements are device-local references. A URL or preset stores the selected measurement's name and identifier, but not the measured data. To use a measurement on another device, enable **Include impulse responses in measurement JSON exports** on the measurement screen before exporting it, then import it on the other device before selecting it. This option is off by default, and including impulse responses can make the file tens of megabytes larger. A missing measurement is shown as a warning and Room EQ uses aligned bypass instead of stale correction data.

### Parameters

- **Measurement** - Selects the one saved frequency-response measurement used by this Room EQ instance. The list shows its name, number of points, and `IR` when impulse-response data is available. Use **Refresh measurements** after adding or changing measurements.
- **Delay** - Adds 0 to 20 ms of manual delay to every channel routed through the instance. It is not included in the plugin's reported processing latency.
- **Phase** - Selects how the FIR filter handles phase.
  - **Minimum** - Minimum-phase magnitude correction with the lowest added latency.
  - **Linear** - Linear-phase magnitude correction. It preserves the input's relative phase but adds half the selected tap count as delay.
  - **Correction** - Minimum-phase magnitude correction plus correction of excess phase in the stored direct-sound impulse response. This reduces group-delay variation while retaining `Taps / 2` samples of delay for the mixed-phase filter. During design, it keeps the main impulse-energy position aligned with the Minimum response at the same Level Correction setting. One filter is designed from the selected measurement and applied unchanged to every routed channel. Changing Level Correction or Phase Correction therefore does not introduce channel-specific timing differences. It uses Reference Point and Direct Window and requires impulse-response data.
- **Taps** - FIR length: 8192, 16384, 32768, 65536, or 131072. More taps improve low-frequency resolution but increase delay, memory use, and filter-design time. Linear and Correction add `Taps / 2` samples of delay.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing; in Linear and Correction, the FIR's half-length delay is usually much larger.
- **Smoothing** - Gaussian frequency smoothing from 0.02 to 1.00 octaves. Higher values produce broader, more conservative correction; lower values follow finer response variations.
- **Correction Low / Correction High** - Set the lower and upper transition boundaries for automatic magnitude correction. Before Gaussian smoothing, automatic correction is treated as 0 dB at and outside these boundaries. Smoothing therefore controls how gradually correction fades and how far it extends beyond each boundary. The high boundary is also limited internally to leave headroom below the audio sample rate's Nyquist frequency.
- **Direct Window** - 1 to 50 ms of the measured response after the direct-sound onset used by Correction. A longer window allows phase correction to extend lower but includes more room reflections.
- **Phase Low** - Sets the lower frequency for measured excess-phase correction in Correction mode from 20 to 20000 Hz. With **Auto** selected by default, Room EQ uses the higher of Correction Low and the frequency that fits three cycles inside Direct Window (500 Hz at 6 ms). Clear Auto to set the boundary manually. The manual value is independent of Correction Low and cannot be set below the frequency of one cycle inside Direct Window (167 Hz at 6 ms). Values below the automatic boundary are more sensitive to time-window truncation and room reflections.
- **Max Boost** - 0 to 18 dB limit for boosts created by automatic response inversion. The limit is applied before Gaussian smoothing so capped regions blend smoothly into the surrounding correction curve. It does not limit cuts.
- **Level Correction** - Scales automatic magnitude correction from 0% to 100% in 1% steps, linearly in dB. At 0%, automatic level correction is disabled; Phase Correction, Additional EQ, Delay, and Gain remain active.
- **Phase Correction** - Scales the measured excess-phase correction from 0% to 100% in 1% steps and affects only the Correction mode. Its controls are disabled in Minimum and Linear modes. At 0%, excess-phase correction is disabled while Level Correction remains active. Level Correction still carries the minimum-phase shift inherently associated with its magnitude response, so Phase Correction controls only the additional measured excess-phase component.
- **Reference Point** - Selects the source of direct-sound excess phase in Correction mode. **Consensus (all points)** is the default and fallback: it time-aligns the points, combines their excess phase, gives less weight to unreliable phase around deep response nulls, and reduces correction where the points disagree. Selecting a named point uses only that point's excess phase. Magnitude correction always uses all points. If the selected point is later removed, this setting returns to Consensus.
- **Additional EQ (folded into FIR)** - Five shared target-shaping bands using the same graph and controls as 5Band PEQ. Each band can be enabled, set to Peak, Low shelf, or High shelf, and adjusted from 20 Hz to 20 kHz, -20 to +20 dB, and Q 0.1 to 10. The response is built into the FIR rather than processed by a separate IIR stage. Its phase is zero in Linear mode and minimum-phase in Minimum and Correction modes. Max Boost limits automatic room-response inversion, not intentional boosts from Additional EQ.
- **Gain** - Applies -12 to +12 dB to all channels after corrected and bypass paths are combined.

### Visual Display

- Use the **Frequency**, **Phase**, and **Impulse** radio buttons at the top of the graph to switch views.
- **Phase** uses a logarithmic frequency axis and a vertical phase axis from -180° to 180°. The gray line is the phase before correction and the green line is the calculated phase after the actual FIR. The measured onset is removed from both, and the FIR's known fixed delay is also removed from the corrected result, so the graph shows the phase change introduced by the filter without those fixed timing offsets. A measurement without impulse-response data shows an unavailable message instead.
- **Impulse** shows the selected point, or the time-aligned average waveform when Reference Point is Consensus, from 2 ms before the measured onset through the later of 5 ms or Direct Window. The gray line is before correction and the green line is the calculated result after the actual FIR. The measured onset is the shared 0 ms reference, and only the FIR's known fixed delay is removed from the corrected waveform, so relative peak timing and pre-ringing remain visible. Both lines use the same normalized amplitude scale. For this display only, components at and above 20 kHz are removed; this does not affect the correction filter or audio processing. A measurement without impulse-response data shows an unavailable message instead.
- **Frequency** uses a logarithmic frequency axis and a vertical gain axis in dB.
- The two white dotted vertical lines mark the frequencies set by Correction Low and Correction High.
- Numbered markers correspond to the five bands. Drag a marker horizontally to change frequency and vertically to change gain; disabled bands appear dimmed.
- The light gray curve shows the smoothed measured frequency response with the graph's common display offset applied.
- The thin, pale green curve shows the automatic correction calculated from the selected measurement and the current Room EQ correction settings, before Additional EQ.
- The bright green curve shows that correction with Additional EQ applied. This is the combined magnitude response folded into the FIR.
- The white curve shows the estimated corrected response obtained by adding the bright green combined correction to the light gray measured response. The gray and white curves share an offset that maps the automatic correction's 100% destination level to 0 dB; Max Boost limits can leave residual deviations, while Additional EQ intentionally reshapes the response around that reference. It is a calculated preview, not a new acoustic measurement.
- The status below the controls shows total processing latency, FIR resolution, and whether the filter asset is bypassed, staged, preparing, active, or in error.

[Back to all effects](/dsp/effects/)
