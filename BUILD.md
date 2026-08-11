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

Before pushing, also check the committed dependency graph:

```bash
npm audit --audit-level=moderate
```

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

### 4. Build and Test the DSP Core

The committed WebAssembly DSP artifacts let JavaScript-only contributors run the app
without Emscripten. Changes under `dsp/`, `plugins/dsp/`, or a plugin's DSP parameter
schema require the pinned toolchain recorded in `dsp/EMSDK_VERSION` (currently 6.0.2),
CMake 3.24 or newer, Ninja, and a C++20 compiler.

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

Then open:

- `http://localhost:8000/effetune.html` for the web app
- `http://localhost:8000/` for the local documentation site home
- `http://localhost:8000/dsp/` for the DSP library documentation
- `http://localhost:8000/docs/i18n/ja/` for a localized documentation page
- `http://localhost:8000/dev/effetune_test.html` for the development test page

The development server first builds the DSP browser package, builds `_site` with GitHub
Pages 232 in the production environment, and stages the complete DSP site snapshot under
the rendered guide. It then serves that output while Jekyll watches for changes, refreshing
the staged demo, schemas, catalog, LLM index, and site manifest after every Jekyll rebuild.
The initial build can take a few minutes. Documentation pages therefore use the real Liquid
layouts, kramdown renderer, navigation data, and permalink handling instead of a separate
development-only Markdown implementation. Web application assets still receive the
development server's no-cache behavior.

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

### Web and PWA Assets

The web app uses `manifest.json`, `sw.js`, and generated `sw-precache.js` for installable/offline app-shell support. Service Worker registration is web-only and is skipped in Electron.

Before release, verify that the web app loads normally, can be installed where supported, and still opens after going offline once the app shell has been cached.

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
SHA-256 hash, and reuses the ignored `native/openhome-sidecar/cache/` directory.
It runs CTest and a stdio handshake smoke, then writes one of:

- `native/openhome-sidecar/build/win32-x64/effetune-openhome-sidecar.exe`
- `native/openhome-sidecar/build/darwin-x64/effetune-openhome-sidecar`
- `native/openhome-sidecar/build/darwin-arm64/effetune-openhome-sidecar`
- `native/openhome-sidecar/build/linux-x64/effetune-openhome-sidecar`

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
runs. The Windows, macOS, and Linux jobs produce the same unsigned packages as
the maintained platform build commands. Tags beginning with `dsp-v` belong to
the separate DSP library release workflow and cannot start the desktop release
workflow.

## Build Output

After a successful build, you'll find the following in the `dist` directory:

- **Windows Portable application**: `EffeTune-x.xx.x-Portable.exe` (where x.xx.x is the version number)
- **Windows Installer**: `EffeTune-x.xx.x-Setup.exe` (NSIS installer)
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

Root web assets such as `effetune-mobile.css`, `sw.js`, `sw-precache.js`, `manifest.json`, icons, screenshots, and vendor scripts must be included when they are required at runtime.

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
   - Consider implementing an auto-update mechanism for future versions
