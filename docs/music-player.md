---
title: "Music Player - EffeTune"
description: "Play music and video files through your EffeTune effect chain, change playback speed, use the Mini Player, and set up gapless playback."
lang: en
---

# Music Player

Open a music file in EffeTune to listen through the current effect chain. Use the player controls to pause, resume, or adjust playback speed.

## Opening Music Files

- Click **Open music files** (the folder button in the header), or drag music files into the window.
- **Desktop app:** Choose **File > Open music file...**, or open a music file with EffeTune from your OS.
- **Mobile layout:** Tap **Open Music**.

For player-only use, set **Input Device:** to **None (music file player only)** in **Audio Configuration** so EffeTune does not use a live audio input.

## Playback Controls

- Pausing, resuming, or closing the player with **×** uses a short fade to avoid clicks.
- Click the playback speed button next to **Shuffle** to choose one of nine presets or set any speed from `0.25x` to `4x` in `0.01x` steps. **Preserve Pitch** is on by default so pitch stays constant as speed changes; turn it off to let pitch rise and fall with speed like a tape or record.
- In the desktop app, choose **View > Mini Player** (`Ctrl/Cmd+Shift+M`) or click the player's mini-player button to switch to a compact window. Click the pin button to keep it always on top.

## Gapless Playback

**Gapless Playback** in **Audio Configuration** is on by default and plays compatible local tracks without a gap; support is limited by the file format and the browser or app environment. Unsupported formats and some mobile environments use a memory-safe fallback, so a short gap may remain. Turning it off prioritizes lower memory use and stability, at the cost of a possible short gap; the change does not interrupt the current track. Gapless playback works only at 1x speed; changing speed during gapless playback restarts the track from the same position with a brief interruption.

## Video

Video appears in the player's artwork area. Select **⛶** to fill the app display; move the pointer over the video or tap it to show the playback controls along the bottom. You can also add a **Video** item in Visualizer. To include video files in Music Library, see the [Music Library guide](music-library.md#availability).

[← Back to README](../README.md)
