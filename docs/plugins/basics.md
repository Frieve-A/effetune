---
title: "Basic Plugins - EffeTune"
description: "Essential audio plugins including Bass Management, Volume, Mute, Stereo Balance, FIR crossover, Matrix routing, and more."
lang: en
---

# Basic Audio Plugins

A collection of essential tools for adjusting the fundamental aspects of your music playback. These plugins help you control volume, balance, and other basic aspects of your listening experience.

<!-- spectrum-overlay -->
## Spectrum Overlay

Press the spectrum icon on a compatible graph to cycle through After, Before + After, and Off. After shows only the processed spectrum as a blue line. Before + After fills the change from the unprocessed spectrum to the processed spectrum: warm color marks frequencies whose level is higher after processing, blue marks frequencies whose level is lower, and a gray line marks the After spectrum. The input and output spectra are aligned to the same point in playback, so the filled differences compare matching audio. Normal applies 1/12-octave smoothing; HQ provides finer analysis at low frequencies. Use the comparison to see how each adjustment changes bass, mids, and treble while listening. Read spectrum levels on the dBFS scale at the right of the graph. It is separate from the graph's gain scale; 0 dBFS is the full-scale digital reference, and lower values are quieter. In Config, choose **Normal** or **HQ** for Overlay spectrum quality, and **Instantaneous** or **Peak Hold** for Overlay spectrum display. Peak Hold keeps recent peaks visible and lets them fall gradually. Only the processed spectrum is collected in After mode; collection and drawing stop in Off.

## Plugin List

