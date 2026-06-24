---
title: "Other Plugins - EffeTune"
description: "Additional utility plugins including Oscillator for audio signal generation."
lang: en
---

# Other Audio Tools

A collection of specialized audio tools and generators that complement the main effect categories. These plugins are useful for checking speakers, headphones, channel balance, and playback behavior before or during listening.

## Plugin List

- [Oscillator](#oscillator) - Test tone and noise generator for checking speakers/headphones

## Oscillator

A test tone and noise generator for checking your listening setup. Use it at low levels to confirm speaker/headphone output, left/right placement, level balance, rattles, buzzes, or simple frequency response issues.

The generated tone or noise is mixed into the current audio path rather than replacing the input. Lower the Volume before enabling it, especially while music is already playing.

### Features
- Multiple waveform types:
  - Pure sine wave for simple tone checks
  - Square wave for rich harmonic content
  - Triangle wave for softer harmonics
  - Sawtooth wave for bright timbres
  - White noise for broadband speaker/headphone checks
  - Pink noise for a smoother, more natural noise balance
- Pulsed operation mode for intermittent tones or noise bursts

### Parameters
- **Frequency (Hz)** - Controls the pitch of the generated tone (20 Hz to 96 kHz)
  - Low frequencies: Deep bass tones
  - Mid frequencies: Musical range
  - High frequencies: Use carefully and only at safe listening levels
  - Applies to sine, square, triangle, and sawtooth only; disabled for white and pink noise
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
  - White Noise: Equal energy per Hz; Frequency does not affect it
  - Pink Noise: Equal energy per octave; Frequency does not affect it
- **Mode** - Controls signal generation pattern
  - Continuous: Standard uninterrupted signal generation
  - Pulsed: Intermittent signal with controllable timing
- **Interval (ms)** - Time between pulse bursts in pulsed mode (100-2000 ms, step 10 ms)
  - Shorter intervals: Rapid pulse sequences
  - Longer intervals: Widely spaced pulses
  - Only active when Mode is set to Pulsed
- **Width (ms)** - Pulse ramp time in pulsed mode (2-100 ms, capped at half of Interval, step 1 ms)
  - Controls the fade-in/fade-out time of each pulse
  - The generated pulse lasts about twice the Width, with no steady hold section
  - Shorter widths: Sharp pulse edges
  - Longer widths: Smoother pulse transitions
  - Only active when Mode is set to Pulsed

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

Remember: The Oscillator is a test signal generator. Start with low Volume, raise it gradually, and avoid loud or high-frequency tones that could cause equipment damage or hearing fatigue.
