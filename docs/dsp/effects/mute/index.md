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

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Mute

A simple utility that silences all audio output by filling the buffer with zeros. Useful for instantly muting audio signals.

### When to Use
- To instantly silence audio without fade
- During silent sections or pauses
- To prevent unwanted noise output

[Back to all effects](/dsp/effects/)
