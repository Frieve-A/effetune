---
layout: dsp
title: "Tape Artifacts — EffeTune DSP"
description: "Models the record and reproduce chain of a reel-to-reel tape machine, including saturation, wow and flutter, hiss, and head response."
lang: en
permalink: /dsp/effects/tape-artifacts/
---
# Tape Artifacts

Semantic type: `TapeArtifacts` · Category: lo-fi

Models the record and reproduce chain of a reel-to-reel tape machine, including saturation, wow and flutter, hiss, and head response.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `speed` | `speed` | string / 1 | `"15"` | Not declared in catalog | `7.5`, `15`, `30` |
| `tape` | `tape` | string / 1 | `"Standard"` | Not declared in catalog | `Standard`, `Master` |
| `bias` | `bias` | number / 1 | `0` | dB | -6 … 6 |
| `recordLevel` | `record_level` | number / 1 | `6` | dB | -12 … 18 |
| `wowFlutter` | `wow_flutter` | number / 1 | `0.16` | % | 0 … 1 |
| `hiss` | `hiss` | number / 1 | `-62.5` | dB re 320 nWb/m | -89 … -39 |
| `output` | `output` | number / 1 | `0` | dB | -24 … 24 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Tape Artifacts

Tape Artifacts records the music onto a modeled analog reel-to-reel machine and plays it back. The signal passes through the record amplifier and the treble lift it puts onto the tape, the magnetic saturation of the tape itself, the treble erasure caused by the record bias, the wavelength losses of the reproduce head, the wow and flutter of the transport, the low-frequency head bump, and the playback curve that takes exactly that lift off again, before tape hiss and modulation noise are added. Use it when you want music to sound as though it had been through a tape machine rather than simply having noise or wobble placed on top of it.

### How It Differs from Other Lo-Fi Effects

- **Tape Artifacts** changes the music itself. The gentle compression, the added warmth, the softened treble, and the pitch wobble all come from the same modeled record-and-reproduce chain, so they respond together to Speed, Tape, Bias, and Record Level.
- **Wow Flutter** (Modulation) reproduces only the speed variation of a transport. Choose it when you want the wobble without tape saturation, tape equalization, or hiss.
- **Saturation** and **Hard Clipping** add nonlinearity on its own, without the frequency-dependent behavior and the transport of a tape machine.
- **Noise Blender** and **Hum Generator** add a noise or hum layer over unchanged music. Here the hiss and the modulation noise are generated at the correct point in the machine, so they follow Speed and Tape the way real tape noise does.

### Sound Character Guide

- **Speed sets the basic tone:** 30 ips is the most open, 15 ips is the familiar studio sound, and 7.5 ips is darker with a stronger low-frequency lift.
- **Gentle level compression:** raise Record Level to make loud passages denser and warmer as the tape rounds their peaks. Lower it for a cleaner, more dynamic result, then match loudness with Output.
- **Warmth:** the saturation is asymmetric, so it produces both even and odd harmonics, and the warmth grows gradually as Record Level rises instead of appearing suddenly.
- **The transport is audible on sustained notes:** Wow/Flutter adds pitch drift and shimmer to piano, organ, strings, and other held sounds.
- **A living background:** Hiss adds both a steady tape floor and noise that follows the music. Set it to the minimum when you want no added tape noise.

### System Presets

Click **Effect Presets** in the effect header to compare three reel-to-reel conditions.

- **Pristine 30 ips Reel** - A fast master-tape transfer with very little hiss or pitch movement.
- **Hobbyist Reel-to-Reel** - A slower home recorder with more hiss and transport movement.
- **Tired Old Reel** - A worn low-speed tape with strong wobble, hiss, and a rougher top end.

### Parameters

- **Speed** (7.5, 15, or 30 ips) - Selects tape speed. Start at 15 ips; choose 30 ips for the cleanest, most open sound or 7.5 ips for darker tone, stronger bass lift, and more movement.
- **Tape** (Standard or Master) - Selects the tape formulation. Master has more headroom and stays cleaner at high Record Level; Standard saturates earlier. Match loudness with Output when comparing them.
- **Bias** (-6.0 to +6.0 dB) - Changes treble and distortion. Start at 0 dB. Positive values sound cleaner and darker; moderately negative values sound brighter and rougher. Extreme negative values add distortion without continuing to brighten.
- **Record Level** (-12.0 to +18.0 dB) - Controls how hard the tape is driven. Start at +6 dB, raise it for more compression and warmth, or lower it for cleaner dynamics. Use Output to match loudness.
- **Wow/Flutter** (0 to 1%) - Controls transport-related pitch movement. 0% is steady; raise it until sustained notes have the amount of drift and shimmer you want.
- **Hiss** (-89.0 to -39.0 dB re 320 nWb/m) - Controls tape hiss and signal-related modulation noise. Raise it for a more obvious tape background or set it to the minimum to switch the noise layer off.
- **Output** (-24.0 to +24.0 dB) - Adjusts the level after the whole chain. Use it to match loudness when you compare with bypass, or to bring back the loudness a high Record Level setting has cost.
- **Mix** (0 to 100%) - Blends the tape sound with the original. Start at 100% for the full effect and lower it for subtle coloration. Intermediate values can soften the highest frequencies through partial cancellation.

### Recommended Settings

1. **Studio Master Tape (default)**
   - Speed: 15 ips, Tape: Standard, Bias: 0.0 dB, Record Level: +6.0 dB
   - Wow/Flutter: 0.160%, Hiss: -62.5 dB re 320 nWb/m, Output: 0.0 dB, Mix: 100%
   - A balanced reel-to-reel sound with softened treble, gentle warmth, light hiss, and audible movement on sustained notes.

2. **Clean High-Speed Transfer**
   - Speed: 30 ips, Tape: Master, Bias: 0.0 dB, Record Level: 0.0 dB
   - Wow/Flutter: 0.070%, Hiss: -68.5 dB re 320 nWb/m, Output: 0.0 dB, Mix: 100%
   - The cleanest preset, useful as a reference when comparing stronger tape coloration.

3. **Warm and Compressed**
   - Speed: 15 ips, Tape: Standard, Bias: 0.0 dB, Record Level: +18.0 dB
   - Wow/Flutter: 0.200%, Hiss: -62.5 dB re 320 nWb/m, Output: +1.5 dB, Mix: 100%
   - Dense, warm tape compression with flattened peaks. Fine-tune Output by ear after setting the drive.

4. **Home Deck at 7.5 ips**
   - Speed: 7.5 ips, Tape: Standard, Bias: +2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.300%, Hiss: -59.5 dB re 320 nWb/m, Output: +0.5 dB, Mix: 100%
   - A darker, noisier, less steady home-machine sound with moderate saturation.

5. **Worn Transport**
   - Speed: 7.5 ips, Tape: Standard, Bias: -2.0 dB, Record Level: +15.0 dB
   - Wow/Flutter: 0.480%, Hiss: -56.5 dB re 320 nWb/m, Output: +1.0 dB, Mix: 100%
   - An intentionally degraded sound with strong pitch movement, grit, compression, and hiss.

Tape Artifacts adds about 5ms of delay when Mix is above 0%. It focuses on tape tone, saturation, hiss, and transport movement; it does not add dropouts, splice noise, or head-alignment errors.

[Back to all effects](/dsp/effects/)
