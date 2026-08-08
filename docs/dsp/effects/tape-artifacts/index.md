---
layout: dsp
title: "Tape Artifacts — EffeTune DSP"
description: "Models the record and reproduce chain of a reel-to-reel tape machine, including saturation, wow and flutter, hiss, and head response."
lang: en
permalink: /dsp/effects/tape-artifacts/
---
# Tape Artifacts

Semantic type: `TapeArtifacts` · Category: lo-fi

Models the record and reproduce chain of a reel-to-reel tape machine, including saturation, wow and flutter, hiss, and head response.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `speed` | `speed` | string / 1 | `"15"` | Not declared in catalog | `7.5`, `15`, `30` |
| `tape` | `tape` | string / 1 | `"Standard"` | Not declared in catalog | `Standard`, `Master` |
| `bias` | `bias` | number / 1 | `0` | dB | -6 … 6 |
| `recordLevel` | `record_level` | number / 1 | `6` | dB | -12 … 18 |
| `wowFlutter` | `wow_flutter` | number / 1 | `0.16` | % | 0 … 1 |
| `hiss` | `hiss` | number / 1 | `-62.5` | dB re 320 nWb/m | -89 … -39 |
| `output` | `output` | number / 1 | `0` | dB | -24 … 24 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Tape Artifacts

Tape Artifacts records the music onto a modeled analog reel-to-reel machine and plays it back. The signal passes through the record amplifier and the treble lift it puts onto the tape, the magnetic saturation of the tape itself, the treble erasure caused by the record bias, the wavelength losses of the reproduce head, the wow and flutter of the transport, the low-frequency head bump, and the playback curve that takes exactly that lift off again, before tape hiss and modulation noise are added. Use it when you want music to sound as though it had been through a tape machine rather than simply having noise or wobble placed on top of it.

### How It Differs from Other Lo-Fi Effects

- **Tape Artifacts** changes the music itself. The gentle compression, the added warmth, the softened treble, and the pitch wobble all come from the same modeled record-and-reproduce chain, so they respond together to Speed, Tape, Bias, and Record Level.
- **Wow Flutter** (Modulation) reproduces only the speed variation of a transport. Choose it when you want the wobble without tape saturation, tape equalization, or hiss.
- **Saturation** and **Hard Clipping** add nonlinearity on its own, without the frequency-dependent behavior and the transport of a tape machine.
- **Noise Blender** and **Hum Generator** add a noise or hum layer over unchanged music. Here the hiss and the modulation noise are generated at the correct point in the machine, so they follow Speed and Tape the way real tape noise does.

### Sound Character Guide

- **Speed sets the basic tone:** 30 ips is the most open, 15 ips is the familiar studio sound, and 7.5 ips is clearly darker with a stronger low-frequency lift. The noise does not simply follow the speed: with no signal the hiss floor is highest at 15 ips and lowest at 30 ips, while the modulation noise that rides on the music is strongest at 7.5 ips.
- **Gentle level compression:** the higher you set Record Level, the more the tape rounds the peaks off before it audibly distorts, so loud passages become denser and steadier rather than obviously clipped. At the default +6.0 dB and the reference 0.0 dB Bias a full-scale 1 kHz tone comes out 0.17 dB rounded off with 0.49% distortion - a machine at its normal operating level, not a clean digital path. The amount grows smoothly from there: 0.68 dB and 2.0% at +12.0 dB, 2.49 dB and 6.8% at the +18.0 dB top. Any larger level change you see at the default comes from the tone shaping and not from the compression, and that one goes either way depending on the material: bass-heavy music can come out about 1 dB louder, and material with a lot of top about 1 dB quieter.
- **Warmth:** the saturation is asymmetric, so it produces both even and odd harmonics, and the warmth grows gradually as Record Level rises instead of appearing suddenly.
- **The transport is audible on sustained notes:** slow wow and faster flutter make held piano, organ, and string notes drift very slightly (0.160%, the deviation the setting states, at the default Wow/Flutter and Speed). This is what most clearly separates tape from a digital file.
- **A living background:** hiss, plus modulation noise that rides on the music itself, is part of the sound at normal settings. The hiss is on the tape, so Record Level moves what it measures at the output one decibel for one decibel. Take Hiss all the way down to -89.0 dB re 320 nWb/m when you want a silent background.

### Parameters

