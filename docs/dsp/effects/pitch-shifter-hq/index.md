---
layout: dsp
title: "Pitch Shifter HQ — EffeTune DSP"
description: "Changes pitch in semitones and cents while preserving playback duration."
lang: en
permalink: /dsp/effects/pitch-shifter-hq/
---
# Pitch Shifter HQ

Semantic type: `PitchShifterHQ` · Category: modulation

Changes pitch in semitones and cents while preserving playback duration.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `pitchShift` | `pitch_shift` | integer / 1 | `0` | semitones | -6 … 6 |
| `fineTune` | `fine_tune` | integer / 1 | `0` | cents | -50 … 50 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Pitch Shifter HQ

A higher-quality pitch shifter for careful listening when reduced phase smearing is worth extra CPU use and about 107-116ms of delay. It changes pitch without changing playback speed and keeps spectral components more firmly grouped than the standard Pitch Shifter. If this effect is unavailable on your device, the audio passes through unchanged.

Pitch Shifter HQ does not preserve formants. Larger shifts therefore change the apparent character of voices and instruments as well as their pitch.

### Listening Experience Guide

- For a subtle change, start with **Pitch Shift** at -1 or +1 and leave **Fine Tune** at 0.
- Use **Fine Tune** to match music that is slightly sharp or flat without moving by a full semitone.
- Choose Pitch Shifter HQ instead of the standard Pitch Shifter when fewer phase artifacts are worth the extra CPU use and delay. Use the standard version for latency-sensitive listening or lower-powered devices.
- Compare larger shifts carefully: the pitch remains stable, but the lack of formant preservation makes the tonal character change more obvious.

### Parameters

- **Pitch Shift** - Changes the overall pitch in semitones (-6 to +6)
  - Negative values lower the pitch; positive values raise it
  - Zero leaves the pitch unchanged
- **Fine Tune** - Adjusts pitch in cents (-50 to +50)
  - Use it for precise adjustment between semitones
  - 100 cents equals one semitone

[Back to all effects](/dsp/effects/)
