---
layout: dsp
title: "Auto Leveler — EffeTune DSP"
description: "Adjusts gain gradually toward a configured target level."
lang: en
permalink: /dsp/effects/auto-leveler/
---
# Auto Leveler

Semantic type: `AutoLeveler` · Category: dynamics

Adjusts gain gradually toward a configured target level.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `targetLufs` | `target_lufs` | number / 1 | `-18` | LUFS | -36 … 0 |
| `timeWindow` | `time_window` | number / 1 | `3000` | ms | 1000 … 10000 |
| `maxGain` | `max_gain` | number / 1 | `0` | dB | 0 … 12 |
| `minGain` | `min_gain` | number / 1 | `-12` | dB | -36 … 0 |
| `attack` | `attack` | number / 1 | `50` | ms | 1 … 1000 |
| `release` | `release` | number / 1 | `5000` | ms | 10 … 10000 |
| `noiseGate` | `noise_gate` | number / 1 | `-60` | dB | -96 … -24 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Auto Leveler

A smart volume control that automatically adjusts your music to maintain a consistent listening level. It uses a LUFS-style level estimate to keep playback closer to your chosen target, whether you're listening to quiet classical pieces or dynamic pop songs.

### Listening Enhancement Guide
- Classical Music:
  - Enjoy both quiet passages and loud crescendos without touching the volume
  - Hear all the subtle details in piano pieces
  - Perfect for albums with varying recording levels
- Pop/Rock Music:
  - Keep a consistent volume across different songs
  - No more surprises from overly loud or quiet tracks
  - Comfortable listening during long sessions
- Background Music:
  - Maintain steady volume while working or studying
  - Never too loud or too quiet
  - Perfect for playlists with mixed content

### Parameters

- **Target** (-36.0dB to 0.0dB LUFS)
  - Sets your desired listening level
  - Default -18.0dB LUFS is comfortable for most music
  - Lower values for quieter background listening
  - Higher values for more impactful sound

- **Time Window** (1000ms to 10000ms)
  - How quickly the level is measured
  - Shorter times: More responsive to changes
  - Longer times: More stable, natural sound
  - Default 3000ms works well for most music

- **Max Gain** (0.0dB to 12.0dB)
  - Limits how much quiet sounds are boosted
  - Higher values: More consistent volume
  - Lower values: More natural dynamics
  - Start with 6.0dB for gentle control

- **Min Gain** (-36.0dB to 0.0dB)
  - Limits how much loud sounds are reduced
  - Higher values: More natural sound
  - Lower values: More consistent volume
  - Try -12.0dB as a starting point

- **Attack Time** (1ms to 1000ms)
  - How quickly volume is reduced
  - Faster times: Better control of sudden loud sounds
  - Slower times: More natural transitions
  - Default 50ms balances control and naturalness

- **Release Time** (10ms to 10000ms)
  - How quickly volume returns to normal
  - Faster times: More responsive
  - Slower times: Smoother transitions
  - Default 5000ms for smooth, natural level changes

- **Noise Gate** (-96dB to -24dB)
  - Prevents very quiet passages or background noise from being boosted
  - Higher values: Less boosting of quiet background noise
  - Lower values: Allows the leveler to react to quieter passages
  - Start at -60dB and adjust if needed

### Visual Feedback
- Real-time LUFS level display
- Input level (green line)
- Output level (white line)
- Clear visual feedback of volume adjustments
- Easy-to-read time-based graph

### Recommended Settings

#### General Listening
- Target: -18.0dB LUFS
- Time Window: 3000ms
- Max Gain: 6.0dB
- Min Gain: -12.0dB
- Attack Time: 50ms
- Release Time: 1000ms
- Noise Gate: -60dB

#### Background Music
- Target: -23.0dB LUFS
- Time Window: 5000ms
- Max Gain: 9.0dB
- Min Gain: -18.0dB
- Attack Time: 100ms
- Release Time: 2000ms
- Noise Gate: -54dB

#### Dynamic Music
- Target: -16.0dB LUFS
- Time Window: 2000ms
- Max Gain: 3.0dB
- Min Gain: -6.0dB
- Attack Time: 30ms
- Release Time: 500ms
- Noise Gate: -72dB

[Back to all effects](/dsp/effects/)
