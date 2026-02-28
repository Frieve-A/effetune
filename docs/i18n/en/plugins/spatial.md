---
title: "Spatial Plugins - EffeTune"
description: "Spatial audio plugins including Stereo Blend, Crossfeed Filter, MS Matrix, and Multiband Balance."
lang: en
---

# Spatial Audio Plugins

A collection of plugins that enhance how your music sounds in your headphones or speakers by adjusting the stereo (left and right) balance. These effects can make your music sound more spacious and natural, especially when listening with headphones.

## Plugin List

- [Crossfeed Filter](#crossfeed-filter) - Headphone crossfeed filter for natural stereo imaging
- [MS Matrix](#ms-matrix) - Adjust stereo image by separately controlling Mid and Side levels, with optional Left/Right swap  
- [Multiband Balance](#multiband-balance) - 5-band frequency-dependent stereo balance control  
- [Stereo Blend](#stereo-blend) - Controls stereo width from mono to enhanced stereo

## Crossfeed Filter

A headphone crossfeed filter that simulates the natural acoustic crosstalk that occurs when listening through speakers. This effect helps reduce the exaggerated stereo separation often experienced with headphones, creating a more natural and comfortable listening experience that mimics the way sound reaches our ears in a real acoustic environment.

### Key Features
- Simulates natural acoustic crosstalk for headphone listening
- Adjustable crossfeed level and timing
- Low-pass filtering to mimic frequency-dependent crosstalk
- Stereo-only processing (automatically bypassed for mono signals)

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
   - Rock/Pop: Moderate levels (-10 to -6 dB) for energy
   - Electronic: Higher levels (-6 to 0 dB) for spaciousness

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

A flexible mid/side processor that lets you control the center (mid) and width (side) of your stereo signal independently. Use simple gain controls and an optional Left/Right swap to fine-tune how your audio sits in the stereo field without complex routing.

### Key Features
- Separate Mid and Side gain (–18 dB to +18 dB)  
- Mode switch: Encode (Stereo→M/S) or Decode (M/S→Stereo)  
- Optional Left/Right swap before encoding or after decoding  
- Click-free parameter changes for smooth adjustments  

### Parameters
- **Mode** (Encode/Decode)  
- **Mid Gain** (–18 dB to +18 dB): Adjusts level of center content  
- **Side Gain** (–18 dB to +18 dB): Adjusts level of stereo difference (width)  
- **Swap L/R** (Off/On): Swaps left and right channels before encoding or after decoding  

### Recommended Settings
1. **Subtle Widening**  
   - Mode: Decode  
   - Mid Gain: 0 dB  
   - Side Gain: +3 dB  
   - Swap: Off  
2. **Center Focus**  
   - Mode: Decode  
   - Mid Gain: +3 dB  
   - Side Gain: –3 dB  
   - Swap: Off  
3. **Creative Flip**  
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### Quick Start Guide
1. Select **Mode** for conversion  
2. Adjust **Mid Gain** and **Side Gain**  
3. Enable **Swap L/R** for channel correction or creative inversion  
4. Bypass to compare and verify no phase issues  

## Multiband Balance

A sophisticated spatial processor that divides the audio into five frequency bands and allows independent stereo balance control of each band. This plugin enables precise control over the stereo image across the frequency spectrum, offering creative possibilities for sound design and mixing, as well as corrective applications for problematic stereo recordings.

### Key Features
- 5-band frequency-dependent stereo balance control
- High-quality Linkwitz-Riley crossover filters
- Linear balance control for precise stereo adjustment
- Independent processing of left and right channels
- Click-free parameter changes with automatic fade handling

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

1. Natural Stereo Enhancement
   - Low Band (20-100 Hz): 0% (centered)
   - Low-Mid (100-500 Hz): ±20%
   - Mid (500-2000 Hz): ±40%
   - High-Mid (2000-8000 Hz): ±60%
   - High (8000+ Hz): ±80%
   - Effect: Creates a graduated stereo spread that widens with frequency

2. Focused Mix
   - Low Band: 0%
   - Low-Mid: ±10%
   - Mid: ±30%
   - High-Mid: ±20%
   - High: ±40%
   - Effect: Maintains central focus while adding subtle width

3. Immersive Soundscape
   - Low Band: 0%
   - Low-Mid: ±40%
   - Mid: ±60%
   - High-Mid: ±80%
   - High: ±100%
   - Effect: Creates an enveloping sound field with anchored bass

### Application Guide

1. Mix Enhancement
   - Keep low frequencies (below 100 Hz) centered for stable bass
   - Gradually increase stereo width with frequency
   - Use moderate settings (±30-50%) for natural enhancement
   - Monitor in mono to check for phase issues

2. Problem Solving
   - Correct phase issues in specific frequency ranges
   - Tighten unfocused bass by centering low frequencies
   - Reduce harsh stereo artifacts in high frequencies
   - Fix poorly recorded stereo tracks

3. Creative Sound Design
   - Create frequency-dependent movement
   - Design unique spatial effects
   - Build immersive soundscapes
   - Enhance specific instruments or elements

4. Stereo Field Adjustment
   - Fine-tune stereo balance per frequency band
   - Correct uneven stereo distribution
   - Enhance stereo separation where needed
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
  - Optimize for your specific listening environment

### Parameters
- **Stereo** - Controls the stereo width (0-200%)
  - 0%: Full mono (left and right channels summed)
  - 100%: Original stereo image
  - 200%: Enhanced stereo with maximum width (L-R/R-L)

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
