import { CUE_FRAMES_PER_SECOND } from '../library/metadata/cue-sheet.js';

export function nativeQueueTrack(source, index) {
    return { uri: source.uri, name: source.title || source.name || '', type: source.type,
        meta: source.metadata, sourceKind: source.sourceKind, nativeQueueIndex: index, lyricsFile: source.lyricsFile,
        libraryTrackId: source.libraryTrackId,
        ...(source.region ? { startFrame: Math.round(source.region.start * CUE_FRAMES_PER_SECOND),
            endFrame: source.region.end == null ? null : Math.round(source.region.end * CUE_FRAMES_PER_SECOND),
            durationSec: source.region.durationSec } : {}),
        entryInstanceId: `android:${index}`, transportOrdinal: index, canonicalOrdinal: index };
}

// The existing queue UI pages the Service's durable queue without copying its catalog.
export class AndroidPlaybackQueue {
    constructor(bridge) {
        this.bridge = bridge;
        this.kind = 'catalog';
        this.sequenceId = 'android-native';
        this.itemCount = 0;
        this.window = { startOrdinal: 0, rows: [], totalCount: 0 };
    }
    accept(playback) {
        this.itemCount = playback.queueLength || 0;
        const start = playback.queueOffset || 0;
        this.window = { startOrdinal: start, totalCount: this.itemCount,
            rows: (playback.queue || []).map((source, index) => nativeQueueTrack(source, start + index)) };
    }
    async getWindow({ startOrdinal, centerOrdinal = 0, limit = 64 } = {}) {
        const offset = Math.max(0, Math.min(startOrdinal ?? centerOrdinal, Math.max(0, this.itemCount - 1)));
        const result = await this.bridge.request('playback.queue.read', { offset, limit: Math.min(64, limit) });
        this.window = { startOrdinal: result.offset, totalCount: result.total,
            rows: result.items.map((source, index) => nativeQueueTrack(source, result.offset + index)) };
        return this.window;
    }
    peekEntry(index) { return this.window.rows[index - this.window.startOrdinal] || null; }
    async getEntry(index) { return this.peekEntry(index) || (await this.getWindow({ startOrdinal: index, limit: 1 })).rows[0]; }
    resolveEntrySource(entry) { return Promise.resolve(entry); }
    toCanonicalOrdinal(index) { return index; }
    toTransportOrdinal(index) { return index; }
    clear() {}
}
