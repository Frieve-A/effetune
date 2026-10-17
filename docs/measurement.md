---
title: "Frequency Response Measurement and Correction - EffeTune"
description: "Measure your audio system's frequency response with a microphone in EffeTune, create a correction EQ, and import, calibrate, and export impulse responses."
lang: en
---

# Frequency Response Measurement and Correction

To measure your audio system's frequency response and create a flat correction EQ:
1. Launch the [Frequency Response Measurement tool](https://effetune.frieve.com/features/measurement/measurement.html), or select **Frequency Response Measurement** from the Settings menu.
2. Follow the guided setup to configure your measurement microphone and output device.
3. Measure your system's frequency response at one or more listening positions.
4. Generate a parametric EQ correction that can be directly imported into EffeTune.
5. Apply the correction to achieve a more accurate, neutral sound reproduction.

## Output Channels

Set **Output Device Channels** to match your output device: **6** for 5.1 or **8** for 7.1. Output channel and per-channel bandwidth choices stay within this range. Test signals and measurements always use this channel count, so keep **6** even when measuring only Ch 3 (center) and Ch 4 (subwoofer) on a 5.1 device.

For a multichannel system, select **All Channels** to measure all outputs together, or select individual **Output Channel** entries to measure them one at a time. Under **Advanced Settings**, choose **Off**, **Same for All Channels**, or **Per Channel** for sweep bandwidth. With **Per Channel**, use **Channel to Configure** to set each selected output channel's frequency range. During level adjustment, **Channel Mode** starts at **Automatic Rotation**; select a specific test-signal channel or **Manual** when needed.

## Importing an Impulse Response

If you already have an impulse-response WAV file, choose **Import** and select it. EffeTune saves each WAV channel as a measurement result that can be used in **Room EQ** and other measurement-based features.

## Audio Interface Calibration

To remove your audio interface's own response, connect its output directly to its input and save that loopback as a normal, uncalibrated measurement with an impulse response. For your speaker measurement, select that saved point under **Audio Interface Calibration** while keeping the same interface, channels, sample rate, and input/output gain settings. Choose **None (uncalibrated)** to measure without loopback calibration.

## Reading and Exporting Results

Saved measurements that include impulse-response data show a normalized **Impulse Response** plot opening at 0–10 ms from the detected onset. Use the mouse wheel or buttons to zoom the time axis, and drag the plot or use the slider to scroll. Selecting a measurement point updates the plot; **All (Average)** displays the first point that has saved impulse-response data and identifies it above the graph. Use **Export Impulse Response (WAV)** below the plot to save the displayed point's full, unnormalized response as a mono 32-bit float WAV at the measurement sample rate.

To inspect the active pipeline's Frequency, Phase, Min Group Delay, Excess Group Delay, and Impulse responses—including up to four selected outputs and optional saved speaker responses—see the [Pipeline Analyzer guide](pipeline-analyzer.md).

[← Back to README](../README.md)
