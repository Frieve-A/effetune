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
v0.4.0. Signed tarballs, wheels, checksums, and the SBOM for every tagged release
are attached to the matching
[`dsp-v` GitHub Release](https://github.com/Frieve-A/effetune/releases?q=dsp-v).
