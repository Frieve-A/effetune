---
layout: dsp
title: "Vinyl Simulator — EffeTune DSP"
description: "Combines tonal, mechanical, and surface-noise behavior associated with vinyl playback."
lang: en
permalink: /dsp/effects/vinyl-simulator/
---
# Vinyl Simulator

Semantic type: `VinylSimulator` · Category: lo-fi

Combines tonal, mechanical, and surface-noise behavior associated with vinyl playback.

This type has catalog telemetry metadata but no public observation API in v0.1. See [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry).

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate
- Telemetry: **catalog metadata only; observation API unavailable in v0.1**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `cutLevel` | `cut_level` | number / 1 | `0` | dB | -20 … 20 |
| `highFrequencyCutoff` | `high_frequency_cutoff` | number / 1 | `16000` | Hz | 6000 … 24000 |
| `bassMonoBelow` | `bass_mono_below` | number / 1 | `250` | Hz | 50 … 1000 |
| `sideMix` | `side_mix` | number / 1 | `70` | % | 0 … 100 |
| `speed` | `speed` | string / 1 | `"33⅓"` | Not declared in catalog | `33⅓`, `45`, `78` |
| `radius` | `radius` | number / 1 | `120` | mm | 60 … 146 |
| `roughness` | `roughness` | number / 1 | `13.17` | nm | 0.1 … 100 |
| `dustRate` | `dust_rate` | number / 1 | `2` | /s | 0 … 10000 |
| `staticRate` | `static_rate` | number / 1 | `0.08` | /s | 0 … 10000 |
| `scratchRate` | `scratch_rate` | number / 1 | `0` | /s | 0 … 1000 |
| `stylusShape` | `stylus_shape` | string / 1 | `"Elliptical"` | Not declared in catalog | `Spherical`, `Elliptical` |
| `sideRadius` | `side_radius` | number / 1 | `18` | um | 5 … 25 |
| `scanRadius` | `scan_radius` | number / 1 | `8` | um | 2 … 25 |
| `trackingForce` | `tracking_force` | number / 1 | `2` | g | 0.5 … 5 |
| `tipMass` | `tip_mass` | number / 1 | `0.4` | mg | 0.1 … 1.5 |
| `compliance` | `compliance` | number / 1 | `15` | cu | 5 … 35 |
| `damping` | `damping` | number / 1 | `0.25` | zeta | 0.05 … 1 |
| `quality` | `quality` | string / 1 | `"Standard"` | Not declared in catalog | `Eco`, `Standard`, `High`, `Ultra` |
| `outputGain` | `output_gain` | number / 1 | `0` | dB | -24 … 24 |
| `mix` | `mix` | number / 1 | `100` | % | 0 … 100 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Vinyl Simulator

Vinyl Simulator transforms the music itself through a physical record-cutting and stylus-playback model. It applies the cutting filters and RIAA recording curve, writes the signal into a modeled groove with surface roughness and debris, follows that groove with a mechanical stylus and tonearm simulation, and then applies RIAA playback equalization. Use it when you want groove geometry, tracking behavior, and the record surface to interact with the music rather than simply placing record noise on top.

### Vinyl Simulator or Vinyl Artifacts?

- **Vinyl Simulator** changes the input signal by passing it through the modeled groove and stylus. Roughness, dust, static, tracking force, stylus shape, record speed, and radius all take part in the simulation.
- **Vinyl Artifacts** leaves the music signal itself unchanged and adds controllable pops, crackle, hiss, rumble, and stereo noise bleed. Choose it for a lighter, predictable noise layer or when WASM is unavailable.
- The two can be combined, but start with one: using strong surface settings in both can make clicks and noise build up quickly.

### Sound Enhancement Guide

- **Gentle record playback:** Keep Cut Level near 0 dB, use an Elliptical stylus, moderate Roughness, little Dust and Static, and reduce Mix if you want to preserve more of the original signal.
- **Inner-groove character:** Move Radius toward 60 mm. The lower groove speed makes high-frequency detail and tracking more demanding, especially with a low Scan Radius or high Cut Level.
- **Cleaner, more stable playback:** Reduce Roughness, Dust, Static, and Scratch; keep Tracking Force around 2 g; and use Standard or High Quality. Lowering Cut Level also reduces mechanical stress.
- **Aged or damaged surface:** Raise Roughness first, then add Dust, Static, and a small amount of Scratch. These controls represent different physical events, so increasing all of them at once can become overpowering.
- **More obvious groove coloration:** Raise Cut Level carefully, lower HF Cutoff, or use a smaller Radius. Watch the HUD for falling Tracking S/E and rising mistrack or skip rates.
- **Wow and flutter:** Vinyl Simulator does not add speed drift, eccentricity, warping, or turntable rumble. Add **Wow Flutter** elsewhere in the effect chain when you want those behaviors.

