---
layout: dsp
title: "Mute — EffeTune DSP"
description: "Silences the selected channels."
lang: en
permalink: /dsp/effects/mute/
---
# Mute

Semantic type: `Mute` · Category: basics

Silences the selected channels.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **zero**

This effect has no semantic parameters.



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. It describes the app UI, so it can mention controls, meters, and displays that the library does not provide, and its parameter names and values can differ from the API through transforms or value maps. Only the parameters in the Contract table above, plus the telemetry described in [Compatibility](/dsp/reference/compatibility/#analyzers-and-telemetry), are part of the library API; the Contract is authoritative. Some parameters take effect only when a related setting enables them.

## Mute

A simple utility that silences all audio output by filling the buffer with zeros. Useful for instantly muting audio signals.

### When to Use
- To instantly silence audio without fade
- During silent sections or pauses
- To prevent unwanted noise output

[Back to all effects](/dsp/effects/)
