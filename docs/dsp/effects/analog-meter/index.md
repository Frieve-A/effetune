---
layout: dsp
title: "Analog Meter — EffeTune DSP"
description: "Passes audio through while exposing ballistic needle levels and, in Loudness mode, program loudness, loudness range, and true peak."
lang: en
permalink: /dsp/effects/analog-meter/
---
# Analog Meter

Semantic type: `AnalogMeter` · Category: analyzer

Passes audio through while exposing ballistic needle levels and, in Loudness mode, program loudness, loudness range, and true peak.

Use the opt-in decoded telemetry callback or subscription API to observe this effect. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **decoded semantic observations are available**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `mode` | `mode` | string / 1 | `"VU"` | Not declared in catalog | `VU`, `PPM`, `RMS`, `Sample Peak`, `True Peak`, `Loudness` |
| `integration` | `integration` | number / 1 | `0.3` | s | 0.05 … 3 |
| `attack` | `attack` | number / 1 | `5` | ms | 1 … 20 |
| `release` | `release` | number / 1 | `1.5` | s | 0.1 … 5 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

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

[Back to all effects](/dsp/effects/)
