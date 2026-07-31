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
> **Release state:** python is **unreleased**. The public install command is intentionally disabled until a version-matched smoke test passes.

<!-- DSP-RELEASE-NOTICE -->
> **Release state:** npm is **unreleased**. The public install command is intentionally disabled until a version-matched smoke test passes.

<!-- DSP-RELEASE-NOTICE -->
> **Release state:** githubRelease is **unreleased**. The public install command is intentionally disabled until a version-matched smoke test passes.


Only an existing, version-verified public asset receives a link. A surface can be
`published-unverified` independently; mismatched verified versions form a
partial/incomplete release cohort rather than changing that surface status.
