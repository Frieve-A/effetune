---
title: "Pipeline Analyzer - Effect Chain Frequency & Phase Response - EffeTune"
description: "Pipeline Analyzer measures the frequency response, phase, group delay, impulse response, distortion, and decay of the active Effect Pipeline without changing the audio you hear."
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

- **Signal:** **Log Sweep** (default), **MLS**, **TSP**, or **Unit Impulse**. Use **Log Sweep** to inspect harmonic distortion as well as the pipeline's response. Its sweep covers 20 Hz–20 kHz within the sample rate's limits. **MLS** and **TSP** use periodic signals; **Unit Impulse** captures the impulse response directly.
- **Level:** Peak test-signal level (default `-12 dBFS`). Linear filters measure the same at any level, whereas compressors, saturators, and other level-dependent effects change with **Level**.
- **Requested sweep length** (**Log Sweep**) / **Sequence Length** (other signals): The default requested length for **Log Sweep** is `131072` samples. It may use a longer sweep to separate harmonics; the actual **Sweep length** and **Total stimulus time** appear after measurement. Its response covers up to 1.5 seconds after the main peak regardless of sweep length. To inspect longer reverb tails, delays, or filter ringing, select **MLS**, **TSP**, or **Unit Impulse** and increase **Sequence Length** as needed.
- **Stabilization Periods:** Number of periods played before capture (default `12`, used by MLS and TSP) so slow-moving effects can settle. This setting is unavailable with **Log Sweep** and **Unit Impulse**.
- **Averages:** Number of captures averaged together (default `2`, used by **Log Sweep**, MLS, and TSP) to reduce variation.

## Reading the graphs

Use the **Graph** selector above the plot to switch views without remeasuring:

- **Frequency:** Magnitude response (dB) versus frequency, referenced to 0 dB.
- **Phase:** Phase response (degrees) versus frequency.
- **Min Group Delay:** Group delay implied by the minimum-phase magnitude response.
- **Excess Group Delay:** Remaining group delay after removing the minimum-phase part (the plot is limited to ±100 ms, while cursor readouts show the actual value), making pure delay and linear-phase or all-pass timing easy to spot.
- **Impulse:** Time-domain impulse response from `-2 ms` to **Impulse Range (ms)**, normalized to its peak.
- **Distortion:** With **Log Sweep**, shows harmonic distortion as a percentage of the fundamental across frequency. H2, H3, and THD (orders 2–3) are shown initially; H4–H10 can be added without remeasuring. Larger values mean more distortion. Select **Log Sweep** if this graph is unavailable with another signal. A silent or otherwise invalid measured output cannot provide distortion data. Saved speaker responses contribute their linear response, not any distortion from the speaker itself.
- **Waterfall:** Shows frequency, relative level (dB), and decay time (ms). Choose **After** (default) or **Before** under **Response** to inspect the pipeline output or the selected speaker responses before processing. Each view is normalized to its own peak, so compare the decay shape rather than absolute levels. Drag to rotate the 3D plot; use the mouse wheel or pinch to zoom.

On the frequency, phase, group-delay, and impulse graphs, hover to read **Before** and **After** values at the cursor; hover over the **Before** legend label to temporarily hide **After**. Use **Smoothing (oct)** for the frequency, phase, and group-delay plots, and **Impulse Range (ms)** for the impulse plot.

## How the measurement works

Pipeline Analyzer captures the active pipeline, its routing, and any selected speaker responses, and automatically compensates **After** for latency reported by the pipeline. For nonlinear, modulated, or random effects, treat the plot as a snapshot at the current settings and **Level**.

[← Back to README](../README.md)
