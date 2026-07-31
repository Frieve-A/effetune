---
layout: dsp
title: "Pitch Shifter — EffeTune DSP"
description: "Shifts pitch while retaining the input duration."
lang: en
permalink: /dsp/effects/pitch-shifter/
---
# Pitch Shifter

Semantic type: `PitchShifter` · Category: modulation

Shifts pitch while retaining the input duration.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `pitchShift` | `pitch_shift` | integer / 1 | `0` | semitones | -6 … 6 |
| `fineTune` | `fine_tune` | integer / 1 | `0` | cents | -50 … 50 |
| `windowSize` | `window_size` | integer / 1 | `150` | ms | 80 … 500 |
| `crossfadeTime` | `crossfade_time` | number / 1 | `35` | ms | 20 … 40 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Pitch Shifter

An effect that changes the pitch of your music without affecting its playback speed. This allows you to experience your favorite songs in different keys, making them sound higher or lower while maintaining the original tempo and rhythm.

### Parameters
- **Pitch Shift** - Changes the overall pitch in semitones (-6 to +6)
  - Negative values: Lowers the pitch (deeper, lower sound)
  - Zero: No change (original pitch)
  - Positive values: Raises the pitch (higher, brighter sound)
- **Fine Tune** - Makes subtle pitch adjustments in cents (-50 to +50)
  - Allows for precise tuning between semitones
  - Perfect for minor adjustments when a full semitone is too much
- **Window Size** - Controls the analysis window size in milliseconds (80 to 500ms)
  - Smaller values (80-150ms): Better for transient-rich material like percussion
  - Medium values (150-300ms): Good balance for most music
  - Larger values (300-500ms): Better for smooth, sustained sounds
- **XFade Time** - Sets the crossfade time between processed segments in milliseconds (20 to 40ms)
  - Affects how smoothly the pitch-shifted segments blend together
  - Lower values may sound more immediate but potentially less smooth
  - Higher values create smoother transitions between segments, but may increase sound wavering and create an overlapping sensation

[Back to all effects](/dsp/effects/)
