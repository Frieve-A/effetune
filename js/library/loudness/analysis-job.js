import { getFileExtension, isSupportedMidiPath } from '../constants.js';
import { loadDspModule } from '../../audio/dsp-wasm-loader.js';
import { createDsdRangeChannel } from '../../ui/audio-player/dsd-range-channel.js';
import { normalizeMtimeMs } from '../scan/file-signature.js';

export async function prepareLoudnessSource(track, source, signal, api = globalThis.window?.electronAPI) {
  const matches = (size, mtimeMs) => track.size === size && track.mtimeMs === normalizeMtimeMs(mtimeMs);
  if (source?.file) return matches(source.file.size, source.file.lastModified) ? { file: source.file } : { status: 'unavailable' };
  if (!source?.path) return { status: 'unavailable' };
  let path = source.path;
  let converted = false;
  let channel;
  let session;
  async function dispose() {
    try {
      if (channel) await channel.dispose();
      else if (session) await api.closePlaybackRange(session.token);
    }
    finally { if (converted) await api.releaseLoudnessSource(path); }
  }
  try {
    if (['m4a', 'mp4'].includes(getFileExtension(path))) {
      signal?.throwIfAborted();
      const id = crypto.randomUUID();
      const cancel = () => { void api.cancelLoudnessSource(id).catch(error => console.warn('ALAC cancellation failed:', error)); };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const result = await api.prepareLoudnessSource(path, id, { size: track.size, mtimeMs: track.mtimeMs });
        if (!result.success) return { status: ['alacRequiresMacDesktop', 'alacUnsupportedDepth'].includes(result.code)
          ? 'unsupported' : 'unavailable' };
        ({ path, converted } = result);
      } finally { signal?.removeEventListener('abort', cancel); }
    }
    signal?.throwIfAborted();
    session = await api.openPlaybackRange(path);
    if (!converted && !matches(session.size, session.mtimeMs)) {
      await dispose();
      return { status: 'unavailable' };
    }
    channel = createDsdRangeChannel({ size: session.size,
      read: async (offset, length) => new Uint8Array(await api.readPlaybackRange(session.token, offset, length)),
      dispose: () => api.closePlaybackRange(session.token)
    });
    return { port: channel.port, size: session.size, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

// One worker per lane lives for the job, so consecutive tracks reuse the
// compiled WASM module. Cancelling terminates active decoders immediately.
function createAnalysisLane(signal) {
  let worker;
  return {
    async analyze(track, source) {
      let input;
      try { input = await prepareLoudnessSource(track, source, signal); }
      catch (error) {
        if (!signal?.aborted) console.warn('Loudness source unavailable:', error);
        return { status: 'unavailable' };
      }
      if (input.status) return input;
      try {
        let module;
        if (!worker) {
          const dsp = globalThis.window?.audioManager?.dspModuleInfo ?? await loadDspModule({
            basePath: new URL('../../../', import.meta.url).href
          });
          if (!dsp) throw new Error('Loudness DSP unavailable');
          module = dsp.moduleCloneable ? dsp.module : dsp.bytes;
          worker = new Worker(new URL('../../vendor/loudness-analysis-worker.mjs', import.meta.url), { type: 'module' });
        }
        signal?.throwIfAborted();
        const result = await new Promise((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal?.addEventListener('abort', abort, { once: true });
          worker.onmessage = ({ data }) => {
            signal?.removeEventListener('abort', abort);
            if (data.error) reject(new Error(data.error));
            else resolve(data);
          };
          worker.onerror = event => {
            signal?.removeEventListener('abort', abort);
            reject(new Error(event.message));
          };
          const { file, size, port } = input;
          worker.postMessage({ file, size, port, module, startFrame: track.startFrame, endFrame: track.endFrame },
            port ? [port] : []);
        });
        return result;
      } finally { await input.dispose?.(); }
    },
    close() { worker?.terminate(); }
  };
}

export async function runLoudnessAnalysis({ catalog, resolveSource, signal, onProgress, refreshLoudness,
  createLane = createAnalysisLane }) {
  const counts = { processed: 0, total: 0, measured: 0, unsupported: 0, failed: 0, unavailable: 0 };
  const controller = new AbortController();
  const jobSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  const lanes = Array.from({ length: 2 }, () => createLane(jobSignal));
  let afterTrackUid = '';
  async function measure(lane, track) {
    const extension = getFileExtension(track.relativePath);
    if (track.sourceKind === 'archive-entry' || ['dsf', 'dff'].includes(extension) || isSupportedMidiPath(track.relativePath)) {
      return { status: 'unsupported' };
    }
    let source;
    try { source = await resolveSource(track); }
    catch (error) { console.warn('Loudness source unavailable:', error); }
    if (!source) return { status: 'unavailable' };
    jobSignal.throwIfAborted();
    return lane.analyze(track, source);
  }
  try {
    while (!jobSignal.aborted) {
      const { tracks, totalCount } = await catalog.listPendingLoudness({ afterTrackUid, limit: 64 });
      if (!afterTrackUid) {
        counts.total = totalCount;
        onProgress?.({ ...counts });
      }
      if (!tracks.length) break;
      afterTrackUid = tracks[tracks.length - 1].trackUid;
      const pending = tracks.values();
      const tasks = lanes.map(async lane => {
        try {
          for (const track of pending) {
            if (jobSignal.aborted) break;
            const result = await measure(lane, track);
            if (jobSignal.aborted) break;
            if (result.status !== 'unavailable') {
              await catalog.saveTrackLoudness({ measurements: [{ ...track, ...result }] });
            }
            counts[result.status]++;
            counts.processed++;
            onProgress?.({ ...counts });
          }
        } catch (error) {
          if (!jobSignal.aborted) {
            controller.abort(error);
            throw error;
          }
        }
      });
      const failed = (await Promise.allSettled(tasks)).find(task => task.status === 'rejected');
      if (failed) throw failed.reason;
    }
    return counts;
  } finally {
    for (const lane of lanes) lane.close();
    await refreshLoudness();
  }
}
