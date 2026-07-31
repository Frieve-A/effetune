---
layout: dsp
title: "Hum Generator — EffeTune DSP"
description: "Adds power-line hum and harmonics at controlled levels."
lang: en
permalink: /dsp/effects/hum-generator/
---
# Hum Generator

Semantic type: `HumGenerator` · Category: lo-fi

Adds power-line hum and harmonics at controlled levels.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `frequency` | `frequency` | number / 1 | `50` | Hz | 10 … 120 |
| `humType` | `hum_type` | string / 1 | `"Standard"` | Not declared in catalog | `Standard`, `Rich`, `Dirty` |
| `harmonics` | `harmonics` | integer / 1 | `50` | % | 0 … 100 |
| `tone` | `tone` | number / 1 | `10` | kHz | 1 … 20 |
| `instability` | `instability` | number / 1 | `1` | % | 0 … 10 |
| `level` | `level` | number / 1 | `-40` | dB | -80 … 0 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Hum Generator

Adds a controllable 50/60 Hz electrical hum layer for a vintage, lo-fi listening mood. Use low levels when clean playback feels too sterile, or raise Level for an obvious sound-effect-like hum.

### Sound Character Guide
- Vintage Equipment Ambience:
  - Recreates the subtle hum of classic amplifiers and equipment
  - Adds the character of being "plugged in" to AC power
  - Creates a vintage playback atmosphere
- Power Supply Characteristics:
  - Simulates different types of power supply noise
  - Recreates regional power grid characteristics (50Hz vs 60Hz)
  - Adds subtle electrical infrastructure character
- Background Texture:
  - Creates organic, low-level background presence
  - Adds depth and "life" to very clean playback
  - Useful for a vintage or lo-fi listening mood

### Parameters
- **Frequency** - Sets the fundamental hum frequency (10-120 Hz)
  - 50 Hz: European/Asian power grid standard
  - 60 Hz: North American power grid standard<br>
  - Other values: Custom frequencies for creative effects
- **Type** - Controls the harmonic structure of the hum
  - Standard: Contains only odd harmonics (more pure, transformer-like)
  - Rich: Contains all harmonics (complex, equipment-like)
  - Dirty: Rich harmonics with subtle distortion (vintage gear character)
- **Harmonics** - Controls the brightness and harmonic content (0-100%)
  - 0-30%: Warm, mellow hum with minimal upper harmonics
  - 30-70%: Balanced harmonic content typical of real equipment
  - 70-100%: Bright, complex hum with strong upper harmonics
  - In Dirty mode, higher Harmonics also increases distortion and roughness
- **Tone** - Final tone shaping filter cutoff frequency (1.0-20.0 kHz)
  - 1-5 kHz: Warm, muffled character
  - 5-10 kHz: Natural equipment-like tone
  - 10-20 kHz: Bright, present character
- **Instability** - Amount of subtle frequency and amplitude variation (0-10%)
  - 0%: Perfectly stable hum (digital precision)
  - 1-3%: Slight natural drift
  - 3-10%: More noticeable but still gentle wobble
- **Level** - Output level of the hum signal (-80.0 to 0.0 dB)
  - -80 to -60 dB: Barely audible background presence
  - -60 to -40 dB: Subtle but noticeable hum
  - -40 to -20 dB: Prominent vintage character
  - -20 to 0 dB: Creative or special effect levels

### Recommended Settings for Different Styles

1. Subtle Vintage Amplifier
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 25%
   - Tone: 8.0 kHz, Instability: 1.5%, Level: -54 dB
   - Perfect for: Adding gentle vintage playback character

2. Classic Vintage Playback
   - Frequency: 60 Hz, Type: Rich, Harmonics: 45%
   - Tone: 6.0 kHz, Instability: 2.0%, Level: -48 dB
   - Perfect for: Background electrical ambience from older playback gear

3. Vintage Tube Equipment
   - Frequency: 50 Hz, Type: Dirty, Harmonics: 60%
   - Tone: 5.0 kHz, Instability: 3.5%, Level: -42 dB
   - Perfect for: Warm tube amplifier character

4. Power Grid Ambience
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 35%
   - Tone: 10.0 kHz, Instability: 1.0%, Level: -60 dB
   - Perfect for: Realistic power supply background

5. Stronger Hum Texture
   - Frequency: 40 Hz, Type: Dirty, Harmonics: 80%
   - Tone: 15.0 kHz, Instability: 6.0%, Level: -36 dB
   - Perfect for: A stronger, more audible hum texture

[Back to all effects](/dsp/effects/)
