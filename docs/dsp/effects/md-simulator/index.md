---
layout: dsp
title: "MD Simulator — EffeTune DSP"
description: "Models MiniDisc ATRAC encode and decode artifacts across the SP, LP2, and LP4 recording modes."
lang: en
permalink: /dsp/effects/md-simulator/
---
# MD Simulator

Semantic type: `MDSimulator` · Category: lo-fi

Models MiniDisc ATRAC encode and decode artifacts across the SP, LP2, and LP4 recording modes.

## Contract

- Seeded: **no**
- Catalog sample rates: **44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 Hz**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `mode` | `mode` | string / 1 | `"SP (292 kbps)"` | Not declared in catalog | `SP (292 kbps)`, `LP2 (132 kbps)`, `LP4 (66 kbps)` |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 12 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## MD Simulator

MD Simulator passes the selected channels through a real-time, simplified ATRAC analysis, finite-bit spectral quantization, and synthesis path modeled on the MiniDisc format's family of codecs. Use it to hear how a clean ATRAC round trip changes transients, high-frequency detail, and tonal textures at the three recording modes a MiniDisc deck actually offered.

Mode selects one of the three real MD operating points: SP (292 kbps) uses ATRAC1, the codec of the original standard-play MiniDisc. LP2 (132 kbps) and LP4 (66 kbps) use ATRAC3, MDLP's double- and quadruple-length recording modes; LP4 also applies joint stereo coding. Lower rates leave less bit budget for the analysis filterbank and make transient smear, high-frequency "birdies"/swishing, and low-bit-allocation noise more apparent.

If the plugin reports that the effect is unavailable, try another sample rate or channel mode. The input remains unchanged until the effect becomes available.

### Sound Enhancement Guide

- **Representative MD listening:** Start with SP, Output at 0 dB, and Mix at 100%. This is the codec most MD recordings actually used and gives the cleanest comparison point.
- **Hear long-play compression:** Switch the same passage through LP2 and then LP4. Cymbals, dense percussion, and wide stereo mixes reveal progressively coarser high-frequency detail and, in LP4, a thinner, more unstable top end from the halved bit budget and joint stereo coding.
- **Expose transient behavior:** Use sharp transient sources (castanets, plucked strings, piano attacks) to hear the pre-echo smear typical of ATRAC's transient detection.
- **Blend the effect:** Reduce Mix when you want some MD character without replacing the whole signal. The dry path is latency-aligned with the decoded path.
- **Match levels before comparing:** Adjust Output only to compensate for perceived or measured loudness differences. It does not change the codec's bit allocation.

### Parameters

- **Mode** — Selects `SP (292 kbps)`, `LP2 (132 kbps)`, or `LP4 (66 kbps)`. SP uses ATRAC1; LP2 and LP4 use ATRAC3, with LP4 adding joint stereo coding. Lower bitrates leave fewer bits for spectral quantization and make codec artifacts more pronounced.
- **Output** — Adjusts the decoded output level from -24.0 to +12.0 dB. Use it for level matching; it does not alter the codec state or bit allocation.
- **Mix** — Blends the latency-aligned original with the decoded result from 0% to 100%.

[Back to all effects](/dsp/effects/)
