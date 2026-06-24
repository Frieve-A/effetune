---
title: "Lo-Fi Plugins - EffeTune"
description: "Lo-Fi effect plugins including Bit Crusher, Noise Blender, Vinyl Artifacts, and more."
lang: en
---

# Lo-Fi Audio Plugins

A collection of plugins that add vintage character and nostalgic qualities to your music. These effects can make modern digital music sound like it's being played through classic equipment or give it that popular "lo-fi" sound that's both relaxing and atmospheric.

## Plugin List

- [Bit Crusher](#bit-crusher) - Creates retro gaming and vintage digital sounds
- [Digital Error Emulator](#digital-error-emulator) - Simulates various digital audio transmission errors
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - Simulates audible intermodulation distortion from DSD64 ultrasonic noise
- [Hum Generator](#hum-generator) - Adds controllable electrical hum ambience for vintage/lo-fi listening
- [Noise Blender](#noise-blender) - Adds atmospheric background texture
- [Simple Jitter](#simple-jitter) - Creates subtle vintage digital imperfections
- [Vinyl Artifacts](#vinyl-artifacts) - Adds vinyl-style pops, crackle, hiss, rumble, and stereo noise bleed

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
- Subtle (default): Amount +24 dB, Ultrasonic Level -30 dBFS, Analog Nonlinearity 1.40%, Even Bias 50%.
- Tweeter-only IMD: IMD Path HPF 2.5 kHz, Signal Coupling 80–150%, Cross Sideband 50–100%, Scratch Tone 9–14 kHz.
- Obvious effect: raise Amount, Ultrasonic Level, and Analog Nonlinearity.

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

Remember: These effects are meant to add character and nostalgia to your music. Start with subtle settings and adjust to taste!
