---
layout: dsp
title: "Adaptive Prediction — EffeTune DSP"
description: "Learns waveform predictions for residual extraction, prediction replacement, and evolving self-feedback sound."
lang: en
permalink: /dsp/effects/adaptive-prediction-effect/
---
# Adaptive Prediction

Semantic type: `AdaptivePredictionEffect` · Category: resonator

Learns waveform predictions for residual extraction, prediction replacement, and evolving self-feedback sound.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `gap` | `gap` | number / 1 | `1` | ms | 0 … 500 |
| `learn` | `learn` | number / 1 | `0.02` | Not declared in catalog | 0 … 0.1 |
| `weightDecay` | `weight_decay` | number / 1 | `0` | s | 0 … 60 |
| `autonomy` | `autonomy` | number / 1 | `0` | Not declared in catalog | 0 … 1 |
| `original` | `original` | number / 1 | `0` | Not declared in catalog | -2 … 2 |
| `residual` | `residual` | number / 1 | `1` | Not declared in catalog | -2 … 2 |
| `prediction` | `prediction` | number / 1 | `0` | Not declared in catalog | -2 … 2 |
| `freeze` | `freeze` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |
| `hold` | `hold` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |
| `resetToken` | `reset_token` | number / 1 | `0` | Not declared in catalog | 0 … 16777215 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

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

[Back to all effects](/dsp/effects/)
