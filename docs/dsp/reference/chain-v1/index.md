---
layout: dsp
title: "Chain v1"
description: "Chain v1"
lang: en
permalink: /dsp/reference/chain-v1/
---
# Chain v1

The [raw schema](/dsp/schemas/chain-v1.schema.json) is authoritative. A document has
`version: 1` and ordered `chain` items. IDs are unique when present; semantic types,
parameters, channels, enabled state, and asset references reject unknown fields.
Some asset and cross-field rules require runtime validation after schema validation.

## Channel selector

Every effect item has a `channel` selector. It defaults to `"all"`.

| Value | Processed channels |
|---|---|
| `"all"` | Every channel |
| `"stereo"` | Channels 1 and 2 (channel 1 in mono audio) |
| `"left"` / `"right"` | Channel 1 / channel 2 |
| `"1"` through `"16"` | That one channel |
| `"34"`, `"56"`, `"78"`, `"910"`, `"1112"`, `"1314"`, `"1516"` | That channel pair |

Processing fails with `ValidationError` when the selected channel or pair does not exist
in the audio. Channels the selector does not include pass through unprocessed, delayed by
the effect's latency so that all channels stay aligned. Bass Management requires
`"all"`, and Adaptive Prediction processes at most two channels, so it rejects `"all"`
for audio with more than two channels.
