---
layout: dsp
title: "Schema-driven agent"
description: "Schema-driven agent"
lang: en
permalink: /dsp/cookbook/schema-driven-agent/
---
# Schema-driven agent

**Goal:** create only documented Chain JSON and render it without inventing effect or
parameter names.

1. Read the [public effect catalog](/dsp/catalog/effects-v1.json).
2. Constrain output with the [Chain v1 schema](/dsp/schemas/chain-v1.schema.json).
3. Run `effetune chain validate chain.json`.
4. Run `effetune render input.wav output.wav --preset chain.json`.

Runtime validation still enforces duplicate IDs, assets, and cross-field rules. MCP,
measurement, resampling, ffmpeg, LUFS, and true-peak tools are not v0.1 capabilities.
