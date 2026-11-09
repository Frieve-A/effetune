---
title: "Other Plugins - Test Tone & Noise Generator, SoundFont Note Player, SoundFont Player - EffeTune"
description: "Oscillator generates test tones and white or pink noise for checking speakers and headphones, and SoundFont Note Player plays detected notes with an SF2/SF3/SFZ instrument. SoundFont Player plays MIDI songs with SF2/SF3 SoundFonts or SFZ instruments."
lang: en
---

# Other Audio Tools

A collection of specialized audio tools and generators that complement the main effect categories. These plugins are useful for checking speakers, headphones, channel balance, and playback behavior before or during listening.

## Plugin List

- [Oscillator](#oscillator) - Test tone and noise generator for checking speakers/headphones
- [SoundFont Note Player](#sfz-note-player) - Plays detected notes with SF2/SF3 SoundFonts and SFZ instruments
- [SoundFont Player](#soundfont-player) - Plays MIDI songs with SF2/SF3 SoundFonts and SFZ instruments

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

## SoundFont Note Player

<a id="sfz-note-player"></a>

SoundFont Note Player detects notes in the incoming audio and plays them with an imported SF2/SF3/SFZ instrument. Use a piano SFZ to follow the notes of a song, or layer another instrument alongside the original recording. Polyphonic note estimation is a listening and layering tool rather than an exact transcription; dense mixes can miss notes or trigger extra ones.

### Sound Enhancement Guide

- **Import and Load an Instrument**: Click **SoundFont Library…**, use **Import files…** to import an `.sf2` / `.sf3` file, click **Load**, and choose a sound with **Preset**. For SFZ, use **Import folder…** to add the definition and its samples together (or a complete ARIA bank folder with `.bank.xml`, `Programs`, and `Samples`). The desktop app reads the original files in place; the web app stores imported instruments on your device. When using **Import files…** for SFZ, include all required samples and other files. Instruments in use cannot be deleted.
- **Audition and Blend**: Start with **Dry: 0%** and **Wet: 100%** to hear the SFZ instrument on its own, then raise **Dry** to blend the original track back in. Adjust **Timing** (−100 to +100 ms) so the SFZ note attacks align with the original recording (at 0 ms, the dry signal is delayed to match note detection: ~90 ms in Classic, ~230 ms in Event).
- **Focus the Note Range and Voices**: Raise **Threshold** to trigger only high-confidence notes, narrow **Lowest Note** and **Highest Note**, or enable only **Lowest** (bass line) or **Highest** (top melody) to follow a single musical line. A colored line in Note Spectrogram does not guarantee playback, because **Threshold** and the note range still apply.
- **Shape Timbre and Octave**: Use **Octave** (−2 to +2) to double a line an octave lower or higher, and use **Sample Shift** (−6 to +6 semitones) to play neighboring sample mappings pitched back to the detected note for a darker or brighter timbre.

### Parameters

- **SoundFont** - Opens **SoundFont Library…** to import, search, sort, load, or delete instruments (**Clear** unloads the current instrument without deleting it from the library).
- **Preset** - For an SF2/SF3 collection, chooses the sound used for detected notes. **Default** uses the first playable preset. This control is hidden for SFZ instruments.
- **Detection**:
  - **Classic (Low Latency)** (default): Lower-latency detector (~90 ms aligned delay) using **Threshold** and **Retrigger Drop**.
  - **Event (+140 ms)**: Uses the same onset/event detector as Note Spectrogram (~230 ms aligned delay, higher CPU use; **Threshold** and **Retrigger Drop** are disabled). When an enabled Note Spectrogram earlier in the chain analyzes the same input with the same note range and the audio between them is unchanged, its analysis is shared to reduce load if **Onsets**, **Instrument** color, or **Highlight** is enabled in Note Spectrogram. Otherwise, SoundFont Note Player performs its own analysis.
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

### Instrument Details

Expand **Instrument Details** below the main controls to read the SFZ instrument's labels for keys, MIDI controllers (**CC**), outputs, groups, layers and keyswitches. These labels explain the instrument's own mappings; they are not additional controls. When a labeled keyswitch is active, **Keyswitch** shows the selected articulation for each channel. Artwork appears when supplied by the instrument; if it declares several images, the last one is shown.

### Playback Display and Notes

- **Interactive Keyboard & Velocity Bars**: The keyboard spans **Lowest Note** to **Highest Note** and lights the notes being played, including release tails. Lit keys follow **Octave**; **Sample Shift** changes the timbre without moving them. Each bar starts at the playing velocity (1–127) and falls over time, even after the note ends; **Color** changes their colors without restarting the fall. **Voices / Max Voices** counts sample voices, including releases.
- **Audition**: Click or drag across the keyboard or velocity area to play the loaded SFZ instrument directly. The keyboard plays at velocity 100; the velocity area uses the height where you enter a note. Audition plays the displayed pitch, ignoring **Octave**, while **Sample Shift** still applies.
- **Memory Limit**: The default budget for instruments and their sample cache is **256 MiB**, adjustable up to **1024 MiB** under **SoundFont size limit** in **Settings > Config... > General**. Streamed source files can be larger. If loading fails because of this limit, raise it or choose a smaller instrument.
- **Supported SFZ Features**: SoundFont Note Player uses detected note attacks. Controller-dependent layers and keyswitches use the instrument’s initial settings; they do not follow MIDI song events. For MIDI songs and dynamic performance controls, use SoundFont Player. If an instrument uses unsupported settings or is missing required samples, it cannot be loaded. Check its files or choose another instrument.
- **Sharing & Backups**: Presets, shared links, and user-data backups store the instrument reference rather than its audio samples; keep your original SFZ folders for use across devices.

## SoundFont Player

Play MIDI songs with an SF2/SF3 SoundFont collection or an SFZ instrument, then adjust the sound with the effects that follow it. Incoming audio passes through unchanged, with the instrument added at this position in the pipeline.

### Getting Started

Open a `.mid` file, add SoundFont Player, and open **SoundFont Library…**. Import an `.sf2` / `.sf3` file, or an `.sfz` file together with its samples, then choose **Load**. The desktop app reads the original files; the web app stores imported files on your device. Start at 0 dB **Instrument Level** and lower it if the combined output is too loud.

SF3 (.sf3) uses compressed samples; import and select its sounds in the same way as SF2. SF3 playback requires Vorbis decoding support in your browser. If it is unavailable, choose an SF2 SoundFont or use a compatible browser.

**SoundFont Library…** imports, searches, loads, and deletes instruments. **Clear** unloads the instrument without deleting it from the library. Instruments in use cannot be deleted. If you change instruments during a song, the MIDI timeline continues while the new instrument is prepared. Once ready, it plays subsequent MIDI events with the current controller settings; earlier notes are not replayed.

### MIDI Mixer

The **MIDI Mixer** tab has one row for each of the 16 MIDI channels. An SF2/SF3 collection can provide a different sound for each channel; Bank Select and Program Change messages choose the sounds, and channel 10 uses the drum bank by default. GS/XG drum-part messages can assign percussion to other channels or return a channel to melodic sounds. Program Change selects an available drum kit in the loaded SoundFont. An SFZ instrument uses its own mappings.

Before a Program Change, melodic channels use program 1 in bank 0 and channel 10 uses the standard drum kit, if those sounds are available. If the requested SF2/SF3 sound is missing, melodic channels try the same program in bank 0, then program 1 in bank 0; drum channels try the standard drum kit. **Patch** shows the sound actually used. If none of these sounds exists, or **Automatic Fallback** is off, the channel has no sound to play.

- **Patch** selects a named sound from the loaded SF2/SF3 collection for that channel. New notes use the selected sound; notes already sounding keep their original sound.
- **Notes** lights each channel's keys while MIDI notes are held, from Note On to Note Off. Releasing a note turns its key off even if a sustain pedal or release tail keeps the sound playing. **Voices** counts the actual sample voices still sounding, including releases, against **Max Voices**. One note can use several sample voices.
- Drag across a channel's keys with the mouse, touch, or a pen to play the loaded instrument at the pitch of the key under the pointer, using that channel's current **Patch** and mixer settings. Moving to another key or releasing works like a MIDI Note Off: the previous note fades with the instrument's own release, so notes with a slow release overlap. This works independently of the song and MIDI input, so it sounds on top of a playing song. A channel with **Mute** on stays silent, and only rows with active mixer controls respond.
- **Vol.** (CC7, 0–127) adjusts the channel level. **EXP** (expression, CC11, 0–127) is an additional level control. Higher values make the channel louder; setting either to 0 silences it.
- **Pan** (CC10, 0–127) moves the sound from left to right, with 64 at the center.
- **Rev.** (CC91) and **Cho.** (CC93) adjust effect sends from 0 to 127. Higher values send more sound to the corresponding effect; the audible result depends on the instrument’s effect support and settings.
- **Level** shows each channel's measured audio after its volume, expression, pan, and Mute/Solo controls. The colored bar follows the signal, and the thin marker briefly holds recent peaks. Shared reverb and chorus returns are not included.
- **Mute** (**M**) silences that channel. **Solo** (**S**) lets you hear only channels with Solo enabled. Use these to compare parts of a song.

Drag the knobs vertically, or focus a knob and use the arrow keys. Mixer changes are temporary and are not saved with presets, shared links, or backups. Patch and controller changes use the incoming MIDI state; subsequent matching MIDI messages can overwrite them. All mixer changes, including Mute and Solo, reset for the next song or a GM, GS, or XG reset message.

When incoming MIDI changes the displayed Patch or a knob value, that control briefly highlights.

### Settings

The **Settings** tab contains the saved playback settings:

- **MIDI Channel** plays **All** channels by default, or only the selected channel from **1–16**.
- **Instrument Level** adjusts the generated sound from -60 to +12 dB (default 0 dB), without changing incoming audio.
- **Max Voices** limits simultaneous sample voices, including releases, to 1–1024 (default 256). Higher values preserve more overlapping sounds and use more processing.
- **Automatic Fallback** (on by default) replaces a missing SF2/SF3 sound with a similar available one, as described above. Turn it off to keep channels that request a missing sound silent, which makes gaps in the SoundFont easy to notice.
- **Interpolation** chooses how the instrument's samples are resampled. **FIR (64 taps)** uses the standard SF2/SF3 filter or the SFZ instrument's own quality setting. **FIR (32 taps)** (default) uses less processing for SF2/SF3; it uses 32 taps when no downsampling is needed, while FIR filters grow when playback requires downsampling to limit aliasing. **Cubic (4 points)** uses light interpolation, but lacks an anti-alias low-pass filter, so strongly raised notes or samples rich in high harmonics can produce aliasing. FIR and Cubic override an SFZ instrument's quality setting.
- **SF2 Compatibility** chooses how SF2/SF3 sounds are interpreted; SFZ instruments are not affected. **Standard** (default) behaves like common SoundFont synthesizers and the original SoundFont hardware, which most SoundFonts are tuned for: each sound's attenuation setting is applied at 40% strength, and the specification's default velocity-to-filter rule is ignored, so softer notes are not automatically darker. **SF2.04 Strict** follows the SoundFont 2.04 specification literally: attenuation is applied in full, so sounds that use attenuation play quieter than their authors likely intended, and softer notes sound darker. Use it to hear how a SoundFont sounds when the specification is followed to the letter.

The selected instrument and these settings are saved normally. The Music Player’s volume and mute also control the MIDI instrument. Presets, shared links, and backups store the instrument reference, not its samples; keep the original files available in the desktop app and for use on another device.

**Color** changes only the keyboard display. **Normal** uses the common graph color, **Note Colors** uses the Note Spectrogram note palette, and **Channel Colors** gives each MIDI channel a different color. The color choice is not saved with presets.

### Instrument Details

The loaded instrument summary shows its sample and preset counts, source file size, and playback memory when available. Large instruments stream the sample data needed for playback rather than loading the entire source into memory. The source size can therefore be much larger than the playback memory.

The status shows reading, instrument or sample-cache preparation, readiness, or a loading error. Progress shows completed work against the total when that total is known; otherwise, the indicator remains indeterminate. If loading fails, check that the original files are available or choose another instrument. When preloading is limited, you can still play, but some notes may start late.

In **Settings**, expand **Instrument Details** to read the SFZ instrument's labels for keys, MIDI controllers (**CC**), outputs, groups, layers and keyswitches. These labels explain the instrument's own mappings; they are not additional controls. When a labeled keyswitch is active, **Keyswitch** shows the selected articulation for each channel. Artwork appears when supplied by the instrument; if it declares several images, the last one is shown.

### Live MIDI Input

Live MIDI performance is available in the desktop app and web/PWA player. It is not supported in the Android app; Controller Mapping remains available there.

To play from a MIDI keyboard or a virtual MIDI port, close Music Player. In **Audio Configuration**, choose **Refresh MIDI Devices**, allow MIDI access if asked, and select **MIDI Input Device**. Keep an instrument loaded in SoundFont Player. An open Music Player takes priority even while paused; choose **None** to stop live MIDI input. Without a loaded instrument, MIDI continues silently. Loading an instrument makes subsequent MIDI events audible; past notes are not replayed. Live MIDI input is not relayed to **MIDI Output Device**, which sends only MIDI file playback from Music Player to an external device.

In the desktop app, websites in **Browser** that use Web MIDI can also play SoundFont Player through a MIDI output named **EffeTune**. From its first MIDI message, the page takes over live MIDI input until you click **Close** on the browser toolbar, leave the page, or reload it; live MIDI input then returns to the selected **MIDI Input Device**.

### SFZ Instruments

An SFZ instrument can shape each note's volume, pitch and tone over time, combine filters and built-in effects, and control sample loops and release sounds. Beat-synchronized playback and effects follow the MIDI song's tempo and playback speed. These settings belong to the instrument file; use the effects after SoundFont Player to adjust the combined sound yourself.

`amp_veltrack_random` lets an SFZ instrument vary its velocity-to-volume response for each new note. The default value 0 adds no random variation. It changes how playing strength affects volume, rather than changing the MIDI velocity itself.

Large instruments read sample data as needed within the configured memory budget. Keep the definition and its required samples together when importing; embedded samples and files used only by the instrument's effects are also included. If a sample fails its content check, restore the original file or import the instrument again. Instruments with separate outputs need an output configuration with enough channels.

An SFZ file can choose sample storage with `load_mode`: 0 (default) uses 32-bit floating-point, and 1 uses 16-bit PCM to reduce sample memory. Higher-precision sources lose precision in 16-bit mode. In EffeTune, `load_start` and `load_end` specify the first and last source sample frames to keep in memory, with the last frame included. When a range is specified, an omitted start means 0 and an omitted end means the sample’s end. Data outside that range streams as needed; this does not trim playback or shift loop positions. Without either bound, streaming remains automatic.

Compatibility varies by instrument, and some vendor-specific behavior is unavailable. See the [SFZ compatibility reference](../../specifications/sfz/README.md) for the supported profile and its limits. SoundFont Note Player uses the same instrument preparation, but its detected notes do not supply a MIDI song's controller changes or tempo.
