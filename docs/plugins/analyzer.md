---
title: "Analyzer Plugins - Spectrum Analyzer, Spectrogram, VU & LUFS Meters - EffeTune"
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

Shows the level of each channel on a classic needle meter without changing the sound. Use it to follow how loud your music is from moment to moment, or to see how your playback reads on the scales used in broadcasting and streaming: VU, PPM, peak, and loudness (LUFS). **Custom** lets you combine a detector, needle movement, and dial to make your own meter.

### Listening Guide

- **Follow the average level with VU**: Watch the needle through a song. Quiet verses and loud choruses show a clear difference, while short drum hits barely move the needle.
- **Check for clipping with True Peak**: Place Analog Meter after your EQ and gain effects and play the loudest part of a track. If the reading goes above 0 dBFS or the over lamp lights, the chain can clip; lower the gain until the peaks stay below 0 dBFS, with a little margin such as -1 dBFS.
- **Compare songs with Loudness**: Set **Target** to a streaming reference such as -14 LUFS, press **Reset** at the start of a song or album, and play it through. The Integrated value shows its overall loudness and the maximum True Peak shows its highest peak, which gives a guide for matching volume across an album or playlist. LRA lets you compare how widely the loudness of each song varies.
- **Make your own meter with Custom**: Start with **Bouncy VU** for a more lively needle, **Slow RMS** for a calm view of average level, or **Fast Peak** to follow brief peaks. Adjust **Needle Response** for speed and **Overshoot** for bounce. Custom can give a PPM-like rise and fall, but its peak detectors rise instantly; use **PPM** for the standard PPM response.

### System Presets

Click **Effect Presets** in the effect header to choose a standard or custom meter in one step. A preset that changes **Mode** starts the measurement over; switching between the Loudness presets keeps the measurement running.

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
- **Bouncy VU** - Custom with the VU detector and dial, and 15% overshoot for a needle that bounces more strongly.
- **Slow RMS** - Custom with a 3 s RMS average, a 1000 ms needle response, and no overshoot. The dB dial has 0 at -18 dBFS and reaches down to -60 dBFS.
- **Fast Peak** - Custom with True Peak detection, a 0.5 s detector release, a 10 ms needle response, and no overshoot. The dBFS dial covers the top 40 dB and reads in dBTP.

### Parameters

Only the controls that apply to the selected **Mode** are shown. In **Custom**, all of its controls remain visible; those that do not apply are disabled, keeping the settings panel the same height.

- **Mode** - Selects the meter type: **VU** (default), **PPM**, **RMS**, **Sample Peak**, **True Peak**, **Loudness**, or **Custom**. Each mode moves the needle differently and uses its own scale (see the Visualization Guide). Changing the mode starts the measurement over.
- **Detector** (Custom; default Average Rectified) - Chooses the level the needle follows. **Average Rectified** uses the signal's absolute amplitude, averaged by the needle itself without a separate averaging window, as in VU. **RMS** measures average power over **Integration**. **Sample Peak** catches the highest sample value; **True Peak** also estimates peaks between samples. Both peak detectors rise instantly and fall according to **Release**. Changing the detector starts the measurement over.
- **Integration** (RMS, Custom with RMS detector; 0.05 to 3 s; default 0.3 s) - Sets the averaging time. Longer values give a steadier, slower reading; shorter values follow changes more quickly. In Custom, the needle adds its own response after this average.
- **Attack** (PPM; 1 to 20 ms; default 5 ms) - Sets how quickly the PPM needle rises, as the length of a tone burst that reads 2 dB below a steady tone. Shorter values show brief peaks closer to their full level; longer values let brief peaks read lower. 5 ms matches the DIN meter.
- **Release** (PPM, Sample Peak, True Peak, Custom with Sample Peak or True Peak detector; 0.1 to 5 s; default 1.5 s) - Sets the time to fall 20 dB after a peak. Longer values make peaks easier to read; shorter values follow the music more closely. In Custom this controls the detector's fall, followed by the needle's own response. 1.5 s matches the DIN meter and the standard digital peak meter.
- **Needle Response** (Custom; 1 to 3000 ms; default 300 ms) - Sets how long the needle takes to first reach 99% of a new, steady detector level. Lower values give a faster needle; higher values make it move more slowly. RMS averaging and peak release also affect the overall movement.
- **Overshoot** (Custom; 0 to 25%; default 1.25%) - Sets how far the needle goes past a new, steady detector level, as a percentage of the level change. Higher values give more bounce; 0 makes the needle approach without going past it.
- **Dial** (Custom; default VU) - Chooses **VU**, **DIN**, **BBC**, **dB**, or **dBFS** independently of the detector and needle movement. VU, DIN, and BBC use the scales described below. With dB, the 0 mark is **Reference** and the upper end is 0 dBFS. With dBFS, the upper end is 0 dBFS and readings use dBTP when **Detector** is True Peak.
- **Reference** (VU, PPM, RMS, Custom except dBFS dial; -30 to 0 dBFS; default -14 dBFS) - Sets the digital level that lands on the meter's reference mark. The default suits most finished commercial recordings; with the studio alignments of -18 or -20 dBFS (see System Presets), ordinary CDs often hold the needle near the top of the scale. Raise it when loud recordings push the needle to the top of the scale; lower it when quiet recordings barely move the needle.
- **Range** (PPM with the DIN or dB scale, RMS, Sample Peak, True Peak, Custom with DIN, dB, or dBFS dial; 20 to 60 dB; default 40 dB) - Sets how far down the scale reaches. Widen it to see quiet passages; narrow it to spread out the upper part of the scale.
- **PPM Scale** (PPM; default DIN) - Selects the PPM scale: **DIN**, **BBC**, or **dB** (see the Visualization Guide).
- **Peak Hold** (PPM, RMS, Sample Peak, True Peak, Custom; 0 to 10 s; default 1 s) - Sets how long the peak mark stays at the highest recent reading, and how long the over lamp stays lit. 0 turns the mark off; the over lamp then stays lit for 1 s.
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
| Custom | Follows **Detector**, with speed set by **Needle Response** and bounce set by **Overshoot**. The defaults give the same needle movement as VU. | Selected by **Dial**, independently of the needle movement. |

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

