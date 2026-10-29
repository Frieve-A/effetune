import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { ANDROID_ORIGIN, bytesToBase64, getAndroidBridge } from '../../js/android/bridge.js';
import { AndroidDocumentFile, requestAndroidDocument, receiveAndroidDocumentReply,
    forwardAndroidDocumentRequest } from '../../js/android/library-io.js';
import { AndroidLibraryFilesystem } from '../../js/android/library-filesystem.js';
import { AndroidDocuments } from '../../js/android/documents.js';
import { selectAndroidFolderFiles } from '../../js/android/folder-import.js';
import { installAndroidFileDownloads } from '../../js/android/file-downloads.js';

let respond;
const transport = { postMessage(raw) {
    const request = JSON.parse(raw);
    Promise.resolve().then(() => respond(request)).then(
        result => transport.onmessage({ data: JSON.stringify({ version: 1, id: request.id, ok: true, result }) }),
        error => transport.onmessage({ data: JSON.stringify({ version: 1, id: request.id, ok: false,
            error: { code: error.name === 'AbortError' ? 'cancelled' : 'failed' } }) })
    );
} };
const host = { location: { origin: ANDROID_ORIGIN, href: `${ANDROID_ORIGIN}/assets/effetune.html` },
    effetuneAndroid: transport };
let bridge;
async function withDocuments(handler, callback) {
    respond = handler;
    await withGlobals({ window: host }, async () => {
        bridge = getAndroidBridge();
        await callback();
    });
}
after(() => bridge?.close());

test('SAF worker replies correlate concurrent reads and release rejected operations', async () => {
    const requests = [];
    await withGlobals({ window: undefined, location: { origin: ANDROID_ORIGIN },
        postMessage: message => requests.push(message) }, async () => {
        const first = requestAndroidDocument('documents.stat', { uri: 'content://first' });
        const second = requestAndroidDocument('documents.stat', { uri: 'content://second' });
        const failure = assert.rejects(second, /document access failed/);
        assert.notEqual(requests[0].id, requests[1].id);
        assert.equal(receiveAndroidDocumentReply({ type: 'unrelated' }), false);
        receiveAndroidDocumentReply({ type: 'android-document-reply', id: requests[1].id, ok: false });
        receiveAndroidDocumentReply({ type: 'android-document-reply', id: requests[0].id, ok: true, result: { size: 12 } });
        assert.deepEqual(await first, { size: 12 });
        await failure;
        assert.equal(receiveAndroidDocumentReply({ type: 'android-document-reply', id: requests[1].id, ok: true }), true);
        await assert.rejects(requestAndroidDocument('documents.write', {}), /Unsupported/);
        assert.equal(requests.length, 2);
    });
    await withDocuments(request => {
        if (request.payload.uri === 'content://denied') throw new Error('private provider diagnostic');
        return { size: 12 };
    }, async () => {
        const replies = [];
        const worker = { postMessage: message => replies.push(message) };
        for (const [id, uri] of [['allowed', 'content://first'], ['denied', 'content://denied']]) {
            assert.equal(forwardAndroidDocumentRequest(worker,
                { type: 'android-document-request', command: 'documents.stat', id, payload: { uri } }), true);
        }
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(replies, [
            { protocolVersion: 1, type: 'android-document-reply', id: 'allowed', ok: true, result: { size: 12 } },
            { protocolVersion: 1, type: 'android-document-reply', id: 'denied', ok: false }
        ]);
    });
});

test('SAF files stream bounded ranges and detect a provider truncation', async () => {
    const bytes = new Uint8Array(256 * 1024 + 3).fill(65), reads = [];
    await withDocuments(({ command, payload }) => {
        assert.equal(command, 'documents.read');
        reads.push(payload);
        return { data: bytesToBase64(payload.uri === 'content://truncated' ? new Uint8Array() :
            bytes.subarray(payload.offset, payload.offset + payload.length)) };
    }, async () => {
        const file = new AndroidDocumentFile({ uri: 'content://file', name: 'sample.bin', size: bytes.length });
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
        assert.deepEqual(reads.map(({ offset, length }) => [offset, length]), [[0, 256 * 1024], [256 * 1024, 3]]);
        assert.equal(await file.slice(-3).text(), 'AAA');
        assert.equal(reads.at(-1).offset, 256 * 1024);
        await assert.rejects(new AndroidDocumentFile({ uri: 'content://truncated', size: 10 }).arrayBuffer(), /changed while reading/);
    });
});

