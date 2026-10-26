---
title: "Acoustic Measurement - EffeTune"
description: "Measure your audio system's frequency response, impulse response, distortion, and decay with a microphone, and create correction EQ in EffeTune."
lang: en
---

# Acoustic Measurement

Measure frequency response, impulse response, distortion, and decay, and create correction EQ when needed:
1. Launch [Acoustic Measurement](https://effetune.frieve.com/features/measurement/measurement.html), or select **Acoustic Measurement** from the Settings menu.
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

Results have five tabs. Frequency averages can include several points or outputs; the impulse, distortion, and waterfall tabs select one saved point and output. When switching from an average, the last valid individual selection is restored, or the first available record is selected. Returning to frequency response restores its selection. A measurement with all outputs playing together describes their combined response.

- **Frequency Response** compares the measured response, correction EQ, and predicted corrected response. Set the frequency and dB ranges, display smoothing, relative normalization or reference level, and visible curves. Smoothing uses a Gaussian width (σ); **0** adds no smoothing but cannot undo processing already present in the saved response. For an individual record with an impulse response, choose the saved response or reanalyze the IR using the selected window before/after onset and window shape. The results may differ because they use different time intervals. Display settings do not change the saved measurement or correction EQ. Correction design, copying, and TXT/CSV export remain in the correction section.
- **Impulse Response** shows signed amplitude or the dB magnitude of the response over time. Adjust the time and amplitude ranges, zoom/pan, peak normalization, displayed time origin, and window lengths and shape. The overlay identifies the analyzed interval. Time zero starts at the detected onset; moving it changes the display, not the measured travel time. A WAV import or a recording without a playback timing reference does not provide absolute propagation delay. WAV export saves the complete stored, unnormalized linear response as mono 32-bit float audio at its saved sample rate, regardless of the displayed window or zoom.
- **Distortion** shows harmonic ratios relative to the fundamental, initially H2, H3, and THD. In **Display settings**, the **Highest displayed harmonic** slider selects up to H10 when the measurement contains those orders; a record limited to H3 needs a new measurement for higher orders. **THD highest order** separately sets the THD ceiling and cannot exceed the display limit. Adjust frequency and vertical ranges, visible curves, and the analysis window. Under **Unit**, choose % or dBr; both express the same ratio to the fundamental (1% = −40 dBr). A larger ratio means more harmonic distortion. THD combines orders 2 through its ceiling and appears only where all are valid; gaps mean unavailable data, not zero distortion. For distortion, **Hann** gives full weight to the direct-response onset and tapers to zero at the selected edges; changing the window can change the curves. Higher harmonics have shorter usable windows and narrower frequency coverage; a longer requested sweep can improve separation. Results describe the complete playback and recording path; linear interface calibration does not remove its distortion.
- **Waterfall (3D)** offers **Waterfall** and **Burst Decay** analysis. Surface height and heatmap color show the same relative dB level; the color scale and position readout identify the level. Contour lines connect points at the same dB level. Frequency grid lines follow the surface at the axis ticks. Under **Normalization**, **None** keeps the original levels. **Overall peak = 0 dB** uses one peak across the displayed frequency band and available times, preserving level differences. **Each frequency peak = 0 dB** sets each frequency’s loudest available time to 0 dB, making decay easier to compare; that peak need not occur at 0 ms. The default view places zero depth at the back and later values toward the front. Set the frequency and dB ranges and first/last slices. Adjust rotation, elevation and zoom with the view controls, or drag to rotate and use the wheel or + / − to zoom. **Reset view** restores the viewpoint without changing the analysis. In **Waterfall**, depth is time in ms; adjust window length, rise time, window shape and smoothing. Longer windows distinguish nearby frequencies better but blur changes in time; the rise interval also affects time resolution. Only complete windows within the saved response are shown. **Burst Decay** shows the envelope of Gaussian-shaped tone bursts with a fixed 1/3-octave bandwidth. Choose **Time** in ms or **Cycles** for depth; the initial cycle range is 0–30. Cycles help compare ringing in periods: one cycle is 10 ms at 100 Hz and 1 ms at 1 kHz, so equal cycle depths are different elapsed times. The burst duration itself contributes to the displayed decay. This estimate assumes silence before the first saved sample while retaining saved samples before onset; gaps indicate insufficient recorded tail, not silence.
- **Measurement Details** shows acquisition, calibration, sample rate, timing reference, saved duration, and available analyses. Export JSON here; including impulse responses also includes available harmonic data. A JSON export without impulse responses retains frequency results but cannot restore time or distortion analyses.

Use the graph legends and position readouts to inspect values with the mouse, touch, or keyboard. In **Frequency Response** and **Distortion**, hover over a legend entry to highlight its curve. Automatic range and reset controls help return to a useful view. These are relative levels, not calibrated sound-pressure levels. Frequency readouts also show λ, the length of one wavelength in meters, calculated for dry air at 15°C and 1 atm (sound speed 340.3 m/s).

Use the camera icon (**Copy image**) above any of the four graphs to copy a high-resolution PNG to the clipboard, then paste it into a presentation or blog editor. The image keeps the current view and theme, title, selected measurement, legend and color scale where shown, without the cursor or settings controls.

New measurements use an exponential sine sweep (ESS). Start with a low output level and adjust it without clipping. Distortion needs valid harmonic data from this measurement; imported WAV responses and measurements containing only frequency or linear IR data cannot supply it. If data is unavailable, import a measurement containing the needed responses or make a new measurement. The available range also depends on the sweep band and recorded duration. The requested sweep length may be increased to separate harmonics. Each repeat also includes 2.5 seconds for decay. With bandwidth limiting off, ESS covers 20 Hz–20 kHz within the limits of the actual sample rate.

To inspect the active pipeline's Frequency, Phase, Min Group Delay, Excess Group Delay, and Impulse responses—including up to four selected outputs and optional saved speaker responses—see the [Pipeline Analyzer guide](pipeline-analyzer.md).

[← Back to README](../README.md)
