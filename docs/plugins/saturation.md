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
- [Tube Simulator](#tube-simulator) - Models tube line stages and a push-pull power amplifier

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

## Tube Simulator

Tube Simulator models a complete electrical signal path built from tube-circuit component values. **Line** uses the two-stage small-signal tube amplifier by itself. **Push-Pull Power** passes that same driver through a fixed volume control into a 12AX7 phase inverter that is solved as a differential pair of real tubes, and from there into a pair of EL84 or EL34 output tubes, an output transformer, and a frequency-dependent speaker load. Bias, B+, transformer, and speaker-load states are solved as the music changes, so the harmonic content, compression, supply sag, and electrical damping respond to the signal instead of being added as a fixed distortion curve. The speaker load models the electrical load on the amplifier; it is not a cabinet or microphone simulation.

### Listening Enhancement Guide

- The plug-in opens on **EL84 Pentode @2%**, so a 2 Vrms D/A converter needs no setup. Its actual product defaults are Input Reference 2.828 Vpk, Input Volume -55.9648dB, 12AX7, Negative Feedback 3dB, and Output Trim +4.626dB, which places the EL84 push-pull circuit at 2% total harmonic distortion at unity gain.
- If it sounds too saturated, lower Input Volume to reduce the voltage entering the circuit, then use Output Trim only to restore the listening level. Output Trim does not recover internal headroom.
- Select **Line Default** when you want the small-signal line circuit on its own instead of a power amplifier.
- Use the **Listening (THD-matched)** presets when you want to compare tubes and circuits by character alone. They are already matched to one another in loudness, so nothing needs to be trimmed between them.
- For a restrained power-amplifier response, start with **EL84 Distributed 10 W**. Compare it with **EL84 Pentode 10 W** to hear the effect of the screen connection and transformer loading while keeping the output-tube family the same.
- Use **EL34 Distributed 20–37 W** when you want to explore the higher-voltage EL34 circuit. Match loudness with Output Trim before comparing it with either EL84 preset.
- Lower Negative Feedback for more of the circuit's open-loop harmonic and level response; raise it for a more controlled closed-loop response. Some extreme combinations can become unstable, so return to a preset if the safety bypass appears.
- Lower Wet/Dry Mix when you want the modeled circuit to remain a subtle part of the result.

### Panel Layout

The 20 parameters are arranged in five tabs below the **Preset** dropdown.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Tube, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit, Power Tubes, Output B+, Cathode Resistor
- **Transformer** - Screen Tap, Transformer Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

The Preset dropdown lists **Custom** first, followed by the **Listening (THD-matched)** and **Circuit** groups; Custom is shown whenever the current settings match no preset; the output-protection settings (Output Safety Trim and Auto Gain Reduction) are not part of that comparison. While Output Circuit is Line, the seven power-circuit controls on the Power and Transformer tabs are dimmed. They stay adjustable and keep their values.

### Circuit Presets and Defaults

The plug-in opens with the **EL84 Pentode @2%** listening preset. Selecting a preset writes the complete circuit shown below; changing any value afterward creates a custom setting.

| Circuit Preset | Output Circuit | Driver / Power Tubes | Negative Feedback | Power settings | Input / output |
| --- | --- | --- | ---: | --- | --- |
| Line Default | Line | 12AU7 / — | 30dB | Power controls retained but dimmed | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim +9dB |
| EL84 Pentode 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 329.696 V, Cathode Resistor 270 Ω / valve, Screen Tap 0%, Transformer Primary 8.0 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |
| EL84 Distributed 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 330.107 V, Cathode Resistor 270 Ω / valve, Screen Tap 20%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |
| EL34 Distributed 20–37 W | Push-Pull Power | 12AX7 / EL34 ×2 | 4dB | Output B+ 443.775 V, Cathode Resistor 470 Ω / valve, Screen Tap 43%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 8 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |

All four presets use Bias 0%, Plate 250 V, Source Z 10 kΩ, Supply 10 kΩ, and Wet/Dry Mix 100%. Every preset also sets Actual Speaker Load to its Assumed Speaker Load, so it starts at the circuit's design point.

### Listening Presets

The **Listening (THD-matched)** group holds seven calibrated settings. Each one inherits every circuit value from the Circuit preset it is based on, and only Input Volume, Input Reference, and Output Trim are calibrated, so the circuit itself is left untouched. All seven land within ±0.0005dB of the same 1 kHz level, so switching between them changes the character and not the loudness.

| Listening Preset | Based on | Circuit change | Input Volume | Input Reference | Output Trim |
| --- | --- | --- | ---: | ---: | ---: |
| Line 12AU7 @1% | Line Default | — | 0dB | 20 Vpk | -7.749dB |
| Line 12AT7 @1% | Line Default | Tube 12AT7 | -3.6973dB | 2.828 Vpk | -9.42dB |
| Line 12AX7 @1% | Line Default | Tube 12AX7 | -4.4805dB | 2.828 Vpk | -11.276dB |
| Line 12AU7 Open-Loop @3% | Line Default | Negative Feedback 0dB | -16.793dB | 2.828 Vpk | +26.427dB |
| EL84 Pentode @2% | EL84 Pentode 10 W | — | -55.9648dB | 2.828 Vpk | +4.626dB |
| EL84 Distributed @2% | EL84 Distributed 10 W | — | -52.9414dB | 2.828 Vpk | +4.908dB |
| EL34 Distributed @2% | EL34 Distributed 20–37 W | — | -43.6504dB | 2.828 Vpk | +5.212dB |

The 12AU7 line circuit stops just short of 1% distortion even at the Input Reference ceiling, so Line 12AU7 @1% sits at the highest figure that circuit reaches.

### Parameters

- **Preset** - Loads a Circuit preset (Line Default or one of the three complete power-amplifier circuits) or one of the Listening (THD-matched) settings
- **Input Volume** (-96 to 0dB) - Passive attenuation between the calibrated input terminal and Stage 1
  - 0dB is fully open; lower values reduce internal drive and increase headroom
- **Tube** (12AX7, 12AT7, or 12AU7) - Selects the two-stage driver tubes
  - 12AX7 has the highest voltage gain, 12AT7 is intermediate, and 12AU7 has the lowest gain and the most headroom
  - In Power mode this two-stage circuit remains the driver, feeding the fixed 12AX7 phase inverter through a fixed volume control
- **Bias** (-50 to +50%) - Shifts the cathode-bias point of the two driver stages
  - Raising it lowers their modeled cathode resistance and moves them toward higher current; lowering it does the opposite
- **Plate** (150 to 300 V) - Sets the driver-stage plate supply
  - Higher values generally provide more voltage headroom; lower values bring compression and nonlinearity in sooner
- **Source Z** (0.6 to 100 kΩ) - Sets the source impedance feeding Stage 1
  - Higher values interact more strongly with the input capacitances and can soften high-frequency or transient drive
- **Supply** (0.1 to 47 kΩ) - Sets the resistance of the driver-stage B+ supply
  - Higher values produce more supply sag as current rises; lower values make the supply stiffer
- **Negative Feedback** (0 to 30dB) - Sets the calibrated global negative-feedback amount
  - Line returns the second-stage plate response; Push-Pull Power returns a fixed transformer-secondary feedback winding
  - Increasing it generally reduces open-loop gain and distortion and tightens the response; 0dB opens the feedback loop
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
- **Input Reference** (0.100 to 20.000 Vpk) - Peak terminal voltage represented by a digital 0dBFS peak
  - 2.828 Vpk corresponds to a 2 Vrms full-scale sine; 5.657 Vpk corresponds to 4 Vrms
  - Stage 1 receives Input Reference multiplied by Input Volume; this is physical calibration, not another output-gain control
- **Output Circuit** (Line or Push-Pull Power) - Selects the modeled topology
  - Line stops after the two-stage driver and does not run the power-tube, transformer, or speaker-load model
  - Push-Pull Power adds the phase inverter and complete power-output circuit
- **Power Tubes** (EL84 ×2 or EL34 ×2) - Selects the output-tube current model and its associated circuit components; it affects only Power mode
  - Both models follow real output-tube data across plate, screen, and grid voltage, including the complete cutoff reached when the grid is driven far enough negative
- **Output B+** (300 to 470 V) - Sets the power-stage supply voltage; higher values increase available voltage swing and tube dissipation
- **Cathode Resistor** (270 to 500 Ω / valve) - Sets the separate cathode-bias resistor for each output tube
  - Higher resistance reduces the idle current; lower resistance raises it
- **Screen Tap** (0%, 20%, or 43%) - Selects the output-tube screen connection
  - 0% uses the fixed screen supply; 20% and 43% connect the screens to the corresponding transformer-primary taps for distributed (ultra-linear) loading
  - The tap is a turns ratio, so the screens follow that share of the magnetic coupling in the primary winding
- **Transformer Primary** (6.0, 6.6, or 8.0 kΩ) - Selects the output transformer's plate-to-plate primary impedance and, together with Assumed Speaker Load, its turns ratio
- **Assumed Speaker Load** (4, 8, 15, or 16 Ω) - Selects the transformer secondary tap and the nominal speaker impedance the circuit is built around
  - Each choice uses a frequency-dependent electrical RLC load rather than a simple resistor and affects transformer loading and feedback
- **Actual Speaker Load** (2 to 32 Ω) - Sets the impedance of the speaker actually connected to that tap
  - The load network is scaled by its ratio to Assumed Speaker Load, so the resonance frequency and Q are kept and only the impedance level moves
  - The turns ratio stays on Assumed Speaker Load, so a mismatch reflects a different impedance to the output tubes and changes damping, available power, and drive; setting the two alike runs the circuit at its design point

### Output Level Protection

The Circuit presets are not matched to one another in loudness. Changing Tube from 12AU7 to 12AX7 raises the level by about 25dB, and changing Output Circuit from Line to Push-Pull Power raises it by about 33dB, because the two circuits normalize to different full-scale references. Output Safety Trim and Auto Gain Reduction protect the equipment connected to the output from that jump.

- Whenever the magnitude of an output sample exceeds 0 dBFS peak, Output Safety Trim is reduced immediately by exactly the amount that sample overshoots by. Every sample is examined, so there is no detection window and no averaging. The threshold is a fixed policy value.
- The reduction is applied over a 20 ms one-way ramp, so the level moves without a step.
- It only reduces and never restores. There is no release and no recovery, so it is neither a limiter nor an auto-leveler.
- The slider and its value box show the effective trim, which is your setting minus the reduction currently applied. The stored setting stays at the value you last set yourself, and that is what is saved.
- The accumulated reduction is cleared when you take hold of Output Safety Trim yourself. The displayed effective value becomes your setting at that point, so the level does not jump.
- Loading a preset sets Output Safety Trim back to 0dB. The accumulated reduction is cleared whenever the trim value itself changes or a single commit changes two or more values at once, as a preset load normally does; re-selecting the preset the circuit is already on after moving one control changes only that single value and keeps the reduction.
- With Auto Gain Reduction off, no new reduction accumulates and any reduction already applied stays applied.
- The current reduction is reported in the status line below the graph, including when it is 0.0 dB.
- The mechanism sits outside the amplifier model. The circuit solving, harmonics, compression, and supply sag are unchanged; only the output level changes, never the character of the overload. What it suppresses is digital full-scale overshoot at the output, not the distortion the model produces.

### Safety Bypass and Recovery

- If the circuit model detects feedback oscillation, it fades the wet circuit output to the latency-aligned dry path and latches the safe bypass. Lower Negative Feedback, select a canonical preset, or change another circuit setting. The new setting is checked while the output stays dry; stable operation returns with a smooth fade, while continuing instability remains bypassed.
- If the model encounters another processing-safety failure, it switches to the safe dry output. Restore the default circuit settings, then reload the effect.
- Unsupported sample rates or channel modes, unavailable WebAssembly processing, and a stopped processing engine also bypass the effect. The status below the HUD explains the action to take.

### How to Read the HUD

- **Input Reference (0 dBFS)** shows the terminal calibration as Vpk, sine Vrms, and **dBuFS**. **Stage 1 External Input (0 dBFS)** shows the peak after Input Volume.
- **Stage 1 Bias**, **Stage 2 Bias**, **B+**, and **Plate − B+ Sag** report the live operating points of the two-stage driver in both output modes. A more negative sag value means the plate sits farther below its supply.
- In Line, the two graph panels show Stage 1 and Stage 2. The thin gray curves are static plate characteristics and the dashed line is the load line, while the recent operating points are plotted as individual points rather than a connected line.
- In Push-Pull Power, the graph panels change to **Push** and **Pull** load lines and plot the two output tubes' recent plate-current operating points.
- The horizontal graph axis is anode-to-cathode voltage, **Vak (V)**, and the vertical axis is plate current, **Ia (mA)**. Cyan is the left audio channel and orange is the right; points spread over a wider area mean the signal is moving that stage through a wider operating range.
- **Power LTP Balance** shows the phase inverter's differential voltage, and **Power B+** shows the live power-stage supply after sag.
- **Speaker Output (100 ms)** and **Speaker Real Power (100 ms)** show non-overlapping 100 ms electrical measurements at the selected speaker load. Real Power is calculated from instantaneous load voltage and current, so it is not simply Vrms squared divided by the nominal impedance.
- **Transformer Flux** shows the output transformer's modeled magnetic flux in webers. Power-only readings are meaningful when Push-Pull Power is selected.
- The status below the graph reports whether processing is loading, active, or safely bypassed, and always shows the current output-protection reduction in dB, including when it is 0.0 dB.

### Processing Requirements and Latency

- Tube Simulator processes 44.1, 48, 88.2, 96, 176.4, and 192 kHz audio using WebAssembly
- The 44.1 kHz rate family is processed internally at 352.8 kHz, and the 48 kHz rate family is processed internally at 384 kHz
- At 44.1 or 48 kHz, the application's normal low-sample-rate warning remains visible because the source audio does not contain the high-frequency information available at higher rates
- Stereo and channel-pair modes are supported; unsupported sample rates or channel modes use the bypass path
- The oversampling filters add a fixed 64-sample latency at every supported rate (about 1.45ms at 44.1 kHz and 0.33ms at 192 kHz)
