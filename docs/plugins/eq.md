---
title: "EQ Plugins - EffeTune"
description: "Equalizer plugins including Parametric EQ, Graphic EQ, Dynamic EQ, Earphone Cable Sim, filters, and Tone Control."
lang: en
---

# Equalizer Plugins

A collection of plugins that let you adjust different aspects of your music's sound, from deep bass to crisp highs. These tools help you personalize your listening experience by enhancing or reducing specific sound elements.

## Plugin List

- [15Band GEQ](#15band-geq) - Detailed sound adjustment with 15 precise controls
- [15Band PEQ](#15band-peq) - Detailed 15-band tone shaping for music playback
- [5Band Dynamic EQ](#5band-dynamic-eq) - Dynamics-based equalizer that responds to your music
- [5Band PEQ](#5band-peq) - Flexible equalizer for shaping bass, mids, and treble
- [Band Pass Filter](#band-pass-filter) - Focus on specific frequencies
- [Comb Filter](#comb-filter) - Phasey, hollow, or metallic sound coloration
- [Earphone Cable Sim](#earphone-cable-sim) - Helps check how small normal earphone-cable response shifts usually are
- [Hi Pass Filter](#hi-pass-filter) - Remove unwanted low frequencies with precision
- [Lo Pass Filter](#lo-pass-filter) - Remove unwanted high frequencies with precision
- [Loudness Equalizer](#loudness-equalizer) - Frequency balance correction for low volume listening
- [Narrow Range](#narrow-range) - Focus on specific parts of the sound
- [Tilt EQ](#tilt-eq) - Simple EQ that tilts the sound spectrum
- [Tone Control](#tone-control) - Simple bass, mid, and treble adjustment

## 15Band GEQ

A detailed sound adjustment tool with 15 separate controls, each affecting a specific part of the sound spectrum. Perfect for fine-tuning your music exactly how you like it.

### Listening Enhancement Guide
- Bass Region (25Hz-160Hz):
  - Enhance the power of bass drums and deep bass
  - Adjust the fullness of bass instruments
  - Control room-shaking sub-bass
- Lower Midrange (250Hz-630Hz):
  - Adjust the warmth of the music
  - Control the fullness of the overall sound
  - Reduce or enhance the "thickness" of the sound
- Upper Midrange (1kHz-2.5kHz):
  - Make vocals more clear and present
  - Adjust the prominence of main instruments
  - Control the "forward" feeling of the sound
- High Frequencies (4kHz-16kHz):
  - Enhance the crispness and detail
  - Control the "sparkle" and "air" in the music
  - Adjust the overall brightness

### Parameters
- **Band Gains** - Individual controls for each frequency range (-12dB to +12dB)
  - Deep Bass
    - 25Hz: Lowest bass feeling
    - 40Hz: Deep bass impact
    - 63Hz: Bass power
    - 100Hz: Bass fullness
    - 160Hz: Upper bass
  - Lower Sound
    - 250Hz: Sound warmth
    - 400Hz: Sound fullness
    - 630Hz: Sound body
  - Middle Sound
    - 1kHz: Main sound presence
    - 1.6kHz: Sound clarity
    - 2.5kHz: Sound detail
  - High Sound
    - 4kHz: Sound crispness
    - 6.3kHz: Sound brilliance
    - 10kHz: Sound air
    - 16kHz: Sound sparkle

### Visual Display
- Real-time graph showing your sound adjustments
- Easy-to-use sliders with precise control
- One-click reset to default settings

## 15Band PEQ

A 15-band parametric equalizer for fine-tuning bass, vocals, presence, and treble while listening. Use it when you want more detailed control than a graphic EQ, from small tone changes to narrowing down a specific annoying frequency.

### Sound Enhancement Guide
- Vocal and Instrument Clarity:
  - Set one band to around 3.2kHz with moderate Q (1.0-2.0) for natural presence
  - Apply narrow Q (4.0-8.0) cuts only when a specific resonance is bothering you
  - Add gentle air with a 10kHz high shelf (+2 to +4dB)
- Bass Quality Control:
  - Shape bass fullness with a 100Hz peaking filter
  - Use a narrow cut if one bass note or room boom stands out too much
  - Create smooth bass extension with a low shelf
- Fine Listening Adjustments:
  - Use small, broad boosts or cuts for natural results
  - Use narrow settings for targeted problems rather than overall tone
  - Compare with bypass often so the music still sounds balanced

### Parameters
- **Configurable Bands**
  - 15 fully configurable frequency bands
  - Initial frequency settings:
    - 25Hz, 40Hz, 63Hz, 100Hz, 160Hz (Deep Bass)
    - 250Hz, 400Hz, 630Hz (Lower Sound)
    - 1kHz, 1.6kHz, 2.5kHz (Middle Sound)
    - 4kHz, 6.3kHz, 10kHz, 16kHz (High Sound)
- **Controls Per Band**
  - Center Frequency: Adjustable from 20Hz to 20kHz
  - Gain Range: ±20dB for Peaking and Low/High Shelf filters
  - Q Factor: 0.1-10.0 for most filter types; Low/High Shelf is limited to 0.1-2.0
  - Higher Q affects a narrower range; lower Q sounds smoother and broader
  - For Low/High Pass, Band Pass, Notch, and AllPass, Frequency and Q shape the filter; Gain is not used
  - Multiple Filter Types:
    - Peaking: Symmetrical frequency adjustment
    - Low/High Pass: 12dB/octave slope
    - Low/High Shelf: Gentle spectral shaping
    - Band Pass: Focused frequency isolation
    - Notch: Precise frequency removal
    - AllPass: Phase-focused frequency alignment
- **Preset Management**
  - Import: Load Equalizer APO-style TXT filter lines
  - Up to 15 `ON` PK/LS/LSC/HS/HSC filters are imported; `Preamp` lines and unsupported filter types are ignored
    - Example format:
      ```
      Filter 1: ON PK Fc 50 Hz Gain -3.0 dB Q 2.00
      Filter 2: ON HS Fc 12000 Hz Gain 4.0 dB Q 0.70
      ...
      ```

### Visual Display
- High-resolution frequency response visualization
- Interactive control points with precise parameter display
- Real-time curve updates as you adjust settings
- Frequency and gain grid
- Accurate numerical readouts for all parameters

## 5Band Dynamic EQ

A smart equalizer that automatically adjusts frequency bands based on the content of your music. It combines precise equalization with dynamic processing that responds to changes in your music in real-time, creating an enhanced listening experience without constant manual adjustments.

### Listening Enhancement Guide
- Tame Harsh Vocals:
  - Use peak filter at 3000Hz with higher ratio (4.0-10.0)
  - Set moderate threshold (-24dB) and fast attack (10ms)
  - Automatically reduces harshness only when vocals get too aggressive
- Enhance Clarity and Brilliance:
  - Use Band 5 with Filter Type: Highshelf, Frequency: around 10000Hz, SC Freq: around 1200Hz, Ratio: 0.5, Attack: 1ms
  - Mids trigger high frequencies for natural-sounding clarity
  - Adds sparkle to music without permanent brightness
- Control Excessive Bass:
  - Use lowshelf filter at 100Hz with moderate ratio (2.0-4.0)
  - Keep bass impact while preventing speaker distortion
  - Perfect for bass-heavy music on smaller speakers
- Adaptive Sound Tailoring:
  - Lets music dynamics control the sound balance
  - Automatically adjusts to different songs and recordings
  - Maintains consistent sound quality across your playlist

### Parameters
- **Five Band Controls** - Each with independent settings
  - Band 1: 100Hz (Bass Region)
  - Band 2: 300Hz (Lower Midrange)
  - Band 3: 1000Hz (Midrange)
  - Band 4: 3000Hz (Upper Midrange)
  - Band 5: 10000Hz (High Frequencies)
- **Band Settings**
  - Filter Type: Choose between Peak, Lowshelf, or Highshelf
  - Frequency: Fine-tune center/corner frequency (20Hz-20kHz)
  - Q: Control bandwidth/sharpness (0.1-10.0)
  - Max Gain: Set maximum gain adjustment (0-24dB)
  - Threshold: Set level when processing begins (-60dB to 0dB)
  - Ratio: Control processing intensity (0.1-100.0)
    - Below 1.0: Expander (enhances when signal exceeds threshold)
    - Above 1.0: Compressor (reduces when signal exceeds threshold)
  - Knee Width: Smooth transition around threshold (0-10dB)
  - Attack: How quickly processing begins (0.1-100ms)
  - Release: How quickly processing ends (1-1000ms)
  - Sidechain Frequency: Detection frequency (20Hz-20kHz)
  - Sidechain Q: Detection bandwidth (0.1-10.0)

### Visual Display
- Real-time frequency response graph
- Dynamic response curve showing the current boosts and cuts
- Interactive frequency and gain controls

## 5Band PEQ

A flexible 5-band equalizer for shaping music playback. Use it when bass feels boomy, vocals sound harsh, or the highs need a little more sparkle without opening the more detailed 15-band version.

### Sound Enhancement Guide
- Vocal and Instrument Clarity:
  - Use the 3.16kHz band with moderate Q (1.0-2.0) for natural presence
  - Apply narrow Q (4.0-8.0) cuts only when a specific resonance is bothering you
  - Add gentle air with the 10kHz high shelf (+2 to +4dB)
- Bass Quality Control:
  - Shape bass fullness with the 100Hz peaking filter
  - Use a narrow cut if one bass note or room boom stands out too much
  - Create smooth bass extension with low shelf
- Everyday Sound Tuning:
  - Use broad, small adjustments for natural tone changes
  - Reduce harshness, boominess, or dullness by ear
  - Compare with bypass often so the music still sounds balanced

### Parameters
- **Five Adjustable Bands**
  - Band 1: 100Hz (Sub & Bass Control)
  - Band 2: 316Hz (Lower Midrange Definition)
  - Band 3: 1.0kHz (Midrange Presence)
  - Band 4: 3.2kHz (Upper Midrange Detail)
  - Band 5: 10kHz (High Frequency Extension)
- **Controls Per Band**
  - Center Frequency: Adjustable from 20Hz to 20kHz
  - Gain Range: ±20dB for Peaking and Low/High Shelf filters
  - Q Factor: 0.1-10.0 for most filter types; Low/High Shelf is limited to 0.1-2.0
  - Higher Q affects a narrower range; lower Q sounds smoother and broader
  - For Low/High Pass, Band Pass, Notch, and AllPass, Frequency and Q shape the filter; Gain is not used
  - Multiple Filter Types:
    - Peaking: Symmetrical frequency adjustment
    - Low/High Pass: 12dB/octave slope
    - Low/High Shelf: Gentle spectral shaping
    - Band Pass: Focused frequency isolation
    - Notch: Precise frequency removal
    - AllPass: Phase-focused frequency alignment

### Visual Display
- High-resolution frequency response visualization
- Interactive control points with precise parameter display
- Real-time curve updates as you adjust settings
- Frequency and gain grid
- Accurate numerical readouts for all parameters

## Band Pass Filter

A precision band-pass filter that combines high-pass and low-pass filters to allow only frequencies in a specific range to pass through. Based on Linkwitz-Riley filter design for optimal phase response and transparent sound quality.

### Listening Enhancement Guide
- Focus on Vocal Range:
  - Set HPF between 100-300Hz and LPF between 4-8kHz to emphasize vocal clarity
  - Use moderate slopes (-24dB/oct) for natural sound
  - Helps vocals stand out in complex mixes
- Create Special Effects:
  - Set narrow frequency ranges for telephone, radio, or megaphone effects
  - Use steeper slopes (-36dB/oct or higher) for more dramatic filtering
  - Experiment with different frequency ranges for creative sounds
- Clean Up Specific Frequency Ranges:
  - Target problematic frequencies with precise control
  - Use different slopes for high-pass and low-pass sections as needed
  - Perfect for removing both rumble and high-frequency noise simultaneously

### Parameters
- **HPF Frequency (Hz)** - Controls where low frequencies are filtered out (10Hz to 40000Hz; the effective upper limit also depends on the audio sample rate)
  - Lower values: Only the very lowest frequencies are removed
  - Higher values: More low frequencies are removed
  - Adjust based on the specific low-frequency content you want to eliminate
- **HPF Slope** - Controls how aggressively frequencies below the cutoff are reduced
  - Off: No filtering applied
  - -12dB/oct: Gentle filtering (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: Standard filtering (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: Stronger filtering (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: Very strong filtering (LR8 - 8th order Linkwitz-Riley)
- **LPF Frequency (Hz)** - Controls where high frequencies are filtered out (10Hz to 40000Hz; the effective upper limit also depends on the audio sample rate)
  - Lower values: More high frequencies are removed
  - Higher values: Only the very highest frequencies are removed
  - Adjust based on the specific high-frequency content you want to eliminate
- **LPF Slope** - Controls how aggressively frequencies above the cutoff are reduced
  - Off: No filtering applied
  - -12dB/oct: Gentle filtering (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: Standard filtering (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: Stronger filtering (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: Very strong filtering (LR8 - 8th order Linkwitz-Riley)

### Visual Display
- Real-time frequency response graph with logarithmic frequency scale
- Clear visualization of both filter slopes and cutoff points
- Interactive controls for precise adjustment
- Frequency grid with markers at key reference points

## Comb Filter

A comb filter that adds a phasey, hollow, metallic, or resonant character by mixing the sound with a very short delayed copy. Use it when you want a track to feel more colored, spacious, or experimental.

### Listening Enhancement Guide
- Add Subtle Coloration:
  - Start with Feedforward mode, Feedback Gain around 0.2-0.4, and Dry-Wet Mix around 20-40%
  - Adjust the Fundamental Frequency until the hollow or phasey tone fits the music
  - Keep feedback low for a gentler effect that blends with the original sound
- Create Resonance and Echo Effects:
  - Use Feedback mode or higher Feedback Gain for stronger ringing or echo-like effects
  - Experiment with different fundamental frequencies for unique tonal character
  - Use lower Dry-Wet Mix values if the effect becomes too obvious
- Bright Metallic Color:
  - Try higher Fundamental Frequency values for brighter, wider-spaced comb peaks and dips
  - Use positive or negative Feedback Gain to change the pattern of peaks and dips
  - Combine with other effects for more experimental listening effects

### Parameters
- **Fundamental Frequency (Hz)** - Controls the delay time and harmonic spacing (20Hz to 20000Hz)
  - Lower values: Longer delays, closer-spaced comb peaks and dips
  - Higher values: Shorter delays, wider-spaced comb peaks and dips
- **Feedback Gain** - Controls the intensity of the comb filter effect (-1.0 to 1.0)
  - Negative values: Creates inverse harmonic patterns
  - Positive values: Creates reinforcing harmonic patterns
  - Zero: No effect (dry signal only)
  - Higher absolute values: More pronounced effect
- **Comb Type** - Controls the filter structure
  - Feedforward: Creates harmonic enhancement without feedback
  - Feedback: Creates resonance and echo-like effects
- **Dry-Wet Mix** - Controls the balance between processed and original signal (0% to 100%)
  - 0%: Original signal only
  - 50%: Equal mix of original and processed
  - 100%: Processed signal only

### Technical Details
- **Delay Calculation**: Delay time = 1 / Fundamental Frequency
- **Harmonic Response**: Creates regularly spaced peaks and dips based on the fundamental frequency
- **Spatial Coloration**: Can resemble short reflections, hollow coloration, or metallic resonance
- **Real-time Visualization**: Shows frequency response with fundamental frequency marker

### Visual Display
- Real-time frequency response graph with logarithmic frequency scale
- Clear visualization of comb filter peaks and dips
- Fundamental frequency marker showing delay time
- Interactive controls for precise adjustment
- Delay distance calculation in millimeters

## Earphone Cable Sim

Reproduces the small frequency-response shifts that appear when an earphone is driven by an amplifier through real cable resistance/inductance and non-zero output impedance. Because an earphone's impedance varies with frequency (driver resonances plus voice-coil inductance), source and cable impedance create earphone-specific level changes. This is useful as a reality check: with cables of normal construction and quality, ordinary amplifier output impedance, and earphones that are not unusually low in impedance or otherwise abnormal, the audible change from ordinary earphone-cable differences is generally small enough to be negligible. The effect is strongest with low-impedance earphones that have large impedance peaks, and is usually subtle with modern low-output-impedance amplifiers.

### Listening Enhancement Guide
- Evaluate Source-Impedance Interaction:
  - Raise Output Z to emulate tube amps or high-impedance headphone outputs
  - Compare with bypass to hear how bass and impedance-peak regions change
- Explore Multi-Driver Earphone Behavior:
  - Enable additional Resonances to model balanced-armature or hybrid earphones with multiple impedance peaks
  - Larger impedance peaks combined with higher source impedance create stronger coloration
- Simulate Cable Resistance and Inductance:
  - Increase Cable R to emulate longer or thinner cables with higher DC resistance
  - Increase Cable L to emulate higher-inductance cables; its effect is mainly in the upper treble
  - Cable R adds to the total series resistance, so it can strengthen the interaction across the band
- Check Normal Cable Audibility:
  - Use realistic Cable R and Cable L values, then compare with bypass to estimate how small ordinary cable differences are
  - If only extreme Output Z, Cable R, or very low Base Z settings make the change obvious, the same comparison suggests normal cables are unlikely to be audibly significant with that earphone and amplifier

### Parameters
- **Output Z (Ω)** - Amplifier output impedance (0 to 20). Values below 1Ω are typical of modern amplifiers; higher values make impedance-related coloration stronger.
- **Cable R (Ω)** - Cable DC resistance (0 to 2). Higher values represent longer or thinner cables and add to the total series resistance.
- **Cable L (µH)** - Cable inductance (0 to 5). Mainly affects upper-treble response, especially with low-impedance earphones.
- **Voice Coil L (mH)** - Earphone voice-coil inductance (0.01 to 2). Raises load impedance toward high frequencies and changes the high-frequency interaction.
- **Base Z (Ω)** - Nominal earphone impedance at low frequencies (4 to 64). Lower values make source and cable impedance more influential.
- **Resonances (up to 5)** - Each models one impedance peak of the driver. The first is enabled by default; the rest are pre-set to typical driver resonances and can be toggled on.
  - **Enable** - Turn each resonance on or off
  - **Freq (Hz)** - Resonance frequency (20 to 20000)
  - **Q** - Sharpness of the impedance peak (0.5 to 10)
  - **Peak Z (Ω)** - Impedance at the resonance peak (16 to 116)

### Technical Details
- **Physical Model**: Computes `H(f) = Zload / (Zsource + Zload)`, where `Zsource` is the output impedance plus cable resistance/inductance and `Zload` is the earphone impedance (base impedance, voice-coil inductance, and resonance peaks).
- **Realization**: The transfer function is factored and converted to a matched-Z cascade of biquad filters, giving zero latency and minimum-phase behavior comparable to the other EQ plugins.
- **Normalization**: The response is normalized to a 0 dB power average (20Hz to 20kHz) so toggling the effect does not change overall loudness.

### Visual Display
- Real-time graph of the realized filter response on a logarithmic frequency scale
- Grid labels cover 20Hz to 20kHz; the plotted curve extends across the full 10Hz to 40kHz graph range
- Green response curve over a dark grid, with an auto-scaled dB axis around the normalized 0dB reference
- Larger curve deviations indicate where the model changes playback level most

## Hi Pass Filter

A precision high-pass filter that removes unwanted low frequencies while preserving the clarity of higher frequencies. Based on Linkwitz-Riley filter design for optimal phase response and transparent sound quality.

### Listening Enhancement Guide
- Remove Unwanted Rumble:
  - Set frequency between 20-40Hz to eliminate subsonic noise
  - Use steeper slopes (-24dB/oct or higher) for cleaner bass
  - Ideal for vinyl recordings or live performances with stage vibrations
- Clean Up Bass-Heavy Music:
  - Set frequency between 60-100Hz to tighten bass response
  - Use moderate slopes (-12dB/oct to -24dB/oct) for natural transition
  - Helps prevent speaker overload and improves clarity
- Create Special Effects:
  - Set frequency between 200-500Hz for a thinner, low-cut voice effect
  - Use steep slopes (-48dB/oct or higher) for dramatic filtering
  - For a telephone-like voice effect, combine with Lo Pass Filter around 3-4kHz

### Parameters
- **Frequency (Hz)** - Controls where low frequencies are filtered out (10Hz to 40000Hz; the effective upper limit also depends on the audio sample rate)
  - Lower values: Only the very lowest frequencies are removed
  - Higher values: More low frequencies are removed
  - Adjust based on the specific low-frequency content you want to eliminate
- **Slope** - Controls how aggressively frequencies below the cutoff are reduced
  - Off: No filtering applied
  - -12dB/oct: Gentle filtering (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: Standard filtering (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: Stronger filtering (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: Very strong filtering (LR8 - 8th order Linkwitz-Riley)
  - -60dB/oct to -96dB/oct: Extremely steep filtering for special applications

### Visual Display
- Real-time frequency response graph with logarithmic frequency scale
- Clear visualization of the filter slope and cutoff point
- Interactive controls for precise adjustment
- Frequency grid with markers at key reference points

## Lo Pass Filter

A precision low-pass filter that removes unwanted high frequencies while preserving the warmth and body of lower frequencies. Based on Linkwitz-Riley filter design for optimal phase response and transparent sound quality.

### Listening Enhancement Guide
- Reduce Harshness and Sibilance:
  - Set frequency between 8-12kHz to tame harsh recordings
  - Use moderate slopes (-12dB/oct to -24dB/oct) for natural sound
  - Helps reduce listening fatigue with bright recordings
- Warm Up Digital Recordings:
  - Set frequency between 12-16kHz to reduce digital "edge"
  - Use gentle slopes (-12dB/oct) for subtle warming effect
  - Creates a more analog-like sound character
- Create Special Effects:
  - Set frequency between 1-3kHz with a steep slope for a muffled, narrow-band character
  - Use steep slopes (-48dB/oct or higher) for dramatic filtering
  - For a vintage radio effect, combine with Hi Pass Filter to remove low frequencies as well
- Control Noise and Hiss:
  - Set frequency just above the musical content (typically 14-18kHz)
  - Use steeper slopes (-36dB/oct or higher) for effective noise control
  - Reduces tape hiss or background noise while preserving most musical content

### Parameters
- **Frequency (Hz)** - Controls where high frequencies are filtered out (10Hz to 40000Hz; the effective upper limit also depends on the audio sample rate)
  - Lower values: More high frequencies are removed
  - Higher values: Only the very highest frequencies are removed
  - Adjust based on the specific high-frequency content you want to eliminate
- **Slope** - Controls how aggressively frequencies above the cutoff are reduced
  - Off: No filtering applied
  - -12dB/oct: Gentle filtering (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: Standard filtering (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: Stronger filtering (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: Very strong filtering (LR8 - 8th order Linkwitz-Riley)
  - -60dB/oct to -96dB/oct: Extremely steep filtering for special applications

### Visual Display
- Real-time frequency response graph with logarithmic frequency scale
- Clear visualization of the filter slope and cutoff point
- Interactive controls for precise adjustment
- Frequency grid with markers at key reference points

## Loudness Equalizer

A specialized equalizer that adjusts frequency balance based on the Average SPL value you set. Use it for quieter listening, where bass and treble can feel weaker, to keep the music balanced and enjoyable.

### Listening Enhancement Guide
- Low Volume Listening:
  - Enhances bass and treble frequencies
  - Maintains musical balance at quiet levels
  - Compensates for human hearing characteristics
- Average SPL Setting:
  - More enhancement at lower Average SPL settings
  - Gradual reduction of processing as the setting increases
  - Natural sound at higher listening levels
- Frequency Balance:
  - Low shelf for bass enhancement (100-300Hz)
  - High shelf for treble enhancement (3-6kHz)
  - Smooth transition between frequency ranges

### Parameters
- **Average SPL** - Estimated average listening level used for correction (60dB to 85dB)
  - Lower values: More enhancement
  - Higher values: Less enhancement
  - Set this manually to match your typical listening volume
- **Low Frequency Controls**
  - Frequency: Bass enhancement center (100Hz to 300Hz)
  - Gain: Maximum bass boost (0dB to 15dB)
  - Q: Shape of bass enhancement (0.5 to 1.0)
- **High Frequency Controls**
  - Frequency: Treble enhancement center (3kHz to 6kHz)
  - Gain: Maximum treble boost (0dB to 15dB)
  - Q: Shape of treble enhancement (0.5 to 1.0)

### Visual Display
- Real-time frequency response graph
- Interactive parameter controls
- Volume-dependent curve visualization
- Precise numerical readouts

## Narrow Range

A tool that lets you focus on specific parts of the music by filtering out unwanted frequencies. Useful for creating special sound effects or removing unwanted sounds.

### Listening Enhancement Guide
- Create unique sound effects:
  - "Telephone voice" effect
  - "Old radio" sound
  - "Underwater" effect
- Focus on a frequency range:
  - Make bass-heavy parts easier to hear
  - Focus on vocal range
  - Narrow the sound to the range where vocals or instruments are most noticeable
- Remove unwanted sounds:
  - Reduce low-frequency rumble
  - Cut excessive high-frequency hiss
  - Focus on the range you want to hear most clearly

### Parameters
- **HPF Frequency** - Controls where low sounds start being reduced (20Hz to 4000Hz)
  - Higher values: Removes more bass
  - Lower values: Keeps more bass
  - Start with low values and adjust to taste
- **HPF Slope** - How quickly low sounds are reduced (0 to -48 dB/octave)
  - 0dB: No reduction (off)
  - -6dB to -48dB: Increasingly stronger reduction in 6dB steps
- **LPF Frequency** - Controls where high sounds start being reduced (200Hz to 40000Hz)
  - Lower values: Removes more highs
  - Higher values: Keeps more highs
  - Start high and adjust down as needed
- **LPF Slope** - How quickly high sounds are reduced (0 to -48 dB/octave)
  - 0dB: No reduction (off)
  - -6dB to -48dB: Increasingly stronger reduction in 6dB steps

### Visual Display
- Clear graph showing frequency response
- Easy-to-adjust frequency controls
- Simple slope drop-down menus

## Tone Control

A simple three-band sound adjuster for quick and easy sound personalization. Perfect for basic sound shaping without getting too technical.

### Music Enhancement Guide
- Classical Music:
  - Light treble boost for more detail in strings
  - Gentle bass boost for fuller orchestra sound
  - Neutral mids for natural sound
- Rock/Pop Music:
  - Moderate bass boost for more impact
  - Slight mid reduction for clearer sound
  - Treble boost for crisp cymbals and details
- Jazz Music:
  - Warm bass for fuller sound
  - Clear mids for instrument detail
  - Gentle treble for cymbal sparkle
- Electronic Music:
  - Strong bass for deep impact
  - Reduced mids for cleaner sound
  - Enhanced treble for crisp details

### Parameters
- **Bass** - Controls the low sounds (-24dB to +24dB)
  - Increase for more powerful bass
  - Decrease for lighter, cleaner sound
  - Affects the "weight" of the music
- **Mid** - Controls the main body of sound (-24dB to +24dB)
  - Increase for more prominent vocals/instruments
  - Decrease for more spacious sound
  - Affects the "fullness" of the music
- **Treble** - Controls the high sounds (-24dB to +24dB)
  - Increase for more sparkle and detail
  - Decrease for smoother, softer sound
  - Affects the "brightness" of the music

### Visual Display
- Easy-to-read graph showing your adjustments
- Simple sliders for each control

## Tilt EQ

A simple yet effective equalizer that gently tilts the frequency balance of your music. It's designed for subtle adjustments, making your music sound warmer or brighter without complex controls. Ideal for quickly tailoring the overall tone to your preference.

### Listening Enhancement Guide
- Make Music Warmer:
  - Use negative slope values to reduce high frequencies and increase low frequencies.
  - Perfect for bright recordings or headphones that sound too sharp.
  - Creates a cozy and relaxed listening experience.
- Make Music Brighter:
  - Use positive slope values to increase high frequencies and reduce low frequencies.
  - Ideal for dull recordings or speakers that sound muffled.
  - Adds clarity and sparkle to your music.
- Subtle Tone Adjustments:
  - Use small slope values for gentle overall tone shaping.
  - Fine-tune the balance to match your listening environment or mood.

### Parameters
- **Pivot Frequency** - Controls the center frequency of the tilt (20Hz to ~20kHz)
  - Adjust to set the frequency point around which the tilt occurs.
- **Slope** - Controls the steepness of the tilt around the Pivot Frequency (-12 dB/oct to +12 dB/oct)
  - Positive values make the sound brighter; negative values make it warmer.
  - Smaller values make gentler changes.

### Visual Display
- Simple slider for easy slope adjustment
- Real-time frequency response curve to show the tilt effect
- Clear indication of current slope value

- Quick reset button
