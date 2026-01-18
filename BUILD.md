---
title: "Build - EffeTune"
description: "Documentation for build in Frieve EffeTune audio processor."
lang: en
---

# EffeTune Desktop Application Build Guide

This document provides detailed instructions for setting up the development environment and building the EffeTune desktop application using Electron.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js** (v18 or later)
- **npm** (v8 or later)
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
- Electron (v35.0.0 or as specified in package.json)
- Electron Builder
- Other dependencies required by the application

### 3. Run in Development Mode

To start the application in development mode:

```bash
npm start
```

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

- **Clean the build directory**:
  ```bash
  npm run clean
  ```

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
