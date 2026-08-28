---
layout: dsp
title: "FM Radio Simulator — EffeTune DSP"
description: "Models bandwidth, stereo behavior, distortion, and noise associated with FM radio."
lang: en
permalink: /dsp/effects/fm-radio-simulator/
---
# FM Radio Simulator

Semantic type: `FMRadioSimulator` · Category: lo-fi

Models bandwidth, stereo behavior, distortion, and noise associated with FM radio.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **yes**
- Catalog sample rates: **44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 Hz**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `radio` | `radio` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |
| `emphasis` | `emphasis` | string / 1 | `"50us"` | Not declared in catalog | `50us`, `75us` |
| `processing` | `processing` | number / 1 | `0` | dB | 0 … 18 |
| `signal` | `signal` | number / 1 | `35` | dBuV | 0 … 70 |
| `tuning` | `tuning` | number / 1 | `0` | kHz | -200 … 200 |
| `ifBandwidth` | `if_bandwidth` | number / 1 | `230` | kHz | 80 … 240 |
| `multipath` | `multipath` | number / 1 | `0` | % | 0 … 100 |
| `pathDelay` | `path_delay` | number / 1 | `5` | us | 0.5 … 50 |
| `fading` | `fading` | number / 1 | `0` | Hz | 0 … 20 |
| `stereo` | `stereo` | string / 1 | `"Auto"` | Not declared in catalog | `Auto`, `Stereo`, `Mono` |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 24 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## FM Radio Simulator

FM Radio Simulator passes the music through a modeled FM broadcast and receiver chain: broadcast audio processing and pre-emphasis, stereo multiplex (MPX) composition with the 19 kHz pilot, FM modulation of a carrier, multipath propagation and antenna noise, receiver tuning, IF filtering, hard limiting, FM discrimination, pilot-PLL stereo decoding, and de-emphasis. Because the signal really is FM modulated and demodulated, the characteristic behaviors of FM reception emerge from the physics instead of being synthesized: the bright hiss that rises as the signal weakens, the stereo noise penalty and automatic blend toward mono, click and sputter noise below the FM threshold, and multipath distortion.

This effect requires an environment that supports its real-time processing. When that processing is unavailable, the audio remains unchanged and the HUD reports that the effect is unavailable.

### How It Differs from Additive Lo-Fi Effects

- **FM Radio Simulator** does not synthesize "radio-like" noise and mix it on top. It modulates the music onto a carrier, degrades that carrier, and demodulates it. Hiss, clicks, and distortion appear only where the receiver physics creates them, and they react to Signal, Tuning, the IF filter, and the stereo decoder, showing the same physical tendencies as real FM reception.
- **Noise Blender** adds a constant background noise texture without changing the music; choose it when you only want ambience. It can also be chained after this effect to stand in for ignition-style impulse interference, which this model does not include.
- **Digital Error Emulator** reproduces digital transmission errors such as dropouts and concealment artifacts — a different family of degradation from analog FM reception.
- **AM Radio Simulator** is the matching physical model for AM broadcasting; FM Radio Simulator reproduces the wideband FM sound with its stereo multiplex, pilot lock, and FM-specific noise behavior.

### Sound Character Guide

- **Clean broadcast:** with a strong signal, the chain mainly contributes the broadcast processing itself — the 15 kHz bandwidth limit and the density of the station's limiter set by Processing.
- **Weak-signal hiss:** as Signal falls, a bright, airy hiss rises first in stereo. Switching Stereo to Mono makes the same reception noticeably quieter, for the same reason mono is quieter on a real tuner.
- **Fringe reception:** near the FM threshold, clicks and sputter appear, the receiver blends to mono, and the program finally sinks into noise.
- **Multipath color:** reflections add a harsh, hollow distortion whose character follows Path Delay; raising Fading turns it into the flutter of mobile reception.

### System Presets

Click **Effect Presets** in the effect header to try representative FM reception conditions.

- **Powerhouse Broadcast** - A strong station with more broadcast processing.
- **Distant Station** - Reception near the service-area edge, with hiss and early stereo degradation.
- **City Drive Multipath** - Fast-changing reflections and multipath distortion for mobile listening.

### Parameters

