---
title: "Browser Extension - EffeTune"
description: "Use the EffeTune browser extension to process audio from one Chrome or Edge tab."
lang: en
---

# EffeTune Browser Extension

The EffeTune browser extension processes the audio from one browser tab with the same stereo Effect Pipeline used by EffeTune. It is useful for listening to a video or music site without starting the desktop app or configuring a virtual audio device.

## Compatibility

Use the extension on a PC with Chrome 116 or later, or a compatible Chromium-based version of Microsoft Edge. Firefox, Safari, mobile browsers, and private browsing are not supported. It processes one selected tab at a time through a stereo, serial effect chain.

## Install a local package

If you received the extension from a browser store, install it there. For a local package, extract `effetune-extension-<version>.zip` to a folder that you will keep, then load that extracted folder:

1. In Chrome, open `chrome://extensions`. In Edge, open `edge://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**, then select the extracted extension folder.

**Load unpacked** cannot install the ZIP file itself. Reload the extension from this page after replacing files in the extracted folder.

## Start, compare, and stop processing

1. Open the tab whose audio you want to process and begin playback.
2. Open the EffeTune extension from the browser toolbar.
3. Choose **Start processing**. The status changes from **Starting…** to **Processing** when the effect chain is ready.

The selected tab stays fixed for the session. To process a different tab, choose **Stop processing**, open the extension from that tab, and start again.

Use **Bypass effects** to hear the captured tab without effects while keeping the session active. Choose **Stop processing** when you are finished. Stopping releases the tab audio and returns the tab to its normal playback path.

You can close the extension popup or the editor while processing continues. When you open either one again, it shows the current tab and processing state. After restarting the browser, start a new session; the extension does not capture a tab automatically.

## Edit the Effect Pipeline and use presets

Choose **Edit pipeline** to open **EffeTune Pipeline Editor**. Add effects, change their order, enable or disable individual effects, and adjust their parameters as you would in EffeTune. Available analysis displays remain available in the editor.

Use **Saved preset** and **Apply** in the popup to change the complete pipeline without opening the editor. In the editor, open **Pipeline Presets** to save a complete pipeline preset with **Save as**. Open **Settings** and choose **Import preset…** or **Export preset** to import or export complete pipeline presets. Extension presets and saved settings stay in the extension; they do not automatically sync with the web app or desktop app.

If a preset needs an unsupported routing, effect, or unavailable external asset, it is not applied and the current pipeline remains unchanged.

To use a measurement from the web app or desktop app with Room EQ or Crosstalk Cancellation, export the measurement as JSON there. In the extension editor, open **Settings**, choose **Import measurement…**, then select that JSON file. Include impulse responses in the export when using Crosstalk Cancellation or Room EQ's phase correction. Imported measurements appear immediately in Room EQ's **Measurement** list, remain in the extension's browser storage, and do not sync automatically. To remove an imported copy, select it in that list and choose **Delete** beside the list. After confirmation, every Room EQ and Crosstalk Cancellation assignment that uses it is cleared before the copy is deleted.

## Permissions and limits

The extension captures audio only from the tab where you explicitly start processing. It does not need microphone access, access to every website, recording, or sending your audio elsewhere.

It supports ordinary stereo pipelines. Multibus or branching pipelines, more than two channels, taking measurements and device control, Music Library, batch file conversion, and desktop-only device or file-path features are unavailable in the extension.

Some protected content may not be available for capture. The extension does not bypass content protection. If capture cannot start, EffeTune stops processing and the tab returns to normal playback. Make sure the tab is playing audio, then choose **Start processing** again.

## If something goes wrong

- If the status shows **Needs attention**, make sure the selected tab is playing audio, then choose **Start processing** again.
- If a tab cannot be captured, make sure that tab is playing audio, then try again.
- If a preset cannot be applied, the editor keeps your current pipeline. Change the preset or make the required assets available before trying again.
