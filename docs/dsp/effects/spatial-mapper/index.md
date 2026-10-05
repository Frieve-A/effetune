---
layout: dsp
title: "Spatial Mapper — EffeTune DSP"
description: "Separates direct, diffuse, and residual sound and routes each component across a multichannel bus."
lang: en
permalink: /dsp/effects/spatial-mapper/
---
# Spatial Mapper

Semantic type: `SpatialMapper` · Category: spatial

Separates direct, diffuse, and residual sound and routes each component across a multichannel bus.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `inputChannels` | `input_channels` | integer / 1 | `2` | ch | 1 … 16 |
| `bands` | `bands` | string / 1 | `"24"` | Not declared in catalog | `8`, `16`, `24`, `32`, `48` |
| `directness` | `directness` | number / 1 | `50` | % | 0 … 100 |
| `separation` | `separation` | number / 1 | `50` | % | 0 … 100 |
| `diffuseExtraction` | `diffuse_extraction` | number / 1 | `50` | % | 0 … 100 |
| `phaseSensitivity` | `phase_sensitivity` | number / 1 | `50` | % | 0 … 100 |
| `temporalSmoothing` | `temporal_smoothing` | number / 1 | `50` | % | 0 … 100 |
| `energyPreservation` | `energy_preservation` | boolean / 1 | `true` | Not declared in catalog | Not declared in catalog |
| `directMatrix` | `direct_matrix` | number / 256 | `[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]` | Not declared in catalog | -1 … 1 |
| `diffuseMatrix` | `diffuse_matrix` | number / 256 | `[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]` | Not declared in catalog | -1 … 1 |
| `residualMatrix` | `residual_matrix` | number / 256 | `[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]` | Not declared in catalog | -1 … 1 |

### Spatial Mapper matrix layout and bus width

`directMatrix`, `diffuseMatrix`, and `residualMatrix` each contain exactly
256 gains: a 16-row by 16-column matrix flattened in row-major order. Rows are
outputs, columns are analyzed inputs, and all indices are zero-based:

`index = outputChannel * 16 + inputChannel`

The stride is always 16, including a three-channel bus. For example, gain from
input 0 to output 2 belongs at index 32, not index 2. Use zero for unused routes;
negative gains invert polarity. Each matrix routes its own separated component,
and the three routed components are summed. `energyPreservation` can normalize
component levels, so matrix gains alone do not define the final output amplitude.

`inputChannels` selects the first N channels to analyze (limited to the actual
bus width); it does not allocate outputs. The processing bus determines output
width, which is preserved. Add silent channels before processing when additional
outputs are needed, or provide a Graph layout with that bus width. Only columns
below the effective input count and rows within the bus participate in routing.
A channel beyond the analyzed inputs passes through with the effect's delay if
no component matrix routes any analyzed input to that output; once such a route
exists, that channel is used as a mapped output instead.

### Center Extract API example

The app's Center Extract preset routes Direct left/right components to output 2
with gains 0.7, retaining identity matrices for Diffuse and Residual components.
It uses `directness=90`, `separation=85`, and the other values shown below.
This example supplies a three-channel bus: stereo input plus a silent center slot.
The correlated 440 Hz input produces an extracted center signal. The result also
retains left/right Diffuse and Residual components; it is not a simple mono sum.

```python
import numpy as np
import effetune as et

rate = 48_000
direct = [0.0] * 256
direct[2 * 16 + 0] = direct[2 * 16 + 1] = 0.7
identity = [1.0 if row == column else 0.0 for row in range(16) for column in range(16)]
# These are the app's Center Extract preset values in semantic API names.
effect = et.SpatialMapper(
    input_channels=2, bands="24", directness=90, separation=85,
    diffuse_extraction=50, phase_sensitivity=50, temporal_smoothing=50,
    energy_preservation=True,
    direct_matrix=direct, diffuse_matrix=identity, residual_matrix=identity,
)
chain = et.Chain([effect])
t = np.arange(rate, dtype=np.float64) / rate
audio = np.zeros((3, rate), dtype=np.float32)
audio[0] = audio[1] = 0.1 * np.sin(2 * np.pi * 440 * t)
delay = chain.latency_samples(rate, channels=3)
output = chain.process(np.pad(audio, ((0, 0), (0, delay))), sample_rate=rate)
aligned = output[:, delay:delay + rate]
assert aligned.shape == audio.shape
assert np.isfinite(aligned).all()
assert np.max(np.abs(aligned[2])) > 0.01
print("Left, right, extracted center:", aligned.shape)
```

Use the corresponding camelCase semantic names and the same 256-entry arrays in
JavaScript options or Chain JSON. Preset labels in the app are not library
constructor parameters; the example explicitly supplies their values.

## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Spatial Mapper

Spatial Mapper analyzes how the input channels relate across frequency bands, continuously separates the sound into Direct, Diffuse, and Residual components, and routes each component across the current channel bus. Use it to keep focused sound toward the front, move ambience toward surround or height channels, extract center or ambience content, or reshape stereo width. The default **Transparent** preset keeps the original channel placement.

