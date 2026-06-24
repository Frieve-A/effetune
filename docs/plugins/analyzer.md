---
title: "Analyzer Plugins - EffeTune"
description: "Audio analysis plugins including Level Meter, Oscilloscope, Spectrogram, Spectrum Analyzer, and Stereo Meter."
lang: en
---

# Analyzer Plugins

A collection of plugins that let you see your music in fascinating ways. These visual tools help you understand what you're hearing by showing different aspects of the sound, making your listening experience more engaging and interactive.

## Plugin List

- [Level Meter](#level-meter) - Shows digital signal level and possible clipping
- [Oscilloscope](#oscilloscope) - Shows real-time waveform visualization
- [Spectrogram](#spectrogram) - Creates beautiful visual patterns from your music
- [Spectrum Analyzer](#spectrum-analyzer) - Shows the different frequencies in your music
- [Stereo Meter](#stereo-meter) - Visualizes stereo balance and phase relationships

## Level Meter

A visual display that shows your music's digital signal level in real time. It helps you check levels after applying effects and spot possible clipping before it becomes audible distortion.

### Visualization Guide
- The horizontal bar extends farther to the right as the signal level gets louder
- White marker shows the highest recent level for a short time
- OVERLOAD means the signal exceeded the safe digital range and may distort
- For clean playback, avoid frequent red levels or OVERLOAD warnings; set your actual listening volume on your device

## Oscilloscope

Shows the shape of the sound wave in real time, so you can see beats, sharp hits, and changes in loudness while listening. Trigger settings can steady the display when the waveform repeats.

### Visualization Guide
- Horizontal axis shows time (milliseconds)
- Vertical axis shows normalized amplitude; the visible range changes with Display Level and Vertical Offset
- Green line traces the actual waveform
- Grid lines help measure time and amplitude values
- Trigger settings determine where the waveform capture begins; no separate marker is shown

### Parameters
- **Display Time** - How much time to show (1 to 100 ms)
  - Lower values: See more detail in shorter events
  - Higher values: View longer patterns
- **Trigger Mode**
  - Auto: Continuous updates even without trigger
  - Normal: Freezes display until next trigger
- Trigger detection uses the averaged left/right waveform. Mono input is used directly.
- **Trigger Level** - Amplitude level that starts capture
  - Range: -1 to 1 (normalized amplitude)
- **Trigger Edge**
  - Rising: Trigger when signal goes up
  - Falling: Trigger when signal goes down
- **Holdoff** - Minimum time between triggers (0.1 to 10 ms)
- **Display Level** - Vertical scale in dB (-96 to 0 dB)
- **Vertical Offset** - Shifts waveform up/down (-1 to 1)

### Note on Waveform Display
The displayed waveform uses linear interpolation between sample points for smooth visualization. Use it as a visual guide rather than an exact measurement tool.

## Spectrogram

Creates colorful patterns that show how your music changes over time. Colors show how strong each sound is, while vertical position shows its frequency.

### Visualization Guide
- Colors show how strong different frequencies are:
  - Dark colors: Quiet sounds
  - Bright colors: Loud sounds
  - Watch the patterns change with the music
- Vertical position shows frequency:
  - Bottom: Bass sounds
  - Middle: Main instruments
  - Top: High frequencies

### What You Can See
- Melodies: Flowing lines of color
- Beats: Vertical stripes
- Bass: Bright colors at the bottom
- Harmonies: Multiple parallel lines
- Different instruments create unique patterns

### Parameters
- **DB Range** - How vibrant the colors are (-144dB to -48dB)
  - Lower numbers: See more subtle details
  - Higher numbers: Focus on the main sounds
- **Points** - FFT size used for the display (256 to 16384)
  - Higher numbers: More frequency detail, but slower time updates
  - Lower numbers: Faster movement, but less frequency detail
- The analyzer uses the average of the left and right channels. Mono input is analyzed directly.

## Spectrum Analyzer

Creates a real-time visual display of your music's frequencies, from deep bass to high treble. It's like seeing the individual ingredients that make up the complete sound of your music.

### Visualization Guide
- Left side shows bass frequencies (drums, bass guitar)
- Middle shows main frequencies (vocals, guitars, piano)
- Right side shows high frequencies (cymbals, sparkle, air)
- Higher peaks mean stronger presence of those frequencies
- Darker green line shows the current sound
- Brighter green line briefly holds recent peaks, so you can see strong sounds that just passed
- Watch how different instruments create different patterns

### What You Can See
- Bass Drops: Big movements on the left
- Vocal Melodies: Activity in the middle
- Crisp Highs: Sparkles on the right
- Full Mix: How all frequencies work together

### Parameters
- **DB Range** - How sensitive the display is (-144dB to -48dB)
  - Lower numbers: See more subtle details
  - Higher numbers: Focus on the main sounds
- **Points** - How finely the display separates nearby frequencies (256 to 16384)
  - Higher numbers: More frequency detail, with slower updates
  - Lower numbers: Quicker updates, with less frequency detail
- The analyzer uses the average of the left and right channels. Mono input is analyzed directly.

### Fun Ways to Use These Tools

1. Exploring Your Music
   - Watch how different genres create different patterns
   - See the difference between acoustic and electronic music
   - Observe how instruments occupy different frequency ranges

2. Learning About Sound
   - See the bass in electronic music
   - Watch vocal melodies move across the display
   - Observe how drums create sharp patterns

3. Enhancing Your Experience
   - Use the Level Meter to check signal peaks after adding effects
   - Watch the Spectrum Analyzer dance with the music
   - Create a visual light show with the Spectrogram

## Stereo Meter

A fascinating visualization tool that lets you see how your music creates a sense of space through stereo sound. Watch how different instruments and sounds move between your speakers or headphones, adding an exciting visual dimension to your listening experience.

### Visualization Guide
- **Diamond Display** - The main window where the music comes to life:
  - Center: Very quiet moments or moments where the combined signal is near zero
  - Top/Bottom: Sound shared by left and right channels, such as centered or mono-like content
  - Left/Right: Difference or out-of-phase content between the channels
  - Sounds that are much stronger on one side can appear toward the labeled corners
  - Green dots dance with the current music
  - White line traces the musical peaks
- **Correlation Bar** (Left side)
  - Shows left/right channel correlation
  - Top (+1.0): Left and right are nearly the same, often sounding centered
  - Middle (0.0): Weak channel relationship, often from wide ambience or unrelated left/right content
  - Bottom (-1.0): Left and right are nearly opposite polarity, which can sound weak on speakers
- **Balance Bar** (Bottom)
  - Shows if one speaker is louder than the other
  - Center: Music equally loud in both speakers
  - Left/Right: Music stronger in one speaker
  - Numbers show how much louder in decibels (dB)

### What You Can See
- **Centered Sound**: Strong vertical movement in the middle
- **Spacious Sound**: Activity spread wide across the display
- **Special Effects**: Interesting patterns in the corners
- **Speaker Balance**: Where the bottom bar points
- **Channel Correlation**: What the left correlation bar shows

### Parameters
- **Window** (10-1000 ms) - How much recent audio is shown in the display
  - Lower values: See quick musical changes
  - Higher values: See overall sound patterns
  - Default: 100 ms works well for most music

### Enjoying Your Music
1. **Watch Different Styles**
   - Classical music often shows gentle, balanced patterns
   - Electronic music might create wild, spreading designs
   - Live recordings can show natural room movement

2. **Discover Sound Qualities**
   - See how different albums use stereo effects
   - Notice how some songs feel wider than others
   - Observe how instruments move between speakers

3. **Enhance Your Experience**
   - Try different headphones to see how they show stereo
   - Compare old and new recordings of your favorite songs
   - Watch how different listening positions change the display

Remember: These tools are meant to enhance your enjoyment of music by adding a visual dimension to your listening experience. Have fun exploring and discovering new ways to see your favorite music!
