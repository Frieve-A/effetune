---
title: "Saturation Plugins - EffeTune"
description: "Saturation and restoration plugins including Bandwidth Extender, Saturation, Exciter, Hard Clipping, and more."
lang: en
---

# Saturation Plugins

A collection of plugins for harmonic shaping and bandwidth restoration. They can add warmth or distortion, or generate restrained high-frequency content where a recording has a clear bandwidth limit.

## Plugin List

- [Bandwidth Extender](#bandwidth-extender) - Generates high-frequency content above a detected or specified cutoff
- [Dynamic Saturation](#dynamic-saturation) - Simulates the nonlinear displacement of speaker cones
- [Exciter](#exciter) - Add harmonic content to enhance clarity and presence
- [Hard Clipping](#hard-clipping) - Adds intensity and edge to the sound
- [Harmonic Distortion](#harmonic-distortion) - Adds character with adjustable 2nd- to 5th-order nonlinear distortion
- [Multiband Saturation](#multiband-saturation) - Shapes low, mid, and high frequency ranges independently
- [Saturation](#saturation) - Adds warmth and richness like vintage equipment
- [Sub Synth](#sub-synth) - Adds a filtered low-frequency signal for bass enhancement
- [Tube Simulator](#tube-simulator) - Models tube line stages and push-pull or single-ended power amplifiers

## Bandwidth Extender

Bandwidth Extender is intended for audio with a clear high-frequency cutoff, such as some low-bitrate MP3 files. It analyzes the stereo pair together and adds only newly generated content above the detected or specified boundary. It does not recover the original missing waveform, and it normally stays inactive when Auto cannot find a stable cutoff.

The generated band has two independently adjustable parts: input-related harmonic continuation and deterministic shaped noise. Harmonic continuation keeps tonal material connected to the remaining spectrum, while shaped noise gives percussion and other noise-like sounds a less artificial texture. The original sound remains present while these new components are added.

### Listening Enhancement Guide

- Start with **Auto** and both amounts at their 100% defaults for codec-limited music.
- If Auto does not engage despite a known cutoff, select **Manual** and set the boundary to the source's measured cutoff.
- Reduce **Noise Amount** for sustained tonal material, or reduce **Harmonic Amount** for percussion and breath-like material. Keep both active when the source contains a mixture.
- Compare with bypass at matched level. Raising either amount increases only that generated component and cannot reconstruct details that are absent from the source.
- Do not use this as a general brightener for already full-band audio; Exciter is designed for that different purpose.

### Parameters

- **Harmonic Amount** (0-200%, default 100%) - Controls harmonic continuation independently. 0% removes this component, 100% is its reference level, and 200% doubles it without changing shaped noise or the dry signal.
- **Noise Amount** (0-200%, default 100%) - Controls deterministic shaped noise independently. 0% removes this component, 100% is its reference level, and 200% doubles it without changing harmonic continuation or the dry signal.
- **Cutoff** - Selects how the missing-band boundary is chosen.
  - **Auto** looks for a steep, persistent spectral drop shared by the stereo pair and reduces the effect when confidence is low.
  - **Manual** uses the Manual Cutoff value. The generated band is automatically kept within the frequency range available for playback.
- **Manual Cutoff** (6000-24000 Hz) - Sets the start of generation in Manual mode. Match the measured source boundary instead of lowering it simply to make the effect more obvious.

Bandwidth Extender adds about 26.7–29.0 ms of delay, including one extra processing hop: 1,280 samples at 48 kHz, 2,560 samples at 96 kHz, or 5,120 samples at 192 kHz. If it cannot run with the current sample rate, channel setting, or device, the plugin reports that it is bypassed and the audio remains unchanged. Use a supported setting or disable the plugin.

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

### System Presets

Click **Effect Presets** in the effect header to compare complete cone-motion settings.

- **Subtle Cone Color** - A restrained, mostly clean speaker-cone character.
- **Pushed Speaker** - Stronger cone motion and saturation with output compensation.
- **Ragged Cone** - The most pronounced, deliberately rough cone character.

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

## Tube Simulator

Tube Simulator adds the changing harmonics, compression, and power-supply response of tube line and power-amplifier circuits. **Line** uses the driver stage alone, **Push-Pull Power** offers balanced EL84, EL34, 6L6GC, and KT88 circuits, and **SE Triode** offers single-ended 300B and 2A3 circuits. Both power circuits also model the output transformer core, whose magnetic saturation and hysteresis add distortion on loud low frequencies. It models the amplifier's electrical speaker load, but does not add a speaker cabinet or microphone sound.

### Listening Enhancement Guide

- For subtle coloration, choose the **Pre** group with an **@0.01%** or **@0.1%** suffix. Choose an **@1%** or **@2%** suffix when you want the added harmonics and compression to be easier to hear.
- Choose **Pre** for the line-stage sound, **Power** for the output stage alone, or **Pre+Power** for the complete amplifier path.
- Start with **EL84 Distributed 10 W @2%** for a restrained push-pull sound. Compare it with **EL84 Pentode 10 W @2%** for a firmer, more direct character.
- Try **300B SE @2%** or **2A3 SE @2%** for stronger even-order harmonics and a softer single-ended response.
- Lower **Input Volume** if the sound is too compressed or distorted. Use **Output Trim** afterward to match the listening level.
- Lower **Negative Feedback** for a looser, more harmonically colored response; raise it for tighter control. For SE Triode, start at 3dB and stay near 0-6dB.
- Lower **Wet/Dry Mix** when you want only a trace of the effect.

### Panel Layout

The controls are arranged in five tabs.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Driver Type, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit; Push-Pull Power Tube, Output B+, and Cathode Resistor; SE Triode, SE B+, and SE Cathode Resistor
- **Transformer** - Screen Tap, Push-Pull Primary, SE Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

The Power and Transformer tabs show only controls used by the selected Output Circuit.

### Choosing a Preset

Click the effect header's **Effect Presets** button to open the preset dialog. Choose a setting from System Presets in the Pre, Power, or Pre+Power group to apply it immediately. A preset that matches the current settings is highlighted; if none matches, no preset is highlighted. The initial settings match **EL84 Pentode @2%**. **Output Safety Trim** and **Auto Gain Reduction** are not used for matching, so changing them does not remove the highlight.

The preset suffix is a practical guide to effect strength: **@0.01%** is very subtle, **@0.1%** adds light coloration, and **@1%** or **@2%** makes harmonics and compression more apparent. Presets also set Output Trim to make comparisons easier, but perceived loudness can still vary with the music. Match levels with Output Trim before deciding which sound you prefer.

### Parameters

- **Input Volume** (-96 to 0dB) - Reduces the level driving the selected signal path
  - 0dB is fully open; lower values reduce internal drive and increase headroom
- **Driver Type** (12AX7, 12AT7, 12AU7, or Bypass) - Selects the two-stage driver tubes or removes that driver from the signal path
  - 12AX7 has the highest voltage gain, 12AT7 is intermediate, and 12AU7 has the lowest gain and the most headroom
  - In Push-Pull Power it feeds the fixed 12AX7 phase inverter; in SE Triode it drives the selected output triode directly
  - Bypass is intended for the Power presets. Push-Pull Power still includes its phase inverter; SE Triode feeds the output triode without the common driver. Line with Bypass is an aligned pass-through, and Negative Feedback has no effect there
- **Bias** (-50 to +50%) - Shifts the cathode-bias point of the two driver stages
  - Raising it lowers their modeled cathode resistance and moves them toward higher current; lowering it does the opposite
- **Plate** (150 to 300 V) - Sets the driver-stage plate supply
  - Higher values generally provide more voltage headroom; lower values bring compression and nonlinearity in sooner
- **Source Z** (0.6 to 100 kΩ) - Sets the source impedance feeding Stage 1
  - Higher values interact more strongly with the input capacitances and can soften high-frequency or transient drive
- **Supply** (0.1 to 47 kΩ) - Sets the resistance of the driver-stage B+ supply
  - Higher values produce more supply sag as current rises; lower values make the supply stiffer
- **Negative Feedback** (0 to 30dB) - Sets the global negative-feedback amount
  - Line returns the second-stage plate response; both power topologies return a fixed transformer-secondary feedback winding
  - Increasing it generally reduces open-loop gain and distortion and tightens the response; 0dB opens the feedback loop
  - SE Triode is intended for light feedback: start at 3dB and normally stay within 0–6dB
  - The electrical damping of the speaker load comes out of this loop itself, so raising it also tightens the amplifier's grip on the load
- **Output Trim** (-48 to +48dB) - Adjusts the wet digital level after the modeled circuit without changing its internal drive
- **Output Safety Trim** (-96 to 0dB) - Applies a separate linear trim after the modeled circuit, kept apart from Output Trim so that the output-level protection has a control of its own
  - Auto Gain Reduction lowers this trim only; it never writes to Output Trim
  - The slider and its value box show the effective trim, which is the value you set minus any automatic reduction currently applied; the stored setting is the value you last set yourself, and that is what is saved
  - Taking hold of the slider makes the displayed effective value your setting, so the level does not jump, and the accumulated reduction is cleared at that point
- **Auto Gain Reduction** (on by default) - Lets the output-level protection reduce Output Safety Trim on its own
  - With it off, no new reduction accumulates and any reduction already applied stays applied
- **Wet/Dry Mix** (0 to 100%) - Blends the processed signal with the latency-aligned original
  - At 0%, the dry path still carries the fixed 64-sample delay needed for alignment
- **Input Reference** (0.100 to 300.000 Vpk) - Peak terminal voltage represented by a digital 0dBFS peak
  - 2.828 Vpk corresponds to a 2 Vrms full-scale sine; 5.657 Vpk corresponds to 4 Vrms
  - Higher values drive the modeled circuit harder; use Input Volume for the main listening adjustment
- **Output Circuit** (Line, Push-Pull Power, or SE Triode) - Selects the modeled topology
  - Line stops after the two-stage driver and does not run the power-tube, transformer, or speaker-load model
  - Push-Pull Power adds the phase inverter and complete power-output circuit
  - SE Triode adds one directly driven 300B or 2A3 and a gapped single-ended output transformer
- **Power Tubes** (EL84 ×2, EL34 ×2, 6L6GC ×2, or KT88 ×2) - Selects the output-tube current model and its associated circuit components; it affects only Power mode
  - All four models follow real output-tube data across plate, screen, and grid voltage, including the complete cutoff reached when the grid is driven far enough negative
- **Output B+** (300 to 470 V) - Sets the power-stage supply voltage; higher values increase available voltage swing and tube dissipation
- **Cathode Resistor** (270 to 500 Ω / valve) - Sets the separate cathode-bias resistor for each output tube
  - Higher resistance reduces the idle current; lower resistance raises it
- **SE Triode** (300B or 2A3) - Selects the single-ended directly heated output-triode model; it affects only SE Triode mode
- **SE B+** (250 to 450 V) - Sets the single-ended output-stage supply voltage
- **SE Cathode Resistor** (700 to 1300 Ω) - Sets the single output triode's cathode-bias resistor
- **Screen Tap** (0%, 20%, or 43%) - Selects the output-tube screen connection
  - 0% uses the fixed screen supply; 20% and 43% connect the screens to the corresponding transformer-primary taps for distributed (ultra-linear) loading
  - The tap is a turns ratio, so the screens follow that share of the magnetic coupling in the primary winding
- **Push-Pull Primary** (6.0, 6.6, or 8.0 kΩ) - Selects the push-pull output transformer's plate-to-plate primary impedance and, together with Assumed Speaker Load, its turns ratio
  - The choice also sets the core's magnetic saturation flux
- **SE Primary** (2.5, 3.5, or 5.0 kΩ) - Selects the gapped single-ended transformer's primary impedance and, together with Assumed Speaker Load, its turns ratio
  - The choice also sets how much flux a given signal drives into the gapped core, so higher impedances reach saturation sooner at the same level. The idle current of single-ended operation keeps a standing flux in the core, so the signal saturates it asymmetrically and adds even-order harmonics at low frequencies
- **Assumed Speaker Load** (4, 8, 15, or 16 Ω) - Selects the transformer secondary tap and the nominal speaker impedance the circuit is built around
  - Each choice uses a frequency-dependent electrical RLC load rather than a simple resistor and affects transformer loading and feedback
- **Actual Speaker Load** (2 to 32 Ω) - Sets the impedance of the speaker actually connected to that tap
  - The load network is scaled by its ratio to Assumed Speaker Load, so the resonance frequency and Q are kept and only the impedance level moves
  - The turns ratio stays on Assumed Speaker Load, so a mismatch reflects a different impedance to the output tubes and changes damping, available power, and drive; setting the two alike runs the circuit at its design point

### Output Level Protection

Changing circuit parameters can cause a large level jump. With **Auto Gain Reduction** on, Tube Simulator lowers **Output Safety Trim** when the wet output would exceed digital full scale. The reduction stays in place rather than recovering automatically, and the status below the graph shows the current amount.

- If the reduction becomes large, lower Input Volume or Output Trim, then select a preset again or adjust Output Safety Trim.
- Turn Auto Gain Reduction off only when you are already monitoring output peaks elsewhere.
- This protection reduces output level; it does not remove the harmonic distortion or compression created inside the selected circuit.

### Safety Bypass and Recovery

- If an unstable setting activates bypass, lower Negative Feedback or select a preset. Processing returns automatically once the setting is stable.
- If the status still shows bypass, restore a preset and reload the effect. When processing is unavailable on the device, the audio passes through unchanged.

### How to Read the HUD

- The dots show recent operating points. A wider spread means the music is driving that stage harder. Each panel carries both channels: blue is left and orange is right.
- **Graph** above the display chooses which valves to watch. **Stage 1 / Stage 2** shows the two driver stages, **Push / Pull** the two sides of the push-pull output pair, and **SE Triode** the single-ended output valve. Only the groups the current circuit actually uses can be selected, so with a driver in front of a power stage you can switch between the two and compare them.
- When no valve is running at all — Line with **Driver Type** set to Bypass, or the effect switched off — the display stays empty and the status reads **No tube stage is active**.
- **Speaker Output** and **Speaker Real Power** show how strongly the modeled power stage and speaker load are being driven.
- **Transformer Flux** shows the magnitude of the output transformer's flux linkage in Wb. The harder low frequencies push this reading upward, the more distortion the transformer itself is adding. In SE Triode the reading includes the standing bias flux of the gapped core, so it stays above zero even with no signal.
- The status below the graph shows whether the effect is active or bypassed and displays any automatic output reduction.

Tube Simulator adds a short processing delay of about 0.3-1.5ms, depending on sample rate.