- **Radio** (on or off) - Switches the station's transmission on and off. With it off the carrier disappears entirely, so the receiver has nothing left to limit but its own noise floor and produces the full-scale hiss of an empty channel. Use it to hear the moment a station signs on or off the air. This is not the same as turning the effect off, which leaves the music untouched.
- **Emphasis** (50 or 75 µs) - Selects the pre-emphasis/de-emphasis time-constant pair (50 µs: Japan/Europe, 75 µs: the Americas). On a clean signal the pair nearly cancels; the choice subtly changes how hiss and distortion are voiced.
- **Processing** (0 to +18 dB) - Drive of the broadcast limiter — the station's "loudness". 0 dB is nearly transparent; higher values sound denser and louder in the way heavily processed stations do.
- **Signal** (0 to 70 dBµV) - Carrier level at the antenna input. The noise floor is fixed by physics (75 Ω thermal noise plus receiver noise figure), so this control sets the carrier-to-noise ratio and is the main degradation axis. Around 50 dBµV and above reception is essentially clean; near 30 stereo hiss is clearly audible; near 15 the Auto blend has moved to mono; at 6 and below clicks multiply and the program sinks into noise.
- **Tuning** (-200 to +200 kHz) - Detunes the receiver from the station. Small offsets pass almost unnoticed; from roughly ±40 kHz the sound becomes increasingly distorted, asymmetric, and quieter as the sidebands slide out of the IF passband. At ±200 kHz the station is fully outside the passband, leaving only receiver noise.
- **IF Band** (80 to 240 kHz) - Receiver IF filter width. Narrow settings represent a receiver built for crowded conditions: they truncate the FM sidebands and increase distortion, especially together with detuning. Wide settings are cleaner for a strong, centered station.
- **Multipath** (0 to 100%) - Effect amount for two delayed reflections: at 100% the first reflection reaches the same amplitude as the direct wave, and the second is 60% of the first. As the reflections grow the interference nulls deepen, converting FM into amplitude and phase errors that the limiter cannot fully remove — from a subtle coloration at low settings to the harsh, sputtering distortion of severe multipath near 100%.
- **Path Delay** (0.5 to 50 µs) - Delay of the first reflection (the second is fixed at 2.7 times). Short delays give a broad, phasey coloration; longer delays produce sharper, more localized distortion.
- **Fading** (0 to 20 Hz) - Rotation rate of the reflection phases. 0 Hz freezes the multipath pattern; higher values create the flutter and picket-fencing of reception in a moving car.
- **Stereo** (Auto / Stereo / Mono) - Auto blends continuously from stereo to mono as pilot lock and signal quality degrade, like a real receiver. Stereo forces the decoder on and exposes the full stereo noise penalty on weak signals. Mono discards the L−R subchannel for noticeably quieter weak-signal reception.
- **Output** (-24 to +24 dB) - Output trim after demodulation.
- **Mix** (0 to 100%) - Blends the demodulated signal with a latency-aligned dry signal. 100% is full radio reception; lower values mix the original back in without comb filtering.

### Reading the HUD

- The graph shows the **MPX spectrum** seen at the demodulator output on a logarithmic frequency axis, with markers at 15 kHz (end of the L+R region), the 19 kHz pilot, and the L−R subchannel around 38 kHz (23 to 53 kHz band). As Signal falls, the noise floor rises toward higher frequencies — the triangular noise spectrum characteristic of FM — and swallows the L−R region first. This is the visible reason stereo reception becomes noisy before mono does.
- The **signal meter and dBµV readout** show the received carrier level set by Signal and varying with multipath interference.
- **CNR** is the estimated carrier-to-noise ratio. Clicking starts to appear as it approaches the FM threshold around 12 dB.
- The **ST lamp and percentage** show the current stereo blend: 100% is full stereo, 0% is mono. With Stereo set to Auto, the percentage falls as the signal degrades.
- **MPath** shows the first reflection level relative to the direct wave in dB (−∞ when Multipath is 0%).
- **Clicks** counts recent FM threshold clicks per second and highlights when clicking becomes frequent.
- If the **WASM** engine is unavailable, the HUD shows a notice and the plugin passes audio through unchanged.

### Recommended Settings

1. **Strong Local Station**
   - Emphasis: 50 µs, Processing: 6 dB, Signal: 50 dBµV, Tuning: 0 kHz, IF Band: 230 kHz
   - Multipath: 0%, Fading: 0 Hz, Stereo: Auto, Mix: 100%
   - Clean stereo with only the broadcast processing character. Raise Processing to compare station sounds.

2. **Suburban Reception**
   - Signal: 30 dBµV, Tuning: 0 kHz, IF Band: 230 kHz, Multipath: 20%, Path Delay: 5 µs, Fading: 0.5 Hz
   - Stereo: Auto, Mix: 100%
   - Clearly audible stereo hiss over the music. Compare Stereo: Mono to hear the stereo noise penalty disappear.

3. **Fringe Reception**
   - Signal: 15 dBµV, IF Band: 180 kHz, Multipath: 40%, Path Delay: 12 µs, Fading: 2 Hz
   - Stereo: Auto, Mix: 100%
   - The Auto blend has moved to mono and reception flutters. Force Stereo to hear why receivers blend.

4. **Barely a Signal**
   - Signal: 6 dBµV, Tuning: +30 kHz, Multipath: 60%, Path Delay: 12 µs, Fading: 5 Hz
   - Stereo: Auto, Mix: 100%
   - Below the FM threshold: sputtering clicks, heavy noise, and a program that fades in and out of the static.

### Model Notes

The effect processes the first stereo pair as one broadcast chain; a mono input is broadcast with an empty L−R channel. RDS, adjacent stations, and interference sources are outside this model. For a multiband "big station" sound, place a Multiband Compressor before this effect; for impulse-type interference, chain Noise Blender or Digital Error Emulator after it.

[Back to all effects](/dsp/effects/)
