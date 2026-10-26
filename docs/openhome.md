---
title: "Network Music and Remote Control (Desktop App) - EffeTune"
description: "Play network music through EffeTune, receive OpenHome, UPnP AV / DLNA and AirPlay audio, share music, and control playback on your local network."
lang: en
---

# Network Music and Remote Control (Desktop App)

The desktop app can receive music from other devices on your local network and process it through your EffeTune effects. OpenHome, UPnP AV / DLNA, and AirPlay reception have separate settings and start disabled. Enable only the reception methods you use under **Settings > Config... > Network**.

## Receive music with OpenHome

On supported desktop builds (Windows x64, macOS Intel/Apple silicon, and Linux x64), EffeTune can appear as an OpenHome player to controller apps on the same local network. Open **Settings > Config... > Network**, enable **Allow OpenHome controllers on this network** (off by default), and wait until the status indicates that EffeTune is available.

**Device name** in **Network** names the network player, AirPlay receiver, and shared library. It uses this computer's name by default. Enter a custom name such as `Living Room`, or clear the field to use the computer's name again. UPnP AV / DLNA appears as a separate destination with a short suffix; both destinations play through the same EffeTune player.

OpenHome does not require a sign-in. While enabled, other devices on your local network can view playback metadata, edit the player queue, and control playback. If Windows Firewall asks for permission, allow EffeTune only on **Private networks**, not **Public networks**. Turn the setting off when remote control is not needed.

Controllers can add HTTP or HTTPS audio streams, manage the remote playback queue, and control play, pause, stop, skip, seek, repeat, and shuffle. Remote audio passes through the active EffeTune effect pipeline as usual. Basic OpenHome queue and playback control has been verified with BubbleUPnP on Android; other OpenHome apps may differ in how they display services. The OpenHome destination provides an OpenHome Playlist source and does not expose effect editing, local file paths, master volume, Radio, Songcast, or multi-room sync over OpenHome.

Gapless playback is not guaranteed, and technical metadata can remain unknown until the source provides it. After sleep, wake, VPN, or network changes, the player can disappear briefly while it reconnects.

## Receive music with UPnP AV / DLNA

Enable **Allow UPnP AV / DLNA playback on this network** under **Settings > Config... > Network**. In your controller app, choose EffeTune's UPnP AV / DLNA destination and select music from a server that the computer can reach. OpenHome access is a separate permission and need not be enabled.

This destination receives MP3, FLAC, PCM WAV, and AAC (ADTS or MP4/M4A) over HTTP or HTTPS. Ogg (Vorbis/Opus/FLAC), WebM (Vorbis/Opus), and audio Matroska (PCM/FLAC/MP3/Opus/Vorbis/AAC) are also supported. A supported file type still needs a supported codec; ALAC is not supported.

Controllers can play, pause, stop, skip, seek when the source allows it, and adjust the player's volume or mute. The player volume also affects local and OpenHome music playback; it does not change the computer's volume or effect settings. Selecting a new track replaces the current player queue with that track. The controller and EffeTune show the same playback state. When supplied by the music server, track tags and source audio details are also available in Visualizer’s **Track information** item.

Use this feature on a trusted local network: enabled controllers can change playback without signing in. Allow private-network firewall access when asked. Audio is not converted, and support varies by controller and source. This is an audio receiver; DLNA certification, video playback, and every DLNA format are not promised.

## Receive audio with AirPlay

Enable **Allow AirPlay audio on this network** under **Settings > Config... > Network**, then choose the **Device name** in your sender's AirPlay audio output list. The status indicates when the receiver is available or receiving audio. Keep EffeTune running and both devices on the same trusted local network. Anyone who can reach the enabled receiver can send audio without signing in.

AirPlay receives stereo audio from one sender at a time. Start and stop playback, and adjust its volume, on the sending device. Local and UPnP AV volume/mute settings apply only to file and URL playback. Once AirPlay audio is ready, it replaces the current music playback. Starting local, OpenHome, or UPnP AV music ends AirPlay reception. Ending AirPlay does not resume the previous track automatically. Closing the EffeTune Player with **×**, or using **Stop**, ends the current AirPlay session; the enabled receiver remains available for another connection.

When the sender provides them, the Player displays the track title, artist, artwork, and playback time. Hover over the track title to see additional information, such as album, composer, genre, comments, sender, and audio format. The available information depends on the sending app and content; track time updates when the sender reports it. You can also show this information in [Visualizer](visualizer.md).

**Received audio** identifies the AirPlay codec, such as ALAC or AAC-ELD. **Receiver PCM** describes the audio EffeTune receives for processing: 44.1 kHz, 16-bit stereo. These values do not describe the original music file’s quality. When supplied, **Sender volume** shows the sending device’s volume-slider position as a read-only percentage; adjust it on that device.

Network buffering and EffeTune's effects add delay, so sound may lag behind video. AirPlay 2 features, synchronized multi-room playback, screen mirroring, video, and protected content are not supported. Sender and device compatibility can vary.

AirPlay discovery requires Bonjour on Windows and macOS, or an active Avahi / DNS-SD service on Linux. The standard Windows installer supplies the discovery service if needed; portable and Microsoft Store builds require it to be already installed. On Linux, install your distribution's Avahi / DNS-SD service and enable it using the distribution's normal service tools. If the receiver is unavailable, check this requirement and private-network firewall access before trying again. Guest Wi-Fi, VPNs, or network isolation can prevent devices from finding each other.

## Choose a library and a player

