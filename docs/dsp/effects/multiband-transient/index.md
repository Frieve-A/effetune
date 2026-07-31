---
layout: dsp
title: "Multiband Transient — EffeTune DSP"
description: "Shapes transient and sustain energy independently across frequency bands."
lang: en
permalink: /dsp/effects/multiband-transient/
---
# Multiband Transient

Semantic type: `MultibandTransient` · Category: dynamics

Shapes transient and sustain energy independently across frequency bands.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `frequency1` | `frequency1` | number / 1 | `200` | Hz | 20 … 2000 |
| `frequency2` | `frequency2` | number / 1 | `4000` | Hz | 200 … 20000 |
| `fastAttack` | `fast_attack` | number / 3 | `[5,2,0.5]` | ms | 0.1 … 10 |
| `fastRelease` | `fast_release` | number / 3 | `[50,30,20]` | ms | 1 … 200 |
| `slowAttack` | `slow_attack` | number / 3 | `[25,10,5]` | ms | 1 … 100 |
| `slowRelease` | `slow_release` | number / 3 | `[250,150,100]` | ms | 50 … 1000 |
| `transientGain` | `transient_gain` | number / 3 | `[6,6,6]` | dB | -24 … 24 |
| `sustainGain` | `sustain_gain` | number / 3 | `[0,0,0]` | dB | -24 … 24 |
| `gainSmoothing` | `gain_smoothing` | number / 3 | `[5,5,5]` | ms | 0.1 … 20 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Multiband Transient

A three-band transient shaper for finished music. It divides the sound into Low, Mid, and High ranges, then lets you adjust attack and sustain in each range so the music can feel punchier, tighter, softer, or more relaxed without changing every frequency the same way.

### Listening Enhancement Guide
- Classical Music:
  - Make string attacks a little clearer while controlling low-frequency hall resonance
  - Shape piano transients differently across the frequency spectrum for more balanced sound
  - Soften sharp treble attacks while keeping orchestral weight intact
- Rock/Pop Music:
  - Make drum hits in finished tracks feel more immediate without raising the whole track
  - Tighten boomy low-frequency sustain while keeping midrange presence clear
  - Soften sharp attacks in the treble range when a recording sounds edgy
- Electronic Music:
  - Make bass hits feel firmer while keeping the rest of the track controlled
  - Reduce long low-frequency sustain when bass feels smeared
  - Add or reduce bite in bright synth and percussion ranges

### Frequency Bands

The Multiband Transient processor splits your audio into three carefully designed frequency bands. Because this works by frequency band, not source separation, each adjustment affects all sounds in that band.

- **Low Band** (Below Freq 1)
  - Controls bass and sub-bass frequencies
  - Useful for shaping bass impact, low-frequency thumps, and resonance
  - Default crossover: 200 Hz

- **Mid Band** (Between Freq 1 and Freq 2)<br>
  - Handles the critical midrange frequencies
  - Contains most vocal and instrumental presence
  - Default crossover: 200 Hz to 4000 Hz

- **High Band** (Above Freq 2)
  - Manages treble and air frequencies
  - Controls cymbals, guitar picks, and brightness
  - Default crossover: Above 4000 Hz

### Parameters

#### Crossover Frequencies
- **Freq 1** (20Hz to 2000Hz)
  - Sets the Low/Mid crossover point
  - Lower values: More content in mid and high bands
  - Higher values: More content in low band
  - Default: 200Hz

- **Freq 2** (max(Freq 1, 200Hz) to 20000Hz)
  - Sets the Mid/High crossover point
  - Lower values: More content in high band
  - Higher values: More content in mid band
  - If set below Freq 1, it is automatically raised to Freq 1
  - Default: 4000Hz

#### Per-Band Controls (Low, Mid, High)
Each frequency band has independent transient shaping controls:

- **Fast Attack** (0.1ms to 10.0ms)
  - How quickly the fast envelope responds to transients
  - Lower values: More precise transient detection
  - Higher values: Smoother transient response
  - Typical range: 0.5ms to 5.0ms

