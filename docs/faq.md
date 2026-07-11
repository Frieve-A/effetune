---
title: "FAQ & Troubleshooting - EffeTune"
description: "Frequently asked questions and troubleshooting guide for Frieve EffeTune audio processor."
lang: en
---

# EffeTune FAQ

EffeTune is a real-time DSP application for audio enthusiasts available as both a web app and a desktop app. This document covers setup, troubleshooting, multichannel usage, effect operation, and frequency correction.

## Contents
1. Initial Setup for Streaming
   1. Installing VB-CABLE and using 96 kHz
   2. Streaming service input (Spotify example)
   3. EffeTune audio settings
   4. Operation check
2. Troubleshooting
   1. Audio playback quality
   2. CPU usage
   3. Echo
   4. Input, output, or effect issues
   5. Multichannel output mismatch
3. Multichannel & Hardware Connections
   1. HDMI + AV receiver
   2. Interfaces without multichannel drivers
   3. Channel delay & time alignment
   4. 8ch limit and expansion
4. Frequently Asked Questions
5. Frequency Response & Room Correction
6. Effect Operation Tips
7. Reference Links

---

## 1. Initial Setup for Streaming

Windows example: Spotify → VB-CABLE → EffeTune → DAC/AMP. Concepts are similar for other services and OSes.

### 1.1. Installing VB-CABLE and enabling 96 kHz
Download the VB-CABLE Driver Pack45, run `VBCABLE_Setup_x64.exe` as administrator, and reboot. Return the OS default output to your speakers/DAC and set both **CABLE Input** and **CABLE Output** formats to 24‑bit, 96,000 Hz. Launch `VBCABLE_ControlPanel.exe` as administrator, choose **Menu▸Internal Sample Rate = 96000 Hz**, then click **Restart Audio Engine**.

### 1.2. Streaming service routing (Spotify example)
Open **Settings▸System▸Sound▸Volume mixer**, and set `Spotify.exe` output to **CABLE Input**. Play a track to confirm silence from the speakers.
On macOS, use Rogue Amoeba's **SoundSource** to assign Spotify output to **CABLE Input** in the same manner.

### 1.3. EffeTune audio settings
Open EffeTune and choose **Audio Configuration** from the Settings menu.
- **Input Device:** CABLE Output (VB-Audio Virtual Cable)
- **Output Device:** Physical DAC/Speakers
- **Sample Rate:** 96,000 Hz (lower rates may degrade quality)

### 1.4. Operation check
With Spotify playing, toggle the master **ON/OFF** in EffeTune and confirm the sound changes.

---

## 2. Troubleshooting

### 2.1. Audio playback quality issues

| Symptom | Solution |
| ------ | ------ |
| Dropouts or glitches | Choose **Reset Audio** from the Settings menu or mobile overflow menu. In the desktop app, you can also choose **Reload** from the **View** menu. Reduce the number of active effects if necessary. |
| Distortion or clipping | Insert **Level Meter** at the end of the chain and keep levels below 0 dBFS. Add **Brickwall Limiter** before Level Meter if needed. |
| Aliasing above 20 kHz | VB-CABLE may still run at 48 kHz. Recheck the initial setup. |

### 2.2. High CPU usage
Disable effects you're not using or remove them from the **Effect Pipeline**.

### 2.3. Echo
Your input and output devices may be looping back. Ensure EffeTune's output does not return to its input.

### 2.4. Input, output, or effect problems

| Symptom | Solution |
| ------ | ------ |
| No audio input | Make sure the player outputs to **CABLE Input**. Allow microphone permission in the browser and select **CABLE Output** in **Audio Configuration**. |
| Effect not working | Confirm the master, each effect, and any **Section** are **ON**. Reset parameters if needed. |
| No audio output | Check **Audio Configuration**. If your browser cannot select an output device, check that the OS and browser default output point to your DAC/AMP. |
| Other players report "CABLE Input in use" | Ensure no other application is using **CABLE Input**. |

### 2.5. Multichannel output mismatch
EffeTune outputs channels in order 1→2→…→8. If Windows is configured for 4 channels, the rear channels may map to center/sub. **Workaround:** set the device to 7.1ch, output 8ch from EffeTune, and use channels 5 and 6 for rear audio.

---

## 3. Multichannel & Hardware Connections

### 3.1. HDMI + AV receiver
Set your PC's HDMI output to 7.1ch and connect it to an AV receiver. EffeTune can send up to 8 channels through a single cable. Older receivers may degrade sound quality or remap channels unexpectedly.

### 3.2. Interfaces without multichannel drivers (e.g., MOTU M4)
Out 1‑2 and Out 3‑4 appear as separate devices, preventing 4‑channel output. Workarounds:
- Use **Voicemeeter** to merge channels via ASIO.
- Use **ASIO Link Pro** to expose one virtual 4‑channel device (advanced).

### 3.3. Channel delay & time alignment
Use **MultiChannel Panel** or **Time Alignment** to delay channels in 10 µs steps (minimum 1 sample). For large delays, delay front channels by 100‑400 ms. Video sync must be adjusted on the player side.

### 3.4. 8ch limit and expansion
Current OS drivers support up to 8 channels. EffeTune can support more channels when operating systems allow it.

---

## 4. Frequently Asked Questions

