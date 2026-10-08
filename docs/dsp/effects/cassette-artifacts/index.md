---
layout: dsp
title: "Cassette Artifacts — EffeTune DSP"
description: "Models the record and reproduce chain of a compact-cassette deck, including Dolby B/C, saturation, wow and flutter, hiss, dropouts, and azimuth error."
lang: en
permalink: /dsp/effects/cassette-artifacts/
---
# Cassette Artifacts

Semantic type: `CassetteArtifacts` · Category: lo-fi

Models the record and reproduce chain of a compact-cassette deck, including Dolby B/C, saturation, wow and flutter, hiss, dropouts, and azimuth error.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `deckGrade` | `deck_grade` | string / 1 | `"Consumer"` | Not declared in catalog | `Reference`, `Hi-Fi`, `Consumer`, `Portable` |
| `tapeType` | `tape_type` | string / 1 | `"Type I"` | Not declared in catalog | `Type I`, `Type II`, `Type IV` |
| `noiseReduction` | `noise_reduction` | string / 1 | `"Dolby B"` | Not declared in catalog | `Off`, `Dolby B`, `Dolby C` |
| `bias` | `bias` | number / 1 | `0` | dB | -6 … 6 |
| `recordLevel` | `record_level` | number / 1 | `9` | dB | -12 … 18 |
| `wowFlutter` | `wow_flutter` | number / 1 | `0.2` | % | 0 … 1 |
| `hiss` | `hiss` | number / 1 | `-60.5` | dB re 250 nWb/m | -92 … -42 |
| `dropouts` | `dropouts` | number / 1 | `2` | events/min | 0 … 20 |
| `azimuth` | `azimuth` | number / 1 | `2` | arcmin | -6 … 6 |
| `dolbyLevelError` | `dolby_level_error` | number / 1 | `0` | dB | -3 … 3 |
| `output` | `output` | number / 1 | `0` | dB | -24 … 24 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |
| `mode` | `mode` | string / 1 | `"All"` | Not declared in catalog | `Encode Only`, `Encode + Artifacts`, `All`, `Artifacts + Decode`, `Decode Only` |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Cassette Artifacts

Cassette Artifacts combines cassette frequency response, tape compression, hiss, wow and flutter, dropouts, and head-alignment changes. Use it for a complete cassette-deck character rather than a noise layer added over unchanged music.

Mode also lets you use Dolby encoding or decoding alone, or choose which stages to combine.

### How It Differs from Other Lo-Fi Effects

- **Tape Artifacts** gives a cleaner, wider-band open-reel sound with selectable speed. Cassette Artifacts is darker and offers cassette-specific Deck Grade, Tape Type, noise reduction, dropouts, and head alignment.
- **Wow Flutter** (Modulation) reproduces only the speed variation of a transport. Choose it when you want the wobble without tape saturation, the Type and bias behavior, the noise reduction, or the hiss.
- **Saturation** and **Hard Clipping** add nonlinearity on its own, without the frequency-dependent behavior and the transport of a tape machine.
- **Vinyl Artifacts**, **Noise Blender** and **Hum Generator** add noise without changing the music's frequency response or dynamics.

### Sound Character Guide

- **Deck Grade** moves from the wide, steady Reference sound toward the darker and less stable Portable sound.
- Raise **Record Level** for stronger compression and saturation; lower it for cleaner dynamics. Use Output to match loudness afterward.
- **Tape Type** changes noise and headroom. Type I is the noisiest, Type II is balanced, and Type IV keeps bright peaks cleaner.
- **Noise Reduction** lowers hiss. Dolby C is stronger than Dolby B, while Off gives the rawest cassette background.
- Raise **Wow/Flutter**, **Hiss**, or **Dropouts** for a more worn sound. **Azimuth** darkens and shifts the high frequencies between channels.

For Dolby decoding alone, choose **Mode: Decode Only**. To hear a Dolby B recording played with Dolby C, add two Cassette Artifacts instances in order: **Encode + Artifacts** with **Noise Reduction: Dolby B**, then **Decode Only** with **Noise Reduction: Dolby C**. Set the same **Record Level** on both, with **Output: 0 dB** and **Mix: 100%**, to keep the level reference matched between stages.

### System Presets

Click **Effect Presets** in the effect header to switch between complete cassette-deck characters.

- **Flagship Deck Metal** - A quiet, steady reference deck using metal tape and Dolby C.
- **Hi-Fi Chrome** - A clean Type II cassette with restrained hiss and pitch movement.
- **Pocket Cassette Player** - A portable-player sound with noise, wobble, and head misalignment.
- **Worn Mixtape** - A heavily used tape with dropouts, wobble, and rougher saturation.
- **Hot Deck Saturation** - A deliberately hard-driven cassette sound with stronger tape compression.

### Parameters

Compact cassette speed is fixed, so there is no Speed control.

