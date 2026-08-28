---
layout: dsp
title: "Horn Resonator — EffeTune DSP"
description: "Applies a horn-like resonant response to the input."
lang: en
permalink: /dsp/effects/horn-resonator/
---
# Horn Resonator

Semantic type: `HornResonator` · Category: resonator

Applies a horn-like resonant response to the input.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `crossover` | `crossover` | number / 1 | `600` | Hz | 20 … 5000 |
| `length` | `length` | number / 1 | `70` | cm | 20 … 120 |
| `throatDiameter` | `throat_diameter` | number / 1 | `3` | cm | 0.5 … 50 |
| `mouthDiameter` | `mouth_diameter` | number / 1 | `60` | cm | 5 … 200 |
| `curve` | `curve` | number / 1 | `40` | % | -100 … 100 |
| `damping` | `damping` | number / 1 | `0.03` | dB/m | 0 … 10 |
| `throatReflection` | `throat_reflection` | number / 1 | `0.99` | Not declared in catalog | 0 … 0.99 |
| `waveguideGain` | `waveguide_gain` | number / 1 | `26` | dB | -36 … 36 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Horn Resonator

A plugin that simulates the resonance of a horn-loaded speaker using a digital waveguide model. It adds a warm, natural horn speaker character by modeling wave reflections at the throat and mouth, allowing you to shape the sound with simple controls.

### Listening Guide

- Warm midrange boost: accents vocals and acoustic instruments without harshness.
- Natural horn ambience: adds vintage speaker coloration for richer listening.
- Smooth high-frequency damping: prevents sharp peaks for a relaxed tone.

### System Presets

Click **Effect Presets** in the effect header to start with a complete horn character.

- **Gramophone** - A strongly flared horn with an old acoustic-record-player color.
- **Vintage Theater** - A large, low-reaching theater-horn response.
- **Megaphone** - A short conical horn with a direct, emphatic midrange.

### Parameters

- **Crossover (Hz)** - Sets the frequency split between the low-frequency path (delayed) and the high-frequency path processed by the horn model. (20–5000 Hz)
- **Horn Length (cm)** - Adjusts the length of the simulated horn. Longer horns shift resonances lower and make them more closely spaced; shorter horns shift resonances higher and farther apart for a tighter sound. (20–120 cm)
- **Throat Diameter (cm)** - Controls the opening size at the horn's throat (input). Smaller values tend to increase brightness and upper midrange emphasis, larger values add warmth. (0.5–50 cm)
- **Mouth Diameter (cm)** - Controls the opening size at the horn's mouth (output). This affects the impedance matching to the surrounding air and influences the frequency-dependent reflection at the mouth. Larger values generally widen the perceived sound and reduce low-frequency reflection, smaller values focus it and increase low-frequency reflection. (5–200 cm)
- **Curve (%)** - Tunes the horn's flare shape (how the radius increases from throat to mouth).
    - `0 %`: Creates a conical horn (radius increases linearly with distance).
    - Positive values (`> 0 %`): Creates flares that expand more rapidly towards the mouth (e.g., exponential). Higher values mean slower expansion near the throat and very rapid expansion near the mouth.
    - Negative values (`< 0 %`): Creates flares that expand very rapidly near the throat and then more slowly towards the mouth (e.g., parabolic or tractrix-like). More negative values mean more rapid initial expansion.
    (-100–100 %)
- **Damping (dB/m)** - Sets internal attenuation (sound absorption) per meter within the horn waveguide. Higher values reduce resonance peaks and create a smoother, more damped sound. (0–10 dB/m)
- **Throat Reflection** - Adjusts the reflection coefficient at the horn's throat (input). Higher values increase the amount of sound reflected back into the horn from the throat boundary, which can brighten the response and emphasize certain resonances. (0–0.99)
- **Output Gain (dB)** - Controls the overall output level of the processed (high-frequency) signal path before mixing with the delayed low-frequency path. Use it to match or boost the effect level. (-36–36 dB)

### Quick Start

1.  Set **Crossover** to define the frequency range sent into the horn model (e.g., 800–2000 Hz). Frequencies below this are delayed and mixed back in.
2.  Start with a **Horn Length** of around 60-70 cm for a typical midrange character.
3.  Adjust **Throat Diameter** and **Mouth Diameter** to shape the core tone (brightness vs. warmth, focus vs. width).
4.  Use **Curve** to fine-tune the resonant character (try 0% for conical, positive for exponential-like, negative for tractrix-like flare).
5.  Tweak **Damping** and **Throat Reflection** for smoothness or emphasis of the horn's resonances.
6.  Use **Output Gain** to balance the level of the horn sound against the delayed low frequencies.

[Back to all effects](/dsp/effects/)