test('SAF folder imports retain nested SFZ paths and stop a cancelled or stalled listing', async () => {
    const calls = [];
    const documents = new AndroidDocuments({ async request(command, payload) {
        calls.push({ command, payload });
        if (command === 'documents.pick') return { uri: 'content://root', name: 'Bank' };
        if (payload.uri === 'content://samples') return { entries: [
            { uri: 'content://sample', name: 'note.wav', size: 3 }
        ], nextOffset: null };
        return payload.offset === 0 ? { entries: [{ uri: 'content://samples', name: 'Samples', isDirectory: true }], nextOffset: 1 }
            : { entries: [{ uri: 'content://sfz', name: 'bank.sfz', size: 12 }], nextOffset: null };
    } });
    const files = await selectAndroidFolderFiles({}, documents);
    assert.deepEqual(files.map(file => file.webkitRelativePath), ['Bank/Samples/note.wav', 'Bank/bank.sfz']);
    assert.deepEqual(calls.filter(call => call.command === 'documents.list').map(call => call.payload.offset), [0, 0, 1]);
    calls.length = 0;
    await assert.rejects(selectAndroidFolderFiles({ isCurrent: () => false }, documents), { name: 'AbortError' });
    assert.equal(calls.length, 1);
    await assert.rejects(selectAndroidFolderFiles({}, {
        pick: async () => ({ uri: 'content://root', name: 'Bank' }),
        list: async () => ({ entries: [], nextOffset: 0 })
    }), /Invalid folder page/);
});

test('SAF folder imports reject provider names that cannot form a single relative path component', async () => {
    for (const rootName of [false, true]) {
        for (const name of ['', '.', '..', '../outside', 'nested/file.wav', 'nested\\file.wav']) {
            const listed = [];
            await assert.rejects(selectAndroidFolderFiles({}, {
                pick: async () => ({ uri: 'content://root', name: rootName ? name : 'Bank' }),
                async list(uri) {
                    listed.push(uri);
                    assert.equal(uri, 'content://root');
                    return { entries: [
                        { uri: 'content://valid', name: 'valid.wav', size: 1 },
                        ...(rootName ? [] : [{ uri: 'content://invalid', name, isDirectory: true }])
                    ], nextOffset: null };
                }
            }), /invalid file name/);
            assert.deepEqual(listed, rootName ? [] : ['content://root']);
        }
    }
});

test('SAF library sidecar reads enforce size limits before fetching content', async () => {
    const requests = [];
    await withDocuments(({ command, payload }) => {
        requests.push({ command, payload });
        if (command === 'documents.resolve') return { uri: `content://${payload.relativePath}` };
        if (command === 'documents.stat') return { size: 3, lastModified: 42, name: 'track.lrc' };
        if (command === 'documents.list') return { entries: [{ name: 'Samples', isDirectory: true }, { name: 'track.lrc' }], nextOffset: null };
        if (command === 'documents.read') return { data: bytesToBase64(new TextEncoder().encode('abc')) };
        assert.fail(command);
    }, async () => {
        const filesystem = new AndroidLibraryFilesystem({ rootHandle: { androidUri: 'content://root' } });
        assert.deepEqual(await filesystem.listFileNames(''), ['track.lrc']);
        assert.deepEqual(await filesystem.statFile({ entry: { relativePath: 'track.lrc' } }),
            { fileIdentity: 'content://track.lrc', size: 3, mtimeMs: 42 });
        assert.deepEqual(await filesystem.readSmallFile({ relativePath: 'track.lrc', maximumBytes: 2 }),
            { tooLarge: true, size: 3, bytes: null });
        assert.equal(requests.some(request => request.command === 'documents.read'), false);
        const result = await filesystem.readSmallFile({ relativePath: 'track.lrc', maximumBytes: 3 });
        assert.equal(new TextDecoder().decode(result.bytes), 'abc');
        const count = requests.length;
        await assert.rejects(filesystem.resolve('../outside'), /Invalid document path/);
        assert.equal(requests.length, count);
    });
});

