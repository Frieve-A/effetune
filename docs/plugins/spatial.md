---
title: "Spatial Plugins - Crossfeed, Crosstalk Cancellation, Stereo Width & Upmix - EffeTune"
description: "Spatial audio plugins including Crossfeed Filter, Crosstalk Cancellation, MS Matrix, Multiband Balance, Phase Select EQ, Spatial Mapper, and Stereo Blend."
lang: en
---

# Spatial Audio Plugins

A collection of plugins that enhance how your music sounds in your headphones or speakers by adjusting the stereo (left and right) balance. These effects can make your music sound more spacious and natural, especially when listening with headphones.

## Plugin List

- [Crossfeed Filter](#crossfeed-filter) - Headphone crossfeed filter for natural stereo imaging
- [Crosstalk Cancellation](#crosstalk-cancellation) - Uses in-ear measurements to reduce crosstalk between stereo speakers
- [MS Matrix](#ms-matrix) - Converts stereo to Mid/Side and back for advanced stereo adjustment chains
- [Multiband Balance](#multiband-balance) - 5-band frequency-dependent stereo balance control  
- [Phase Select EQ](#phase-select-eq) - Boosts or cuts frequency components selected by L/R phase difference and Balance
- [Spatial Mapper](#spatial-mapper) - Separates direct, diffuse, and residual sound and routes each component across the channel bus
- [Stereo Blend](#stereo-blend) - Controls stereo width from polarity-swapped stereo through mono to enhanced stereo

## Crossfeed Filter

A headphone crossfeed filter that simulates the natural acoustic crosstalk that occurs when listening through speakers. This effect helps reduce the exaggerated stereo separation often experienced with headphones, creating a more natural and comfortable listening experience that mimics the way sound reaches our ears in a real acoustic environment.

### Key Features
- Simulates natural acoustic crosstalk for headphone listening
- Adjustable crossfeed level and timing
- Low-pass filtering to mimic frequency-dependent crosstalk
- Stereo-only processing (automatically bypassed for mono or other non-stereo signals)

### System Presets

Click **Effect Presets** in the effect header to choose a complete crossfeed amount for headphone listening.

- **Subtle Blend** - A very light crossfeed that preserves most of the original width.
- **Vintage Receiver** - A moderate crossfeed resembling a traditional headphone adapter.
- **Living Room Speakers** - A strong speaker-like blend for recordings with very wide stereo separation.

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

### Starting Points

Use the **Subtle Blend**, **Vintage Receiver**, or **Living Room Speakers** system preset as a complete starting point. Then adjust Level first: lower values preserve more stereo width, while higher values make the speaker-like blend more obvious.

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

## Crosstalk Cancellation

Crosstalk Cancellation uses measurements made at your ears to reduce the sound from each stereo speaker reaching the opposite ear. Use it with two stereo speakers when you listen from one measured position and want a more distinct, binaural-like stereo image. It is not for headphones or mono playback.

Unlike [Crossfeed Filter](#crossfeed-filter), which adds a little speaker-like crosstalk for headphone listening, Crosstalk Cancellation reduces measured crosstalk for speaker listening.

### Measure and Assign

1. Place the microphone at your left ear position and make one measurement with both the left and right speaker outputs selected. Assign that measurement's left channel to **LL: L Speaker → Left Ear** and right channel to **RL: R Speaker → Left Ear**.
2. Move the microphone to your right ear position and repeat the same two-output measurement. Assign its left channel to **LR: L Speaker → Right Ear** and right channel to **RR: R Speaker → Right Ear**.
3. Use single-point measurements made at the same speaker and listening setup. Assign a different measurement channel to every slot, then wait for the filters to become ready.

Start with the defaults: **Taps** 4096, **Regularization** 50%, **Max Gain** 12 dB, **Freq Low** 200 Hz, **Freq High** 6000 Hz, **Direct Window** 8 ms, **Strength** 70%, **Output Gain** 0 dB, and **Latency** 128 samples. Compare with bypass and make small changes while seated at the measured position.

### Parameters

- **Taps** (1024–16384): Sets the filter length. More taps can improve cancellation but require more processing and add a longer modeled delay. If the status warns that the filter tail may be truncated, increase Taps first.
- **Regularization** (0–100%): Limits aggressive correction where the measurements are difficult to cancel. Increase it if the result sounds unstable or colored when you move slightly; decrease it only if the measured position needs more cancellation.
- **Max Gain** (0–24 dB): Caps how much the correction filters can boost. A lower value is gentler and preserves headroom; a higher value can cancel more but may make the result less robust.
- **Freq Low** (20–2000 Hz) and **Freq High** (1000–20000 Hz): Set the main correction band. Lower frequencies below the selected band and higher frequencies above it pass through. Begin with 200 Hz–6000 Hz; narrow the band if the effect is too sensitive to head movement.
- **Direct Window** (2–50 ms): Sets how much of each measured direct sound is used. A shorter window reduces room reflections but can raise the effective low-frequency limit; a longer window includes more low-frequency information but may include more room sound.
- **Strength** (0–100%): Blends from the delayed uncorrected signal at 0% to full correction at 100%. Start at 70%; reduce it if the sound becomes unnatural away from the measured position.
- **Output Gain** (-24 to +24 dB): Adjusts the final level after correction. Keep it at 0 dB first, then reduce it if needed to leave headroom.
- **Latency** (0, 128, 256, 512, or 1024 samples): Selects the processing block latency. Higher values can make filter processing easier; lower values are preferable when monitoring latency matters.

### Status and Latency

The status begins with **Assign all four measurements to begin.** While the filters are being made it shows that design is in progress; when ready, it reports the maximum filter gain. A tail warning means increasing **Taps** or **Regularization** may help. A warning that **Direct Window** raised the effective low frequency means the selected window is too short to use the requested lowest frequencies.

If an assigned measurement cannot be found, reselect it. If the filters cannot be prepared, try fewer **Taps** or a higher **Latency**. Until four suitable measurements are assigned and the filters are ready, the plugin passes audio through unchanged and reports no added processing latency.

Once ready, the total added latency is the selected **Latency** plus the filter's modeled delay; the app applies its normal pipeline delay compensation. Check **Total Delay** if real-time monitoring or audio/video synchronization matters. Crosstalk Cancellation has no graph or other visualization.

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

## Phase Select EQ

Phase Select EQ boosts or cuts stereo frequency components selected simultaneously by **frequency**, **absolute left/right phase difference**, and **left/right level balance**. It applies the same positive gain multiplier to both channels, so it shapes the level of targeted spatial components without rotating or altering phase. Use it when a standard frequency-only EQ cannot separate a centered vocal or instrument from wider or hard-panned sounds sharing the same frequency band.

Five independent Bands are available, each with an inner **Core** (full Gain) and an outer **Transition** (smooth fade toward 100%). Overlapping Bands multiply their gains, so several boosts can raise the signal above 0 dBFS; leave enough headroom and compare with bypass. Phase Select EQ adds FFT analysis latency (5,120 samples or ~106.7 ms at 48 kHz; ~116.1 ms at 44.1 kHz), which is reported in **Total Delay** and can affect real-time monitoring and audio/video synchronization.

### Listening Enhancement Guide

1. **Reduce wide high-frequency glare**: Set a Band around 4–12 kHz and 90–180° Phase with 70–90% Gain and broad transitions to soften out-of-phase upper-treble harshness while leaving centered detail intact.
2. **Add presence to centered vocals**: Set a Band around 1–4 kHz and 0–30° Phase (or −17% to +17% Balance) with 110–125% Gain to bring near-center midrange forward without boosting wide ambience.
3. **Control diffuse low-mid ambience**: Set a Band around 150–600 Hz and 60–150° Phase with 80–90% Gain to clean up wide low-mid mud while keeping centered bass and snare body.
4. **Tame a hard-panned instrument**: In **Balance** view, select −100% to −70% (left) or +70% to +100% (right) with Phase Core at 150–180° so it includes the one-sided points at -180° and +180° (or 0–180° if Balance alone should decide), narrow the frequency range around the instrument, and reduce Gain to 70–90%.

These phase ranges are typical tendencies, not fixed source positions. Watch where the dots actually appear, make small changes, and confirm the result on both headphones and speakers.

### Parameters

- **Band 1–5 / checkbox** (Off/On) - Selects a Band for editing and toggles it on or off.
- **Gain** (0% to 200%) - Level multiplier inside the Core (100% = unchanged, 0% = mute, 200% = +6 dB).
- **Solo** (Off/On) - Auditions only the components selected by the soloed Band(s); while Solo is on, Gain is ignored and everything outside the soloed Bands is muted.
- **Core Low Freq / Core High Freq** (20 Hz to 40 kHz, limited by the sample rate) - Fully processed frequency range.
- **Low Freq Trans / High Freq Trans** - Frequency fade widths below and above the Core.
- **Core Low Phase / Core High Phase** (0° to 180°) - Fully processed absolute L/R phase-difference range.
- **Low Phase Trans / High Phase Trans** - Phase fade widths toward 0° and 180°.
- **Outer Low Bal / Core Low Bal / Core High Bal / Outer High Bal** (-100% to +100%) - Left/right amplitude-balance Core and outer Transition boundaries.
- **Map Handles**: Drag inside a Band's frame to move it, drag Core edges/corners to resize the Core, or drag outer dashed handles to adjust transitions.

### Reading the Selection Map

- **Vertical axis**: Logarithmic frequency (low at bottom, high at top).
- **Horizontal axis**: Switch between **Phase** and **Balance** above the map; editing a Phase or Balance control switches the view automatically.
  - **Phase**: 0° in-phase at center; -180° and +180° at the edges are the same opposite-phase point. Selection uses the absolute phase difference, so the frame is mirrored across 0°, joins at the center when it touches 0°, and continues across both edges when it reaches 180°.
  - **Balance**: 50:50 at center, left-only at the left edge, right-only at the right edge. Balance is `(right amplitude - left amplitude) / (left amplitude + right amplitude) × 100%`.
- **One-sided sounds**: A component present in only one channel has Balance -100% or +100% and appears at -180° (left) or +180° (right) in Phase view, so hard-panned sounds can be selected from either view.
- **Dots & Frames**: White dots show recent input components (brighter/larger = stronger; dots rejected by the hidden axis are dimmed). Solid inner rectangles show each enabled Band's **Core** and dashed outer rectangles its **Transition**; the Band being edited is highlighted, and the number at the corner of each Core identifies the Band.
- **Badges**: The badge beside each Band number shows its hidden-axis range as outer low › Core low–high › outer high, e.g. `P 20°›40°–80°›100°` or `B 100:0›80:20–70:30›0:100` (left:right ratios). `P full` or `B full` means that axis is not limited.
- **Readout**: Hover over the map, or touch and drag on it, to read the frequency and the phase difference or balance at that point.

The Balance grid uses familiar channel ratios; approximate L/R level differences are shown for reference:

| Balance | 0% | ±17% | ±33% | ±60% | ±82% | ±100% |
|---|---:|---:|---:|---:|---:|---:|
| L/R level difference | 0 dB | ±3 dB | ±6 dB | ±12 dB | ±20 dB | one channel only |

## Spatial Mapper

Spatial Mapper analyzes how the input channels relate across frequency bands, continuously separates the sound into Direct, Diffuse, and Residual components, and routes each component across the current channel bus. Use it to keep focused sound toward the front, move ambience toward surround or height channels, extract center or ambience content, or reshape stereo width. The default **Transparent** preset keeps the original channel placement.

The three components have different roles. **Direct** contains the dominant coherent sound in each band. **Diffuse** contains less coherent, distributed sound. **Residual** keeps content that is not assigned fully to either component. The split is gradual, so changing the controls does not hard-switch sounds between routes.

Spatial Mapper adds frequency-analysis latency. EffeTune includes this in the **Total Delay** display. Keep that delay in mind for real-time monitoring and audio/video synchronization.

### System Presets

Click **Effect Presets** in the effect header to choose a complete starting configuration.

- **Transparent** - Keeps the original channel placement and is the default.
- **Stereo Enhance** - Widens a stereo input through the Residual route while retaining focused and diffuse placement.
- **Center Extract** - Sends the Direct component toward channel 3. Use a bus with at least three channels.
- **5.1 Upmix** - Maps stereo to L, R, C, LFE, Ls, Rs order. It leaves LFE empty and requires at least six bus channels.
- **7.1.4 Upmix** - Maps stereo to L, R, C, LFE, Ls, Rs, Lb, Rb, Ltf, Rtf, Ltb, Rtb order. It leaves LFE empty and requires at least twelve bus channels.
- **Ambience Extract** - Keeps the Diffuse component and suppresses the Direct and Residual components.

### Reading and Editing the Routing Grid

Under **Component Routing**, choose the **Direct**, **Diffuse**, or **Residual** tab. Columns are analyzed input channels and rows are output bus channels. Use the small slider or number field in each cell to set a linear gain from -1.00 to +1.00 in 0.01 steps: 0 makes no connection, +1.00 sends the component at full positive polarity, and a negative value sends it with inverted polarity. Negative values appear in red. Values between these points set a proportionally lower level.

A routed output row replaces that bus channel with the mapped result. An output channel within the **Input Channels** range becomes silent when no component is routed to its row. Channels outside **Input Channels** pass through with matching delay when no component writes to them.

### Listening Enhancement Guide

1. **Widen stereo without moving focused sound as strongly**
   - Start with **Stereo Enhance**.
   - Lower **Directness** or **Diffuse Extraction** only if more material needs to remain in Residual for the widening route.
   - Compare with **Transparent**, and reduce the change if center images become weak or mono playback loses too much content.
2. **Build a center channel from stereo**
   - Use a bus with at least three channels and choose **Center Extract**.
   - Raise **Directness** and **Separation** to concentrate more coherent content in Direct.
   - Check that vocals and other centered material remain stable while wide ambience stays mainly in left and right.
3. **Expand stereo across surround or height channels**
   - Set the bus to the channel order shown above, then choose **5.1 Upmix** or **7.1.4 Upmix**.
   - Adjust **Diffuse Extraction** to control how much distributed content reaches the surround and height routes.
   - The preset does not generate an LFE signal; add bass management separately when needed.
4. **Isolate ambience**
   - Start with **Ambience Extract**.
   - Raise **Diffuse Extraction** for a stronger diffuse selection, and use **Phase Sensitivity** to decide how strongly opposing channel phase reduces Direct classification.

### Parameters

- **Input Channels** (1 to 16): Sets how many channels from the start of the bus are analyzed. If the bus has fewer channels, Spatial Mapper uses the available channels.
- **Analysis Bands** (8, 16, 24, 32, or 48): Sets the frequency resolution of the spatial analysis. More bands follow frequency-dependent placement more closely but require more processing. The default is 24.
- **Directness** (0% to 100%): Controls how much dominant coherent content is assigned to Direct. Higher values make the Direct extraction stronger.
- **Separation** (0% to 100%): Controls how selectively content is assigned to Direct and Diffuse. Higher values leave more ambiguous content in Residual, increasing the contrast among routes.
- **Diffuse Extraction** (0% to 100%): Controls how much low-coherence content is assigned to Diffuse. Higher values send more distributed ambience into the Diffuse route.
- **Phase Sensitivity** (0% to 100%): Controls how strongly channel phase opposition reduces Direct classification. Lower values treat coherent opposite-polarity content more like other coherent sound; higher values leave more of it outside Direct. This control does not automatically designate opposite-phase sound as rear content.
- **Temporal Smoothing** (0% to 100%, Fast to Stable): Controls how quickly the analysis and routing follow changes. Lower values react faster; higher values reduce image movement and pumping but respond more slowly.
- **Energy Preservation** (Off/On): Normalizes Direct, Diffuse, and Residual routing separately to avoid unintended level changes from the routing matrices. Turn it off when the matrix gain itself should change component level.
- **Component Routing / Direct**: Selects the Direct grid and sets its output gains.
- **Component Routing / Diffuse**: Selects the Diffuse grid and sets its output gains.
- **Component Routing / Residual**: Selects the Residual grid and sets its output gains.

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
