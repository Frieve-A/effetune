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

- **Check the tempo**: Play a track with a clear, steady beat. After a few seconds the header shows the BPM with **LOCKED**, and the tempogram strip marks the same tempo as **adopted**. The analyzer sometimes follows a different beat level than the one you tap your foot to, so also look at **×½**, **×2**, and **strongest** in the header: if one of them matches your foot, that is the tempo you feel.
- **Hear where the beat falls**: Turn on **Metronome Click** to hear a click on each detected beat. If the clicks fall on the beat you tap your foot to, the analyzer has found the beat. If they fall between your taps, or at twice or half your tapping speed, the analyzer is following a different beat position or level; see **Fix a lock at double or half speed** below and **Limitations**.
- **Place it last when using the click**: The click is mixed into the audio that leaves the analyzer, so any effect after it also processes the click. Put Rhythm Analyzer at the end of the effect chain while you listen with the click.
- **Turn the click off before processing files**: With **Metronome Click** on, the clicks are written into any file you process. Turn it off first.
- **Fix a lock at double or half speed**: If a slow ballad locks at twice its tempo, lower **Max BPM** below that value (for example, to 100 for a 60 BPM ballad). If a fast track locks at half speed, raise **Min BPM** above that value. The analysis starts over with the new range.
- **Read a steady groove**: With programmed music or music played to a click, the dots sit close to the center of their lanes, and **jitter** stays near 0 ms. When one part plays consistently behind or ahead of the others, its dots sit above or below the lane center at the same positions every time. A snare that is 15 ms behind the kick and hi-hat, for example, shows as Mid dots raised above the lane center on beats 2 and 4, and as a Mid mark labelled +15 in the **1** column of the beat lens.
- **Read the swing**: **swing** shows how far the off-beat is delayed: 1.00:1 is straight, 2.00:1 is a full triplet shuffle, and values in between are a lighter swing. In clearly swung music, the beat lens places off-beat hits in the **⅔** column instead of **&**.
- **Spot fills and section changes**: A ring marks a hit that the same band did not play at the same position one or two spans earlier. While a pattern repeats, few rings appear; a fill or the first bars of a new section show many. The echo rows below the main lanes let you compare the new pattern with the previous ones.
- **When it shows searching**: While the beat is unclear, the header shows **searching** with the last locked tempo in parentheses, the lanes keep scrolling at that tempo inside a shaded band, and hits are drawn as hollow circles without timing. The analyzer locks once it has been sure of the beat for a full beat. With a clear, steady beat this takes a few seconds; classical music and music played with rubato can take longer. When the music stops, the analyzer stops showing the beat within half a second and locks again after the music returns.

### Parameters

- **Min BPM** (40 to 192; default 40) - Sets the lowest tempo the analyzer can lock to. Raise it when the analyzer locks to half of the tempo you feel.
- **Max BPM** (50 to 240; default 240) - Sets the highest tempo the analyzer can lock to. Lower it when the analyzer locks to double the tempo you feel. The analyzer locks only to tempos between Min BPM and Max BPM, but the tempo shown can drift slightly outside it when the music speeds up or slows down. Max BPM is always kept at least 1.25 times Min BPM; when a change would break this, the other limit moves. Changing either limit starts the analysis over. The tempogram strip always covers 30 to 480 BPM, and the **×½** and **×2** lines can fall outside the selected range.
- **Metronome Click** (on or off; default off) - Adds a short, high-pitched click on each detected beat to the audio that passes through. Clicks play only while the analyzer is locked and stop when it returns to **searching**. The click has a fixed level of about −10 dBFS and is added to channels 1 and 2 (channel 1 for mono input); other channels are not changed. When it is off, the audio passes through unchanged. Turning it on or off does not restart the analysis.
- **Span (beats)** (4, 6, 8, 12, or 16; default 8) - Sets how many beats the main lanes and each echo row show, and how far back the rings compare. It changes only the display, not the analysis. A span that covers whole bars lines up a repeating pattern across the echo rows, for example 8 for two bars of 4/4 or 6 for two bars of 3/4.
- **Tempogram**, **Timing lanes**, **Echo rows**, **Beat lens** (on or off; default on) - Show or hide the tempogram strip, the main lanes, the echo rows, and the beat lens. The remaining panels grow to fill the space, and the header is always shown. Hiding a panel changes only the display: the analysis continues, and the panel shows its full history again when you turn it back on.