- **Speed** (7.5, 15, or 30 ips) - Selects the tape speed. Faster speeds extend the treble and move the low-frequency head bump higher in frequency while making it smaller: +1.4 dB at 41 Hz at 7.5 ips, +0.8 dB at 80 Hz at 15 ips, and +0.4 dB at 159 Hz at 30 ips. They also make the wow and flutter faster and shallower: Wow/Flutter states the weighted deviation at 15 ips and the speed multiplies it by 1.5 at 7.5 ips and by 0.75 at 30 ips, so the 0.04% the reference machine publishes at 15 ips gives the 0.06% and 0.03% it publishes at the other two. The noise does not move in one direction with the speed: the hiss floor is highest at 15 ips and lowest at 30 ips, while the modulation noise that rides on the music is strongest at 7.5 ips. 15 ips is the usual studio setting, 7.5 ips is the darkest, and 30 ips is the closest to the original. Wow/Flutter and Hiss are both stated at the reference 15 ips, and the last line of the effect shows what each of them comes to at the Speed, Tape and Record Level you have selected, alongside the Record Level convention itself.
- **Tape** (Standard or Master) - Selects the tape formulation. Master has a thicker coating and about 3 dB more headroom before the tape saturates, so it stays clean longer and has a slightly softer top end. At low Record Level settings the two are close in level (0.08 dB apart at the default), but the higher you set Record Level the louder Master stays: 0.34 dB at +12.0 dB and 1.16 dB at +18.0 dB, precisely because it saturates later, so re-match the loudness with Output when you compare them.
- **Bias** (-6.0 to +6.0 dB) - Sets the recording bias. 0 dB is the correctly aligned machine, and it is the point the manufacturer's own bias procedure lands on: record 10 kHz 20 dB below the operating level, find the peak of the sensitivity curve, then raise the bias until playback has dropped by the published amount, which on Standard tape is 1.5 dB at 30 ips, 4.0 dB at 15 ips, and 5.0 dB at 7.5 ips. Master tape differs only at 7.5 ips, where the drop is 6.5 dB. Higher (over-biased) settings are cleaner and duller. Lower (under-biased) settings are brighter and more distorted, in the way a misaligned deck is, but only down to that peak, which on Standard tape sits at about -2.7 dB at 30 ips, -4.5 dB at 15 ips, and -5.0 dB at 7.5 ips, and on Master at 7.5 ips at about -5.7 dB. Below it the treble darkens again while the distortion keeps rising. How much brightening there is depends on the frequency as much as on the speed: at 30 ips the peak is worth 1.5 dB at 10 kHz but 2.9 dB at 16 kHz, and by -6.0 dB the top is already darker than at 0 dB, by 0.2 dB at 10 kHz and 0.5 dB at 16 kHz.
- **Record Level** (-12.0 to +18.0 dB) - Sets how hard the machine records. The number is the tape level a 0 dBFS peak reaches, in dB above the 320 nWb/m reference flux, and the status line states that convention. The control adds no gain of its own: as long as the tape is not saturating, the same signal comes out at the same level wherever Record Level is set. That level is not exactly unity - it sits within 0.05 dB of it, a little high at 30 ips and a little low at 7.5 ips - but it does not move with Record Level. The default +6.0 dB is a machine at its normal operating level, where a full-scale 1 kHz tone distorts 0.49%; +12.0 dB gives 2.0% and the +18.0 dB top 6.8%, and that is how you get tape compression and warmth out of it. The peaks flattening is the tape, not the control turning anything down, so the harder you drive the tape the quieter the result gets, and Output is there to bring the loudness back. It also moves the background one decibel for every decibel in the other direction, since the hiss is recorded on the tape and the tape is now further below the peak.
- **Wow/Flutter** (0 to 1%) - Sets the speed variation of the transport, as a DIN 45507 peak-weighted deviation in percent at 15 ips. 0% is a perfectly steady machine. 0.04% is the tolerance the reference studio machine publishes at that speed, and dialing it in gives the 0.06% at 7.5 ips and the 0.03% at 30 ips that the same machine publishes for those speeds. The default 0.160% is four times that tolerance; higher values give the audible drift and shimmer of a worn deck, up to 1.5% at 7.5 ips.
- **Hiss** (-89.0 to -39.0 dB re 320 nWb/m) - Sets the level of the tape hiss and the modulation noise together, as the A-weighted hiss flux at 15 ips on Standard tape, referred to the 320 nWb/m reference. This is the tape's own datasheet figure rather than a level at the output: the noise is recorded on the tape, so what it measures at the output depends on Record Level. -89.0 dB re 320 nWb/m switches both off completely. The default -62.5 dB re 320 nWb/m is the bias noise the manufacturer publishes for that tape at that speed; the other speeds and Master tape differ from it by the amounts the datasheet gives, so at that default and Record Level +6.0 dB the six combinations run from -68.0 to -72.0 dBFS, and the whole set moves with both controls. All of these are ahead of Output, so a meter placed after Output reads them lifted by whatever Output is set to. That floor is what you hear in the gaps; while the music plays what this control mostly adds is the modulation noise riding on the signal, about 57 dB below a steady tone on Standard tape at 15 ips, and a few decibels either side of that at the other Speed and Tape settings and on real material. Higher values make the background more obvious.
- **Output** (-24.0 to +24.0 dB) - Adjusts the level after the whole chain. Use it to match loudness when you compare with bypass, or to bring back the loudness a high Record Level setting has cost.
- **Mix** (0 to 100%) - Blends the tape signal with the original. 100% is full tape playback. The dry signal is delay-aligned with the tape path, so the midrange blends cleanly - 1 kHz stays within 0.1 dB of unity at every Mix setting and Speed at the reference 0.0 dB Bias, and within 0.5 dB anywhere in the Bias range - but the top octave does not, because dry and tape no longer share the same phase up there and partly cancel. At 50% the level at 16 kHz comes out 1.7 dB down on a 44.1 kHz host, 2.1 dB on 48 kHz, 4.6 dB on 96 kHz, and 5.7 dB on 192 kHz, and on a 96 or 192 kHz host the darkest point of the control is not 100% but around 70%. On a 44.1 kHz host it only gets darker as you turn it up, and on a 48 kHz one the darkest point is 89%, 0.06 dB below 100%, so on both the middle of the control is brighter at the very top than 100% is. At 0% the input passes through completely unchanged and the effect adds no latency; at any other setting it adds 5.26 ms on a 44.1 kHz host, falling to 5.06 ms on a 192 kHz one.

