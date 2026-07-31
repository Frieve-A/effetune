---
layout: dsp
title: "FAQ"
description: "FAQ"
lang: en
permalink: /dsp/faq/
---
# FAQ

**Why does the registry return 404?** The package is not yet published or its smoke test
is incomplete. Use the CI candidate named by the release process; do not install an
older version and assume it matches these docs.

**Why does my Python array fail?** Use finite C-contiguous planar `float32` shaped
`(channels, frames)`.

**Why was JavaScript audio rejected?** Every `Float32Array` sample must be finite.
`NaN` and positive or negative infinity are rejected before native processing, so a
bad stream block can be fixed and retried without resetting the stream.

**Why does Worklet loading fail?** Use HTTPS/localhost and verify same-origin URLs,
MIME types, CSP, processor/WASM/meta files, and a resumed AudioContext. Direct
`file:` loading is unsupported.

**Does the library decode, encode, resample, call ffmpeg, or measure loudness?** No.
Those are caller responsibilities in v0.1.

**Why do offline and streaming output differ?** Offline starts fresh. Streams retain
history and require the same block/event schedule for reproduction.

**Why is an IR rejected?** Check resolver output, SHA-256, byte length, ETA1 topology,
rate, channel mapping, and the 32 MiB cap.

## Errors

`ValidationError` covers document/parameter failures, `EffectError` unknown effects,
`AssetError` resolver/asset failures, runtime errors backend failures, and state errors
invalid lifecycle operations. Show users a plain-language cause and next action; send
technical diagnostics to the developer console.
