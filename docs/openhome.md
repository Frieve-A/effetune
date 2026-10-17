---
title: "OpenHome Remote Control (Desktop App) - EffeTune"
description: "Control the EffeTune desktop app from OpenHome controller apps on your local network: setup, network access, compatibility, and limitations."
lang: en
---

# OpenHome Remote Control (Desktop App)

On supported desktop builds (Windows x64, macOS Intel/Apple silicon, and Linux x64), EffeTune can appear as an OpenHome player to controller apps on the same local network. Open **Settings > Config...**, enable **Allow OpenHome controllers on this network** (off by default), and wait until the status indicates that EffeTune is available. The default player name is `EffeTune (computer name)`; use **Player name** to set a custom name such as `EffeTune Living Room`.

OpenHome does not require a sign-in. While enabled, other devices on your local network can view playback metadata, edit the player queue, and control playback. If Windows Firewall asks for permission, allow EffeTune only on **Private networks**, not **Public networks**. Turn the setting off when remote control is not needed.

Controllers can add HTTP or HTTPS audio streams, manage the remote playback queue, and control play, pause, stop, skip, seek, repeat, and shuffle. Remote audio passes through the active EffeTune effect pipeline as usual. Basic queue and playback control has been verified with BubbleUPnP on Android; other OpenHome apps may differ in how they display services. EffeTune operates as an OpenHome Playlist source (not a UPnP AV MediaRenderer) and does not expose effect editing, local file paths, master volume, Radio, Songcast, or multi-room sync over OpenHome.

Gapless playback is not guaranteed, and technical metadata can remain unknown until the source provides it. After sleep, wake, VPN, or network changes, the player can disappear briefly while it reconnects.

[← Back to README](../README.md)
