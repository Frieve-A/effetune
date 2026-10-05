---
layout: dsp
title: "Bass Management — EffeTune DSP"
description: "Routes managed main-channel bass and dedicated LFE inputs to selected subwoofer outputs."
lang: en
permalink: /dsp/effects/bass-management/
---
# Bass Management

Semantic type: `BassManagement` · Category: basics

Routes managed main-channel bass and dedicated LFE inputs to selected subwoofer outputs.

Some configurations use an external asset. See [Assets and bundles](/dsp/concepts/assets-and-bundles/) for resolver and bundle contracts.

## Contract

- Seeded: **yes**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **impulseResponse (impulseResponse)**
- Catalog-declared latency: **dynamic**; depends on phase, taps

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `phase` | `phase` | string / 1 | `"IIR"` | Not declared in catalog | `IIR`, `Linear` |
| `taps` | `taps` | string / 1 | `"16384"` | Not declared in catalog | `8192`, `16384`, `32768` |
| `roles` | `roles` | integer / 16 | `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]` | Not declared in catalog | 0 … 3 |
| `frequencies` | `frequencies` | number / 16 | `[80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80]` | Hz | 20 … 300 |
| `slopes` | `slopes` | integer / 16 | `[24,24,24,24,24,24,24,24,24,24,24,24,24,24,24,24]` | dB/oct | `24`, `48`, `96` |
| `routes` | `routes` | integer / 16 | `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]` | Not declared in catalog | 0 … 65535 |
| `subs` | `subs` | integer / 1 | `0` | Not declared in catalog | 0 … 65535 |
| `lfeFrequency` | `lfe_frequency` | number / 1 | `120` | Hz | 20 … 300 |
| `lfeSlope` | `lfe_slope` | integer / 1 | `24` | dB/oct | `24`, `48`, `96` |
| `lfeLowpass` | `lfe_lowpass` | boolean / 1 | `false` | Not declared in catalog | Not declared in catalog |
| `bassGain` | `bass_gain` | number / 1 | `0` | dB | -24 … 12 |
| `lfeGain` | `lfe_gain` | number / 1 | `0` | dB | -24 … 12 |
| `headroom` | `headroom` | number / 1 | `0` | dB | -24 … 0 |
| `routeInversions` | `route_inversions` | integer / 16 | `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]` | Not declared in catalog | 0 … 65535 |

### Bass Management channel roles and routing

`roles`, `frequencies`, `slopes`, `routes`, and `routeInversions` each
contain exactly 16 entries. Entry `n` describes input channel `n` (zero-based).
The channel role codes are:

| Value | Role | Output when Sub routing is configured |
|---|---|---|
| `0` | Full Range | The full signal stays on the matching main output. |
| `1` | Managed | The high-pass signal stays on the matching main output; low frequencies go to the selected Sub outputs. |
| `2` | LFE | The signal goes only to selected Sub outputs, with optional low-pass filtering controlled by `lfeLowpass`. |
| `3` | Unused | This input contributes no signal. The same channel can still serve as a Sub output receiving other inputs. |

`subs` is an output bit mask: bit `m` reserves output channel `m` for Sub
signals. For example, `subs=4` (`1 << 2`) selects the third output. Every
Managed or LFE input needs a nonzero route, and every route must target selected
Sub outputs. Main outputs (roles 0/1) cannot also be Sub outputs. A contribution
routed to multiple Sub outputs is divided equally among those destinations;
contributions from different inputs are summed. `headroom` scales all outputs.
Use `channel="all"` and provide a bus wide enough for every configured input
and Sub output. The effect preserves the bus width: for stereo plus one Sub,
pass three channels with a silent third input slot.

The library defaults are all roles `0` and `subs=0`. With `subs=0`, routing
is unconfigured and every channel passes through, including inputs marked
Managed, LFE, or Unused (with `headroom` and the selected phase delay).
The app initializes available input roles to Managed, but that UI initialization
does not change the library constructor defaults.

This IIR example splits 40 Hz and 1 kHz stereo input at 80 Hz and sends the bass
to output 2. The -6 dB headroom accommodates the summed left/right bass:

