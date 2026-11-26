import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { ANDROID_ORIGIN, base64ToBytes, bytesToBase64, getAndroidBridge } from '../../js/android/bridge.js';
import { createAndroidLoudnessTagJob, writeAndroidLoudnessTags } from '../../js/android/loudness-tags.js';
import { AndroidDocumentFile } from '../../js/android/library-io.js';
import { parseBlob } from '../../js/vendor/music-metadata-browser.mjs';
import { getReplayGain } from '../../js/library/metadata/metadata-mapper.js';

function flac(audioSize = 192) {
    const stream = Buffer.alloc(34);
    stream.writeUInt16BE(4096);
    stream.writeUInt16BE(4096, 2);
    stream.writeBigUInt64BE((44100n << 44n) | (1n << 41n) | (15n << 36n) | 4096n, 10);
    const size = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
    const comments = ['TITLE=Keep me', 'replaygain_track_gain=+99 dB'];
    const data = Buffer.concat([size(3), Buffer.from('org'), size(comments.length),
        ...comments.flatMap(text => [size(text.length), Buffer.from(text)])]);
    const block = (type, body, last) => Buffer.concat([Buffer.from([type | (last ? 128 : 0),
        body.length >> 16, (body.length >> 8) & 255, body.length & 255]), body]);
    const audio = Buffer.alloc(audioSize, 0x32);
    return { content: new Uint8Array(Buffer.concat([Buffer.from('fLaC'), block(0, stream, false), block(4, data, true), audio])), audio };
}

// An in-memory SAF provider answering the same commands as DocumentStore.
function provider({ writable = true, granted = true, stableIds = false, originalFlags, temporaryFlags } = {}) {
    let clock = 1000;
    const files = new Map(), calls = [];
    const put = (uri, bytes) => files.set(uri, { bytes, lastModified: clock += 1000 });
    const meta = uri => {
        const file = files.get(uri);
        if (!file) return { uri, name: 'Music', isDirectory: true, writable };
        return { uri, name: file.name ?? uri.split('/').at(-1), size: file.bytes.length, lastModified: file.lastModified,
            mimeType: 'audio/flac', isDirectory: false, writable, canRename: true, canDelete: true,
            ...(uri.endsWith('.tmp') ? temporaryFlags : originalFlags) };
    };
    const handle = ({ command, payload }, keepBackup = false) => {
        calls.push(command);
        switch (command) {
        case 'documents.stat': return meta(payload.uri);
        case 'documents.resolve': return meta(payload.relativePath ? `${payload.treeUri}/${payload.relativePath}` : payload.treeUri);
        case 'documents.permission': return { granted: payload.write ? granted : true };
        case 'documents.read': {
            const { bytes } = files.get(payload.uri);
            return { data: bytesToBase64(bytes.subarray(payload.offset, payload.offset + payload.length)) };
        }
        case 'documents.create': put(`${payload.uri}/${payload.name}`, new Uint8Array()); return meta(`${payload.uri}/${payload.name}`);
        case 'documents.write': {
            const data = base64ToBytes(payload.data);
            put(payload.uri, payload.append ? Buffer.concat([files.get(payload.uri).bytes, data]) : data);
            return { bytesWritten: data.length };
        }
        case 'documents.delete': return { deleted: files.delete(payload.uri) };
        case 'documents.replace': {
            const original = meta(payload.uri), staged = meta(payload.temporary);
            const bytes = files.get(payload.temporary).bytes;
            files.delete(payload.temporary);
            if (original.size !== payload.expectSize || original.lastModified !== payload.expectLastModified ||
                staged.size !== payload.temporarySize || staged.lastModified !== payload.temporaryLastModified) return { status: 'changed' };
            if (stableIds) return { status: 'unavailable' };
            if (keepBackup) files.set('test.effetune-backup', files.get(payload.uri));
            put(payload.uri, bytes);
            return { status: 'written', size: bytes.length, lastModified: meta(payload.uri).lastModified,
                ...(keepBackup ? { backupRemaining: true } : {}) };
        }
        case 'documents.copyRange': {
            const part = files.get(payload.source).bytes.subarray(payload.offset, payload.offset + payload.length);
            put(payload.target, Buffer.concat([files.get(payload.target).bytes, part]));
            return { copied: part.length };
        }
        case 'documents.compareRange': {
            const left = files.get(payload.left).bytes.subarray(payload.leftOffset, payload.leftOffset + payload.length);
            const right = files.get(payload.right).bytes.subarray(payload.rightOffset, payload.rightOffset + payload.length);
            return { equal: Buffer.from(left).equals(Buffer.from(right)) };
        }
        default: throw new Error(command);
        }
    };
    return { files, calls, put, handle };
}

