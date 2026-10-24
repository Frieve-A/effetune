import assert from 'node:assert/strict';
import test from 'node:test';
import { copyGraphImage } from '../../features/measurement/ui/graph-image-copy.js';

async function environment(values, run) {
    const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    try {
        for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
        return await run();
    } finally {
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
}

test('copy starts the browser write before asynchronous PNG encoding and reports real failure categories', async () => {
    let complete, writes = 0;
    const canvas = { width: 1600, height: 900, toBlob: callback => { complete = callback; } };
    class Item { constructor(data) { this.data = data; } }
    const clipboard = { write: async items => { writes++; await items[0].data['image/png']; } };
    await environment({ window: {}, navigator: { clipboard }, ClipboardItem: Item }, async () => {
        const pending = copyGraphImage(canvas);
        assert.equal(writes, 1);
        complete(new Blob(['png'], { type: 'image/png' }));
        await pending;
        clipboard.write = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
        const denied = copyGraphImage(canvas);
        complete(null);
        // Encoding failed independently before permission rejection was observed.
        await assert.rejects(denied, { code: 'encoding' });
        canvas.toBlob = callback => callback(new Blob(['png'], { type: 'image/png' }));
        await assert.rejects(copyGraphImage(canvas), { code: 'denied' });
        clipboard.write = async items => { await items[0].data['image/png']; };
        canvas.toBlob = callback => callback(null);
        await assert.rejects(copyGraphImage(canvas), { code: 'encoding' });
    });
    await environment({ window: {}, navigator: {}, ClipboardItem: undefined }, async () => {
        await assert.rejects(copyGraphImage(canvas), { code: 'unsupported' });
    });
});

test('Electron image bridge is preferred and false results never report a successful copy', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const canvas = { width: 10, height: 10, toBlob: callback => callback(new Blob([bytes], { type: 'image/png' })) };
    let received;
    const bridge = { writeClipboardImage: async value => { received = value; return true; } };
    await environment({ window: { electronAPI: bridge }, navigator: {}, ClipboardItem: undefined }, async () => {
        await copyGraphImage(canvas);
        assert.deepEqual(received, bytes);
        bridge.writeClipboardImage = async () => false;
        await assert.rejects(copyGraphImage(canvas), { code: 'failed' });
    });
});