Shows estimated fundamental pitches (F0s) from A0 to C8 in a scrolling piano roll without changing the audio. Use it to follow chord tones, vocal and melodic lines, bass lines, and overlapping notes across octaves, with optional instrument color-coding and highlighting.

### Listening Guide

- **Chords & Melodies**: Chords appear as simultaneous bright rows; melodies and bass lines trace paths across note rows.
- **Follow Vocals or Bass**: Choose **Instrument (3)**, or keep **Note Colors** and select **Vocal** or **Bass** in **Highlight**. Use **Instrument (9)** for finer instrument grouping.
- **Estimate Accuracy**: Pitch and instrument estimates are a visual listening aid rather than exact transcription. Overlapping sounds, percussion, or noise can produce ambiguous estimates, and drums are not classified. Instrument estimates use earlier notes as clues, so they are less reliable just after enabling them or moving the playback position; once ready, an estimate is not revised.

### Instrument Groups

**Instrument (3)** groups pitches into **Vocal**, **Bass**, and **Other** (all groups below except Vocal and Bass).

**Instrument (9)** separates pitches into nine groups:
- **Vocal**: Recorded human singing, including solo voices and choirs.
- **Bass**: Acoustic, electric, and synth bass.
- **Guitar**: Acoustic, clean electric, and distorted guitars.
- **Piano**: Acoustic and electric pianos, harpsichord, and clavinet.
- **Strings**: Solo and ensemble strings, pizzicato, harp, and synth strings.
- **Wind**: Brass and woodwinds, including saxophones and flutes.
- **Synth**: Synth leads and pads.
- **Organ**: Organs, accordion, and harmonica.
- **Other**: Pitched percussion (celesta, vibraphone), synthesized choir/voice patches, synth effects, orchestral hits, ethnic instruments, and sound effects.

### Parameters

- **Color** - Selects display colors without changing pitch detection (switching recolors existing history):
  - **Normal** (default): Theme graph trace color.
  - **Note Colors**: Distinct color per pitch class, repeated across octaves.
  - **Instrument (3)**: Colors for Vocal, Bass, and Other.
  - **Instrument (9)**: Colors for the nine instrument groups above.
- **Highlight** - Emphasizes a specific group (**Vocal**, **Bass**, **Other (3)**, **Guitar**, **Piano**, **Strings**, **Wind**, **Synth**, **Organ**, or **Other (9)**) by shifting notes toward neutral gray the less likely they are to belong to that group, while preserving volume thickness. **None** (default) disables highlighting.
  - Onset and instrument analysis use additional CPU. To minimize CPU usage, turn off **Onsets**, choose **Normal** or **Note Colors**, and set **Highlight** to **None**.
