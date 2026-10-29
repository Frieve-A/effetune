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

The desktop Player also displays [network music and AirPlay](openhome.md). During AirPlay, track details, artwork, and time appear when supplied by the sender; hover over the title for more information. Control playback and volume on the sending device. Closing the Player with **×**, or using **Stop**, ends that AirPlay session while leaving the enabled receiver available for another connection.

Use the volume slider and mute button to adjust the Player’s sound before it enters the effect chain. Changes made by a remote controller also appear here, so you can check the current level and turn mute off locally.

When the built-in Player starts or resumes playback, including track changes and remote commands, the mute button briefly blinks if muted, and the volume slider and value blink if the volume is zero.

## Gapless Playback

**Gapless Playback** in **Audio Configuration** is on by default and plays compatible local tracks without a gap; support is limited by the file format and the browser or app environment. Unsupported formats and some mobile environments use a memory-safe fallback, so a short gap may remain. Turning it off prioritizes lower memory use and stability, at the cost of a possible short gap; the change does not interrupt the current track. Gapless playback works only at 1x speed; changing speed during gapless playback restarts the track from the same position with a brief interruption.

## Video

Video appears in the player's artwork area. In the desktop layout, starting a video automatically expands the player panel. You can collapse it again for the current playback. Move the pointer over the video or tap it to show the expand button; it hides after a short period of inactivity. Select **⛶** to fill the app display; move the pointer over the video or tap it to show the playback controls along the bottom. You can also add a **Video** item in Visualizer. To include video files in Music Library, see the [Music Library guide](music-library.md#availability).

In the mobile layout, expanded video and its controls rotate together when this makes the video fit the screen better. **Rotate expanded video on mobile** in **Settings > Config... > Display** is on by default; turn it off to keep the display unrotated. Returning to the small player restores the normal display. Desktop layout and the device’s orientation settings are unchanged.

Use these gestures on the video or its surrounding black borders, outside Mini Player:

- **Mouse:** Click to play or pause. Double-click to expand or restore the video without changing whether it is playing or paused.
- **Touch:** Tap to show the controls. While expanded, double-tap the left half to go back 10 seconds or the right half to go forward 10 seconds. Double-tapping the small preview does not seek.

Buttons and sliders keep their usual behavior.

## Playback on another device

Choose an EffeTune, OpenHome, or UPnP AV / DLNA player in the device selector. Playback controls follow the selected player's capabilities, including **Volume** and **Mute** when supported. These controls change that player, not the computer's system volume or effect gain. Selecting another player does not stop the previous one or move its queue.

Music sent to another player does not include this device's effects. An EffeTune destination applies its own effects. For connections, sources, and the computer that must stay running for a UPnP AV / DLNA sequence, see [network music and remote control](openhome.md#choose-a-library-and-a-player).

[← Back to README](../README.md)
