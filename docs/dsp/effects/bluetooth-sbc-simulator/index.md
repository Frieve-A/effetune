---
layout: dsp
title: "SBC Codec Simulator — EffeTune DSP"
description: "Models Bluetooth SBC audio coding with bitpool, channel-mode, and seeded packet-loss behavior."
lang: en
permalink: /dsp/effects/bluetooth-sbc-simulator/
---
# SBC Codec Simulator

Semantic type: `BluetoothSBCSimulator` · Category: lo-fi

Models Bluetooth SBC audio coding with bitpool, channel-mode, and seeded packet-loss behavior.

## Contract

- Seeded: **yes**
- Catalog sample rates: **44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 Hz**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `bitpool` | `bitpool` | integer / 1 | `35` | Not declared in catalog | 2 … 53 |
| `channelMode` | `channel_mode` | string / 1 | `"Joint Stereo"` | Not declared in catalog | `Joint Stereo`, `Stereo`, `Dual Channel` |
| `blocks` | `blocks` | string / 1 | `"16"` | Not declared in catalog | `4`, `8`, `12`, `16` |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 12 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |
| `packetLoss` | `packet_loss` | number / 1 | `0` | % | 0 … 20 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## SBC Codec Simulator

SBC Codec Simulator passes the selected channels through a real-time SBC analysis, bit allocation, quantization, and synthesis path. Use it to hear how the mandatory baseline codec for Bluetooth A2DP can change high-frequency detail, tonal textures, transients, and stereo imaging. With Packet Loss at its default the round trip is completely clean; raising it reproduces the dropouts of a real Bluetooth link.

The read-only Bitrate value shows the resulting stream rate for the current Bitpool, Channel Mode, and Blocks settings. Use it when comparing configurations; Bitpool itself is not a bitrate.

If the plugin reports that the effect is unavailable, try another sample rate or channel mode. The input remains unchanged until the effect becomes available.

### Sound Enhancement Guide

- **Typical clean SBC comparison:** Start with Bitpool 35, Joint Stereo, 16 Blocks, and Mix at 100%. Compare cymbals, sustained tones, percussion, and wide stereo recordings with bypass.
- **Make codec artifacts easier to hear:** Lower Bitpool toward 12–20. Fewer quantization bits are available to the eight subbands, so high-frequency detail and tonal residuals become more obvious.
- **Compare stereo allocation:** Switch between Joint Stereo and Stereo while watching Bitrate. Joint Stereo can code correlated stereo content more efficiently, while Stereo keeps left and right subbands separate.
- **Reproduce SBC XQ:** Select Dual Channel and set Bitpool to 38 for the common "SBC XQ" configuration, or 47 for "SBC XQ+". On a 44.1 kHz source the Bitrate reads 452.0 and 551.3 kbit/s, matching the well-known figures. Bitpool 53 reaches 617.4 kbit/s, the highest rate this simulator can produce. These settings are outside the A2DP recommendation but are what high-bitrate SBC senders actually transmit, and they are where the codec becomes hardest to distinguish from bypass.
- **Compare frame adaptation:** Change Blocks from 16 to 4. Shorter frames update scale factors more often but spend a larger share of each frame on fixed overhead, which also changes the displayed bitrate.
- **Add wireless dropouts:** Raise Packet Loss toward 5–20% to hear frames disappear in bursts and the concealment fade in. Leave it at 0% for a clean encode/decode comparison.
- **Blend the effect:** Reduce Mix when you want some SBC character without replacing the whole signal. The dry path is latency-aligned with the coded path.

### Parameters

- **Bitpool** — Sets the quantization-bit budget per SBC frame, from 2 to 53. `Joint Stereo` and `Stereo` share this budget across the stereo pair, while `Dual Channel` spends it on each channel separately. Lower values leave more subbands with few or no bits and make codec artifacts stronger. Bitpool is not a direct kbit/s value.
- **Channel Mode** — `Joint Stereo` may encode correlated subbands as sum/difference when that reduces the required scale factors. `Stereo` keeps left and right subbands separate. Both share one bitpool across the first stereo pair; Joint Stereo does not simply make the output mono. `Dual Channel` gives each channel its own independent allocation at the full bitpool, so the frame and the bitrate roughly double: this is the configuration behind "SBC XQ", and because left and right are quantized independently the stereo image fluctuates differently than under Joint Stereo.
- **Blocks** — Selects 4, 8, 12, or 16 subband-sample blocks per SBC frame. Fewer blocks shorten the codec frame and increase fixed overhead relative to coded audio; more blocks adapt scale factors less often.
- **Bitrate** — Shows the current stream rate in kbit/s. It updates when Bitpool, Channel Mode, Blocks, sample rate, or mono/stereo routing changes.
- **Packet Loss** — Sets the Bluetooth link packet loss rate from 0% to 20% (default 0%). At 0% no frames are lost. Higher values drop whole SBC frames in bursts (Gilbert-Elliott model), and the built-in concealment repeats the previous frame with attenuation before fading to silence, giving the interruptions of a real wireless link.
- **Output** — Adjusts the decoded level from -24.0 to +12.0 dB (default 0.0 dB). Lower it if codec filter overshoot makes peaks too high.
- **Mix** — Blends the latency-aligned original with the decoded result from 0% to 100%.

[Back to all effects](/dsp/effects/)
