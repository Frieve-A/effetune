---
title: "Music Library Guide - EffeTune"
description: "Learn how to set up Music Library in EffeTune, find and play music by subfolder or metadata, and manage playlists."
lang: en
---

# How to Use Music Library

Music Library indexes selected music folders so you can browse your local collection by tracks, albums, artists, genres, subfolders, folders, recently added tracks, or playlists. Playback still goes through the current EffeTune effect pipeline, so you can listen with the same effects used for normal music file playback.

Music Library stores its catalog, artwork cache, and playlists inside the app. It does not edit, rename, move, or delete your audio files.

EffeTune 2.1.0 starts with a new Music Library. Earlier Library state is not inherited, so add your music folders and scan them again. This does not modify the audio files in those folders.

## Availability

- **Desktop app:** Uses the full folder scanner and can keep selected folders available between launches. Desktop builds can also show a track in its folder.
- **PC Chromium browsers with File System Access:** Store the selected folder handle persistently. The browser may ask for permission again, but the handle can be reused after a reload once access is granted.
- **Mobile browsers, Safari, Firefox, and other browsers without File System Access:** Keep selected `File` objects only for the current page session. The catalog remains stored, but the files themselves cannot be reopened after a reload. Select the folder or files again after every reload; EffeTune reconnects them to the existing catalog entries by normalized relative path.

Music Library indexes common media file extensions such as MP3, WAV, OGG, FLAC, Opus, M4A, AAC, WebM, and MP4. For MP4 files, EffeTune plays only the audio track and does not display video. Actual playback support, including the audio codec inside an MP4 file, still depends on the browser or OS decoder.

## Opening Music Library

- **PC layout:** Click the **Music Library** button in the header.
- **Mobile layout:** Open the **Library** tab in the bottom navigation.
- **Desktop app:** You can also use **View > Music Library** or **Ctrl+L** (**Command+L** on macOS).

To return to effect editing, click the **Effect Pipeline** button in the PC layout, switch back to the **Effects** tab in the mobile layout, or use **View > Effect Pipeline** or **Ctrl+E** (**Command+E** on macOS) in the desktop app.

You can also make Music Library the first view shown at startup: open **Settings > Config...**, then set **Startup view:** to **Music Library**. Use the list beside Music Library to choose whether **Tracks**, **Albums**, **Artists**, **Genres**, or **Subfolders** appears first.

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
- **Subfolders** - Tracks grouped by the direct parent subfolder path relative to each indexed music folder.
- **Folders** - Registered music folder roots and their scan status.
- **Recently Added** - Recently indexed tracks.
- **Playlists** - Playlists created or imported inside Music Library.

For example, `Artist/Album/01 Song.flac` appears in the `Artist/Album` subfolder group. Identical relative paths in different indexed roots remain separate. Files stored directly in a root do not create a subfolder group; they remain available in **Tracks** and from that root in **Folders**.

Use **Search library** to search across tracks, albums, artists, and playlists. In the PC layout, track table headers sort by **Title**, **Artist**, **Album**, **Genre**, or **Time**. Album, artist, genre, subfolder, and playlist views provide a **Sort** list backed by the catalog. Depending on the view, it can order by name, artist, path, track count, total duration, updated time, or created time, in either direction. Each view keeps its own selection.

For tracks, search terms of three or more characters match anywhere in the title, artist, album, genre, file name, or path. One- or two-character terms match only the beginning of a word. Enter at least three characters when you need a match in the middle of a word.

In both the PC and mobile layouts, track search results and tracks in an album, artist, genre, subfolder, or playlist detail are all selected by default when the result contains 300 tracks or fewer. Results with 301 tracks or more are not selected automatically. Use the row checkboxes, **Select All**, or **Deselect All** to change the selection.

Mobile starts with the normal title list and does not show artist or duration columns. Only long-pressing a track enters selection mode; checkboxes, **Select All**, and **Deselect All** then appear while the usual row actions remain available. Automatic selection and later selection changes—including **Select All**, **Deselect All**, and individual checkboxes—change only the selection state; they do not enter or leave selection mode.

If metadata is missing or unreadable, EffeTune falls back to the file name and folder information. Track properties show the file path, format, sample rate, bit depth, bitrate, and main metadata fields.

## Playing from the Library

Select a track, album, artist, genre, subfolder, folder, search result, or playlist, then use:

- **Play** to replace the current player queue and start playback.
- **Shuffle** to play the selected group in random order.
- **Play Next** to insert the selected tracks after the current track.
- **Add to Queue** to append the selected tracks.
- **Add to Playlist** to save selected tracks into a Music Library playlist.

On PC, you can double-click a track row to play from that point and use right-click or the **More** menu for track actions. On mobile, tap a track in the normal list to play it; long-press enters selection mode as described above.

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
- Open an individual playlist and export it with **Export M3U8** or **Export XSPF**.

Folder scans automatically import supported playlist files after their tracks are indexed. An unchanged file is skipped. When the content at the same folder and relative path changes, EffeTune atomically replaces the items in its automatically imported playlist; this also replaces item edits made to that playlist in EffeTune. A failed or canceled import is retried on the next rescan. Deleting or renaming the source file leaves the existing playlist in place, and a renamed source is imported as a new playlist.

When importing, EffeTune previews how many playlist entries match tracks in the current library. Unmatched entries are kept as unresolved items when possible, so they can be resolved later after adding or reconnecting the matching folder.

When exporting, choosing **Relative paths** writes paths relative to the export location when possible. Use this when you want the playlist to move together with the music folder.

## Safety and Storage

- Music Library reads audio files and metadata but does not write changes to audio files.
- Artwork caching and playlists are app data, not embedded file changes.
- Browser storage can be cleared by the browser or user settings. Export important playlists if you need a portable copy.
- In browsers with File System Access, permission controls whether a persisted folder handle can be reused after reload. In fallback browsers, selected files are session-only and must always be selected again after reload.

## Large Libraries

The catalog keeps data on disk and pages or streams work in bounded batches so large collections do not need to be loaded into memory at once. Scale and fixed-reference measurements are optional local development diagnostics. They do not gate commits, releases, `verify`, or GitHub Actions and are not a general performance guarantee. Scan time and practical limits depend on storage speed, available memory, metadata, artwork, and browser or OS limits.

While you scroll the track list, EffeTune keeps nearby pages cached. In the mobile layout, it reads up to two pages ahead in the current direction, gives a page needed on screen priority over additional read-ahead, and reuses overlapping visible rows. Completed viewport reads are published to this bounded cache even while scrolling continues. Repeated viewport requests are coalesced to the newest position, and no additional database read is made when that position is covered by the page that just finished loading. Superseded queued read-ahead is discarded. SQLite supports interruption, but the catalog adapters currently execute each statement synchronously and do not expose a cross-worker interruption path. An exceptionally fast jump may therefore still show a brief gap until the current read finishes, especially on slow storage.

Multiple tabs or application instances are unsupported. A second writable open is rejected to protect the catalog. Using different EffeTune versions with the same Library is also unsupported.

[← Back to README](../README.md)
