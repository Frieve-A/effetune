---
title: "Analyzer Plugins - EffeTune"
description: "Audio analysis plugins including Analog Meter, Chroma Spiral, Level Meter, Note Spectrogram, Oscilloscope, Pitch Meter, Rhythm Analyzer, Spectrogram, Spectrum Analyzer, and Stereo Meter."
lang: en
---

# Analyzer Plugins

A collection of plugins that let you see your music in fascinating ways. These visual tools help you understand what you're hearing by showing different aspects of the sound, making your listening experience more engaging and interactive.

## Plugin List

- [Analog Meter](#analog-meter) - Shows channel levels on a needle meter with VU, PPM, peak, and loudness scales
- [Chroma Spiral](#chroma-spiral) - Places frequency components around a note and octave spiral
- [Level Meter](#level-meter) - Shows digital signal level and possible clipping
- [Note Spectrogram](#note-spectrogram) - Shows estimated pitches over time as a piano roll
- [Oscilloscope](#oscilloscope) - Shows real-time waveform visualization
- [Pitch Meter](#pitch-meter) - Tracks one fundamental pitch and its tuning over time
- [Rhythm Analyzer](#rhythm-analyzer) - Shows the tempo, the hits beat by beat, and how early or late each part plays
- [Spectrogram](#spectrogram) - Creates beautiful visual patterns from your music
- [Spectrum Analyzer](#spectrum-analyzer) - Shows the different frequencies in your music
- [Stereo Meter](#stereo-meter) - Visualizes stereo balance and phase relationships

## Analog Meter

Shows the level of each channel on a classic needle meter without changing the sound. Use it to follow how loud your music is from moment to moment, or to see how your playback reads on the scales used in broadcasting and streaming: VU, PPM, peak, and loudness (LUFS).

### Listening Guide

- **Follow the average level with VU**: Watch the needle through a song. Quiet verses and loud choruses show a clear difference, while short drum hits barely move the needle.
- **Check for clipping with True Peak**: Place Analog Meter after your EQ and gain effects and play the loudest part of a track. If the reading goes above 0 dBFS or the over lamp lights, the chain can clip; lower the gain until the peaks stay below 0 dBFS, with a little margin such as -1 dBFS.
- **Compare songs with Loudness**: Set **Target** to a streaming reference such as -14 LUFS, press **Reset** at the start of a song or album, and play it through. The Integrated value shows its overall loudness and the maximum True Peak shows its highest peak, which gives a guide for matching volume across an album or playlist. LRA lets you compare how widely the loudness of each song varies.

### System Presets

Click **Effect Presets** in the effect header to set the meter to a well-known standard in one step. A preset that changes **Mode** starts the measurement over; switching between the Loudness presets keeps the measurement running.

- **Studio VU (-18 dBFS)** - VU with 0 VU at -18 dBFS, the common studio alignment (EBU R68). Suits recordings with plenty of headroom.
- **SMPTE VU (-20 dBFS)** - VU with 0 VU at -20 dBFS (SMPTE RP 155), the practice in North American studios and broadcasting.
- **Hot VU (-14 dBFS)** - The default settings: VU with 0 VU at -14 dBFS, which suits most finished commercial recordings.
- **Loud Master VU (-8 dBFS)** - VU with 0 VU at -8 dBFS, for loudness-maximized modern CDs and pop masters that would otherwise hold the needle at the top.
- **DIN PPM** - The DIN meter (**Attack** 5 ms, 20 dB fall in 1.5 s, DIN scale) with the -9 mark at -18 dBFS, so 0 is at -9 dBFS. The scale reaches down to -50.
- **BBC PPM** - The BBC meter (**Attack** 10 ms, 24 dB fall in 2.8 s, BBC scale) with mark 4 at -18 dBFS, so mark 6 is at -10 dBFS.
- **Nagra Modulometer** - The modulometer of Nagra tape recorders (**Attack** 7.5 ms, dB scale from -30 to +5 dB) with 0 dB at -18 dBFS. **Release** uses the DIN value of 1.5 s.
- **K-20** - Bob Katz's K-System on an RMS meter, with 0 at -20 dBFS and the scale reaching down to -60 dBFS. For recordings with wide dynamics.
- **K-14** - The same with 0 at -14 dBFS, down to -60 dBFS. For typical pop music.
- **K-12** - The same with 0 at -12 dBFS, down to -60 dBFS. For tightly compressed material made for broadcast.
- **Digital Peak** - A standard digital peak meter (IEC 60268-18) from -60 to 0 dBFS with a 2 s peak hold.
- **True Peak Clip Watch** - True Peak zoomed to the top 20 dB with the longest peak hold (10 s), for catching peaks above 0 dBFS after EQ or gain changes.
- **EBU R128 (-23 LUFS)** - Loudness with the European broadcast target and the EBU +9 scale.
- **EBU R128 +18 Scale** - The same target with the wider EBU +18 scale, for classical music and other material with wide dynamics.
- **TV (-24 LKFS)** - Loudness with the -24 LKFS target used for TV in the US (ATSC A/85) and Japan (ARIB TR-B32).
- **Streaming (-14 LUFS)** - Loudness with a -14 LUFS target, close to the volume normalization of many music streaming services, and the calmer Short-term needle.
- **Streaming (-16 LUFS)** - Loudness with the -16 LUFS target recommended for streaming and podcasts (AES TD1008), and the Short-term needle.

### Parameters

Only the controls that apply to the selected **Mode** are shown.

- **Mode** - Selects the meter type: **VU** (default), **PPM**, **RMS**, **Sample Peak**, **True Peak**, or **Loudness**. Each mode moves the needle differently and uses its own scale (see the Visualization Guide). Changing the mode starts the measurement over.
- **Integration** (RMS; 0.05 to 3 s; default 0.3 s) - Sets the averaging time. Longer values give a steadier, slower needle; shorter values follow changes more quickly.
- **Attack** (PPM; 1 to 20 ms; default 5 ms) - Sets how quickly the PPM needle rises, as the length of a tone burst that reads 2 dB below a steady tone. Shorter values show brief peaks closer to their full level; longer values let brief peaks read lower. 5 ms matches the DIN meter.
- **Release** (PPM, Sample Peak, True Peak; 0.1 to 5 s; default 1.5 s) - Sets the time the needle takes to fall 20 dB after a peak. Longer values make peaks easier to read; shorter values follow the music more closely. 1.5 s matches the DIN meter and the standard digital peak meter.
- **Reference** (VU, PPM, RMS; -30 to 0 dBFS; default -14 dBFS) - Sets the digital level that lands on the meter's reference mark. The default suits most finished commercial recordings; with the studio alignments of -18 or -20 dBFS (see System Presets), ordinary CDs often hold the needle near the top of the scale. Raise it when loud recordings push the needle to the top of the scale; lower it when quiet recordings barely move the needle.
- **Range** (PPM with the DIN or dB scale, RMS, Sample Peak, True Peak; 20 to 60 dB; default 40 dB) - Sets how far down the scale reaches. Widen it to see quiet passages; narrow it to spread out the upper part of the scale.
- **PPM Scale** (PPM; default DIN) - Selects the PPM scale: **DIN**, **BBC**, or **dB** (see the Visualization Guide).
- **Peak Hold** (PPM, RMS, Sample Peak, True Peak; 0 to 10 s; default 1 s) - Sets how long the peak mark stays at the highest recent reading, and how long the over lamp stays lit. 0 turns the mark off; the over lamp then stays lit for 1 s.
- **Needle** (Loudness; default Momentary) - Selects what the needle shows. **Momentary** follows loudness over the last 0.4 s; **Short-term** shows the last 3 s and moves more calmly.
- **Target** (Loudness; -36 to -10 LUFS; default -23 LUFS) - Sets the loudness marked on the scale and lays out the scale relative to it. -23 LUFS is the EBU R128 broadcast level; many streaming services use values around -14 LUFS.
- **Scale** (Loudness; default EBU +9) - Selects the width of the loudness scale. **EBU +9** covers 18 LU below to 9 LU above **Target**; **EBU +18** covers 36 LU below to 18 LU above, which suits music with wide dynamics or very loud material.

### Visualization Guide

- Each channel has its own meter, up to four per row and up to 16 channels.
- Levels follow the common digital convention that a full-scale sine wave reads 0 dBFS, so a steady sine wave gives the same reading in every mode except Loudness.
- The modes differ in how quickly the needle moves:

| Mode | Needle movement | Scale |
|---|---|---|
| VU | Slow. It reaches a new level in about 0.3 s and shows the average level (IEC 60268-17). | -20 to +3 VU. 0 VU = **Reference**. |
| PPM | An approximation based on IEC 60268-10. Rises quickly at the speed set by **Attack**; with the default 5 ms, a 10 ms burst reads about 1 dB below a steady tone, as on a DIN meter. Falls 20 dB in the **Release** time. | Selected by **PPM Scale**. **DIN**: the -9 mark = **Reference**, so 0 is 9 dB above it. **BBC**: marks 1 to 7, with 4 dB between marks from 2 to 7 and 6 dB between 1 and 2; mark 4 = **Reference**. **dB**: the 0 mark = **Reference**, from **Range** below it up to +5 dB. |
| RMS | Shows the average power over the **Integration** time, with no extra smoothing. | The 0 mark = **Reference**. |
| Sample Peak | Jumps immediately to the highest sample value. | Top of the scale = 0 dBFS. |
| True Peak | Like Sample Peak, but also estimates peaks between samples. It can read above 0 dBFS; such peaks can clip in a DAC or during conversion. | Top of the scale = 0 dBFS. |
| Loudness | Shows loudness in LUFS as defined by ITU-R BS.1770 and EBU R128. | Set by **Target** and **Scale**; readings are shown in LUFS. |

- The peak mark shows the highest recent reading for the **Peak Hold** time. The over lamp lights when the level exceeds 0 dBFS and stays lit for the **Peak Hold** time, or for 1 s when **Peak Hold** is 0.
- In Loudness mode, the first meter shows the whole program. Its needle follows **Needle**, and it lists Momentary (M), Short-term (S), Integrated (I), Loudness Range (LRA), the maximum True Peak, and the elapsed measurement time, with a **Reset** button. Integrated and LRA appear once enough audio has been measured.
  - For mono, stereo, and 5.1 (channel order L, R, C, LFE, Ls, Rs), these values follow the standard channel weighting. For other channel counts, all channels are added with equal weight, so the values are for reference only.
  - The meters after the first one show each channel on its own. These are reference values, measured without channel weighting or gating.
- Integrated, LRA, and the maximum True Peak keep accumulating until you press **Reset**, change **Mode**, the sample rate or channel count changes, or audio processing restarts.
- Time when processing is paused is not measured: during power-saving pauses in silence, while Master Bypass is on or Analog Meter is turned off, and while the Effect Pipeline is not visible (for example, in the Music Library, when minimized, or in Mini Player) with **Skip display-only DSP when hidden** turned on in Config (on by default). The readings continue from where they stopped.

## Chroma Spiral

Shows where the frequency components of your music fall among the 12 notes and across octaves, without changing the sound. Use it to see which note positions are active when harmonics overlap, compare a vocal with a bass line, or inspect the pitch range of an instrument.

### Listening Guide

- Play a sustained note, then look for its position and the other positions lit by its harmonics. A single note can light several note names; these are frequency components, not necessarily separate played notes.
- Watch a chord or melody to see how its active note positions change. The display can suggest tonal patterns, but it does not identify a chord or key.
- For a tuning check, watch whether a bright dot or the outer edge of a filled peak falls between note guides. Use Pitch Meter when you need a cents readout for one fundamental pitch.
- Press the graph with a mouse, finger, or pen to hear a sine wave at the selected spiral position. Drag to change the tone; release or cancel the gesture to stop it. This preview works with every **Color** choice.

### Parameters

- **Color** - Selects how the spectrum is drawn. The same background spiral guide remains visible with every choice, even during silence.
  - **Normal** (default): shows each frequency cell as a dot in the theme's graph trace color. Its brightness follows the cell's level, while its area grows in proportion to that level, making quieter frequencies easier to see. At maximum strength, a dot's radius reaches halfway toward the next spiral turn.
  - **Normal 2**: fills from each frequency's spiral position out to its level in the graph trace color, without drawing a data contour.
  - **Note Colors**: shows the same dots as Normal, but uses a different color for each note, repeated across octaves.
- **Lowest Octave** (1 to 8; default 1) - Sets the innermost displayed octave. Raise it to focus on higher sounds.
- **Highest Octave** (1 to 9; default 7) - Sets the outermost displayed octave. Lower it to focus on bass and midrange sounds. The two octave limits stay in order when either is changed.
- **Frequency Tilt** (-6 to +6 dB/oct in 0.5 steps; default +3) - Adjusts the displayed level of frequencies above 100 Hz without changing the sound. Positive values make higher frequencies more prominent; negative values make them less prominent. At 0, no frequency correction is applied.
- **Level Range** (6 to 96 dB in 1 dB steps; default 24) - Sets the width of the moving display window. Narrow it to emphasize level differences; widen it to show weaker components alongside stronger ones.
- **Display Floor** (-120 to -24 dB in 1 dB steps; default -60) - Sets how low the moving display window may reach during quiet passages. Lower it to allow quieter components to appear within the selected **Level Range**. The window still follows recent peaks, so this setting does not guarantee that every quiet component will be visible.

### Visualization Guide

- Each turn covers one octave. C is at the top and note names run clockwise; inner turns are lower than outer turns. The C labels mark the octave numbers.
- In **Normal** and **Note Colors**, brighter, larger dots indicate stronger components at their positions, including between note names. In **Normal 2**, a filled region extends farther outward for stronger components; its outer edge shows the changing spectrum without a separate contour line.
- Dot brightness and area, and the filled area's extent, show relative strength. The display follows recent peaks, so they are not absolute level readings.
- Low notes are less sharply separated and respond more slowly. Nearby notes in the lowest octaves may blur together.

### Visual Display
- Hover over the display, or touch and drag on it, to read the values at that point.

## Level Meter

A visual display that shows your music's digital signal level in real time. It helps you check levels after applying effects and spot possible clipping before it becomes audible distortion.

### Visualization Guide
- The horizontal bar extends farther to the right as the signal level gets louder
- The white marker holds a new peak for one second, then falls smoothly
- OVERLOAD means the signal exceeded the safe digital range and may distort
- For clean playback, avoid frequent red levels or OVERLOAD warnings; set your actual listening volume on your device

## Note Spectrogram

Shows estimated fundamental pitches (F0s) in a selectable range from A0 to C8 in a scrolling piano roll without changing the audio. Use it to follow chord tones, changing vocal and melodic lines, bass lines, and notes that overlap across octaves. The analyzer estimates the fundamental pitches of notes it detects in the selected range.

### Visualization Guide

- **Vertical** shows time from left to right, with the keyboard and current sound at the right edge. Higher notes appear toward the top.
- **Horizontal** places the keyboard at the bottom, with low notes on the left and high notes on the right. New sound appears just above the keyboard, and history scrolls upward.
- New sound is shown with an immediate pitch estimate. About 40, 80, and 160 ms later, that part of the history is updated using the sounds that follow, so recent marks just behind the newest sound may change. This adds no display delay and leaves **Sync Visuals to Audio** alignment unchanged.
- Lines at each C mark octave boundaries.
- Pitch rows corresponding to black piano keys use a nearly black gray background so they remain distinguishable when no note is detected.
- **Normal** uses the theme’s graph trace color; **Note Colors** uses a different color for each note, repeated across octaves. The guide lines between E and F remain visible in both modes.
- **1/12 Octave** shows one row per semitone. **High (1/60 Octave)** divides each semitone into five rows so that small pitch movement is easier to follow; colors are blended between neighboring notes.
- Color strength indicates confidence in each pitch estimate; weak candidates remain visible without a display threshold.
- With **Volume** on, each detected pitch becomes a bar whose opaque core thickness shows its frequency-corrected relative volume, from 1/60 octave at the bottom of the scale to 1/12 octave at the top. A fade extends 1/120 octave beyond each side of that core, adding 1/60 octave to the total footprint. **Pitch Resolution** changes the bar’s center position, not its core thickness.
- At the keyboard edge, a soft-edged semicircle extends into the graph and shows the current volume. It responds immediately to increases and falls at 20 dB per second; there is no separate visible peak hold.
- The volume scale covers 24 dB. Its top follows the louder of a recent reference used to stabilize the history scale (over about one second) and -36 dB, so quieter material remains readable without making louder passages fill the display continuously. This reference is separate from the current-volume semicircle.
- Octave and E–F guide lines are drawn behind the volume bars so the pitch grid remains a visual reference.
- The keys blend from their normal color toward the display color as confidence in the latest frame increases, reaching that color at 1.
- Changing **Color** recolors the existing history.

### Visual Display
- Hover over the history, or touch and drag on it, to read the note, time, **Salience** (pitch confidence), and **Level** (frequency-corrected volume in dB) at that point.

### Listening Guide

- Chords appear as several bright rows at the same time
- Melodies and bass lines form paths that move between note rows
- The display estimates pitch; it does not create MIDI or notation, identify instruments, or separate every simultaneous sound completely. Complex overlaps can leave parts of a melody or harmony blank, while percussion, noise, and unclear repeating patterns can produce an occasional incorrect pitch.

### Parameters

- **Color** - Selects the display colors without changing the pitch estimates.
  - **Normal** (default): the theme’s graph trace color.
  - **Note Colors**: a separate color for each note, repeated across octaves.
- **Pitch Resolution** - Selects the vertical pitch detail without clearing the existing history.
  - **1/12 Octave** (default): one row per semitone, using the strongest estimate within that note.
  - **High (1/60 Octave)**: five rows per semitone for finer pitch movement.
- **Layout** - Selects **Horizontal** (default) or **Vertical**. Switching layout preserves the existing history.
- **Volume** - Shows relative volume in bar thickness and semicircle meters. It is on by default; turning it off shows confidence as row intensity.
- **Time Span** (1 to 10 s) - Sets how much time the piano roll shows
  - Shorter values make timing changes easier to see
  - Longer values show a longer musical passage at once
  - Default: 2 s
- **Lowest Note** - Sets the bottom of both the displayed and analyzed pitch range. Default: E1.
- **Highest Note** - Sets the top of both the displayed and analyzed pitch range. Default: G6.
- When input is too low for analysis, the piano roll remains dark rather than showing extremely small input as pitches. This suppression does not determine whether a sound would be audible or perceptually masked.

## Oscilloscope

Shows the shape of the sound wave in real time, so you can see beats, sharp hits, and changes in loudness while listening. Trigger settings can steady the display when the waveform repeats.

### Visualization Guide
- Horizontal axis shows time (milliseconds)
- Vertical axis shows normalized amplitude; the visible range changes with Display Level and Vertical Offset
- Green line traces the actual waveform
- Grid lines help measure time and amplitude values
- Trigger settings determine where the waveform capture begins; no separate marker is shown

### Visual Display
- Hover over the graph, or touch and drag on it, to read the values at that point.

### Parameters
- **Display Time** - How much time to show (1 to 100 ms)
  - Lower values: See more detail in shorter events
  - Higher values: View longer patterns
- **Trigger Mode**
  - Auto: Continuous updates even without trigger
  - Normal: Freezes display until next trigger
  - Off: No trigger; continuously shows the latest waveform as it arrives. Trigger Level, Trigger Edge, and Holdoff have no effect
- Trigger detection uses the averaged left/right waveform. Mono input is used directly.
- **Trigger Level** - Amplitude level that starts capture
  - Range: -1 to 1 (normalized amplitude)
- **Trigger Edge**
  - Rising: Trigger when signal goes up
  - Falling: Trigger when signal goes down
- **Holdoff** - Minimum time between triggers (0.1 to 10 ms)
- **Display Level** - Vertical scale in dB (-96 to 0 dB)
- **Vertical Offset** - Shifts waveform up/down (-1 to 1)

### Note on Waveform Display
The waveform connects captured points in time order. For longer display times, each interval retains its first and last samples plus the minimum and maximum samples at their original positions, preserving continuity and short peaks at display resolution. Use it as a visual guide rather than an exact measurement tool.

## Pitch Meter

Tracks one fundamental pitch (F0) at a time in a two-second scrolling piano roll without changing the audio. Use it to check the tuning and pitch movement of a solo voice or instrument.

### Visualization Guide

- **Horizontal** (default) places low notes on the left and high notes on the right. The newest estimate appears above the keyboard and history scrolls upward.
- **Vertical** places low notes at the bottom and high notes at the top. The newest estimate appears beside the keyboard at the right and history moves left.
- The line position shows pitch between semitones. A more confident estimate appears more strongly; the line breaks when the input is too quiet or no stable single pitch is found. **Heatmap** uses line color to show relative volume, while **Note Colors** follows pitch.
- The current label shows the nearest note and the difference in cents. A positive value is above the note and a negative value is below it. The label disappears when there is no reliable estimate.
- The note name uses the same note colors as Note Spectrogram. The large readout fits the available width and keeps the cents decimal point in a fixed position.

### Visual Display
- Hover over the display, or touch and drag on it, to read the values at that point.

### Listening Guide

- Start with a single sustained note, then watch whether the line stays centered on a note or moves sharp or flat.
- Vibrato and pitch bends appear as smooth movement across the note rows.
- This analyzer follows one dominant pitch. Chords, dense mixes, percussion, noise, or unclear repeating sounds can interrupt the line or produce an incorrect octave.

### Parameters

- **Color** - Changes the line color without changing pitch detection. **Normal** (default) uses the theme’s graph trace color; **Heatmap** follows relative volume on the same 24 dB scale as Note Spectrogram; **Note Colors** follows pitch between the note colors.
- **Layout** - Selects **Horizontal** (default) or **Vertical**.
- **Reference A4** (400 to 480 Hz) - Sets the tuning reference used for note names and cents. Default: 440 Hz.
- **Lowest Note** - Sets the bottom of the displayed and analyzed range. Default: C2. The lowest available setting is A0.
- **Highest Note** - Sets the top of the displayed and analyzed range. Default: C7. The highest available setting is C8.
- Stereo input is analyzed by averaging the first two channels; mono input is used directly. Strong opposite-polarity content can cancel in the average and leave no pitch trace.

## Rhythm Analyzer

Finds the tempo of your music and shows, beat by beat, where the drum and instrument hits land and how early or late each part plays, without changing the sound unless **Metronome Click** is on. Use it to find a track's BPM, check how much swing a groove has, see whether the snare sits behind the beat, or spot where a fill comes in or a pattern changes.

### Listening Guide

- **Check the tempo**: Play a track with a clear, steady beat. The BPM and **adopted** line follow the analysis history, which appears about 1–2 seconds after the sound. **LOCKED** means the analyzer is showing beat ticks for the lamp and click. If the tempo differs from the beat you tap your foot to, compare **×½**, **×2**, and **strongest**: one may match the beat level you feel.
- **Hear where the beat falls**: Turn on **Metronome Click** to hear a click on each detected beat. If the clicks fall on the beat you tap your foot to, the analyzer has found the beat. If they fall between your taps, or at twice or half your tapping speed, the analyzer is following a different beat position or level; see **Fix a lock at double or half speed** below and **Limitations**.
- **Place it last when using the click**: The click is mixed into the audio that leaves the analyzer, so any effect after it also processes the click. Put Rhythm Analyzer at the end of the effect chain while you listen with the click.
- **Turn the click off before processing files**: With **Metronome Click** on, the clicks are written into any file you process. Turn it off first.
- **Fix a lock at double or half speed**: If a slow ballad locks at twice its tempo, lower **Max BPM** below that value (for example, to 100 for a 60 BPM ballad). If a fast track locks at half speed, raise **Min BPM** above that value. The analysis starts over with the new range.
- **Read a steady groove**: With programmed music or music played to a click, the dots sit close to the center of their lanes, and **jitter** stays near 0 ms. When one part plays consistently behind or ahead of the others, its dots sit above or below the lane center at the same positions every time. A snare that is 15 ms behind the kick and hi-hat, for example, shows as Mid dots raised above the lane center on beats 2 and 4, and as a Mid mark labelled +15 in the **1** column of the beat lens.
- **Read the swing**: **swing** shows how far the off-beat is delayed: 1.00:1 is straight, 2.00:1 is a full triplet shuffle, and values in between are a lighter swing. In clearly swung music, the beat lens places off-beat hits in the **⅔** column instead of **&**.
- **Spot fills and section changes**: A ring marks a hit that the same band did not play at the same position one or two spans earlier. While a pattern repeats, few rings appear; a fill or the first bars of a new section show many. The echo rows below the main lanes let you compare the new pattern with the previous ones.
- **When it shows searching**: The analyzer stops showing new beat ticks, but continues analyzing the music. Tempo, timing lanes, and the beat lens can remain visible and grow fainter as confidence falls. A beat already detected may still flash or click. Silence clears the current beat readings; the analysis starts again when sound returns. Fades and background sound can take longer to stop the ticks.

### Parameters

- **Min BPM** (40 to 192; default 40) - Sets the lowest tempo considered in the analysis. Raise it when the analyzer follows half of the tempo you feel.
- **Max BPM** (50 to 240; default 240) - Sets the highest tempo considered in the analysis. Lower it when the analyzer follows double the tempo you feel. Max BPM stays at least 1.25 times Min BPM; if a change breaks this relation, the other limit moves. Changing either limit restarts the analysis. The tempogram always covers 30–480 BPM, and the **×½** and **×2** lines may lie outside the selected range.
- **Metronome Click** (on or off; default off) - Adds a short, high-pitched click on each shown beat tick, matching the beat lamp. New clicks stop during **searching**, though a beat already detected can still play. The fixed level is about −10 dBFS, added to channels 1 and 2 (channel 1 for mono); other channels are unchanged. When it is off, audio passes through unchanged. Toggling the click does not restart analysis.
- **Span (beats)** (4, 6, 8, 12, or 16; default 8) - Sets how many beats the main lanes and each echo row show, and how far back the rings compare. It changes only the display, not the analysis. A span that covers whole bars lines up a repeating pattern across the echo rows, for example 8 for two bars of 4/4 or 6 for two bars of 3/4.
- **Tempogram**, **Timing lanes**, **Echo rows**, **Beat lens** (on or off; Timing lanes and Beat lens are on by default) - Show or hide the tempogram strip, the main lanes, the echo rows, and the beat lens. The remaining panels grow to fill the space, and the header is always shown. Hiding a panel changes only the display: the analysis continues, and the panel shows its full history again when you turn it back on.

### Visualization Guide

The display has five parts: the header, the tempogram strip, the main lanes, the echo rows, and the beat lens. On a wide display the beat lens sits to the right of the lanes, and with only these two shown, as by default, its rows line up with the lane rows so each band reads across one line; on a tall display all parts are stacked from top to bottom. When you hide panels with their checkboxes, the remaining panels fill the space; the header always stays. Hits are sorted into three bands: **Low** (kick drum and bass), **Mid** (snare, voices, and most instruments), and **High** (hi-hats and cymbals). All bands share one color; in the lanes, echo rows, and beat lens each band has its own row, with **High** at the top and **Low** at the bottom. Axis names, tick values, and the **High**, **Mid**, and **Low** row labels are drawn over the graphs. The display counts beats only; it does not detect bars or beat 1.

- **Header**:
  - The beat lamp flashes once for each shown beat tick and fades quickly; **Metronome Click** follows those same ticks. The flash is weaker when confidence is lower. During **searching** the lamp is hollow, though an already detected beat may still flash. The lamp and click respond sooner than the delayed analysis history.
  - The BPM comes from the confirmed analysis beats. **LOCKED** means new beat ticks are shown; **searching** means they are hidden. Searching does not erase an available tempo or timing analysis.
  - **×½** and **×2** - Half and double the tempo shown.
  - **strongest** - The tempo with the strongest current support in the tempogram. It can differ from the tempo of the delayed analysis history.
  - **swing** - The ratio between the first and second half of a beat, from the typical off-beat position in the last 32 beats. 1.00:1 is straight and 2.00:1 is a triplet shuffle.
  - **jitter** - The typical random scatter of hits around their average position in the beat lens, in ms. Tight, programmed parts read near 0; loose playing reads higher.
  - A key to the symbols: **○ timing unavailable**, **◎ new vs N / 2N beats ago**, and **beat re-aligned** for the dashed line.
  - A value that is not available yet shows —.
- **Tempogram strip**: Shows the last 20 seconds. **Time** runs left to right; **Tempo (BPM)** covers 30–480 on a logarithmic scale. Brightness shows relative support for each tempo, not the probability that it is correct. Half- or double-tempo bands can suggest other plausible beat levels. A solid **adopted** line shows tempo from confirmed analysis beats; dashed **×2** and **×½** lines show its multiples. The history follows the audio time it describes, while the lines extend to the right edge at the latest confirmed tempo. Lower confidence makes them fainter. Silence clears the current tempo column.
- **Main lanes**: Show the most recent beats, including the newest estimates, with the latest on the right; **Span (beats)** sets their width and the caption reads **Last N beats**. There is one row per band, with **Beats** horizontally and **Timing (ms)** vertically. Vertical guides mark beats and eighth notes where analysis is available. Each dot is a detected hit, joined to the lane center by a stem; a larger dot means a more certain hit. Points appear as soon as hits are detected. The newest positions are estimates, updated continuously as more sound arrives. They move smoothly toward the current estimate and become fixed when the analysis confirms them about 1–2 seconds later. The lanes and echo rows scroll smoothly with the sound. They continue scrolling at the last available tempo during silence or stopped playback, so older hits leave the visible windows.
  - The height of a dot in its lane shows its timing: above the lane center (0 ms) is late, below is early. Dotted lines labelled **+20** and **−20** mark ±20 ms, and hits beyond ±30 ms stay at the lane edge. Timing is measured from the nearest sixteenth-note or triplet position, whichever grid the music follows, and is shown relative to the typical timing of the preceding 16 beats. A constant delay shared by all parts therefore does not show; the lanes show how each hit differs from the recent average.
  - A hollow circle is a hit without an available beat analysis. It sits at the lane center because its timing is unknown.
  - A ring marks a hit absent at the same position in the same band one or two spans earlier. Rings begin one span after analysis starts or the grid is re-aligned.
  - A shaded area marks unavailable timing analysis; **searching** in the header alone does not remove timing.
  - A dashed line marks a re-aligned beat grid, after a change of beat position or beat level. The beat lens, swing, and jitter begin a new summary there.
- **Echo rows**: Cycles of as many beats as **Span (beats)** sets, stacked with the newest on top and separated by lines. The horizontal axis is **Beats**, and the vertical axis, **Cycles ago**, numbers each row. While the main lanes are shown, the rows start one cycle back, at 1, and the caption reads **Previous N-beat cycles**. With the main lanes hidden, the top row is the current cycle, at 0, the caption reads **Recent N-beat cycles**, and the top row carries the band labels when it has room. Because beats line up vertically, a pattern that repeats every cycle forms vertical columns, and a change breaks them. The echo rows show the band of each hit, **High** at the top of a row and **Low** at the bottom, but not its timing. Hollow circles, rings, shading, and dashed lines have the same meaning as in the main lanes.
- **Beat lens**: Summarizes up to the last 32 confirmed beats since analysis started or the grid was re-aligned. Columns show positions within a beat along **Position in beat**: **1**, sixteenth-note **e**, **&**, **a**, and triplet **⅓**, **⅔**. Each band has a labelled row; beside the main lanes, the rows line up with their corresponding bands.
  - The vertical mark shows how early (left) or late (right) that band plays at that position on average. The scale at the top covers ±30 ms, with ticks at ±20 ms. The shaded bar around the mark shows the scatter (± one standard deviation). A more opaque mark means the position is played more often; a position needs at least four hits to appear.
  - As values update, the marks and bar widths move smoothly toward the new values, slowing as they approach them.
  - Offsets are measured relative to the ensemble as a whole, so if everything plays together, every mark sits at the center. The lens shows how the parts differ from one another.
  - Offsets of 3 ms or more are labelled in ms. Smaller offsets are drawn without a label, because timing differences between bands below about 3 ms cannot be measured reliably.
  - Until beat analysis is available, the lens shows **waiting for a steady beat**. It remains available during **searching** when confirmed analysis is still present.
- Confidence shades the tempo text and lines, timing lanes, echo rows, beat lens, swing, and jitter. Dimmer readings mean less confidence in the analysis, not looser playing. Timing looseness is shown by dot heights, **jitter**, and lens bars. **LOCKED** controls whether new lamp and click ticks are shown.
- When EffeTune's player starts a new track, the analysis starts over automatically at the start of the track, and the display keeps its history. The **Reset** button clears the display and starts the analysis over, for example when another app switches tracks.
- Stereo input is analyzed by averaging the first two channels; mono input is used directly.

### Visual Display
- Hover over the display, or touch and drag, to read values. Lanes and echo rows show beats ago, band, and timing of the nearest hit (— when unavailable). The tempogram shows tempo and time, **Tempo support** (relative support, with 100% for the strongest tempo), and **Adopted** tempo. The beat lens shows each band's offset and scatter.

### Limitations

- Accuracy can be lower with large tempo fluctuations, sparse rhythm, acoustic performances, or solo piano. Ambient sound, noise, and sustained tones can produce incorrect beat ticks; **LOCKED** is not a guarantee of a correct beat. Compare the click with the rhythm you hear and turn it off when it is unhelpful.
- The analyzer can settle on a different beat level than a listener would choose, so the lamp and the click may run at twice, half, two-thirds, or one and a half times the tempo you feel. On classical music, music played with rubato, and some other music, it also takes longer to lock and jumps briefly to another level more often than on music with a steady beat. **×½**, **×2**, and **strongest** show likely alternative tempos. If the detected tempo or beat position seems wrong, try narrowing **Min BPM** and **Max BPM** around the expected tempo and listen again.
- With sparse, clave-like rhythm patterns, the beat can lock on the off-beat.
- When the tempo changes continuously, as in a gradual speed-up or free rubato, the beat follows with a short delay, so the click can run slightly early or late until the tempo settles.
- On some steady tracks the beat position is occasionally re-aligned, shown by the dashed line, even though the music did not change.
- In dense mixes and noisy recordings, the **Mid** and **High** lanes show more dots where no instrument actually struck. The **Low** lane misses some low piano notes.
- There is no bar or meter detection: the display is organized by beats only and does not show where a bar starts.
- Analysis is available at 8, 11.025, 16, 22.05, 24, 32, 44.1, 48, 88.2, 96, 176.4, 192, 352.8, and 384 kHz. At other rates, such as 64 kHz, audio still passes through but rhythm analysis and clicks are unavailable. Choose a supported sample rate to use them.

## Spectrogram

Shows how your music changes over time. Color intensity shows how strong each frequency is, while vertical position shows its frequency.

The graph scrolls from right to left at a steady speed, with marks every second.

### Visualization Guide
- Colors show how strong different frequencies are:
  - Dark colors: Quiet sounds
  - Bright colors: Loud sounds
  - Watch the patterns change with the music
- Vertical position shows frequency:
  - Bottom: Bass sounds
  - Middle: Main instruments
  - Top: High frequencies
- With **Log (HQ)**, nearby low-frequency tones appear as more clearly separated bands. The longer low-frequency measurement can take a little longer to settle or fade.

### Visual Display
- Hover over the display, or touch and drag on it, to read the values at that point.

### What You Can See
- Melodies: Flowing lines of color
- Beats: Vertical stripes
- Bass: Bright colors at the bottom
- Harmonies: Multiple parallel lines
- Different instruments create unique patterns

### Parameters
- **DB Range** - How vibrant the colors are (-144dB to -48dB)
  - Lower numbers: See more subtle details
  - Higher numbers: Focus on the main sounds
- **Points** - FFT size used for the display (256 to 16384)
  - Higher numbers: More frequency detail, but slower time updates
  - Lower numbers: Faster movement, but less frequency detail
  - With **Log (HQ)**, Points sets the short analysis window; a four-times-longer window improves low-frequency separation.
- **Color** - **Normal** uses the theme’s graph color, with stronger frequencies shown more brightly. **Heatmap** (default) uses the original dark-to-bright multicolor scale. Switching color recolors the existing history.
- **Frequency Scale** - **Log** gives low frequencies more display space. **Log (HQ)** adds a longer measurement for clearer separation of nearby bass frequencies while retaining the short measurement for higher frequencies. It uses more processing and low-frequency changes can take longer to appear or fade; it does not change the audio. **Linear** places equal frequency widths at equal intervals.
- **Keyboard** - Shows a static keyboard guide at the right of the graph that relates musical notes to frequencies. It does not change the analysis or audio. The keys follow **Log**, **Log (HQ)**, or **Linear**; **Log (HQ)** uses the same logarithmic spacing as **Log**, while with **Linear**, low-frequency keys look narrower.
- The analyzer uses the average of the left and right channels. Mono input is analyzed directly.

## Spectrum Analyzer

Creates a real-time visual display of your music's frequencies, from deep bass to high treble. It's like seeing the individual ingredients that make up the complete sound of your music.

### Visualization Guide
- Left side shows bass frequencies (drums, bass guitar)
- Middle shows main frequencies (vocals, guitars, piano)
- Right side shows high frequencies (cymbals, sparkle, air)
- Higher peaks mean stronger presence of those frequencies
- The thicker line shows the current sound
- The thinner line follows recent peaks and falls smoothly as they fade
- In **Bar** display, each bar shows the strongest level in an equal-width portion of the display. **Log** and **Log (HQ)** use equal octave widths; **Linear** uses equal frequency widths.
- The thin marker above a bar shows its recent peak and falls smoothly.
- With **Log (HQ)**, nearby bass tones can appear as separate peaks. Their longer low-frequency measurement can take a little longer to settle or fade.
- Watch how different instruments create different patterns

### Visual Display
- Hover over the graph, or touch and drag on it, to read the values at that point.

### What You Can See
- Bass Drops: Big movements on the left
- Vocal Melodies: Activity in the middle
- Crisp Highs: Sparkles on the right
- Full Mix: How all frequencies work together

### Parameters
- **DB Range** - How sensitive the display is (-144dB to -48dB)
  - Lower numbers: See more subtle details
  - Higher numbers: Focus on the main sounds
- **Points** - How finely the display separates nearby frequencies (256 to 16384)
  - Higher numbers: More frequency detail, with slower updates
  - Lower numbers: Quicker updates, with less frequency detail
  - With **Log (HQ)**, Points sets the short analysis window; a four-times-longer window improves low-frequency separation.
- **Color** - **Normal** (default) keeps the theme’s graph colors. **Heatmap** colors higher levels more brightly, and **Note Colors** follows the note colors across the frequency axis. The choice applies to both Line and Bar displays. With **Bar** and **Note Colors**, each bar and its peak use one color based on the band’s center frequency.
- **Frequency Scale** - **Log** gives low frequencies more display space. **Log (HQ)** adds a longer measurement for clearer separation of nearby bass frequencies while retaining the short measurement for higher frequencies. It uses more processing and low-frequency changes can take longer to appear or fade; it does not change the audio. **Linear** places equal frequency widths at equal intervals.
- **Display** - Changes only how the spectrum looks; it does not change the analysis or audio.
  - **Line** (default): Shows the spectrum as continuous lines.
  - **Bar**: Shows the strongest level in each display band as a bar.
- **Keyboard** - Shows a static keyboard guide below the graph that relates musical notes to frequencies. It does not change the analysis or audio. The keys follow **Log**, **Log (HQ)**, or **Linear**; **Log (HQ)** uses the same logarithmic spacing as **Log**, while with **Linear**, low-frequency keys look narrower.
- The analyzer uses the average of the left and right channels. Mono input is analyzed directly.

### Fun Ways to Use These Tools

1. Exploring Your Music
   - Watch how different genres create different patterns
   - See the difference between acoustic and electronic music
   - Observe how instruments occupy different frequency ranges

2. Learning About Sound
   - See the bass in electronic music
   - Watch vocal melodies move across the display
   - Observe how drums create sharp patterns

3. Enhancing Your Experience
   - Use the Level Meter to check signal peaks after adding effects
   - Watch the Spectrum Analyzer dance with the music
   - Create a visual light show with the Spectrogram

## Stereo Meter

A fascinating visualization tool that lets you see how your music creates a sense of space through stereo sound. Watch how different instruments and sounds move between your speakers or headphones, adding an exciting visual dimension to your listening experience.

### Visualization Guide
- **Diamond Display** - The main window where the music comes to life:
  - Center: Very quiet moments or moments where the combined signal is near zero
  - Top/Bottom: Sound shared by left and right channels, such as centered or mono-like content
  - Left/Right: Difference or out-of-phase content between the channels
  - Sounds that are much stronger on one side can appear toward the labeled corners
  - Green dots dance with the current music
  - White line traces the musical peaks
  - The white peak line decays with every audio sample, so its movement stays consistent regardless of the audio processing block size
- **Correlation Bar** (Left side)
  - Shows left/right channel correlation
  - Top (+1.0): Left and right are nearly the same, often sounding centered
  - Middle (0.0): Weak channel relationship, often from wide ambience or unrelated left/right content
  - Bottom (-1.0): Left and right are nearly opposite polarity, which can sound weak on speakers
- **Balance Bar** (Bottom)
  - Shows if one speaker is louder than the other
  - Center: Music equally loud in both speakers
  - Left/Right: Music stronger in one speaker
  - Numbers show how much louder in decibels (dB)

### What You Can See
- **Centered Sound**: Strong vertical movement in the middle
- **Spacious Sound**: Activity spread wide across the display
- **Special Effects**: Interesting patterns in the corners
- **Speaker Balance**: Where the bottom bar points
- **Channel Correlation**: What the left correlation bar shows

### Parameters
- **Window** (10-1000 ms) - How much recent audio is shown in the display
  - Lower values: See quick musical changes
  - Higher values: See overall sound patterns
  - Default: 100 ms works well for most music
- **Gain** (0-24 dB; default 0 dB) - Enlarges only the dots and peak line in the diamond. Raise it to see quieter patterns more clearly. It does not change the sound or the correlation and balance readings.

### Enjoying Your Music
1. **Watch Different Styles**
   - Classical music often shows gentle, balanced patterns
   - Electronic music might create wild, spreading designs
   - Live recordings can show natural room movement

2. **Discover Sound Qualities**
   - See how different albums use stereo effects
   - Notice how some songs feel wider than others
   - Observe how instruments move between speakers

3. **Enhance Your Experience**
   - Try different headphones to see how they show stereo
   - Compare old and new recordings of your favorite songs
   - Watch how different listening positions change the display

Remember: These tools are meant to enhance your enjoyment of music by adding a visual dimension to your listening experience. Have fun exploring and discovering new ways to see your favorite music!
