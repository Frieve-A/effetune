---
layout: dsp
title: "TV Audio Simulator — EffeTune DSP"
description: "Models analogue and NICAM television sound reception, including bandwidth, stereo and programme behavior, reception impairment, and picture-related buzz."
lang: en
permalink: /dsp/effects/tv-audio-simulator/
---
# TV Audio Simulator

Semantic type: `TVAudioSimulator` · Category: lo-fi

Models analogue and NICAM television sound reception, including bandwidth, stereo and programme behavior, reception impairment, and picture-related buzz.

This type has catalog telemetry metadata but no public observation API. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **yes**
- Catalog sample rates: **44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 Hz**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate
- Telemetry: **catalog metadata only; no public observation API**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `broadcast` | `broadcast` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |
| `standard` | `standard` | string / 1 | `"M/EIA-J"` | Not declared in catalog | `M/EIA-J`, `M/BTSC`, `M/A2`, `B/G A2`, `B/G NICAM`, `I NICAM`, `D/K Mono`, `L AM` |
| `txMode` | `tx_mode` | string / 1 | `"Stereo"` | Not declared in catalog | `Stereo`, `Mono`, `Dual` |
| `processing` | `processing` | number / 1 | `0` | dB | 0 … 18 |
| `signal` | `signal` | number / 1 | `35` | dBuV | 0 … 70 |
| `tuning` | `tuning` | number / 1 | `0` | kHz | -200 … 200 |
| `ifBandwidth` | `if_bandwidth` | number / 1 | `230` | kHz | 80 … 240 |
| `multipath` | `multipath` | number / 1 | `0` | % | 0 … 100 |
| `pathDelay` | `path_delay` | number / 1 | `5` | us | 0.5 … 50 |
| `fading` | `fading` | number / 1 | `0` | Hz | 0 … 20 |
| `receiveMode` | `receive_mode` | string / 1 | `"Auto"` | Not declared in catalog | `Auto`, `Stereo`, `Main`, `Sub` |
| `buzz` | `buzz` | number / 1 | `-80` | dB | -80 … -20 |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 24 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## TV Audio Simulator

TV Audio Simulator passes music through the sound path of an analogue television broadcast or a NICAM digital television service. Use it to compare regional television sound systems, hear stereo collapse or programme switching as reception worsens, or add the narrow bandwidth, multipath distortion, hiss, and picture-related buzz associated with older television reception. NICAM standards use a digital main path and change to the accompanying analogue FM mono sound when the digital signal can no longer be received reliably.

### Sound Enhancement Guide

- Start with the Standard for the region or sound you want, leave Signal at 35 dBµV, Tuning at 0 kHz, Multipath and Fading at 0, and Mix at 100%.
- For a clean period-TV sound, raise Signal and keep Tuning centered. Use Processing for a denser analogue broadcast sound; it does not affect the NICAM digital main path.
- For difficult analogue reception, lower Signal first, then add Multipath or a small Tuning offset. Path Delay changes the character of multipath distortion.
- With B/G NICAM or I NICAM, lower Signal gradually to hear digital damage and the transition to analogue FM mono. The HUD shows `NICAM` while the digital path is selected and `FALLBACK` after the changeover.
- In the Video Buzz tab, raise Buzz only when you want mains and scan-related tones. Its minimum value, -80 dB, turns the buzz off.

### System Presets

The nine presets select representative regional systems: Japan TV (M / EIA-J), North America TV (M / BTSC), Korea TV (M / A2), Europe TV (B/G / A2), Australia TV (B/G / A2), UK TV (I / NICAM), Nordic TV (B/G / NICAM), Eastern Europe TV (D/K mono), and France TV (L / AM sound). They also provide a useful reception starting point; adjust Signal, Tuning, Multipath, and Fading for the amount of damage you want.

### Parameters

- **Broadcast**: Turns the modeled transmission on or off. Off leaves the receiver on an empty channel rather than bypassing the effect.
- **Standard**: Selects M/EIA-J, M/BTSC, M/A2, B/G A2, B/G NICAM, I NICAM, D/K Mono, or L AM. This also sets the modulation, emphasis, channel spacing behavior, and 50/60 Hz scan family used by the model.
- **Tx Mode**: Selects Stereo, Mono, or Dual programme transmission. Dual carries a main and secondary programme only on standards that support it; BTSC Dual is reproduced as main mono.
- **Processing**: Increases analogue transmitter compression and density from 0 to 18 dB. It applies to analogue sound and the analogue fallback, not to the NICAM digital main path.
- **Signal**: Sets received strength from 0 to 70 dBµV. Lower values add analogue noise and loss of stereo, or increase NICAM errors and eventually cause fallback.
- **Tuning**: Offsets receiver tuning by -200 to +200 kHz. Moving away from 0 narrows and distorts reception and can remove the programme entirely.
- **IF Band**: Sets the receiver passband from 80 to 240 kHz. Narrower settings reject more off-frequency energy but remove more programme bandwidth when tuning is offset.
- **Multipath** (0–100%): Adds a delayed reflected signal. Higher values increase comb-like coloration, stereo instability, and reception distortion.
- **Path Delay**: Sets the reflected-path delay from 0.5 to 50 µs. Short delays produce broad coloration; longer delays create more closely spaced peaks and dips.
- **Fading**: Sets reception-level movement from 0 to 20 Hz. Raise it for faster fluttering or repeated changes between clear and impaired reception.
- **Receive Mode**: `Auto` follows the available stereo, main, secondary, NICAM, or fallback path. `Stereo`, `Main`, and `Sub` request a particular programme; combinations the selected transmission cannot supply return to the main mono programme.
- **Buzz**: Sets picture-related 50/60 Hz buzz from -80 to -20 dB. -80 dB is off. Buzz is heard on analogue paths, including NICAM fallback.
- **Output Gain**: Adjusts the final level from -24 to +24 dB. Reduce it if transmitter processing or reception artifacts make peaks too strong.
- **Mix**: Blends the original and television paths from 0% to 100%.

### Reading the HUD

The HUD shows the selected television standard and the path currently heard: `STEREO`, `MAIN`, `SUB`, `NICAM`, `FALLBACK`, or `AM`. Carrier and CNR indicate received level and estimated signal quality. Health shows whether the selected stereo or digital path is usable; Multipath reports the reflected-signal depth, and Errors reports the reception error rate per second. The spectrum represents recovered multiplex audio for analogue FM, detected audio for L AM, and the selected output for NICAM.

The model focuses on audible television sound behavior. It does not generate a complete television picture-and-radio-frequency channel, and its A2 and NICAM paths reproduce the listening effects rather than serving as broadcast test signals.

[Back to all effects](/dsp/effects/)
