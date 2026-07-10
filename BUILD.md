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

### 3. Run Quality Checks

Run the default validation before handing code changes back:

```bash
npm run verify
```

This runs:

- `npm run lint`: ESLint checks for JavaScript syntax and high-confidence correctness hazards across Electron, renderer, plugin, feature, tool, and test code
- `npm test`: Node.js tests with the repository's coverage thresholds and test hygiene checks

Before lint and tests, `npm run verify` rebuilds the browser vendor assets and performs a
non-writing freshness check of the committed PWA precache. It does not regenerate a stale
`sw-precache.js`; if that check fails, run `npm run assets:web` and then rerun
`npm run verify`.

For narrower verification, use:

```bash
npm run lint
npm test
```

### 4. Build and Test the DSP Core

The committed WebAssembly DSP artifacts let JavaScript-only contributors run the app
without Emscripten. Changes under `dsp/`, `plugins/dsp/`, or a plugin's DSP parameter
schema require the pinned toolchain recorded in `dsp/EMSDK_VERSION` (currently 6.0.2),
CMake 3.24 or newer, Ninja, and a C++20 compiler.

```bash
npm run gen:dsp
npm run test:dsp
npm run build:dsp
npm run test:dsp:parity
```

- `gen:dsp` validates every `params.json` and updates the generated C++ and JavaScript
  parameter layouts.
- `test:dsp` builds the native core, allocation guard, and parity runner, then runs CTest.
- `build:dsp` verifies the active Emscripten version and rebuilds the committed baseline
  and SIMD modules plus deterministic metadata under `plugins/dsp/`.
- `test:dsp:parity` checks both shipped modules against the committed JavaScript goldens.

Set `EMSDK` to the activated SDK root on Windows. Use `npm run build:dsp -- --check` for
a write-free freshness check and `npm run build:dsp -- --debug` for the local debug
artifact. The debug module is excluded from the service-worker precache and packaged
applications. Kernel preparation and instance creation run between audio quanta and may
grow WASM memory; processing itself must never allocate, lock, perform I/O, or grow
memory. See `dsp/README.md` for the ABI and kernel workflow.

For a browser runtime check, open the served app with `?dspBench=1`, start the audio
graph with a user gesture, and inspect the console. A successful production path reports
`Ready: 67 kernels (SIMD)` (or `baseline`) followed by `Processing active` with a
positive `single-call blocks` count. The same statistics are available as
`window.dspStats`; `telemetryDroppedFrames` should remain zero during the check. Repeat
once with `?dsp=off` and confirm that the JavaScript compatibility path starts without
any `[dsp-wasm]` messages. Browsers that do not acknowledge a cloned compiled module
are retried automatically with the retained WASM bytes.

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
- `http://localhost:8000/docs/i18n/ja/` for a localized documentation page
- `http://localhost:8000/dev/effetune_test.html` for the development test page

The development server renders the documentation Markdown locally with the site layout, so the public site structure can be checked without running Jekyll separately.

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

- **Build macOS application**:
  ```bash
  npm run build:mac
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

2. **Build fails with code signing errors**:
   - Set `forceCodeSigning` to `false` in the build configuration
   - Or provide valid code signing certificates
3. **Electron download fails**:
   - Check your internet connection
   - The build configuration includes `strictSSL: false` to help with some network issues

4. **Antivirus blocking the build**:
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
