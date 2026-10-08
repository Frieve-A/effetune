---
layout: dsp
title: "Rhythm Analyzer — EffeTune DSP"
description: "Passes audio through while exposing detected tempo, a per-cycle beat raster of hits, swing, and per-band timing offsets."
lang: en
permalink: /dsp/effects/rhythm-analyzer/
---
# Rhythm Analyzer

Semantic type: `RhythmAnalyzer` · Category: analyzer

Passes audio through while exposing detected tempo, a per-cycle beat raster of hits, swing, and per-band timing offsets.

Use the opt-in decoded telemetry callback or subscription API to observe this effect. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **decoded semantic observations are available**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `minimumBpm` | `minimum_bpm` | number / 1 | `40` | Not declared in catalog | 40 … 192 |
| `maximumBpm` | `maximum_bpm` | number / 1 | `240` | Not declared in catalog | 50 … 240 |
| `metronomeClick` | `metronome_click` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

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

### Limitations

- Accuracy can be lower with large tempo fluctuations, sparse rhythm, acoustic performances, or solo piano. Ambient sound, noise, and sustained tones can produce incorrect beat ticks; **LOCKED** is not a guarantee of a correct beat. Compare the click with the rhythm you hear and turn it off when it is unhelpful.
- The analyzer can settle on a different beat level than a listener would choose, so the lamp and the click may run at twice, half, two-thirds, or one and a half times the tempo you feel. On classical music, music played with rubato, and some other music, it also takes longer to lock and jumps briefly to another level more often than on music with a steady beat. **×½**, **×2**, and **strongest** show likely alternative tempos. If the detected tempo or beat position seems wrong, try narrowing **Min BPM** and **Max BPM** around the expected tempo and listen again.
- With sparse, clave-like rhythm patterns, the beat can lock on the off-beat.
- When the tempo changes continuously, as in a gradual speed-up or free rubato, the beat follows with a short delay, so the click can run slightly early or late until the tempo settles.
- On some steady tracks the beat position is occasionally re-aligned, shown by the dashed line, even though the music did not change.
- In dense mixes and noisy recordings, the **Mid** and **High** lanes show more dots where no instrument actually struck. The **Low** lane misses some low piano notes.
- There is no bar or meter detection: the display is organized by beats only and does not show where a bar starts.
- Analysis is available at 8, 11.025, 16, 22.05, 24, 32, 44.1, 48, 88.2, 96, 176.4, 192, 352.8, and 384 kHz. At other rates, such as 64 kHz, audio still passes through but rhythm analysis and clicks are unavailable. Choose a supported sample rate to use them.

[Back to all effects](/dsp/effects/)
