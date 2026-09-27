---
title: "Browser Extension - EffeTune"
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

Choose **Edit pipeline** to open **EffeTune Pipeline Editor**, then select the tab in the header. Add effects, change their order, enable or disable individual effects, and adjust their parameters as you would in EffeTune. Analysis displays show the selected tab. With no active sessions, **Offline pipeline** edits the default pipeline for the next start.

Select **Visualizer** in the editor header to show the selected tab's processed audio in [Visualizer](visualizer.md); select it again to return to the pipeline. If that tab is not being processed, Visualizer shows "Start EffeTune on a tab to show Visualizer." Track titles and artwork are not shown in the extension. **Share** and **Import Link** work as in the web app, and shared links open in the web version. Visualizer layouts and presets stay in the extension and do not sync with the web app or desktop app.

Select a tab in the popup, then use **Saved preset** and **Apply to selected tab** to change its complete pipeline without opening the editor. In the editor, open **Pipeline Presets** to save a complete pipeline preset with **Save as**. Open **Settings** and choose **Import preset…** or **Export preset** to import or export complete pipeline presets. Extension presets and saved settings stay in the extension; they do not automatically sync with the web app or desktop app.

If a preset needs an unsupported routing, effect, or unavailable external asset, it is not applied and the current pipeline remains unchanged.

To use a measurement from the web app or desktop app with Room EQ or Crosstalk Cancellation, export the measurement as JSON there. In the extension editor, open **Settings**, choose **Import measurement…**, then select that JSON file. Include impulse responses in the export when using Crosstalk Cancellation or Room EQ's phase correction. Imported measurements appear immediately in Room EQ's **Measurement** list, remain in the extension's browser storage, and do not sync automatically. To remove an imported copy, select it in that list and choose **Delete** beside the list. After confirmation, every Room EQ and Crosstalk Cancellation assignment that uses it is cleared before the copy is deleted.

For a selective transfer of all supported saved data, open **Settings > Backup / Restore** in the editor. The same `.effetune_backup` file works with the web and desktop apps and can contain saved pipeline presets, effect presets, Visualizer presets, impulse responses, and imported measurements. A pipeline that uses unsupported extension routing or effects remains saved and can be backed up again, although it cannot be applied in the extension. URL rules and the extension sample-rate setting are not included.

## URL presets and sample rate

In **Settings**, open **URL rules…** to add a pattern, choose a saved preset, and enable the rule. Patterns use `host/path`, such as `example.com/music/*`; `*` matches any text. The first enabled matching rule wins. Host names ignore letter case; the scheme, query string, and fragment are ignored. Reorder rules to set their priority, or disable or delete rules you no longer need.

You still start each tab yourself. Its preset is selected automatically at startup and when its URL changes. If no rule matches, the default pipeline is used. Saving rule changes affects the next start or navigation. Editing a pipeline selected by a URL rule updates that saved preset; other edits update the default pipeline. Applying a preset manually leaves subsequent edits assigned to the default pipeline. Deleting a preset disables its rules and returns tabs using those rules to the default pipeline.

**Sample rate** in **Settings** applies to every active tab: **Auto**, **44.1 kHz**, **48 kHz**, **96 kHz**, or **192 kHz**. Auto lets the browser choose. Changing it briefly restarts audio processing for all active tabs while keeping their captures. If a tab cannot process at the new rate, it returns to normal playback; choose another rate and start that tab again.

## Permissions and limits

The extension captures audio only from tabs where you explicitly start processing. It reads those tabs' URLs to choose saved presets, including after navigation. It does not read page content, insert scripts into websites, require microphone access, record audio, or send your audio elsewhere.

Stereo pipelines support Bus Routing with Main and Bus 1–4, including parallel effect paths. More than two channels, taking measurements and device control, Music Library, batch file conversion, and desktop-only device or file-path features are unavailable in the extension.

Some protected content may not be available for capture. The extension does not bypass content protection. If capture cannot start, the tab returns to normal playback. Make sure the tab is playing audio, then choose **Start on this tab** again.

## If something goes wrong

- If the status shows **Needs attention**, make sure the selected tab is playing audio, then choose **Start on this tab** again.
- If a tab cannot be captured, make sure that tab is playing audio, then try again.
- If a preset cannot be applied, the editor keeps your current pipeline. Change the preset or make the required assets available before trying again.
