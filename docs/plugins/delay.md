---
title: "Delay Plugins - EffeTune"
description: "Delay effect plugins including standard Delay and Time Alignment for precise audio timing."
lang: en
---

# Delay Plugins

A collection of tools for adjusting the timing of your audio signals or adding distinct repetitions. These plugins help you fine-tune the temporal alignment of your audio, create rhythmic echoes, or add a sense of space and depth to your listening experience.

## Plugin List

- [Delay](#delay) - Creates echoes with control over timing, tone, and stereo spread.
- [Time Alignment](#time-alignment) - Precise timing adjustments for audio channels

## Delay

This effect adds distinct echoes to your audio. You can control how quickly the echoes repeat, how they fade away, and how they spread between your speakers, allowing you to add subtle depth, rhythmic interest, or creative spatial effects to your music playback.

### Listening Experience Guide

- **Subtle Depth & Space:**
  - Adds a gentle sense of space without washing out the sound.
  - Can make vocals or lead instruments feel slightly larger or more present.
  - Use short delay times and low feedback/mix.
- **Rhythmic Enhancement:**
  - Creates echoes that sync with the music's tempo (manually tuned).
  - Adds groove and energy, especially to electronic music, drums, or guitars.
  - Experiment with different delay times (e.g., matching eighth or quarter notes by ear).
- **Slapback Echo:**
  - A very short, single echo often used on vocals or guitars in rock and country.
  - Adds a percussive, doubling effect.
  - Use very short delay times (30-120ms), zero feedback, and moderate mix.
- **Creative Stereo Spreading:**
  - Using the Ping-Pong control, echoes can bounce between left and right speakers.
  - Creates a wider, more engaging stereo image.
  - Can make the sound feel more dynamic and interesting.

### Parameters

- **Pre-Delay (ms)** - How long before the *first* echo is heard (0 to 100 ms).
  - Lower values (0-20ms): Echo starts almost immediately.
  - Higher values (20-100ms): Creates a noticeable gap before the echo, separating it from the original sound.
- **Delay Size (ms)** - The time between each echo (1 to 5000 ms).
  - Short (1-100ms): Creates thickening or 'slapback' effects.
  - Medium (100-600ms): Standard echo effects, good for rhythmic enhancement.
  - Long (600ms+): Widely spaced, distinct echoes.
  - *Tip:* Try tapping along to the music to find a delay time that feels rhythmic.
- **Damping (%)** - Controls how much the high and low frequencies fade with each echo (0 to 100%).
  - 0%: Echoes keep their original tone (brighter).
  - 50%: A balanced, natural fade.
  - 100%: Echoes become significantly darker and thinner quickly (more muffled).
  - Use in conjunction with High/Low Damp.
- **High Damp (Hz)** - Sets the frequency above which echoes start losing brightness (1000 to 20000 Hz).
  - Lower values (e.g., 2000Hz): Echoes become dark quickly.
  - Higher values (e.g., 10000Hz): Echoes stay brighter for longer.
  - Adjust with Damping for tonal control of the echoes.
- **Low Damp (Hz)** - Sets the frequency below which echoes start losing fullness (20 to 1000 Hz).
  - Lower values (e.g., 50Hz): Echoes retain more bass.
  - Higher values (e.g., 500Hz): Echoes become thinner more quickly.
  - Adjust with Damping for tonal control of the echoes.
- **Feedback (%)** - How many echoes you hear, or how long they last (0 to 99%).
  - 0%: Only one echo is heard.
  - 10-40%: A few noticeable repeats.
  - 40-70%: Longer, fading trails of echoes.
  - 70-99%: Very long trails, approaching self-oscillation (use carefully!).
- **Ping-Pong (%)** - Controls how echoes bounce between stereo channels (0 to 100%). (Only affects stereo playback).
  - 0%: Standard delay - left input echoes on left, right on right.
  - 50%: Mono feedback - echoes are centered between speakers.
  - 100%: Full Ping-Pong - echoes alternate between left and right speakers.
  - Values in between create varying degrees of stereo spread.
- **Mix (%)** - Balances the volume of the echoes against the original sound (0 to 100%).
  - 0%: No effect.
  - 5-15%: Subtle depth or rhythm.
  - 15-30%: Clearly audible echoes (good starting point).
  - 30%+: Stronger, more pronounced effect. Default is 16%.

### Recommended Settings for Listening Enhancement

1.  **Subtle Vocal/Instrument Depth:**
    - Delay Size: 80-150ms
    - Feedback: 0-15%
    - Mix: 8-16%
    - Ping-Pong: 0% (or try 20-40% for slight width)
    - Damping: 40-60%
2.  **Rhythmic Enhancement (Electronic/Pop):**
    - Delay Size: Try matching tempo by ear (e.g., 120-500ms)
    - Feedback: 20-40%
    - Mix: 15-25%
    - Ping-Pong: 0% or 100%
    - Damping: Adjust to taste (lower for brighter repeats)
3.  **Classic Rock Slapback (Guitars/Vocals):**
    - Delay Size: 50-120ms
    - Feedback: 0%
    - Mix: 15-30%
    - Ping-Pong: 0%
    - Damping: 20-40%
4.  **Wide Stereo Echoes (Ambient/Pads):**
    - Delay Size: 300-800ms
    - Feedback: 40-60%
    - Mix: 20-35%
    - Ping-Pong: 70-100%
    - Damping: 50-70% (for smoother tails)

### Quick Start Guide

1.  **Set the Timing:**
    - Start with `Delay Size` to set the main echo rhythm.
    - Adjust `Feedback` to control how many echoes you hear.
    - Use `Pre-Delay` if you want a gap before the first echo.
2.  **Adjust the Tone:**
    - Use `Damping`, `High Damp`, and `Low Damp` together to shape how the echoes sound as they fade. Start with Damping around 50% and adjust the Damp frequencies.
3.  **Position in Stereo (Optional):**
    - If listening in stereo, experiment with `Ping-Pong` to control the width of the echoes.
4.  **Blend it In:**
    - Use `Mix` to balance the echo volume with the original music. Start low (around 16%) and increase until the effect feels right.

## Time Alignment

A precision tool that lets you adjust the timing of audio channels with millisecond accuracy. Perfect for correcting phase issues or creating specific stereo effects.

### When to Use
- Fixing phase alignment between stereo channels
- Compensating for speaker distance differences
- Fine-tuning stereo imaging
- Correcting timing mismatches in recordings

### Parameters
- **Delay** - Controls the delay time (0 to 100ms)
  - 0ms: No delay (original timing)
  - Higher values: Increased delay
  - Fine adjustments for precise control
- **Channel** - Select which channel to delay
  - All: Affects both channels
  - Left: Only delays left channel
  - Right: Only delays right channel

### Recommended Uses

1. Speaker Alignment
   - Compensate for different speaker distances
   - Match timing between monitors
   - Adjust for room acoustics

2. Recording Correction
   - Fix phase issues between microphones
   - Align multiple audio sources
   - Correct timing discrepancies

3. Creative Effects
   - Create subtle stereo widening
   - Design spatial effects
   - Experiment with channel timing

Remember: The goal is to enhance your listening enjoyment. Experiment with the controls to find sounds that add interest and depth to your favorite music without overpowering it.