---
layout: dsp
title: "Tonal Balance EQ — EffeTune DSP"
description: "Measures the long-term spectrum and gently corrects it toward the typical tonal balance of released music. An averaging time of 100 s means no time limit: the measurement averages everything since creation or reset."
lang: en
permalink: /dsp/effects/tonal-balance-eq/
---
# Tonal Balance EQ

Semantic type: `TonalBalanceEQ` · Category: eq

Measures the long-term spectrum and gently corrects it toward the typical tonal balance of released music. An averaging time of 100 s means no time limit: the measurement averages everything since creation or reset.

Use the opt-in decoded telemetry callback or subscription API to observe this effect. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **decoded semantic observations are available**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `target` | `target` | string / 1 | `"All"` | Not declared in catalog | `All`, `Classical`, `Electronic`, `Pop`, `Rock`, `Tilt` |
| `amount` | `amount` | number / 1 | `100` | % | 0 … 100 |
| `range` | `range` | number / 1 | `6` | dB | 0 … 12 |
| `smoothing` | `smoothing` | number / 1 | `0.5` | oct | 0.1667 … 2 |
| `averagingTime` | `averaging_time` | number / 1 | `30` | s | 0.1 … 100 |
| `low` | `low` | number / 1 | `20` | Hz | 20 … 200 |
| `high` | `high` | number / 1 | `16000` | Hz | 2000 … 20000 |
| `averageSpl` | `average_spl` | number / 1 | `83` | dB | 60 … 96 |
| `adjustEnabled` | `adjust_enabled` | boolean / 5 | `[true,true,true,true,true]` | Not declared in catalog | Not declared in catalog |
| `adjustType` | `adjust_type` | string / 5 | `["pk","pk","pk","pk","pk"]` | Not declared in catalog | `pk`, `ls`, `hs` |
| `adjustFrequency` | `adjust_frequency` | number / 5 | `[100,316,1000,3160,10000]` | Hz | 20 … 20000 |
| `adjustGain` | `adjust_gain` | number / 5 | `[0,0,0,0,0]` | dB | -20 … 20 |
| `adjustQ` | `adjust_q` | number / 5 | `[0.7,0.7,0.7,0.7,0.7]` | Not declared in catalog | 0.1 … 10 |
| `tiltSlope` | `tilt_slope` | number / 1 | `-6` | dB/oct | -18 … 0 |
| `tiltCorner` | `tilt_corner` | number / 1 | `250` | Hz | 20 … 1000 |
| `measurementPaused` | `measurement_paused` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Tonal Balance EQ

Measures the long-term tonal balance of whatever is playing and gradually corrects it toward the typical balance of released music in a chosen style. Use it when recordings, playlists, or streams sound consistently too dark, too bright, too boomy, or too thin, and you want them evened out without adjusting an EQ by hand for each one. It corrects the recording, not your speakers or room; use Room EQ for those.

The plugin compares the measured spectrum with the target after lining up their overall levels, so only the shape of the balance matters, not how loud the recording is. It reduces the regions that are too strong and then raises the whole signal by one make-up gain, so the loudness stays the same and the weaker regions come forward. It does not raise regions that hold no real music content, such as the empty top of a band-limited recording or steady hiss; a steady, noise-like sound such as an unchanging synth pad is treated the same way, and so is a sound that keeps playing at the same level through the quiet breaks, because it cannot be told apart from background noise. Silence and quiet breaks do not count toward the measurement. All channels receive the same correction, so the stereo image is unchanged, and the plugin adds no delay.

The style targets are learned from the long-term spectra of a permissively licensed music collection. Each style has a typical curve and a typical spread between tracks. **Tilt** is a fixed reference instead: flat in the bass, then falling at a set slope. Any target can be reshaped to your taste with the five Target Adjust bands.

### Sound Enhancement Guide
- **Mixed playlists and streaming**: Start with the defaults (Target **All**, Amount 100%, Averaging Time 30 s). The correction fades in over tens of seconds as the measurement becomes reliable, so compare with the plugin turned off after about half a minute of music.
- **One steady correction for an album**: Press **Reset** when the album starts and set Averaging Time to **∞**. The plugin then averages everything it has heard since the Reset, so the correction settles and changes less and less.
- **Music of one style**: Choose the Target closest to what you are playing, such as **Classical** for orchestral recordings or **Electronic** for dance music. All is a good choice when styles are mixed.
- **A gentler result**: Lower Amount to about 50% or Range to about 3 dB. For only broad tilts without narrower shaping, raise Smoothing to about 1 oct.
- **Following changes within a song**: Shorten Averaging Time to about 0.5 to 1 s so a dark verse and a bright chorus are each corrected. If you hear the tone moving, lengthen it again.
- **Leaving the extremes alone**: Raise Low so the deep bass is not reshaped, or lower High so the top octave is not reshaped.
- **Your own house curve**: Shape the target with Target Adjust. For example, a High shelf of +1.5 dB at 8 kHz with Q 0.7 asks for a slightly brighter balance, and a broad Peak of -2 dB around 300 Hz with Q 0.7 asks for less low-mid weight. Each recording is then corrected toward that shape only as far as it needs, instead of every recording receiving the same EQ.
- **A mechanical reference**: Choose Target **Tilt**. The default Slope of -6 dB/oct asks for a balance slightly darker than most released music; set Slope to about -4.5 to -5 dB/oct for a more typical balance, or to -3 dB/oct, the pink-noise reference, for a brighter one.

