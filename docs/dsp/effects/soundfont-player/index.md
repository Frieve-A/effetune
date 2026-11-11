---
layout: dsp
title: "SoundFont Player — EffeTune DSP"
description: "Plays MIDI events with a prepared SF2, SF3, or SFZ instrument bank and adds the result to the input."
lang: en
permalink: /dsp/effects/soundfont-player/
---
# SoundFont Player

Semantic type: `SoundFontPlayer` · Category: others

Plays MIDI events with a prepared SF2, SF3, or SFZ instrument bank and adds the result to the input.

See [Assets and bundles](/dsp/concepts/assets-and-bundles/#soundfont-banks) before using this effect.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **soundFont (soundFont)**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `midiChannel` | `midi_channel` | integer / 1 | `0` | Not declared in catalog | 0 … 16 |
| `maxVoices` | `max_voices` | integer / 1 | `256` | Not declared in catalog | 1 … 1024 |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -60 … 12 |
| `sampleQuality` | `sample_quality` | integer / 1 | `0` | Not declared in catalog | 0 … 2 |
| `automaticFallback` | `automatic_fallback` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |
| `previewMidi` | `preview_midi` | integer / 1 | `-1` | Not declared in catalog | -1 … 127 |
| `previewChannel` | `preview_channel` | integer / 1 | `0` | Not declared in catalog | 0 … 15 |
| `sf2Compatibility` | `sf2_compatibility` | integer / 1 | `0` | Not declared in catalog | 0 … 1 |

### Playing MIDI

`assets.soundFont` takes a bank prepared as described in
[SoundFont banks](/dsp/concepts/assets-and-bundles/#soundfont-banks). Streams accept
note, control change, program change, and pitch bend messages as
[MIDI events](/dsp/concepts/streaming-and-events/#midi-events), and an
`EffeTuneNode` accepts them in real time through `sendMidi()`. One-shot
`process()` on an effect or Chain does not accept MIDI; there, `previewMidi` is the
only way to make the player sound. Graphs cannot deliver MIDI, so a Graph that
contains this effect, even a disabled one, raises `ValidationError` with
`GRAPH_UNSUPPORTED_CAPABILITY` when it is created. The output is added to the input,
so silent input yields the instrument alone. [MIDI to WAV](/dsp/cookbook/midi-to-wav/)
renders a MIDI file.

### Parameter values

- `midiChannel`: `0` (default) follows all 16 MIDI channels; `1` to `16`
  follows only that channel.
- `sampleQuality`: `0` (default) is FIR (64 taps), `1` is FIR (32 taps), and `2`
  is Cubic (4 points). The library default is FIR (64 taps), unlike the app's
  FIR (32 taps) default described below.
- `previewMidi`: `-1` (default) is off; `0` to `127` holds that MIDI note
  until the value changes.
- `previewChannel`: the zero-based MIDI channel of the preview note, so `0` is
  MIDI channel 1 and `15` is channel 16.

## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

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
- **Notes** lights each channel's keys while MIDI notes are held, from Note On to Note Off. Releasing a note turns its key off even if a sustain pedal or release tail keeps the sound playing. **Voices** counts the actual sample voices still sounding, including releases, against **Max Voices**. One note can use several sample voices. When **Max Voices** is reached and a new note has to stop a sounding voice, the **Voices** readout changes color for three seconds: orange if the stopped voice was already releasing, red if it was still being played.
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

Compatibility varies by instrument, and some vendor-specific behavior is unavailable. See the [SFZ compatibility reference](https://github.com/Frieve-A/effetune/blob/main/specifications/sfz/README.md) for the supported profile and its limits. SoundFont Note Player uses the same instrument preparation, but its detected notes do not supply a MIDI song's controller changes or tempo.

[Back to all effects](/dsp/effects/)
