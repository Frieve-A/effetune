---
title: "Spatial Plugins - EffeTune"
description: "Spatial audio plugins including Stereo Blend, Crossfeed Filter, MS Matrix, and Multiband Balance."
lang: en
---

# Spatial Audio Plugins

A collection of plugins that enhance how your music sounds in your headphones or speakers by adjusting the stereo (left and right) balance. These effects can make your music sound more spacious and natural, especially when listening with headphones.

## Plugin List

- [Crossfeed Filter](#crossfeed-filter) - Headphone crossfeed filter for natural stereo imaging
- [MS Matrix](#ms-matrix) - Converts stereo to Mid/Side and back for advanced stereo adjustment chains
- [Multiband Balance](#multiband-balance) - 5-band frequency-dependent stereo balance control  
- [Stereo Blend](#stereo-blend) - Controls stereo width from polarity-swapped stereo through mono to enhanced stereo

## Crossfeed Filter

A headphone crossfeed filter that simulates the natural acoustic crosstalk that occurs when listening through speakers. This effect helps reduce the exaggerated stereo separation often experienced with headphones, creating a more natural and comfortable listening experience that mimics the way sound reaches our ears in a real acoustic environment.

### Key Features
- Simulates natural acoustic crosstalk for headphone listening
- Adjustable crossfeed level and timing
- Low-pass filtering to mimic frequency-dependent crosstalk
- Stereo-only processing (automatically bypassed for mono or other non-stereo signals)

### Parameters
- **Level** (-60 dB to 0 dB): Controls the amount of crossfeed signal
  - Lower values (-20 dB to -6 dB): Subtle, natural crossfeed
  - Higher values (-6 dB to 0 dB): More pronounced effect
- **Delay** (0 ms to 1 ms): Simulates the time difference of acoustic crosstalk
  - Lower values (0.1-0.3 ms): Tighter, more focused image
  - Higher values (0.3-1.0 ms): More spacious, speaker-like presentation
- **LPF Freq** (100 Hz to 20000 Hz): Controls the frequency response of crossfeed
  - Lower values (500-1000 Hz): More natural, frequency-dependent crosstalk
  - Higher values (1000-20000 Hz): Broader frequency response

### Recommended Settings

1. Natural Headphone Listening
   - Level: -12 dB
   - Delay: 0.3 ms
   - LPF Freq: 700 Hz
   - Effect: Subtle crossfeed for comfortable long-term listening

2. Speaker Simulation
   - Level: -6 dB
   - Delay: 0.5 ms
   - LPF Freq: 1000 Hz
   - Effect: More pronounced speaker-like presentation

3. Subtle Enhancement
   - Level: -20 dB
   - Delay: 0.2 ms
   - LPF Freq: 500 Hz
   - Effect: Very gentle crossfeed for sensitive listeners

### Application Guide

1. Headphone Optimization
   - Start with conservative settings (-15 dB level, 0.3 ms delay)
   - Adjust level for comfort and naturalness
   - Fine-tune delay for spatial perception
   - Use LPF to control frequency response

2. Music Style Considerations
   - Classical/Jazz: Lower levels (-15 to -10 dB) for natural presentation
   - Rock/Pop: Moderate levels (-12 to -8 dB) can soften hard-panned guitars or vocals while keeping the music lively
   - Electronic or very wide mixes: Use lower to moderate levels (-18 to -10 dB) to keep width, or higher levels only when you want to tame excessive left-right separation

3. Listening Environment
   - Quiet environments: Lower levels for subtle effect
   - Noisy environments: Higher levels for better focus
   - Long listening sessions: Conservative settings to reduce fatigue

### Quick Start Guide

1. Initial Setup
   - Set Level to -12 dB
   - Set Delay to 0.3 ms
   - Set LPF Freq to 700 Hz

2. Fine-tuning
   - Adjust Level for desired crossfeed amount
   - Modify Delay for spatial perception
   - Tune LPF Freq for frequency response

3. Optimization
   - Listen for natural, comfortable presentation
   - Avoid excessive settings that sound artificial
   - Test with various music styles

Remember: The Crossfeed Filter is designed to make headphone listening more natural and comfortable. Start with conservative settings and adjust gradually to find the optimal balance for your listening preferences and music material.

## MS Matrix

MS Matrix converts normal stereo audio to Mid/Side format, or converts Mid/Side audio back to normal stereo. Use it when you want to adjust center and side information separately inside an effect chain, such as encoding to M/S, changing the Mid or Side level, then decoding back to stereo. For simple stereo width adjustment on normal music, [Stereo Blend](#stereo-blend) is the more direct tool.

### Key Features
- Separate Mid and Side gain (–18 dB to +18 dB)  
- Mode switch: Encode (Stereo→M/S) or Decode (M/S→Stereo)  
- Optional Left/Right swap before encoding or after decoding  

### Parameters
- **Mode** (Encode/Decode): Encode turns left/right stereo into Mid on the left channel and Side on the right channel. Decode treats the left channel as Mid and the right channel as Side, then rebuilds normal stereo.
- **Mid Gain** (–18 dB to +18 dB): Adjusts the Mid level during the selected conversion.
- **Side Gain** (–18 dB to +18 dB): Adjusts the Side level during the selected conversion.
- **Swap L/R** (Off/On): Swaps left and right channels before encoding or after decoding  

### Recommended Settings
1. **Subtle Widening for Normal Stereo**
   - First MS Matrix: Mode: Encode, Mid Gain: 0 dB, Side Gain: +3 dB, Swap: Off
   - Second MS Matrix after it: Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Effect: Slightly strengthens the Side component, then returns the result to normal stereo
2. **Center Focus for Normal Stereo**
   - First MS Matrix: Mode: Encode, Mid Gain: +3 dB, Side Gain: -3 dB, Swap: Off
   - Second MS Matrix after it: Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Effect: Brings vocals and centered sounds forward while reducing side ambience
3. **Decode Existing M/S Audio**
   - Mode: Decode
   - Mid Gain: 0 dB
   - Side Gain: 0 dB
   - Swap: Off
   - Use only when the incoming signal is already Mid/Side format
4. **Creative Flip**
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### Quick Start Guide
1. Decide whether you need a single conversion or a full Encode -> adjust -> Decode chain.
2. For normal stereo listening, place one MS Matrix in Encode mode and a second one later in Decode mode.
3. Adjust **Mid Gain** and **Side Gain** on the Encode stage.
4. Enable **Swap L/R** only for channel correction or creative inversion.
5. Bypass to compare and make sure the stereo image still feels natural.

## Multiband Balance

A frequency-dependent balance processor that divides the audio into five bands and lets you shift each band slightly left or right. Use it when bass, vocals, cymbals, or other frequency ranges feel pulled to one side and you want to rebalance only that part of the sound without moving the whole track.

### Key Features
- 5-band frequency-dependent stereo balance control
- High-quality Linkwitz-Riley crossover filters
- Linear balance control for precise stereo adjustment
- Independent processing of left and right channels
- Automatic fade handling when crossover filters are reset

### Parameters

#### Crossover Frequencies
- **Freq 1** (20-500 Hz): Separates low and low-mid bands
- **Freq 2** (100-2000 Hz): Separates low-mid and mid bands
- **Freq 3** (500-8000 Hz): Separates mid and high-mid bands
- **Freq 4** (1000-20000 Hz): Separates high-mid and high bands

#### Band Controls
Each band has independent balance control:
- **Band 1 Bal.** (-100% to +100%): Controls stereo balance of low frequencies
- **Band 2 Bal.** (-100% to +100%): Controls stereo balance of low-mid frequencies
- **Band 3 Bal.** (-100% to +100%): Controls stereo balance of mid frequencies
- **Band 4 Bal.** (-100% to +100%): Controls stereo balance of high-mid frequencies
- **Band 5 Bal.** (-100% to +100%): Controls stereo balance of high frequencies

### Recommended Settings

1. Correct a Treble Pull to the Right
   - Low Band (20-100 Hz): 0% (centered)
   - Low-Mid (100-500 Hz): 0%
   - Mid (500-2000 Hz): 0%
   - High-Mid (2000-8000 Hz): -10% to -25%
   - High (8000+ Hz): -10% to -30%
   - Effect: Moves bright content slightly left while keeping bass and vocals stable

2. Correct a Low-Mid Pull to the Left
   - Low Band: 0%
   - Low-Mid: +10% to +25%
   - Mid: +5% to +15%
   - High-Mid: 0%
   - High: 0%
   - Effect: Moves warm body and lower vocals slightly right without changing the whole stereo image

3. Keep Bass Centered While Adjusting Air
   - Low Band: 0%
   - Low-Mid: 0%
   - Mid: 0%
   - High-Mid: +5% to +15%
   - High: +10% to +20%
   - Effect: Gently moves upper ambience to the right while the low end stays centered

### Application Guide

1. Listening Balance Correction
   - Keep low frequencies (below 100 Hz) centered for stable bass
   - Shift only the frequency range that feels off-center
   - Use small signed values first (about 5-20%)
   - Check mono playback for tonal or level changes

2. Problem Solving
   - Rebalance frequency ranges that feel too far left or right
   - Tighten unfocused bass by centering low frequencies
   - Reduce harsh stereo artifacts in high frequencies
   - Improve recordings where different parts of the sound lean to different sides

3. Creative Listening Effects
   - Create unusual frequency-dependent placement
   - Make high frequencies lean one way while low frequencies stay centered
   - Build a wider-feeling ambience by making small balance shifts in upper bands

4. Stereo Field Adjustment
   - Fine-tune stereo balance per frequency band
   - Correct uneven stereo distribution
   - Avoid treating this as a stereo width control; use Stereo Blend when you want to widen or narrow the whole image
   - Maintain mono compatibility

### Quick Start Guide

1. Initial Setup
   - Start with all bands centered (0%)
   - Set crossover frequencies to standard points:
     * Freq 1: 100 Hz
     * Freq 2: 500 Hz
     * Freq 3: 2000 Hz
     * Freq 4: 8000 Hz

2. Basic Enhancement
   - Keep Band 1 (low) centered
   - Make small adjustments to higher bands
   - Listen for changes in spatial image
   - Check mono compatibility

3. Fine-tuning
   - Adjust crossover points to match your material
   - Make gradual changes to band positions
   - Listen for unwanted artifacts
   - Compare with bypass for perspective

Remember: The Multiband Balance is a powerful tool that requires careful adjustment. Start with subtle settings and increase complexity as needed. Always check your adjustments in both stereo and mono to ensure compatibility.

## Stereo Blend

An effect that helps achieve a more natural sound field by adjusting the stereo width of your music. It's particularly useful for headphone listening, where it can reduce the exaggerated stereo separation that often occurs with headphones, making the listening experience more natural and less fatiguing. It can also enhance the stereo image for speaker listening when needed.

### Listening Enhancement Guide
- Headphone Optimization:
  - Reduce stereo width (60-90%) for more natural, speaker-like presentation
  - Minimize listening fatigue from excessive stereo separation
  - Create a more realistic front-focused soundstage
- Speaker Enhancement:
  - Maintain original stereo image (100%) for accurate reproduction
  - Subtle enhancement (110-130%) for wider soundstage when needed
  - Careful adjustment to maintain natural sound field
- Sound Field Control:
  - Focus on natural, realistic presentation
  - Avoid excessive width that could sound artificial
  - Use negative width only for corrective or creative side-polarity inversion
  - Optimize for your specific listening environment

### Parameters
- **Stereo** - Controls the stereo width (-200% to 200%)
  - Negative values: Invert the polarity of the stereo side (L-R) component before reconstruction
  - -200%: Maximum width with inverted side polarity; use only for correction or special cases
  - -100%: Original stereo width with the left/right image swapped
  - 0%: Full mono (left and right channels summed)
  - 100%: Original stereo image
  - 200%: Maximum width enhancement; keeps the center component while strongly boosting the stereo side difference

### Recommended Settings for Different Listening Scenarios

1. Headphone Listening (Natural)
   - Stereo: 60-90%
   - Effect: Reduced stereo separation
   - Perfect for: Long listening sessions, reducing fatigue

2. Speaker Listening (Reference)
   - Stereo: 100%
   - Effect: Original stereo image
   - Perfect for: Accurate reproduction

3. Speaker Enhancement
   - Stereo: 110-130%
   - Effect: Subtle width enhancement
   - Perfect for: Rooms with close speaker placement

### Music Style Optimization Guide

- Classical Music
  - Headphones: 70-80%
  - Speakers: 100%
  - Benefit: Natural concert hall perspective

- Jazz & Acoustic
  - Headphones: 80-90%
  - Speakers: 100-110%
  - Benefit: Intimate, realistic ensemble sound

- Rock & Pop
  - Headphones: 85-95%
  - Speakers: 100-120%
  - Benefit: Balanced impact without artificial width

- Electronic Music
  - Headphones: 90-100%
  - Speakers: 100-130%
  - Benefit: Controlled spaciousness while maintaining focus

### Quick Start Guide

1. Choose Your Listening Setup
   - Identify whether you're using headphones or speakers
   - This determines your starting point for adjustment

2. Start with Conservative Settings
   - Headphones: Begin at 80%
   - Speakers: Begin at 100%
   - Listen for natural sound placement

3. Fine-tune for Your Music
   - Make small adjustments (5-10% at a time)
   - Focus on achieving natural sound field
   - Pay attention to listening comfort

Remember: The goal is to achieve a natural, comfortable listening experience that reduces fatigue and maintains the intended musical presentation. Avoid extreme settings that might sound impressive at first but become fatiguing over time.
