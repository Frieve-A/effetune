---
title: "Resonator Plugins - EffeTune"
description: "Resonator effect plugins including Horn Resonator and Modal Resonator."
lang: en
---

# Resonator Plugins

A collection of plugins that emphasize resonant characteristics to add unique tonal textures and color to your music. These effects simulate resonances found in physical objects or speaker systems, enhancing your listening experience with warmth, shimmer, or vintage character.

## Plugin List

- [Horn Resonator](#horn-resonator) - Simulates the resonance of horn speaker systems
- [Horn Resonator Plus](#horn-resonator-plus) - Smoother horn-speaker resonance for natural listening color
- [Modal Resonator](#modal-resonator) - Frequency resonance effect with up to 5 resonators

## Horn Resonator

A plugin that simulates the resonance of a horn-loaded speaker using a digital waveguide model. It adds a warm, natural horn speaker character by modeling wave reflections at the throat and mouth, allowing you to shape the sound with simple controls.

### Listening Guide

- Warm midrange boost: accents vocals and acoustic instruments without harshness.
- Natural horn ambience: adds vintage speaker coloration for richer listening.
- Smooth high-frequency damping: prevents sharp peaks for a relaxed tone.

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

## Horn Resonator Plus

Horn Resonator Plus adds a smoother, more natural horn-speaker character to music. Use it when you want vocals, brass, acoustic instruments, or full mixes to feel warmer and more lively, while keeping the resonance less sharp than the standard Horn Resonator.

It is based on the same horn model as [Horn Resonator](#horn-resonator), with a more detailed mouth and throat reflection model so resonances decay more smoothly.

### Listening Guide

- Smoother horn color: adds horn-loaded speaker character with less sharp ringing.
- Warmer presence: can make vocals, brass, and acoustic music feel more lively.
- Natural high-frequency behavior: the upper range is closer to an acoustic horn or horn-loaded speaker than the standard version.

### Technical Enhancements

- **2nd-order mouth reflection filter**: Smoother modeling of frequency-dependent reflection at the mouth opening.
- **Frequency-dependent throat reflection**: Throat reflection changes with frequency for more natural horn behavior.

### Parameters and Usage

Horn Resonator Plus uses the same parameters as [Horn Resonator](#horn-resonator). Please refer to the Horn Resonator section for parameter descriptions, settings, and recommended values.

### Usage Guidelines

- **Horn Resonator**: Choose when you want lighter processing with basic horn character.
- **Horn Resonator Plus**: Choose when you want smoother, more natural horn coloration and can accept slightly higher CPU use.

### Quick Start Guide

Use the same controls as the [Horn Resonator](#horn-resonator). Choose Horn Resonator Plus when you want a smoother horn-speaker character.

## Modal Resonator

An effect that adds tuned resonances to your music, similar to the way physical objects or speaker parts ring at their natural frequencies. Use it when you want extra shimmer, body, metallic color, or speaker-like resonance during listening.

### Listening Experience Guide

- **Metallic Resonance:**
  - Creates bell-like or metallic tones that follow the dynamics of the source material.
  - Useful for adding shimmer or a metallic character to percussion, synths, or full mixes.
  - Use multiple resonators at carefully tuned frequencies with moderate decay times.
- **Tonal Enhancement:**
  - Subtly reinforces specific frequencies in the music.
  - Can accentuate harmonics or add fullness to specific frequency ranges.
  - Use with low mix values (10-20%) for subtle enhancement.
- **Full-Range Speaker Simulation:**
  - Simulates the modal behavior of physical loudspeakers.
  - Recreates the distinctive resonances that occur when drivers divide their vibrations at different frequencies.
  - Helps simulate the characteristic sound of specific speaker types.
- **Special Effects:**
  - Creates unusual timbral qualities and otherworldly textures.
  - Useful when you want an obvious resonance effect rather than natural enhancement.
  - Try extreme settings only when you want the resonances to become part of the sound.

### Parameters

- **Resonator Selection (1-5)** - Five independent resonators that can be enabled/disabled and configured separately.
  - Use multiple resonators for complex, layered resonance effects.
  - Each resonator can target different frequency regions.
  - Try harmonic relationships between resonators for more musical results.

For each resonator:

- **Enable** - Toggles the individual resonator on/off.
- **Freq (Hz)** - Sets the primary resonant frequency (20 to 20,000 Hz).
- **Decay (ms)** - Controls how long the resonance continues after the input sound (1 to 500 ms).
- **LPF Freq (Hz)** - Low-pass filter that shapes the tone of the resonance (20 to 20,000 Hz).
- **HPF Freq (Hz)** - High-pass filter that removes unwanted low frequencies from the resonance (20 to 20,000 Hz).
- **Gain (dB)** - Controls the individual output level of each resonator (-18 to +18 dB).

Global control:

- **Mix (%)** - Balances the combined output of all enabled resonators against the original sound (0 to 100%).

### Recommended Settings for Listening Enhancement

1. **Subtle Speaker Enhancement:**
   - Enable 2-3 resonators
   - Freq settings: 400 Hz, 900 Hz, 1600 Hz
   - Decay: 60-100ms
   - LPF Freq: 2000-4000 Hz
   - Mix: 10-20%

2. **Metallic Character:**
   - Enable 3-5 resonators
   - Freq settings: spread between 1000-6500 Hz
   - Decay: 100-200ms
   - LPF Freq: 4000-8000 Hz
   - Mix: 15-30%

3. **Bass Enhancement:**
   - Enable 1-2 resonators
   - Freq settings: 50-150 Hz
   - HPF Freq: 20-60 Hz, kept below the target resonance
   - Decay: 50-100ms
   - LPF Freq: 1000-2000 Hz
   - Mix: 10-25%

4. **Full-Range Speaker Simulation:**
   - Enable all 5 resonators
   - Freq settings: 100 Hz, 400 Hz, 800 Hz, 1600 Hz, 3000 Hz
   - HPF Freq settings: 20 Hz, 120 Hz, 250 Hz, 500 Hz, 1000 Hz
   - Decay: Progressively shorter from low to high (100ms to 30ms)
   - LPF Freq: Progressively higher from low to high (2000Hz to 4000Hz)
   - Mix: 20-40%

### Quick Start Guide

1. **Choose Resonance Points:**
   - Start by enabling one or two resonators.
   - Set their frequencies to target areas you want to enhance.
   - For more complex effects, add more resonators with complementary frequencies.

2. **Adjust the Character:**
   - Use the `Decay` parameter to control how long resonances sustain.
   - Shape the tone with the `LPF Freq` control.
   - Set `HPF Freq` below the resonance you want to keep, especially for bass settings.
   - Longer decay times create more obvious, bell-like tones.

3. **Blend with Original:**
   - Use `Mix` to balance the effect with your source material.
   - Start with lower mix values (10-20%) for subtle enhancement.
   - Increase for more dramatic effects.

4. **Fine-Tune:**
   - Make small adjustments to frequencies and decay times.
   - Enable/disable individual resonators to find the perfect combination.
   - Remember that subtle changes can have a significant impact on the overall sound.
