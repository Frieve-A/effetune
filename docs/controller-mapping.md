---
title: "Controller Mapping - EffeTune"
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

Use two mappings when you want separate increase and decrease buttons or keys. Set one mapping to **+** and the other to **−**. If a learned key is already an EffeTune shortcut, the dialog warns you; the mapping takes priority while the app has focus.

For button mappings, choose **Button Mode**: **Toggle** changes the state on each press, while **Momentary** keeps it active only while the control is held.

## Add time-based or random automation

Choose **Add Automation** when you want a numeric effect parameter to change without a physical controller. The new mapping starts with **Timer** at a safe one-second interval. Select the target effect and parameter first, then configure these controls:

- **Source** chooses **Timer** or **Clock**.
- For **Clock**, **Time part** chooses **Hour**, **Minute**, or **Second**. **Wave** chooses **Rising**, **Sine**, or **Cosine**. The current local time is read once per second and mapped between Min and Max.
- For **Timer**, **Schedule** offers **Interval**, **Once**, and **Daily**. Interval uses **Interval (seconds)** from 1 through 2,147,483.647 seconds. Once uses a local **Date** and **Time**; Daily uses a local Time and waits until the next day if today's time has passed.
- Under **Action**, **Change by amount** adds or subtracts **Amount** each time, **Random value in range** chooses a new value between Min and Max, and **Random step from current value** moves up or down by Amount from the current value.

Clock and Timer automations are available only for numeric effect parameters. They cannot target Enabled, list parameters, Master Bypass, or A/B Toggle. Clock uses the selected time wave directly; random actions are available for Timer and for physical button or key mappings that target a numeric parameter.

Automation is intended for changes that happen no faster than once per second. Interval measures elapsed app runtime rather than following the wall clock. If the app or computer delays a Timer event, EffeTune applies one change when it resumes, starts the next interval from there, and does not replay every missed event.

Once and Daily follow the computer's local calendar and clock, including later clock or daylight-saving changes. A Once time that passed while EffeTune was closed is marked **Expired** and is not replayed; change its Date or Time to a future value to arm it again. Daily fires at most once on a local date. Random values and directions are newly chosen during use, so repeating the same setup does not produce the same sequence.

### Practical examples

- To move Vinyl Simulator Radius from the outside toward the inside, use Timer, set Interval (seconds) to 1, choose **Change by amount**, select the decrease direction, set Amount to 1 mm, and set Min and Max to 60 and 146 mm. The value stops at Min.
- To vary a Radio Simulator numeric parameter with the time of day, use Clock and try Minute with Sine. Min and Max set the useful range.
- For slow, irregular Radio Simulator changes, use Timer with a longer interval and **Random step from current value**. Start with a small Amount so each change remains gradual.
- To apply one change at a particular local date and time, select Once. To apply it at the same local time each day, select Daily.

## Choose the target

- **First** controls the first matching effect in the current pipeline.
- **Last** controls the last matching effect.
- **All** sends the same value to every matching effect, using the first one as the starting value for relative changes.
- **Enabled** toggles an effect on or off. **Global** offers Master Bypass and A/B Toggle.

Min and Max limit the usable part of a parameter's range. Enter them in the unit shown for that parameter. Swap them to reverse the direction. Sensitivity changes the size of relative steps; begin at 1 and adjust only if movement feels too slow or too fast.

## Input types

### MIDI

EffeTune supports MIDI CC, notes, and pitch bend through Web MIDI. Generic devices default to absolute CC input; select a relative mode when an endless encoder sends relative values. MIDI requires permission from the browser or desktop app.

Web MIDI is available in Chromium-based browsers and Firefox, but not Safari. BLE-MIDI and network MIDI can be used when the operating system exposes them as MIDI ports.

### Mackie Control (MCU)

Set the device protocol to **MCU** for compatible control surfaces. Motor faders, fader touch, V-Pot input and LED rings, and button LEDs are supported. LCD text, meters, time displays, and device handshakes are not supported.

After changing a device between Generic and MCU, learn its mappings again.

### Gamepad

Buttons can step or toggle a parameter and repeat while held for continuous or list parameters. Axes default to relative operation, which works well for self-centering sticks: the parameter stays where you leave it when the stick returns to center. Choose absolute mode for controls that do not return to center.

### Keyboard

Keyboard mappings work only while EffeTune has focus and do not run while you are typing in a text field. Toggle actions ignore operating-system key repeat; increase and decrease mappings may repeat while held.

## Connection and troubleshooting

Mappings remain saved when a controller is disconnected and resume when a matching device returns. Device matching uses the MIDI port name or gamepad name. If the name changes after an operating-system or driver change, learn the affected mappings again. Identical gamepads share the same mappings, and identical MIDI port names are distinguished only by their connection order.

If MIDI devices do not appear, allow MIDI access for EffeTune and reopen **Controller Mapping...**. Safari users can still use keyboard and gamepad mappings.