| Question | Answer |
| ------ | ------ |
| Which devices can use the PWA version? | EffeTune works on major mobile and desktop environments, including Android phones and tablets, iPhone/iPad, Windows, macOS, Linux, and ChromeOS. Because the PWA runs in the browser rather than as a device-specific native app, installation steps, audio input/output device selection, and supported music file formats depend on the browser and OS. |
| I can't install the PWA version | Use the **Install PWA version** button on the EffeTune site, or open the gear menu in the upper-right of the web app and choose **Install App**. If the install option does not appear, open the site in Chrome or Edge on Android or desktop. On iPhone/iPad, open it in Safari and add it to the Home Screen from the Share menu. In-app browsers, private browsing, and older browsers may not show an install option. |
| Surround input (5.1ch etc.)? | The Web Audio API limits input to 2 channels. Output and effects support up to 8 channels. |
| Recommended effect chain length? | Use as many effects as your CPU allows without causing dropouts or high latency. |
| How to get the best sound quality? | Use 96 kHz or higher, start with subtle settings, monitor headroom with **Level Meter**, and add **Brickwall Limiter** if needed. |
| Does it work with any source? | Yes. With a virtual audio device you can process streaming, local files, or physical equipment. |
| Can I use only the music file player without an audio input? | Yes. If microphone audio bleeds into your headphones or earphones after startup, open **Audio Configuration** and set **Input Device:** to **None (music file player only)**. EffeTune uses a silent source so the effect pipeline remains active for the player and signal-generating effects such as **Oscillator**. If you select an audio input instead, you can process sound from external equipment through a USB audio interface or monitor the input with **Spectrum Analyzer**. |
| Can the mobile web app process audio from other apps? | Usually no. Mobile browsers do not provide a general loopback input from other apps, so mobile use is centered on EffeTune's music player. |
| Which music file formats are supported? | Support depends on the browser and OS audio decoder. As a practical baseline, MP3, WAV, and AAC/M4A work in many environments, while FLAC, OGG/Vorbis, and Opus/WebM vary by environment. EffeTune can also play the audio track in an MP4 file without displaying video; MP4 playback depends on its internal audio codec, with AAC being the most common compatible choice. If a file does not play, try MP3, AAC/M4A, or WAV. |
| Can I play multiple music files? | Yes. Use **Open music files** and select multiple files in the device's standard file picker before opening them; EffeTune loads them as a playlist. Multiple selection and selecting all files in a folder depend on the device, browser, and file picker. |
| What does Music Library do? | It indexes selected music folders so you can browse and search by track, album, artist, or genre, then play results through EffeTune. It stores library metadata and playlists in the app, not in the audio files. |
| Where is Music Library available? | The desktop app has the full folder scanner. Chromium browsers use File System Access when available. Safari and Firefox use an import fallback, so folder or file access may need to be selected again after reload or permission loss. |
| How do I refresh or reconnect Music Library folders? | Use **Rescan Music Library** after adding, removing, or editing files. If a folder reports missing access, use its **Reconnect** button and grant access to the same folder again. |
| Which playlist formats can Music Library import or export? | Music Library can import M3U, M3U8, PLS, and XSPF playlists, and can export M3U8 or XSPF playlists. |
| Does Music Library change my audio files? | No. Scanning, metadata reading, artwork caching, playlist editing, and playback actions stay inside the app and never modify audio files on disk. |
| Why is output device selection unavailable in the web app? | Browser support and permissions vary. Use Chrome/Chromium on a secure page, or set the desired DAC/AMP as the OS/browser default output. |
| Why did Sample Rate or Output Channels fall back to another value? | Browsers and devices may clamp or ignore unsupported values. EffeTune uses the effective value reported by the audio device. |
| Does the web player remember my playlist? | Repeat/shuffle settings are saved, but the selected music files are not restored after reload because browsers do not keep normal file selections. |
| Does mobile playback continue when the screen turns off? | Not reliably on all browsers, especially iOS. EffeTune uses Wake Lock where available, but background playback is browser-dependent. |
| AV receiver vs. interface cost? | Reusing an AV receiver with HDMI is simple. For PC-centric setups, a multichannel interface plus small amps offers good cost and quality. |
| No sound from other apps right after installing VB-CABLE | The OS default output was switched to **CABLE Input**. Change it back in sound settings. |
| Only channels 3+4 change volume after splitting | Place a **Volume** effect after the splitter and set **Channel** to 3+4. If placed before, all channels change. |

---

## 5. Frequency Response & Room Correction

### 5.1. Importing AutoEQ settings into 15Band PEQ
From EffeTune v1.51 or later, you can import AutoEQ equalizer settings directly from the button in the top right.

### 5.2. Pasting measurement correction settings
Copy the 5Band PEQ settings from the measurement page and paste into the **Effect Pipeline** view using **Ctrl+V** or the menu.

---

## 6. Effect Operation Tips
* Signal flow is top to bottom.
* Use the **Matrix** effect for conversions like 2→4ch or 8→2ch (set **Channel = All** in bus routing).
* Manage level, mute, and delay for up to 8 channels with **MultiChannel Panel**.

---

## 7. Reference Links
* EffeTune Desktop: <https://github.com/Frieve-A/effetune/releases>
* EffeTune Web App: <https://effetune.frieve.com/effetune.html>
* Frequency Response Measurement: <https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE: <https://vb-audio.com/Cable/>
* Voicemeeter: <https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro (unofficial fixed version): search for "ASIO Link Pro 2.4.1"
