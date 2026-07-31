---
layout: dsp
title: "Expander — EffeTune DSP"
description: "Increases dynamic contrast below a configurable threshold."
lang: en
permalink: /dsp/effects/expander/
---
# Expander

Semantic type: `Expander` · Category: dynamics

Increases dynamic contrast below a configurable threshold.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `threshold` | `threshold` | number / 1 | `-24` | dB | -60 … 0 |
| `ratio` | `ratio` | number / 1 | `2` | Not declared in catalog | 0.05 … 20 |
| `attack` | `attack` | number / 1 | `10` | ms | 0.1 … 100 |
| `release` | `release` | number / 1 | `100` | ms | 10 … 1000 |
| `knee` | `knee` | number / 1 | `3` | dB | 0 … 12 |
| `gain` | `gain` | number / 1 | `0` | dB | -12 … 12 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Expander

A dynamic range processor that expands the dynamic range of signals below a threshold, making quiet sounds even quieter while leaving loud sounds unchanged. This creates more dramatic dynamics and can help restore natural dynamics to over-compressed material.

### Listening Enhancement Guide
- Classical Music:
  - Restores natural dynamics to over-compressed recordings
  - Enhances the contrast between quiet passages and loud crescendos
  - Brings back the natural ebb and flow of orchestral performances
- Pop/Rock Music:
  - Adds more punch and impact to dynamic sections
  - Creates more dramatic contrast between verses and choruses
  - Restores natural dynamics to heavily compressed tracks
- Jazz Music:
  - Enhances the natural dynamics between instruments
  - Makes quiet solos more intimate and loud sections more powerful
  - Restores the natural breathing of jazz performances

### Parameters

- **Threshold** - Sets the volume level where expansion begins (-60dB to 0dB)
  - Higher settings: Only affects quieter parts of the music
  - Lower settings: Creates more overall dynamic expansion
  - Start at -24dB for gentle expansion
- **Ratio** - Controls how strongly the effect expands the dynamic range (1:0.05 to 1:20)
  - 1:0.5: Upward compression (boosts quiet sounds)
  - 1:1: No effect (original sound)
  - 1:2: Gentle expansion
  - 1:4: Moderate expansion
  - 1:8+: Strong dynamic expansion
- **Attack Time** - How quickly the effect responds to quiet sounds (0.1ms to 100ms)
  - Faster times: More immediate dynamic control
  - Slower times: More natural sound
  - Try 10ms as a starting point
- **Release Time** - How quickly the dynamics return to normal (10ms to 1000ms)
  - Faster times: More dynamic sound
  - Slower times: Smoother, more natural transitions
  - Start with 100ms for general listening
- **Knee** - How smoothly the effect transitions (0dB to 12dB)
  - Lower values: More precise control
  - Higher values: Gentler, more natural sound
  - 3dB is a good starting point
- **Gain** - Adjusts the overall volume after processing (-12dB to +12dB)
  - Use this to match the volume with the original sound
  - Increase if the music feels too quiet
  - Decrease if it's too loud

### Visual Display

- Interactive graph showing how the expansion is working
- Easy-to-read volume level indicators
- Visual feedback for all parameter adjustments
- Reference lines to help guide your settings

### Recommended Settings for Different Listening Scenarios
- Natural Dynamics Restoration:
  - Threshold: -18dB
  - Ratio: 1:2
  - Attack: 10ms
  - Release: 100ms
  - Knee: 3dB
- Dramatic Dynamic Enhancement:
  - Threshold: -12dB
  - Ratio: 1:4
  - Attack: 5ms
  - Release: 50ms
  - Knee: 1dB
- Quiet Sound Enhancement:
  - Threshold: -30dB
  - Ratio: 1:0.5
  - Attack: 20ms
  - Release: 200ms
  - Knee: 6dB
- Subtle Dynamic Enhancement:
  - Threshold: -24dB
  - Ratio: 1:1.5
  - Attack: 15ms
  - Release: 150ms
  - Knee: 6dB

[Back to all effects](/dsp/effects/)
