---
title: Mastering Presets
description: Genre-based effect chains for processing finished stereo mixes.
lang: en
---

# Mastering Presets

**System Presets > Mastering** provides ten effect chains for finished stereo mixes (2mix). Each chain automatically adjusts tonal balance, compresses dynamics, and limits peaks while audio plays or a file is processed. They are starting points for different styles, not automatic matching to a specified LUFS loudness.

## Choose a preset

| Preset | Intended result |
| --- | --- |
| Acoustic | Gentle tonal correction and compression for acoustic instruments and vocals. |
| Classical | Light tonal correction and peak control, retaining large differences between quiet and loud passages. |
| EDM | Firm bass control, slight transient shaping, and strong limiting for electronic dance mixes. |
| Hip-Hop | Controlled bass with extra emphasis on kick attacks and light saturation. |
| J-Pop Dense | Deliberately very compressed sound: strong five-band compression, reduced attacks, saturation, and heavy limiting. |
| Jazz | Light compression and peak control for acoustic jazz. |
| Metal | Firm compression and dynamic upper-mid/treble cuts for dense guitars and cymbals. |
| Pop | Moderate compression with dynamic control of prominent upper mids and treble. |
| R&B and Soul | Gentle saturation and slower compression for vocal-led mixes. |
| Rock | Compression with slight attack emphasis and dynamic control of guitar presence. |

## Process a finished mix

1. Start with a stereo mix without clipping. As a starting point, use a mix whose loudest peaks are around -6 to -3 dBFS. These presets do not first normalize the input; quieter mixes receive less compression, and louder mixes receive more.
2. Clear the current Effect Pipeline, then add one preset from **System Presets > Mastering**. System presets insert effects into the pipeline, so adding several stacks their processing.
3. Preview the loudest passage and a quieter passage. The first **Volume** effect is the input trim: raise it for more compression, or lower it if the whole chain sounds too compressed. Compare at a similar listening volume.
4. Choose WAV or FLAC and the output sample rate and quality under **Settings > Config > Offline file output**. Drop the original mix into the file-processing area below Effect Pipeline to save a processed copy.

Tonal Balance EQ uses a 10-second averaging time and adapts as the music progresses; it does not analyze the whole file in advance. The beginning and later passages can therefore receive different corrections. Acoustic and Jazz use the broad **All** target, while Hip-Hop uses **Electronic** and R&B and Soul use **Pop**. Reduce **Amount** or **Range** if the tonal correction changes the mix too much.

Every chain ends with **Brickwall Limiter**, set to 4× oversampling, 5 ms lookahead, and a -1 dB margin with a 0 dB threshold. Its **Input Gain** determines how strongly the final peaks are limited. Lower it if drums lose impact or loud passages distort. Leave the limiter last, and check the exported file if you need a particular loudness or true-peak specification; these presets do not guarantee either.

**J-Pop Dense** intentionally sacrifices transient detail and dynamic range for density. It uses 5:1 compression in all five bands, 10 dB of band makeup gain, and 14 dB of limiter input gain. Start with **Pop** when you want more dynamics. Avoid applying Dense to a mix that has already been heavily limited unless further compression is your intention.

See [EQ effects](plugins/eq.md), [dynamics effects](plugins/dynamics.md), and [saturation effects](plugins/saturation.md) for the individual controls.