The make-up gain keeps the loudness, not the peak level, so peaks can rise. If a later stage clips, lower the level after this plugin or add a limiter.

### Parameters
- **Target** - The tonal balance that is the goal: **All**, **Classical**, **Electronic**, **Pop**, **Rock**, or **Tilt** (default All)
  - All is an equal-weight mixture of the four styles
  - Tilt is a fixed reference, not a learned style: flat below Corner, then falling at Slope
- **Slope** - Shown only while Target is Tilt. How steeply the target falls above Corner (-18 dB/oct to 0 dB/oct, default -6 dB/oct)
  - -3 dB/oct is pink noise, which has equal energy in every octave; 0 dB/oct is white noise and -6 dB/oct is brown noise
  - Typical commercial recordings average roughly -5 dB/oct (Pestana et al.), so the default asks for a slightly darker balance than typical music. A shallower Slope asks for more treble; steeper (more negative) settings tilt the balance further toward the bass
- **Corner** - Shown only while Target is Tilt. The frequency below which the target stays flat (20 Hz to 1000 Hz, default 250 Hz)
  - Lower values continue the slope further into the deep bass, asking for more deep bass
  - Higher values keep more of the bass flat, asking for less bass
- **Amount** - How much of the correction is applied (0% to 100%, default 100%)
  - Lower values scale the whole correction down; at 0% the sound is unchanged
  - At 0% the measurement and the graph keep running, and Range, Smoothing, Low, and High are disabled
- **Range** - The largest correction any band can receive, up or down (0 dB to 12 dB, default 6 dB)
  - Lower values keep changes subtle; 0 dB turns the correction off
  - Higher values let recordings that are far from the target move closer to it
- **Smoothing** - How wide the features of the correction curve are (0.1667 oct to 2 oct, default 0.5 oct)
  - Higher values give broad, gentle tilts
  - Lower values follow the target more closely, including narrower peaks and dips
- **Averaging Time** - How long the measurement averages (0.1 s to ∞, default 30 s)
  - Short values make the tone follow changes within a song
  - Long values give a steady correction that changes slowly between songs
  - The right end of the slider is **∞**: the plugin averages everything since the last Reset. You can also type ∞ in the value box
- **Low** - The lower edge of the corrected range (20 Hz to 200 Hz, default 20 Hz)
  - Below it, the correction stays at the value it has at Low
  - Raise it so the deep bass is not reshaped
- **High** - The upper edge of the corrected range (2000 Hz to 20000 Hz, default 16000 Hz)
  - Above it, the correction stays at the value it has at High
  - Lower it so the top octave is not reshaped
- **Average SPL** - Your estimated average listening level at the listening position, as in Loudness Equalizer (60 dB to 96 dB, default 83 dB)
  - It only decides which quiet bands are loud enough to hear and may therefore be raised; it does not change the output level
  - Lower values treat more faint bands as inaudible, so they are not raised
  - Higher values count more faint bands as audible content
- **Target Adjust** - Five bands below the graph that reshape the target, with the same controls as Room EQ's Additional EQ and 5Band PEQ
  - Each band can be turned on or off and set to Peak, Low shelf, or High shelf
  - Frequency: 20 Hz to 20 kHz (defaults 100 Hz, 316 Hz, 1 kHz, 3.16 kHz, and 10 kHz)
  - Gain: -20 dB to +20 dB (default 0 dB). Positive values ask for more of that region, negative values for less; 0 dB leaves the target unchanged
  - Q: 0.1 to 10, limited to 2 for shelves (default 0.7). Higher values affect a narrower range

Target Adjust changes only the target. The plugin still measures each recording and corrects it toward the adjusted target with the same Amount, Range, Smoothing, Low, and High; it is not an extra EQ applied on top. Lifting the whole target by the same amount therefore changes nothing, because overall levels are lined up before the comparison and the loudness stays matched. Regions with no real music content are still not raised, and below Low and above High the correction is held as usual. The target is followed in hearing-sized bands and then smoothed, so a narrow peak or notch is spread out and comes out smaller, as the graph shows; use 5Band PEQ for narrow fixes. Range still limits the correction in every band, so a large adjustment may need a larger Range.

[Back to all effects](/dsp/effects/)
