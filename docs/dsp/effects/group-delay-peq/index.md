---
layout: dsp
title: "Group Delay PEQ — EffeTune DSP"
description: "Applies an externally prepared FIR response for five-band parametric group-delay adjustment."
lang: en
permalink: /dsp/effects/group-delay-peq/
---
# Group Delay PEQ

Semantic type: `GroupDelayPEQ` · Category: eq

Applies an externally prepared FIR response for five-band parametric group-delay adjustment.

See [Assets and bundles](/dsp/concepts/assets-and-bundles/#asset-required-effects) before using this effect.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **impulseResponse (impulseResponse)**
- Catalog-declared latency: **dynamic**; depends on latencyMode, filterDelaySamples, impulseResponse

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `latencyMode` | `latency_mode` | string / 1 | `"128"` | Not declared in catalog | `0`, `128`, `256`, `512`, `1024` |
| `filterDelaySamples` | `filter_delay_samples` | integer / 1 | `8192` | Not declared in catalog | 0 … 65536 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Group Delay PEQ

Group Delay PEQ is the parametric version of Group Delay EQ. Instead of fifteen fixed sliders it gives you five freely placed bands, each with its own shape, frequency, delay amount, and Q. The enabled bands are added together into one target delay curve, and the plugin builds a single FIR filter designed to realize that curve with a flat magnitude response. A flat response is the design target, not a guarantee: finite Taps approximate that ideal target, and large or very narrow delay shapes can create measurable magnitude ripple. Use it when the timing error you want to correct has a known shape - a crossover, a ported enclosure, a steep high-pass, or a resonance - because one or two bands can then reproduce that shape directly. The plugin requires the WASM DSP engine; without it, the signal passes through unchanged.

Only the differences between frequencies matter for the sound. A filter that delays everything equally is just a plain delay, so the plugin keeps a fixed internal delay and lets you push each region earlier or later around it. While every enabled band is at 0 ms the plugin is completely transparent and adds no latency at all. Because the magnitude response stays flat, the effect is subtle: it changes timing, not tone, and it is easiest to hear on transients such as drums, plucked strings, and piano attacks.

### Sound Enhancement Guide

- **Copy a known filter with Filter GD**: A second-order analog section has a group-delay hump whose shape is fixed by its cutoff frequency and Q. Enter those two values into Freq and Q, then set Delay to minus the height of the hump you measured, and the band cancels it. A closed-box subwoofer or an LR2 crossover sum needs one band, a fourth-order bass-reflex alignment or an LR4 sum is covered by one or two.
- **Align a whole region with the shelves**: When one part of the spectrum arrives late as a group rather than around a single frequency, use Low Shelf or High Shelf with Q 2 to 4. That produces a step of roughly one octave in width, so everything on one side of the corner frequency is shifted by the same amount.
- **Touch up what is left with Peak**: Peak is a smooth bell whose half-width follows Q exactly as in a parametric EQ. Use it for the residual bumps that no single filter shape explains.
- **Be realistic about high-frequency crossovers**: An LR4 crossover at 3 kHz has a group-delay peak of only about 0.2 ms. Correcting it is below the threshold of audibility, so the benefit there is marginal; low-frequency timing errors are far more worthwhile.
- **Low frequencies and high Q need long filters**: Correcting a low-frequency resonance with a high Q, around Q 8, requires 32768 taps at 96 kHz. Watch the two curves: if the green one cannot follow the grey one, increase Taps or lower Q.
- **Work band by band**: Change one band at a time and listen. Phase-only changes are subtle on most program material, and comparing with the effect off tells you more than looking at the graph alone.

### Parameters

- **Type** - Selects the delay shape of the band. All four types are described by the same three values, Freq, Delay, and Q, and Delay is always the extreme value of that band's own curve.
  - **Peak** - A bell centred on Freq whose half-width equals the bandwidth implied by Q. It never overshoots, so it is the natural choice for free-form corrections and for touching up residual deviations.
  - **Low Shelf** - A smooth step that holds Delay below Freq, passes half of Delay at Freq, and falls to zero above it. Q sets the steepness of the transition: Q 1 matches the group-delay transition of a first-order allpass, while Q 2 to 4 gives the practical, roughly one-octave step used for band-limited alignment.
  - **High Shelf** - The mirror image of Low Shelf, and its complement: the two shapes at the same Freq and Q add up to a constant Delay.
  - **Filter GD** - Adds or subtracts the group-delay shape of one analog filter stage (high-pass, crossover, or resonance) as it is. Enter the cutoff frequency and Q of the filter you are correcting into Freq and Q, and the height of the hump on the measured group-delay curve into Delay, using a negative value to cancel it.
- **Freq** - Sets the band frequency from 20 Hz to 20 kHz.
- **Delay** - Sets the extreme value of that band's own curve in milliseconds. Positive values make that region arrive later, negative values earlier. The range covers the whole delay the filter can hold: at 96 kHz that is ±18.6 ms with 4096 taps and ±149.3 ms with 32768 taps. Changing Taps or the sample rate clamps the stored values to the new limit.
- **Q** - Sets the width or steepness of the shape from 0.1 to 100 on a logarithmic slider, and is used by every Type. The useful ranges differ: 0.25 to 16 for Low Shelf and High Shelf, and 0.1 to 10 for Filter GD. In practice, shelves are used at Q 2 to 4, and Filter GD at Q 0.5 to 8 - 0.5 corresponds to a first-order allpass or an LR2 sum, 0.7071 to a Butterworth alignment or an LR4 sum, and 8 to a sharp resonance. Settings outside those ranges are still accepted; the status line reports when the current Taps cannot realize them.
- **Enabled** - Turns each of the five bands on or off. Disabled bands contribute nothing to the target curve and appear dimmed on the graph.
- **Taps** - FIR length: 4096, 8192, 16384, or 32768. Low frequencies need a long filter, and so do high-Q shapes. Taps also decide how much delay the filter can hold, and therefore how far Delay reaches. More taps mean more latency and more processing.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing.

Total latency is the Latency setting plus half the Taps count. It stays the same while you move the bands, so only a change of Taps or Latency changes the delay of the whole chain.

### Visual Display

- The grey curve is the target: the sum of the enabled band shapes, drawn on a logarithmic frequency axis. The delay axis rescales itself to fit the current settings, starting at ±5 ms.
- The green curve is what the designed filter really does. Where the two curves lie on top of each other the setting is fully realized; where they separate, the filter cannot follow the request with the current Taps.
- Near 18 to 20 kHz the target is tapered smoothly down to zero. This high-frequency taper is by design, so a band placed close to the top of the range is shown, and realized, with a reduced effect.
- Numbered markers correspond to the five bands. Drag horizontally to change Freq and vertically to change Delay. The marker sits on the curve only for Peak: a shelf passes half of Delay at Freq, and Filter GD reaches its extreme value below Freq - just below it at high Q, and progressively further below as Q falls, until at Q of about 0.577 or less the extreme value sits at the low-frequency end of the graph.
- The status line shows the total latency in samples and milliseconds, and the magnitude ripple of the filter. Ripple measures how far the realized magnitude response departs from the flat design target: smaller values are closer to the target, and 0.3 dB is the accuracy-warning threshold.

[Back to all effects](/dsp/effects/)
