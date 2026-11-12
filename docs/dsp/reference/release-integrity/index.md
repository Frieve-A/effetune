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
v0.18.1. The wheels, npm tarball, `SHA256SUMS`, and SPDX SBOM
(`SBOM.spdx.json`) for every tagged release are attached to the matching
[`dsp-v` GitHub Release](https://github.com/Frieve-A/effetune/releases?q=dsp-v).
The files themselves are not signed. Instead, each wheel, the npm tarball, and every
attached file has a GitHub build-provenance attestation (SLSA provenance signed through
Sigstore). The npm package also carries npm registry signatures and provenance, and the
PyPI wheels carry PyPI publish attestations.

To check downloaded release files, run these commands in their directory. The first
checks the files you downloaded against `SHA256SUMS`; the second requires the
[GitHub CLI](https://cli.github.com/). In an npm project, `npm audit signatures`
checks the registry signatures and provenance of the installed packages:

```console
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify effetune-dsp-0.18.1.tgz -R Frieve-A/effetune
npm audit signatures
```

`sha256sum` is not available in Windows PowerShell. There, print a file's hash with
the command below and compare it with that file's line in `SHA256SUMS`:

```powershell
(Get-FileHash effetune-dsp-0.18.1.tgz -Algorithm SHA256).Hash.ToLower()
```

The [live demo build manifest](/dsp/demo/build-manifest.json) records the package
name, version, DSP `sourceDigest`, and SHA-256 hashes of its served files. The
site copies the checkout's built package artifacts. To check whether the demo
uses the same processing files as an npm release, compare every manifest hash
under `vendor/@effetune/dsp/` with the corresponding file in that installed
package's `dist/` directory, including JavaScript, the worklet processor, WASM,
and metadata. A matching displayed version or WASM hash alone does not establish
that all these files are identical.