### Recommended Settings

1. **Studio Master Tape (default)**
   - Speed: 15 ips, Tape: Standard, Bias: 0.0 dB, Record Level: +6.0 dB
   - Wow/Flutter: 0.160%, Hiss: -62.5 dB re 320 nWb/m, Output: 0.0 dB, Mix: 100%
   - The everyday tape sound, and the plugin's own default: the top softened by 3.5 dB at 16 kHz, a 0.8 dB lift around 80 Hz, 0.49% distortion and 0.17 dB of rounding on a full-scale tone, a -68.5 dBFS background, and 0.160% wow and flutter, audible on held notes and not on transients.

2. **Clean High-Speed Transfer**
   - Speed: 30 ips, Tape: Master, Bias: 0.0 dB, Record Level: 0.0 dB
   - Wow/Flutter: 0.070%, Hiss: -68.5 dB re 320 nWb/m, Output: 0.0 dB, Mix: 100%
   - Very close to the original: 0.07% distortion and 0.02 dB of rounding on a full-scale tone, 2.2 dB down at 16 kHz, a -72.0 dBFS background - what the -68.5 dB re 320 nWb/m Base setting becomes at 30 ips on Master tape at this Record Level - and 0.053% wow and flutter. The tape is recorded 6 dB below the default, which is what keeps it this clean. Useful as a reference point when comparing the other settings.

3. **Warm and Compressed**
   - Speed: 15 ips, Tape: Standard, Bias: 0.0 dB, Record Level: +18.0 dB
   - Wow/Flutter: 0.200%, Hiss: -62.5 dB re 320 nWb/m, Output: +1.5 dB, Mix: 100%
   - The tape is recorded 12 dB above the default, at the top of the range: a full-scale tone comes out 2.49 dB rounded off with 6.8% distortion, so the mix becomes denser and warmer while the peaks flatten. The background drops to -80.5 dBFS at the same time, because the hiss is on the tape and the tape now sits that much higher. Output goes up, not down, because the compression costs loudness; fine-tune it by ear.

4. **Home Deck at 7.5 ips**
   - Speed: 7.5 ips, Tape: Standard, Bias: +2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.300%, Hiss: -59.5 dB re 320 nWb/m, Output: +0.5 dB, Mix: 100%
   - Darker (10.2 dB down at 16 kHz, with a 1.4 dB lift at 50 Hz) and noisier (a -72.5 dBFS background, which is the tape's own -73.0 dBFS floor plus its +0.5 dB of Output), and less steady (0.450% wow and flutter), with 1.3% distortion on a full-scale tone. The bias is set a little high, the way a domestic deck running generic tape usually is: an ordinary machine rather than a studio one.

5. **Worn Transport**
   - Speed: 7.5 ips, Tape: Standard, Bias: -2.0 dB, Record Level: +15.0 dB
   - Wow/Flutter: 0.480%, Hiss: -56.5 dB re 320 nWb/m, Output: +1.0 dB, Mix: 100%
   - 0.720% wow and flutter, 5.2% distortion and 1.80 dB of rounding on a full-scale tone, and a -72.0 dBFS background - the tape's own -73.0 dBFS floor plus its +1.0 dB of Output - with the gritty, forward top of an under-biased machine, only 4.4 dB down at 16 kHz where an aligned machine at this speed is 7.2 dB down. Output has to come up to bring the loudness back. An intentionally degraded lo-fi effect.

### Model Notes

The effect models one recording and playback pass on a correctly aligned machine. The record side lifts the treble before the tape and the playback side takes exactly the same lift off again, at every speed, rather than following a published equalization standard such as NAB. Print-through, tape dropouts, azimuth error, splice noise, and machine-specific equalization standards are outside this model. The tape path carries 5.06 to 5.26 ms of transport and processing delay on hosts from 44.1 to 192 kHz. The tone figures quoted above are measured on a 96 kHz host at the reference 0.0 dB Bias; the extreme top depends on the host sample rate, so the 3.5 dB at 16 kHz of the default becomes 2.7 dB at 44.1 or 48 kHz.

[Back to all effects](/dsp/effects/)