test('Android downloads retain revoked Blob data and distinguish cancel from export failure', async () => {
    const requests = [], notices = [];
    let click, mode = 'share', complete;
    await withDocuments(({ command, payload }) => {
        requests.push({ command, payload });
        if (command === 'documents.pick') {
            if (mode === 'cancel') { complete(); throw new DOMException('Cancelled', 'AbortError'); }
            return { uri: 'content://export', share: true };
        }
        if (command === 'documents.write' && mode === 'fail') throw new Error('Provider unavailable');
        if (command === 'documents.share') complete();
        return {};
    }, async () => {
        const windowRef = { ...host, document: { addEventListener(type, listener) { assert.equal(type, 'click'); click = listener; } },
            uiManager: { setError(...args) { notices.push(args); complete(); } } };
        installAndroidFileDownloads(windowRef);
        const download = () => {
            const href = URL.createObjectURL(new Blob(['exported'], { type: 'text/plain' }));
            let prevented = false;
            click({ target: { closest: () => ({ href, download: 'preset.txt' }) }, preventDefault() { prevented = true; } });
            URL.revokeObjectURL(href);
            assert.equal(prevented, true);
        };
        await new Promise((resolve, reject) => {
            const guard = setTimeout(() => reject(new Error('Export did not finish')), 2000);
            complete = () => { clearTimeout(guard); resolve(); };
            download();
        });
        assert.deepEqual(requests.map(request => request.command), ['documents.pick', 'documents.write', 'documents.share']);
        assert.equal(atob(requests[1].payload.data), 'exported');
        mode = 'cancel';
        await new Promise((resolve, reject) => {
            const guard = setTimeout(() => reject(new Error('Export picker did not open')), 2000);
            complete = () => { clearTimeout(guard); resolve(); };
            download();
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(notices, []);
        mode = 'fail';
        await withGlobals({ console: Object.assign(Object.create(console), { error() {} }) }, async () => {
            await new Promise((resolve, reject) => {
                const guard = setTimeout(() => reject(new Error('Export error was not shown')), 2000);
                complete = () => { clearTimeout(guard); resolve(); };
                download();
            });
        });
        assert.deepEqual(notices, [['error.fileExportFailed', true]]);
    });
});

test('Android export interception leaves ordinary and external links alone and saves supported download URLs', async () => {
    const requests = [], fetched = [];
    let click, complete;
    await withDocuments(({ command, payload }) => {
        requests.push({ command, payload });
        if (command === 'documents.pick') return { uri: 'content://export' };
        assert.equal(command, 'documents.write');
        complete();
        return {};
    }, async () => {
        await withGlobals({ fetch: async url => {
            fetched.push(url);
            return new Response(new Blob(['saved'], { type: 'text/plain' }));
        } }, async () => {
            installAndroidFileDownloads({ ...host, document: { addEventListener(_type, listener) { click = listener; } } });
            const activate = link => {
                let prevented = false;
                click({ target: { closest(selector) { assert.equal(selector, 'a[download]'); return link; } },
                    preventDefault() { prevented = true; } });
                return prevented;
            };
            assert.equal(activate(null), false);
            assert.equal(activate({ href: 'https://external.invalid/file.txt', download: 'file.txt' }), false);
            assert.deepEqual(fetched, []);
            assert.deepEqual(requests, []);
            for (const href of [`blob:${ANDROID_ORIGIN}/export`, 'data:text/plain,saved', `${ANDROID_ORIGIN}/assets/export.txt`]) {
                const start = requests.length;
                await new Promise((resolve, reject) => {
                    const guard = setTimeout(() => reject(new Error('Supported download did not finish')), 2000);
                    complete = () => { clearTimeout(guard); resolve(); };
                    assert.equal(activate({ href, download: 'export.txt' }), true);
                });
                assert.equal(fetched.at(-1), href);
                assert.deepEqual(requests.slice(start).map(request => request.command), ['documents.pick', 'documents.write']);
                assert.equal(requests[start].payload.name, 'export.txt');
                assert.equal(atob(requests.at(-1).payload.data), 'saved');
            }
        });
    });
});
