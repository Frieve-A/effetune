---
layout: dsp
title: "GSM-FR Simulator — EffeTune DSP"
description: "Models GSM full-rate speech coding with repeated transcoding and seeded carrier interference."
lang: en
permalink: /dsp/effects/gsm-full-rate-simulator/
---
# GSM-FR Simulator

Semantic type: `GSMFullRateSimulator` · Category: lo-fi

Models GSM full-rate speech coding with repeated transcoding and seeded carrier interference.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **yes**
- Catalog sample rates: **44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 Hz**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `transcodes` | `transcodes` | integer / 1 | `1` | Not declared in catalog | 1 … 3 |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 12 |
| `mix` | `mix` | integer / 1 | `100` | % | 0 … 100 |
| `carrierToInterference` | `carrier_to_interference` | number / 1 | `30` | dB | 4 … 30 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## GSM-FR Simulator

When the audio output has one channel, GSM-FR Simulator processes that channel directly. With two or more output channels, it combines the selected stereo pair to mono. It then resamples the mono signal to 8 kHz and passes it through the standardized 13 kbit/s GSM-FR RPE-LTP encoder and decoder. The decoded result returns to the single output channel or to both channels of the selected pair. Use it to examine how early digital mobile speech coding changes voices, percussion, sustained tones, and dense music. With C/I at its default the path stays completely clean; lowering it reproduces poor GSM reception.

Each 20 ms frame is represented by quantized linear-prediction, long-term-prediction, and regular-pulse-excitation parameters. Transcodes repeats the complete encode/decode stage with independent state, reproducing tandem coding rather than acting as a generic quality control. Additional channels beyond the selected stereo pair remain unchanged.

This effect requires its WebAssembly processing engine. If that engine or the selected sample-rate/channel mode is unavailable, the input remains unchanged and the plugin shows a plain-language status message. When processing resumes after suspension, the resamplers, frame buffers, and codec state restart together so buffered pre-suspension audio is not replayed.

### Sound Enhancement Guide

- **Representative early-mobile speech:** Set Transcodes to 1, Output to 0 dB, and Mix to 100%, then compare voices, cymbals, and percussion with bypass.
- **Hear tandem coding:** Keep the same passage and change Transcodes from 1 to 2 to 3. Warble, chirping, and loss of clarity increase because the signal is genuinely encoded and decoded again. Radio reception errors are separate: at the default C/I of 30 dB there are none, and lowering C/I reproduces them.
- **Expose the speech model with music:** Use Transcodes 3 on bright or dense music to make the 8 kHz speech bandwidth, RPE-LTP buzz, and formant reshaping easier to identify.
- **Blend the result:** Lower Mix to restore some of the original stereo signal. The dry path is aligned to the codec latency.
- **Match levels before comparing:** Adjust Output only to compensate for perceived or measured loudness differences. It does not change the codec algorithm.

### Parameters

- **Transcodes** — Selects 1, 2, or 3 complete GSM-FR encode/decode passes. Every pass has independent state and uses the same 13 kbit/s codec. Higher settings increase tandem-coding artifacts.
- **Output** — Adjusts the decoded output level from -24.0 to +12.0 dB. Use it for level matching; it does not alter the codec state or bit rate.
- **Mix** — Blends the latency-aligned original with the decoded result from 0% to 100%. At 100%, a selected stereo pair carries the same decoded mono signal on both channels; lower settings restore the original stereo difference.
- **C/I** — Sets the carrier-to-interference ratio of the radio link from 4 to 30 dB (default 30). At 30 dB reception is effectively perfect. Lower values add frame erasures with GSM 06.11-style concealment (previous frame repeated and attenuated, muting after consecutive losses) plus Class 2 bit-error distortion, giving the ragged dropouts of a phone at the edge of coverage. With Transcodes above 1 the degradation is applied to the final hop only.

[Back to all effects](/dsp/effects/)
