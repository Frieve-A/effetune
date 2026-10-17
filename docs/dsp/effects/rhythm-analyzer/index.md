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

### Limitations

- Tempo and beat tracking are less certain on rubato, classical music, solo piano, or ambient/beatless passages, and the beat may lock at twice, half, two-thirds, or one and a half times the tempo you feel, or on the off-beat (use **Min BPM** / **Max BPM** to constrain the range). **LOCKED** does not guarantee a correct beat.
- When the tempo changes continuously, the beat follows with a short delay, so the click can run slightly early or late.
- In dense mixes and noisy recordings, the **Mid** and **High** lanes can show extra dots, and the **Low** lane misses some low piano notes.
- The analyzer tracks beats rather than bar lines or time signatures (it does not identify beat 1).
- Supported sample rates: 8, 11.025, 16, 22.05, 24, 32, 44.1, 48, 88.2, 96, 176.4, 192, 352.8, and 384 kHz. At other rates, audio passes through unchanged, but analysis and clicks are unavailable.

[Back to all effects](/dsp/effects/)
