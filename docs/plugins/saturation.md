---
title: "Saturation Plugins - EffeTune"
description: "Saturation and distortion plugins including Saturation, Exciter, Hard Clipping, and more."
lang: en
---

# Saturation Plugins

A collection of plugins that add warmth and character to your music. These effects can make digital music sound more analog-like and add pleasant richness to the sound, similar to how vintage audio equipment colors the sound.

## Plugin List

- [Dynamic Saturation](#dynamic-saturation) - Simulates the nonlinear displacement of speaker cones
- [Exciter](#exciter) - Add harmonic content to enhance clarity and presence
- [Hard Clipping](#hard-clipping) - Adds intensity and edge to the sound
- [Harmonic Distortion](#harmonic-distortion) - Adds character with adjustable 2nd- to 5th-order nonlinear distortion
- [Multiband Saturation](#multiband-saturation) - Shapes low, mid, and high frequency ranges independently
- [Saturation](#saturation) - Adds warmth and richness like vintage equipment
- [Sub Synth](#sub-synth) - Adds a filtered low-frequency signal for bass enhancement

## Dynamic Saturation

A physics-based effect that simulates the nonlinear displacement of speaker cones under different conditions. By modeling the mechanical behavior of a speaker and then applying saturation to that displacement, it creates a unique form of distortion that responds dynamically to your music.

### Listening Enhancement Guide
- **Subtle Enhancement:**
  - Adds gentle warmth and slight rounded-peak behavior
  - Creates a natural "pushed speaker" sound without obvious distortion
  - Adds subtle movement and depth to the sound
- **Moderate Effect:**
  - Creates a more dynamic, responsive distortion
  - Adds unique movement and liveliness to sustained passages
  - Gives transients a moving, responsive character
- **Creative Effect:**
  - Produces complex distortion patterns that evolve with the input
  - Creates resonant, speaker-like behaviors
  - Creates bold, evolving character for experimental listening

### Parameters
- **Speaker Drive** (0.0-10.0) - Controls how strongly the audio signal moves the cone
  - Low values: Subtle movement and gentle effect
  - High values: Dramatic movement and stronger character
- **Speaker Stiffness** (0.0-10.0) - Simulates the cone's suspension stiffness
  - Low values: Loose, free movement with longer decay
  - High values: Tight, controlled movement with quick response
- **Speaker Damping** (0.1-10.0) - Controls how quickly cone movement settles
  - Low values near 0.1: Prolonged vibration and resonance
  - High values: Quick damping for controlled sound
- **Speaker Mass** (0.1-5.0) - Simulates cone inertia
  - Low values: Fast, responsive movement
  - High values: Slower, more pronounced movement
- **Distortion Drive** (0.0-10.0) - Controls the intensity of displacement saturation
  - Low values: Subtle nonlinearity
  - High values: Strong saturation character
- **Distortion Bias** (-1.0-1.0) - Adjusts the symmetry of the saturation curve
  - Zero: Symmetrical saturation
  - Positive/Negative: Adds asymmetric character by changing which side of the displacement saturates more strongly
- **Distortion Mix** (0-100%) - Blends between linear and saturated displacement
  - Low values: More linear response
  - High values: More saturated character
- **Cone Motion Mix** (0-100%) - Controls how much cone motion affects the original sound
  - Low values: Subtle enhancement
  - High values: Dramatic effect
- **Output Gain** (-18.0-18.0dB) - Adjusts the final output level

### Visual Display
- Live transfer curve graph showing how displacement is being saturated
- Clear visual feedback of distortion characteristics
- Visual representation of how Distortion Drive and Bias affect the sound

### Music Enhancement Tips
- For Subtle Warmth:
  - Speaker Drive: 2.0-3.0
  - Speaker Stiffness: 1.5-2.5
  - Speaker Damping: 0.5-1.5
  - Distortion Drive: 1.0-2.0
  - Cone Motion Mix: 20-40%
  - Distortion Mix: 30-50%

- For Dynamic Character:
  - Speaker Drive: 3.0-5.0
  - Speaker Stiffness: 2.0-4.0
  - Speaker Mass: 0.5-1.5
  - Distortion Drive: 3.0-6.0
  - Distortion Bias: Try +/-0.2 for asymmetrical character
  - Cone Motion Mix: 40-70%

- For Strong Experimental Effect:
  - Speaker Drive: 6.0-10.0
  - Speaker Stiffness: Try extreme values (very low or high)
  - Speaker Mass: 2.0-5.0 for exaggerated movement
  - Distortion Drive: 5.0-10.0
  - Experiment with Bias values
  - Cone Motion Mix: 70-100%

### Quick Start Guide
1. Start with moderate Speaker Drive (3.0) and Stiffness (2.0)
2. Set Speaker Damping to control resonance (1.0 for balanced response)
3. Adjust Distortion Drive to taste (3.0 for moderate effect)
4. Set Distortion Bias to 0.0 first for symmetrical saturation
5. Set Distortion Mix to 50% and Cone Motion Mix to 50%
6. Adjust Speaker Mass to change the character of the effect
7. Fine-tune with Output Gain to balance levels

## Exciter

An effect that adds harmonic content to enhance clarity and presence. By filtering the high-frequency content and applying saturation, it creates additional harmonics that brighten and enhance your music.

### Listening Enhancement Guide
- **Subtle Enhancement:**
  - Adds clarity and air to voices and high-frequency details
  - Enhances presence in the whole playback signal
  - Creates a more open, detailed sound
- **Moderate Effect:**
  - Brings out hidden details in the mix
  - Adds sparkle and brilliance
  - Makes music sound more "hi-fi"
- **Creative Effect:**
  - Creates bright, cutting tones
  - Adds aggressive presence
  - Useful when you want a brighter, more forward sound, but best used sparingly

### Parameters
- **HPF Freq** (500-10000Hz) - Sets the cutoff frequency for high-pass filtering
  - Low values (500-2000Hz): Affects more of the signal
  - Mid values (2000-5000Hz): Targets presence frequencies
  - High values (5000-10000Hz): Focuses on air and brilliance
- **HPF Slope** - Controls the filter steepness
  - Off: No filtering, processes full spectrum
  - 6dB/oct: Gentle filtering
  - 12dB/oct: Steeper filtering
- **Drive** (0.0-10.0) - Controls saturation intensity
  - Light (0.0-3.0): Subtle harmonic enhancement
  - Medium (3.0-6.0): Notable brightness
  - High (6.0-10.0): Strong excitation
- **Bias** (-0.3 to 0.3) - Adjusts saturation asymmetry
  - Zero: Symmetrical saturation
  - Positive/Negative: Adds asymmetric character by changing which side of the generated enhancement saturates more strongly
- **Mix** (0-100%) - Controls how much of the generated harmonic enhancement is added to the original sound
  - Low (0-30%): Subtle added brightness
  - Medium (30-60%): Clearer presence and detail
  - High (60-100%): Strong added harmonics; use carefully to avoid harshness

### Visual Display
- High-pass filter frequency response graph
- Saturation transfer curve visualization
- Clear visual feedback for both filter and saturation

### Music Enhancement Tips
- For Clearer Voices in Songs, Podcasts, or Videos:
  - HPF Freq: 3000-5000Hz
  - HPF Slope: 6dB/oct
  - Drive: 2.0-4.0
  - Bias: 0.05 to 0.1
  - Mix: 20-40%

- For Clearer Mid/High Detail in Busy Recordings:
  - HPF Freq: 2000-4000Hz
  - HPF Slope: 12dB/oct
  - Drive: 3.0-5.0
  - Bias: 0.0
  - Mix: 30-50%

- For Subtle Full-Track Brightness:
  - HPF Freq: 5000-8000Hz
  - HPF Slope: 6dB/oct
  - Drive: 1.0-3.0
  - Bias: 0.0 to 0.1
  - Mix: 10-25%

### Quick Start Guide
1. Set HPF Freq to target the desired frequency range
2. Choose HPF Slope (start with 6dB/oct)
3. Begin with moderate Drive (3.0)
4. Set Bias near 0.1 for a slightly asymmetric character
5. Set Mix to 25% and adjust to taste
6. Fine-tune all parameters while listening

## Hard Clipping

A digital clipping effect that limits peaks above a set threshold. Use it when you want extra edge, density, or creative distortion; keep the threshold high for light peak control and lower it gradually for stronger character.

### Listening Enhancement Guide
- Subtle Enhancement:
  - Adds a little edge and density when Threshold stays high
  - Can trim sharp peaks when used lightly
  - Compare with bypass because clipping can become harsh if pushed too far
- Moderate Effect:
  - Creates a more energetic sound
  - Adds excitement to rhythmic elements
  - Makes the music feel more "driven"
- Creative Effect:
  - Creates dramatic sound transformations
  - Adds aggressive character to the music
  - Perfect for experimental listening

### Parameters
- **Threshold** - Controls how much of the sound is affected (-60dB to 0dB)
  - Higher values (-6dB to 0dB): Light peak control or subtle edge
  - Middle values (-24dB to -6dB): Notable clipping character and density
  - Lower values (-60dB to -24dB): Heavy distortion and dramatic effect
- **Mode** - Chooses which parts of the sound to affect
  - Both Sides: Clips positive and negative peaks symmetrically; the most predictable mode
  - Positive Only: Clips only positive peaks, creating asymmetrical clipping and a different tonal character
  - Negative Only: Clips only negative peaks, creating asymmetrical clipping with a different feel from Positive Only

### Visual Display
- Real-time graph showing how the sound is being shaped
- Clear visual feedback as you adjust settings
- Reference lines to help guide your adjustments

### Listening Tips
- For subtle enhancement:
  1. Start with Threshold at 0dB
  2. Use "Both Sides" mode
  3. Lower it gradually toward -3dB to -6dB and stop when the effect is just audible
- For creative effects:
  1. Lower the Threshold gradually
  2. Try different Modes
  3. Combine with other effects for unique sounds

## Harmonic Distortion

The Harmonic Distortion plugin shapes the waveform with adjustable 2nd- to 5th-order nonlinear terms. It lets you tune even- and odd-order distortion character from subtle warmth to stronger coloration, which can help music that sounds too clean, thin, or flat feel more vivid.

### Listening Enhancement Guide
- **Subtle Effect:**
  - Adds a gentle layer of harmonic warmth
  - Enhances the natural tone without overwhelming the original signal
  - Ideal for adding analog-like subtle depth
- **Moderate Effect:**
  - Adds a more pronounced harmonic character
  - Can add body, brightness, or edge to the whole recording
  - Useful when the sound feels too flat or restrained
- **Aggressive Effect:**
  - Intensifies several nonlinear terms for a rich, complex distortion
  - Creates bold textures for experimental listening
  - Can sound edgy or unconventional when pushed hard
- **Positive vs. Negative Values:**
  - Positive and negative values flip the direction of each nonlinear term
  - Even-order terms mainly change asymmetry and tonal color
  - Odd-order terms mainly change the symmetric distortion character

### Parameters
- **2nd Harm (%):** Sets the second-order distortion term (-30 to 30%, default: 2%)
- **3rd Harm (%):** Sets the third-order distortion term (-30 to 30%, default: 3%)
- **4th Harm (%):** Sets the fourth-order distortion term (-30 to 30%, default: 0.5%)
- **5th Harm (%):** Sets the fifth-order distortion term (-30 to 30%, default: 0.3%)
- **Sensitivity (x):** Adjusts the overall input sensitivity (0.1-2.0, default: 0.5)
  - Lower sensitivity provides a more understated effect
  - Higher sensitivity increases the distortion intensity
  - Works as a global control affecting the intensity of the nonlinear shaping

### Visual Display
- Transfer curve showing how input levels are shaped into output levels
- Intuitive sliders and input fields that provide immediate feedback
- The graph updates as harmonic and sensitivity settings change

### Quick Start Guide
1. **Initialization:** Start with default settings (2nd: 2%, 3rd: 3%, 4th: 0.5%, 5th: 0.3%, Sensitivity: 0.5)
2. **Adjust Parameters:** Change one or two harmonic controls at a time while listening for harshness or loss of clarity
3. **Blend Your Sound:** Balance the effect using Sensitivity to achieve either a subtle warmth or a pronounced distortion

## Multiband Saturation

A versatile effect that lets you add warmth and character to specific frequency ranges of the whole playback signal. By splitting the sound into low, mid, and high bands, you can shape each range independently for precise sound enhancement.

### Listening Enhancement Guide
- Low-Frequency Warmth:
  - Add warmth and punch to low frequencies
  - Adds fullness and gentle punch to the low-frequency range of the whole playback signal
  - Create fuller, richer low end
- Midrange Clarity:
  - Adds body and definition to the midrange where many voices and instruments are present
  - Helps busy recordings feel clearer
  - Create clearer, more defined sound
- High-End Sweetening:
  - Add sparkle to the high-frequency range
  - Enhance the air and brilliance
  - Create crisp, detailed highs

Because this processes frequency bands, it affects all sounds in the selected range, not isolated instruments or vocals.

### Parameters
- **Crossover Frequencies**
  - Freq 1 (20Hz-2kHz): Sets where low band ends and mid band begins
  - Freq 2 (200Hz-20kHz, always kept at or above Freq 1): Sets where mid band ends and high band begins
  - If Freq 2 is set below Freq 1, it is automatically raised to preserve the low-mid-high band order
- **Band Controls** (for each Low, Mid, and High band):
  - **Drive** (0.0-10.0): Controls saturation intensity
    - Light (0.0-3.0): Subtle enhancement
    - Medium (3.0-6.0): Notable warmth
    - High (6.0-10.0): Strong character
  - **Bias** (-0.3 to 0.3): Adjusts the saturation curve's symmetry
    - Zero: Symmetrical saturation
    - Positive/Negative: Adds asymmetric character by changing which side of the waveform saturates more strongly
  - **Mix** (0-100%): Blends effect with original
    - Low (0-30%): Subtle enhancement
    - Medium (30-70%): Balanced effect
    - High (70-100%): Strong character
  - **Gain** (-18dB to +18dB): Adjusts band volume
    - Use to balance the bands with each other
    - Compensate for any volume changes

### Visual Display
- Interactive band selection tabs
- Real-time transfer curve graph for each band
- Clear visual feedback as you adjust settings

### Music Enhancement Tips
- For Full Mix Enhancement:
  1. Start with gentle Drive (2.0-3.0) on all bands
  2. Set Bias to 0.0 for natural saturation
  3. Set Mix around 40-50% for natural blend
  4. Fine-tune Gain for each band

- For Low-Frequency Warmth:
  1. Focus on Low band
  2. Use moderate Drive (3.0-5.0)
  3. Keep Bias neutral for consistent response
  4. Keep Mix around 50-70%

- For Midrange Presence:
  1. Focus on Mid band
  2. Use light Drive (1.0-3.0)
  3. Set Bias to 0.0 for natural sound
  4. Adjust Mix to taste (30-50%)

- For Adding Brightness:
  1. Focus on High band
  2. Use gentle Drive (1.0-2.0)
  3. Keep Bias neutral for clean saturation
  4. Keep Mix subtle (20-40%)

### Quick Start Guide
1. Set crossover frequencies to split your sound
2. Start with low Drive values on all bands
3. Set Bias to 0.0 first for symmetrical saturation
4. Use Mix to blend the effect naturally
5. Fine-tune with Gain controls
6. Trust your ears and adjust to taste!

## Saturation

An effect that simulates the warm, pleasant sound of vintage tube equipment. It can add richness and character to your music, making it sound more "analog" and less "digital."

### Listening Enhancement Guide
- Adding Warmth:
  - Makes digital music sound more natural
  - Adds pleasant richness to the sound
  - Perfect for jazz and acoustic music
- Rich Character:
  - Creates a more "vintage" sound
  - Adds depth and dimension
  - Great for rock and electronic music
- Strong Effect:
  - Transforms the sound dramatically
  - Creates bold, characterful tones
  - Ideal for experimental listening

### Parameters
- **Drive** - Controls the amount of warmth and character (0.0 to 10.0)
  - Light (0.0-3.0): Subtle analog warmth
  - Medium (3.0-6.0): Rich, vintage character
  - Strong (6.0-10.0): Bold, dramatic effect
- **Bias** - Adjusts the saturation curve's asymmetry (-0.3 to 0.3)
  - 0.0: Symmetrical saturation
  - Positive: Makes the negative side of the waveform more prominent
  - Negative: Makes the positive side of the waveform more prominent
- **Mix** - Balances the effect with the original sound (0% to 100%)
  - 0-30%: Subtle enhancement
  - 30-70%: Balanced effect
  - 70-100%: Strong character
- **Gain** - Adjusts the overall volume (-18dB to +18dB)
  - Use negative values if the effect is too loud
  - Use positive values if the effect is too quiet

### Visual Display
- Clear graph showing how the sound is being shaped
- Real-time visual feedback
- Easy-to-read controls

### Music Enhancement Tips
- Classical & Jazz:
  - Light Drive (1.0-2.0) for natural warmth
  - Set Bias to 0.0 for clean saturation
  - Low Mix (20-40%) for subtlety
- Rock & Pop:
  - Medium Drive (3.0-5.0) for rich character
  - Keep Bias neutral for consistent response
  - Medium Mix (40-60%) for balance
- Electronic:
  - Higher Drive (4.0-7.0) for bold effect
  - Experiment with different Bias values
  - Higher Mix (60-80%) for character

### Quick Start Guide
1. Start with low Drive for gentle warmth
2. Set Bias to 0.0 first for symmetrical saturation
3. Adjust Mix to balance the effect
4. Adjust Gain if needed for proper volume
5. Experiment and trust your ears!

## Sub Synth

A specialized effect that reinforces the low end by mixing in a filtered low-frequency signal derived from the original audio. Useful when bass-light music needs more warmth, fullness, or headphone-friendly impact.

### Listening Enhancement Guide
- Bass Enhancement:
  - Adds depth and power to thin recordings
  - Creates fuller, richer low end
  - Perfect for headphone listening
- Frequency Control:
  - Control which added low-frequency range is kept
  - Independent filtering for clean bass
  - Maintains clarity while adding power

### Parameters
- **Sub Level** - Controls the added low-frequency signal level (0-200%)
  - Light (0-50%): Subtle bass enhancement
  - Medium (50-100%): Balanced bass boost
  - High (100-200%): Dramatic bass effect
- **Dry Level** - Adjusts the original signal level (0-200%)
  - Use to balance with the added low-frequency signal
  - Maintain clarity of original sound
- **Sub LPF** - Low-pass filter for the added low-frequency signal (5-400Hz)
  - Frequency: Controls upper limit of the added low-frequency signal
  - Slope: Adjusts filter steepness (Off to -24dB/oct)
- **Sub HPF** - High-pass filter for the added low-frequency signal (5-400Hz)
  - Frequency: Removes unwanted rumble from the added low-frequency signal
  - Slope: Controls filter steepness (Off to -24dB/oct)
- **Dry HPF** - High-pass filter for dry signal (5-400Hz)
  - Frequency: Prevents bass buildup
  - Slope: Adjusts filter steepness (Off to -24dB/oct)

### Visual Display
- Live frequency response graph
- Clear visualization of filter curves
- Real-time visual feedback

### Music Enhancement Tips
- For General Bass Enhancement:
  1. Start with Sub Level at 50%
  2. Set Sub LPF around 100Hz (-12dB/oct)
  3. Keep Sub HPF at 20Hz (-6dB/oct)
  4. Adjust Dry Level to taste

- For Clean Bass Boost:
  1. Set Sub Level to 70-100%
  2. Use Sub LPF at 80Hz (-18dB/oct)
  3. Set Sub HPF to 30Hz (-12dB/oct)
  4. Set Dry HPF to 40Hz (-6dB/oct)

- For Maximum Impact:
  1. Increase Sub Level to 150%
  2. Set Sub LPF to 120Hz (-24dB/oct)
  3. Keep Sub HPF at 15Hz (-6dB/oct)
  4. Balance with Dry Level

### Quick Start Guide
1. Start with moderate Sub Level (50-70%)
2. Set Sub LPF around 100Hz
3. Enable Sub HPF around 20Hz (-6dB/oct)
4. Adjust Dry Level for balance
5. Fine-tune filters to taste
6. Trust your ears and adjust gradually!