### Parameters

#### Cutting

- **Cut Level** (-20 to +20 dB) - Sets how strongly the input drives the cutter. Higher values make groove displacement and tracking nonlinearity more prominent; lower values provide more mechanical headroom.
- **HF Cutoff** (6000 to 24000 Hz) - Sets the high-frequency limit before cutting. Lower values produce a darker, easier-to-track groove; higher values retain more upper-frequency detail and demand more from the stylus.
- **Bass Mono Below** (50 to 1000 Hz) - Sets the range in which the stereo Side component is reduced. Raising it centers more bass and reduces opposing low-frequency motion between the groove walls.
- **Side Mix** (0 to 100%) - Sets how much low-frequency Side information remains below Bass Mono Below. 0% makes that range mono; 100% preserves the original Side level.

#### Record

- **Speed** (33⅓, 45, or 78 rpm) - Sets record rotation speed. Higher speeds increase groove velocity at the same Radius and generally make fine detail easier to trace; they also change the motion of surface features past the stylus.
- **Radius** (60 to 146 mm) - Sets the stylus position on the record. Smaller values represent the inner groove, where linear velocity is lower and high-frequency tracking is more difficult.
- **Roughness** (0.1 to 100 nm) - Sets the microscopic surface roughness used by the contact model. Higher values raise the continuous surface texture.
- **Dust** (0 to 10000/s) - Sets the arrival rate of dust particles in the groove. Higher values create more physical contacts and short disturbances.
- **Static** (0 to 10000/s) - Sets the rate of electrical discharge pulses. This adds sharp pops through the cartridge output rather than changing the groove shape.
- **Scratch** (0 to 1000/s) - Sets the rate of larger groove defects. Use low values for occasional damage or high values for an intentionally distressed effect.

#### Stylus

- **Shape** (Spherical or Elliptical) - Selects the contact geometry. Elliptical emphasizes directional groove tracing; Spherical links Scan Radius to Side Radius and gives a rounder contact profile. Changing Shape rebuilds the simulation state.
- **Side Radius** (5 to 25 µm) - Sets the stylus radius across the groove wall. It changes the contact footprint and pressure distribution.
- **Scan Radius** (2 to 25 µm) - Sets the radius used along the direction of groove travel. Smaller values follow finer geometry; larger values average it over a broader contact. In Spherical mode it follows Side Radius.
- **Tracking Force** (0.5 to 5.0 g) - Sets downward stylus force. More force can improve contact stability but increases contact force and pressure; too little can raise mistrack and skip activity.
- **Tip Mass** (0.1 to 1.5 mg) - Sets the moving mass of the stylus tip. Higher values increase inertia and make rapid groove motion harder to follow.
- **Compliance** (5 to 35 cu) - Sets suspension flexibility. Higher values allow more movement for a given force and shift the mechanical response.
- **Damping** (0.05 to 1.0 ζ) - Controls mechanical resonance damping. Higher values suppress ringing more strongly; very low values allow a more resonant response.

#### Output

- **Quality** (Eco, Standard, High, or Ultra) - Selects the base number of physical integration substeps and contact scan points. To keep the contact resonance stable, the engine may automatically raise the effective substeps above this base according to sample rate, Tracking Force, Tip Mass, Compliance, Shape, Side Radius, and Scan Radius. Standard is the default for real-time listening. Changing Quality rebuilds the simulation state.
- **Output Gain** (-24 to +24 dB) - Adjusts the level after playback equalization and normalization. Reduce it if strong cutting or surface settings create high peaks.
- **Mix** (0 to 100%) - Blends the simulated playback with a latency-aligned dry signal. 0% is dry and 100% is fully simulated.

### Reading the HUD

- **Force L/R (mN)** shows contact force on each groove wall. Large or strongly unequal values indicate demanding groove motion or uneven contact.
- **Pressure (GPa)** shows the higher current contact pressure. Use it together with Force when adjusting Tracking Force and stylus radii.
- **Tip (cm/s and dB)** shows stylus-tip velocity and the resulting playback level.
- **Tracking S/E L/R (dB)** compares tracked signal with tracking error. Higher values indicate cleaner tracing; a sustained fall means the stylus is struggling to follow the groove.
- **Jitter (ns)** appears with the Stylus view and reports timing variation at the groove read point.
- **Mistrack, Skip, Static Pop, and Dust Hit (/s)** show recent event rates. A flash marks a new event; repeated mistracks or skips suggest reducing Cut Level, increasing Tracking Force moderately, choosing a larger Radius, or raising Quality.

