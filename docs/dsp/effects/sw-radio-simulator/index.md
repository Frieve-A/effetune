---
layout: dsp
title: "SW Radio Simulator — EffeTune DSP"
description: "Models fading, interference, limited bandwidth, and noise associated with shortwave radio."
lang: en
permalink: /dsp/effects/sw-radio-simulator/
---
# SW Radio Simulator

Semantic type: `SWRadioSimulator` · Category: lo-fi

Models fading, interference, limited bandwidth, and noise associated with shortwave radio.

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
| `txBandwidth` | `tx_bandwidth` | number / 1 | `4.5` | kHz | 2 … 10 |
| `preEmphasis` | `pre_emphasis` | number / 1 | `50` | % | 0 … 100 |
| `modDepth` | `mod_depth` | number / 1 | `90` | % | 10 … 125 |
| `compression` | `compression` | number / 1 | `6` | dB | 0 … 20 |
| `signal` | `signal` | number / 1 | `-15` | dB | -50 … 0 |
| `skywave` | `skywave` | number / 1 | `55` | % | 0 … 100 |
| `fadingSpeed` | `fading_speed` | number / 1 | `0.5` | Hz | 0.1 … 10 |
| `delaySpread` | `delay_spread` | number / 1 | `1.4` | ms | 0.2 … 8 |
| `staticRate` | `static_rate` | number / 1 | `2` | /s | 0 … 100 |
| `interference` | `interference` | number / 1 | `-47` | dB | -80 … 0 |
| `interferenceOffset` | `interference_offset` | number / 1 | `1` | kHz | 0.1 … 10 |
| `tuning` | `tuning` | number / 1 | `0` | kHz | -5 … 5 |
| `ifBandwidth` | `if_bandwidth` | number / 1 | `6` | kHz | 2 … 10 |
| `detector` | `detector` | string / 1 | `"Envelope"` | Not declared in catalog | `Envelope`, `Synchronous` |
| `agcSpeed` | `agc_speed` | string / 1 | `"Fast"` | Not declared in catalog | `Slow`, `Mid`, `Fast` |
| `detectorRc` | `detector_rc` | number / 1 | `50` | us | 20 … 500 |
| `hum` | `hum` | number / 1 | `-80` | dB | -80 … -20 |
| `humFrequency` | `hum_frequency` | string / 1 | `"50"` | Not declared in catalog | `50`, `60` |
| `speaker` | `speaker` | string / 1 | `"Small"` | Not declared in catalog | `Off`, `Small`, `Table` |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 24 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |
| `mode` | `mode` | string / 1 | `"AM"` | Not declared in catalog | `AM`, `USB`, `LSB` |
| `bfoOffset` | `bfo_offset` | number / 1 | `0` | Hz | -1000 … 1000 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## SW Radio Simulator

SW Radio Simulator passes the music through a modeled shortwave chain: transmitter processing and AM or single-sideband modulation, ionospheric propagation with deep frequency-selective fading, atmospheric static and a station sharing the channel, a narrow communications receiver with envelope, synchronous, or BFO detection and AGC, and an optional radio speaker. Use it to hear music the way a distant international broadcast arrives on a shortwave set: narrow and hollow, swelling and sinking with the ionosphere, whistling where another transmitter is close in frequency. Switch Mode to USB or LSB and the same chain becomes a communications receiver, where a dial that is not exactly on frequency shifts the whole sound and makes it nasal and inharmonic.

This effect requires an environment that supports its real-time processing. When that processing is unavailable, the audio remains unchanged and the HUD reports that the effect is unavailable.

### How It Differs from AM, FM, and Additive Lo-Fi Effects

- **AM Radio Simulator** models medium-wave reception, where a stable groundwave normally dominates and fading is a secondary effect. Its passband is wider and it offers C-QUAM stereo.
- **SW Radio Simulator** models shortwave, where the signal arrives by ionospheric reflection. Deep frequency-selective fading is the main event, the audio band is narrower, and the heterodyne whistle of a co-channel station is part of the sound. It also offers USB and LSB reception, which no other effect here provides. Shortwave transmission is mono, so the processed signal is always mono.
- **FM Radio Simulator** reproduces wideband FM with its stereo multiplex, rising hiss, and threshold clicks — a different family of degradation.
- **Noise Blender** and **Hum Generator** add noise or hum on top of unchanged music. This effect instead modulates, propagates, and detects the music, so its noise, interference, and distortion react to Tuning, the IF filter, and AGC the way real reception does.