- **Pitch Resolution** - Selects vertical pitch detail without clearing history:
  - **1/12 Octave** (default): One row per semitone.
  - **High**: Places pitches at their estimated cent positions to show vibrato and pitch bends.
- **Layout** - **Horizontal** (default, keyboard at bottom, history scrolls up) or **Vertical** (keyboard at right, history scrolls left).
- **Volume** - Encodes relative volume in bar thickness and keyboard-edge semicircle meters (on by default). When off, bar thickness is fixed.
- **Onsets** - Marks estimated note attacks with triangles (▼ in Horizontal, ▶ in Vertical; off by default). The center of each triangle's base marks the attack time and pitch, so repeated attacks of a sustained pitch get separate marks. Turning it off does not stop instrument analysis while an Instrument **Color** or **Highlight** needs it.
- **Time Span** (1 to 10 s; default 2 s) - Duration of visible history on the piano roll.
- **Lowest Note** / **Highest Note** - Sets the analyzed and displayed pitch range (defaults: E1 to G6).

### Visualization Guide

- **Pitch Updates**: New sound appears immediately and is refined about 40, 80, and 160 ms later using subsequent audio context, without adding display latency or affecting **Sync Visuals to Audio**.
- **Grid & Keyboard**: Lines at each C mark octave boundaries, E–F guides remain visible in all modes, and black-key rows use a darker background. Piano keys light up with current pitch confidence.
- **Color Strength**: Color strength always shows pitch confidence. When the input is too quiet for analysis, the piano roll stays dark.
- **Instrument Colors & Highlight**: Instrument colors blend the group colors by their estimated probabilities. Colors appear at the corresponding positions in the history once the instrument estimate is ready; notes awaiting classification appear in neutral gray. The legend lists the shown groups, followed by **Highlight:** and the selected group while highlighting is active. Hover over any group in the legend to highlight it temporarily.
- **Volume Bars**: With **Volume** on, bar thickness spans a 24 dB relative range, and a soft semicircle at the keyboard edge rises immediately with the current volume and falls at 20 dB/s.

### Visual Display
- Hover over the history, or touch and drag on it, to read the note, time, **Salience** (pitch confidence), **Level** (dB), and—when instrument analysis is active—the estimated group probabilities: **Vocal**, **Bass**, and **Other** in **Instrument (3)**, the nine groups otherwise, plus the **Highlight** group when it is not among them (**Not classified** for notes without an estimate).

## Oscilloscope

Shows the shape of the sound wave in real time, so you can see beats, sharp hits, and changes in loudness while listening. Trigger settings steady the display when a waveform repeats.

### Usage Guide
- Set **Display Time** to 1–20 ms and **Trigger Mode** to **Auto** to inspect a repeating waveform cycle.
- Set **Display Time** to 1,000–10,000 ms and **Trigger Mode** to **Off** to follow beats and loudness envelopes scrolling smoothly from right to left.
- In **Auto** and **Normal** modes, the trace updates once the full **Display Time** interval has been collected.

### Parameters
- **Display Time** (1 to 10,000 ms) - Visible time span. Short values show individual waveform cycles; long values show overall envelope patterns.
- **Trigger Mode**:
  - **Auto**: Updates continuously even without a trigger event.
  - **Normal**: Updates only when a trigger occurs and holds the last capture until the next trigger.
  - **Off**: Scrolls continuously from right to left; trigger settings have no effect.
- **Trigger Level** (-1 to 1) - Normalized amplitude threshold that starts capture (detected from the mono or averaged L/R signal).
- **Trigger Edge** - **Rising** (triggers on upward crossing) or **Falling** (triggers on downward crossing).
- **Holdoff** (0.1 to 10 ms) - Minimum wait time between triggers.
- **Display Level** (-96 to 0 dB; default 0 dB) - Sets the level shown at the top and bottom edges of the display. 0 dB shows the full ±1 range; lower values zoom in on quieter signals.
- **Vertical Offset** (-1 to 1) - Shifts the waveform vertically; positive values move the waveform up.

