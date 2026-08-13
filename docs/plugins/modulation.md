---
title: "Modulation Plugins - EffeTune"
description: "Modulation effects including Auto Filter, Auto Pan, Chorus, Frequency Shifter, Phaser, Rotary Speaker, pitch effects, Tremolo, and Wow Flutter."
lang: en
---

# Modulation Plugins

A collection of plugins that add movement and variation to your music through modulation effects. These effects can make your digital music feel more organic and dynamic, enhancing your listening experience with subtle or dramatic variations in sound.

## Plugin List

- [Auto Filter](#auto-filter) - Sweeps a resonant filter with an LFO or the music's amplitude envelope
- [Auto Pan](#auto-pan) - Moves stereo-pair level smoothly across the listening field
- [Chorus](#chorus) - Adds moving delayed voices for chorus, ensemble, flanging, or vibrato
- [Doppler Distortion](#doppler-distortion) - Simulates the natural, dynamic shifts in sound from subtle speaker cone movement
- [Frequency Shifter](#frequency-shifter) - Translates frequencies, applies ring modulation, or creates a barber-pole shift
- [Phaser](#phaser) - Creates moving peaks and notches with classic or barber-pole sweeps
- [Pitch Shifter](#pitch-shifter) - Changes the pitch of your music without affecting playback speed
- [Pitch Shifter HQ](#pitch-shifter-hq) - Changes pitch with fewer phase artifacts when sound quality matters more than latency or CPU use
- [Rotary Speaker](#rotary-speaker) - Combines independent horn and drum motion for a rotary-speaker effect
- [Tremolo](#tremolo) - Creates rhythmic volume variations for a pulsing, dynamic sound
- [Wow Flutter](#wow-flutter) - Recreates the gentle pitch variations of vinyl records and tape players

## Auto Filter

Auto Filter moves a resonant filter automatically. **LFO** mode repeats a sweep, while **Envelope** mode follows the music's level for Envelope Filter and Auto Wah sounds.

### Sound Enhancement Guide

- For gentle tonal motion, choose **LFO**, **Low-pass**, a wide frequency range, low **Resonance**, and **Mix** around 30–50%.
- For an Auto Wah response, choose **Envelope**, **Band-pass**, raise **Resonance**, and adjust **Sensitivity** until accents open the filter without holding it fully open.
- Use a slower **Attack** to soften the reaction to percussion; use a longer **Release** for a smoother return between notes.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Auto Filter Sweep** (LFO), **Stereo Filter Sweep** (LFO), **Envelope Filter** (Envelope), **Auto Wah** (Envelope), and **Reverse Auto Wah** (Envelope). Changing an individual parameter switches Style to **Custom**.
- **Mode** — **LFO** sweeps periodically; **Envelope** follows signal level.
- **Filter Type** — **Low-pass** retains frequencies below the moving cutoff, **Band-pass** emphasizes the region around it, and **High-pass** retains frequencies above it.
- **Minimum Frequency / Maximum Frequency** (20–20,000 Hz) — set the sweep limits. If supplied in reverse order, EffeTune sorts them; equal values hold the filter stationary. The available upper limit can be lower at lower playback sample rates.
- **Resonance** (Q 0.5–20) — higher values emphasize the moving cutoff more strongly.
- **Mix** (0–100%) — blends dry and filtered sound; 0% is transparent dry.
- **Rate** (0.05–20 Hz), **Waveform** (Sine/Triangle), and **Stereo Phase** (0–180°) — control LFO speed, trajectory, and the offset within each stereo pair. They are used only in LFO mode.
- **Sensitivity** (0–60 dB), **Attack** (1–500 ms), **Release** (10–2,000 ms), and **Direction** (Up/Down) — control how strongly and how quickly the envelope moves, and whether louder sound raises or lowers the cutoff. They are used only in Envelope mode.

## Auto Pan

Auto Pan moves the level of each stereo pair between left and right. If the audio has an unpaired channel, that channel remains centered.

### Sound Enhancement Guide

- Start with **Rate** around 0.2–0.5 Hz and moderate **Depth** for slow, unobtrusive movement.
- Reduce **Width** when headphone movement feels too wide; offset **Center** when the recording needs a stable bias to one side.
- **Triangle** gives a more uniform traverse; **Sine** slows near the ends for gentler motion.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Gentle Auto Pan**, **Wide Auto Pan**, and **Fast Auto Pan**. Changing an individual parameter switches Style to **Custom**.
- **Rate** (0.05–20 Hz) — sets movement speed.
- **Depth** (0–100%) — sets how far level moves around the center; 0% is neutral.
- **Center** (-100–100%) — shifts the midpoint left or right.
- **Width** (0–100%) — sets the usable stereo span.
- **Waveform** — chooses **Sine** or **Triangle** motion.
- **Phase** (0–360°) — sets the starting point of the repeating movement.

## Chorus

Chorus adds moving delayed copies of the music. Its modes cover **Stereo Chorus**, **Ensemble**, **Flanger**, and **Vibrato**; Delay and Depth can make the processed sound feel slightly behind the original.

### Sound Enhancement Guide

- Use **Classic Chorus** or **Stereo Chorus** for moderate width and animation on dense recordings.
- Use **Ensemble** with more **Voices** for a denser, smoother layer; excessive depth can make pitch motion obvious.
- **Flanger** uses the shortest delay and is the only mode that uses **Feedback**. Positive and negative values give different comb-filter polarity.
- **Vibrato** is fully wet by design: use a moderate **Rate** and **Depth** for controlled pitch movement.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Classic Chorus** (Chorus), **Stereo Chorus** (Stereo Chorus), **Ensemble** (Ensemble), **Flanger** (Flanger), **Jet Flanger** (Flanger), and **Vibrato** (Vibrato). Changing an individual parameter switches Style to **Custom**.
- **Mode** — selects Chorus, Stereo Chorus, Ensemble, Flanger, or Vibrato.
- **Rate** (0.05–10 Hz) — sets modulation speed.
- **Delay** (0.5–30 ms) — sets nominal wet-path delay.
- **Depth** (0–20 ms) — sets delay excursion and is automatically limited to the current **Delay** value.
- **Voices** (1–6) — sets the number of moving voices in Chorus and Ensemble; other modes ignore it.
- **Stereo Spread** (0–100%) — offsets motion within each stereo pair in Stereo Chorus, Ensemble, Flanger, and Vibrato. Chorus mode ignores it.
- **Feedback** (-75–75%) — returns wet output to the delay in Flanger mode only.
- **Mix** (0–100%) — linearly blends dry and wet sound; Vibrato ignores it and remains 100% wet. 0% is transparent in other modes.

Changing Mode or Voices may briefly emphasize the original sound to keep the transition smooth.

## Doppler Distortion

Experience a unique audio effect that brings a touch of natural movement to your music. Doppler Distortion simulates the gentle distortions created by the physical movement of a speaker cone. This effect introduces slight changes in the sound's depth and tone, much like the familiar pitch shifts you hear when a sound source moves relative to you. It adds a dynamic, immersive quality to your listening experience by making the audio feel more alive and engaging.

### Parameters

- **Coil Force (N / V)**
  Controls how strongly the input signal drives the simulated speaker coil movement. Higher values result in a more pronounced Doppler distortion.

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
- **Coil Force:** 8.0 N / V
- **Speaker Mass:** 0.03 kg  
- **Spring Constant:** 6000 N/m  
- **Damping Factor:** 1.5 N·s/m  

These settings provide a subtle Doppler Distortion that enriches the listening experience without overpowering the original sound.

## Frequency Shifter

Frequency Shifter moves every frequency component by a fixed number of hertz rather than by a musical interval. **Ring Mod** creates metallic sidebands, while **Barber-pole** creates the impression of a shift that keeps rising or falling. The effect adds a short processing delay that varies with sample rate, including when Mix is 0%.

### Sound Enhancement Guide

- For subtle animation, choose **Shift** and begin near ±5–15 Hz. Unlike pitch shifting, harmonic intervals are intentionally changed.
- Choose **Ring Mod** for metallic or bell-like sidebands; lower **Carrier Frequency** values retain more of the source's rhythm.
- Use **Barber-pole** at a slow **Rate** for a continuous spectral-motion illusion. Keep **Mix** moderate when the effect masks pitch or speech clarity.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Shift Up** (Shift), **Shift Down** (Shift), **Fine Detune** (Shift), **Ring Modulator** (Ring Mod), **Barber-pole Up** (Barber-pole), and **Barber-pole Down** (Barber-pole). Changing an individual parameter switches Style to **Custom**.
- **Mode** — selects Shift, Ring Mod, or Barber-pole processing.
- **Shift** (-5,000–5,000 Hz) — fixed signed translation in Shift mode; positive moves components upward and negative moves them downward.
- **Carrier Frequency** (0.1–10,000 Hz) — multiplication frequency in Ring Mod mode.
- **Minimum Shift / Maximum Shift** (0–5,000 Hz) — barber sweep limits. EffeTune sorts reversed values; equal values make the barber shift stationary.
- **Rate** (0.01–2 Hz) and **Direction** (Up/Down) — control barber sweep speed and direction.
- **Stereo Phase** (0–180°) — offsets the carrier or sweep between the left and right channels of each stereo pair in all modes.
- **Mix** (0–100%) — blends matched-delay dry and shifted sound; 0% is dry in level but still carries the documented fixed latency.

If a large shift sounds rough or metallic in an unwanted way, reduce Shift or Mix.

## Phaser

Phaser mixes the original sound with filtered copies to create moving peaks and notches. **Classic** sweeps back and forth, while **Barber-pole** suggests continuous upward or downward movement.

### Sound Enhancement Guide

- Start with **Classic Phaser**, 4–6 **Stages**, moderate **Range**, and **Mix** near 50% for clear notches without excessive resonance.
- Raise **Stages** and **Feedback** for a deeper pattern; reduce them if transients become too colored.
- Use **Stereo Phase** for width while remembering that each adjacent stereo pair repeats the same relation.
- Choose **Barber-pole Up/Down** for continuous motion rather than an ordinary returning sweep.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Classic Phaser** (Classic), **Deep Phaser** (Classic), **Stereo Phaser** (Classic), **Barber-pole Up** (Barber-pole), and **Barber-pole Down** (Barber-pole). Changing an individual parameter switches Style to **Custom**.
- **Mode** — selects Classic or Barber-pole.
- **Rate** (0.05–10 Hz) — sets sweep speed.
- **Center Frequency** (80–8,000 Hz) — sets the geometric center of the sweep.
- **Range** (0–6 octaves) — sets sweep span in logarithmic frequency.
- **Stages** (2–12, even) — sets the number of all-pass sections; more stages create more notches.
- **Feedback** (-90–90%) — returns phased output to the input; magnitude sharpens the pattern and sign changes emphasis.
- **Stereo Phase** (0–180°) — offsets motion within each stereo pair.
- **Direction** (Up/Down) — controls Barber-pole direction and is ignored in Classic mode.
- **Mix** (0–100%) — linearly blends dry and phased sound; the middle region normally produces the deepest cancellation.

Changing Mode, Stages, or Direction may briefly emphasize the original sound to keep the transition smooth.

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

## Pitch Shifter HQ

A higher-quality pitch shifter for careful listening when reduced phase smearing is worth extra CPU use and about 107-116ms of delay. It changes pitch without changing playback speed and keeps spectral components more firmly grouped than the standard Pitch Shifter. If this effect is unavailable on your device, the audio passes through unchanged.

Pitch Shifter HQ does not preserve formants. Larger shifts therefore change the apparent character of voices and instruments as well as their pitch.

### Listening Experience Guide

- For a subtle change, start with **Pitch Shift** at -1 or +1 and leave **Fine Tune** at 0.
- Use **Fine Tune** to match music that is slightly sharp or flat without moving by a full semitone.
- Choose Pitch Shifter HQ instead of the standard Pitch Shifter when fewer phase artifacts are worth the extra CPU use and delay. Use the standard version for latency-sensitive listening or lower-powered devices.
- Compare larger shifts carefully: the pitch remains stable, but the lack of formant preservation makes the tonal character change more obvious.

### Parameters

- **Pitch Shift** - Changes the overall pitch in semitones (-6 to +6)
  - Negative values lower the pitch; positive values raise it
  - Zero leaves the pitch unchanged
- **Fine Tune** - Adjusts pitch in cents (-50 to +50)
  - Use it for precise adjustment between semitones
  - 100 cents equals one semitone

## Rotary Speaker

Rotary Speaker splits the sound between a high-frequency horn and low-frequency drum, then gives them different rotation rates. Level movement and a short Doppler delay create the characteristic dual-rotor motion.

### Sound Enhancement Guide

- Select **Slow** for broad, relaxed movement and **Fast** for a more urgent rotary texture.
- Set **Acceleration** long enough to hear the rotors gather speed naturally when changing Speed State.
- Increase **Doppler Depth** for stronger pitch motion or **Amplitude Depth** for stronger level motion; moderate both for ordinary listening.
- Use **Rotor Balance** to favor the drum or horn, and reduce **Stereo Width** when headphones make the movement too broad.

### Parameters

- **Style** — loads a complete factory setting for every parameter. Choices are **Rotary Slow** (Slow), **Rotary Fast** (Fast), **Gentle Rotary** (Slow), **Leslie Slow** (Slow), and **Leslie Fast** (Fast). Changing an individual parameter switches Style to **Custom**.
- **Speed State** — **Stop**, **Slow**, or **Fast** target. During a change, the rotors accelerate or slow down smoothly without interrupting the sound.
- **Speed** (25–200%) — scales both internal rotor rates while preserving their difference.
- **Acceleration** (0.1–10 s) — sets how quickly the rotors approach a new speed.
- **Crossover** (200–2,000 Hz) — divides drum and horn bands.
- **Rotor Balance** (-100–100%) — favors the drum at negative values and horn at positive values.
- **Stereo Width** (0–100%) — sets paired-channel spatial separation.
- **Doppler Depth** (0–100%) — sets moving-delay pitch motion.
- **Amplitude Depth** (0–100%) — sets level modulation from virtual rotor orientation.
- **Mix** (0–100%) — blends dry and rotary sound; 0% is transparent dry.

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
- **Rate** - How fast the volume changes (0.1 to 50 Hz)
  - Slower (0.1-2 Hz): Gentle, subtle pulsing
  - Medium (2-6 Hz): Classic tremolo effect
  - Faster (6-20 Hz): Dramatic, choppy effects
  - Very fast (20-50 Hz): Extremely rapid volume modulation that can add a rough or buzzy texture; use sparingly for comfortable listening
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
- **Depth** - How strongly the delay time is modulated, which makes the pitch waver (0 to 40 ms)
  - Subtle (0-6 ms): Gentle vintage character
  - Medium (6-15 ms): Clearly audible tape/vinyl feel
  - Strong (15-40 ms): Dramatic special effects
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
   - Rate: 0.3-0.8 Hz (slow, gentle movement)
   - Depth: 2-6 ms
   - Randomness: 1-4 ms
   - Randomness Cutoff: 0.5-3 Hz
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Perfect for: Jazz, Classical, Vintage Rock

2. Retro Cassette Feel
   - Rate: 4-6 Hz (faster flutter)
   - Depth: 1-3 ms
   - Randomness: 1-5 ms
   - Randomness Cutoff: 3-8 Hz
   - Ch Phase: 0-30°
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
   - Rate: 1-2 Hz
   - Depth: 2-5 ms
   - Randomness: 1-3 ms
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Perfect for: Any music needing gentle vintage character

### Quick Start Guide

1. For a Natural Vintage Sound:
   - Start with slow Rate (0.5-1 Hz)
   - Add light Depth (2-6 ms)
   - Include a little Randomness (1-4 ms)
   - Use Randomness Cutoff around 0.5-3 Hz
   - Keep Ch Phase at 0° and Ch Sync at 100%
   - Adjust to taste

2. For More Character:
   - Increase Depth gradually
   - Add more Randomness
   - Experiment with different Ch Phase settings
   - Reduce Ch Sync for more stereo variation
   - Trust your ears

Remember: The goal is to add pleasant vintage character to your music. Start subtle and adjust until you find the sweet spot that enhances your listening experience!
