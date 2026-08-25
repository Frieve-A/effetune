# Pipeline Analyzer

Pipeline Analyzer measures the response of the active Effect Pipeline without changing the audio you hear. It stays beside the pipeline in a wide window and moves below its header in a narrow window, so you can adjust an effect while watching the result update.

Open it with the graph button in the Effect Pipeline header or **View > Pipeline Analyzer** in the desktop app. With **Auto** selected, pipeline changes start a new measurement automatically. Clear **Auto** to measure pipeline changes only when you select **Refresh measurements**. Measurement-setting changes always start a new measurement.

## Choosing channels and speaker responses

Choose one input channel. One output is present initially; use **+ Add Output** to add up to four distinct channels supported by the current audio device. Delete removes that output and its speaker-response setting. The final output cannot be deleted.

Each output can use **No speaker IR**, or a saved measurement point for the connected tweeter, woofer, or other speaker unit. Choosing a measurement without choosing its point is treated as **No speaker IR**. When no output uses a speaker IR, **Before** is the ideal unit impulse: 1.0 at 0 ms and 0 elsewhere. With speaker IRs, **Before** is the signed sum of the aligned responses. **After** is the signed sum after the selected pipeline has processed every output, so a FIR Crossover can be checked together with its speaker units. A missing saved response stays identified as missing until you replace or clear it.

Saved speaker responses are aligned at their detected starts. Separate measurements do not preserve the acoustic arrival-time difference between drivers, so set relative delay and polarity in the pipeline before relying on the combined response.

## Measurement settings

Open **Measurement settings** for these controls:

- **Signal** uses **MLS** by default. **TSP** is an alternative periodic test signal, while **Unit Impulse** directly captures the time response. Each can measure the pipeline differently when effects are nonlinear or change over time.
- **Level** sets the test-signal peak and defaults to `-12 dBFS`. Linear effects normally give the same normalized response at every level; nonlinear and level-dependent effects can give a different result.
- **Sequence Length** controls how long a response can be measured cleanly: for MLS and TSP it is the period of the test signal, and for Unit Impulse it is the number of samples captured after the impulse. Longer settings take more time and memory. Increase it for delay, reverb, or other long-ringing effects, especially when the analyzer recommends a longer value.
- **Stabilization Periods** defaults to 12 and lets the pipeline settle before capture. Increase it when slow-moving effects have not reached a steady state.
- **Averages** defaults to 2. Increase it to reduce run-to-run variation when the graph is unstable; measurements will take longer.

The details show whether the current length is sufficient, the recommended length and stabilization time, and the total measurement time. For Unit Impulse they show the capture length in samples and seconds at the current sample rate. Recommendations are guidance; apply them when they match the effects you are measuring.

Stabilization Periods and Averages are disabled only for Unit Impulse. MLS uses lengths of 2^n-1 samples, while TSP and Unit Impulse use lengths of 2^n samples; switching signals keeps the nearest matching length. Changing Frequency, Phase, Min Group Delay, Excess Group Delay, or Impulse only changes the displayed graph and does not remeasure.

## Reading the graphs

- Use the **Graph** radio buttons above the graph to select the response to display.
- **Frequency** shows level versus frequency.
- **Phase** shows phase versus frequency.
- **Min Group Delay** shows the delay implied by the minimum-phase part of the magnitude response.
- **Excess Group Delay** shows the remaining delay after the minimum-phase part is removed, making pure delay and other non-minimum-phase timing easier to distinguish.
- **Impulse** shows the response over time.

The graph always shows **Before** and **After**. Move the pointer across the graph to read both curves at the same frequency or time; moving over **Before** temporarily hides **After** for an unobstructed comparison. **Smoothing (oct)** and **Impulse Range (ms)** remain visible for every graph so the layout does not move. Smoothing is enabled for Frequency, Phase, and both Group Delay graphs; Impulse Range is enabled for Impulse. The Excess Group Delay graph is limited to ±100 ms for readability, while the pointer readout retains the original value outside that display range. Controls that do not affect the selected graph are disabled. Each frequency curve is independently referenced to 0 dB, while each impulse is independently scaled to its full-response peak and displayed from -2 ms to the selected Impulse Range.

## How the measurement works

Each measurement captures the active pipeline, its current settings and routing, and any selected speaker responses. The graphs show the resulting frequency, phase, minimum-group-delay, excess-group-delay, and impulse responses; **After** compensates for latency reported by the pipeline.

MLS and TSP are best for general response measurement. If delay, reverb, or ringing extends beyond the selected measurement window, the result can overlap itself; increase **Sequence Length**. **Unit Impulse** records exactly the selected **Sequence Length** of samples, so tails longer than that window are cut off; increase the length when a tail is still ringing at the end of the capture.

Nonlinear, time-varying, random, noisy, and source-generating effects can produce different results at different levels or between runs. Treat these graphs as snapshots of the selected settings rather than fixed characteristics.
