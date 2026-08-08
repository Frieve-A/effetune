---
title: "Contributing - EffeTune"
description: "Contribution guidelines for Frieve EffeTune audio processor."
lang: en
---

# Contributing to EffeTune

Thank you for your interest in improving EffeTune. This document explains how to report issues, what a good pull request looks like, and how changes are landed. For environment setup, build commands, and the full verification matrix, see [BUILD.md](BUILD.md).

## Reporting Issues

Open a GitHub issue with:

- What you did, what you expected, and what happened instead.
- The environment: web app or desktop app, OS, browser (for the web app), and the app version.
- For audio-processing issues, the effect chain and parameter values that reproduce the problem. A minimal chain is far more useful than a full preset.

## Pull Requests

- Base your branch on the latest `main` and keep each pull request scoped to one coherent change. Do not refactor unrelated code in the same PR.
- Describe not only what you changed but why the new behavior is correct — for DSP changes, reference the conventions or measurements that justify it.
- Add or update tests when they are needed to verify the changed behavior. Run `npm run verify` (web asset freshness check + install-script audit + lint + full test suite) before submitting; see BUILD.md for narrower and additional checks.
- Write all code comments in English. Keep the code simple and consistent with the surrounding style (the project follows KISS and DRY as defaults, and ESLint plus `clang-format` for C++ under `dsp/` enforce formatting).
- Never include anything under `tmp/` — that directory is permanently local-only.

## Generated Artifacts: Leave Them to the Maintainer

Several files in the tree are build outputs that change with nearly every commit to `main`:

- `plugins/dsp/effetune-dsp.wasm` and `plugins/dsp/effetune-dsp.simd.wasm` (committed WebAssembly DSP modules)
- `plugins/dsp/effetune-dsp.meta.json` (build metadata and source digest)
- `sw-precache.js` and the other outputs of `npm run assets:web` (PWA precache and web asset bundles)

**Do not include changes to these files in a pull request.** Because `main` moves continuously, any committed copy of them is stale by the time a PR is reviewed, and two of them are binaries that Git cannot merge — including them guarantees conflicts without adding anything reviewable. The maintainer regenerates all of them on top of the current `main` as the final step before merging, using the pinned toolchain, and verifies the result with the full gate (the WASM build is deterministic, so the rebuild is byte-for-byte checkable).

Practical consequences for contributors:

- Rebuild the artifacts locally whenever you need them to run the parity gates (`npm run build:dsp`, then `npm run test:dsp:parity`), but leave the rebuilt files out of your commits.
- It is expected — and fine — that artifact-dependent checks on your branch reflect your local rebuild rather than committed files. State in the PR which gates you ran and with which Emscripten version (the pinned version is recorded in `dsp/EMSDK_VERSION`).
- Everything else that is generated but text-based and change-local — generated parameter layouts from `npm run gen:dsp` and parity goldens (see below) — **should** be included, because it is part of the reviewable diff and does not churn globally.

## Dependencies and Workflows

Two supply-chain rules are enforced by CI, so a change that breaks either one fails the gate:

- **Dependency install scripts never run.** The committed `.npmrc` sets `ignore-scripts=true`, and `npm run check:install-scripts` fails when a new dependency ships a `preinstall`, `install`, or `postinstall` script. If you add one, say in the PR why the package is needed and why its script has to run. The same setting suppresses implicit `pre`/`post` hooks for `npm run`, so chain script prerequisites explicitly with `&&`; a `pre<name>` entry would be skipped without warning.
- **Workflow actions are pinned to a full commit SHA**, with the tag kept as a trailing comment so Dependabot can update it:

```yaml
uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
```

  Tags are mutable, so a tag reference lets whoever controls the action run code with the workflow's token. Resolve the SHA with `gh api repos/OWNER/REPO/commits/TAG --jq .sha`. Local `uses: ./.github/workflows/...` references are exempt.

## DSP Changes

Changes under `dsp/` or to a plugin's DSP parameter schema follow the workflow in BUILD.md ("Build and Test the DSP Core"). In summary:

```bash
npm run gen:dsp
npm run test:dsp:warnings
npm run test:dsp
npm run build:dsp
npm run test:dsp:parity
```

Additional expectations:

- The JavaScript implementation is the reference; the C++ kernels must match it. If your change alters audio output, regenerate the affected parity goldens and include them in the PR — goldens are reviewable data, and the test suite verifies they regenerate byte-for-byte from the JavaScript reference.
- Format changed C++ with `clang-format` before rebuilding, since formatting changes the committed source digest.
- Real-time processing must never allocate, lock, perform I/O, or grow WASM memory; preparation work belongs between audio quanta.

## Documentation

- English documentation (root `README.md` and `docs/`) is the source of truth. Update it first when behavior changes.
- You do not need to update localized documentation under `docs/i18n/**` or `docs/version-history.md`; translations and the version history are curated by the maintainer. You are welcome to include localization updates if you are fluent in the target language.
- `docs/` is reserved for end-user documentation and public developer guides. Internal notes and working documents do not belong in the repository.

## How Changes Are Landed

So you know what to expect after approval:

1. The maintainer rebases the PR branch onto the current `main` (source changes normally apply cleanly because generated artifacts are not part of the PR).
2. All generated artifacts are regenerated on top of that state, and the full verification gate is run (lint, ESM suite, native tests, WASM/SIMD parity).
3. The branch is updated and merged, preserving your commits and authorship. PRs opened with "Allow edits by maintainers" enabled make this step smoother.

## License

EffeTune is released under the MIT License. By contributing, you agree that your contributions are licensed under the same terms.
