---
title: "EQ Plugins - EffeTune"
description: "Equalizer plugins including Parametric EQ, FIR EQ, Graphic EQ, Dynamic EQ, Room EQ, Earphone Cable Sim, filters, and Tone Control."
lang: en
---

# Equalizer Plugins

A collection of plugins that let you adjust different aspects of your music's sound, from deep bass to crisp highs. These tools help you personalize your listening experience by enhancing or reducing specific sound elements.

<!-- spectrum-overlay -->
## Spectrum Overlay

Press the spectrum icon on a compatible graph to cycle through After, Before + After, and Off. After shows only the processed spectrum as a blue line. Before + After fills the change from the unprocessed spectrum to the processed spectrum: warm color marks frequencies whose level is higher after processing, blue marks frequencies whose level is lower, and a gray line marks the After spectrum. Both views use 1/12-octave smoothing to make high-frequency trends easier to read. Use the comparison to see how each adjustment changes bass, mids, and treble while listening. Read spectrum levels on the dBFS scale at the right of the graph. It is separate from the graph's gain scale; 0 dBFS is the full-scale digital reference, and lower values are quieter. Only the processed spectrum is collected in After mode; collection and drawing stop in Off.

On the draggable point graphs in 5Band PEQ, 15Band PEQ, 5Band FIR PEQ, Group Delay PEQ, and Room EQ's Additional EQ, drag a point normally to change both axes. Hold Shift while dragging to lock the movement: start mostly sideways to change only Frequency, or mostly vertically to change only Level (Delay in Group Delay PEQ). Release Shift to return to free movement. Place the pointer over a point and scroll up to increase Q or down to decrease it.

## Plugin List

