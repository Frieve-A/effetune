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
| `inputVolume` | `input_volume` | number / 1 | `-44.0059` | dB | -96 … 0 |
| `tube` | `tube` | string / 1 | `"12AX7"` | Not declared in catalog | `12AX7`, `12AT7`, `12AU7`, `Bypass` |
| `bias` | `bias` | number / 1 | `0` | % | -50 … 50 |
| `plateVoltage` | `plate_voltage` | number / 1 | `250` | V | 150 … 300 |
| `sourceImpedance` | `source_impedance` | number / 1 | `10` | kOhm | 0.6 … 100 |
| `supplyImpedance` | `supply_impedance` | number / 1 | `10` | kOhm | 0.1 … 47 |
| `outputTrim` | `output_trim` | number / 1 | `-7.372` | dB | -48 … 48 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |
| `inputReference` | `input_reference` | number / 1 | `2.828` | Vpk | 0.1 … 300 |
| `negativeFeedback` | `negative_feedback` | number / 1 | `3` | dB | 0 … 30 |
| `outputStage` | `output_stage` | string / 1 | `"Power"` | Not declared in catalog | `Line`, `Power`, `SingleEnded` |
| `powerTube` | `power_tube` | string / 1 | `"EL84"` | Not declared in catalog | `EL84`, `EL34`, `6L6GC`, `KT88` |
| `powerBPlus` | `power_bplus` | number / 1 | `329.696` | V | 300 … 470 |
| `cathodeResistor` | `cathode_resistor` | number / 1 | `270` | Ohm | 270 … 500 |
| `screenTap` | `screen_tap` | string / 1 | `"0"` | Not declared in catalog | `0`, `20`, `43` |
| `primaryImpedance` | `primary_impedance` | string / 1 | `"8.0"` | Not declared in catalog | `6.0`, `6.6`, `8.0` |
| `speakerLoad` | `speaker_load` | string / 1 | `"15"` | Not declared in catalog | `4`, `8`, `15`, `16` |
| `actualSpeakerLoad` | `actual_speaker_load` | number / 1 | `15` | Ohm | 2 … 32 |
| `safetyTrim` | `safety_trim` | number / 1 | `0` | dB | -96 … 0 |
| `autoGainReduction` | `auto_gain_reduction` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |
| `seTube` | `se_tube` | string / 1 | `"300B"` | Not declared in catalog | `300B`, `2A3` |
| `seBPlus` | `se_bplus` | number / 1 | `400` | V | 250 … 450 |
| `seCathodeResistor` | `se_cathode_resistor` | number / 1 | `1000` | Ohm | 700 … 1300 |
| `sePrimaryImpedance` | `se_primary_impedance` | string / 1 | `"3.5"` | Not declared in catalog | `2.5`, `3.5`, `5.0` |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Tube Simulator

Tube Simulator models a complete electrical signal path built from tube-circuit component values. **Line** uses the two-stage small-signal tube amplifier by itself. **Push-Pull Power** normally passes that driver through a 12AX7 phase inverter and a pair of EL84, EL34, 6L6GC, or KT88 output tubes. **SE Triode** normally passes the driver to one 300B or 2A3, without a phase inverter or screen supply, and uses a gapped single-ended output transformer. Selecting **Bypass** for Driver Type removes the common two-stage driver: Push-Pull Power still runs its required phase inverter and output pair, while SE Triode feeds the selected output triode directly. Both power topologies feed the same frequency-dependent speaker-load model. Bias, B+, transformer, and speaker-load states are solved as the music changes, so harmonic content, compression, supply sag, and electrical damping respond to the signal instead of being added as a fixed distortion curve. The speaker load models the electrical load on the amplifier; it is not a cabinet or microphone simulation.

### Listening Enhancement Guide