### Visualization Guide
- **Horizontal axis**: Time in milliseconds or seconds.
- **Vertical axis**: Normalized amplitude, scaled by **Display Level** and shifted by **Vertical Offset**.
- **Line vs. Envelope Band**: Short display times draw a continuous waveform line; long display times draw a filled min/max band so brief peaks remain visible when many samples share a single pixel column.

### Visual Display
- Hover over the graph, or touch and drag on it, to read the time and amplitude (or Minimum/Maximum at long display times).

## Pitch Meter

Tracks one fundamental pitch (F0) at a time in a two-second scrolling piano roll without changing the audio. Use it to check the tuning and pitch movement of a solo voice or instrument.

### Listening Guide

- Play or sing a single sustained note and watch whether the trace stays centered on the note row or drifts sharp or flat.
- Vibrato, slides, and pitch bends appear as smooth curves across the note rows.
- Because Pitch Meter tracks a single dominant pitch, chords, dense mixes, or percussion can interrupt the trace or jump octaves; use [Note Spectrogram](#note-spectrogram) for polyphonic material.
- Stereo input is analyzed by averaging the first two channels (mono input is used directly), so a sound with opposite polarity in the two channels can cancel out and leave no trace.

### Parameters

- **Color** - Changes trace color without affecting detection: **Normal** (default theme trace color), **Heatmap** (relative volume over a 24 dB range), or **Note Colors** (pitch class colors).
- **Layout** - **Horizontal** (default, keyboard at bottom, history scrolls up) or **Vertical** (keyboard at right, history scrolls left).
- **Reference A4** (400 to 480 Hz; default 440 Hz) - Tuning reference used for note names and cent offsets.
- **Lowest Note** / **Highest Note** - Sets the analyzed and displayed pitch range (defaults: C2 to C7; full range: A0 to C8).

### Visualization Guide

- The trace position shows continuous pitch between semitones; higher confidence draws a brighter line, and silence or unpitched sound breaks the line.
- The readout displays the nearest note name (colored by pitch class) and the tuning offset in cents (`+` sharp, `-` flat; for example, `+3.5 cent`).

### Visual Display
- Hover over the display, or touch and drag on it, to read the values at that point.

## Rhythm Analyzer

Finds the tempo of your music and shows, beat by beat, where drum and instrument hits land and how early or late each part plays, without changing the sound unless **Metronome Click** is on. Use it to find a track's BPM, measure swing, see whether the snare sits behind the beat, or spot drum fills and section changes.

### Listening Guide

- **Check the tempo**: Play a track with a steady beat. Confirmed BPM and the **adopted** line appear about 1–2 seconds after the sound, while **LOCKED** indicates active beat ticks for the lamp and click. Compare **×½**, **×2**, and **strongest** if the analyzer locks to double or half the tempo you feel.
- **Hear where the beat falls**: Enable **Metronome Click** to hear a click on each detected beat. Place Rhythm Analyzer at the end of the effect chain while listening with the click, and turn **Metronome Click** off before exporting processed audio files.
- **Fix double- or half-tempo locks**: If a slow ballad locks at double tempo, lower **Max BPM** below that value; if a fast track locks at half tempo, raise **Min BPM** above it.
- **Read groove and micro-timing**: Programmed beats sit near the lane center with **jitter** near 0 ms. A snare consistently 15 ms behind the kick shows as **Mid** dots above the lane center on beats 2 and 4, and as a **+15** mark in the beat lens.
- **Read swing**: **swing** reports the off-beat delay ratio (1.00:1 is straight, 2.00:1 is a triplet shuffle). In swung grooves, off-beat hits cluster in the **⅔** column of the beat lens rather than **&**.
- **Spot fills and changes**: Rings (**◎**) highlight hits that were not played at the same beat position one or two cycles ago, making drum fills and section transitions stand out across the **Echo rows**.
- **When it shows searching**: New beat ticks and clicks stop, but analysis continues; tempo, lanes, and the beat lens stay visible and grow fainter as confidence falls. Silence clears the current beat readings and tempogram column; analysis starts again when sound returns.

### Parameters

- **Min BPM** (40 to 192; default 40) / **Max BPM** (50 to 240; default 240) - Tempo search range (Max BPM stays at least 1.25× Min BPM; changing either restarts analysis).
- **Metronome Click** (default off) - Mixes a short −10 dBFS click into channels 1 and 2 (channel 1 for mono) on each detected beat tick; other channels are unchanged.
- **Span (beats)** (4, 6, 8, 12, or 16; default 8) - Number of beats shown across the timing lanes and each echo row (e.g., 8 for two bars of 4/4, 6 for two bars of 3/4).
- **Tempogram**, **Timing lanes**, **Echo rows**, **Beat lens** - Show or hide individual display panels (Timing lanes and Beat lens start on; hiding a panel does not stop analysis).

### Visualization Guide

On a wide display the **Beat lens** sits to the right of the lanes; on a tall display all panels are stacked. Hits are separated into **High** (hi-hats, cymbals), **Mid** (snare, vocals, instruments), and **Low** (kick, bass) rows:
- **Header**: Shows the beat flash lamp (weaker at lower confidence, hollow during **searching**), confirmed BPM (**LOCKED** or **searching**), **×½**, **×2**, **strongest** tempogram candidate, **swing** ratio (from the last 32 beats), **jitter** (typical scatter of hits around their average position, in ms), and symbol legend. Values not yet available show —.
- **Tempogram**: 20-second history of tempo support, with **Time** running left to right and **Tempo (BPM)** from 30 to 480 on a logarithmic scale, overlaid with the solid **adopted** tempo line and dashed **×2** / **×½** lines. Brightness shows relative support for each tempo, not the probability that it is correct.
- **Timing lanes**: Shows hits over the last *N* beats (**Span (beats)**; caption **Last N beats**); a larger dot means a more certain hit, and the newest positions are estimates that settle about 1–2 seconds later. Vertical stem height shows micro-timing relative to the nearest 16th-note or triplet grid, compared with the typical timing of the preceding 16 beats (**+20** / **−20** ms dotted guides; above center = late, below = early; hits beyond ±30 ms stay at the lane edge). Hollow circles (**○**) are hits whose timing is unavailable (drawn at the lane center), shaded areas mark periods without timing analysis, rings (**◎**) mark new hits compared with 1–2 cycles ago, and dashed vertical lines mark beat-grid re-alignments.
- **Echo rows**: Stacks previous *N*-beat cycles vertically, newest on top, so repeating bar patterns align in columns and fills or variations stand out. **Cycles ago** numbers the rows from 1; with **Timing lanes** hidden, the top row is the current cycle (0). Each hit shows its band but not its timing.
- **Beat lens**: Summarizes, for each band, how early (mark to the left) or late (mark to the right) it plays on average (±30 ms scale) and its scatter (shaded bar, ± one standard deviation) across beat subdivisions (**1**, **e**, **&**, **a**, **⅓**, **⅔**) over the last 32 confirmed beats. Offsets are relative to the whole ensemble, a more opaque mark means the position is played more often, positions need at least four hits to appear, and offsets of 3 ms or more are labelled. Until beat analysis is available, the lens shows **waiting for a steady beat**.
- **Confidence**: Dimmer readings mean less confidence in the analysis, not looser playing.
- **Reset**: The **Reset** button below the display clears it and restarts the analysis, for example when another app switches tracks. When EffeTune's player starts a new track, the analysis restarts automatically.

### Visual Display
- Hover over the display, or touch and drag, to read values: beats ago, band, and timing of the nearest hit in the lanes and echo rows (— when unavailable); tempo, **Tempo support**, and **Adopted** tempo in the tempogram; and each band's offset and scatter in the beat lens.

### Limitations

- Tempo and beat tracking are less certain on rubato, classical music, solo piano, or ambient/beatless passages, and the beat may lock at twice, half, two-thirds, or one and a half times the tempo you feel, or on the off-beat (use **Min BPM** / **Max BPM** to constrain the range). **LOCKED** does not guarantee a correct beat.
- When the tempo changes continuously, the beat follows with a short delay, so the click can run slightly early or late.
- In dense mixes and noisy recordings, the **Mid** and **High** lanes can show extra dots, and the **Low** lane misses some low piano notes.
- The analyzer tracks beats rather than bar lines or time signatures (it does not identify beat 1).
- Supported sample rates: 8, 11.025, 16, 22.05, 24, 32, 44.1, 48, 88.2, 96, 176.4, 192, 352.8, and 384 kHz. At other rates, audio passes through unchanged, but analysis and clicks are unavailable.

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

## Fun Ways to Use These Tools

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

Remember: These tools are meant to enhance your enjoyment of music by adding a visual dimension to your listening experience. Have fun exploring and discovering new ways to see your favorite music!