- [Bass Management](#bass-management) - Routes managed bass and LFE to selected subwoofer outputs
- [Channel Divider](#channel-divider) - Splits stereo audio into frequency bands across stereo output pairs
- [DC Offset](#dc-offset) - Adds or corrects a constant DC offset
- [FIR Crossover](#fir-crossover) - FIR crossover with minimum- and linear-phase modes and very steep slopes
- [Matrix](#matrix) - Routes and mixes audio channels with flexible control
- [MultiChannel Panel](#multichannel-panel) - Controls multiple audio channels with individual settings
- [Mute](#mute) - Silences the audio output
- [Polarity Inversion](#polarity-inversion) - Flips signal polarity for correction or special routing cases
- [Stereo Balance](#stereo-balance) - Adjusts the left-right balance of your music
- [Volume](#volume) - Controls how loud the music plays

## Bass Management

Bass Management sends the low-frequency part of selected main channels and any dedicated LFE input to the subwoofer outputs you choose. It is useful when a multi-channel output drives main speakers and one or more subwoofers. Each managed main keeps its higher frequencies on the same output channel, while the subwoofers receive the bass routed to them. The plugin requires the WASM DSP engine.

Until you select a **Sub Output**, Bass Management does not split bass or distribute it to subwoofers, so the input channels pass through without a crossover. A new instance starts with the actual bus channels set to **Managed** and no **Sub Outputs** selected.

Select **All** in the effect bus routing, then make the output bus wide enough for every main and subwoofer channel you will use. The channel table always shows the input role and its selected subwoofer outputs. A subwoofer output cannot also be a **Full Range** or **Managed** main channel. An **LFE** input may use the same channel number as a subwoofer output; its signal is collected before outputs are assembled, so it is sent only once.

### Sound Enhancement Guide

- For stereo with two subwoofers, use a four-channel bus. Set channels 1 and 2 to **Managed**, then select channels 3 and 4 as **Sub Outputs**. Their roles change to **LFE** automatically; use the Matrix to keep or turn off each main-to-subwoofer route.
- For surround material, set only the actual main channels to **Managed** and set the source LFE channel to **LFE**. Choose the subwoofer outputs explicitly. Do not leave an LFE source as a main channel if it should play only through subwoofers.
- Start each managed main at 80 Hz and 24 dB/oct. Raise its crossover frequency when that speaker has limited bass extension; use a steeper slope when you need less overlap. Confirm the speaker's usable range before increasing playback level.
- When one input is sent to several subwoofers, Bass Management divides that electrical signal equally among them. This does not prevent peaks when several inputs or subwoofers combine. Begin with **Headroom** below 0 dB when needed, watch the following level meter, and place Brickwall Limiter later in the chain if peak control is required.
- Use **LFE Gain** only when your source chain has not already applied its intended LFE level adjustment. It does not add an automatic cinema-style level correction.
- Follow Bass Management with any per-subwoofer high-pass filter, EQ, or polarity adjustment. Use MultiChannel Panel afterwards for individual trim, mute/solo, and up to 30 ms of placement delay; add a limiter last if needed.

### Parameters

- **Phase**
  - **IIR** - Provides the lower-latency crossover mode. It changes phase around the crossover frequency.
  - **Linear** - Keeps the crossover split time-aligned, but adds visible processing latency and can produce pre-ringing. Use it only when that delay is acceptable.
- **Taps** - Selects the Linear filter length: 8192, 16384, or 32768. More Taps improve low-frequency and steep-slope accuracy, while increasing preparation time and latency. The initial setting is 16384; this control affects Linear mode.
- **Headroom** - Applies the same attenuation to every output. Lower it when combined bass and LFE signals leave too little level margin.
- **Bass Gain** - Adjusts the level of bass separated from **Managed** main channels before it is mixed into the selected subwoofer outputs.
- **LFE Gain** - Adjusts the level of **LFE** inputs before they are mixed into the selected subwoofer outputs.
- **Channel Role** - Sets each input channel to **Full Range**, **Managed**, **LFE**, or **Unused**.
  - **Full Range** keeps the source on its matching main output without sending bass to a subwoofer.
  - **Managed** keeps the high-frequency part on its matching main output and sends its low-frequency part to the selected subwoofers.
  - **LFE** sends the source only to the selected subwoofers. It does not pass through its matching output as a main channel.
  - **Unused** reserves an input channel, normally for a subwoofer output.
- **Crossover Frequency** - Sets each **Managed** channel's crossover point from 20 to 300 Hz. Higher values send more of that main channel's bass to subwoofers.
- **Slope** - Sets the crossover steepness for each **Managed** channel: 24, 48, or 96 dB/oct. Higher values narrow the overlap between main and subwoofer output.
- **Sub Outputs** - Selects the subwoofer output channels used by a **Managed** or **LFE** input. Selecting a channel changes its **Channel Role** to **LFE**. A newly selected output starts with every current bus input routed **ON** at normal polarity; use the Matrix to turn off an individual route. When no **Sub Outputs** are selected, bass splitting and subwoofer routing stop, and the input channels pass through without a crossover.
- **ON** and **Ø** - In each channel-table cell, **ON** sends that **Managed** or **LFE** input to the selected subwoofer output. **Ø** reverses polarity only for that input-to-subwoofer path, which can help align it with your measured or audible result. **Ø** is available only while **ON** is selected; clearing **ON** also clears **Ø**. It does not change the input's main output.
- **LFE Low-pass** - When enabled, limits LFE content above the selected **LFE Frequency**. Leave it off to keep the source LFE bandwidth unchanged.
- **LFE Frequency** and **LFE Slope** - Set the optional LFE low-pass point from 20 to 300 Hz and its 24, 48, or 96 dB/oct slope. They do not filter the bass already separated from managed main channels.

### Visual Display and Status

- The routing summary shows which input roles feed each subwoofer output. Check it before raising the level, especially after changing the output-channel count.
- Select a managed main channel to see its low-pass and high-pass responses. The display represents the active filter mode and settings rather than an idealized response.
- The status shows the active mode, Linear filter preparation state, and effective latency in samples and milliseconds.
- Hover over the graph, or touch and drag on it, to read the values at that point.

### Filter Preparation
Changing Linear settings can briefly reduce or pause sound while the new filters are prepared. If filter preparation cannot complete, reduce **Taps** and try again. When a previous active configuration remains usable, it continues playing; otherwise the normal main channels pass through with matching delay, reserved subwoofer outputs are silent, and an LFE source is not played until preparation succeeds.

### Bypass and Calibration

Host plugin bypass restores the original channel assignment and audio, so Bass Management routing, subwoofer protection, and delay matching do not continue while it is bypassed. For comparisons or temporary muting that keep the configured wiring, use the later MultiChannel Panel instead.

Linear mode describes the crossover itself. Per-subwoofer IIR high-pass/EQ processing or an intentional relative delay later in the chain changes the phase behavior of the complete system. Save the complete calibrated chain as one preset.

## Channel Divider

A specialized tool that splits your stereo signal into separate frequency bands and routes each band to a different stereo output pair. It is useful for multi-amplifier, multi-speaker, or custom crossover playback setups.

To use this effect, use the desktop app, set an even output-channel count from 4 to 16 in the audio settings, and set the channel in the effect bus routing to "All." The selected Band Count determines which output pairs the effect uses.

### When to Use
- When using even multi-channel audio outputs from 4 to 16 channels
- To create custom frequency-based channel routing
- For multi-amplifier or multi-speaker setups

### Parameters
- **Band Count** - Number of frequency bands to create (2-4 bands)
  - 2 bands: Low/High split, requiring 4 output channels
  - 3 bands: Low/Mid/High split, requiring 6 output channels
  - 4 bands: Low/Mid-Low/Mid-High/High split, requiring 8 output channels
  - Band Count remains limited to four bands; higher output-channel counts do not add more bands

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
- Output channels must be an even number from 4 to 16
- Each band keeps the original stereo pair: 2-band mode outputs Low to channels 1-2 and High to channels 3-4; 3-band mode uses channels 1-2, 3-4, and 5-6; 4-band mode uses channels 1-2, 3-4, 5-6, and 7-8
- Uses high-quality Linkwitz-Riley crossover filters

### Visual Display
- The graph shows the frequency response of each output band.
- Hover over the graph, or touch and drag on it, to read the values at that point.

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

## FIR Crossover

FIR Crossover splits stereo input into two, three, or four frequency bands and routes each band to its own stereo output pair. It is intended for multi-amplifier or multi-speaker playback systems that need sharper separation than Channel Divider provides. The FIR design supports very steep crossover targets without recursive-filter stability limits, and Linear Phase keeps the same fixed processing delay across the spectrum. The plugin requires the WASM DSP engine.

To use it, run the desktop app with an even output-channel count from 4 to 16 and select **All** in the effect bus routing. Channels 1-2 are the stereo input; successive stereo output pairs receive the low-to-high bands. Band Count remains limited to four bands, so the effect uses at most channels 1-8. When the effect receives two channels, it passes the input through unchanged.

### Sound Enhancement Guide

- Start with two bands, **Minimum Phase**, 32768 Taps, 128 samples of Latency, and a 24 dB/oct slope. Confirm that the low band reaches output channels 1-2 and the high band reaches channels 3-4 before connecting additional amplifiers or speakers.
- Add bands only when the output interface and speaker system have matching stereo output pairs. Three bands require six output channels, and four bands require eight.
- Use 48 to 96 dB/oct when drivers need less frequency overlap. Reserve the steeper settings for a concrete crossover requirement; they need more taps to follow the target accurately and can produce a longer impulse response.
- Use **Linear Phase** when constant phase delay through the crossover is important and its `Taps / 2` delay is acceptable. Use **Minimum Phase** when lower delay matters more.
- Set crossover frequencies from driver measurements and safe operating ranges, not only by ear. Protect tweeters and other limited-band drivers during setup.

### Parameters

- **Phase**
  - **Minimum Phase** - Uses a causal minimum-phase crossover construction and adds no FIR half-length delay. The selected convolution Latency still applies.
  - **Linear Phase** - Builds linear-phase band filters and adds `Taps / 2` samples of FIR delay in addition to the selected convolution Latency.
- **Taps** - FIR length: 8192, 16384, 32768, 65536, or 131072. More taps improve low-frequency resolution and the accuracy of steep transitions, but increase memory use, design time, and Linear Phase delay.
- **Latency** - Convolution-engine head latency: 0, 128, 256, 512, or 1024 samples. Lower values reduce delay but require more processing.
- **Band Count** - Selects 2, 3, or 4 stereo bands. The available maximum follows the configured output channel count.
- **Crossover Frequencies** - F1, F2, and F3 set the active crossover points from 10 Hz to 40 kHz. The plugin keeps them in ascending order; the usable upper range also depends on the audio sample rate.
- **Slope** - Sets each crossover target to 24, 48, 72, 96, 144, 192, 288, or 384 dB/oct. Higher values make a narrower transition and usually benefit from more Taps.

### Visual Display

- The graph follows Channel Divider's display: it shows the intended response of every active output band from 10 Hz to 40 kHz on a -60 to +12 dB scale.
- Each green curve corresponds to one stereo output pair, ordered from the lowest band to the highest band.
- The status line reports total processing latency, FIR frequency resolution, and whether the filter asset is bypassed, staged, preparing, active, or in error.
- A channel warning appears unless the plugin is running with an even output-channel count from 4 to 16.
- Hover over the graph, or touch and drag on it, to read the values at that point.

## Matrix

A channel routing tool for fixing unusual speaker or headphone channel layouts, swapping channels, combining channels, or sending one channel to more than one available output.

### When to Use
- To create custom routing between channels
- When you need to mix or split signals in specific ways
- When left/right or multi-channel playback is coming from the wrong speakers
- To combine stereo to mono or duplicate a channel to another available output

### Features
- Flexible routing matrix for up to 16 channels
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

A comprehensive control panel for managing multiple audio channels individually. This plugin provides complete control over volume, muting, soloing, and delay for up to 16 channels, with a visual level meter for each channel.

Scroll within the panel to reach channels below the visible area.

### When to Use
- When working with multi-channel audio (up to 16 channels)
- To create custom volume balance between different channels
- When you need to apply individual delay to specific channels
- For monitoring levels across multiple channels simultaneously

### Features
- Individual controls for up to 16 audio channels
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