- The plug-in opens on **EL84 Pentode @2%**, including its level-matched Output Trim of -7.372dB.
- If it sounds too saturated, lower Input Volume to reduce the voltage entering the circuit, then use Output Trim only to restore the listening level. Output Trim does not recover internal headroom.
- Select a **Pre** preset at **0.01%** or **0.1%** for transparent line-stage coloration, or retain the existing **@1%** choices when you want the harmonics to be more apparent.
- Use the **Pre** group for the two-stage driver by itself, **Power** for power circuits with Driver Type set to Bypass, and **Pre+Power** for the complete driver-and-power signal path. Every selectable preset is calibrated for a listening-oriented distortion level and matched playback level.
- In **Power**, use **300B SE @0.1%** or **2A3 SE @0.1%** for a lightly driven output triode by itself. Their **@1%** versions reproduce the higher small-signal distortion expected from directly driven class-A single-ended triodes without adding the common driver stage.
- For a restrained power-amplifier response, start with **EL84 Distributed 10 W @2%**. Compare it with **EL84 Pentode 10 W @2%** to hear the effect of the screen connection and transformer loading while keeping the output-tube family the same.
- Use **EL34 Distributed 20–37 W @2%** when you want to explore the higher-voltage EL34 circuit. Its preset level is already matched with the other Power and Pre+Power settings.
- Use **6L6GC Pentode @2%** for the lower-transconductance beam-tetrode circuit, or **KT88 Distributed @2%** for the higher-current KT88 model with a 43% screen tap.
- Select **300B SE @2%** and **2A3 SE @2%** to compare the complete single-ended circuits. A single output tube does not cancel even-order harmonics as a balanced push-pull pair does.
- For SE Triode, start with the preset's 3dB Negative Feedback. The useful light-feedback range is normally 0–6dB: 0dB opens the loop, while 6dB gives a more controlled response without turning it into a high-feedback design.
- Lower Negative Feedback for more of the circuit's open-loop harmonic and level response; raise it for a more controlled closed-loop response. Some extreme combinations can become unstable, so return to a preset if the safety bypass appears.
- Lower Wet/Dry Mix when you want the modeled circuit to remain a subtle part of the result.

### Panel Layout

The 24 parameters are arranged in five tabs below the **Preset** dropdown.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Driver Type, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit; Push-Pull Power Tube, Output B+, and Cathode Resistor; SE Triode, SE B+, and SE Cathode Resistor
- **Transformer** - Screen Tap, Push-Pull Primary, SE Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

The Preset dropdown lists **Custom** first, followed by the **Pre**, **Power**, and **Pre+Power** groups. The Pre group contains eight calibrated Line settings, Power contains fourteen calibrated power-stage-only settings with Driver Type set to Bypass, and Pre+Power contains thirteen calibrated complete driver-and-power settings. The uncalibrated canonical circuit records are kept internally as the single source of circuit constants, but are not duplicated in the menu. Custom is shown whenever the current settings match no preset; the output-protection settings (Output Safety Trim and Auto Gain Reduction) are not part of that comparison. The Power and Transformer tabs show only controls used by the selected Output Circuit: Line hides every power-output control, Push-Pull Power hides the four SE-only controls, and SE Triode hides the five push-pull-only controls. Hidden controls keep their values for the next time that circuit is selected.

### Circuit Presets and Defaults

At startup, every circuit, drive, load, and output value matches **EL84 Pentode @2%**, so the Preset dropdown opens on that entry. Changing a preset-matched circuit, drive, or output value then shows Custom; Output Safety Trim and Auto Gain Reduction are excluded from matching, so changing either protection setting does not change the preset selection.

The table below records the internal canonical circuit values inherited by the selectable presets. These records preserve the modeled circuit designs but are not separate menu entries; exposing both them and their calibrated forms would create duplicate circuits with unsafe or inaudible drive levels. Selecting a preset writes the complete calibrated circuit.