### Sound Character Guide

- **Narrow and hollow:** the transmitter bandwidth and the narrow receiver IF remove most treble, giving the restricted, boxy tone of a shortwave set.
- **Slow deep fading (QSB):** the received level swells and sinks continuously. This is the defining shortwave behavior and is active by default.
- **Watery fade distortion:** in a deep fade the carrier and the sidebands sink at different rates, so the envelope detector no longer reconstructs the audio cleanly. The sound turns hollow, unstable, and "underwater" at the bottom of each fade rather than simply getting quieter. Delay Spread controls how strong this is; Synchronous detection largely removes it.
- **Flutter:** at high Fading Speed the swells become a fast shimmer, like reception over a disturbed or polar path.
- **Heterodyne whistle (QRM):** a co-channel transmitter beats against your carrier and produces a steady tone whose pitch equals Interf. Offset.
- **Atmospheric static (QRN):** distant lightning arrives as crashes that ring through the IF filter.
- **Pumping:** as fades pass, AGC chases the level and the background noise breathes up and down between passages.
- **Single-sideband narrowness (USB, LSB):** the recovered audio reaches only half the IF Bandwidth in every Mode — about 3 kHz at the 6 kHz default. With the carrier suppressed and only one sideband transmitted, the other half of the passband carries no signal at all and passes only noise and interference, which is the dry, restricted sound of a communications channel.
- **"Duck voice" detuning (USB, LSB):** the BFO shifts every component by the same number of hertz instead of scaling them, so harmonics stop being whole-number multiples of the fundamental. Voices and instruments turn nasal and inharmonic, and USB and LSB shift in opposite directions.
- **Syllabic AGC (USB, LSB):** no carrier is transmitted between phrases, so AGC follows the program itself. The background lifts during pauses and each new phrase starts with an audible attack.
- **Loud first moment after silence:** when the music starts — at the beginning of playback or after a gap — the gain is still wide open from the silence, so the first instant comes through loud before AGC settles, most obviously in USB and LSB. This is what a receiver switched on into a quiet channel does, and it is deliberately kept.
- **Thin, dropping-out fades (USB, LSB):** a deep fade attenuates parts of the single sideband unevenly rather than producing the watery envelope-detector distortion of AM, so the sound goes thin and pieces of it drop out.

### System Presets

Click **Effect Presets** in the effect header to try complete shortwave reception scenes.

- **Major Broadcaster** - A stable, relatively wide international broadcast through a tabletop radio.
- **Transoceanic Night** - Deep nighttime fading and synchronous detection on a distant signal.
- **Stormy 49 m Band** - Rapid fading, static, and a nearby interfering station.

### Parameters

#### Station

- **Radio** (on or off) - Switches the station's transmission on and off. With it off the carrier disappears entirely, leaving the receiver with only atmospheric static, the co-channel station, and its own noise, and AGC opens up until that background becomes loud. Use it to hear the moment a station signs on or off the air. This is not the same as turning the effect off, which leaves the music untouched.
- **TX Bandwidth** (2.0 to 10.0 kHz) - Sets the transmitter's audio bandwidth. Shortwave broadcast channels are spaced 5 kHz apart, so the narrow default already sounds darker than a medium-wave station; raise it for a more open transmitter.
- **Pre-emphasis** (0 to 100%) - Boosts upper audio frequencies before transmission. Higher settings add presence inside the narrow band but drive bright peaks harder through the broadcast limiter.
- **Mod Depth** (10 to 125%) - Sets AM modulation depth. Values above 100% create overmodulation and negative-peak clipping.
- **Compression** (0 to 20 dB) - Sets the depth of the broadcast limiter. Higher settings restrain peaks and keep modulation more consistent, which is how international broadcasters stay readable through fades.

#### Propagation

