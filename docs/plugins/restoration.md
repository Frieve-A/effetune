---
title: "Restoration Plugins - EffeTune"
description: "Restoration effect plugins for clicks, clipped peaks, electrical hum, and steady background noise."
lang: en
---

# Restoration Plugins

Restoration plugins reduce unwanted problems in a recording while keeping the music enjoyable to listen to.

## Plugin List

- [Click Remover](#click-remover) - Repairs short clicks, crackles, pops, and dropouts
- [Clip Restorer](#clip-restorer) - Restores peaks flattened by hard clipping
- [Hum Remover](#hum-remover) - Removes steady electrical hum and its harmonics
- [Noise Reduction](#noise-reduction) - Turns down steady background hiss and hum while keeping the music intact

## Click Remover

Click Remover repairs short, isolated faults such as record crackle, pops, brief clicks, and tiny dropouts. Use it for occasional interruptions rather than for a constant hiss or hum.

### Listening Guide

1. Start with **Sensitivity** at 50% and **Max Repair Length** at 1 ms.
2. Raise **Sensitivity** gradually until the unwanted clicks become less noticeable. If drum hits or other sharp musical details become softer, lower it again.
3. Increase **Max Repair Length** only when the faults last longer than a brief click. Keep it short for ordinary crackle.
4. While the affected passage plays, use **REPAIRS/S** to confirm that the effect is finding faults; compare with the effect bypassed before keeping a stronger setting.

### Parameters

- **Sensitivity** (0–100%, default 50%) controls how readily the effect treats a short change as a fault. Higher values repair more suspected clicks; lower values are more conservative and better preserve sharp musical attacks.
- **Max Repair Length** (0.1–2 ms, default 1 ms) limits the duration of each repair. Raise it for slightly longer pops or dropouts; lower it when repairing ordinary short crackle.

### Reading the Display

**REPAIRS/S** shows the recent number of click repairs per second. A value near zero means no short faults are currently being repaired. A steady high value on normal music is a reason to lower **Sensitivity** or **Max Repair Length**.

## Clip Restorer

Clip Restorer reconstructs peaks that were flattened by hard digital clipping. It is useful for recordings with obvious flat-topped distortion; it cannot recover every detail that was lost before the recording reached EffeTune.

### Listening Guide

1. Start with **Threshold** at -0.10 dB and **Output Gain** at -3 dB.
2. If clearly clipped peaks remain, lower **Threshold** a little to include less extreme clipping. If loud, sustained sounds are changed unnecessarily, raise it toward 0 dB.
3. Keep **Output Gain** below 0 dB when possible. Restored peaks can be higher than the original flat peaks, so the default leaves useful headroom.
4. Use **RESTORED** while a damaged section plays, then compare with the effect bypassed to choose the least intrusive setting.

### Parameters

- **Threshold** (-18–0 dB, default -0.10 dB) sets the level treated as a clipped peak. A value closer to 0 dB targets only nearly full-scale flat peaks. Lowering it includes less obvious clipping, but can affect more loud material.
- **Output Gain** (-12–0 dB, default -3 dB) sets the output level after restoration. Raise it toward 0 dB for a louder result; lower it for more headroom if restored peaks are too high.

### Reading the Display

**RESTORED** shows the recent percentage of audio samples repaired as clipped peaks. A small value can be normal because clipping often occurs only at brief peaks. If it remains high on material that does not sound clipped, raise **Threshold**.

## Hum Remover

Hum Remover reduces a steady electrical mains hum and its harmonics, such as a 50 Hz or 60 Hz buzz from a turntable, cable, or power-related fault. It is for a constant tone, not general background noise.

### Listening Guide

1. Start with **Frequency** set to **Auto**, **Harmonics** at 8, and **Tracking Speed** at 50%.
2. If you know the mains frequency in the recording, choose **50 Hz** or **60 Hz**. Otherwise, leave **Auto** selected and check the displayed **FUNDAMENTAL**.
3. Raise **Harmonics** when audible buzz remains above the fundamental; lower it if the music loses too much body or detail.
4. Raise **Tracking Speed** when a hum slowly drifts in pitch; lower it for a stable hum if you want gentler tracking.
5. If sustained bass or another musical tone exactly matches a hum harmonic, lower **Harmonics** to leave that frequency less affected.

### Parameters

- **Frequency** (**Auto**, **50 Hz**, or **60 Hz**; default **Auto**) selects the hum fundamental. **Auto** follows a detected mains-like hum; choose a fixed value when the hum is known to be 50 Hz or 60 Hz.
- **Harmonics** (1–64, default 8) chooses how many multiples of the fundamental are removed. Higher values can clear more buzz, while lower values preserve more musical content near higher harmonics. The slider uses a logarithmic scale to give lower settings more adjustment space.
- **Tracking Speed** (0–100%, default 50%) controls how quickly automatic tracking follows a changing hum. Higher values follow drift more quickly; lower values change more slowly and suit a stable hum.

### Reading the Display

**FUNDAMENTAL** shows the frequency currently targeted by the effect. **REMOVED** shows the level of the hum component being removed in dBFS: a value closer to 0 dBFS means a stronger removed hum, while a very low value (such as -140 dBFS) means little or no hum is currently being removed.

## Noise Reduction

Noise Reduction lowers steady background noise such as tape hiss, equipment noise, and room noise. Use it when a recording has a constant layer of noise behind the music. It is most effective on noise that remains present between notes; it is not intended to remove individual clicks, changing background sounds, or other music in the recording.

### Listening Guide

1. Start with the default settings: **Reduction** 12 dB, **Sensitivity** 0 dB, **Smoothing** 50%, **Treble Care** 50%, and **Mix** 100%.
2. Raise **Reduction** slowly until the quiet parts become cleaner. If voices, cymbals, or room ambience begin to sound less natural, lower it again.
3. For obvious continuous hiss, raise **Sensitivity** a little. For a more natural result on already-clean music, lower it.
4. If the noise reduction seems to flutter or change color, raise **Smoothing**. If the music becomes too softened, lower **Smoothing** or **Reduction**.
5. Compare with the effect bypassed, and use **Mix** to keep some of the original sound when that sounds more natural.

### Parameters

- **Reduction** (0–24 dB, default 12 dB) sets the greatest amount of background-noise reduction.
  - Lower values make a gentle, less noticeable change.
  - Higher values make steady noise quieter, but can also make faint musical detail less clear.
  - Start around 6–12 dB for lightly noisy recordings and increase only when needed.

- **Sensitivity** (-12–+12 dB, default 0 dB) controls how readily the effect treats sound as background noise.
  - Raise it when steady noise remains too audible after setting **Reduction**.
  - Lower it when soft instruments, reverb tails, or ambience are reduced too much.
  - Small adjustments are usually enough.

- **Smoothing** (0–100%, default 50%) makes the amount of reduction change more evenly across nearby frequencies.
  - Higher values help keep the result smoother and reduce a fluttering or watery character.
  - Lower values let the effect react more selectively to the noise.
  - If higher smoothing dulls the music, reduce it a little and use less **Reduction** instead.

- **Treble Care** (0–100%, default 50%) protects high-frequency musical detail from strong reduction.
  - Raise it to retain more sparkle in cymbals, strings, and air around voices.
  - Lower it only when high-frequency hiss remains distracting.
  - A middle setting is a good balance for most music.

- **Mix** (0–100%, default 100%) balances the reduced-noise sound with the original sound.
  - At 100%, you hear only the processed result.
  - Lower it when a small amount of the original ambience makes the recording sound more natural.
  - At 0%, the sound is unchanged, which is useful for comparison.

### Recommended Settings

1. **Gentle cleanup for a lightly noisy recording**
   - Reduction: 6–10 dB
   - Sensitivity: -2 to 0 dB
   - Smoothing: 40–60%
   - Treble Care: 50–70%

2. **Clear tape or equipment hiss**
   - Reduction: 12–18 dB
   - Sensitivity: 0 to +4 dB
   - Smoothing: 60–80%
   - Treble Care: 50–70%

3. **Preserve delicate high frequencies**
   - Reduction: 6–12 dB
   - Sensitivity: -4 to 0 dB
   - Smoothing: 50–70%
   - Treble Care: 70–100%
   - Mix: 70–100%
