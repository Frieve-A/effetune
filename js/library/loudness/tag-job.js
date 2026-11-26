// Writes ReplayGain tags for a confirmed catalog snapshot. The host supplies
// catalog access, source resolution and a writer with
// `write(path, track, mayReplace, source)` and `close()`.
export function createLoudnessTagJob({ readSnapshot, resolveSource, updateSignatures, rescanFolder, makeWriter }) {
    let snapshot = null;
    let busy = false;
    return {
        async prepare() {
            if (busy) throw new Error('A tag operation is already running');
            busy = true;
            try {
                const { tracks } = await readSnapshot();
                const id = globalThis.crypto.randomUUID();
                snapshot = tracks.length ? { id, tracks } : null;
                return { snapshotId: id, eligible: tracks.length, total: tracks.length };
            } finally { busy = false; }
        },
        discard(id) {
            if (snapshot?.id !== id) return false;
            snapshot = null;
            return true;
        },
        async write({ snapshotId, scanOptions = {} } = {}) {
            if (busy || !snapshot || snapshot.id !== snapshotId) throw new Error('No matching tag operation');
            busy = true;
            const { tracks } = snapshot;
            snapshot = null;
            const changes = [];
            const folders = new Set();
            const result = { written: 0, skipped: 0, failed: 0, rescanFailed: 0, syncFailed: false, total: tracks.length,
                reasons: { unsupported: 0, changed: 0, unavailable: 0 } };
            let writer;
            async function closeWriter() {
                try { await writer?.close(); }
                catch (error) { console.warn('ReplayGain writer cleanup failed:', error); }
                writer = null;
            }
            try {
                for (const track of tracks) {
                    let source;
                    try { source = await resolveSource(track.trackUid); }
                    catch (error) { console.warn('ReplayGain source unavailable:', error?.code); }
                    let outcome = { status: 'unavailable' };
                    if (source?.path) {
                        try {
                            writer ??= makeWriter();
                            outcome = await writer.write(source.path, track, async () => {
                                const current = await resolveSource(track.trackUid);
                                return current?.path === source.path && current.folderId === source.folderId &&
                                    current.lifecycleVersion === source.lifecycleVersion;
                            }, source);
                        } catch (error) {
                            console.warn('ReplayGain writer failed:', error);
                            outcome = { status: 'failed' };
                            await closeWriter();
                        }
                    }
                    if (outcome.backupRemaining) result.backupRemaining = true;
                    if (outcome.temporaryRemaining) result.temporaryRemaining = true;
                    if (outcome.status === 'written') {
                        result.written++;
                        folders.add(source.folderId);
                        changes.push({ trackUid: track.trackUid, size: track.size, mtimeMs: track.mtimeMs,
                            newSize: outcome.size, newMtimeMs: outcome.mtimeMs });
                    } else if (Object.hasOwn(result.reasons, outcome.status)) {
                        result.reasons[outcome.status]++;
                        result.skipped++;
                    } else result.failed++;
                }
                await closeWriter();
                const retry = [];
                for (let i = 0; i < changes.length; i += 256) {
                    const rows = changes.slice(i, i + 256);
                    try { await updateSignatures(rows); }
                    catch (error) {
                        console.warn('ReplayGain signatures could not be saved before the rescan:', error);
                        retry.push(rows);
                    }
                }
                for (const folderId of folders) {
                    try {
                        if (await rescanFolder(folderId, scanOptions) !== 'completed') result.rescanFailed++;
                    } catch (error) {
                        console.warn('ReplayGain folder rescan unavailable:', error?.code);
                        result.rescanFailed++;
                    }
                }
                for (const rows of retry) {
                    try { await updateSignatures(rows); }
                    catch (error) {
                        console.warn('ReplayGain signatures could not be saved after the rescan:', error);
                        result.syncFailed = true;
                    }
                }
            } finally {
                await closeWriter();
                busy = false;
            }
            return { ...result, folderIds: [...folders] };
        }
    };
}
