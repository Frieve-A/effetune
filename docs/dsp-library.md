---
layout: dsp
title: "EffeTune DSP Library"
description: "Deterministic MIT-licensed DSP for Python, JavaScript, and AudioWorklet."
lang: en
permalink: /dsp/
---
# EffeTune DSP Library

**Deterministic DSP for Python, JavaScript, browsers, humans, and agents.**

EffeTune DSP v0.4.0 is an MIT-licensed audio processing library with 90 catalog-registered effects, analyzers, and utilities. Python and WebAssembly run the same host-neutral C++20 core and use the same semantic Chain JSON, so a preset does not need to be reauthored for each surface.

Process arrays and files offline, keep state across a continuous stream, or run the package-owned AudioWorklet in a browser. The EffeTune app is an optional visual preset editor; the Python and JavaScript packages work independently.

[Python Start](/dsp/getting-started/python/){: .dsp-cta } · [JavaScript Start](/dsp/getting-started/javascript/){: .dsp-cta } · [AudioWorklet Start](/dsp/getting-started/audioworklet/){: .dsp-cta } · [CLI Start](/dsp/getting-started/cli/){: .dsp-cta }

Try the [live demo](/dsp/demo/) or follow the [schema-driven agent recipe](/dsp/cookbook/schema-driven-agent/).

<iframe class="dsp-demo-frame" src="/dsp/demo/?compact=1" title="EffeTune DSP live demo"></iframe>

**No upload. No CDN.** The demo uses the package-owned WASM and AudioWorklet.

## One library, several ways to work

The [Python API](/dsp/api/python/) provides semantic classes for all 90 catalog types, with NumPy-oriented offline and streaming processing. The [JavaScript API](/dsp/api/javascript/) makes every catalog type available through generic `createEffect` and Chain APIs, plus 90 generated named class/factory pairs. The generic and named JavaScript surfaces both cover the complete catalog.

In a browser, use JavaScript for offline rendering or the packaged [AudioWorklet path](/dsp/getting-started/audioworklet/) for real-time processing. In Python, use the same model from an application, notebook, or the [CLI](/dsp/getting-started/cli/) for file and batch workflows.

## From one effect to a reproducible pipeline

[Chain JSON](/dsp/concepts/chain-and-presets/) is an ordered serial pipeline with strict semantic effect names and parameters. It is readable as a preset, accepted by both language bindings, and described by a public schema that humans and automation can validate before processing.

When the routing itself is part of the program, the opt-in [Graph v1](/dsp/reference/graph-v1/) document describes parallel branches, additive merges, wet/dry and send/return shapes, and automatic delay compensation. It is a separate document type and does not change Chain v1.

Offline calls begin with fresh DSP state. Streaming calls preserve history across blocks, including delay and reverb tails, and scheduled parameter events are part of that history. Seeded execution is repeatable when the input, sample rate, channel layout, Chain, seed, block boundaries, and event sequence are the same. See [Determinism](/dsp/concepts/determinism/) and [Streaming and events](/dsp/concepts/streaming-and-events/) for the exact contract.

## Catalog-driven, inspectable behavior

The generated [effect reference](/dsp/effects/) and machine-readable [catalog](/dsp/catalog/effects-v1.json) come from the binding catalog. Entries expose parameter types, defaults and ranges, channel and latency declarations, capability metadata, external-asset requirements, and whether an effect can generate output without input.

Asset-backed effects use explicit resolver and [bundle](/dsp/concepts/assets-and-bundles/) contracts, including ETA1 assets and digest-addressed bundle records. Source-generating effects require an explicit frame count, while stateful effects make block and event history relevant. These behaviors are documented instead of being hidden behind a host application.

## Practical paths

- **ML and audio data:** start with [Python](/dsp/getting-started/python/) and the [augmentation recipe](/dsp/cookbook/ml-data-augmentation/).
- **Web audio:** prototype offline with [JavaScript](/dsp/getting-started/javascript/), then move the same Chain to [AudioWorklet](/dsp/getting-started/audioworklet/).
- **Agents and automation:** discover types through the public [catalog](/dsp/catalog/effects-v1.json), validate Chains with the [schema](/dsp/schemas/chain-v1.schema.json), and render through a normal library or CLI call.
- **Research and teaching:** record the complete [reproducibility conditions](/dsp/concepts/determinism/#reproducible-experiment) alongside an experiment.
- **Listening and batch workflows:** design a preset visually in the optional app or write Chain JSON directly, then render files with the [CLI batch path](/dsp/getting-started/cli/#batch-rendering).

## What stays consistent {#library-strengths}

The library, schemas, and examples are MIT licensed. Python and WebAssembly use one C++ core and one semantic catalog; seeded repeatability is defined by explicit execution conditions rather than by a vague promise. Generated reference pages and schemas make the contract inspectable, while [verification](/dsp/reference/verification/) and [release integrity](/dsp/reference/release-integrity/) document how packages, native artifacts, examples, and public pages are checked together.

## Boundaries

EffeTune DSP does not host VST/AU plugins, decode or encode audio in JavaScript, resample audio, call ffmpeg, or expose integrated-LUFS/true-peak measurements. Five analyzers expose opt-in decoded observations in v0.1; all other catalog telemetry remains metadata-only. MCP is planned only after its implementation and acceptance exist.

See [Compatibility and boundaries](/dsp/reference/compatibility/) for supported runtimes, channel behavior, and the precise v0.1 surface.

Package identities are `effetune` on PyPI and `@effetune/dsp` on npm. Source: [Frieve-A/effetune](https://github.com/Frieve-A/effetune). Canonical documentation: https://effetune.frieve.com/dsp/.

## Continue

[Concepts](/dsp/concepts/processing-model/) · [Compatibility](/dsp/reference/compatibility/) · [Verification](/dsp/reference/verification/) · [Release integrity](/dsp/reference/release-integrity/) · [FAQ](/dsp/faq/) · [Chain schema](/dsp/schemas/chain-v1.schema.json) · [Bundle schema](/dsp/schemas/bundle-v1.schema.json)

## Links

[Source Code](https://github.com/Frieve-A/effetune)

[Support on Ko-fi](https://ko-fi.com/frievea)
