---
title: "Music Library Guide - Browse & Play Local Music Files - EffeTune"
description: "Learn how to set up Music Library in EffeTune, find and play music by subfolder or metadata, and manage playlists."
lang: en
---

# How to Use Music Library

Music Library indexes selected music folders so you can browse your local collection by tracks, files, albums, artists, genres, subfolders, folders, recently added tracks, or playlists. Playback still goes through the current EffeTune effect pipeline, so you can listen with the same effects used for normal music file playback.

Music Library stores its catalog, artwork cache, and playlists inside the app. It does not edit, rename, move, or delete your audio files.

## Availability

- **Desktop app:** Uses the full folder scanner and can keep selected folders available between launches. Desktop builds can also show a track in its folder.
- **PC Chromium browsers with File System Access:** Can keep access to selected folders after a reload. The browser may ask for permission again.
- **Mobile browsers, Safari, Firefox, and other browsers without File System Access:** Keep access to selected files only for the current page session. The catalog remains stored, but select the folder or files again after every reload so EffeTune can reconnect them.

Music Library indexes common audio file extensions such as MP3, WAV, OGG, FLAC, Opus, M4A, and AAC. It can also use an external CUE sheet to divide a WAV or FLAC album file in the same folder into individual tracks.

To include MP4, WebM, M4V, MOV, MKV, and 3GP files, enable **Include video file formats in Music Library** under **Settings > Config... > General**, then add or rescan a folder. This setting is off by default; changing it does not immediately change the existing catalog. Actual playback support, including the audio codec inside a video file, depends on the browser or OS decoder. See the [Music Player guide](music-player.md#video) for video display.

## Opening Music Library

- **PC layout:** Click the **Music Library** button in the header.
- **Mobile layout:** Open the **Library** tab in the bottom navigation.
- **Desktop app:** You can also use **View > Music Library** or **Ctrl+L** (**Command+L** on macOS).

To return to effect editing, click the **Effect Pipeline** button in the PC layout, switch back to the **Effects** tab in the mobile layout, or use **View > Effect Pipeline** or **Ctrl+E** (**Command+E** on macOS) in the desktop app.

You can also make Music Library the first view shown at startup: open **Settings > Config...**, then set **Startup view:** to **Music Library**. Use the list beside Music Library to choose whether **Tracks**, **Files**, **Albums**, **Artists**, **Genres**, **Subfolders**, **Folders**, or **Playlists** appears first.

## Adding Music Folders

1. Open Music Library.
2. Select **Add Music Folder**.
3. Choose the folder that contains your music. On mobile or fallback browsers, the picker may ask you to choose folder contents instead of granting persistent folder access.
4. Wait for the scan to finish. The status line shows the number of tracks and albums, and scan progress while indexing.

If you add a folder that is already inside an existing library folder, EffeTune warns you instead of indexing duplicate content. If you add a parent folder that contains already indexed folders, EffeTune can merge them into the new folder.

## Browsing and Searching

Use the navigation tabs to browse your collection:

- **Tracks:** All indexed tracks (a sortable table on PC; a compact list on mobile).
- **Files:** Tracks listed by file path so you can pick a file directly. Tracks defined by a CUE sheet appear as separate entries.
- **Albums:** Albums grouped from track metadata.
- **Artists:** Artists and album artists from metadata (semicolon-separated values such as `Artist A; Artist B` are indexed under each artist while keeping the full credit displayed).
- **Genres:** Genre groups from metadata.
- **Subfolders:** Tracks grouped by their direct parent subfolder inside each indexed root folder (for example, `Artist/Album`).
- **Folders:** Registered root folders, their scan status, and their folder hierarchy.
- **Recently Added:** Recently indexed tracks.
- **Playlists:** Playlists created or imported inside Music Library.

In **Folders**, open a registered root to browse its folders in **Tree view** or switch to **Flat view** to list all tracks inside that root at once. In **Tree view**, single-child folders that contain no direct tracks are combined into one row (such as `Artist / Album`) so you can jump straight to the album folder, while the breadcrumb path lets you open any intermediate folder.

Use **Search library** to filter across tracks, albums, artists, and playlists. Search terms of three or more characters match anywhere in the title, artist, album, genre, file name, or path; one- or two-character terms match word starts. On PC, click track table headers (**Track No.**, **Title**, **Artist**, **Album**, **Genre**, or **Time**) or use the **Sort** list in other views. On mobile, use the **Sort** list to change order in any view outside saved playlists.

When a search result, folder level, album, artist, genre, subfolder, or playlist contains 300 tracks or fewer, all tracks are selected by default so you can start playback immediately. Results with 301 tracks or more are not selected automatically; use the row checkboxes, **Select All**, or **Deselect All** to change the selection. On mobile, long-press any track row to show checkboxes and selection controls.

If tags are missing, EffeTune falls back to the file and folder names. Track properties display the file path, format, sample rate, bit depth, bitrate, metadata, and (for CUE tracks) the CUE sheet path and track region.

## CUE Album Files

Place an external `.cue` sheet in the same folder as the WAV or FLAC files it references, then add or rescan the folder. Each valid `TRACK ... AUDIO` entry appears as an individual track in Music Library.

For cover art, Music Library checks embedded artwork in the source audio first, then looks beside the `.cue` file for `cover.jpg`, `cover.png`, `front.jpg`, `front.png`, or an image matching the audio file name.

You can also open a `.cue` sheet directly from the player (**Open music files**, **File > Open music file...** on desktop, or **Open Music** on mobile):
- **Desktop app:** Select the `.cue` file by itself.
- **PC Chromium browser:** If the album folder is already registered in Music Library with permission granted, select the `.cue` file by itself.
- **Other browsers:** Select the `.cue` file together with all and only the WAV/FLAC files it references, plus a matching cover image if you want one.

If a CUE sheet is invalid or its audio files cannot be matched, EffeTune notifies you and imports the WAV or FLAC files as single whole-file tracks instead. Correct the CUE sheet or its file names, then rescan the folder to try again.

## Playing from the Library

Select a track, album, artist, genre, subfolder, folder, search result, or playlist, then choose:

- **Play** to replace the current player queue and start playback.
- **Shuffle** to play the selection in random order.
- **Play Next** to insert the selection after the current track.
- **Add to Queue** to append the selection to the queue.
- **Add to Playlist** to add the selection to a Music Library playlist.

On PC, double-click a track row to play from that track, or right-click / open **More** for track actions. On mobile, tap a track to play it or long-press to select multiple tracks.

## Folder Maintenance

Use **Rescan** after adding, removing, renaming, or retagging files in your music folders. Rescanning updates modified tracks, removes deleted files from the catalog, and relinks playlist entries when matching files are found.

Folder status in **Folders**:
- **OK:** Ready to browse and play.
- **Not scanned:** Added, but not yet indexed.
- **Missing:** The folder path is no longer found.
- **Reconnect:** Browser or folder permission is needed again; click **Reconnect** and grant access to the same folder.

If a library track cannot be opened because its folder is offline, reconnect or re-import the folder.

Choosing **Remove** only removes the folder from EffeTune's catalog; your files on disk are never deleted.

## Playlists

Music Library playlists are saved inside EffeTune and can hold tracks from any indexed folder:

- Create a playlist from selected library tracks or save the current player queue as a playlist.
- Use **Rename**, **Duplicate**, and **Delete** to manage playlists, and drag tracks (or use **Move Up** / **Move Down**) to reorder them.
- Use **Import Playlist** for M3U, M3U8, PLS, and XSPF files, and **Export M3U8** or **Export XSPF** inside a playlist to export it.

### Recently Played and Favorites

Two automatic playlists appear in the Playlists grid once used:

- **Recently Played:** Keeps the last 100 distinct tracks played from Music Library, ordered from newest to oldest.
- **Favorites:** Collects tracks marked with the **☆** beside a track on PC, or with **Add to Favorites** in the track's **More** menu (also available by right-clicking on PC). Click the Play button on the **Favorites** card to start it immediately.

Their names follow the current UI language and cannot be renamed, though you can duplicate, export, or delete them like any other playlist.

### Importing and Exporting Playlists

Folder scans automatically import supported playlist files found inside your music folders and update them on rescan when the playlist file changes on disk; this update replaces any edits you made to that playlist in EffeTune. Unmatched entries are kept as unresolved items so they can link automatically once the matching folder is added or reconnected.

When exporting a playlist, enable **Relative paths** if you want the exported M3U8 or XSPF file to move together with your music folder. Because standard M3U8 and XSPF files do not store CUE sub-track ranges, CUE tracks are omitted during export and EffeTune reports how many were skipped.

## Safety and Storage

- Music Library reads audio files and metadata without modifying your files on disk.
- Clearing browser site data removes the web app's catalog and playlists; export important playlists to keep them.
- Large collections load progressively as you scroll. Use Music Library in one EffeTune window at a time.

## Music on your network (desktop app)

Use **Library** to browse this device or a discovered music server, and the device selector at the top of the window to choose where selected music plays. Switching the library changes browsing and search only. Adding folders, rescanning and other local library management are available with **This device** selected.

When browsing another EffeTune library, use **Tracks**, **Albums**, **Artists**, **Genres**, **Subfolders**, **Files**, **Folders**, **Recently Added**, and **Playlists** as you do locally. Search the selected library, sort its lists, and open albums, artists or genres to find their tracks. In **Folders**, use **Tree** to browse the folder hierarchy or **Flat** to list all tracks in the selected folder. Only shared music appears. Remote playlists can be browsed and played; edit them on the source computer.

Other music servers show the categories and folder hierarchy they publish; search and sorting are available only when the server supports them.

To play Music Library tracks on another player, open **Settings > Config... > Network > Library sharing** and explicitly share its folder first. Network playback uses the destination's supported formats and effects; CUE sub-tracks are not available as separate network tracks. See [network music and remote control](openhome.md#choose-a-library-and-a-player) for setup, effect pairing and connection troubleshooting.

To play individual local files without enabling library sharing, choose another player and use **Open music files**. EffeTune makes only the selected files available to that player; keep the source app running.

## Shared music in the PWA

The PWA can browse a registered EffeTune computer’s shared library and play it through this device’s effects or another registered computer. Local PWA files cannot be sent to another player. See [PWA setup and playback](openhome.md#pwa) for adding a device, browser permissions, and connection requirements.

[← Back to README](../README.md)
