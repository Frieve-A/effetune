---
title: "Lo-Fi Plugins - EffeTune"
description: "Lo-Fi effect plugins including AM Radio Simulator, Bit Crusher, Noise Blender, Vinyl Artifacts, and more."
lang: en
---

# Lo-Fi Audio Plugins

A collection of plugins that add vintage character and nostalgic qualities to your music. These effects can make modern digital music sound like it's being played through classic equipment or give it that popular "lo-fi" sound that's both relaxing and atmospheric.

## Plugin List

- [AM Radio Simulator](#am-radio-simulator) - Passes the music through a modeled AM broadcast and receiver chain
- [Bit Crusher](#bit-crusher) - Creates retro gaming and vintage digital sounds
- [Cassette Artifacts](#cassette-artifacts) - Records the music onto a modeled compact cassette and plays it back through a Type I/II/IV deck with Dolby B/C
- [Digital Error Emulator](#digital-error-emulator) - Simulates various digital audio transmission errors
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - Simulates audible intermodulation distortion from DSD64 ultrasonic noise
- [FM Radio Simulator](#fm-radio-simulator) - Passes the music through a physically simulated FM broadcast and receiver chain
- [G.726 Simulator](#g726-simulator) - Simulates an ITU-T G.726 speech-codec encode/decode round trip with an optional noisy radio link
- [GSM-FR Simulator](#gsm-fr-simulator) - Simulates a 13 kbit/s GSM-FR speech-codec encode/decode round trip over a radio link with frame erasure concealment
- [Hum Generator](#hum-generator) - Adds controllable electrical hum ambience for vintage/lo-fi listening
- [MP3 Codec Simulator](#mp3-codec-simulator) - Simulates a clean low-bitrate MPEG Layer III encode/decode round trip
- [Noise Blender](#noise-blender) - Adds atmospheric background texture
- [SBC Codec Simulator](#sbc-codec-simulator) - Simulates a Bluetooth A2DP SBC encode/decode round trip with optional link packet loss and concealment
- [Simple Jitter](#simple-jitter) - Creates subtle vintage digital imperfections
- [SW Radio Simulator](#sw-radio-simulator) - Passes the music through a modeled shortwave broadcast, ionospheric path, and receiver
- [Tape Artifacts](#tape-artifacts) - Records the music onto a modeled reel-to-reel tape and plays it back
- [Vinyl Artifacts](#vinyl-artifacts) - Adds vinyl-style pops, crackle, hiss, rumble, and stereo noise bleed
- [Vinyl Simulator](#vinyl-simulator) - Cuts the input into a modeled groove and plays it back with a physical stylus model

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

### C-QUAM Blend and Static Model

In C-QUAM, automatic stereo blending observes qualified signal loss on two orthogonal receiver axes: the decoded sum and the 25 Hz pilot region of the quadrature difference signal. AGC is removed from both observations, and a loss lowers the quality term only when it coincides on both axes. This loss-coincidence rule keeps ordinary program changes on either axis from being mistaken for an RF fade. It runs only while the PLL is tracking and the pilot is accepted; otherwise, the quality observation is cleared.

The new-instance Skywave default is 1%, adopted after the integrated model checks passed. Saved presets keep their explicitly stored Skywave value. Compared with 8%, the 1% setting gives Mono mode calmer level movement and shallower fades; select about 8% when a more severe nighttime-fade effect is wanted.

The frozen response range begins at Fading Speed 0.05 Hz. Attenuation that changes much more slowly than the adaptive reference's 60 s fall time is absorbed into that reference and is intentionally not retained as a continuing quality loss. The 0.75 dB residual-program allowance, 0.04 ratio offset, Q=4 pilot observation band, 0.05/0.2/0.5/60 s quality time constants, and the 0.5 dB deadband with 5.0 dB transfer span are empirical simulator calibration, not general C-QUAM receiver specifications.

This receiver-faithful observation has the same program ambiguity as pilot C-QUAM hardware. If a program contains both difference energy near 25 Hz and asymmetric sum/DC, ending both components together can briefly lower the stereo blend because it presents the same RF evidence as a fade. A coherent anti-phase residual can likewise drive the quality observation while the PLL remains in TRACK and the pilot remains accepted. These are intentional behaviors within the approved model boundary, not defects.

Static events use a carrier-relative vector-area calibration: each event is scaled from a 20.0 µs area referenced to the nominal desired carrier, with an empirical uniform 0.5-to-1.5 area distribution and random phase. Events are scheduled from double-precision absolute deadlines rather than rounded sample countdowns, so timing remains continuous across render blocks and multiple events due in one sample are accumulated. The 20.0 µs scale and its distribution are empirical simulator calibration.

### Parameters

#### Station

- **Radio** (on or off) - Switches the station's transmission on and off. With it off the carrier disappears entirely, leaving the receiver with only atmospheric static, the adjacent station, and its own noise, and AGC opens up until that background becomes loud. Use it to hear the moment a station signs on or off the air. This is not the same as turning the effect off, which leaves the music untouched.
- **Stereo Mode** (Mono or C-QUAM) - Mono uses a traditional envelope-detector receiver. C-QUAM provides stereo reception, with lower stereo S/N than mono, and automatically blends toward mono when the signal is weak or mistuned. Because the receiver uses a physically different detector, switching modes can also change the timbre; Detector RC and its diagonal clipping apply only to Mono and have no effect in C-QUAM. C-QUAM stereo operates at sample rates up to 192 kHz; at higher rates, reception is mono. The simulation models only the FCC C-QUAM c(5) modulation-phase limit and does not represent a complete compliance test.
- **TX Bandwidth** (2.0 to 10.0 kHz) - Sets the transmitter's audio bandwidth. Lower values sound darker and more restricted; higher values preserve more detail.
- **Pre-emphasis** (0 to 100%) - Boosts upper audio frequencies before transmission. Higher settings add presence but also drive bright peaks harder through the broadcast chain.
- **Mod Depth** (10 to 125%) - Sets AM modulation depth. Values above 100% create overmodulation and negative-peak clipping.
- **Compression** (0 to 20 dB) - Sets the depth of the broadcast limiter. Higher settings restrain peaks and make modulation more consistent.

#### Path

- **Signal** (-50 to 0 dB) - Sets received signal strength. Weaker settings expose more receiver noise and require more AGC gain.
- **Skywave** (0 to 100%) - Blends stable groundwave reception with delayed ionospheric paths. New instances default to 1% for gentle movement; around 8% gives a more severe nighttime fade, and higher values make the frequency-selective fading deeper.
- **Fading Speed** (0.05 to 2.0 Hz) - Sets how quickly skywave conditions vary.
- **Static** (0 to 100/s) - Sets the rate of lightning-like events. Each carrier-relative event follows an absolute-time schedule and rings through the receiver's IF filter rather than being added after reception.
- **Interference** (-80 to 0 dB) - Sets adjacent-station strength. -80 dB switches it off; values closer to 0 dB make it stronger.
- **Interf. Offset** (5 to 10 kHz) - Sets adjacent-station spacing and the resulting carrier beat frequency. 9 and 10 kHz represent common channel spacing.

#### Receiver

- **Tuning** (-30.0 to +30.0 kHz) - Offsets the receiver from the desired station. Small offsets reduce clarity and increase asymmetric filtering distortion; at large offsets, the station falls below the receiver noise floor.
- **IF Bandwidth** (2.0 to 20.0 kHz) - Sets the receiver's total IF passband. Narrow settings reject more noise and interference but remove more treble; wide settings retain more detail.
- **AGC Speed** (Slow, Mid, or Fast) - Sets how quickly automatic gain control follows signal changes. Slow emphasizes gradual recovery and pumping; Fast controls rapid fades more tightly.
- **Detector RC** (20 to 500 µs) - Sets the envelope detector's discharge time. Longer values smooth the envelope more but increase high-frequency diagonal-clipping distortion at strong modulation.
- **Hum** (-80 to -20 dB) - Sets power-supply hum. -80 dB switches it off. Unlike an added hum layer, most of this control modulates receiver gain before detection.
- **Hum Freq** (50 or 60 Hz) - Selects the simulated power frequency.

#### Output

- **Speaker** (Off, Small, or Table) - Selects line output, a restricted pocket-radio speaker, or a fuller tabletop-radio response.
- **Output Gain** (-24 to +24 dB) - Adjusts level after receiver and speaker processing.
- **Mix** (0 to 100%) - Blends the original stereo signal with the simulated mono reception. 0% is unchanged stereo; 100% sends the same wet signal to left and right. Only 100% Mix makes the output fully mono.
- In C-QUAM, the wet signal is stereo when reception permits; the mono description above applies to Mono mode. Its FIR delay remains within the wet receiver path. Mix does not delay the dry signal to align it, so intermediate settings combine dry and wet signals with that timing difference.

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

## Bit Crusher

An effect that recreates the sound of vintage digital devices like old gaming consoles and early samplers. Perfect for adding retro character or creating a lo-fi atmosphere.

### Sound Character Guide
- Retro Gaming Style:
  - Creates classic 8-bit console sounds
  - Perfect for video game music nostalgia
  - Adds pixelated texture to the sound
- Lo-Fi Hip Hop Style:
  - Creates that relaxing, study-beats sound
  - Warm, gentle digital degradation
  - Perfect for background listening
- Creative Effects:
  - Create unique glitch-style sounds
  - Transform modern music into retro versions
  - Add digital character to any music

### Parameters
- **Bit Depth** - Controls how "digital" the sound becomes (4 to 24 bits)
  - 4-6 bits: Extreme retro gaming sound
  - 8 bits: Classic vintage digital
  - 12-16 bits: Subtle lo-fi character
  - Higher values: Very gentle effect
- **TPDF Dither** - Makes the effect sound smoother
  - On: Gentler, more musical sound
  - Off: Raw, more aggressive effect
- **ZOH Frequency** - Affects the overall clarity (4000Hz to 96000Hz)
  - Lower values: More retro, less clear
  - Higher values: Clearer, more subtle effect
- **Bit Error** - Adds vintage hardware character (0.00% to 10.00%)
  - 0%: No DAC bit-weight mismatch; Random Seed has no audible effect
  - 0.1-1%: Subtle digital DAC coloration
  - 1-3%: Classic hardware imperfections
  - 3-10%: Creative lo-fi character
- **Random Seed** - Controls the unique character of imperfections (0 to 1000)
  - Changes the fixed imperfection pattern used by Bit Error
  - Audible only when Bit Error is above 0%
  - Same value always recreates the same imperfection pattern

## Cassette Artifacts

Cassette Artifacts records the music onto a modeled compact cassette and plays it back. The signal passes through the Dolby encoder, the record amplifier with the treble lift and the bounded low-frequency boost it puts onto the tape, the magnetic saturation of the coating, the treble erasure caused by the record bias, the wavelength losses of the reproduce head, local dropouts in the coating, the wow and flutter of the transport, the drifting head azimuth of the deck, the head contour of the reproduce head, and the playback curve that takes the treble lift off again, before tape hiss and modulation noise are added and the Dolby decoder runs. Use it when you want music that has been through a cassette deck rather than music with cassette-like noise placed on top of it.

### How It Differs from Other Lo-Fi Effects

- **Tape Artifacts** models an open-reel studio machine, and the difference between the two is the difference between the formats. At their defaults, with a small signal on a 96 kHz host, the cassette is 2.0 dB down at 8 kHz, 4.4 dB at 12 kHz and 7.9 dB at 16 kHz where the open-reel machine is 0.7, 1.7 and 3.5 dB down. With noise reduction off the cassette's background is also the louder of the two - -65.5 dBFS against the open-reel machine's -68.5 dBFS - and with Dolby B or C it drops below it, to -73.6 and -82.8 dBFS, the same relationship the real formats have. Speed is a control there and a fixed 4.76 cm/s here, and Deck Grade, the Type I/II/IV columns, Dolby B/C, the dropouts, the head azimuth and the Dolby level error exist only here.
- **Wow Flutter** (Modulation) reproduces only the speed variation of a transport. Choose it when you want the wobble without tape saturation, the Type and bias behavior, the noise reduction, or the hiss.
- **Saturation** and **Hard Clipping** add nonlinearity on its own, without the frequency-dependent behavior and the transport of a tape machine.
- **Vinyl Artifacts**, **Noise Blender** and **Hum Generator** add a noise layer over unchanged music. Here the hiss, the modulation noise and the dropouts are generated at the correct point in the deck, so the noise reduction acts on them and they follow Tape Type and Hiss the way real cassette noise does.

### Sound Character Guide

- **Deck Grade sets the class of machine:** it moves the band edges and the short-term stability together, and nothing else. Measured at the reference bias with a small signal on a 96 kHz host, the -3 dB points run 13.6 Hz to 18.0 kHz on Reference, 16.7 Hz to 14.0 kHz on Hi-Fi, 19.9 Hz to 10.0 kHz on Consumer and 26.1 Hz to 6.5 kHz on Portable. At 16 kHz that is 2.4, 4.0, 7.8 and 16.7 dB down. The azimuth wobble grows with the same order - none at all on Reference, which is the class of deck that carries an azimuth servo, and largest on Portable, where the top end visibly breathes.
- **Record Level is the operating point, not a gain:** it states how hard a 0 dBFS peak drives the tape, and the output level does not move with it. What moves is everything else. At the default +9.0 dB, a full-scale 1 kHz tone comes out 3.6 dB rounded off with about 6% third harmonic, and on a dense modern master the top 6 dB of the material comes out as about 4.2 dB. At +0.0 dB the same material comes out almost uncompressed (the top 6 dB stays 5.9 dB) and the tape is never used; by +15.0 dB the top 6 dB has collapsed to about 1.9 dB. The background follows it one decibel for one decibel in the other direction, so raising Record Level buys signal-to-noise and spends dynamic range.
- **Bass hits the ceiling first:** the record side has to boost everything below 50 Hz to get it onto the tape, and that boost has a ceiling set by Deck Grade, so deep bass reaches saturation before the midrange does. On a Consumer deck at Record Level +12.0 dB, a full-scale tone comes out 7.8 dB down at 20 Hz and 5.4 dB down at 40 Hz against 3.3 dB at 315 Hz. The same asymmetry is why the low end rolls off at all.
- **Tape Type is not a volume switch:** a small 1 kHz signal comes out within 0.01 dB of the same level on all three. What changes is headroom and noise. Type IV has the most high-frequency headroom - its 10 kHz saturation output is 6.5 dB above Type II and its 315 Hz maximum output level 1 dB above - and at the default Record Level it keeps about 4.9 dB more at 10 kHz than Type II on a -6 dBFS tone, and about 7.5 dB more on a full-scale one; its own noise floor, though, is 2.5 dB worse than Type II. Type I is the noisiest of the three, 4 dB above Type II, and colors small signals exactly as Type II does, so most of what you hear from it is the extra background.
- **Noise reduction is a matched round trip:** the same sliding-band compander encodes before the tape and expands after it, so under ideal conditions the music comes back out. The quieting is the measured, effective figure rather than the nominal 10 and 20 dB: about 8 dB for Dolby B and about 17 dB for Dolby C, A-weighted, at the default settings. The price is treble mistracking at high levels, where the decoder reads tape-compressed high frequencies as a quieter signal and turns them down further; Dolby C's anti-saturation shelves reduce it, and at the default Record Level C keeps about 3.9 dB more than B on a 10 kHz tone at -6 dBFS, and about 8.4 dB more on a full-scale one.
- **The top octave is the deck's limit:** at the reference bias, with a small signal on a 96 kHz host, the default Consumer deck measures +1.1 dB at 50 Hz (the head contour), 0.0 dB at 1 kHz, -0.8 dB at 5 kHz, -3.0 dB at 10 kHz and -7.8 dB at 16 kHz, and -2.9 dB at 20 Hz. That gentle low-frequency lift over a falling low end and that falling top are the deck's own response, before anything is driven hard.
- **The transport is slower and larger than an open reel's:** a capstan wow at 6.9 Hz, a hub rotation at 0.42 Hz and broadband flutter between 1 and 40 Hz. At the default 0.200% the pitch moves about 9 cents peak to peak, right at the 5 to 10 cents where frequency modulation starts to be heard as such, so the wobble is audible on held notes and masked in dense program; 0.040% is the figure a reference deck publishes and moves only about 2 cents, and the 1.000% top of the range gives about 46 cents, a strong warble.
- **A living background:** hiss in the gaps, plus modulation noise that rides on the music itself, about 48, 50 and 52 dB below the signal on Type I, Type II and Type IV. Take Hiss all the way down to -92.0 dB re 250 nWb/m when you want a silent background.
- **Dropouts are losses, not clicks:** each event is a smooth raised-cosine dip of 2.1 to 21 ms and 3 to 30 dB rather than a gate, and the depth draw is weighted toward the shallow end, so what you usually hear is the music briefly ducking rather than a tick. The default 2.0 events/min is about one every half minute on any single track.
- **Azimuth and Dolby Level Error are the compatibility axes:** both are signed, and their sign is the point. Azimuth darkens the top on both channels and puts a lag between them, and which channel leads follows its sign. A Dolby Level Error above zero makes the decoder cut too little, so the result is brighter and hissier; below zero it cuts too much and the result is duller.

### Parameters

Speed is stated rather than selected: the compact cassette runs at 4.76 cm/s (1⅞ ips) by definition, so it is not a control and the status line at the bottom of the panel names it once, as part of the Wow/Flutter readout.

- **Deck Grade** (Reference, Hi-Fi, Consumer or Portable) - Selects the class of the deck. It governs only the mechanisms that have no control of their own: the record equalization budget that flattens the head's wavelength loss, the record amplifier's bandwidth, the ceiling on the low-frequency record boost, the size of the azimuth wobble and the shape of the head contour. It never touches Wow/Flutter, Hiss or Dropouts, so changing it can never discard your own settings. The band edges, measured with a small signal on a 96 kHz host, are 13.6 Hz to 18.0 kHz (Reference), 16.7 Hz to 14.0 kHz (Hi-Fi), 19.9 Hz to 10.0 kHz (Consumer) and 26.1 Hz to 6.5 kHz (Portable), and the azimuth wobble runs 0, 1, 2 and 4 arcmin of standard deviation over the same four. Reference has no wobble at all, because a deck of that class carries an azimuth servo. The default Consumer is an ordinary domestic machine.
- **Tape Type** (Type I, Type II or Type IV) - Selects the tape formulation: ferric, high-bias and metal. This is a headroom and noise profile, not an equalizer preset and not a level control - a small 1 kHz signal comes out within 0.01 dB of the same level on all three. Type II is the reference column: Type I sits 4.0 dB noisier and Type IV 2.5 dB noisier, while Type IV has 6.5 dB more high-frequency headroom and 1 dB more low-frequency headroom than Type II. Each Type also has its own recommended bias point, so Bias 0 dB means a correctly aligned deck whichever one is selected.
- **Noise Reduction** (Off, Dolby B or Dolby C) - Selects the companding noise reduction. This is always a matched encode/decode round trip - the same sliding-band law records and plays back - so it quiets the tape without changing the music under ideal conditions. Dolby B is a single sliding band and Dolby C two staggered ones with anti-saturation shelves; the quieting they deliver here is measured rather than nominal, about 8 dB for B and about 17 dB for C, and it depends on Tape Type, Hiss, Dolby Level Error and the host sample rate, which is why the status line reports the figure for the current settings. Both also mistrack loud treble the way a real deck does, and Dolby C mistracks less than Dolby B.
- **Bias** (-6.0 to +6.0 dB) - Sets the recording bias relative to the recommended point for the selected Tape Type. 0 dB is the correctly aligned deck: it sits 2.5 dB (Type I), 3.0 dB (Type II) or 2.0 dB (Type IV) over the peak of the 10 kHz sensitivity curve, which is where a deck is aligned. Higher (over-biased) settings are cleaner in the low and mid range and duller on top: at +2.0 dB the 10 kHz sensitivity falls 1.67, 1.81 and 1.52 dB on the three Types, and at +6.0 dB it falls 5.31, 5.71 and 4.86 dB. Lower (under-biased) settings are brighter and more distorted, in the way a misaligned deck is, but only down to that peak - about -3.6 dB on Type I, -3.9 dB on Type II and -3.2 dB on Type IV, worth about +2.5, +3.0 and +2.0 dB at 10 kHz - and below it the treble darkens again while the distortion keeps rising, so -6.0 dB is already less bright than -4.0 dB. At 1 kHz the whole range moves less than 0.2 dB, so Bias is not a volume control.
- **Record Level** (-12.0 to +18.0 dB) - Sets how hard the deck records. The number is the tape level a 0 dBFS peak reaches, in dB above the 250 nWb/m reference flux, and the status line states that convention. The control adds no gain of its own: as long as the tape is not saturating, the same signal comes out at the same level wherever Record Level is set, so what it changes is the tape, not the volume. The default +9.0 dB is a normally recorded cassette, where a full-scale 1 kHz tone comes out 3.6 dB rounded off with about 6% third harmonic and the deep bass is already into the ceiling. Lower settings back off toward a transfer that never uses the tape - at +0.0 dB a full-scale tone loses only 0.5 dB - and raise the background one decibel for every decibel, since the hiss is on the tape and the tape is now further below the peak. Higher settings compress harder and quiet the background by the same rule; past about +15.0 dB the dynamic range stops widening and only the compression keeps growing.
- **Wow/Flutter** (0 to 1%) - Sets the speed variation of the transport, as a DIN 45507 peak-weighted deviation in percent at the fixed 4.76 cm/s. 0% is a perfectly steady transport. The default 0.200% sits in the middle of the 0.15 to 0.25% window ordinary cassette decks publish and moves the pitch about 9 cents peak to peak, right at the 5 to 10 cents where frequency modulation begins to be heard as such. 0.040% is the weighted peak a reference deck publishes and moves only about 2 cents; the 1.000% top of the range gives about 46 cents, a strong warble. The movement is slower here than on an open-reel machine, because the hub rotation at 0.42 Hz dominates it.
- **Hiss** (-92.0 to -42.0 dB re 250 nWb/m) - Sets the level of the tape hiss and the modulation noise together, as the A-weighted no-signal flux of Type II with noise reduction off, referred to the 250 nWb/m reference. This is the tape's own datasheet figure rather than a level at the output: the noise is recorded on the tape, so what it measures at the output depends on Record Level. -92.0 dB re 250 nWb/m switches both off completely. The default -60.5 dB re 250 nWb/m is the bias noise the manufacturer publishes for a Type II tape. Type I sits 4.0 dB above that column and Type IV 2.5 dB above it, Record Level moves the whole thing one decibel for one decibel, and the Dolby decoder then removes its own measured amount, so what you hear in the gaps is not this number - the status line states what it comes to. All of it is ahead of Output, so a meter placed after Output reads it lifted by whatever Output is set to. While the music plays, what this control mostly adds is the modulation noise riding on the signal.
- **Dropouts** (0 to 20 events/min) - Sets the average rate of coating dropouts, counted per track: whichever single channel you meter, it sees this many events per minute. Half of them are tape-wide and affect every channel together, half are local to one track. Each event is a smooth raised-cosine dip of 2.1 to 21 ms and 3 to 30 dB rather than a gate, so it sounds like a brief loss of signal, not a click. The default 2.0 events/min is a cassette in ordinary service, about one event every half minute on any one track; 0 is a flawless tape and adds nothing at all, and the 20 events/min top is three times the quality-control bound a premium cassette publishes, which is clearly degraded-tape territory.
- **Azimuth** (-6.0 to +6.0 arcmin) - Sets the head alignment error between the deck that recorded the tape and the deck playing it. It is not a quality grade but the alignment state of that particular pair of machines, which is why it is signed and independent of Deck Grade. Any error costs treble on both channels: at the default +2.0 arcmin a 10 kHz tone loses 0.25 dB and a 16 kHz tone 0.60 dB against a perfectly aligned pair, and at ±6.0 arcmin that becomes 1.03 and 2.26 dB. It also puts a lag of 11.0 µs between the channels at +2.0 arcmin, and the sign decides which channel leads, so a mono sum of correlated material loses a further 0.8 dB at 8 kHz, 1.8 dB at 12 kHz and 3.2 dB at 16 kHz; uncorrelated material shows no such comb. Deck Grade adds a slow drift on top of this setting, so Azimuth is the centre the drift wanders around rather than a frozen value.
- **Dolby Level Error** (-3.0 to +3.0 dB) - Sets how far the playback deck's Dolby reference sits from the recording deck's. It only means anything with Noise Reduction on, and its sign is the point: above zero the decoder reads the tape as hotter than it is, cuts too little, and the result is brighter and hissier; below zero it cuts too much and the result is duller. At the default deck a mid-level tone moves about 2.4 dB down at 5 kHz and 1.0 dB down at 10 kHz at -3.0 dB, and about 1.9 dB up at 5 kHz and 2.2 dB up at 10 kHz at +3.0 dB. 0.0 dB is two decks calibrated to each other. The mistracking on loud treble is there at every setting, because the tape itself changes the signal between encode and decode; what this control opens is the bright side, which a matched pair cannot reach.
- **Output** (-24.0 to +24.0 dB) - Adjusts the level after the whole chain. Use it to match loudness when you compare with bypass, or to bring back the loudness a high Record Level setting has cost.
- **Mix** (0 to 100%) - Blends the cassette signal with the original. 100% is full cassette playback. The dry signal is delay-aligned with the tape path, so the midrange blends cleanly - 1 kHz stays within 0.06 dB of unity at 50% - but the top octave does not, because dry and tape no longer share the same phase up there and partly cancel. That cancellation is not the same on both channels, because the azimuth error puts a lag between them: at 50% at the default settings on a 96 kHz host the left channel comes out 1.7 dB down at 8 kHz, 3.6 dB at 12 kHz, 5.3 dB at 16 kHz and 6.2 dB at 20 kHz, while the right channel is 4.4, 8.9, 9.0 and 7.0 dB down at the same frequencies. At 0% the input passes through completely unchanged and the effect adds no latency; at any other setting it adds 165 samples (3.741 ms) on a 44.1 kHz host, 179 (3.729 ms) at 48 kHz, 347 (3.615 ms) at 96 kHz and 683 (3.557 ms) at 192 kHz.

### Reading the Status Line

The line under the controls states the Record Level convention and reports what the two Base settings come to on the deck as it is currently configured, in the form `Record Level +9.0 dB → tape peak +9.0 dB re 250 nWb/m at 0 dBFS in · Wow/Flutter Base 0.200% → 0.200% at 4.76 cm/s (1⅞ ips) · Hiss Base -60.5 dB re 250 nWb/m → -73.6 dBFS, Type I, Dolby B`.

- **Record Level** restates the control as what it means on the tape: the flux a 0 dBFS peak reaches. It is a statement of the convention, not a meter - there is none, and a quieter master lands correspondingly lower on the tape.
- **Wow/Flutter** states the Base value and the effective one. The speed is fixed, so the two are always the same figure; the line is there to name the measurement convention the percentage belongs to, and it is the one place the transport speed is stated.
- **Hiss** states the Base value and the no-signal A-weighted floor it becomes at the output, after the Tape Type column, Record Level and the Dolby decoder, before Output. With Hiss at -92.0 dB re 250 nWb/m the whole noise family is off and the line reads `→ off`.
- The effective floor is measured, not derived from the nominal 10 and 20 dB of Dolby B and C, and it depends on Tape Type, noise reduction, Hiss, Dolby Level Error, Record Level and the host sample rate together. With Hiss at its -60.5 dB re 250 nWb/m default and Record Level at +9.0 dB, on a 96 kHz host, it comes to:

  | Tape Type | NR Off | Dolby B | Dolby C |
  |---|---|---|---|
  | Type I | -65.5 dBFS | -73.6 dBFS | -82.8 dBFS |
  | Type II | -69.5 dBFS | -77.7 dBFS | -87.0 dBFS |
  | Type IV | -67.0 dBFS | -75.2 dBFS | -84.4 dBFS |

  Record Level shifts the whole table one decibel for one decibel: at +12.0 dB every figure is 3 dB lower, at +6.0 dB every figure is 3 dB higher. How much the Dolby decoder removes does not change with it, because the tape floor and the decoder's own reference move together.
- Each combination is measured once and then remembered, so the figure appears immediately for any setting you have already visited. While you drag Hiss or Dolby Level Error through combinations that have not been measured yet, the line reads `measuring…` and fills in the number once the control stops - announcing a settled-looking figure that is several decibels out would be worse than announcing nothing.

### Recommended Settings

1. **Ordinary Cassette Deck (default)**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Dolby B, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.200%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 2.0 events/min, Azimuth: +2.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - The everyday cassette sound, and the plugin's own default: the top softened by 7.9 dB at 16 kHz, a 1.1 dB lift around 50 Hz over a low end that is already 2.9 dB down at 20 Hz, about 6% third harmonic and 3.6 dB of rounding on a full-scale tone, a -73.6 dBFS background on a 96 kHz host, pitch movement of about 9 cents, and a dropout about every half minute on each track.

2. **Reference Deck, Metal Tape with Dolby C**
   - Deck Grade: Reference, Tape Type: Type IV, Noise Reduction: Dolby C, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.040%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 0.0 events/min, Azimuth: 0.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - The most capable combination the format offers: a Reference deck reaches -3 dB at 18.0 kHz and does not drift at all, Type IV brings 6.5 dB more high-frequency headroom than Type II, and the background sits at -84.4 dBFS on a 96 kHz host. Type IV's own tape floor is 2.5 dB worse than Type II's - it is Dolby C that makes this the quietest setting here, and it is also the setting that mistracks loud treble least. With the wobble, the hiss, the dropouts and the azimuth drift all switched off, this deck is entirely deterministic.

3. **Ferric Tape, No Noise Reduction**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Off, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.200%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 2.0 events/min, Azimuth: +2.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - A plain ferric tape recorded without noise reduction: the background sits at -65.5 dBFS on a 96 kHz host, 8.1 dB louder than the default, and nothing removes it, so hiss is part of the sound in every gap. The tone is exactly the default's for small signals - the difference between the Types is noise and headroom, not color - and nothing mistracks, because there is no decoder to mistrack.

4. **Home Deck, Slightly Over-Biased**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Dolby B, Bias: +2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.300%, Hiss: -58.0 dB re 250 nWb/m, Dropouts: 4.0 events/min, Azimuth: +3.0 arcmin, Dolby Level Error: -1.0 dB, Output: +0.5 dB, Mix: 100%
   - An ordinary domestic deck running generic tape, and a tape recorded on a different one: the bias set a little high, so the top is about 1.7 dB darker at 10 kHz than an aligned deck and the low and mid range a little cleaner, a less steady transport, a raised tape floor, a dropout every quarter minute or so per track, a wider azimuth error, and a decoder calibrated 1 dB low, which darkens it further. Record Level is 3 dB above the default, so the top 6 dB of a dense master comes out as about 3.1 dB and Output goes slightly up to pay for the compression. The status line reports what the raised Hiss setting comes to after Type I, Dolby B and the Record Level.

5. **Portable, Worn Tape**
   - Deck Grade: Portable, Tape Type: Type I, Noise Reduction: Off, Bias: -2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.480%, Hiss: -54.0 dB re 250 nWb/m, Dropouts: 8.0 events/min, Azimuth: +4.0 arcmin, Dolby Level Error: 0.0 dB, Output: +1.0 dB, Mix: 100%
   - An intentionally degraded lo-fi effect. A Portable deck reaches -3 dB at 6.5 kHz and 26 Hz and drifts twice as much as the default one; the bias is under the aligned point, which brightens 10 kHz by about 1.6 dB and adds distortion with it; the transport is well past the point where the wobble is obvious; the tape is loud and noisy; the azimuth is badly out; and dropouts arrive several times a minute on every track. Record Level is high enough that the bass is firmly into the ceiling, and Output brings the loudness back.

### Model Notes

The effect models one recording and playback pass on a deck running at the fixed 4.76 cm/s of the compact cassette. The record side lifts the treble before the tape and the playback side takes exactly the same lift off again, rather than following a published reproduce standard; the low-frequency half of the curve is deliberately not symmetric, because the record-side boost a real deck applies below 50 Hz has a ceiling, and that ceiling is what produces both the low-frequency rolloff and the bass reaching saturation first. Deck Grade governs only the mechanisms that have no control of their own, so it never changes Wow/Flutter, Hiss or Dropouts. The azimuth wobble is a bounded process that is pulled back to the Azimuth setting rather than a random walk, and Reference has none at all, because a deck of that class carries an azimuth servo; with Wow/Flutter at 0, Hiss off, Dropouts at 0 and Deck Grade at Reference, nothing random runs at all. Dolby B and Dolby C are modeled as matched sliding-band companders and always run as a complete encode and decode round trip; there is no encode-only or decode-only operation, and no claim of conformance to, or certification against, any noise-reduction specification. Dolby Level Error offsets the decoder's reference only, which is the calibration difference between two decks, not a second processing stage. Type III tapes, microcassette and Elcaset formats, other tape speeds, pitch control, auto-reverse, print-through, splice noise, motor hum, shell and mechanism noise, and bleed from the opposite side are outside this model. No public per-tape dropout statistics exist, so the dropout rate range, durations and depths are a calibrated model constrained by a published quality-control bound rather than a transcription of measured data. The tape path carries 165 samples (3.741 ms) of transport and processing delay on a 44.1 kHz host, falling to 683 samples (3.557 ms) on a 192 kHz one; at Mix 0% the input is passed through bit-exactly with no delay at all. The tone figures quoted above are measured on a 96 kHz host at the reference 0.0 dB Bias. This effect costs about one and a half times as much as Tape Artifacts.

## Digital Error Emulator

An effect that simulates the sound of digital audio transmission errors, from faint interface clicks to vintage CD player imperfections and wireless dropouts. Use it when you want nostalgic digital character or obvious glitch texture during listening.

### Sound Character Guide
- Subtle Digital Playback Character:
  - Simulates S/PDIF, AES3, and MADI transmission artifacts
  - Adds faint, occasional digital imperfections
  - Useful when clean playback feels too perfect
- Consumer Digital Dropouts:
  - Recreates classic CD player error correction behavior
  - Simulates USB audio interface glitches
  - Great for 90s/2000s digital music nostalgia
- Streaming & Wireless Audio Artifacts:
  - Simulates Bluetooth transmission errors
  - Network streaming dropouts and artifacts
  - Modern digital life imperfections
- Creative Digital Textures:
  - RF interference and wireless transmission errors 
  - HDMI/DisplayPort audio corruption effects
  - Unique experimental sound possibilities

### Parameters
- **Bit Error Rate** - Controls how often errors occur (10^-12 to 10^-2) 
  - Very Rare (10^-10 to 10^-8): Subtle occasional artifacts
  - Occasional (10^-8 to 10^-6): Classic consumer equipment behavior
  - Frequent (10^-6 to 10^-4): Noticeable vintage character
  - Extreme (10^-4 to 10^-2): Creative experimental effects
  - Default: 10^-6 (typical consumer equipment)
- **Mode** - Selects the type of digital transmission to simulate
  - AES3/S-PDIF: Professional interface bit errors with sample hold
  - ADAT/TDIF/MADI: Multi-channel burst errors (hold or mute)
  - HDMI/DP: Display audio row corruption or muting
  - USB/FireWire/Thunderbolt: Micro-frame dropouts with interpolation
  - Dante/AES67/AVB: Network audio packet loss (64/128/256 samples)
  - Bluetooth A2DP/LE: Wireless transmission errors with concealment
  - WiSA: Wireless speaker FEC block errors
  - RF Systems: Radio frequency squelch and interference
  - CD Audio: CIRC error correction simulation
  - Default: CD Audio — CIRC Error Correction (Interpolated)
- **Reference Fs (kHz)** - Sets the reference sample rate used only by Dante / AES67 / AVB packet-loss modes to scale the 64/128/256-sample packet length
  - Available rates: 44.1, 48, 88.2, 96, 176.4, 192 kHz
  - Other modes use their own fixed or current-sample-rate timing
  - Default: 48 kHz
- **Wet Mix** - Controls the blend between original and processed audio (0-100%)
  - Note: For realistic digital error simulation, keep at 100%
  - Lower values create unrealistic "partial" errors that don't occur in real digital systems
  - Default: 100% (authentic digital error behavior)

### Mode Details

**Professional Interfaces:**
- AES3/S-PDIF: Single-sample errors with previous sample hold 
- ADAT/TDIF/MADI: 32-sample burst errors - either hold last good samples or mute
- HDMI/DisplayPort: 192-sample row corruption with bit-level errors or complete muting

**Computer Audio:**
- USB/FireWire/Thunderbolt: Micro-frame dropouts with interpolation concealment
- Network Audio (Dante/AES67/AVB): Packet loss with different size options and concealment

**Consumer Wireless:**
- Bluetooth A2DP: Post-codec transmission errors with warble and decay artifacts
- Bluetooth LE: Enhanced concealment with high-frequency filtering and noise
- WiSA: Wireless speaker FEC block muting

**Specialized Systems:**
- RF Systems: Variable-length squelch events simulating radio interference
- CD Audio: CIRC error correction simulation with Reed-Solomon-style behavior

### Recommended Settings for Different Styles

1. Subtle Digital Playback Character
   - Mode: AES3 / S-PDIF (I²S) — Bit Error (Hold), BER: 10^-8, Fs: 48kHz, Wet: 100%
   - Perfect for: Adding faint, occasional digital imperfections

2. Classic CD Player Experience
   - Mode: CD Audio — CIRC Error Correction (Interpolated), BER: 10^-7, Fs: 44.1kHz, Wet: 100%
   - Perfect for: 90s digital music nostalgia

3. Modern Streaming Glitches
   - Mode: Dante / AES67 / AVB — UDP Drop (128 samp), BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfect for: Contemporary digital life imperfections

4. Bluetooth Listening Experience
   - Mode: Bluetooth A2DP — Digital Transmission, BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfect for: Wireless audio memories

5. Wireless Dropout Texture
   - Mode: WMAS / DECT / Axient — RF Squelch, BER: 10^-5, Fs: 48kHz, Wet: 100%
   - Perfect for: Obvious radio-style interruptions and glitch texture

Note: All recommendations use 100% Wet Mix for realistic digital error behavior. Lower wet mix values can be used for creative effects, but they don't represent how real digital errors actually occur.

## DSD64 IMD Simulator

An effect that recreates a subtle, often-debated side effect of DSD64 playback: the ultrasonic noise that DSD carries above the audible range can, through the small imperfections of real DACs, amplifiers, and speakers, create intermodulation distortion (IMD) — extra grit and tones that fall back down into the range you can hear. This effect reproduces that audible result so you can hear and adjust it. It is a simulation and does not generate a real DSD stream.

**This effect requires a sample rate of 88.2 kHz or higher** (88.2 / 96 / 176.4 / 192 kHz). At 44.1 / 48 kHz it cannot work and is bypassed (the dry signal passes through unchanged) with a warning shown. Set the sample rate to 88.2 kHz or higher in the app's audio settings to use this effect.

### Sound Character Guide
- Very subtle "digital grit": a faint, constant sandy noise floor plus a fine harshness that follows the music.
- Demonstration tool: makes the usually-inaudible DSD64 ultrasonic IMD audible and adjustable.
- Creative texture: with higher Amount and Analog Nonlinearity it becomes an obvious lo-fi scratch/edge effect.

### Parameters

Main parameters
- **Amount** (-40.0 to +50.0 dB) - Overall level of the generated distortion.
- **Dry-Wet** (100:0 to 0:100) - Balance of dry signal to generated distortion, shown as a dry:wet ratio. 100:0 = dry only; 100:100 (center) = full dry plus full distortion; 0:100 = distortion only.
- **Ultrasonic Level** (-48.0 to -18.0 dBFS RMS) - Level of the simulated DSD ultrasonic noise. More noise produces more distortion.
- **Noise Color** (-100 to +100%) - Moves the ultrasonic noise lower or higher in frequency and tilts its balance.
- **Analog Nonlinearity** (0.00 to 10.00%) - How imperfect (non-linear) the simulated analog gear is. Higher values produce more distortion.
- **Even Bias** (0 to 100%) - Balances the make-up of the distortion. Lower values favor distortion that follows the music (Attached); higher values favor the constant, noise-like distortion (Additive) plus the Cross component.
- **Signal Coupling** (0 to 200%) - Strength of the music-dependent distortion (Attached and Cross). At 0, only the constant Additive noise remains.
- **IMD Path HPF** (0.0 to 8.0 kHz) - Limits distortion generation to frequencies above this point. 0.0 = Off (full-range, like an amplifier); around 2.5 kHz emulates a system where only the tweeter produces the distortion. The dry signal is never affected.
- **Scratch Tone** (3.0 to 14.0 kHz) - Center frequency of the audible "scratch" character.

Advanced / utility parameters
- **Noise Texture** (0 to 100%) - Adds resonant ripple to the ultrasonic noise for a slightly different texture.
- **Cross Sideband** (0 to 100%) - Amount of distortion created by the music mixing with the ultrasonic noise.
- **Output Trim** (-24.0 to +12.0 dB) - Final output level adjustment.

### Visualizations
- **Term Contribution meters** - Real-time levels of each part of the effect:
  - **Additive** - the constant noise-only distortion, present even with no input.
  - **Attached** - distortion that sticks to and follows the music.
  - **Cross** - distortion from the music mixing with the ultrasonic noise.
  - **Total IMD** - the combined distortion that is generated.
  - **Output** - the final output level (dry plus distortion, after Dry-Wet and Output Trim).
- **Analog Transfer Curve** - Shows the distortion curve created by Analog Nonlinearity and Even Bias, in the same in/out style as the Saturation plugins.
- **Difference-Frequency view** - A static graph showing which audible frequencies the ultrasonic noise produces, based on the current noise settings.

### Recommended Settings
- Subtle (default): Amount +24 dB, Ultrasonic Level -30 dBFS, Analog Nonlinearity 1.40%, Even Bias 20%, Signal Coupling 150%, Cross Sideband 75%, Scratch Tone 10.5 kHz.
- Tweeter-only IMD: IMD Path HPF 2.5 kHz, Signal Coupling 80–150%, Cross Sideband 50–100%, Scratch Tone 9–14 kHz.
- Obvious effect: raise Amount, Ultrasonic Level, and Analog Nonlinearity.

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

## G.726 Simulator

G.726 Simulator passes the selected mono channel or stereo pair through a real ITU-T G.726 encode/decode round trip at an 8 kHz codec rate. A stereo pair is combined to mono before encoding, and the decoded signal is sent to both selected channels. Use it to hear the bandwidth, adaptive differential quantization, and prediction-error character of digital telephone speech coding. With Bit Error Rate at its default the path stays completely clean; raising it adds the bit errors of a wireless link such as DECT.

The four modes are the standard G.726 rates: 16, 24, 32, and 40 kbit/s. The default 32 kbit/s setting is the historical DECT full-slot speech mode. Lower rates spend fewer bits on each 8 kHz sample and make granular quantization, rough sustained tones, and slope overload more apparent. The codec is designed for speech, so full-band music exposes its limits strongly.

This effect requires its WebAssembly processing engine. If that engine or the selected sample-rate/channel mode is unavailable, the input remains unchanged and the plugin shows a plain-language status message. When processing resumes after suspension, the resamplers and codec prediction state restart together so buffered pre-suspension audio is not replayed.

### Sound Enhancement Guide

- **Representative telephone speech:** Start with 32 kbit/s, Output at 0 dB, and Mix at 100%. Spoken voice reveals the narrow 8 kHz path and characteristic adaptive-ADPCM texture while staying close to the historically common operating point.
- **Compare rate-dependent artifacts:** Switch between 40, 32, 24, and 16 kbit/s on the same speech passage. At lower rates, listen for coarser vowels, rougher sustained tones, and slower recovery after abrupt level changes.
- **Expose the codec with music:** Use percussion, bright sustained notes, or dense mixes at 16 or 24 kbit/s. These sources stress a speech-oriented predictor and make bandwidth and prediction-error artifacts easier to identify.
- **Add radio bit errors:** Raise Bit Error Rate toward -4.5 to -2 to hear code words break up into crackling and rough patches. Leave it at -6 for a clean encode/decode comparison.
- **Blend the effect:** Reduce Mix when you want some codec character without replacing the entire signal. The dry path is delayed to align with the decoded path, avoiding a separate comb-filter effect.
- **Match levels before comparing:** Adjust Output only to compensate for perceived or measured loudness differences. It does not change the G.726 bit allocation.

### Parameters

- **Bitrate** — Selects the standard G.726 rate: 16, 24, 32, or 40 kbit/s. Each 8 kHz sample uses 2, 3, 4, or 5 ADPCM bits respectively. Lower settings increase quantization and predictor-error artifacts; higher settings preserve the reconstructed waveform more closely.
- **Output** — Adjusts the decoded output level from -24.0 to +12.0 dB. Use it for level matching; it does not alter the codec state or bitrate.
- **Mix** — Blends the latency-aligned original with the decoded result from 0% to 100%.
- **Bit Error Rate** — Sets the wireless-link bit error rate as a power of ten, from -6 to -2 (default -6). At -6 the codec path is effectively error-free. Higher settings flip more bits inside the ADPCM code words, producing the crackling that a weak DECT-style radio link causes.

## GSM-FR Simulator

When the audio output has one channel, GSM-FR Simulator processes that channel directly. With two or more output channels, it combines the selected stereo pair to mono. It then resamples the mono signal to 8 kHz and passes it through the standardized 13 kbit/s GSM-FR RPE-LTP encoder and decoder. The decoded result returns to the single output channel or to both channels of the selected pair. Use it to examine how early digital mobile speech coding changes voices, percussion, sustained tones, and dense music. With C/I at its default the path stays completely clean; lowering it reproduces poor GSM reception.

Each 20 ms frame is represented by quantized linear-prediction, long-term-prediction, and regular-pulse-excitation parameters. Transcodes repeats the complete encode/decode stage with independent state, reproducing tandem coding rather than acting as a generic quality control. Additional channels beyond the selected stereo pair remain unchanged.

This effect requires its WebAssembly processing engine. If that engine or the selected sample-rate/channel mode is unavailable, the input remains unchanged and the plugin shows a plain-language status message. When processing resumes after suspension, the resamplers, frame buffers, and codec state restart together so buffered pre-suspension audio is not replayed.

### Sound Enhancement Guide

- **Representative early-mobile speech:** Set Transcodes to 1, Output to 0 dB, and Mix to 100%, then compare voices, cymbals, and percussion with bypass.
- **Hear tandem coding:** Keep the same passage and change Transcodes from 1 to 2 to 3. Warble, chirping, and loss of clarity increase because the signal is genuinely encoded and decoded again. Radio reception errors are separate: at the default C/I of 30 dB there are none, and lowering C/I reproduces them.
- **Expose the speech model with music:** Use Transcodes 3 on bright or dense music to make the 8 kHz speech bandwidth, RPE-LTP buzz, and formant reshaping easier to identify.
- **Blend the result:** Lower Mix to restore some of the original stereo signal. The dry path is aligned to the codec latency.
- **Match levels before comparing:** Adjust Output only to compensate for perceived or measured loudness differences. It does not change the codec algorithm.

### Parameters

- **Transcodes** — Selects 1, 2, or 3 complete GSM-FR encode/decode passes. Every pass has independent state and uses the same 13 kbit/s codec. Higher settings increase tandem-coding artifacts.
- **Output** — Adjusts the decoded output level from -24.0 to +12.0 dB. Use it for level matching; it does not alter the codec state or bit rate.
- **Mix** — Blends the latency-aligned original with the decoded result from 0% to 100%. At 100%, a selected stereo pair carries the same decoded mono signal on both channels; lower settings restore the original stereo difference.
- **C/I** — Sets the carrier-to-interference ratio of the radio link from 4 to 30 dB (default 30). At 30 dB reception is effectively perfect. Lower values add frame erasures with GSM 06.11-style concealment (previous frame repeated and attenuated, muting after consecutive losses) plus Class 2 bit-error distortion, giving the ragged dropouts of a phone at the edge of coverage. With Transcodes above 1 the degradation is applied to the final hop only.

## Hum Generator

Adds a controllable 50/60 Hz electrical hum layer for a vintage, lo-fi listening mood. Use low levels when clean playback feels too sterile, or raise Level for an obvious sound-effect-like hum.

### Sound Character Guide
- Vintage Equipment Ambience:
  - Recreates the subtle hum of classic amplifiers and equipment
  - Adds the character of being "plugged in" to AC power
  - Creates a vintage playback atmosphere
- Power Supply Characteristics:
  - Simulates different types of power supply noise
  - Recreates regional power grid characteristics (50Hz vs 60Hz)
  - Adds subtle electrical infrastructure character
- Background Texture:
  - Creates organic, low-level background presence
  - Adds depth and "life" to very clean playback
  - Useful for a vintage or lo-fi listening mood

### Parameters
- **Frequency** - Sets the fundamental hum frequency (10-120 Hz)
  - 50 Hz: European/Asian power grid standard
  - 60 Hz: North American power grid standard  
  - Other values: Custom frequencies for creative effects
- **Type** - Controls the harmonic structure of the hum
  - Standard: Contains only odd harmonics (more pure, transformer-like)
  - Rich: Contains all harmonics (complex, equipment-like)
  - Dirty: Rich harmonics with subtle distortion (vintage gear character)
- **Harmonics** - Controls the brightness and harmonic content (0-100%)
  - 0-30%: Warm, mellow hum with minimal upper harmonics
  - 30-70%: Balanced harmonic content typical of real equipment
  - 70-100%: Bright, complex hum with strong upper harmonics
  - In Dirty mode, higher Harmonics also increases distortion and roughness
- **Tone** - Final tone shaping filter cutoff frequency (1.0-20.0 kHz)
  - 1-5 kHz: Warm, muffled character
  - 5-10 kHz: Natural equipment-like tone
  - 10-20 kHz: Bright, present character
- **Instability** - Amount of subtle frequency and amplitude variation (0-10%)
  - 0%: Perfectly stable hum (digital precision)
  - 1-3%: Slight natural drift
  - 3-10%: More noticeable but still gentle wobble
- **Level** - Output level of the hum signal (-80.0 to 0.0 dB)
  - -80 to -60 dB: Barely audible background presence
  - -60 to -40 dB: Subtle but noticeable hum
  - -40 to -20 dB: Prominent vintage character
  - -20 to 0 dB: Creative or special effect levels

### Recommended Settings for Different Styles

1. Subtle Vintage Amplifier
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 25%
   - Tone: 8.0 kHz, Instability: 1.5%, Level: -54 dB
   - Perfect for: Adding gentle vintage playback character

2. Classic Vintage Playback
   - Frequency: 60 Hz, Type: Rich, Harmonics: 45%
   - Tone: 6.0 kHz, Instability: 2.0%, Level: -48 dB
   - Perfect for: Background electrical ambience from older playback gear

3. Vintage Tube Equipment
   - Frequency: 50 Hz, Type: Dirty, Harmonics: 60%
   - Tone: 5.0 kHz, Instability: 3.5%, Level: -42 dB
   - Perfect for: Warm tube amplifier character

4. Power Grid Ambience
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 35%
   - Tone: 10.0 kHz, Instability: 1.0%, Level: -60 dB
   - Perfect for: Realistic power supply background

5. Stronger Hum Texture
   - Frequency: 40 Hz, Type: Dirty, Harmonics: 80%
   - Tone: 15.0 kHz, Instability: 6.0%, Level: -36 dB
   - Perfect for: A stronger, more audible hum texture

## MP3 Codec Simulator

MP3 Codec Simulator passes the selected channels through a real-time, simplified MPEG Layer III analysis, finite-bit spectral quantization, and synthesis path. Use it to hear how a clean MP3 round trip changes transients, high-frequency detail, tonal textures, and stereo imaging at low bitrates. It models codec processing only; it does not add damaged-file clicks, dropouts, packet loss, or transmission errors.

The 44.1 kHz MPEG-1 profile offers 32–320 kbit/s. The 22.05 kHz MPEG-2 profile offers 32–160 kbit/s and naturally limits the coded bandwidth more strongly. High settings are useful as comparison points and may sound very close to the input on some material.

This effect requires its WebAssembly processing engine. If that engine or the selected sample-rate/channel mode is unavailable, the input remains unchanged and the plugin shows a plain-language status message.

### Sound Enhancement Guide

- **Clearly audible low-bitrate MP3:** Start with 44.1 kHz, 48 or 64 kbit/s, Joint Stereo, Bit Reservoir On, and Mix at 100%. Percussion, cymbals, sustained tones, and wide stereo recordings reveal the codec most readily.
- **Stronger bandwidth limitation:** Choose 22.05 kHz at 32 or 48 kbit/s. This profile is useful for comparing early low-rate downloads and streaming-like constraints with the 44.1 kHz profile.
- **Hear the reservoir working:** Keep a track with quiet and dense passages at 48 or 64 kbit/s, then switch Bit Reservoir Off. With it off, every frame must fit its own bit budget, so dense transients can become rougher.
- **Compare subtle and obvious degradation:** Compare 64 kbit/s with 128 or 192 kbit/s at 44.1 kHz. The higher setting does not guarantee a completely transparent result, but it shows how added bit budget preserves more detail.
- **Blend the effect:** Reduce Mix when you want some codec character without replacing the whole signal. The dry path is latency-aligned with the coded path.

### Parameters

- **Codec Rate** — Selects `44.1 kHz (MPEG-1)` or `22.05 kHz (MPEG-2)`. This changes the codec profile, frame structure, and coded bandwidth; it is not just a playback sample-rate control.
- **Bitrate** — Sets the total constant bitrate for the mono or stereo stream. MPEG-1 supports 32, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, and 320 kbit/s. MPEG-2 supports the same choices through 160 kbit/s. Lower values leave fewer bits for each transform frame and make spectral holes, rough tonal components, and transient smear more likely.
- **Stereo Mode** — `Joint Stereo` can encode the first stereo pair as Mid/Side when that is more efficient. `Stereo` keeps the left and right spectra separate. Joint Stereo does not simply convert the output to mono.
- **Bit Reservoir** — Lets simple frames save unused main-data capacity for later complex frames. Turning it off makes every frame meet its own budget and can expose stronger frame-to-frame quality variation.
- **Output** — Adjusts the decoded level from -24.0 to +12.0 dB. Lower it if transform overshoot makes peaks too high.
- **Mix** — Blends the latency-aligned original with the decoded result from 0% to 100%.

## Noise Blender

An effect that adds atmospheric background texture to your music, similar to the sound of vinyl records or vintage equipment. Perfect for creating cozy, nostalgic atmospheres.

### Sound Character Guide
- Vintage Equipment Sound:
  - Recreates the warmth of old audio gear
  - Adds subtle "life" to digital recordings
  - Creates an authentic vintage feel
- Vinyl Record Experience:
  - Adds that classic record player atmosphere
  - Creates a cozy, familiar feeling
  - Perfect for late-night listening
- Ambient Texture:
  - Adds atmospheric background
  - Creates depth and space
  - Makes digital music feel more organic

### Parameters
- **Noise Type** - Chooses the character of the background texture
  - White: Brighter, more present texture
  - Pink: Warmer, more natural sound
  - Brown: Deeper, softer texture with more low-frequency weight
- **Level** - Controls how noticeable the effect is (-96dB to 0dB)
  - Very Subtle (-96dB to -72dB): Just a hint
  - Gentle (-72dB to -48dB): Noticeable texture
  - Strong (-48dB to -24dB): Dominant vintage character
- **Per Channel** - Creates a more spacious effect
  - On: Wider, more immersive sound
  - Off: More focused, centered texture

## SBC Codec Simulator

SBC Codec Simulator passes the selected channels through a real-time SBC analysis, bit allocation, quantization, and synthesis path. Use it to hear how the mandatory baseline codec for Bluetooth A2DP can change high-frequency detail, tonal textures, transients, and stereo imaging. With Packet Loss at its default the round trip is completely clean; raising it reproduces the dropouts of a real Bluetooth link.

The codec runs internally at 44.1 kHz for the 44.1 kHz sample-rate family and 48 kHz for the 48 kHz family. The read-only Bitrate value is calculated from the exact SBC frame length for the current Bitpool, Channel Mode, Blocks, and codec rate. It is therefore more informative than treating Bitpool itself as a bitrate.

This effect requires its WebAssembly processing engine. If that engine or the selected sample-rate/channel mode is unavailable, the input remains unchanged and the plugin shows a plain-language status message.

### Sound Enhancement Guide

- **Typical clean SBC comparison:** Start with Bitpool 35, Joint Stereo, 16 Blocks, and Mix at 100%. Compare cymbals, sustained tones, percussion, and wide stereo recordings with bypass.
- **Make codec artifacts easier to hear:** Lower Bitpool toward 12–20. Fewer quantization bits are available to the eight subbands, so high-frequency detail and tonal residuals become more obvious.
- **Compare stereo allocation:** Switch between Joint Stereo and Stereo while watching Bitrate. Joint Stereo can code correlated stereo content more efficiently, while Stereo keeps left and right subbands separate.
- **Reproduce SBC XQ:** Select Dual Channel and set Bitpool to 38 for the common "SBC XQ" configuration, or 47 for "SBC XQ+". On a 44.1 kHz source the Bitrate reads 452.0 and 551.3 kbit/s, matching the well-known figures. Bitpool 53 reaches 617.4 kbit/s, the highest rate this simulator can produce. These settings are outside the A2DP recommendation but are what high-bitrate SBC senders actually transmit, and they are where the codec becomes hardest to distinguish from bypass.
- **Compare frame adaptation:** Change Blocks from 16 to 4. Shorter frames update scale factors more often but spend a larger share of each frame on fixed overhead, which also changes the displayed bitrate.
- **Add wireless dropouts:** Raise Packet Loss toward 5–20% to hear frames disappear in bursts and the concealment fade in. Leave it at 0% for a clean encode/decode comparison.
- **Blend the effect:** Reduce Mix when you want some SBC character without replacing the whole signal. The dry path is latency-aligned with the coded path.

### Parameters

- **Bitpool** — Sets the quantization-bit budget per SBC frame, from 2 to 53. `Joint Stereo` and `Stereo` share this budget across the stereo pair, while `Dual Channel` spends it on each channel separately. Lower values leave more subbands with few or no bits and make codec artifacts stronger. Bitpool is not a direct kbit/s value.
- **Channel Mode** — `Joint Stereo` may encode correlated subbands as sum/difference when that reduces the required scale factors. `Stereo` keeps left and right subbands separate. Both share one bitpool across the first stereo pair; Joint Stereo does not simply make the output mono. `Dual Channel` gives each channel its own independent allocation at the full bitpool, so the frame and the bitrate roughly double: this is the configuration behind "SBC XQ", and because left and right are quantized independently the stereo image fluctuates differently than under Joint Stereo.
- **Blocks** — Selects 4, 8, 12, or 16 subband-sample blocks per SBC frame. Fewer blocks shorten the codec frame and increase fixed overhead relative to coded audio; more blocks adapt scale factors less often.
- **Bitrate** — Read-only current stream bitrate in kbit/s, calculated from the exact frame bytes and codec rate. It updates when Bitpool, Channel Mode, Blocks, the host sample-rate family, or the host output routing between mono and stereo changes.
- **Packet Loss** — Sets the Bluetooth link packet loss rate from 0% to 20% (default 0%). At 0% no frames are lost. Higher values drop whole SBC frames in bursts (Gilbert-Elliott model), and the built-in concealment repeats the previous frame with attenuation before fading to silence, giving the interruptions of a real wireless link.
- **Output** — Adjusts the decoded level from -24.0 to +12.0 dB (default 0.0 dB). Lower it if codec filter overshoot makes peaks too high.
- **Mix** — Blends the latency-aligned original with the decoded result from 0% to 100%.

## Simple Jitter

An effect that adds subtle timing variations to create that imperfect, vintage digital sound. It can make music sound like it's playing through old CD players or vintage digital equipment.

### Sound Character Guide
- Subtle Vintage Feel:
  - Adds gentle instability like old equipment
  - Creates a more organic, less perfect sound
  - Perfect for adding character subtly
- Classic CD Player Sound:
  - Recreates the sound of early digital players
  - Adds nostalgic digital character
  - Great for 90s music appreciation
- Creative Effects:
  - Create unique wobble effects
  - Transform modern sounds into vintage ones
  - Add experimental character

### Parameters
- **RMS Jitter** - Controls the amount of timing variation (1ps to 10ms)
  - Subtle (1-10ps): Gentle vintage character
  - Medium (10-100ps): Classic CD player feel
  - Strong (100ps-1ms): Creative wobble effects

### Recommended Settings for Different Styles

1. Barely Perceptible
   - RMS Jitter: 1-5ps
   - Perfect for: Making playback feel slightly less perfectly digital

2. Classic CD Player Character
   - RMS Jitter: 50-100ps
   - Perfect for: Recreating the sound of early digital playback equipment

3. Vintage DAT Machine
   - RMS Jitter: 200-500ps
   - Perfect for: 90s digital recording equipment character

4. Worn Digital Equipment
   - RMS Jitter: 1-2ns (1000-2000ps)
   - Perfect for: Creating the sound of aging or poorly maintained digital gear

5. Creative Wobble Effect
   - RMS Jitter: 10-100µs (0.01-0.1ms)
   - Perfect for: Experimental effects and noticeable pitch modulation

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
- **Delay Spread** (0.2 to 8.0 ms) - Sets the delay difference between the two ionospheric paths. It determines how closely the fading notches are spaced across the audio band — about 1 kHz apart at 1 ms, and closer as the setting rises — which is what makes a deep fade sound watery instead of merely quiet. Short values fade the whole band together; long values let different parts of the spectrum fade at different moments.
- **Static** (0 to 100/s) - Sets the rate of lightning-like crashes. Each event is injected ahead of the IF filter and rings through it. 0 switches them off.
- **Interference** (-80 to 0 dB) - Sets the strength of a station sharing the channel. -80 dB is effectively off; values closer to 0 dB make it louder.
- **Interf. Offset** (0.1 to 10 kHz) - Sets how far the interfering carrier sits from yours. The two carriers beat at that difference and produce the heterodyne whistle, so this control sets its pitch: below roughly 3 kHz it is a clear tone, and higher settings raise its pitch until the IF filter begins to attenuate it. The interfering program is modeled as shaped noise, so it adds a rough, rushing texture rather than intelligible speech.

#### Tuning

- **Mode** (AM, USB, or LSB) - Selects how the station is transmitted and received. AM is the double-sideband broadcast the rest of this description assumes. USB and LSB suppress the carrier and transmit a single sideband, the way amateur and utility stations do, and the receiver recovers the audio against its own beat-frequency oscillator. Mode also decides which controls apply: BFO Offset works only in USB and LSB, and Detector and Detector RC only in AM. Controls that do not apply are shown disabled and keep their values. USB and LSB come out at about the same loudness as AM at the same settings, and the residual difference is set by the program's crest and by how much of it is pauses: dense material measures about a decibel above AM, while voice-like material with frequent pauses measures a few decibels above it, because AGC lifts the background during the gaps. This is what a real receiver does: AGC normalizes the level inside the IF passband, and with the carrier suppressed that level is the program itself instead of a constant carrier, so the gain follows the program and rides up through every pause.
- **Tuning** (-5.0 to +5.0 kHz) - Offsets the receiver from the station. Small offsets dull the sound, add asymmetric filtering distortion, and change how loud the heterodyne whistle is; larger offsets push the station out of the narrow IF passband. In USB and LSB it also shifts the recovered audio, together with BFO Offset, and the pitch of an interfering station's heterodyne whistle moves by the same amount.
- **BFO Offset** (-1000 to +1000 Hz) - Fine-tunes the beat-frequency oscillator in USB and LSB; it has no effect in AM. Together with Tuning it sets the frequency shift applied to everything the receiver recovers. The shift is Tuning × 1000 − BFO Offset hertz: in USB it is added to every component, and in LSB it is subtracted from every one. Zero is exactly on frequency, a few tens of hertz already makes the sound nasal, and larger settings render it unintelligible the way a mistuned receiver does.
- **IF Bandwidth** (2.0 to 10.0 kHz) - Sets the receiver's IF passband. Narrow settings are the communications-receiver response that rejects noise and the co-channel station but removes more treble; wide settings keep more detail and more interference. The recovered audio reaches half this setting in every Mode — about 3 kHz at the 6 kHz default; in USB and LSB only one sideband is present, so the other half of the passband carries only noise and interference. Mode does not change this control for you; lower it yourself for a narrower communications sound.

#### Receiver

- **Detector** (Envelope or Synchronous) - Envelope is the ordinary diode detector, and it is what turns a deep selective fade into watery distortion. Synchronous recovers the carrier with a PLL and demodulates against it, which greatly reduces that distortion while the fade is deep. It pulls in over roughly ±1 kHz of Tuning and drops out of lock beyond that, so use Envelope while moving the dial. Switching detectors restarts carrier acquisition. It applies to AM only, because USB and LSB always use the BFO product detector.
- **AGC Speed** (Slow, Mid, or Fast) - Sets how quickly automatic gain control follows the fades. Slow leaves the level swings audible and pumps as the signal recovers; Fast holds the level more tightly. In AM it sets both how fast the gain comes down on a rise and how fast it comes back up. In USB and LSB it sets the recovery only: the gain always comes down within a few milliseconds, as it does in a real single-sideband receiver, so a new phrase is caught immediately instead of bursting through.
- **Detector RC** (20 to 500 µs) - Sets the envelope detector's discharge time. Longer values smooth the envelope more but increase high-frequency diagonal-clipping distortion at strong modulation. It has no effect when Detector is Synchronous, or in USB and LSB.
- **Hum** (-80 to -20 dB) - Sets power-supply hum. -80 dB is effectively off. Most of this control modulates receiver gain before detection rather than adding a hum layer.
- **Hum Freq** (50 or 60 Hz) - Selects the simulated power frequency.

#### Output

- **Speaker** (Off, Small, or Table) - Selects line output, the restricted speaker of a portable shortwave set, or the fuller response of a tabletop communications receiver.
- **Output Gain** (-24 to +24 dB) - Adjusts level after receiver and speaker processing.
- **Mix** (0 to 100%) - Blends the original stereo signal with the simulated mono reception. 100% is full shortwave reception, sent identically to left and right. Mix does not delay the dry signal to align it, so intermediate settings combine dry and wet signals with the receiver and propagation delay between them.

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

### Model Notes

The effect processes the first stereo pair as one mono transmission, as real shortwave does, and the received signal is always mono. One co-channel station is modeled, and its program is shaped noise rather than speech or music. USB and LSB model the reception of a suppressed-carrier single-sideband signal; the sideband is selected at the transmitter, so the receiver adds no opposite-sideband rejection of its own, and CW and data modes are not modeled. Real band conditions — day and night propagation changes and specific broadcast bands — are outside this model; set the conditions you want with Signal, Fading, and the propagation controls.

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

## Vinyl Artifacts

An effect that adds vinyl-style playback artifacts such as pops, crackle, hiss, rumble, and reactive surface noise. It adds generated record noise to the music; it does not change the tone of the original music signal like a full turntable, cartridge, or phono preamp model.

### Sound Character Guide
- Vinyl Record Experience:
  - Recreates the authentic sound of playing vinyl records
  - Adds the characteristic surface noise and artifacts
  - Creates that warm, nostalgic analog feeling
- Vintage Playback System:
  - Adds generated playback artifacts around the music
  - Shapes the tone of the generated vinyl noise
  - Adds reactive noise that can respond to the music
- Atmospheric Texture:
  - Creates rich, organic background texture
  - Adds depth and character to digital recordings
  - Perfect for creating cozy, intimate listening experiences

### Parameters
- **Pops/min** - Controls the frequency of large click noises per minute (0 to 120)
  - 0-20: Occasional gentle pops
  - 20-60: Moderate vintage character
  - 60-120: Heavy wear and tear sound
- **Pop Level** - Controls the volume of pop noises (-80.0 to 0.0 dB)
  - -80 to -48 dB: Subtle clicks
  - -48 to -24 dB: Moderate pops
  - -24 to 0 dB: Loud pops (extreme settings)
- **Crackles/min** - Controls the density of crackling noise per minute (0 to 2000)
  - 0-200: Subtle surface texture
  - 200-1000: Classic vinyl character
  - 1000-2000: Heavy surface noise
- **Crackle Level** - Controls the volume of crackling noise (-80.0 to 0.0 dB)
  - -80 to -48 dB: Subtle crackling
  - -48 to -24 dB: Moderate crackling
  - -24 to 0 dB: Loud crackling (extreme settings)
- **Hiss** - Controls the level of constant surface noise (-80.0 to 0.0 dB)
  - -80 to -48 dB: Subtle background texture
  - -48 to -30 dB: Noticeable surface noise
  - -30 to 0 dB: Prominent hiss (extreme settings)
- **Rumble** - Controls low-frequency turntable rumble (-80.0 to 0.0 dB)
  - -80 to -60 dB: Subtle low-end warmth
  - -60 to -40 dB: Noticeable rumble
  - -40 to 0 dB: Heavy rumble (extreme settings)
- **Crosstalk** - Blends the generated artifact noise between left and right channels; the original music signal keeps its stereo separation (0 to 100%)
  - 0%: Generated noise keeps its original channel separation
  - 30-60%: Realistic vinyl-style noise bleed
  - 100%: Generated noise becomes nearly equal between left and right
- **Noise Profile** - Adjusts the frequency response of the generated noise (0.0 to 10.0)
  - 0: Darkest, warmest noise tone
  - 5: Partially shaped noise tone
  - 10: Flat noise tone / tone shaping bypassed
- **Wear** - Scales surface wear artifacts such as pops, crackles, and hiss (0 to 200%)
  - 0-50%: Cleaner surface noise
  - 50-100%: Normal surface wear
  - 100-200%: Heavily worn surface noise
  - Rumble, Crosstalk, and Noise Profile are controlled separately
- **React** - How much the noise responds to the input signal (0 to 100%)
  - 0%: Static noise levels
  - 25-50%: Moderate response to music
  - 75-100%: Highly reactive to input
- **React Mode** - Selects what aspect of the signal controls the reaction
  - Velocity: Responds to high-frequency content (needle speed)
  - Amplitude: Responds to overall signal level
- **Mix** - Controls how much noise is added to the dry signal (0 to 100%)
  - 0%: No noise added (dry signal only)
  - 50%: Moderate noise addition
  - 100%: Maximum noise addition
  - Note: The dry signal level remains unchanged; this parameter only controls the noise amount

### Recommended Settings for Different Styles

1. Subtle Vinyl Character
   - Pops/min: 20, Pop Level: -48dB, Crackles/min: 200, Crackle Level: -48dB
   - Hiss: -48dB, Rumble: -60dB, Crosstalk: 30%, Noise Profile: 5.0
   - Wear: 25%, React: 20%, React Mode: Velocity, Mix: 100%
   - Perfect for: Adding gentle vinyl surface texture

2. Classic Vinyl Experience
   - Pops/min: 40, Pop Level: -36dB, Crackles/min: 400, Crackle Level: -36dB
   - Hiss: -36dB, Rumble: -50dB, Crosstalk: 50%, Noise Profile: 4.0
   - Wear: 60%, React: 30%, React Mode: Velocity, Mix: 100%
   - Perfect for: Authentic vinyl listening experience

3. Well-Worn Record
   - Pops/min: 80, Pop Level: -24dB, Crackles/min: 800, Crackle Level: -24dB
   - Hiss: -30dB, Rumble: -40dB, Crosstalk: 70%, Noise Profile: 3.0
   - Wear: 120%, React: 50%, React Mode: Velocity, Mix: 100%
   - Perfect for: Heavily aged record character

4. Lo-Fi Ambient
   - Pops/min: 15, Pop Level: -54dB, Crackles/min: 150, Crackle Level: -54dB
   - Hiss: -42dB, Rumble: -66dB, Crosstalk: 25%, Noise Profile: 6.0
   - Wear: 40%, React: 15%, React Mode: Amplitude, Mix: 100%
   - Perfect for: Background ambient texture

5. Dynamic Vinyl
   - Pops/min: 60, Pop Level: -30dB, Crackles/min: 600, Crackle Level: -30dB
   - Hiss: -39dB, Rumble: -45dB, Crosstalk: 60%, Noise Profile: 5.0
   - Wear: 80%, React: 75%, React Mode: Velocity, Mix: 100%
   - Perfect for: Noise that responds dramatically to the music

## Vinyl Simulator

Vinyl Simulator transforms the music itself through a physical record-cutting and stylus-playback model. It applies the cutting filters and RIAA recording curve, writes the signal into a modeled groove with surface roughness and debris, follows that groove with a mechanical stylus and tonearm simulation, and then applies RIAA playback equalization. Use it when you want groove geometry, tracking behavior, and the record surface to interact with the music rather than simply placing record noise on top.

### Vinyl Simulator or Vinyl Artifacts?

- **Vinyl Simulator** changes the input signal by passing it through the modeled groove and stylus. Roughness, dust, static, tracking force, stylus shape, record speed, and radius all take part in the simulation.
- **Vinyl Artifacts** leaves the music signal itself unchanged and adds controllable pops, crackle, hiss, rumble, and stereo noise bleed. Choose it for a lighter, predictable noise layer or when WASM is unavailable.
- The two can be combined, but start with one: using strong surface settings in both can make clicks and noise build up quickly.

### Sound Enhancement Guide

- **Gentle record playback:** Keep Cut Level near 0 dB, use an Elliptical stylus, moderate Roughness, little Dust and Static, and reduce Mix if you want to preserve more of the original signal.
- **Inner-groove character:** Move Radius toward 60 mm. The lower groove speed makes high-frequency detail and tracking more demanding, especially with a low Scan Radius or high Cut Level.
- **Cleaner, more stable playback:** Reduce Roughness, Dust, Static, and Scratch; keep Tracking Force around 2 g; and use Standard or High Quality. Lowering Cut Level also reduces mechanical stress.
- **Aged or damaged surface:** Raise Roughness first, then add Dust, Static, and a small amount of Scratch. These controls represent different physical events, so increasing all of them at once can become overpowering.
- **More obvious groove coloration:** Raise Cut Level carefully, lower HF Cutoff, or use a smaller Radius. Watch the HUD for falling Tracking S/E and rising mistrack or skip rates.
- **Wow and flutter:** Vinyl Simulator does not add speed drift, eccentricity, warping, or turntable rumble. Add **Wow Flutter** elsewhere in the effect chain when you want those behaviors.

### Parameters

#### Cutting

- **Cut Level** (-20 to +20 dB) - Sets how strongly the input drives the cutter. Higher values make groove displacement and tracking nonlinearity more prominent; lower values provide more mechanical headroom.
- **HF Cutoff** (6000 to 24000 Hz) - Sets the high-frequency limit before cutting. Lower values produce a darker, easier-to-track groove; higher values retain more upper-frequency detail and demand more from the stylus.
- **Bass Mono Below** (50 to 1000 Hz) - Sets the range in which the stereo Side component is reduced. Raising it centers more bass and reduces opposing low-frequency motion between the groove walls.
- **Side Mix** (0 to 100%) - Sets how much low-frequency Side information remains below Bass Mono Below. 0% makes that range mono; 100% preserves the original Side level.

#### Record

- **Speed** (33⅓, 45, or 78 rpm) - Sets record rotation speed. Higher speeds increase groove velocity at the same Radius and generally make fine detail easier to trace; they also change the motion of surface features past the stylus.
- **Radius** (60 to 146 mm) - Sets the stylus position on the record. Smaller values represent the inner groove, where linear velocity is lower and high-frequency tracking is more difficult.
- **Roughness** (0.1 to 100 nm) - Sets the microscopic surface roughness used by the contact model. Higher values raise the continuous surface texture.
- **Dust** (0 to 10000/s) - Sets the arrival rate of dust particles in the groove. Higher values create more physical contacts and short disturbances.
- **Static** (0 to 10000/s) - Sets the rate of electrical discharge pulses. This adds sharp pops through the cartridge output rather than changing the groove shape.
- **Scratch** (0 to 1000/s) - Sets the rate of larger groove defects. Use low values for occasional damage or high values for an intentionally distressed effect.

#### Stylus

- **Shape** (Spherical or Elliptical) - Selects the contact geometry. Elliptical emphasizes directional groove tracing; Spherical links Scan Radius to Side Radius and gives a rounder contact profile. Changing Shape rebuilds the simulation state.
- **Side Radius** (5 to 25 µm) - Sets the stylus radius across the groove wall. It changes the contact footprint and pressure distribution.
- **Scan Radius** (2 to 25 µm) - Sets the radius used along the direction of groove travel. Smaller values follow finer geometry; larger values average it over a broader contact. In Spherical mode it follows Side Radius.
- **Tracking Force** (0.5 to 5.0 g) - Sets downward stylus force. More force can improve contact stability but increases contact force and pressure; too little can raise mistrack and skip activity.
- **Tip Mass** (0.1 to 1.5 mg) - Sets the moving mass of the stylus tip. Higher values increase inertia and make rapid groove motion harder to follow.
- **Compliance** (5 to 35 cu) - Sets suspension flexibility. Higher values allow more movement for a given force and shift the mechanical response.
- **Damping** (0.05 to 1.0 ζ) - Controls mechanical resonance damping. Higher values suppress ringing more strongly; very low values allow a more resonant response.

#### Output

- **Quality** (Eco, Standard, High, or Ultra) - Selects the base number of physical integration substeps and contact scan points. To keep the contact resonance stable, the engine may automatically raise the effective substeps above this base according to sample rate, Tracking Force, Tip Mass, Compliance, Shape, Side Radius, and Scan Radius. Standard is the default for real-time listening. Changing Quality rebuilds the simulation state.
- **Output Gain** (-24 to +24 dB) - Adjusts the level after playback equalization and normalization. Reduce it if strong cutting or surface settings create high peaks.
- **Mix** (0 to 100%) - Blends the simulated playback with a latency-aligned dry signal. 0% is dry and 100% is fully simulated.

### Reading the HUD

- **Force L/R (mN)** shows contact force on each groove wall. Large or strongly unequal values indicate demanding groove motion or uneven contact.
- **Pressure (GPa)** shows the higher current contact pressure. Use it together with Force when adjusting Tracking Force and stylus radii.
- **Tip (cm/s and dB)** shows stylus-tip velocity and the resulting playback level.
- **Tracking S/E L/R (dB)** compares tracked signal with tracking error. Higher values indicate cleaner tracing; a sustained fall means the stylus is struggling to follow the groove.
- **Jitter (ns)** appears with the Stylus view and reports timing variation at the groove read point.
- **Mistrack, Skip, Static Pop, and Dust Hit (/s)** show recent event rates. A flash marks a new event; repeated mistracks or skips suggest reducing Cut Level, increasing Tracking Force moderately, choosing a larger Radius, or raising Quality.

The HUD becomes active when native DSP telemetry is available. When playback is stopped or telemetry is paused to save power, it may show an idle state rather than live values.

### Recommended Settings

1. **Gentle Physical Playback**
   - Cut Level: 0 dB, HF Cutoff: 16 kHz, Bass Mono Below: 250 Hz, Side Mix: 70%
   - Speed: 33⅓ rpm, Radius: 120 mm, Roughness: 5 nm, Dust: 0.5/s, Static: 0.02/s, Scratch: 0/s
   - Shape: Elliptical, Side Radius: 18 µm, Scan Radius: 8 µm, Tracking Force: 2.0 g, Quality: Standard, Mix: 75%

2. **Classic Outer-Groove Playback**
   - Cut Level: 0 dB, HF Cutoff: 16 kHz, Speed: 33⅓ rpm, Radius: 135 mm
   - Roughness: 13.17 nm, Dust: 2/s, Static: 0.08/s, Scratch: 0/s
   - Shape: Elliptical, Tracking Force: 2.0 g, Quality: Standard, Mix: 100%

3. **Inner-Groove Demonstration**
   - Cut Level: +3 dB, HF Cutoff: 14 kHz, Speed: 33⅓ rpm, Radius: 60 mm
   - Shape: Elliptical, Scan Radius: 8 µm, Tracking Force: 2.0 g, Quality: High, Mix: 100%
   - Watch Tracking S/E and the event counters while comparing this with a larger Radius.

4. **Worn Surface**
   - Cut Level: 0 dB, Speed: 33⅓ rpm, Radius: 100 mm, Roughness: 35 nm
   - Dust: 25/s, Static: 1/s, Scratch: 0.5/s, Tracking Force: 2.2 g, Quality: Standard, Output Gain: -3 dB, Mix: 100%

### Quality and CPU Guide

Each Quality preset sets base substeps and contact scan points. For stability, the engine also calculates `Nmin = ceil(8 × f_c / sampleRate)`, where the contact-resonance frequency `f_c` depends on Tracking Force, Tip Mass, Compliance, Shape, Side Radius, and Scan Radius, then uses `effectiveSubsteps = max(base, Nmin)`. At the default settings, Standard at 96 kHz remains at its base of 4 substeps, so the existing performance target is unchanged.

The main workload is proportional to sample rate × effective substeps × contact scan points. The contact-evaluation and relative-load figures below are base estimates for when the stability floor does not raise the substeps, not measured CPU percentages; actual load also depends on the processor, browser, and availability of WASM SIMD.

| Quality | Base detail | Base evaluations at 96 kHz | Base relative load | Suggested use |
|---|---:|---:|---:|---|
| Eco | 2 substeps × 7 scan points | 2.7 million/s | 0.39× | Mobile, low-power systems, or several instances |
| Standard | 4 × 9 | 6.9 million/s | 1.00× | Normal real-time listening |
| High | 8 × 13 | 20 million/s | 2.89× | Faster systems or focused comparison |
| Ultra | 20 × 25 | 96 million/s | 13.89× | Offline rendering and verification |

When the stability floor is inactive, apply the following sample-rate multiplier to the base relative load: 44.1 kHz = 0.46×, 48 kHz = 0.50×, 88.2 kHz = 0.92×, 96 kHz = 1.00×, 176.4 kHz = 1.84×, and 192 kHz = 2.00×. Sample rate and the Tracking Force, Tip Mass, Compliance, Shape, Side Radius, and Scan Radius settings can activate the floor and make the actual load higher than this base estimate. If playback breaks up, lower Quality first.

### WASM Requirement and Model Limits

Vinyl Simulator requires the native WebAssembly DSP kernel for real-time processing. If WASM is disabled with `?dsp=off`, unsupported, or fails to initialize, the effect passes the input through unchanged and the UI reports that WASM is required. It does not fall back to the much slower JavaScript reference simulation.

The model processes the first stereo pair. Dust deformation is retained only while each simulated particle remains active; the stylus always advances into newly generated groove, so wear does not accumulate over repeated revolutions and is not saved with presets. Long-term record wear, 3D visualization, real-time SNR/THD meters, wow/flutter, eccentricity, warping, turntable rumble, and cartridge electrical loading are outside this effect's model.

Remember: These effects are meant to add character and nostalgia to your music. Start with subtle settings and adjust to taste!
