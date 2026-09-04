---
layout: dsp
title: "IR Reverb — EffeTune DSP"
description: "Convolves audio with a caller-supplied impulse response."
lang: en
permalink: /dsp/effects/ir-reverb/
---
# IR Reverb

Semantic type: `IRReverb` · Category: reverb

Convolves audio with a caller-supplied impulse response.

See [Assets and bundles](/dsp/concepts/assets-and-bundles/#asset-required-effects) before using this effect.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **impulseResponse (impulseResponse)**
- Catalog-declared latency: **dynamic**; depends on latency, convolutionRate, impulseResponse

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `channelMode` | `channel_mode` | string / 1 | `"automatic"` | Not declared in catalog | `automatic`, `mono`, `independent`, `trueStereo`, `matrix` |
| `latency` | `latency` | integer / 1 | `128` | Not declared in catalog | `0`, `128`, `256`, `512`, `1024` |
| `convolutionRate` | `convolution_rate` | string / 1 | `"auto"` | Not declared in catalog | `auto`, `full`, `half`, `quarter` |
| `wetLevel` | `wet_level` | number / 1 | `-15` | dB | -96 … 12 |
| `dryEnabled` | `dry_enabled` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |
| `dryLevel` | `dry_level` | number / 1 | `0` | dB | -96 … 12 |
| `preDelay` | `pre_delay` | number / 1 | `0` | ms | 0 … 500 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## IR Reverb

IR Reverb convolves the signal with an imported impulse response (IR), reproducing the measured decay and spatial character of a room, hall, plate, or other acoustic system. It is useful when you want the repeatable character of a particular capture rather than a synthesized reverb model.

### Sound Enhancement Guide

- **Subtle room support:** import a short room IR, keep **Dry** on with **Dry Level** at 0 dB, set **Wet Level** around -18 to -12 dB, and use a short **Pre Delay**. This adds space without obscuring the recording.
- **Concert-hall expansion:** use a stereo or true-stereo hall IR, lower **Wet Level** first, then shorten an overly long tail with **Decay** and **Trim**.
- **Reverberant send/return:** route the source to another bus with **Matrix**, place IR Reverb on that return with **Dry** off and **Wet Level** at 0 dB, then use the send level to control reverb. This avoids adding the dry signal twice and also works for selected multichannel returns.
- **Comparison and repeatability:** retain the original IR file and its source/license record. The same IR bytes produce the same library ID, so another installation can relink exactly by importing that file.

### Parameters

- **Channel Mode** - Selects how IR channels are routed. **Auto** selects Mono for a one-channel IR, True Stereo for a four-channel IR on a stereo selection, Independent when the IR and selected-channel counts match, and Diagonal Matrix otherwise; the resolved mode appears to the right of the menu. **Mono** applies one IR to the selected channels; **Independent** maps one IR channel to each selected channel; **True Stereo** uses LL/LR/RL/RR paths; **Diagonal Matrix** maps matching input/output channels without crossfeed.
- **Latency** - Chooses the convolution block latency (Zero, 128, 256, 512, or 1024 samples). Higher settings generally reduce processing pressure but delay the whole effect output; the direct signal is held back by the same amount so it stays aligned with the reverb, and the pipeline compensates for the delay. **Zero** requires **Convolution Rate = Full**.
- **Convolution Rate** - Sets the rate used by the wet convolution. **Auto** uses half rate at high context rates and shows the resolved rate to the right of the menu, while **Full**, **Half**, and **Quarter** make the choice explicit. Reduced rates lower processing cost but also reduce wet-path bandwidth; Quarter requires a context rate of at least 176.4 kHz.
- **Wet Level** - Sets convolved output level from -96 to +12 dB. The default is -15 dB for typical insert use; in a send/return setup, use 0 dB and control the reverb amount with the send level.
- **Dry** - Enables the direct signal. It is on by default; turn it off to remove the dry signal completely while keeping the **Dry Level** setting for later use.
- **Dry Level** - Sets direct-signal level from -96 to +12 dB while **Dry** is on. The -96 dB endpoint also mutes the dry signal.
- **Pre Delay** - Delays only the wet signal by 0 to 500 ms, separating the original transient from the room response.
- **Direct Cut** - Removes the detected direct impulse from the IR so the capture contributes only its reverberant portion. Normalization continues to use the uncut IR as its reference, so enabling Direct Cut does not boost the remaining reverberant tail.
- **Cut Offset** - Moves the detected cut point by -20 to +50 ms when **Direct Cut** is on.
- **Decay** - Reshapes the IR decay from 10% to 400%; 100% preserves the recorded decay, lower values shorten it, and higher values extend it.
- **Trim** - Retains 1% to 100% of the post-cut IR with a fade. Shorter settings reduce tail length, CPU use, and memory.

### Reading the Decay Graph

Time runs left to right and level runs from 0 to -90 dB. The solid energy decay curve (EDC) shows how stored acoustic energy falls; a steeper descent means a shorter tail. The faint envelope gives transient context. Markers identify detected onset, the active direct-cut point, wet pre-delay, and trim point. **RT60** estimates the time for a 60 dB decay; “unavailable” means the IR did not contain a reliable fitting range. When **Decay** differs from 100%, compare the reshaped solid curve with the original dotted curve.

### Routing, Library, and Sharing

A mono IR can feed selected channels, independent IR channels stay separate, and a four-channel true-stereo IR uses LL/LR/RL/RR cross-routes. In Auto, every four-channel IR on a stereo selection is interpreted in that order; choose Independent or Diagonal Matrix explicitly for quad or other four-channel layouts. Other multichannel files use a bounded diagonal route; IR Reverb does not create a full surround crossfeed matrix. For paired true-stereo files, select matching `L`/`R` or `Left`/`Right` filenames together.

Imported IR files are kept in the **Impulse Response Library**, where you can search, load, or delete them by their original filenames. To delete several at once, select their checkboxes—or press **Ctrl+A** (**Command+A** on macOS) to select every entry currently shown—then choose **Delete selected**. WAV audio with an `.irs` filename extension can be imported without renaming it. In the web app, these files are stored in your browser and can be lost if you clear site data or the browser frees storage. The desktop app stores them with its application data. Keep a separate copy of every IR you need.

Shared URLs and presets identify the IR but do not include its audio data. If the IR is unavailable, no wet sound is produced; import or select the IR again, or choose a replacement. The direct signal continues according to **Dry** and **Dry Level**.

For freely available material, start with the University of York [OpenAIR library](https://www.openair.hosted.york.ac.uk/), [EchoThief downloads](https://www.echothief.com/downloads/), or individual IR uploads on [Freesound](https://freesound.org/). “Free” does not mean unrestricted: OpenAIR records the license on each content page, and Freesound files may be CC0, CC BY, or CC BY-NC. Check the specific download page, keep the author/source/license with the file, provide attribution where required, and confirm that your intended commercial or redistribution use is permitted. EffeTune does not store or verify licensing information.

[Back to all effects](/dsp/effects/)
