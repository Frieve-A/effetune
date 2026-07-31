---
layout: dsp
title: "Transient Shaper — EffeTune DSP"
description: "Adjusts attack and sustain without using a fixed threshold."
lang: en
permalink: /dsp/effects/transient-shaper/
---
# Transient Shaper

Semantic type: `TransientShaper` · Category: dynamics

Adjusts attack and sustain without using a fixed threshold.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `fastAttack` | `fast_attack` | number / 1 | `1` | ms | 0.1 … 10 |
| `fastRelease` | `fast_release` | number / 1 | `20` | ms | 1 … 200 |
| `slowAttack` | `slow_attack` | number / 1 | `20` | ms | 1 … 100 |
| `slowRelease` | `slow_release` | number / 1 | `300` | ms | 50 … 1000 |
| `transientGain` | `transient_gain` | number / 1 | `6` | dB | -24 … 24 |
| `sustainGain` | `sustain_gain` | number / 1 | `0` | dB | -24 … 24 |
| `gainSmoothing` | `gain_smoothing` | number / 1 | `5` | ms | 0.1 … 20 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Transient Shaper

A specialized dynamics processor that lets you enhance or reduce the attack and sustain portions of your audio independently. Use it to change the punch and body of music, but note that positive Transient Gain or Sustain Gain can raise peaks and perceived loudness.

### Listening Enhancement Guide
- Percussion:
  - Add punch and definition to drums by enhancing transients
  - Reduce room resonance by taming the sustain portion
  - Create a stronger sense of impact by emphasizing drum attacks; use a limiter after it if peaks become too high
- Acoustic Guitar:
  - Enhance pick attacks for more clarity and presence
  - Control sustain to make the instrument feel tighter or fuller
  - Shape strumming patterns for a clearer or more relaxed listening feel
- Electronic Music:
  - Accentuate synth attacks for more percussive feel
  - Control the sustain of bass sounds for a tighter impression
  - Add punch to electronic drums while watching peak level

### Parameters

- **Fast Attack** (0.1ms to 10.0ms)
  - Controls how quickly the fast envelope follower responds
  - Lower values: More responsive to sharp transients
  - Higher values: Smoother transient detection
  - Start with 1.0ms for most material

- **Fast Release** (1ms to 200ms)
  - How quickly the fast envelope follower resets
  - Lower values: More precise transient tracking
  - Higher values: More natural transient shaping
  - 20ms works well as a starting point

- **Slow Attack** (1ms to 100ms)
  - Controls how quickly the slow envelope follower responds
  - Lower values: Slow envelope follows attacks sooner, producing gentler or shorter transient emphasis
  - Higher values: Greater separation between attack and sustain, making transient shaping stronger and longer
  - 20ms is a good default setting

- **Slow Release** (50ms to 1000ms)
  - How quickly the slow envelope returns to rest
  - Lower values: Shorter sustain portion
  - Higher values: Longer sustain tail detection
  - Try 300ms as a starting point

- **Transient Gain** (-24dB to +24dB)
  - Boosts or cuts the attack portion of sounds
  - Positive values: More punch and definition
  - Negative values: Softer, less aggressive sound
  - Positive values can raise peak level
  - Start with +6dB to enhance transients

- **Sustain Gain** (-24dB to +24dB)
  - Boosts or cuts the sustain portion of sounds
  - Positive values: More body and resonance
  - Negative values: Tighter, more controlled sound
  - Positive values can raise perceived loudness
  - Start with 0dB and adjust to taste

- **Smoothing** (0.1ms to 20.0ms)
  - Controls how smoothly gain changes are applied
  - Lower values: More precise, possibly more aggressive shaping
  - Higher values: More natural, transparent processing
  - 5.0ms provides a good balance for most material

### Visual Display
- Real-time gain visualization
- Clear gain history display
- Time markers for reference
- Intuitive interface for all parameters

### Recommended Settings

#### Enhanced Percussion
- Fast Attack: 0.5ms
- Fast Release: 10ms
- Slow Attack: 15ms
- Slow Release: 200ms
- Transient Gain: +9dB
- Sustain Gain: -3dB
- Smoothing: 3.0ms

#### Natural Acoustic Instruments
- Fast Attack: 2.0ms
- Fast Release: 30ms
- Slow Attack: 25ms
- Slow Release: 400ms
- Transient Gain: +3dB
- Sustain Gain: 0dB
- Smoothing: 8.0ms

#### Tighter Electronic Sounds
- Fast Attack: 1.0ms
- Fast Release: 15ms
- Slow Attack: 10ms
- Slow Release: 250ms
- Transient Gain: +6dB
- Sustain Gain: -6dB
- Smoothing: 4.0ms

[Back to all effects](/dsp/effects/)