| Circuit Preset | Output Circuit | Driver / Power Tubes | Negative Feedback | Power settings | Input / output |
| --- | --- | --- | ---: | --- | --- |
| Line Default | Line | 12AU7 / — | 30dB | Power-control values retained but hidden | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim +9dB |
| EL84 Pentode 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 329.696 V, Cathode Resistor 270 Ω / valve, Screen Tap 0%, Transformer Primary 8.0 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim -19.675dB |
| EL84 Distributed 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 330.107 V, Cathode Resistor 270 Ω / valve, Screen Tap 20%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim -17.331dB |
| EL34 Distributed 20–37 W | Push-Pull Power | 12AX7 / EL34 ×2 | 4dB | Output B+ 443.775 V, Cathode Resistor 470 Ω / valve, Screen Tap 43%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 8 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim -17.230dB |
| 6L6GC Pentode | Push-Pull Power | 12AX7 / 6L6GC ×2 | 3dB | Output B+ 391.454 V, Cathode Resistor 483.871 Ω / valve, Screen Tap 0%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 8 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim -15.267dB |
| KT88 Distributed | Push-Pull Power | 12AX7 / KT88 ×2 | 4dB | Output B+ 379.290 V, Cathode Resistor 400 Ω / valve, Screen Tap 43%, Transformer Primary 6.0 kΩ, Assumed Speaker Load 8 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim -16.166dB |
| 300B Single-Ended | SE Triode | 12AU7 / 300B | 3dB | SE B+ 400 V, SE Cathode Resistor 1000 Ω, SE Primary 3.5 kΩ, Assumed Speaker Load 8 Ω | Input Volume -42dB, Input Reference 2.828 Vpk, Output Trim +38.795dB |
| 2A3 Single-Ended | SE Triode | 12AU7 / 2A3 | 3dB | SE B+ 300 V, SE Cathode Resistor 750 Ω, SE Primary 2.5 kΩ, Assumed Speaker Load 8 Ω | Input Volume -42dB, Input Reference 2.828 Vpk, Output Trim +37.461dB |

All eight canonical bases use Bias 0%, Plate 250 V, Source Z 10 kΩ, Supply 10 kΩ, and Wet/Dry Mix 100%. Every selectable preset also sets Actual Speaker Load to its Assumed Speaker Load, so it starts at the circuit's design point.

