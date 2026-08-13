---
layout: dsp
title: "AM Radio Simulator — EffeTune DSP"
description: "Models bandwidth, distortion, interference, and noise associated with AM radio."
lang: en
permalink: /dsp/effects/am-radio-simulator/
---
# AM Radio Simulator

Semantic type: `AMRadioSimulator` · Category: lo-fi

Models bandwidth, distortion, interference, and noise associated with AM radio.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `radio` | `radio` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |
| `txBandwidth` | `tx_bandwidth` | number / 1 | `6` | kHz | 2 … 10 |
| `preEmphasis` | `pre_emphasis` | number / 1 | `50` | % | 0 … 100 |
| `modDepth` | `mod_depth` | number / 1 | `90` | % | 10 … 125 |
| `compression` | `compression` | number / 1 | `6` | dB | 0 … 20 |
| `stereoMode` | `stereo_mode` | string / 1 | `"Mono"` | Not declared in catalog | `Mono`, `C-QUAM` |
| `signal` | `signal` | number / 1 | `-12` | dB | -50 … 0 |
| `skywave` | `skywave` | number / 1 | `1` | % | 0 … 100 |
| `fadingSpeed` | `fading_speed` | number / 1 | `0.15` | Hz | 0.05 … 2 |
| `staticRate` | `static_rate` | number / 1 | `0.3` | /s | 0 … 100 |
| `interference` | `interference` | number / 1 | `-65` | dB | -80 … 0 |
| `interferenceOffset` | `interference_offset` | number / 1 | `9` | kHz | 5 … 10 |
| `tuning` | `tuning` | number / 1 | `0` | kHz | -30 … 30 |
| `ifBandwidth` | `if_bandwidth` | number / 1 | `12` | kHz | 2 … 20 |
| `agcSpeed` | `agc_speed` | string / 1 | `"Fast"` | Not declared in catalog | `Slow`, `Mid`, `Fast` |
| `detectorRc` | `detector_rc` | number / 1 | `50` | us | 20 … 500 |
| `hum` | `hum` | number / 1 | `-70` | dB | -80 … -20 |
| `humFrequency` | `hum_frequency` | string / 1 | `"50"` | Not declared in catalog | `50`, `60` |
| `speaker` | `speaker` | string / 1 | `"Table"` | Not declared in catalog | `Off`, `Small`, `Table` |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 24 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## AM Radio Simulator

AM Radio Simulator transforms the music through a modeled AM broadcast chain: transmitter processing and modulation, groundwave and skywave propagation, static and adjacent-channel interference, receiver tuning and detection, AGC, and an optional radio speaker. Use it to compare a strong local station with a fading nighttime signal, explore a crowded dial, or give music the bandwidth, distortion, fading, and interference of AM reception.

This effect requires an environment that supports its real-time processing. When that processing is unavailable, the audio remains unchanged and the HUD reports that the effect is unavailable.

### How It Differs from Additive Lo-Fi Effects

- **AM Radio Simulator** changes the input signal by modulating, propagating, filtering, and detecting it. Its static, interference, and hum enter at modeled points in the radio chain, so they interact with tuning, the IF filter, and AGC.
- **Noise Blender** adds a general background noise texture, while **Hum Generator** adds a controllable hum layer. Choose them when you want those sounds without changing the music through a radio receiver.
- **Vinyl Artifacts** adds record-style surface noise without changing the original music signal. **Vinyl Simulator** is another signal-transforming physical model, but it models a record groove and stylus rather than radio transmission.

### Sound Enhancement Guide

- **Clear local broadcast:** Use a strong Signal, little Skywave and Static, centered Tuning, and a wider IF Bandwidth. Select Table for a fuller radio-speaker response or Off for line output.
- **Nighttime distant station:** Lower Signal, raise Skywave, and use a moderate Fading Speed. Slow AGC makes level recovery more gradual, while Static adds occasional lightning-like bursts.
- **Crowded dial:** Raise Interference and set Interf. Offset to 9 or 10 kHz. Narrow IF Bandwidth rejects more of the adjacent station; small Tuning changes alter how much reaches the detector.
- **Broadcast overload:** Raise Mod Depth above 100% or lengthen Detector RC to hear AM-specific overmodulation and diagonal-clipping distortion. Reduce either control for cleaner reception.
- **Fade depth:** New instances use 1% Skywave for gentler level movement in Mono and a less pronounced nighttime fade. Raise Skywave to about 8% when you specifically want a deeper fade; larger values make the effect more extreme.
- Start with Mix at 100% when judging the radio model. Lower it only when you intentionally want some of the original stereo image to remain.

### Parameters

#### Station

- **Radio** (on or off) - Switches the station's transmission on and off. With it off the carrier disappears entirely, leaving the receiver with only atmospheric static, the adjacent station, and its own noise, and AGC opens up until that background becomes loud. Use it to hear the moment a station signs on or off the air. This is not the same as turning the effect off, which leaves the music untouched.
- **Stereo Mode** (Mono or C-QUAM) - Mono uses a traditional envelope-detector receiver. C-QUAM provides stereo reception and automatically blends toward mono when the signal is weak or mistuned. Switching modes can also change the timbre; Detector RC applies only to Mono. C-QUAM stereo operates at sample rates up to 192 kHz; at higher rates, reception is mono.
- **TX Bandwidth** (2.0 to 10.0 kHz) - Sets the transmitter's audio bandwidth. Lower values sound darker and more restricted; higher values preserve more detail.
- **Pre-emphasis** (0 to 100%) - Boosts upper audio frequencies before transmission. Higher settings add presence but also drive bright peaks harder through the broadcast chain.
- **Mod Depth** (10 to 125%) - Sets AM modulation depth. Values above 100% create overmodulation and negative-peak clipping.
- **Compression** (0 to 20 dB) - Sets the depth of the broadcast limiter. Higher settings restrain peaks and make modulation more consistent.