```python
import numpy as np
import effetune as et

rate = 48_000
t = np.arange(rate, dtype=np.float64) / rate
mono = (0.1 * np.sin(2 * np.pi * 40 * t)
        + 0.1 * np.sin(2 * np.pi * 1000 * t)).astype(np.float32)
audio = np.zeros((3, rate), dtype=np.float32)
audio[0] = audio[1] = mono  # Channels 0/1: left/right; channel 2: silent Sub slot.
chain = et.Chain([et.BassManagement(
    phase="IIR",
    roles=[1, 1, 3] + [0] * 13,
    routes=[4, 4] + [0] * 14,
    subs=4,  # 1 << 2: third output.
    frequencies=[80] * 16,
    slopes=[24] * 16,
    headroom=-6,
)])
output = chain.process(audio, sample_rate=rate)
assert output.shape == audio.shape
assert np.isfinite(output).all()
assert np.max(np.abs(output[2])) > 0.01
steady = np.abs(np.fft.rfft(output[:, rate // 2:]))
assert steady[0, 20] < 0.1 * steady[0, 500]  # Main: 40 Hz below 1 kHz.
assert steady[2, 500] < 0.1 * steady[2, 20]  # Sub: 1 kHz below 40 Hz.
print("Left, right, Sub:", output.shape)
```

The equivalent Chain v1 JSON can be loaded with `Chain.from_preset(document)`
in Python or `createChain(document)` in JavaScript, using the same three-channel
audio bus:

```json
{
  "version": 1,
  "chain": [
    {
      "id": "bass",
      "type": "BassManagement",
      "channel": "all",
      "parameters": {
        "phase": "IIR",
        "roles": [1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        "routes": [4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        "subs": 4,
        "frequencies": [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80],
        "slopes": [24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24],
        "headroom": -6
      }
    }
  ]
}
```

### Bass Management route polarity

`routes` and `routeInversions` are 16-entry integer bit-mask arrays. Entry `n`
applies to input channel `n`, and bit `m` selects output channel `m`, with both
indices zero-based. A set bit in `routeInversions[n]` reverses only that input's
bass or LFE contribution on the corresponding enabled route; it does not affect
the matching main output.

When `subs` is nonzero, `routeInversions[n]` must be a subset of `routes[n]`,
and both route masks must target only output channels selected by `subs`. A
configuration that violates either condition raises `ValidationError`.

### Linear low-pass coefficient asset

An `assets.impulseResponse` reference is required when `phase="Linear"`,
`subs` is nonzero, and at least one input has either role Managed or role LFE
with `lfeLowpass=true`. IIR mode, unconfigured routing, and Linear routing containing
only Full Range, Unused, or unfiltered LFE inputs do not use a filter asset;
supplying one for those configurations raises `AssetError`.

Supply finite planar float32 coefficients at exactly the processing sample rate.
There is one IR channel per Managed or low-pass-filtered LFE input, ordered by
ascending input channel index. Each IR channel has exactly `Number(taps)`
frames: 8192, 16384, or 32768. An automatic topology is accepted and expanded
to diagonal matrix paths. With explicit `topology="matrix"`, the paths must be
`(inputSlot=n, outputSlot=n, irChannel=k)` in that same order; `k` counts only
the filtered inputs. Set Python `AssetData.input_count` to the processing bus
width; JavaScript derives it from the processing bus when preparing ETA1 assets.
These diagonal paths compute each input's low-pass signal;
`routes` then distribute it to Sub outputs.

Design the low-pass FIR around sample `Number(taps)/2`. The main signal is the
delayed input minus the low-pass signal. The reported delay is
`Number(taps)/2 + 128` samples, including the convolution block delay.
The library consumes your coefficients; it does not synthesize them from
`frequencies`/`slopes` or `lfeFrequency`/`lfeSlope`. Changing those values
requires preparing corresponding coefficients and a new stream. Use the desired
cutoff/slope for each Managed input and the LFE settings for each filtered LFE
input; duplicate a filter channel when two inputs use identical coefficients.

This complete NumPy example prepares an 80 Hz, 24 dB/oct low-pass magnitude curve
with a -6 dB crossover point, centers and tapers its FIR, and uses two identical
IR channels for left/right. The Sub output carries their summed low frequencies.
It pads the input to retain delayed output; offline processing otherwise returns
the same number of frames as its input.