- **Signal** (-50 to 0 dB) - Sets received signal strength. Weaker settings expose more receiver noise and require more AGC gain.
- **Fading** (0 to 100%) - Distributes the received power between a stable direct path and two delayed ionospheric paths. 0% is steady short-range reception; the default gives the continuous fading of a distant signal; 100% makes fades deepest and selective-fade distortion strongest.
- **Fading Speed** (0.1 to 10.0 Hz) - Sets how quickly the ionospheric paths change. Low values give slow swells; a few hertz and above turns the movement into rapid flutter.
- **Delay Spread** (0.2 to 8.0 ms) - Controls how differently parts of the spectrum fade. Low values mainly move the whole signal together; high values create a stronger watery, uneven fade.
- **Static** (0 to 100/s) - Sets the rate of lightning-like crashes. Each event is injected ahead of the IF filter and rings through it. 0 switches them off.
- **Interference** (-80 to 0 dB) - Sets the strength of a station sharing the channel. -80 dB is effectively off; values closer to 0 dB make it louder.
- **Interf. Offset** (0.1 to 10 kHz) - Sets the pitch of the interfering-station whistle. Values below about 3 kHz give a clear tone; higher values raise it until the IF filter begins to remove it.

#### Tuning

- **Mode** (AM, USB, or LSB) - Selects broadcast-style AM or the narrower single-sideband sound of communications receivers. BFO Offset works only in USB and LSB; Detector and Detector RC work only in AM. Disabled controls keep their values.
- **Tuning** (-5.0 to +5.0 kHz) - Offsets the receiver from the station; positive values tune the receiver above the station and negative values tune it below. Small offsets dull the sound, add asymmetric filtering distortion, and change how loud the heterodyne whistle is; larger offsets push the station out of the narrow IF passband. In USB, tuning high shifts the recovered audio down; in LSB, it shifts the audio up. Tuning low reverses those directions.
- **BFO Offset** (-1000 to +1000 Hz) - Fine-tunes USB and LSB reception. Start at 0 Hz; a small offset makes the sound nasal, while a large offset makes it increasingly inharmonic and hard to recognize.
- **IF Bandwidth** (2.0 to 10.0 kHz) - Narrows or widens reception. Lower it to reject more noise and get a drier communications sound; raise it to keep more detail. Start at 6 kHz.

#### Receiver

- **Detector** (Envelope or Synchronous) - In AM, Envelope gives watery distortion during deep fades. Synchronous keeps the signal clearer but works best with Tuning within about ±1 kHz; use Envelope while searching for a station.
- **AGC Speed** (Slow, Mid, or Fast) - Sets how quickly level control follows fades. Slow leaves more swelling and pumping; Fast keeps the level steadier.
- **Detector RC** (20 to 500 µs) - Sets the envelope detector's discharge time. Longer values smooth the envelope more but increase high-frequency diagonal-clipping distortion at strong modulation. It has no effect when Detector is Synchronous, or in USB and LSB.
- **Hum** (-80 to -20 dB) - Sets power-supply hum. -80 dB is effectively off. Most of this control modulates receiver gain before detection rather than adding a hum layer.
- **Hum Freq** (50 or 60 Hz) - Selects the simulated power frequency.

#### Output

- **Speaker** (Off, Small, or Table) - Selects line output, the restricted speaker of a portable shortwave set, or the fuller response of a tabletop communications receiver.
- **Output Gain** (-24 to +24 dB) - Adjusts level after receiver and speaker processing.
- **Mix** (0 to 100%) - Blends the original stereo signal with the mono shortwave sound. Start at 100% for the full receiver effect; lower it to restore some original stereo detail.

### Reading the HUD