- [15Band GEQ](#15band-geq) - Detailed sound adjustment with 15 precise controls
- [15Band PEQ](#15band-peq) - Detailed 15-band tone shaping for music playback
- [5Band Dynamic EQ](#5band-dynamic-eq) - Dynamics-based equalizer that responds to your music
- [5Band FIR PEQ](#5band-fir-peq) - Five-band tone shaping with minimum- or linear-phase FIR filtering
- [5Band PEQ](#5band-peq) - Flexible equalizer for shaping bass, mids, and treble
- [Band Pass Filter](#band-pass-filter) - Focus on specific frequencies
- [Comb Filter](#comb-filter) - Phasey, hollow, or metallic sound coloration
- [Earphone Cable Sim](#earphone-cable-sim) - Helps check how small normal earphone-cable response shifts usually are
- [Group Delay EQ](#group-delay-eq) - Adjusts the delay of each frequency band without changing the tone
- [Group Delay PEQ](#group-delay-peq) - Five-band parametric control of per-frequency delay without changing the tone
- [Hi Pass Filter](#hi-pass-filter) - Remove unwanted low frequencies with precision
- [Lo Pass Filter](#lo-pass-filter) - Remove unwanted high frequencies with precision
- [Loudness Equalizer](#loudness-equalizer) - Frequency balance correction for low volume listening
- [Narrow Range](#narrow-range) - Focus on specific parts of the sound
- [Room EQ](#room-eq) - FIR correction from saved room measurements
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
- Double-click a slider to return that band to 0dB

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

## 5Band FIR PEQ

5Band FIR PEQ provides the familiar five-band layout of 5Band PEQ but builds the combined response as one FIR filter. Use it for precise playback correction, very narrow cuts, or steep shelf transitions when you want to avoid recursive-filter stability limits. Minimum Phase keeps processing delay low, while Linear Phase gives every frequency the same fixed delay. The plugin requires the WASM DSP engine; without it, the signal passes through unchanged.

### Sound Enhancement Guide

- Start with **Minimum Phase**, 32768 Taps, and 128 samples of Latency. Use broad Q values around 0.7 to 2 for ordinary bass, midrange, and treble shaping.
- For a measured narrow peak, select Peaking, set the center frequency to the peak, and increase Q gradually. Values above 10 are intended for precise corrections; check the status because an extremely narrow response may need more Taps.
- Use Low Shelf for bass balance and High Shelf for treble balance. Small changes of 1 to 3 dB are usually enough for everyday listening.
- Use LowPass or HighPass to remove unwanted frequency extremes. Start with a 12 or 24 dB/oct Slope, and increase it only when you need a sharper cutoff.
- Choose **Linear Phase** when constant phase delay across the spectrum is important and the added latency is acceptable. It can place energy before a transient, especially with sharp settings, so compare Minimum Phase for music with strong attacks.
- FIR construction avoids feedback-pole instability, but a large boost or very high Q still produces a long, selective impulse response. Prefer cuts for isolated resonances and leave enough playback headroom.

### Parameters

- **Phase**
  - **Minimum Phase** - Builds a causal minimum-phase response and adds no FIR half-length delay. The selected convolution Latency still applies.
  - **Linear Phase** - Builds a symmetric linear-phase response and adds `Taps / 2` samples of FIR delay in addition to the selected convolution Latency.
- **Taps** - FIR length: 8192, 16384, 32768, 65536, or 131072. More taps improve the accuracy of low-frequency and very high-Q settings, but increase memory use, design time, and Linear Phase delay.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing.
- **Five Adjustable Bands** - The default centers are 100 Hz, 316 Hz, 1 kHz, 3.16 kHz, and 10 kHz. Each band can be enabled independently.
- **Type** - Peaking, LowPass, HighPass, Low Shelf, High Shelf, BandPass, or Notch. All enabled bands are combined before the FIR is designed.
- **Freq** - Sets the band frequency from 20 Hz to 20 kHz.
- **Gain** - Sets the boost or cut from -20 to +20 dB for Peaking, Low Shelf, and High Shelf. LowPass, HighPass, BandPass, and Notch do not use Gain.
- **Q** - Sets the response width from 0.1 to 100. Higher values make a narrower change; lower values make a broader transition. The slider uses a logarithmic scale.
- **Slope** - Sets the LowPass or HighPass cutoff rate from 0.1 to 384 dB/oct. The slider uses a logarithmic scale, and the control is available only for those two filter types.

### Visual Display

- The grey curve shows the combined target response requested by the current band settings.
- The green curve shows the magnitude response realized by the designed FIR. A visible gap means the selected Taps cannot reproduce the target exactly.
- Numbered markers correspond to the five bands. Drag horizontally to change frequency and vertically to change gain; disabled bands appear dimmed.
- The status line reports whether the FIR is being designed, prepared, or used, and shows total processing latency in samples and milliseconds.
- If the selected Taps cannot reproduce an extreme response accurately, the status recommends increasing Taps or reducing Q or Slope.

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

### System Presets

Click **Effect Presets** in the effect header to compare complete source-and-cable cases.

- **High Impedance Source** - A high-output-impedance source driving a low-impedance earphone.
- **Long Thin Cable** - Increased cable resistance and inductance.
- **Vintage Portable Out** - A higher-impedance portable output and 32 Ω earphone.

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

## Group Delay EQ

Group Delay EQ is the counterpart of an ordinary equalizer: instead of changing how loud each band is, it changes **when** each band arrives. Fifteen sliders set the delay of each frequency range, and the plugin builds one FIR filter designed to realize those delays with a flat magnitude response. A flat response is the design target, not a guarantee: finite Taps approximate that ideal target, and large or rapidly changing delay settings can create measurable magnitude ripple. Use it to compensate the timing errors of a speaker or crossover, or to hear for yourself how much phase distortion your system and your ears actually reveal. The plugin requires the WASM DSP engine; without it, the signal passes through unchanged.

Only the differences between bands matter for the sound. A filter that delays every band equally is just a plain delay, so the plugin keeps a fixed internal delay and lets you push each band earlier or later around it. While all sliders are at 0 ms the plugin is completely transparent and adds no latency at all.

### Sound Enhancement Guide

- **Speaker and subwoofer timing**: If bass arrives late compared with the rest of the music, delay the bands above the crossover by the same amount until the graph shows a flat line there. Typical corrections are 2 to 10 ms and are easiest to judge on kick drums and bass guitar.
- **Ported speakers and room modes**: A ported enclosure adds group delay around its tuning frequency. Lower the affected low band, or raise everything else, so the curve becomes flatter. Small residual differences below 50 Hz are normal.
- **Listening test for phase distortion**: Set one band to +10 ms, compare with the effect off, and then lower the value until you can no longer hear a difference. Interpret this as a phase-only comparison only when Ripple in the status line is sufficiently small and the green Realized curve closely overlaps the grey Target curve. Otherwise, magnitude changes or an inaccurately realized delay can also affect what you hear.
- **Work band by band**: Change one slider at a time and listen. Phase-only changes are subtle on most program material and show up mainly on transients such as drums, plucked strings, and piano attacks.
- **Watch the two curves**: If the green curve no longer follows the grey one, the current Taps setting cannot realize that shape. Increase Taps, or reduce the difference between neighbouring bands.

### Parameters

- **Taps** - FIR length: 4096, 8192, 16384, or 32768. Low frequencies need a long filter: at 96 kHz, 16384 taps track even large delay differences down to about 60 Hz, while shorter settings lose accuracy in the bass first. Taps also decide how much delay the filter can hold, and therefore how far the sliders reach. More taps mean more latency and more processing.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing.
- **Band Sliders (25 Hz to 16 kHz)** - Fifteen sliders set the group delay of each band. Positive values make that range arrive later, negative values earlier. The range covers the whole delay the filter can hold: at 96 kHz that is ±18.6 ms with 4096 taps and ±149.3 ms with 32768 taps. The highest band realizes those values in full, while lower bands need more taps to follow a large setting; the graph shows how far each one gets. The values are interpolated smoothly across frequency, so neighbouring bands always blend into each other.
- **Phase angle** - Below each millisecond value the slider shows the same delay as a phase rotation at the band centre frequency. Past a full turn the reading is split into whole cycles and the remaining angle, so `+2c180°` means two complete cycles plus a half turn.
- **Reset** - Double-click a slider to return that band to 0 ms. The Reset button on the graph clears every band at once.

Total latency is the Latency setting plus half the Taps count. It stays the same while you move the sliders, so only a change of Taps or Latency changes the delay of the whole chain.

### Visual Display

- The grey curve is the target: the delay you asked for, interpolated across a logarithmic frequency axis from 20 Hz to 20 kHz. The delay axis rescales itself to fit the current settings, starting at ±5 ms.
- The green curve is what the designed filter really does. Where the two curves lie on top of each other the setting is fully realized; where they separate, the filter cannot follow the request with the current Taps.
- The status line shows the total latency in samples and milliseconds, and the magnitude ripple of the filter. Ripple measures how far the realized magnitude response departs from the flat design target: smaller values are closer to the target, and 0.3 dB is the accuracy-warning threshold.

## Group Delay PEQ

Group Delay PEQ is the parametric version of Group Delay EQ. Instead of fifteen fixed sliders it gives you five freely placed bands, each with its own shape, frequency, delay amount, and Q. The enabled bands are added together into one target delay curve, and the plugin builds a single FIR filter designed to realize that curve with a flat magnitude response. A flat response is the design target, not a guarantee: finite Taps approximate that ideal target, and large or very narrow delay shapes can create measurable magnitude ripple. Use it when the timing error you want to correct has a known shape - a crossover, a ported enclosure, a steep high-pass, or a resonance - because one or two bands can then reproduce that shape directly. The plugin requires the WASM DSP engine; without it, the signal passes through unchanged.

Only the differences between frequencies matter for the sound. A filter that delays everything equally is just a plain delay, so the plugin keeps a fixed internal delay and lets you push each region earlier or later around it. While every enabled band is at 0 ms the plugin is completely transparent and adds no latency at all. Because the magnitude response stays flat, the effect is subtle: it changes timing, not tone, and it is easiest to hear on transients such as drums, plucked strings, and piano attacks.

### Sound Enhancement Guide

- **Copy a known filter with Filter GD**: A second-order analog section has a group-delay hump whose shape is fixed by its cutoff frequency and Q. Enter those two values into Freq and Q, then set Delay to minus the height of the hump you measured, and the band cancels it. A closed-box subwoofer or an LR2 crossover sum needs one band, a fourth-order bass-reflex alignment or an LR4 sum is covered by one or two.
- **Align a whole region with the shelves**: When one part of the spectrum arrives late as a group rather than around a single frequency, use Low Shelf or High Shelf with Q 2 to 4. That produces a step of roughly one octave in width, so everything on one side of the corner frequency is shifted by the same amount.
- **Touch up what is left with Peak**: Peak is a smooth bell whose half-width follows Q exactly as in a parametric EQ. Use it for the residual bumps that no single filter shape explains.
- **Be realistic about high-frequency crossovers**: An LR4 crossover at 3 kHz has a group-delay peak of only about 0.2 ms. Correcting it is below the threshold of audibility, so the benefit there is marginal; low-frequency timing errors are far more worthwhile.
- **Low frequencies and high Q need long filters**: Correcting a low-frequency resonance with a high Q, around Q 8, requires 32768 taps at 96 kHz. Watch the two curves: if the green one cannot follow the grey one, increase Taps or lower Q.
- **Work band by band**: Change one band at a time and listen. Phase-only changes are subtle on most program material, and comparing with the effect off tells you more than looking at the graph alone.

### Parameters

- **Type** - Selects the delay shape of the band. All four types are described by the same three values, Freq, Delay, and Q, and Delay is always the extreme value of that band's own curve.
  - **Peak** - A bell centred on Freq whose half-width equals the bandwidth implied by Q. It never overshoots, so it is the natural choice for free-form corrections and for touching up residual deviations.
  - **Low Shelf** - A smooth step that holds Delay below Freq, passes half of Delay at Freq, and falls to zero above it. Q sets the steepness of the transition: Q 1 matches the group-delay transition of a first-order allpass, while Q 2 to 4 gives the practical, roughly one-octave step used for band-limited alignment.
  - **High Shelf** - The mirror image of Low Shelf, and its complement: the two shapes at the same Freq and Q add up to a constant Delay.
  - **Filter GD** - Adds or subtracts the group-delay shape of one analog filter stage (high-pass, crossover, or resonance) as it is. Enter the cutoff frequency and Q of the filter you are correcting into Freq and Q, and the height of the hump on the measured group-delay curve into Delay, using a negative value to cancel it.
- **Freq** - Sets the band frequency from 20 Hz to 20 kHz.
- **Delay** - Sets the extreme value of that band's own curve in milliseconds. Positive values make that region arrive later, negative values earlier. The range covers the whole delay the filter can hold: at 96 kHz that is ±18.6 ms with 4096 taps and ±149.3 ms with 32768 taps. Changing Taps or the sample rate clamps the stored values to the new limit.
- **Q** - Sets the width or steepness of the shape from 0.1 to 100 on a logarithmic slider, and is used by every Type. The useful ranges differ: 0.25 to 16 for Low Shelf and High Shelf, and 0.1 to 10 for Filter GD. In practice, shelves are used at Q 2 to 4, and Filter GD at Q 0.5 to 8 - 0.5 corresponds to a first-order allpass or an LR2 sum, 0.7071 to a Butterworth alignment or an LR4 sum, and 8 to a sharp resonance. Settings outside those ranges are still accepted; the status line reports when the current Taps cannot realize them.
- **Enabled** - Turns each of the five bands on or off. Disabled bands contribute nothing to the target curve and appear dimmed on the graph.
- **Taps** - FIR length: 4096, 8192, 16384, or 32768. Low frequencies need a long filter, and so do high-Q shapes. Taps also decide how much delay the filter can hold, and therefore how far Delay reaches. More taps mean more latency and more processing.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing.

Total latency is the Latency setting plus half the Taps count. It stays the same while you move the bands, so only a change of Taps or Latency changes the delay of the whole chain.

### Visual Display

- The grey curve is the target: the sum of the enabled band shapes, drawn on a logarithmic frequency axis. The delay axis rescales itself to fit the current settings, starting at ±5 ms.
- The green curve is what the designed filter really does. Where the two curves lie on top of each other the setting is fully realized; where they separate, the filter cannot follow the request with the current Taps.
- Near 18 to 20 kHz the target is tapered smoothly down to zero. This high-frequency taper is by design, so a band placed close to the top of the range is shown, and realized, with a reduced effect.
- Numbered markers correspond to the five bands. Drag horizontally to change Freq and vertically to change Delay. The marker sits on the curve only for Peak: a shelf passes half of Delay at Freq, and Filter GD reaches its extreme value below Freq - just below it at high Q, and progressively further below as Q falls, until at Q of about 0.577 or less the extreme value sits at the low-frequency end of the graph.
- The status line shows the total latency in samples and milliseconds, and the magnitude ripple of the filter. Ripple measures how far the realized magnitude response departs from the flat design target: smaller values are closer to the target, and 0.3 dB is the accuracy-warning threshold.

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

A specialized equalizer that links volume adjustment with frequency balance correction. Set Average SPL to the estimated average listening level at 0dB Relative Volume, then use Relative Volume for everyday volume changes. The plugin automatically strengthens the correction as you turn the volume down and reduces it as you turn the volume up.

### Listening Enhancement Guide
- Low Volume Listening:
  - Enhances bass and treble frequencies
  - Maintains musical balance at quiet levels
  - Compensates for human hearing characteristics
- Average SPL Setting:
  - Set it to the estimated average listening level at 0dB Relative Volume
  - This is a manual reference value; the plugin does not measure SPL
- Relative Volume Adjustment:
  - Negative values lower the output level and increase the correction
  - Positive values raise the output level and reduce the correction
  - EQ correction is based on `Average SPL + Relative Volume` and is limited to the 60dB-to-85dB correction range
- Frequency Balance:
  - Low shelf for bass enhancement (100-300Hz)
  - High shelf for treble enhancement (3-6kHz)
  - Smooth transition between frequency ranges

### System Presets

Click **Effect Presets** in the effect header to start from a complete loudness-compensation curve.

- **Late Night Listening** - Stronger compensation for a lower listening level.
- **Quiet Background** - A moderate everyday compensation curve.
- **Near Reference Level** - Minimal compensation around a higher reference level.

### Parameters
- **Average SPL** - Estimated average listening level at 0dB Relative Volume (60dB to 96dB)
  - Set this manually to match the average SPL at your listening position
  - Values above 85dB allow a higher reference level; EQ correction remains off until `Average SPL + Relative Volume` falls below 85dB
- **Relative Volume** - Volume adjustment relative to Average SPL (-30dB to +12dB)
  - 0dB: Output level corresponding to Average SPL
  - Negative values: Lower volume with more loudness correction
  - Positive values: Higher volume with less loudness correction
  - Positive values can cause clipping when the input or EQ boost is already high
- **Low Frequency Controls**
  - Frequency: Bass enhancement center (100Hz to 300Hz)
  - Gain: Maximum bass boost (0dB to 15dB)
  - Q: Shape of bass enhancement (0.5 to 1.0)
- **High Frequency Controls**
  - Frequency: Treble enhancement center (3kHz to 6kHz)
  - Gain: Maximum treble boost (0dB to 15dB)
  - Q: Shape of treble enhancement (0.5 to 1.0)

### Visual Display
- Real-time EQ response graph
- Interactive parameter controls
- Volume-dependent correction curve; the uniform Relative Volume gain is not included in the graph
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

## Room EQ

Room EQ creates FIR correction filters from frequency-response measurements saved by EffeTune. By default it designs one filter from a shared measurement and applies it to every channel routed through the plugin; assign a different measurement to an individual channel to give that channel its own filter, while every other setting stays common to the whole instance. Use the plugin's standard bus selector to choose which channels it receives. The filter averages all points in the selected measurement, smooths the result, and reduces deviations inside the selected correction range. Use it when loudspeaker and room interactions cause repeatable peaks or broad tonal imbalance at the listening area. It can also apply linear-phase magnitude correction or mixed-phase correction that combines minimum-phase magnitude correction with correction of the measured excess phase: Phase Correction addresses the direct sound, and Reverb Correction can additionally counteract the measured room reverberation that follows it. With Consensus, the phase target is the reliability-weighted average of the measurement points. Room EQ requires the WASM DSP engine; without it, the signal passes through unchanged.

### Sound Enhancement Guide

- Measure the loudspeaker or channel group that you will route through one Room EQ instance from several nearby microphone positions, then select that saved measurement. Multiple points make the correction less dependent on one exact microphone position.
- Start with **Phase: Minimum**, **Smoothing: 0.17 oct**, **Correction Low: 80 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB**, and **Level Correction: 100%**. Compare with the plugin's main on/off control to confirm that the result is more even without becoming unnaturally thin or bright.
- If the filter tries to fill narrow dips that change with microphone position, increase Smoothing or lower Max Boost. A value of 0 dB for Max Boost prevents automatic boosts while still allowing cuts to reduce peaks.
- If full level correction sounds too strong, lower Level Correction. Because it scales each automatic correction value in dB, 50% changes a +6 dB correction to +3 dB and a -8 dB correction to -4 dB.
- Limit Correction Low and Correction High to the range your loudspeaker and measurement microphone reproduce reliably. Correcting outside a trustworthy measurement range can make the result less accurate.
- After the room correction is stable, use Additional EQ for a gentle listening target, such as a broad +2 dB Low shelf around 100 Hz or a small High shelf adjustment around 10 kHz. These bands reshape the target and are built into the FIR filter.
- Use **Minimum** when low latency matters. Use **Correction** when you want to correct excess phase as well as frequency response. Start with Reference Point set to **Consensus (all points)**, the default Direct Window, and **Phase Correction: 100%**. Select an individual point only when you want to optimize the excess-phase correction for that microphone position. Lower Phase Correction independently if the phase result sounds too strong.
- **Low-frequency Phase Extension** is off by default. Enable it only when you want excess-phase correction below Phase Low. Lower frequencies use progressively longer analysis windows and can include later room response, so Consensus is the safest starting point. Compare more than one listening position and turn the extension off if bass timing becomes less consistent.
- **Reverb Correction** is 0% by default. In Correction mode, raise it little by little while keeping the default **Reverb Max Freq: 250 Hz**; this counteracts low-frequency reverberation while remaining useful across the listening area. Extend Reverb Max Freq toward higher frequencies only with the understanding that the result then becomes an optimization for a single listening position.
- Room EQ does not calculate speaker-distance alignment. **Delay** is shared across the whole instance, even when channels use different measurements; use separate Room EQ instances only when different channel groups need different manual delay values.

Measurements are device-local references. A URL or preset stores the selected measurement's name and identifier, but not the measured data. To use a measurement on another device, enable **Include impulse responses in measurement JSON exports** on the measurement screen before exporting it, then import it on the other device before selecting it. This option is off by default, and including impulse responses can make the file tens of megabytes larger. A missing measurement is shown as a warning and Room EQ uses aligned bypass instead of stale correction data.

### Parameters

- **Measurement** - Selects the shared saved frequency-response measurement used by any channel that has no per-channel override. The list shows its name, number of points, and `IR` when impulse-response data is available. Use **Refresh measurements** after adding or changing measurements.
- **Measurement Ch N** - One optional override selector per channel handled by the instance's bus selection. Leave it at **(Shared)**, the default, to use Measurement above; assign a different saved measurement to give that channel its own filter. Leaving every channel at **(Shared)** reproduces the single shared-filter behavior exactly.
- **Delay** - Adds 0 to 20 ms of manual delay to every channel routed through the instance. It is not included in the plugin's reported processing latency.
- **Phase** - Selects how the FIR filter handles phase.
  - **Minimum** - Minimum-phase magnitude correction with the lowest added latency.
  - **Linear** - Linear-phase magnitude correction. It preserves the input's relative phase but adds half the selected tap count as delay.
  - **Correction** - Minimum-phase magnitude correction plus correction of excess phase in the stored impulse response: Phase Correction controls the direct-sound component analyzed within Direct Window, and Reverb Correction can additionally counteract the later reverberation analyzed within Reverb Window. This reduces group-delay variation while retaining `Taps / 2` samples of delay for the mixed-phase filter. During design, it keeps the main impulse-energy position aligned with the Minimum response at the same Level Correction setting. When every channel uses the shared measurement, one filter is designed from it and applied unchanged to every routed channel, so changing Level Correction, Phase Correction, or Reverb Correction introduces no channel-specific timing differences. When a channel is given its own measurement, a separate filter is designed for that channel. It uses Reference Point and Direct Window and requires impulse-response data.
- **Taps** - FIR length: 8192, 16384, 32768, 65536, or 131072. More taps improve low-frequency resolution but increase delay, memory use, and filter-design time. Linear and Correction add `Taps / 2` samples of delay.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing; in Linear and Correction, the FIR's half-length delay is usually much larger.
- **Smoothing** - Gaussian frequency smoothing from 0.02 to 1.00 octaves. Higher values produce broader, more conservative correction; lower values follow finer response variations.
- **Phase Smoothing** - Gaussian frequency smoothing from 0.02 to 1.00 octaves applied to the direct sound's measured excess-phase correction in Correction mode. With **Auto** selected by default it follows Smoothing, so magnitude and phase corrections are smoothed identically. Clear Auto to smooth the phase correction independently; the current effective value is kept as the starting point. Lower values follow finer timing detail, higher values give a more conservative phase correction. Reverb Correction is not affected; it uses Reverb Smoothing instead.
- **Correction Low / Correction High** - Set the lower and upper transition boundaries for automatic magnitude correction. Before Gaussian smoothing, automatic correction is treated as 0 dB at and outside these boundaries. Smoothing therefore controls how gradually correction fades and how far it extends beyond each boundary. The high boundary is also limited internally to leave headroom below the audio sample rate's Nyquist frequency.
- **Direct Window** - 1 to 50 ms of the measured response after the direct-sound onset used by Correction. It is the fixed analysis window at and above Phase Low and, with Low-frequency Phase Extension enabled, the shortest analysis window. A longer window can move the automatic Phase Low lower but includes more room reflections.
- **Phase Low** - Sets the lower frequency for measured excess-phase correction in Correction mode from 20 to 20000 Hz when Low-frequency Phase Extension is off. When the extension is on, Phase Low instead marks the boundary between the fixed Direct Window and the progressively longer low-frequency windows. With **Auto** selected by default, Room EQ uses the higher of Correction Low and the frequency that fits three cycles inside Direct Window (500 Hz at 6 ms). Clear Auto to set the boundary manually. The manual value is independent of Correction Low and cannot be set below the frequency of one cycle inside Direct Window (167 Hz at 6 ms). Values below the automatic boundary are more sensitive to time-window truncation and room reflections.
- **Low-frequency Phase Extension** - Extends measured excess-phase correction from Phase Low toward Correction Low by using progressively longer, frequency-dependent analysis windows below Phase Low. Phase Low and higher frequencies use a fixed analysis window. This setting is off by default. It is available only in Correction; the control is disabled in Minimum and Linear while its selected value is retained. If the measured impulse response is too short for a requested low-frequency window, Room EQ uses the available shorter measurement window and shows a warning. It reduces or skips the correction only when the realized FIR approaches its time limits; the rest of the Room EQ filter remains active. The extension works only while Phase Correction is above 0%; at 0% it stays inactive even when Reverb Correction is in use.
- **Max Boost** - 0 to 18 dB limit for boosts created by automatic response inversion. The limit is applied before Gaussian smoothing so capped regions blend smoothly into the surrounding correction curve. It does not limit cuts.
- **Level Correction** - Scales automatic magnitude correction from 0% to 100% in 1% steps, linearly in dB. At 0%, automatic level correction is disabled; Phase Correction, Additional EQ, Delay, and Gain remain active.
- **Phase Correction** - Scales the direct sound's measured excess-phase correction from 0% to 100% in 1% steps and affects only the Correction mode. Its controls are disabled in Minimum and Linear modes. It is independent of Reverb Correction: at 0%, direct-sound excess-phase correction is disabled while Level Correction and any Reverb Correction remain active. Level Correction still carries the minimum-phase shift inherently associated with its magnitude response, so Phase Correction controls only the direct sound's additional measured excess-phase component.
- **Reverb Correction** - Scales correction of the measured room reverberation's excess phase from 0% to 100% in 1% steps and affects only the Correction mode; its controls are disabled in Minimum and Linear while the values are retained. At the default 0%, reverb correction is fully off and Room EQ behaves exactly as without this control. Above 0%, Room EQ analyzes the response through Reverb Window and, up to Reverb Max Freq, corrects later excess phase independently of Phase Correction. It does not change the magnitude-correction target: Smoothing and Level Correction continue to control the full-IR frequency-response correction. With Consensus, Room EQ uses the reliability-weighted average delay across the measurement points. When the usable reverb window or frequency band is too small, or when the synthesized phase correction does not fit safely within the time limits of the realized FIR, Room EQ reduces or skips the reverb correction and shows a warning; the rest of the filter remains active.
- **Reverb Window** - Sets how much of the measured response after the direct-sound onset, from 20 to 1000 ms, reverb correction analyzes. Longer windows include later reverberation. The effective window can be shortened by the measured impulse response's available length after its onset. The requested observation window is not shortened merely because Taps is smaller; after analysis, Room EQ separately checks whether the requested phase correction fits the realized FIR and reduces or skips only the part that does not. If the available window does not exceed Direct Window, or Reverb Window is set at or below Direct Window, reverb correction is skipped and a warning is shown; the rest of the filter remains active.
- **Reverb Max Freq** - Sets the upper frequency limit of reverb correction from 20 to 20000 Hz. The default 250 Hz keeps correction in the low-frequency range where room reverberation behaves consistently across nearby positions. The phase part is effectively limited to the lowest of Reverb Max Freq, Correction High, and 45% of the sample rate, so Correction High remains the ceiling for all correction and Reverb Max Freq selects the reverb limit inside it. Raising it extends reverb correction to higher frequencies where the reverberant field differs from seat to seat and even shifts with air temperature, so the result holds only at the measured listening position. If no frequency band remains below the effective limit — for example when Correction Low is set at or above it — reverb correction is skipped entirely and a warning is shown; the rest of the filter remains active.
- **Reverb Smoothing** - Gaussian frequency smoothing from 0.02 to 1.00 octaves applied only to the excess-phase delay analyzed through Reverb Window. Lower values follow finer timing structure; higher values make the phase correction broader and more conservative. It does not change the frequency-response correction, which uses Smoothing instead. With multiple measurement points it also sets the frequency scale used for the agreement diagnostic.
- **Reference Point** - Selects the source of excess phase in Correction mode for both the direct-sound and reverb analyses. **Consensus (all points)** is the default and fallback: it time-aligns the points, combines their excess delay using a reliability-weighted average, and gives less weight to unreliable phase around deep response nulls. Selecting a named point uses only that point's excess phase. Magnitude correction always uses all points. If the selected point is later removed, this setting returns to Consensus.
- **Additional EQ (folded into FIR)** - Five shared target-shaping bands using the same graph and controls as 5Band PEQ. Each band can be enabled, set to Peak, Low shelf, or High shelf, and adjusted from 20 Hz to 20 kHz, -20 to +20 dB, and Q 0.1 to 10. The response is built into the FIR rather than processed by a separate IIR stage. Its phase is zero in Linear mode and minimum-phase in Minimum and Correction modes. Max Boost limits automatic room-response inversion, not intentional boosts from Additional EQ.
- **Gain** - Applies -12 to +12 dB to all channels after corrected and bypass paths are combined.

### Visual Display

- Use the **Graph** radio buttons above the graph to switch between **Frequency**, **Phase**, **Min Group Delay**, **Excess Group Delay**, and **Impulse**.
- **Phase** uses a logarithmic frequency axis and a vertical phase axis from -180° to 180°. The gray line is the phase before correction and the green line is the calculated phase after the actual FIR. The measured onset is removed from both, and the FIR's known fixed delay is also removed from the corrected result, so the graph shows the phase change introduced by the filter without those fixed timing offsets. A measurement without impulse-response data shows an unavailable message instead.
- **Min Group Delay** shows the delay implied by the minimum-phase part of the magnitude response. **Excess Group Delay** separately shows the remaining delay after that minimum-phase part is removed, making reflections and other non-minimum-phase timing easier to inspect. Both views use a logarithmic frequency axis and a vertical axis in milliseconds. Values retain the absolute group delay after removing the measured onset and, from the corrected result, the FIR's known fixed delay. They are not re-referenced at 1 kHz, so the value there is not necessarily 0 ms. The gray line is before correction and the green line is the calculated result after the actual FIR. Group-delay analysis is independent of the displayed point spacing and does not rely on phase unwrapping. Smoothing is applied on a fixed logarithmic-frequency analysis grid, so a lower Smoothing setting shows finer detail. **Min Group Delay** automatically adjusts its vertical range to the displayed curves. **Excess Group Delay** keeps a fixed -100 to +100 ms range, while the hover readout retains the unclipped value when a curve extends beyond it. A measurement without impulse-response data shows an unavailable message instead.
- **Impulse** shows the selected point, or the time-aligned average waveform when Reference Point is Consensus, from 2 ms before the measured onset through the largest of 5 ms, Direct Window, and — when Reverb Correction is above 0% — Reverb Window limited to 50 ms. The gray line is before correction and the green line is the calculated result after the actual FIR. The measured onset is the shared 0 ms reference, and only the FIR's known fixed delay is removed from the corrected waveform, so relative peak timing and pre-ringing remain visible. Both lines use the same normalized amplitude scale. Low-frequency Phase Extension and Reverb Correction can analyze later response than this view displays. For this display only, components at and above 20 kHz are removed; this does not affect the correction filter or audio processing. A measurement without impulse-response data shows an unavailable message instead.
- **Frequency** uses a logarithmic frequency axis and a vertical gain axis in dB.
- The **Preview channel** selector above the graph appears only when filters have been designed for more than one channel; it selects which channel's response the graph and the Additional EQ base curve show, and does not affect the audio.
- Moving the pointer over the graph marks every curve with a dot at the pointer's horizontal position and shows each reading to the right of its name in the legend, with the pointer's own frequency — or time in the Impulse view — above them. The readout clears when the pointer leaves the graph.
- The two white dotted vertical lines mark the frequencies set by Correction Low and Correction High.
- Numbered markers correspond to the five bands. Drag a marker horizontally to change frequency and vertically to change gain; disabled bands appear dimmed.
- The light gray curve shows the smoothed measured frequency response with the graph's common display offset applied.
- The thin, pale green curve shows the automatic correction calculated from the selected measurement and the current Room EQ correction settings, before Additional EQ.
- The bright green curve shows that correction with Additional EQ applied. This is the combined magnitude response folded into the FIR.
- The white curve shows the estimated corrected response obtained by adding the bright green combined correction to the light gray measured response. The gray and white curves share an offset that maps the automatic correction's 100% destination level to 0 dB; Max Boost limits can leave residual deviations, while Additional EQ intentionally reshapes the response around that reference. It is a calculated preview, not a new acoustic measurement.
- The status below the controls shows total processing latency, FIR resolution, and whether the filter asset is bypassed, staged, preparing, active, or in error.

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