```python
import numpy as np
import effetune as et

rate, taps, cutoff, slope = 48_000, 8192, 80, 24
# Sample a low-pass magnitude curve and center its FIR at taps / 2.
fft_size = 2 * taps
frequencies = np.fft.rfftfreq(fft_size, 1 / rate)
magnitude = 1 / (1 + (frequencies / cutoff) ** (slope / (20 * np.log10(2))))
bins = np.arange(magnitude.size)
spectrum = magnitude * np.exp(-2j * np.pi * bins * (taps / 2) / fft_size)
impulse = np.fft.irfft(spectrum, n=fft_size)[:taps]
indices = np.arange(taps)
edge = taps * 0.05
window = np.ones(taps)
window[indices < edge] = 0.5 - 0.5 * np.cos(np.pi * indices[indices < edge] / edge)
window[indices > taps - edge] = (
    0.5 - 0.5 * np.cos(np.pi * (taps - indices[indices > taps - edge]) / edge)
)
coefficients = np.ascontiguousarray(np.stack([impulse * window] * 2), dtype=np.float32)
asset = et.AssetData(
    coefficients, rate, topology="matrix",
    paths=(et.ConvolutionPath(0, 0, 0), et.ConvolutionPath(1, 1, 1)),
    input_count=3,
)
chain = et.Chain([et.BassManagement(
    phase="Linear", taps=str(taps),
    roles=[1, 1, 3] + [0] * 13,
    routes=[4, 4] + [0] * 14, subs=4,
    frequencies=[cutoff] * 16, slopes=[slope] * 16, headroom=-6,
    assets={"impulseResponse": "memory:lowpass"},
)], asset_resolver=lambda reference: asset if reference == "memory:lowpass" else None)
t = np.arange(rate, dtype=np.float64) / rate
audio = np.zeros((3, rate), dtype=np.float32)
audio[0] = audio[1] = 0.1 * np.sin(2 * np.pi * 40 * t) + 0.1 * np.sin(2 * np.pi * 1000 * t)
delay = chain.latency_samples(rate, channels=3)
# Include zeros after the signal so delayed output is retained.
output = chain.process(np.pad(audio, ((0, 0), (0, delay))), sample_rate=rate)
aligned = output[:, delay:delay + rate]
assert delay == taps // 2 + 128
assert np.isfinite(aligned).all()
assert np.max(np.abs(aligned[2])) > 0.01
steady = np.abs(np.fft.rfft(aligned[:, rate // 2:]))
assert steady[0, 20] < 0.1 * steady[0, 500]
assert steady[2, 500] < 0.1 * steady[2, 20]
print("Latency and left/right/Sub shape:", delay, aligned.shape)
```

## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Bass Management

Bass Management sends the low-frequency part of selected main channels and any dedicated LFE input to the subwoofer outputs you choose. It is useful when a multi-channel output drives main speakers and one or more subwoofers. Each managed main keeps its higher frequencies on the same output channel, while the subwoofers receive the bass routed to them. The plugin requires the WASM DSP engine.

Until you select a **Sub Output**, Bass Management does not split bass or distribute it to subwoofers, so the input channels pass through without a crossover. A new instance starts with the actual bus channels set to **Managed** and no **Sub Outputs** selected.

Select **All** in the effect bus routing, then make the output bus wide enough for every main and subwoofer channel you will use. The channel table always shows the input role and its selected subwoofer outputs. A subwoofer output cannot also be a **Full Range** or **Managed** main channel. An **LFE** input may use the same channel number as a subwoofer output; its signal is collected before outputs are assembled, so it is sent only once.

### Sound Enhancement Guide

