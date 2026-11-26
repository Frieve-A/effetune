import { createLoudnessTagJob } from '../library/loudness/tag-job.js';
import { checkReplayGainTags, readTagLayout, TAG_EXTENSIONS, tagValues } from '../library/loudness/tag-formats.js';
import { normalizeMtimeMs } from '../library/scan/file-signature.js';
import { parseBlob } from '../vendor/music-metadata-browser.mjs';
import { bytesToBase64 } from './bridge.js';
import { ANDROID_FILE_CHUNK_BYTES } from './documents.js';
import { AndroidDocumentFile, isAndroidDirectory, requestAndroidDocument } from './library-io.js';

// Matches DocumentStore.RANGE_BYTES: one host copy or compare call.
const RANGE_BYTES = 4 * 1024 * 1024;

const stat = uri => requestAndroidDocument('documents.stat', { uri });

function reader(record) {
    const file = new AndroidDocumentFile(record);
    return { read: async (start, length) => new Uint8Array(await file.slice(start, start + length).arrayBuffer()) };
}

async function copy(source, target, start, end) {
    for (let offset = start; offset < end; offset += RANGE_BYTES) {
        await requestAndroidDocument('documents.copyRange', {
            source, target, offset, length: Math.min(RANGE_BYTES, end - offset)
        });
    }
}

async function append(uri, bytes) {
    for (let i = 0; i < bytes.length; i += ANDROID_FILE_CHUNK_BYTES) {
        await requestAndroidDocument('documents.write', {
            uri, data: bytesToBase64(bytes.subarray(i, i + ANDROID_FILE_CHUNK_BYTES)), append: true
        });
    }
}

async function sameRange(left, leftOffset, right, rightOffset, length) {
    for (let i = 0; i < length; i += RANGE_BYTES) {
        const { equal } = await requestAndroidDocument('documents.compareRange', {
            left, leftOffset: leftOffset + i, right, rightOffset: rightOffset + i, length: Math.min(RANGE_BYTES, length - i)
        });
        if (!equal) return false;
    }
    return true;
}

async function verifyMedia(uri, temporary, source, output) {
    if (source.mediaLength !== output.mediaLength ||
        source.offsets?.length !== output.offsets?.length ||
        source.offsets?.some((offset, i) => offset !== output.offsets[i])) {
        throw new Error('Media layout changed');
    }
    if (!await sameRange(uri, source.mediaStart, temporary, output.mediaStart, source.mediaLength)) {
        throw new Error('Encoded audio changed');
    }
}

async function remove(uri) {
    try {
        return (await requestAndroidDocument('documents.delete', { uri })).deleted;
    } catch (error) {
        console.warn('ReplayGain file cleanup failed:', error);
        return false;
    }
}

export async function writeAndroidLoudnessTags(uri, track, mayReplace, source) {
    const name = source.relativePath.split('/').at(-1);
    const dot = name.lastIndexOf('.');
    const extension = dot < 0 ? '' : name.slice(dot).toLowerCase();
    const tags = tagValues(track);
    if (track.sourceKind !== 'file' || !tags.REPLAYGAIN_TRACK_GAIN || !TAG_EXTENSIONS.includes(extension)) {
        return { status: 'unsupported' };
    }
    let temporary = null;
    let outcome = { status: 'failed' };
    try {
        const original = await stat(uri);
        if (!original.canRename || !original.canDelete || !original.lastModified || !track.mtimeMs) return { status: 'unavailable' };
        if (original.size !== track.size || normalizeMtimeMs(original.lastModified) !== track.mtimeMs) return { status: 'changed' };
        const slash = source.relativePath.lastIndexOf('/');
        const folder = await requestAndroidDocument('documents.resolve', {
            treeUri: source.treeUri, relativePath: slash < 0 ? '' : source.relativePath.slice(0, slash)
        });
        if (!folder.writable) return { status: 'unavailable' };
        const layout = await readTagLayout(reader(original), original.size, extension, tags);
        const created = await requestAndroidDocument('documents.create', {
            uri: folder.uri, name: `.effetune-${crypto.randomUUID()}.tmp`, mimeType: 'application/octet-stream'
        });
        if (created.uri === uri) return outcome;
        temporary = created.uri;
        if (!created.canRename || !created.canDelete || !created.writable) {
            outcome.status = 'unavailable';
            return outcome;
        }
        await copy(uri, temporary, 0, layout.start);
        await append(temporary, layout.replacement);
        await copy(uri, temporary, layout.end, original.size);
        const written = await stat(temporary);
        const output = await readTagLayout(reader({ ...written, uri: temporary }), written.size, extension, tags);
        await verifyMedia(uri, temporary, layout, output);
        const { native } = await parseBlob(new AndroidDocumentFile({ ...written, uri: temporary,
            name: original.name, mimeType: original.mimeType }), { duration: false, skipCovers: true });
        checkReplayGainTags(native, tags);
        if (!await mayReplace()) {
            outcome.status = 'changed';
            return outcome;
        }
        const replacement = { uri, temporary, expectSize: original.size, expectLastModified: original.lastModified,
            temporarySize: written.size, temporaryLastModified: written.lastModified };
        // A timeout can arrive while the host is still installing or restoring the file.
        temporary = null;
        const { lastModified, ...result } = await requestAndroidDocument('documents.replace', replacement);
        outcome = result;
        if (outcome.status === 'written') outcome.mtimeMs = normalizeMtimeMs(lastModified);
    } catch (error) {
        if (error?.code === 'UNSUPPORTED_TAG' || error instanceof RangeError) outcome.status = 'unsupported';
        else console.warn('ReplayGain tag verification or write failed:', error);
    } finally {
        if (temporary && !await remove(temporary)) outcome.temporaryRemaining = true;
    }
    return outcome;
}

// The Web catalog Worker owns the Android tag job, as the catalog host does on
// desktop, and exposes it with the same request shapes.
export function createAndroidLoudnessTagJob({ catalog, handleStore, rescanFolder }) {
    const job = createLoudnessTagJob({
        readSnapshot: async () => ({ tracks: await catalog.listLoudnessTagCandidates() }),
        async resolveSource(trackUid) {
            const track = await catalog.getTrackStorageIdentity(trackUid);
            if (track?.sourceKind !== 'file') return null;
            const handle = await handleStore.get(track.folderId);
            if (!isAndroidDirectory(handle)) return null;
            const treeUri = handle.androidUri;
            // Folders picked without write access stay read-only.
            if (!(await requestAndroidDocument('documents.permission', { uri: treeUri, write: true })).granted) return null;
            const { uri } = await requestAndroidDocument('documents.resolve', { treeUri, relativePath: track.relativePath });
            return { path: uri, folderId: track.folderId, lifecycleVersion: track.lifecycleVersion, treeUri,
                relativePath: track.relativePath };
        },
        updateSignatures: rows => catalog.updateLoudnessTagSignatures({ rows }),
        rescanFolder,
        makeWriter: () => ({ write: writeAndroidLoudnessTags, close() {} })
    });
    return {
        prepareLoudnessTagWrite: () => job.prepare(),
        discardLoudnessTagSnapshot: ({ snapshotId } = {}) => job.discard(snapshotId),
        writeLoudnessTags: ({ snapshotId, scanOptions = {} } = {}) => job.write({ snapshotId, scanOptions: {
            languageHints: scanOptions.languageHints ?? null, includeVideo: scanOptions.includeVideo === true,
            includeMidi: scanOptions.includeMidi === true, includeMidiArchives: scanOptions.includeMidiArchives === true
        } })
    };
}
