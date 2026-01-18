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
Launch the desktop app and open **Config Audio**.
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
| Dropouts or glitches | Click the **Reset Audio** button in the top-left corner of the web app or choose **Reload** from the **View** menu in the desktop app. Reduce the number of active effects if necessary. |
| Distortion or clipping | Insert **Level Meter** at the end of the chain and keep levels below 0 dBFS. Add **Brickwall Limiter** before Level Meter if needed. |
| Aliasing above 20 kHz | VB-CABLE may still run at 48 kHz. Recheck the initial setup. |

### 2.2. High CPU usage
Disable effects you're not using or remove them from the **Effect Pipeline**.

### 2.3. Echo
Your input and output devices may be looping back. Ensure EffeTune's output does not return to its input.

### 2.4. Input, output, or effect problems

| Symptom | Solution |
| ------ | ------ |
| No audio input | Make sure the player outputs to **CABLE Input**. Allow microphone permission in the browser and select **CABLE Output** as the input device. |
| Effect not working | Confirm the master, each effect, and any **Section** are **ON**. Reset parameters if needed. |
| No audio output | For the web app, check that the OS and browser outputs point to your DAC/AMP. For the desktop app, check the output device in **Config Audio**. |
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
| Surround input (5.1ch etc.)? | The Web Audio API limits input to 2 channels. Output and effects support up to 8 channels. |
| Recommended effect chain length? | Use as many effects as your CPU allows without causing dropouts or high latency. |
| How to get the best sound quality? | Use 96 kHz or higher, start with subtle settings, monitor headroom with **Level Meter**, and add **Brickwall Limiter** if needed. |
| Does it work with any source? | Yes. With a virtual audio device you can process streaming, local files, or physical equipment. |
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
* EffeTune Web version: <https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE: <https://vb-audio.com/Cable/>
* Voicemeeter: <https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro (unofficial fixed version): search for "ASIO Link Pro 2.4.1"
