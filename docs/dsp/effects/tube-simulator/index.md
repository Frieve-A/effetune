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

Tube Simulator adds the changing harmonics, compression, and power-supply response of tube line and power-amplifier circuits. **Line** uses the driver stage alone, **Push-Pull Power** offers balanced EL84, EL34, 6L6GC, and KT88 circuits, and **SE Triode** offers single-ended 300B and 2A3 circuits. Both power circuits also model the output transformer core, whose magnetic saturation and hysteresis add distortion on loud low frequencies. It models the amplifier's electrical speaker load, but does not add a speaker cabinet or microphone sound.

### Listening Enhancement Guide

- For subtle coloration, choose the **Pre** group with an **@0.01%** or **@0.1%** suffix. Choose an **@1%** or **@2%** suffix when you want the added harmonics and compression to be easier to hear.
- Choose **Pre** for the line-stage sound, **Power** for the output stage alone, or **Pre+Power** for the complete amplifier path.
- Start with **EL84 Distributed 10 W @2%** for a restrained push-pull sound. Compare it with **EL84 Pentode 10 W @2%** for a firmer, more direct character.
- Try **300B SE @2%** or **2A3 SE @2%** for stronger even-order harmonics and a softer single-ended response.
- Lower **Input Volume** if the sound is too compressed or distorted. Use **Output Trim** afterward to match the listening level.
- Lower **Negative Feedback** for a looser, more harmonically colored response; raise it for tighter control. For SE Triode, start at 3dB and stay near 0-6dB.
- Lower **Wet/Dry Mix** when you want only a trace of the effect.

### Panel Layout

The controls are arranged in five tabs below **Preset**.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Driver Type, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit; Push-Pull Power Tube, Output B+, and Cathode Resistor; SE Triode, SE B+, and SE Cathode Resistor
- **Transformer** - Screen Tap, Push-Pull Primary, SE Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

The Power and Transformer tabs show only controls used by the selected Output Circuit. **Custom** appears after you change a circuit or tone parameter from a preset.

### Choosing a Preset

Tube Simulator starts with **EL84 Pentode @2%**; changing a circuit or tone parameter changes the preset name to **Custom**, while **Output Safety Trim** and **Auto Gain Reduction** are not used for preset matching and therefore do not change the preset name.

The preset suffix is a practical guide to effect strength: **@0.01%** is very subtle, **@0.1%** adds light coloration, and **@1%** or **@2%** makes harmonics and compression more apparent. Presets also set Output Trim to make comparisons easier, but perceived loudness can still vary with the music. Match levels with Output Trim before deciding which sound you prefer.

### Parameters

- **Preset** - Loads a Pre, Power, or Pre+Power setting
- **Input Volume** (-96 to 0dB) - Reduces the level driving the selected signal path
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
- **Negative Feedback** (0 to 30dB) - Sets the global negative-feedback amount
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
  - Higher values drive the modeled circuit harder; use Input Volume for the main listening adjustment
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
  - The choice also sets the core's magnetic saturation flux
- **SE Primary** (2.5, 3.5, or 5.0 kΩ) - Selects the gapped single-ended transformer's primary impedance and, together with Assumed Speaker Load, its turns ratio
  - The choice also sets how much flux a given signal drives into the gapped core, so higher impedances reach saturation sooner at the same level. The idle current of single-ended operation keeps a standing flux in the core, so the signal saturates it asymmetrically and adds even-order harmonics at low frequencies
- **Assumed Speaker Load** (4, 8, 15, or 16 Ω) - Selects the transformer secondary tap and the nominal speaker impedance the circuit is built around
  - Each choice uses a frequency-dependent electrical RLC load rather than a simple resistor and affects transformer loading and feedback
- **Actual Speaker Load** (2 to 32 Ω) - Sets the impedance of the speaker actually connected to that tap
  - The load network is scaled by its ratio to Assumed Speaker Load, so the resonance frequency and Q are kept and only the impedance level moves
  - The turns ratio stays on Assumed Speaker Load, so a mismatch reflects a different impedance to the output tubes and changes damping, available power, and drive; setting the two alike runs the circuit at its design point

### Output Level Protection

Changing circuit parameters can cause a large level jump. With **Auto Gain Reduction** on, Tube Simulator lowers **Output Safety Trim** when the wet output would exceed digital full scale. The reduction stays in place rather than recovering automatically, and the status below the graph shows the current amount.

- If the reduction becomes large, lower Input Volume or Output Trim, then select a preset again or adjust Output Safety Trim.
- Turn Auto Gain Reduction off only when you are already monitoring output peaks elsewhere.
- This protection reduces output level; it does not remove the harmonic distortion or compression created inside the selected circuit.

### Safety Bypass and Recovery

- If an unstable setting activates bypass, lower Negative Feedback or select a preset. Processing returns automatically once the setting is stable.
- If the status still shows bypass, restore a preset and reload the effect. When processing is unavailable on the device, the audio passes through unchanged.

### How to Read the HUD

- The dots show recent operating points. A wider spread means the music is driving that stage harder.
- In Line mode, the panels show the two driver stages. Push-Pull mode shows the two output sides, and SE Triode shows the left and right channels.
- **Speaker Output** and **Speaker Real Power** show how strongly the modeled power stage and speaker load are being driven.
- **Transformer Flux** shows the magnitude of the output transformer's flux linkage in Wb. The harder low frequencies push this reading upward, the more distortion the transformer itself is adding. In SE Triode the reading includes the standing bias flux of the gapped core, so it stays above zero even with no signal.
- The status below the graph shows whether the effect is active or bypassed and displays any automatic output reduction.

Tube Simulator adds a short processing delay of about 0.3-1.5ms, depending on sample rate.

[Back to all effects](/dsp/effects/)
