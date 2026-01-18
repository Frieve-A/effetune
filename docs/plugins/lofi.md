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
- [Hum Generator](#hum-generator) - High-precision power hum noise generator
- [Noise Blender](#noise-blender) - Adds atmospheric background texture
- [Simple Jitter](#simple-jitter) - Creates subtle vintage digital imperfections
- [Vinyl Artifacts](#vinyl-artifacts) - Analog record noise physical simulation

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
  - 0-1%: Subtle vintage warmth
  - 1-3%: Classic hardware imperfections
  - 3-10%: Creative lo-fi character
- **Random Seed** - Controls the unique character of imperfections (0 to 1000)
  - Different values create different vintage "personalities"
  - Same value always creates the same character
  - Perfect for finding and saving your favorite vintage sound

## Digital Error Emulator

An effect that simulates the sound of various digital audio transmission errors, from subtle professional interface glitches to vintage CD player imperfections. Perfect for adding vintage digital character or creating unique listening experiences that remind you of classic digital audio equipment.

### Sound Character Guide
- Professional Digital Interface Glitches:
  - Simulates S/PDIF, AES3, and MADI transmission artifacts
  - Adds the character of aging professional gear
  - Perfect for vintage studio sound
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
  - Default: CD Audio (most familiar to music listeners)
- **Reference Fs (kHz)** - Sets the reference sample rate for timing calculations
  - Available rates: 44.1, 48, 88.2, 96, 176.4, 192 kHz
  - Affects timing accuracy for network audio modes
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

1. Subtle Professional Gear Character
   - Mode: AES3/S-PDIF, BER: 10^-8, Fs: 48kHz, Wet: 100%
   - Perfect for: Adding subtle professional gear aging

2. Classic CD Player Experience
   - Mode: CD Audio, BER: 10^-7, Fs: 44.1kHz, Wet: 100%
   - Perfect for: 90s digital music nostalgia

3. Modern Streaming Glitches
   - Mode: Dante/AES67 (128 samp), BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfect for: Contemporary digital life imperfections

4. Bluetooth Listening Experience
   - Mode: Bluetooth A2DP, BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfect for: Wireless audio memories

5. Creative Experimental Effects
   - Mode: RF Systems, BER: 10^-5, Fs: 48kHz, Wet: 100%
   - Perfect for: Unique experimental sounds

Note: All recommendations use 100% Wet Mix for realistic digital error behavior. Lower wet mix values can be used for creative effects, but they don't represent how real digital errors actually occur.

## Hum Generator

An effect that generates high-precision, authentic electrical power hum noise with its characteristic harmonic structure and subtle instabilities. Perfect for adding realistic background hum from vintage equipment, power supplies, or creating that authentic "plugged-in" feel that many classic recordings possess.

### Sound Character Guide
- Vintage Equipment Ambience:
  - Recreates the subtle hum of classic amplifiers and equipment
  - Adds the character of being "plugged in" to AC power
  - Creates authentic vintage studio atmosphere
- Power Supply Characteristics:
  - Simulates different types of power supply noise
  - Recreates regional power grid characteristics (50Hz vs 60Hz)
  - Adds subtle electrical infrastructure character
- Background Texture:
  - Creates organic, low-level background presence
  - Adds depth and "life" to sterile digital recordings
  - Perfect for vintage-inspired productions

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
- **Tone** - Final tone shaping filter cutoff frequency (1.0-20.0 kHz)
  - 1-5 kHz: Warm, muffled character
  - 5-10 kHz: Natural equipment-like tone
  - 10-20 kHz: Bright, present character
- **Instability** - Amount of subtle frequency and amplitude variation (0-10%)
  - 0%: Perfectly stable hum (digital precision)
  - 1-3%: Subtle real-world instability
  - 3-7%: Noticeable vintage equipment character
  - 7-10%: Creative modulation effects
- **Level** - Output level of the hum signal (-80.0 to 0.0 dB)
  - -80 to -60 dB: Barely audible background presence
  - -60 to -40 dB: Subtle but noticeable hum
  - -40 to -20 dB: Prominent vintage character
  - -20 to 0 dB: Creative or special effect levels

### Recommended Settings for Different Styles

1. Subtle Vintage Amplifier
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 25%
   - Tone: 8.0 kHz, Instability: 1.5%, Level: -54 dB
   - Perfect for: Adding gentle vintage amplifier character

2. Classic Recording Studio
   - Frequency: 60 Hz, Type: Rich, Harmonics: 45%
   - Tone: 6.0 kHz, Instability: 2.0%, Level: -48 dB
   - Perfect for: Authentic studio atmosphere from the analog era

3. Vintage Tube Equipment
   - Frequency: 50 Hz, Type: Dirty, Harmonics: 60%
   - Tone: 5.0 kHz, Instability: 3.5%, Level: -42 dB
   - Perfect for: Warm tube amplifier character

4. Power Grid Ambience
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 35%
   - Tone: 10.0 kHz, Instability: 1.0%, Level: -60 dB
   - Perfect for: Realistic power supply background

5. Creative Hum Effects
   - Frequency: 40 Hz, Type: Dirty, Harmonics: 80%
   - Tone: 15.0 kHz, Instability: 6.0%, Level: -36 dB
   - Perfect for: Artistic and experimental applications

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
   - Perfect for: Adding the subtlest hint of analog warmth to digital recordings

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
   - RMS Jitter: 10-100µs (10000-100000ps)
   - Perfect for: Experimental effects and noticeable pitch modulation

## Vinyl Artifacts

An effect that recreates the physical noise characteristics of analog vinyl records. This plugin simulates the various artifacts that occur when playing back vinyl records, from surface noise to the electrical characteristics of the playback chain.

### Sound Character Guide
- Vinyl Record Experience:
  - Recreates the authentic sound of playing vinyl records
  - Adds the characteristic surface noise and artifacts
  - Creates that warm, nostalgic analog feeling
- Vintage Playback System:
  - Simulates the complete analog playback chain
  - Includes RIAA equalization characteristics
  - Adds reactive noise that responds to the music
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
- **Crosstalk** - Controls stereo channel bleed between left and right (0 to 100%)
  - 0%: Perfect stereo separation
  - 30-60%: Realistic vinyl crosstalk
  - 100%: Maximum channel bleed
- **Noise Profile** - Adjusts the frequency response of the noise (0.0 to 10.0)
  - 0: RIAA curve reproduction (authentic vinyl frequency response)
  - 5: Partially corrected response
  - 10: Flat response (bypassed)
- **Wear** - Master multiplier for overall record condition (0 to 200%)
  - 0-50%: Well-maintained record
  - 50-100%: Normal wear and age
  - 100-200%: Heavily worn record
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
   - Perfect for: Adding gentle analog warmth

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