### Visualization Guide

The display has five parts: the header, the tempogram strip, the main lanes, the echo rows, and the beat lens. On a wide display the beat lens sits to the right of the lanes; on a tall display all parts are stacked from top to bottom. When you hide panels with their checkboxes, the remaining panels fill the space; the header always stays. Hits are sorted into three bands: **Low** (kick drum and bass), **Mid** (snare, voices, and most instruments), and **High** (hi-hats and cymbals). All bands share one color; in the lanes, echo rows, and beat lens each band has its own row, with **High** at the top and **Low** at the bottom. Axis names, tick values, and the **High**, **Mid**, and **Low** row labels are drawn over the graphs. The display counts beats only; it does not detect bars or beat 1.

- **Header**:
  - The beat lamp to the left of the BPM lights on each beat the analyzer predicts and then fades quickly, so you can see the beat it follows; **Metronome Click** plays on the same beats. Every beat lights the same way, because the analyzer does not know where a bar starts. While the analyzer is searching, the lamp is a hollow ring.
  - The BPM and **LOCKED** while the analyzer follows a beat. While it has not found one, it shows **searching**, with the last locked tempo as **(N BPM held)**.
  - **×½** and **×2** - Half and double the tempo shown.
  - **strongest** - The tempo that currently repeats most strongly in the music. It often matches the locked tempo; when it differs, it is a likely alternative.
  - **swing** - The ratio between the first and second half of a beat, from the typical off-beat position in the last 32 beats. 1.00:1 is straight and 2.00:1 is a triplet shuffle.
  - **jitter** - The typical random scatter of hits around their average position in the beat lens, in ms. Tight, programmed parts read near 0; loose playing reads higher.
  - A key to the symbols: **○ no beat lock**, **◎ new vs N / 2N beats ago**, and **beat re-aligned** for the dashed line.
  - A value that is not available yet shows —.
- **Tempogram strip**: Shows the last 20 seconds, with **Time** running left to right and **Tempo (BPM)** on a logarithmic scale from 30 to 480, its values at the left edge. The brightness shows how clearly the music repeats at each tempo: only clear, strong repetition is drawn bright, weak or unclear repetition stays dim, and silence stays dark. Related tempos, such as half and double the beat, often appear as fainter lines. While the analyzer is locked, a solid line shows the locked tempo, and dashed lines show half and double of it; their labels **adopted**, **×2**, and **×½** sit at the right edge, just above the lines. These lines grow fainter when the analyzer is less certain of the beat.
- **Main lanes**: The most recent beats, as many as **Span (beats)** sets, with the newest at the right edge; the caption reads **Last N beats**. Solid lines divide them into three timing graphs, one lane per band, each labelled at the left edge, with **Beats** on the horizontal axis and **Timing (ms)** on the vertical axis. Vertical lines mark the beats, and fainter lines the eighth notes; they are drawn only where the analyzer was locked. Each dot is one detected hit, joined to the lane center by a stem; the larger the dot, the more certain the analyzer is of that hit.
  - The height of a dot in its lane shows its timing: above the lane center (0 ms) is late, below is early. Dotted lines labelled **+20** and **−20** mark ±20 ms, and hits beyond ±30 ms stay at the lane edge. Timing is measured from the nearest sixteenth-note or triplet position, whichever grid the music follows, and is shown relative to the typical timing of the preceding 16 beats. A constant delay shared by all parts therefore does not show; the lanes show how each hit differs from the recent average.
  - A hollow circle is a hit without a beat lock. It sits at the lane center because it has no timing.
  - A ring around a dot marks a hit that the same band did not play at the same position one or two spans earlier. Rings appear from one span after a lock or re-alignment.
  - A shaded band labelled **searching** marks the time without a beat lock.
  - A dashed line marks where the beat grid was re-aligned without losing the lock, when the analyzer switched to a new tempo or shifted the beat position. The beat lens, swing, and jitter start over from there.
