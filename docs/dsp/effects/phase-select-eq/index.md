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

Phase Select EQ boosts or cuts stereo frequency components selected by frequency, absolute left/right phase difference, and left/right level balance. All three ranges must match. It applies the same positive gain to both channel spectra, so it does not rotate, correct, or create a phase difference. Use it when an ordinary frequency-only EQ cannot separate a centered sound from another sound at the same frequency that is wider or panned to one side.

Five independent Bands are always available. Each Band has an inner **Core**, where its Gain is applied fully, and an outer **Transition**, where the multiplier fades smoothly toward 100%. Overlapping Bands multiply their gains; for example, overlapping 150% and 50% Cores produce 75%. Several boosts can therefore raise the signal above 0 dBFS, so leave enough headroom and compare with bypass.

Phase Select EQ reports processing latency equal to its FFT size plus its hop size. At 48 kHz, this is 4,096 + 1,024 = 5,120 samples, or about 106.7 ms (about 116.1 ms at 44.1 kHz). Check the complete chain in the app's **Total Delay** display. This latency can affect real-time monitoring and audio/video synchronization.

### Reading the Selection Map

- The vertical axis is logarithmic frequency: low frequencies are at the bottom and high frequencies are at the top.
- Use **Phase** or **Balance** above the map to choose its horizontal axis. Editing a Phase or Balance control switches to the corresponding view automatically.
- In Phase view, 0° in the center means in phase, while -180° and +180° at the edges are the same opposite-phase point. Selection uses the **absolute** phase difference, so the frame is mirrored across 0° and processes +60° and -60° identically.
- In Balance view, 50:50 is centered, the left edge is left-only, and the right edge is right-only. Balance is `(right amplitude - left amplitude) / (left amplitude + right amplitude) × 100%`; negative values favor the left channel and positive values favor the right. The frame is a single rectangle, not a mirrored pair.
- Each dot represents a recently measured input component. Brighter or larger dots are stronger; older dots fade away.
- White dots show the measured components. Only enabled Band frames are drawn; the Band being edited is bright green and the other enabled Bands are light green. The number in the upper-left corner of each Core identifies its Band.
- The short badge beside every Core number shows that Band's complete hidden-axis selection. For example, `P 20°›40°–80°›100°` means Phase outer low › Core low–high › outer high. A Balance badge uses left:right ratios in the same order, such as `B 100:0›80:20–70:30›0:100`. `P full` or `B full` means that Band does not limit the hidden axis.
- The solid inner frame is the Core and the dashed outer frame is the Transition. In Phase view, a Band touching 0° joins at the center and a Band reaching 180° continues across both map edges.
- The badge beside the Graph choices shows the hidden axis's Core and, when needed, Transition range. Dots rejected by the selected Band on that hidden axis are dimmed, making the three-way AND selection visible without changing views.
- A component present in only one channel has Balance -100% or +100%. Phase view places left-only components at -180° and right-only components at +180°, so hard-panned sounds can be selected from either view.

The Balance grid uses familiar channel ratios. Approximate level differences are shown here for reference:

| Balance | 0% | ±17% | ±33% | ±60% | ±82% | ±100% |
|---|---:|---:|---:|---:|---:|---:|
| L/R level difference | 0 dB | ±3 dB | ±6 dB | ±12 dB | ±20 dB | one channel only |

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
4. **Reduce a hard-panned instrument**
   - Switch to Balance and select roughly -100% to -70% for a left-panned sound, or +70% to +100% for a right-panned sound. Narrow the frequency range around the instrument.
   - Set the Phase Core around 150-180° so it includes the one-sided points at -180° or +180°. If Balance alone should decide the selection, use the full 0-180° Phase Core instead.
   - Start with 70-90% Gain and a moderate Balance Transition.
   - Effect: Reduces the strongly one-sided component while leaving centered material at the same frequencies largely unchanged.
5. **Emphasize a centered source**
   - Select a Balance Core around -17% to +17% and a Phase Core around 0-30°, then narrow the frequency range around the source.
   - Start with 105-120% Gain.
   - Effect: Favors near-equal, near-in-phase components over sounds panned away from the center.

These phase ranges describe typical tendencies, not fixed sound-source locations. Watch where the dots actually appear in the recording, make small changes, and confirm the result on both headphones and speakers.

### Parameters

- **Band 1-5 / checkbox** (Off/On): Selects a Band for editing and enables or disables it without changing its settings.
- **Gain** (0% to 200%): Sets the level multiplier inside the Core. 100% leaves the level unchanged, 0% removes the selected component, and 200% doubles its amplitude.
- **Solo** (Off/On): Lets you hear only what the soloed Bands select. While any enabled Band has Solo on, Gain is ignored and everything outside the soloed Bands is muted, with the same smooth Transition fade at the edges. Soloing several Bands at once passes the combination of their regions. Turning every Solo off restores normal processing.
- **Core Low Frequency / Core High Frequency** (20 Hz to 40 kHz, limited by the current sample rate): Set the fully processed frequency range.
- **Core Low Phase / Core High Phase** (0° to 180°): Set the fully processed absolute L/R phase-difference range.
- **Outer Low Balance / Core Low Balance / Core High Balance / Outer High Balance** (-100% to +100%): Set the four Balance boundaries directly. The Core pair sets the fully processed left/right amplitude-balance range; the Outer pair sets where the Transition reaches no processing. Negative values select toward the left; positive values select toward the right.
- **Low Frequency Transition / High Frequency Transition**: Set how far below and above the frequency Core the gain fades between 0% and 100%.
- **Low Phase Transition / High Phase Transition**: Set how far toward 0° and 180° the gain fades between 0% and 100%.
The map handles edit the same values as the sliders and numeric inputs: drag anywhere inside the selected Band's outer frame to move the whole Band, drag Core edges or corners to resize it, and drag the outer edge handles to change one transition at a time. These gestures work with a mouse or touch. A low-phase handle stops at the center instead of crossing it: Core Low Phase stops at 0°, and Low Phase Transition stops at its maximum width. When Core Low Phase is exactly 0°, the center handle can initially move either left or right; after the pointer moves to one side, it stays locked to that side for the rest of the drag.

[Back to all effects](/dsp/effects/)
