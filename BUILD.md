---
title: "Build - EffeTune"
description: "Documentation for build in Frieve EffeTune audio processor."
lang: en
---

# EffeTune Build and Packaging Guide

This document provides instructions for setting up the development environment, validating the web app, and building the EffeTune desktop application using Electron.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js** (v22.12 or later)
- **npm** (v10 or later)
- **Git** (for cloning the repository)
- **Ruby** with the GitHub Pages gem used by the deployment workflow (`gem install github-pages -v 232`) when previewing the documentation site

## Development Environment Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/effetune.git
cd effetune
```

### 2. Install Dependencies

Install all required dependencies for the project:

```bash
npm install
```

This will install:
- Electron (as specified in `package.json`)
- Electron Builder
- Other dependencies required by the application

The committed `.npmrc` sets `ignore-scripts=true`, so no dependency runs a
`preinstall`, `install`, or `postinstall` script during any install in this
repository. Nothing in the tree needs one: Electron downloads its binary lazily
on first use rather than from an install script, esbuild resolves its executable
from the `@esbuild/*` platform package, and the remaining two packages that ship
install scripts (`electron-winstaller`, `fsevents`) are never on a path this
project builds. `npm run check:install-scripts` fails when that stops holding or
when the setting is removed, and it runs as part of `npm run verify`.

To run a blocked script deliberately, name its package; a plain `npm rebuild`
silently does nothing while the setting is active:

```bash
npm rebuild --ignore-scripts=false --foreground-scripts <package>
```

Because `ignore-scripts` also suppresses implicit `pre`/`post` hooks for
`npm run`, every script in `package.json` chains its prerequisites explicitly
with `&&`. Keep new scripts self-contained the same way instead of relying on a
`pre<name>` entry, which would be skipped without warning.

CI installs with `npm ci --ignore-scripts` and additionally runs
`npm audit signatures`, which rejects the run if any installed package fails to
match its registry signature. It also verifies that every workflow action is
pinned to a full commit SHA; see CONTRIBUTING.md for that convention.

### 3. Run Quality Checks

Run the default validation before handing code changes back:

```bash
npm run verify
```

This runs:

- `npm run assets:web:check`: rebuilds the browser vendor assets and checks the committed PWA precache for freshness without writing it
- `npm run check:install-scripts`: dependency install-script audit that fails when a package ships a `preinstall`, `install`, or `postinstall` script or when `ignore-scripts` is removed
- `npm run lint`: ESLint checks for JavaScript syntax and high-confidence correctness hazards across Electron, renderer, plugin, feature, tool, and test code
- `npm test`: Node.js tests with the repository's coverage thresholds and test hygiene checks

The precache check never regenerates a stale `sw-precache.js`; if it fails, run
`npm run assets:web` and then rerun `npm run verify`.

Before every commit, run the owning audit and outdated checks for every
dependency manifest. For the root npm dependency graph, run:

```bash
npm audit --audit-level=moderate
npm outdated
```

Also inspect all current Dependabot alerts and pull requests, including GitHub
Actions updates. Resolve every available update in the prospective commit or an
earlier local commit; routine and development-only updates are not deferred to a
later Dependabot run.

Install or configure missing audit and analysis tooling as part of commit
readiness. Run every check supported by the current host. When a check genuinely
requires an unavailable operating system, hardware capability, credential,
external service, or equivalent environment, record only that omitted scope and
its residual risk and continue with the remaining checks; a missing local tool or
ordinary configuration is not by itself an acceptable omission.

When dependency metadata changes, reproduce the CI install and supply-chain
checks before the normal verification. Do not use `--force` or
`--legacy-peer-deps` to conceal an incompatible update.

```bash
npm ci --ignore-scripts
npm audit signatures
npm run verify
```

For narrower verification, use:

```bash
npm run lint
npm test
```

### Music Library Web correctness and scale diagnostics

The Web Music Library catalog uses the vendored official SQLite WASM build in a dedicated
Worker, with one `opfs-sahpool` connection and rollback journaling. The browser contract and
browser checks start and stop their own temporary loopback origin and use an isolated
Playwright browser context; do not start a separate development server.

Changes that affect Music Library storage, scanning, paging, search, durable operations,
playlists, playback sequences, or artwork must run the browser contract:

```bash
npm run test:library-sqlite:web
```

Performance measurements are local, manually invoked development diagnostics. They are not
required before a commit or release, are not part of `npm test` or `npm run verify`, and must not
be added to GitHub Actions. The recommended production-path measurement uses one retained
reference-computer manifest; see `tests/scale/README.md` for the initialization and measurement
commands. You can also run the Web-only million-track diagnostic explicitly:

```bash
npm run test:library-scale:web-sqlite
```

Do not treat either result as a release gate or a general performance guarantee.

- `test:library-sqlite:web` covers fresh creation, reopen, Worker restart, the repository
  domains, one-to-two-character word-prefix search, three-or-more-character trigram
  substring search, message limits, foreign keys, and integrity.
- `test:library-scale:reference` measures the production Electron utility, Web catalog Worker,
  and AudioWorklet on the same retained reference computer.
- `test:library-scale:web-sqlite` writes one million tracks through the production Web
  repository in bounded batches with realistic metadata and path lengths, verifies
  first/middle/end pages and the reopen order digest, and records insertion time, OPFS
  size, browser/Worker memory, and page and search timings.
- SQLite vendor hashes and the Web precache are verified by `npm run assets:web` and
  `npm run verify` before the browser checks.

Release notes should state that EffeTune starts with a new Music Library, earlier Library state is not inherited, and folders must be added and scanned again. This is ordinary release information, not a migration detector or prerequisite workflow.

Changes to the power-saving policy, audio-pipeline lifetime, input ownership, or resume
behavior must also pass the browser smoke test:

```bash
npx playwright install chromium
npm run test:power-browser
```

The Playwright install command is needed only when Chromium is not already available.
The smoke-test runner starts and stops its own temporary loopback server; do not start a
separate development server for this command.

Windows sleep-resume recovery also requires `npm run test:rolling-pcm:electron`.
For hardware verification, play audio through both standard and low-latency output,
put Windows to sleep, and confirm that playback and live input recover without a
page reload after waking. Check that the effect settings and playback position are
preserved. With audio intentionally suspended by the power policy, waking Windows
must leave it suspended; requesting audio again should recreate the audio resources
before resuming. Automated resume tests simulate the notification and resource
states; actual driver recovery requires this hardware check.

### 4. Build and Test the DSP Core

The committed WebAssembly DSP artifacts let JavaScript-only contributors run the app
without Emscripten. Changes under `dsp/`, `plugins/dsp/`, or a plugin's DSP parameter
schema require the pinned toolchain recorded in `dsp/EMSDK_VERSION` (currently 6.0.13),
CMake 3.24 or newer, Ninja, Python 3.10 or newer, and a C++20 compiler.

```bash
npm run gen:dsp
npm run test:dsp:warnings
npm run test:dsp -- --native-build-type=Debug
npm run test:dsp -- --native-build-type=Release
npm run build:dsp
npm run test:dsp:parity
```

- `gen:dsp` validates every `params.json` and updates the generated C++ and JavaScript
  parameter layouts.
- `test:dsp:warnings` uses the pinned Emscripten Clang frontend to compile every native
  test source registered with CMake using warnings as errors, including
  `-Wunused-but-set-variable`.
- The two `test:dsp` runs build the native core, allocation guard, and parity
  runner, then run CTest in both configurations used by CI.
- `build:dsp` verifies the active Emscripten version and rebuilds the committed baseline
  and SIMD modules plus deterministic metadata under `plugins/dsp/`; it also runs the
  native-test warning check before building the modules.
- `test:dsp:parity` checks both shipped modules against the committed JavaScript goldens.

Note Spectrogram ships fixed float32 HarmNet weights in the generated hex-float
header `dsp/plugins/analyzer/note_spectrogram/harmnet_weights.h`. Its adjacent
`harmnet_weights.provenance.json` records the architecture, calibration, artifact
digest, and dataset-level training proportions. Replace both when updating the
model, then regenerate its native parity goldens and DSP modules.

Rhythm Analyzer's onset lanes (`rhythm_d_low`, `rhythm_d_mid`, and
`rhythm_d_high` in `dsp/plugins/analyzer/rhythm_analyzer/`) ship learned tree
models as `.bin` files with small JSON manifests. The shared
`dsp/plugins/analyzer/tree_models/` folder
owns the format, the evaluators (`heap_tree_model.h` and `oblivious_tree_model.h`),
the tools (`compact_model.py` and `embed_models.py`), and `models.cmake`, which
lists every model and embeds it into the `effetune_tree_models` target. Replace a
complete binary and its manifest when updating a model; retain the training
provenance at dataset level and update the reference fixtures if the predictions
change. The binary format concatenates, in
order and all little-endian: split feature indices (`uint8`); split thresholds;
for `index8` thresholds, the per-feature borders (IEEE 754 binary32) and their
start offsets (`uint32`); leaf values; and for integer leaves, one binary32 scale
per tree and output. Align each array to its element width with zero padding.
`thresholdType` is `float` (binary32 values) or `index8` (indices into the
feature's strictly increasing borders). `leafType` is `float`, `double`, `int16`,
or `int8` (value = stored integer × scale). With `"layout": "oblivious"`, each
tree stores one split per level, and split k sets bit k of the leaf index. The
manifest records format version 1, model dimensions, constants, output count,
layout, threshold and leaf types, the border count for `index8`, the source-model
hash, and the SHA-256 of the complete binary.
Export float thresholds and float or double leaves, then run
`python compact_model.py <manifest.json>` to rewrite the model in place. It
converts the thresholds to `index8` when no feature has more than 256 distinct
thresholds, which is exact. Add `--oblivious` to store symmetric trees in the
oblivious layout, which is also exact, and `--leaves int16` or `--leaves int8` to
quantize float leaves; this is lossy, so accept it only after evaluating the
model's predictions. The oblivious layout requires `index8` thresholds and `int16`
or `int8` leaves, and `int8` leaves require the oblivious layout, so pass `--leaves`
together with `--oblivious`.

CMake runs `embed_models.py` when a model or its generator changes, validating the
hash, dimensions, feature and threshold indices, border order, and finite numeric
values. It produces small declaration headers and embeds the data directly in a
read-only section: assembler `.incbin` for Linux, macOS, and WASM, or a
relocation-free COFF object for MSVC x64 and ARM64. Generated files stay in the
build directory. Models require no runtime file access, decoding pass, allocation,
or extra copy, and do not pass through the C++ compiler as millions of numeric
literals. Binary inputs are hashed byte-for-byte
by the DSP artifact freshness check. Model reader tests run in native CTest.

Rhythm Analyzer's beat path uses the fixed T48M causal TCN in
`tc_tcn_weights.h`: binary16 weights and float32 input normalization values.
`tc_constants.h` supplies derived frontend and rate-conversion tables;
`rhythm_d_tables.h` supplies the onset detector and supported-rate constants.
The RD6 decoder derives its state topology and transition constants during
`Rd6Decoder::prepare`; these are not learned parameters. Its
`rd6_decoder.provenance.json` records the decoder source and Python reference
hashes and the derivation settings.

Each shipped model and generated header has adjacent provenance describing its
artifact digest, dataset-level training information or derived-constant method,
and numerical or runtime contract. Update that provenance with the artifact;
keep individual input files and selection records private.
`tools/rhythm-analyzer/export.py` reproduces the frozen TCN export and generates
weight and frontend header candidates, while the tools in the same directory
provide the ordered numerical reference and evaluation checks. See
`tools/rhythm-analyzer/README.md` for the required inputs and commands. Normal
DSP builds compile or embed the committed artifacts without retraining or
regenerating their values.

Regenerate an affected golden whenever DSP behavior or an input that defines
the golden changes. Those inputs include the reference implementation, cases,
comparison policy or tolerance, and revision metadata; a metadata-only mismatch
is still stale generated state. Exact native parity can also vary by compiler or
architecture, so run the native acceptance path on every available
CI-equivalent platform and report unavailable platforms as residual risk rather
than changing a tolerance from CI evidence alone.

The root Node.js suite does not run installed Python wheel tests. Changes to a
DSP binding, generated cross-language contract, or its tests must also run that
binding's package and acceptance checks. For Python, build and install a
candidate wheel, then use the same unittest, native-export audit, and golden
runner sequence defined in `.github/workflows/dsp-library-ci.yml`.

Windows wheel repair uses `tools/repair-dsp-windows-wheel.py` through the shared
cibuildwheel configuration. It selects the redistributable for the compiler
recorded by CMake and verifies the bundled runtime after repair. An unrelated
Java or Python installation earlier on `PATH` must not select an older C++
runtime. Use the shared repair command for local release candidates too; do not
replace it with a bare `delvewheel repair` command.

Set `EMSDK` to the activated SDK root on Windows. Use `npm run build:dsp -- --check` for
a write-free freshness check. Kernel preparation and instance creation run between audio quanta and may
grow WASM memory; processing itself must never allocate, lock, perform I/O, or grow
memory. See `dsp/README.md` for the ABI and kernel workflow.

Before rebuilding artifacts for a commit that changes C++ under `dsp/`, format the changed
sources and run the same repository-wide non-vendor check as the DSP Core workflow:

```bash
find dsp -path dsp/vendor -prune -o \( -name '*.cpp' -o -name '*.h' \) -print0 | xargs -0 clang-format --dry-run --Werror
```

On Windows PowerShell, use the equivalent check:

```powershell
Get-ChildItem dsp -Recurse -File |
  Where-Object { $_.Extension -in '.cpp', '.h' -and $_.FullName -notmatch '[\\/]dsp[\\/]vendor[\\/]' } |
  ForEach-Object { clang-format --dry-run --Werror $_.FullName }
```

Use a current clang-format version that accepts the repository's `.clang-format`; the LLVM
binary bundled with the current Visual Studio installation is suitable on Windows. A parser
or configuration error is a failed check. `npm run verify` does not include this C++ check.
Run formatting before `npm run build:dsp` because formatting changes the committed DSP source
digest. After the build, rerun it and confirm that no managed files change on the second run.

For a browser runtime check, open the served app, start the audio graph with a user
gesture, and confirm the console stays free of `[dsp-wasm]` warnings. Repeat once with
`?dsp=off` and confirm that the JavaScript compatibility path starts without any
`[dsp-wasm]` messages. Browsers that do not acknowledge a cloned compiled module are
retried automatically with the retained WASM bytes.

### 5. Run in Development Mode

To start the application in development mode:

```bash
npm start
```

To debug the web version in a browser with no-cache dynamic loading for plugins:

```bash
npm run dev
```

To test only the web app without building the DSP library or documentation site:

```bash
npm run dev -- --web-only
```

Open `http://127.0.0.1:8000/effetune.html`. This mode serves the working tree directly
with development cache suppression and uses the existing DSP artifacts. Ruby and
Jekyll are not required. Documentation pages are not rendered in this mode.
Add `--port 8080` to use another port. Stop the server with Ctrl+C.

The standalone measurement helper, `python features/measurement/server.py`, listens only on
`127.0.0.1:8000` and serves the measurement page and public app assets from this checkout,
independently of the shell's current directory. Open
`http://127.0.0.1:8000/features/measurement/measurement.html`. Directory listings, hidden paths,
Python sources and files outside the public asset folders are not served. Its tests run with
`python -m unittest discover -s tests -p test_measurement_server.py`.

With the full `npm run dev` command, open:

- `http://localhost:8000/effetune.html` for the web app
- `http://localhost:8000/` for the local documentation site home
- `http://localhost:8000/dsp/` for the DSP library documentation
- `http://localhost:8000/docs/i18n/ja/` for a localized documentation page

The development server first builds the DSP browser package, builds `_site` with GitHub
Pages 232 in the production environment, and stages the complete DSP site snapshot under
the rendered guide. It then serves that output while Jekyll watches for changes, refreshing
the staged demo, schemas, catalog, LLM index, and site manifest after every Jekyll rebuild.
The initial build can take a few minutes. Documentation pages therefore use the real Liquid
layouts, kramdown renderer, navigation data, and permalink handling instead of a separate
development-only Markdown implementation. Web application assets still receive the
development server's no-cache behavior.

### Preview Multichannel UI Without Multichannel Hardware

After the app has loaded, run this in the developer Console:

```javascript
uiManager.setDebugChannelCount(16);
```

This immediately refreshes the channel selectors, Matrix, Multi Channel Panel,
Pipeline Analyzer controls, and channel-count label for layout inspection. It does
not change the audio device, AudioContext, worklet, or DSP channel count. This is
only a UI debug preview: playback, processing, analysis, and other operations may
fail or disagree with the displayed channel count. Making those operations work
in this mode is explicitly not a requirement; do not add compatibility fixes or
tests requiring full functionality. Use it to inspect layouts, not to validate audio.

Pass an integer from 1 to 16 to preview another count. Clear the override with
`uiManager.setDebugChannelCount(null)` or reload the page. The override is not saved;
ordinary plugin edits made during the preview still follow normal save behavior.

## Building the Application

EffeTune can be built as a portable application or as an installer. The build process is configured in the `package.json` file under the `build` section.

### Build Configuration

The build configuration in `package.json` includes:

- **appId**: `com.frieve.effetune`
- **productName**: `EffeTune`
- **Output directory**: `dist`
- **File associations**: `.effetune_preset` files
- **Build targets**:
  - Windows: NSIS installer and portable executable
  - macOS: DMG (x64 and arm64 architectures)
  - Linux: AppImage

### Build Commands

To build the application, use the following npm commands:

- **Build all versions**:
  ```bash
  npm run build
  ```

- **Build portable app only**:
  ```bash
  npm run build:portable
  ```

- **Build installer only**:
  ```bash
  npm run build:installer
  ```

- **Build macOS application (ARM64 only)**:
  ```bash
  npm run build:mac:arm64
  ```

- **Build macOS application (x64 only)**:
  ```bash
  npm run build:mac:x64
  ```

- **Build Linux application**:
  ```bash
  npm run build:linux
  ```

- **Clean the build directory**:
  ```bash
  npm run clean
  ```

The Electron build scripts and GitHub Pages workflow run `npm run assets:web` automatically before packaging or deployment. This regenerates the browser metadata parser bundle, its third-party notice file, and `sw-precache.js`. If you add or remove web assets outside those flows, run `npm run assets:web` before committing.

Keep each vendored library's complete license and bundled dependency notices in
`js/vendor/` beside its code. Update those notices when replacing a vendor file;
a license name or upstream link alone does not replace a required license text.
For desktop dependencies whose published package omits that text, retain the
upstream author and declared license in `electron/THIRD_PARTY_NOTICES.txt`.
Browser extension builds preserve legal comments and include the notices for
the vendor files they ship. Keep the extension's vendor notice mapping current
when introducing another vendor file.

`plugins/dsp/NOTICE.txt` is the shared DSP and WebAssembly runtime notice,
including PFFFT, fdlibm, Emscripten, and musl. Desktop and web distributions
ship it under `plugins/dsp/`; the JavaScript package copies it to
`dist/assets/NOTICE.txt`, and the Python wheel installs it as
`effetune/licenses/DSP-NOTICE.txt`.

Keep public training-data records at dataset level, retaining the broad dataset
names already published. Do not publish details identifying individual training
files for reproducibility, including track IDs, file lists, paths, or hashes.
Apply this granularity to the current worktree and future changes, and keep
detailed usage and licensing evidence private. Model artifact hashes and
structural metadata used to verify the shipped artifacts may remain public.
Preserve notices required for third-party code and material actually
redistributed; learning parameters from a dataset does not by itself establish
a disclosure or attribution obligation.

The Tonal Balance EQ target-table generator publishes counts by style and license,
without individual track identifiers or input archive fingerprints. Verify this
with `python -m unittest discover -s dsp/plugins/eq/tonal_balance_eq -p test_learn_targets.py`.

### Official ECS builds and Widevine signing

Desktop release packages use Castlabs' official Electron for Content Security
(ECS) for Windows x64, Linux x64, and macOS x64/arm64. Windows and macOS require
production streaming VMP signatures from its EVS service; Linux does not use VMP.
The regular development dependency and local build commands remain unchanged.

#### GitHub Actions release setup

In the repository's **Settings → Secrets and variables → Actions → Secrets**,
select **New repository secret** and add these two values from your existing
EVS account:

| Repository secret | Value |
| --- | --- |
| `EVS_ACCOUNT_NAME` | The Account Name chosen during EVS signup |
| `EVS_PASSWD` | The EVS account password |

Use repository secrets for this configuration, not Actions variables or environment
secrets. Do not put either value in source files, command arguments, or build logs.
See [GitHub's secret setup](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-a-repository).

The existing `desktop-release.yml` workflow accepts only a tag exactly matching
`v${package.version}` in `Frieve-A/effetune`. Its Windows and macOS jobs pass the
two named secrets explicitly to the reusable `build.yml` workflow after source preflight
succeeds. Ordinary CI, pull requests, forks, and Dependabot runs do not sign.
Missing credentials, authentication failures, or signature verification failures
fail the affected release job; it does not fall back to an unsigned release.

The workflow downloads the official ECS 44.9.3+wvcus archive for the runner's
architecture and verifies its pinned SHA-256. Linux packages that runtime as an
AppImage, retaining the separate GPG signing and OpenHome provenance checks.

Windows authenticates with `castlabs-evs==1.3.2` using environment variables and
`--no-ask`. It signs and verifies `dist/win-unpacked`, packages that directory
with `--prepackaged`, and verifies VMP again before uploading artifacts.
macOS authenticates with the same client, finalizes the application resources,
then requests VMP in electron-builder's `afterPack` hook before macOS ad-hoc code
signing. The app and its helpers use `build/entitlements.mac.plist`, including
the library-validation entitlement needed for the downloaded Widevine CDM.
The workflow verifies VMP after code signing, creates the DMG from that exact
prepackaged `.app` without re-signing it, and verifies VMP again afterward.
The authentication configuration is stored through `EVS_CONFIG_FILE` under the
runner's temporary directory and removed after the signing step, including on
failure. Credentials and this configuration are not included in artifacts or caches.
The Windows packaging step checks that the executable is unchanged; its final VMP check
uses the local signature and needs no EVS credentials.

These secrets authorize Widevine VMP signing. They do not provide Windows
Authenticode or Apple Developer ID signatures. macOS uses an explicit ad-hoc
identity and does not require Apple credentials or notarization. Windows
Authenticode, if added, must run before VMP signing. This workflow produces
artifacts for the existing desktop Release draft process; it does not publish
a GitHub Release.

#### Local ECS packaging

Use the opt-in ECS pack command to prepare a local Widevine-enabled build.
Download the Windows x64 ZIP from the [pinned ECS release](https://github.com/castlabs/electron-releases/releases/tag/v44.9.3%2Bwvcus), then run:

```powershell
npm run pack:ecs:win -- --runtime-zip 'C:\Downloads\electron-v44.9.3+wvcus-win32-x64.zip'
```

For an already prepared application snapshot with its own installed dependencies,
`node scripts/pack-ecs.mjs --runtime-zip '<ZIP>' --app-dir '<snapshot>'`
packs that snapshot. Prepare its assets and sidecar before invoking the runner directly;
keep the development-only `build` configuration in the root package, not the snapshot's
`package.json`.

The command verifies the official archive hash and prepares
`out/ecs/win32-x64/win-unpacked`. The executable's icon and version resources
are finalized during packing. OS code signing is disabled for this command,
and it does not request a VMP signature;
the original ECS development signature cannot be reused after executable edits.

Install the [official EVS client](https://pypi.org/project/castlabs-evs/) in a
dedicated Python environment. Use an existing EVS account; if authentication is
needed, run `python -m castlabs_evs.account reauth` in your own terminal and enter
credentials there. Do not put passwords in command arguments or repository files.
On Windows, apply Authenticode signing first if it is part of your distribution
process, then request and verify the streaming VMP signature:

```powershell
python -m castlabs_evs.vmp --no-ask sign-pkg --streaming 'out/ecs/win32-x64/win-unpacked'
python -m castlabs_evs.vmp --no-ask verify-pkg --streaming 'out/ecs/win32-x64/win-unpacked'
```

The EVS client uploads the executable when a new signature is needed and writes
its `.sig` sidecar. Keep that file with the application. After verification,
freeze the application directory and package that exact directory:

```powershell
node scripts/pack-ecs.mjs --prepackaged 'out/ecs/win32-x64/win-unpacked' --output 'out/ecs/win32-x64/installers'
```

Do not run a fresh pack over the signed directory. Verify the VMP signature again
after extracting or installing the resulting package. VMP and OS code signing
are separate: Windows requires VMP **after** OS signing; macOS requires VMP
**before** OS signing. Linux does not use VMP. See the [official EVS signing order](https://github.com/castlabs/electron-releases/wiki/EVS#signing-an-ecs-application-package).

On Linux x64 and macOS x64/arm64, prepare the assets and native sidecar, then use
`node scripts/prepare-ecs.mjs` to download and check the matching runtime and
`node scripts/pack-ecs.mjs --output '<directory>'` to package it. Both helpers
select the host architecture. Linux produces an AppImage; macOS produces a
directory containing `EffeTune.app`, with OS and VMP signing disabled by default.
On macOS, explicitly adding `--sign-vmp` requests VMP before ad-hoc signing and
verifies it afterward; authenticate with EVS first. Package the verified app with
`node scripts/pack-ecs.mjs --prepackaged '<directory>/mac/EffeTune.app' --output '<directory>'`
(use `mac-arm64` for arm64). This produces a DMG without changing the signed app.

ECS downloads the Widevine CDM through its component updater; do not copy a CDM
from a development profile into the package. Its pinned Electron version may lag
the normal dependency, so validate the completed application on that runtime.
A valid VMP signature does not establish
compatibility with a particular streaming service or guarantee audio capture.

### Linux AppImage signing

Desktop release builds create a GPG detached signature of the final AppImage.
`EffeTune-<version>-Linux-AppImage.zip` contains the executable AppImage,
`EffeTune-<version>.AppImage.asc`, and `EffeTune-AppImage-signing-key.asc`.
The signature authenticates the AppImage bytes without repacking it. It is a
separate file, not an embedded AppImage signature, and Linux does not automatically
enforce it when launching the application. Local `npm run build:linux` builds
remain unsigned.

#### Create a signing key on Windows

Install [Gpg4win](https://www.gpg4win.org/download.html), open a new PowerShell
terminal, and check `gpg --version`. Create a dedicated signing key using a
public contact address you control in place of the example:

```powershell
gpg --quick-generate-key "EffeTune AppImage Signing <you@example.com>" rsa4096 sign 2y
gpg --list-secret-keys --keyid-format long --with-fingerprint "EffeTune AppImage Signing"
```

Enter a new, unique passphrase in GnuPG's prompt. Generate and store it in your
password manager; for example, use at least 24 random printable ASCII characters
without line breaks. Do not put it in a command or send it in chat. Record the
full 40-character fingerprint shown below the `sec` line, without spaces.
The name and contact address are public parts of the exported key.

Export the passphrase-protected private key and the public key to a private
directory outside this repository:

```powershell
$signingDirectory = Join-Path $env:USERPROFILE 'EffeTune-signing'
New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
$fingerprint = 'REPLACE_WITH_THE_FULL_40_CHARACTER_FINGERPRINT'
gpg --armor --output "$signingDirectory\appimage-private-key.asc" --export-secret-keys $fingerprint
gpg --armor --output "$signingDirectory\EffeTune-AppImage-signing-key.asc" --export $fingerprint
gpg --output "$signingDirectory\appimage-revocation.asc" --gen-revoke $fingerprint
```

Keep an encrypted offline backup of the private key, its passphrase, and the
revocation certificate. The revocation certificate can invalidate this key, so
keep it private as well. Do not import it unless you intend to revoke the key.
The key expires after two years. Before expiry, run
`gpg --quick-set-expire $fingerprint 2y`, export the keys again, update the
private-key secret, and publish the renewed public key. The fingerprint stays
the same.

#### Configure repository secrets

Open **Settings → Secrets and variables → Actions → Secrets → New repository
secret** in `Frieve-A/effetune`, and register:

| Repository secret | Value |
| --- | --- |
| `APPIMAGE_GPG_PRIVATE_KEY` | The entire `appimage-private-key.asc` text, including the BEGIN/END lines and line breaks; no Base64 conversion |
| `APPIMAGE_GPG_PASSPHRASE` | The passphrase entered when creating the key |
| `APPIMAGE_GPG_KEY_FINGERPRINT` | The full 40-character fingerprint, without spaces |

Use repository secrets, not Actions variables. The fingerprint is public but is
passed as a named secret alongside the other signing inputs. With an authenticated
[GitHub CLI](https://cli.github.com/manual/gh_secret_set), the equivalent PowerShell
commands are:

```powershell
Get-Content -Raw "$signingDirectory\appimage-private-key.asc" | gh secret set APPIMAGE_GPG_PRIVATE_KEY --repo Frieve-A/effetune
gh secret set APPIMAGE_GPG_PASSPHRASE --repo Frieve-A/effetune
gh secret set APPIMAGE_GPG_KEY_FINGERPRINT --repo Frieve-A/effetune --body $fingerprint
gh secret list --repo Frieve-A/effetune
```

Enter the passphrase at the CLI's hidden prompt. Verify each command succeeds.
After verifying the encrypted backup and secret registration, remove the temporary
private-key export from this directory. Never commit private keys, passphrases,
or revocation certificates.

The Linux job in `desktop-release.yml` passes only these three named secrets to
`build.yml`. Signing requires the official repository and an exact
`v${package.version}` tag after the common preflight. It imports the key into an
isolated temporary GnuPG home, checks the exported public key's fingerprint, signs
with that exact key using the passphrase on stdin, and verifies the result with
`gpgv` and the exported public key before creating the release ZIP. Missing secrets,
an incorrect passphrase or fingerprint, an unusable key, or a failed verification
fails the job before artifact upload. The temporary keyring and its GnuPG agent
are cleaned up on success or failure. Signing secrets are not passed to Windows,
macOS, ordinary CI, or pull-request builds. The workflow creates artifacts; it
does not publish a GitHub Release.

#### Verify a downloaded release

Publish the public key and full fingerprint on an official project channel, and
include the fingerprint in the desktop Release notes. A public key bundled beside
an untrusted download does not by itself establish who signed it.
After extracting the Linux ZIP, compare the key's fingerprint with the official
one, then verify the signature before running the AppImage:

```bash
gpg --show-keys --with-fingerprint EffeTune-AppImage-signing-key.asc
gpg --import EffeTune-AppImage-signing-key.asc
gpg --verify EffeTune-<version>.AppImage.asc EffeTune-<version>.AppImage
```

Replace `<version>` with the downloaded version. Require a successful exit status
and `Good signature` from the expected fingerprint. GnuPG may warn that the key is
not certified by a trusted signature; independently checking the official
fingerprint is still necessary. The detached `.asc` signature is verified by GnuPG,
not by `--appimage-signature`, which only displays an embedded signature.
See the [GnuPG key-management manual](https://www.gnupg.org/documentation/manuals/gnupg/OpenPGP-Key-Management.html)
and [AppImage's signature documentation](https://docs.appimage.org/packaging-guide/optional/signatures.html).

### Browser Extension

Build the Chrome and Edge extension separately from the desktop application:

```bash
npm run build:extension
```

The build writes the unpacked extension to `out/extension/` and a distributable archive
to `out/effetune-extension-<package.json version>.zip`. The unpacked directory is the
manual-load target for Chrome or Edge; extract the ZIP before using **Load unpacked**.

Run the extension smoke check after changing its packaging, manifest, session handling,
or editor integration:

```bash
npm run test:extension-browser
```

The extension is its own Manifest V3 package. Do not add extension-only files or assets
to the desktop and Web/PWA packages, and keep the generated `out/` artifacts untracked.

For automated Chrome CRX signing and Chrome/Edge store submission from release tags,
see [Browser extension releases](extension/RELEASING.md), including the required
repository secrets, store API setup, and manual upload-only runs.

### Web and PWA Assets

The web app uses `manifest.json`, `sw.js`, and generated `sw-precache.js` for installable/offline app-shell support. Service Worker registration is web-only and is skipped in Electron.

Before release, verify that the web app loads normally, can be installed where supported, and still opens after going offline once the app shell has been cached.

The original numeric fonts in `css/fonts/` are committed assets; normal builds
do not require Python. To regenerate them after editing their geometry, install
the optional authoring tools with
`python -m pip install "fonttools[woff]==4.57.0" "brotli==1.0.9"`, then run
`python scripts/generate-numeric-fonts.py` and include the regenerated fonts.

### OpenHome Sidecar

The native OpenHome sidecar requires Node.js, npm, CMake 3.21 or newer, and a
64-bit native C++ toolchain. Platform prerequisites are:

- Windows x64: Visual Studio 2022 C++ build tools, including the x64 compiler
  and NMake.
- macOS x64 or arm64: Xcode Command Line Tools, CMake, and Make. Build each
  architecture on its matching GitHub Actions runner or host architecture.
- Linux x64: GCC or Clang, CMake, Make, pkg-config, `libnl-3-dev`,
  `libnl-genl-3-dev`, `dpkg-dev`, `readelf`, and `ldd`. Exact source bundle
  generation also requires enabled `deb-src` entries for the same Ubuntu
  repositories that supplied the installed binary packages.

Use the canonical producer before packaging:

```bash
npm run build:openhome-sidecar -- --no-publish-development
```

For macOS, select exactly one architecture on both the producer and
electron-builder command line. The maintained package entry points do this and
start from a clean output directory:

```bash
npm run build:mac:x64
npm run build:mac:arm64
```

The producer downloads revisions pinned in
`native/openhome-sidecar/dependencies.lock.json`, verifies every archive's
SHA-256 hash, and reuses the ignored `tmp/cache/openhome-sidecar/` directory.
It runs CTest and a stdio handshake smoke, then writes one of:

- `out/native/openhome-sidecar/win32-x64/effetune-openhome-sidecar.exe`
- `out/native/openhome-sidecar/darwin-x64/effetune-openhome-sidecar`
- `out/native/openhome-sidecar/darwin-arm64/effetune-openhome-sidecar`
- `out/native/openhome-sidecar/linux-x64/effetune-openhome-sidecar`

Linux builds dynamically link libnl. The producer copies the exact libnl and
libnl-genl shared objects resolved by the build host's loader beside the
sidecar, and the executable resolves them through `$ORIGIN`. The AppImage keeps
those files beside the sidecar under `resources/openhome/` and includes the
tracked libnl license text. On Linux, the canonical producer also writes
`libnl-runtime-manifest.json` with each packaged binary's SHA-256, exact dpkg
package/version/architecture, and exact source package/version before packaging
can begin. `npm run smoke:openhome-package` verifies that manifest against the
package contents and, on Linux, verifies packaged loader resolution.

Tagged desktop release builds enable Ubuntu `deb-src` entries and run:

```bash
npm run collect:openhome-linux-provenance -- --with-source
npm run verify:openhome-linux-provenance -- --require-source
```

This downloads the exact Debian source package set referenced by the installed
libnl binaries, verifies the `.dsc` SHA-256 list and `dpkg-source` extraction,
and fails the release if the upstream source or distribution patch/build
archive is missing. The Linux release artifact contains both
`EffeTune-<version>-Linux-AppImage.zip` and
`EffeTune-<version>-OpenHome-Linux-Source.zip`; the latter contains the source
files and the same provenance manifest shipped inside the AppImage.

Use `npm run pack:win` for an unpacked Windows package and smoke check, or
`npm run build:linux` for the Linux AppImage. The macOS commands above produce
one DMG architecture per clean build.

Desktop release packaging runs only in `Frieve-A/effetune` for an exact
`v${package.version}` tag. A preflight job must succeed before any platform job
runs. That preflight performs the full source verification once; the platform
jobs retain only host-filesystem checks plus packaged DSP and OpenHome smoke
checks. Windows release packages use ECS and require EVS VMP signing as described
above; Linux packages require the GPG detached signature described above.
macOS retains its existing Electron packaging. Windows Authenticode and Apple
Developer ID signing are not configured by this workflow. Central CI verifies the app's DSP
core on a desktop tag but leaves desktop package production to this release
workflow, and it does not rebuild the separately released Python/npm DSP
Library matrix. Tags beginning with `dsp-v` belong to the separate DSP library
release workflow and cannot start the desktop release workflow.

For a Windows release, attach `latest.yml` and
`EffeTune-<version>-Setup.exe.blockmap` beside the NSIS installer. The in-app
updater requires these files. They are generated for that exact installer, so
do not combine a regenerated installer with metadata from another build. The
updater reads them from the `v<version>` release it selected, never from the
newest release of the repository, which is often a DSP library release.

## Build Output

After a successful build, you'll find the following in the `dist` directory:

- **Windows Portable application**: `EffeTune-x.xx.x-Portable.exe` (where x.xx.x is the version number)
- **Windows Installer**: `EffeTune-x.xx.x-Setup.exe` (NSIS installer)
- **Windows update metadata**: `latest.yml`
- **Windows installer block map**: `EffeTune-x.xx.x-Setup.exe.blockmap`
- **macOS application**:
  - `EffeTune-x.xx.x-x64.dmg` (Intel Mac)
  - `EffeTune-x.xx.x-arm64.dmg` (Apple Silicon Mac)
- **Linux application**: `EffeTune-x.xx.x.AppImage`
- **Other build artifacts**: Various files created during the build process

The file naming convention has been configured in the `package.json` file to clearly distinguish between the portable application and the installer.

## Application Structure

The EffeTune Electron application consists of several key components:

### Main Process (`main.js`)

The main process is responsible for:
- Creating and managing the application window
- Setting up the application menu
- Handling IPC (Inter-Process Communication) with the renderer process
- Managing file system operations
- Handling audio device enumeration

### Preload Script (`preload.js`)

The preload script securely exposes Electron APIs to the renderer process through the contextBridge:
- File system operations
- Documentation rendering
- Audio device operations
- IPC event listeners

### Electron Integration (`js/electron-integration.js`)

This module integrates the web application with Electron-specific features:
- Detecting the Electron environment
- Handling file import/export
- Managing audio preferences
- Processing audio files
- Displaying dialogs

## Customizing the Build

### Application Icon

To change the application icon:
1. Replace `images/favicon.ico` (Windows) and `images/icon.png` (macOS/Linux) with your custom icons
2. Ensure the icons are referenced correctly in the `build` section of `package.json`

### Application Metadata

To modify application metadata:
1. Update the relevant fields in `package.json`:
   - `name`
   - `version`
   - `description`
   - `author`
   - `license`

### Installer Options

To customize the installer behavior:
1. Modify the `nsis` section in the `build` configuration in `package.json`

### Bundled Files

The `build.files` array in `package.json` is an explicit allowlist of top-level directories and files to bundle into the application. This keeps repo-only assets (Jekyll site files, dev scripts, docs metadata, untracked work-in-progress files outside the allowlisted directories, etc.) out of the installer.

When adding a new top-level directory or root file that must ship with the app, add a matching entry to `build.files`. Otherwise the build will silently omit it.

Application stylesheets in `css/` and root web assets such as `sw.js`, `sw-precache.js`, `manifest.json`, icons, screenshots, and vendor scripts must be included when they are required at runtime.

## Troubleshooting

### Common Build Issues

1. **Missing dependencies**:
   - Ensure all dependencies are installed with `npm install`
   - Check for any peer dependency warnings

2. **Electron download fails**:
   - Check your internet connection

3. **Antivirus blocking the build**:
   - Temporarily disable antivirus software
   - Add exceptions for the project directory

### Runtime Issues

1. **Audio device access problems**:
   - Ensure proper permissions are granted to the application
   - Check the audio device configuration in the application settings

2. **File association issues**:
   - Reinstall the application using the installer
   - Manually associate `.effetune_preset` files with the application

## DSP Library documentation verification

Generate the public library pages with `npm run docs:dsp`, then check them with
`npm run docs:dsp:check`. The source prose and runnable examples live under
`examples/dsp-library/`; do not edit generated pages directly.

Run `node tools/verify-dsp-library-goldens.mjs` to check the frozen reference
suites. The generator validates their coverage against the current catalog.
The suites include JavaScript-derived, native direct-double, independent native,
and production-native-promoted references. The independent filter reference uses
RBJ biquads in direct form I and direct FIR convolution.

The visual-editor acceptance test freezes `Date.now()` and compares its export
with the committed fixture. It then copies that fixture into a temporary working
directory as `listening.effetune_preset` and runs the public Python example there.

CI acceptance summaries are temporary workflow artifacts, not public Release
assets. The repository Chromium harness uses a special `file:` flag for testing;
public browser integrations still require HTTPS or localhost.

## Distribution

After building the application:

1. **Testing**:
   - Test the application thoroughly on the target platforms
   - Verify all features work as expected

2. **Distribution**:
   - Upload the installer and/or portable application to your distribution platform
   - Update the download links in your documentation

3. **Updates**:
   - Increment the version number in `package.json` for new releases
   - For Windows installer releases, upload the matching `latest.yml` and installer block map with the installer so the in-app update can download it

## Microsoft Store MSIX packaging

The Store package wraps the final Windows x64 ECS application with Windows SDK
MakePRI and MakeAppx. It does not rebuild the application or change its executable.
Complete the existing EVS VMP signing and verification first, and package before
adding `effetune_settings` for the Portable ZIP. Never edit the executable after
VMP signing. The existing NSIS and Portable outputs remain separate artifacts.

Set `name`, `publisher`, `publisherDisplayName`, and `productId` in
`build/msix/store-identity.json` to the exact Partner Center values. They are public
identifiers, not credentials. The checked-in null values deliberately stop a
submission build. For local packaging checks only, `--test-identity` selects
`build/msix/test-identity.json` and marks the metadata `testOnly: true`; that
artifact must never be submitted to the Store.

```powershell
npm run pack:msix:win -- --prepackaged out/ecs/win32-x64/win-unpacked --output dist/store
# Without a Partner Center identity, exercise the same SDK packaging with:
npm run pack:msix:win -- --prepackaged out/ecs/win32-x64/win-unpacked --output out/msix/test --test-identity
```

The command selects the newest installed Windows SDK containing MakePRI and
MakeAppx; `--sdk-dir <Windows-Kits-bin/version/x64>` overrides that selection.
It stages beneath `out/msix`, rejects local settings/cache folders and links,
checks the packaged application version, generates file associations from
`package.json`, and unpacks the result to verify the manifest and unchanged EXE
and `.sig` hashes. The source application directory is left intact.
The manifest uses `Windows.Desktop`, x64, disabled-by-default `EffeTuneStartup`,
the `effetune` protocol, microphone access, and `runFullTrust`. Its Windows 10
22H2 minimum (`10.0.19045.0`) is a candidate pending the initial OS trials.
Images under `build/msix/Assets` are resized from `build/icon.png`: StoreLogo
50/100 px, Square44x44Logo 44/88 px, and Square150x150Logo 150/300 px.

Outputs are the unsigned `EffeTune-<version>-Store-x64.msix` and
`store-package.json`. The metadata records the source tag/commit, three-part
application version, four-part Windows version (`X.Y.Z.0`), Identity, hashes,
ECS version, SDK version, and test-only status. The Store signs the submitted
original. Do not distribute the unsigned package as a general installation file.

### Installed-package and WACK trial

Use a dedicated Windows 11 VM with an interactive test-user session, Node/npm
dependencies, the Windows SDK, and the Windows App Certification Kit. Provision
one QA administrator account with UAC enabled and an active desktop session, then
run the orchestrator elevated as that same account. The routine job must use this
interactive session, not a Session 0 service. Certificate trust, WACK and cleanup
run in the administrative orchestrator without per-release UAC prompts. Registered
launch, restart, file and protocol activation use a temporary Task Scheduler task
with that QA SID, the exact desktop session and explicit Interactive/Limited
permissions; no password is stored. The helper's identity/session and the app's
actual token are checked. Launch uses COM activation; file and protocol operations
use the registered Shell associations and verify their effect in the existing app.
The runner removes its task and package processes before
cleaning the test data and certificate. Do not run the trial on a personal workstation.

```powershell
npm run test:msix:installed -- -Package dist/store/EffeTune-2.15.0-Store-x64.msix -Metadata dist/store/store-package.json -ReportDirectory out/msix/installed-test -DedicatedTestVm
# To choose a different validated baseline explicitly:
# -PreviousPackage <previous-version.msix>
```

`-DryRun` only checks input metadata, hashes, and installed SDK/WACK paths. It
does not install, trust certificates, start the app, or certify the package.
Without `-PreviousPackage`, the first full trial creates an older manifest
version in a disposable copy, leaving `package.json` and the submission original
unchanged. Successful trials preserve the unsigned original and metadata in
`%LOCALAPPDATA%\EffeTuneMsixValidation\validated`, and select that validated
baseline automatically for a newer candidate. `-ValidatedPackageDirectory`
changes this VM-local cache location. `-PreviousPackage` overrides selection.

The runner refuses an existing registration or Store data, signs test copies,
checks clean installation and restart, then upgrades the older package to the
candidate. It activates through Windows package registration and uses a temporary
loopback CDP connection with the bundled Playwright probe. Checks cover the
Store flag, rendered main window, dedicated userData path, configuration,
presets, a library playlist, Browser bookmarks, OpenHome start/stop, application
of an identifiable file preset, restoration of a minimized
window by protocol activation, StartupTask registration, and a complete WACK pass
or pass with warnings. Required failures, unknown results and incomplete runs fail
validation. WACK warnings and optional failures remain in the report and console;
`wack.xml` retains the original SDK findings.
The report evaluator can be checked without installing or launching an app:
`powershell -NoProfile -File tests/msix-wack.test.ps1`.
The runner removes its packages, test certificate, processes, and scratch files, while
preserving `installed-test.json`, probe JSON/screenshots, and `wack.xml`.

VM execution is required before enabling routine validation or publishing.
The initial Windows 10/11 compatibility trial, actual audio devices, LAN clients
and Firewall behavior, login-triggered StartupTask operation, and Store-delivered
Widevine playback still require their dedicated environment checks. A successful
SDK pack or `-DryRun` does not establish those results.

### Store release automation

After the formal Identity is configured, repository variable
`MSSTORE_BUILD_ENABLED=true` adds the unsigned `store-msix-x64` artifact to the
desktop release build. `MSSTORE_VALIDATION_ENABLED=true` also selects the dedicated
`[self-hosted, Windows, X64, msix-validation]` runner. Both artifacts, including
`store-msix-validation`, are retained for 90 days. Leave these variables unset
until their inputs and VM are ready. The runner may set `MSIX_PREVIOUS_PACKAGE`
to override the automatically retained validation baseline.

Configure the `microsoft-store` GitHub Environment with variables
`MSSTORE_TENANT_ID`, `MSSTORE_SELLER_ID`, and `MSSTORE_CLIENT_ID`, and secret
`MSSTORE_CLIENT_SECRET`. Set repository variable `MSSTORE_CREDENTIAL_EXPIRES_AT`
to the credential expiry date in ISO format. Keep credentials out of Git and
artifacts. Initial listing drafts live in `build/msix/store-listing`.
Only after initial Partner Center publication and Store-installed validation,
enable `MSSTORE_AUTOPUBLISH_ENABLED=true` once to connect subsequent formal
GitHub Release publication to Store updates.

The release workflow checks the exact published tag, commit, MSIX hash and
installed-test report from a successful desktop build. GitHub Deployments record
the release input and submission ID; six-hour checks resume pending work without
holding a runner during certification. A submitted package remains pending until
the Store confirms publication. Manual workflow dispatch with an empty
`release_tag` resumes recorded work; an explicit tag must already be published.
Do not edit a submission concurrently in Partner Center. If an upload/commit
result is unknown or an unrelated draft exists, preserve it and investigate
before resubmitting. The pinned Microsoft Store CLI uses the MSIX positional
argument; submission metadata, commit and polling use Microsoft's submission API.

The Store app uses its own `EffeTune Store` data directory and leaves existing
NSIS/Portable data in place. It does not invoke the GitHub updater, legacy login
registration, or protocol registration. Windows handles package associations,
startup settings and updates; ordinary Store package updates retain the same
Identity and userData location.
