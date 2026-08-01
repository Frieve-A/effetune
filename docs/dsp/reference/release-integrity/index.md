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

<!-- DSP-RELEASE-NOTICE -->
> **Release state:** python is **published** for 0.1.0. The verified package matches these 0.1.0 docs.

<!-- DSP-RELEASE-NOTICE -->
> **Release state:** npm is **published** for 0.1.0. The verified package matches these 0.1.0 docs.

<!-- DSP-RELEASE-NOTICE -->
> **Release state:** githubRelease is **published** for 0.1.0. The verified package matches these 0.1.0 docs.
> [Verified public Release asset](https://github.com/Frieve-A/effetune/releases/download/dsp-v0.1.0/effetune-dsp-0.1.0.tgz)


Only an existing, version-verified public asset receives a link. A surface can be
`published-unverified` independently; mismatched verified versions form a
partial/incomplete release cohort rather than changing that surface status.
