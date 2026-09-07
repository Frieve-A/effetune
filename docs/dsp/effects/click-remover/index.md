---
layout: dsp
title: "Click Remover — EffeTune DSP"
description: "Reduces short clicks in playback."
lang: en
permalink: /dsp/effects/click-remover/
---
# Click Remover

Semantic type: `ClickRemover` · Category: restoration

Reduces short clicks in playback.

## Contract

- Seeded: **no**
- Catalog sample rates: **not declared; this does not mean unsupported**
- Assets: **none**
- Catalog-declared latency: **sampleRateDependent**; depends on sampleRate

| Semantic name | Python constructor keyword | Type / count | Default | Unit | Range or values |
|---|---|---:|---|---|---|
| `sensitivity` | `sensitivity` | number / 1 | `50` | % | 0 … 100 |
| `maxRepairLength` | `max_repair_length` | number / 1 | `1` | ms | 0.1 … 2 |



## EffeTune app documentation

> The following section is reproduced from the English EffeTune app documentation. Its parameter names and values describe the app UI and can differ from semantic API parameters through transforms or value maps. The generated contract above is authoritative.

## Click Remover

Click Remover repairs short, isolated faults such as record crackle, pops, brief clicks, and tiny dropouts. Use it for occasional interruptions rather than for a constant hiss or hum.

### Listening Guide

1. Start with **Sensitivity** at 50% and **Max Repair Length** at 1 ms.
2. Raise **Sensitivity** gradually until the unwanted clicks become less noticeable. If drum hits or other sharp musical details become softer, lower it again.
3. Increase **Max Repair Length** only when the faults last longer than a brief click. Keep it short for ordinary crackle.
4. While the affected passage plays, use **REPAIRS/S** to confirm that the effect is finding faults; compare with the effect bypassed before keeping a stronger setting.

### Parameters

- **Sensitivity** (0–100%, default 50%) controls how readily the effect treats a short change as a fault. Higher values repair more suspected clicks; lower values are more conservative and better preserve sharp musical attacks.
- **Max Repair Length** (0.1–2 ms, default 1 ms) limits the duration of each repair. Raise it for slightly longer pops or dropouts; lower it when repairing ordinary short crackle.

### Reading the Display

**REPAIRS/S** shows the recent number of click repairs per second. A value near zero means no short faults are currently being repaired. A steady high value on normal music is a reason to lower **Sensitivity** or **Max Repair Length**.

[Back to all effects](/dsp/effects/)
