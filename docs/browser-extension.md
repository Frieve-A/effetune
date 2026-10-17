---
title: "Browser Extension - Equalizer & Audio Effects for Chrome and Edge - EffeTune"
description: "Process audio from up to four Chrome or Edge tabs with EffeTune, with URL presets and a selectable sample rate."
lang: en
---

# EffeTune Browser Extension

The EffeTune browser extension processes audio from up to four browser tabs at once, each with its own stereo Effect Pipeline. It is useful for listening to a video or music site without starting the desktop app or configuring a virtual audio device.

For details about local data handling and optional external links, read the [Browser Extension Privacy Policy](browser-extension-privacy.md). For help, use [GitHub Issues](https://github.com/Frieve-A/effetune/issues), but do not post audio, tab titles or URLs, presets, measurements, impulse responses, or other private information in a public issue.

## Compatibility

Use the extension on a PC with Chrome 116 or later, or a compatible Chromium-based version of Microsoft Edge. Firefox, Safari, mobile browsers, and private browsing are not supported. Each tab uses a stereo effect pipeline.

## Install a local package

If you received the extension from a browser store, install it there. For a local package, extract `effetune-extension-<version>.zip` to a folder that you will keep, then load that extracted folder:

1. In Chrome, open `chrome://extensions`. In Edge, open `edge://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**, then select the extracted extension folder.

**Load unpacked** cannot install the ZIP file itself. Reload the extension from this page after replacing files in the extracted folder.

## Start, compare, and stop processing

1. Open the tab whose audio you want to process and begin playback.
2. Open the EffeTune extension from the browser toolbar.
3. Choose **Start on this tab**. The status changes from **Starting…** to **Processing** when the effect chain is ready.

To add another tab, open the extension from that tab and choose **Start on this tab**. The popup lists all sessions. Up to four tabs can run together; stop one before starting a fifth.

Use **Bypass** beside a tab to hear it without effects while keeping its session active. Choose **Stop** beside that tab when you are finished. Stopping returns that tab to normal playback without interrupting the others.

You can close the extension popup or the editor while processing continues. When you open either one again, it shows the current tab and processing state. After restarting the browser, start a new session; the extension does not capture a tab automatically.

## Edit the Effect Pipeline and use presets

Choose **Edit pipeline** to open **EffeTune Pipeline Editor**, then select the target tab in the header. Add, reorder, toggle, and adjust effects just as in EffeTune; analyzer displays follow the selected tab. When no tab is active, **Offline pipeline** edits the default pipeline used for the next tab you start.

Select **Visualizer** in the editor header to view the selected tab's processed audio in [Visualizer](visualizer.md), or click it again to return to the pipeline. Track titles and artwork are not shown in the extension, and **Share** / **Import Link** work as in the web app.

To switch presets quickly from the popup, select a tab, choose a **Saved preset**, and click **Apply to selected tab**. In the editor, use **Pipeline Presets > Save as** to save a preset, or **Settings > Import preset…** / **Export preset** to exchange `.effetune_preset` files. If a preset requires unsupported multichannel routing, effects, or missing external assets, the current pipeline is left unchanged.

To use a room or speaker measurement from the web or desktop app with **Room EQ** or **Crosstalk Cancellation**:

1. Export the measurement as JSON from the web or desktop app (include impulse responses when using **Crosstalk Cancellation** or **Room EQ** phase correction).
2. In the extension editor, open **Settings > Import measurement…** and select the JSON file.
3. Select the imported measurement in **Room EQ** or **Crosstalk Cancellation**. To remove an imported copy, select it in Room EQ's **Measurement** list and choose **Delete**; after confirmation, every Room EQ and Crosstalk Cancellation assignment that uses it is cleared.

To move presets, effect presets, Visualizer presets, impulse responses, and imported measurements together between the web app, desktop app, and extension, use **Settings > Backup / Restore** (`.effetune_backup`). Extension presets, layouts, and imported measurements are stored locally inside the extension and do not sync automatically with the web or desktop app. Backups do not include URL rules or the extension's sample-rate setting.

## URL presets and sample rate

Open **Settings > URL rules…** to automatically load a saved preset when a tab's URL matches a `host/path` pattern (such as `example.com/music/*`, where `*` matches any text). You still start each tab yourself; rules only choose its preset at startup and when its URL changes. The first enabled matching rule in the list wins; if no rule matches, the default pipeline is used. Rule changes take effect at the next start or page navigation. Editing a pipeline that was loaded by a URL rule updates that rule's saved preset, whereas other edits, including those after applying a preset manually, update the default pipeline. Deleting a preset disables its rules and returns tabs using those rules to the default pipeline.

**Sample rate** in **Settings** applies to all active tabs (**Auto**, **44.1 kHz**, **48 kHz**, **96 kHz**, or **192 kHz**). **Auto** lets the browser choose. Changing the rate briefly restarts processing on active tabs while keeping their captures. If a tab cannot run at the new rate, it returns to normal playback; select another rate and start the tab again.

## Permissions and limits

The extension captures audio only from tabs where you click **Start on this tab** and reads those tabs' URLs only to match URL preset rules. It never reads page content, injects scripts, uses the microphone, or sends audio over the network.

Each tab runs a stereo pipeline supporting **Main** and **Bus 1–4**. Multichannel output (>2ch), running acoustic measurements, Music Library, batch offline file conversion, and desktop-only hardware features are not available in the extension. Protected (DRM) streams that block browser capture return to normal playback.

## If something goes wrong

- **Status shows "Needs attention" or capture does not start:** Make sure the tab is actively playing audio, then click **Start on this tab** again.
- **A preset cannot be applied:** The editor keeps your current pipeline. Check that any required measurement or impulse-response assets have been imported into the extension first.

[← Back to README](../README.md)
