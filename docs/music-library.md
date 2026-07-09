---
title: "Music Library Guide - EffeTune"
description: "Learn how to set up Music Library in EffeTune, find and play music by folder or metadata, and manage playlists."
lang: en
---

# How to Use Music Library

Music Library indexes selected music folders so you can browse your local collection by tracks, albums, artists, genres, folders, recently added tracks, or playlists. Playback still goes through the current EffeTune effect pipeline, so you can listen with the same effects used for normal music file playback.

Music Library stores its catalog, artwork cache, and playlists inside the app. It does not edit, rename, move, or delete your audio files.

## Availability

- **Desktop app:** Uses the full folder scanner and can keep selected folders available between launches. Desktop builds can also show a track in its folder.
- **PC Chromium browsers:** Use File System Access when available. Folder access can usually be kept, but the browser may ask for permission again.
- **Mobile browsers, Safari, and Firefox:** Use the browser's available folder or file picker. In fallback mode, you can index selected folder files, but after a reload or lost permission you may need to select the folder or files again.

Music Library indexes common audio file extensions such as MP3, WAV, OGG, FLAC, Opus, M4A, AAC, and WebM. Actual playback support still depends on the browser or OS audio decoder.

## Opening Music Library

- **PC layout:** Click the **Music Library** button in the header.
- **Mobile layout:** Open the **Library** tab in the bottom navigation.
- **Desktop app:** You can also use **View > Music Library** or **Ctrl+L** (**Command+L** on macOS).

To return to effect editing, click the **Effect Pipeline** button in the PC layout, switch back to the **Effects** tab in the mobile layout, or use **View > Effect Pipeline** or **Ctrl+E** (**Command+E** on macOS) in the desktop app.

You can also make Music Library the first view shown at startup: open **Settings > Config...**, then set **Startup view:** to **Music Library**.

## Adding Music Folders

1. Open Music Library.
2. Select **Add Music Folder**.
3. Choose the folder that contains your music. On mobile or fallback browsers, the picker may ask you to choose folder contents instead of granting persistent folder access.
4. Wait for the scan to finish. The status line shows the number of tracks and albums, and scan progress while indexing.

If you add a folder that is already inside an existing library folder, EffeTune warns you instead of indexing duplicate content. If you add a parent folder that contains already indexed folders, EffeTune can merge them into the new folder.

## Browsing and Searching

Use the navigation tabs to browse the catalog:

- **Tracks** - All indexed tracks. PC layout shows a sortable table; mobile layout shows a compact list.
- **Albums** - Albums grouped from metadata.
- **Artists** - Artists and album artists from metadata.
- **Genres** - Genre groups from metadata.
- **Folders** - Library folders and their scan status.
- **Recently Added** - Recently indexed tracks.
- **Playlists** - Playlists created or imported inside Music Library.

Use **Search library** to search across tracks, albums, artists, and playlists. In the PC layout, track table headers sort by **Title**, **Artist**, **Album**, **Genre**, or **Time**.

If metadata is missing or unreadable, EffeTune falls back to the file name and folder information. Track properties show the file path, format, sample rate, bit depth, bitrate, and main metadata fields.

## Playing from the Library

Select a track, album, artist, genre, folder, search result, or playlist, then use:

- **Play** to replace the current player queue and start playback.
- **Shuffle** to play the selected group in random order.
- **Play Next** to insert the selected tracks after the current track.
- **Add to Queue** to append the selected tracks.
- **Add to Playlist** to save selected tracks into a Music Library playlist.

On PC, you can double-click a track row to play from that point and use right-click or the **More** menu for track actions. On mobile, tap the play button on a track row to start playback, or long-press a track to open the action sheet.

The normal music player controls and repeat/shuffle settings still apply. On devices with a keyboard, the usual player shortcuts also work. If a library track cannot be opened because the folder is offline, reconnect or re-import the folder.

## Folder Maintenance

Use **Rescan** after you add, remove, rename, or retag files in your music folders. Rescanning updates changed tracks, removes files no longer found, and tries to resolve playlist items that were previously unavailable.

Folder statuses in the **Folders** view indicate whether a folder is ready:

- **OK** - The folder is available.
- **Not scanned** - The folder has not been indexed yet.
- **Missing** - The folder or stored path is no longer available.
- **Reconnect** - EffeTune needs permission again.

When a folder shows **Reconnect**, select **Reconnect** and grant access to the same folder. Choosing **Remove** only removes the folder from the Music Library catalog; files on disk are not deleted.

## Playlists

Music Library playlists are stored inside EffeTune and can contain tracks from your indexed folders.

You can:

- Create a playlist from selected library tracks.
- Save the current player queue as a playlist.
- Use **Rename**, **Duplicate**, **Delete**, and **Reorder** for playlists.
- Drag tracks inside a playlist to change order, or use **Move Up** and **Move Down** where drag is not convenient.
- Use **Import Playlist** for M3U, M3U8, PLS, and XSPF playlist files.
- Export playlists with **Export M3U8** or **Export XSPF**.

When importing, EffeTune previews how many playlist entries match tracks in the current library. Unmatched entries are kept as unresolved items when possible, so they can be resolved later after adding or reconnecting the matching folder.

When exporting, choosing **Relative paths** writes paths relative to the export location when possible. Use this when you want the playlist to move together with the music folder.

## Safety and Storage

- Music Library reads audio files and metadata but does not write changes to audio files.
- Artwork caching and playlists are app data, not embedded file changes.
- Browser storage can be cleared by the browser or user settings. Export important playlists if you need a portable copy.
- If you use the web app, browser permissions control whether folder handles remain usable after reload.

[← Back to README](../README.md)
