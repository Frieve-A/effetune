import { createDsdRangeChannel } from '../ui/audio-player/dsd-range-channel.js';
import { normalizeMtimeMs } from '../library/scan/file-signature.js';
import { AndroidDocumentFile, requestAndroidDocument } from './library-io.js';

// A SAF document is not a transferable Blob. Give the analysis worker the same
// bounded range channel it uses for desktop files.
export async function prepareAndroidLoudnessSource(track, uri, signal) {
    signal?.throwIfAborted();
    const record = await requestAndroidDocument('documents.stat', { uri });
    signal?.throwIfAborted();
    if (record.size !== track.size || normalizeMtimeMs(record.lastModified) !== track.mtimeMs) {
        return { status: 'unavailable' };
    }
    const file = new AndroidDocumentFile({ ...record, uri });
    const channel = createDsdRangeChannel({
        size: file.size,
        async read(offset, length) {
            signal?.throwIfAborted();
            const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
            signal?.throwIfAborted();
            return bytes;
        },
        dispose() {}
    });
    return { ...channel, size: file.size };
}
