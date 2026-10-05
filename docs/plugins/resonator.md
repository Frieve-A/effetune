---
title: "Resonator Plugins - EffeTune"
description: "Resonator effect plugins including Adaptive Prediction, Horn Resonator and Modal Resonator."
lang: en
---

# Resonator Plugins

A collection of plugins that add resonant character to your music, from physical-object and speaker simulations to evolving resonance learned from the audio itself.

## Plugin List

- [Adaptive Prediction](#adaptive-prediction) - Learns audio predictions to extract residuals or create evolving resonance
- [Horn Resonator](#horn-resonator) - Simulates the resonance of horn speaker systems
- [Horn Resonator Plus](#horn-resonator-plus) - Smoother horn-speaker resonance for natural listening color
- [Modal Resonator](#modal-resonator) - Frequency resonance effect with up to 5 resonators

## Adaptive Prediction

Adaptive Prediction learns to predict the incoming waveform from earlier audio. Use it to reduce predictable parts of the sound, listen to the prediction itself, or feed the prediction back into a resonator that develops its own sound. Left and right channels learn independently.

**Residual** is the original sound minus the prediction. Repeating tones can become quieter in the residual as the effect learns, making changes and unpredictable details more apparent. With **Autonomy** above 0, the prediction also follows its own generated sound; at 1, that generation path is disconnected from the incoming audio. Learning still follows the external input unless frozen.

### Listening Guide and System Presets

Click **Effect Presets** in the effect header to choose a starting point. Presets change settings and retain the learning already acquired by the running effect.

| Preset | Gap | Autonomy | Original / Residual / Prediction | Starting use |
| --- | --- | --- | --- | --- |
| **Surprise** (default) | 1 ms | 0 | 0 / 1 / 0 | Listen for changing details as predictable tones are reduced. |
| **Prediction** | 5 ms | 0 | 0 / 0 / 1 | Replace the original with the learned prediction. Allow a few seconds of audible input to learn. |
| **Resonator** | 10 ms | 0.98 | 0.6 / 0 / 0.6 | Mix the original with evolving resonance influenced by the music. |
| **Hold** | 10 ms | 1 | 0 / 0 / 1 | Freeze learning and hear autonomous generation from the model already learned. |

For a first comparison, play a sustained tone or a repeating musical passage with **Surprise**, then choose **Prediction**. For autonomous sound, let **Prediction** learn first, then choose **Hold** or enable the **Hold** checkbox. Hold fixes the learned prediction rules, so pitch, timbre, and level can continue to change or fade; it does not hold a note or loop a recording. An untrained or freshly reset effect cannot start autonomous sound from silence.

### Parameters

- **Gap (ms)** — Excludes the most recent 0–500 ms from the waveform information used for prediction (default 1 ms). Larger values predict from more distant history and can change the tone or reduce prediction accuracy. Even at 0, the prediction uses earlier samples. Gap is neither output latency nor the length of a recording window; moving it preserves the learned model, which then adapts to the new distance.
- **Learn** — Sets how quickly prediction learning follows the input, from 0 to 0.1 (default 0.02). Higher values adapt faster; lower values change more slowly. At 0, error-driven learning stops, but finite **Weight Decay** can still reduce the learned coefficients.
- **Weight Decay (s)** — Sets how quickly learned coefficients decay while learning is active, from 0.5 to 60 seconds. Shorter times weaken older learning sooner; longer times retain it longer. This is not an audio-history length.
- **Infinity** — Disables Weight Decay (on by default). Turn it off to use the Weight Decay time.
- **Autonomy** — Blends external-input prediction with self-fed generation, from 0 to 1 (default 0). Increase it for stronger interaction with the generated sound; at 1, the generation path receives only its own feedback. Output mix levels do not change that feedback.
- **Original / Residual / Prediction** — Independent signed gains from −2 to +2, initially 0 / 1 / 0. Zero mutes that component; positive values add it; negative values invert its polarity. A magnitude above 1 increases its level. There is no automatic mix normalization. Because Residual = Original − Prediction, setting these gains to 0 / 1 / 1 reconstructs the original before output peak limiting.
- **Freeze** — Stops learning and Weight Decay while audio processing and generation continue. Turn it off to resume learning.
- **Hold** — Applies Freeze and Autonomy 1 together. While on, their controls are disabled; turning Hold off restores their separate settings.
- **Reset** — Clears learned coefficients, running states, and audio history. Control settings stay as they are. Prediction starts silent and must learn again.

Learning and Weight Decay pause when external input is below −60 dBFS, so silence does not erase the learned model. Generated sound does not count as input for this decision. Learned coefficients and running sound are temporary and are not saved in presets; a recreated effect learns again. While enabled, Adaptive Prediction continues processing during silence to preserve the learned sound. Bypass it when you no longer need it.

### If the Result Is Unexpected

- If **Prediction** or **Hold** is silent, turn Hold and Freeze off, keep Learn above 0, and play audible input to train the effect. Start with Autonomy 0.
- If resonance is too strong, lower Prediction or Autonomy. Output peak limiting controls sample peaks, but high mix settings can still change the tone.
- If a processing problem is reported, press Reset and play audio to learn again.
- Adaptive Prediction works with mono or stereo audio and requires **Use WebAssembly audio processing** to be enabled in Audio Configuration. Select one channel or a stereo pair in the effect routing. At an unsupported setting it is bypassed; choose a supported audio format.

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

## Horn Resonator Plus

Horn Resonator Plus adds a smoother, more natural horn-speaker character to music. Use it when you want vocals, brass, acoustic instruments, or full mixes to feel warmer and more lively, while keeping the resonance less sharp than the standard Horn Resonator.

It is based on the same horn model as [Horn Resonator](#horn-resonator), with a more detailed mouth and throat reflection model so resonances decay more smoothly.

### Listening Guide

- Smoother horn color: adds horn-loaded speaker character with less sharp ringing.
- Warmer presence: can make vocals, brass, and acoustic music feel more lively.
- Natural high-frequency behavior: the upper range is closer to an acoustic horn or horn-loaded speaker than the standard version.

### System Presets

Click **Effect Presets** in the effect header to start with the same three complete horn characters, rendered by the smoother Plus model.

- **Gramophone** - A strongly flared horn with an old acoustic-record-player color.
- **Vintage Theater** - A large, low-reaching theater-horn response.
- **Megaphone** - A short conical horn with a direct, emphatic midrange.

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

### System Presets

Click **Effect Presets** in the effect header to load a complete resonance pattern.

- **Wooden Body** - Low, longer-lived modes for a wooden enclosure character.
- **Metal Can** - Higher, longer ringing modes with a metallic character.
- **Plastic Enclosure** - Shorter, higher modes for a lightweight enclosure character.

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
