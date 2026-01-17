# Dynamics Plugins

A collection of plugins that help balance the loud and quiet parts of your music, making your listening experience more enjoyable and comfortable.

## Plugin List

- [Auto Leveler](#auto-leveler) - Automatic volume adjustment for consistent listening experience
- [Brickwall Limiter](#brickwall-limiter) - Transparent peak control for safe and comfortable listening
- [Compressor](#compressor) - Automatically balances volume levels for more comfortable listening (includes upward expansion)
- [Expander](#expander) - Dynamic range expansion below threshold with ratio and knee control (includes upward compression)
- [Gate](#gate) - Reduces unwanted background noise by attenuating signals below a threshold
- [Multiband Compressor](#multiband-compressor) - Professional 5-band dynamics processor with FM radio-style sound shaping
- [Multiband Expander](#multiband-expander) - Professional 5-band expander for frequency-specific dynamic range expansion
- [Multiband Transient](#multiband-transient) - Advanced 3-band transient shaper for frequency-specific attack and sustain control
- [Power Amp Sag](#power-amp-sag) - Simulates power amplifier voltage sag under high load conditions
- [Transient Shaper](#transient-shaper) - Controls transient and sustain portions of the signal

## Auto Leveler

A smart volume control that automatically adjusts your music to maintain a consistent listening level. It uses industry-standard LUFS measurements to ensure your music stays at a comfortable volume, whether you're listening to quiet classical pieces or dynamic pop songs.

### Listening Enhancement Guide
- Classical Music:
  - Enjoy both quiet passages and loud crescendos without touching the volume
  - Hear all the subtle details in piano pieces
  - Perfect for albums with varying recording levels
- Pop/Rock Music:
  - Keep a consistent volume across different songs
  - No more surprises from overly loud or quiet tracks
  - Comfortable listening during long sessions
- Background Music:
  - Maintain steady volume while working or studying
  - Never too loud or too quiet
  - Perfect for playlists with mixed content

### Parameters

- **Target** (-36.0dB to 0.0dB LUFS)
  - Sets your desired listening level
  - Default -18.0dB LUFS is comfortable for most music
  - Lower values for quieter background listening
  - Higher values for more impactful sound

- **Time Window** (1000ms to 10000ms)
  - How quickly the level is measured
  - Shorter times: More responsive to changes
  - Longer times: More stable, natural sound
  - Default 3000ms works well for most music

- **Max Gain** (0.0dB to 12.0dB)
  - Limits how much quiet sounds are boosted
  - Higher values: More consistent volume
  - Lower values: More natural dynamics
  - Start with 6.0dB for gentle control

- **Min Gain** (-36.0dB to 0.0dB)
  - Limits how much loud sounds are reduced
  - Higher values: More natural sound
  - Lower values: More consistent volume
  - Try -12.0dB as a starting point

- **Attack Time** (1ms to 1000ms)
  - How quickly volume is reduced
  - Faster times: Better control of sudden loud sounds
  - Slower times: More natural transitions
  - Default 50ms balances control and naturalness

- **Release Time** (10ms to 10000ms)
  - How quickly volume returns to normal
  - Faster times: More responsive
  - Slower times: Smoother transitions
  - Default 1000ms for natural sound

- **Noise Gate** (-96dB to -24dB)
  - Reduces processing of very quiet sounds
  - Higher values: Less background noise
  - Lower values: Process more quiet sounds
  - Start at -60dB and adjust if needed

### Visual Feedback
- Real-time LUFS level display
- Input level (green line)
- Output level (white line)
- Clear visual feedback of volume adjustments
- Easy-to-read time-based graph

### Recommended Settings

#### General Listening
- Target: -18.0dB LUFS
- Time Window: 3000ms
- Max Gain: 6.0dB
- Min Gain: -12.0dB
- Attack Time: 50ms
- Release Time: 1000ms
- Noise Gate: -60dB

#### Background Music
- Target: -23.0dB LUFS
- Time Window: 5000ms
- Max Gain: 9.0dB
- Min Gain: -18.0dB
- Attack Time: 100ms
- Release Time: 2000ms
- Noise Gate: -54dB

#### Dynamic Music
- Target: -16.0dB LUFS
- Time Window: 2000ms
- Max Gain: 3.0dB
- Min Gain: -6.0dB
- Attack Time: 30ms
- Release Time: 500ms
- Noise Gate: -72dB


## Brickwall Limiter

A high-quality peak limiter that ensures your music never exceeds a specified level, preventing digital clipping while maintaining natural sound quality. Perfect for protecting your audio system and ensuring comfortable listening levels without compromising the music's dynamics.

### Listening Enhancement Guide
- Classical Music:
  - Safely enjoy full orchestral crescendos
  - Maintain the natural dynamics of piano pieces
  - Protect against unexpected peaks in live recordings
- Pop/Rock Music:
  - Keep consistent volume during intense passages
  - Enjoy dynamic music at any listening level
  - Prevent distortion in bass-heavy sections
- Electronic Music:
  - Control synthesizer peaks transparently
  - Maintain impact while preventing overload
  - Keep bass drops powerful but controlled

### Parameters

- **Input Gain** (-18dB to +18dB)
  - Adjusts the level going into the limiter
  - Increase to drive the limiter harder
  - Decrease if you hear too much limiting
  - Default is 0dB

- **Threshold** (-24dB to 0dB)
  - Sets the maximum peak level
  - Lower values provide more safety margin
  - Higher values preserve more dynamics
  - Start at -3dB for gentle protection

- **Release Time** (10ms to 500ms)
  - How quickly limiting is released
  - Faster times maintain more dynamics
  - Slower times for smoother sound
  - Try 100ms as a starting point

- **Lookahead** (0ms to 10ms)
  - Allows the limiter to anticipate peaks
  - Higher values for more transparent limiting
  - Lower values for less latency
  - 3ms is a good balance

- **Margin** (-1.000dB to 0.000dB)
  - Fine-tune the effective threshold
  - Provides additional safety headroom
  - Default -1.000dB works well for most material
  - Adjust for precise peak control

- **Oversampling** (1x, 2x, 4x, 8x)
  - Higher values for cleaner limiting
  - Lower values for less CPU usage
  - 4x is a good balance of quality and performance

### Visual Display
- Real-time gain reduction metering
- Clear threshold level indication
- Interactive parameter adjustment
- Peak level monitoring

### Recommended Settings

#### Transparent Protection
- Input Gain: 0dB
- Threshold: -3dB
- Release: 100ms
- Lookahead: 3ms
- Margin: -1.000dB
- Oversampling: 4x

#### Maximum Safety
- Input Gain: -6dB
- Threshold: -6dB
- Release: 50ms
- Lookahead: 5ms
- Margin: -1.000dB
- Oversampling: 8x

#### Natural Dynamics
- Input Gain: 0dB
- Threshold: -1.5dB
- Release: 200ms
- Lookahead: 2ms
- Margin: -0.500dB
- Oversampling: 4x

## Compressor

An effect that automatically manages volume differences in your music by gently reducing loud sounds and enhancing quiet ones. This creates a more balanced and enjoyable listening experience by smoothing out sudden volume changes that might be jarring or uncomfortable.

### Listening Enhancement Guide
- Classical Music:
  - Makes dramatic orchestral crescendos more comfortable to listen to
  - Balances the difference between soft and loud piano passages
  - Helps hear quiet details even in powerful sections
- Pop/Rock Music:
  - Creates a more comfortable listening experience during intense sections
  - Makes vocals clearer and easier to understand
  - Reduces listening fatigue during long sessions
- Jazz Music:
  - Balances the volume between different instruments
  - Makes solo sections blend more naturally with the ensemble
  - Maintains clarity during both quiet and loud passages

### Parameters

- **Threshold** - Sets the volume level where the effect begins working (-60dB to 0dB)
  - Higher settings: Only affects the loudest parts of the music
  - Lower settings: Creates more overall balance
  - Start at -24dB for gentle balancing
- **Ratio** - Controls how strongly the effect balances the volume (1:0.5 to 1:20)
  - 1:0.5: Upward expansion (boosts loud sounds)
  - 1:1: No effect (original sound)
  - 1:2: Gentle compression
  - 1:4: Moderate compression
  - 1:8+: Strong volume control
- **Attack Time** - How quickly the effect responds to loud sounds (0.1ms to 100ms)
  - Faster times: More immediate volume control
  - Slower times: More natural sound
  - Try 20ms as a starting point
- **Release Time** - How quickly the volume returns to normal (10ms to 1000ms)
  - Faster times: More dynamic sound
  - Slower times: Smoother, more natural transitions
  - Start with 200ms for general listening
- **Knee** - How smoothly the effect transitions (0dB to 12dB)
  - Lower values: More precise control
  - Higher values: Gentler, more natural sound
  - 6dB is a good starting point
- **Gain** - Adjusts the overall volume after processing (-12dB to +12dB)
  - Use this to match the volume with the original sound
  - Increase if the music feels too quiet
  - Decrease if it's too loud

### Visual Display

- Interactive graph showing how the effect is working
- Easy-to-read volume level indicators
- Visual feedback for all parameter adjustments
- Reference lines to help guide your settings

### Recommended Settings for Different Listening Scenarios
- Casual Background Listening:
  - Threshold: -24dB
  - Ratio: 1:2
  - Attack: 20ms
  - Release: 200ms
  - Knee: 6dB
- Critical Listening Sessions:
  - Threshold: -18dB
  - Ratio: 1:1.5
  - Attack: 30ms
  - Release: 300ms
  - Knee: 3dB
- Late Night Listening:
  - Threshold: -30dB
  - Ratio: 1:4
  - Attack: 10ms
  - Release: 150ms
  - Knee: 9dB
- Loud Sound Enhancement:
  - Threshold: -12dB
  - Ratio: 1:0.5
  - Attack: 50ms
  - Release: 400ms
  - Knee: 6dB

## Expander

A dynamic range processor that expands the dynamic range of signals below a threshold, making quiet sounds even quieter while leaving loud sounds unchanged. This creates more dramatic dynamics and can help restore natural dynamics to over-compressed material.

### Listening Enhancement Guide
- Classical Music:
  - Restores natural dynamics to over-compressed recordings
  - Enhances the contrast between quiet passages and loud crescendos
  - Brings back the natural ebb and flow of orchestral performances
- Pop/Rock Music:
  - Adds more punch and impact to dynamic sections
  - Creates more dramatic contrast between verses and choruses
  - Restores natural dynamics to heavily compressed tracks
- Jazz Music:
  - Enhances the natural dynamics between instruments
  - Makes quiet solos more intimate and loud sections more powerful
  - Restores the natural breathing of jazz performances

### Parameters

- **Threshold** - Sets the volume level where expansion begins (-60dB to 0dB)
  - Higher settings: Only affects quieter parts of the music
  - Lower settings: Creates more overall dynamic expansion
  - Start at -24dB for gentle expansion
- **Ratio** - Controls how strongly the effect expands the dynamic range (1:0.05 to 1:20)
  - 1:0.5: Upward compression (boosts quiet sounds)
  - 1:1: No effect (original sound)
  - 1:2: Gentle expansion
  - 1:4: Moderate expansion
  - 1:8+: Strong dynamic expansion
- **Attack Time** - How quickly the effect responds to quiet sounds (0.1ms to 100ms)
  - Faster times: More immediate dynamic control
  - Slower times: More natural sound
  - Try 10ms as a starting point
- **Release Time** - How quickly the dynamics return to normal (10ms to 1000ms)
  - Faster times: More dynamic sound
  - Slower times: Smoother, more natural transitions
  - Start with 100ms for general listening
- **Knee** - How smoothly the effect transitions (0dB to 12dB)
  - Lower values: More precise control
  - Higher values: Gentler, more natural sound
  - 3dB is a good starting point
- **Gain** - Adjusts the overall volume after processing (-12dB to +12dB)
  - Use this to match the volume with the original sound
  - Increase if the music feels too quiet
  - Decrease if it's too loud

### Visual Display

- Interactive graph showing how the expansion is working
- Easy-to-read volume level indicators
- Visual feedback for all parameter adjustments
- Reference lines to help guide your settings

### Recommended Settings for Different Listening Scenarios
- Natural Dynamics Restoration:
  - Threshold: -18dB
  - Ratio: 1:2
  - Attack: 10ms
  - Release: 100ms
  - Knee: 3dB
- Dramatic Dynamic Enhancement:
  - Threshold: -12dB
  - Ratio: 1:4
  - Attack: 5ms
  - Release: 50ms
  - Knee: 1dB
- Quiet Sound Enhancement:
  - Threshold: -30dB
  - Ratio: 1:0.5
  - Attack: 20ms
  - Release: 200ms
  - Knee: 6dB
- Subtle Dynamic Enhancement:
  - Threshold: -24dB
  - Ratio: 1:1.5
  - Attack: 15ms
  - Release: 150ms
  - Knee: 6dB

## Gate

A noise gate that helps reduce unwanted background noise by automatically attenuating signals that fall below a specified threshold. This plugin is particularly useful for cleaning up audio sources with constant background noise, such as fan noise, hum, or ambient room noise.

### Key Features
- Precise threshold control for accurate noise detection
- Adjustable ratio for natural or aggressive noise reduction
- Variable attack and release times for optimal timing control
- Soft knee option for smooth transitions
- Real-time gain reduction metering
- Interactive transfer function display

### Parameters

- **Threshold** (-96dB to 0dB)
  - Sets the level where noise reduction begins
  - Signals below this level will be attenuated
  - Higher values: More aggressive noise reduction
  - Lower values: More subtle effect
  - Start at -40dB and adjust based on your noise floor

- **Ratio** (1:1 to 100:1)
  - Controls how strongly signals below threshold are attenuated
  - 1:1: No effect
  - 10:1: Strong noise reduction
  - 100:1: Near-complete silence below threshold
  - Start at 10:1 for typical noise reduction

- **Attack Time** (0.01ms to 50ms)
  - How quickly the gate responds when signal rises above threshold
  - Faster times: More precise but may sound abrupt
  - Slower times: More natural transitions
  - Try 1ms as a starting point

- **Release Time** (10ms to 2000ms)
  - How quickly the gate closes when signal falls below threshold
  - Faster times: Tighter noise control
  - Slower times: More natural decay
  - Start with 200ms for natural sound

- **Knee** (0dB to 6dB)
  - Controls how gradually the gate transitions around threshold
  - 0dB: Hard knee for precise gating
  - 6dB: Soft knee for smoother transitions
  - Use 1dB for general purpose noise reduction

- **Gain** (-12dB to +12dB)
  - Adjusts the output level after gating
  - Use to compensate for any perceived volume loss
  - Typically left at 0dB unless needed

### Visual Feedback
- Interactive transfer function graph showing:
  - Input/output relationship
  - Threshold point
  - Knee curve
  - Ratio slope
- Real-time gain reduction meter displaying:
  - Current amount of noise reduction
  - Visual feedback of gate activity

### Recommended Settings

#### Light Noise Reduction
- Threshold: -50dB
- Ratio: 2:1
- Attack: 5ms
- Release: 300ms
- Knee: 3dB
- Gain: 0dB

#### Moderate Background Noise
- Threshold: -40dB
- Ratio: 10:1
- Attack: 1ms
- Release: 200ms
- Knee: 1dB
- Gain: 0dB

#### Heavy Noise Removal
- Threshold: -30dB
- Ratio: 50:1
- Attack: 0.1ms
- Release: 100ms
- Knee: 0dB
- Gain: 0dB

### Application Tips
- Set threshold just above the noise floor for optimal results
- Use longer release times for more natural sound
- Add some knee when processing complex material
- Monitor the gain reduction meter to ensure proper gating
- Combine with other dynamics processors for comprehensive control

## Multiband Compressor

A professional-grade dynamics processor that splits your audio into five frequency bands and processes each independently. This plugin is particularly effective at creating that polished "FM radio" sound, where each part of the frequency spectrum is perfectly controlled and balanced.

### Key Features
- 5-band processing with adjustable crossover frequencies
- Independent compression controls for each band
- Optimized default settings for FM radio-style sound
- Real-time visualization of gain reduction per band
- High-quality Linkwitz-Riley crossover filters

### Frequency Bands
- Band 1 (Low): Below 100 Hz
  - Controls the deep bass and sub frequencies
  - Higher ratio and longer release for tight, controlled bass
- Band 2 (Low-Mid): 100-500 Hz
  - Handles the upper bass and lower midrange
  - Moderate compression to maintain warmth
- Band 3 (Mid): 500-2000 Hz
  - Critical vocal and instrument presence range
  - Gentle compression to preserve naturalness
- Band 4 (High-Mid): 2000-8000 Hz
  - Controls presence and air
  - Light compression with faster response
- Band 5 (High): Above 8000 Hz
  - Manages brightness and sparkle
  - Quick response times with higher ratio

### Parameters (Per Band)
- **Threshold** (-60dB to 0dB)
  - Sets the level where compression begins
  - Lower settings create more consistent levels
- **Ratio** (1:1 to 20:1)
  - Controls the amount of gain reduction
  - Higher ratios for more aggressive control
- **Attack** (0.1ms to 100ms)
  - How quickly compression responds
  - Faster times for transient control
- **Release** (10ms to 1000ms)
  - How quickly gain returns to normal
  - Longer times for smoother sound
- **Knee** (0dB to 12dB)
  - Smoothness of compression onset
  - Higher values for more natural transition
- **Gain** (-12dB to +12dB)
  - Output level adjustment per band
  - Fine-tune the frequency balance

### FM Radio Style Processing
The Multiband Compressor comes with optimized default settings that recreate the polished, professional sound of FM radio broadcasting:

- Low Band (< 100 Hz)
  - Higher ratio (4:1) for tight bass control
  - Slower attack/release to maintain punch
  - Slight reduction to prevent muddiness

- Low-Mid Band (100-500 Hz)
  - Moderate compression (3:1)
  - Balanced timing for natural response
  - Neutral gain to maintain warmth

- Mid Band (500-2000 Hz)
  - Gentle compression (2.5:1)
  - Quick response times
  - Slight boost for vocal presence

- High-Mid Band (2000-8000 Hz)
  - Light compression (2:1)
  - Fast attack/release
  - Enhanced presence boost

- High Band (> 8000 Hz)
  - Higher ratio (5:1) for consistent brilliance
  - Very quick response times
  - Controlled reduction for polish

This configuration creates the characteristic "radio-ready" sound:
- Consistent, impactful bass
- Clear, forward vocals
- Controlled dynamics across all frequencies
- Professional polish and sheen
- Enhanced presence and clarity
- Reduced listening fatigue

### Visual Feedback
- Interactive transfer function graphs for each band
- Real-time gain reduction meters
- Frequency band activity visualization
- Clear crossover point indicators

### Tips for Use
- Start with the default FM radio preset
- Adjust crossover frequencies to match your material
- Fine-tune each band's threshold for desired amount of control
- Use the gain controls to shape the final frequency balance
- Monitor the gain reduction meters to ensure appropriate processing

## Multiband Expander

A professional-grade dynamics processor that splits your audio into five frequency bands and applies independent expansion to each. This plugin is designed to expand the dynamic range of specific frequency ranges, making quiet sounds even quieter while leaving loud sounds unchanged. It's particularly effective for restoring natural dynamics to over-compressed recordings from modern mastering or creating more dramatic frequency-specific dynamic contrast.

### Key Features
- 5-band processing with adjustable crossover frequencies
- Independent expansion controls for each band
- Optimized default settings following 1/f energy distribution
- Real-time visualization of gain boost per band
- High-quality Linkwitz-Riley crossover filters

### Listening Enhancement Guide
- Pop/Rock Music:
  - Reduce the "wall of sound" effect from over-compressed mastering
  - Restore dynamic contrast between verses and choruses
  - Improve the flat impression of streaming audio sources
- Classical Music:
  - Restore the natural dynamic ebb and flow of recordings
  - Enhance contrast between quiet passages and loud crescendos
  - Bring back the vivid expression of orchestral performances
- Jazz Music:
  - Enhance the natural dynamics between instruments
  - Make quiet solos more intimate and loud sections more powerful
  - Restore the natural breathing of jazz performances

### Frequency Bands
- Band 1 (Low): Below 100 Hz
  - Controls the deep bass and sub frequencies
  - Gentle expansion with longer attack/release for natural bass dynamics
- Band 2 (Low-Mid): 100-500 Hz
  - Handles the upper bass and lower midrange
  - Moderate expansion to restore warmth and body
- Band 3 (Mid): 500-2000 Hz
  - Critical vocal and instrument presence range
  - Balanced expansion to preserve naturalness
- Band 4 (High-Mid): 2000-8000 Hz
  - Controls presence and air
  - Light expansion with faster response
- Band 5 (High): Above 8000 Hz
  - Manages brightness and sparkle
  - Quick response times with gentler expansion

### Parameters (Per Band)
- **Threshold** (-60dB to 0dB)
  - Sets the level where expansion begins
  - Signals below this level will be expanded (made quieter)
- **Ratio** (1:0.05 to 1:20)
  - Controls the amount of expansion applied
  - Higher ratios for more dramatic dynamic range expansion
- **Attack** (0.1ms to 100ms)
  - How quickly expansion responds
  - Faster times for precise transient control
- **Release** (10ms to 1000ms)
  - How quickly gain returns to normal
  - Longer times for smoother, more natural sound
- **Knee** (0dB to 12dB)
  - Smoothness of expansion onset
  - Higher values for more natural transition
- **Gain** (-12dB to +12dB)
  - Output level adjustment per band
  - Fine-tune the frequency balance

### Dynamic Range Restoration
The Multiband Expander comes with optimized default settings that follow natural 1/f energy distribution for restoring dynamics to over-compressed material:

- Low Band (< 100 Hz)
  - Gentle expansion (1.2:1) for controlled bass dynamics
  - Longer attack/release to maintain punch
  - Threshold set to accommodate typical bass energy

- Low-Mid Band (100-500 Hz)
  - Moderate expansion (1.2:1)
  - Balanced timing for natural response
  - Threshold follows -6dB energy rolloff

- Mid Band (500-2000 Hz)
  - Balanced expansion (1.2:1)
  - Medium response times
  - Optimized for vocal and instrument dynamics

- High-Mid Band (2000-8000 Hz)
  - Light expansion (1.2:1)
  - Faster attack/release
  - Natural presence restoration

- High Band (> 8000 Hz)
  - Gentlest expansion (1.1:1)
  - Very quick response times
  - Subtle air and sparkle enhancement

This configuration creates natural-sounding dynamic restoration:
- Restored natural dynamics across all frequencies
- Enhanced contrast between quiet and loud passages
- Frequency-specific control for optimal results
- Natural, musical expansion without artifacts
- Improved clarity and separation
- Reduced flatness in over-compressed recordings

### Visual Feedback
- Interactive transfer function graphs for each band
- Real-time gain boost meters showing expansion activity
- Frequency band activity visualization
- Clear crossover point indicators

### Tips for Use
- Start with the default settings for general dynamic restoration
- Adjust crossover frequencies to match your material
- Fine-tune each band's threshold based on the frequency content
- Use the gain controls to compensate for any perceived volume changes
- Monitor the gain boost meters to ensure appropriate expansion

## Multiband Transient

An advanced transient shaping processor that divides your audio into three frequency bands (Low, Mid, High) and applies independent transient shaping to each band. This sophisticated tool allows you to enhance or reduce the attack and sustain characteristics of different frequency ranges simultaneously, providing precise control over the punch, clarity, and body of your music.

### Listening Enhancement Guide
- Classical Music:
  - Enhance the attack of string sections for better clarity while controlling hall resonance in the low frequencies
  - Shape piano transients differently across the frequency spectrum for more balanced sound
  - Independently control the punch of timpani (low) and cymbals (high) for optimal orchestral balance
- Rock/Pop Music:
  - Add punch to kick drums (low band) while enhancing snare presence (mid band)
  - Control bass guitar attack separately from vocal clarity
  - Shape guitar pick attacks in the high frequencies without affecting bass response
- Electronic Music:
  - Independently shape bass drops and lead synthesizers
  - Control sub-bass punch while maintaining clarity in the high frequencies
  - Add definition to individual elements across the frequency spectrum

### Frequency Bands

The Multiband Transient processor splits your audio into three carefully designed frequency bands:

- **Low Band** (Below Freq 1)
  - Controls bass and sub-bass frequencies
  - Ideal for shaping kick drums, bass instruments, and low-frequency elements
  - Default crossover: 200 Hz

- **Mid Band** (Between Freq 1 and Freq 2)  
  - Handles the critical midrange frequencies
  - Contains most vocal and instrumental presence
  - Default crossover: 200 Hz to 4000 Hz

- **High Band** (Above Freq 2)
  - Manages treble and air frequencies
  - Controls cymbals, guitar picks, and brightness
  - Default crossover: Above 4000 Hz

### Parameters

#### Crossover Frequencies
- **Freq 1** (20Hz to 2000Hz)
  - Sets the Low/Mid crossover point
  - Lower values: More content in mid and high bands
  - Higher values: More content in low band
  - Default: 200Hz

- **Freq 2** (200Hz to 20000Hz)
  - Sets the Mid/High crossover point
  - Lower values: More content in high band
  - Higher values: More content in mid band
  - Default: 4000Hz

#### Per-Band Controls (Low, Mid, High)
Each frequency band has independent transient shaping controls:

- **Fast Attack** (0.1ms to 10.0ms)
  - How quickly the fast envelope responds to transients
  - Lower values: More precise transient detection
  - Higher values: Smoother transient response
  - Typical range: 0.5ms to 5.0ms

- **Fast Release** (1ms to 200ms)
  - How quickly the fast envelope resets
  - Lower values: Tighter transient control
  - Higher values: More natural transient decay
  - Typical range: 20ms to 50ms

- **Slow Attack** (1ms to 100ms)
  - Controls the slow envelope's response time
  - Lower values: Better separation of transient vs sustain
  - Higher values: More gradual sustain detection
  - Typical range: 10ms to 50ms

- **Slow Release** (50ms to 1000ms)
  - How long the sustain portion is tracked
  - Lower values: Shorter sustain detection
  - Higher values: Longer sustain tail tracking
  - Typical range: 150ms to 500ms

- **Transient Gain** (-24dB to +24dB)
  - Enhances or reduces the attack portion
  - Positive values: More punch and definition
  - Negative values: Softer, less aggressive attacks
  - Typical range: 0dB to +12dB

- **Sustain Gain** (-24dB to +24dB)
  - Enhances or reduces the sustain portion
  - Positive values: More body and resonance
  - Negative values: Tighter, more controlled sound
  - Typical range: -6dB to +6dB

- **Smoothing** (0.1ms to 20.0ms)
  - Controls how smoothly gain changes are applied
  - Lower values: More precise shaping
  - Higher values: More natural, transparent processing
  - Typical range: 3ms to 8ms

### Visual Feedback
- Three independent gain visualization graphs (one per band)
- Real-time gain history display for each frequency band
- Time markers for reference
- Interactive band selection
- Clear visual feedback of transient shaping activity

### Recommended Settings

#### Enhanced Drum Kit
- **Low Band (Kick Drum):**
  - Fast Attack: 2.0ms, Fast Release: 50ms
  - Slow Attack: 25ms, Slow Release: 250ms
  - Transient Gain: +6dB, Sustain Gain: -3dB
  - Smoothing: 5.0ms

- **Mid Band (Snare/Vocals):**
  - Fast Attack: 1.0ms, Fast Release: 30ms
  - Slow Attack: 15ms, Slow Release: 150ms
  - Transient Gain: +9dB, Sustain Gain: 0dB
  - Smoothing: 3.0ms

- **High Band (Cymbals/Hi-hat):**
  - Fast Attack: 0.5ms, Fast Release: 20ms
  - Slow Attack: 10ms, Slow Release: 100ms
  - Transient Gain: +3dB, Sustain Gain: -6dB
  - Smoothing: 2.0ms

#### Balanced Full Mix
- **All Bands:**
  - Fast Attack: 2.0ms, Fast Release: 30ms
  - Slow Attack: 20ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: 0dB
  - Smoothing: 5.0ms

#### Natural Acoustic Enhancement
- **Low Band:**
  - Fast Attack: 5.0ms, Fast Release: 50ms
  - Slow Attack: 30ms, Slow Release: 400ms
  - Transient Gain: +2dB, Sustain Gain: +1dB
  - Smoothing: 8.0ms

- **Mid Band:**
  - Fast Attack: 3.0ms, Fast Release: 35ms
  - Slow Attack: 25ms, Slow Release: 300ms
  - Transient Gain: +4dB, Sustain Gain: +1dB
  - Smoothing: 6.0ms

- **High Band:**
  - Fast Attack: 1.5ms, Fast Release: 25ms
  - Slow Attack: 15ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: -2dB
  - Smoothing: 4.0ms

### Application Tips
- Start with moderate settings and adjust each band independently
- Use the visual feedback to monitor the amount of transient shaping applied
- Consider the musical content when setting crossover frequencies
- Higher frequency bands typically benefit from faster attack times
- Lower frequency bands often need longer release times for natural sound
- Combine with other dynamics processors for comprehensive control

## Power Amp Sag

Simulates the voltage sag behavior of power amplifiers under high load conditions. This effect recreates the natural compression and warmth that occurs when an amplifier's power supply is stressed by demanding musical passages, adding punch and musical character to your audio.

### Listening Enhancement Guide
- Vintage Audio Systems:
  - Recreates classic amplifier character with natural compression
  - Adds warmth and richness of vintage hi-fi equipment
  - Perfect for achieving authentic analog sound
- Rock/Pop Music:
  - Enhances punch and presence during powerful passages
  - Adds natural compression without harshness
  - Creates satisfying amplifier "drive" feeling
- Classical Music:
  - Provides natural dynamics to orchestral crescendos
  - Adds amplifier warmth to string and brass sections
  - Enhances realism of amplified performances
- Jazz Music:
  - Recreates classic amplifier compression behavior
  - Adds warmth and character to solo instruments
  - Maintains natural dynamic flow

### Parameters

- **Sensitivity** (-18.0dB to +18.0dB)
  - Controls how sensitive the sag effect is to input levels
  - Higher values: More sag at lower volumes
  - Lower values: Only affects loud signals
  - Start with 0dB for natural response

- **Stability** (0% to 100%)
  - Simulates power supply capacitance size
  - Lower values: Smaller capacitors (more dramatic sag)
  - Higher values: Larger capacitors (more stable voltage)
  - Physically represents the energy storage capacity of the power supply
  - 50% provides balanced character

- **Recovery Speed** (0% to 100%)
  - Controls the power supply's recharge capability
  - Lower values: Slower recharge rate (sustained compression)
  - Higher values: Faster recharge rate (quicker recovery)
  - Physically represents the charging circuit's current delivery capability
  - 40% provides natural behavior

- **Monoblock** (Checkbox)
  - Enables independent processing per channel
  - Unchecked: Shared power supply (stereo amplifier)
  - Checked: Independent supplies (monoblock configuration)
  - Use for better channel separation and imaging

### Visual Display

- Dual real-time graphs showing input envelope and gain reduction
- Input envelope (green): Signal energy driving the effect
- Gain reduction (white): Amount of voltage sag applied
- Time-based display with 1-second reference markers
- Current values displayed in real-time

### Recommended Settings

#### Vintage Character
- Sensitivity: +3.0dB
- Stability: 30% (smaller capacitors)
- Recovery Speed: 25% (slower recharge)
- Monoblock: Unchecked

#### Modern Hi-Fi Enhancement
- Sensitivity: 0.0dB
- Stability: 70% (larger capacitors)
- Recovery Speed: 60% (faster recharge)
- Monoblock: Checked

#### Dynamic Rock/Pop
- Sensitivity: +6.0dB
- Stability: 40% (moderate capacitors)
- Recovery Speed: 50% (moderate recharge)
- Monoblock: Unchecked

## Transient Shaper

A specialized dynamics processor that allows you to enhance or reduce the attack and sustain portions of your audio independently. This powerful tool gives you precise control over the punch and body of your music, allowing you to reshape the character of sounds without affecting their overall level.

### Listening Enhancement Guide
- Percussion:
  - Add punch and definition to drums by enhancing transients
  - Reduce room resonance by taming the sustain portion
  - Create more impactful drum sounds without increasing volume
- Acoustic Guitar:
  - Enhance pick attacks for more clarity and presence
  - Control sustain to find the perfect balance with other instruments
  - Shape strumming patterns to sit better in the mix
- Electronic Music:
  - Accentuate synth attacks for more percussive feel
  - Control the sustain of bass sounds for tighter mixes
  - Add punch to electronic drums without changing their timbre

### Parameters

- **Fast Attack** (0.1ms to 10.0ms)
  - Controls how quickly the fast envelope follower responds
  - Lower values: More responsive to sharp transients
  - Higher values: Smoother transient detection
  - Start with 1.0ms for most material

- **Fast Release** (1ms to 200ms)
  - How quickly the fast envelope follower resets
  - Lower values: More precise transient tracking
  - Higher values: More natural transient shaping
  - 20ms works well as a starting point

- **Slow Attack** (1ms to 100ms)
  - Controls how quickly the slow envelope follower responds
  - Lower values: More separation between transient and sustain
  - Higher values: More natural detection of sustain portions
  - 20ms is a good default setting

- **Slow Release** (50ms to 1000ms)
  - How quickly the slow envelope returns to rest
  - Lower values: Shorter sustain portion
  - Higher values: Longer sustain tail detection
  - Try 300ms as a starting point

- **Transient Gain** (-24dB to +24dB)
  - Boosts or cuts the attack portion of sounds
  - Positive values: More punch and definition
  - Negative values: Softer, less aggressive sound
  - Start with +6dB to enhance transients

- **Sustain Gain** (-24dB to +24dB)
  - Boosts or cuts the sustain portion of sounds
  - Positive values: More body and resonance
  - Negative values: Tighter, more controlled sound
  - Start with 0dB and adjust to taste

- **Smoothing** (0.1ms to 20.0ms)
  - Controls how smoothly gain changes are applied
  - Lower values: More precise, possibly more aggressive shaping
  - Higher values: More natural, transparent processing
  - 5.0ms provides a good balance for most material

### Visual Display
- Real-time gain visualization
- Clear gain history display
- Time markers for reference
- Intuitive interface for all parameters

### Recommended Settings

#### Enhanced Percussion
- Fast Attack: 0.5ms
- Fast Release: 10ms
- Slow Attack: 15ms
- Slow Release: 200ms
- Transient Gain: +9dB
- Sustain Gain: -3dB
- Smoothing: 3.0ms

#### Natural Acoustic Instruments
- Fast Attack: 2.0ms
- Fast Release: 30ms
- Slow Attack: 25ms
- Slow Release: 400ms
- Transient Gain: +3dB
- Sustain Gain: 0dB
- Smoothing: 8.0ms

#### Tighter Electronic Sounds
- Fast Attack: 1.0ms
- Fast Release: 15ms
- Slow Attack: 10ms
- Slow Release: 250ms
- Transient Gain: +6dB
- Sustain Gain: -6dB
- Smoothing: 4.0ms
