# Music Library 2.1 implementation plan

This document records the product owner's normative decisions for Music Library 2.1. Future implementation work and regression audits must treat these decisions as the intended 2.1 behavior, not as regressions from 2.0.

## Release baseline

- The next release version is `2.1.0` everywhere.
- Preserve all 2.0 functionality and UX unless a removal or replacement is explicitly recorded here.
- The removed IndexedDB-based library implementation and its catalog resurrection or migration paths are intentionally out of scope.
- Do not roll back an intentional 2.1 feature merely because it differs from 2.0.

## Startup and catalog recovery

- A Music Library database or utility startup failure must not prevent the Effect Pipeline from starting.
- Music Library must show a plain-language recovery UI when its catalog cannot be opened.
- The recovery UI must let the user explicitly confirm deletion/reset of the broken catalog and then retry initialization.
- Developer diagnostics belong in the Console; the UI must not expose raw errors or internal identifiers.

## Browser compatibility and persistence

- Safari, Firefox, and mobile browsers without the File System Access API must retain 2.0-equivalent support.
- Their catalog may persist, but selected files and file handles are session-only. After a reload, the user reselects the files.
- Reselected files reconnect to catalog entries by normalized relative path.
- This compatibility path must not resurrect the removed IndexedDB catalog implementation.

## Playback and unavailable files

- Playback transport state is session-only.
- Remove persisted playback-operation history, client request IDs, operation rejoin, persisted progress, restart/interruption recovery, transport ownership, and persisted Undo state.
- Within the current session, Play, Play Next, Queue, large logical selections, and ordinary Undo remain supported. Playlist persistence is unchanged.
- When a playback source is unavailable because file permission was lost, request permission again before skipping it.
- Retry that same occurrence once after permission is restored.
- If it still cannot be played, or permission is not restored, skip it and continue with the next playable occurrence.
- Within one playback operation, show the permission UI at most once for each `(folderId, lifecycleVersion)`. After cancellation or failure, skip the remaining occurrences from that folder generation without prompting again.
- A later independent playback operation may show the permission UI once again for that folder generation.
- The retry/skip process must be bounded and must apply both to explicit playback and automatic advancement.
- Playlist occurrence identity must be preserved independently from track identity, including duplicate occurrences of the same track.

## Library ordering and search

- **Recently Added** is ordered by addition time, newest first, and is limited to 500 tracks for 2.0 compatibility.
- Global search includes Tracks, Albums, Artists, and Playlists.
- Search results must not have a fixed maximum such as eight results per category. A summary may show only its current page, but that page size is not a result limit: every match must remain reachable through a paged category-results route that preserves the query.
- Desktop search and supported detail scopes retain their default selection mode. Mobile search and detail scopes do not enter that mode automatically.
- User-selectable sorting for playlists, albums, subfolders, and related collection views is being implemented in a separate task. This task must not overwrite or roll back that work, and does not establish a new fixed playlist default order.

## Paged browsing and mobile scrolling

- Track browsing keeps a bounded page cache. Mobile scrolling may read at most two adjacent pages ahead in the current direction.
- A page needed by the visible viewport has priority over additional read-ahead. When that page arrives through the prefetch path, publish its cached rows immediately and stop the rest of that read-ahead request instead of waiting for the full batch.
- Publish every completed viewport page to the bounded cache even while scroll input continues. Coalesce repeated viewport requests onto the latest ordinal; activate it without another database read when the completed page covers it, otherwise continue with only that newest request.
- Bias an uncached viewport read toward the active scroll direction. A downward read starts at the first visible ordinal. An upward read retains enough trailing rows for the current render range and uses the rest of the 200-row page as forward coverage above the viewport, avoiding the one-row reverse overlap that otherwise leaves the upper viewport empty.
- When every page in the directional read-ahead range is already cached, or the range reaches the start or end of the context, return before allocating a prefetch request ID or starting the asynchronous prefetch loop.
- Invalidating read-ahead does not start another prefetch concurrently with the obsolete read, and no additional obsolete page is requested after it completes.
- SQLite supports interruption, but the current Electron and Web catalog adapters execute statements synchronously and expose no cross-worker interruption path. This limitation does not justify withholding a completed page from the viewport cache.
- Reuse overlapping track-row DOM elements while the virtual render window moves. Create rows only for newly exposed ordinals or changed row objects.
- An ordinal seek may read from the nearer end of the ordered context, then return to keyset cursors for sequential paging. This bounds the offset scan to the nearer side without changing cursor semantics.
- In the Web runtime, cache context before-image byte totals by `shadow_count`. Recompute the aggregate only when that count changes; the count remains the invalidation authority because before-image insertions and deletions update it transactionally.

## Playlist import and recovery

- Keep the 2.1 convenience feature that automatically discovers `.m3u`, `.m3u8`, `.pls`, and `.xspf` files during a folder scan.
- Automatic playlist import is intentional and must not be removed in the name of 2.0 compatibility.
- Automatic import is content-aware, not once-only. A playlist source is identified by its folder and normalized relative path. Unchanged content is skipped; when that same source file changes, its existing automatically imported playlist is updated.
- The source file is authoritative for an automatically imported playlist. When its content changes, replace that playlist's items atomically with the newly imported content; in-app edits to that playlist are overwritten by the next changed-source import.
- Deleting or renaming a source playlist file does not delete its previously imported playlist. A renamed source path is treated as a new source and creates its own automatically imported playlist.
- A failed, interrupted, or canceled automatic import is retried on a later rescan. Only the last successfully imported content fingerprint is terminal for that content revision.
- If the main folder scan has finished and the user cancels during automatic playlist import, report the folder scan as complete while explicitly reporting the playlist-import cancellation. Remaining playlist imports are handled by the next rescan rather than by an implicit immediate resume.
- Manual playlist import remains supported and must present a preview before committing changes.
- Unresolved playlist entries should be re-resolved automatically when newly available files or roots provide enough information.
- Automatic resolution must use all useful known information, including normalized relative paths and Electron absolute/root context where available, so duplicate relative paths under different roots can be distinguished.
- A manual Retry or Locate action should exist only if it can resolve a case that automatic resolution cannot. Do not retain a redundant manual action.
- Add to Playlist and manual or automatic Import keep their atomic database staging, commit, cancellation, and failure cleanup.
- Their UI progress tracking is current-session only. Do not persist pending UI operation IDs in session storage or reconnect the UI to an operation after a renderer reload or utility restart.

