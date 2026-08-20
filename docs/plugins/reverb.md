---
title: "Reverb Plugins - EffeTune"
description: "Reverb effect plugins including Dattorro Plate Reverb, FDN Reverb, IR Reverb, and RS Reverb."
lang: en
---

# Reverb Plugins

A collection of plugins that add space and atmosphere to your music. These effects can make your music sound like it's being played in different environments, from intimate rooms to grand concert halls, enhancing your listening experience with natural ambience and depth.

## Plugin List

- [Dattorro Plate Reverb](#dattorro-plate-reverb) - Classic plate reverb based on Dattorro algorithm
- [FDN Reverb](#fdn-reverb) - Feedback Delay Network reverb with advanced diffusion matrix
- [IR Reverb](#ir-reverb) - Convolution reverb using an imported acoustic impulse response
- [RS Reverb](#rs-reverb) - Creates natural room ambience and space

## Dattorro Plate Reverb

A plate reverb based on Jon Dattorro's 1997 design. It adds a dense, smooth decay that works well when you want spacious ambience without the impression of a specific room.

Routing note: Dattorro Plate Reverb is a stereo plate model. When routed with more than two channels, all routed input channels feed one shared mono-to-stereo plate, but the wet/dry mix is written only to the first routed stereo pair. Additional channels contribute to the plate input and otherwise pass through unchanged, including when Dry Mix is 0%; they do not receive a wet return and are not independent plate tanks.

### Listening Experience Guide
- Lush Plate Sound:
  - Classic plate reverb character
  - Smooth, dense reverb tail without metallic artifacts
  - Beautiful shimmer and warmth characteristic of plate reverbs
- Versatile Ambience:
  - From subtle room enhancement to expansive halls
  - Works beautifully with any music genre
  - Adds smooth polish and space to music
- Natural Movement:
  - Modulation adds organic life to the reverb
  - Prevents static, artificial-sounding tails
  - Creates a breathing, living space around your music

### Parameters
- **Pre Delay** - Initial silence before reverb begins (0.0 to 100.0 ms control; use values below 100.0 ms for effective pre-delay)
  - 0-10ms: Immediate reverb, intimate feeling
  - 10-30ms: Natural sense of space
  - 30-99.9ms: Creates impression of larger spaces
  - Avoid exactly 100.0ms when you want maximum pre-delay, because that setting produces almost no audible pre-delay
- **Bandwidth** - Input signal filtering (0.0 to 1.0)
  - Lower values: Darker, warmer input tone
  - Higher values (near 1.0): Brighter, full-frequency input
  - Default 0.9995: Optimal as suggested by Dattorro
- **Input Diff 1** - First stage input diffusion (0.0 to 1.0)
  - Controls initial smearing of input signal
  - Default 0.75: Recommended value from Dattorro paper
  - Higher values: More diffuse, smoother early reflections
- **Input Diff 2** - Second stage input diffusion (0.0 to 1.0)
  - Further spreads the input signal
  - Default 0.625: Recommended value from Dattorro paper
  - Works with Input Diff 1 to create complex diffusion
- **Decay** - How long the reverb tail lasts (0.0 to 1.0)
  - Low (0.1-0.3): Short, controlled decay
  - Medium (0.4-0.6): Natural room-like decay
  - High (0.7-1.0): Long, expansive tails
- **Decay Diff 1** - Decay diffusion in the tank (0.0 to 1.0)
  - Controls density during decay phase
  - Default 0.70: Recommended value from Dattorro paper
  - Affects the smoothness of the reverb tail
- **Damping** - High frequency absorption over time (0.0 to 1.0)
  - 0.0: No damping, bright reverb throughout
  - 0.0005 (default): Very subtle, natural damping
  - Higher values: Darker, warmer decay
- **Mod Depth** - Amount of delay modulation (0.0 to 16.0 samples)
  - 0.0: No modulation, static reverb
  - 1.0-4.0: Subtle movement, adds life
  - 8.0-16.0: More noticeable chorus-like effect
- **Mod Rate** - Speed of modulation (0.0 to 10.0 Hz)
  - 0.5-1.5Hz: Slow, gentle movement
  - 2.0-4.0Hz: More active modulation
  - Higher values: Fast, shimmering effect
- **Wet Mix** - Amount of reverb added (0 to 100%)
  - 10-30%: Subtle enhancement
  - 30-50%: Noticeable presence
  - 50-100%: Dominant reverb effect
- **Dry Mix** - Amount of original signal (0 to 100%)
  - Usually kept at 100% for normal listening
  - Reduce for special effects or ambient washes

### Recommended Settings for Different Music Styles

1. Classical Piano
   - Decay: 0.6-0.7
   - Damping: 0.001
   - Mod Depth: 1.0
   - Wet Mix: 25-35%
   - Useful for: Solo piano, chamber music

2. Vocals and Acoustic
   - Decay: 0.4-0.5
   - Damping: 0.002
   - Pre Delay: 15-25ms
   - Wet Mix: 20-30%
   - Useful for: Vocals, acoustic guitar

3. Ambient and Atmospheric
   - Decay: 0.8-0.95
   - Mod Depth: 4.0-8.0
   - Mod Rate: 0.5-1.0Hz
   - Wet Mix: 50-70%
   - Useful for: Ambient, electronic, soundscapes

4. General Enhancement
   - Decay: 0.5
   - Damping: 0.0005
   - Mod Depth: 1.0
   - Wet Mix: 20-30%
   - Useful for: General listening and subtle ambience

### Quick Start Guide

1. Set the Basic Character
   - Start with Decay to control reverb length
   - Adjust Pre Delay for perceived distance
   - Set Wet Mix for desired reverb presence

2. Shape the Tone
   - Use Bandwidth to control input brightness
   - Adjust Damping for high frequency decay
   - Fine-tune diffusion parameters for density

3. Add Movement
   - Set Mod Depth for subtle variation (try 1.0)
   - Adjust Mod Rate for speed (try 1.0Hz)
   - These parameters add life to the reverb

4. Final Balance
   - Adjust Wet/Dry mix to taste
   - Trust your ears for the final settings
   - The default values are a great starting point

The Dattorro Plate Reverb brings a classic plate-style ambience to your listening experience. Its smooth, lush character makes it useful for adding beautiful, natural-sounding space to a recording.

## FDN Reverb

FDN Reverb adds a dense, natural-sounding decay. Use it to give dry or close recordings a clearer sense of room size and distance.

Routing note: FDN Reverb is a stereo reverb model with one shared feedback tank. When routed with more than two channels, each routed channel advances that shared tank in sequence rather than using independent per-channel tanks. Channel 1 receives the left wet signal, and channels 2+ receive the right wet signal.

### Listening Experience Guide
- Natural Room Feel:
  - Creates the sensation of listening in real acoustic spaces
  - Adds depth and dimension to your music
  - Makes stereo recordings feel more spacious and alive
- Atmospheric Enhancement:
  - Transforms flat recordings into immersive experiences
  - Adds beautiful tail and sustain to musical notes
  - Creates a sense of being in the performance space
- Customizable Ambience:
  - Adjustable from intimate rooms to grand concert halls
  - Fine control over the character and color of the space
  - Gentle modulation adds natural movement and life

### Parameters
- **Reverb Time** - How long the reverb effect lasts (0.20 to 10.00 s)
  - Short (0.2-1.0s): Quick, controlled decay for clarity
  - Medium (1.0-3.0s): Natural room-like reverberation
  - Long (3.0-10.0s): Expansive, atmospheric tails
- **Density** - Number of echo paths for complexity (4 to 8 lines)
  - 4 lines: Simpler, more defined individual echoes
  - 6 lines: Good balance of complexity and clarity
  - 8 lines: Maximum smoothness and density
- **Pre Delay** - Initial silence before reverb begins (0.0 to 100.0 ms)
  - 0-20ms: Immediate reverb, intimate feeling
  - 20-50ms: Natural sense of room distance
  - 50-100ms: Creates impression of larger spaces
- **Base Delay** - Foundation timing for the reverb network (10.0 to 60.0 ms)
  - Lower values: Tighter, more focused reverb character
  - Higher values: More spacious, open sound quality
  - Affects the fundamental timing relationships
- **Delay Spread** - Adds progressive timing variation between delay lines on top of small per-line random offsets (0.0 to 25.0 ms)
  - 0.0ms: Uses the base delay plus small randomized line offsets, so the reflections still stay slightly irregular
  - Higher values: Adds more progressive spread between lines for a larger, less regular tail
  - Adds realistic variation found in real acoustic spaces
- **HF Damp** - How high frequencies fade over time (0.0 to 12.0 dB/s)
  - 0.0: No damping, bright sound throughout decay
  - 3.0-6.0: Natural air absorption simulation
  - 12.0: Heavy damping for warm, mellow character
- **Low Cut** - Removes low frequencies from reverb (20 to 500 Hz)
  - 20-50Hz: Full bass response in reverb
  - 100-200Hz: Controlled bass to avoid muddiness
  - 300-500Hz: Tight, clear low end
- **Mod Depth** - Amount of pitch modulation for chorus effect (0.0 to 10.0 cents)
  - 0.0: No modulation, pure static reverb
  - 2.0-5.0: Subtle movement that adds life and realism
  - 10.0: Noticeable chorus-like effect
- **Mod Rate** - Speed of the modulation (0.10 to 5.00 Hz)
  - 0.1-0.5Hz: Very slow, gentle movement
  - 1.0-2.0Hz: Natural-sounding variation
  - 3.0-5.0Hz: Fast, more obvious modulation
- **Diffusion** - Controls how much of the mixed feedback is returned to the delay network (0 to 100%)
  - 0%: Disables feedback diffusion; the sound becomes much sparser and the reverb tail is greatly reduced
  - 50%: Balanced diffusion for natural sound
  - 100%: Maximum feedback diffusion for the smoothest density
- **Wet Mix** - Amount of reverb added to the sound (0 to 100%)
  - 10-30%: Subtle spatial enhancement
  - 30-60%: Noticeable reverb presence
  - 60-100%: Dominant reverb effect
- **Dry Mix** - Amount of original signal preserved (0 to 100%)
  - Usually kept at 100% for normal listening
  - Can be reduced for special atmospheric effects
- **Stereo Width** - Blends the wet reverb from mono toward separate left/right wet taps (0 to 200%)
  - 0%: Wet reverb appears in the center (mono)
  - 100%: Default moderate wet stereo width
  - 200%: Full left/right wet tap separation, not extra side amplification

### Recommended Settings for Different Listening Experiences

1. Classical Music Enhancement
   - Reverb Time: 2.5-3.5s
   - Density: 8 lines
   - Pre Delay: 30-50ms
   - HF Damp: 4.0-6.0
   - Useful for: Orchestral recordings, chamber music

2. Jazz Club Atmosphere
   - Reverb Time: 1.2-1.8s
   - Density: 6 lines
   - Pre Delay: 15-25ms
   - HF Damp: 2.0-4.0
   - Useful for: Acoustic jazz, intimate performances

3. Pop/Rock Enhancement
   - Reverb Time: 1.0-2.0s
   - Density: 6-7 lines
   - Pre Delay: 10-30ms
   - Wet Mix: 20-40%
   - Useful for: Recordings that need a little more space

4. Ambient Soundscapes
   - Reverb Time: 4.0-8.0s
   - Density: 8 lines
   - Mod Depth: 3.0-6.0
   - Wet Mix: 60-80%
   - Useful for: Atmospheric music and long decays

### Quick Start Guide

1. Set the Space Character
   - Start with Reverb Time to match your desired space size
   - Set Density to 6-8 for smooth, natural sound
   - Adjust Pre Delay to control distance perception

2. Shape the Tone
   - Use HF Damp to simulate natural air absorption
   - Set Low Cut to prevent bass buildup
   - Adjust Diffusion for smoothness (try 70-100%)

3. Add Natural Movement
   - Set Mod Depth to 2-4 cents for subtle life
   - Use Mod Rate around 0.3-1.0 Hz for gentle variation
   - Adjust Stereo Width for spatial impression

4. Balance the Effect
   - Start with 30% Wet Mix
   - Keep Dry Mix at 100% for normal listening
   - Fine-tune based on your music and preferences

Start with a low Mix value, then increase it until the added space is audible without masking detail in the recording.

## IR Reverb

IR Reverb convolves the signal with an imported impulse response (IR), reproducing the measured decay and spatial character of a room, hall, plate, or other acoustic system. It is useful when you want the repeatable character of a particular capture rather than a synthesized reverb model.

### Sound Enhancement Guide

- **Subtle room support:** import a short room IR, keep **Dry** on with **Dry Level** at 0 dB, set **Wet Level** around -18 to -12 dB, and use a short **Pre Delay**. This adds space without obscuring the recording.
- **Concert-hall expansion:** use a stereo or true-stereo hall IR, lower **Wet Level** first, then shorten an overly long tail with **Decay** and **Trim**.
- **Reverberant send/return:** route the source to another bus with **Matrix**, place IR Reverb on that return with **Dry** off and **Wet Level** at 0 dB, then use the send level to control reverb. This avoids adding the dry signal twice and also works for selected multichannel returns.
- **Comparison and repeatability:** retain the original IR file and its source/license record. The same IR bytes produce the same library ID, so another installation can relink exactly by importing that file.

### Parameters

- **Channel Mode** - Selects how IR channels are routed. **Auto** selects Mono for a one-channel IR, True Stereo for a four-channel IR on a stereo selection, Independent when the IR and selected-channel counts match, and Diagonal Matrix otherwise; the resolved mode appears to the right of the menu. **Mono** applies one IR to the selected channels; **Independent** maps one IR channel to each selected channel; **True Stereo** uses LL/LR/RL/RR paths; **Diagonal Matrix** maps matching input/output channels without crossfeed.
- **Latency** - Chooses the convolution block latency (Zero, 128, 256, 512, or 1024 samples). Higher settings generally reduce processing pressure but delay the whole effect output; the direct signal is held back by the same amount so it stays aligned with the reverb, and the pipeline compensates for the delay. **Zero** requires **Convolution Rate = Full**.
- **Convolution Rate** - Sets the rate used by the wet convolution. **Auto** uses half rate at high context rates and shows the resolved rate to the right of the menu, while **Full**, **Half**, and **Quarter** make the choice explicit. Reduced rates lower processing cost but also reduce wet-path bandwidth; Quarter requires a context rate of at least 176.4 kHz.
- **Wet Level** - Sets convolved output level from -96 to +12 dB. The default is -15 dB for typical insert use; in a send/return setup, use 0 dB and control the reverb amount with the send level.
- **Dry** - Enables the direct signal. It is on by default; turn it off to remove the dry signal completely while keeping the **Dry Level** setting for later use.
- **Dry Level** - Sets direct-signal level from -96 to +12 dB while **Dry** is on. The -96 dB endpoint also mutes the dry signal.
- **Pre Delay** - Delays only the wet signal by 0 to 500 ms, separating the original transient from the room response.
- **Direct Cut** - Removes the detected direct impulse from the IR so the capture contributes only its reverberant portion. Normalization continues to use the uncut IR as its reference, so enabling Direct Cut does not boost the remaining reverberant tail.
- **Cut Offset** - Moves the detected cut point by -20 to +50 ms when **Direct Cut** is on.
- **Decay** - Reshapes the IR decay from 10% to 400%; 100% preserves the recorded decay, lower values shorten it, and higher values extend it.
- **Trim** - Retains 1% to 100% of the post-cut IR with a fade. Shorter settings reduce tail length, CPU use, and memory.

### Reading the Decay Graph

Time runs left to right and level runs from 0 to -90 dB. The solid energy decay curve (EDC) shows how stored acoustic energy falls; a steeper descent means a shorter tail. The faint envelope gives transient context. Markers identify detected onset, the active direct-cut point, wet pre-delay, and trim point. **RT60** estimates the time for a 60 dB decay; “unavailable” means the IR did not contain a reliable fitting range. When **Decay** differs from 100%, compare the reshaped solid curve with the original dotted curve.

### Routing, Library, and Sharing

A mono IR can feed selected channels, independent IR channels stay separate, and a four-channel true-stereo IR uses LL/LR/RL/RR cross-routes. In Auto, every four-channel IR on a stereo selection is interpreted in that order; choose Independent or Diagonal Matrix explicitly for quad or other four-channel layouts. Other multichannel files use a bounded diagonal route; IR Reverb does not create a full surround crossfeed matrix. For paired true-stereo files, select matching `L`/`R` or `Left`/`Right` filenames together.

Imported IR files are kept in the **Impulse Response Library**, where you can search, load, or delete them by their original filenames. WAV audio with an `.irs` filename extension can be imported without renaming it. In the web app, these files are stored in your browser and can be lost if you clear site data or the browser frees storage. The desktop app stores them with its application data. Keep a separate copy of every IR you need.

Shared URLs and presets identify the IR but do not include its audio data. If the IR is unavailable, no wet sound is produced; import or select the IR again, or choose a replacement. The direct signal continues according to **Dry** and **Dry Level**.

For freely available material, start with the University of York [OpenAIR library](https://www.openair.hosted.york.ac.uk/), [EchoThief downloads](https://www.echothief.com/downloads/), or individual IR uploads on [Freesound](https://freesound.org/). “Free” does not mean unrestricted: OpenAIR records the license on each content page, and Freesound files may be CC0, CC BY, or CC BY-NC. Check the specific download page, keep the author/source/license with the file, provide attribution where required, and confirm that your intended commercial or redistribution use is permitted. EffeTune does not store or verify licensing information.

## RS Reverb

RS Reverb adds adjustable reflections and decay, making a dry recording sound as though it is playing in a room or hall.

### Listening Experience Guide
- Intimate Space:
  - Start with Room Size 8-12m, Reverb Time 1.0-1.5s, and Mix 20-30%
  - Lower Mix if vocals or instrument attacks lose clarity
- Hall-like Space:
  - Start with Room Size 30-40m, Reverb Time 2.0-2.5s, and Mix 30-40%
  - Shorten Reverb Time if successive notes become blurred
- Long, Atmospheric Decay:
  - Start with Room Size 25-40m, Reverb Time 3-6s, and Mix 40-60%
  - Raise Damping or lower High Damp if the tail is too bright

### Parameters
- **Pre-Delay** (0 to 50 ms) - Changing this control does not currently change the sound. Use Room Size, Reverb Time, and Mix to adjust the sense of space.
- **Room Size** - Sets how large the space feels (2.0 to 50.0 m)
  - Small (2-5m): Cozy room feeling
  - Medium (5-15m): Live room atmosphere
  - Large (15-50m): Concert hall grandeur
- **Reverb Time** - How long the echoes last (0.1 to 10.0 s)
  - Short (0.1-1.0s): Clear, focused sound
  - Medium (1.0-3.0s): Natural room sound
  - Long (3.0-10.0s): Spacious, atmospheric
- **Density** - How rich the space feels (4 to 8)
  - Lower values: More defined echoes
  - Higher values: Smoother atmosphere
  - Start with 6 for natural sound
- **Diffusion** - How the sound spreads out (0.2 to 0.8)
  - Lower values: More distinct echoes
  - Higher values: Smoother blend
  - Try 0.5 for balanced sound
- **Damping** - How the echoes fade away (0 to 100%)
  - Lower values: Brighter, more open sound
  - Higher values: Warmer, more intimate
  - Start around 40% for natural feel
- **High Damp** - Controls brightness of the space (1000 to 20000 Hz)
  - Lower values: Darker, warmer space
  - Higher values: Brighter, more open
  - Start around 8000Hz for natural sound
- **Low Damp** - Controls fullness of the space (20 to 500 Hz)
  - Lower values: Fuller, richer sound
  - Higher values: Clearer, more controlled
  - Start around 100Hz for balanced bass
- **Mix** - Balances the effect with original sound (0 to 100%)
  - 10-30%: Subtle enhancement
  - 30-50%: Notable space
  - 50-100%: Dramatic effect

### Recommended Settings for Different Music Styles

1. Classical Music in Concert Hall
   - Room Size: 30-40m
   - Reverb Time: 2.0-2.5s
   - Mix: 30-40%
   - Useful for: Orchestral works, piano concertos

2. Intimate Jazz Club
   - Room Size: 8-12m
   - Reverb Time: 1.0-1.5s
   - Mix: 20-30%
   - Useful for: Jazz, acoustic performances

3. Modern Pop/Rock
   - Room Size: 15-20m
   - Reverb Time: 1.2-1.8s
   - Mix: 15-25%
   - Useful for: Contemporary music

4. Ambient/Electronic
   - Room Size: 25-40m
   - Reverb Time: 3.0-6.0s
   - Mix: 40-60%
   - Useful for: Atmospheric electronic music

### Quick Start Guide

1. Choose Your Space
   - Start with Room Size to set basic space
   - Adjust Reverb Time for desired atmosphere
   - Fine-tune Mix for proper balance

2. Shape the Sound
   - Use Damping to control warmth
   - Adjust High/Low Damp for tone
   - Set Density and Diffusion for texture

3. Fine-Tune the Effect
   - Adjust Mix for final balance
   - Trust your ears and adjust to taste

Start with a low Mix value, then increase it until the added space is clear without obscuring the original recording.
