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

Measures the long-term tonal balance of whatever is playing and gently steers it toward the typical spectral balance of released music in a chosen style. Use it when tracks across a playlist, album, or stream sound consistently too dark, too bright, too boomy, or too thin, and you want them evened out automatically without adjusting an EQ by hand for every track. (It corrects the recording's balance rather than your speakers or room; use [Room EQ](/dsp/effects/room-eq/) for acoustic correction.)

The plugin compares the measured spectrum with the target after aligning overall loudness, attenuates overly strong regions, and applies a single make-up gain so weaker regions come forward without changing perceived loudness. It excludes silence and pauses from the measurement and withholds lift on hiss and on steady, noise-like bands (including a sustained synth pad), so empty frequency extremes are not artificially boosted. All channels receive the same zero-latency correction, preserving the stereo image.

### Sound Enhancement Guide
- **Mixed playlists and streaming**: Start with the defaults (**Target: All**, **Amount: 100%**, **Averaging Time: 30 s**). The correction builds up over tens of seconds as the measurement becomes reliable, so let the music play for about 30 seconds before comparing with bypass.
- **One steady correction for an album**: Click **Reset** at the start of the album and set **Averaging Time** to **∞** so the correction averages the entire playback session and settles into a fixed curve.
- **Genre-specific targets**: Choose **Classical**, **Electronic**, **Pop**, or **Rock** to match a specific style, or **All** for mixed listening.
- **Gentler shaping**: Lower **Amount** (e.g., 50%), reduce **Range** (e.g., 3 dB), or raise **Smoothing** (e.g., 1 oct) for broad, subtle tilts.
- **Custom house curve**: Use the five **Target Adjust** bands below the graph to tilt or shape the target to your taste (for example, +1.5 dB High shelf at 8 kHz). Each recording is then corrected toward your custom target only as much as needed.
- **Fixed slope reference**: Select **Target: Tilt** for a flat response below **Corner** followed by a constant roll-off **Slope** (−5 dB/oct approximates typical commercial masters; −3 dB/oct matches pink noise).

The make-up gain keeps loudness, not peak level, so peaks can rise; if a later stage clips, lower the level after this plugin or add a limiter.

### Parameters
- **Target** - Goal tonal balance: **All** (default equal mix of the four styles), **Classical**, **Electronic**, **Pop**, **Rock**, or **Tilt** (fixed slope reference).
- **Slope** (-18 to 0 dB/oct; default -6 dB/oct; Tilt mode only) - Roll-off rate above **Corner** (-3 dB/oct = pink noise, ~-5 dB/oct = typical commercial releases). Shallower values ask for more treble; the default asks for a slightly darker balance than typical music.
- **Corner** (20 to 1000 Hz; default 250 Hz; Tilt mode only) - Frequency below which the **Tilt** target remains flat. Lower values ask for more deep bass; higher values ask for less bass.
- **Amount** (0% to 100%; default 100%) - Overall correction strength. At 0% the sound is unchanged, but the measurement and graph keep running, and **Range**, **Smoothing**, **Low**, and **High** are disabled.
- **Range** (0 to 12 dB; default 6 dB) - Maximum gain adjustment allowed in any band, up or down. Lower values keep changes subtle (0 dB turns the correction off); higher values let recordings far from the target move closer to it.
- **Smoothing** (0.1667 to 2 oct; default 0.5 oct) - Width of the correction curve features (higher values produce broader tilts).
- **Averaging Time** (0.1 s to ∞; default 30 s) - Measurement integration window. Short values (e.g., 0.5 to 1 s) follow changes within a song, such as a dark verse and a bright chorus; long values give a steady correction (**∞** averages continuously since the last **Reset**).
- **Low** (20 to 200 Hz; default 20 Hz) / **High** (2000 to 20000 Hz; default 16000 Hz) - Lower and upper frequency bounds of active reshaping (outside these bounds, correction holds constant). Raise **Low** to leave the deep bass alone, or lower **High** to leave the top octave alone.
- **Average SPL** (60 to 96 dB; default 83 dB) - Estimated listening level used to determine which quiet frequency bands are audible enough to be lifted; it does not change the output level. Lower values treat more faint bands as inaudible, so they are not lifted; higher values count more of them as audible.
- **Target Adjust** - Five parametric bands (Peak, Low shelf, High shelf; 20 Hz–20 kHz, ±20 dB, Q 0.1–10, up to 2 for shelves; default Q 0.7) that reshape the target curve. Positive gain asks for more of that region, negative gain for less.

**Target Adjust** changes only the target; each recording is still corrected toward it within **Amount** and **Range**, so a larger adjustment may need a larger **Range**. Raising the whole target by the same amount changes nothing, because overall levels are aligned before comparison. Narrow peaks and dips are smoothed out; use 5Band PEQ for narrow fixes.

[Back to all effects](/dsp/effects/)