## Desktop and mobile interaction

- In both desktop and mobile layouts, track searches and album, artist, genre, and subfolder details select all matching tracks by default only when the result contains 300 tracks or fewer. Results with 301 tracks or more start unselected.
- Automatic selection changes only selection state and never enters mobile selection mode.
- Desktop selection is indicated by checkboxes. A selected desktop row otherwise keeps its normal appearance.
- Mobile layout normally shows the track-name list and ordinary row actions, without selection checkboxes, Select All, or Deselect All.
- Only long-pressing a mobile track enters selection mode and then reveals the checkboxes, Select All, and Deselect All controls.
- Selection state and mobile selection mode are independent. Automatic selection, Select All, Deselect All, and individual checkbox changes do not enter or leave selection mode.
- When the long-pressed track is already included in a logical Select All selection, keep the complete selection and enter selection mode so that selection can be edited from that state.
- In ordinary mobile mode with zero selected tracks, the visible Play, Play Next, Queue, and Add to Playlist actions operate on the entire current context, matching the 2.0 behavior.
- Dragging a Select All or Shift-range selection to the Audio Player operates on the complete logical selection, not only currently rendered or cached rows.
- `.library-paged-row.selected` styling is visible only in mobile layout while selection mode is active. Outside that state, a selected row has its normal appearance.
- Artist and duration are not shown in mobile track rows.
- When an artwork card is shown in mobile layout, its title is below the artwork, not beside it.

## Playlist export

- The Playlists collection does not show a collection-level export action.
- Playlist export remains available from each individual playlist detail view in the supported M3U8 and XSPF formats.
- Do not add a collection-level control that only redirects focus or asks the user to select a playlist.

## Performance workflow

- The fixed-reference performance workflow is a local, manually invoked development tool.
- It uses the production Electron utility process, Web Worker, and mixed AudioWorklet path with a deterministic fixture and reference-machine manifest.
- Performance checks are not part of every pre-commit check, `npm run verify`, or GitHub Actions.
- A performance observation is development data, not a release gate or pass/fail result.
- A dirty-worktree measurement is allowed when useful during development and records that the worktree was dirty.
- Do not run the fixed-reference measurement for ordinary commits; invoke it manually only when development work needs performance observations.

## Electron playback source transport

- Electron uses grant-checked canonical absolute file paths for playback sources.
- The authoritative main-process resolver checks the active folder grant and resolves the track beneath that granted root before returning its path to the renderer.
- The IPC result carries the absolute path; it does not require or generate a separate `mediaUrl` in the main process.
- Sequence-entry identity is checked before source resolution, and the resolver returns the path after the folder grant check.
- The renderer converts the authorized path for the media element, so playback remains streaming and files larger than 256 MiB remain supported.
- The whole-file byte broker and its 256 MiB playback limit are not part of the 2.1 playback contract.
- A custom streaming protocol is not required for 2.1.
- Typed permission errors, bounded reauthorization, retry, and skip behavior remain required.

## Artwork decoding

- Preserve the image-format compatibility provided by the platform decoder and `createImageBitmap`; do not maintain separate PNG, JPEG, or WebP header parsers.
- Enforce the raw artwork byte limit before decoding.
- After decoding, enforce the source width, height, pixel-count, and decoded-byte limits before storage admission or thumbnail generation.

## Commit-readiness scope

- Do not add features or policy in response to adversarial review findings.
- Remaining work is limited to bug fixes, removal of over-engineered or unintended behavior, and making the existing 2.1 scope ready to commit.
- Folder removal must remain visibly marked as in progress, including when an interrupted removal resumes after a Web app restart. Normal Library browsing remains available during physical cleanup, which must not cause full-page loading flicker.
- High maintainability is a product goal. New machinery belongs in 2.1 only when its current user benefit clearly and substantially outweighs its implementation and ongoing maintenance cost.
- Do not add speculative recovery, persistence, ownership, evidence, or policy layers for hypothetical review concerns.
- When removing unintended work, preserve changes made by parallel tasks. Delete only work whose origin and lack of requirement are established, or work the product owner explicitly directed to remove.
- Electron keeps one generic whole-file byte reader for non-catalog local-file imports. It accepts regular files only, rejects files larger than 256 MiB before reading, and replaces the removed legacy Library scanner, mirror, artwork, and binary/base64 IPC stack.
- Active Electron and Web File System Access library roots follow the 2.0 containment rules: an exact or nested root is rejected, while adding a parent root requires one native confirmation and then fully removes the contained roots before scanning the parent.
- Reconnect may bind an existing Electron folder record to a readable folder that was moved or renamed. It preserves the folder identity and scan history, applies the same root-containment confirmation rules, advances the folder lifecycle, grants the new canonical path only after acceptance, and starts a rescan. Tracks from the previous lifecycle must not resolve through the new grant before that rescan completes successfully.
