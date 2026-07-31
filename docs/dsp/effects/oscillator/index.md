---
layout: dsp
title: "Oscillator — EffeTune DSP"
description: "Generates a periodic test tone without requiring an input signal."
lang: en
permalink: /dsp/effects/oscillator/
---
# Oscillator

Semantic type: `Oscillator` · Category: others

Generates a periodic test tone without requiring an input signal.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `frequency` | `frequency` | number / 1 | `880` | Hz | 20 … 96000 |
| `volume` | `volume` | number / 1 | `-12` | dB | -96 … 0 |
| `panning` | `panning` | number / 1 | `0` | Not declared in catalog | -1 … 1 |
| `waveform` | `waveform` | string / 1 | `"sine"` | Not declared in catalog | `sine`, `square`, `triangle`, `sawtooth`, `white`, `pink`, `impulse` |
| `mode` | `mode` | string / 1 | `"continuous"` | Not declared in catalog | `continuous`, `pulsed` |
| `interval` | `interval` | number / 1 | `500` | ms | 100 … 2000 |
| `width` | `width` | number / 1 | `5` | ms | 2 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Oscillator

A test tone and noise generator for checking your listening setup. Use it at low levels to confirm speaker/headphone output, left/right placement, level balance, rattles, buzzes, or simple frequency response issues.

The generated tone or noise is mixed into the current audio path rather than replacing the input. Lower the Volume before enabling it, especially while music is already playing.

### Features
- Multiple waveform types:
  - Pure sine wave for simple tone checks
  - Square wave for rich harmonic content
  - Triangle wave for softer harmonics
  - Sawtooth wave for bright timbres
  - Periodic one-sample impulses for checking impulse response and timing
  - White noise for broadband speaker/headphone checks
  - Pink noise for a smoother, more natural noise balance
- Pulsed operation mode for intermittent tones or noise bursts

### Parameters
- **Frequency (Hz)** - Controls the pitch of the generated tone (20 Hz to 96 kHz)
  - Low frequencies: Deep bass tones
  - Mid frequencies: Musical range
  - High frequencies: Use carefully and only at safe listening levels
  - Applies to sine, square, triangle, and sawtooth only; disabled for Impulse, white noise, and pink noise
  - Available high-frequency output depends on the current audio sample rate; tones above the usable Nyquist frequency are muted
- **Volume (dB)** - Adjusts output level (-96 dB to 0 dB)
  - Start low and raise slowly
  - Higher values can be loud or fatiguing
- **Panning (L/R)** - Controls stereo placement
  - Center: Equal in both channels
  - Left/Right: Check channel routing and balance
- **Waveform Type** - Selects the type of signal
  - Sine: Clean reference tone
  - Square: Rich in odd harmonics
  - Triangle: Softer harmonic content
  - Sawtooth: Full harmonic series
  - Impulse: One full-scale sample at each Interval, based on the current audio sample rate; Frequency does not affect it
  - White Noise: Equal energy per Hz; Frequency does not affect it
  - Pink Noise: Equal energy per octave; Frequency does not affect it
- **Mode** - Controls signal generation pattern
  - Continuous: Standard uninterrupted signal generation
  - Pulsed: Intermittent signal with controllable timing
  - Impulse always uses Pulsed; Continuous is disabled
- **Interval (ms)** - Time between pulse bursts in pulsed mode (100-2000 ms, step 10 ms)
  - Shorter intervals: Rapid pulse sequences
  - Longer intervals: Widely spaced pulses
  - Active when Mode is set to Pulsed, including Impulse
- **Width (ms)** - Pulse ramp time in pulsed mode (2-100 ms, capped at half of Interval, step 1 ms)
  - Controls the fade-in/fade-out time of each pulse
  - The generated pulse lasts about twice the Width, with no steady hold section
  - Shorter widths: Sharp pulse edges
  - Longer widths: Smoother pulse transitions
  - Only active when Mode is set to Pulsed; disabled for Impulse because each impulse is exactly one sample

### Example Uses

1. Speaker or Headphone Checks
   - Check basic frequency reproduction
     * Use sine wave sweep from low to high frequencies
     * Note where sound becomes inaudible or distorted
   - Listen for rattles, buzzes, or harsh resonances
     * Use low Volume first
     * Test one frequency range at a time
   - Compare left and right output
     * Pan fully left and right
     * Confirm each side plays from the expected speaker or headphone driver

2. Channel and Level Balance
   - Check stereo placement
     * Use a centered sine wave or pink noise
     * Confirm the sound appears centered
   - Compare left and right loudness
     * Pan to each side at the same Volume
     * Adjust your playback setup if one side seems louder
   - Check plugin chains
     * Place the Oscillator before or after other effects to hear how the chain treats a simple signal

3. Room or Desk Resonance Spot Checks
   - Find obvious bass build-up or rattles
     * Use low sine tones at safe levels
     * Move around the listening position and note strong peaks or dropouts
   - Check vibration-prone objects
     * Sweep slowly through low and low-mid frequencies
     * Reduce Volume immediately if anything rattles strongly

4. Noise Balance Checks
   - Use pink noise for a broad, steady reference
     * Listen for obvious left/right or tonal imbalance
     * Keep the level comfortable and avoid long high-volume noise playback
   - Use white noise only when you need a brighter broadband signal

5. Pulsed Signal Checks
   - Use pulsed mode to make short bursts easier to identify
     * Longer intervals make each burst easier to hear separately
     * Shorter Width values create sharper starts and stops
     * Compare behavior at different volume levels

6. Impulse Response and Timing Checks
   - Select Impulse to generate one-sample transients at the configured Interval
     * Use a longer Interval to separate reflections or effect tails
     * Record the output when you need to inspect a system or plugin chain's impulse response
     * Begin with a low Volume because an impulse has a sharp peak and broad frequency content

Remember: The Oscillator is a test signal generator. Start with low Volume, raise it gradually, and avoid loud or high-frequency tones that could cause equipment damage or hearing fatigue.

[Back to all effects](/dsp/effects/)
