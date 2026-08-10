# Pipeline Analyzer

Pipeline Analyzer measures the response of the active Effect Pipeline without changing the audio you hear. It stays beside the pipeline in a wide window and moves below its header in a narrow window, so you can adjust an effect while watching the result update.

Open it with the graph button in the Effect Pipeline header or **View > Pipeline Analyzer** in the desktop app. With **Auto** selected, pipeline changes start a new measurement automatically. Clear **Auto** to measure pipeline changes only when you select **Refresh measurements**. Measurement-setting changes always start a new measurement.

## Choosing channels and speaker responses

Choose one input channel. One output is present initially; use **+ Add Output** to add up to four distinct channels supported by the current audio device. Delete removes that output and its speaker-response setting. The final output cannot be deleted.

Each output can use **No speaker IR**, or a saved measurement point for the connected tweeter, woofer, or other speaker unit. Choosing a measurement without choosing its point is treated as **No speaker IR**. When no output uses a speaker IR, **Before** is the ideal unit impulse: 1.0 at 0 ms and 0 elsewhere. With speaker IRs, **Before** is the signed sum of the aligned responses. **After** is the signed sum after the selected pipeline has processed every output, so a FIR Crossover can be checked together with its speaker units. A missing saved response stays identified as missing until you replace or clear it.

Saved speaker responses are aligned at their detected starts. Separate measurements do not preserve the acoustic arrival-time difference between drivers, so set relative delay and polarity in the pipeline before relying on the combined response.

## Measurement settings

Open **Measurement settings** for these controls:

- **Signal** uses **MLS** by default. **TSP** provides a periodic swept-phase signal with the same stabilization and averaging controls. **Unit Impulse** remains available for a direct time-domain capture.
- **Level** sets the test-signal peak and defaults to `-12 dBFS`. Linear effects normally give the same normalized response at every level; nonlinear and level-dependent effects can give a different result.
- **Sequence Length** sets the periodic signal length. MLS uses 32,767 through 524,287 samples; TSP uses the matching powers of two, 32,768 through 524,288. Switching signal keeps the same order. A longer sequence takes more time and memory but represents a longer response before circular overlap. Pipeline Analyzer recommends a longer value when it can identify that need, but never changes it automatically.
- **Stabilization Periods** defaults to 12. MLS or TSP runs continuously for these periods before capture. The panel shows the actual duration and warns if it is shorter than the known response span or the four-second recommendation.
- **Averages** defaults to 2. Additional periods reduce repeat variation and make changing or random behavior easier to notice.

The details also show **Current support**, **Recommended length**, **Recommended stabilization** in periods and seconds, and **Total stimulus time**. These values are guidance only; Pipeline Analyzer never changes your settings automatically.

Sequence Length, Stabilization Periods, and Averages are disabled only for Unit Impulse. Changing Frequency, Phase, Group Delay, or Impulse only changes the displayed graph and does not remeasure.

## Reading the graphs

- **Frequency** shows level versus frequency.
- **Phase** shows phase versus frequency.
- **Group Delay** shows frequency-dependent delay.
- **Impulse** shows the response over time.

The graph always shows **Before** and **After**. Move the pointer across the graph to read both curves at the same frequency or time; moving over **Before** temporarily hides **After** for an unobstructed comparison. **Smoothing (oct)** and **Impulse Range (ms)** remain visible for every graph so the layout does not move. Smoothing is enabled for Frequency and Group Delay; Impulse Range is enabled for Impulse. Controls that do not affect the selected graph are disabled. Each frequency curve is independently referenced to 0 dB, while each impulse is independently scaled to its full-response peak and displayed from -2 ms to the selected Impulse Range.

## How the measurement works

Each run freezes the current pipeline, parameters, required assets, channel routing, speaker responses, and measurement settings in an isolated worker.

MLS uses circular correlation and TSP uses its inverse sweep to recover the periodic response except at DC. The expected constant offset is removed to form a finite causal response for the Impulse graph and speaker convolution. Reported pipeline latency is removed from the displayed **After** phase, group delay, and impulse time. A response that does not fit within the selected period may overlap itself, so use a longer sequence.

Unit Impulse sends one impulse at the selected Level, normalizes the captured response by that level, and keeps the existing bounded tail capture. A response that continues beyond the maximum capture is incomplete.

For nonlinear, time-varying, random, noisy, or source-generating effects, every signal produces one captured response at the chosen level and initial state—not a universal transfer function. Such results can legitimately differ between runs. Invalid numeric output or a processor or required asset that cannot be prepared causes the measurement to fail.
