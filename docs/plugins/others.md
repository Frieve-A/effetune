---
title: "Other Plugins - EffeTune"
description: "Additional utility plugins including Oscillator for audio signal generation."
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

SFZ Note Player detects notes in the incoming audio and plays them with an SFZ instrument you choose. Use a piano SFZ to follow the notes of a song, or blend another instrument with the original recording. Polyphonic note estimation can miss notes or detect extra ones, especially in dense music.

Playback automatically suppresses aliasing when shifting notes or converting sample rates.

**Retrigger Drop** controls when a note can play again during continuous detection. After detection and any **Note Hold** period end, detecting the same pitch again starts a new note.

### Sound Enhancement Guide

In Electron, click **Select SFZ Folder…** and choose the instrument folder containing its SFZ files, samples and included files. If several SFZ files are found, choose an instrument and click **Select**. Files within this folder are read directly each time the instrument loads. **Remove** removes the entry from the list without deleting the original files.

In the web version, click **Import Folder…** and choose a folder containing the SFZ file and its samples. If the folder contains several SFZ files, choose one and click **Import**. Select the saved instrument in **SFZ**; **Remove** deletes the selected bank from local storage.

Begin with **Dry** at 0% and **Wet** at 100% to hear the instrument alone, then raise **Dry** to add the original sound. Set **Octave** to -1 to add a lower layer, or +1 for a higher one. Raise **Threshold** to follow fewer, more confidently detected notes. Limit **Lowest Note** and **Highest Note** to the range you want to hear. Adjust **Velocity 1 Level** and **Velocity 127 Level** if the instrument is consistently too soft or too strong, and use **Output Gain** to balance its final level.

Use **Lowest** alone to follow a lower line, or **Highest** alone to follow an upper line.

If a sustained note repeats unexpectedly, raise **Retrigger Drop** from its default of 40 dB; 96 dB strongly suppresses repeats caused by level changes. Lower it to follow repeated strikes of the same note.

Raise **Note Hold** to lengthen notes and connect short gaps in detection. At 100 ms, a note is held for an extra 100 ms before note-off.

A colored line in **Note Spectrogram** does not by itself guarantee playback: **Threshold** and **Lowest Note / Highest Note** still apply. For very low or high notes, check these limits, try a lower **Threshold**, and check that the SFZ instrument covers the note after **Octave** is applied.

### Parameters

- **SFZ**: Chooses an instrument by name. A dialog reports problems on the first loading attempt after manual selection or import; automatic reloads show no dialog.
- **Threshold**: Minimum detection confidence (0.01–1, default 0.75). Higher values reduce unwanted notes but can miss quieter or less distinct notes.
- **Retrigger Drop (dB)**: Required fall from the note's peak input level before it can play again (1–96 dB, default 40 dB). The level must then rise by at least 6 dB. Higher values reduce repeats during sustained notes; lower values make repeated strikes easier to follow.
- **Note Hold (ms)**: Extra time to keep a note held after detection ends (0–100 ms, default 50 ms). If the same pitch returns within this period, the existing note continues. The instrument's envelope and sample length still apply.
- **Velocity 1 Level / Velocity 127 Level (dB)**: Input note levels mapped to the softest and strongest playing velocities (defaults -60 dB / -10 dB). Lowering these levels produces stronger velocities from the same input. Their spacing controls how widely input levels spread across the velocity range.
- **Lowest Note / Highest Note**: Lowest and highest input notes to detect (A0–C8, MIDI 21–108; defaults E1 and G6), displayed as note names. A narrower range ignores notes outside it.
- **Highest / Middle / Lowest**: Selects the lower line, inner notes, and upper line before Octave is applied (all enabled by default). Middle selects notes strictly between the current lowest and highest detected notes. The outer lines follow pitches over time to reduce sudden switches; a single detected note belongs to both. Notes no longer selected fade out naturally. Turn all three off to stop new notes.
- **Octave**: Shifts newly played SFZ notes by -2 to +2 octaves, in whole-octave steps (default 0). Negative values play lower notes; positive values play higher notes. The input detection range and notes already sounding remain unchanged.
- **Max Voices**: Limits simultaneous sample voices. A larger value preserves more overlapping notes and releases but uses more processing power; a smaller value replaces older voices sooner.
- **Dry (%)**: Level of the original audio (0–100%, default 20%). 0% mutes it; 100% keeps its original level.
- **Wet (%)**: Level of the SFZ instrument (0–100%, default 100%). 0% mutes it; 100% keeps its full level. Dry and Wet are independent.
- **Timing (ms)**: Adjusts the timing between the original audio and the SFZ instrument (-100 to +100 ms, default 0). Negative values delay the original audio further; positive values delay the instrument. Adjust it while listening to bring their note attacks closer together.
- **Output Gain (dB)**: Adjusts the final level of the blended output.

At **Timing** 0 ms, the original audio is delayed by about **80 ms** to match note-detection processing and correction. The analysis cycle and the instrument’s attack can still cause small timing differences. An enabled **Note Spectrogram** placed upstream with the same note range, input bus, and channel selection can share its analysis and reduce processing load when the audio between them is unchanged.

Loading supports common SFZ selection, pitch, volume, pan, loop, and amplitude-envelope settings. Release fades last at least **0.2 seconds**, preserving longer SFZ settings; samples can stop sooner at their end. Controller range conditions use initial controller values, with the SFZ's `set_ccN` settings taking priority. For example, a piano with the pedal initially released uses its pedal-up samples without adding its pedal-down layer. An instrument’s default key-switch articulation is used when specified. Layers requiring note release, controller events, dynamic key switching or other unsupported playing conditions are omitted. Invalid regions are skipped while valid regions continue. Other unsupported sound-shaping settings are ignored.

The default size limit is **256 MiB**. Change **SFZ size limit** in **Config → General** to raise it up to **1024 MiB (1 GiB)**. The limit applies to the instrument's files and the samples expanded for playback, starting with the next selection, import or load. Higher limits use more memory. If the full instrument exceeds the limit, loading tries representative samples across its playable note range. Velocity still changes volume, while velocity-layer and round-robin variations are simplified. If these samples do not fit, choose a smaller instrument or raise the limit. In the web version, reimport the original folder after raising the limit to restore omitted samples. Other sample-based effects also share the available processing memory.

Presets and shared pipelines contain only an instrument reference, without its sound files. On another device, select the local instrument folder in Electron, or import its folder in the web version. SFZ sound files are not included in the user-data backup; keep your original SFZ folders.
