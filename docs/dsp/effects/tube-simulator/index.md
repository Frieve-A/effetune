---
layout: dsp
title: "Tube Simulator — EffeTune DSP"
description: "Models vacuum-tube preamplifier and power-stage saturation with supply and speaker-load interaction."
lang: en
permalink: /dsp/effects/tube-simulator/
---
# Tube Simulator

Semantic type: `TubeSimulator` · Category: saturation

Models vacuum-tube preamplifier and power-stage saturation with supply and speaker-load interaction.

This type can intentionally generate output from zero input at an active setting. See [Processing model](/dsp/concepts/processing-model/#source-generating-effects).

## Contract

- Seeded: **no**
- Catalog sample rates: **44100, 48000, 88200, 96000, 176400, 192000 Hz**
- Assets: **none**
- Catalog-declared latency: **zero**
- Effective delay on the active processing path: **64 samples**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `inputVolume` | `input_volume` | number / 1 | `-55.9648` | dB | -96 … 0 |
| `tube` | `tube` | string / 1 | `"12AX7"` | Not declared in catalog | `12AX7`, `12AT7`, `12AU7` |
| `bias` | `bias` | number / 1 | `0` | % | -50 … 50 |
| `plateVoltage` | `plate_voltage` | number / 1 | `250` | V | 150 … 300 |
| `sourceImpedance` | `source_impedance` | number / 1 | `10` | kOhm | 0.6 … 100 |
| `supplyImpedance` | `supply_impedance` | number / 1 | `10` | kOhm | 0.1 … 47 |
| `outputTrim` | `output_trim` | number / 1 | `4.626` | dB | -48 … 48 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |
| `inputReference` | `input_reference` | number / 1 | `2.828` | Vpk | 0.1 … 20 |
| `negativeFeedback` | `negative_feedback` | number / 1 | `3` | dB | 0 … 30 |
| `outputStage` | `output_stage` | string / 1 | `"Power"` | Not declared in catalog | `Line`, `Power` |
| `powerTube` | `power_tube` | string / 1 | `"EL84"` | Not declared in catalog | `EL84`, `EL34` |
| `powerBPlus` | `power_bplus` | number / 1 | `329.696` | V | 300 … 470 |
| `cathodeResistor` | `cathode_resistor` | number / 1 | `270` | Ohm | 270 … 500 |
| `screenTap` | `screen_tap` | string / 1 | `"0"` | Not declared in catalog | `0`, `20`, `43` |
| `primaryImpedance` | `primary_impedance` | string / 1 | `"8.0"` | Not declared in catalog | `6.0`, `6.6`, `8.0` |
| `speakerLoad` | `speaker_load` | string / 1 | `"15"` | Not declared in catalog | `4`, `8`, `15`, `16` |
| `actualSpeakerLoad` | `actual_speaker_load` | number / 1 | `15` | Ohm | 2 … 32 |
| `safetyTrim` | `safety_trim` | number / 1 | `0` | dB | -96 … 0 |
| `autoGainReduction` | `auto_gain_reduction` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Tube Simulator

Tube Simulator models a complete electrical signal path built from tube-circuit component values. **Line** uses the two-stage small-signal tube amplifier by itself. **Push-Pull Power** passes that same driver through a fixed volume control into a 12AX7 phase inverter that is solved as a differential pair of real tubes, and from there into a pair of EL84 or EL34 output tubes, an output transformer, and a frequency-dependent speaker load. Bias, B+, transformer, and speaker-load states are solved as the music changes, so the harmonic content, compression, supply sag, and electrical damping respond to the signal instead of being added as a fixed distortion curve. The speaker load models the electrical load on the amplifier; it is not a cabinet or microphone simulation.

### Listening Enhancement Guide

- The plug-in opens on **EL84 Pentode @2%**, so a 2 Vrms D/A converter needs no setup. Its actual product defaults are Input Reference 2.828 Vpk, Input Volume -55.9648dB, 12AX7, Negative Feedback 3dB, and Output Trim +4.626dB, which places the EL84 push-pull circuit at 2% total harmonic distortion at unity gain.
- If it sounds too saturated, lower Input Volume to reduce the voltage entering the circuit, then use Output Trim only to restore the listening level. Output Trim does not recover internal headroom.
- Select **Line Default** when you want the small-signal line circuit on its own instead of a power amplifier.
- Use the **Listening (THD-matched)** presets when you want to compare tubes and circuits by character alone. They are already matched to one another in loudness, so nothing needs to be trimmed between them.
- For a restrained power-amplifier response, start with **EL84 Distributed 10 W**. Compare it with **EL84 Pentode 10 W** to hear the effect of the screen connection and transformer loading while keeping the output-tube family the same.
- Use **EL34 Distributed 20–37 W** when you want to explore the higher-voltage EL34 circuit. Match loudness with Output Trim before comparing it with either EL84 preset.
- Lower Negative Feedback for more of the circuit's open-loop harmonic and level response; raise it for a more controlled closed-loop response. Some extreme combinations can become unstable, so return to a preset if the safety bypass appears.
- Lower Wet/Dry Mix when you want the modeled circuit to remain a subtle part of the result.

### Panel Layout

The 20 parameters are arranged in five tabs below the **Preset** dropdown.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Tube, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit, Power Tubes, Output B+, Cathode Resistor
- **Transformer** - Screen Tap, Transformer Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

The Preset dropdown lists **Custom** first, followed by the **Listening (THD-matched)** and **Circuit** groups; Custom is shown whenever the current settings match no preset; the output-protection settings (Output Safety Trim and Auto Gain Reduction) are not part of that comparison. While Output Circuit is Line, the seven power-circuit controls on the Power and Transformer tabs are dimmed. They stay adjustable and keep their values.

### Circuit Presets and Defaults

The plug-in opens with the **EL84 Pentode @2%** listening preset. Selecting a preset writes the complete circuit shown below; changing any value afterward creates a custom setting.

| Circuit Preset | Output Circuit | Driver / Power Tubes | Negative Feedback | Power settings | Input / output |
| --- | --- | --- | ---: | --- | --- |
| Line Default | Line | 12AU7 / — | 30dB | Power controls retained but dimmed | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim +9dB |
| EL84 Pentode 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 329.696 V, Cathode Resistor 270 Ω / valve, Screen Tap 0%, Transformer Primary 8.0 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |
| EL84 Distributed 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 330.107 V, Cathode Resistor 270 Ω / valve, Screen Tap 20%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |
| EL34 Distributed 20–37 W | Push-Pull Power | 12AX7 / EL34 ×2 | 4dB | Output B+ 443.775 V, Cathode Resistor 470 Ω / valve, Screen Tap 43%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 8 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |

All four presets use Bias 0%, Plate 250 V, Source Z 10 kΩ, Supply 10 kΩ, and Wet/Dry Mix 100%. Every preset also sets Actual Speaker Load to its Assumed Speaker Load, so it starts at the circuit's design point.

### Listening Presets

The **Listening (THD-matched)** group holds seven calibrated settings. Each one inherits every circuit value from the Circuit preset it is based on, and only Input Volume, Input Reference, and Output Trim are calibrated, so the circuit itself is left untouched. All seven land within ±0.0005dB of the same 1 kHz level, so switching between them changes the character and not the loudness.

| Listening Preset | Based on | Circuit change | Input Volume | Input Reference | Output Trim |
| --- | --- | --- | ---: | ---: | ---: |
| Line 12AU7 @1% | Line Default | — | 0dB | 20 Vpk | -7.749dB |
| Line 12AT7 @1% | Line Default | Tube 12AT7 | -3.6973dB | 2.828 Vpk | -9.42dB |
| Line 12AX7 @1% | Line Default | Tube 12AX7 | -4.4805dB | 2.828 Vpk | -11.276dB |
| Line 12AU7 Open-Loop @3% | Line Default | Negative Feedback 0dB | -16.793dB | 2.828 Vpk | +26.427dB |
| EL84 Pentode @2% | EL84 Pentode 10 W | — | -55.9648dB | 2.828 Vpk | +4.626dB |
| EL84 Distributed @2% | EL84 Distributed 10 W | — | -52.9414dB | 2.828 Vpk | +4.908dB |
| EL34 Distributed @2% | EL34 Distributed 20–37 W | — | -43.6504dB | 2.828 Vpk | +5.212dB |

The 12AU7 line circuit stops just short of 1% distortion even at the Input Reference ceiling, so Line 12AU7 @1% sits at the highest figure that circuit reaches.

### Parameters

- **Preset** - Loads a Circuit preset (Line Default or one of the three complete power-amplifier circuits) or one of the Listening (THD-matched) settings
- **Input Volume** (-96 to 0dB) - Passive attenuation between the calibrated input terminal and Stage 1
  - 0dB is fully open; lower values reduce internal drive and increase headroom
- **Tube** (12AX7, 12AT7, or 12AU7) - Selects the two-stage driver tubes
  - 12AX7 has the highest voltage gain, 12AT7 is intermediate, and 12AU7 has the lowest gain and the most headroom
  - In Power mode this two-stage circuit remains the driver, feeding the fixed 12AX7 phase inverter through a fixed volume control
- **Bias** (-50 to +50%) - Shifts the cathode-bias point of the two driver stages
  - Raising it lowers their modeled cathode resistance and moves them toward higher current; lowering it does the opposite
- **Plate** (150 to 300 V) - Sets the driver-stage plate supply
  - Higher values generally provide more voltage headroom; lower values bring compression and nonlinearity in sooner
- **Source Z** (0.6 to 100 kΩ) - Sets the source impedance feeding Stage 1
  - Higher values interact more strongly with the input capacitances and can soften high-frequency or transient drive
- **Supply** (0.1 to 47 kΩ) - Sets the resistance of the driver-stage B+ supply
  - Higher values produce more supply sag as current rises; lower values make the supply stiffer
- **Negative Feedback** (0 to 30dB) - Sets the calibrated global negative-feedback amount
  - Line returns the second-stage plate response; Push-Pull Power returns a fixed transformer-secondary feedback winding
  - Increasing it generally reduces open-loop gain and distortion and tightens the response; 0dB opens the feedback loop
  - The electrical damping of the speaker load comes out of this loop itself, so raising it also tightens the amplifier's grip on the load
- **Output Trim** (-48 to +48dB) - Adjusts the wet digital level after the modeled circuit without changing its internal drive
- **Output Safety Trim** (-96 to 0dB) - Applies a separate linear trim after the modeled circuit, kept apart from Output Trim so that the output-level protection has a control of its own
  - Auto Gain Reduction lowers this trim only; it never writes to Output Trim
  - The slider and its value box show the effective trim, which is the value you set minus any automatic reduction currently applied; the stored setting is the value you last set yourself, and that is what is saved
  - Taking hold of the slider makes the displayed effective value your setting, so the level does not jump, and the accumulated reduction is cleared at that point
- **Auto Gain Reduction** (on by default) - Lets the output-level protection reduce Output Safety Trim on its own
  - With it off, no new reduction accumulates and any reduction already applied stays applied
- **Wet/Dry Mix** (0 to 100%) - Blends the processed signal with the latency-aligned original
  - At 0%, the dry path still carries the fixed 64-sample delay needed for alignment
- **Input Reference** (0.100 to 20.000 Vpk) - Peak terminal voltage represented by a digital 0dBFS peak
  - 2.828 Vpk corresponds to a 2 Vrms full-scale sine; 5.657 Vpk corresponds to 4 Vrms
  - Stage 1 receives Input Reference multiplied by Input Volume; this is physical calibration, not another output-gain control
- **Output Circuit** (Line or Push-Pull Power) - Selects the modeled topology
  - Line stops after the two-stage driver and does not run the power-tube, transformer, or speaker-load model
  - Push-Pull Power adds the phase inverter and complete power-output circuit
- **Power Tubes** (EL84 ×2 or EL34 ×2) - Selects the output-tube current model and its associated circuit components; it affects only Power mode
  - Both models follow real output-tube data across plate, screen, and grid voltage, including the complete cutoff reached when the grid is driven far enough negative
- **Output B+** (300 to 470 V) - Sets the power-stage supply voltage; higher values increase available voltage swing and tube dissipation
- **Cathode Resistor** (270 to 500 Ω / valve) - Sets the separate cathode-bias resistor for each output tube
  - Higher resistance reduces the idle current; lower resistance raises it
- **Screen Tap** (0%, 20%, or 43%) - Selects the output-tube screen connection
  - 0% uses the fixed screen supply; 20% and 43% connect the screens to the corresponding transformer-primary taps for distributed (ultra-linear) loading
  - The tap is a turns ratio, so the screens follow that share of the magnetic coupling in the primary winding
- **Transformer Primary** (6.0, 6.6, or 8.0 kΩ) - Selects the output transformer's plate-to-plate primary impedance and, together with Assumed Speaker Load, its turns ratio
- **Assumed Speaker Load** (4, 8, 15, or 16 Ω) - Selects the transformer secondary tap and the nominal speaker impedance the circuit is built around
  - Each choice uses a frequency-dependent electrical RLC load rather than a simple resistor and affects transformer loading and feedback
- **Actual Speaker Load** (2 to 32 Ω) - Sets the impedance of the speaker actually connected to that tap
  - The load network is scaled by its ratio to Assumed Speaker Load, so the resonance frequency and Q are kept and only the impedance level moves
  - The turns ratio stays on Assumed Speaker Load, so a mismatch reflects a different impedance to the output tubes and changes damping, available power, and drive; setting the two alike runs the circuit at its design point

### Output Level Protection

The Circuit presets are not matched to one another in loudness. Changing Tube from 12AU7 to 12AX7 raises the level by about 25dB, and changing Output Circuit from Line to Push-Pull Power raises it by about 33dB, because the two circuits normalize to different full-scale references. Output Safety Trim and Auto Gain Reduction protect the equipment connected to the output from that jump.

- Whenever the magnitude of an output sample exceeds 0 dBFS peak, Output Safety Trim is reduced immediately by exactly the amount that sample overshoots by. Every sample is examined, so there is no detection window and no averaging. The threshold is a fixed policy value.
- The reduction is applied over a 20 ms one-way ramp, so the level moves without a step.
- It only reduces and never restores. There is no release and no recovery, so it is neither a limiter nor an auto-leveler.
- The slider and its value box show the effective trim, which is your setting minus the reduction currently applied. The stored setting stays at the value you last set yourself, and that is what is saved.
- The accumulated reduction is cleared when you take hold of Output Safety Trim yourself. The displayed effective value becomes your setting at that point, so the level does not jump.
- Loading a preset sets Output Safety Trim back to 0dB. The accumulated reduction is cleared whenever the trim value itself changes or a single commit changes two or more values at once, as a preset load normally does; re-selecting the preset the circuit is already on after moving one control changes only that single value and keeps the reduction.
- With Auto Gain Reduction off, no new reduction accumulates and any reduction already applied stays applied.
- The current reduction is reported in the status line below the graph, including when it is 0.0 dB.
- The mechanism sits outside the amplifier model. The circuit solving, harmonics, compression, and supply sag are unchanged; only the output level changes, never the character of the overload. What it suppresses is digital full-scale overshoot at the output, not the distortion the model produces.

### Safety Bypass and Recovery

- If the circuit model detects feedback oscillation, it fades the wet circuit output to the latency-aligned dry path and latches the safe bypass. Lower Negative Feedback, select a canonical preset, or change another circuit setting. The new setting is checked while the output stays dry; stable operation returns with a smooth fade, while continuing instability remains bypassed.
- If the model encounters another processing-safety failure, it switches to the safe dry output. Restore the default circuit settings, then reload the effect.
- Unsupported sample rates or channel modes, unavailable WebAssembly processing, and a stopped processing engine also bypass the effect. The status below the HUD explains the action to take.

### How to Read the HUD

- **Input Reference (0 dBFS)** shows the terminal calibration as Vpk, sine Vrms, and **dBuFS**. **Stage 1 External Input (0 dBFS)** shows the peak after Input Volume.
- **Stage 1 Bias**, **Stage 2 Bias**, **B+**, and **Plate − B+ Sag** report the live operating points of the two-stage driver in both output modes. A more negative sag value means the plate sits farther below its supply.
- In Line, the two graph panels show Stage 1 and Stage 2. The thin gray curves are static plate characteristics and the dashed line is the load line, while the recent operating points are plotted as individual points rather than a connected line.
- In Push-Pull Power, the graph panels change to **Push** and **Pull** load lines and plot the two output tubes' recent plate-current operating points.
- The horizontal graph axis is anode-to-cathode voltage, **Vak (V)**, and the vertical axis is plate current, **Ia (mA)**. Cyan is the left audio channel and orange is the right; points spread over a wider area mean the signal is moving that stage through a wider operating range.
- **Power LTP Balance** shows the phase inverter's differential voltage, and **Power B+** shows the live power-stage supply after sag.
- **Speaker Output (100 ms)** and **Speaker Real Power (100 ms)** show non-overlapping 100 ms electrical measurements at the selected speaker load. Real Power is calculated from instantaneous load voltage and current, so it is not simply Vrms squared divided by the nominal impedance.
- **Transformer Flux** shows the output transformer's modeled magnetic flux in webers. Power-only readings are meaningful when Push-Pull Power is selected.
- The status below the graph reports whether processing is loading, active, or safely bypassed, and always shows the current output-protection reduction in dB, including when it is 0.0 dB.

### Processing Requirements and Latency

- Tube Simulator processes 44.1, 48, 88.2, 96, 176.4, and 192 kHz audio using WebAssembly
- The 44.1 kHz rate family is processed internally at 352.8 kHz, and the 48 kHz rate family is processed internally at 384 kHz
- At 44.1 or 48 kHz, the application's normal low-sample-rate warning remains visible because the source audio does not contain the high-frequency information available at higher rates
- Stereo and channel-pair modes are supported; unsupported sample rates or channel modes use the bypass path
- The oversampling filters add a fixed 64-sample latency at every supported rate (about 1.45ms at 44.1 kHz and 0.33ms at 192 kHz)

[Back to all effects](/dsp/effects/)