let respond;
const transport = { postMessage(raw) {
    const request = JSON.parse(raw);
    Promise.resolve().then(() => respond(request)).then(
        result => transport.onmessage({ data: JSON.stringify({ version: 1, id: request.id, ok: true, result }) }),
        () => transport.onmessage({ data: JSON.stringify({ version: 1, id: request.id, ok: false, error: { code: 'failed' } }) })
    );
} };
const host = { location: { origin: ANDROID_ORIGIN, href: `${ANDROID_ORIGIN}/assets/effetune.html` }, effetuneAndroid: transport };
let bridge;
after(() => bridge?.close());

async function withProvider(saf, callback) {
    respond = saf.handle;
    await withGlobals({ window: host, console: Object.assign(Object.create(console), { warn() {} }) }, async () => {
        bridge = getAndroidBridge();
        await callback();
    });
}

const URI = 'content://tree/Music/Album/song.flac';
const SOURCE = { treeUri: 'content://tree/Music', relativePath: 'Album/song.flac' };
const measured = saf => ({ trackUid: 'song', sourceKind: 'file', size: saf.files.get(URI).bytes.length,
    mtimeMs: saf.files.get(URI).lastModified, integrated: -22, truePeak: -6, albumIntegrated: -20, albumTruePeak: -3 });

test('Android tag job rewrites a FLAC in place, keeps its audio and URI, and leaves no copy', async () => {
    const saf = provider();
    const { content, audio } = flac();
    saf.put(URI, content);
    const rescans = [], signatures = [];
    await withProvider(saf, async () => {
        const job = createAndroidLoudnessTagJob({
            catalog: {
                listLoudnessTagCandidates: async () => [measured(saf)],
                getTrackStorageIdentity: async () => ({ sourceKind: 'file', folderId: 'f1', lifecycleVersion: 1, relativePath: SOURCE.relativePath }),
                updateLoudnessTagSignatures: async request => { signatures.push(...request.rows); }
            },
            handleStore: { get: async () => ({ kind: 'directory', androidUri: SOURCE.treeUri }) },
            rescanFolder: async folderId => { rescans.push(folderId); return 'completed'; }
        });
        const { snapshotId, eligible } = await job.prepareLoudnessTagWrite();
        assert.equal(eligible, 1);
        const result = await job.writeLoudnessTags({ snapshotId, scanOptions: {} });
        assert.deepEqual({ written: result.written, skipped: result.skipped, failed: result.failed }, { written: 1, skipped: 0, failed: 0 });
        assert.deepEqual([...saf.files.keys()], [URI]);
        assert.equal(saf.calls.filter(command => command === 'documents.replace').length, 1);
        const bytes = saf.files.get(URI).bytes;
        assert.deepEqual(Buffer.from(bytes.subarray(-audio.length)), audio);
        const meta = await parseBlob(new Blob([bytes], { type: 'audio/flac' }), { duration: false });
        assert.equal(meta.common.title, 'Keep me');
        const values = getReplayGain(meta);
        assert.equal(values.trackGainDb, 4);
        assert.equal(values.albumGainDb, 2);
        assert.deepEqual(rescans, ['f1']);
        assert.deepEqual(signatures.map(row => [row.newSize, row.newMtimeMs]), [[bytes.length, saf.files.get(URI).lastModified]]);

        respond = request => saf.handle(request, true);
        const again = await job.prepareLoudnessTagWrite();
        const partial = await job.writeLoudnessTags({ snapshotId: again.snapshotId });
        assert.equal(partial.written, 1);
        assert.equal(partial.failed, 0);
        assert.equal(partial.backupRemaining, true);
        const backups = [...saf.files.keys()].filter(key => key.endsWith('.effetune-backup'));
        assert.equal(backups.length, 1);
        assert.deepEqual(saf.files.get(backups[0]).bytes, bytes);
        assert.equal(signatures.length, 2);
    });
});

test('Android tag writes require folder access, rename and delete support, and a known modification time', async () => {
    for (const options of [{ granted: false }, { writable: false }, { originalFlags: { canRename: false } },
        { originalFlags: { canDelete: false } }, { zeroMtime: true }]) {
        const saf = provider(options);
        saf.put(URI, flac().content);
        if (options.zeroMtime) saf.files.get(URI).lastModified = 0;
        await withProvider(saf, async () => {
            const job = createAndroidLoudnessTagJob({
                catalog: {
                    listLoudnessTagCandidates: async () => [measured(saf)],
                    getTrackStorageIdentity: async () => ({ sourceKind: 'file', folderId: 'f1', lifecycleVersion: 1, relativePath: SOURCE.relativePath }),
                    updateLoudnessTagSignatures: async () => {}
                },
                handleStore: { get: async () => ({ kind: 'directory', androidUri: SOURCE.treeUri }) },
                rescanFolder: async () => 'completed'
            });
            const { snapshotId } = await job.prepareLoudnessTagWrite();
            const result = await job.writeLoudnessTags({ snapshotId });
            assert.equal(result.reasons.unavailable, 1);
            assert.equal(saf.calls.includes('documents.create'), false);
            assert.equal(saf.calls.includes('documents.copyRange'), false);
        });
    }
});

