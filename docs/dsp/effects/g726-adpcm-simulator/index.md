---
layout: dsp
title: "G.726 Simulator — EffeTune DSP"
description: "Models G.726 ADPCM speech coding from 16 to 40 kbit/s with seeded radio bit errors."
lang: en
permalink: /dsp/effects/g726-adpcm-simulator/
---
# G.726 Simulator

Semantic type: `G726ADPCMSimulator` · Category: lo-fi

Models G.726 ADPCM speech coding from 16 to 40 kbit/s with seeded radio bit errors.

## Contract

- Seeded: **yes**
- Catalog sample rates: **44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 Hz**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `bitrate` | `bitrate` | string / 1 | `"32"` | kbit/s | `16`, `24`, `32`, `40` |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 12 |
| `mix` | `mix` | integer / 1 | `100` | % | 0 … 100 |
| `radioBitErrorRate` | `radio_bit_error_rate` | number / 1 | `0.000001` | Not declared in catalog | 0.000001 … 0.01 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## G.726 Simulator

G.726 Simulator passes the selected mono channel or stereo pair through a real ITU-T G.726 encode/decode round trip at an 8 kHz codec rate. A stereo pair is combined to mono before encoding, and the decoded signal is sent to both selected channels. Use it to hear the bandwidth, adaptive differential quantization, and prediction-error character of digital telephone speech coding. With Bit Error Rate at its default the path stays completely clean; raising it adds the bit errors of a wireless link such as DECT.

The four modes are the standard G.726 rates: 16, 24, 32, and 40 kbit/s. The default 32 kbit/s setting is the historical DECT full-slot speech mode. Lower rates spend fewer bits on each 8 kHz sample and make granular quantization, rough sustained tones, and slope overload more apparent. The codec is designed for speech, so full-band music exposes its limits strongly.

If the plugin reports that the effect is unavailable, try another sample rate or channel mode. Until then, the input remains unchanged.

### Sound Enhancement Guide

- **Representative telephone speech:** Start with 32 kbit/s, Output at 0 dB, and Mix at 100%. Spoken voice reveals the narrow 8 kHz path and characteristic adaptive-ADPCM texture while staying close to the historically common operating point.
- **Compare rate-dependent artifacts:** Switch between 40, 32, 24, and 16 kbit/s on the same speech passage. At lower rates, listen for coarser vowels, rougher sustained tones, and slower recovery after abrupt level changes.
- **Expose the codec with music:** Use percussion, bright sustained notes, or dense mixes at 16 or 24 kbit/s. These sources stress a speech-oriented predictor and make bandwidth and prediction-error artifacts easier to identify.
- **Add radio bit errors:** Raise Bit Error Rate toward -4.5 to -2 to hear code words break up into crackling and rough patches. Leave it at -6 for a clean encode/decode comparison.
- **Blend the effect:** Reduce Mix when you want some codec character without replacing the entire signal. The dry path is delayed to align with the decoded path, avoiding a separate comb-filter effect.
- **Match levels before comparing:** Adjust Output only to compensate for perceived or measured loudness differences. It does not change the G.726 bit allocation.

### Parameters

- **Bitrate** — Selects the standard G.726 rate: 16, 24, 32, or 40 kbit/s. Each 8 kHz sample uses 2, 3, 4, or 5 ADPCM bits respectively. Lower settings increase quantization and predictor-error artifacts; higher settings preserve the reconstructed waveform more closely.
- **Output** — Adjusts the decoded output level from -24.0 to +12.0 dB. Use it for level matching; it does not alter the codec state or bitrate.
- **Mix** — Blends the latency-aligned original with the decoded result from 0% to 100%.
- **Bit Error Rate** — Sets the wireless-link bit error rate as a power of ten, from -6 to -2 (default -6). At -6 the codec path is effectively error-free. Higher settings flip more bits inside the ADPCM code words, producing the crackling that a weak DECT-style radio link causes.

[Back to all effects](/dsp/effects/)
