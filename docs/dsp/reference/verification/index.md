---
layout: dsp
title: "Verification"
description: "Verification"
lang: en
permalink: /dsp/reference/verification/
---
# Verification

Each test case processes a fixed input and compares the output with a frozen
reference output under that case's tolerance. The same cases run on the native
Python package, the JavaScript package's baseline and SIMD WebAssembly modules, and
the AudioWorklet in Chromium. These comparisons check processing behavior; they do
not promise byte-identical output across backends. See [Determinism](/dsp/concepts/determinism/)
for the conditions needed to reproduce a result.

Package checks also exercise installation and the documented examples. See the
[DSP Library Release workflow results](https://github.com/Frieve-A/effetune/actions/workflows/dsp-library-release.yml)
for the verification status of published releases and [Release integrity](/dsp/reference/release-integrity/)
for published package checksums and provenance.

Use [Compatibility](/dsp/reference/compatibility/) to check supported runtimes
and browser requirements before integrating the library.
