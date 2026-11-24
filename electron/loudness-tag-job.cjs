'use strict';

const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { Worker, MessageChannel } = require('node:worker_threads');

function createWriter() {
  const worker = new Worker(path.join(__dirname, 'loudness-tag-worker.mjs'));
  return {
    write(filename, track, mayReplace) {
      return new Promise((resolve, reject) => {
        const { port1, port2 } = new MessageChannel();
        port1.once('message', async () => {
          let allowed = false;
          try { allowed = await mayReplace(); }
          catch (error) { console.warn('ReplayGain source access changed:', error?.code); }
          port1.postMessage(allowed);
        });
        function cleanup() {
          port1.close();
          worker.off('message', done);
          worker.off('error', fail);
          worker.off('exit', exited);
        }
        function done(result) { cleanup(); resolve(result); }
        function fail(error) { cleanup(); reject(error); }
        function exited(code) { fail(new Error(`ReplayGain writer exited: ${code}`)); }
        worker.once('message', done).once('error', fail).once('exit', exited);
        worker.postMessage({ path: filename, track, port: port2 }, [port2]);
      });
    },
    close: () => worker.terminate()
  };
}

function createLoudnessTagJob({ readSnapshot, resolveSource, updateSignatures, rescanFolder, makeWriter = createWriter }) {
  let snapshot = null;
  let busy = false;
  return {
    async prepare() {
      if (busy) throw new Error('A tag operation is already running');
      busy = true;
      try {
        const { tracks } = await readSnapshot();
        const id = randomUUID();
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
              });
            } catch (error) {
              console.warn('ReplayGain writer failed:', error);
              outcome = { status: 'failed' };
              await closeWriter();
            }
          }
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

module.exports = { createLoudnessTagJob };
