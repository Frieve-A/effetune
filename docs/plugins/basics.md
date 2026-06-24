---
title: "Basic Plugins - EffeTune"
description: "Essential audio plugins including Volume, Mute, Stereo Balance, Matrix routing, and more."
lang: en
---

# Basic Audio Plugins

A collection of essential tools for adjusting the fundamental aspects of your music playback. These plugins help you control volume, balance, and other basic aspects of your listening experience.

## Plugin List

- [Channel Divider](#channel-divider) - Splits stereo audio into frequency bands across stereo output pairs
- [DC Offset](#dc-offset) - Adds or corrects a constant DC offset
- [Matrix](#matrix) - Routes and mixes audio channels with flexible control
- [MultiChannel Panel](#multichannel-panel) - Controls multiple audio channels with individual settings
- [Mute](#mute) - Silences the audio output
- [Polarity Inversion](#polarity-inversion) - Flips signal polarity for correction or special routing cases
- [Stereo Balance](#stereo-balance) - Adjusts the left-right balance of your music
- [Volume](#volume) - Controls how loud the music plays

## Channel Divider

A specialized tool that splits your stereo signal into separate frequency bands and routes each band to a different stereo output pair. It is useful for multi-amplifier, multi-speaker, or custom crossover playback setups.

To use this effect, you need to use the desktop app, set the number of output channels in the audio settings to 4, 6, or 8 depending on the number of bands, and set the channel in the effect bus routing to "All."

### When to Use
- When using multi-channel audio outputs (4, 6, or 8 channels)
- To create custom frequency-based channel routing
- For multi-amplifier or multi-speaker setups

### Parameters
- **Band Count** - Number of frequency bands to create (2-4 bands)
  - 2 bands: Low/High split, requiring 4 output channels
  - 3 bands: Low/Mid/High split, requiring 6 output channels
  - 4 bands: Low/Mid-Low/Mid-High/High split, requiring 8 output channels
  - Higher band counts are unavailable when the selected output channel count is too low

- **Crossover Frequencies** - Define where audio splits between bands
  - F1: First crossover point
  - F2: Second crossover point (for 3+ bands)
  - F3: Third crossover point (for 4 bands)
  - Each crossover can be set from 10 Hz to 40000 Hz
  - The plugin keeps F1, F2, and F3 in ascending order with at least 1 Hz separation

- **Slopes** - Control how sharply bands are separated
  - Options: -12dB to -96dB per octave
  - Steeper slopes provide cleaner separation
  - Lower slopes offer more natural transitions

### Technical Notes
- Processes first two input channels only
- Output channels must be a multiple of 2 (4, 6, or 8)
- Each band keeps the original stereo pair: 2-band mode outputs Low to channels 1-2 and High to channels 3-4; 3-band mode uses channels 1-2, 3-4, and 5-6; 4-band mode uses channels 1-2, 3-4, 5-6, and 7-8
- Uses high-quality Linkwitz-Riley crossover filters
- Visual frequency response graph for easy configuration

## DC Offset

A utility for correcting a signal whose waveform is shifted away from the zero line. Most listeners should leave this at 0.0, but it can help with unusual files or processing chains that contain DC offset.

### When to Use
- When audio has a constant DC bias or causes clicks/headroom problems after other processing
- When a diagnostic tool or meter shows the waveform is shifted away from zero
- Leave it at 0.0 for normal listening

### Parameters
- **Offset** - Adds a constant value to every sample (-1.0 to +1.0)
  - 0.0: No offset
  - Positive values shift the signal upward
  - Negative values shift the signal downward
  - Use very small adjustments when correction is needed

## Matrix

A channel routing tool for fixing unusual speaker or headphone channel layouts, swapping channels, combining channels, or sending one channel to more than one available output.

### When to Use
- To create custom routing between channels
- When you need to mix or split signals in specific ways
- When left/right or multi-channel playback is coming from the wrong speakers
- To combine stereo to mono or duplicate a channel to another available output

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
- When several inputs are sent to the same output, their levels are added together, so you may need to lower the volume
- Matrix does not create extra output channels by itself; it routes audio within the channels currently available

### Practical Applications
- Custom downmixing, channel swapping, or routing within the available channels
- Combining left and right into mono
- Duplicating a channel to another available output
- Correcting unusual multi-channel playback layouts

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
- Balancing surround sound or multi-speaker playback
- Matching speaker timing when speakers are at different distances
- Temporarily muting or soloing individual speakers during setup
- Linking stereo pairs or speaker groups for easier adjustment

## Mute

A simple utility that silences all audio output by filling the buffer with zeros. Useful for instantly muting audio signals.

### When to Use
- To instantly silence audio without fade
- During silent sections or pauses
- To prevent unwanted noise output

## Polarity Inversion

A utility that flips the polarity of the audio signal. Inverting all channels usually does not change what you hear by itself, but it can help when one speaker, cable, or channel appears to be wired with opposite polarity.

To fix a suspected left/right or multi-channel polarity mismatch, limit the processed channels in the effect's common routing settings and invert only the affected channel.

### When to Use
- When the center image sounds weak, hollow, or spread out because one channel may have opposite polarity
- When checking or correcting speaker, cable, or channel polarity in a playback setup
- When combining it with routing or stereo effects that need one channel's polarity reversed

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
