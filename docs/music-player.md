---
title: "Music Player - EffeTune"
description: "Play music and video files through your EffeTune effect chain, change playback speed, use the Mini Player, and set up gapless playback and ReplayGain."
lang: en
---

# Music Player

Open a music file in EffeTune to listen through the current effect chain. Use the player controls to pause, resume, or adjust playback speed.

## Opening Music Files

- Click **Open music files** (the folder button in the header), or drag music files into the window.
- **Desktop app:** Choose **File > Open music file...**, or open a music file with EffeTune from your OS.
- **Mobile layout:** Tap **Open Music**.

For player-only use, set **Input Device:** to **None (music file player only)** in **Audio Configuration** so EffeTune does not use a live audio input.

## DSD files {#dsd-files}

Open `.dsf` (DSF) or `.dff` (DSDIFF) files like other music files. Both uncompressed and DST-compressed DFF are supported. EffeTune converts DSD64, DSD128, and DSD256 with up to six channels (5.1) to PCM for playback through the current effects. The audio device receives PCM, not native DSD or DoP.

Multichannel DSD reaches the effects in file channel order. If that order differs from your speaker outputs, place [**Matrix**](plugins/basics.md#matrix) first in the effect chain. For a five-channel DSF on a standard 5.1 output, route inputs 1–3 to their matching outputs and send inputs 4 and 5 only to outputs 5 and 6 respectively. This leaves output 4 (LFE) silent.

Some DST encoding variants (segmented frames), files with more than six channels, DSD512, and 48 kHz-based DSD are not supported. If a file cannot be played, use an uncompressed DFF or a compatible PCM copy such as FLAC or WAV.

High-rate DSD, especially at faster playback speeds, needs more processing power. If playback stutters or stops, lower the playback speed.

## MIDI files

Open `.mid`, `.midi`, or `.kar` files with the usual music file picker or drag and drop. MIDI contains notes and timing rather than recorded sound. Add [**SoundFont Player**](plugins/others.md#soundfont-player) from **Others** to the Effect Pipeline, then select an instrument with **SoundFont Library…**. Opening a MIDI file does not add an instrument automatically. MIDI files can also be added to the Music Library.
To show lyrics in **Lyrics** in Visualizer, use lyrics embedded in the MIDI file or place a same-name `.wrd` file beside it. On the web, select or drop both files together unless the folder is accessible through Music Library. A `.wrd` file is an accompaniment, not a separate track; if it cannot be read, MIDI playback continues.

For MIDI and MusicXML cover artwork, place `cover.jpg` (preferred) or `folder.jpg` in the same folder. On the web, select or drop the image with the music file unless the folder is accessible through Music Library.

Use **Open music files** or drag and drop a ZIP, LZH/LHA, tar, gzip, or gzip-compressed tar archive to play the MIDI, KAR, and MusicXML files inside it. This works with the Music Library settings off. When the selection contains two or more playable files inside archives, choose which ones to open. If the files are too large to open together, choose fewer. The player uses matching `.wrd` lyrics and cover artwork in the track’s folder inside the archive.

When you start a song while its selected instrument is still loading, playback waits so you hear the opening notes. If another instrument or a connected MIDI output can already play, the song starts immediately.

If SoundFont Player is missing or no instrument is selected, and no [external MIDI output device](#midi-output-device) is connected, the player shows guidance and continues sending MIDI in time, silently, without skipping to the next song. The song still ends normally. You can add SoundFont Player or load an instrument during playback: once ready, it responds to subsequent MIDI events, using the song's current channel sounds and controller settings. Earlier notes are not replayed, even if the song still holds them.

Use the usual play, pause, seek, repeat, shuffle, speed, volume, and mute controls. Speed changes MIDI timing without changing note pitches; **Preserve Pitch** is unavailable for MIDI. With an SF2/SF3 collection, one SoundFont Player follows Bank Select and Program Change independently on all 16 channels, with channel 10 using the drum bank by default. Use **MIDI Mixer** to adjust a channel’s **Patch**, level, or other performance controls. These changes are temporary, follow subsequent MIDI messages, and reset for the next song. SFZ instruments keep their own sound mappings.

To save a MIDI song as audio, select it in offline file processing with SoundFont Player and an instrument prepared. Rendering uses the whole song, the selected instrument, and following effects, with speed 1 and unity song gain, and saves WAV or FLAC using your output settings. If a maximum tail limit is reached, the app tells you; the remaining tail is cut off.

Standard MIDI File formats 0 and 1 are supported. Convert format 2 or RMID to a standard format 0 or 1 `.mid` file before opening it.

### Playing through an external MIDI device {#midi-output-device}

To play MIDI files on a hardware sound module or synthesizer, or on a software synthesizer through a virtual MIDI port, select it as **MIDI Output Device** in **Audio Configuration**. It is below **MIDI Input Device**, and **Refresh MIDI Devices** updates both lists. The default is **None**. In the web version, allow MIDI access when the browser asks, including system-exclusive messages.

While the device is connected, MIDI and MusicXML playback sends the file's MIDI messages, including system-exclusive messages, to it in time, following seek, pause, stop, and speed changes. Lyrics and other text in the file are not sent. EffeTune then works as a plain MIDI player, and SoundFont Player is optional; if it has an instrument, both sound at the same time. The external device's sound does not pass through EffeTune's effects, and the Player's volume slider and mute button do not affect it, so use the device's own volume control. Saving as audio, described above, still uses SoundFont Player only.

## MusicXML files {#musicxml-files}

Open `.musicxml`, `.xml`, or compressed `.mxl` files like MIDI files. Add **SoundFont Player** and load an instrument to hear them, or use an [external MIDI output device](#midi-output-device). MusicXML playback uses the MIDI controls described above; it does not display sheet music. Music Library can also index these files.
MusicXML lyrics can appear in Visualizer’s **Lyrics** item during playback. Select a **Part** and **Verse** there when a score has more than one, or keep **Automatic**.

Notes, rests, chords, voices, ties, tempo changes, and standard repeats with alternate endings are supported. Some notation details, such as ornaments and grace notes, are not reproduced. For scores with nested repeats, measure-repeat symbols, microtonal notes, or D.C., D.S., Coda, or Fine, and for opus collections with multiple scores, export a standard MIDI file from a notation app and open that instead.

## Playback Controls

- Pausing, resuming, or closing the player with **×** uses a short fade to avoid clicks.
- Click the playback speed button next to **Shuffle** to choose one of nine presets or set any speed from `0.25x` to `4x` in `0.01x` steps. **Preserve Pitch** is on by default so pitch stays constant as speed changes; turn it off to let pitch rise and fall with speed like a tape or record.
- In the desktop app, choose **View > Mini Player** (`Ctrl/Cmd+Shift+M`) or click the player's mini-player button to switch to a compact window. Click the pin button to keep it always on top.

The Player also displays [network music](openhome.md) and, in the desktop app, AirPlay. During AirPlay, track details, artwork, and time appear when supplied by the sender; hover over the title for more information. Control playback and volume on the sending device. Closing the Player with **×**, or using **Stop**, ends that AirPlay session while leaving the enabled receiver available for another connection.

Use the volume slider and mute button to adjust the Player’s sound before it enters the effect chain. Changes made by a remote controller also appear here, so you can check the current level and turn mute off locally.

When the built-in Player starts or resumes playback, including track changes and remote commands, the mute button briefly blinks if muted, and the volume slider and value blink if the volume is zero.

## Resuming Where You Left Off

When you reopen EffeTune, the Player restores your queue and pauses at the last saved position in the current track. In the desktop and web apps, playback speed starts at 1x. The position is saved about every 10 seconds during playback, so recent changes just before you quit may be lost.

Library tracks are restored in all versions, along with local files opened in the desktop app. The Android app also restores opened files it can still read; it skips Subsonic tracks and files it can no longer open, and tells you how many were skipped. On the web, your browser may ask you to select your music folder again when you press Play. Add any files opened directly on the web and any network tracks again.

To restore tracks from an archive, play them from the library. If you opened the archive directly, reopen it.

To discard the saved queue, close the Player with **×**. If a receiver or remote control feature keeps the Player open, turn that feature off first, then close the visible Player with **×**.

## Gapless Playback

**Gapless Playback** in **Audio Configuration** is on by default and plays compatible local tracks without a gap; support is limited by the file format and the browser or app environment. Unsupported formats and some mobile environments use a memory-safe fallback, so a short gap may remain. Turning it off prioritizes lower memory use and stability, at the cost of a possible short gap; the change does not interrupt the current track. In the desktop and web apps, gapless playback works only at 1x speed; changing speed during gapless playback restarts the track from the same position with a brief interruption.

Multichannel WAV and FLAC files with up to six channels play gaplessly in the desktop app when **Driver** in **Audio Configuration** is set to anything other than **Standard**, and in the Android app. Their channels reach the effects in file channel order. If that order differs from your speaker outputs, place [**Matrix**](plugins/basics.md#matrix) first in the effect chain, as with [multichannel DSD](#dsd-files).

## ReplayGain

In **Audio Configuration**, use **ReplayGain** to even out volume differences between recordings. The player uses [Music Library measurements](music-library.md#loudness-analysis) first, then embedded ReplayGain tags, including `R128_TRACK_GAIN` and `R128_ALBUM_GAIN` in Opus files. Songs with neither play at their original level.

- **Off** (default) plays each song at its original level.
- **Track**: Brings every song to a similar level. Use this for shuffle and playlists that mix albums.
- **Album**: Adjusts each album as a whole, keeping the level differences between its songs, such as a quiet intro. Use this when listening to albums from start to finish.

If only one track or album value is available, the player uses it in either mode. Each measured CUE track has its own value. Otherwise, CUE tracks share the tags in their audio file.

With **Target** set to **Manual** (default), the target is −18 LUFS. **ReplayGain Preamp** (−15 to +15 dB, default 0 dB) raises or lowers that target. Choose **Auto** to see the highest target that **Auto Coverage (%)** of measured tracks or albums can reach within the **Peak Ceiling (dB)**. The default coverage is 95%. Increase it for more tracks to reach the target, or reduce it for a potentially louder target. Until the first measurements are available, Auto uses −18 LUFS.

**Prevent Clipping** (on by default) reduces gain when the measured true peak or tagged peak would exceed **Peak Ceiling (dB)**. Lower the ceiling from its default of 0 dB to leave room for effects that boost the signal. Auto also uses the ceiling to choose its target when **Prevent Clipping** is off. Changes take effect during playback.

The adjustment is applied to the Player's sound before it enters the effect chain; the volume slider position does not change. ReplayGain does not apply to MIDI or MusicXML playback, network music, AirPlay reception, playback on OpenHome or UPnP AV / DLNA players, or offline file processing.

## Video

Video appears in the player's artwork area. In the desktop layout, starting a video automatically expands the player panel. You can collapse it again for the current playback. Move the pointer over the video or tap it to show the expand button; it hides after a short period of inactivity. Select **⛶** to fill the app display; move the pointer over the video or tap it to show the playback controls along the bottom. You can also add a **Video** item in Visualizer. To include video files in Music Library, see the [Music Library guide](music-library.md#availability).

In the mobile layout, expanded video and its controls rotate together when this makes the video fit the screen better. **Rotate expanded video on mobile** in **Settings > Config... > Display** is on by default; turn it off to keep the display unrotated. Returning to the small player restores the normal display. Desktop layout and the device’s orientation settings are unchanged.

Use these gestures on the video or its surrounding black borders, outside Mini Player:

- **Mouse:** Click to play or pause. Double-click to expand or restore the video without changing whether it is playing or paused.
- **Touch:** Tap to show the controls. While expanded, double-tap the left half to go back 10 seconds or the right half to go forward 10 seconds. Double-tapping the small preview does not seek.

Buttons and sliders keep their usual behavior.

## Playback on another device

Choose an EffeTune, OpenHome, or UPnP AV / DLNA player in the device selector. Playback controls follow the selected player's capabilities, including **Volume** and **Mute** when supported. These controls change that player, not this device's system volume or effect gain. Selecting another player does not stop the previous one or move its queue.

Music sent to another player does not include this device's effects. An EffeTune destination applies its own effects. For connections, sources, and the device that must stay running for a UPnP AV / DLNA sequence, see [network music and remote control](openhome.md#choose-a-library-and-a-player).

[← Back to README](../README.md)
