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
- [Digital Error Emulator](#digital-error-emulator) - Simulates various digital audio transmission errors
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - Simulates audible intermodulation distortion from DSD64 ultrasonic noise
- [FM Radio Simulator](#fm-radio-simulator) - Passes the music through a physically simulated FM broadcast and receiver chain
- [Hum Generator](#hum-generator) - Adds controllable electrical hum ambience for vintage/lo-fi listening
- [Noise Blender](#noise-blender) - Adds atmospheric background texture
- [Simple Jitter](#simple-jitter) - Creates subtle vintage digital imperfections
- [SW Radio Simulator](#sw-radio-simulator) - Passes the music through a modeled shortwave broadcast, ionospheric path, and receiver
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

- **Emphasis** (50 or 75 µs) - Selects the pre-emphasis/de-emphasis time-constant pair (50 µs: Japan/Europe, 75 µs: the Americas). On a clean signal the pair nearly cancels; the choice subtly changes how hiss and distortion are voiced.
- **Processing** (0 to +18 dB) - Drive of the broadcast limiter — the station's "loudness". 0 dB is nearly transparent; higher values sound denser and louder in the way heavily processed stations do.
- **Signal** (0 to 70 dBµV) - Carrier level at the antenna input. The noise floor is fixed by physics (75 Ω thermal noise plus receiver noise figure), so this control sets the carrier-to-noise ratio and is the main degradation axis. Around 50 dBµV and above reception is essentially clean; near 30 stereo hiss is clearly audible; near 15 the Auto blend has moved to mono; at 6 and below clicks multiply and the program sinks into noise.
- **Tuning** (-200 to +200 kHz) - Detunes the receiver from the station. Small offsets pass almost unnoticed; from roughly ±40 kHz the sound becomes increasingly distorted, asymmetric, and quieter as the sidebands slide out of the IF passband. At ±200 kHz the station is fully outside the passband, leaving only receiver noise.
- **IF Band** (80 to 240 kHz) - Receiver IF filter width. Narrow settings represent a receiver built for crowded conditions: they truncate the FM sidebands and increase distortion, especially together with detuning. Wide settings are cleaner for a strong, centered station.
- **Multipath** (0 to 100%) - Effect amount for two delayed reflections: at 100% the first reflection reaches 30% of the direct wave, and the second is 60% of the first. The interference notches convert FM into amplitude and phase errors that the limiter cannot fully remove, producing the typical harsh multipath distortion.
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

SW Radio Simulator passes the music through a modeled shortwave broadcast chain: transmitter processing and AM modulation, ionospheric propagation with deep frequency-selective fading, atmospheric static and a station sharing the channel, a narrow communications receiver with envelope or synchronous detection and AGC, and an optional radio speaker. Use it to hear music the way a distant international broadcast arrives on a shortwave set: narrow and hollow, swelling and sinking with the ionosphere, whistling where another transmitter is close in frequency.

This effect requires an environment that supports its real-time processing. When that processing is unavailable, the audio remains unchanged and the HUD reports that the effect is unavailable.

### How It Differs from AM, FM, and Additive Lo-Fi Effects

- **AM Radio Simulator** models medium-wave reception, where a stable groundwave normally dominates and fading is a secondary effect. Its passband is wider and it offers C-QUAM stereo.
- **SW Radio Simulator** models shortwave, where the signal arrives by ionospheric reflection. Deep frequency-selective fading is the main event, the audio band is narrower, and the heterodyne whistle of a co-channel station is part of the sound. Shortwave broadcasting is mono, so the processed signal is always mono.
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

### Parameters

#### Station

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

#### Receiver

- **Tuning** (-5.0 to +5.0 kHz) - Offsets the receiver from the station. Small offsets dull the sound, add asymmetric filtering distortion, and change how loud the heterodyne whistle is; larger offsets push the station out of the narrow IF passband.
- **IF Bandwidth** (2.0 to 10.0 kHz) - Sets the receiver's IF passband. Narrow settings are the communications-receiver response that rejects noise and the co-channel station but removes more treble; wide settings keep more detail and more interference.
- **Detector** (Envelope or Synchronous) - Envelope is the ordinary diode detector, and it is what turns a deep selective fade into watery distortion. Synchronous recovers the carrier with a PLL and demodulates against it, which greatly reduces that distortion while the fade is deep. It pulls in over roughly ±1 kHz of Tuning and drops out of lock beyond that, so use Envelope while moving the dial. Switching detectors restarts carrier acquisition.
- **AGC Speed** (Slow, Mid, or Fast) - Sets how quickly automatic gain control follows the fades. Slow leaves the level swings audible and pumps as the signal recovers; Fast holds the level more tightly.
- **Detector RC** (20 to 500 µs) - Sets the envelope detector's discharge time. Longer values smooth the envelope more but increase high-frequency diagonal-clipping distortion at strong modulation. It has no effect when Detector is Synchronous.
- **Hum** (-80 to -20 dB) - Sets power-supply hum. -80 dB is effectively off. Most of this control modulates receiver gain before detection rather than adding a hum layer.
- **Hum Freq** (50 or 60 Hz) - Selects the simulated power frequency.

#### Output

- **Speaker** (Off, Small, or Table) - Selects line output, the restricted speaker of a portable shortwave set, or the fuller response of a tabletop communications receiver.
- **Output Gain** (-24 to +24 dB) - Adjusts level after receiver and speaker processing.
- **Mix** (0 to 100%) - Blends the original stereo signal with the simulated mono reception. 100% is full shortwave reception, sent identically to left and right. Mix does not delay the dry signal to align it, so intermediate settings combine dry and wet signals with the receiver and propagation delay between them.

### Reading the HUD

- **S METER** shows, on an S1-to-S9 scale, the in-band signal strength the receiver has before AGC. Like the S meter of a real set it reads everything inside the passband, so the co-channel station, noise, and static lift it along with the station you want.
- **FADE** shows the current propagation gain change in dB, and it swings both below and above 0 dB as the direct path and the two ionospheric paths cancel or reinforce each other. On shortwave this is the display to watch: it moves continuously at the default settings, and the deepest dips are where the sound turns watery and distorted.
- **AGC GAIN** shows how much gain the receiver is applying. It rises as Signal falls or a fade deepens. It stops at +42 dB, so the deepest fades stay quiet instead of being fully compensated.
- **MOD / EVENTS** shows the effective transmitter modulation percentage, followed by the recent static-crash rate (⚡) and clipping rate (▲) per second, and flashes as those events occur. Frequent clipping suggests reducing Mod Depth or Detector RC when a cleaner result is wanted.
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

### Model Notes

The effect processes the first stereo pair as one mono broadcast, as real shortwave broadcasting does, and the received signal is always mono. One co-channel station is modeled, and its program is shaped noise rather than speech or music. Real band conditions — day and night propagation changes, specific broadcast bands, and single-sideband reception — are outside this model; set the conditions you want with Signal, Fading, and the propagation controls.

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
