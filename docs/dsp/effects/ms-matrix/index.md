---
layout: dsp
title: "MS Matrix — EffeTune DSP"
description: "Encodes, decodes, or adjusts mid-side stereo components."
lang: en
permalink: /dsp/effects/ms-matrix/
---
# MS Matrix

Semantic type: `MSMatrix` · Category: spatial

Encodes, decodes, or adjusts mid-side stereo components.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `mode` | `mode` | integer / 1 | `0` | Not declared in catalog | 0 … 1 |
| `midGain` | `mid_gain` | number / 1 | `0` | dB | -18 … 18 |
| `sideGain` | `side_gain` | number / 1 | `0` | dB | -18 … 18 |
| `swap` | `swap` | integer / 1 | `0` | Not declared in catalog | 0 … 1 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## MS Matrix

MS Matrix converts normal stereo audio to Mid/Side format, or converts Mid/Side audio back to normal stereo. Use it when you want to adjust center and side information separately inside an effect chain, such as encoding to M/S, changing the Mid or Side level, then decoding back to stereo. For simple stereo width adjustment on normal music, [Stereo Blend](/dsp/effects/stereo-blend/) is the more direct tool.

### Key Features
- Separate Mid and Side gain (–18 dB to +18 dB)<br>
- Mode switch: Encode (Stereo→M/S) or Decode (M/S→Stereo)<br>
- Optional Left/Right swap before encoding or after decoding<br>

### Parameters
- **Mode** (Encode/Decode): Encode turns left/right stereo into Mid on the left channel and Side on the right channel. Decode treats the left channel as Mid and the right channel as Side, then rebuilds normal stereo.
- **Mid Gain** (–18 dB to +18 dB): Adjusts the Mid level during the selected conversion.
- **Side Gain** (–18 dB to +18 dB): Adjusts the Side level during the selected conversion.
- **Swap L/R** (Off/On): Swaps left and right channels before encoding or after decoding<br>

### Recommended Settings
1. **Subtle Widening for Normal Stereo**
   - First MS Matrix: Mode: Encode, Mid Gain: 0 dB, Side Gain: +3 dB, Swap: Off
   - Second MS Matrix after it: Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Effect: Slightly strengthens the Side component, then returns the result to normal stereo
2. **Center Focus for Normal Stereo**
   - First MS Matrix: Mode: Encode, Mid Gain: +3 dB, Side Gain: -3 dB, Swap: Off
   - Second MS Matrix after it: Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Effect: Brings vocals and centered sounds forward while reducing side ambience
3. **Decode Existing M/S Audio**
   - Mode: Decode
   - Mid Gain: 0 dB
   - Side Gain: 0 dB
   - Swap: Off
   - Use only when the incoming signal is already Mid/Side format
4. **Creative Flip**
   - Mode: Encode<br>
   - Mid Gain: 0 dB<br>
   - Side Gain: 0 dB<br>
   - Swap: On<br>

### Quick Start Guide
1. Decide whether you need a single conversion or a full Encode -> adjust -> Decode chain.
2. For normal stereo listening, place one MS Matrix in Encode mode and a second one later in Decode mode.
3. Adjust **Mid Gain** and **Side Gain** on the Encode stage.
4. Enable **Swap L/R** only for channel correction or creative inversion.
5. Bypass to compare and make sure the stereo image still feels natural.

[Back to all effects](/dsp/effects/)