- For stereo with two subwoofers, use a four-channel bus. Set channels 1 and 2 to **Managed**, then select channels 3 and 4 as **Sub Outputs**. Their roles change to **LFE** automatically; use the Matrix to keep or turn off each main-to-subwoofer route.
- For surround material, set only the actual main channels to **Managed** and set the source LFE channel to **LFE**. Choose the subwoofer outputs explicitly. Do not leave an LFE source as a main channel if it should play only through subwoofers.
- Start each managed main at 80 Hz and 24 dB/oct. Raise its crossover frequency when that speaker has limited bass extension; use a steeper slope when you need less overlap. Confirm the speaker's usable range before increasing playback level.
- When one input is sent to several subwoofers, Bass Management divides that electrical signal equally among them. This does not prevent peaks when several inputs or subwoofers combine. Begin with **Headroom** below 0 dB when needed, watch the following level meter, and place Brickwall Limiter later in the chain if peak control is required.
- Use **LFE Gain** only when your source chain has not already applied its intended LFE level adjustment. It does not add an automatic cinema-style level correction.
- Follow Bass Management with any per-subwoofer high-pass filter, EQ, or polarity adjustment. Use MultiChannel Panel afterwards for individual trim, mute/solo, and up to 30 ms of placement delay; add a limiter last if needed.

### Parameters

- **Phase**
  - **IIR** - Provides the lower-latency crossover mode. It changes phase around the crossover frequency.
  - **Linear** - Keeps the crossover split time-aligned, but adds visible processing latency and can produce pre-ringing. Use it only when that delay is acceptable.
- **Taps** - Selects the Linear filter length: 8192, 16384, or 32768. More Taps improve low-frequency and steep-slope accuracy, while increasing preparation time and latency. The initial setting is 16384; this control affects Linear mode.
- **Headroom** - Applies the same attenuation to every output. Lower it when combined bass and LFE signals leave too little level margin.
- **Bass Gain** - Adjusts the level of bass separated from **Managed** main channels before it is mixed into the selected subwoofer outputs.
- **LFE Gain** - Adjusts the level of **LFE** inputs before they are mixed into the selected subwoofer outputs.
- **Channel Role** - Sets each input channel to **Full Range**, **Managed**, **LFE**, or **Unused**.
  - **Full Range** keeps the source on its matching main output without sending bass to a subwoofer.
  - **Managed** keeps the high-frequency part on its matching main output and sends its low-frequency part to the selected subwoofers.
  - **LFE** sends the source only to the selected subwoofers. It does not pass through its matching output as a main channel.
  - **Unused** reserves an input channel, normally for a subwoofer output.
- **Crossover Frequency** - Sets each **Managed** channel's crossover point from 20 to 300 Hz. Higher values send more of that main channel's bass to subwoofers.
- **Slope** - Sets the crossover steepness for each **Managed** channel: 24, 48, or 96 dB/oct. Higher values narrow the overlap between main and subwoofer output.
- **Sub Outputs** - Selects the subwoofer output channels used by a **Managed** or **LFE** input. Selecting a channel changes its **Channel Role** to **LFE**. A newly selected output starts with every current bus input routed **ON** at normal polarity; use the Matrix to turn off an individual route. When no **Sub Outputs** are selected, bass splitting and subwoofer routing stop, and the input channels pass through without a crossover.
- **ON** and **Ø** - In each channel-table cell, **ON** sends that **Managed** or **LFE** input to the selected subwoofer output. **Ø** reverses polarity only for that input-to-subwoofer path, which can help align it with your measured or audible result. **Ø** is available only while **ON** is selected; clearing **ON** also clears **Ø**. It does not change the input's main output.
- **LFE Low-pass** - When enabled, limits LFE content above the selected **LFE Frequency**. Leave it off to keep the source LFE bandwidth unchanged.
- **LFE Frequency** and **LFE Slope** - Set the optional LFE low-pass point from 20 to 300 Hz and its 24, 48, or 96 dB/oct slope. They do not filter the bass already separated from managed main channels.

### Filter Preparation
Changing Linear settings can briefly reduce or pause sound while the new filters are prepared. If filter preparation cannot complete, reduce **Taps** and try again. When a previous active configuration remains usable, it continues playing; otherwise the normal main channels pass through with matching delay, reserved subwoofer outputs are silent, and an LFE source is not played until preparation succeeds.

### Bypass and Calibration

Host plugin bypass restores the original channel assignment and audio, so Bass Management routing, subwoofer protection, and delay matching do not continue while it is bypassed. For comparisons or temporary muting that keep the configured wiring, use the later MultiChannel Panel instead.

Linear mode describes the crossover itself. Per-subwoofer IIR high-pass/EQ processing or an intentional relative delay later in the chain changes the phase behavior of the complete system. Save the complete calibrated chain as one preset.

[Back to all effects](/dsp/effects/)
