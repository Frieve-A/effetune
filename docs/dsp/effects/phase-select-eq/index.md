---
layout: dsp
title: "Phase Select EQ — EffeTune DSP"
description: "Applies gain only where the stereo phase difference falls within configured frequency-and-phase regions."
lang: en
permalink: /dsp/effects/phase-select-eq/
---
# Phase Select EQ

Semantic type: `PhaseSelectEQ` · Category: spatial

Applies gain only where the stereo phase difference falls within configured frequency-and-phase regions.

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



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Phase Select EQ

Phase Select EQ boosts or cuts stereo frequency components according to the absolute phase difference between the left and right channels. It applies the same positive gain to both channel spectra, so it does not rotate, correct, or create a phase difference. Use it when a sound occupies a particular frequency and stereo-phase region that an ordinary frequency-only EQ cannot isolate.

Five independent Bands are always available. Each Band has an inner **Core**, where its Gain is applied fully, and an outer **Transition**, where the multiplier fades smoothly toward 100%. Overlapping Bands multiply their gains; for example, overlapping 150% and 50% Cores produce 75%. Several boosts can therefore raise the signal above 0 dBFS, so leave enough headroom and compare with bypass.

Phase Select EQ reports processing latency equal to its FFT size plus its hop size. At 48 kHz, this is 4,096 + 1,024 = 5,120 samples, or about 106.7 ms (about 116.1 ms at 44.1 kHz). Check the complete chain in the app's **Total Delay** display. This latency can affect real-time monitoring and audio/video synchronization.

### Reading the Phase Map

- The vertical axis is logarithmic frequency: low frequencies are at the bottom and high frequencies are at the top.
- The horizontal axis shows signed L/R phase difference for display: 0° in the center means in phase, while -180° and +180° at the edges are the same opposite-phase point.
- Each dot represents a recently measured input component. Brighter or larger dots are stronger; older dots fade away.
- White dots show the measured components. Only enabled Band frames are drawn; the Band being edited is bright green and the other enabled Bands are light green. The number in the upper-left corner of each Core identifies its Band.
- Selection uses the **absolute** phase difference. A single logical region is therefore mirrored across 0° and processes +60° and -60° identically. Swapping L/R mirrors the dots but does not change which components are processed.
- The solid inner frame is the Core and the dashed outer frame is the Transition. A Band touching 0° joins at the center; a Band reaching 180° continues across both map edges.

### Listening Enhancement Guide

1. **Reduce wide high-frequency glare**
   - Set a Band around 4-12 kHz and 90-180°.
   - Start with 70-90% Gain and broad transitions.
   - Effect: Softens strongly out-of-phase upper-frequency content while leaving more centered detail largely unchanged.
2. **Add presence to centered vocals**
   - Set a Band around 1-4 kHz and 0-30°.
   - Start with 110-125% Gain.
   - Effect: Emphasizes near-in-phase midrange components without applying the same boost to widely spread ambience.
3. **Control diffuse low-mid ambience**
   - Set a Band around 150-600 Hz and 60-150°.
   - Start with 80-90% Gain and widen the frequency transitions until the change is smooth.
   - Effect: Reduces broad stereo low-mid energy while retaining near-center fundamentals.

These phase ranges describe typical tendencies, not fixed sound-source locations. Watch where the dots actually appear in the recording, make small changes, and confirm the result on both headphones and speakers.

### Parameters

- **Band 1-5 / checkbox** (Off/On): Selects a Band for editing and enables or disables it without changing its settings.
- **Gain** (0% to 200%): Sets the level multiplier inside the Core. 100% leaves the level unchanged, 0% removes the selected component, and 200% doubles its amplitude.
- **Core Low Frequency / Core High Frequency** (20 Hz to 40 kHz, limited by the current sample rate): Set the fully processed frequency range.
- **Core Low Phase / Core High Phase** (0° to 180°): Set the fully processed absolute L/R phase-difference range.
- **Low Frequency Transition / High Frequency Transition**: Set how far below and above the frequency Core the gain fades between 0% and 100%.
- **Low Phase Transition / High Phase Transition**: Set how far toward 0° and 180° the gain fades between 0% and 100%.
The map handles edit the same values as the sliders and numeric inputs: drag anywhere inside the selected Band's outer frame to move the whole Band, drag Core edges or corners to resize it, and drag the outer edge handles to change one transition at a time. A low-phase handle stops at the center instead of crossing it: Core Low Phase stops at 0°, and Low Phase Transition stops at its maximum width. When Core Low Phase is exactly 0°, the center handle can initially move either left or right; after the pointer moves to one side, it stays locked to that side for the rest of the drag.

[Back to all effects](/dsp/effects/)
