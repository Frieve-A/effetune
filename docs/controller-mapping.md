---
title: "Controller Mapping - MIDI, Gamepad & Keyboard Control - EffeTune"
description: "Control EffeTune effect parameters from MIDI controllers, gamepads, and the keyboard."
lang: en
---

# Controller Mapping

Controller Mapping lets you adjust effect parameters without dragging their on-screen controls. You can use a MIDI controller, a gamepad, or keyboard keys while EffeTune has focus. Changes use the same parameter ranges as the effect UI and are reflected on screen.

## Add a mapping

1. Open **Settings**, then choose **Controller Mapping...**.
2. Choose **Add (Learn)**.
3. Move a MIDI control, press a key, or operate a gamepad button or axis.
4. Select the target effect, instance rule, and parameter.
5. Adjust Min, Max, Sensitivity, direction, or input mode when needed. Changes are saved immediately.

Use two mappings when you want separate increase and decrease buttons or keys. Set **Direction** to **Increase (+)** on one and **Decrease (−)** on the other. If a learned key is already an EffeTune shortcut, the dialog warns you; the mapping takes priority while the app has focus.

For button mappings, choose **Button Mode**: **Toggle** changes the state on each press, while **Momentary** keeps it active only while the control is held.

## Choose the target

- **First** controls the first matching effect in the current pipeline.
- **Last** controls the last matching effect.
- **All** sends the same value to every matching effect, using the first one as the starting value for relative changes.
- **Enabled** toggles an effect on or off.

**Global** controls the app and the music player instead of an effect: **Master Bypass**, **A/B Toggle**, **Play/Pause**, **Stop**, **Next/Previous Track**, **Seek ±10 s**, **Playback Speed**, **Preserve Pitch**, **Repeat**, **Shuffle**, and **Next/Previous Preset**.

- For **Next/Previous Track**, **Seek ±10 s**, and **Next/Previous Preset**, **Direction** sets **Increase (+)** (forward) or **Decrease (−)** (backward). An endless encoder or jog wheel follows the turn direction.
- **Playback Speed** changes continuously with a fader or knob (`1x` at center), or steps through standard speeds when mapped to a button or key.
- **Next/Previous Preset** steps through user presets in name order and wraps around.
- Player actions require the music player to be open. If browser autoplay rules block audio startup, press Play in the player UI first.

**Min** and **Max** limit the active parameter range (in the parameter's unit); swap them to invert the control direction. **Sensitivity** scales relative step size (start at `1`).

## Add time-based or random automation

Choose **Add Automation** when you want a numeric effect parameter to change automatically without a physical controller. Select the target effect and parameter first, then configure these controls:

- **Source**: Choose **Timer** (default, 1-second interval) or **Clock**.
- **Clock**: **Time part** selects **Hour**, **Minute**, or **Second**, and **Wave** selects **Rising**, **Sine**, or **Cosine**. The current local time is read once per second and mapped between **Min** and **Max**.
- **Timer**: **Schedule** offers **Interval**, **Once**, and **Daily**. **Interval** uses **Interval (seconds)** from `1` to `2,147,483.647` seconds. **Once** triggers at a local **Date** and **Time**; **Daily** triggers at a local **Time** once per calendar day.
- **Action** (Timer and numeric button/key mappings): **Change by amount** adds or subtracts **Amount** each time, **Random value in range** picks a new value between **Min** and **Max**, and **Random step from current value** steps up or down by **Amount** at random.

Clock and Timer automations apply only to numeric effect parameters (not **Enabled**, list parameters, or **Global** operations) and run at most once per second. If the app or computer is paused or asleep when an **Interval** timer is due, EffeTune applies a single step when it resumes and starts the next interval from there. A **Once** schedule whose time passed while EffeTune was closed is marked **Expired**; set a future **Date** or **Time** to arm it again.

### Practical examples

- Vinyl Simulator Radius: Use **Timer**, set **Interval (seconds)** to `1`, choose **Change by amount**, set **Direction** to **Decrease (−)** and **Amount** to `1 mm`, and set **Min** and **Max** to `60` and `146 mm` so the stylus moves from the outer edge to the inner groove and stops at **Min**.
- Time-of-day tone variation: Use **Clock** with **Minute** and **Sine** to sweep a Radio Simulator numeric parameter smoothly between **Min** and **Max**.
- Slow random drift: Use **Timer** with a longer interval and **Random step from current value**, starting with a small **Amount** so changes stay gradual.
- Scheduled change: Select **Once** for a single local date and time, or **Daily** for the same local time every day.

## Input types

### MIDI

EffeTune supports MIDI CC, notes, and pitch bend through Web MIDI (available in Chromium browsers, Firefox, and the desktop app; not supported in Safari). Generic devices default to absolute CC input; select a relative mode for endless encoders. BLE-MIDI and network MIDI work when exposed as OS MIDI ports.

### Mackie Control (MCU)

Set the device protocol to **MCU** for compatible control surfaces. Motor faders, fader touch, V-Pot input, LED rings, and button LEDs are supported (LCD text, level meters, timecode displays, and device handshakes are not used). Re-learn mappings after switching a device between **Generic** and **MCU**.

### Gamepad

Buttons can toggle or step parameters and repeat while held. Axes default to relative mode so self-centering sticks leave the parameter where you release it; switch to absolute mode for throttle-style axes that stay in position.

### Keyboard

Keyboard mappings work while EffeTune has focus and are ignored while typing in text fields. Toggle mappings ignore key repeat, while increase/decrease mappings repeat at your operating system's key-repeat rate when held.

## Connection and troubleshooting

Each MIDI device shows **Connected** or **Disconnected** below its name. Mappings stay saved when a controller is unplugged and reconnect automatically when a device with the same MIDI port or gamepad name returns. If a driver or OS update changes the device name, re-learn the affected mappings. Gamepads with the same name share mappings, and MIDI ports with the same name are told apart only by the order in which they are connected. If MIDI devices do not appear, grant MIDI permission and reopen **Controller Mapping...**. Safari users can still use keyboard and gamepad mappings.

[← Back to README](../README.md)
