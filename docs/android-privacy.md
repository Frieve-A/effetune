---
title: "Android App Privacy Policy - EffeTune"
description: "How the EffeTune Android app handles audio input, the camera, music files, settings, and network features."
lang: en
---

# EffeTune Android App Privacy Policy

**Effective date:** November 28, 2026

**Operator:** Frieve

**Privacy inquiries:** Contact Frieve through the contact form at [https://www.frieve.com/about](https://www.frieve.com/about) (email address required).

This policy applies to the EffeTune app for Android (`com.frieve.effetune`). It explains what the app handles, why it handles it, where it is stored, and how you can delete it.

## Summary

- EffeTune plays and processes audio on your device. It has no accounts, advertising, or analytics, and it does not send your music, audio, settings, or other data to the EffeTune operator.
- The microphone or another audio input is used only after you select an input device or start an acoustic measurement. Input audio is processed on your device in real time and is not recorded or sent anywhere. Only measurement results that you choose to keep are saved, on your device.
- The camera is used only while you scan a pairing QR code. The image is read on your device and is not saved or sent.
- Network features that you configure or turn on, such as network music servers, playback on network speakers, library sharing, and remote control, exchange data directly between your device and the servers or devices you choose.
- Ask ChatGPT, Ask Perplexity, and other external links open in your web browser only when you choose them.

## Information the app handles

### Music files and the music library

When you open music files or add a folder to Music Library, Android asks which files and folders EffeTune may use. EffeTune reads only those files. It stores a catalog of the music it finds, such as titles, artists, albums, and artwork, together with your playlists, favorites, and recently played tracks, in the app's private storage so it can show and play your library.

### Audio input and measurements

EffeTune requests microphone access when you select an input device for live processing or start an acoustic measurement. Input from the microphone or a connected audio interface is processed through your effect pipeline in real time and played back on your device. It is not recorded or saved, except for measurement results that you choose to keep, such as frequency responses and impulse responses. Those results are stored on your device.

Live processing can continue when you switch to another app or turn off the screen. While input is in use, a notification remains visible. To stop input, set **Input Device** to **None (music file player only)** in **Audio Configuration**.

### Camera

EffeTune requests camera access only when you choose to scan a pairing QR code, for example to add another EffeTune device or a network music server. The camera image is read on your device to find the code and is not saved or sent.

### Settings, presets, and imported files

EffeTune stores your settings, effect pipelines, presets, impulse responses, measurements, and Visualizer data in the app's private storage. Android's automatic cloud backup does not include this data. **Backup / Restore** and export features create files that you save or share through Android's file and sharing screens; where they go is up to you.

### Connection information

When you add a network music server, EffeTune stores the server address and the sign-in information you enter on your device so it can reconnect. Pairing information for remote control and connected devices is also stored on your device. This information is not sent to the EffeTune operator.

## Network features

EffeTune connects to other servers and devices only for features you use. These connections go directly between your device and the server or device you choose. The EffeTune operator does not run, receive, or relay them.

- **Network music servers (Subsonic / OpenSubsonic):** EffeTune sends your sign-in information and requests for music and artwork to the server you add. That server's operator handles this information under its own policy. If the server address begins with `http://` rather than `https://`, data, including sign-in information, is sent without encryption.
- **Network speakers:** When you play to a UPnP AV / DLNA, OpenHome, or Chromecast device, EffeTune sends the audio and track information, such as the title, artist, album, and artwork, to that device. To find devices, EffeTune sends discovery messages on your local network.
- **Receiving music:** When you enable OpenHome or UPnP AV / DLNA reception, controller apps on your local network can send music to EffeTune, view playback information, and control playback without signing in. Reception is off by default.
- **Library sharing:** When you share music folders, other devices on your local network can browse and play the music in those folders without signing in. Sharing is off by default and includes only the folders you select.
- **Remote control:** When you allow remote control, a device that has your pairing link can view and change playback, the music library, and effect settings. Keep the pairing link private. Remote control is off by default. When you join another EffeTune, your device sends your edits to that EffeTune.
- **Headphone EQ:** When you search for a headphone model, EffeTune downloads the public AutoEQ index and the result you select from GitHub (`raw.githubusercontent.com`). The request contains the name of the model being loaded. If you enter a web address yourself, EffeTune downloads that file from that address. GitHub's privacy statement applies to these downloads.

Use local-network features only on networks you trust. Some local-network protocols, such as UPnP AV / DLNA and OpenHome, do not encrypt data.

## Optional third-party services

Each effect's help dialog can offer **Ask ChatGPT** and **Ask Perplexity**. If you choose one of these actions, EffeTune opens the selected provider's website in your web browser with the question you entered and the name of the effect in the page URL. Your browser and the selected provider receive that information, and the provider's own terms and privacy policy apply. Do not enter private or sensitive information in an AI question.

Documentation, support, and other external links also open in your web browser. The destination website's privacy policy applies to that visit.

## Android permissions

- **Microphone** (`RECORD_AUDIO`): live input processing and acoustic measurement, after you choose them.
- **Camera** (`CAMERA`): scanning pairing QR codes, after you choose to scan.
- **Notifications** (`POST_NOTIFICATIONS`): the playback and processing notification with its controls.
- **Foreground service** (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `FOREGROUND_SERVICE_MICROPHONE`): keeps playback, live input processing, music reception, and library sharing running while the app is in the background or the screen is off.
- **Network access** (`INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_LOCAL_NETWORK`, `CHANGE_WIFI_MULTICAST_STATE`): connecting to the servers and devices described under [Network features](#network-features), and finding devices on your local network.

## Sharing, sale, advertising, and analytics

EffeTune does not sell the information described in this policy. It does not use it for advertising, credit decisions, or profiling, and it does not include advertising, analytics, or crash-reporting libraries.

Except for the network features and optional third-party actions described above, which send information only to the destinations you choose, the app does not transmit your music, audio input, camera images, settings, presets, measurements, or connection information to the EffeTune operator or third parties.

Google Play and Android may separately process installation, update, crash, and other device information under their own terms and privacy policies. That processing is controlled by Google, not by EffeTune.

## Retention and deletion

- Audio input and camera images are not retained.
- Your music library catalog, settings, presets, impulse responses, measurements, Visualizer data, and connection information remain on your device until you delete them in the app, clear EffeTune's storage in Android's app settings, or uninstall the app.
- To stop EffeTune from using a music folder, remove it from Music Library. You can also remove the folder access in Android's settings.
- To delete a saved preset, open **Pipeline Presets**, select it, and choose **Delete Selected**. To delete an imported measurement or impulse response, use **Delete** in Room EQ's **Measurement** list or in **Impulse Response Library**.
- Files that you exported or shared, and information held by network music servers, network speakers, or third-party services, are kept and deleted under the control of their destination.

## Children

EffeTune is not directed to children and does not provide accounts, advertising, or social features. It does not send app data to the EffeTune operator. If a child uses the app, information is handled in the same way described in this policy.

## Security

The app's data is kept in storage that Android protects for EffeTune. Protect access to your device. Connections to servers use the security of the address you enter: `https://` connections are encrypted and `http://` connections are not. No storage or transmission method can be guaranteed to be completely secure.

## Changes to this policy

This policy may be updated when the app's features or data handling change. The effective date at the top of the page will be updated when a revised policy is published. If a change materially affects how the app handles information, the Google Play listing and its disclosures will also be updated before the changed behavior is released.

## Contact and support

For general help or bug reports, use [EffeTune GitHub Issues](https://github.com/Frieve-A/effetune/issues). GitHub Issues are public. Do not post audio, music files, presets, measurement files, server addresses, sign-in information, pairing links, or other personal or confidential information there.

Privacy inquiries: Contact Frieve through the contact form at [https://www.frieve.com/about](https://www.frieve.com/about) (email address required). When you use the form, only the information you enter in it is sent for your inquiry. The app does not attach or send audio, music, settings, or other app data with an inquiry.
