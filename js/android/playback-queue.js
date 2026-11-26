import { CUE_FRAMES_PER_SECOND } from '../library/metadata/cue-sheet.js';
import { CATALOG_QUEUE_WINDOW_SIZE, ReversibleShufflePermutation } from '../ui/audio-player/playback-sequence.js';

export function nativeQueueTrack(source, index, transportOrdinal = index) {
    return { uri: source.uri, name: source.title || source.name || '', type: source.type,
        meta: source.metadata, sourceKind: source.sourceKind, nativeQueueIndex: index, lyricsFile: source.lyricsFile,
        libraryTrackId: source.libraryTrackId,
        ...(source.scoreUri && { scoreUri: source.scoreUri, fileName: source.scoreName }),
        ...(source.region ? { startFrame: Math.round(source.region.start * CUE_FRAMES_PER_SECOND),
            endFrame: source.region.end == null ? null : Math.round(source.region.end * CUE_FRAMES_PER_SECOND),
            durationSec: source.region.durationSec } : {}),
        entryInstanceId: `android:${index}`, transportOrdinal, canonicalOrdinal: index };
}

export async function reportAndroidPlaybackRestore(uiManager, bridge) {
    const { omittedCount, restoredCount } = await bridge.request('playback.queue.takeRestoreResult');
    if (omittedCount > 0 && restoredCount > 0) {
        uiManager.showTransientMessage('status.playbackSessionPartiallyRestored', false, { count: omittedCount });
    } else if (omittedCount > 0) {
        uiManager.showTransientMessage('status.playbackSessionNotRestored');
    }
}

// The existing queue UI pages the Service's durable queue without copying its catalog.
export class AndroidPlaybackQueue {
    constructor(bridge) {
        this.bridge = bridge;
        this.kind = 'catalog';
        this.sequenceId = 'android-native';
        this.itemCount = 0;
        this.windowRequest = 0;
        this.window = { startOrdinal: 0, rows: [], totalCount: 0 };
    }
    accept(playback) {
        const count = playback.queueLength || 0;
        const seed = playback.shuffle ? playback.shuffleSeed ?? 0 : undefined;
        const offset = count ? (playback.shuffleOffset || 0) % count : 0;
        this.currentCanonicalOrdinal = playback.index;
        this.currentTransportOrdinal = playback.ordinal;
        this.explicitOrder = playback.explicitOrder === true;
        if (this.itemCount === count && this.revision === playback.queueRevision &&
            this.permutation?.seed === seed && this.shuffleOffset === offset) return false;
        this.itemCount = count;
        this.revision = playback.queueRevision;
        this.permutation = seed === undefined ? null : new ReversibleShufflePermutation(count, seed);
        this.shuffleOffset = offset;
        this.windowRequest++;
        this.window = { startOrdinal: this.window.startOrdinal, rows: [], totalCount: count };
        return true;
    }
    async getWindow({ startOrdinal, centerOrdinal = 0, limit = CATALOG_QUEUE_WINDOW_SIZE } = {}) {
        limit = Math.min(limit, CATALOG_QUEUE_WINDOW_SIZE);
        const request = ++this.windowRequest;
        const totalCount = this.itemCount;
        const start = startOrdinal === undefined
            ? Math.max(0, Math.min(centerOrdinal - Math.floor(limit / 2), totalCount - limit))
            : Math.max(0, Math.min(startOrdinal, totalCount - 1));
        const rows = [];
        while (request === this.windowRequest && rows.length < limit && start + rows.length < totalCount) {
            const offset = start + rows.length;
            const count = Math.min(64, limit - rows.length, totalCount - offset);
            const page = await this.bridge.request('playback.queue.read', { offset, limit: count });
            if (request !== this.windowRequest || page.total !== totalCount) break;
            for (const source of page.items) {
                const ordinal = start + rows.length;
                rows.push(nativeQueueTrack(source, source.canonicalOrdinal ?? this.toCanonicalOrdinal(ordinal), ordinal));
            }
            if (page.items.length < count) break;
        }
        const window = { startOrdinal: start, totalCount, rows };
        if (request === this.windowRequest) this.window = window;
        return window;
    }
    async getPlaylistTrackIds() {
        const ids = [];
        const total = this.itemCount;
        const revision = this.revision;
        for (let offset = 0; offset < total; offset += 64) {
            const limit = Math.min(64, total - offset);
            const page = await this.bridge.request('playback.queue.read', { offset, limit });
            if (page.revision !== revision || page.total !== total || page.items.length !== limit) {
                throw new Error('The playback queue changed while reading its tracks.');
            }
            for (const item of page.items) {
                if (item.libraryTrackId) ids.push(item.libraryTrackId);
            }
        }
        return ids;
    }

    async updateReplayGainFactors(computeFactor, isCurrent) {
        const update = async sources => {
            const items = [];
            for (const source of sources) {
                if (!isCurrent()) return;
                const replayGainFactor = await computeFactor(source);
                if (source.replayGainFactor !== replayGainFactor) items.push({ queueEntryId: source.queueEntryId, replayGainFactor });
            }
            if (items.length && isCurrent()) {
                await this.bridge.request('playback.queue.updateGains', { items });
            }
        };
        const priority = await this.bridge.request('playback.queue.readGains');
        const priorityIds = new Set();
        for (const source of priority.items) {
            if (priorityIds.has(source.queueEntryId)) continue;
            priorityIds.add(source.queueEntryId);
            await update([source]);
        }
        let afterId = 0;
        while (isCurrent()) {
            const { items } = await this.bridge.request('playback.queue.readGains', { afterId });
            if (!items.length) break;
            await update(items.filter(source => !priorityIds.has(source.queueEntryId)));
            afterId = items.at(-1).queueEntryId;
        }
    }

    peekEntry(index) { return this.window.rows[index - this.window.startOrdinal] || null; }
    async getEntry(index) {
        const cached = this.peekEntry(index);
        if (cached) return cached;
        const { items } = await this.bridge.request('playback.queue.read', { offset: index, limit: 1 });
        return items.length ? nativeQueueTrack(items[0], items[0].canonicalOrdinal ?? this.toCanonicalOrdinal(index), index) : null;
    }
    async getCanonicalEntry(index) {
        if (!this.explicitOrder) return this.getEntry(this.toTransportOrdinal(index));
        const { items } = await this.bridge.request('playback.queue.read', { offset: index, limit: 1, canonical: true });
        return items.length ? nativeQueueTrack(items[0], index, items[0].transportOrdinal) : null;
    }
    resolveEntrySource(entry) { return Promise.resolve(entry); }
    toCanonicalOrdinal(index) {
        if (this.explicitOrder) return index === this.currentTransportOrdinal
            ? this.currentCanonicalOrdinal : this.peekEntry(index)?.canonicalOrdinal ?? -1;
        return this.permutation ? this.permutation.permute((index + this.shuffleOffset) % this.itemCount) : index;
    }
    toTransportOrdinal(index) {
        if (this.explicitOrder) return index === this.currentCanonicalOrdinal ? this.currentTransportOrdinal
            : this.window.rows.find(entry => entry.canonicalOrdinal === index)?.transportOrdinal ?? -1;
        return this.permutation && index >= 0
            ? (this.permutation.invert(index) - this.shuffleOffset + this.itemCount) % this.itemCount : index;
    }
    clear() {}
}
