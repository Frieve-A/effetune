---
title: "Pipeline Analyzer - Effect Chain Frequency & Phase Response - EffeTune"
description: "Pipeline Analyzer measures the frequency response, phase, group delay, and impulse response of the active Effect Pipeline without changing the audio you hear."
lang: en
---

# Pipeline Analyzer

Pipeline Analyzer measures the response of the active Effect Pipeline without changing the audio you hear. It sits beside the pipeline in wide windows or below the pipeline header in narrow windows, letting you adjust effects while watching the response update.

Open it with the graph button in the Effect Pipeline header or **View > Pipeline Analyzer** in the desktop app. When **Auto** is enabled, pipeline edits trigger a new measurement automatically. Clear **Auto** to remeasure pipeline edits only when you click **Refresh measurements**; changing the channels, speaker responses, or measurement settings always starts a new measurement.

## Choosing channels and speaker responses

Select one input channel from the active pipeline (up to 16 channels) and up to four output channels using **+ Add Output**. At least one output always remains, so the last one cannot be removed. Deleting an output also removes its speaker-response setting.

Each output can use **No speaker IR** or a saved measurement point for the connected speaker or driver:

- **Without speaker IRs:** **Before** is an ideal flat reference impulse, and **After** shows the response of the effect pipeline alone.
- **With speaker IRs:** **Before** is the combined response of the selected speaker measurements, and **After** is the combined response after the pipeline processes each output. This lets you verify a **Channel Divider** or **FIR Crossover** together with the actual driver measurements.

A saved response that is no longer available stays selected but appears as — until you replace or clear it.

Because separate speaker measurements are aligned at their detected onsets and do not preserve physical arrival-time differences between drivers, configure relative driver delay and polarity in the pipeline before evaluating the summed response.

## Measurement settings

Open **Measurement settings** to adjust how the pipeline is measured:

- **Signal:** **MLS** (default), **TSP**, or **Unit Impulse**. MLS and TSP use periodic test signals (`2^n - 1` and `2^n` samples), while **Unit Impulse** directly captures the time-domain impulse response (`2^n` samples).
- **Level:** Peak test-signal level (default `-12 dBFS`). Linear filters measure the same at any level, whereas compressors, saturators, and other level-dependent effects change with **Level**.
- **Sequence Length:** Measurement window length. Increase it when measuring reverb, delay, or steep low-frequency filters with long ringing, especially when the analyzer recommends a longer length.
- **Stabilization Periods:** Number of periods played before capture (default `12`, used by MLS and TSP) so slow-moving effects can settle.
- **Averages:** Number of captured periods averaged together (default `2`, used by MLS and TSP) to reduce variation.

## Reading the graphs

Use the **Graph** selector above the plot to switch views without remeasuring:

- **Frequency:** Magnitude response (dB) versus frequency, referenced to 0 dB.
- **Phase:** Phase response (degrees) versus frequency.
- **Min Group Delay:** Group delay implied by the minimum-phase magnitude response.
- **Excess Group Delay:** Remaining group delay after removing the minimum-phase part (the plot is limited to ±100 ms, while cursor readouts show the actual value), making pure delay and linear-phase or all-pass timing easy to spot.
- **Impulse:** Time-domain impulse response from `-2 ms` to **Impulse Range (ms)**, normalized to its peak.

Hover over the graph to read **Before** and **After** values at the cursor; hover over the **Before** legend label to temporarily hide **After**. Use **Smoothing (oct)** for the frequency, phase, and group-delay plots, and **Impulse Range (ms)** for the impulse plot.

## How the measurement works

Pipeline Analyzer captures the active pipeline, its routing, and any selected speaker responses, and automatically compensates **After** for latency reported by the pipeline. If a reverb tail or filter ringing extends past **Sequence Length**, increase **Sequence Length** to avoid wraparound (MLS/TSP) or truncation (**Unit Impulse**). For nonlinear, modulated, or random effects, treat the plot as a snapshot at the current settings and **Level**.

[← Back to README](../README.md)