test('Android tag writes preserve changes made after verification', async () => {
    const saf = provider();
    const { content } = flac();
    saf.put(URI, content);
    await withProvider(saf, async () => {
        const track = measured(saf);
        // The original is updated after verification but before the rewrite.
        const changed = await writeAndroidLoudnessTags(URI, track, async () => { saf.put(URI, content); return true; }, SOURCE);
        assert.deepEqual(changed, { status: 'changed' });
        assert.deepEqual(saf.files.get(URI).bytes, content);
        assert.deepEqual([...saf.files.keys()], [URI]);
    });
});

test('Android tag writes keep the whole song if staging fails partway through a copy', async () => {
    const limit = 4 * 1024 * 1024;
    const { content } = flac(limit + 512);
    const saf = provider();
    saf.put(URI, content);
    await withProvider(saf, async () => {
        let stagedBytes;
        respond = request => {
            const { command, payload } = request;
            if (command === 'documents.copyRange' && payload.offset >= limit) {
                stagedBytes = saf.files.get(payload.target).bytes.length;
                throw new Error('EPERM');
            }
            return saf.handle(request);
        };
        const result = await writeAndroidLoudnessTags(URI, measured(saf), async () => true, SOURCE);
        assert.equal(result.status, 'failed');
        assert.ok(stagedBytes >= limit && stagedBytes < content.length + 512);
        assert.deepEqual([...saf.files.keys()], [URI]);
        assert.deepEqual(saf.files.get(URI).bytes, content);
    });
});

test('Android tag writes propagate an unavailable replacement from the host', async () => {
    const saf = provider({ stableIds: true });
    const { content } = flac();
    saf.put(URI, content);
    await withProvider(saf, async () => {
        const result = await writeAndroidLoudnessTags(URI, measured(saf), async () => true, SOURCE);
        assert.deepEqual(result, { status: 'unavailable' });
        assert.deepEqual([...saf.files.keys()], [URI]);
        assert.deepEqual(saf.files.get(URI).bytes, content);
        assert.equal(saf.calls.filter(command => command === 'documents.replace').length, 1);
    });
});

test('Android tag writes check temporary file capabilities before copying audio and report failed cleanup', async () => {
    for (const canDelete of [false, true]) {
        const saf = provider({ temporaryFlags: { canRename: !canDelete, canDelete } });
        saf.put(URI, flac().content);
        await withProvider(saf, async () => {
            if (!canDelete) respond = request => request.command === 'documents.delete' ? { deleted: false } : saf.handle(request);
            const result = await writeAndroidLoudnessTags(URI, measured(saf), async () => true, SOURCE);
            assert.equal(result.status, 'unavailable');
            assert.equal(Boolean(result.temporaryRemaining), !canDelete);
            assert.equal(saf.files.size, canDelete ? 1 : 2);
            assert.ok(!saf.calls.some(command => ['documents.copyRange', 'documents.write', 'documents.replace'].includes(command)));
        });
    }
});

test('Android metadata reads use the M4A extension and fall back to the provider for unknown types', () => {
    const record = { name: 'song.M4A', mimeType: 'audio/mpeg', size: 32 };
    const file = new AndroidDocumentFile(record);
    assert.equal(file.type, 'audio/mp4');
    assert.equal(file.slice(4, 8).type, 'audio/mp4');
    assert.equal(new AndroidDocumentFile({ ...record, name: 'song.other', mimeType: 'audio/custom' }).type, 'audio/custom');
});

test('Android tag replacement timeout leaves the host in charge of both files', async () => {
    const saf = provider(), submitted = [];
    saf.put(URI, flac().content);
    await withProvider(saf, async () => {
        const previous = bridge.timeoutMs;
        let finish;
        respond = request => {
            submitted.push(request.command);
            if (request.command !== 'documents.replace') return saf.handle(request);
            return new Promise(resolve => { finish = () => resolve(saf.handle(request)); });
        };
        try {
            bridge.timeoutMs = 10;
            const result = await writeAndroidLoudnessTags(URI, measured(saf), async () => true, SOURCE);
            assert.deepEqual(result, { status: 'failed' });
            assert.deepEqual(submitted.slice(submitted.indexOf('documents.replace')), ['documents.replace']);
            assert.equal(saf.files.size, 2);
            finish();
            await new Promise(resolve => setImmediate(resolve));
            assert.deepEqual([...saf.files.keys()], [URI]);
            assert.deepEqual(submitted.slice(submitted.indexOf('documents.replace')), ['documents.replace']);
        } finally { bridge.timeoutMs = previous; }
    });
});