- **Fast Release** (1ms to 200ms)
  - How quickly the fast envelope resets
  - Lower values: Tighter transient control
  - Higher values: More natural transient decay
  - Typical range: 20ms to 50ms

- **Slow Attack** (1ms to 100ms)
  - Controls the slow envelope's response time
  - Lower values: Slow envelope follows attacks sooner, producing gentler or shorter transient emphasis
  - Higher values: Greater separation between attack and sustain, making transient shaping stronger and longer
  - Typical range: 10ms to 50ms

- **Slow Release** (50ms to 1000ms)
  - How long the sustain portion is tracked
  - Lower values: Shorter sustain detection
  - Higher values: Longer sustain tail tracking
  - Typical range: 150ms to 500ms

- **Transient Gain** (-24dB to +24dB)
  - Enhances or reduces the attack portion
  - Positive values: More punch and definition
  - Negative values: Softer, less aggressive attacks
  - Typical range: 0dB to +12dB

- **Sustain Gain** (-24dB to +24dB)
  - Enhances or reduces the sustain portion
  - Positive values: More body and resonance
  - Negative values: Tighter, more controlled sound
  - Typical range: -6dB to +6dB

- **Smoothing** (0.1ms to 20.0ms)
  - Controls how smoothly gain changes are applied
  - Lower values: More precise shaping
  - Higher values: More natural, transparent processing
  - Typical range: 3ms to 8ms

### Visual Feedback
- Three independent gain visualization graphs (one per band)
- Real-time gain history display for each frequency band
- Time markers for reference
- Interactive band selection
- Clear visual feedback of transient shaping activity

### Recommended Settings

#### Punchier Pop/Rock Listening
- **Low Band (Bass Punch):**
  - Fast Attack: 2.0ms, Fast Release: 50ms
  - Slow Attack: 25ms, Slow Release: 250ms
  - Transient Gain: +6dB, Sustain Gain: -3dB
  - Smoothing: 5.0ms

- **Mid Band (Attack and Presence):**
  - Fast Attack: 1.0ms, Fast Release: 30ms
  - Slow Attack: 15ms, Slow Release: 150ms
  - Transient Gain: +9dB, Sustain Gain: 0dB
  - Smoothing: 3.0ms

- **High Band (Treble Snap):**
  - Fast Attack: 0.5ms, Fast Release: 20ms
  - Slow Attack: 10ms, Slow Release: 100ms
  - Transient Gain: +3dB, Sustain Gain: -6dB
  - Smoothing: 2.0ms

#### Balanced Full Track
- **All Bands:**
  - Fast Attack: 2.0ms, Fast Release: 30ms
  - Slow Attack: 20ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: 0dB
  - Smoothing: 5.0ms

#### Natural Acoustic Enhancement
- **Low Band:**
  - Fast Attack: 5.0ms, Fast Release: 50ms
  - Slow Attack: 30ms, Slow Release: 400ms
  - Transient Gain: +2dB, Sustain Gain: +1dB
  - Smoothing: 8.0ms

- **Mid Band:**
  - Fast Attack: 3.0ms, Fast Release: 35ms
  - Slow Attack: 25ms, Slow Release: 300ms
  - Transient Gain: +4dB, Sustain Gain: +1dB
  - Smoothing: 6.0ms

- **High Band:**
  - Fast Attack: 1.5ms, Fast Release: 25ms
  - Slow Attack: 15ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: -2dB
  - Smoothing: 4.0ms

### Application Tips
- Start with moderate settings and adjust each band independently
- Use the visual feedback to monitor the amount of transient shaping applied
- Consider the musical content when setting crossover frequencies
- Higher frequency bands typically benefit from faster attack times
- Lower frequency bands often need longer release times for natural sound
- Combine with other dynamics processors for comprehensive control

[Back to all effects](/dsp/effects/)