- **S METER** shows, on an S1-to-S9 scale, the total in-band signal strength the receiver has before AGC, in every Mode. Like the S meter of a real set it reads everything inside the passband, so the co-channel station, noise, and static lift it along with the station you want. In AM that total is dominated by the carrier and therefore steady; in USB and LSB the carrier is suppressed, so the reading follows the program and falls back toward the noise between phrases.
- **FADE** shows the current propagation gain change in dB, and it swings both below and above 0 dB as the direct path and the two ionospheric paths cancel or reinforce each other. On shortwave this is the display to watch: it moves continuously at the default settings, and the deepest dips are where the sound turns watery and distorted. It is always the path gain at the carrier frequency, so in USB and LSB it reports that gain for the suppressed carrier — not the attenuation of the sideband as a whole, and not the program level.
- **AGC GAIN** shows how much gain the receiver is applying. It rises as Signal falls or a fade deepens. It stops at +42 dB, so the deepest fades stay quiet instead of being fully compensated.
- **MOD / EVENTS**, labeled **TX / EVENTS** in USB and LSB, shows the effective transmitter modulation percentage — the sideband drive in USB and LSB — followed by the recent static-crash rate (⚡) and clipping rate (▲) per second, and flashes as those events occur. Frequent clipping suggests reducing Mod Depth or Detector RC when a cleaner result is wanted. The clipping counter reports AM over-modulation and envelope-detector clipping, so it stays at rest in USB and LSB.
- If the **WASM** engine is unavailable, the HUD shows a notice and the plugin passes audio through unchanged.

### Recommended Settings

1. **Distant International Broadcast**
   - TX Bandwidth: 4.5 kHz, Mod Depth: 90%, Signal: -15 dB, Fading: 55%, Fading Speed: 0.5 Hz, Delay Spread: 1.4 ms, Static: 2/s
   - Interference: -47 dB, Interf. Offset: 1.0 kHz, Tuning: 0 kHz, IF Bandwidth: 6.0 kHz, Detector: Envelope, AGC Speed: Fast, Hum: -80 dB, Speaker: Small, Mix: 100%
   - The everyday shortwave sound: narrow, continuously fading, with an occasional crash and a faint whistle.

2. **Deep Nighttime Fading**
   - Signal: -30 dB, Fading: 100%, Fading Speed: 0.3 Hz, Delay Spread: 5.0 ms, Static: 10/s
   - IF Bandwidth: 4.0 kHz, Detector: Envelope, AGC Speed: Slow, Detector RC: 150 µs, Speaker: Small, Mix: 100%
   - Long, deep swells with watery distortion at the bottom of each fade and clearly audible AGC pumping on recovery.

3. **Crowded Band**
   - Signal: -20 dB, Fading: 60%, Fading Speed: 0.5 Hz, Static: 8/s, Interference: -18 dB, Interf. Offset: 0.8 kHz
   - Tuning: +0.3 kHz, IF Bandwidth: 4.0 kHz, AGC Speed: Mid, Speaker: Small, Mix: 100%
   - A steady heterodyne whistle over the program. Change Interf. Offset to move its pitch, and Tuning to change how loud it is.

4. **Synchronous Detection**
   - Start from Deep Nighttime Fading and set Detector: Synchronous
   - The deep fades remain, but the distortion at the bottom of each fade is far weaker and the program stays readable. Keep Tuning within about ±1 kHz so the detector stays locked, and compare with Envelope to hear what the detector is doing.

5. **Polar Flutter**
   - Signal: -25 dB, Fading: 90%, Fading Speed: 6 Hz, Delay Spread: 3.0 ms, Static: 5/s
   - IF Bandwidth: 5.0 kHz, Detector: Envelope, AGC Speed: Fast, Speaker: Small, Mix: 100%
   - The fast shimmer of a disturbed or polar path instead of a slow swell.

6. **Single-Sideband Station**
   - Mode: USB, Tuning: 0 kHz, BFO Offset: 0 Hz, TX Bandwidth: 3.0 kHz, IF Bandwidth: 6.0 kHz
   - Signal: -20 dB, Fading: 55%, Fading Speed: 0.5 Hz, Static: 2/s, AGC Speed: Fast, Speaker: Small, Output Gain: 0 dB, Mix: 100%
   - Narrow, dry communications audio that is on frequency, with AGC breathing between phrases. It already lands close to an AM station in level, so no extra trim is needed.

7. **Off-Frequency Duck Voice**
   - Start from Single-Sideband Station and set BFO Offset: -150 Hz
   - Every component moves up by 150 Hz, so harmonics no longer line up and voices and instruments turn nasal and inharmonic. Switch Mode to LSB with the same setting to move everything down by 150 Hz instead, and use Tuning for coarser offsets.

[Back to all effects](/dsp/effects/)
