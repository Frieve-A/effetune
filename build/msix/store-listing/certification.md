# First Store submission — reviewer notes and owner declarations

This input draft is maintained with the package. It has not been submitted. Replace the outstanding decisions only after the owner confirms them.

## Certification notes

EffeTune plays local music files and applies audio effects on the computer. A subscription, developer account, virtual audio driver, or additional download is not required for the local-file demonstration below.

1. Launch EffeTune from the installed app entry.
2. Use **Open music files** to select a local WAV or MP3 file supplied by the reviewer and start playback at a low listening level.
3. Add an equalizer to **Effect Pipeline**, adjust a band, and bypass the effect to compare the result.
4. Save the effect chain as a preset, close the app, reopen it, and load the preset.
5. Optionally open **Music Library**, choose **Add Music Folder**, and browse the selected folder.

The desktop **Browser** can open external HTTP/HTTPS websites. Compatibility with third-party sign-in and protected media varies; this feature is not required for the local-file demonstration. Optional OpenHome and remote-control features use the local network and are disabled by default.

The app uses `runFullTrust` because it is an Electron desktop application with local audio processing, file access, and a bundled OpenHome helper. The intended installation does not bundle an audio driver or require the app to run with administrator privileges. The installed-package tests must confirm ordinary-user operation before submission.

## Owner decisions to complete in Partner Center

- Confirm the developer account, legal identity, Store name reservation, publisher display name, pricing, and markets. Do not infer these from a GitHub account.
- Complete the current age-rating questionnaire. The app contains a general web browser that can access external content; do not answer as though the app contains only the developer's own music or screenshots.
- Review capability and privacy declarations for live audio input/microphone, selected music files and folders, Internet access, Browser cookies and website sign-in, content-decryption-module downloads, optional LAN remote control, and OpenHome discovery.
- The owner-confirmed support contact is https://discord.gg/YRNR7bzGk2 (corrected on 2026-10-21). Publish a desktop-specific privacy policy before setting its Store URL.
- Review all claims and screenshots against the actual installed candidate, including any protected-playback limitations.

## Privacy-policy facts to incorporate into the owner-approved policy

- Selected audio inputs and music files are processed locally for playback and effects. Music Library keeps a local catalog, cached artwork, and playlists for folders the user selects.
- Browser visits contact the selected websites. Website sign-ins and site data can persist; **Clear site data** signs out of websites and clears stored site data.
- Protected playback can require a content-decryption-module download. The runtime and visited service determine whether protected playback is available.
- OpenHome is optional. When enabled, other devices on the network can see playback metadata, modify the queue, and control playback.
- Paired remote control can expose the effect pipeline, presets, and impulse-response library to authorized clients on the local network. Pairing uses a token; traffic is HTTP/WebSocket on a trusted LAN.
- Exported presets, backups, and processed audio files contain the information the user chooses to export and can be shared by the user.
- Confirm all other external requests, optional assistant links/MCP behavior, retention/deletion instructions, the operator contact, and the effective date against the final desktop build before publishing a policy. The existing browser-extension policy covers a different product.

## Evidence required before the first submission

Record the candidate tag, commit, MSIX version/hash, installed-test and WACK reports, approved listing text and screenshots, final privacy URL, and owner declarations. Actual Store acquisition and Widevine/DRM playback remain separate post-publication checks; no fixture or unsigned package build establishes them.
