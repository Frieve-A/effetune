---
title: "Basic Plugins - EffeTune"
description: "Essential audio plugins including Volume, Mute, Stereo Balance, Matrix routing, and more."
lang: en
---

# Basic Audio Plugins

A collection of essential tools for adjusting the fundamental aspects of your music playback. These plugins help you control volume, balance, and other basic aspects of your listening experience.

## Plugin List

- [Channel Divider](#channel-divider) - Splits audio into frequency bands across multiple channels
- [DC Offset](#dc-offset) - Helps fix audio that sounds unbalanced
- [Matrix](#matrix) - Routes and mixes audio channels with flexible control
- [MultiChannel Panel](#multichannel-panel) - Controls multiple audio channels with individual settings
- [Mute](#mute) - Silences the audio output
- [Polarity Inversion](#polarity-inversion) - Can improve how stereo music sounds
- [Stereo Balance](#stereo-balance) - Adjusts the left-right balance of your music
- [Volume](#volume) - Controls how loud the music plays

## Channel Divider

A specialized tool that splits your stereo signal into separate frequency bands and routes each band to different output channels. Perfect for multi-channel systems or custom crossover configurations.

To use this effect, you need to use the desktop app, set the number of output channels in the audio settings to 4 or more, and set the channel in the effect bus routing to "All."

### When to Use
- When using multi-channel audio outputs (4, 6, or 8 channels)
- To create custom frequency-based channel routing
- For multi-amplifier or multi-speaker setups

### Parameters
- **Band Count** - Number of frequency bands to create (2-4 bands)
  - 2 bands: Low/High split
  - 3 bands: Low/Mid/High split
  - 4 bands: Low/Mid-Low/Mid-High/High split

- **Crossover Frequencies** - Define where audio splits between bands
  - F1: First crossover point
  - F2: Second crossover point (for 3+ bands)
  - F3: Third crossover point (for 4 bands)

- **Slopes** - Control how sharply bands are separated
  - Options: -12dB to -96dB per octave
  - Steeper slopes provide cleaner separation
  - Lower slopes offer more natural transitions

### Technical Notes
- Processes first two input channels only
- Output channels must be a multiple of 2 (4, 6, or 8)
- Uses high-quality Linkwitz-Riley crossover filters
- Visual frequency response graph for easy configuration

## DC Offset

A utility that can help fix audio that sounds unbalanced or strange. Most listeners won't need this often, but it's helpful when you encounter audio that doesn't sound quite right.

### When to Use
- If music sounds unusually unbalanced
- When one channel seems louder than it should
- If other effects aren't working as expected

### Parameters
- **Offset** - Adjusts the audio balance (-1.0 to +1.0)
  - 0.0: Normal setting
  - Adjust if something sounds off
  - Small adjustments usually work best

## Matrix

A powerful channel routing tool that allows you to create custom signal paths between input and output channels. Offers complete flexibility in how audio signals are connected and mixed.

### When to Use
- To create custom routing between channels
- When you need to mix or split signals in specific ways
- For creative sound design using channel interactions

### Features
- Flexible routing matrix for up to 8 channels
- Individual connection control between any input/output pair
- Phase inversion options for each connection
- Visual matrix interface for intuitive configuration

### How It Works
- Each connection point represents routing from an input row to an output column
- Active connections allow signal to flow between channels
- Phase inversion option reverses the signal polarity
- Multiple input connections to one output are mixed together

### Practical Applications
- Custom downmixing or upmixing configurations
- Isolating or combining specific channels
- Creating phase relationships between channels
- Solving complex routing requirements

## MultiChannel Panel

A comprehensive control panel for managing multiple audio channels individually. This plugin provides complete control over volume, muting, soloing, and delay for up to 8 channels, with a visual level meter for each channel.

### When to Use
- When working with multi-channel audio (up to 8 channels)
- To create custom volume balance between different channels
- When you need to apply individual delay to specific channels
- For monitoring levels across multiple channels simultaneously

### Features
- Individual controls for up to 8 audio channels
- Real-time level meters with peak hold for visual monitoring
- Channel linking capability for grouped parameter changes

### Parameters

#### Per Channel Controls
- **Mute (M)** - Silences individual channels
  - Toggle on/off for each channel
  - Works in conjunction with solo feature

- **Solo (S)** - Isolates individual channels
  - When any channel is soloed, only soloed channels play
  - Multiple channels can be soloed simultaneously

- **Volume** - Adjusts individual channel loudness (-20dB to +10dB)
  - Fine control with slider or direct value input
  - Linked channels maintain the same volume

- **Delay** - Adds time delay to individual channels (0-30ms)
  - Precise delay control in milliseconds
  - Useful for time-alignment between channels
  - Allows phase adjustment between channels

#### Channel Linking
- **Link** - Connects adjacent channels for synchronized control
  - Changes to one linked channel affect all connected channels
  - Maintains consistent settings across linked channel groups
  - Useful for stereo pairs or multi-channel groups

### Visual Monitoring
- Real-time level meters show current signal strength
- Peak hold indicators display maximum levels
- Clear numerical dB readout of peak levels
- Color-coded meters for easy level recognition:
  - Green: Safe levels
  - Yellow: Approaching maximum
  - Red: Near or at maximum level

### Practical Applications
- Balancing surround sound systems
- Creating custom headphone mixes
- Time-aligning multi-microphone setups
- Monitoring and adjusting multi-channel audio sources

## Mute

A simple utility that silences all audio output by filling the buffer with zeros. Useful for instantly muting audio signals.

### When to Use
- To instantly silence audio without fade
- During silent sections or pauses
- To prevent unwanted noise output

## Polarity Inversion

A tool that can improve how stereo music sounds in certain situations. It's like "flipping" the audio wave to potentially make it sound better.

You can also invert the polarity of only specific channels by limiting the channels to be processed in the effector common settings.

### When to Use
- When stereo music sounds "hollow" or "weird"
- If combining this with other stereo effects
- When trying to improve stereo imaging

## Stereo Balance

Lets you adjust how the music is distributed between your left and right speakers or headphones. Perfect for fixing uneven stereo or creating your preferred sound placement.

### Listening Enhancement Guide
- Perfect Balance:
  - Center position for natural stereo
  - Equal volume in both ears
  - Best for most music
- Adjusted Balance:
  - Compensate for room acoustics
  - Adjust for hearing differences
  - Create preferred sound stage

### Parameters
- **Balance** - Controls left-right distribution (-100% to +100%)
  - Center (0%): Equal in both sides
  - Left (-100%): More sound in left
  - Right (+100%): More sound in right

### Visual Display
- Easy-to-use slider
- Clear number display
- Visual indicator of stereo position

### Recommended Uses

1. General Listening
   - Keep balance centered (0%)
   - Adjust if stereo feels uneven
   - Use subtle adjustments

2. Headphone Listening
   - Fine-tune for comfort
   - Compensate for hearing differences
   - Create preferred stereo image

3. Speaker Listening
   - Adjust for room setup
   - Balance for listening position
   - Compensate for room acoustics

## Volume

A simple but essential control that lets you adjust how loud your music plays. Perfect for finding the right listening level for different situations.

### Listening Enhancement Guide
- Adjust for different listening scenarios:
  - Background music while working
  - Active listening sessions
  - Late night quiet listening
- Keep volume at comfortable levels to avoid:
  - Listening fatigue
  - Sound distortion
  - Potential hearing damage

### Parameters
- **Volume** - Controls the overall loudness (-60dB to +24dB)
  - Lower values: Quieter playback
  - Higher values: Louder playback
  - 0dB: Original volume level

Remember: These basic controls are the foundation of good sound. Start with these adjustments before using more complex effects!