In the desktop app, Music Library's **Library** selector chooses **This device** or a music server on your local network. Shared EffeTune libraries offer the familiar browsing categories, search and sorting described in the [Music Library guide](music-library.md#music-on-your-network-desktop-app). Other music servers show the categories and folder hierarchy they publish; search and sorting are available only when the server supports them.

Use the device selector at the top of the window to choose **This device** or an OpenHome player. The library and player selections are independent: you can browse music on one computer and play it on another. Changing the player only changes what you control; it does not stop the previous player or move its queue. The selected player's track, queue, position, repeat and shuffle are shown, with controls limited to what it supports. Changes from other controllers are reflected too.

## Share music folders

Open **Settings > Config... > Network**. Under **Library sharing**, select the folders to share, enable **Share selected folders on this network**, and click **Save**. Add folders to Music Library first if none are listed. Sharing starts disabled and publishes only the selected registered folders. Other devices on the same network can browse and play them without signing in. Disable sharing or deselect a folder, then click **Save** to revoke access. Keep EffeTune running on the computer that holds the files.

To play individual local files without enabling library sharing, choose another player and use **Open music files**. EffeTune makes only the selected files available to that player; keep the source app running.

Sharing sends the original audio, without the source computer's effects. If the destination is EffeTune, its own effects process the sound. The computer used to select the music does not process or continuously relay that audio. The music server and player must be able to reach each other; their queue can continue playing when the controlling app disconnects.

## Edit the selected player's effects (desktop app)

Select an EffeTune player, then open **Effect Pipeline**. Before the first connection, enable **Allow remote control** on that player under **Settings > Config... > Network** or **Settings > Remote Control...**. Choose **Connect effects** here, then choose **Allow** in the request shown on the player's computer. No pairing link is needed. The approved connection is remembered, and selecting that player later connects its effects automatically. Discovery or library sharing alone does not permit effect editing.

The effect header names the player being edited. Its supported pipeline, bypass, A/B, Undo/Redo and saved pipeline presets are available here; the IR selector uses that player's IR library. Pipeline preset saves and deletions affect that player. Individual effects offer built-in presets; individual user presets are unavailable remotely. Unsupported operations are unavailable. Another manufacturer's player can still play music, but cannot use EffeTune's effect editor.

In IR Reverb's library, **Upload file…** imports one IR file of up to 64 MiB into the selected player, and **Download** saves a single-file IR to the device you are using. True-stereo pairs can be selected but cannot be transferred. To delete IRs, open the library on the player itself. Transfers happen only when you request them; libraries are not automatically copied between devices.

If a connection drops, the selected player stays selected and editing is disabled until it reconnects. Reconnection reads its latest settings without resending unconfirmed edits. Use **Change connection**, then **Connect effects**, to reconnect. The Remote Control button continues to manage access to this computer; pairing links, the browser editor and separate remote windows remain available.

<a id="pwa"></a>

## Listen and control from the PWA

On the same network, the [EffeTune PWA](https://effetune.frieve.com/effetune.html) can play a computer’s shared music through your phone’s own EffeTune effects, or control playback and effects on registered EffeTune computers. **Library** and the playback device both start at **This device**. The PWA uses devices you add; it does not discover other music servers.

1. On the computer, open **Settings > Remote Control...**, enable **Allow remote control**, and choose **Copy link**. To browse its music, also share folders using **Library sharing** as described above. OpenHome controller access need not be enabled.
2. In the PWA’s playback device selector, choose **Add device…**. Paste the copied link into **Pairing link** and choose **Connect**. Allow local-network access when asked. You can use **Scan QR code** when available; otherwise paste the link. Opening the QR code with your phone’s normal camera opens the separate remote editor instead.

Choose the computer under **Library** to use the same nine browsing views. Keep the playback device at **This device** to listen through the PWA’s effects, or choose a registered computer and open **Effect Pipeline** to edit its effects. To play computer A’s music on computer B, add both computers and choose A as the library and B as the player. Changing selections does not stop the previous player or move its queue.

Open **Add device…** again to manage **Saved devices**. Use **Update connection** with a fresh link if the address or connection code changes, or **Remove** to forget a device. **Refresh** reloads availability and sharing settings. Clearing browser data removes saved devices; if storage is unavailable, registration lasts only for the current session. Older hosts may offer **Open remote editor** instead of PWA music playback.

Use a recent Chromium browser and allow local-network access. Browser support varies; see [Chrome’s local-network permission guidance](https://developer.chrome.com/blog/local-network-access) and [WebSocket support](https://developer.chrome.com/release-notes/147). HTTP links are unencrypted: use them only on a trusted network. Safari/iOS and browsers without local HTTP support need a [trusted HTTPS setup](remote-v1.md#encrypted-connections), with a certificate matching the computer’s IP address and trusted by the browser. Browser or OS policies can still block access; scanning a QR code does not establish certificate trust.

The PWA cannot send its own local files to another player; select a shared computer library instead. Keep the source and player awake and connected. Closing the PWA does not stop playback on another computer when source and player can still reach each other. Playback on the phone depends on its supported formats and may pause when the app is in the background.

## Network playback limits

Automatic server discovery and music-folder sharing require the desktop app. The PWA connects to registered EffeTune computers as described above. Playback support and seeking depend on the destination and source format; audio is not converted. CUE sub-tracks cannot be sent as separate network tracks. Gapless and synchronized multi-room playback are not guaranteed. If a server or player disappears, check that it is awake, on the same network, and allowed through the private-network firewall, then refresh the device list. Sharing stops when the source app exits or its computer sleeps.

[← Back to README](../README.md)