- **Echo rows**: Cycles of as many beats as **Span (beats)** sets, stacked with the newest on top and separated by lines. The horizontal axis is **Beats**, and the vertical axis, **Cycles ago**, numbers each row. While the main lanes are shown, the rows start one cycle back, at 1, and the caption reads **Previous N-beat cycles**. With the main lanes hidden, the top row is the current cycle, at 0, the caption reads **Recent N-beat cycles**, and the top row carries the band labels when it has room. Because beats line up vertically, a pattern that repeats every cycle forms vertical columns, and a change breaks them. The echo rows show the band of each hit, **High** at the top of a row and **Low** at the bottom, but not its timing. Hollow circles, rings, shading, and dashed lines have the same meaning as in the main lanes.
- **Beat lens**: Summarizes the timing of the last 32 beats since the current lock or re-alignment. The columns are positions within one beat, along the **Position in beat** axis: **1** (on the beat), **e**, **&**, and **a** for sixteenth notes, and **⅓** and **⅔** for triplets. Each band has its own row, labelled at the left edge.
  - The vertical mark shows how early (left) or late (right) that band plays at that position on average. The scale at the top covers ±30 ms, with ticks at ±20 ms. The shaded bar around the mark shows the scatter (± one standard deviation). A more opaque mark means the position is played more often; a position needs at least four hits to appear.
  - As values update, the marks and bar widths move smoothly toward the new values, slowing as they approach them.
  - Offsets are measured relative to the ensemble as a whole, so if everything plays together, every mark sits at the center. The lens shows how the parts differ from one another.
  - Offsets of 3 ms or more are labelled in ms. Smaller offsets are drawn without a label, because timing differences between bands below about 3 ms cannot be measured reliably.
  - While the analyzer is not locked, the lens shows **waiting for a steady beat**.
- **LOCKED** and the opacity of the tempo lines show how certain the analyzer is of the beat. They do not show how tightly the music is played; timing looseness is shown only by the dot heights, **jitter**, and the lens bars.
- The **Reset** button clears the display and starts the analysis over, for example when you switch to a different track.
- Stereo input is analyzed by averaging the first two channels; mono input is used directly.

### Limitations

- Accuracy may be lower on tracks with large tempo fluctuations, tracks without a rhythm section, and acoustic performances. Quiet music played in free tempo without percussion, ambient music, and sustained tones stay in **searching**. Some expressive recordings, such as solo piano or classical performances, never lock.
- The analyzer can settle on a different beat level than a listener would choose, so the lamp and the click may run at twice, half, two-thirds, or one and a half times the tempo you feel. On classical music, music played with rubato, and some other music, it also takes longer to lock and jumps briefly to another level more often than on music with a steady beat. **×½**, **×2**, and **strongest** show likely alternative tempos. If the detected tempo or beat position seems wrong, try narrowing **Min BPM** and **Max BPM** around the expected tempo and listen again.
- With sparse, clave-like rhythm patterns, the beat can lock on the off-beat.
- When the tempo changes continuously, as in a gradual speed-up or free rubato, the beat follows with a short delay, so the click can run slightly early or late until the tempo settles.
- On some steady tracks the beat position is occasionally re-aligned, shown by the dashed line, even though the music did not change.
- In dense mixes and noisy recordings, the **Mid** and **High** lanes show more dots where no instrument actually struck. The **Low** lane misses some low piano notes.
- There is no bar or meter detection: the display is organized by beats only and does not show where a bar starts.
- The full analysis runs at 8, 11.025, 16, 22.05, 24, 32, 44.1, 48, 88.2, 96, 176.4, 192, 352.8, and 384 kHz. At any other sample rate, such as 64 kHz, the analyzer uses a simpler method: the beat and the hits are less accurate, and after the music stops, the beat stays on display for several seconds.

[Back to all effects](/dsp/effects/)
