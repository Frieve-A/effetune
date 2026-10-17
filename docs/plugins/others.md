---
title: "Other Plugins - Test Tone & Noise Generator, SFZ Note Player - EffeTune"
description: "Oscillator generates test tones and white or pink noise for checking speakers and headphones, and SFZ Note Player plays detected notes with an SFZ instrument."
lang: en
---

# Other Audio Tools

A collection of specialized audio tools and generators that complement the main effect categories. These plugins are useful for checking speakers, headphones, channel balance, and playback behavior before or during listening.

## Plugin List

- [Oscillator](#oscillator) - Test tone and noise generator for checking speakers/headphones
- [SFZ Note Player](#sfz-note-player) - Plays an imported SFZ instrument from detected notes

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

## SFZ Note Player

SFZ Note Player detects notes in the incoming audio and plays them with an imported SFZ instrument. Use a piano SFZ to follow the notes of a song, or layer another instrument alongside the original recording. Polyphonic note estimation is a listening and layering tool rather than an exact transcription; dense mixes can miss notes or trigger extra ones.

### Sound Enhancement Guide

- **Import and Load an Instrument**: Click **SFZ Library…**, use **Import folder…** to add a folder containing `.sfz` definitions and sample files (or a complete ARIA bank folder with `.bank.xml`, `Programs`, and `Samples`), and click **Load** beside the instrument. In the desktop app, EffeTune reads the original files in place; in the web app, instruments are stored on your device, and **Import files…** must include the samples and other files the instrument needs. Instruments in use cannot be deleted.
- **Audition and Blend**: Start with **Dry: 0%** and **Wet: 100%** to hear the SFZ instrument on its own, then raise **Dry** to blend the original track back in. Adjust **Timing** (−100 to +100 ms) so the SFZ note attacks align with the original recording (at 0 ms, the dry signal is delayed to match note detection: ~90 ms in Classic, ~230 ms in Event).
- **Focus the Note Range and Voices**: Raise **Threshold** to trigger only high-confidence notes, narrow **Lowest Note** and **Highest Note**, or enable only **Lowest** (bass line) or **Highest** (top melody) to follow a single musical line. A colored line in Note Spectrogram does not guarantee playback, because **Threshold** and the note range still apply.
- **Shape Timbre and Octave**: Use **Octave** (−2 to +2) to double a line an octave lower or higher, and use **Sample Shift** (−6 to +6 semitones) to play neighboring sample mappings pitched back to the detected note for a darker or brighter timbre.

### Parameters

- **SFZ** - Opens **SFZ Library…** to import, search, sort, load, or delete instruments (**Clear** unloads the current instrument without deleting it from the library).
- **Detection**:
  - **Classic (Low Latency)** (default): Lower-latency detector (~90 ms aligned delay) using **Threshold** and **Retrigger Drop**.
  - **Event (+140 ms)**: Uses the same onset/event detector as Note Spectrogram (~230 ms aligned delay, higher CPU use; **Threshold** and **Retrigger Drop** are disabled). When an enabled Note Spectrogram earlier in the chain analyzes the same input with the same note range and the audio between them is unchanged, its analysis is shared to reduce load if **Onsets**, **Instrument** color, or **Highlight** is enabled in Note Spectrogram. Otherwise, SFZ Note Player performs its own analysis.
- **Color** - **Normal** (theme graph color) or **Note Colors** (pitch-class colors matching Note Spectrogram).
- **Threshold** (0.01 to 1; default 0.75) - Detection confidence threshold in Classic mode.
- **Retrigger Drop (dB)** (1 to 96 dB; default 40 dB) - Required level drop before retriggering sustained notes above B5 in Classic mode; the level must then rise again by at least 6 dB. Higher values reduce unwanted repeats during sustained notes; lower values follow repeated strikes of the same note more easily. At B5 and below, detected attacks trigger new notes directly.
- **Note Hold (ms)** (0 to 100 ms; default 50 ms) - Bridges brief detection gaps before releasing a note.
- **Velocity 1 Level / Velocity 127 Level (dB)** (-96 to 0 dB / -60 to +24 dB; defaults -60 dB / -10 dB) - Input level range mapped to MIDI velocities 1–127. Lowering them gives stronger velocities from the same input.
- **Lowest Note / Highest Note** (A0 to C8; defaults E1 to G6) - Pitch detection range.
- **Highest / Middle / Lowest** - Filters which simultaneous detected notes are played (top line, inner voices, or bass line; all on by default).
- **Octave** (-2 to +2; default 0) - Transposes newly triggered SFZ notes in whole octaves.
- **Sample Shift** (-6 to +6 semitones; default 0) - Shifts which sample region is selected while counter-pitching it to preserve the target note pitch. Positive values play higher-note samples more slowly (at +1, a detected C4 uses the C#4 sample at C4 pitch); negative values play lower-note samples faster.
- **Max Voices** (1 to 128; default 32) - Maximum simultaneous sample voices (including release tails). Higher values keep more overlapping notes but use more processing.
- **Dry (%)** / **Wet (%)** (0 to 100%; defaults 20% / 100%) - Independent levels for the latency-aligned original audio and the SFZ instrument.
- **Timing (ms)** (-100 to +100 ms; default 0 ms) - Fine-tunes time alignment between the original audio and the SFZ instrument. Negative values delay the original audio further; positive values delay the instrument.
- **Output Gain (dB)** (-60 to +12 dB; default 0 dB) - Final output level trim.

### Playback Display and Notes

- **Interactive Keyboard & Velocity Bars**: The keyboard spans **Lowest Note** to **Highest Note** and lights the notes being played, including release tails. Lit keys follow **Octave**; **Sample Shift** changes the timbre without moving them. Each bar starts at the playing velocity (1–127) and falls over time, even after the note ends; **Color** changes their colors without restarting the fall. **Voices / Max Voices** counts sample voices, including releases.
- **Audition**: Click or drag across the keyboard or velocity area to play the loaded SFZ instrument directly. The keyboard plays at velocity 100; the velocity area uses the height where you enter a note. Audition plays the displayed pitch, ignoring **Octave**, while **Sample Shift** still applies.
- **Memory Limit**: Instruments default to a **256 MiB** limit (configurable up to **1024 MiB** under **SFZ size limit** in **Settings > Config... > General**). If an instrument exceeds the limit, representative samples across the keyboard are loaded automatically. In the web app, reimport the folder after raising the limit.
- **Supported SFZ Features**: Layers that need note release, controller events, or dynamic key switching are omitted, and other unsupported settings are ignored.
- **Sharing & Backups**: Presets, shared links, and user-data backups store the instrument reference rather than its audio samples; keep your original SFZ folders for use across devices.
