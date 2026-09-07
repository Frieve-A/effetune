---
layout: dsp
title: "Clip Restorer — EffeTune DSP"
description: "Reconstructs clipped waveform peaks."
lang: en
permalink: /dsp/effects/clip-restorer/
---
# Clip Restorer

Semantic type: `ClipRestorer` · Category: restoration

Reconstructs clipped waveform peaks.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `threshold` | `threshold` | number / 1 | `-0.1` | dB | -18 … 0 |
| `outputGain` | `output_gain` | number / 1 | `-3` | dB | -12 … 0 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Clip Restorer

Clip Restorer reconstructs peaks that were flattened by hard digital clipping. It is useful for recordings with obvious flat-topped distortion; it cannot recover every detail that was lost before the recording reached EffeTune.

### Listening Guide

1. Start with **Threshold** at -0.10 dB and **Output Gain** at -3 dB.
2. If clearly clipped peaks remain, lower **Threshold** a little to include less extreme clipping. If loud, sustained sounds are changed unnecessarily, raise it toward 0 dB.
3. Keep **Output Gain** below 0 dB when possible. Restored peaks can be higher than the original flat peaks, so the default leaves useful headroom.
4. Use **RESTORED** while a damaged section plays, then compare with the effect bypassed to choose the least intrusive setting.

### Parameters

- **Threshold** (-18–0 dB, default -0.10 dB) sets the level treated as a clipped peak. A value closer to 0 dB targets only nearly full-scale flat peaks. Lowering it includes less obvious clipping, but can affect more loud material.
- **Output Gain** (-12–0 dB, default -3 dB) sets the output level after restoration. Raise it toward 0 dB for a louder result; lower it for more headroom if restored peaks are too high.

### Reading the Display

**RESTORED** shows the recent percentage of audio samples repaired as clipped peaks. A small value can be normal because clipping often occurs only at brief peaks. If it remains high on material that does not sound clipped, raise **Threshold**.

[Back to all effects](/dsp/effects/)