#### Path

- **Signal** (-50 to 0 dB) - Sets received signal strength. Weaker settings expose more receiver noise and require more AGC gain.
- **Skywave** (0 to 100%) - Blends stable groundwave reception with delayed ionospheric paths. New instances default to 1% for gentle movement; around 8% gives a more severe nighttime fade, and higher values make the frequency-selective fading deeper.
- **Fading Speed** (0.05 to 2.0 Hz) - Sets how quickly skywave conditions vary.
- **Static** (0 to 100/s) - Sets the rate of lightning-like events. Raise it for a stormier, more intermittent signal; set it to 0 for none.
- **Interference** (-80 to 0 dB) - Sets adjacent-station strength. -80 dB switches it off; values closer to 0 dB make it stronger.
- **Interf. Offset** (5 to 10 kHz) - Sets adjacent-station spacing and the resulting carrier beat frequency. 9 and 10 kHz represent common channel spacing.

#### Receiver

- **Tuning** (-30.0 to +30.0 kHz) - Offsets the receiver from the desired station; positive values tune above the station and negative values tune below it. Small offsets reduce clarity and increase asymmetric filtering distortion; at large offsets, the station falls below the receiver noise floor. The direction also determines whether the receiver moves toward or away from the higher adjacent station set by Interf. Offset.
- **IF Bandwidth** (2.0 to 20.0 kHz) - Sets the receiver's total IF passband. Narrow settings reject more noise and interference but remove more treble; wide settings retain more detail.
- **AGC Speed** (Slow, Mid, or Fast) - Sets how quickly automatic gain control follows signal changes. Slow emphasizes gradual recovery and pumping; Fast controls rapid fades more tightly.
- **Detector RC** (20 to 500 µs) - Sets the envelope detector's discharge time. Longer values smooth the envelope more but increase high-frequency diagonal-clipping distortion at strong modulation.
- **Hum** (-80 to -20 dB) - Sets power-supply hum. -80 dB switches it off. Unlike an added hum layer, most of this control modulates receiver gain before detection.
- **Hum Freq** (50 or 60 Hz) - Selects the simulated power frequency.

#### Output

- **Speaker** (Off, Small, or Table) - Selects line output, a restricted pocket-radio speaker, or a fuller tabletop-radio response.
- **Output Gain** (-24 to +24 dB) - Adjusts level after receiver and speaker processing.
- **Mix** (0 to 100%) - Blends the original stereo signal with the simulated mono reception. 0% is unchanged stereo; 100% sends the same wet signal to left and right. Only 100% Mix makes the output fully mono.
- In C-QUAM, the wet signal is stereo when reception permits. Use Mix at 100% when judging the decoded stereo image.

### Reading the HUD

- **S METER** shows, on an S1-to-S9 scale, the in-band signal strength the receiver has before AGC. Like the S meter of a real set it reads everything inside the passband, so the adjacent station, noise, and static lift it along with the station you want.
- **AGC GAIN** shows how much gain the receiver is currently applying. It normally rises as Signal falls or a fade deepens. It stops at +42 dB, so deeper fades and weaker signals remain quieter instead of being fully compensated.
- **MODULATION** shows the effective transmitter modulation percentage after transmitter filtering.
- **FADE / EVENTS** shows the current propagation gain change in dB and flashes with recent static and clipping rates. Frequent clipping suggests reducing Mod Depth or Detector RC when a cleaner result is wanted.
- **STEREO** follows the decoded stereo blend. It brightens as stereo reception opens and dims as the receiver automatically returns toward mono.

### Recommended Settings

1. **Strong Local Station**
   - TX Bandwidth: 6.0 kHz, Mod Depth: 90%, Signal: -10 dB, Skywave: 5%, Fading Speed: 0.1 Hz, Static: 0.5/s
   - Interference: -80 dB, Tuning: 0 kHz, IF Bandwidth: 12 kHz, AGC Speed: Fast, Speaker: Table, Mix: 100%

2. **Nighttime Distant Station**
   - TX Bandwidth: 4.5 kHz, Signal: -35 dB, Skywave: 75%, Fading Speed: 0.3 Hz, Static: 6/s
   - Interference: -55 dB, Interf. Offset: 9 kHz, IF Bandwidth: 6 kHz, AGC Speed: Slow, Detector RC: 150 µs, Speaker: Small, Mix: 100%

3. **Crowded Adjacent Channel**
   - Signal: -25 dB, Skywave: 40%, Fading Speed: 0.5 Hz, Static: 3/s
   - Interference: -28 dB, Interf. Offset: 9 kHz, Tuning: +0.5 kHz, IF Bandwidth: 6 kHz, AGC Speed: Mid, Speaker: Small, Mix: 100%

[Back to all effects](/dsp/effects/)