The three components have different roles. **Direct** contains the dominant coherent sound in each band. **Diffuse** contains less coherent, distributed sound. **Residual** keeps content that is not assigned fully to either component. The split is gradual, so changing the controls does not hard-switch sounds between routes.

Spatial Mapper adds frequency-analysis latency. EffeTune includes this in the **Total Delay** display. Keep that delay in mind for real-time monitoring and audio/video synchronization.

### System Presets

Click **Effect Presets** in the effect header to choose a complete starting configuration.

- **Transparent** - Keeps the original channel placement and is the default.
- **Stereo Enhance** - Widens a stereo input through the Residual route while retaining focused and diffuse placement.
- **Center Extract** - Sends the Direct component toward channel 3. Use a bus with at least three channels.
- **5.1 Upmix** - Maps stereo to L, R, C, LFE, Ls, Rs order. It leaves LFE empty and requires at least six bus channels.
- **7.1.4 Upmix** - Maps stereo to L, R, C, LFE, Ls, Rs, Lb, Rb, Ltf, Rtf, Ltb, Rtb order. It leaves LFE empty and requires at least twelve bus channels.
- **Ambience Extract** - Keeps the Diffuse component and suppresses the Direct and Residual components.

### Reading and Editing the Routing Grid

Under **Component Routing**, choose the **Direct**, **Diffuse**, or **Residual** tab. Columns are analyzed input channels and rows are output bus channels. Use the small slider or number field in each cell to set a linear gain from -1.00 to +1.00 in 0.01 steps: 0 makes no connection, +1.00 sends the component at full positive polarity, and a negative value sends it with inverted polarity. Negative values appear in red. Values between these points set a proportionally lower level.

A routed output row replaces that bus channel with the mapped result. An output channel within the **Input Channels** range becomes silent when no component is routed to its row. Channels outside **Input Channels** pass through with matching delay when no component writes to them.

### Listening Enhancement Guide

1. **Widen stereo without moving focused sound as strongly**
   - Start with **Stereo Enhance**.
   - Lower **Directness** or **Diffuse Extraction** only if more material needs to remain in Residual for the widening route.
   - Compare with **Transparent**, and reduce the change if center images become weak or mono playback loses too much content.
2. **Build a center channel from stereo**
   - Use a bus with at least three channels and choose **Center Extract**.
   - Raise **Directness** and **Separation** to concentrate more coherent content in Direct.
   - Check that vocals and other centered material remain stable while wide ambience stays mainly in left and right.
3. **Expand stereo across surround or height channels**
   - Set the bus to the channel order shown above, then choose **5.1 Upmix** or **7.1.4 Upmix**.
   - Adjust **Diffuse Extraction** to control how much distributed content reaches the surround and height routes.
   - The preset does not generate an LFE signal; add bass management separately when needed.
4. **Isolate ambience**
   - Start with **Ambience Extract**.
   - Raise **Diffuse Extraction** for a stronger diffuse selection, and use **Phase Sensitivity** to decide how strongly opposing channel phase reduces Direct classification.

### Parameters

- **Input Channels** (1 to 16): Sets how many channels from the start of the bus are analyzed. If the bus has fewer channels, Spatial Mapper uses the available channels.
- **Analysis Bands** (8, 16, 24, 32, or 48): Sets the frequency resolution of the spatial analysis. More bands follow frequency-dependent placement more closely but require more processing. The default is 24.
- **Directness** (0% to 100%): Controls how much dominant coherent content is assigned to Direct. Higher values make the Direct extraction stronger.
- **Separation** (0% to 100%): Controls how selectively content is assigned to Direct and Diffuse. Higher values leave more ambiguous content in Residual, increasing the contrast among routes.
- **Diffuse Extraction** (0% to 100%): Controls how much low-coherence content is assigned to Diffuse. Higher values send more distributed ambience into the Diffuse route.
- **Phase Sensitivity** (0% to 100%): Controls how strongly channel phase opposition reduces Direct classification. Lower values treat coherent opposite-polarity content more like other coherent sound; higher values leave more of it outside Direct. This control does not automatically designate opposite-phase sound as rear content.
- **Temporal Smoothing** (0% to 100%, Fast to Stable): Controls how quickly the analysis and routing follow changes. Lower values react faster; higher values reduce image movement and pumping but respond more slowly.
- **Energy Preservation** (Off/On): Normalizes Direct, Diffuse, and Residual routing separately to avoid unintended level changes from the routing matrices. Turn it off when the matrix gain itself should change component level.
- **Component Routing / Direct**: Selects the Direct grid and sets its output gains.
- **Component Routing / Diffuse**: Selects the Diffuse grid and sets its output gains.
- **Component Routing / Residual**: Selects the Residual grid and sets its output gains.

[Back to all effects](/dsp/effects/)
