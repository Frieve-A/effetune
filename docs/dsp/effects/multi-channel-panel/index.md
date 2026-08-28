---
layout: dsp
title: "Multi Channel Panel — EffeTune DSP"
description: "Applies per-channel gain, mute, solo, and delay controls to multichannel audio."
lang: en
permalink: /dsp/effects/multi-channel-panel/
---
# Multi Channel Panel

Semantic type: `MultiChannelPanel` · Category: basics

Applies per-channel gain, mute, solo, and delay controls to multichannel audio.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `mute` | `mute` | boolean / 16 | `[false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]` | Not declared in catalog | Not declared in catalog |
| `solo` | `solo` | boolean / 16 | `[false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]` | Not declared in catalog | Not declared in catalog |
| `volume` | `volume` | number / 16 | `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]` | dB | -20 … 10 |
| `delay` | `delay` | number / 16 | `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]` | ms | 0 … 30 |
| `link` | `link` | boolean / 15 | `[false,false,false,false,false,false,false,false,false,false,false,false,false,false,false]` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## MultiChannel Panel

A comprehensive control panel for managing multiple audio channels individually. This plugin provides complete control over volume, muting, soloing, and delay for up to 16 channels, with a visual level meter for each channel.

Scroll within the panel to reach channels below the visible area.

### When to Use
- When working with multi-channel audio (up to 16 channels)
- To create custom volume balance between different channels
- When you need to apply individual delay to specific channels
- For monitoring levels across multiple channels simultaneously

### Features
- Individual controls for up to 16 audio channels
- Real-time level meters with peak hold for visual monitoring
- Channel linking capability for grouped parameter changes

### Parameters

#### Per Channel Controls
- **Mute (M)** - Silences individual channels
  - Toggle on/off for each channel
  - Works in conjunction with solo feature

- **Solo (S)** - Isolates individual channels
  - When any channel is soloed, only soloed channels play
  - Multiple channels can be soloed simultaneously

- **Volume** - Adjusts individual channel loudness (-20dB to +10dB)
  - Fine control with slider or direct value input
  - Linked channels maintain the same volume

- **Delay** - Adds time delay to individual channels (0-30ms)
  - Precise delay control in milliseconds
  - Useful for time-alignment between channels
  - Allows phase adjustment between channels

#### Channel Linking
- **Link** - Connects adjacent channels for synchronized control
  - Changes to one linked channel affect all connected channels
  - Maintains consistent settings across linked channel groups
  - Useful for stereo pairs or multi-channel groups

### Visual Monitoring
- Real-time level meters show current signal strength
- Peak hold indicators display maximum levels
- Clear numerical dB readout of peak levels
- Color-coded meters for easy level recognition:
  - Green: Safe levels
  - Yellow: Approaching maximum
  - Red: Near or at maximum level

### Practical Applications
- Balancing surround sound or multi-speaker playback
- Matching speaker timing when speakers are at different distances
- Temporarily muting or soloing individual speakers during setup
- Linking stereo pairs or speaker groups for easier adjustment

[Back to all effects](/dsp/effects/)
