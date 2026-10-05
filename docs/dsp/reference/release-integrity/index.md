---
layout: dsp
title: "Release integrity"
description: "Release integrity"
lang: en
permalink: /dsp/reference/release-integrity/
---
# Release integrity

EffeTune is MIT licensed. Python wheels include PFFFT and nanobind notices; the npm
tarball includes the PFFFT notice. Release automation builds and clean-installs
candidates, checks goldens, emits checksums, an SPDX SBOM, and provenance attestations.

The registries hold the authoritative published versions. `pip install effetune` and
`npm install @effetune/dsp` always resolve the latest release; these docs describe
v0.12.0. Signed tarballs, wheels, checksums, and the SBOM for every tagged release
are attached to the matching
[`dsp-v` GitHub Release](https://github.com/Frieve-A/effetune/releases?q=dsp-v).

The [live demo build manifest](/dsp/demo/build-manifest.json) records the package
name, version, DSP `sourceDigest`, and SHA-256 hashes of its served files. The
site copies the checkout's built package artifacts. To check whether the demo
uses the same processing files as an npm release, compare every manifest hash
under `vendor/@effetune/dsp/` with the corresponding file in that installed
package's `dist/` directory, including JavaScript, the worklet processor, WASM,
and metadata. A matching displayed version or WASM hash alone does not establish
that all these files are identical.