The added Power designs keep published circuit data separate from the choices imposed by the plugin controls. The 6L6GC preset follows the cathode-referenced push-pull AB1 row in the [Ei-RC 6L6GC data](https://frank.pocnet.net/sheets/084/6/6L6GC.pdf); its cathode resistor is the DC-equivalent bias for that fixed-bias row. The KT88 current model follows the cathode-bias ultra-linear row in the [GEC KT88 data](https://keith-snook.info/valve-data/KT88%20GEC%20Data.pdf), while its published 40% tap and 5 kΩ load are projected to the available 43% and 6.0 kΩ controls. The primary winding resistance and small-signal inductances use the measured [Monolith B-8/6K6](https://www.monolithmagnetics.com/sites/default/files/datasheets/Push-Pull-output-transformers/datasheet%20B-8%206K6%20300B%20push%20pull%20output%20tube%20amplifier%20transformer%20prelim.pdf) and [B-8/8k](https://www.monolithmagnetics.com/sites/default/files/B-8_8k_0.pdf) values. Other transformer-loss, resonance, feedback, and power-supply coefficients remain explicit model parameters rather than claimed measurements of those transformers.

### Calibrated Presets

All 35 selectable settings use the same reproducible calibration point shared with the Pipeline Analyzer default: THD and playback level are measured with a 96 kHz, 1 kHz, -12dBFS-peak sine (sine RMS -15.01dBFS) after three seconds of settling, at the preset's design speaker load and with Auto Gain Reduction disabled. The level was chosen as a practical reference that approximates the average-to-loud body of typical mastered commercial music without treating occasional near-full-scale peaks as normal. It is not a loudness standard and does not guarantee the same THD on real music. The Measured THD values in the table apply only to the settled sine; instantaneous THD on music varies with the waveform, crest factor, spectrum, instantaneous level, and circuit state. Input Volume and Input Reference set the sine-wave distortion point; Output Trim then sets 0dB AC RMS gain at the same reference. Power-only KT88 uses 2dB Negative Feedback for stability; the corresponding Pre+Power circuit retains 4dB.

| Group | Preset | Input Volume | Input Reference | Output Trim | Measured THD |
| --- | --- | ---: | ---: | ---: | ---: |
| Pre | Line 12AT7 @0.01% | -13.7480dB | 2.828 Vpk | +0.619dB | 0.0100% |
| Pre | Line 12AT7 @0.1% | 0dB | 4.5552 Vpk | -17.268dB | 0.1000% |
| Pre | Line 12AX7 @0.01% | -24.2637dB | 2.828 Vpk | +8.508dB | 0.0100% |
| Pre | Line 12AX7 @0.1% | -4.4922dB | 2.828 Vpk | -11.264dB | 0.1000% |
| Pre | Line 12AU7 Open-Loop @0.1% | -19.2715dB | 2.828 Vpk | +28.495dB | 0.1000% |
| Pre | Line 12AT7 @1% | 0dB | 7.3556 Vpk | -21.421dB | 0.9974% |
| Pre | Line 12AX7 @1% | 0dB | 6.7213 Vpk | -23.276dB | 1.0003% |
| Pre | Line 12AU7 Open-Loop @1% | -9.2656dB | 2.828 Vpk | +18.592dB | 1.0002% |
| Power | EL84 Pentode 10 W @0.1% | -26.5957dB | 2.828 Vpk | +8.696dB | 0.1001% |
| Power | EL84 Distributed 10 W @0.1% | -21.7676dB | 2.828 Vpk | +7.363dB | 0.1002% |
| Power | EL34 Distributed 20–37 W @0.1% | -8.1543dB | 2.828 Vpk | +3.767dB | 0.1000% |
| Power | 6L6GC Pentode @0.1% | -19.3047dB | 2.828 Vpk | +12.251dB | 0.1003% |
| Power | KT88 Distributed @0.1% | 0dB | 3.1263 Vpk | -3.485dB | 0.1002% |
| Power | 300B SE @0.1% | 0dB | 35.4586 Vpk | +16.582dB | 0.1000% |
| Power | 300B SE @1% | 0dB | 295.9454 Vpk | -1.794dB | 1.0000% |
| Power | 2A3 SE @0.1% | 0dB | 18.1347 Vpk | +21.072dB | 0.1000% |
| Power | 2A3 SE @1% | 0dB | 167.2455 Vpk | +1.816dB | 1.0000% |
| Power | EL84 Pentode 10 W @2% | -9.7148dB | 2.828 Vpk | -7.483dB | 1.9995% |
| Power | EL84 Distributed 10 W @2% | -6.5352dB | 2.828 Vpk | -7.322dB | 2.0005% |
| Power | EL34 Distributed 20–37 W @2% | 0dB | 5.2781 Vpk | -9.510dB | 1.9995% |
| Power | 6L6GC Pentode @2% | 0dB | 3.3694 Vpk | -7.187dB | 2.0004% |
| Power | KT88 Distributed @2% | 0dB | 7.4992 Vpk | -10.748dB | 1.9970% |
| Pre+Power | EL84 Distributed @0.1% | -58.4629dB | 2.828 Vpk | +9.910dB | 0.1000% |
| Pre+Power | EL34 Distributed @0.1% | -56.4629dB | 2.828 Vpk | +17.947dB | 0.1000% |
| Pre+Power | 6L6GC Pentode @0.1% | -58.4551dB | 2.828 Vpk | +17.255dB | 0.1000% |
| Pre+Power | KT88 Distributed @0.1% | -56.4629dB | 2.828 Vpk | +21.698dB | 0.1000% |
| Pre+Power | 300B SE @0.1% | -15.2227dB | 2.828 Vpk | +12.027dB | 0.1000% |
| Pre+Power | 2A3 SE @0.1% | -23.2598dB | 2.828 Vpk | +18.722dB | 0.1000% |
| Pre+Power | EL84 Pentode @2% | -44.0059dB | 2.828 Vpk | -7.372dB | 2.0004% |
| Pre+Power | EL84 Distributed @2% | -40.9746dB | 2.828 Vpk | -7.091dB | 2.0005% |
| Pre+Power | EL34 Distributed @2% | -31.6797dB | 2.828 Vpk | -6.779dB | 2.0000% |
| Pre+Power | 6L6GC Pentode @2% | -35.2070dB | 2.828 Vpk | -5.145dB | 1.9998% |
| Pre+Power | KT88 Distributed @2% | -31.5391dB | 2.828 Vpk | -3.147dB | 1.9997% |
| Pre+Power | 300B SE @2% | -2.4824dB | 2.828 Vpk | -0.439dB | 2.0000% |
| Pre+Power | 2A3 SE @2% | -4.2266dB | 2.828 Vpk | -0.093dB | 2.0002% |

The Line 12AU7 Open-Loop circuit needs about +48.5dB of Output Trim to level-match its 0.01% point, just beyond the current +48dB limit, so only its 0.1% and 1% settings are offered. The complete EL84 Pentode path bottoms out at 0.3055% in the usable measurement region, so it has no Pre+Power @0.1% preset. The Input Reference range was extended to 300 Vpk so the driver-bypassed 300B and 2A3 SE circuits can reach calibrated 0.1% and 1% points without altering their circuit designs. Older nonselectable SE compatibility records remain fixed at 20 Vpk, while the new selectable presets use distinct calibration records.

### Parameters

- **Preset** - Loads a Pre, Power, or Pre+Power setting
- **Input Volume** (-96 to 0dB) - Attenuates the calibrated input before the selected active signal path
  - 0dB is fully open; lower values reduce internal drive and increase headroom
- **Driver Type** (12AX7, 12AT7, 12AU7, or Bypass) - Selects the two-stage driver tubes or removes that driver from the signal path
  - 12AX7 has the highest voltage gain, 12AT7 is intermediate, and 12AU7 has the lowest gain and the most headroom
  - In Push-Pull Power it feeds the fixed 12AX7 phase inverter; in SE Triode it drives the selected output triode directly
  - Bypass is intended for the Power presets. Push-Pull Power still includes its phase inverter; SE Triode feeds the output triode without the common driver. Line with Bypass is an aligned pass-through, and Negative Feedback has no effect there
- **Bias** (-50 to +50%) - Shifts the cathode-bias point of the two driver stages
  - Raising it lowers their modeled cathode resistance and moves them toward higher current; lowering it does the opposite
- **Plate** (150 to 300 V) - Sets the driver-stage plate supply
  - Higher values generally provide more voltage headroom; lower values bring compression and nonlinearity in sooner
- **Source Z** (0.6 to 100 kΩ) - Sets the source impedance feeding Stage 1
  - Higher values interact more strongly with the input capacitances and can soften high-frequency or transient drive
- **Supply** (0.1 to 47 kΩ) - Sets the resistance of the driver-stage B+ supply
  - Higher values produce more supply sag as current rises; lower values make the supply stiffer
- **Negative Feedback** (0 to 30dB) - Sets the calibrated global negative-feedback amount
  - Line returns the second-stage plate response; both power topologies return a fixed transformer-secondary feedback winding
  - Increasing it generally reduces open-loop gain and distortion and tightens the response; 0dB opens the feedback loop
  - SE Triode is intended for light feedback: start at 3dB and normally stay within 0–6dB
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
- **Input Reference** (0.100 to 300.000 Vpk) - Peak terminal voltage represented by a digital 0dBFS peak
  - 2.828 Vpk corresponds to a 2 Vrms full-scale sine; 5.657 Vpk corresponds to 4 Vrms
  - The active signal path receives Input Reference multiplied by Input Volume; this is physical calibration, not another output-gain control
- **Output Circuit** (Line, Push-Pull Power, or SE Triode) - Selects the modeled topology
  - Line stops after the two-stage driver and does not run the power-tube, transformer, or speaker-load model
  - Push-Pull Power adds the phase inverter and complete power-output circuit
  - SE Triode adds one directly driven 300B or 2A3 and a gapped single-ended output transformer
- **Power Tubes** (EL84 ×2, EL34 ×2, 6L6GC ×2, or KT88 ×2) - Selects the output-tube current model and its associated circuit components; it affects only Power mode
  - All four models follow real output-tube data across plate, screen, and grid voltage, including the complete cutoff reached when the grid is driven far enough negative
- **Output B+** (300 to 470 V) - Sets the power-stage supply voltage; higher values increase available voltage swing and tube dissipation
- **Cathode Resistor** (270 to 500 Ω / valve) - Sets the separate cathode-bias resistor for each output tube
  - Higher resistance reduces the idle current; lower resistance raises it
- **SE Triode** (300B or 2A3) - Selects the single-ended directly heated output-triode model; it affects only SE Triode mode
- **SE B+** (250 to 450 V) - Sets the single-ended output-stage supply voltage
- **SE Cathode Resistor** (700 to 1300 Ω) - Sets the single output triode's cathode-bias resistor
- **Screen Tap** (0%, 20%, or 43%) - Selects the output-tube screen connection
  - 0% uses the fixed screen supply; 20% and 43% connect the screens to the corresponding transformer-primary taps for distributed (ultra-linear) loading
  - The tap is a turns ratio, so the screens follow that share of the magnetic coupling in the primary winding
- **Push-Pull Primary** (6.0, 6.6, or 8.0 kΩ) - Selects the push-pull output transformer's plate-to-plate primary impedance and, together with Assumed Speaker Load, its turns ratio
- **SE Primary** (2.5, 3.5, or 5.0 kΩ) - Selects the gapped single-ended transformer's primary impedance and, together with Assumed Speaker Load, its turns ratio
- **Assumed Speaker Load** (4, 8, 15, or 16 Ω) - Selects the transformer secondary tap and the nominal speaker impedance the circuit is built around
  - Each choice uses a frequency-dependent electrical RLC load rather than a simple resistor and affects transformer loading and feedback
- **Actual Speaker Load** (2 to 32 Ω) - Sets the impedance of the speaker actually connected to that tap
  - The load network is scaled by its ratio to Assumed Speaker Load, so the resonance frequency and Q are kept and only the impedance level moves
  - The turns ratio stays on Assumed Speaker Load, so a mismatch reflects a different impedance to the output tubes and changes damping, available power, and drive; setting the two alike runs the circuit at its design point

### Output Level Protection

Loading any preset applies its calibrated Output Trim, so all 35 selectable presets are level-matched under the reference conditions above. Manually changing Driver Type, Output Circuit, or another parameter does not automatically compensate Output Trim and can therefore cause a large level jump. Output Safety Trim and Auto Gain Reduction protect the equipment connected to the output from such jumps.

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

- If the circuit model detects feedback oscillation, it fades the wet circuit output to the latency-aligned dry path and latches the safe bypass. Lower Negative Feedback, select an available preset, or change another circuit setting. The new setting is checked while the output stays dry; stable operation returns with a smooth fade, while continuing instability remains bypassed.
- If the model encounters another processing-safety failure, it switches to the safe dry output. Restore the default circuit settings, then reload the effect.
- Unsupported sample rates or channel modes, unavailable WebAssembly processing, and a stopped processing engine also bypass the effect. The status below the HUD explains the action to take.

### How to Read the HUD

- **Input Reference (0 dBFS)** shows the terminal calibration as Vpk, sine Vrms, and **dBuFS**. **Stage 1 External Input (0 dBFS)** shows the peak after Input Volume.
- **Stage 1 Bias**, **Stage 2 Bias**, **B+**, and **Plate − B+ Sag** report the live operating points of the two-stage driver. They show unavailable values when Driver Type is Bypass. A more negative sag value means the plate sits farther below its supply.
- In Line, the two graph panels show Stage 1 and Stage 2. The thin gray curves are static plate characteristics and the dashed line is the load line, while the recent operating points are plotted as individual points rather than a connected line.
- In Push-Pull Power, the graph panels change to **Push** and **Pull** load lines and plot the two output tubes' recent plate-current operating points.
- In SE Triode, the graph panels show the left and right channels of the single output-triode circuit over its plate curves and load line.
- The horizontal graph axis is anode-to-cathode voltage, **Vak (V)**, and the vertical axis is plate current, **Ia (mA)**. Cyan is the left audio channel and orange is the right; points spread over a wider area mean the signal is moving that stage through a wider operating range.
- **Power LTP Balance** shows the push-pull phase inverter's differential voltage. **Power B+** shows the live power-stage supply after sag in either power topology.
- **Speaker Output (100 ms)** and **Speaker Real Power (100 ms)** show non-overlapping 100 ms electrical measurements at the selected speaker load. Real Power is calculated from instantaneous load voltage and current, so it is not simply Vrms squared divided by the nominal impedance.
- **Transformer Flux** shows the output transformer's modeled magnetic flux in webers. Power-output readings are meaningful in Push-Pull Power and SE Triode.
- The status below the graph reports whether processing is loading, active, or safely bypassed, and always shows the current output-protection reduction in dB, including when it is 0.0 dB.

### Processing Requirements and Latency

- Tube Simulator processes 44.1, 48, 88.2, 96, 176.4, and 192 kHz audio using WebAssembly
- The 44.1 kHz rate family is processed internally at 352.8 kHz, and the 48 kHz rate family is processed internally at 384 kHz
- At 44.1 or 48 kHz, the application's normal low-sample-rate warning remains visible because the source audio does not contain the high-frequency information available at higher rates
- Stereo and channel-pair modes are supported; unsupported sample rates or channel modes use the bypass path
- The oversampling filters add a fixed 64-sample latency at every supported rate (about 1.45ms at 44.1 kHz and 0.33ms at 192 kHz)

[Back to all effects](/dsp/effects/)