The HUD becomes active when native DSP telemetry is available. When playback is stopped or telemetry is paused to save power, it may show an idle state rather than live values.

### Recommended Settings

1. **Gentle Physical Playback**
   - Cut Level: 0 dB, HF Cutoff: 16 kHz, Bass Mono Below: 250 Hz, Side Mix: 70%
   - Speed: 33⅓ rpm, Radius: 120 mm, Roughness: 5 nm, Dust: 0.5/s, Static: 0.02/s, Scratch: 0/s
   - Shape: Elliptical, Side Radius: 18 µm, Scan Radius: 8 µm, Tracking Force: 2.0 g, Quality: Standard, Mix: 75%

2. **Classic Outer-Groove Playback**
   - Cut Level: 0 dB, HF Cutoff: 16 kHz, Speed: 33⅓ rpm, Radius: 135 mm
   - Roughness: 13.17 nm, Dust: 2/s, Static: 0.08/s, Scratch: 0/s
   - Shape: Elliptical, Tracking Force: 2.0 g, Quality: Standard, Mix: 100%

3. **Inner-Groove Demonstration**
   - Cut Level: +3 dB, HF Cutoff: 14 kHz, Speed: 33⅓ rpm, Radius: 60 mm
   - Shape: Elliptical, Scan Radius: 8 µm, Tracking Force: 2.0 g, Quality: High, Mix: 100%
   - Watch Tracking S/E and the event counters while comparing this with a larger Radius.

4. **Worn Surface**
   - Cut Level: 0 dB, Speed: 33⅓ rpm, Radius: 100 mm, Roughness: 35 nm
   - Dust: 25/s, Static: 1/s, Scratch: 0.5/s, Tracking Force: 2.2 g, Quality: Standard, Output Gain: -3 dB, Mix: 100%

### Quality and CPU Guide

Each Quality preset sets base substeps and contact scan points. For stability, the engine also calculates `Nmin = ceil(8 × f_c / sampleRate)`, where the contact-resonance frequency `f_c` depends on Tracking Force, Tip Mass, Compliance, Shape, Side Radius, and Scan Radius, then uses `effectiveSubsteps = max(base, Nmin)`. At the default settings, Standard at 96 kHz remains at its base of 4 substeps, so the existing performance target is unchanged.

The main workload is proportional to sample rate × effective substeps × contact scan points. The contact-evaluation and relative-load figures below are base estimates for when the stability floor does not raise the substeps, not measured CPU percentages; actual load also depends on the processor, browser, and availability of WASM SIMD.

| Quality | Base detail | Base evaluations at 96 kHz | Base relative load | Suggested use |
|---|---:|---:|---:|---|
| Eco | 2 substeps × 7 scan points | 2.7 million/s | 0.39× | Mobile, low-power systems, or several instances |
| Standard | 4 × 9 | 6.9 million/s | 1.00× | Normal real-time listening |
| High | 8 × 13 | 20 million/s | 2.89× | Faster systems or focused comparison |
| Ultra | 20 × 25 | 96 million/s | 13.89× | Offline rendering and verification |

When the stability floor is inactive, apply the following sample-rate multiplier to the base relative load: 44.1 kHz = 0.46×, 48 kHz = 0.50×, 88.2 kHz = 0.92×, 96 kHz = 1.00×, 176.4 kHz = 1.84×, and 192 kHz = 2.00×. Sample rate and the Tracking Force, Tip Mass, Compliance, Shape, Side Radius, and Scan Radius settings can activate the floor and make the actual load higher than this base estimate. If playback breaks up, lower Quality first.

### WASM Requirement and Model Limits

Vinyl Simulator requires the native WebAssembly DSP kernel for real-time processing. If WASM is disabled with `?dsp=off`, unsupported, or fails to initialize, the effect passes the input through unchanged and the UI reports that WASM is required. It does not fall back to the much slower JavaScript reference simulation.

The model processes the first stereo pair. Dust deformation is retained only while each simulated particle remains active; the stylus always advances into newly generated groove, so wear does not accumulate over repeated revolutions and is not saved with presets. Long-term record wear, 3D visualization, real-time SNR/THD meters, wow/flutter, eccentricity, warping, turntable rumble, and cartridge electrical loading are outside this effect's model.

Remember: These effects are meant to add character and nostalgia to your music. Start with subtle settings and adjust to taste!

[Back to all effects](/dsp/effects/)
