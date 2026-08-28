---
layout: dsp
title: "Matrix — EffeTune DSP"
description: "Mixes input channels into output channels using an explicit routing matrix."
lang: en
permalink: /dsp/effects/matrix/
---
# Matrix

Semantic type: `Matrix` · Category: basics

Mixes input channels into output channels using an explicit routing matrix.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `matrixRoutes` | `matrix_routes` | string / 1 | `"0011"` | Not declared in catalog | maximum length 3072 |

### Matrix route grammar

`matrixRoutes` uses the complete grammar `(p?[0-9a-f][0-9a-f])*`. Two independent
limits apply: the string is at most 3,072 characters, and it may contain at
most 1,024 routes. Exceeding either raises `ValidationError`; the route-count
limit is enforced when the chain is prepared for processing, not when the
effect is constructed. Route tokens are concatenated directly, with no
separators and no whitespace. Each token is an optional `p`, one
input-channel digit, and one output-channel digit.
For example, `p01` sends input 0 to output 1 with polarity inverted.
Without `p`, the route keeps its polarity.

The empty string is valid and produces silence. Channel indices are zero-based.
The grammar accepts lowercase hexadecimal digits `0` through `f`, representing
indices 0 through 15. Audio carries at most 16 channels, and index `n` is routable only when
the processing call has more than `n` channels. Any route whose input or
output is unavailable is silently ignored. Routes targeting the
same available output are summed, and an output with no surviving route stays
silent. A string that does not match `^(?:p?[0-9a-f][0-9a-f])*$` raises
`ValidationError`.

`"0011"` is stereo passthrough, `"0110"` swaps left and right, and
`"p0011"` inverts the left channel only.

## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Matrix

A channel routing tool for fixing unusual speaker or headphone channel layouts, swapping channels, combining channels, or sending one channel to more than one available output.

### When to Use
- To create custom routing between channels
- When you need to mix or split signals in specific ways
- When left/right or multi-channel playback is coming from the wrong speakers
- To combine stereo to mono or duplicate a channel to another available output

### Features
- Flexible routing matrix for up to 16 channels
- Individual connection control between any input/output pair
- Phase inversion options for each connection
- Visual matrix interface for intuitive configuration

### How It Works
- Each connection point represents routing from an input row to an output column
- Active connections allow signal to flow between channels
- Phase inversion option reverses the signal polarity
- Multiple input connections to one output are mixed together
- When several inputs are sent to the same output, their levels are added together, so you may need to lower the volume
- Matrix does not create extra output channels by itself; it routes audio within the channels currently available

### Practical Applications
- Custom downmixing, channel swapping, or routing within the available channels
- Combining left and right into mono
- Duplicating a channel to another available output
- Correcting unusual multi-channel playback layouts

[Back to all effects](/dsp/effects/)
