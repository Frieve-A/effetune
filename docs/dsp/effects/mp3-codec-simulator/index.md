---
layout: dsp
title: "MP3 Codec Simulator — EffeTune DSP"
description: "Models MP3 perceptual audio coding artifacts across bitrates, stereo modes, and reservoir use."
lang: en
permalink: /dsp/effects/mp3-codec-simulator/
---
# MP3 Codec Simulator

Semantic type: `MP3CodecSimulator` · Category: lo-fi

Models MP3 perceptual audio coding artifacts across bitrates, stereo modes, and reservoir use.

## Contract

- Seeded: **no**
- Catalog sample rates: **44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 Hz**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `codecRate` | `codec_rate` | string / 1 | `"44.1 kHz (MPEG-1)"` | Not declared in catalog | `22.05 kHz (MPEG-2)`, `44.1 kHz (MPEG-1)` |
| `bitrate` | `bitrate` | string / 1 | `"64"` | Not declared in catalog | `32`, `48`, `64`, `80`, `96`, `112`, `128`, `160`, `192`, `224`, `256`, `320` |
| `stereoMode` | `stereo_mode` | string / 1 | `"Joint Stereo"` | Not declared in catalog | `Joint Stereo`, `Stereo` |
| `bitReservoir` | `bit_reservoir` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 12 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## MP3 Codec Simulator

MP3 Codec Simulator passes the selected channels through a real-time, simplified MPEG Layer III analysis, finite-bit spectral quantization, and synthesis path. Use it to hear how a clean MP3 round trip changes transients, high-frequency detail, tonal textures, and stereo imaging at low bitrates. It models codec processing only; it does not add damaged-file clicks, dropouts, packet loss, or transmission errors.

The 44.1 kHz MPEG-1 profile offers 32–320 kbit/s. The 22.05 kHz MPEG-2 profile offers 32–160 kbit/s and naturally limits the coded bandwidth more strongly. High settings are useful as comparison points and may sound very close to the input on some material.

This effect requires its WebAssembly processing engine. If that engine or the selected sample-rate/channel mode is unavailable, the input remains unchanged and the plugin shows a plain-language status message.

### Sound Enhancement Guide

- **Clearly audible low-bitrate MP3:** Start with 44.1 kHz, 48 or 64 kbit/s, Joint Stereo, Bit Reservoir On, and Mix at 100%. Percussion, cymbals, sustained tones, and wide stereo recordings reveal the codec most readily.
- **Stronger bandwidth limitation:** Choose 22.05 kHz at 32 or 48 kbit/s. This profile is useful for comparing early low-rate downloads and streaming-like constraints with the 44.1 kHz profile.
- **Hear the reservoir working:** Keep a track with quiet and dense passages at 48 or 64 kbit/s, then switch Bit Reservoir Off. With it off, every frame must fit its own bit budget, so dense transients can become rougher.
- **Compare subtle and obvious degradation:** Compare 64 kbit/s with 128 or 192 kbit/s at 44.1 kHz. The higher setting does not guarantee a completely transparent result, but it shows how added bit budget preserves more detail.
- **Blend the effect:** Reduce Mix when you want some codec character without replacing the whole signal. The dry path is latency-aligned with the coded path.

### Parameters

- **Codec Rate** — Selects `44.1 kHz (MPEG-1)` or `22.05 kHz (MPEG-2)`. This changes the codec profile, frame structure, and coded bandwidth; it is not just a playback sample-rate control.
- **Bitrate** — Sets the total constant bitrate for the mono or stereo stream. MPEG-1 supports 32, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, and 320 kbit/s. MPEG-2 supports the same choices through 160 kbit/s. Lower values leave fewer bits for each transform frame and make spectral holes, rough tonal components, and transient smear more likely.
- **Stereo Mode** — `Joint Stereo` can encode the first stereo pair as Mid/Side when that is more efficient. `Stereo` keeps the left and right spectra separate. Joint Stereo does not simply convert the output to mono.
- **Bit Reservoir** — Lets simple frames save unused main-data capacity for later complex frames. Turning it off makes every frame meet its own budget and can expose stronger frame-to-frame quality variation.
- **Output** — Adjusts the decoded level from -24.0 to +12.0 dB. Lower it if transform overshoot makes peaks too high.
- **Mix** — Blends the latency-aligned original with the decoded result from 0% to 100%.

[Back to all effects](/dsp/effects/)
