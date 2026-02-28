---
title: "Modulation Plugins - EffeTune"
description: "Modulation effect plugins including Tremolo, Wow Flutter, Pitch Shifter, and Doppler Distortion."
lang: en
---

# Modulation Plugins

A collection of plugins that add movement and variation to your music through modulation effects. These effects can make your digital music feel more organic and dynamic, enhancing your listening experience with subtle or dramatic variations in sound.

## Plugin List

- [Doppler Distortion](#doppler-distortion) - Simulates the natural, dynamic shifts in sound from subtle speaker cone movement.
- [Pitch Shifter](#pitch-shifter) - Changes the pitch of your music without affecting playback speed
- [Tremolo](#tremolo) - Creates rhythmic volume variations for a pulsing, dynamic sound
- [Wow Flutter](#wow-flutter) - Recreates the gentle pitch variations of vinyl records and tape players

## Doppler Distortion

Experience a unique audio effect that brings a touch of natural movement to your music. Doppler Distortion simulates the gentle distortions created by the physical movement of a speaker cone. This effect introduces slight changes in the sound's depth and tone, much like the familiar pitch shifts you hear when a sound source moves relative to you. It adds a dynamic, immersive quality to your listening experience by making the audio feel more alive and engaging.

### Parameters

- **Coil Force (N)**  
  Controls the strength of the simulated speaker coil movement. Higher values result in a more pronounced distortion.

- **Speaker Mass (kg)**  
  Simulates the weight of the speaker cone, affecting how naturally the movement is reproduced.  
  - **Higher values:** Increase the inertia, resulting in a slower response and smoother, subtler distortions.  
  - **Lower values:** Reduce the inertia, causing a quicker, more pronounced modulation effect.

- **Spring Constant (N/m)**  
  Determines the stiffness of the speaker's suspension. A higher spring constant produces a crisper, more defined response.

- **Damping Factor (N·s/m)**  
  Adjusts how quickly the simulated movement settles, balancing lively motion with smooth transitions.  
  - **Higher values:** Lead to faster stabilization, reducing oscillations and producing a tighter, more controlled effect.  
  - **Lower values:** Allow the movement to persist longer, resulting in a looser, more extended dynamic fluctuation.

### Recommended Settings

For a balanced and natural enhancement, start with:
- **Coil Force:** 8.0 N  
- **Speaker Mass:** 0.03 kg  
- **Spring Constant:** 6000 N/m  
- **Damping Factor:** 1.5 N·s/m  

These settings provide a subtle Doppler Distortion that enriches the listening experience without overpowering the original sound.

## Pitch Shifter

An effect that changes the pitch of your music without affecting its playback speed. This allows you to experience your favorite songs in different keys, making them sound higher or lower while maintaining the original tempo and rhythm.

### Parameters
- **Pitch Shift** - Changes the overall pitch in semitones (-6 to +6)
  - Negative values: Lowers the pitch (deeper, lower sound)
  - Zero: No change (original pitch)
  - Positive values: Raises the pitch (higher, brighter sound)
- **Fine Tune** - Makes subtle pitch adjustments in cents (-50 to +50)
  - Allows for precise tuning between semitones
  - Perfect for minor adjustments when a full semitone is too much
- **Window Size** - Controls the analysis window size in milliseconds (80 to 500ms)
  - Smaller values (80-150ms): Better for transient-rich material like percussion
  - Medium values (150-300ms): Good balance for most music
  - Larger values (300-500ms): Better for smooth, sustained sounds
- **XFade Time** - Sets the crossfade time between processed segments in milliseconds (20 to 40ms)
  - Affects how smoothly the pitch-shifted segments blend together
  - Lower values may sound more immediate but potentially less smooth
  - Higher values create smoother transitions between segments, but may increase sound wavering and create an overlapping sensation

## Tremolo

An effect that adds rhythmic volume variations to your music, similar to the pulsing sound found in vintage amplifiers and classic recordings. This creates a dynamic, expressive quality that adds movement and interest to your listening experience.

### Listening Experience Guide
- Classic Amplifier Experience:
  - Recreates the iconic pulsing sound of vintage tube amplifiers
  - Adds rhythmic movement to static recordings
  - Creates a hypnotic, engaging listening experience
- Vintage Recording Character:
  - Simulates the natural tremolo effects used in classic recordings
  - Adds vintage character and warmth
  - Perfect for jazz, blues, and rock listening
- Creative Atmosphere:
  - Creates dramatic swells and fades
  - Adds emotional intensity to music
  - Perfect for ambient and atmospheric listening

### Parameters
- **Rate** - How fast the volume changes (0.1 to 20 Hz)
  - Slower (0.1-2 Hz): Gentle, subtle pulsing
  - Medium (2-6 Hz): Classic tremolo effect
  - Faster (6-20 Hz): Dramatic, choppy effects
- **Depth** - How much the volume changes (0 to 12 dB)
  - Subtle (0-3 dB): Gentle volume variations
  - Medium (3-6 dB): Noticeable pulsing effect
  - Strong (6-12 dB): Dramatic volume swells
- **Ch Phase** - Phase difference between stereo channels (-180 to 180 degrees)
  - 0°: Both channels pulse together (mono tremolo)
  - 90° or -90°: Creates a swirling, rotating effect
  - 180° or -180°: Channels pulse in opposite directions (maximum stereo width)
- **Randomness** - How irregular the volume changes become (0 to 96 dB)
  - Low: More predictable, regular pulsing
  - Medium: Natural vintage variation
  - High: More unstable, organic sound
- **Randomness Cutoff** - How quickly the random changes happen (1 to 1000 Hz)
  - Lower: Slower, more gentle random variations
  - Higher: Quicker, more erratic changes
- **Randomness Slope** - Controls how aggressive the randomness filtering is (-12 to 0 dB)
  - -12 dB: Smoother, more gradual random variations (gentler effect)
  - -6 dB: Balanced response
  - 0 dB: Sharper, more pronounced random variations (stronger effect)
- **Ch Sync** - How synchronized the randomness is between channels (0 to 100%)
  - 0%: Each channel has independent randomness
  - 50%: Partial synchronization between channels
  - 100%: Both channels share the same randomness pattern

### Recommended Settings for Different Styles

1. Classic Guitar Amp Tremolo
   - Rate: 4-6 Hz (medium speed)
   - Depth: 6-8 dB
   - Ch Phase: 0° (mono)
   - Randomness: 0-5 dB
   - Perfect for: Blues, Rock, Surf Music

2. Stereo Psychedelic Effect
   - Rate: 2-4 Hz
   - Depth: 4-6 dB
   - Ch Phase: 180° (opposite channels)
   - Randomness: 10-20 dB
   - Perfect for: Psychedelic Rock, Electronic, Experimental

3. Subtle Enhancement
   - Rate: 1-2 Hz
   - Depth: 2-3 dB
   - Ch Phase: 0-45°
   - Randomness: 5-10 dB
   - Perfect for: Any music needing gentle movement

4. Dramatic Pulsing
   - Rate: 8-12 Hz
   - Depth: 8-12 dB
   - Ch Phase: 90°
   - Randomness: 20-30 dB
   - Perfect for: Electronic, Dance, Ambient

### Quick Start Guide

1. For a Classic Tremolo Sound:
   - Start with medium Rate (4-5 Hz)
   - Add moderate Depth (6 dB)
   - Set Ch Phase to 0° for mono or 90° for stereo movement
   - Keep Randomness low (0-5 dB)
   - Adjust to taste

2. For More Character:
   - Increase Randomness gradually
   - Experiment with different Ch Phase settings
   - Try different Rate and Depth combinations
   - Trust your ears

## Wow Flutter

An effect that adds subtle pitch variations to your music, similar to the natural wavering sound you might remember from vinyl records or cassette tapes. This creates a warm, nostalgic feeling that many people find pleasing and relaxing.

### Listening Experience Guide
- Vinyl Record Experience:
  - Recreates the gentle wavering of turntables
  - Adds organic movement to the sound
  - Creates a cozy, nostalgic atmosphere
- Cassette Tape Memory:
  - Simulates the characteristic flutter of tape decks
  - Adds vintage tape deck character
  - Perfect for lo-fi and retro vibes
- Creative Atmosphere:
  - Creates dreamy, underwater-like effects
  - Adds movement and life to static sounds
  - Perfect for ambient and experimental listening

### Parameters
- **Rate** - How fast the sound wavers (0.1 to 20 Hz)
  - Slower (0.1-2 Hz): Vinyl record-like movement
  - Medium (2-6 Hz): Cassette tape-like flutter
  - Faster (6-20 Hz): Creative effects
- **Depth** - How much the pitch changes (0 to 40 ms)
  - Subtle (0-10 ms): Gentle vintage character
  - Medium (10-20 ms): Classic tape/vinyl feel
  - Strong (20-40 ms): Dramatic effects
- **Ch Phase** - Phase difference between stereo channels (-180 to 180 degrees)
  - 0°: Both channels waver together
  - 90° or -90°: Creates a swirling, rotating effect
  - 180° or -180°: Channels waver in opposite directions
- **Randomness** - How irregular the wavering becomes (0 to 40 ms)
  - Low: More predictable, regular movement
  - Medium: Natural vintage variation
  - High: More unstable, worn equipment sound
- **Randomness Cutoff** - How quickly the random changes happen (0.1 to 20 Hz)
  - Lower: Slower, more gentle changes
  - Higher: Quicker, more erratic changes
- **Randomness Slope** - Controls how aggressive the randomness filtering is (-12 to 0 dB)
  - -12 dB: Smoother, more gradual random variations (gentler effect)
  - -6 dB: Balanced response
  - 0 dB: Sharper, more pronounced random variations (stronger effect)
- **Ch Sync** - How synchronized the randomness is between channels (0 to 100%)
  - 0%: Each channel has independent randomness
  - 50%: Partial synchronization between channels
  - 100%: Both channels share the same randomness pattern

### Recommended Settings for Different Styles

1. Classic Vinyl Experience
   - Rate: 0.5-1 Hz (slow, gentle movement)
   - Depth: 15-20 ms
   - Randomness: 10-15 ms
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Perfect for: Jazz, Classical, Vintage Rock

2. Retro Cassette Feel
   - Rate: 4-5 Hz (faster flutter)
   - Depth: 10-15 ms
   - Randomness: 15-20 ms
   - Ch Phase: 0-45°
   - Ch Sync: 80-100%
   - Perfect for: Lo-Fi, Pop, Rock

3. Dreamy Atmosphere
   - Rate: 1-2 Hz
   - Depth: 25-30 ms
   - Randomness: 20-25 ms
   - Ch Phase: 90-180°
   - Ch Sync: 50-70%
   - Perfect for: Ambient, Electronic, Experimental

4. Subtle Enhancement
   - Rate: 2-3 Hz
   - Depth: 5-10 ms
   - Randomness: 5-10 ms
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Perfect for: Any music needing gentle vintage character

### Quick Start Guide

1. For a Natural Vintage Sound:
   - Start with slow Rate (1 Hz)
   - Add moderate Depth (15 ms)
   - Include some Randomness (10 ms)
   - Keep Ch Phase at 0° and Ch Sync at 100%
   - Adjust to taste

2. For More Character:
   - Increase Depth gradually
   - Add more Randomness
   - Experiment with different Ch Phase settings
   - Reduce Ch Sync for more stereo variation
   - Trust your ears

Remember: The goal is to add pleasant vintage character to your music. Start subtle and adjust until you find the sweet spot that enhances your listening experience!