- **Mode** (default: All) - Selects stages in this order: Dolby encoding → cassette recording/playback → Dolby decoding. **Encode Only** and **Decode Only** run only the corresponding Dolby stage. **Encode + Artifacts** omits decoding; **Artifacts + Decode** omits encoding; **All** runs every stage. Controls for skipped stages are disabled.
- **Deck Grade** (Reference, Hi-Fi, Consumer or Portable) - Chooses the deck character. Reference is widest and steadiest; Portable is darkest and least stable. Start with Consumer for a familiar home-deck sound.
- **Tape Type** (Type I, Type II or Type IV) - Changes tape noise and headroom. Type I is noisiest, Type II is balanced, and Type IV keeps bright peaks cleaner.
- **Noise Reduction** (Off, Dolby B or Dolby C) - Chooses the Dolby system for the active encoding and decoding stages. Encoding boosts quiet parts of the signal, especially treble; decoding reduces them. Dolby C acts more strongly than Dolby B. Off bypasses both Dolby stages and leaves any cassette artifacts active.
- **Bias** (-6.0 to +6.0 dB) - Changes treble and distortion. Start at 0 dB. Small positive values sound cleaner and darker; small negative values sound brighter and rougher. Extreme negative settings become distorted without continuing to brighten.
- **Record Level** (-12.0 to +18.0 dB) - Sets tape drive and the signal level relative to the Dolby reference. Start at +9 dB. With cassette artifacts active, raise it for denser compression and saturation or lower it for cleaner dynamics. In Dolby-only modes it changes the amount of level-dependent processing. Use the same value when combining encoding and decoding in separate instances.
- **Wow/Flutter** (0 to 1%) - Controls pitch instability. 0% is steady, the 0.200% default gives audible cassette movement on sustained notes, and higher values create a worn-deck warble.
- **Hiss** (-92.0 to -42.0 dB re 250 nWb/m) - Controls tape hiss and signal-related modulation noise. Raise it for a noisier tape or set it to the minimum to switch the noise layer off. The status line shows the resulting background level for the current settings.
- **Dropouts** (0 to 20 events/min) - Sets how often brief signal dips occur. 0 disables them, 2 events/min gives occasional wear, and higher values sound increasingly damaged.
- **Azimuth** (-6.0 to +6.0 arcmin) - Simulates head misalignment. Move away from 0 to soften treble and change the left/right timing; the sign selects which channel leads.
- **Dolby Level Error** (-3.0 to +3.0 dB) - Simulates a mismatch between recording and playback decks when decoding is active and Noise Reduction is on. Positive values sound brighter and hissier; negative values sound duller. Start at 0 dB.
- **Output** (-24.0 to +24.0 dB) - Adjusts the level after the whole chain. Use it to match loudness when you compare with bypass, or to bring back the loudness a high Record Level setting has cost.
- **Mix** (0 to 100%) - Blends the processed sound with the original. Start at 100% to judge the full effect; lower it for a subtler result. With cassette artifacts active, intermediate values can soften the highest frequencies because the two paths partly cancel there.

### Recommended Settings

1. **Ordinary Cassette Deck (default)**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Dolby B, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.200%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 2.0 events/min, Azimuth: +2.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - A familiar home-cassette sound with softened treble, audible compression, light pitch movement, and occasional dropouts.

2. **Reference Deck, Metal Tape with Dolby C**
   - Deck Grade: Reference, Tape Type: Type IV, Noise Reduction: Dolby C, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.040%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 0.0 events/min, Azimuth: 0.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - The cleanest cassette preset: wide, steady, and quiet, with strong high-frequency headroom and no added wear.

3. **Ferric Tape, No Noise Reduction**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Off, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.200%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 2.0 events/min, Azimuth: +2.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - Raw ferric cassette playback with clearly audible hiss in quiet passages and no noise-reduction coloration.

4. **Home Deck, Slightly Over-Biased**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Dolby B, Bias: +2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.300%, Hiss: -58.0 dB re 250 nWb/m, Dropouts: 4.0 events/min, Azimuth: +3.0 arcmin, Dolby Level Error: -1.0 dB, Output: +0.5 dB, Mix: 100%
   - A darker, more compressed home-deck sound with extra wobble, hiss, misalignment, and occasional dropouts.

5. **Portable, Worn Tape**
   - Deck Grade: Portable, Tape Type: Type I, Noise Reduction: Off, Bias: -2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.480%, Hiss: -54.0 dB re 250 nWb/m, Dropouts: 8.0 events/min, Azimuth: +4.0 arcmin, Dolby Level Error: 0.0 dB, Output: +1.0 dB, Mix: 100%
   - An intentionally degraded portable-player sound with narrow bandwidth, strong wobble, noise, distortion, and frequent dropouts.

[Back to all effects](/dsp/effects/)
