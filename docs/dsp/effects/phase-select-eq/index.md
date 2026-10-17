---
layout: dsp
title: "Phase Select EQ — EffeTune DSP"
description: "Applies gain only where frequency, absolute stereo phase difference, and left/right Balance fall within configured regions."
lang: en
permalink: /dsp/effects/phase-select-eq/
---
# Phase Select EQ

Semantic type: `PhaseSelectEQ` · Category: spatial

Applies gain only where frequency, absolute stereo phase difference, and left/right Balance fall within configured regions.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `regionEnabled` | `region_enabled` | boolean / 5 | `[true,false,false,false,false]` | Not declared in catalog | Not declared in catalog |
| `outerFrequencyLow` | `outer_frequency_low` | number / 5 | `[80,80,80,80,80]` | Hz | 20 … 40000 |
| `coreFrequencyLow` | `core_frequency_low` | number / 5 | `[100,100,100,100,100]` | Hz | 20 … 40000 |
| `coreFrequencyHigh` | `core_frequency_high` | number / 5 | `[10000,10000,10000,10000,10000]` | Hz | 20 … 40000 |
| `outerFrequencyHigh` | `outer_frequency_high` | number / 5 | `[12000,12000,12000,12000,12000]` | Hz | 20 … 40000 |
| `outerPhaseLow` | `outer_phase_low` | number / 5 | `[0,0,0,0,0]` | degree | 0 … 180 |
| `corePhaseLow` | `core_phase_low` | number / 5 | `[0,0,0,0,0]` | degree | 0 … 180 |
| `corePhaseHigh` | `core_phase_high` | number / 5 | `[30,30,30,30,30]` | degree | 0 … 180 |
| `outerPhaseHigh` | `outer_phase_high` | number / 5 | `[45,45,45,45,45]` | degree | 0 … 180 |
| `gain` | `gain` | number / 5 | `[100,100,100,100,100]` | % | 0 … 200 |
| `regionSolo` | `region_solo` | boolean / 5 | `[false,false,false,false,false]` | Not declared in catalog | Not declared in catalog |
| `outerBalanceLow` | `outer_balance_low` | number / 5 | `[-100,-100,-100,-100,-100]` | % | -100 … 100 |
| `coreBalanceLow` | `core_balance_low` | number / 5 | `[-100,-100,-100,-100,-100]` | % | -100 … 100 |
| `coreBalanceHigh` | `core_balance_high` | number / 5 | `[100,100,100,100,100]` | % | -100 … 100 |
| `outerBalanceHigh` | `outer_balance_high` | number / 5 | `[100,100,100,100,100]` | % | -100 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Phase Select EQ

Phase Select EQ boosts or cuts stereo frequency components selected simultaneously by **frequency**, **absolute left/right phase difference**, and **left/right level balance**. It applies the same positive gain multiplier to both channels, so it shapes the level of targeted spatial components without rotating or altering phase. Use it when a standard frequency-only EQ cannot separate a centered vocal or instrument from wider or hard-panned sounds sharing the same frequency band.

Five independent Bands are available, each with an inner **Core** (full Gain) and an outer **Transition** (smooth fade toward 100%). Overlapping Bands multiply their gains, so several boosts can raise the signal above 0 dBFS; leave enough headroom and compare with bypass. Phase Select EQ adds FFT analysis latency (5,120 samples or ~106.7 ms at 48 kHz; ~116.1 ms at 44.1 kHz), which is reported in **Total Delay** and can affect real-time monitoring and audio/video synchronization.

### Listening Enhancement Guide

1. **Reduce wide high-frequency glare**: Set a Band around 4–12 kHz and 90–180° Phase with 70–90% Gain and broad transitions to soften out-of-phase upper-treble harshness while leaving centered detail intact.
2. **Add presence to centered vocals**: Set a Band around 1–4 kHz and 0–30° Phase (or −17% to +17% Balance) with 110–125% Gain to bring near-center midrange forward without boosting wide ambience.
3. **Control diffuse low-mid ambience**: Set a Band around 150–600 Hz and 60–150° Phase with 80–90% Gain to clean up wide low-mid mud while keeping centered bass and snare body.
4. **Tame a hard-panned instrument**: In **Balance** view, select −100% to −70% (left) or +70% to +100% (right) with Phase Core at 150–180° so it includes the one-sided points at -180° and +180° (or 0–180° if Balance alone should decide), narrow the frequency range around the instrument, and reduce Gain to 70–90%.

These phase ranges are typical tendencies, not fixed source positions. Watch where the dots actually appear, make small changes, and confirm the result on both headphones and speakers.

### Parameters

- **Band 1–5 / checkbox** (Off/On) - Selects a Band for editing and toggles it on or off.
- **Gain** (0% to 200%) - Level multiplier inside the Core (100% = unchanged, 0% = mute, 200% = +6 dB).
- **Solo** (Off/On) - Auditions only the components selected by the soloed Band(s); while Solo is on, Gain is ignored and everything outside the soloed Bands is muted.
- **Core Low Freq / Core High Freq** (20 Hz to 40 kHz, limited by the sample rate) - Fully processed frequency range.
- **Low Freq Trans / High Freq Trans** - Frequency fade widths below and above the Core.
- **Core Low Phase / Core High Phase** (0° to 180°) - Fully processed absolute L/R phase-difference range.
- **Low Phase Trans / High Phase Trans** - Phase fade widths toward 0° and 180°.
- **Outer Low Bal / Core Low Bal / Core High Bal / Outer High Bal** (-100% to +100%) - Left/right amplitude-balance Core and outer Transition boundaries.
- **Map Handles**: Drag inside a Band's frame to move it, drag Core edges/corners to resize the Core, or drag outer dashed handles to adjust transitions.

### Reading the Selection Map

- **Vertical axis**: Logarithmic frequency (low at bottom, high at top).
- **Horizontal axis**: Switch between **Phase** and **Balance** above the map; editing a Phase or Balance control switches the view automatically.
  - **Phase**: 0° in-phase at center; -180° and +180° at the edges are the same opposite-phase point. Selection uses the absolute phase difference, so the frame is mirrored across 0°, joins at the center when it touches 0°, and continues across both edges when it reaches 180°.
  - **Balance**: 50:50 at center, left-only at the left edge, right-only at the right edge. Balance is `(right amplitude - left amplitude) / (left amplitude + right amplitude) × 100%`.
- **One-sided sounds**: A component present in only one channel has Balance -100% or +100% and appears at -180° (left) or +180° (right) in Phase view, so hard-panned sounds can be selected from either view.
- **Dots & Frames**: White dots show recent input components (brighter/larger = stronger; dots rejected by the hidden axis are dimmed). Solid inner rectangles show each enabled Band's **Core** and dashed outer rectangles its **Transition**; the Band being edited is highlighted, and the number at the corner of each Core identifies the Band.
- **Badges**: The badge beside each Band number shows its hidden-axis range as outer low › Core low–high › outer high, e.g. `P 20°›40°–80°›100°` or `B 100:0›80:20–70:30›0:100` (left:right ratios). `P full` or `B full` means that axis is not limited.
- **Readout**: Hover over the map, or touch and drag on it, to read the frequency and the phase difference or balance at that point.

The Balance grid uses familiar channel ratios; approximate L/R level differences are shown for reference:

| Balance | 0% | ±17% | ±33% | ±60% | ±82% | ±100% |
|---|---:|---:|---:|---:|---:|---:|
| L/R level difference | 0 dB | ±3 dB | ±6 dB | ±12 dB | ±20 dB | one channel only |

[Back to all effects](/dsp/effects/)
